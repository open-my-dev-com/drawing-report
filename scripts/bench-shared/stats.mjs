/**
 * 네 성능 측정이 함께 사용하는 통계·숫자 표기 도우미입니다.
 *
 * 중앙값·백분위수·숫자 표기 계산은 아래 구현을 공통으로 사용합니다.
 */

/**
 * 가장 가까운 순위 방식으로 백분위수를 계산합니다. 값이 짝수 개일 때 중앙값만 가운데 두 값의 평균을 씁니다.
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
 * 중앙값을 계산합니다.
 *
 * @param {number[]} values - 숫자 배열 (비우면 0)
 * @returns {number} 중앙값
 */
export function median(values) {
  return percentile(values, 50);
}

/**
 * 천 단위 구분 기호를 넣어 표시합니다. 소수는 반올림합니다.
 *
 * @param {number} value - 숫자
 * @returns {string} 문자열
 */
export function formatInt(value) {
  return Math.round(value).toLocaleString('en-US');
}
