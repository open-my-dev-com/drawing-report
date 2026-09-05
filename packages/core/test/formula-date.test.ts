// FORMAT_DATE 패턴 문법과 날짜 함수 입력 형식을 확인한다.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormulaEvalError, evaluateFormula, type FormulaContext, type FormulaValue } from '../src/index.js';

const ctx = (values: FormulaContext['values'] = {}, locale?: string): FormulaContext =>
  locale === undefined ? { values } : { values, locale };

/** 수식을 평가해 던져진 평가 오류를 돌려준다. */
function evalError(source: string, context: FormulaContext = ctx()): FormulaEvalError {
  try {
    evaluateFormula(source, context);
  } catch (error) {
    if (error instanceof FormulaEvalError) return error;
    throw error;
  }
  throw new Error(`평가에 실패하지 않았습니다: ${source}`);
}

describe('FORMAT_DATE 패턴 — 리터럴 블록', () => {
  it('[...] 안은 토큰으로 해석하지 않는다', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "[Date:] YYYY-MM-DD")', ctx())).toBe('Date: 2026-09-04');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "[Day D of Month M]")', ctx())).toBe('Day D of Month M');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "YYYY[년] M[월] D[일]")', ctx())).toBe('2026년 9월 4일');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T13:05:09", "[Time] HH:mm:ss [UTC]")', ctx())).toBe(
      'Time 13:05:09 UTC',
    );
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "[]YYYY[]")', ctx())).toBe('2026');
  });

  it('블록 안에서 \\]는 ]로, \\\\는 백슬래시로 출력한다', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "[a\\]b] YYYY")', ctx())).toBe('a]b 2026');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "[a\\\\b] YYYY")', ctx())).toBe('a\\b 2026');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "[\\\\\\]]")', ctx())).toBe('\\]');
  });

  it('블록 밖의 ]는 리터럴이다', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "YYYY]")', ctx())).toBe('2026]');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "]M]")', ctx())).toBe(']9]');
  });

  it('닫히지 않은 [는 위치와 함께 오류다', () => {
    expect(() => evaluateFormula('FORMAT_DATE("2026-09-04", "[Date: YYYY")', ctx())).toThrow(
      /FORMAT_DATE pattern has an unclosed '\[' at character 1/,
    );
    expect(() => evaluateFormula('FORMAT_DATE("2026-09-04", "YYYY [")', ctx())).toThrow(/at character 6/);
  });

  it('허용되지 않는 백슬래시는 위치와 함께 오류다', () => {
    expect(() => evaluateFormula('FORMAT_DATE("2026-09-04", "[a\\x]")', ctx())).toThrow(
      /FORMAT_DATE pattern has an invalid backslash at character 3/,
    );
    expect(() => evaluateFormula('FORMAT_DATE("2026-09-04", "[a\\")', ctx())).toThrow(/invalid backslash at character 3/);
    expect(() => evaluateFormula('FORMAT_DATE("2026-09-04", "YYYY\\D")', ctx())).toThrow(
      /invalid backslash at character 5/,
    );
  });
});

