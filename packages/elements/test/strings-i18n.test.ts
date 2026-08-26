import { describe, expect, it } from 'vitest';
import { STRINGS, getStrings, strings } from '../src/strings.js';

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

  it('getStrings는 언어만 보고 사전을 고르고, 모르는 로케일은 한국어로 돌아간다', () => {
    expect(getStrings('en')).toBe(STRINGS.en);
    expect(getStrings('en-US')).toBe(STRINGS.en);
    expect(getStrings('ja')).toBe(STRINGS.ja);
    expect(getStrings('ja-JP')).toBe(STRINGS.ja);
    expect(getStrings('ko-KR')).toBe(STRINGS.ko);
    expect(getStrings('fr')).toBe(STRINGS.ko);
    expect(getStrings(undefined)).toBe(STRINGS.ko);
    expect(strings).toBe(STRINGS.ko);
  });
});
