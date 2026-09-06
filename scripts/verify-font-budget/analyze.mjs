/**
 * Elements 빌드 산출물(dist)의 크기를 재고 동봉 폰트 예산과 비교하는 정적 분석 모듈.
 *
 * - 루트 진입점(`dist/index.js`)에서 상대 경로 정적 import/export-from만 따라간 파일 묶음을
 *   「정적 import closure」로 잰다. bare 지정자(`lit`, `@omdc-slipkit/core`)와 동적 `import()`는
 *   따라가지 않는다 — 루트를 불러올 때 실제로 읽히는 파일만 세기 위해서다.
 * - 폰트 청크는 파일 이름을 하드코딩하지 않고 분류한다: `package.json`의 `./fonts/*` exports가
 *   가리키는 파일과 루트 closure 안의 동적 import 대상이 같은 두 파일을 가리키고, 그 모듈이
 *   `PRETENDARD_FONTS` 또는 `NOTO_SANS_JP_FONTS`를 export할 때만 성공한다.
 * - gzip 바이트는 `node:zlib` `gzipSync` 기본 레벨로 파일마다 압축한 크기의 합이다.
 * - tarball 크기는 `pnpm pack` 결과 파일 크기, unpacked 크기는 그 tarball의 tar 항목 크기 합이다
 *   (외부 `tar` 명령 없이 Node에서 gunzip 후 헤더를 읽는다).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

/** 자동 예산 상한(바이트) */
export const FONT_BUDGET = {
  tarballBytes: 6_300_000,
  unpackedBytes: 12_000_000,
  rootClosure: { raw: 760_000, gzip: 170_000 },
  chunks: {
    pretendard: { raw: 4_300_000, gzip: 2_650_000 },
    notoSansJp: { raw: 6_500_000, gzip: 3_400_000 },
  },
  decoded: { Pretendard: 1_600_000, 'Pretendard-Bold': 1_600_000, 'Noto Sans JP': 4_850_000 },
};

/** 폰트 청크 키를 표 제목에 쓰는 이름으로 잇는다 */
export const CHUNK_LABELS = { pretendard: 'Pretendard 청크', notoSansJp: 'Noto Sans JP 청크' };

/** 청크 키마다 그 모듈이 export해야 하는 폰트 배열 이름 */
const CHUNK_EXPORTS = { pretendard: 'PRETENDARD_FONTS', notoSansJp: 'NOTO_SANS_JP_FONTS' };

/** 청크 키마다 `package.json` exports의 하위 경로 */
const CHUNK_SUBPATHS = { pretendard: './fonts/pretendard', notoSansJp: './fonts/noto-sans-jp' };

/**
 * 예산 검사에서 사유를 구분해 던지는 오류.
 *
 * `kind`: `missing-chunk`(폰트 청크 파일이 없거나 부족) · `classification-failure`(청크는 있지만 종류를 확정할 수
 * 없음, exports와 어긋남, 예산의 폰트 이름이 측정값에 없음) · `over-budget`(상한 초과) · `pack-failed`(`pnpm pack` 실패).
 */
export class FontBudgetError extends Error {
  /**
   * @param {'missing-chunk' | 'classification-failure' | 'over-budget' | 'pack-failed'} kind - 오류 종류
   * @param {string} message - 사람이 읽는 사유
   */
  constructor(kind, message) {
    super(message);
    this.name = 'FontBudgetError';
    this.kind = kind;
  }
}

/** 정적 import — `import x from "./a.js"`, `import { a,\n b } from "./a.js"`, `import "./a.js"` (여러 줄 허용) */
const STATIC_IMPORT_RE = /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"'\n]+)["']/g;
/** 정적 재수출 — `export { a } from "./a.js"`, `export * from "./a.js"`, `export * as ns from "./a.js"` */
const STATIC_EXPORT_RE = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g;
/** 동적 import — `import("./a.js")`·`import('./a.js')` */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

/**
 * 상대 경로 지정자인지 본다. bare 지정자와 URL은 따라가지 않는다.
 *
 * @param {string} specifier - import 지정자
 * @returns {boolean} `./` 또는 `../`로 시작하면 true
 */
