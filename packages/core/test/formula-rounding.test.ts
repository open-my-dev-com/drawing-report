import { afterEach, describe, expect, it } from 'vitest';
import { FormulaEvalError, evaluateFormula, type FormulaContext } from '../src/index.js';

const ctx = (values: FormulaContext['values'] = {}): FormulaContext => ({ values });

describe('ROUND — 정확한 절반은 0에서 멀어지는 쪽으로', () => {
  it.each([
    ['ROUND(2.5)', 3],
    ['ROUND(-2.5)', -3],
    ['ROUND(0.5)', 1],
    ['ROUND(-0.5)', -1],
    ['ROUND(1.005, 2)', 1.01],
    ['ROUND(-1.005, 2)', -1.01],
    ['ROUND(2.675, 2)', 2.68],
    ['ROUND(1.45, 1)', 1.5],
    ['ROUND(-1.45, 1)', -1.5],
    ['ROUND(15, -1)', 20],
    ['ROUND(-15, -1)', -20],
    ['ROUND(0.4)', 0],
    ['ROUND(-0.4)', 0],
    ['ROUND(70, -3)', 0],
  ])('%s = %s', (formula, expected) => {
    expect(evaluateFormula(formula, ctx())).toBe(expected);
  });

  it('100억 이상에서도 소수 2자리를 정확하게 반올림한다', () => {
    expect(evaluateFormula('ROUND(12345678901.23, 2)', ctx())).toBe(12345678901.23);
    expect(evaluateFormula('ROUND(12345678901.235, 2)', ctx())).toBe(12345678901.24);
    expect(evaluateFormula('ROUND(1234567890123.456, 2)', ctx())).toBe(1234567890123.46);
    expect(evaluateFormula('ROUND(1e12 + 0.5)', ctx())).toBe(1000000000001);
  });

  it('매우 작은 수와 지수 표기 수도 자릿수대로 처리한다', () => {
    expect(evaluateFormula('ROUND(0.000001234, 8)', ctx())).toBe(0.00000123);
    expect(evaluateFormula('ROUND(0.0000005, 6)', ctx())).toBe(0.000001);
    expect(evaluateFormula('ROUND(1e-7, 7)', ctx())).toBe(1e-7);
    expect(evaluateFormula('ROUND(1e21, -20)', ctx())).toBe(1e21);
    expect(evaluateFormula('ROUND(1e21 + 1, 2)', ctx())).toBe(1e21);
  });

  it('0과 자릿수 없는 정수는 그대로다', () => {
    expect(evaluateFormula('ROUND(0, 3)', ctx())).toBe(0);
    expect(evaluateFormula('ROUND(1234, 5)', ctx())).toBe(1234);
    expect(Object.is(evaluateFormula('ROUND(-0.1)', ctx()), 0)).toBe(true);
  });
});

describe('FLOOR·CEIL — 수학적 방향', () => {
  it.each([
    ['FLOOR(2.5)', 2],
    ['FLOOR(-2.5)', -3],
    ['CEIL(2.5)', 3],
    ['CEIL(-2.5)', -2],
    ['FLOOR(1.005, 2)', 1],
    ['CEIL(1.005, 2)', 1.01],
    ['FLOOR(-1.005, 2)', -1.01],
    ['CEIL(-1.005, 2)', -1],
    ['FLOOR(12345678901.99, 2)', 12345678901.99],
    ['CEIL(12345678901.001, 2)', 12345678901.01],
    ['FLOOR(-15, -1)', -20],
    ['CEIL(-15, -1)', -10],
    ['FLOOR(70, -3)', 0],
    ['CEIL(70, -3)', 1000],
    ['FLOOR(-70, -3)', -1000],
    ['CEIL(-70, -3)', 0],
    ['FLOOR(1.1, 1)', 1.1],
    ['CEIL(1.1, 1)', 1.1],
  ])('%s = %s', (formula, expected) => {
    expect(evaluateFormula(formula, ctx())).toBe(expected);
  });

  it('FLOOR 결과는 입력보다 커지지 않고 CEIL 결과는 작아지지 않는다', () => {
    const samples = [
      0.1, 0.7, 1.005, 2.675, 1234.5678, 12345678901.23, 0.000001234, 1e12 + 0.3, 99.995, 5.5,
    ];
    for (const sample of samples) {
      for (const sign of [1, -1]) {
        const n = sample * sign;
        for (let digits = -3; digits <= 6; digits++) {
          const floor = evaluateFormula(`FLOOR(${n}, ${digits})`, ctx()) as number;
          const ceil = evaluateFormula(`CEIL(${n}, ${digits})`, ctx()) as number;
          expect(floor, `FLOOR(${n}, ${digits})`).toBeLessThanOrEqual(n);
          expect(ceil, `CEIL(${n}, ${digits})`).toBeGreaterThanOrEqual(n);
        }
      }
    }
  });
});

