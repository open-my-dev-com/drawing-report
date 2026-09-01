import { describe, expect, it } from 'vitest';
import { STRINGS, getStrings } from '../src/strings.js';

// 타입 검사 외에 각 언어 사전의 런타임 값도 확인한다.

function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

describe('UI 문구 사전 (ADR-013/028)', () => {
  it('한국어·영어·일본어 사전의 모든 문구가 비어 있지 않다', () => {
    for (const dict of [STRINGS.ko, STRINGS.en, STRINGS.ja]) {
      for (const text of leaves(dict)) expect(text.trim()).not.toBe('');
    }
  });

  // 계산되지 않아도 적용할 수 있다는 것이 이 문구의 요점이라, 세 언어 모두
  // 「샘플 값으로 계산되지 않는다」와 「그래도 적용할 수 있다」를 함께 담아야 합니다.
  it('샘플 값 미리 계산 안내는 세 언어 모두 계산되지 않는 까닭과 적용 가능함을 알린다', () => {
    const cases = [
      { text: STRINGS.ko.designer.previewUnavailable, sample: '샘플 값', apply: '적용할 수 있습니다' },
      { text: STRINGS.en.designer.previewUnavailable, sample: 'sample values', apply: 'apply' },
      { text: STRINGS.ja.designer.previewUnavailable, sample: 'サンプル値', apply: '適用できます' },
    ];
    for (const { text, sample, apply } of cases) {
      expect(text).toContain(sample);
      expect(text).toContain(apply);
    }
  });

  it('getStrings는 언어 코드로 사전을 선택하고 지원하지 않는 로케일에는 영어를 사용한다', () => {
    expect(getStrings('en')).toBe(STRINGS.en);
    expect(getStrings('en-US')).toBe(STRINGS.en);
    expect(getStrings('ja')).toBe(STRINGS.ja);
    expect(getStrings('ja-JP')).toBe(STRINGS.ja);
    expect(getStrings('ko-KR')).toBe(STRINGS.ko);
    expect(getStrings('fr')).toBe(STRINGS.en);
    expect(getStrings(undefined)).toBe(STRINGS.en);
  });
});
