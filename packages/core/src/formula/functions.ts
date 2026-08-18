/**
 * v1 수식 함수 스타터셋 (ADR-017).
 * 구현: builtins.ts (IF/AND/OR는 지연 평가라 evaluator.ts에서 처리).
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
] as const;

export type FormulaFunctionName = (typeof FORMULA_FUNCTIONS)[number];
