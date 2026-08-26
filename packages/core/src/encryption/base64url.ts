/**
 * base64url 인코딩·디코딩 (RFC 4648 §5, 패딩 없음).
 * JWS compact serialization에 사용된다.
 */

const ENC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// 알파벳에 없는 문자를 0으로 해석하지 않도록 유효하지 않은 항목은 0xFF로 표시한다.
const DEC = new Uint8Array(128).fill(0xff);
for (let i = 0; i < ENC.length; i++) DEC[ENC.charCodeAt(i)] = i;

/** base64url 문자 하나를 6비트 값으로 변환한다. */
function sextet(code: number): number {
  const v = code < 128 ? DEC[code]! : 0xff;
  if (v === 0xff) throw new Error('base64url 문자열에 허용되지 않는 문자가 있습니다');
  return v;
}

/**
 * 바이트를 base64url 문자열로 인코딩한다.
 *
 * @param bytes - 인코딩할 바이트
 * @returns base64url 문자열 (패딩 없음)
 */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ENC[b0 >> 2];
    out += ENC[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) {
      out += ENC[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    }
    if (b2 !== undefined) {
      out += ENC[b2 & 0x3f];
    }
  }
  return out;
}

/**
 * base64url 문자열을 바이트로 디코딩한다.
 *
 * @param str - base64url 문자열 (패딩 없음)
 * @returns 디코딩된 바이트
 */
export function base64urlDecode(str: string): Uint8Array {
  const n = str.length;
  const rem = n % 4;
  // base64 문자열의 길이를 4로 나눈 나머지는 1이 될 수 없다.
  if (rem === 1) throw new Error('base64url 길이가 올바르지 않습니다');
  const fullBlocks = (n - rem) >> 2;
  const outLen = fullBlocks * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);

  let si = 0;
  let di = 0;
  for (let b = 0; b < fullBlocks; b++) {
    const a = sextet(str.charCodeAt(si++));
    const b_ = sextet(str.charCodeAt(si++));
    const c = sextet(str.charCodeAt(si++));
    const d = sextet(str.charCodeAt(si++));
    out[di++] = (a << 2) | (b_ >> 4);
    out[di++] = ((b_ & 0x0f) << 4) | (c >> 2);
    out[di++] = ((c & 0x03) << 6) | d;
  }
  if (rem === 2) {
    const a = sextet(str.charCodeAt(si++));
    const b_ = sextet(str.charCodeAt(si));
    out[di] = (a << 2) | (b_ >> 4);
  } else if (rem === 3) {
    const a = sextet(str.charCodeAt(si++));
    const b_ = sextet(str.charCodeAt(si++));
    const c = sextet(str.charCodeAt(si));
    out[di++] = (a << 2) | (b_ >> 4);
    out[di] = ((b_ & 0x0f) << 4) | (c >> 2);
  }
  return out;
}

/**
 * UTF-8 문자열을 base64url로 인코딩한다 (JWS 페이로드용).
 *
 * @param str - 인코딩할 문자열
 * @returns base64url 문자열 (패딩 없음)
 */
export function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}
