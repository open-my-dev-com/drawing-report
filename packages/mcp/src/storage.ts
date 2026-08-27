/**
 * 로컬 파일 시스템에 `.slip` 파일을 저장하는 저장소 어댑터.
 * MCP 서버가 내부에서 사용하고, Node 백엔드를 가진 호스트도 같은 규칙으로 재사용할 수 있다.
 */
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
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

/** 파일별 암호화에 사용하는 암호문 또는 32바이트 원시 키 */
export type FileSystemStorageKey = string | Uint8Array;

/** {@link FileSystemStorage} 생성 옵션 */
export interface FileSystemStorageOptions {
  /** `.slip` 파일을 읽고 쓸 기준 디렉터리. 이 밖의 경로는 거부한다. */
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
  /** 기준 디렉터리의 절대 경로 */
  readonly rootDir: string;
  private readonly locale: string | undefined;
  private readonly encryption: FileSystemStorageOptions['encryption'];

  /**
   * @param options - 기준 디렉터리, 오류 메시지 언어와 암호화 설정
   */
  constructor(options: FileSystemStorageOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.locale = options.locale;
    this.encryption = options.encryption;
  }

  /**
   * 저장 키를 기준 디렉터리 안의 절대 경로로 변환한다.
   *
   * @param id - 상대 경로 저장 키 (`.slip` 확장자는 없으면 붙인다)
   * @returns 절대 경로
   * @throws SlipStorageError 경로가 기준 디렉터리를 벗어나면 (`io`)
   */
  resolvePath(id: string): string {
    const withExt = id.endsWith('.slip') ? id : `${id}.slip`;
    return resolveInRoot(this.rootDir, withExt, this.locale);
  }

  /**
   * `.slip` 파일을 저장한다. 같은 id가 이미 있으면 덮어쓴다.
   * 암호화가 설정되어 있으면 암호화 봉투로 저장한다.
   *
   * @param id - 상대 경로 저장 키
   * @param file - 저장할 `.slip` 파일
   * @throws SlipStorageError 경로 이탈·쓰기 실패(io) 시
   */
  async save(id: string, file: SlipFile): Promise<void> {
    const abs = this.resolvePath(id);
    const text = this.encryption
      ? await encryptSlipFile(file, this.encryption.key, this.localeOptions())
      : serializeSlipFile(file);
    try {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, text, 'utf8');
    } catch (error) {
      throw new SlipStorageError('io', reasonOf(error));
    }
  }

  /**
   * id의 `.slip` 파일을 읽는다. 암호화 봉투는 설정된 키로 복호화한다.
   *
   * @param id - 상대 경로 저장 키
   * @returns 파싱·검증한 `.slip` 파일
   * @throws SlipStorageError 없음(not-found)·경로 이탈·읽기 실패(io) 시
   * @throws SlipEncryptionError 암호화 파일인데 키가 없거나 맞는 키가 없을 때
   * @throws SlipParseError 파일이 유효한 `.slip`이 아니면
   */
  async load(id: string): Promise<SlipFile> {
    const abs = this.resolvePath(id);
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
   * @throws SlipStorageError 없음(not-found)·경로 이탈·삭제 실패(io) 시
   */
  async delete(id: string): Promise<void> {
    const abs = this.resolvePath(id);
    try {
      await unlink(abs);
    } catch (error) {
      if (isNotFound(error)) {
        throw new SlipStorageError('not-found', mcpText(this.locale).notFound(id));
      }
      throw new SlipStorageError('io', reasonOf(error));
    }
  }

  /**
   * 기준 디렉터리(하위 디렉터리 포함)의 `.slip` 파일 목록을 반환한다.
   * 읽거나 복호화할 수 없는 파일은 목록에서 제외한다.
   *
   * @param filter - 종류·검색어 필터 (검색어는 제목과 경로에 부분 일치)
   * @param cursor - 이전 페이지가 돌려준 nextCursor
   * @returns 목록 한 페이지 (경로순 정렬)
   * @throws SlipStorageError 디렉터리 조회 실패(io)·잘못된 커서(io) 시
   */
  async list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage> {
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    if (Number.isNaN(offset) || offset < 0) {
      throw new SlipStorageError('io', mcpText(this.locale).badCursor());
    }

    let names: string[];
    try {
      const entries = await readdir(this.rootDir, { recursive: true, withFileTypes: true });
      names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.slip'))
        .map((entry) => path.relative(this.rootDir, path.join(entry.parentPath, entry.name)))
        .sort();
    } catch (error) {
      throw new SlipStorageError('io', reasonOf(error));
    }

    const items: SlipListItem[] = [];
    for (const name of names) {
      const item = await this.listItem(name);
      if (item === null) continue;
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

  /** 목록 항목 하나를 만든다. 읽지 못하는 파일이면 null을 반환한다. */
  private async listItem(id: string): Promise<SlipListItem | null> {
    try {
      const abs = this.resolvePath(id);
      const file = await this.load(id);
      const info = await stat(abs);
      const title =
        file.kind === 'template' ? file.template.meta.title : file.templateSnapshot.meta.title;
      return { id, kind: file.kind, title, updatedAt: info.mtime.toISOString() };
    } catch {
      return null;
    }
  }

  /** 파일 내용을 파싱한다. 암호화 봉투는 설정된 키와 이전 키를 순서대로 시도한다. */
  private async parseText(text: string): Promise<SlipFile> {
    if (!isEncryptedSlipFile(text)) {
      return parseSlipFile(text, this.localeOptions());
    }
    if (!this.encryption) {
      throw new SlipStorageError('io', mcpText(this.locale).encryptedNoKey());
    }
    const keys = [this.encryption.key, ...(this.encryption.previousKeys ?? [])];
    let lastError: unknown;
    for (const key of keys) {
      try {
        return await decryptSlipFile(text, key, this.localeOptions());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  /** core 함수에 전달할 로케일 옵션 (exactOptionalPropertyTypes 대응) */
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
  const rel = path.relative(rootDir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SlipStorageError('io', mcpText(locale).outsideRoot(relPath));
  }
  return abs;
}

/** 항목의 제목 또는 경로에 검색어가 부분 일치하는지 확인한다. */
function matchesQuery(item: SlipListItem, query: string): boolean {
  const q = query.toLowerCase();
  return item.title.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
}

/** Node 파일 오류가 "파일 없음"인지 판별한다. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

/** 오류를 사람이 읽을 문자열로 바꾼다. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 어댑터가 직접 만드는 오류 문구 사전 (영어 기본, 한국어·일본어) */
const MCP_TEXT = {
  en: {
    notFound: (id: string) => `No saved file: ${id}`,
    outsideRoot: (id: string) => `Path is outside the working directory: ${id}`,
    encryptedNoKey: () =>
      'The file is encrypted but no key is configured. Set the SLIPKIT_MCP_KEY environment variable.',
    badCursor: () => 'Invalid list cursor',
  },
  ko: {
    notFound: (id: string) => `저장된 파일이 없습니다: ${id}`,
    outsideRoot: (id: string) => `작업 디렉터리 밖의 경로입니다: ${id}`,
    encryptedNoKey: () =>
      '암호화된 파일인데 설정된 키가 없습니다. SLIPKIT_MCP_KEY 환경변수를 설정하세요.',
    badCursor: () => '잘못된 목록 커서입니다',
  },
  ja: {
    notFound: (id: string) => `保存されたファイルがありません: ${id}`,
    outsideRoot: (id: string) => `作業ディレクトリ外のパスです: ${id}`,
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
