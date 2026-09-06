/**
 * `bench:mcp-list`가 쓰는 `.slip` fixture 생성기.
 *
 * 만드는 파일은 모두 `parseSlipFile`을 통과하는 유효한 `.slip`이다 — 목록 조회가 파싱까지 하므로
 * 손상 파일을 섞으면 측정 대상이 달라진다. 파일은 `shard-000/slip-00000.slip`처럼 하위 디렉터리로
 * 나눠 두어 재귀 탐색 비용도 함께 재고, 이름을 0으로 채워 정렬 순서가 색인 순서와 같게 한다.
 *
 * 색인 규칙(시나리오마다 같다)
 * - `index % 5 === 0`이면 전표, 나머지는 양식 — `kind` 필터가 고르는 비율이 8:2가 된다.
 * - `index % 10 === 3`이면 제목에 검색 표지 `alpha`를 붙인다 — `query` 필터가 약 10%를 고른다.
 * - 색인 0은 항상 제목 끝에 `r00`처럼 두 자리 판 번호를 달고 있다. 외부 수정 단계가 이 자리만
 *   바꾸므로 파일 크기는 그대로 두고 내용과 mtime만 달라진다.
 *
 * 크기 맞추기
 * - `targetBytes`가 null이면 최소 유효 양식(텍스트 요소 하나)을 그대로 쓴다.
 * - 값을 주면 더미 텍스트 요소를 늘려 그 바이트에 맞춘다. 요소 수는 종류마다 한 번만 계산하고,
 *   파일마다 달라지는 제목 길이는 마지막 더미 요소의 글자 수로 흡수해 정확히 같은 바이트로 만든다.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 한 하위 디렉터리에 넣는 파일 수 */
const SHARD_SIZE = 100;

/** 제목에 붙이는 검색 표지 — `query` 필터가 이 말을 찾는다 */
export const QUERY_MARK = 'alpha';

/** 외부 수정 단계가 고쳐 쓰는 파일의 색인 */
export const TOUCH_INDEX = 0;

/** 삭제·추가 단계가 지우는 파일의 색인 */
export const CHURN_INDEX = 1;

/** 삭제·추가 단계가 새로 만드는 파일의 저장 키 (정렬하면 항상 맨 뒤) */
export const ADDED_ID = 'zz-added.slip';

/** 더미 텍스트 요소 하나의 기본 글자 수 */
const PAD_CHARS = 48;

/**
 * 색인에 해당하는 상대 경로를 만든다.
 *
 * @param index - 0부터 시작하는 파일 색인
 * @returns 기준 디렉터리 기준 상대 경로
 */
export function relPathOf(index) {
  const shard = String(Math.floor(index / SHARD_SIZE)).padStart(3, '0');
  return `shard-${shard}/slip-${String(index).padStart(5, '0')}.slip`;
}

/**
 * 색인에 해당하는 파일 종류를 정한다.
 *
 * @param index - 파일 색인
 * @returns `'template'` 또는 `'voucher'`
 */
function kindOf(index) {
  return index % 5 === 0 ? 'voucher' : 'template';
}

/**
 * 색인의 제목에 검색 표지를 붙일지 정한다.
 *
 * @param index - 파일 색인
 * @returns 표지를 붙이면 true
 */
function isMarked(index) {
  return index % 10 === 3;
}

/**
 * 파일 수에 대한 기대 항목 수를 계산한다. 목록 결과 검증에 쓴다.
 *
 * @param count - fixture 파일 수
 * @returns 전체·양식·검색 표지 항목 수
 */
export function expectedCounts(count) {
  let templates = 0;
  let marked = 0;
  for (let i = 0; i < count; i += 1) {
    if (kindOf(i) === 'template') templates += 1;
    if (isMarked(i)) marked += 1;
  }
  return { total: count, templates, marked };
}

/**
 * 색인과 판 번호로 제목을 만든다.
 *
 * @param index - 파일 색인
 * @param revision - 두 자리 판 번호. 생략하면 판 번호를 붙이지 않는다
 * @returns 제목 문자열
 */
