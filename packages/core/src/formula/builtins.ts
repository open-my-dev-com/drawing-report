/**
 * v1 수식 함수 29종 구현 (ADR-017).
 * IF·AND·OR는 지연 평가가 필요해 evaluator에서 특수 처리한다 — 여기 없음.
 */
import { FormulaEvalError } from './errors.js';

/** 수식 런타임 값. 배열은 범위(참조가 배열 데이터를 가리킬 때)로 취급된다. */
export type FormulaValue = number | string | boolean | null | FormulaValue[];

/** 수식 평가에 주입되는 실행 문맥 */
export interface FormulaContext {
  /** 전표 values — 참조(path)가 여기서 해소된다 */
  values: Record<string, unknown>;
  /**
   * TODAY() 기준 시각. 테스트·재현용 주입 지점.
   *
   * @defaultValue 호출 시점의 현재 시각
   */
  now?: Date;
  /**
   * FORMAT_NUMBER 등 포맷 함수의 로케일 (BCP-47) — ADR-013.
   *
   * @defaultValue `'ko-KR'`
   */
  locale?: string;
}

// ---------------------------------------------------------------------------
// 값 변환 헬퍼
// ---------------------------------------------------------------------------

function describe(value: FormulaValue): string {
  if (value === null) return '(빈 값)';
  if (Array.isArray(value)) return '(범위)';
  return JSON.stringify(value);
}

/**
 * 값을 숫자로 강제 변환한다 — 숫자 문자열 허용, 빈 값은 0.
 *
 * @param value 변환할 수식 값
 * @param what 오류 메시지에 쓸 대상 이름 (예: '집계 대상')
 * @returns 변환된 숫자
 * @throws FormulaEvalError 숫자로 볼 수 없는 값이면
 */
export function toNumber(value: FormulaValue, what = '값'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FormulaEvalError(`${what}이(가) 유한한 수가 아닙니다`);
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (value === null) return 0;
  throw new FormulaEvalError(`${what}은(는) 숫자여야 합니다: ${describe(value)}`);
}

function toText(value: FormulaValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  throw new FormulaEvalError('범위는 문자열로 변환할 수 없습니다');
}

/**
 * 값을 조건(논리값)으로 강제 변환한다 — 숫자는 0이 아니면 참, 빈 값은 거짓.
 *
 * @param value 변환할 수식 값
 * @returns 변환된 논리값
 * @throws FormulaEvalError 문자열·범위 등 논리값으로 볼 수 없는 값이면
 */
export function toCondition(value: FormulaValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null) return false;
  throw new FormulaEvalError(`조건은 논리값이어야 합니다: ${describe(value)}`);
}

function requireInt(value: FormulaValue, what: string): number {
  const n = toNumber(value, what);
  if (!Number.isInteger(n)) throw new FormulaEvalError(`${what}은(는) 정수여야 합니다`);
  return n;
}