function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * 상대 지정자를 절대 파일 경로로 바꾼다. 확장자가 없으면 `.js`·`/index.js`를 차례로 시도한다.
 *
 * @param {string} fromFile - 지정자가 적힌 파일
 * @param {string} specifier - 상대 지정자
 * @returns {string} 절대 경로 (파일이 없어도 첫 후보를 돌려준다)
 */
function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
}

/**
 * 한 파일의 상대 경로 정적 import·export-from 대상을 절대 경로로 모은다.
 *
 * @param {string} file - 읽을 파일
 * @returns {string[]} 대상 절대 경로 (중복 제거, 등장 순)
 */
function staticTargets(file) {
  const text = readFileSync(file, 'utf8');
  const targets = [];
  for (const re of [STATIC_IMPORT_RE, STATIC_EXPORT_RE]) {
    for (const match of text.matchAll(re)) {
      if (!isRelative(match[1])) continue;
      const target = resolveRelative(file, match[1]);
      if (!targets.includes(target)) targets.push(target);
    }
  }
  return targets;
}

/**
 * 진입점에서 상대 경로 정적 import·export-from만 재귀적으로 따라간 파일 집합.
 *
 * @param {string} entryFile - 진입점 절대 경로
 * @returns {string[]} 절대 경로 목록 (진입점 포함, 정렬)
 */
function closureFiles(entryFile) {
  const entry = path.resolve(entryFile);
  if (!existsSync(entry)) throw new Error(`진입점이 없다: ${entry}`);
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const target of staticTargets(file)) {
      if (!existsSync(target)) throw new Error(`${file} 가 가리키는 파일이 없다: ${target}`);
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen].sort();
}

/**
 * 파일들의 raw 바이트 합과 파일별 gzip(기본 레벨) 바이트 합.
 *
 * @param {string[]} files - 절대 경로 목록
 * @returns {{ raw: number, gzip: number }} 합계
 */
function sizeFiles(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const buf = readFileSync(file);
    raw += buf.byteLength;
    gzip += gzipSync(buf).byteLength;
  }
  return { raw, gzip };
}

/**
 * 상대 경로 정적 import/export-from만 따라간 파일 목록(진입점 포함, 절대 경로, 정렬)과 raw·gzip 합.
 *
 * @param {string} entryFile - 진입점 파일 경로
 * @returns {{ files: string[], raw: number, gzip: number }} closure 파일과 크기 합
 */
export function staticImportClosure(entryFile) {
  const files = closureFiles(entryFile);
  return { files, ...sizeFiles(files) };
}

/**
 * 주어진 파일들에 나타나는 상대 경로 동적 import 대상.
 *
 * @param {string[]} files - 읽을 파일 절대 경로 목록
 * @returns {string[]} 대상 절대 경로 (중복 제거, 정렬)
 */
export function dynamicImportTargets(files) {
  const targets = new Set();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(DYNAMIC_IMPORT_RE)) {
      if (isRelative(match[1])) targets.add(resolveRelative(file, match[1]));
    }
  }
  return [...targets].sort();
}

/**
 * 패키지의 `package.json`을 읽는다.
 *
 * @param {string} packageDir - 패키지 루트
 * @returns {any} 파싱된 package.json
 */
function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

/**
 * `exports[subpath].import`(또는 문자열 exports)가 가리키는 파일의 절대 경로.
 *
 * @param {string} packageDir - 패키지 루트
 * @param {any} pkg - 파싱된 package.json
 * @param {string} subpath - exports 하위 경로 (`.`, `./fonts/pretendard` 등)
 * @returns {string | undefined} 절대 경로. 항목이 없으면 undefined
 */
function exportTarget(packageDir, pkg, subpath) {
  const entry = pkg.exports?.[subpath];
  const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
  return typeof target === 'string' ? path.resolve(packageDir, target) : undefined;
}

/**
 * 루트 진입점 경로 — `exports["."].import` → `main` → `dist/index.js` 순으로 찾는다.
 *
 * @param {string} packageDir - 패키지 루트
 * @param {any} pkg - 파싱된 package.json
 * @returns {string} 절대 경로
 */
function rootEntry(packageDir, pkg) {
  return exportTarget(packageDir, pkg, '.')
    ?? (typeof pkg.main === 'string' ? path.resolve(packageDir, pkg.main) : path.join(packageDir, 'dist', 'index.js'));
}

