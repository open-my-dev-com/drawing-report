import { describe, expect, it } from 'vitest';
import {
  FormulaEvalError,
  FormulaSyntaxError,
  evaluateFormula,
  parseFormula,
  type FormulaContext,
} from '../src/index.js';

const ctx = (values: FormulaContext['values'] = {}, now?: Date): FormulaContext =>
  now ? { values, now } : { values };

const items = [
  { 품명: '노트', 구분: '과세', 수량: 2, 금액: 3000 },
  { 품명: '연필', 구분: '면세', 수량: 10, 금액: 5000 },
  { 품명: '지우개', 구분: '과세', 수량: 5, 금액: 2000 },
];

describe('파서', () => {
  it('연산자 우선순위: 곱셈이 덧셈보다 먼저', () => {
    expect(evaluateFormula('1 + 2 * 3', ctx())).toBe(7);
    expect(evaluateFormula('(1 + 2) * 3', ctx())).toBe(9);
  });

  it('비교는 산술보다 나중', () => {
    expect(evaluateFormula('1 + 2 = 3', ctx())).toBe(true);
    expect(evaluateFormula('2 * 3 <> 5', ctx())).toBe(true);
  });

  it('단항 부호', () => {
    expect(evaluateFormula('-3 + 5', ctx())).toBe(2);
    expect(evaluateFormula('--3', ctx())).toBe(3);
  });

  it('문자열 리터럴과 "" 이스케이프', () => {
    expect(evaluateFormula('"안녕 ""세상"""', ctx())).toBe('안녕 "세상"');
  });

  it('빈 수식·문법 오류는 FormulaSyntaxError', () => {
    expect(() => parseFormula('')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('1 +')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('SUM(1')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('1 2')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('"닫히지 않음')).toThrow(FormulaSyntaxError);
  });

  it('알 수 없는 함수는 파싱 단계에서 거부한다 (ADR-010)', () => {
    expect(() => parseFormula('EVAL("1+1")')).toThrow(/Unsupported function/);
  });

  it('함수명은 대소문자 무관', () => {
    expect(evaluateFormula('sum(1, 2, 3)', ctx())).toBe(6);
  });
});

describe('참조', () => {
  it('단순 참조와 중첩 경로', () => {
    expect(evaluateFormula('total', ctx({ total: 3000 }))).toBe(3000);
    expect(evaluateFormula('공급자.상호', ctx({ 공급자: { 상호: '한빛문구' } }))).toBe('한빛문구');
  });

  it('배열을 만나면 나머지 경로를 각 원소에 사상한다 (items.금액)', () => {
    expect(evaluateFormula('SUM(items.금액)', ctx({ items }))).toBe(10000);
  });

  it('없는 키는 빈 값(null)', () => {
    expect(evaluateFormula('IF(없는키 = 0, "기본", "값")', ctx())).toBe('값');
    expect(evaluateFormula('CONCAT("[", 없는키, "]")', ctx())).toBe('[]');
  });

  it('범위를 산술에 직접 쓰면 평가 오류', () => {
    expect(() => evaluateFormula('items.금액 + 1', ctx({ items }))).toThrow(FormulaEvalError);
  });
});

describe('집계·조건부 집계', () => {
  it('SUM / AVG / COUNT / MIN / MAX', () => {
    const c = ctx({ items });
    expect(evaluateFormula('SUM(items.금액)', c)).toBe(10000);
    expect(evaluateFormula('AVG(items.수량)', c)).toBeCloseTo(17 / 3);
    expect(evaluateFormula('COUNT(items.품명)', c)).toBe(3);
    expect(evaluateFormula('MIN(items.금액)', c)).toBe(2000);
    expect(evaluateFormula('MAX(items.금액)', c)).toBe(5000);
  });

  it('SUM은 빈 값을 건너뛴다', () => {
    expect(evaluateFormula('SUM(rows.v)', ctx({ rows: [{ v: 1 }, {}, { v: 2 }] }))).toBe(3);
  });

  it('AVG는 대상이 없으면 오류', () => {
    expect(() => evaluateFormula('AVG(rows.v)', ctx({ rows: [] }))).toThrow(FormulaEvalError);
  });

  it('SUMIF(조건 범위, 조건, 합계 범위)', () => {
    const c = ctx({ items });
    expect(evaluateFormula('SUMIF(items.구분, "과세", items.금액)', c)).toBe(5000);
    expect(evaluateFormula('SUMIF(items.금액, ">=3000")', c)).toBe(8000);
  });

  it('COUNTIF와 비교 조건 문자열', () => {
    const c = ctx({ items });
    expect(evaluateFormula('COUNTIF(items.구분, "과세")', c)).toBe(2);
    expect(evaluateFormula('COUNTIF(items.수량, ">4")', c)).toBe(2);
    expect(evaluateFormula('COUNTIF(items.구분, "<>과세")', c)).toBe(1);
  });
});

