// 폰트 예산 정적 분석 모듈의 시험 — `node --test`로 실행한다. 임시 디렉터리에 합성 패키지를 만들어 분류·closure·예산 비교를
// 확인하고, 마지막에 실제 `packages/elements/dist`(있을 때만)에 대해 `pnpm pack` 없이 예산이 통과하는지 본다.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  checkFontBudget,
  classifyFontChunks,
  decodedFontBytes,
  dynamicImportTargets,
  FONT_BUDGET,
  FontBudgetError,
  measureElementsDist,
  staticImportClosure,
} from './analyze.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELEMENTS_DIR = path.join(ROOT, 'packages', 'elements');

/** 시험이 만든 임시 디렉터리 — 끝나면 모두 지운다 */
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** 합성 dist의 기본 파일 내용 */
const DEFAULT_FILES = {
  'package.json': JSON.stringify({
    name: 'synthetic-elements',
    version: '0.0.0',
    type: 'module',
    exports: {
      '.': { import: './dist/index.js' },
      './fonts/pretendard': { import: './dist/fonts/pretendard.js' },
      './fonts/noto-sans-jp': { import: './dist/fonts/noto-sans-jp.js' },
      './default-fonts': { import: './dist/default-fonts.js' },
    },
  }),
  // 여러 줄 import·bare import·export-from이 섞인 루트 진입점
  'dist/index.js': [
    'import {',
    '  loadDefaultFonts',
    '} from "./chunk-x.js";',
    'import { LitElement } from "lit";',
    'import "@omdc-slipkit/core";',
    'export { helper } from "./util.js";',
    'export { loadDefaultFonts, LitElement };',
    '',
  ].join('\n'),
  'dist/util.js': 'export const helper = 1;\n',
  'dist/chunk-x.js': [
    'export function loadDefaultFonts() {',
    '  return Promise.all([import("./fonts/pretendard.js"), import(\'./fonts/noto-sans-jp.js\')]);',
    '}',
    '',
  ].join('\n'),
  // 루트 closure에 들지 않는 재수출 진입점 — 청크 files에도 들어가지 않아야 한다
  'dist/default-fonts.js': 'export { loadDefaultFonts } from "./chunk-x.js";\n',
  'dist/fonts/shared-decode.js': 'export function decode(n) { return new Uint8Array(n); }\n',
  'dist/fonts/pretendard.js': [
    'import { decode } from "./shared-decode.js";',
    'var PRETENDARD_FONTS = [',
    '  { name: "Pretendard", data: decode(7), fallback: true },',
    '  { name: "Pretendard-Bold", data: decode(9) }',
    '];',
    'export { PRETENDARD_FONTS };',
    '',
  ].join('\n'),
  'dist/fonts/noto-sans-jp.js': [
    'var NOTO_SANS_JP_FONTS = [{ name: "Noto Sans JP", data: new Uint8Array(11), fallback: true }];',
    'var noto_sans_jp_default = NOTO_SANS_JP_FONTS;',
    'export { NOTO_SANS_JP_FONTS, noto_sans_jp_default as default };',
    '',
  ].join('\n'),
};

/**
 * 합성 패키지를 임시 디렉터리에 만든다.
 *
 * @param {Record<string, string | null>} [overrides] - 덮어쓸 파일 내용. `null`이면 그 파일을 만들지 않는다
 * @returns {string} 패키지 루트 절대 경로
 */
function makePackage(overrides = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slipkit-font-budget-test-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries({ ...DEFAULT_FILES, ...overrides })) {
    if (content === null) continue;
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

/**
 * 패키지 안 상대 경로들을 정렬된 절대 경로로 바꾼다.
 *
 * @param {string} dir - 패키지 루트
 * @param {string[]} rels - 상대 경로
 * @returns {string[]} 정렬된 절대 경로
 */
function abs(dir, rels) {
  return rels.map((rel) => path.join(dir, rel)).sort();
}

/**
 * 파일들의 raw·gzip 합을 시험 쪽에서 독립적으로 계산한다.
 *
 * @param {string[]} files - 절대 경로
 * @returns {{ raw: number, gzip: number }} 합
 */
function expectedSizes(files) {
  return files.reduce((acc, file) => {
    const buf = readFileSync(file);
    return { raw: acc.raw + buf.byteLength, gzip: acc.gzip + gzipSync(buf).byteLength };
  }, { raw: 0, gzip: 0 });
}

/**
 * 비동기 호출이 지정한 종류의 `FontBudgetError`를 던지는지 확인한다.
 *
 * @param {() => Promise<unknown>} fn - 실행할 함수
 * @param {string} kind - 기대하는 오류 종류
 * @returns {Promise<void>}
 */
async function rejectsWithKind(fn, kind) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof FontBudgetError, `FontBudgetError 가 아니다: ${error}`);
    assert.equal(error.kind, kind);
    return true;
  });
}

