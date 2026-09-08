// 기준선 해석과 비교 시험 — 저장소에 든 기준선 파일이 형식을 지키는지, 비교기가 결정적 지표와
// 환경 조건부 지표를 규칙대로 판정하는지 본다.
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BASELINE_SCHEMA, compareMetric, compareToBaseline, loadBaselines, validateBaseline } from './baseline.mjs';
import { BenchSchemaError, TOOLS, createResult, metric } from './result.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_DIR = path.join(ROOT, 'scripts', 'bench-baselines');

const environment = { node: 'v22.13.0', platform: 'linux', arch: 'x64', cpuModel: 'A', cores: 4, memoryGiB: 16, chromium: null };
const SAME = { same: true, differences: [] };
const OTHER = { same: false, differences: [{ field: 'cpuModel', baseline: 'A', actual: 'B' }] };

/**
 * 기준선 항목 하나를 만든다.
 *
 * @param {Record<string, any>} overrides - 덮어쓸 항목
 * @returns {Record<string, any>} 기준선 항목
 */
function entry(overrides = {}) {
  return {
    id: 'core.plan.1000.outputPages',
    label: '출력 페이지 수',
    unit: 'count',
    kind: 'deterministic',
    value: 33,
    context: { fixture: 'plan-1000', items: 1000 },
    rationale: '페이지 계획은 입력이 같으면 언제나 같은 페이지 수를 낸다',
    ...overrides,
  };
}

/**
 * 이번 측정 지표 하나를 만든다.
 *
 * @param {Record<string, any>} overrides - 덮어쓸 항목
 * @returns {Record<string, any>} 지표
 */
function measured(overrides = {}) {
  return metric(overrides.id ?? 'core.plan.1000.outputPages', {
    label: '출력 페이지 수',
    unit: overrides.unit ?? 'count',
    kind: overrides.kind ?? 'deterministic',
    value: overrides.value ?? 33,
    context: overrides.context ?? { fixture: 'plan-1000', items: 1000 },
  });
}

/**
 * 기준선 파일 하나를 만든다.
 *
 * @param {object[]} metrics - 기준선 항목
 * @returns {Record<string, any>} 기준선
 */
function baseline(metrics) {
  return {
    schema: { ...BASELINE_SCHEMA },
    tool: 'core',
    baselineCommit: '46c73cda6930492197a760366074ddb225f2bff2',
    measuredAt: '2026-09-08T00:00:00.000Z',
    environment,
    metrics,
  };
}

describe('validateBaseline', () => {
  it('40자리 커밋 SHA가 아니면 거절한다', () => {
    assert.throws(() => validateBaseline({ ...baseline([entry()]), baselineCommit: 'main' }), BenchSchemaError);
  });

  it('허용치 근거가 없으면 거절한다', () => {
    const broken = entry();
    delete broken.rationale;
    assert.throws(() => validateBaseline(baseline([broken])), BenchSchemaError);
  });

  it('환경 조건부 지표에 허용 회귀율이 없으면 거절한다', () => {
    assert.throws(() => validateBaseline(baseline([entry({ kind: 'environmental', unit: 'ms' })])), BenchSchemaError);
  });

  it('허용 회귀율이 1 이하면 거절한다', () => {
    const item = entry({ kind: 'environmental', unit: 'ms', tolerance: { maxRegressionRatio: 1 } });
    assert.throws(() => validateBaseline(baseline([item])), BenchSchemaError);
  });

  it('지표 id가 겹치면 거절한다', () => {
    assert.throws(() => validateBaseline(baseline([entry(), entry()])), BenchSchemaError);
  });

  it('schema 판 번호가 다르면 거절한다', () => {
    const value = baseline([entry()]);
    value.schema = { ...BASELINE_SCHEMA, version: BASELINE_SCHEMA.version + 1 };
    assert.throws(() => validateBaseline(value), BenchSchemaError);
  });
});

describe('compareMetric — 결정적 지표', () => {
  it('값이 같으면 통과한다', () => {
    assert.equal(compareMetric(entry(), measured(), SAME).status, 'pass');
  });

  it('값이 다르면 환경과 무관하게 실패한다', () => {
    const finding = compareMetric(entry(), measured({ value: 34 }), OTHER);
    assert.equal(finding.status, 'fail');
    assert.equal(finding.delta, 1);
  });

  it('허용 폭 안이면 통과한다', () => {
    const item = entry({ id: 'core.pdf.small.bytes', unit: 'bytes', value: 5135, tolerance: { absolute: 16 } });
    const actual = measured({ id: 'core.pdf.small.bytes', unit: 'bytes', value: 5140 });
    assert.equal(compareMetric(item, actual, SAME).status, 'pass');
  });

  it('지표가 없으면 실패한다', () => {
    const finding = compareMetric(entry(), undefined, SAME);
    assert.equal(finding.status, 'fail');
    assert.equal(finding.actual, null);
  });

  it('값이 숫자가 아니면 실패한다', () => {
    assert.equal(compareMetric(entry(), { ...measured(), value: Number.NaN }, SAME).status, 'fail');
  });

  it('단위가 다르면 실패한다', () => {
    assert.equal(compareMetric(entry(), measured({ unit: 'bytes' }), SAME).status, 'fail');
  });

  it('fixture가 다르면 실패한다', () => {
    const actual = measured({ context: { fixture: 'plan-100', items: 100 } });
    const finding = compareMetric(entry(), actual, SAME);
    assert.equal(finding.status, 'fail');
    assert.match(finding.reason, /비교 문맥/);
  });
});

