/**
 * 수식 내장 함수와 타입 변환 규칙을 구현한다.
 * `IF`, `AND`, `OR`는 지연 평가가 필요하므로 evaluator에서 처리한다.
 */
import { assertArity } from './arity.js';
import { FormulaEvalError, valueError } from './errors.js';
import type { FormulaFunctionName } from './functions.js';
import { fm, type FormulaSubject } from './messages.js';

/** 수식 런타임 값. 배열은 범위(참조가 배열 데이터를 가리킬 때)로 취급된다. */
export type FormulaValue = number | string | boolean | null | FormulaValue[];

/** 수식 평가에 주입되는 실행 문맥 */
export interface FormulaContext {
  /** 수식의 참조 경로를 조회할 전표 값 */
  values: Record<string, unknown>;
  /**
   * `TODAY`의 기준 시각. 테스트와 재현 가능한 평가에 사용한다.
   *
   * @defaultValue 호출 시점의 현재 시각
   */
  now?: Date;
  /**
   * `FORMAT_NUMBER` 등 형식 함수와 오류 메시지 언어에 사용할 BCP 47 로케일.
   *
   * @defaultValue `'en-US'`
   */
  locale?: string;
  /**
   * 그리드 페이지 계획이 공급하는 예약 참조(`@item`·`@group`·`@page`·`@all`·`@carried`) 값.
   * 예약 참조를 지원하지 않는 곳에서는 생략하며, 생략된 상태에서 예약 참조를 평가하면
   * 오류가 발생한다.
   */
  reserved?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// 값 변환 헬퍼
// ---------------------------------------------------------------------------

function describe(value: FormulaValue): string {
  if (value === null) return fm().emptyValueLabel();
  if (Array.isArray(value)) return fm().rangeLabel();
  return JSON.stringify(value);
}

/**
 * 수식 값을 숫자로 변환한다. 숫자와 빈 값만 허용한다.
 *
 * @remarks
 * 숫자를 요구하는 자리(산술 연산, SUM·AVG 등)는 문자열을 자동 변환하지 않는다.
 * 문자열을 숫자로 바꾸려면 수식에서 `TO_NUMBER`를 사용해야 한다. 빈 값(null)은 0으로 처리한다.
 *
 * @param value - 변환할 수식 값
 * @param what - 오류 메시지에서 대상을 가리키는 키 (예: `'aggregateTarget'`)
 * @param fromData - 이 값이 참조를 통해 데이터에서 왔는지
 * @returns 변환된 숫자
 * @throws FormulaEvalError 숫자가 아닌 값(글자·논리·범위)이면
 */
export function toNumber(value: FormulaValue, what: FormulaSubject = 'value', fromData = false): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw valueError(fm().numberNotFinite(what), fromData);
    return value;
  }
  if (value === null) return 0;
  throw valueError(fm().mustBeNumber(what, describe(value)), fromData);
}

// `Number`가 허용하는 16진수, 2진수, Infinity를 제외하고 10진수 표기만 허용한다.
const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 문자열과 논리값을 숫자로 명시적으로 변환한다 (`TO_NUMBER`).
 *
 * @param value - 변환할 값
 * @param fromData - 이 값이 참조를 통해 데이터에서 왔는지
 * @returns 변환된 숫자 (빈 값·빈 문자열은 0, 논리는 1/0)
 * @throws FormulaEvalError 숫자로 볼 수 없는 문자열·범위면
 */
function coerceToNumber(value: FormulaValue, fromData: boolean): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw valueError(fm().valueNotFinite(), fromData);
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  if (Array.isArray(value)) throw valueError(fm().toNumberRange(), fromData);
  const text = value.trim();
  if (text === '') return 0;
  if (DECIMAL_NUMBER.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) throw valueError(fm().toNumberNotFinite(), fromData);
    return n;
  }
  throw valueError(fm().toNumberInvalid(describe(value)), fromData);
}

function toText(value: FormulaValue, fromData = false): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  throw valueError(fm().rangeToText(), fromData);
}

/**
 * 값을 조건식에 사용할 논리값으로 변환한다. 0이 아닌 숫자는 참이고 빈 값은 거짓이다.
 *
 * @param value - 변환할 수식 값
 * @param fromData - 이 값이 참조를 통해 데이터에서 왔는지
 * @returns 변환된 논리값
 * @throws FormulaEvalError 문자열·범위 등 논리값으로 볼 수 없는 값이면
 */