function titleOf(index, revision) {
  const kind = kindOf(index) === 'voucher' ? '전표' : '양식';
  const mark = isMarked(index) ? ` ${QUERY_MARK}` : '';
  const rev = revision === undefined ? '' : ` r${String(revision % 100).padStart(2, '0')}`;
  return `bench ${kind} ${String(index).padStart(5, '0')}${mark}${rev}`;
}

/**
 * 더미 텍스트 요소 하나를 만든다.
 *
 * @param index - 요소 번호
 * @param chars - 본문 글자 수
 * @returns 텍스트 요소
 */
function padElement(index, chars) {
  return {
    type: 'text',
    id: `pad-${index}`,
    name: `더미 ${index}`,
    position: { x: 10, y: 10 },
    width: 60,
    height: 5,
    content: 'x'.repeat(Math.max(1, chars)),
  };
}

/**
 * 양식 본문을 만든다.
 *
 * @param title - 제목
 * @param padCount - 더미 텍스트 요소 수
 * @returns 양식 본문
 */
function buildBody(title, padCount) {
  const elements = [
    {
      type: 'text',
      id: 'title',
      name: '제목',
      position: { x: 15, y: 20 },
      width: 180,
      height: 10,
      content: title,
    },
  ];
  for (let i = 0; i < padCount; i += 1) elements.push(padElement(i, PAD_CHARS));
  return {
    meta: { title },
    paper: { width: 210, height: 297, padding: [15, 15, 15, 15] },
    pages: [{ elements }],
    assets: [],
  };
}

/**
 * 본문을 양식 또는 전표 파일로 감싼다.
 *
 * @param kind - 파일 종류
 * @param body - 양식 본문
 * @param schemaVersion - 현재 스키마 버전
 * @returns `.slip` 파일 객체
 */
function wrapFile(kind, body, schemaVersion) {
  if (kind === 'voucher') {
    return {
      schemaVersion,
      kind: 'voucher',
      templateSnapshot: body,
      values: { customer: 'bench' },
      issued: false,
    };
  }
  return { schemaVersion, kind: 'template', template: body };
}

/**
 * 파일 본문의 마지막 요소를 찾는다. 양식과 전표의 본문 위치가 달라 한 곳에서 처리한다.
 *
 * @param file - `.slip` 파일 객체
 * @returns 첫 페이지의 요소 배열
 */
function elementsOf(file) {
  return (file.kind === 'voucher' ? file.templateSnapshot : file.template).pages[0].elements;
}

/**
 * fixture 생성기를 만든다. 같은 규칙으로 파일 객체·직렬화 문자열을 얻을 수 있어,
 * 처음 만들 때와 외부 수정 단계가 다시 쓸 때 같은 내용을 재현한다.
 *
 * @param options - core의 `serializeSlipFile`·`CURRENT_SCHEMA_VERSION`과 목표 바이트
 * @returns `fileFor`·`textFor`·`addedText`를 가진 생성기
 */