/**
 * 모듈에서 `{ name, data }` 항목으로 이루어진 폰트 배열 export를 찾는다.
 *
 * @param {Record<string, unknown>} mod - import한 모듈 네임스페이스
 * @param {string} name - export 이름
 * @returns {Array<{ name: string, data: Uint8Array }> | undefined} 폰트 배열. 없거나 모양이 다르면 undefined
 */
function fontArrayExport(mod, name) {
  const value = mod[name];
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const wellFormed = value.every((item) => item && typeof item.name === 'string' && item.data && typeof item.data.length === 'number');
  return wellFormed ? value : undefined;
}

/**
 * 상대 경로 목록을 사람이 읽기 좋게 잇는다.
 *
 * @param {string} base - 기준 디렉터리
 * @param {string[]} files - 절대 경로 목록
 * @returns {string} 쉼표로 이은 상대 경로
 */
function listRelative(base, files) {
  return files.map((file) => path.relative(base, file)).join(', ') || '(없음)';
}

/**
 * dist 안 폰트 청크를 분류한다.
 *
 * `package.json` exports(`./fonts/pretendard`·`./fonts/noto-sans-jp`)가 가리키는 파일과 루트 진입점 closure의
 * 동적 import 대상이 정확히 같은 두 파일을 가리키고, 각 모듈이 `PRETENDARD_FONTS`/`NOTO_SANS_JP_FONTS` 중
 * 하나만 export할 때만 성공한다. 청크의 `files`는 그 진입점의 정적 closure에서 루트 closure에 든 파일을 뺀 것이다.
 *
 * @param {string} packageDir - 패키지 루트 (`package.json`·`dist`를 읽는다)
 * @returns {Promise<{ pretendard: { entry: string, files: string[], raw: number, gzip: number, exportName: string }, notoSansJp: { entry: string, files: string[], raw: number, gzip: number, exportName: string } }>} 분류된 청크
 * @throws {FontBudgetError} `missing-chunk` — 동적 import 대상이 둘보다 적거나 파일이 없을 때.
 *   `classification-failure` — 대상이 둘보다 많거나 exports와 어긋나거나 export 이름으로 종류를 확정할 수 없을 때
 */
export async function classifyFontChunks(packageDir) {
  const dir = path.resolve(packageDir);
  const pkg = readPackageJson(dir);
  const root = closureFiles(rootEntry(dir, pkg));
  const dynamic = dynamicImportTargets(root);

  const missing = dynamic.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new FontBudgetError('missing-chunk', `동적 import 대상 파일이 없다: ${listRelative(dir, missing)}`);
  }
  if (dynamic.length < 2) {
    throw new FontBudgetError('missing-chunk', `루트 closure의 동적 import 대상이 2개여야 하는데 ${dynamic.length}개다: ${listRelative(dir, dynamic)}`);
  }
  if (dynamic.length > 2) {
    throw new FontBudgetError('classification-failure', `루트 closure의 동적 import 대상이 2개여야 하는데 ${dynamic.length}개다: ${listRelative(dir, dynamic)}`);
  }

  const exported = {};
  for (const [key, subpath] of Object.entries(CHUNK_SUBPATHS)) {
    const target = exportTarget(dir, pkg, subpath);
    if (target === undefined) throw new FontBudgetError('classification-failure', `package.json exports에 ${subpath} 항목이 없다`);
    exported[key] = target;
  }
  const exportedFiles = Object.values(exported).sort();
  if (exportedFiles.join('\n') !== dynamic.join('\n')) {
    throw new FontBudgetError(
      'classification-failure',
      `exports가 가리키는 파일(${listRelative(dir, exportedFiles)})과 동적 import 대상(${listRelative(dir, dynamic)})이 다르다`,
    );
  }

  const classified = {};
  for (const entry of dynamic) {
    const mod = await import(pathToFileURL(entry).href);
    const kinds = Object.entries(CHUNK_EXPORTS).filter(([, name]) => fontArrayExport(mod, name) !== undefined).map(([key]) => key);
    if (kinds.length !== 1) {
      throw new FontBudgetError(
        'classification-failure',
        `${path.relative(dir, entry)} 가 export하는 폰트 배열로 종류를 확정할 수 없다 (${kinds.join(', ') || '없음'})`,
      );
    }
    const [key] = kinds;
    if (classified[key] !== undefined) {
      throw new FontBudgetError('classification-failure', `${CHUNK_LABELS[key]}가 두 파일에서 나온다: ${listRelative(dir, [classified[key].entry, entry])}`);
    }
    if (exported[key] !== entry) {
      throw new FontBudgetError(
        'classification-failure',
        `${CHUNK_SUBPATHS[key]} exports는 ${path.relative(dir, exported[key])} 인데 ${CHUNK_EXPORTS[key]} 는 ${path.relative(dir, entry)} 가 export한다`,
      );
    }
    const files = closureFiles(entry).filter((file) => !root.includes(file));
    classified[key] = { entry, files, ...sizeFiles(files), exportName: CHUNK_EXPORTS[key] };
  }
  // 결과는 파일 이름 순서가 아니라 청크 키 순서(pretendard → notoSansJp)로 고정한다
  const ordered = {};
  for (const key of Object.keys(CHUNK_EXPORTS)) {
    if (classified[key] === undefined) throw new FontBudgetError('classification-failure', `${CHUNK_LABELS[key]}를 찾지 못했다`);
    ordered[key] = classified[key];
  }
  return ordered;
}

