// @vitest-environment happy-dom
// 호스트 폰트 공급 실패와 재시도 과정에서 디자이너와 PDF가 같은 출처를 쓰는지 확인합니다.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  loadDefaultFonts: () =>
    Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import { createSlipKit, type SlipFile, type SlipKit } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  createElement,
  flush,
  toolbarButton,
  type Designer,
} from './helpers.js';

const HOST_FONTS = [{ name: 'Host Sans', data: new Uint8Array([7]), fallback: true }];

/** 등록에 성공하는 FontFace 대역 */
class FakeFontFace {
  constructor(readonly family: string, readonly source: unknown) {}
  load(): Promise<this> {
    return Promise.resolve(this);
  }
}

describe('<slip-designer> 호스트 폰트 공급 실패와 재시도', () => {
  const s = strings.designer;

  beforeEach(() => {
    (globalThis as { FontFace?: unknown }).FontFace = FakeFontFace;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: () => undefined },
    });
  });

  afterEach(() => {
    delete (globalThis as { FontFace?: unknown }).FontFace;
    Reflect.deleteProperty(document, 'fonts');
  });

  /** 첫 호출만 실패하고 이후에는 사용자 폰트를 주는 SlipKit 대역 */
  function failingSlipKit(failFirst: () => never): {
    slipkit: SlipKit;
    getFonts: ReturnType<typeof vi.fn>;
  } {
    let attempt = 0;
    const getFonts = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return failFirst();
      return HOST_FONTS;
    });
    const slipkit = {
      getFonts,
      render: () => Promise.resolve(new Uint8Array([0x25, 0x50])),
    } as unknown as SlipKit;
    return { slipkit, getFonts };
  }

  function fontNames(el: Designer): readonly string[] {
    return (el as unknown as { _fontRegistry: { fontNames: readonly string[] } })
      ._fontRegistry.fontNames;
  }

  async function mount(slipkit: SlipKit): Promise<Designer> {
    const file = makeTemplateFile();
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.slipkit = slipkit;
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  /** 미리보기를 켜 렌더링이 끝날 때까지 기다립니다. */
  async function runPreview(el: Designer): Promise<void> {
    toolbarButton(el, s.preview).click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    await flush();
    await el.updateComplete;
  }

  it('조회에 실패하면 폰트 목록을 비우고 화면 갱신을 멈추지 않는다', async () => {
    const { slipkit } = failingSlipKit(() => {
      throw new Error('설정 오류');
    });
    const el = await mount(slipkit);
    // 동기 예외가 나도 디자이너는 계속 그려집니다.
    expect(el.shadowRoot!.querySelector('.toolbar')).not.toBeNull();
    expect(fontNames(el)).toEqual([]);
    el.remove();
  });

  it('미리보기 렌더링이 성공하면 실패했던 폰트 조회를 다시 시도한다', async () => {
    const { slipkit, getFonts } = failingSlipKit(() => {
      throw new Error('설정 오류');
    });
    const el = await mount(slipkit);
    expect(fontNames(el)).toEqual([]);

    await runPreview(el);
    expect(fontNames(el)).toEqual(['Host Sans']);
    expect(getFonts.mock.calls.length).toBeGreaterThan(1);
    el.remove();
  });

  it('비동기 거부도 같은 방식으로 다시 시도한다', async () => {
    const { slipkit } = failingSlipKit(
      () => Promise.reject(new Error('네트워크 오류')) as unknown as never,
    );
    const el = await mount(slipkit);
    expect(fontNames(el)).toEqual([]);

    await runPreview(el);
    expect(fontNames(el)).toEqual(['Host Sans']);
    el.remove();
  });

  it('같은 인스턴스를 쓰는 디자이너가 하나라도 성공하면 나머지도 함께 복구된다', async () => {
    const { slipkit } = failingSlipKit(() => {
      throw new Error('설정 오류');
    });
    const first = await mount(slipkit);
    expect(fontNames(first)).toEqual([]);

    // 두 번째 디자이너의 조회가 성공하면 같은 출처를 쓰는 첫 디자이너도 같은 목록을 봅니다.
    const second = await mount(slipkit);
    await first.updateComplete;
    expect(fontNames(second)).toEqual(['Host Sans']);
    expect(fontNames(first)).toEqual(['Host Sans']);
    first.remove();
    second.remove();
  });
  it('외부 조회가 성공한 뒤 다시 연결하면 공급 함수를 추가로 호출하지 않고 복구된다', async () => {
    let attempt = 0;
    const supply = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) throw new Error('설정 오류');
      return HOST_FONTS;
    });
    const slipkit = createSlipKit({ getFonts: supply });

    const el = await mount(slipkit);
    expect(fontNames(el)).toEqual([]);
    expect(supply).toHaveBeenCalledTimes(1);

    // 디자이너 외부에서 같은 인스턴스의 조회가 성공합니다.
    await slipkit.getFonts!();
    expect(supply).toHaveBeenCalledTimes(2);

    el.remove();
    document.body.appendChild(el);
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(fontNames(el)).toEqual(['Host Sans']);
    // 재연결이 공급 함수를 다시 부르지는 않습니다.
    expect(supply).toHaveBeenCalledTimes(2);
    el.remove();
  });

  it('성공 상태에서는 다시 연결해도 조회하지 않는다', async () => {
    const supply = vi.fn(() => HOST_FONTS);
    const slipkit = createSlipKit({ getFonts: supply });

    const el = await mount(slipkit);
    expect(fontNames(el)).toEqual(['Host Sans']);
    expect(supply).toHaveBeenCalledTimes(1);

    el.remove();
    document.body.appendChild(el);
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(supply).toHaveBeenCalledTimes(1);
    el.remove();
  });
});