describe('산술 함수·연산', () => {
  it('ROUND / FLOOR / CEIL 자릿수', () => {
    expect(evaluateFormula('ROUND(1234.567, 2)', ctx())).toBe(1234.57);
    expect(evaluateFormula('ROUND(1234.567)', ctx())).toBe(1235);
    expect(evaluateFormula('FLOOR(1234.567, 1)', ctx())).toBe(1234.5);
    expect(evaluateFormula('FLOOR(-15, -1)', ctx())).toBe(-20);
    expect(evaluateFormula('CEIL(1234.001, 2)', ctx())).toBe(1234.01);
    expect(evaluateFormula('ABS(-5)', ctx())).toBe(5);
  });

  it('0으로 나누면 오류', () => {
    expect(() => evaluateFormula('1 / 0', ctx())).toThrow(/Cannot divide by zero/);
  });

  it('숫자 자리에 글자를 넣으면 오류 — 자동 변환하지 않는다 (ADR-044)', () => {
    expect(() => evaluateFormula('금액 * 2', ctx({ 금액: '1500' }))).toThrow(/must be a number/);
  });

  it('TO_NUMBER로 감싸면 글자를 수로 변환한다 (ADR-044)', () => {
    expect(evaluateFormula('TO_NUMBER(금액) * 2', ctx({ 금액: '1500' }))).toBe(3000);
  });
});

describe('문자열 함수', () => {
  it('CONCAT은 수·논리·빈 값을 문자열로 잇는다', () => {
    expect(evaluateFormula('CONCAT("합계: ", 1000, "원")', ctx())).toBe('합계: 1000원');
  });

  it('LEFT / RIGHT / MID는 유니코드 문자 단위', () => {
    expect(evaluateFormula('LEFT("거래명세서", 2)', ctx())).toBe('거래');
    expect(evaluateFormula('RIGHT("거래명세서", 3)', ctx())).toBe('명세서');
    expect(evaluateFormula('MID("거래명세서", 3, 2)', ctx())).toBe('명세');
  });

  it('REPLACE는 모든 일치를 치환', () => {
    expect(evaluateFormula('REPLACE("a-b-c", "-", "/")', ctx())).toBe('a/b/c');
  });

  it('TRIM / UPPER / LOWER', () => {
    expect(evaluateFormula('TRIM("  x  ")', ctx())).toBe('x');
    expect(evaluateFormula('UPPER("abc")', ctx())).toBe('ABC');
    expect(evaluateFormula('LOWER("ABC")', ctx())).toBe('abc');
  });
});

describe('조건', () => {
  it('IF는 조건 분기하고 else 생략 시 빈 값', () => {
    expect(evaluateFormula('IF(1 < 2, "참", "거짓")', ctx())).toBe('참');
    expect(evaluateFormula('IF(FALSE, "참")', ctx())).toBe(null);
  });

  it('IF는 선택되지 않은 가지를 평가하지 않는다 (지연)', () => {
    expect(evaluateFormula('IF(TRUE, 1, 1/0)', ctx())).toBe(1);
  });

  it('AND / OR 단락 평가', () => {
    expect(evaluateFormula('AND(TRUE, 1 = 1)', ctx())).toBe(true);
    expect(evaluateFormula('OR(FALSE, FALSE)', ctx())).toBe(false);
    expect(evaluateFormula('OR(TRUE, 1/0 = 1)', ctx())).toBe(true);
    expect(evaluateFormula('AND(FALSE, 1/0 = 1)', ctx())).toBe(false);
  });

  it('비교: 타입이 다르면 = 는 false, 순서 비교는 오류', () => {
    expect(evaluateFormula('"1" = 1', ctx())).toBe(false);
    expect(() => evaluateFormula('"a" < 1', ctx())).toThrow(FormulaEvalError);
  });
});

