// 선택 속성 쓰기·지우기 — 화면 없이 직접 확인한다.
import { describe, expect, it } from 'vitest';
import { setOptional, clearValueSources } from '../../src/designer/patch.js';

describe('setOptional', () => {
  it('값을 주면 그 키에 넣는다', () => {
    const target: Record<string, unknown> = {};
    setOptional(target, 'fontSize', 12);
    expect(target).toEqual({ fontSize: 12 });
  });

  it('null이나 undefined면 키 자체를 지운다', () => {
    const target: Record<string, unknown> = { fontSize: 12, bold: true };
    setOptional(target, 'fontSize', null);
    setOptional(target, 'bold', undefined);
    expect('fontSize' in target).toBe(false);
    expect('bold' in target).toBe(false);
  });

  it('빈 문자열과 0은 지우지 않고 그대로 넣는다', () => {
    const target: Record<string, unknown> = {};
    setOptional(target, 'content', '');
    setOptional(target, 'characterSpacing', 0);
    expect(target).toEqual({ content: '', characterSpacing: 0 });
  });

  it('false도 값으로 넣는다', () => {
    const target: Record<string, unknown> = {};
    setOptional(target, 'bold', false);
    expect(target).toEqual({ bold: false });
  });
});

describe('clearValueSources', () => {
  it('값 소스 세 가지를 모두 지우고 다른 키는 남긴다', () => {
    const cell = { row: 0, column: 0, content: '글', parameter: 'p', formula: 'f', bold: true };
    clearValueSources(cell);
    expect(cell).toEqual({ row: 0, column: 0, bold: true });
  });

  it('없는 키를 지워도 문제가 없다', () => {
    const cell: { content?: string } = {};
    clearValueSources(cell);
    expect(cell).toEqual({});
  });
});
