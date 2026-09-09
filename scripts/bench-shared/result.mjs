/**
 * 성능 측정 결과 JSON의 공통 형식입니다.
 *
 * 네 종류(Core·Designer·fonts·MCP list)가 서로 다른 원본 데이터를 남기더라도, 최상위 구조(`schema`·
 * `tool`·`environment`·`metrics`)는 같게 두어 하나의 비교기와 실행 목록에서 모두 읽을 수 있게 합니다.
 *
 * - `metrics`는 기준선과 비교할 값만 한 단계 목록으로 모읍니다. 원본 데이터는 `data`에 그대로 둡니다.
 * - `kind`는 값의 성질입니다. `deterministic`은 환경이 달라도 같아야 하는 값(횟수·바이트·페이지 수)이고,
 *   `environmental`은 기계와 부하에 따라 달라지는 값(시간·메모리)입니다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 결과 파일 형식의 이름과 버전입니다. */
export const RESULT_SCHEMA = Object.freeze({ name: 'slipkit-bench-result', version: 1 });

/** 측정 이름입니다. 결과 파일과 기준선 파일은 같은 이름을 사용합니다. */
export const TOOLS = Object.freeze(['core', 'designer', 'fonts', 'mcp-list']);

/** 지표의 단위입니다. */
export const METRIC_UNITS = Object.freeze(['ms', 'bytes', 'count', 'flag', 'ratio']);

/** 지표의 성질입니다. */
export const METRIC_KINDS = Object.freeze(['deterministic', 'environmental']);

/** 결과나 기준선 형식이 올바르지 않을 때 발생하는 오류입니다. */
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
 * 지표 하나를 만듭니다.
 *
 * @param {string} id - `core.plan.20000.medianMs`처럼 점으로 연결한 지표 식별자입니다.
 * @param {{ label: string, unit: string, kind: string, value: number,
 *   context?: Record<string, string | number> }} spec - 설명·단위·성질·값과 비교 문맥
 * @returns {{ id: string, label: string, unit: string, kind: string, value: number,
 *   context: Record<string, string | number> }} 지표
 * @throws BenchSchemaError 단위·성질이 알려진 값이 아니거나 값이 유한한 숫자가 아닐 때
 */
export function metric(id, spec) {
  if (typeof id !== 'string' || id.length === 0) throw new BenchSchemaError('지표 ID가 비어 있습니다.');
  if (typeof spec?.label !== 'string' || spec.label.length === 0) {
    throw new BenchSchemaError(`${id}: label이 필요합니다.`);
  }
  if (!METRIC_UNITS.includes(spec.unit)) {
    throw new BenchSchemaError(`${id}: 알 수 없는 단위 ${String(spec.unit)} (${METRIC_UNITS.join('·')} 중 하나)`);
  }
  if (!METRIC_KINDS.includes(spec.kind)) {
    throw new BenchSchemaError(`${id}: 알 수 없는 성질 ${String(spec.kind)} (${METRIC_KINDS.join('·')} 중 하나)`);
  }
  if (typeof spec.value !== 'number' || !Number.isFinite(spec.value)) {
    throw new BenchSchemaError(`${id}: 값이 유한한 숫자가 아닙니다(${String(spec.value)}).`);
  }
  return { id, label: spec.label, unit: spec.unit, kind: spec.kind, value: spec.value, context: spec.context ?? {} };
}

/**
 * 결과 객체를 만듭니다.
 *
 * @param {{ tool: string, environment: Record<string, unknown>, metrics: object[],
 *   options?: Record<string, unknown>, data?: Record<string, unknown>, measuredAt?: string }} spec - 결과 내용
 * @returns {Record<string, any>} 결과 객체
 * @throws BenchSchemaError 알 수 없는 성능 측정 이름이거나 지표 ID가 겹칠 때
 */
export function createResult(spec) {
  if (!TOOLS.includes(spec.tool)) {
    throw new BenchSchemaError(`알 수 없는 성능 측정 이름입니다: ${String(spec.tool)}(사용 가능: ${TOOLS.join('·')})`);
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
 * 결과 객체의 형식을 검사합니다.
 *
 * @param {any} value - 검사할 값
 * @returns {Record<string, any>} 같은 값 (문제가 없을 때)
 * @throws BenchSchemaError 결과 형식 이름·버전이 다르거나 지표가 형식에 맞지 않을 때
 */
export function validateResult(value) {
  if (value === null || typeof value !== 'object') throw new BenchSchemaError('결과가 객체가 아닙니다.');
  if (value.schema?.name !== RESULT_SCHEMA.name) {
    throw new BenchSchemaError(`결과 스키마 이름이 다릅니다: ${String(value.schema?.name)} ≠ ${RESULT_SCHEMA.name}`);
  }
  if (value.schema?.version !== RESULT_SCHEMA.version) {
    throw new BenchSchemaError(`결과 스키마 버전이 다릅니다: ${String(value.schema?.version)} ≠ ${RESULT_SCHEMA.version}`);
  }
  if (!TOOLS.includes(value.tool)) throw new BenchSchemaError(`알 수 없는 성능 측정 이름입니다: ${String(value.tool)}`);
  if (value.environment === null || typeof value.environment !== 'object') {
    throw new BenchSchemaError('environment가 객체가 아닙니다.');
  }
  if (!Array.isArray(value.metrics)) throw new BenchSchemaError('metrics가 배열이 아닙니다.');
  const seen = new Set();
  for (const entry of value.metrics) {
    metric(entry?.id, entry);
    if (seen.has(entry.id)) throw new BenchSchemaError(`지표 ID가 겹칩니다: ${entry.id}`);
    seen.add(entry.id);
  }
  return value;
}

/**
 * 지표 목록을 ID로 찾을 수 있는 Map으로 만듭니다.
 *
 * @param {{ metrics: object[] }} result - 결과 객체
 * @returns {Map<string, any>} id → 지표
 */
export function metricsById(result) {
  return new Map((result.metrics ?? []).map((entry) => [entry.id, entry]));
}

/**
 * 결과를 파일로 씁니다. 상위 디렉터리는 필요하면 만듭니다.
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
 * 결과 파일을 읽어 검사합니다.
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
    throw new BenchSchemaError(`결과 파일을 읽지 못했습니다(${file}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateResult(parsed);
}