/**
 * 청크 모듈을 import해 export된 폰트 배열 항목의 `data.length`를 폰트 이름별로 모은다.
 *
 * @param {{ entry: string, exportName?: string }} chunk - `classifyFontChunks`가 돌려준 청크
 * @returns {Promise<Record<string, number>>} `{ [폰트 이름]: 디코딩 바이트 }`
 * @throws {FontBudgetError} `classification-failure` — 모듈에 폰트 배열 export가 없을 때
 */
export async function decodedFontBytes(chunk) {
  const mod = await import(pathToFileURL(chunk.entry).href);
  const names = chunk.exportName ? [chunk.exportName] : Object.values(CHUNK_EXPORTS);
  const fonts = names.map((name) => fontArrayExport(mod, name)).find((value) => value !== undefined);
  if (fonts === undefined) throw new FontBudgetError('classification-failure', `${chunk.entry} 에 폰트 배열 export(${names.join(', ')})가 없다`);
  return Object.fromEntries(fonts.map((font) => [font.name, font.data.length]));
}

/**
 * tar 아카이브 바이트에서 일반 파일 항목의 크기 필드를 합산한다 (512바이트 헤더, 8진수 size, 데이터 블록 512 정렬).
 *
 * @param {Buffer} tar - gunzip한 tar 바이트
 * @returns {number} 일반 파일 크기 합
 */
function tarUnpackedBytes(tar) {
  const BLOCK = 512;
  let offset = 0;
  let total = 0;
  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const sizeField = header.subarray(124, 136);
    let size;
    if (sizeField[0] & 0x80) {
      // base-256 표기(GNU 확장) — 아주 큰 항목에만 쓰인다
      size = 0;
      for (let i = 1; i < sizeField.length; i++) size = size * 256 + sizeField[i];
    } else {
      size = parseInt(sizeField.toString('ascii').replace(/[^0-7]/g, '') || '0', 8);
    }
    const typeflag = String.fromCharCode(header[156]);
    if (typeflag === '0' || typeflag === '\0' || typeflag === '7') total += size;
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return total;
}

/**
 * `pnpm pack --pack-destination <임시 디렉터리>`로 tarball을 만들어 크기와 unpacked 크기를 잰다. 끝나면 임시 디렉터리를 지운다.
 *
 * @param {string} packageDir - 패키지 루트
 * @returns {Promise<{ tarballBytes: number, unpackedBytes: number, fileName: string }>} tarball 파일 크기·tar 항목 크기 합·파일 이름
 * @throws {FontBudgetError} `pack-failed` — pnpm pack이 실패했거나 tarball을 찾지 못했을 때
 */