export function toCondition(value: FormulaValue, fromData = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null) return false;
  throw valueError(fm().conditionRequired(describe(value)), fromData);
}

function requireInt(value: FormulaValue, what: FormulaSubject, fromData: boolean): number {
  const n = toNumber(value, what, fromData);
  if (!Number.isInteger(n)) throw valueError(fm().mustBeInteger(what), fromData);
  return n;
}

/** 범위와 단일 값을 집계할 숫자 목록으로 변환한다. 빈 값은 제외한다. */
function collectNumbers(args: FormulaValue[], origins: readonly boolean[]): number[] {
  const out: number[] = [];
  const visit = (value: FormulaValue, fromData: boolean): void => {
    if (value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, fromData));
      return;
    }
    out.push(toNumber(value, 'aggregateTarget', fromData));
  };
  args.forEach((value, index) => visit(value, origins[index] === true));
  return out;
}

function flatten(args: FormulaValue[]): (number | string | boolean | null)[] {
  const out: (number | string | boolean | null)[] = [];
  const visit = (value: FormulaValue): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    out.push(value);
  };
  args.forEach(visit);
  return out;
}

// ---------------------------------------------------------------------------
// SUMIF/COUNTIF에서 사용하는 비교 조건
// ---------------------------------------------------------------------------

/** 범위가 아닌 단일 수식 값 */
export type Scalar = number | string | boolean | null;

function makeCriteria(criterion: FormulaValue, fromData: boolean): (value: Scalar) => boolean {
  if (Array.isArray(criterion)) throw valueError(fm().criteriaRange(), fromData);
  if (typeof criterion === 'string') {
    const match = /^(<>|<=|>=|=|<|>)(.*)$/.exec(criterion);
    if (match) {
      const [, op, rawText] = match as unknown as [string, string, string];
      const raw: Scalar = rawText.trim() !== '' && !Number.isNaN(Number(rawText)) ? Number(rawText) : rawText;
      return (value) => compareForCriteria(value, op, raw);
    }
  }
  return (value) => compareForCriteria(value, '=', criterion);
}

function compareForCriteria(value: Scalar, op: string, target: Scalar): boolean {
  if (op === '=') return looseEquals(value, target);
  if (op === '<>') return !looseEquals(value, target);
  if (typeof value === 'number' && typeof target === 'number') {
    if (op === '<') return value < target;
    if (op === '>') return value > target;
    if (op === '<=') return value <= target;
    if (op === '>=') return value >= target;
  }
  return false;
}

function looseEquals(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'number' && typeof b === 'string') return !Number.isNaN(Number(b)) && a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return !Number.isNaN(Number(a)) && Number(a) === b;
  return a === b;
}

// ---------------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 시간대 표기가 없는 ISO 날짜·시간 (`2026-01-01T00:30`, `2026-01-01 00:30:15.250`) */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function parseDate(value: FormulaValue, what: FormulaSubject, fromData: boolean): Date {
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value) ?? LOCAL_DATE_TIME.exec(value);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hour = Number(m[4] ?? 0);
      const minute = Number(m[5] ?? 0);
      const second = Number(m[6] ?? 0);
      const millisecond = Number((m[7] ?? '0').padEnd(3, '0'));
      // 시간대가 없는 값은 실행 환경의 시간대와 무관하게 UTC로 해석해 브라우저와 Node의 결과를 맞춘다.
      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
      // Date.UTC는 범위 밖 월·일·시각을 다음 단위로 넘겨 버리므로(2026-13-45 → 2027-02-14),
      // Date 생성 전후의 구성요소가 다르면 유효하지 않은 날짜로 처리한다.
      if (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day &&
        date.getUTCHours() === hour &&
        date.getUTCMinutes() === minute &&
        date.getUTCSeconds() === second
      ) {
        return date;
      }
      throw valueError(fm().dateNotReal(what, describe(value)), fromData);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw valueError(fm().dateInvalid(what, describe(value)), fromData);
}

function formatDate(date: Date, pattern: string): string {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return pattern.replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY': return pad(date.getUTCFullYear(), 4);
      case 'YY': return pad(date.getUTCFullYear() % 100, 2);
      case 'MM': return pad(date.getUTCMonth() + 1, 2);
      case 'M': return String(date.getUTCMonth() + 1);
      case 'DD': return pad(date.getUTCDate(), 2);
      case 'D': return String(date.getUTCDate());
      case 'HH': return pad(date.getUTCHours(), 2);
      case 'mm': return pad(date.getUTCMinutes(), 2);
      case 'ss': return pad(date.getUTCSeconds(), 2);
      default: return token;
    }
  });
}

