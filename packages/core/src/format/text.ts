/**
 * `.slip` 파일 텍스트를 JSON으로 파싱하기 전에 거치는 공통 문자열 처리.
 */

/** UTF-8 BOM으로 해석하는 문자 (U+FEFF). */
const BOM = '\uFEFF';

/**
 * 파일 텍스트 맨 앞에 붙은 UTF-8 BOM 하나를 제거한다.
 *
 * 일부 편집기·운영체제가 UTF-8 파일 앞에 붙이는 BOM은 JSON 문법이 아니므로 파싱 전에 떼어 낸다.
 * 맨 앞의 U+FEFF 한 글자만 BOM으로 보고, 그 뒤 또는 텍스트 중간·끝의 U+FEFF는 문서 내용으로
 * 간주해 그대로 둔다.
 *
 * @param text - 저장소·파일에서 읽은 `.slip` 텍스트
 * @returns 맨 앞의 BOM 하나를 뗀 텍스트 (BOM이 없으면 원문 그대로)
 */
export function stripLeadingBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
