// 동봉 폰트 지연 로딩 — 청크를 각각 한 번만 읽고 로케일별 Promise를 재사용하는지 확인한다.
// 실제 `default-fonts.js`·`settings.js`를 쓰고 대형 폰트 청크만 평가 횟수를 세는 대역으로 바꾼다.
import { describe, expect, it, vi } from 'vitest';

// 팩토리는 모듈을 처음 가져올 때 한 번 실행되므로 이 횟수가 청크를 읽은 횟수다.
// 실제 모듈과 같은 모양(이름·순서·fallback)을 유지하고 데이터만 몇 바이트로 줄인다.
const chunkEvaluations = vi.hoisted(() => ({ pretendard: 0, notoSansJp: 0 }));

vi.mock('../src/fonts/pretendard.js', () => {
  chunkEvaluations.pretendard += 1;
  return {
    PRETENDARD_FONTS: [
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ],
  };
});
vi.mock('../src/fonts/noto-sans-jp.js', () => {
  chunkEvaluations.notoSansJp += 1;
  const NOTO_SANS_JP_FONTS = [{ name: 'Noto Sans JP', data: new Uint8Array([3]), fallback: true }];
  return { NOTO_SANS_JP_FONTS, default: NOTO_SANS_JP_FONTS };
});

import type { SlipKit } from '@omdc-slipkit/core';
import { loadDefaultFonts } from '../src/default-fonts.js';
import { resolveFonts } from '../src/settings.js';

/** 세 로케일이 공통으로 돌려주는 동봉 폰트 이름과 순서 */
const BUNDLED_FONT_NAMES = ['Pretendard', 'Pretendard-Bold', 'Noto Sans JP'];

/** `fallback: true`인 폰트 이름 */
function fallbackNames(fonts: readonly { name: string; fallback?: boolean }[]): string[] {
  return fonts.filter((f) => f.fallback === true).map((f) => f.name);
}

describe('동봉 폰트 지연 로딩', () => {
  it('default-fonts·settings를 가져오기만 해서는 폰트 청크를 읽지 않는다', () => {
    expect(chunkEvaluations).toEqual({ pretendard: 0, notoSansJp: 0 });
  });

  it('기본·ko·en은 같은 Promise를 돌려주고 ja는 별도 Promise를 재사용한다', async () => {
    const base = loadDefaultFonts();
    expect(loadDefaultFonts('ko')).toBe(base);
    expect(loadDefaultFonts('en')).toBe(base);
    // 같은 청크를 처음 읽는 동안 다른 로케일의 읽기가 겹치면 vitest의 모듈 대역이 두 번 만들어진다.
    // 실제 ESM은 같은 모듈을 한 번만 평가하므로 시험에서만 첫 읽기를 순서대로 끝낸다.
    await base;
    const ja = loadDefaultFonts('ja');
    expect(ja).not.toBe(base);
    expect(loadDefaultFonts('ja')).toBe(ja);
  });

  it('세 로케일 모두 같은 폰트 3종을 같은 순서로 주고 대체 폰트만 다르다', async () => {
    for (const locale of ['ko', 'en'] as const) {
      const fonts = await loadDefaultFonts(locale);
      expect(fonts.map((f) => f.name)).toEqual(BUNDLED_FONT_NAMES);
      expect(fallbackNames(fonts)).toEqual(['Pretendard']);
    }
    const ja = await loadDefaultFonts('ja');
    expect(ja.map((f) => f.name)).toEqual(BUNDLED_FONT_NAMES);
    expect(fallbackNames(ja)).toEqual(['Noto Sans JP']);
  });

  it('네 로케일 인자로 여러 번 불러도 두 폰트 청크는 각각 한 번만 읽는다', async () => {
    await Promise.all([
      loadDefaultFonts(),
      loadDefaultFonts('ko'),
      loadDefaultFonts('en'),
      loadDefaultFonts('ja'),
    ]);
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });
  });

  it('반환 목록은 원본 폰트 정의와 분리된 새 항목이고 원본 fallback을 바꾸지 않는다', async () => {
    // 이미 평가된 대역 모듈을 그대로 받는다 — 여기서 청크를 다시 읽지 않는다.
    const { PRETENDARD_FONTS } = await import('../src/fonts/pretendard.js');
    const { NOTO_SANS_JP_FONTS } = await import('../src/fonts/noto-sans-jp.js');
    const ko = await loadDefaultFonts('ko');
    const ja = await loadDefaultFonts('ja');

    expect(ko).not.toBe(PRETENDARD_FONTS);
    expect(ko[0]).not.toBe(PRETENDARD_FONTS[0]);
    expect(ko[2]).not.toBe(NOTO_SANS_JP_FONTS[0]);
    // 폰트 바이트는 복사하지 않고 같은 배열을 가리킨다.
    expect(ko[0]!.data).toBe(PRETENDARD_FONTS[0]!.data);
    expect(ja[2]!.data).toBe(NOTO_SANS_JP_FONTS[0]!.data);
    // 로케일에 따라 대체 폰트를 옮겨도 원본 정의는 그대로다.
    expect(ko[2]!.fallback).toBeUndefined();
    expect(ja[0]!.fallback).toBeUndefined();
    expect(PRETENDARD_FONTS[0]!.fallback).toBe(true);
    expect(NOTO_SANS_JP_FONTS[0]!.fallback).toBe(true);
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });
  });

  it('resolveFonts는 getFonts가 없거나 빈 목록이면 같은 캐시의 동봉 폰트를 돌려준다', async () => {
    const ko = await loadDefaultFonts('ko');
    const ja = await loadDefaultFonts('ja');

    expect(await resolveFonts(undefined, 'ko')).toBe(ko);
    expect(await resolveFonts({} as unknown as SlipKit, 'en')).toBe(ko);
    expect(await resolveFonts({ getFonts: () => [] } as unknown as SlipKit, 'ja')).toBe(ja);
    // 지역 코드가 붙은 로케일도 언어 코드의 캐시를 쓴다.
    expect(await resolveFonts(undefined, 'ja-JP')).toBe(ja);
    expect(await resolveFonts(undefined, 'ko-KR')).toBe(ko);
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });
  });
});
