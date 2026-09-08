// 통계 도우미 시험 — `node --test`로 실행한다. 예전에 Core benchmark가 따로 갖고 있던 중앙값
// 계산과 값이 같은지도 함께 본다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatInt, median, percentile } from './stats.mjs';

/** 통합 전 `scripts/benchmark.mjs`가 쓰던 중앙값 계산 (배열을 직접 정렬했다) */
function legacyMiddle(times) {
  const values = [...times].sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

describe('median', () => {
  it('홀수 개면 가운데 값을 돌려준다', () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  it('짝수 개면 가운데 두 값의 평균을 돌려준다', () => {
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });

  it('비어 있으면 0을 돌려준다', () => {
    assert.equal(median([]), 0);
  });

  it('입력 배열을 정렬해 바꾸지 않는다', () => {
    const values = [3, 1, 2];
    median(values);
    assert.deepEqual(values, [3, 1, 2]);
  });

  it('통합 전 Core benchmark의 중앙값과 같은 값을 낸다', () => {
    const samples = [
      [1],
      [2, 1],
      [5, 3, 1, 4, 2],
      [10.5, 2.25, 8, 4, 6.75, 1],
      [0.001, 0.002, 0.003, 0.004],
    ];
    for (const values of samples) assert.equal(median(values), legacyMiddle(values));
  });
});

describe('percentile', () => {
  it('95번째 백분위수는 가장 가까운 순위를 고른다', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    assert.equal(percentile(values, 95), 19);
  });

  it('0과 100은 최솟값과 최댓값이다', () => {
    const values = [7, 2, 9, 4];
    assert.equal(percentile(values, 0), 2);
    assert.equal(percentile(values, 100), 9);
  });

  it('비어 있으면 0을 돌려준다', () => {
    assert.equal(percentile([], 95), 0);
  });
});

describe('formatInt', () => {
  it('천 단위 구분 기호를 넣고 소수는 반올림한다', () => {
    assert.equal(formatInt(1234567), '1,234,567');
    assert.equal(formatInt(1234.6), '1,235');
  });
});
