/** PDF 렌더링(변환·생성) 단계 오류. 메시지는 사용자 대면 한국어. */
export class SlipRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipRenderError';
  }
}