function toIsoDate(date: Date): string {
  return formatDate(date, 'YYYY-MM-DD');
}

type DateUnit = 'days' | 'months' | 'years';

function toDateUnit(value: FormulaValue, fromData: boolean): DateUnit {
  const unit = value === null ? 'days' : toText(value, fromData);
  if (unit === 'days' || unit === 'months' || unit === 'years') return unit;
  throw valueError(fm().dateUnitInvalid(describe(value)), fromData);
}

// ---------------------------------------------------------------------------
// 금액 한글 표기 (NUMBER_TO_KOREAN)
// ---------------------------------------------------------------------------

const KOREAN_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNITS = ['', '십', '백', '천'];
const GROUP_UNITS = ['', '만', '억', '조', '경'];

/** 금액 위변조 방지 관례에 따라 십/백/천 앞에도 '일'을 쓴다 (예: 110 → 일백일십) */
function numberToKorean(n: number, fromData: boolean): string {
  if (!Number.isInteger(n)) throw valueError(fm().numberToKoreanInteger(), fromData);
  if (n === 0) return '영';
  const sign = n < 0 ? '마이너스' : '';
  let abs = Math.abs(n);
  // 안전 정수 범위를 넘으면 % 10000·나눗셈이 부정확해져 잘못된 자릿값을 읽는다.
  if (abs > Number.MAX_SAFE_INTEGER) throw valueError(fm().numberToKoreanRange(), fromData);
  const groups: string[] = [];
  let groupIndex = 0;
  while (abs > 0) {
    const group = abs % 10000;
    abs = Math.floor(abs / 10000);
    if (group > 0) {
      let text = '';
      for (let place = 3; place >= 0; place--) {
        const digit = Math.floor(group / 10 ** place) % 10;
        if (digit > 0) text += KOREAN_DIGITS[digit]! + SMALL_UNITS[place]!;
      }
      groups.unshift(text + GROUP_UNITS[groupIndex]!);
    }
    groupIndex++;
  }
  return sign + groups.join('');
}

// ---------------------------------------------------------------------------
// 함수 테이블 (지연 평가가 필요한 IF/AND/OR 제외 29종)
// ---------------------------------------------------------------------------

function arity(name: FormulaFunctionName, args: FormulaValue[]): void {
  assertArity(name, args.length);
}

/** ROUND·FLOOR·CEIL이 받는 자릿수 인자의 절대값 상한 */
const MAX_ROUND_DIGITS = 20;

/** ROUND·FLOOR·CEIL의 공통 구현 — 자릿수 인자만 다르다 */
function roundArg(
  args: FormulaValue[],
  origins: readonly boolean[],
  name: FormulaFunctionName,
  mode: 'round' | 'floor' | 'ceil',
): number {
  arity(name, args);
  const digits = args.length > 1 ? requireInt(args[1] ?? null, 'digits', origins[1] === true) : 0;
  if (digits < -MAX_ROUND_DIGITS || digits > MAX_ROUND_DIGITS) {
    throw valueError(fm().digitsRange(MAX_ROUND_DIGITS), origins[1] === true);
  }
  return roundTo(toNumber(args[0] ?? null, 'value', origins[0] === true), digits, mode);
}

/**
 * 수의 절대값을 10진 자릿수 문자열로 푼다. `String(n)`이 주는 가장 짧은 표기(사람이 적은
 * 그대로: `1.005` → `"1005"`)를 쓰므로 `1.005 * 100 = 100.49999…` 같은 이진 오차가 끼지 않는다.
 *
 * @returns `digits`는 숫자만 이어 붙인 문자열, `intDigits`는 소수점 앞 자릿수(1 이상)
 */
function decimalDigits(abs: number): { digits: string; intDigits: number } {
  const text = String(abs);
  const exponentAt = text.indexOf('e');
  const mantissa = exponentAt < 0 ? text : text.slice(0, exponentAt);
  const exponent = exponentAt < 0 ? 0 : Number(text.slice(exponentAt + 1));
  const pointAt = mantissa.indexOf('.');
  let digits = pointAt < 0 ? mantissa : mantissa.slice(0, pointAt) + mantissa.slice(pointAt + 1);
  let intDigits = (pointAt < 0 ? mantissa.length : pointAt) + exponent;
  if (intDigits > digits.length) {
    digits = digits.padEnd(intDigits, '0');
  } else if (intDigits < 1) {
    // 0.001처럼 정수부가 없는 수는 앞에 0을 채워 정수부 한 자리를 만든다.
    digits = '0'.repeat(1 - intDigits) + digits;
    intDigits = 1;
  }
  return { digits, intDigits };
}