describe('정적 import closure', () => {
  it('상대 경로 정적 import·export-from만 재귀적으로 따라가고 여러 줄 import도 인식한다', () => {
    const dir = makePackage();
    const closure = staticImportClosure(path.join(dir, 'dist', 'index.js'));
    assert.deepEqual(closure.files, abs(dir, ['dist/index.js', 'dist/chunk-x.js', 'dist/util.js']));
    assert.deepEqual({ raw: closure.raw, gzip: closure.gzip }, expectedSizes(closure.files));
  });

  it('bare import와 동적 import는 closure에 넣지 않는다', () => {
    const dir = makePackage();
    const closure = staticImportClosure(path.join(dir, 'dist', 'index.js'));
    for (const file of closure.files) {
      assert.ok(!file.includes(`${path.sep}fonts${path.sep}`), `동적 import 대상이 closure에 들어갔다: ${file}`);
      assert.ok(!file.includes('default-fonts.js'));
    }
  });

  it('동적 import 대상을 절대 경로로 중복 없이 모은다', () => {
    const dir = makePackage();
    const files = staticImportClosure(path.join(dir, 'dist', 'index.js')).files;
    assert.deepEqual(dynamicImportTargets(files), abs(dir, ['dist/fonts/pretendard.js', 'dist/fonts/noto-sans-jp.js']));
    assert.deepEqual(dynamicImportTargets([...files, ...files]), abs(dir, ['dist/fonts/pretendard.js', 'dist/fonts/noto-sans-jp.js']));
  });
});

describe('폰트 청크 분류와 예산 비교 (합성 패키지)', () => {
  it('exports와 동적 import 대상이 같고 export 이름으로 종류를 정한다', async () => {
    const dir = makePackage();
    const chunks = await classifyFontChunks(dir);
    assert.deepEqual(Object.keys(chunks), ['pretendard', 'notoSansJp']);
    assert.equal(chunks.pretendard.entry, path.join(dir, 'dist', 'fonts', 'pretendard.js'));
    assert.equal(chunks.notoSansJp.entry, path.join(dir, 'dist', 'fonts', 'noto-sans-jp.js'));
    // 청크 files = 청크 진입점의 정적 closure − 루트 closure
    assert.deepEqual(chunks.pretendard.files, abs(dir, ['dist/fonts/pretendard.js', 'dist/fonts/shared-decode.js']));
    assert.deepEqual(chunks.notoSansJp.files, abs(dir, ['dist/fonts/noto-sans-jp.js']));
    assert.deepEqual({ raw: chunks.pretendard.raw, gzip: chunks.pretendard.gzip }, expectedSizes(chunks.pretendard.files));
    assert.deepEqual({ raw: chunks.notoSansJp.raw, gzip: chunks.notoSansJp.gzip }, expectedSizes(chunks.notoSansJp.files));
  });

  it('디코딩 데이터 바이트를 폰트 이름별로 돌려준다', async () => {
    const dir = makePackage();
    const chunks = await classifyFontChunks(dir);
    assert.deepEqual(await decodedFontBytes(chunks.pretendard), { Pretendard: 7, 'Pretendard-Bold': 9 });
    assert.deepEqual(await decodedFontBytes(chunks.notoSansJp), { 'Noto Sans JP': 11 });
  });

  it('pack을 생략한 측정값은 tarball 항목이 없고 기본 예산을 통과한다', async () => {
    const dir = makePackage();
    const measurements = await measureElementsDist(dir, { pack: false });
    assert.equal(measurements.tarballBytes, undefined);
    assert.equal(measurements.unpackedBytes, undefined);
    assert.deepEqual(measurements.decoded, { Pretendard: 7, 'Pretendard-Bold': 9, 'Noto Sans JP': 11 });
    const result = checkFontBudget(measurements, FONT_BUDGET);
    assert.equal(result.ok, true);
    assert.deepEqual(result.rows.map((row) => row.item), [
      '루트 정적 closure raw',
      '루트 정적 closure gzip',
      'Pretendard 청크 raw',
      'Pretendard 청크 gzip',
      'Noto Sans JP 청크 raw',
      'Noto Sans JP 청크 gzip',
      'Pretendard 디코딩 데이터',
      'Pretendard-Bold 디코딩 데이터',
      'Noto Sans JP 디코딩 데이터',
    ]);
    assert.ok(result.rows.every((row) => row.ok && row.actual <= row.limit));
  });

  it('tarball·unpacked 숫자가 있으면 표 앞에 두 행이 들어간다', async () => {
    const dir = makePackage();
    const measurements = { ...await measureElementsDist(dir, { pack: false }), tarballBytes: 10, unpackedBytes: 20 };
    const result = checkFontBudget(measurements, FONT_BUDGET);
    assert.deepEqual(result.rows.slice(0, 2), [
      { item: 'Elements tarball', actual: 10, limit: FONT_BUDGET.tarballBytes, ok: true },
      { item: 'Elements unpacked', actual: 20, limit: FONT_BUDGET.unpackedBytes, ok: true },
    ]);
  });

  it('상한을 넘으면 ok가 false이고 실패 행이 정확히 그 항목이다', async () => {
    const dir = makePackage();
    const measurements = await measureElementsDist(dir, { pack: false });
    const budget = {
      ...FONT_BUDGET,
      rootClosure: { raw: 1, gzip: FONT_BUDGET.rootClosure.gzip },
      decoded: { ...FONT_BUDGET.decoded, 'Noto Sans JP': 10 },
    };
    const result = checkFontBudget(measurements, budget);
    assert.equal(result.ok, false);
    assert.deepEqual(result.rows.filter((row) => !row.ok).map((row) => row.item), ['루트 정적 closure raw', 'Noto Sans JP 디코딩 데이터']);
    const overRow = result.rows.find((row) => row.item === '루트 정적 closure raw');
    assert.equal(overRow.actual, measurements.rootClosure.raw);
    assert.equal(overRow.limit, 1);
  });

  it('동적 import가 하나뿐이면 missing-chunk', async () => {
    const dir = makePackage({
      'dist/chunk-x.js': 'export function loadDefaultFonts() { return import("./fonts/pretendard.js"); }\n',
    });
    await rejectsWithKind(() => classifyFontChunks(dir), 'missing-chunk');
  });

  it('동적 import 대상 파일이 없으면 missing-chunk', async () => {
    const dir = makePackage({ 'dist/fonts/noto-sans-jp.js': null });
    await rejectsWithKind(() => classifyFontChunks(dir), 'missing-chunk');
  });

  it('두 청크가 모두 PRETENDARD_FONTS를 export하면 classification-failure', async () => {
    const dir = makePackage({
      'dist/fonts/noto-sans-jp.js': 'export const PRETENDARD_FONTS = [{ name: "Pretendard", data: new Uint8Array(3) }];\n',
    });
    await rejectsWithKind(() => classifyFontChunks(dir), 'classification-failure');
  });

  it('exports가 동적 import 대상과 다른 파일을 가리키면 classification-failure', async () => {
    const pkg = JSON.parse(DEFAULT_FILES['package.json']);
    pkg.exports['./fonts/noto-sans-jp'] = { import: './dist/fonts/other.js' };
    const dir = makePackage({
      'package.json': JSON.stringify(pkg),
      'dist/fonts/other.js': 'export const NOTO_SANS_JP_FONTS = [{ name: "Noto Sans JP", data: new Uint8Array(1) }];\n',
    });
    await rejectsWithKind(() => classifyFontChunks(dir), 'classification-failure');
  });

  it('exports 파일과 export 이름이 서로 바뀌어 있으면 classification-failure', async () => {
    const dir = makePackage({
      'dist/fonts/pretendard.js': DEFAULT_FILES['dist/fonts/noto-sans-jp.js'],
      'dist/fonts/noto-sans-jp.js': DEFAULT_FILES['dist/fonts/pretendard.js'],
    });
    await rejectsWithKind(() => classifyFontChunks(dir), 'classification-failure');
  });

  it('예산에 있는 폰트 이름이 측정값에 없으면 classification-failure', async () => {
    const dir = makePackage();
    const measurements = await measureElementsDist(dir, { pack: false });
    assert.throws(
      () => checkFontBudget(measurements, { ...FONT_BUDGET, decoded: { ...FONT_BUDGET.decoded, 'Pretendard-Light': 1 } }),
      (error) => error instanceof FontBudgetError && error.kind === 'classification-failure',
    );
  });
});

