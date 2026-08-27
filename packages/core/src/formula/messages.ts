/**
 * 사용자에게 표시하는 수식 파싱·평가 메시지를 언어별로 정의한다.
 *
 * 파싱과 평가는 동기로 실행된다. 진입점은 {@link withFormulaLocale}에서 언어를
 * 선택하고, 내부 코드는 {@link fm}에서 해당 메시지 사전을 읽는다.
 * 이 방식은 비동기 코드에 사용하지 않는다.
 */
import { resolveMessageLocale, type MessageLocale } from '../i18n.js';

/** 오류가 발생한 값을 언어별 명사구로 표시하기 위한 키 */
export type FormulaSubject =
  | 'value'
  | 'addOperand'
  | 'subtractOperand'
  | 'multiplyOperand'
  | 'divideOperand'
  | 'signOperand'
  | 'aggregateTarget'
  | 'sumifTarget'
  | 'digits'
  | 'fractionDigits'
  | 'charCount'
  | 'startPosition'
  | 'length'
  | 'amountDelta'
  | 'supplyAmount'
  | 'taxRate'
  | 'date'
  | 'startDate'
  | 'endDate';

/** 범위를 쓸 수 없는 자리를 가리키는 키 */
export type FormulaPlace =
  | { kind: 'operator'; operator: string }
  | { kind: 'sign' }
  | { kind: 'ifCondition' }
  | { kind: 'functionArg'; name: string };

interface FormulaMessages {
  // 파서
  invalidNumberFormat(): string;
  numberTooLarge(): string;
  unterminatedString(): string;
  unknownCharacter(ch: string): string;
  trailingContent(): string;
  expectedClosingParen(): string;
  formulaTooDeep(max: number): string;
  unknownFunction(name: string): string;
  expectedFieldAfterDot(): string;
  expectedValue(): string;
  emptyFormula(): string;
  formulaTooLong(max: number): string;
  // 평가기
  valueDepthExceeded(max: number): string;
  notAnObject(prefix: string, segment: string): string;
  objectValueNotUsable(): string;
  rangeNotAllowed(place: FormulaPlace): string;
  divideByZero(): string;
  comparisonTypeMismatch(operator: string): string;
  arity(name: string, min: number, max: number): string;
  arityAtLeastOne(name: string): string;
  notImplementedFunction(name: string): string;
  // 값 변환
  emptyValueLabel(): string;
  rangeLabel(): string;
  numberNotFinite(subject: FormulaSubject): string;
  mustBeNumber(subject: FormulaSubject, shown: string): string;
  mustBeInteger(subject: FormulaSubject): string;
  valueNotFinite(): string;
  toNumberRange(): string;
  toNumberNotFinite(): string;
  toNumberInvalid(shown: string): string;
  rangeToText(): string;
  conditionRequired(shown: string): string;
  criteriaRange(): string;
  // 날짜
  dateNotReal(subject: FormulaSubject, shown: string): string;
  dateInvalid(subject: FormulaSubject, shown: string): string;
  dateUnitInvalid(shown: string): string;
  // 개별 함수
  avgEmpty(): string;
  sumifLengthMismatch(): string;
  midStartTooSmall(): string;
  fractionDigitsRange(): string;
  vatRateNegative(): string;
  numberToKoreanInteger(): string;
  numberToKoreanRange(): string;
}

const EN_SUBJECTS: Record<FormulaSubject, string> = {
  value: 'The value',
  addOperand: 'The addition operand',
  subtractOperand: 'The subtraction operand',
  multiplyOperand: 'The multiplication operand',
  divideOperand: 'The division operand',
  signOperand: 'The sign operand',
  aggregateTarget: 'The aggregated value',
  sumifTarget: 'The SUMIF sum value',
  digits: 'The digit count',
  fractionDigits: 'The fraction digit count',
  charCount: 'The character count',
  startPosition: 'The start position',
  length: 'The length',
  amountDelta: 'The amount to add',
  supplyAmount: 'The supply amount',
  taxRate: 'The tax rate',
  date: 'The date',
  startDate: 'The start date',
  endDate: 'The end date',
};