describe('FORMAT_DATE 패턴 — 토큰', () => {
  const d = '"2026-09-04T05:06:07"';

  it('토큰 9종과 구분자 없는 연속', () => {
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYY YY MM M DD D HH mm ss")`, ctx())).toBe('2026 26 09 9 04 4 05 06 07');
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYYMMDD")`, ctx())).toBe('20260904');
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYYMMDDHHmmss")`, ctx())).toBe('20260904050607');
    expect(evaluateFormula(`FORMAT_DATE(${d}, "M/D")`, ctx())).toBe('9/4');
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYY/MM/DD HH:mm:ss")`, ctx())).toBe('2026/09/04 05:06:07');
  });

  it('블록 밖의 한글·한자·기호·공백은 리터럴이다', () => {
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYY년 M월 D일")`, ctx())).toBe('2026년 9월 4일');
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYY年M月D日")`, ctx())).toBe('2026年9月4日');
    expect(evaluateFormula(`FORMAT_DATE(${d}, "YYYY.MM.DD. (HH시 mm분)")`, ctx())).toBe('2026.09.04. (05시 06분)');
  });

  it.each([
    ['YYYYY', 'YYYYY', 1],
    ['MMM', 'MMM', 1],
    ['DDD', 'DDD', 1],
    ['HHH', 'HHH', 1],
    ['hh', 'hh', 1],
    ['Q', 'Q', 1],
    ['A', 'A', 1],
    ['SS', 'SS', 1],
    ['yyyy', 'yyyy', 1],
    ['Date: YYYY', 'Date', 1],
    ['YYYY-MMM', 'MMM', 6],
    ['YYYY년 M월 D일 HHH시', 'HHH', 13],
  ])('%s → 알 수 없는 토큰 "%s" (위치 %i)', (pattern, run, position) => {
    const error = evalError(`FORMAT_DATE(${d}, "${pattern}")`);
    expect(error.message).toBe(
      `The FORMAT_DATE pattern has an unknown token "${run}" at character ${position} (allowed: YYYY, YY, MM, M, DD, D, HH, mm, ss; wrap literal text in [ ])`,
    );
  });

  it('빈 패턴은 빈 문자열, 생략하면 YYYY-MM-DD', () => {
    expect(evaluateFormula(`FORMAT_DATE(${d}, "")`, ctx())).toBe('');
    expect(evaluateFormula(`FORMAT_DATE(${d})`, ctx())).toBe('2026-09-04');
  });

  it('문자열이 아닌 패턴은 문자열로 바꾼 뒤 같은 문법을 적용한다', () => {
    expect(evaluateFormula(`FORMAT_DATE(${d}, 20260904)`, ctx())).toBe('20260904');
    expect(evaluateFormula(`FORMAT_DATE(${d}, $(a))`, ctx({ a: null }))).toBe('');
    expect(() => evaluateFormula(`FORMAT_DATE(${d}, TRUE)`, ctx())).toThrow(/unknown token "TRUE"/);
  });

  it('패턴 오류는 한국어·일본어 메시지도 제공한다', () => {
    expect(evalError(`FORMAT_DATE(${d}, "Date")`, ctx({}, 'ko')).message).toBe(
      'FORMAT_DATE 패턴: 1번째 글자에 알 수 없는 토큰이 있습니다: "Date" (사용 가능: YYYY, YY, MM, M, DD, D, HH, mm, ss. 그대로 표시할 글자는 [ ]로 감싸세요)',
    );
    expect(evalError(`FORMAT_DATE(${d}, "[x")`, ctx({}, 'ko')).message).toBe("FORMAT_DATE 패턴: 1번째 글자의 '['가 닫히지 않았습니다");
    expect(evalError(`FORMAT_DATE(${d}, "[\\x]")`, ctx({}, 'ko')).message).toBe(
      'FORMAT_DATE 패턴: 2번째 글자의 백슬래시를 해석할 수 없습니다 ([ ] 안에서 \\]와 \\\\만 쓸 수 있습니다)',
    );
    expect(evalError(`FORMAT_DATE(${d}, "Date")`, ctx({}, 'ja')).message).toBe(
      'FORMAT_DATE のパターン: 1 文字目に不明なトークンがあります: "Date"（使用可能: YYYY, YY, MM, M, DD, D, HH, mm, ss。そのまま表示する文字は [ ] で囲んでください）',
    );
    expect(evalError(`FORMAT_DATE(${d}, "[x")`, ctx({}, 'ja')).message).toBe(
      "FORMAT_DATE のパターン: 1 文字目の '[' が閉じられていません",
    );
    expect(evalError(`FORMAT_DATE(${d}, "[\\x]")`, ctx({}, 'ja')).message).toBe(
      'FORMAT_DATE のパターン: 2 文字目のバックスラッシュを解釈できません（[ ] の中では \\] と \\\\ のみ使えます）',
    );
  });
});

