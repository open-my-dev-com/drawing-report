/**
 * `bench:all` 실행 결과를 한데 모은 목록 파일입니다.
 *
 * 각 하위 성능 측정은 원본 데이터 JSON을 남기고, 이 파일은 실행 결과를 하나로 묶습니다.
 * 어떤 명령을 어떤 순서로 실행했는지, 결과 파일이 어디에 있고 어떤 스키마 판인지, 성공했는지,
 * 실행 환경 정보와 기준선 판정을 함께 기록합니다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BenchSchemaError, TOOLS } from './result.mjs';

/** 실행 목록 형식의 이름과 버전입니다. */
export const MANIFEST_SCHEMA = Object.freeze({ name: 'slipkit-bench-manifest', version: 1 });

/**
 * 하위 실행 기록 하나를 만듭니다.
 *
 * @param {{ tool: string, command: string, argv: string[], success: boolean, exitCode: number | null,
 *   durationMs: number, resultFile: string | null, logFile: string | null,
 *   resultSchema?: { name: string, version: number } | null, fingerprint?: string | null,
 *   environment?: Record<string, unknown> | null, metricCount?: number,
 *   comparison?: Record<string, unknown> | null, error?: string | null }} spec - 실행 기록
 * @returns {Record<string, any>} 실행 기록
 * @throws BenchSchemaError 알 수 없는 측정 이름일 때
 */
export function createRunRecord(spec) {
  if (!TOOLS.includes(spec.tool)) throw new BenchSchemaError(`알 수 없는 성능 측정 이름입니다: ${String(spec.tool)}`);
  return {
    tool: spec.tool,
    command: spec.command,
    argv: spec.argv,
    success: spec.success === true,
    exitCode: spec.exitCode ?? null,
    durationMs: spec.durationMs,
    resultFile: spec.resultFile ?? null,
    logFile: spec.logFile ?? null,
    resultSchema: spec.resultSchema ?? null,
    environment: spec.environment ?? null,
    fingerprint: spec.fingerprint ?? null,
    metricCount: spec.metricCount ?? 0,
    comparison: spec.comparison ?? null,
    error: spec.error ?? null,
  };
}

/**
 * manifest를 만듭니다.
 *
 * @param {{ startedAt: string, finishedAt: string, outDir: string, baselineDir: string | null,
 *   environment: Record<string, unknown>, fingerprint: string, runs: object[],
 *   options?: Record<string, unknown> }} spec - manifest 내용
 * @returns {Record<string, any>} manifest
 * @throws BenchSchemaError 형식에 맞지 않을 때
 */
export function buildManifest(spec) {
  const manifest = {
    schema: { ...MANIFEST_SCHEMA },
    startedAt: spec.startedAt,
    finishedAt: spec.finishedAt,
    durationMs: Date.parse(spec.finishedAt) - Date.parse(spec.startedAt),
    outDir: spec.outDir,
    baselineDir: spec.baselineDir ?? null,
    environment: spec.environment,
    fingerprint: spec.fingerprint,
    options: spec.options ?? {},
    runs: spec.runs,
    ok: spec.runs.every((run) => run.success && (run.comparison === null || run.comparison.ok === true)),
  };
  return validateManifest(manifest);
}

/**
 * manifest를 검사합니다.
 *
 * @param {any} value - 검사할 값
 * @returns {Record<string, any>} 같은 값 (문제가 없을 때)
 * @throws BenchSchemaError 실행 목록 형식의 이름·버전이 다르거나 실행 기록이 형식에 맞지 않을 때
 */
export function validateManifest(value) {
  if (value === null || typeof value !== 'object') throw new BenchSchemaError('manifest가 객체가 아닙니다.');
  if (value.schema?.name !== MANIFEST_SCHEMA.name) {
    throw new BenchSchemaError(`manifest 스키마 이름이 다릅니다: ${String(value.schema?.name)} ≠ ${MANIFEST_SCHEMA.name}`);
  }
  if (value.schema?.version !== MANIFEST_SCHEMA.version) {
    throw new BenchSchemaError(`manifest 스키마 버전이 다릅니다: ${String(value.schema?.version)} ≠ ${MANIFEST_SCHEMA.version}`);
  }
  if (!Array.isArray(value.runs) || value.runs.length === 0) throw new BenchSchemaError('manifest의 runs가 비어 있습니다.');
  const seen = new Set();
  for (const run of value.runs) {
    if (!TOOLS.includes(run?.tool)) throw new BenchSchemaError(`알 수 없는 성능 측정 이름입니다: ${String(run?.tool)}`);
    if (seen.has(run.tool)) throw new BenchSchemaError(`실행 기록이 겹칩니다: ${run.tool}`);
    seen.add(run.tool);
    if (typeof run.success !== 'boolean') throw new BenchSchemaError(`${run.tool}: success가 참 또는 거짓이 아닙니다.`);
    if (run.success && run.resultFile === null) throw new BenchSchemaError(`${run.tool}: 성공한 실행에 결과 파일 경로가 없습니다.`);
    if (run.success && run.fingerprint === null) throw new BenchSchemaError(`${run.tool}: 성공한 실행에 환경 fingerprint가 없습니다.`);
    if (run.success && run.resultSchema === null) throw new BenchSchemaError(`${run.tool}: 성공한 실행에 결과 스키마가 없습니다.`);
  }
  if (typeof value.fingerprint !== 'string' || value.fingerprint.length === 0) {
    throw new BenchSchemaError('manifest의 fingerprint가 비어 있습니다.');
  }
  return value;
}

/**
 * manifest를 파일로 씁니다.
 *
 * @param {string} file - 저장할 경로
 * @param {Record<string, any>} manifest - `buildManifest` 결과
 * @returns {string} 저장한 경로
 */
export function writeManifestFile(file, manifest) {
  validateManifest(manifest);
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

/**
 * manifest 파일을 읽어 검사합니다.
 *
 * @param {string} file - 읽을 경로
 * @returns {Record<string, any>} manifest
 * @throws BenchSchemaError JSON이 아니거나 형식에 맞지 않을 때
 */
export function readManifestFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new BenchSchemaError(`manifest를 읽지 못했습니다(${file}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateManifest(parsed);
}
