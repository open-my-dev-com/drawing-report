/** 파일 암호화 또는 복호화에 실패했을 때 발생하며, 사용자에게 표시할 메시지를 포함한다. */
export class SlipEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipEncryptionError';
  }
}