/** 범위·스칼라 인자들을 평탄화해 집계 대상 숫자 목록으로 만든다. 빈 값은 건너뛴다. */
function collectNumbers(args: FormulaValue[]): number[] {
  const out: number[] = [];
  const visit = (value: FormulaValue): void => {
    if (value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    out.push(toNumber(value, '집계 대상'));
  };
  args.forEach(visit);
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
// SUMIF/COUNTIF 조건 ("&gt;=10", "&lt;&gt;완료", "지급" 등 엑셀 스타일)
// ---------------------------------------------------------------------------

/** 범위가 아닌 단일 수식 값 */
export type Scalar = number | string | boolean | null;

function makeCriteria(criterion: FormulaValue): (value: Scalar) => boolean {
  if (Array.isArray(criterion)) throw new FormulaEvalError('조건에는 범위를 쓸 수 없습니다');
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

function parseDate(value: FormulaValue, what = '날짜'): Date {
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new FormulaEvalError(`${what}은(는) ISO 형식(YYYY-MM-DD 등) 문자열이어야 합니다: ${describe(value)}`);
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

function toDateUnit(value: FormulaValue): DateUnit {
  const unit = value === null ? 'days' : toText(value);
  if (unit === 'days' || unit === 'months' || unit === 'years') return unit;
  throw new FormulaEvalError(`날짜 단위는 days/months/years 중 하나여야 합니다: ${describe(value)}`);
}

// ---------------------------------------------------------------------------
// 금액 한글 표기 (NUMBER_TO_KOREAN)
// ---------------------------------------------------------------------------

const KOREAN_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNITS = ['', '십', '백', '천'];
const GROUP_UNITS = ['', '만', '억', '조', '경'];

/** 금액 위변조 방지 관례에 따라 십/백/천 앞에도 '일'을 쓴다 (예: 110 → 일백일십) */
function numberToKorean(n: number): string {
  if (!Number.isInteger(n)) throw new FormulaEvalError('NUMBER_TO_KOREAN은 정수만 지원합니다');
  if (n === 0) return '영';
  const sign = n < 0 ? '마이너스' : '';
  let abs = Math.abs(n);
  if (abs >= 1e20) throw new FormulaEvalError('NUMBER_TO_KOREAN 지원 범위를 넘었습니다');
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
// 함수 테이블 (지연 평가가 필요한 IF/AND/OR 제외 26종)
// ---------------------------------------------------------------------------

function arity(name: string, args: FormulaValue[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const range = min === max ? `${min}개` : `${min}~${max}개`;
    throw new FormulaEvalError(`${name} 함수의 인자는 ${range}여야 합니다`);
  }
}

function roundTo(n: number, digits: number, mode: 'round' | 'floor' | 'ceil'): number {
  const factor = 10 ** digits;
  const scaled = n * factor;
  // 부동소수점 오차 보정 (예: 1.005 * 100 = 100.49999...)
  const corrected = Number(scaled.toPrecision(12));
  const fn = mode === 'round' ? Math.round : mode === 'floor' ? Math.floor : Math.ceil;
  return fn(corrected) / factor;
}

/** 즉시 평가 함수 구현 테이블 — 지연 평가가 필요한 IF·AND·OR는 evaluator가 직접 처리한다 */
export const BUILTIN_FUNCTIONS: Record<string, (args: FormulaValue[], ctx: FormulaContext) => FormulaValue> = {
  // --- 집계 ---
  SUM: (args) => collectNumbers(args).reduce((a, b) => a + b, 0),
  AVG: (args) => {
    const numbers = collectNumbers(args);
    if (numbers.length === 0) throw new FormulaEvalError('AVG: 평균을 낼 값이 없습니다');
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  },
  /** 빈 값(null·'')을 제외한 항목 수 */
  COUNT: (args) => flatten(args).filter((v) => v !== null && v !== '').length,
  MIN: (args) => {
    const numbers = collectNumbers(args);
    return numbers.length === 0 ? 0 : Math.min(...numbers);
  },
  MAX: (args) => {
    const numbers = collectNumbers(args);
    return numbers.length === 0 ? 0 : Math.max(...numbers);
  },

  // --- 조건부 집계 ---
  SUMIF: (args) => {
    arity('SUMIF', args, 2, 3);
    const [range, criterion, sumRange] = args;
    const test = makeCriteria(criterion ?? null);
    const testValues = flatten([range ?? null]);
    const sumValues = sumRange === undefined ? testValues : flatten([sumRange]);
    if (sumRange !== undefined && sumValues.length !== testValues.length) {
      throw new FormulaEvalError('SUMIF: 조건 범위와 합계 범위의 길이가 다릅니다');
    }
    let total = 0;
    testValues.forEach((value, index) => {
      if (!test(value)) return;
      const target = sumValues[index] ?? null;
      if (target === null || target === '') return;
      total += toNumber(target, 'SUMIF 합계 대상');
    });
    return total;
  },
  COUNTIF: (args) => {
    arity('COUNTIF', args, 2);
    const test = makeCriteria(args[1] ?? null);
    return flatten([args[0] ?? null]).filter(test).length;
  },

  // --- 산술 ---
  ROUND: (args) => {
    arity('ROUND', args, 1, 2);
    return roundTo(toNumber(args[0] ?? null), args.length > 1 ? requireInt(args[1] ?? null, '자릿수') : 0, 'round');
  },
  FLOOR: (args) => {
    arity('FLOOR', args, 1, 2);
    return roundTo(toNumber(args[0] ?? null), args.length > 1 ? requireInt(args[1] ?? null, '자릿수') : 0, 'floor');
  },
  CEIL: (args) => {
    arity('CEIL', args, 1, 2);
    return roundTo(toNumber(args[0] ?? null), args.length > 1 ? requireInt(args[1] ?? null, '자릿수') : 0, 'ceil');
  },
  ABS: (args) => {
    arity('ABS', args, 1);
    return Math.abs(toNumber(args[0] ?? null));
  },

  // --- 문자열 ---
  CONCAT: (args) => args.map(toText).join(''),
  LEFT: (args) => {
    arity('LEFT', args, 1, 2);
    const count = args.length > 1 ? requireInt(args[1] ?? null, '글자 수') : 1;
    return [...toText(args[0] ?? null)].slice(0, Math.max(0, count)).join('');
  },
  RIGHT: (args) => {
    arity('RIGHT', args, 1, 2);
    const count = args.length > 1 ? requireInt(args[1] ?? null, '글자 수') : 1;
    const chars = [...toText(args[0] ?? null)];
    return count <= 0 ? '' : chars.slice(-count).join('');
  },
  /** MID(문자열, 시작(1-기반), 길이) */
  MID: (args) => {
    arity('MID', args, 3);
    const start = requireInt(args[1] ?? null, '시작 위치');
    const length = requireInt(args[2] ?? null, '길이');
    if (start < 1) throw new FormulaEvalError('MID: 시작 위치는 1 이상이어야 합니다');
    return [...toText(args[0] ?? null)].slice(start - 1, start - 1 + Math.max(0, length)).join('');
  },
  /** REPLACE(문자열, 찾을 문자열, 바꿀 문자열) — 모든 일치를 치환 */
  REPLACE: (args) => {
    arity('REPLACE', args, 3);
    const search = toText(args[1] ?? null);
    if (search === '') return toText(args[0] ?? null);
    return toText(args[0] ?? null).split(search).join(toText(args[2] ?? null));
  },
  TRIM: (args) => {
    arity('TRIM', args, 1);
    return toText(args[0] ?? null).trim();
  },
  UPPER: (args) => {
    arity('UPPER', args, 1);
    return toText(args[0] ?? null).toUpperCase();
  },
  LOWER: (args) => {
    arity('LOWER', args, 1);
    return toText(args[0] ?? null).toLowerCase();
  },

  // --- 포맷 ---
  /** FORMAT_NUMBER(수, 소수 자릿수?) — 자릿수 구분 표기. 로케일은 컨텍스트로 지정 (ADR-013) */
  FORMAT_NUMBER: (args, ctx) => {
    arity('FORMAT_NUMBER', args, 1, 2);
    const n = toNumber(args[0] ?? null);
    const locale = ctx.locale ?? 'ko-KR';
    if (args.length > 1) {
      const digits = requireInt(args[1] ?? null, '소수 자릿수');
      if (digits < 0 || digits > 20) throw new FormulaEvalError('소수 자릿수는 0~20이어야 합니다');
      return n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    return n.toLocaleString(locale, { maximumFractionDigits: 20 });
  },
  /** FORMAT_DATE(날짜, 패턴? = "YYYY-MM-DD") — 토큰: YYYY YY MM M DD D HH mm ss */
  FORMAT_DATE: (args) => {
    arity('FORMAT_DATE', args, 1, 2);
    return formatDate(parseDate(args[0] ?? null), args.length > 1 ? toText(args[1] ?? null) : 'YYYY-MM-DD');
  },
  NUMBER_TO_KOREAN: (args) => {
    arity('NUMBER_TO_KOREAN', args, 1);
    return numberToKorean(toNumber(args[0] ?? null));
  },

  // --- 날짜 ---
  TODAY: (args, ctx) => {
    arity('TODAY', args, 0);
    return toIsoDate(ctx.now ?? new Date());
  },
  /** DATE_ADD(날짜, 증감량, 단위? = "days") */
  DATE_ADD: (args) => {
    arity('DATE_ADD', args, 2, 3);
    const date = parseDate(args[0] ?? null);
    const amount = requireInt(args[1] ?? null, '증감량');
    const unit = toDateUnit(args.length > 2 ? (args[2] ?? null) : null);
    if (unit === 'days') date.setUTCDate(date.getUTCDate() + amount);
    else if (unit === 'months') date.setUTCMonth(date.getUTCMonth() + amount);
    else date.setUTCFullYear(date.getUTCFullYear() + amount);
    return toIsoDate(date);
  },
  /** DATE_DIFF(시작, 끝, 단위? = "days") — 끝 - 시작 */
  DATE_DIFF: (args) => {
    arity('DATE_DIFF', args, 2, 3);
    const start = parseDate(args[0] ?? null, '시작 날짜');
    const end = parseDate(args[1] ?? null, '끝 날짜');
    const unit = toDateUnit(args.length > 2 ? (args[2] ?? null) : null);
    if (unit === 'days') return Math.trunc((end.getTime() - start.getTime()) / 86_400_000);
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
    const adjust = end.getUTCDate() < start.getUTCDate() ? (months >= 0 ? -1 : 0) : months < 0 && end.getUTCDate() > start.getUTCDate() ? 1 : 0;
    const fullMonths = months + adjust;
    return unit === 'months' ? fullMonths : Math.trunc(fullMonths / 12);
  },

  // --- 세무 ---
  /** VAT(공급가액, 세율? = 10) — 부가세액. 절사·반올림은 ROUND/FLOOR와 조합해 지정한다 */
  VAT: (args) => {
    arity('VAT', args, 1, 2);
    const amount = toNumber(args[0] ?? null, '공급가액');
    const rate = args.length > 1 ? toNumber(args[1] ?? null, '세율') : 10;
    if (rate < 0) throw new FormulaEvalError('VAT: 세율은 0 이상이어야 합니다');
    return (amount * rate) / 100;
  },
};
