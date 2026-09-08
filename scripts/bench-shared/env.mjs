/**
 * 실행 환경 정보 수집과 비교.
 *
 * benchmark 네 갈래가 각자 `os.cpus()`·`os.totalmem()`으로 같은 머리말을 만들던 것을 모았다.
 * 여기서 만든 fingerprint는 기준선 비교에서 「같은 환경인지」를 판정하는 기준이 된다 —
 * 시간·메모리처럼 환경을 타는 값은 fingerprint가 같을 때만 비교한다.
 */
import os from 'node:os';

/** fingerprint에 넣는 항목 — 하나라도 다르면 환경을 타는 값은 비교하지 않는다 */
export const FINGERPRINT_FIELDS = ['node', 'platform', 'arch', 'cpuModel', 'cores', 'memoryGiB', 'chromium'];

/**
 * 현재 프로세스의 실행 환경을 모은다.
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
 * 환경 정보를 한 줄 문자열로 만든다. 같은 문자열이면 같은 환경으로 본다.
 *
 * @param {Record<string, unknown>} environment - `collectEnvironment` 결과
 * @returns {string} fingerprint
 */
export function environmentFingerprint(environment) {
  return FINGERPRINT_FIELDS.map((field) => `${field}=${environment?.[field] ?? 'none'}`).join(' | ');
}

/**
 * 두 환경의 fingerprint 항목을 견줘 다른 항목을 모은다.
 *
 * @param {Record<string, unknown>} baseline - 기준선을 잰 환경
 * @param {Record<string, unknown>} actual - 이번에 잰 환경
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
 * 사람이 읽을 실행 환경 한 줄.
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
