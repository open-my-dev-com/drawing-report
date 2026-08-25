// Web Crypto API · Encoding API 최소 타입 선언
// DOM lib 전체를 포함하면 window·document 접근이 가능해져 순수 TS 규칙(ADR-002)에
// 어긋날 수 있으므로, 암호화 모듈(encryption/crypto.ts)이 쓰는 Web 표준 전역만 선언한다.
// 런타임: Node 20+, 모든 모던 브라우저에서 crypto / TextEncoder 사용 가능.
// (crypto.subtle의 세부 시그니처는 crypto.ts의 SubtleLike로 좁혀 다룬다.)

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
