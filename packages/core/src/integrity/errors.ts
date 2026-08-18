export class SlipIntegrityError extends Error {
  override readonly name = 'SlipIntegrityError';

  constructor(message: string) {
    super(message);
  }
}
