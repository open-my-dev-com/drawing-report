/**
 * 페이지 계획이 실패했을 때 발생하는 오류입니다.
 * 오류를 일으킨 요소와 행 구간을 함께 전달해 편집기가 설정 위치에 표시할 수 있게 합니다.
 */
export class SlipLayoutError extends Error {
  /** 오류와 관련된 요소 ID입니다. */
  readonly elementId?: string;
  /** 오류와 관련된 행 구간 ID입니다. */
  readonly bandId?: string;

  constructor(message: string, related: { elementId?: string; bandId?: string } = {}) {
    super(message);
    this.name = 'SlipLayoutError';
    if (related.elementId !== undefined) this.elementId = related.elementId;
    if (related.bandId !== undefined) this.bandId = related.bandId;
  }
}