/**
 * 10진 자릿수 기준으로 반올림·내림·올림한다.
 * - `round`: 정확한 절반은 0에서 멀어지는 쪽으로 (2.5 → 3, -2.5 → -3)
 * - `floor`·`ceil`: 수학적 방향(음의 무한대·양의 무한대 쪽)
 */
function roundTo(n: number, digits: number, mode: 'round' | 'floor' | 'ceil'): number {
  if (n === 0) return 0;
  const negative = n < 0;
  const decimal = decimalDigits(Math.abs(n));
  const cut = decimal.intDigits + digits;
  // 남기는 자릿수가 실제 자릿수보다 많으면 뒤를 0으로 채워 자리 이동을 맞춘다.
  const padded = decimal.digits.padEnd(Math.max(cut, 0), '0');
  const kept = cut > 0 ? padded.slice(0, cut) : '';
  const rest = cut > 0 ? padded.slice(cut) : padded;
  const restNonZero = /[1-9]/.test(rest);
  let bumpMagnitude: boolean;
  if (mode === 'round') {
    // cut이 음수이면 버리는 첫 자리가 정수부 앞의 0이므로 올리지 않는다.
    bumpMagnitude = cut >= 0 && (rest[0] ?? '0') >= '5';
  } else if (mode === 'floor') {
    bumpMagnitude = negative && restNonZero;
  } else {
    bumpMagnitude = !negative && restNonZero;
  }
  const magnitude = (kept === '' ? 0n : BigInt(kept)) + (bumpMagnitude ? 1n : 0n);
  if (magnitude === 0n) return 0;
  // 정수 자릿수와 10의 거듭제곱을 문자열로 합쳐 Number가 가장 가까운 double을 고르게 한다.
  const value = Number(`${magnitude.toString()}e${-digits}`);
  return negative ? -value : value;
}

/** 집계 대상의 최솟값·최댓값을 반복문으로 구한다 — 인자 전개(spread)는 큰 범위에서 호출 스택을 넘친다. */
function extremum(numbers: readonly number[], pick: 'min' | 'max'): number {
  if (numbers.length === 0) return 0;
  let result = numbers[0]!;
  for (let i = 1; i < numbers.length; i++) {
    const value = numbers[i]!;
    if (pick === 'min' ? value < result : value > result) result = value;
  }
  return result;
}

/**
 * 즉시 평가 함수 구현 테이블 — 지연 평가가 필요한 IF·AND·OR는 evaluator가 직접 처리한다.
 *
 * @remarks
 * `origins[i]`는 `args[i]`가 참조를 통해 데이터에서 왔는지다. 오류를 일으킨 값의 출처를 함께
 * 넘겨야, 편집기가 「샘플 값만 잘못됨」과 「수식이 잘못됨」을 가를 수 있다.
 */
export const BUILTIN_FUNCTIONS: Record<
  string,
  (args: FormulaValue[], ctx: FormulaContext, origins: readonly boolean[]) => FormulaValue