const KO_SUBJECTS: Record<FormulaSubject, string> = {
  value: '값',
  addOperand: '더하기 대상',
  subtractOperand: '빼기 대상',
  multiplyOperand: '곱하기 대상',
  divideOperand: '나누기 대상',
  signOperand: '부호 연산 대상',
  aggregateTarget: '집계 대상',
  sumifTarget: 'SUMIF 합계 대상',
  digits: '자릿수',
  fractionDigits: '소수 자릿수',
  charCount: '글자 수',
  startPosition: '시작 위치',
  length: '길이',
  amountDelta: '증감량',
  supplyAmount: '공급가액',
  taxRate: '세율',
  date: '날짜',
  startDate: '시작 날짜',
  endDate: '끝 날짜',
};

const JA_SUBJECTS: Record<FormulaSubject, string> = {
  value: '値',
  addOperand: '加算の対象',
  subtractOperand: '減算の対象',
  multiplyOperand: '乗算の対象',
  divideOperand: '除算の対象',
  signOperand: '符号演算の対象',
  aggregateTarget: '集計の対象',
  sumifTarget: 'SUMIF の合計対象',
  digits: '桁数',
  fractionDigits: '小数の桁数',
  charCount: '文字数',
  startPosition: '開始位置',
  length: '長さ',
  amountDelta: '増減量',
  supplyAmount: '供給価額',
  taxRate: '税率',
  date: '日付',
  startDate: '開始日',
  endDate: '終了日',
};

function enPlace(place: FormulaPlace): string {
  switch (place.kind) {
    case 'operator': return `the '${place.operator}' operator`;
    case 'sign': return 'the sign operator';
    case 'ifCondition': return 'the IF condition';
    case 'functionArg': return `a ${place.name} argument`;
  }
}

function koPlace(place: FormulaPlace): string {
  switch (place.kind) {
    case 'operator': return `'${place.operator}' 연산`;
    case 'sign': return '부호 연산';
    case 'ifCondition': return 'IF 조건';
    case 'functionArg': return `${place.name} 인자`;
  }
}

function jaPlace(place: FormulaPlace): string {
  switch (place.kind) {
    case 'operator': return `'${place.operator}' 演算`;
    case 'sign': return '符号演算';
    case 'ifCondition': return 'IF の条件';
    case 'functionArg': return `${place.name} の引数`;
  }
}

