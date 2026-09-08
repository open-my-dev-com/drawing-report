// bench:all manifest 시험 — 하위 실행 기록이 갖춰야 할 항목과 전체 성공 판정을 본다.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { MANIFEST_SCHEMA, buildManifest, createRunRecord, readManifestFile, validateManifest, writeManifestFile } from './manifest.mjs';
import { BenchSchemaError, RESULT_SCHEMA } from './result.mjs';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * 임시 디렉터리를 만든다.
 *
 * @returns {string} 디렉터리 경로
 */
function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slipkit-bench-manifest-test-'));
  tempDirs.push(dir);
  return dir;
}

const environment = { node: 'v22.13.0', platform: 'linux', arch: 'x64', cpuModel: 'A', cores: 4, memoryGiB: 16, chromium: null };
const FINGERPRINT = 'node=v22.13.0 | platform=linux';

/**
 * 성공한 하위 실행 기록을 만든다.
 *
 * @param {string} tool - benchmark 이름
 * @param {Record<string, any>} overrides - 덮어쓸 항목
 * @returns {Record<string, any>} 실행 기록
 */
function record(tool, overrides = {}) {
  return createRunRecord({
    tool,
    command: `node scripts/${tool}.mjs`,
    argv: ['--json', `${tool}.json`],
    success: true,
    exitCode: 0,
    durationMs: 1000,
    resultFile: `${tool}.json`,
    logFile: `${tool}.log`,
    resultSchema: { ...RESULT_SCHEMA },
    environment,
    fingerprint: FINGERPRINT,
    metricCount: 3,
    ...overrides,
  });
}

/**
 * manifest 하나를 만든다.
 *
 * @param {object[]} runs - 하위 실행 기록
 * @returns {Record<string, any>} manifest
 */
function manifest(runs) {
  return buildManifest({
    startedAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:10:00.000Z',
    outDir: '/tmp/bench',
    baselineDir: 'scripts/bench-baselines',
    environment,
    fingerprint: FINGERPRINT,
    runs,
  });
}

describe('buildManifest', () => {
  it('시작·종료 시각에서 전체 소요를 계산한다', () => {
    assert.equal(manifest([record('core')]).durationMs, 600_000);
  });

  it('하위 실행이 모두 성공하고 기준선을 통과하면 ok다', () => {
    const runs = [record('core', { comparison: { ok: true } }), record('designer')];
    assert.equal(manifest(runs).ok, true);
  });

  it('기준선 판정이 실패면 ok가 아니다', () => {
    assert.equal(manifest([record('core', { comparison: { ok: false } })]).ok, false);
  });

  it('하위 실행이 실패하면 ok가 아니다', () => {
    const failed = createRunRecord({
      tool: 'fonts', command: 'node scripts/bench-fonts.mjs', argv: [], success: false, exitCode: 1,
      durationMs: 10, resultFile: null, logFile: 'fonts.log', error: '실패 사유',
    });
    assert.equal(manifest([record('core'), failed]).ok, false);
  });
});

describe('validateManifest', () => {
  it('성공한 실행에 결과 파일·fingerprint·schema가 없으면 거절한다', () => {
    for (const missing of ['resultFile', 'fingerprint', 'resultSchema']) {
      const run = record('core');
      run[missing] = null;
      assert.throws(() => manifest([run]), BenchSchemaError, `${missing}가 없어도 통과했다`);
    }
  });

  it('같은 benchmark가 두 번 들어가면 거절한다', () => {
    assert.throws(() => manifest([record('core'), record('core')]), BenchSchemaError);
  });

  it('실행 기록이 비면 거절한다', () => {
    assert.throws(() => manifest([]), BenchSchemaError);
  });

  it('schema 판 번호가 다르면 거절한다', () => {
    const value = manifest([record('core')]);
    value.schema = { ...MANIFEST_SCHEMA, version: MANIFEST_SCHEMA.version + 1 };
    assert.throws(() => validateManifest(value), BenchSchemaError);
  });
});

describe('manifest 파일', () => {
  it('쓰고 다시 읽으면 같은 내용이다', () => {
    const file = path.join(tempDir(), 'manifest.json');
    const value = manifest([record('core'), record('mcp-list')]);
    writeManifestFile(file, value);
    assert.deepEqual(readManifestFile(file), value);
  });

  it('JSON이 아니면 형식 오류로 알린다', () => {
    const file = path.join(tempDir(), 'broken.json');
    writeFileSync(file, 'nope');
    assert.throws(() => readManifestFile(file), BenchSchemaError);
  });
});
