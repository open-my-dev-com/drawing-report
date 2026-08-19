/** 무결성 계산·검증 실패 오류 (해시 불일치·서명 실패·환경 미지원 등) */
export class SlipIntegrityError extends Error {
  override readonly name = 'SlipIntegrityError';

  constructor(message: string) {
    super(message);
  }
}