const EN: FormulaMessages = {
  invalidNumberFormat: () => 'Invalid number format',
  numberTooLarge: () => 'Number is too large',
  unterminatedString: () => 'String is not closed',
  unknownCharacter: (ch) => `Unknown character: '${ch}'`,
  trailingContent: () => 'Unexpected content at the end of the formula',
  expectedClosingParen: () => 'A closing parenthesis is required',
  formulaTooDeep: (max) => `Formula nesting is too deep (max ${max} levels)`,
  unknownFunction: (name) => `Unsupported function: ${name}`,
  expectedFieldAfterDot: () => `A field name must follow '.'`,
  expectedValue: () => 'A value, reference, or function is required',
  emptyFormula: () => 'The formula is empty',
  formulaTooLong: (max) => `The formula is too long (max ${max} characters)`,
  valueDepthExceeded: (max) => `Value nesting exceeds the limit (${max})`,
  notAnObject: (prefix, segment) => `'${prefix}' is not an object, so '.${segment}' cannot be read`,
  objectValueNotUsable: () => 'Object values cannot be used directly in a formula (reference a subfield)',
  rangeNotAllowed: (place) => `A range cannot be used directly in ${enPlace(place)} (use an aggregate function such as SUM)`,
  divideByZero: () => 'Cannot divide by zero',
  comparisonTypeMismatch: (operator) => `The '${operator}' comparison only works between numbers or between strings`,
  arity: (name, min, max) => `The ${name} function takes ${min === max ? String(min) : `${min}-${max}`} argument${max === 1 ? '' : 's'}`,
  arityAtLeastOne: (name) => `The ${name} function requires at least one argument`,
  notImplementedFunction: (name) => `Function is not implemented: ${name}`,
  emptyValueLabel: () => '(empty)',
  rangeLabel: () => '(range)',
  numberNotFinite: (subject) => `${EN_SUBJECTS[subject]} is not a finite number`,
  mustBeNumber: (subject, shown) => `${EN_SUBJECTS[subject]} must be a number (use TO_NUMBER to convert text): ${shown}`,
  mustBeInteger: (subject) => `${EN_SUBJECTS[subject]} must be an integer`,
  valueNotFinite: () => 'The value is not a finite number',
  toNumberRange: () => 'TO_NUMBER: a range cannot be converted to a number',
  toNumberNotFinite: () => 'TO_NUMBER: the value is not a finite number',
  toNumberInvalid: (shown) => `TO_NUMBER: cannot convert to a number: ${shown}`,
  rangeToText: () => 'A range cannot be converted to a string',
  conditionRequired: (shown) => `The condition must be a logical value: ${shown}`,
  criteriaRange: () => 'A range cannot be used as a criterion',
  dateNotReal: (subject, shown) => `${EN_SUBJECTS[subject]} is not a real calendar date: ${shown}`,
  dateInvalid: (subject, shown) => `${EN_SUBJECTS[subject]} must be an ISO-format string (such as YYYY-MM-DD): ${shown}`,
  dateUnitInvalid: (shown) => `The date unit must be one of days/months/years: ${shown}`,
  avgEmpty: () => 'AVG: there are no values to average',
  sumifLengthMismatch: () => 'SUMIF: the criteria range and the sum range have different lengths',
  midStartTooSmall: () => 'MID: the start position must be 1 or greater',
  fractionDigitsRange: () => 'The fraction digit count must be between 0 and 20',
  vatRateNegative: () => 'VAT: the tax rate must be 0 or greater',
  numberToKoreanInteger: () => 'NUMBER_TO_KOREAN only supports integers',
  numberToKoreanRange: () => 'NUMBER_TO_KOREAN: the number is out of the supported range',
};