> = {
  // --- 집계 ---
  SUM: (args, _ctx, origins) => collectNumbers(args, origins).reduce((a, b) => a + b, 0),
  AVG: (args, _ctx, origins) => {
    const numbers = collectNumbers(args, origins);
    if (numbers.length === 0) throw new FormulaEvalError(fm().avgEmpty(), 'data');
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  },
  /** 빈 값(null·'')을 제외한 항목 수 */
  COUNT: (args) => flatten(args).filter((v) => v !== null && v !== '').length,
  MIN: (args, _ctx, origins) => extremum(collectNumbers(args, origins), 'min'),
  MAX: (args, _ctx, origins) => extremum(collectNumbers(args, origins), 'max'),

  // --- 조건부 집계 ---
  SUMIF: (args, _ctx, origins) => {
    arity('SUMIF', args);
    const [range, criterion, sumRange] = args;
    const test = makeCriteria(criterion ?? null, origins[1] === true);
    const testValues = flatten([range ?? null]);
    const sumValues = sumRange === undefined ? testValues : flatten([sumRange]);
    if (sumRange !== undefined && sumValues.length !== testValues.length) {
      throw new FormulaEvalError(fm().sumifLengthMismatch(), 'data');
    }
    // 더하는 값은 합계 범위가 있으면 그 인자에서, 없으면 검사 범위 인자에서 온다.
    const sumFromData = (sumRange === undefined ? origins[0] : origins[2]) === true;
    let total = 0;
    testValues.forEach((value, index) => {
      if (!test(value)) return;
      const target = sumValues[index] ?? null;
      if (target === null || target === '') return;
      total += toNumber(target, 'sumifTarget', sumFromData);
    });
    return total;
  },
  COUNTIF: (args, _ctx, origins) => {
    arity('COUNTIF', args);
    const test = makeCriteria(args[1] ?? null, origins[1] === true);
    return flatten([args[0] ?? null]).filter(test).length;
  },

  // --- 산술 ---
  ROUND: (args, _ctx, origins) => roundArg(args, origins, 'ROUND', 'round'),
  FLOOR: (args, _ctx, origins) => roundArg(args, origins, 'FLOOR', 'floor'),
  CEIL: (args, _ctx, origins) => roundArg(args, origins, 'CEIL', 'ceil'),
  ABS: (args, _ctx, origins) => {
    arity('ABS', args);
    return Math.abs(toNumber(args[0] ?? null, 'value', origins[0] === true));
  },

  // --- 문자열 ---
  CONCAT: (args, _ctx, origins) => args.map((value, index) => toText(value, origins[index] === true)).join(''),
  LEFT: (args, _ctx, origins) => {
    arity('LEFT', args);
    const count = args.length > 1 ? requireInt(args[1] ?? null, 'charCount', origins[1] === true) : 1;
    return [...toText(args[0] ?? null, origins[0] === true)].slice(0, Math.max(0, count)).join('');
  },
  RIGHT: (args, _ctx, origins) => {
    arity('RIGHT', args);
    const count = args.length > 1 ? requireInt(args[1] ?? null, 'charCount', origins[1] === true) : 1;
    const chars = [...toText(args[0] ?? null, origins[0] === true)];
    return count <= 0 ? '' : chars.slice(-count).join('');
  },
  /** MID(문자열, 시작(1-기반), 길이) */
  MID: (args, _ctx, origins) => {
    arity('MID', args);
    const start = requireInt(args[1] ?? null, 'startPosition', origins[1] === true);
    const length = requireInt(args[2] ?? null, 'length', origins[2] === true);
    if (start < 1) throw valueError(fm().midStartTooSmall(), origins[1] === true);
    return [...toText(args[0] ?? null, origins[0] === true)]
      .slice(start - 1, start - 1 + Math.max(0, length)).join('');
  },
  /** REPLACE(문자열, 찾을 문자열, 바꿀 문자열) — 모든 일치를 치환 */
  REPLACE: (args, _ctx, origins) => {
    arity('REPLACE', args);
    const text = toText(args[0] ?? null, origins[0] === true);
    const search = toText(args[1] ?? null, origins[1] === true);
    if (search === '') return text;
    return text.split(search).join(toText(args[2] ?? null, origins[2] === true));
  },
  TRIM: (args, _ctx, origins) => {
    arity('TRIM', args);
    return toText(args[0] ?? null, origins[0] === true).trim();
  },
  UPPER: (args, _ctx, origins) => {
    arity('UPPER', args);
    return toText(args[0] ?? null, origins[0] === true).toUpperCase();
  },
  LOWER: (args, _ctx, origins) => {
    arity('LOWER', args);
    return toText(args[0] ?? null, origins[0] === true).toLowerCase();
  },

  // --- 포맷 ---
  /** FORMAT_NUMBER(수, 소수 자릿수?) — 자릿수 구분 표기. 로케일은 컨텍스트로 지정  */
  FORMAT_NUMBER: (args, ctx, origins) => {
    arity('FORMAT_NUMBER', args);
    const n = toNumber(args[0] ?? null, 'value', origins[0] === true);
    const locale = ctx.locale ?? 'en-US';
    if (args.length > 1) {
      const digits = requireInt(args[1] ?? null, 'fractionDigits', origins[1] === true);
      if (digits < 0 || digits > 20) throw valueError(fm().fractionDigitsRange(), origins[1] === true);
      return n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    return n.toLocaleString(locale, { maximumFractionDigits: 20 });
  },
  /** FORMAT_DATE(날짜, 패턴? = "YYYY-MM-DD") — 토큰: YYYY YY MM M DD D HH mm ss */
  FORMAT_DATE: (args, _ctx, origins) => {
    arity('FORMAT_DATE', args);
    return formatDate(
      parseDate(args[0] ?? null, 'date', origins[0] === true),
      args.length > 1 ? toText(args[1] ?? null, origins[1] === true) : 'YYYY-MM-DD',
    );
  },
  NUMBER_TO_KOREAN: (args, _ctx, origins) => {
    arity('NUMBER_TO_KOREAN', args);
    return numberToKorean(toNumber(args[0] ?? null, 'value', origins[0] === true), origins[0] === true);
  },

  // --- 날짜 ---
  TODAY: (args, ctx) => {
    arity('TODAY', args);
    return toIsoDate(ctx.now ?? new Date());
  },
  /** DATE_ADD(날짜, 증감량, 단위? = "days") */
  DATE_ADD: (args, _ctx, origins) => {
    arity('DATE_ADD', args);
    const date = parseDate(args[0] ?? null, 'date', origins[0] === true);
    const amount = requireInt(args[1] ?? null, 'amountDelta', origins[1] === true);
    const unit = toDateUnit(args.length > 2 ? (args[2] ?? null) : null, origins[2] === true);
    if (unit === 'days') {
      date.setUTCDate(date.getUTCDate() + amount);
    } else {
      // 월·해 가감은 대상 달의 마지막 날로 맞춘다 — setUTCMonth는 짧은 달에서 다음 달로
      // 넘어가므로(1/31 + 1개월 → 3/3), 원래 일을 대상 달 말일로 클램프한다(EDATE 방식).
      const day = date.getUTCDate();
      date.setUTCDate(1);
      if (unit === 'months') date.setUTCMonth(date.getUTCMonth() + amount);
      else date.setUTCFullYear(date.getUTCFullYear() + amount);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
    }
    return toIsoDate(date);
  },
  /** DATE_DIFF(시작, 끝, 단위? = "days") — 끝 - 시작 */
  DATE_DIFF: (args, _ctx, origins) => {
    arity('DATE_DIFF', args);
    const start = parseDate(args[0] ?? null, 'startDate', origins[0] === true);
    const end = parseDate(args[1] ?? null, 'endDate', origins[1] === true);
    const unit = toDateUnit(args.length > 2 ? (args[2] ?? null) : null, origins[2] === true);
    if (unit === 'days') return Math.trunc((end.getTime() - start.getTime()) / 86_400_000);
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
    const adjust = end.getUTCDate() < start.getUTCDate() ? (months >= 0 ? -1 : 0) : months < 0 && end.getUTCDate() > start.getUTCDate() ? 1 : 0;
    const fullMonths = months + adjust;
    return unit === 'months' ? fullMonths : Math.trunc(fullMonths / 12);
  },

  // --- 세무 ---
  /** VAT(공급가액, 세율? = 10) — 부가세액. 절사·반올림은 ROUND/FLOOR와 조합해 지정한다 */
  VAT: (args, _ctx, origins) => {
    arity('VAT', args);
    const amount = toNumber(args[0] ?? null, 'supplyAmount', origins[0] === true);
    const rate = args.length > 1 ? toNumber(args[1] ?? null, 'taxRate', origins[1] === true) : 10;
    if (rate < 0) throw valueError(fm().vatRateNegative(), origins[1] === true);
    return (amount * rate) / 100;
  },

  // --- 타입 변환  ---
  /** TO_NUMBER(값) — 글자·논리를 숫자로. 빈 값·빈 문자열은 0, 숫자로 볼 수 없으면 오류 */
  TO_NUMBER: (args, _ctx, origins) => {
    arity('TO_NUMBER', args);
    return coerceToNumber(args[0] ?? null, origins[0] === true);
  },
  /** TO_STRING(값) — 숫자·논리·빈 값을 글자로. 범위는 바꿀 수 없다 */
  TO_STRING: (args, _ctx, origins) => {
    arity('TO_STRING', args);
    return toText(args[0] ?? null, origins[0] === true);
  },
  /** TO_DATE(값) — 날짜 문자열을 검증해 ISO(YYYY-MM-DD)로 정규화한다 */
  TO_DATE: (args, _ctx, origins) => {
    arity('TO_DATE', args);
    return toIsoDate(parseDate(args[0] ?? null, 'date', origins[0] === true));
  },
};
