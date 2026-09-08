/**
 * 성능 기준선 파일의 해석과 비교.
 *
 * 기준선은 `scripts/bench-baselines/<benchmark>.json`에 둔다. 항목마다 지표 id·단위·성질·기준값과
 * 비교 문맥(fixture 크기·반복 수·한 측정당 호출 수), 그리고 허용치를 적는다. 허용치는 항목별로 적고
 * 전역 하나로 묶지 않는다 — 작업마다 흔들리는 폭이 다르기 때문이다.
 *
 * `baselineCommit`은 그 기준값을 만들어 낸 코드의 커밋 SHA다 — 측정한 시점의 작업 트리가 아니라,
 * 재려는 코드가 들어 있는 커밋을 적는다. 다시 재서 값을 갱신할 때 함께 바꾼다.
 *
 * 비교 문맥은 `KNOWN_CONTEXT_KEYS`에 적힌 키만 쓴다. 기준선이든 이번 측정이든 목록에 없는 키가
 * 있으면 실패로 잡는다 — 결과의 의미를 가르는 키가 비교에서 조용히 빠지지 않게 하려는 것이다.
 *
 * 판정 방법
 * - `deterministic`: 환경과 무관하게 같아야 하는 값이라 어긋나면 실패다. 생성 시각이 섞여
 *   몇 바이트가 흔들리는 값만 `tolerance.absolute`로 폭을 적어 둔다.
 * - `environmental`: 시간·메모리처럼 기계와 부하를 타는 값이라, 환경 fingerprint와 반복 수가
 *   기준선과 같을 때만 항목별 허용 회귀율로 판정한다. 다르면 비교하지 않고 사유와 두 수치를
 *   함께 알린다 — 일반 CI에서 시간을 하드 한계로 쓰지 않기 위해서다.
 * - 지표가 없거나, 값이 유한한 숫자가 아니거나, 단위·성질·비교 문맥이 다르면 실패다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { compareEnvironments } from './env.mjs';
import { BenchSchemaError, METRIC_KINDS, METRIC_UNITS, TOOLS, metricsById } from './result.mjs';

/** 기준선 파일 봉투의 이름과 판 번호 */
export const BASELINE_SCHEMA = Object.freeze({ name: 'slipkit-bench-baseline', version: 1 });

/** 비교 문맥에서 값이 같아야 하는 키 — 다르면 같은 측정으로 보지 않는다 */
const COMPARED_CONTEXT_KEYS = ['fixture', 'items', 'files', 'batch'];

/** 반복 수 키 — 값을 견주지 않고 환경 조건부 지표를 비교할 수 있는지만 가른다 */
const RUNS_CONTEXT_KEY = 'runs';

/** 쓸 수 있는 비교 문맥 키 전부. 새 문맥 키를 적을 때 여기에 함께 더한다 */
export const KNOWN_CONTEXT_KEYS = Object.freeze([...COMPARED_CONTEXT_KEYS, RUNS_CONTEXT_KEY]);

/**
 * 기준선 파일을 검사한다.
 *
 * @param {any} value - 검사할 값
 * @returns {Record<string, any>} 같은 값 (문제가 없을 때)
 * @throws BenchSchemaError 봉투·항목이 형식에 맞지 않을 때
 */
