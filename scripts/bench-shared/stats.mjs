/**
 * benchmark 네 갈래가 함께 쓰는 통계·숫자 표기 도우미.
 *
 * 예전에는 Core benchmark가 자체 `middle()`을, 나머지 셋이 `bench-designer/metrics.mjs`의
 * `median`·`percentile`·`formatInt`를 각각 썼다. 계산 방법이 같으므로 여기 하나로 모은다.
 */

/**
 * 백분위수 (가장 가까운 순위 방식). 짝수 개의 중앙값만 두 값의 평균을 쓴다.
 *
 * @param {number[]} values - 숫자 배열 (비우면 0)
 * @param {number} p - 0~100
 * @returns {number} 백분위 값
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p === 50 && sorted.length % 2 === 0) {
    const mid = sorted.length / 2;
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/**
 * 중앙값.
 *
 * @param {number[]} values - 숫자 배열 (비우면 0)
 * @returns {number} 중앙값
 */
export function median(values) {
  return percentile(values, 50);
}

/**
 * 천 단위 구분 기호를 넣어 적는다. 소수는 반올림한다.
 *
 * @param {number} value - 숫자
 * @returns {string} 문자열
 */
export function formatInt(value) {
  return Math.round(value).toLocaleString('en-US');
}
