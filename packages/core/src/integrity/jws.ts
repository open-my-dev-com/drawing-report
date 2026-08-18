/**
 * JWS ES256 compact serialization (RFC 7515 + RFC 7518 §3.4).
 * Web Crypto API(ECDSA P-256 + SHA-256)로 직접 구현.
 */

import { base64urlEncode, base64urlDecode, base64urlEncodeString } from './base64url.js';
import { SlipIntegrityError } from './errors.js';

export interface IntegrityJwk {
  readonly kty: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
  readonly d?: string;
  readonly kid?: string;
  readonly [key: string]: unknown;
}

export interface IntegrityKeyPair {
  readonly privateKey: IntegrityJwk;
  readonly publicKey: IntegrityJwk;
}

const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;
const HEADER_B64 = base64urlEncodeString('{"alg":"ES256"}');

function requireSubtle(): SubtleCrypto {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) {
    throw new SlipIntegrityError(
      'Web Crypto API(crypto.subtle)를 사용할 수 없습니다 — Node 18+ 또는 모던 브라우저가 필요합니다',
    );
  }
  return subtle;
}

async function importEcKey(
  jwk: IntegrityJwk,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  const subtle = requireSubtle();
  try {
    return await subtle.importKey(
      'jwk',
      jwk as Record<string, unknown>,
      ECDSA_PARAMS,
      false,
      [usage],
    );
  } catch (cause) {
    throw new SlipIntegrityError(
      `EC P-256 키를 가져올 수 없습니다 — JWK 형식을 확인하세요: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export async function jwsSign(
  payload: string,
  privateKey: IntegrityJwk,
): Promise<string> {
  const key = await importEcKey(privateKey, 'sign');
  const payloadB64 = base64urlEncodeString(payload);
  const signingInput = new TextEncoder().encode(`${HEADER_B64}.${payloadB64}`);
  const sig = await requireSubtle().sign(SIGN_PARAMS, key, signingInput);
  return `${HEADER_B64}.${payloadB64}.${base64urlEncode(new Uint8Array(sig))}`;
}

export async function jwsVerify(
  jws: string,
  expectedPayload: string,
  publicKey: IntegrityJwk,
): Promise<void> {
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw new SlipIntegrityError('JWS compact 형식이 아닙니다 (header.payload.signature)');
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const headerJson = new TextDecoder().decode(base64urlDecode(headerB64));
  let header: { alg?: string };
  try {
    header = JSON.parse(headerJson) as { alg?: string };
  } catch {
    throw new SlipIntegrityError('JWS 헤더를 파싱할 수 없습니다');
  }
  if (header.alg !== 'ES256') {
    throw new SlipIntegrityError(`지원하지 않는 JWS 알고리즘: ${String(header.alg)} (ES256만 지원)`);
  }

  const actualPayload = new TextDecoder().decode(base64urlDecode(payloadB64));
  if (actualPayload !== expectedPayload) {
    throw new SlipIntegrityError('JWS 페이로드가 contentHash와 일치하지 않습니다');
  }

  const key = await importEcKey(publicKey, 'verify');
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await requireSubtle().verify(
    SIGN_PARAMS,
    key,
    base64urlDecode(sigB64),
    signingInput,
  );
  if (!valid) {
    throw new SlipIntegrityError('JWS 서명 검증에 실패했습니다');
  }
}

export async function generateKeyPair(): Promise<IntegrityKeyPair> {
  const subtle = requireSubtle();
  const pair = await subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);
  const [priv, pub] = await Promise.all([
    subtle.exportKey('jwk', pair.privateKey),
    subtle.exportKey('jwk', pair.publicKey),
  ]);
  return {
    privateKey: priv as IntegrityJwk,
    publicKey: pub as IntegrityJwk,
  };
}
