// 성능 측정 결과의 최상위 구조와 파일 읽기·쓰기 형식을 확인합니다.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  BenchSchemaError,
  RESULT_SCHEMA,
  createResult,
  metric,
  metricsById,
  readResultFile,
  validateResult,
  writeResultFile,
} from './result.mjs';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * 임시 디렉터리를 만듭니다.
 *
 * @returns {string} 디렉터리 경로
 */
function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slipkit-bench-result-test-'));
  tempDirs.push(dir);
  return dir;
}

const environment = { node: 'v22.13.0', platform: 'linux', arch: 'x64', cpuModel: 'test', cores: 4, memoryGiB: 16, chromium: null };

/**
 * 시험용 지표 하나를 만듭니다.
 *
 * @param {string} id - 지표 ID
 * @param {number} value - 값
 * @returns {object} 지표
 */
function sample(id, value) {
  return metric(id, { label: id, unit: 'count', kind: 'deterministic', value, context: { fixture: 'f' } });
}

describe('metric', () => {
  it('알 수 없는 단위를 거절한다', () => {
    assert.throws(() => metric('a', { label: 'a', unit: 'seconds', kind: 'deterministic', value: 1 }), BenchSchemaError);
  });

  it('알 수 없는 성질을 거절한다', () => {
    assert.throws(() => metric('a', { label: 'a', unit: 'ms', kind: 'guess', value: 1 }), BenchSchemaError);
  });

  it('NaN·무한대·누락 값을 거절한다', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '3']) {
      assert.throws(() => metric('a', { label: 'a', unit: 'ms', kind: 'environmental', value }), BenchSchemaError);
    }
  });

  it('설명이 없으면 거절한다', () => {
    assert.throws(() => metric('a', { unit: 'ms', kind: 'environmental', value: 1 }), BenchSchemaError);
  });

  it('문맥을 주지 않으면 빈 객체로 둔다', () => {
    assert.deepEqual(metric('a', { label: 'a', unit: 'ms', kind: 'environmental', value: 1 }).context, {});
  });
});

describe('createResult', () => {
  it('최상위 구조에 스키마 이름과 버전을 넣는다', () => {
    const result = createResult({ tool: 'core', environment, metrics: [sample('a', 1)] });
    assert.deepEqual(result.schema, { ...RESULT_SCHEMA });
    assert.equal(result.tool, 'core');
    assert.equal(typeof result.measuredAt, 'string');
  });

  it('알 수 없는 성능 측정 이름을 거절한다', () => {
    assert.throws(() => createResult({ tool: 'unknown', environment, metrics: [] }), BenchSchemaError);
  });

  it('지표 ID가 겹치면 거절한다', () => {
    assert.throws(() => createResult({ tool: 'core', environment, metrics: [sample('a', 1), sample('a', 2)] }), BenchSchemaError);
  });
});

describe('validateResult', () => {
  it('스키마 버전이 다르면 거절한다', () => {
    const result = createResult({ tool: 'core', environment, metrics: [sample('a', 1)] });
    assert.throws(() => validateResult({ ...result, schema: { ...RESULT_SCHEMA, version: RESULT_SCHEMA.version + 1 } }), BenchSchemaError);
  });

  it('environment가 없으면 거절한다', () => {
    const result = createResult({ tool: 'core', environment, metrics: [] });
    assert.throws(() => validateResult({ ...result, environment: null }), BenchSchemaError);
  });
});

describe('결과 파일', () => {
  it('쓰고 다시 읽으면 같은 내용이다', () => {
    const file = path.join(tempDir(), 'nested', 'core.json');
    const result = createResult({ tool: 'core', environment, metrics: [sample('a', 1), sample('b', 2)], data: { rows: [1, 2] } });
    writeResultFile(file, result);
    const loaded = readResultFile(file);
    assert.deepEqual(loaded, result);
    assert.equal(metricsById(loaded).get('b').value, 2);
  });

  it('JSON이 아니면 형식 오류로 알린다', () => {
    const file = path.join(tempDir(), 'broken.json');
    writeFileSync(file, '{ not json');
    assert.throws(() => readResultFile(file), BenchSchemaError);
  });
});
