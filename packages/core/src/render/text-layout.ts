/**
 * PDF와 캔버스 미리보기에 공통으로 적용하는 텍스트 배치 함수.
 */

/**
 * 각 글자 뒤에 줄바꿈을 넣어 세로쓰기 문자열을 만든다.
 *
 * @remarks
 * 렌더링 엔진이 세로쓰기를 지원하지 않아 글자를 한 줄에 하나씩 배치한다.
 * 원문의 줄바꿈은 제거한다.
 *
 * @param text - 원본 문자열
 * @param vertical - 세로쓰기 적용 여부
 * @returns 세로쓰기면 글자마다 줄바꿈을 넣은 문자열, 아니면 원본
 */
export function stackVertically(text: string, vertical: boolean | undefined): string {
  if (vertical !== true) return text;
  return [...text.replace(/\r\n|\r|\n/g, '')].join('\n');
}
