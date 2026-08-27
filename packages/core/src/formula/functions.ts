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