const KO: FormulaMessages = {
  invalidNumberFormat: () => '숫자 형식이 잘못되었습니다',
  numberTooLarge: () => '숫자가 너무 큽니다',
  unterminatedString: () => '문자열이 닫히지 않았습니다',
  unknownCharacter: (ch) => `알 수 없는 문자입니다: '${ch}'`,
  trailingContent: () => '수식 끝에 해석할 수 없는 내용이 있습니다',
  expectedClosingParen: () => '닫는 괄호가 필요합니다',
  formulaTooDeep: (max) => `수식 중첩이 허용 범위(${max}단계)를 초과했습니다`,
  unknownFunction: (name) => `지원하지 않는 함수입니다: ${name}`,
  expectedFieldAfterDot: () => "'.' 뒤에는 필드 이름이 와야 합니다",
  expectedValue: () => '값, 참조 또는 함수가 필요합니다',
  emptyFormula: () => '빈 수식입니다',
  formulaTooLong: (max) => `수식 길이가 허용 범위(${max}자)를 초과했습니다`,
  valueDepthExceeded: (max) => `값의 중첩이 허용 깊이(${max})를 초과했습니다`,
  notAnObject: (prefix, segment) =>
    `'${prefix}'에서 '.${segment}'를 읽을 수 없습니다. '${prefix}'의 값이 객체가 아닙니다`,
  objectValueNotUsable: () => '객체 값은 수식에서 직접 사용할 수 없습니다. 하위 필드를 참조하세요',
  rangeNotAllowed: (place) => `${koPlace(place)}에 범위를 직접 사용할 수 없습니다. SUM 등의 집계 함수를 사용하세요`,
  divideByZero: () => '0으로 나눌 수 없습니다',
  comparisonTypeMismatch: (operator) =>
    `'${operator}' 비교 연산은 두 값이 모두 숫자이거나 모두 문자열일 때만 사용할 수 있습니다`,
  arity: (name, min, max) => `${name} 함수의 인자는 ${min === max ? `${min}개` : `${min}~${max}개`}여야 합니다`,
  arityAtLeastOne: (name) => `${name} 함수의 인자는 1개 이상이어야 합니다`,
  notImplementedFunction: (name) => `구현되지 않은 함수입니다: ${name}`,
  emptyValueLabel: () => '(빈 값)',
  rangeLabel: () => '(범위)',
  numberNotFinite: (subject) => `${KO_SUBJECTS[subject]}: 유한한 수가 아닙니다`,
  mustBeNumber: (subject, shown) =>
    `${KO_SUBJECTS[subject]}: 숫자가 필요합니다. 문자열은 TO_NUMBER로 변환하세요. 현재 값: ${shown}`,
  mustBeInteger: (subject) => `${KO_SUBJECTS[subject]}: 정수여야 합니다`,
  valueNotFinite: () => '값이 유한한 수가 아닙니다',
  toNumberRange: () => 'TO_NUMBER: 범위는 숫자로 바꿀 수 없습니다',
  toNumberNotFinite: () => 'TO_NUMBER: 값이 유한한 수가 아닙니다',
  toNumberInvalid: (shown) => `TO_NUMBER: 숫자로 바꿀 수 없습니다: ${shown}`,
  rangeToText: () => '범위는 문자열로 변환할 수 없습니다',
  conditionRequired: (shown) => `조건은 논리값이어야 합니다. 현재 값: ${shown}`,
  criteriaRange: () => '조건에는 범위를 쓸 수 없습니다',
  dateNotReal: (subject, shown) => `${KO_SUBJECTS[subject]}: 존재하지 않는 날짜입니다. 현재 값: ${shown}`,
  dateInvalid: (subject, shown) =>
    `${KO_SUBJECTS[subject]}: ISO 형식(예: YYYY-MM-DD)의 문자열이어야 합니다. 현재 값: ${shown}`,
  dateUnitInvalid: (shown) => `날짜 단위는 days, months, years 중 하나여야 합니다. 현재 값: ${shown}`,
  avgEmpty: () => 'AVG: 평균을 낼 값이 없습니다',
  sumifLengthMismatch: () => 'SUMIF: 조건 범위와 합계 범위의 길이가 다릅니다',
  midStartTooSmall: () => 'MID: 시작 위치는 1 이상이어야 합니다',
  fractionDigitsRange: () => '소수 자릿수는 0~20이어야 합니다',
  vatRateNegative: () => 'VAT: 세율은 0 이상이어야 합니다',
  numberToKoreanInteger: () => 'NUMBER_TO_KOREAN은 정수만 지원합니다',
  numberToKoreanRange: () => '값이 NUMBER_TO_KOREAN의 지원 범위를 벗어났습니다',
};