describe('compareMetric — 환경 조건부 지표', () => {
  const item = entry({
    id: 'core.plan.1000.medianMs',
    unit: 'ms',
    kind: 'environmental',
    value: 10,
    context: { fixture: 'plan-1000', runs: 15 },
    tolerance: { maxRegressionRatio: 1.5 },
  });
  const timing = (value, context) => measured({
    id: 'core.plan.1000.medianMs', unit: 'ms', kind: 'environmental', value,
    context: context ?? { fixture: 'plan-1000', runs: 15 },
  });

  it('같은 환경에서 허용 회귀율 안이면 통과한다', () => {
    assert.equal(compareMetric(item, timing(14), SAME).status, 'pass');
  });

  it('같은 환경에서 허용 회귀율을 넘으면 실패한다', () => {
    const finding = compareMetric(item, timing(16), SAME);
    assert.equal(finding.status, 'fail');
    assert.equal(finding.ratio, 1.6);
  });

  it('환경이 다르면 비교하지 않고 사유와 수치를 함께 알린다', () => {
    const finding = compareMetric(item, timing(99), OTHER);
    assert.equal(finding.status, 'incomparable');
    assert.equal(finding.actual, 99);
    assert.equal(finding.baseline, 10);
    assert.match(finding.reason, /cpuModel/);
  });

  it('반복 수가 다르면 비교하지 않는다', () => {
    const finding = compareMetric(item, timing(11, { fixture: 'plan-1000', runs: 5 }), SAME);
    assert.equal(finding.status, 'incomparable');
    assert.match(finding.reason, /반복 수/);
  });
});

describe('compareToBaseline', () => {
  it('기준선에 없는 지표는 실패로 세지 않는다', () => {
    const result = createResult({
      tool: 'core',
      environment,
      metrics: [measured(), measured({ id: 'core.extra', value: 1 })],
    });
    const comparison = compareToBaseline(baseline([entry()]), result);
    assert.equal(comparison.ok, true);
    assert.deepEqual(comparison.unlisted, ['core.extra']);
    assert.equal(comparison.counts.pass, 1);
  });

  it('benchmark 이름이 다르면 거절한다', () => {
    const result = createResult({ tool: 'designer', environment, metrics: [] });
    assert.throws(() => compareToBaseline(baseline([entry()]), result), BenchSchemaError);
  });
});

describe('저장소의 기준선 파일', () => {
  const baselines = loadBaselines(BASELINE_DIR);

  it('benchmark 네 갈래의 기준선이 모두 있다', () => {
    assert.deepEqual([...baselines.keys()].sort(), [...TOOLS].sort());
  });

  it('지표 id가 benchmark 이름으로 시작한다', () => {
    const prefixes = { core: 'core.', designer: 'designer.', fonts: 'fonts.', 'mcp-list': 'mcp.' };
    for (const [tool, file] of baselines) {
      for (const item of file.metrics) {
        assert.ok(item.id.startsWith(prefixes[tool]), `${tool}: ${item.id}`);
      }
    }
  });

  it('결정적 지표와 환경 조건부 지표를 모두 담고 있다', () => {
    for (const [tool, file] of baselines) {
      const kinds = new Set(file.metrics.map((item) => item.kind));
      assert.ok(kinds.has('deterministic'), `${tool}: 결정적 지표가 없다`);
      assert.ok(kinds.has('environmental'), `${tool}: 환경 조건부 지표가 없다`);
    }
  });

  it('기준선 값을 그대로 다시 잰 결과는 전부 통과한다', () => {
    for (const [tool, file] of baselines) {
      const result = createResult({
        tool,
        environment: file.environment,
        metrics: file.metrics.map((item) => metric(item.id, {
          label: item.label, unit: item.unit, kind: item.kind, value: item.value, context: item.context,
        })),
      });
      const comparison = compareToBaseline(file, result);
      assert.equal(comparison.counts.fail, 0, `${tool}: ${JSON.stringify(comparison.findings.filter((f) => f.status !== 'pass'))}`);
      assert.equal(comparison.counts.incomparable, 0, `${tool}: 비교 불가 항목이 있다`);
    }
  });
});