export function validateBaseline(value) {
  if (value === null || typeof value !== 'object') throw new BenchSchemaError('기준선이 객체가 아니다');
  if (value.schema?.name !== BASELINE_SCHEMA.name) {
    throw new BenchSchemaError(`기준선 schema 이름이 다르다: ${String(value.schema?.name)} ≠ ${BASELINE_SCHEMA.name}`);
  }
  if (value.schema?.version !== BASELINE_SCHEMA.version) {
    throw new BenchSchemaError(`기준선 schema 판 번호가 다르다: ${String(value.schema?.version)} ≠ ${BASELINE_SCHEMA.version}`);
  }
  if (!TOOLS.includes(value.tool)) throw new BenchSchemaError(`알 수 없는 benchmark 이름 ${String(value.tool)}`);
  if (typeof value.baselineCommit !== 'string' || !/^[0-9a-f]{40}$/.test(value.baselineCommit)) {
    throw new BenchSchemaError(`${value.tool}: baselineCommit이 40자리 커밋 SHA가 아니다`);
  }
  if (value.environment === null || typeof value.environment !== 'object') {
    throw new BenchSchemaError(`${value.tool}: environment가 객체가 아니다`);
  }
  if (!Array.isArray(value.metrics) || value.metrics.length === 0) {
    throw new BenchSchemaError(`${value.tool}: metrics가 비었다`);
  }
  const seen = new Set();
  for (const entry of value.metrics) {
    const id = entry?.id;
    if (typeof id !== 'string' || id.length === 0) throw new BenchSchemaError(`${value.tool}: 지표 id가 비었다`);
    if (seen.has(id)) throw new BenchSchemaError(`${value.tool}: 지표 id가 겹친다 — ${id}`);
    seen.add(id);
    if (!METRIC_UNITS.includes(entry.unit)) throw new BenchSchemaError(`${id}: 알 수 없는 단위 ${String(entry.unit)}`);
    if (!METRIC_KINDS.includes(entry.kind)) throw new BenchSchemaError(`${id}: 알 수 없는 성질 ${String(entry.kind)}`);
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      throw new BenchSchemaError(`${id}: 기준값이 유한한 숫자가 아니다 (${String(entry.value)})`);
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.length === 0) {
      throw new BenchSchemaError(`${id}: 허용치 근거(rationale)가 필요하다`);
    }
    const unknownKeys = unknownContextKeys([entry.context]);
    if (unknownKeys.length > 0) {
      throw new BenchSchemaError(`${id}: 모르는 비교 문맥 키가 있다 — ${unknownKeys.join(', ')}`);
    }
    if (entry.kind === 'environmental') {
      const ratio = entry.tolerance?.maxRegressionRatio;
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 1) {
        throw new BenchSchemaError(`${id}: 환경 조건부 지표에는 1보다 큰 tolerance.maxRegressionRatio가 필요하다`);
      }
    } else if (entry.tolerance !== undefined) {
      const absolute = entry.tolerance.absolute;
      if (typeof absolute !== 'number' || !Number.isFinite(absolute) || absolute < 0) {
        throw new BenchSchemaError(`${id}: 결정적 지표의 tolerance.absolute는 0 이상의 숫자여야 한다`);
      }
    }
  }
  return value;
}

/**
 * 기준선 파일 하나를 읽는다.
 *
 * @param {string} file - 파일 경로
 * @returns {Record<string, any>} 기준선
 * @throws BenchSchemaError JSON이 아니거나 형식에 맞지 않을 때
 */
function readBaselineFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new BenchSchemaError(`기준선을 읽지 못했다 (${file}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateBaseline(parsed);
}

/**
 * 기준선 디렉터리의 `<benchmark>.json`을 모두 읽는다.
 *
 * @param {string} dir - 기준선 디렉터리
 * @returns {Map<string, Record<string, any>>} benchmark 이름 → 기준선
 * @throws BenchSchemaError 파일 이름과 `tool`이 다를 때
 */
export function loadBaselines(dir) {
  const baselines = new Map();
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const baseline = readBaselineFile(path.join(dir, name));
    const expected = `${baseline.tool}.json`;
    if (name !== expected) throw new BenchSchemaError(`기준선 파일 이름이 tool과 다르다: ${name} ≠ ${expected}`);
    baselines.set(baseline.tool, baseline);
  }
  return baselines;
}

/**
 * 알려진 문맥 키에 없는 키를 모은다.
 *
 * @param {Array<Record<string, any> | undefined>} contexts - 살펴볼 비교 문맥
 * @returns {string[]} 모르는 키 목록. 없으면 빈 배열
 */
function unknownContextKeys(contexts) {
  const keys = new Set(contexts.flatMap((context) => Object.keys(context ?? {})));
  return [...keys].filter((key) => !KNOWN_CONTEXT_KEYS.includes(key));
}

/**
 * 비교 문맥이 같은지 본다.
 *
 * @param {Record<string, any>} expected - 기준선 항목의 문맥
 * @param {Record<string, any>} actual - 이번 지표의 문맥
 * @returns {string[]} 다른 항목 설명. 같으면 빈 배열
 */
function contextDifferences(expected = {}, actual = {}) {
  const out = [];
  for (const key of COMPARED_CONTEXT_KEYS) {
    if (expected[key] === undefined && actual[key] === undefined) continue;
    if (expected[key] !== actual[key]) out.push(`${key} ${String(expected[key])} ≠ ${String(actual[key])}`);
  }
  for (const key of unknownContextKeys([expected, actual])) {
    out.push(`모르는 문맥 키 ${key} — 알려진 문맥 키 목록에 더해야 비교한다`);
  }
  return out;
}

/**
 * 기준선 항목 하나를 이번 측정과 견준다.
 *
 * @param {Record<string, any>} entry - 기준선 항목
 * @param {Record<string, any> | undefined} actual - 같은 id의 이번 지표
 * @param {{ same: boolean, differences: Array<{ field: string, baseline: unknown, actual: unknown }> }} environment -
 *   `compareEnvironments` 결과
 * @returns {{ id: string, kind: string, unit: string, label: string, status: string, reason: string,
 *   baseline: number, actual: number | null, delta: number | null, ratio: number | null }} 판정
 */
export function compareMetric(entry, actual, environment) {
  const base = {
    id: entry.id,
    kind: entry.kind,
    unit: entry.unit,
    label: entry.label ?? entry.id,
    baseline: entry.value,
    actual: null,
    delta: null,
    ratio: null,
  };
  if (actual === undefined || actual === null) {
    return { ...base, status: 'fail', reason: '이번 실행에 지표가 없다' };
  }
  if (typeof actual.value !== 'number' || !Number.isFinite(actual.value)) {
    return { ...base, status: 'fail', reason: `값이 유한한 숫자가 아니다 (${String(actual.value)})` };
  }
  const measured = actual.value;
  const delta = measured - entry.value;
  const ratio = entry.value === 0 ? null : measured / entry.value;
  const filled = { ...base, actual: measured, delta, ratio };
  if (actual.unit !== entry.unit) {
    return { ...filled, status: 'fail', reason: `단위가 다르다: 기준선 ${entry.unit}, 이번 ${String(actual.unit)}` };
  }
  if (actual.kind !== entry.kind) {
    return { ...filled, status: 'fail', reason: `성질이 다르다: 기준선 ${entry.kind}, 이번 ${String(actual.kind)}` };
  }
  const contextDiff = contextDifferences(entry.context, actual.context);
  if (contextDiff.length > 0) {
    return { ...filled, status: 'fail', reason: `비교 문맥이 다르다: ${contextDiff.join(', ')}` };
  }

  if (entry.kind === 'deterministic') {
    const allowed = entry.tolerance?.absolute ?? 0;
    if (Math.abs(delta) <= allowed) {
      return { ...filled, status: 'pass', reason: allowed === 0 ? '기준선과 같다' : `허용 폭 ±${allowed} 안이다` };
    }
    return { ...filled, status: 'fail', reason: `결정적 값이 다르다 (허용 폭 ±${allowed})` };
  }

  if (!environment.same) {
    const fields = environment.differences.map((diff) => `${diff.field}: ${String(diff.baseline)} → ${String(diff.actual)}`);
    return { ...filled, status: 'incomparable', reason: `환경이 달라 비교하지 않는다 (${fields.join(', ')})` };
  }
  const baselineRuns = entry.context?.[RUNS_CONTEXT_KEY];
  const actualRuns = actual.context?.[RUNS_CONTEXT_KEY];
  if (baselineRuns !== undefined && baselineRuns !== actualRuns) {
    return { ...filled, status: 'incomparable', reason: `반복 수가 달라 비교하지 않는다 (기준선 ${baselineRuns}회, 이번 ${String(actualRuns)}회)` };
  }
  const limit = entry.tolerance.maxRegressionRatio;
  if (ratio === null) {
    return { ...filled, status: 'fail', reason: '기준값이 0이라 회귀율을 낼 수 없다' };
  }
  if (ratio <= limit) {
    return { ...filled, status: 'pass', reason: `허용 회귀율 ${limit}배 안이다 (${ratio.toFixed(2)}배)` };
  }
  return { ...filled, status: 'fail', reason: `허용 회귀율 ${limit}배를 넘었다 (${ratio.toFixed(2)}배)` };
}

/**
 * 결과 하나를 기준선과 견준다.
 *
 * @param {Record<string, any>} baseline - `validateBaseline`을 통과한 기준선
 * @param {Record<string, any>} result - `validateResult`를 통과한 결과
 * @returns {{ tool: string, ok: boolean, baselineCommit: string,
 *   environment: { same: boolean, differences: object[] }, findings: object[], unlisted: string[],
 *   counts: { pass: number, fail: number, incomparable: number, unlisted: number } }} 판정 묶음
 */
export function compareToBaseline(baseline, result) {
  if (baseline.tool !== result.tool) {
    throw new BenchSchemaError(`기준선과 결과의 benchmark가 다르다: ${baseline.tool} ≠ ${result.tool}`);
  }
  const environment = compareEnvironments(baseline.environment, result.environment);
  const measured = metricsById(result);
  const findings = baseline.metrics.map((entry) => compareMetric(entry, measured.get(entry.id), environment));
  const listed = new Set(baseline.metrics.map((entry) => entry.id));
  const unlisted = [...measured.keys()].filter((id) => !listed.has(id));
  const counts = {
    pass: findings.filter((finding) => finding.status === 'pass').length,
    fail: findings.filter((finding) => finding.status === 'fail').length,
    incomparable: findings.filter((finding) => finding.status === 'incomparable').length,
    unlisted: unlisted.length,
  };
  return {
    tool: result.tool,
    ok: counts.fail === 0,
    baselineCommit: baseline.baselineCommit,
    environment,
    findings,
    unlisted,
    counts,
  };
}

/**
 * 지표 값을 단위와 함께 적는다.
 *
 * @param {number} value - 값
 * @param {string} unit - 단위
 * @returns {string} 문자열
 */
function formatValue(value, unit) {
  if (unit === 'ms') return `${value.toFixed(2)}ms`;
  if (unit === 'bytes') return `${Math.round(value)} B`;
  return String(value);
}

/**
 * 판정 묶음을 사람이 읽을 줄로 만든다.
 *
 * @param {ReturnType<typeof compareToBaseline>} comparison - 판정 묶음
 * @returns {string[]} 출력할 줄 목록
 */
export function formatComparison(comparison) {
  const lines = [];
  const { counts } = comparison;
  lines.push(
    `### ${comparison.tool} — 기준선 ${comparison.baselineCommit.slice(0, 12)} · ` +
      `통과 ${counts.pass} · 실패 ${counts.fail} · 비교 불가 ${counts.incomparable} · 기준선 없음 ${counts.unlisted}`,
  );
  if (!comparison.environment.same) {
    const fields = comparison.environment.differences.map((diff) => `${diff.field}: ${String(diff.baseline)} → ${String(diff.actual)}`);
    lines.push(`- 환경이 기준선과 다르다 — ${fields.join(', ')} (환경 조건부 지표는 비교하지 않는다)`);
  }
  for (const finding of comparison.findings) {
    if (finding.status === 'pass') continue;
    const mark = finding.status === 'fail' ? '실패' : '비교 불가';
    const actual = finding.actual === null ? '없음' : formatValue(finding.actual, finding.unit);
    lines.push(`- [${mark}] ${finding.id}: 기준선 ${formatValue(finding.baseline, finding.unit)} → 이번 ${actual} — ${finding.reason}`);
  }
  return lines;
}
