/**
 * 수식 편집 모달에 표시할 함수 분류, 사용법, 설명을 정의한다.
 *
 * 함수 목록은 core의 `FORMULA_FUNCTIONS`와 일치해야 한다. core에 함수를 추가할 때
 * 각 언어의 도움말도 함께 추가한다.
 */

/** 함수 이름, 사용법, 설명으로 구성된 도움말 항목. */
export interface FormulaHelpEntry {
  name: string;
  /** UI 언어로 작성한 사용법 표기. 예: `SUM(범위, …)`. */
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
  {
    title: '타입 변환',
    functions: [
      { name: 'TO_NUMBER', signature: 'TO_NUMBER(값)', description: '글자를 수로 (빈 값은 0). 숫자 자리에 글자를 넣을 때' },
      { name: 'TO_STRING', signature: 'TO_STRING(값)', description: '수·논리를 글자로' },
      { name: 'TO_DATE', signature: 'TO_DATE(값)', description: '날짜 문자열을 검증해 YYYY-MM-DD로' },
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
  {
    title: 'Type conversion',
    functions: [
      { name: 'TO_NUMBER', signature: 'TO_NUMBER(value)', description: 'Text to number (empty is 0). Use where a number is required' },
      { name: 'TO_STRING', signature: 'TO_STRING(value)', description: 'Number/boolean to text' },
      { name: 'TO_DATE', signature: 'TO_DATE(value)', description: 'Validate a date string to YYYY-MM-DD' },
    ],
  },
];

const ja: FormulaHelpCategory[] = [
  {
    title: '集計',
    functions: [
      { name: 'SUM', signature: 'SUM(範囲, …)', description: '値・範囲の合計 (例: SUM(items.amount))' },
      { name: 'AVG', signature: 'AVG(範囲, …)', description: '値・範囲の平均' },
      { name: 'COUNT', signature: 'COUNT(範囲, …)', description: '空の値を除いた項目数' },
      { name: 'MIN', signature: 'MIN(範囲, …)', description: '最小値 (値がなければ0)' },
      { name: 'MAX', signature: 'MAX(範囲, …)', description: '最大値 (値がなければ0)' },
      { name: 'SUMIF', signature: 'SUMIF(範囲, 条件, 合計範囲?)', description: '条件に合う値だけを合計する (条件の例: ">=1000")' },
      { name: 'COUNTIF', signature: 'COUNTIF(範囲, 条件)', description: '条件に合う項目数' },
    ],
  },
  {
    title: '算術',
    functions: [
      { name: 'ROUND', signature: 'ROUND(数値, 桁数?)', description: '四捨五入 (桁数を省略すると整数に)' },
      { name: 'FLOOR', signature: 'FLOOR(数値, 桁数?)', description: '切り捨て' },
      { name: 'CEIL', signature: 'CEIL(数値, 桁数?)', description: '切り上げ' },
      { name: 'ABS', signature: 'ABS(数値)', description: '絶対値' },
    ],
  },
  {
    title: '文字列',
    functions: [
      { name: 'CONCAT', signature: 'CONCAT(値, …)', description: '複数の値を文字列として連結する' },
      { name: 'LEFT', signature: 'LEFT(文字列, 文字数?)', description: '左から指定した文字数だけ' },
      { name: 'RIGHT', signature: 'RIGHT(文字列, 文字数?)', description: '右から指定した文字数だけ' },
      { name: 'MID', signature: 'MID(文字列, 開始, 長さ)', description: '開始位置(1から)から指定した長さだけ' },
      { name: 'REPLACE', signature: 'REPLACE(文字列, 検索, 置換)', description: '一致する部分をすべて置き換える' },
      { name: 'TRIM', signature: 'TRIM(文字列)', description: '前後の空白を除去' },
      { name: 'UPPER', signature: 'UPPER(文字列)', description: '英字を大文字に' },
      { name: 'LOWER', signature: 'LOWER(文字列)', description: '英字を小文字に' },
    ],
  },
  {
    title: '条件',
    functions: [
      { name: 'IF', signature: 'IF(条件, 真のとき, 偽のとき)', description: '条件に応じて2つの値のいずれか' },
      { name: 'AND', signature: 'AND(条件, …)', description: 'すべて真なら真' },
      { name: 'OR', signature: 'OR(条件, …)', description: 'いずれかが真なら真' },
    ],
  },
  {
    title: '書式',
    functions: [
      { name: 'FORMAT_NUMBER', signature: 'FORMAT_NUMBER(数値, 小数桁数?)', description: '1,234,567のように桁区切り表記' },
      { name: 'FORMAT_DATE', signature: 'FORMAT_DATE(日付, パターン?)', description: '日付の表記 (既定 YYYY-MM-DD)' },
      { name: 'NUMBER_TO_KOREAN', signature: 'NUMBER_TO_KOREAN(数値)', description: '金額を韓国語表記に (例: 일만이천삼백)' },
    ],
  },
  {
    title: '日付',
    functions: [
      { name: 'TODAY', signature: 'TODAY()', description: '今日の日付 (YYYY-MM-DD)' },
      { name: 'DATE_ADD', signature: 'DATE_ADD(日付, 増減量, 単位?)', description: '日付の加算・減算 (単位: days・months・years)' },
      { name: 'DATE_DIFF', signature: 'DATE_DIFF(開始, 終了, 単位?)', description: '2つの日付の差 (終了 − 開始)' },
    ],
  },
  {
    title: '税務',
    functions: [
      { name: 'VAT', signature: 'VAT(課税標準額, 税率?)', description: '消費税額 (既定の税率10%)' },
    ],
  },
  {
    title: '型変換',
    functions: [
      { name: 'TO_NUMBER', signature: 'TO_NUMBER(値)', description: '文字を数値に (空は0)。数値が必要な場所で使う' },
      { name: 'TO_STRING', signature: 'TO_STRING(値)', description: '数値・論理値を文字に' },
      { name: 'TO_DATE', signature: 'TO_DATE(値)', description: '日付文字列を検証して YYYY-MM-DD に' },
    ],
  },
];

const HELP = { ko, en, ja } as const;

/**
 * 로케일에 맞는 함수 도움말을 반환한다. 지역 코드가 포함되면 언어 코드만 사용하며
 * 지원하지 않는 언어는 한국어로 처리한다.
 *
 * @param locale - UI 언어 (생략하면 한국어)
 * @returns 분류별 함수 도움말 목록
 */
export function getFormulaHelp(locale?: string): FormulaHelpCategory[] {
  const language = locale?.toLowerCase().split('-')[0];
  return language && language in HELP ? HELP[language as keyof typeof HELP] : HELP.ko;
}
