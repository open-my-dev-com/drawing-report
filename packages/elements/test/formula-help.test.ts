import { describe, expect, it } from 'vitest';
import { FORMULA_FUNCTIONS } from '@omdc-slipkit/core';
import { getFormulaHelp } from '../src/formula-help.js';

describe('수식 함수 도움말 (D-12)', () => {
  it.each(['ko', 'en', 'ja'] as const)(
    '%s 도움말이 core 함수 목록(32종, ADR-017·044)과 빠짐없이 일치한다',
    (locale) => {
      const names = getFormulaHelp(locale).flatMap((category) =>
        category.functions.map((fn) => fn.name),
      );
      expect([...names].sort()).toEqual([...FORMULA_FUNCTIONS].sort());
      expect(new Set(names).size).toBe(names.length);
    },
  );

  it('모든 항목이 사용법·설명을 갖고, 사용법은 함수 이름으로 시작한다', () => {
    for (const locale of ['ko', 'en', 'ja'] as const) {
      for (const category of getFormulaHelp(locale)) {
        expect(category.title.length).toBeGreaterThan(0);
        for (const fn of category.functions) {
          expect(fn.signature.startsWith(fn.name)).toBe(true);
          expect(fn.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('모르는 로케일은 한국어로 돌아간다', () => {
    expect(getFormulaHelp('fr')).toEqual(getFormulaHelp('ko'));
    expect(getFormulaHelp('en-US')).toEqual(getFormulaHelp('en'));
    expect(getFormulaHelp('ja-JP')).toEqual(getFormulaHelp('ja'));
  });
});
