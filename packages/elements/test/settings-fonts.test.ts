// 미리보기 렌더링의 폰트 선택 — 사용자 폰트가 비어 있으면 동봉 폰트를 씁니다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return { ...actual, renderSlipToPdf: vi.fn(() => Promise.resolve(new Uint8Array([1]))) };
});

vi.mock('../src/default-fonts.js', () => ({
  loadDefaultFonts: (locale?: string) =>
    Promise.resolve(locale === 'ja'
      ? [{ name: 'Noto Sans JP', data: new Uint8Array([3]), fallback: true }]
      : [{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import { renderSlipToPdf, type SlipFile, type SlipKit } from '@omdc-slipkit/core';
import { renderSlip, resolveFonts } from '../src/settings.js';

const FILE = { kind: 'template' } as unknown as SlipFile;
const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);

/** 렌더러에 넘어간 `getFonts`가 실제로 돌려준 폰트 이름 */
async function fontNamesPassedToRenderer(): Promise<string[]> {
  const options = renderSlipToPdfMock.mock.calls[0]![1]!;
  const fonts = await options.getFonts!();
  return fonts.map((f) => f.name);
}

describe('renderSlip의 폰트 선택', () => {
  it('getFonts가 빈 목록을 주면 렌더 로케일의 동봉 폰트를 쓴다', async () => {
    renderSlipToPdfMock.mockClear();
    const render = vi.fn();
    const slipkit = { getFonts: () => [], locale: 'ko', render } as unknown as SlipKit;

    await renderSlip(slipkit, FILE);
    // 인스턴스 렌더링을 쓰지 않고 동봉 폰트로 직접 렌더링합니다.
    expect(render).not.toHaveBeenCalled();
    expect(await fontNamesPassedToRenderer()).toEqual(['Pretendard']);
  });

  it('사용자 폰트가 있으면 인스턴스로 렌더링한다', async () => {
    renderSlipToPdfMock.mockClear();
    const render = vi.fn(() => Promise.resolve(new Uint8Array([2])));
    const slipkit = {
      getFonts: () => [{ name: 'Host', data: new Uint8Array([9]) }],
      render,
    } as unknown as SlipKit;

    await renderSlip(slipkit, FILE);
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();
  });

  it('SlipKit 로케일이 없으면 넘겨받은 로케일의 동봉 폰트를 쓴다', async () => {
    renderSlipToPdfMock.mockClear();
    await renderSlip({ getFonts: () => [] } as unknown as SlipKit, FILE, 'ja');
    expect(await fontNamesPassedToRenderer()).toEqual(['Noto Sans JP']);
  });
});

describe('resolveFonts', () => {
  it('빈 목록을 주면 동봉 폰트로 대체한다', async () => {
    const slipkit = { getFonts: () => [] } as unknown as SlipKit;
    expect((await resolveFonts(slipkit, 'ja')).map((f) => f.name)).toEqual(['Noto Sans JP']);
  });
});
