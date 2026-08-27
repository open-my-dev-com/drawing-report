// DOM 타입 전체를 포함하지 않고 암호화 모듈이 사용하는 Web Crypto 및 Encoding API만 선언한다.
// crypto.subtle의 세부 인터페이스는 encryption/crypto.ts의 SubtleLike에서 정의한다.

interface SubtleCrypto {
  encrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(
    format: string,
    keyData: Uint8Array,
    algorithm: unknown,
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<unknown>;
  deriveKey(
    algorithm: unknown,
    baseKey: unknown,
    derivedKeyType: unknown,
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<unknown>;
}

interface Crypto {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends Uint8Array>(array: T): T;
}

declare const crypto: Crypto;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
