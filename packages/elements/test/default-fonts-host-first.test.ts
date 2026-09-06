// 호스트 폰트가 있으면 동봉 폰트 청크를 읽지 않는지 확인한다.
// 청크 평가 횟수가 0인 상태에서 시작해야 하므로 `default-fonts-loading.test.ts`와 파일을 나눈다.
import { describe, expect, it, vi } from 'vitest';

// 팩토리는 모듈을 처음 가져올 때 한 번 실행되므로 이 횟수가 청크를 읽은 횟수다.
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

import { createSlipKit, type SlipFont, type SlipKit } from '@omdc-slipkit/core';
import { resolveFonts } from '../src/settings.js';

const HOST_FONTS: readonly SlipFont[] = [{ name: 'Host Sans', data: new Uint8Array([7]), fallback: true }];

describe('호스트 폰트가 있을 때의 동봉 폰트 청크', () => {
  it('getFonts가 비어 있지 않은 목록을 주면 그 목록을 그대로 돌려주고 청크를 읽지 않는다', async () => {
    const slipkit = { getFonts: () => HOST_FONTS } as unknown as SlipKit;
    expect(await resolveFonts(slipkit, 'ja')).toBe(HOST_FONTS);
    expect(await resolveFonts(slipkit, 'ko')).toBe(HOST_FONTS);

    // createSlipKit 인스턴스도 같다 — 공급 결과를 그대로 넘긴다.
    const instance = createSlipKit({ locale: 'ja', getFonts: () => HOST_FONTS });
    expect(await resolveFonts(instance, 'ja')).toBe(HOST_FONTS);
    expect(chunkEvaluations).toEqual({ pretendard: 0, notoSansJp: 0 });
  });

  it('그 뒤 빈 목록을 받으면 그때 처음 두 청크를 한 번씩 읽는다', async () => {
    const fonts = await resolveFonts(createSlipKit({ getFonts: () => [] }), 'ja');
    expect(fonts.map((f) => f.name)).toEqual(['Pretendard', 'Pretendard-Bold', 'Noto Sans JP']);
    expect(fonts.filter((f) => f.fallback === true).map((f) => f.name)).toEqual(['Noto Sans JP']);
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });
  });
});
