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

  // 계산에 실패해도 적용할 수 있다는 것과 경고가 남는다는 것을 세 언어 모두 알려야 합니다.
  it('계산 실패 안내는 세 언어 모두 적용 가능함과 남는 경고를 알린다', () => {
    for (const dict of [STRINGS.ko, STRINGS.en, STRINGS.ja]) {
      expect(dict.designer.formulaStatusWarning.trim()).not.toBe('');
      expect(dict.designer.formulaCannotCalculate.trim()).not.toBe('');
      expect(dict.designer.formulaWarningHint.trim()).not.toBe('');
      expect(dict.designer.formulaWarningItem.trim()).not.toBe('');
    }
    expect(STRINGS.ko.designer.formulaStatusWarning).toBe('현재 값으로 계산할 수 없음');
    expect(STRINGS.ko.designer.formulaWarningHint)
      .toBe('수식을 적용할 수 있지만, 계산할 수 없는 동안 요소에 경고가 표시됩니다.');
    expect(STRINGS.en.designer.formulaStatusWarning).toBe('Cannot calculate with the current values');
    expect(STRINGS.en.designer.formulaWarningHint)
      .toBe('You can apply the formula. A warning remains on the element until it can be calculated.');
    expect(STRINGS.ja.designer.formulaStatusWarning).toBe('現在の値では計算できません');
    expect(STRINGS.ja.designer.formulaWarningHint)
      .toBe('数式は適用できますが、計算できるようになるまで要素に警告が表示されます。');
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
