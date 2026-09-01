// @vitest-environment happy-dom
// 동봉 기본 폰트의 로케일 기준 — 캔버스와 PDF가 같은 대체 폰트를 고르는지 확인합니다.
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
  // 로케일마다 대체 폰트가 달라지는 동봉 폰트를 흉내 냅니다.
  loadDefaultFonts: (locale?: string) =>
    Promise.resolve(locale === 'ja'
      ? [
          { name: 'Noto Sans JP', data: new Uint8Array([3]), fallback: true },
          { name: 'Pretendard', data: new Uint8Array([1]) },
        ]
      : [
          { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
          { name: 'Noto Sans JP', data: new Uint8Array([3]) },
        ]),
}));

import type { SlipFile, SlipKit } from '@omdc-slipkit/core';
import { getStrings } from '../../src/strings.js';
import {
  parseSlipFileMock,
  makeTemplateFile,
  createElement,
  flush,
  selectElement,
  type Designer,
} from './helpers.js';

/** 등록에 성공하는 FontFace 대역 */
class FakeFontFace {
  constructor(readonly family: string, readonly source: unknown) {}
  load(): Promise<this> {
    return Promise.resolve(this);
  }
}

describe('<slip-designer> 동봉 폰트의 로케일 기준', () => {
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

  async function mount(setup: (el: Designer) => void): Promise<Designer> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
    }] as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    setup(el);
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    selectElement(el, 't1');
    await el.updateComplete;
    return el;
  }

  /** 폰트 선택의 기본값 항목에 적힌 대체 폰트 이름 */
  function defaultOptionLabel(el: Designer, label: string): string {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    return (row!.querySelector('.list-select') as HTMLElement).textContent?.trim() ?? '';
  }

  it('SlipKit 로케일이 UI 로케일보다 앞선다 — PDF와 같은 대체 폰트를 쓴다', async () => {
    const ja = getStrings('ja').designer;
    const el = await mount((d) => {
      d.slipkit = { locale: 'ko' } as unknown as SlipKit;
      d.locale = 'ja';
    });
    // 화면 문구는 UI 로케일(일본어)이지만 대체 폰트는 렌더 로케일(ko)을 따릅니다.
    expect(defaultOptionLabel(el, ja.fontName)).toBe(`${ja.fontDefault} (Pretendard)`);
    el.remove();
  });

  it('SlipKit에 로케일이 없으면 컴포넌트 로케일을 따르고, 바뀌면 대체 폰트도 바뀐다', async () => {
    const ko = getStrings('ko').designer;
    const ja = getStrings('ja').designer;
    const el = await mount((d) => {
      d.slipkit = {} as unknown as SlipKit;
      d.locale = 'ko';
    });
    expect(defaultOptionLabel(el, ko.fontName)).toBe(`${ko.fontDefault} (Pretendard)`);

    el.locale = 'ja';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(defaultOptionLabel(el, ja.fontName)).toBe(`${ja.fontDefault} (Noto Sans JP)`);
    el.remove();
  });
});