describe('실제 Elements dist', () => {
  it('두 폰트 청크를 찾고 예산을 통과한다 (pnpm pack 생략)', async (t) => {
    if (!existsSync(path.join(ELEMENTS_DIR, 'dist', 'index.js'))) {
      t.skip('packages/elements/dist 가 없다 — 먼저 pnpm -r build 를 실행한다');
      return;
    }
    const measurements = await measureElementsDist(ELEMENTS_DIR, { pack: false });
    assert.equal(measurements.chunks.pretendard.entry, path.join(ELEMENTS_DIR, 'dist', 'fonts', 'pretendard.js'));
    assert.equal(measurements.chunks.notoSansJp.entry, path.join(ELEMENTS_DIR, 'dist', 'fonts', 'noto-sans-jp.js'));
    assert.ok(measurements.rootClosure.files.includes(path.join(ELEMENTS_DIR, 'dist', 'index.js')));
    for (const file of measurements.rootClosure.files) {
      assert.ok(!file.includes(`${path.sep}fonts${path.sep}`), `루트 closure에 폰트 청크가 들어갔다: ${file}`);
    }
    assert.deepEqual(Object.keys(measurements.decoded).sort(), ['Noto Sans JP', 'Pretendard', 'Pretendard-Bold']);
    const result = checkFontBudget(measurements, FONT_BUDGET);
    assert.equal(result.ok, true, JSON.stringify(result.rows.filter((row) => !row.ok)));
  });
});
