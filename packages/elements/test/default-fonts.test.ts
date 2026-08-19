import { describe, expect, it } from 'vitest';
import { loadDefaultFonts } from '../src/default-fonts.js';
import { PRETENDARD_FONTS } from '../src/fonts/pretendard.js';

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

  it('loadDefaultFonts는 같은 목록을 재사용한다 (캐시)', async () => {
    const a = await loadDefaultFonts();
    const b = await loadDefaultFonts();
    expect(a).toBe(b);
    expect(a).toBe(PRETENDARD_FONTS);
  });
});
