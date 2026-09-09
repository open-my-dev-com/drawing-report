/**
 * PDF와 캔버스 미리보기에 공통으로 적용하는 텍스트 배치 함수입니다.
 */

/** 글자 묶음 분할기 — 만드는 비용이 크므로 처음 쓸 때 한 번만 만들어 재사용합니다. */
let graphemeSegmenter: Intl.Segmenter | undefined;

/** 결합 문자를 낱자로 쪼개지 않도록 글자 묶음(grapheme cluster) 단위로 나눕니다. */
function segmentGraphemes(text: string): string[] {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...graphemeSegmenter.segment(text)].map((s) => s.segment);
}

/**
 * 각 글자 뒤에 줄바꿈을 넣어 세로쓰기 문자열을 만듭니다.
 *
 * @remarks
 * 렌더링 엔진이 세로쓰기를 지원하지 않아 글자를 한 줄에 하나씩 배치합니다.
 * 원문의 줄바꿈은 제거합니다. 자모를 따로 적은 한글이나 결합 악센트처럼 여러 코드 포인트로
 * 이루어진 글자는 한 줄에 함께 둡니다.
 *
 * @param text - 원본 문자열
 * @param vertical - 세로쓰기 적용 여부
 * @returns 세로쓰기이면 글자마다 줄바꿈을 넣은 문자열을, 아니면 원본을 반환합니다.
 */
export function stackVertically(text: string, vertical: boolean | undefined): string {
  if (vertical !== true) return text;
  return segmentGraphemes(text.replace(/\r\n|\r|\n/g, '')).join('\n');
}
