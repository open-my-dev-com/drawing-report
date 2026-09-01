// 현재 평가 실패를 데이터 의존과 수식 구성으로 분류하는지 확인한다.
import { describe, expect, it } from 'vitest';
import {
  diagnoseFormula,
  evaluateFormula,
  FormulaEvalError,
  type FormulaContext,
} from '../src/index.js';

const CONTEXT: FormulaContext = {
  values: { amount: 1200, quantity: 0, name: '연필', items: [{ amount: 100 }] },
  locale: 'ko',
};

/** 수식을 평가해 던져진 평가 오류를 돌려준다. */
function evalError(source: string, context: FormulaContext = CONTEXT): FormulaEvalError {
  try {
    evaluateFormula(source, context);
  } catch (error) {
    if (error instanceof FormulaEvalError) return error;
    throw error;
  }
  throw new Error(`평가에 실패하지 않았습니다: ${source}`);
}

describe('FormulaEvalError — 현재 평가 실패의 분류', () => {
  it('예약 범위를 쓸 수 없는 실패는 데이터 의존으로 분류한다', () => {
    const error = evalError('SUM(@page.amount)');
    expect(error.reason).toBe('data');
    expect(error.dataDependent).toBe(true);
  });

  it('평균 낼 값이 하나도 없는 실패도 데이터 의존으로 분류한다', () => {
    const error = evalError('AVG(items.amount)', { values: { items: [] }, locale: 'ko' });
    expect(error.reason).toBe('data');
    expect(error.dataDependent).toBe(true);
  });

  it('오류를 일으킨 값이 상수면 데이터 의존으로 분류하지 않는다', () => {
    for (const source of [
      '1 / 0',
      'amount / 0',
      'FORMAT_NUMBER(1, 21)',
      'FORMAT_NUMBER(amount, 21)',
      'MID("abc", 0, 1)',
      'MID(name, 0, 1)',
      'DATE_ADD("not-a-date", 1)',
    ]) {
      const error = evalError(source);
      expect(error.reason, source).toBe('value');
      expect(error.dataDependent, source).toBe(false);
    }
  });

  it('오류를 일으킨 값이 데이터에서 왔으면 데이터 의존으로 분류한다', () => {
    // 지금 값에서만 나누는 값이 0입니다.
    const error = evalError('amount / quantity');
    expect(error.reason).toBe('value');
    expect(error.dataDependent).toBe(true);
  });

  it('참조를 푸는 중 난 오류는 데이터 의존으로 분류한다', () => {
    const error = evalError('name.first', { values: { name: '연필' }, locale: 'ko' });
    expect(error.dataDependent).toBe(true);
  });

  it('인자 수가 틀린 수식은 수식 구성 오류로 분류한다', () => {
    const error = evalError('IF(TRUE)');
    expect(error.reason).toBe('formula');
    expect(error.dataDependent).toBe(false);
  });

  it('오류를 일으킨 가장 안쪽 자리의 값으로 분류한다', () => {
    // 바깥 나눗셈은 두 쪽 모두 데이터에서 왔지만 오류는 안쪽 상수 나눗셈에서 났습니다.
    const error = evalError('amount / (amount / 0)');
    expect(error.dataDependent).toBe(false);
  });
});

describe('diagnoseFormula — 현재 평가에서 발견한 오류 분류', () => {
  it('계산에 성공하면 결과만 돌려준다', () => {
    const found = diagnoseFormula('amount + 1', CONTEXT);
    expect(found.value).toBe(1201);
    expect(found.formulaError).toBeUndefined();
    expect(found.dataError).toBeUndefined();
  });

  it('값이 없어 실패하면 데이터 오류로만 분류한다', () => {
    const found = diagnoseFormula('SUM(@page.amount)', CONTEXT);
    expect(found.dataError).toBeInstanceOf(FormulaEvalError);
    expect(found.formulaError).toBeUndefined();
  });

  it('데이터 오류 뒤의 평가 오류도 함께 수집한다', () => {
    // `@page`가 없어 평가는 거기서 멈추지만, 빈 값으로 이어 계산하면 0 나눗셈이 드러난다.
    const found = diagnoseFormula('SUM(@page.amount) / 0', CONTEXT);
    expect(found.formulaError).toBeInstanceOf(FormulaEvalError);
    expect(found.dataError).toBeInstanceOf(FormulaEvalError);
  });

  it('상수 인자가 허용 범위를 벗어난 실패는 수식 구성 오류로 분류한다', () => {
    for (const source of ['FORMAT_NUMBER(amount, 21)', 'MID(name, 0, 1)', 'DATE_ADD("not-a-date", 1)']) {
      expect(diagnoseFormula(source, CONTEXT).formulaError, source).toBeInstanceOf(FormulaEvalError);
    }
  });

  it('오류를 일으킨 값이 데이터에서 왔으면 데이터 오류로 분류한다', () => {
    const found = diagnoseFormula('amount / quantity', CONTEXT);
    expect(found.formulaError).toBeUndefined();
    expect(found.dataError).toBeInstanceOf(FormulaEvalError);
  });

  it('실행되지 않은 분기의 오류는 수집하지 않는다', () => {
    const found = diagnoseFormula('IF(TRUE, 1, 1 / 0)', CONTEXT);
    expect(found.value).toBe(1);
    expect(found.formulaError).toBeUndefined();
    expect(found.dataError).toBeUndefined();
  });

  it('진단이 끝나면 평가는 다시 첫 오류에서 멈춘다', () => {
    diagnoseFormula('SUM(@page.amount)', CONTEXT);
    expect(() => evaluateFormula('SUM(@page.amount)', CONTEXT)).toThrow(FormulaEvalError);
  });
});