const JA: FormulaMessages = {
  invalidNumberFormat: () => '数値の形式が正しくありません',
  numberTooLarge: () => '数値が大きすぎます',
  unterminatedString: () => '文字列が閉じられていません',
  unknownCharacter: (ch) => `不明な文字です: '${ch}'`,
  trailingContent: () => '数式の末尾に解釈できない内容があります',
  expectedClosingParen: () => '閉じ括弧が必要です',
  formulaTooDeep: (max) => `数式のネストが深すぎます（最大 ${max} 段階）`,
  unknownFunction: (name) => `サポートされていない関数です: ${name}`,
  expectedFieldAfterDot: () => `'.' の後にはフィールド名が必要です`,
  expectedValue: () => '値・参照・関数が必要です',
  emptyFormula: () => '数式が空です',
  formulaTooLong: (max) => `数式が長すぎます（最大 ${max} 文字）`,
  valueDepthExceeded: (max) => `値のネストの深さが上限（${max}）を超えました`,
  notAnObject: (prefix, segment) => `'${prefix}' はオブジェクトではないため '.${segment}' を読み取れません`,
  objectValueNotUsable: () => 'オブジェクト値は数式で直接使えません（サブフィールドを参照してください）',
  rangeNotAllowed: (place) => `${jaPlace(place)}に範囲を直接使えません（SUM などの集計関数を使ってください）`,
  divideByZero: () => '0 で割ることはできません',
  comparisonTypeMismatch: (operator) => `'${operator}' の比較は数値同士または文字列同士でのみ可能です`,
  arity: (name, min, max) => `${name} 関数の引数は ${min === max ? `${min} 個` : `${min}~${max} 個`}でなければなりません`,
  arityAtLeastOne: (name) => `${name} 関数の引数は 1 個以上でなければなりません`,
  notImplementedFunction: (name) => `実装されていない関数です: ${name}`,
  emptyValueLabel: () => '（空の値）',
  rangeLabel: () => '（範囲）',
  numberNotFinite: (subject) => `${JA_SUBJECTS[subject]}が有限の数ではありません`,
  mustBeNumber: (subject, shown) => `${JA_SUBJECTS[subject]}は数値でなければなりません（文字は TO_NUMBER で変換してください）: ${shown}`,
  mustBeInteger: (subject) => `${JA_SUBJECTS[subject]}は整数でなければなりません`,
  valueNotFinite: () => '値が有限の数ではありません',
  toNumberRange: () => 'TO_NUMBER: 範囲は数値に変換できません',
  toNumberNotFinite: () => 'TO_NUMBER: 値が有限の数ではありません',
  toNumberInvalid: (shown) => `TO_NUMBER: 数値に変換できません: ${shown}`,
  rangeToText: () => '範囲は文字列に変換できません',
  conditionRequired: (shown) => `条件は論理値でなければなりません: ${shown}`,
  criteriaRange: () => '条件に範囲は使えません',
  dateNotReal: (subject, shown) => `${JA_SUBJECTS[subject]}が実在する日付ではありません: ${shown}`,
  dateInvalid: (subject, shown) => `${JA_SUBJECTS[subject]}は ISO 形式（YYYY-MM-DD など）の文字列でなければなりません: ${shown}`,
  dateUnitInvalid: (shown) => `日付の単位は days/months/years のいずれかでなければなりません: ${shown}`,
  avgEmpty: () => 'AVG: 平均を求める値がありません',
  sumifLengthMismatch: () => 'SUMIF: 条件範囲と合計範囲の長さが異なります',
  midStartTooSmall: () => 'MID: 開始位置は 1 以上でなければなりません',
  fractionDigitsRange: () => '小数の桁数は 0~20 でなければなりません',
  vatRateNegative: () => 'VAT: 税率は 0 以上でなければなりません',
  numberToKoreanInteger: () => 'NUMBER_TO_KOREAN は整数のみ対応しています',
  numberToKoreanRange: () => 'NUMBER_TO_KOREAN の対応範囲を超えました',
};

const CATALOG: Record<MessageLocale, FormulaMessages> = { en: EN, ko: KO, ja: JA };

// 동기 실행 중 사용할 메시지 사전을 모듈 상태로 유지한다.
let current: FormulaMessages = EN;

/**
 * 지정한 로케일의 메시지 사전을 사용해 함수를 실행한다. 실행 후에는 이전 사전으로 복원한다.
 *
 * @param locale - BCP 47 로케일 (생략하면 현재 메시지 사전 유지)
 * @param fn - 실행할 동기 함수
 * @returns `fn`의 반환값
 */
export function withFormulaLocale<T>(locale: string | undefined, fn: () => T): T {
  if (locale === undefined) return fn();
  const previous = current;
  current = CATALOG[resolveMessageLocale(locale)];
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** 현재 선택된 수식 메시지 사전 */
export function fm(): FormulaMessages {
  return current;
}
