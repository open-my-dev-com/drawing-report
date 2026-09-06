/**
 * Elements 동봉 폰트·빌드 산출물 크기의 정적 예산 게이트.
 *
 * 실행: `pnpm verify:font-budget` (또는 `node scripts/verify-font-budget.mjs`). `pnpm verify`는 build 뒤에
 * 이 게이트를 돌린다 — dist가 없으면 먼저 `pnpm -r build`를 실행한다.
 *
 * 옵션
 * - `--json <path>`: 측정값과 항목별 결과(rows)를 JSON으로 저장한다.
 * - `--no-pack`: `pnpm pack`을 생략한다 (tarball·unpacked 항목이 표에서 빠진다).
 *
 * 무엇을 재나
 * - 루트 진입점 `dist/index.js`에서 상대 경로 정적 import만 따라간 「정적 import closure」의 raw·gzip 합.
 *   루트를 불러올 때 두 대형 폰트 청크가 함께 읽히지 않는지 이 값이 지킨다.
 * - 폰트 청크 두 개(Pretendard·Noto Sans JP)의 raw·gzip과 디코딩된 폰트 데이터 바이트.
 * - `pnpm pack` tarball 크기와 unpacked 크기.
 *
 * 분류 방식: 청크 파일 이름(빌드마다 달라질 수 있는 해시)을 하드코딩하지 않는다. `package.json`의
 * `./fonts/pretendard`·`./fonts/noto-sans-jp` exports가 가리키는 파일과 루트 closure 안의 동적 `import()` 대상이
 * 같은 두 파일이어야 하고, 각 모듈이 `PRETENDARD_FONTS` 또는 `NOTO_SANS_JP_FONTS`를 export하는지로 종류를 정한다.
 *
 * 출력: `| 항목 | 측정 | 상한 | 여유 | 결과 |` 표와 루트 closure·청크 파일 목록을 stdout에 적는다. 상한을 넘거나
 * 분류·pack에 실패하면 사유를 stderr에 적고 종료 코드 1로 끝난다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFontBudget, CHUNK_LABELS, FONT_BUDGET, FontBudgetError, measureElementsDist } from './verify-font-budget/analyze.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = path.join(ROOT, 'packages', 'elements');

/**
 * 명령행 인자를 읽는다.
 *
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{ json: string | undefined, pack: boolean }} 옵션
 */
function parseArgs(argv) {
  const options = { json: undefined, pack: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-pack') {
      options.pack = false;
    } else if (arg === '--json') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--json 뒤에 저장할 파일 경로가 필요하다');
      options.json = path.resolve(value);
    } else if (arg.startsWith('--json=')) {
      options.json = path.resolve(arg.slice('--json='.length));
    } else {
      throw new Error(`알 수 없는 옵션: ${arg}\n사용법: node scripts/verify-font-budget.mjs [--json <path>] [--no-pack]`);
    }
  }
  return options;
}

const formatter = new Intl.NumberFormat('en-US');

/**
 * 바이트 수를 천 단위 쉼표로 적는다.
 *
 * @param {number} value - 바이트
 * @returns {string} 예: `1,234,567`
 */
function fmt(value) {
  return formatter.format(value);
}

/**
 * 결과 행을 마크다운 표로 만든다.
 *
 * @param {Array<{ item: string, actual: number, limit: number, ok: boolean }>} rows - `checkFontBudget` 결과
 * @returns {string} 표 문자열
 */
function renderTable(rows) {
  const lines = ['| 항목 | 측정 | 상한 | 여유 | 결과 |', '|---|---:|---:|---:|---|'];
  for (const row of rows) {
    lines.push(`| ${row.item} | ${fmt(row.actual)} | ${fmt(row.limit)} | ${fmt(row.limit - row.actual)} | ${row.ok ? '통과' : '초과'} |`);
  }
  return lines.join('\n');
}

/**
 * 파일 목록을 크기와 함께 적는다.
 *
 * @param {string} title - 목록 제목
 * @param {string[]} files - 절대 경로 목록
 * @returns {string} 목록 문자열
 */
function renderFiles(title, files) {
  const lines = [`${title} (${files.length}개)`];
  for (const file of files) lines.push(`  - ${path.relative(PACKAGE_DIR, file)}`);
  return lines.join('\n');
}

/**
 * 측정·비교·출력을 수행한다.
 *
 * @param {string[]} argv - 명령행 인자
 * @returns {Promise<number>} 종료 코드
 */
async function main(argv) {
  const options = parseArgs(argv);
  const measurements = await measureElementsDist(PACKAGE_DIR, { pack: options.pack });
  const result = checkFontBudget(measurements, FONT_BUDGET);

  console.log(`# Elements 폰트 예산 (${path.relative(ROOT, PACKAGE_DIR)})`);
  console.log('');
  console.log(renderTable(result.rows));
  console.log('');
  console.log(renderFiles('루트 정적 closure 파일', measurements.rootClosure.files));
  for (const [key, chunk] of Object.entries(measurements.chunks)) {
    console.log('');
    console.log(renderFiles(`${CHUNK_LABELS[key] ?? key} 파일 (${chunk.exportName})`, chunk.files));
  }
  if (measurements.fileName) {
    console.log('');
    console.log(`tarball: ${measurements.fileName}`);
  }

  if (options.json) {
    mkdirSync(path.dirname(options.json), { recursive: true });
    const payload = {
      measuredAt: new Date().toISOString(),
      packageDir: path.relative(ROOT, PACKAGE_DIR),
      ok: result.ok,
      budget: FONT_BUDGET,
      measurements,
      rows: result.rows,
    };
    writeFileSync(options.json, `${JSON.stringify(payload, null, 2)}\n`);
    console.log('');
    console.log(`JSON 저장: ${options.json}`);
  }

  if (!result.ok) {
    const failed = result.rows.filter((row) => !row.ok);
    const error = new FontBudgetError(
      'over-budget',
      failed.map((row) => `${row.item}: ${fmt(row.actual)} B > 상한 ${fmt(row.limit)} B (${fmt(row.actual - row.limit)} B 초과)`).join('\n'),
    );
    console.error(`폰트 예산 초과 (${error.kind})\n${error.message}`);
    return 1;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof FontBudgetError) {
      console.error(`폰트 예산 검사 실패 (${error.kind}): ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  },
);
