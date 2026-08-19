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

/**
 * 전표의 contentHash를 계산한다 — integrity 필드를 뺀 나머지를 JCS 정규화한
 * 바이트의 SHA-256 (소문자 hex, SPEC §8).
 *
 * @param voucher 해시를 계산할 전표 파일
 * @returns SHA-256 해시 (소문자 hex 64자)
 * @throws SlipIntegrityError 정규화 불가(중첩 깊이 초과 등) 시
 */
export async function computeContentHash(voucher: SlipVoucherFile): Promise<string> {
  const { integrity: _, ...rest } = voucher;
  let canonical: string;
  try {
    canonical = canonicalize(rest);
  } catch (error) {
    // 정규화 불가(중첩 깊이 초과 등)를 원시 오류 대신 무결성 오류로 알린다
    throw new SlipIntegrityError(
      `문서를 정규화할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return sha256Hex(new TextEncoder().encode(canonical));
}

/**
 * 발행 시 기록할 무결성 값을 만든다 — 해시 필수, 개인키를 주면 JWS(ES256) 서명 포함.
 *
 * @param voucher 무결성을 기록할 전표 파일
 * @param privateKey 서명에 쓸 개인키 (생략하면 해시만 기록)
 * @returns integrity 필드에 넣을 값
 * @throws SlipIntegrityError 정규화 불가·키 오류·Web Crypto 미지원 시
 */
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

/**
 * 전표의 무결성 기록을 검증한다 — 해시 재계산 대조, 서명이 있으면 공개키로 서명까지 확인.
 * 통과하면 조용히 끝나고, 문제가 있으면 오류를 던진다.
 *
 * @param voucher 검증할 전표 파일 (integrity 필드 포함)
 * @param publicKey 서명 검증에 쓸 공개키 (서명이 있는 파일이면 필수)
 * @throws SlipIntegrityError 기록 없음·해시 불일치·서명 검증 실패·공개키 누락 시
 */
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
