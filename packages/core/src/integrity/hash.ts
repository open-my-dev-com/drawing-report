import { SlipIntegrityError } from './errors.js';

/**
 * 바이트의 SHA-256 해시를 소문자 hex 64자로 돌려준다.
 *
 * @throws SlipIntegrityError Web Crypto API를 쓸 수 없는 환경이면
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) {
    throw new SlipIntegrityError(
      'Web Crypto API(crypto.subtle)를 사용할 수 없습니다 — Node 18+ 또는 모던 브라우저가 필요합니다',
    );
  }
  const buf = await subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}
