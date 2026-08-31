/**
 * 샘플 값과 수식 결과를 화면 입력에 넣고 읽는 변환.
 *
 * @remarks
 * 샘플 값에는 별도의 타입 정보가 없으므로 입력 문자열을 분석해 숫자 여부를 판별한다.
 */

/**
 * 숫자 형식의 샘플 입력은 숫자로, 나머지는 문자열로 반환한다.
 *
 * @param text - 입력 문자열
 * @returns 숫자 형식이면 숫자, 아니면 원래 문자열
 */
export function parseSampleScalar(text: string): string | number {
  const trimmed = text.trim();
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/**
 * 스칼라 샘플 값을 입력 요소에 표시할 문자열로 변환한다.
 *
 * @param value - 샘플 값
 * @returns 입력 요소에 넣을 문자열. 값이 없거나 객체면 빈 문자열
 */
export function sampleScalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * 수식 계산 결과를 미리보기용 문자열로 변환한다.
 *
 * @param value - 수식 계산 결과
 * @returns 미리보기에 표시할 문자열
 */
export function formulaPreviewText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}