describe('포맷 함수', () => {
  it('FORMAT_NUMBER 천단위 콤마·소수 자릿수', () => {
    expect(evaluateFormula('FORMAT_NUMBER(1234567)', ctx())).toBe('1,234,567');
    expect(evaluateFormula('FORMAT_NUMBER(1234.5, 2)', ctx())).toBe('1,234.50');
  });

  it('FORMAT_DATE 패턴', () => {
    expect(evaluateFormula('FORMAT_DATE("2026-08-18")', ctx())).toBe('2026-08-18');
    expect(evaluateFormula('FORMAT_DATE("2026-08-18", "YYYY년 M월 D일")', ctx())).toBe('2026년 8월 18일');
  });

  it('NUMBER_TO_KOREAN 금액 한글 표기 (일십 관례)', () => {
    expect(evaluateFormula('NUMBER_TO_KOREAN(0)', ctx())).toBe('영');
    expect(evaluateFormula('NUMBER_TO_KOREAN(110)', ctx())).toBe('일백일십');
    expect(evaluateFormula('NUMBER_TO_KOREAN(123456)', ctx())).toBe('일십이만삼천사백오십육');
    expect(evaluateFormula('NUMBER_TO_KOREAN(100000100)', ctx())).toBe('일억일백');
    expect(evaluateFormula('NUMBER_TO_KOREAN(-3000)', ctx())).toBe('마이너스삼천');
    expect(() => evaluateFormula('NUMBER_TO_KOREAN(1.5)', ctx())).toThrow(/only supports integers/);
  });
});

describe('날짜 함수', () => {
  const now = new Date('2026-08-18T09:30:00Z');

  it('TODAY는 컨텍스트 주입 시각 기준', () => {
    expect(evaluateFormula('TODAY()', ctx({}, now))).toBe('2026-08-18');
  });

  it('DATE_ADD 일·월·년', () => {
    expect(evaluateFormula('DATE_ADD("2026-08-18", 14)', ctx())).toBe('2026-09-01');
    expect(evaluateFormula('DATE_ADD("2026-08-18", -1, "months")', ctx())).toBe('2026-07-18');
    expect(evaluateFormula('DATE_ADD("2026-08-18", 2, "years")', ctx())).toBe('2028-08-18');
  });

  it('DATE_DIFF(시작, 끝)', () => {
    expect(evaluateFormula('DATE_DIFF("2026-08-01", "2026-08-18")', ctx())).toBe(17);
    expect(evaluateFormula('DATE_DIFF("2026-01-31", "2026-03-01", "months")', ctx())).toBe(1);
    expect(evaluateFormula('DATE_DIFF("2024-08-18", "2026-08-17", "years")', ctx())).toBe(1);
  });

  it('잘못된 날짜는 오류', () => {
    expect(() => evaluateFormula('DATE_ADD("어제", 1)', ctx())).toThrow(FormulaEvalError);
  });
});

describe('세무', () => {
  it('VAT 기본 10%, 세율 지정 가능, ROUND 조합', () => {
    expect(evaluateFormula('VAT(10000)', ctx())).toBe(1000);
    expect(evaluateFormula('VAT(10000, 5)', ctx())).toBe(500);
    expect(evaluateFormula('FLOOR(VAT(공급가액))', ctx({ 공급가액: 12345 }))).toBe(1234);
  });
});

