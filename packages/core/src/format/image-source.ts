/**
 * 이미지 데이터의 형식·내용·크기를 검사하는 공통 도우미.
 *
 * PDF에는 PNG·JPEG만 심을 수 있으므로 디자이너·작성 폼·MCP·렌더러가 같은 기준으로
 * 이미지를 받아들이도록 한 곳에서 판정한다. 선언된 MIME이 아니라 바이트 앞부분(매직
 * 바이트)으로 실제 형식을 확인하고, base64 길이에서 계산한 디코딩 크기로 상한을 검사한다.
 */

/** PDF에 심을 수 있는 이미지 MIME 종류 */
export type ImageMimeType = 'image/png' | 'image/jpeg';

/** PDF에 심을 수 있는 이미지 MIME 목록 */
export const IMAGE_MIME_TYPES: readonly ImageMimeType[] = ['image/png', 'image/jpeg'];

/** 이미지 한 장의 디코딩 크기 상한(바이트, 2 MiB) — `data:` 이미지와 에셋에 공통 적용한다 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * 이미지 검사 결과.
 *
 * - `format`: `data:<mime>;base64,<data>` 형식이 아니다
 * - `mime`: 선언된 MIME이 PNG·JPEG가 아니다
 * - `content`: 바이트 앞부분이 PNG·JPEG 서명과 맞지 않는다(위장·손상)
 * - `size`: 디코딩 크기가 상한을 넘는다
 */
export type ImageInspection =
  | { ok: true; mimeType: ImageMimeType; bytes: number }
  | { ok: false; reason: 'format' | 'mime' | 'content' | 'size'; bytes: number; mimeType?: string };

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w.+-]+=[\w.+-]+)*;base64,([A-Za-z0-9+/]*=*)$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * 바이트 앞부분의 서명으로 이미지 형식을 판정한다.
 *
 * @param bytes - 이미지 바이트 (앞 8바이트만 본다)
 * @returns PNG·JPEG면 그 MIME, 아니면 `undefined`
 */