describe('날짜 입력 — 허용 형식', () => {
  it('YYYY-MM-DD와 T로 잇는 시각(초·소수 초는 선택)', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-09-04", "YYYY-MM-DD HH:mm:ss")', ctx())).toBe('2026-09-04 00:00:00');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T09:30", "YYYY-MM-DD HH:mm:ss")', ctx())).toBe('2026-09-04 09:30:00');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T09:30:15", "HH:mm:ss")', ctx())).toBe('09:30:15');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T09:30:15.5", "HH:mm:ss")', ctx())).toBe('09:30:15');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T23:59:59.999999999", "YYYY-MM-DD HH:mm:ss")', ctx())).toBe(
      '2026-09-04 23:59:59',
    );
  });

  it('오프셋이 없으면 UTC, Z는 UTC 그대로', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T00:30", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-09-04 00:30');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T00:30Z", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-09-04 00:30');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T00:30:00.000Z", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-09-04 00:30');
  });

  it('±HH:mm 오프셋은 UTC 순간으로 옮겨 계산한다', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T00:30+09:00", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-09-03 15:30');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T22:00-05:30", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-09-05 03:30');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T00:30:45.25+00:00", "HH:mm:ss")', ctx())).toBe('00:30:45');
    expect(evaluateFormula('FORMAT_DATE("2026-09-04T23:59+23:59", "YYYY-MM-DD HH:mm")', ctx())).toBe('2026-09-04 00:00');
    expect(evaluateFormula('TO_DATE("2026-09-04T23:59+09:00")', ctx())).toBe('2026-09-04');
    expect(evaluateFormula('DATE_DIFF("2026-09-04T00:00+09:00", "2026-09-04T00:00Z", "days")', ctx())).toBe(0);
    expect(evaluateFormula('DATE_ADD("2026-09-04T00:30+09:00", 1)', ctx())).toBe('2026-09-04');
  });
});