export async function packSizes(packageDir) {
  const dir = path.resolve(packageDir);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'slipkit-font-budget-'));
  try {
    const result = spawnSync('pnpm', ['pack', '--pack-destination', tmp], {
      cwd: dir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (result.error) throw new FontBudgetError('pack-failed', `pnpm pack 실행 실패: ${result.error.message}`);
    if (result.status !== 0) {
      throw new FontBudgetError('pack-failed', `pnpm pack 종료 코드 ${result.status}\n${result.stderr}\n${result.stdout}`.trim());
    }
    const fileName = readdirSync(tmp).find((name) => name.endsWith('.tgz'));
    if (fileName === undefined) throw new FontBudgetError('pack-failed', `pnpm pack 뒤 ${tmp} 에 .tgz 파일이 없다`);
    const tarballPath = path.join(tmp, fileName);
    const tarballBytes = statSync(tarballPath).size;
    const unpackedBytes = tarUnpackedBytes(gunzipSync(readFileSync(tarballPath)));
    return { tarballBytes, unpackedBytes, fileName };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Elements dist의 측정값을 모두 모은다.
 *
 * @param {string} packageDir - 패키지 루트 (`packages/elements`)
 * @param {{ pack?: boolean }} [options] - `pack: false`면 `pnpm pack`을 생략한다 (tarball·unpacked 항목이 빠진다)
 * @returns {Promise<{ tarballBytes?: number, unpackedBytes?: number, fileName?: string, rootClosure: { files: string[], raw: number, gzip: number }, chunks: Awaited<ReturnType<typeof classifyFontChunks>>, decoded: Record<string, number> }>} 측정값
 * @throws {FontBudgetError} 청크 분류·pack 실패 사유
 */
export async function measureElementsDist(packageDir, { pack = true } = {}) {
  const dir = path.resolve(packageDir);
  const pkg = readPackageJson(dir);
  const rootClosure = staticImportClosure(rootEntry(dir, pkg));
  const chunks = await classifyFontChunks(dir);
  const decoded = {};
  for (const chunk of Object.values(chunks)) Object.assign(decoded, await decodedFontBytes(chunk));
  const packed = pack ? await packSizes(dir) : {};
  return { ...packed, rootClosure, chunks, decoded };
}

/**
 * 측정값을 예산과 비교한다. 숫자가 없는 항목(pack 생략)은 건너뛴다.
 *
 * @param {Awaited<ReturnType<typeof measureElementsDist>>} measurements - `measureElementsDist` 결과
 * @param {typeof FONT_BUDGET} [budget] - 예산 상한 (기본 `FONT_BUDGET`)
 * @returns {{ ok: boolean, rows: Array<{ item: string, actual: number, limit: number, ok: boolean }> }} 항목별 결과. `item`은 표 제목으로 그대로 쓴다
 * @throws {FontBudgetError} `classification-failure` — 예산에 있는 청크·폰트 이름이 측정값에 없을 때
 */
export function checkFontBudget(measurements, budget = FONT_BUDGET) {
  const rows = [];
  const add = (item, actual, limit) => {
    if (typeof actual !== 'number' || typeof limit !== 'number') return;
    rows.push({ item, actual, limit, ok: actual <= limit });
  };
  add('Elements tarball', measurements.tarballBytes, budget.tarballBytes);
  add('Elements unpacked', measurements.unpackedBytes, budget.unpackedBytes);
  add('루트 정적 closure raw', measurements.rootClosure?.raw, budget.rootClosure?.raw);
  add('루트 정적 closure gzip', measurements.rootClosure?.gzip, budget.rootClosure?.gzip);
  for (const [key, limits] of Object.entries(budget.chunks ?? {})) {
    const chunk = measurements.chunks?.[key];
    if (chunk === undefined) throw new FontBudgetError('classification-failure', `예산 항목 ${key} 청크가 측정값에 없다`);
    const label = CHUNK_LABELS[key] ?? `${key} 청크`;
    add(`${label} raw`, chunk.raw, limits.raw);
    add(`${label} gzip`, chunk.gzip, limits.gzip);
  }
  for (const [name, limit] of Object.entries(budget.decoded ?? {})) {
    const actual = measurements.decoded?.[name];
    if (actual === undefined) throw new FontBudgetError('classification-failure', `예산에 있는 폰트 ${name} 가 측정값에 없다`);
    add(`${name} 디코딩 데이터`, actual, limit);
  }
  return { ok: rows.every((row) => row.ok), rows };
}