export function detectImageMimeType(bytes: Uint8Array): ImageMimeType | undefined {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'image/png';
  if (JPEG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'image/jpeg';
  return undefined;
}

/**
 * 이미지 바이트를 검사한다.
 *
 * @param bytes - 이미지 바이트
 * @param options - `maxBytes`: 디코딩 크기 상한 (기본 {@link MAX_IMAGE_BYTES}); `declaredMimeType`: 선언된 MIME이 있으면 실제 형식과 대조한다
 * @returns 검사 결과
 */
export function inspectImageBytes(
  bytes: Uint8Array,
  options: { maxBytes?: number; declaredMimeType?: string } = {},
): ImageInspection {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const declared = options.declaredMimeType;
  if (declared !== undefined && !IMAGE_MIME_TYPES.includes(declared as ImageMimeType)) {
    return { ok: false, reason: 'mime', bytes: bytes.length, mimeType: declared };
  }
  const actual = detectImageMimeType(bytes);
  if (actual === undefined || (declared !== undefined && declared !== actual)) {
    const mimeType = declared ?? actual;
    return mimeType === undefined
      ? { ok: false, reason: 'content', bytes: bytes.length }
      : { ok: false, reason: 'content', bytes: bytes.length, mimeType };
  }
  if (bytes.length > maxBytes) return { ok: false, reason: 'size', bytes: bytes.length, mimeType: actual };
  return { ok: true, mimeType: actual, bytes: bytes.length };
}

/**
 * `data:` base64 이미지 문자열을 검사한다. 전체를 디코딩하지 않고 앞부분 서명과
 * base64 길이에서 계산한 크기만 확인하므로 큰 이미지에도 비용이 작다.
 *
 * @param src - `data:<mime>;base64,<data>` 문자열
 * @param options - `maxBytes`: 디코딩 크기 상한 (기본 {@link MAX_IMAGE_BYTES})
 * @returns 검사 결과
 */
export function inspectImageDataUrl(src: string, options: { maxBytes?: number } = {}): ImageInspection {
  const match = DATA_URL.exec(src);
  if (match === null) return { ok: false, reason: 'format', bytes: 0 };
  const declared = match[1] ?? '';
  const data = match[2] ?? '';
  const bytes = decodedBase64Length(data);
  if (!IMAGE_MIME_TYPES.includes(declared as ImageMimeType)) {
    return { ok: false, reason: 'mime', bytes, mimeType: declared };
  }
  const head = decodeBase64Prefix(data, 12);
  const actual = detectImageMimeType(head);
  if (actual !== declared) return { ok: false, reason: 'content', bytes, mimeType: declared };
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  if (bytes > maxBytes) return { ok: false, reason: 'size', bytes, mimeType: actual };
  return { ok: true, mimeType: actual, bytes };
}

/** 크기 정보를 담은 JPEG 프레임 시작(SOF) 마커. 산술 부호화와 계층 부호화 변형을 모두 포함한다. */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * `data:` base64 이미지를 끝까지 디코딩해 PDF에 심을 수 있는 구조인지 확인한다.
 *
 * @remarks
 * 서명만 맞고 내용이 깨진 이미지는 PDF 생성 단계에서야 실패해 어느 요소인지 알 수 없다.
 * 렌더 전에 PNG 청크와 JPEG 마커를 훑어 크기 정보까지 읽히는지 확인한다.
 * 전체 바이트를 디코딩하므로 렌더링처럼 한 번만 검사하는 자리에서 사용한다.
 *
 * @param src - `data:<mime>;base64,<data>` 문자열
 * @returns PDF에 심을 수 있는 구조면 `true`
 */
export function isEmbeddableImageData(src: string): boolean {
  const match = DATA_URL.exec(src);
  if (match === null) return false;
  const data = match[2] ?? '';
  const bytes = decodeBase64Prefix(data, decodedBase64Length(data));
  const mimeType = detectImageMimeType(bytes);
  if (mimeType === 'image/png') return isCompletePng(bytes);
  if (mimeType === 'image/jpeg') return isCompleteJpeg(bytes);
  return false;
}

/** PNG 청크를 순서대로 훑어 IHDR·IDAT·IEND가 모두 읽히는지 확인한다. */
function isCompletePng(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let hasHeader = false;
  let hasData = false;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    // 청크 하나는 길이 4바이트 + 종류 4바이트 + 데이터 + CRC 4바이트다.
    const next = offset + 12 + length;
    if (next > bytes.length) return false;
    if (!hasHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      if (view.getUint32(offset + 8) === 0 || view.getUint32(offset + 12) === 0) return false;
      hasHeader = true;
    }
    if (type === 'IDAT') hasData = true;
    if (type === 'IEND') return hasData;
    offset = next;
  }
  return false;
}

/** JPEG 마커를 순서대로 훑어 크기를 담은 프레임 시작 구획까지 읽히는지 확인한다. */
function isCompleteJpeg(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    // 마커 앞에는 0xFF 채움 바이트가 여러 개 올 수 있다.
    let markerAt = offset + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1;
    if (markerAt >= bytes.length) return false;
    const marker = bytes[markerAt]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerAt + 1;
      continue;
    }
    // 크기를 읽기 전에 스캔이 시작되거나 이미지가 끝나면 심을 수 없다.
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return false;
    const lengthAt = markerAt + 1;
    if (lengthAt + 2 > bytes.length) return false;
    const length = view.getUint16(lengthAt);
    if (length < 2 || lengthAt + length > bytes.length) return false;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 8) return false;
      return view.getUint16(lengthAt + 3) > 0 && view.getUint16(lengthAt + 5) > 0;
    }
    offset = lengthAt + length;
  }
  return false;
}

/** base64 문자열이 디코딩되면 몇 바이트인지 계산한다 (패딩 반영). */
function decodedBase64Length(data: string): number {
  if (data.length === 0) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 앞부분만 디코딩한다 (서명 확인용). */
function decodeBase64Prefix(data: string, byteCount: number): Uint8Array {
  const chars = Math.ceil(byteCount / 3) * 4;
  const chunk = data.slice(0, chars).replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((chunk.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const ch of chunk) {
    const value = BASE64_ALPHABET.indexOf(ch);
    if (value < 0) break;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}
