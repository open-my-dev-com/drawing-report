/**
 * 텍스트 배치 헬퍼 — 렌더(PDF)와 캔버스 미리보기가 같은 규칙을 쓰도록 SSOT로 둔다 (ADR-012).
 */

/**
 * 세로쓰기 문자열을 만든다 — 글자를 한 자씩 위에서 아래로 쌓는다 (0.5.0, ADR-042).
 *
 * @remarks
 * 하부 엔진에 세로쓰기 모드가 없어 글자마다 줄바꿈을 넣어 한 열로 쌓는다. 원래의 줄바꿈은
 * 없앤다(한 열로 이어 쌓기 위해). 캔버스도 같은 문자열을 그려 화면과 PDF가 어긋나지 않는다.
 *
 * @param text - 원본 문자열
 * @param vertical - 세로쓰기 여부 (아니면 원본을 그대로 돌려준다)
 * @returns 세로쓰기면 글자마다 줄바꿈을 넣은 문자열, 아니면 원본
 */
export function stackVertically(text: string, vertical: boolean | undefined): string {
  if (vertical !== true) return text;
  return [...text.replace(/\r\n|\r|\n/g, '')].join('\n');
}
