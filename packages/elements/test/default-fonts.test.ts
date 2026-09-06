import { describe, expect, it } from 'vitest';
import { loadDefaultFonts } from '../src/default-fonts.js';
import { PRETENDARD_FONTS } from '../src/fonts/pretendard.js';
import { NOTO_SANS_JP_FONTS } from '../src/fonts/noto-sans-jp.js';

describe('동봉 기본 폰트 (Pretendard, ADR-012)', () => {
  it('Regular·Bold 2종이고 Regular가 대체(fallback) 폰트다', () => {
    expect(PRETENDARD_FONTS.map((f) => f.name)).toEqual(['Pretendard', 'Pretendard-Bold']);
    expect(PRETENDARD_FONTS[0]!.fallback).toBe(true);
    expect(PRETENDARD_FONTS[1]!.fallback).toBeUndefined();
  });

  it('데이터가 실제 OTF다 (매직 바이트 OTTO, 한글 폰트 크기)', () => {
    for (const font of PRETENDARD_FONTS) {
      const head = String.fromCharCode(...font.data.slice(0, 4));
      expect(head).toBe('OTTO');
      expect(font.data.length).toBeGreaterThan(1_000_000);
    }
  });

  it('한국어·영어 로케일에는 동봉 폰트 3종과 Pretendard 대체 폰트를 반환한다', async () => {
    // 결과뿐 아니라 Promise 자체를 로케일 사이에서 재사용한다.
    expect(loadDefaultFonts('ko')).toBe(loadDefaultFonts('en'));
    const a = await loadDefaultFonts();
    const b = await loadDefaultFonts('ko');
    const c = await loadDefaultFonts('en');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.map((f) => f.name)).toEqual(['Pretendard', 'Pretendard-Bold', 'Noto Sans JP']);
    expect(a.filter((f) => f.fallback === true).map((f) => f.name)).toEqual(['Pretendard']);
  });
});

describe('동봉 기본 폰트 (Noto Sans JP, ADR-042)', () => {
  it('Regular 1종이고 대체(fallback) 폰트다', () => {
    expect(NOTO_SANS_JP_FONTS.map((f) => f.name)).toEqual(['Noto Sans JP']);
    expect(NOTO_SANS_JP_FONTS[0]!.fallback).toBe(true);
  });

  it('데이터가 실제 TTF다 (매직 바이트 0x00010000, 일본어 폰트 크기)', () => {
    const font = NOTO_SANS_JP_FONTS[0]!;
    expect([...font.data.slice(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
    expect(font.data.length).toBeGreaterThan(1_000_000);
  });

  it('일본어 로케일에는 동봉 폰트 3종과 Noto Sans JP 대체 폰트를 반환한다', async () => {
    const a = await loadDefaultFonts('ja');
    const b = await loadDefaultFonts('ja');
    expect(a).toBe(b);
    expect(a.map((f) => f.name)).toEqual(['Pretendard', 'Pretendard-Bold', 'Noto Sans JP']);
    expect(a.filter((f) => f.fallback === true).map((f) => f.name)).toEqual(['Noto Sans JP']);
    // 반환 목록을 구성해도 원본 폰트 정의는 변경하지 않는다.
    expect(NOTO_SANS_JP_FONTS[0]!.fallback).toBe(true);
    expect(PRETENDARD_FONTS[0]!.fallback).toBe(true);
  });
});