describe('실전 조합', () => {
  it('전표 합계란 시나리오', () => {
    const c = ctx({ items });
    expect(evaluateFormula('CONCAT("합계: ", FORMAT_NUMBER(SUM(items.금액) + VAT(SUM(items.금액))), "원")', c)).toBe(
      '합계: 11,000원',
    );
    expect(evaluateFormula('CONCAT("금", NUMBER_TO_KOREAN(SUM(items.금액)), "원整")', c)).toBe('금일만원整');
  });
});

describe('적대적 수식 방어 (SPEC §3.2)', () => {
  it('중첩이 너무 깊은 수식은 스택 오버플로 대신 FormulaSyntaxError로 거부한다', () => {
    const deepParens = '('.repeat(500) + '1' + ')'.repeat(500);
    expect(() => parseFormula(deepParens)).toThrow(FormulaSyntaxError);
    expect(() => parseFormula(deepParens)).toThrow(/nesting is too deep/);

    const deepUnary = '-'.repeat(500) + '1';
    expect(() => parseFormula(deepUnary)).toThrow(FormulaSyntaxError);
  });

  it('허용 깊이 안의 정상 수식은 그대로 파싱된다', () => {
    const ok = '('.repeat(50) + '1+2' + ')'.repeat(50);
    expect(parseFormula(ok)).toBeTruthy();
  });

  it('너무 긴 수식은 FormulaSyntaxError로 거부한다', () => {
    const long = '1+' .repeat(6000) + '1';
    expect(() => parseFormula(long)).toThrow(/too long/);
  });

  it('너무 깊게 중첩된 값 참조는 FormulaEvalError로 거부한다', () => {
    let nested: unknown = 1;
    for (let i = 0; i < 5000; i++) nested = [nested];
    expect(() => evaluateFormula('SUM(v)', ctx({ v: nested as never }))).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('SUM(v)', ctx({ v: nested as never }))).toThrow(/nesting exceeds the limit/);
  });
});

describe('FORMAT_NUMBER 로케일 (ADR-013)', () => {
  it('기본 로케일(ko-KR)은 천단위 콤마 표기다', () => {
    expect(evaluateFormula('FORMAT_NUMBER(1234567.5)', ctx())).toBe('1,234,567.5');
  });

  it('컨텍스트로 로케일을 지정하면 해당 표기를 따른다', () => {
    expect(evaluateFormula('FORMAT_NUMBER(1234567.5)', { values: {}, locale: 'de-DE' })).toBe(
      '1.234.567,5',
    );
    expect(evaluateFormula('FORMAT_NUMBER(1234.5, 2)', { values: {}, locale: 'de-DE' })).toBe(
      '1.234,50',
    );
  });
});

describe('경계·잘못된 입력 방어 (G-48)', () => {
  it('TO_NUMBER는 유한한 10진수만 받는다 (Infinity·16진수 거부, ADR-044)', () => {
    expect(() => evaluateFormula('TO_NUMBER(a)', ctx({ a: '1e400' }))).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('TO_NUMBER(a)', ctx({ a: 'Infinity' }))).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('TO_NUMBER(a)', ctx({ a: '0x1F' }))).toThrow(FormulaEvalError);
    expect(evaluateFormula('TO_NUMBER(a) + 1', ctx({ a: '2.5' }))).toBe(3.5);
  });

  it('너무 큰 숫자 리터럴(Infinity)은 파싱 단계에서 거부한다', () => {
    expect(() => evaluateFormula('1e400', ctx())).toThrow(FormulaSyntaxError);
  });

  it('FORMAT_DATE는 실제 존재하지 않는 날짜를 롤오버하지 않고 거부한다', () => {
    expect(() => evaluateFormula('FORMAT_DATE("2026-13-45")', ctx())).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('FORMAT_DATE("2026-02-30")', ctx())).toThrow(FormulaEvalError);
    expect(evaluateFormula('FORMAT_DATE("2026-02-28")', ctx())).toBe('2026-02-28');
  });

  it('DATE_ADD는 월·해 가감 시 대상 달의 마지막 날로 클램프한다', () => {
    expect(evaluateFormula('DATE_ADD("2026-01-31", 1, "months")', ctx())).toBe('2026-02-28');
    expect(evaluateFormula('DATE_ADD("2024-01-31", 1, "months")', ctx())).toBe('2024-02-29');
    expect(evaluateFormula('DATE_ADD("2026-01-15", 1, "months")', ctx())).toBe('2026-02-15');
  });

  it('NUMBER_TO_KOREAN은 안전 정수 범위를 넘으면 거부한다', () => {
    expect(() => evaluateFormula('NUMBER_TO_KOREAN(a)', ctx({ a: 1e20 }))).toThrow(FormulaEvalError);
    expect(evaluateFormula('NUMBER_TO_KOREAN(110)', ctx())).toBe('일백일십');
  });
});

