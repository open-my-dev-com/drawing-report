/**
 * 샘플 값과 수식 결과를 화면 입력에 넣고 읽는 변환.
 *
 * @remarks
 * 샘플 편집은 값의 종류를 따로 저장하지 않으므로 입력 글에서 숫자를 알아본다.
 */

/**
 * 숫자 형식의 샘플 입력은 숫자로, 나머지는 문자열로 반환한다.
 *
 * @param text - 입력한 글
 * @returns 숫자 형식이면 숫자, 아니면 입력한 글 그대로
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