describe('날짜 입력 — 거부', () => {
  const INVALID = /must be a string in the form YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss/;

  it.each([
    '"2026/9/4"',
    '"2026/09/04"',
    '"Sep 4, 2026"',
    '"2026-9-4"',
    '"20260904"',
    '"2026-09-04 00:30"',
    '"2026-09-04T00:30 +09:00"',
    '"2026-09-04T00:30+0900"',
    '"2026-09-04T0030"',
    '"2026-09-04T09"',
    '"2026-09-04Z"',
    '"2026-09-04+09:00"',
    '" 2026-09-04"',
    '"2026-09-04T09:30:15."',
    '"2026-09-04T09:30:15.1234567890"',
    '""',
    '1788800000000',
    '0',
    'TRUE',
    '$(NULL)',
  ])('%s은(는) 형식 오류', (source) => {
    for (const fn of ['FORMAT_DATE', 'TO_DATE']) {
      expect(() => evaluateFormula(`${fn}(${source})`, ctx()), fn).toThrow(INVALID);
    }
    expect(() => evaluateFormula(`DATE_ADD(${source}, 1)`, ctx())).toThrow(INVALID);
    expect(() => evaluateFormula(`DATE_DIFF(${source}, "2026-09-04")`, ctx())).toThrow(/start date must be a string/);
    expect(() => evaluateFormula(`DATE_DIFF("2026-09-04", ${source})`, ctx())).toThrow(/end date must be a string/);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-09-04T24:00', '2026-09-04T23:60', '2026-09-04T23:59:60', '2027-02-29'])(
    '%s은(는) 존재하지 않는 날짜·시각',
    (value) => {
      expect(() => evaluateFormula(`TO_DATE("${value}")`, ctx())).toThrow(/not a real calendar date/);
    },
  );

  it('허용 범위를 벗어난 오프셋은 별도 오류다', () => {
    for (const value of ['2026-09-04T00:30+24:00', '2026-09-04T00:30-24:00', '2026-09-04T00:30+09:60']) {
      expect(() => evaluateFormula(`TO_DATE("${value}")`, ctx()), value).toThrow(
        /time zone offset out of range \(up to ±23:59\)/,
      );
    }
    expect(evalError('TO_DATE("2026-09-04T00:30+24:00")', ctx({}, 'ko')).message).toBe(
      '날짜: 시간대 오프셋이 허용 범위(±23:59까지)를 벗어났습니다. 현재 값: "2026-09-04T00:30+24:00"',
    );
    expect(evalError('TO_DATE("2026-09-04T00:30+24:00")', ctx({}, 'ja')).message).toBe(
      '日付のタイムゾーンオフセットが範囲外です（±23:59 まで）: "2026-09-04T00:30+24:00"',
    );
  });

  it('형식 오류는 한국어·일본어 메시지도 제공한다', () => {
    expect(evalError('TO_DATE("2026/09/04")', ctx({}, 'ko')).message).toBe(
      '날짜: YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm:ss 형식(Z·±HH:mm 오프셋은 선택)의 문자열이어야 합니다. 현재 값: "2026/09/04"',
    );
    expect(evalError('TO_DATE("2026/09/04")', ctx({}, 'ja')).message).toBe(
      '日付は YYYY-MM-DD または YYYY-MM-DDTHH:mm:ss 形式（Z・±HH:mm オフセットは任意）の文字列でなければなりません: "2026/09/04"',
    );
  });
});

describe('입력 오류와 패턴 오류의 구분', () => {
  it('입력 오류는 값 오류이고 값의 출처를 따른다', () => {
    const literal = evalError('FORMAT_DATE("2026/09/04", "YYYY")');
    expect(literal.reason).toBe('value');
    expect(literal.dataDependent).toBe(false);
    const fromData = evalError('FORMAT_DATE($(d), "YYYY")', ctx({ d: '2026/09/04' }));
    expect(fromData.reason).toBe('value');
    expect(fromData.dataDependent).toBe(true);
  });

  it('수식에 직접 적은 패턴의 오류는 수식 구성 오류다', () => {
    const error = evalError('FORMAT_DATE("2026-09-04", "Date")');
    expect(error.reason).toBe('formula');
    expect(error.dataDependent).toBe(false);
    expect(error.message).toMatch(/FORMAT_DATE pattern/);
    expect(error.message).not.toMatch(/must be a string in the form/);
  });

  it('데이터에서 온 패턴의 오류는 데이터 의존 값 오류다', () => {
    const error = evalError('FORMAT_DATE("2026-09-04", $(p))', ctx({ p: '[Date' }));
    expect(error.reason).toBe('value');
    expect(error.dataDependent).toBe(true);
    expect(error.message).toMatch(/unclosed '\[' at character 1/);
  });

  it('패턴이 있어도 입력 오류가 먼저다', () => {
    expect(() => evaluateFormula('FORMAT_DATE("bad", "Date")', ctx())).toThrow(/must be a string in the form/);
  });
});

describe('0001~9999년', () => {
  it('두 자리 이하 연도를 1900년대로 바꾸지 않는다', () => {
    expect(evaluateFormula('FORMAT_DATE("0001-01-01")', ctx())).toBe('0001-01-01');
    expect(evaluateFormula('FORMAT_DATE("0001-01-01", "YYYY/YY")', ctx())).toBe('0001/01');
    expect(evaluateFormula('FORMAT_DATE("0099-12-31T23:59:59", "YYYY-MM-DD HH:mm:ss")', ctx())).toBe('0099-12-31 23:59:59');
    expect(evaluateFormula('FORMAT_DATE("0100-01-01")', ctx())).toBe('0100-01-01');
    expect(evaluateFormula('FORMAT_DATE("9999-12-31", "YYYY년 M월 D일")', ctx())).toBe('9999년 12월 31일');
    expect(evaluateFormula('TO_DATE("0001-01-01T00:00Z")', ctx())).toBe('0001-01-01');
    expect(() => evaluateFormula('TO_DATE("0001-02-29")', ctx())).toThrow(/not a real calendar date/);
    expect(evaluateFormula('TO_DATE("0004-02-29")', ctx())).toBe('0004-02-29');
  });

  it('DATE_ADD·DATE_DIFF도 같은 범위에서 동작한다', () => {
    expect(evaluateFormula('DATE_ADD("0001-01-31", 1, "months")', ctx())).toBe('0001-02-28');
    expect(evaluateFormula('DATE_ADD("0001-01-02", -1)', ctx())).toBe('0001-01-01');
    expect(evaluateFormula('DATE_ADD("0099-12-31", 1)', ctx())).toBe('0100-01-01');
    expect(evaluateFormula('DATE_ADD("0099-12-31", 1, "years")', ctx())).toBe('0100-12-31');
    expect(evaluateFormula('DATE_ADD("9999-12-31", -1, "years")', ctx())).toBe('9998-12-31');
    expect(evaluateFormula('DATE_ADD("9999-01-31", 1, "months")', ctx())).toBe('9999-02-28');
    expect(evaluateFormula('DATE_DIFF("0001-01-01", "0001-01-02")', ctx())).toBe(1);
    expect(evaluateFormula('DATE_DIFF("0001-01-01", "9999-12-31", "years")', ctx())).toBe(9998);
    expect(evaluateFormula('DATE_DIFF("0099-12-31", "0100-01-31", "months")', ctx())).toBe(1);
  });
});

describe('연도 범위 밖의 결과', () => {
  const OUT_OF_RANGE = /outside the supported years 0001–9999/;

  it('오프셋을 적용한 결과가 범위 안이면 통과한다', () => {
    expect(evaluateFormula('TO_DATE("0001-01-01T23:59+23:59")', ctx())).toBe('0001-01-01');
    expect(evaluateFormula('FORMAT_DATE("0001-01-01T23:59+23:59", "YYYY-MM-DD HH:mm")', ctx())).toBe('0001-01-01 00:00');
    expect(evaluateFormula('TO_DATE("9999-12-31T00:00-23:59")', ctx())).toBe('9999-12-31');
    expect(evaluateFormula('FORMAT_DATE("9999-12-31T00:00-23:59", "YYYY-MM-DD HH:mm")', ctx())).toBe('9999-12-31 23:59');
    expect(evaluateFormula('TO_DATE("0001-01-01T00:00Z")', ctx())).toBe('0001-01-01');
    expect(evaluateFormula('TO_DATE("9999-12-31T23:59:59.999Z")', ctx())).toBe('9999-12-31');
  });

  it.each([
    '0001-01-01T23:58+23:59',
    '0001-01-01T00:00+23:59',
    '0001-01-01T00:00+00:01',
    '9999-12-31T00:01-23:59',
    '9999-12-31T23:59-23:59',
    '9999-12-31T23:59-00:01',
    '0000-12-31',
    '0000-01-01T00:00Z',
  ])('%s은(는) 오프셋을 적용한 결과가 범위 밖', (value) => {
    for (const fn of ['FORMAT_DATE', 'TO_DATE']) {
      expect(() => evaluateFormula(`${fn}("${value}")`, ctx()), fn).toThrow(OUT_OF_RANGE);
    }
    expect(() => evaluateFormula(`DATE_ADD("${value}", 0)`, ctx())).toThrow(OUT_OF_RANGE);
    expect(() => evaluateFormula(`DATE_DIFF("${value}", "2026-09-04")`, ctx())).toThrow(/start date gives a result outside/);
    expect(() => evaluateFormula(`DATE_DIFF("2026-09-04", "${value}")`, ctx())).toThrow(/end date gives a result outside/);
  });

  it('DATE_ADD 결과가 범위 안이면 통과한다', () => {
    expect(evaluateFormula('DATE_ADD("0001-01-02", -1, "days")', ctx())).toBe('0001-01-01');
    expect(evaluateFormula('DATE_ADD("9999-12-30", 1, "days")', ctx())).toBe('9999-12-31');
    expect(evaluateFormula('DATE_ADD("0001-02-15", -1, "months")', ctx())).toBe('0001-01-15');
    expect(evaluateFormula('DATE_ADD("9999-11-30", 1, "months")', ctx())).toBe('9999-12-30');
    expect(evaluateFormula('DATE_ADD("0002-06-01", -1, "years")', ctx())).toBe('0001-06-01');
    expect(evaluateFormula('DATE_ADD("9998-06-01", 1, "years")', ctx())).toBe('9999-06-01');
    expect(evaluateFormula('DATE_ADD("0001-01-01", 9998, "years")', ctx())).toBe('9999-01-01');
    expect(evaluateFormula('DATE_ADD("9999-12-31", -9998, "years")', ctx())).toBe('0001-12-31');
  });

  it.each([
    'DATE_ADD("0001-01-01", -1, "days")',
    'DATE_ADD("9999-12-31", 1, "days")',
    'DATE_ADD("0001-01-15", -1, "months")',
    'DATE_ADD("9999-12-15", 1, "months")',
    'DATE_ADD("0001-06-01", -1, "years")',
    'DATE_ADD("9999-06-01", 1, "years")',
    'DATE_ADD("2026-01-01", 10000, "years")',
    'DATE_ADD("2026-01-01", -3000000, "days")',
    'DATE_ADD("2026-01-01", 100000000000, "days")',
  ])('%s은(는) 결과가 범위 밖', (source) => {
    expect(() => evaluateFormula(source, ctx())).toThrow(OUT_OF_RANGE);
  });

  it('값 오류이고 날짜·증감량 중 하나라도 데이터에서 오면 데이터 의존이다', () => {
    const literal = evalError('DATE_ADD("9999-12-31", 1)');
    expect(literal.reason).toBe('value');
    expect(literal.dataDependent).toBe(false);
    const dateFromData = evalError('DATE_ADD($(d), 1)', ctx({ d: '9999-12-31' }));
    expect(dateFromData.reason).toBe('value');
    expect(dateFromData.dataDependent).toBe(true);
    const amountFromData = evalError('DATE_ADD("9999-12-31", $(n))', ctx({ n: 1 }));
    expect(amountFromData.reason).toBe('value');
    expect(amountFromData.dataDependent).toBe(true);
    const offset = evalError('TO_DATE("0001-01-01T00:00+23:59")');
    expect(offset.reason).toBe('value');
    expect(offset.dataDependent).toBe(false);
    expect(evalError('TO_DATE($(d))', ctx({ d: '0001-01-01T00:00+23:59' })).dataDependent).toBe(true);
  });

  it('세 언어의 메시지가 대상과 입력을 알려 준다', () => {
    expect(evalError('TO_DATE("0001-01-01T00:00+23:59")').message).toBe(
      'The date gives a result outside the supported years 0001–9999: "0001-01-01T00:00+23:59"',
    );
    expect(evalError('TO_DATE("0001-01-01T00:00+23:59")', ctx({}, 'ko')).message).toBe(
      '날짜: 결과가 지원하는 연도 범위(0001~9999년)를 벗어났습니다. 현재 값: "0001-01-01T00:00+23:59"',
    );
    expect(evalError('TO_DATE("0001-01-01T00:00+23:59")', ctx({}, 'ja')).message).toBe(
      '日付の結果が対応する年の範囲（0001~9999 年）を超えました: "0001-01-01T00:00+23:59"',
    );
    expect(evalError('DATE_ADD("9999-12-31", 1)').message).toBe(
      'The date gives a result outside the supported years 0001–9999: "9999-12-31"',
    );
    expect(evalError('DATE_ADD("9999-12-31", 1)', ctx({}, 'ko')).message).toBe(
      '날짜: 결과가 지원하는 연도 범위(0001~9999년)를 벗어났습니다. 현재 값: "9999-12-31"',
    );
    expect(evalError('DATE_ADD("9999-12-31", 1)', ctx({}, 'ja')).message).toBe(
      '日付の結果が対応する年の範囲（0001~9999 年）を超えました: "9999-12-31"',
    );
    expect(evalError('DATE_DIFF("2026-09-04", "9999-12-31T23:59-00:01")').message).toBe(
      'The end date gives a result outside the supported years 0001–9999: "9999-12-31T23:59-00:01"',
    );
  });
});

describe('실행 환경 시간대와 무관한 결과', () => {
  const originalTz = process.env['TZ'];
  afterEach(() => {
    if (originalTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalTz;
  });

  const CASES: ReadonlyArray<readonly [string, string | number]> = [
    ['FORMAT_DATE("2026-09-04T00:30", "YYYY-MM-DD HH:mm")', '2026-09-04 00:30'],
    ['FORMAT_DATE("2026-09-04T00:30+09:00", "YYYY-MM-DD HH:mm")', '2026-09-03 15:30'],
    ['FORMAT_DATE("2026-09-04T22:00-05:30", "YYYY-MM-DD HH:mm")', '2026-09-05 03:30'],
    ['FORMAT_DATE("0001-01-01", "YYYY-MM-DD HH:mm")', '0001-01-01 00:00'],
    ['FORMAT_DATE("2026-03-08T02:30", "[DST] HH:mm")', 'DST 02:30'],
    ['TO_DATE("2026-09-04T23:59+09:00")', '2026-09-04'],
    ['DATE_ADD("2026-01-31T12:00", 1, "months")', '2026-02-28'],
    ['DATE_DIFF("2026-09-04T00:30", "2026-09-05T00:29")', 0],
    // 연도 범위 경계 — 통과하는 값과 범위 밖 오류(`!value`는 값 오류로 실패했다는 표시)
    ['TO_DATE("0001-01-01T23:59+23:59")', '0001-01-01'],
    ['TO_DATE("9999-12-31T00:00-23:59")', '9999-12-31'],
    ['TO_DATE("0001-01-01T23:58+23:59")', '!value'],
    ['TO_DATE("9999-12-31T00:01-23:59")', '!value'],
    ['DATE_ADD("0001-01-02", -1)', '0001-01-01'],
    ['DATE_ADD("9999-12-30", 1)', '9999-12-31'],
    ['DATE_ADD("0001-01-01", -1)', '!value'],
    ['DATE_ADD("9999-12-31", 1)', '!value'],
    ['DATE_ADD("0001-01-15", -1, "months")', '!value'],
    ['DATE_ADD("9999-06-01", 1, "years")', '!value'],
  ];

  /** 평가 결과를 돌려주고, 평가 오류면 `!<reason>`으로 표시한다. */
  function run(formula: string): FormulaValue {
    try {
      return evaluateFormula(formula, ctx());
    } catch (error) {
      if (error instanceof FormulaEvalError) return `!${error.reason}`;
      throw error;
    }
  }

  it.each(['UTC', 'Asia/Tokyo', 'America/New_York'])('TZ=%s (같은 프로세스)', (tz) => {
    process.env['TZ'] = tz;
    for (const [formula, expected] of CASES) {
      expect(run(formula), formula).toBe(expected);
    }
  });

  it.each(['UTC', 'Asia/Tokyo', 'America/New_York'])('TZ=%s (자식 프로세스)', (tz) => {
    const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
    if (!existsSync(dist)) {
      throw new Error('dist/index.js가 없습니다 — 먼저 @omdc-slipkit/core를 build한 뒤 실행해야 합니다');
    }
    const script = [
      `import { FormulaEvalError, evaluateFormula } from ${JSON.stringify(pathToFileURL(dist).href)};`,
      `const formulas = ${JSON.stringify(CASES.map(([formula]) => formula))};`,
      'const run = (f) => { try { return evaluateFormula(f, { values: {} }); }',
      '  catch (e) { if (e instanceof FormulaEvalError) return `!${e.reason}`; throw e; } };',
      'process.stdout.write(JSON.stringify(formulas.map(run)));',
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual(CASES.map(([, expected]) => expected));
  });
});
