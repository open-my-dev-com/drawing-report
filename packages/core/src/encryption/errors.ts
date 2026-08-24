/** 파일 암호화·복호화 실패 오류 — message는 사용자 대면 한국어 (ADR-054) */
export class SlipEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipEncryptionError';
  }
}
