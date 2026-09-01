// 함수 인자 수 규칙 — 값 없이도 확인할 수 있는 검사
import { describe, expect, it } from 'vitest';
import {
  FORMULA_ARITY,
  FORMULA_FUNCTIONS,
  FormulaEvalError,
  assertFormulaArity,
  evaluateFormula,
  parseFormula,
} from '../src/index.js';

describe('FORMULA_ARITY', () => {
  it('모든 함수의 허용 인자 수를 정의한다', () => {
    expect(Object.keys(FORMULA_ARITY).sort()).toEqual([...FORMULA_FUNCTIONS].sort());
    for (const [name, arity] of Object.entries(FORMULA_ARITY)) {
      expect(arity.min, name).toBeGreaterThanOrEqual(0);
      if (arity.max !== undefined) expect(arity.max, name).toBeGreaterThanOrEqual(arity.min);
    }
  });
});

describe('assertFormulaArity', () => {
  const check = (source: string): void => assertFormulaArity(parseFormula(source));

  it('인자 수가 맞으면 통과한다', () => {
    for (const source of ['SUM()', 'SUM(1, 2, 3)', 'IF(TRUE, 1)', 'IF(TRUE, 1, 2)', 'TODAY()']) {
      expect(() => check(source), source).not.toThrow();
    }
  });

  it('인자 수가 틀리면 값 없이도 잡아낸다', () => {
    for (const source of ['IF(TRUE)', 'ROUND()', 'MID("가", 1)', 'TODAY(1)', 'AND()']) {
      expect(() => check(source), source).toThrow(FormulaEvalError);
    }
  });

  it('중첩된 함수의 인자 수도 검사한다', () => {
    expect(() => check('SUM(1, ROUND())')).toThrow(FormulaEvalError);
    expect(() => check('-ABS()')).toThrow(FormulaEvalError);
    expect(() => check('1 + TRIM()')).toThrow(FormulaEvalError);
  });

  it('평가기와 같은 판정을 내린다', () => {
    for (const source of ['IF(TRUE)', 'ROUND()', 'AND()', 'VAT()']) {
      expect(() => check(source), source).toThrow();
      expect(() => evaluateFormula(source, { values: {} }), source).toThrow();
    }
  });

  it('로케일에 맞는 오류 문구를 낸다', () => {
    expect(() => assertFormulaArity(parseFormula('IF(TRUE)'), { locale: 'ko' }))
      .toThrow(/IF 함수의 인자는 2~3개여야 합니다/);
    expect(() => assertFormulaArity(parseFormula('AND()'), { locale: 'ko' }))
      .toThrow(/AND 함수의 인자는 1개 이상이어야 합니다/);
  });
});
