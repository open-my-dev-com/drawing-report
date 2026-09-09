/**
 * 실행 환경 정보를 수집하고 비교합니다.
 *
 * 네 성능 측정에서 공통으로 필요한 `os.cpus()`·`os.totalmem()` 결과를 이 모듈에서 만듭니다.
 * 여기서 수집한 실행 환경 정보는 기준선과 현재 실행 환경이 같은지 판단하는 기준입니다.
 * 시간·메모리처럼 환경에 따라 달라지는 값은 실행 환경 정보가 같을 때만 비교합니다.
 */
import os from 'node:os';

/** 실행 환경 정보에 넣는 항목입니다. 하나라도 다르면 환경에 따라 달라지는 값은 비교하지 않습니다. */
export const FINGERPRINT_FIELDS = ['node', 'platform', 'arch', 'cpuModel', 'cores', 'memoryGiB', 'chromium'];

/**
 * 현재 프로세스의 실행 환경을 모읍니다.
 *
 * @param {{ chromium?: string | null }} [extra] - Chromium 버전처럼 호출자만 아는 값
 * @returns {{ node: string, v8: string, platform: string, arch: string, osRelease: string,
 *   cpuModel: string, cores: number, memoryBytes: number, memoryGiB: number, chromium: string | null }} 환경 정보
 */
export function collectEnvironment(extra = {}) {
  const cpus = os.cpus();
  const memoryBytes = os.totalmem();
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    memoryBytes,
    memoryGiB: Math.round((memoryBytes / 1024 ** 3) * 10) / 10,
    chromium: extra.chromium ?? null,
  };
}

/**
 * 환경 정보를 한 줄 문자열로 만듭니다. 같은 문자열이면 같은 환경으로 확인합니다.
 *
 * @param {Record<string, unknown>} environment - `collectEnvironment` 결과
 * @returns {string} 실행 환경을 비교할 때 사용하는 문자열
 */
export function environmentFingerprint(environment) {
  return FINGERPRINT_FIELDS.map((field) => `${field}=${environment?.[field] ?? 'none'}`).join(' | ');
}

/**
 * 두 실행 환경의 항목을 비교해 서로 다른 항목을 모읍니다.
 *
 * @param {Record<string, unknown>} baseline - 기준선을 측정한 환경
 * @param {Record<string, unknown>} actual - 이번 측정의 실행 환경
 * @returns {{ same: boolean, differences: Array<{ field: string, baseline: unknown, actual: unknown }> }} 비교 결과
 */
export function compareEnvironments(baseline, actual) {
  const differences = [];
  for (const field of FINGERPRINT_FIELDS) {
    const left = baseline?.[field] ?? null;
    const right = actual?.[field] ?? null;
    if (left !== right) differences.push({ field, baseline: left, actual: right });
  }
  return { same: differences.length === 0, differences };
}

/**
 * 실행 환경을 사람이 읽을 수 있는 한 줄로 나타냅니다.
 *
 * @param {Record<string, any>} environment - `collectEnvironment` 결과
 * @returns {string} 머리말에 쓸 문자열
 */
export function describeEnvironment(environment) {
  const parts = [
    `Node ${environment.node}`,
    `${environment.platform}/${environment.arch}`,
    `${environment.cpuModel} × ${environment.cores}`,
    `메모리 ${environment.memoryGiB}GiB`,
  ];
  if (environment.chromium) parts.push(`Chromium ${environment.chromium}`);
  return parts.join(' · ');
}
