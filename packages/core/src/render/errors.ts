/** `.slip` 변환 또는 PDF 생성에 실패했을 때 발생하는 오류. */
export class SlipRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipRenderError';
  }
}