describe('값 종류가 맞지 않는 현재 값', () => {
  const WRONG: FormulaContext = {
    values: { amount: 'not-a-number', date: 'not-a-date', flag: 'not-a-boolean', name: '연필' },
    locale: 'ko',
  };

  it('상수가 섞여 있어도 오류를 일으킨 값이 데이터면 데이터 오류로 분류한다', () => {
    for (const source of [
      'amount + 1',
      'ROUND(amount, 2)',
      'FORMAT_NUMBER(amount, 2)',
      'DATE_ADD(date, 1)',
      'IF(flag, 1, 2)',
    ]) {
      const found = diagnoseFormula(source, WRONG);
      expect(found.formulaError, source).toBeUndefined();
      expect(found.dataError, source).toBeInstanceOf(FormulaEvalError);
    }
  });

  it('데이터 오류 뒤에 남은 상수 인자 오류도 함께 수집한다', () => {
    // `amount`가 숫자가 아니어서 먼저 실패하지만, 빈 값으로 이어 계산하면 소수 자릿수 21이 드러난다.
    const found = diagnoseFormula('FORMAT_NUMBER(amount, 21)', WRONG);
    expect(found.dataError).toBeInstanceOf(FormulaEvalError);
    expect(found.formulaError).toBeInstanceOf(FormulaEvalError);
  });

  it('상수 인자 오류는 값이 멀쩡해도 수식 구성 오류로 분류한다', () => {
    for (const source of ['amount / 0', 'FORMAT_NUMBER(amount, 21)', 'MID(name, 0, 1)']) {
      const found = diagnoseFormula(source, CONTEXT);
      expect(found.formulaError, source).toBeInstanceOf(FormulaEvalError);
    }
  });
});

describe('단락 평가로 건너뛴 분기', () => {
  const VALUES: FormulaContext = { values: { amount: 10 }, locale: 'ko' };

  it('실행되지 않은 분기의 참조는 고른 값의 출처로 세지 않는다', () => {
    for (const source of [
      'IF(TRUE, "not-a-number", amount) + 1',
      'ROUND(IF(TRUE, "not-a-number", amount), 2)',
      '1 / IF(TRUE, 0, amount)',
      'IF(FALSE, amount, "not-a-number") + 1',
    ]) {
      const found = diagnoseFormula(source, VALUES);
      expect(found.formulaError, source).toBeInstanceOf(FormulaEvalError);
      expect(found.dataError, source).toBeUndefined();
    }
  });

  it('실제로 고른 분기가 데이터면 데이터 오류로 분류한다', () => {
    const found = diagnoseFormula('IF(TRUE, amount, 1) + 1', {
      values: { amount: 'not-a-number' }, locale: 'ko',
    });
    expect(found.dataError).toBeInstanceOf(FormulaEvalError);
    expect(found.formulaError).toBeUndefined();
  });

  it('AND·OR도 건너뛴 인수의 출처를 결과에 세지 않는다', () => {
    // 첫 인수에서 참이 확정되므로 `amount` 인수는 평가되지 않습니다.
    const found = diagnoseFormula('IF(OR(TRUE, amount > 0), "not-a-number", 0) + 1', VALUES);
    expect(found.formulaError).toBeInstanceOf(FormulaEvalError);
    expect(found.dataError).toBeUndefined();
  });
});
