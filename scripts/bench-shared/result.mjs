/**
 * benchmark 결과 JSON의 공통 형식.
 *
 * 네 갈래(Core·Designer·fonts·MCP list)가 저마다 다른 원자료를 남기더라도, 봉투(`schema`·`tool`·
 * `environment`·`metrics`)는 같게 두어 하나의 비교기와 manifest가 모두를 읽을 수 있게 한다.
 *
 * - `metrics`는 기준선과 맞대 볼 값만 평평하게 모은 목록이다. 원자료는 `data`에 그대로 둔다.
 * - `kind`는 값의 성질이다. `deterministic`은 환경이 달라도 같아야 하는 값(횟수·바이트·페이지 수),
 *   `environmental`은 기계와 부하를 타는 값(시간·메모리)이다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 결과 파일 봉투의 이름과 판 번호 */
export const RESULT_SCHEMA = Object.freeze({ name: 'slipkit-bench-result', version: 1 });

/** benchmark 이름 — 결과 파일과 기준선 파일이 같은 이름을 쓴다 */
export const TOOLS = Object.freeze(['core', 'designer', 'fonts', 'mcp-list']);

/** 지표의 단위 */
export const METRIC_UNITS = Object.freeze(['ms', 'bytes', 'count', 'flag', 'ratio']);

/** 지표의 성질 */
export const METRIC_KINDS = Object.freeze(['deterministic', 'environmental']);

/** 결과·기준선 형식이 어긋났을 때 던지는 오류 */
export class BenchSchemaError extends Error {
  /**
   * @param {string} message - 어긋난 내용
   */
  constructor(message) {
    super(message);
    this.name = 'BenchSchemaError';
  }
}

/**
 * 지표 하나를 만든다.
 *
 * @param {string} id - 지표 식별자 (`core.plan.20000.medianMs`처럼 점으로 잇는다)
 * @param {{ label: string, unit: string, kind: string, value: number,
 *   context?: Record<string, string | number> }} spec - 설명·단위·성질·값과 비교 문맥
 * @returns {{ id: string, label: string, unit: string, kind: string, value: number,
 *   context: Record<string, string | number> }} 지표
 * @throws BenchSchemaError 단위·성질이 알려진 값이 아니거나 값이 유한한 숫자가 아닐 때
 */
export function metric(id, spec) {
  if (typeof id !== 'string' || id.length === 0) throw new BenchSchemaError('지표 id가 비었다');
  if (typeof spec?.label !== 'string' || spec.label.length === 0) {
    throw new BenchSchemaError(`${id}: label이 필요하다`);
  }
  if (!METRIC_UNITS.includes(spec.unit)) {
    throw new BenchSchemaError(`${id}: 알 수 없는 단위 ${String(spec.unit)} (${METRIC_UNITS.join('·')} 중 하나)`);
  }
  if (!METRIC_KINDS.includes(spec.kind)) {
    throw new BenchSchemaError(`${id}: 알 수 없는 성질 ${String(spec.kind)} (${METRIC_KINDS.join('·')} 중 하나)`);
  }
  if (typeof spec.value !== 'number' || !Number.isFinite(spec.value)) {
    throw new BenchSchemaError(`${id}: 값이 유한한 숫자가 아니다 (${String(spec.value)})`);
  }
  return { id, label: spec.label, unit: spec.unit, kind: spec.kind, value: spec.value, context: spec.context ?? {} };
}

/**
 * 결과 봉투를 만든다.
 *
 * @param {{ tool: string, environment: Record<string, unknown>, metrics: object[],
 *   options?: Record<string, unknown>, data?: Record<string, unknown>, measuredAt?: string }} spec - 결과 내용
 * @returns {Record<string, any>} 결과 객체
 * @throws BenchSchemaError 알 수 없는 benchmark 이름이거나 지표 id가 겹칠 때
 */
export function createResult(spec) {
  if (!TOOLS.includes(spec.tool)) {
    throw new BenchSchemaError(`알 수 없는 benchmark 이름 ${String(spec.tool)} (${TOOLS.join('·')} 중 하나)`);
  }
  const result = {
    schema: { ...RESULT_SCHEMA },
    tool: spec.tool,
    measuredAt: spec.measuredAt ?? new Date().toISOString(),
    environment: spec.environment,
    options: spec.options ?? {},
    metrics: spec.metrics ?? [],
    data: spec.data ?? {},
  };
  validateResult(result);
  return result;
}

/**
 * 결과 봉투를 검사한다.
 *
 * @param {any} value - 검사할 값
 * @returns {Record<string, any>} 같은 값 (문제가 없을 때)
 * @throws BenchSchemaError 봉투 이름·판 번호가 다르거나 지표가 형식에 맞지 않을 때
 */
export function validateResult(value) {
  if (value === null || typeof value !== 'object') throw new BenchSchemaError('결과가 객체가 아니다');
  if (value.schema?.name !== RESULT_SCHEMA.name) {
    throw new BenchSchemaError(`결과 schema 이름이 다르다: ${String(value.schema?.name)} ≠ ${RESULT_SCHEMA.name}`);
  }
  if (value.schema?.version !== RESULT_SCHEMA.version) {
    throw new BenchSchemaError(`결과 schema 판 번호가 다르다: ${String(value.schema?.version)} ≠ ${RESULT_SCHEMA.version}`);
  }
  if (!TOOLS.includes(value.tool)) throw new BenchSchemaError(`알 수 없는 benchmark 이름 ${String(value.tool)}`);
  if (value.environment === null || typeof value.environment !== 'object') {
    throw new BenchSchemaError('environment가 객체가 아니다');
  }
  if (!Array.isArray(value.metrics)) throw new BenchSchemaError('metrics가 배열이 아니다');
  const seen = new Set();
  for (const entry of value.metrics) {
    metric(entry?.id, entry);
    if (seen.has(entry.id)) throw new BenchSchemaError(`지표 id가 겹친다: ${entry.id}`);
    seen.add(entry.id);
  }
  return value;
}

/**
 * 지표 목록을 id로 찾을 수 있는 Map으로 만든다.
 *
 * @param {{ metrics: object[] }} result - 결과 객체
 * @returns {Map<string, any>} id → 지표
 */
export function metricsById(result) {
  return new Map((result.metrics ?? []).map((entry) => [entry.id, entry]));
}

/**
 * 결과를 파일로 쓴다. 상위 디렉터리는 필요하면 만든다.
 *
 * @param {string} file - 저장할 경로
 * @param {Record<string, any>} result - `createResult` 결과
 * @returns {string} 저장한 경로
 */
export function writeResultFile(file, result) {
  validateResult(result);
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}

/**
 * 결과 파일을 읽어 검사한다.
 *
 * @param {string} file - 읽을 경로
 * @returns {Record<string, any>} 결과 객체
 * @throws BenchSchemaError JSON이 아니거나 봉투가 형식에 맞지 않을 때
 */
export function readResultFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new BenchSchemaError(`결과 파일을 읽지 못했다 (${file}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateResult(parsed);
}
