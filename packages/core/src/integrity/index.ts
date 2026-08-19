/**
 * 무결성 계층 — SHA-256 해시 + JWS(ES256) 서명 (ADR-019, SPEC §8).
 *
 * 공개 API:
 *   computeIntegrity  — 해시(+ 선택적 서명) 계산
 *   verifyIntegrity   — 해시(+ 선택적 서명) 검증
 *   computeContentHash / generateSigningKeyPair — 저수준 빌딩 블록
 *   canonicalize      — RFC 8785 JCS 정규화
 */

import type { Integrity, SlipVoucherFile } from '../format/schema.js';
import { canonicalize } from './jcs.js';
import { sha256Hex } from './hash.js';
import { jwsSign, jwsVerify, generateKeyPair } from './jws.js';
import { SlipIntegrityError } from './errors.js';

export type { IntegrityJwk, IntegrityKeyPair } from './jws.js';
export { SlipIntegrityError } from './errors.js';
export { canonicalize } from './jcs.js';

export async function computeContentHash(voucher: SlipVoucherFile): Promise<string> {
  const { integrity: _, ...rest } = voucher;
  const canonical = canonicalize(rest);
  return sha256Hex(new TextEncoder().encode(canonical));
}

export async function computeIntegrity(
  voucher: SlipVoucherFile,
  privateKey?: import('./jws.js').IntegrityJwk,
): Promise<Integrity> {
  const contentHash = await computeContentHash(voucher);
  if (privateKey) {
    const signature = await jwsSign(contentHash, privateKey);
    return { contentHash, signature };
  }
  return { contentHash };
}

export async function verifyIntegrity(
  voucher: SlipVoucherFile,
  publicKey?: import('./jws.js').IntegrityJwk,
): Promise<void> {
  if (!voucher.integrity) {
    throw new SlipIntegrityError('integrity 필드가 없습니다');
  }
  const computed = await computeContentHash(voucher);
  if (computed !== voucher.integrity.contentHash) {
    throw new SlipIntegrityError(
      'contentHash가 일치하지 않습니다 — 문서가 변조되었을 수 있습니다',
    );
  }
  if (voucher.integrity.signature) {
    if (!publicKey) {
      throw new SlipIntegrityError(
        'signature가 있지만 검증할 공개키가 제공되지 않았습니다',
      );
    }
    await jwsVerify(
      voucher.integrity.signature,
      voucher.integrity.contentHash,
      publicKey,
    );
  }
}

export { generateKeyPair as generateSigningKeyPair } from './jws.js';
