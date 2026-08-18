// Web Crypto API · Encoding API 최소 타입 선언
// DOM lib 전체를 포함하면 window·document 접근이 가능해져 순수 TS 규칙(ADR-002)에
// 어긋날 수 있으므로, 무결성 모듈이 쓰는 Web 표준 API만 선언한다.
// 런타임: Node 18+, 모든 모던 브라우저에서 crypto / TextEncoder 사용 가능.

interface CryptoKey {
  readonly type: string;
}

interface CryptoKeyPair {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
}

interface SubtleCrypto {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(
    format: 'jwk',
    keyData: Record<string, unknown>,
    algorithm: { name: string; namedCurve: string },
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<CryptoKey>;
  sign(
    algorithm: { name: string; hash: string },
    key: CryptoKey,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
  verify(
    algorithm: { name: string; hash: string },
    key: CryptoKey,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
  generateKey(
    algorithm: { name: string; namedCurve: string },
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<CryptoKeyPair>;
  exportKey(format: 'jwk', key: CryptoKey): Promise<Record<string, unknown>>;
}

interface Crypto {
  readonly subtle: SubtleCrypto;
}

declare const crypto: Crypto;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
