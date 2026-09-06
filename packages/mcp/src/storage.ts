/**
 * 로컬 파일 시스템에 `.slip` 파일을 저장하는 저장소 어댑터.
 * MCP 서버와 Node.js 호스트 애플리케이션이 같은 파일 접근 규칙을 사용할 수 있다.
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  SlipStorageError,
  decryptSlipFile,
  encryptSlipFile,
  isEncryptedSlipFile,
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
  type SlipListFilter,
  type SlipListItem,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import {
  LIST_METRICS,
  ListMetadataCache,
  statCandidates,
  type CandidateStat,
  type ListCacheResult,
  type ListMetrics,
} from './list-cache.js';

/** 파일 암호화에 사용할 문자열 또는 32바이트 원시 키. */
export type FileSystemStorageKey = string | Uint8Array;

/** {@link FileSystemStorage} 생성 옵션 */
export interface FileSystemStorageOptions {
  /**
   * `.slip` 파일을 읽고 쓸 기준 디렉터리. 이 밖의 경로는 거부한다.
   * 디렉터리 안에 있는 심볼릭 링크라도 실제 위치가 밖이면 거부한다.
   */
  rootDir: string;
  /** 오류 메시지 언어 (`ko`, `en`, `ja`). 기본 영어 */
  locale?: string;
  /**
   * 파일 암호화 설정. 지정하면 저장 시 암호화 봉투로 쓰고, 읽을 때는
   * `key`와 `previousKeys`를 순서대로 시도해 복호화한다. 평문 파일은 그대로 읽는다.
   */
  encryption?: { key: FileSystemStorageKey; previousKeys?: FileSystemStorageKey[] };
}

/** 목록 조회 한 페이지에 담는 항목 수 */
const LIST_PAGE_SIZE = 50;

/**
 * 지정한 디렉터리 안의 `.slip` 파일을 읽고 쓰는 {@link StorageAdapter} 구현.
 *
 * 저장 키(id)는 기준 디렉터리에 대한 상대 경로다. 하위 디렉터리를 포함할 수 있고
 * `.slip` 확장자는 없으면 붙인다. 기준 디렉터리를 벗어나는 경로는 `io` 오류로 거부한다.
 */
export class FileSystemStorage implements StorageAdapter {
  /** 기준 디렉터리의 절대 경로. 디렉터리가 있으면 심볼릭 링크를 푼 실제 경로다 */
  readonly rootDir: string;
  private readonly locale: string | undefined;
  private readonly encryption: FileSystemStorageOptions['encryption'];
  /** 목록 조회가 쓰는 인스턴스 메모리 캐시. 다른 인스턴스와 결과를 나누지 않는다 */
  private readonly listCache = new ListMetadataCache();

  /**
   * @param options - 기준 디렉터리, 오류 메시지 언어와 암호화 설정
   */
  constructor(options: FileSystemStorageOptions) {
    this.rootDir = realRootDir(options.rootDir);
    this.locale = options.locale;
    this.encryption = options.encryption;
    // 계측 값은 공개 API를 늘리지 않으려고 열거되지 않는 심볼 속성으로만 노출한다.
    Object.defineProperty(this, LIST_METRICS, {
      value: this.listCache.metrics,
      enumerable: false,
    });
  }

  /**
   * 저장 키를 기준 디렉터리 안의 절대 경로로 변환한다.
   *
   * @param id - 상대 경로 저장 키 (`.slip` 확장자는 없으면 붙인다)
   * @returns 절대 경로
   * @throws SlipStorageError 파일 이름이 비어 있거나 경로가 기준 디렉터리를 벗어나면 (`io`)
   */
  resolvePath(id: string): string {
    const withExt = id.endsWith('.slip') ? id : `${id}.slip`;
    // 빈 id나 디렉터리로 끝나는 id는 이름 없는 `.slip` 파일을 만들므로 거부한다.
    if (path.basename(withExt) === '.slip') {
      throw new SlipStorageError('io', mcpText(this.locale).emptyId(id));
    }
    return resolveInRoot(this.rootDir, withExt, this.locale);
  }

