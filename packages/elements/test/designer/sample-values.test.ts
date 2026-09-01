// 샘플 값 입력 변환 — 화면 없이 직접 확인합니다.
import { describe, expect, it } from 'vitest';
import {
  parseSampleScalar,
  sampleScalarText,
  formulaPreviewText,
} from '../../src/designer/render/sample-values.js';

describe('parseSampleScalar', () => {
  it('숫자로 보이는 입력만 숫자로 읽는다', () => {
    expect(parseSampleScalar('42')).toBe(42);
    expect(parseSampleScalar('-3.5')).toBe(-3.5);
    expect(parseSampleScalar(' 7 ')).toBe(7);
  });

  it('숫자가 아니면 입력한 글을 그대로 둔다', () => {
    expect(parseSampleScalar('42개')).toBe('42개');
    expect(parseSampleScalar('1,000')).toBe('1,000');
    expect(parseSampleScalar('')).toBe('');
    expect(parseSampleScalar('  ')).toBe('  ');
  });
});

describe('sampleScalarText', () => {
  it('논리값은 TRUE·FALSE로 보여 준다', () => {
    expect(sampleScalarText(true)).toBe('TRUE');
    expect(sampleScalarText(false)).toBe('FALSE');
  });

  it('빈 값과 객체는 빈 글로 둔다', () => {
    expect(sampleScalarText(null)).toBe('');
    expect(sampleScalarText(undefined)).toBe('');
    expect(sampleScalarText({ a: 1 })).toBe('');
    expect(sampleScalarText([1, 2])).toBe('');
  });

  it('숫자와 글은 그대로 보여 준다', () => {
    expect(sampleScalarText(42)).toBe('42');
    expect(sampleScalarText('사과')).toBe('사과');
  });
});

describe('formulaPreviewText', () => {
  it('계산 결과를 사람이 읽을 글로 바꾼다', () => {
    expect(formulaPreviewText(1200)).toBe('1200');
    expect(formulaPreviewText('합계')).toBe('합계');
    expect(formulaPreviewText(true)).toBe('TRUE');
    expect(formulaPreviewText(null)).toBe('');
  });
});
