/**
 * 수식 함수 도움말 리소스 (ADR-013/017) — 수식 편집 모달의 분류·설명·클릭 삽입에 쓴다.
 *
 * 함수 목록은 core의 `FORMULA_FUNCTIONS`(29종, ADR-017)와 일치해야 하며,
 * 테스트가 빠짐·초과를 잡는다. 새 함수를 core에 더하면 여기도 함께 채운다.
 */

/** 함수 하나의 도움말 — 이름·모달에 보여줄 사용법·한 줄 설명 */
export interface FormulaHelpEntry {
  name: string;
  /** 사용법 표기 (예: `SUM(범위, …)`) — 인자 이름은 UI 언어를 따른다 */
  signature: string;
  description: string;
}

/** 함수 분류 한 묶음 */
export interface FormulaHelpCategory {
  title: string;
  functions: FormulaHelpEntry[];
}

const ko: FormulaHelpCategory[] = [
  {
    title: '집계',
    functions: [
      { name: 'SUM', signature: 'SUM(범위, …)', description: '값·범위의 합계 (예: SUM(items.amount))' },
      { name: 'AVG', signature: 'AVG(범위, …)', description: '값·범위의 평균' },
      { name: 'COUNT', signature: 'COUNT(범위, …)', description: '빈 값을 뺀 항목 수' },
      { name: 'MIN', signature: 'MIN(범위, …)', description: '가장 작은 값 (값이 없으면 0)' },
      { name: 'MAX', signature: 'MAX(범위, …)', description: '가장 큰 값 (값이 없으면 0)' },
      { name: 'SUMIF', signature: 'SUMIF(범위, 조건, 합계범위?)', description: '조건에 맞는 값만 더한다 (조건 예: ">=1000")' },
      { name: 'COUNTIF', signature: 'COUNTIF(범위, 조건)', description: '조건에 맞는 항목 수' },
    ],
  },
  {
    title: '산술',
    functions: [
      { name: 'ROUND', signature: 'ROUND(수, 자릿수?)', description: '반올림 (자릿수 생략 시 정수로)' },
      { name: 'FLOOR', signature: 'FLOOR(수, 자릿수?)', description: '내림' },
      { name: 'CEIL', signature: 'CEIL(수, 자릿수?)', description: '올림' },
      { name: 'ABS', signature: 'ABS(수)', description: '절댓값' },
    ],
  },
  {
    title: '문자열',
    functions: [
      { name: 'CONCAT', signature: 'CONCAT(값, …)', description: '값들을 글자로 이어 붙인다' },
      { name: 'LEFT', signature: 'LEFT(문자열, 글자 수?)', description: '왼쪽부터 지정한 글자 수만큼' },
      { name: 'RIGHT', signature: 'RIGHT(문자열, 글자 수?)', description: '오른쪽부터 지정한 글자 수만큼' },
      { name: 'MID', signature: 'MID(문자열, 시작, 길이)', description: '시작 위치(1부터)에서 지정 길이만큼' },
      { name: 'REPLACE', signature: 'REPLACE(문자열, 찾기, 바꾸기)', description: '일치하는 부분을 모두 바꾼다' },
      { name: 'TRIM', signature: 'TRIM(문자열)', description: '양끝 공백 제거' },
      { name: 'UPPER', signature: 'UPPER(문자열)', description: '영문 대문자로' },
      { name: 'LOWER', signature: 'LOWER(문자열)', description: '영문 소문자로' },
    ],
  },
  {
    title: '조건',
    functions: [
      { name: 'IF', signature: 'IF(조건, 참일 때, 거짓일 때)', description: '조건에 따라 두 값 중 하나' },
      { name: 'AND', signature: 'AND(조건, …)', description: '전부 참이면 참' },
      { name: 'OR', signature: 'OR(조건, …)', description: '하나라도 참이면 참' },
    ],
  },
  {
    title: '포맷',
    functions: [
      { name: 'FORMAT_NUMBER', signature: 'FORMAT_NUMBER(수, 소수 자릿수?)', description: '1,234,567처럼 자릿수 구분 표기' },
      { name: 'FORMAT_DATE', signature: 'FORMAT_DATE(날짜, 패턴?)', description: '날짜 표기 (기본 YYYY-MM-DD)' },
      { name: 'NUMBER_TO_KOREAN', signature: 'NUMBER_TO_KOREAN(수)', description: '금액을 한글로 (예: 일만이천삼백)' },
    ],
  },
  {
    title: '날짜',
    functions: [
      { name: 'TODAY', signature: 'TODAY()', description: '오늘 날짜 (YYYY-MM-DD)' },
      { name: 'DATE_ADD', signature: 'DATE_ADD(날짜, 증감량, 단위?)', description: '날짜 더하기·빼기 (단위: days·months·years)' },
      { name: 'DATE_DIFF', signature: 'DATE_DIFF(시작, 끝, 단위?)', description: '두 날짜의 차이 (끝 − 시작)' },
    ],
  },
  {
    title: '세무',
    functions: [
      { name: 'VAT', signature: 'VAT(공급가액, 세율?)', description: '부가세액 (기본 세율 10%)' },
    ],
  },
];