  /**
   * `.slip` 파일을 저장한다. 같은 id가 이미 있으면 덮어쓴다.
   * 암호화가 설정되어 있으면 암호화 봉투로 저장한다.
   * 임시 파일에 쓴 뒤 이름을 바꿔 교체하므로 쓰기가 실패해도 기존 파일은 그대로 남는다.
   *
   * @param id - 상대 경로 저장 키
   * @param file - 저장할 `.slip` 파일
   * @throws SlipStorageError 경로 이탈(심볼릭 링크 경유 포함)·쓰기 실패(io) 시
   */
  async save(id: string, file: SlipFile): Promise<void> {
    const abs = this.resolvePath(id);
    const text = this.encryption
      ? await encryptSlipFile(file, this.encryption.key, this.localeOptions())
      : serializeSlipFile(file);
    await assertInsideRootReal(this.rootDir, abs, this.locale, id);
    try {
      await writeFileAtomic(abs, text);
    } catch (error) {
      throw new SlipStorageError('io', reasonOf(error));
    }
    this.listCache.invalidate(this.cacheKey(abs));
  }

  /**
   * id의 `.slip` 파일을 읽는다. 암호화 봉투는 설정된 키로 복호화한다.
   *
   * @param id - 상대 경로 저장 키
   * @returns 파싱·검증한 `.slip` 파일
   * @throws SlipStorageError 파일 없음(not-found), 경로 이탈 또는 읽기 실패(io) 시
   * @throws SlipEncryptionError 암호화 파일인데 키가 없거나 맞는 키가 없을 때
   * @throws SlipParseError 파일이 유효한 `.slip`이 아니면
   */
  async load(id: string): Promise<SlipFile> {
    const abs = this.resolvePath(id);
    await assertInsideRootReal(this.rootDir, abs, this.locale, id);
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        throw new SlipStorageError('not-found', mcpText(this.locale).notFound(id));
      }
      throw new SlipStorageError('io', reasonOf(error));
    }
    return this.parseText(text);
  }

  /**
   * id의 파일을 삭제한다.
   *
   * @param id - 상대 경로 저장 키
   * @throws SlipStorageError 파일 없음(not-found), 경로 이탈 또는 삭제 실패(io) 시
   */
  async delete(id: string): Promise<void> {
    const abs = this.resolvePath(id);
    await assertInsideRootReal(this.rootDir, abs, this.locale, id);
    try {
      await unlink(abs);
    } catch (error) {
      if (isNotFound(error)) {
        throw new SlipStorageError('not-found', mcpText(this.locale).notFound(id));
      }
      throw new SlipStorageError('io', reasonOf(error));
    }
    this.listCache.invalidate(this.cacheKey(abs));
  }

  /**
   * 기준 디렉터리(하위 디렉터리 포함)의 `.slip` 파일 목록을 반환한다.
   * 읽거나 복호화할 수 없는 파일과 심볼릭 링크(링크된 디렉터리 안의 파일 포함)는 목록에서 제외한다.
   *
   * 이름 탐색과 `lstat`은 조회할 때마다 다시 하고, 파일이 바뀌지 않았으면 본문을 다시 읽지 않는다.
   * 한 페이지와 다음 페이지 존재 여부를 판정할 만큼 모이면 남은 후보는 열어 보지 않는다.
   *
   * @param filter - 종류·검색어 필터 (검색어는 제목과 경로에 부분 일치)
   * @param cursor - 이전 페이지가 돌려준 nextCursor
   * @returns 목록 한 페이지 (경로순 정렬)
   * @throws SlipStorageError 디렉터리 조회 실패(io)·잘못된 커서(io) 시
   */
  async list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage> {
    const metrics = this.listCache.metrics;
    metrics.listCalls += 1;
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    if (Number.isNaN(offset) || offset < 0) {
      throw new SlipStorageError('io', mcpText(this.locale).badCursor());
    }

    let names: string[];
    try {
      const entries = await readdir(this.rootDir, { recursive: true, withFileTypes: true });
      metrics.directoryEntries += entries.length;
      names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.slip'))
        .map((entry) => path.relative(this.rootDir, path.join(entry.parentPath, entry.name)))
        .sort();
    } catch (error) {
      throw new SlipStorageError('io', reasonOf(error));
    }
    metrics.candidates += names.length;
    // 이번 탐색에서 사라진 경로는 캐시에 남겨 두지 않는다.
    this.listCache.retain(new Set(names));

    const stats = await statCandidates(
      names.map((name) => path.join(this.rootDir, name)),
      metrics,
    );

    // 한 페이지와 다음 페이지 존재 여부를 판정할 만큼 모이면 남은 후보는 열어 보지 않는다.
    const needed = offset + LIST_PAGE_SIZE + 1;
    const items: SlipListItem[] = [];
    for (let index = 0; index < names.length && items.length < needed; index += 1) {
      const name = names[index] as string;
      const info = stats[index];
      if (info === null || info === undefined) continue;
      const result =
        this.listCache.lookup(name, info.fingerprint) ??
        (await this.listCache.resolve(name, info.fingerprint, () => this.readListItem(name, info)));
      if (!('item' in result)) continue;
      const item = result.item;
      if (filter?.kind !== undefined && item.kind !== filter.kind) continue;
      if (filter?.query !== undefined && !matchesQuery(item, filter.query)) continue;
      items.push(item);
    }

    const page = items.slice(offset, offset + LIST_PAGE_SIZE);
    const nextOffset = offset + LIST_PAGE_SIZE;
    return {
      items: page,
      ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  /** 후보 파일 하나를 목록 항목으로 해석한다. 목록에 넣을 수 없는 파일은 제외 결과가 된다. */
  private async readListItem(name: string, info: CandidateStat): Promise<ListCacheResult> {
    // 심볼릭 링크와 일반 파일이 아닌 항목은 본문을 열지 않고 제외한다.
    if (info.isSymbolicLink || !info.isFile) return { excluded: true };
    const metrics = this.listCache.metrics;
    try {
      const abs = this.resolvePath(name);
      // 링크된 디렉터리를 거쳐 기준 디렉터리 밖에 닿는 경로는 본문을 읽기 전에 막는다.
      await assertInsideRootReal(this.rootDir, abs, this.locale, name);
      const text = await readFile(abs, 'utf8');
      metrics.bodyReads += 1;
      metrics.bodyBytes += Buffer.byteLength(text, 'utf8');
      const file = await this.parseText(text, metrics);
      const title =
        file.kind === 'template' ? file.template.meta.title : file.templateSnapshot.meta.title;
      return { item: { id: name, kind: file.kind, title, updatedAt: info.mtime.toISOString() } };
    } catch {
      return { excluded: true };
    }
  }

  /** 절대 경로를 캐시 키로 쓰는 기준 디렉터리 기준 상대 경로로 바꾼다. */
  private cacheKey(abs: string): string {
    return path.relative(this.rootDir, abs);
  }

  /**
   * 파일 내용을 파싱한다. 암호화 봉투는 설정된 키와 이전 키를 순서대로 시도한다.
   * 계측 객체를 넘기면 파싱·복호화 횟수를 센다.
   */
  private async parseText(text: string, metrics?: ListMetrics): Promise<SlipFile> {
    if (!isEncryptedSlipFile(text)) {
      if (metrics !== undefined) metrics.parses += 1;
      return parseSlipFile(text, this.localeOptions());
    }
    if (!this.encryption) {
      throw new SlipStorageError('io', mcpText(this.locale).encryptedNoKey());
    }
    const keys = [this.encryption.key, ...(this.encryption.previousKeys ?? [])];
    let lastError: unknown;
    for (const key of keys) {
      try {
        if (metrics !== undefined) metrics.decryptAttempts += 1;
        const file = await decryptSlipFile(text, key, this.localeOptions());
        if (metrics !== undefined) metrics.parses += 1;
        return file;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private localeOptions(): { locale?: string } {
    return this.locale === undefined ? {} : { locale: this.locale };
  }
}

/**
 * 상대 경로를 기준 디렉터리 안의 절대 경로로 변환한다.
 *
 * @param rootDir - 기준 디렉터리 (절대 경로)
 * @param relPath - 변환할 상대 경로
 * @param locale - 오류 메시지 언어
 * @returns 절대 경로
 * @throws SlipStorageError 경로가 기준 디렉터리를 벗어나면 (`io`)
 */
export function resolveInRoot(rootDir: string, relPath: string, locale?: string): string {
  const abs = path.resolve(rootDir, relPath);
  if (escapesRoot(rootDir, abs)) {
    throw new SlipStorageError('io', mcpText(locale).outsideRoot(relPath));
  }
  return abs;
}

/** 절대 경로가 기준 디렉터리 자신이거나 그 밖에 있는지 문자열 기준으로 판정한다. */
function escapesRoot(rootDir: string, abs: string): boolean {
  const rel = path.relative(rootDir, abs);
  // `..foo`처럼 점 두 개로 시작하는 정상 이름은 상위 디렉터리 참조가 아니다.
  return rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/** 기준 디렉터리를 절대 경로로 만들고, 디렉터리가 있으면 심볼릭 링크를 푼 실제 경로로 바꾼다. */
function realRootDir(rootDir: string): string {
  const resolved = path.resolve(rootDir);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Node 파일 오류가 경로의 일부가 없거나 디렉터리가 아니라는 뜻인지 판별한다. */
function isMissingPath(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * 경로의 심볼릭 링크를 풀어 실제 경로를 구한다. 아직 없는 꼬리 부분은 가장 가까운
 * 존재하는 상위 경로의 실제 경로 뒤에 그대로 붙인다.
 *
 * @param abs - 절대 경로
 * @param followTargetLink - true면 경로 자체가 링크여도 따라가 실제 경로를 구한다 (기준 디렉터리용)
 * @returns 실제 경로와, 경로가 가리키는 항목 자체가 심볼릭 링크인지 여부
 */
async function realizePath(
  abs: string,
  followTargetLink = false,
): Promise<{ real: string; isLink: boolean }> {
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      const info = await lstat(current);
      // 대상 자체가 링크면 가리키는 곳이 없어도(단절된 링크) 링크라는 사실만으로 충분하다.
      if (current === abs && info.isSymbolicLink() && !followTargetLink) {
        return { real: abs, isLink: true };
      }
      break;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      const parent = path.dirname(current);
      // 파일 시스템 루트까지 없으면 더 올라갈 곳이 없다.
      if (parent === current) break;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
  return { real: path.join(await realpath(current), ...rest), isLink: false };
}

/**
 * 절대 경로가 실제로도 기준 디렉터리 안에 있는지 확인한다. {@link resolveInRoot}의 문자열 검사와
 * 달리 심볼릭 링크를 풀어 판정하므로, 기준 디렉터리 안에 있는 링크를 거쳐 밖의 파일에 닿는 경로를
 * 막는다. 대상 자체가 링크면 어디를 가리키든 거부하고, 아직 없는 경로는 가장 가까운 존재하는
 * 상위 경로의 실제 위치로 판정한다. 파일을 읽고 쓰기 직전에 호출한다.
 *
 * @param rootDir - 기준 디렉터리 (절대 경로)
 * @param abs - {@link resolveInRoot}를 통과한 절대 경로
 * @param locale - 오류 메시지 언어
 * @param label - 오류 메시지에 쓸 경로 표기 (기본은 기준 디렉터리 기준 상대 경로)
 * @throws SlipStorageError 실제 위치가 기준 디렉터리 밖이거나 대상이 심볼릭 링크일 때, 또는 경로를 확인할 수 없을 때 (`io`)
 */
export async function assertInsideRootReal(
  rootDir: string,
  abs: string,
  locale?: string,
  label: string = path.relative(rootDir, abs),
): Promise<void> {
  let rootReal: string;
  let target: { real: string; isLink: boolean };
  try {
    rootReal = (await realizePath(path.resolve(rootDir), true)).real;
    target = await realizePath(abs);
  } catch (error) {
    throw new SlipStorageError('io', reasonOf(error));
  }
  if (target.isLink || escapesRoot(rootReal, target.real)) {
    throw new SlipStorageError('io', mcpText(locale).outsideRoot(label));
  }
}

/**
 * 파일을 원자적으로 쓴다. 같은 디렉터리의 임시 파일에 먼저 쓰고 이름을 바꿔 교체하므로
 * 도중에 실패해도 대상 파일은 이전 내용 그대로 남고, 임시 파일은 정리한다.
 * 부모 디렉터리가 없으면 만든다.
 *
 * @param abs - 대상 파일의 절대 경로
 * @param data - 쓸 내용 (문자열은 UTF-8)
 * @throws Error 디렉터리 생성·쓰기·이름 바꾸기가 실패했을 때 (Node 파일 오류 그대로)
 */
export async function writeFileAtomic(abs: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(abs), { recursive: true });
  // 임시 파일은 `.slip`·`.pdf`로 끝나지 않아 목록 조회나 링크 서버에 노출되지 않는다.
  const temp = `${abs}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, data, typeof data === 'string' ? 'utf8' : undefined);
    await rename(temp, abs);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** 항목의 제목 또는 경로에 검색어가 부분 일치하는지 확인한다. */
function matchesQuery(item: SlipListItem, query: string): boolean {
  const q = query.toLowerCase();
  return item.title.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
}

/**
 * Node 파일 오류가 "파일 없음"인지 판별한다.
 *
 * @param error - 확인할 오류
 * @returns `ENOENT` 오류면 true
 */
export function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

/** 오류 값을 도구 응답에 넣을 문자열로 변환한다. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 파일 저장소 오류 문구. 영어를 기본으로 한국어와 일본어를 지원한다. */
const MCP_TEXT = {
  en: {
    notFound: (id: string) => `No saved file: ${id}`,
    outsideRoot: (id: string) => `Path is outside the working directory: ${id}`,
    emptyId: (id: string) => `File name is empty: "${id}"`,
    encryptedNoKey: () =>
      'The file is encrypted but no key is configured. Set the SLIPKIT_MCP_KEY environment variable.',
    badCursor: () => 'Invalid list cursor',
  },
  ko: {
    notFound: (id: string) => `저장된 파일이 없습니다: ${id}`,
    outsideRoot: (id: string) => `작업 디렉터리 밖의 경로입니다: ${id}`,
    emptyId: (id: string) => `파일 이름이 비어 있습니다: "${id}"`,
    encryptedNoKey: () =>
      '암호화된 파일인데 설정된 키가 없습니다. SLIPKIT_MCP_KEY 환경변수를 설정하세요.',
    badCursor: () => '잘못된 목록 커서입니다',
  },
  ja: {
    notFound: (id: string) => `保存されたファイルがありません: ${id}`,
    outsideRoot: (id: string) => `作業ディレクトリ外のパスです: ${id}`,
    emptyId: (id: string) => `ファイル名が空です: "${id}"`,
    encryptedNoKey: () =>
      '暗号化されたファイルですが、キーが設定されていません。SLIPKIT_MCP_KEY 環境変数を設定してください。',
    badCursor: () => '無効なリストカーソルです',
  },
} as const;

/** 로케일에 맞는 문구 사전을 반환한다 (기본 영어). */
export function mcpText(locale: string | undefined): (typeof MCP_TEXT)['en'] {
  const lang = locale?.toLowerCase().split('-')[0];
  if (lang === 'ko') return MCP_TEXT.ko;
  if (lang === 'ja') return MCP_TEXT.ja;
  return MCP_TEXT.en;
}