export function createGenerator({ serializeSlipFile, schemaVersion, targetBytes = null }) {
  /** 종류별 더미 요소 수 — 종류마다 한 번만 계산한다 */
  const padCounts = new Map();

  const sizeOf = (file) => Buffer.byteLength(serializeSlipFile(file), 'utf8');

  // 제목이 가장 긴 파일(검색 표지와 판 번호를 모두 단 경우)로 요소 수를 정해야
  // 어떤 파일에서도 목표 바이트를 넘지 않고 마지막 요소로 차이를 메울 수 있다.
  const probeTitle = () => titleOf(3, 0);

  const padCountFor = (kind) => {
    const cached = padCounts.get(kind);
    if (cached !== undefined) return cached;
    let count = 0;
    for (;;) {
      const probe = wrapFile(kind, buildBody(probeTitle(), count + 1), schemaVersion);
      if (sizeOf(probe) > targetBytes) break;
      count += 1;
    }
    padCounts.set(kind, count);
    return count;
  };

  /**
   * 마지막 더미 요소의 글자 수로 파일 크기를 목표 바이트에 맞춘다.
   *
   * @param file - `.slip` 파일 객체
   * @returns 크기를 맞춘 같은 객체
   */
  function fitSize(file) {
    const elements = elementsOf(file);
    const last = elements[elements.length - 1];
    if (!last.id.startsWith('pad-')) return file;
    const delta = targetBytes - sizeOf(file);
    last.content = 'x'.repeat(Math.max(1, last.content.length + delta));
    return file;
  }

  /**
   * 색인의 파일 객체를 만든다.
   *
   * @param index - 파일 색인
   * @param revision - 두 자리 판 번호 (색인 0에만 쓴다)
   * @returns `.slip` 파일 객체
   */
  function fileFor(index, revision) {
    const kind = kindOf(index);
    const title = titleOf(index, revision);
    if (targetBytes === null) return wrapFile(kind, buildBody(title, 0), schemaVersion);
    // 제목 길이가 파일마다 달라지므로 마지막 더미 요소의 글자 수로 차이를 흡수한다.
    return fitSize(wrapFile(kind, buildBody(title, padCountFor(kind)), schemaVersion));
  }

  /**
   * 색인의 파일을 직렬화한다.
   *
   * @param index - 파일 색인
   * @param revision - 두 자리 판 번호
   * @returns `.slip` JSON 문자열
   */
  function textFor(index, revision) {
    return serializeSlipFile(fileFor(index, revision));
  }

  /**
   * 삭제·추가 단계가 새로 만드는 파일의 내용을 만든다.
   *
   * @returns `.slip` JSON 문자열 (검색 표지 없는 양식)
   */
  function addedText() {
    const body = buildBody('bench added', targetBytes === null ? 0 : padCountFor('template'));
    const file = wrapFile('template', body, schemaVersion);
    return serializeSlipFile(targetBytes === null ? file : fitSize(file));
  }

  return { fileFor, textFor, addedText };
}

/**
 * 디렉터리가 없으면 만든다. 같은 shard를 여러 번 만들지 않도록 기억한다.
 *
 * @param dir - 만들 디렉터리
 * @param seen - 이미 만든 디렉터리 집합
 */
function ensureDir(dir, seen) {
  if (seen.has(dir)) return;
  mkdirSync(dir, { recursive: true });
  seen.add(dir);
}

/**
 * 평문 fixture를 만든다. 동기 API로 한 번에 써서 생성 시간이 측정에 섞이지 않게 한다.
 *
 * @param options - 기준 디렉터리, 파일 수, 생성기
 * @returns 파일별 바이트 배열
 */
export function writePlainFixture({ dir, count, generator }) {
  const seen = new Set();
  const bytes = [];
  for (let i = 0; i < count; i += 1) {
    const rel = relPathOf(i);
    const abs = path.join(dir, rel);
    ensureDir(path.dirname(abs), seen);
    const text = generator.textFor(i, i === TOUCH_INDEX ? 0 : undefined);
    writeFileSync(abs, text, 'utf8');
    bytes.push(Buffer.byteLength(text, 'utf8'));
  }
  return bytes;
}

/**
 * 암호화 fixture를 만든다. 암호화는 비동기라 묶음으로 나눠 처리하고, 쓰기는 동기로 한다.
 *
 * @param options - 기준 디렉터리, 파일 수, 생성기, 암호화 함수와 키, 동시 처리 수
 * @returns 파일별 바이트 배열
 */
export async function writeEncryptedFixture({
  dir,
  count,
  generator,
  encryptSlipFile,
  key,
  batch = 64,
}) {
  const seen = new Set();
  const bytes = [];
  for (let start = 0; start < count; start += batch) {
    const end = Math.min(count, start + batch);
    const texts = await Promise.all(
      Array.from({ length: end - start }, (_, offset) =>
        encryptSlipFile(generator.fileFor(start + offset, undefined), key),
      ),
    );
    for (const [offset, text] of texts.entries()) {
      const abs = path.join(dir, relPathOf(start + offset));
      ensureDir(path.dirname(abs), seen);
      writeFileSync(abs, text, 'utf8');
      bytes.push(Buffer.byteLength(text, 'utf8'));
    }
  }
  return bytes;
}

/**
 * 디렉터리 항목 수(파일과 하위 디렉터리)를 센다. 계측 심볼이 없을 때도 탐색 규모를 표에 적기 위해서다.
 *
 * @param dir - 기준 디렉터리
 * @returns 항목 수
 */
export function countEntries(dir) {
  let total = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      total += 1;
      if (entry.isDirectory()) walk(path.join(current, entry.name));
    }
  };
  walk(dir);
  return total;
}