const en: FormulaHelpCategory[] = [
  {
    title: 'Aggregation',
    functions: [
      { name: 'SUM', signature: 'SUM(range, …)', description: 'Sum of values/ranges (e.g. SUM(items.amount))' },
      { name: 'AVG', signature: 'AVG(range, …)', description: 'Average of values/ranges' },
      { name: 'COUNT', signature: 'COUNT(range, …)', description: 'Number of non-empty items' },
      { name: 'MIN', signature: 'MIN(range, …)', description: 'Smallest value (0 when empty)' },
      { name: 'MAX', signature: 'MAX(range, …)', description: 'Largest value (0 when empty)' },
      { name: 'SUMIF', signature: 'SUMIF(range, criteria, sumRange?)', description: 'Sum only matching values (e.g. ">=1000")' },
      { name: 'COUNTIF', signature: 'COUNTIF(range, criteria)', description: 'Count matching items' },
    ],
  },
  {
    title: 'Math',
    functions: [
      { name: 'ROUND', signature: 'ROUND(number, digits?)', description: 'Round (to integer when digits omitted)' },
      { name: 'FLOOR', signature: 'FLOOR(number, digits?)', description: 'Round down' },
      { name: 'CEIL', signature: 'CEIL(number, digits?)', description: 'Round up' },
      { name: 'ABS', signature: 'ABS(number)', description: 'Absolute value' },
    ],
  },
  {
    title: 'Text',
    functions: [
      { name: 'CONCAT', signature: 'CONCAT(value, …)', description: 'Join values as text' },
      { name: 'LEFT', signature: 'LEFT(text, count?)', description: 'Leftmost characters' },
      { name: 'RIGHT', signature: 'RIGHT(text, count?)', description: 'Rightmost characters' },
      { name: 'MID', signature: 'MID(text, start, length)', description: 'Substring from start (1-based)' },
      { name: 'REPLACE', signature: 'REPLACE(text, search, replacement)', description: 'Replace every match' },
      { name: 'TRIM', signature: 'TRIM(text)', description: 'Strip surrounding whitespace' },
      { name: 'UPPER', signature: 'UPPER(text)', description: 'To upper case' },
      { name: 'LOWER', signature: 'LOWER(text)', description: 'To lower case' },
    ],
  },
  {
    title: 'Logic',
    functions: [
      { name: 'IF', signature: 'IF(condition, then, else)', description: 'One of two values by condition' },
      { name: 'AND', signature: 'AND(condition, …)', description: 'True when all are true' },
      { name: 'OR', signature: 'OR(condition, …)', description: 'True when any is true' },
    ],
  },
  {
    title: 'Format',
    functions: [
      { name: 'FORMAT_NUMBER', signature: 'FORMAT_NUMBER(number, digits?)', description: 'Grouped digits like 1,234,567' },
      { name: 'FORMAT_DATE', signature: 'FORMAT_DATE(date, pattern?)', description: 'Format a date (default YYYY-MM-DD)' },
      { name: 'NUMBER_TO_KOREAN', signature: 'NUMBER_TO_KOREAN(number)', description: 'Amount in Korean words' },
    ],
  },
  {
    title: 'Date',
    functions: [
      { name: 'TODAY', signature: 'TODAY()', description: 'Today (YYYY-MM-DD)' },
      { name: 'DATE_ADD', signature: 'DATE_ADD(date, amount, unit?)', description: 'Shift a date (unit: days·months·years)' },
      { name: 'DATE_DIFF', signature: 'DATE_DIFF(start, end, unit?)', description: 'Difference between dates (end − start)' },
    ],
  },
  {
    title: 'Tax',
    functions: [
      { name: 'VAT', signature: 'VAT(amount, rate?)', description: 'VAT amount (default rate 10%)' },
    ],
  },
];

const HELP = { ko, en } as const;

/**
 * 로케일에 맞는 함수 도움말을 돌려준다. 'en-US'처럼 지역이 붙어도 언어만 보고
 * 고르며, 모르는 로케일은 한국어(기본)로 돌아간다 (strings.ts와 같은 규칙).
 *
 * @param locale - UI 언어 (생략하면 한국어)
 * @returns 분류별 함수 도움말 목록
 */
export function getFormulaHelp(locale?: string): FormulaHelpCategory[] {
  const language = locale?.toLowerCase().split('-')[0];
  return language && language in HELP ? HELP[language as keyof typeof HELP] : HELP.ko;
}
