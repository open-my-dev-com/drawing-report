/**
 * 지원하는 수식 함수 이름을 분류별로 정의한다.
 * `IF`, `AND`, `OR`는 단락 평가가 필요하므로 evaluator.ts에서 처리한다.
 */
export const FORMULA_FUNCTIONS = [
  // 집계
  'SUM', 'AVG', 'COUNT', 'MIN', 'MAX',
  // 조건부 집계
  'SUMIF', 'COUNTIF',
  // 산술
  'ROUND', 'FLOOR', 'CEIL', 'ABS',
  // 문자열
  'CONCAT', 'LEFT', 'RIGHT', 'MID', 'REPLACE', 'TRIM', 'UPPER', 'LOWER',
  // 조건
  'IF', 'AND', 'OR',
  // 포맷
  'FORMAT_NUMBER', 'FORMAT_DATE', 'NUMBER_TO_KOREAN',
  // 날짜
  'TODAY', 'DATE_ADD', 'DATE_DIFF',
  // 세무
  'VAT',
  // 타입 변환. 문자열과 숫자 사이의 변환은 명시적으로 요청해야 한다.
  'TO_NUMBER', 'TO_STRING', 'TO_DATE',
] as const;

/** 파서가 허용하는 수식 함수 이름의 집합. */
export type FormulaFunctionName = (typeof FORMULA_FUNCTIONS)[number];

/** 함수 하나가 받을 수 있는 인자 수. `max`가 없으면 개수에 상한이 없다. */
export interface FormulaArity {
  min: number;
  max?: number;
}

/**
 * 함수별 허용 인자 수의 단일 원천.
 *
 * 인자 수는 데이터와 무관한 규칙이므로, 값 없이도 잘못된 수식을 걸러낼 수 있다.
 * 평가기와 편집기가 같은 표를 본다.
 */
export const FORMULA_ARITY: Record<FormulaFunctionName, FormulaArity> = {
  // 집계 — 개수 제한 없이 값과 범위를 받는다.
  // AVG는 평균을 계산할 값이 최소 하나 필요합니다.
  SUM: { min: 0 },
  AVG: { min: 1 },
  COUNT: { min: 0 },
  MIN: { min: 0 },
  MAX: { min: 0 },
  SUMIF: { min: 2, max: 3 },
  COUNTIF: { min: 2, max: 2 },
  // 산술
  ROUND: { min: 1, max: 2 },
  FLOOR: { min: 1, max: 2 },
  CEIL: { min: 1, max: 2 },
  ABS: { min: 1, max: 1 },
  // 문자열
  CONCAT: { min: 0 },
  LEFT: { min: 1, max: 2 },
  RIGHT: { min: 1, max: 2 },
  MID: { min: 3, max: 3 },
  REPLACE: { min: 3, max: 3 },
  TRIM: { min: 1, max: 1 },
  UPPER: { min: 1, max: 1 },
  LOWER: { min: 1, max: 1 },
  // 조건 — AND·OR는 하나 이상이면 개수 제한이 없다
  IF: { min: 2, max: 3 },
  AND: { min: 1 },
  OR: { min: 1 },
  // 포맷
  FORMAT_NUMBER: { min: 1, max: 2 },
  FORMAT_DATE: { min: 1, max: 2 },
  NUMBER_TO_KOREAN: { min: 1, max: 1 },
  // 날짜
  TODAY: { min: 0, max: 0 },
  DATE_ADD: { min: 2, max: 3 },
  DATE_DIFF: { min: 2, max: 3 },
  // 세무
  VAT: { min: 1, max: 2 },
  // 타입 변환
  TO_NUMBER: { min: 1, max: 1 },
  TO_STRING: { min: 1, max: 1 },
  TO_DATE: { min: 1, max: 1 },
};