describe('타입 변환 함수 (ADR-044)', () => {
  it('TO_NUMBER: 글자·논리를 수로, 빈 값·빈 문자열은 0', () => {
    expect(evaluateFormula('TO_NUMBER("1500")', ctx())).toBe(1500);
    expect(evaluateFormula('TO_NUMBER("-3.5")', ctx())).toBe(-3.5);
    expect(evaluateFormula('TO_NUMBER(a)', ctx({ a: '' }))).toBe(0);
    expect(evaluateFormula('TO_NUMBER(a)', ctx({ a: null }))).toBe(0);
    expect(evaluateFormula('TO_NUMBER(TRUE)', ctx())).toBe(1);
    expect(evaluateFormula('TO_NUMBER(FALSE)', ctx())).toBe(0);
  });

  it('TO_NUMBER: 숫자로 볼 수 없는 글자는 오류', () => {
    expect(() => evaluateFormula('TO_NUMBER("abc")', ctx())).toThrow(FormulaEvalError);
    expect(() => evaluateFormula('TO_NUMBER(items)', ctx({ items: [1, 2] }))).toThrow(FormulaEvalError);
  });

  it('TO_STRING: 수·논리·빈 값을 글자로', () => {
    expect(evaluateFormula('TO_STRING(1500)', ctx())).toBe('1500');
    expect(evaluateFormula('TO_STRING(TRUE)', ctx())).toBe('TRUE');
    expect(evaluateFormula('TO_STRING(a)', ctx({ a: null }))).toBe('');
    expect(evaluateFormula('TO_STRING(3) = "3"', ctx())).toBe(true);
    expect(evaluateFormula('3 = a', ctx({ a: '3' }))).toBe(false);
  });

  it('TO_DATE: 날짜 문자열을 ISO(YYYY-MM-DD)로 정규화·검증', () => {
    expect(evaluateFormula('TO_DATE("2026-01-05")', ctx())).toBe('2026-01-05');
    expect(evaluateFormula('TO_DATE("2026-01-05T09:30:00Z")', ctx())).toBe('2026-01-05');
    expect(() => evaluateFormula('TO_DATE("2026-13-45")', ctx())).toThrow(FormulaEvalError);
  });
});

describe('메시지 언어 (로케일 설정)', () => {
  it('기본은 영어 메시지다', () => {
    expect(() => evaluateFormula('1/0', ctx({}))).toThrow('Cannot divide by zero');
  });

  it("locale이 'ko-KR'면 한국어 메시지다", () => {
    expect(() => evaluateFormula('1/0', { values: {}, locale: 'ko-KR' })).toThrow('0으로 나눌 수 없습니다');
  });

  it("locale이 'ja'면 일본어 메시지다", () => {
    expect(() => evaluateFormula('1/0', { values: {}, locale: 'ja' })).toThrow('0 で割ることはできません');
  });

  it('parseFormula도 locale 옵션으로 메시지 언어를 고른다', () => {
    expect(() => parseFormula('')).toThrow('The formula is empty');
    expect(() => parseFormula('', { locale: 'ko' })).toThrow('빈 수식입니다');
  });

  it('지원하지 않는 로케일은 영어로 표시한다', () => {
    expect(() => evaluateFormula('1/0', { values: {}, locale: 'fr-FR' })).toThrow('Cannot divide by zero');
  });
});