describe('자릿수 인자 검증', () => {
  it('자릿수 경계 -20과 20은 허용한다', () => {
    expect(evaluateFormula('ROUND(1.5, 20)', ctx())).toBe(1.5);
    expect(evaluateFormula('ROUND(5e19, -20)', ctx())).toBe(1e20);
    expect(evaluateFormula('ROUND(4e19, -20)', ctx())).toBe(0);
    expect(evaluateFormula('ROUND(5e20, -20)', ctx())).toBe(5e20);
    expect(evaluateFormula('FLOOR(1.5, 20)', ctx())).toBe(1.5);
    expect(evaluateFormula('CEIL(1.5, -20)', ctx())).toBe(1e20);
  });

  it('자릿수가 범위를 벗어나면 FormulaEvalError를 던진다', () => {
    expect(() => evaluateFormula('ROUND(1.5, 21)', ctx())).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('ROUND(1.5, 21)', ctx())).toThrow('between -20 and 20');
    expect(() => evaluateFormula('FLOOR(1.5, -21)', ctx())).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('CEIL(1.5, 100)', ctx())).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('ROUND(1.5, 1.5)', ctx())).toThrow(/integer/);
  });

  it('자릿수 범위 오류 메시지는 로케일을 따른다', () => {
    expect(() => evaluateFormula('ROUND(1.5, 21)', { values: {}, locale: 'ko-KR' })).toThrow(
      '자릿수는 -20~20이어야 합니다',
    );
    expect(() => evaluateFormula('ROUND(1.5, 21)', { values: {}, locale: 'ja' })).toThrow(
      '桁数は -20~20 でなければなりません',
    );
  });
});

describe('MIN·MAX 대량 집계', () => {
  it('20만 개 범위를 호출 스택 없이 집계한다', () => {
    const count = 200_000;
    const items = Array.from({ length: count }, (_, i) => ({ v: (i * 7919) % count }));
    const c = ctx({ items });
    expect(evaluateFormula('MIN($(items).$(v))', c)).toBe(0);
    expect(evaluateFormula('MAX($(items).$(v))', c)).toBe(count - 1);
    expect(evaluateFormula('SUM($(items).$(v))', c)).toBe((count * (count - 1)) / 2);
    expect(evaluateFormula('COUNT($(items).$(v))', c)).toBe(count);
  });

  it('빈 범위의 MIN·MAX는 0이다', () => {
    expect(evaluateFormula('MIN($(items).$(v))', ctx({ items: [] }))).toBe(0);
    expect(evaluateFormula('MAX($(items).$(v))', ctx({ items: [] }))).toBe(0);
  });
});

describe('시간대 없는 날짜·시간은 UTC로 해석한다', () => {
  const originalTz = process.env['TZ'];
  afterEach(() => {
    if (originalTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalTz;
  });

  it.each(['UTC', 'Asia/Seoul', 'America/Los_Angeles'])('TZ=%s에서도 같은 결과', (tz) => {
    process.env['TZ'] = tz;
    expect(evaluateFormula('FORMAT_DATE("2026-01-01T00:30", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-01-01 00:30');
    expect(evaluateFormula('FORMAT_DATE("2026-01-01T23:59:59.5", "YYYY-MM-DD HH:mm:ss")', ctx())).toBe(
      '2026-01-01 23:59:59',
    );
    expect(evaluateFormula('TO_DATE("2026-01-01T00:30")', ctx())).toBe('2026-01-01');
    expect(evaluateFormula('TO_DATE("2026-01-01")', ctx())).toBe('2026-01-01');
    expect(evaluateFormula('DATE_DIFF("2026-01-01T00:30", "2026-01-02T00:29")', ctx())).toBe(0);
    expect(evaluateFormula('DATE_ADD("2026-01-31T12:00", 1, "months")', ctx())).toBe('2026-02-28');
  });

  it('시간대가 붙은 값은 그 시간대대로 해석한다', () => {
    process.env['TZ'] = 'Asia/Seoul';
    expect(evaluateFormula('FORMAT_DATE("2026-01-01T00:30+09:00", "YYYY-MM-DD HH:mm")', ctx())).toBe(
      '2025-12-31 15:30',
    );
  });

  it('존재하지 않는 시각은 거부한다', () => {
    expect(() => evaluateFormula('TO_DATE("2026-01-01T24:00")', ctx())).toThrow(/not a real/);
    expect(() => evaluateFormula('TO_DATE("2026-02-30T10:00")', ctx())).toThrow(/not a real/);
  });
});
