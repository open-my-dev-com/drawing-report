import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, detectImageMimeType, inspectImageBytes, inspectImageDataUrl } from '../src/index.js';

const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

describe('이미지 검사 (PNG·JPEG 서명·크기)', () => {
  it('서명으로 PNG·JPEG를 판정하고 그 밖은 알 수 없음으로 둔다', () => {
    expect(detectImageMimeType(PNG_HEAD)).toBe('image/png');
    expect(detectImageMimeType(JPEG_HEAD)).toBe('image/jpeg');
    expect(detectImageMimeType(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeUndefined(); // GIF
    expect(detectImageMimeType(new Uint8Array(0))).toBeUndefined();
  });

  it('바이트 검사: 선언 MIME 대조·내용 위장·크기 상한', () => {
    expect(inspectImageBytes(PNG_HEAD)).toEqual({ ok: true, mimeType: 'image/png', bytes: PNG_HEAD.length });
    expect(inspectImageBytes(PNG_HEAD, { declaredMimeType: 'image/jpeg' })).toMatchObject({ ok: false, reason: 'content' });
    expect(inspectImageBytes(PNG_HEAD, { declaredMimeType: 'image/gif' })).toMatchObject({ ok: false, reason: 'mime' });
    expect(inspectImageBytes(Uint8Array.from([1, 2, 3]))).toMatchObject({ ok: false, reason: 'content' });
    expect(inspectImageBytes(PNG_HEAD, { maxBytes: 8 })).toMatchObject({ ok: false, reason: 'size', bytes: PNG_HEAD.length });
  });

  it('data URL 검사: 형식·MIME·서명·크기를 디코딩 없이 판정한다', () => {
    expect(inspectImageDataUrl(dataUrl('image/png', PNG_HEAD))).toEqual({ ok: true, mimeType: 'image/png', bytes: PNG_HEAD.length });
    expect(inspectImageDataUrl(dataUrl('image/jpeg', JPEG_HEAD))).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
    expect(inspectImageDataUrl('https://example.com/a.png')).toMatchObject({ ok: false, reason: 'format' });
    expect(inspectImageDataUrl('data:image/png;base64,AAAA AAAA')).toMatchObject({ ok: false, reason: 'format' });
    expect(inspectImageDataUrl(dataUrl('image/gif', PNG_HEAD))).toMatchObject({ ok: false, reason: 'mime', mimeType: 'image/gif' });
    expect(inspectImageDataUrl(dataUrl('image/svg+xml', PNG_HEAD))).toMatchObject({ ok: false, reason: 'mime' });
    expect(inspectImageDataUrl(dataUrl('image/png', JPEG_HEAD))).toMatchObject({ ok: false, reason: 'content' });
    expect(inspectImageDataUrl('data:image/png;base64,AAAAAAAA')).toMatchObject({ ok: false, reason: 'content' });
    expect(inspectImageDataUrl(dataUrl('image/png', PNG_HEAD), { maxBytes: 10 })).toMatchObject({ ok: false, reason: 'size', bytes: PNG_HEAD.length });
  });

  it('크기는 base64 길이와 패딩에서 정확히 계산한다', () => {
    for (const n of [1, 2, 3, 4, 100, 1023, 4096]) {
      const bytes = new Uint8Array(n);
      bytes.set(PNG_HEAD.subarray(0, Math.min(n, PNG_HEAD.length)));
      const result = inspectImageDataUrl(dataUrl('image/png', bytes), { maxBytes: 1 << 20 });
      if (n >= 8) expect(result).toMatchObject({ ok: true, bytes: n });
      else expect(result).toMatchObject({ bytes: n });
    }
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);
  });
});
