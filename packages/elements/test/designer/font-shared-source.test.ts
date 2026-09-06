// @vitest-environment happy-dom
// 디자이너·작성 폼·뷰어가 같은 SlipKit으로 동봉 폰트를 쓸 때 폰트 청크를 각각 한 번만 읽고
// 같은 목록을 나눠 쓰는지 확인합니다. 호스트 폰트가 있으면 청크를 아예 읽지 않아야 합니다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

// 팩토리는 모듈을 처음 가져올 때 한 번 실행되므로 이 횟수가 청크를 읽은 횟수입니다.
// 실제 모듈과 같은 모양(이름·순서·fallback)을 유지하고 데이터만 몇 바이트로 줄입니다.
const chunkEvaluations = vi.hoisted(() => ({ pretendard: 0, notoSansJp: 0 }));

vi.mock('../../src/fonts/pretendard.js', () => {
  chunkEvaluations.pretendard += 1;
  return {
    PRETENDARD_FONTS: [
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ],
  };
});
vi.mock('../../src/fonts/noto-sans-jp.js', () => {
  chunkEvaluations.notoSansJp += 1;
  const NOTO_SANS_JP_FONTS = [{ name: 'Noto Sans JP', data: new Uint8Array([3]), fallback: true }];
  return { NOTO_SANS_JP_FONTS, default: NOTO_SANS_JP_FONTS };
});

// 실제 구현을 그대로 쓰되 호출과 반환 Promise를 기록합니다.
vi.mock('../../src/default-fonts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/default-fonts.js')>();
  return { loadDefaultFonts: vi.fn(actual.loadDefaultFonts) };
});

import { createSlipKit, type SlipFont, type SlipKit } from '@omdc-slipkit/core';
import { loadDefaultFonts } from '../../src/default-fonts.js';
import {
  installDesignerTestEnv,
  renderSlipToPdfMock,
  flush,
  DUMMY_PDF,
  type Designer,
} from './helpers.js';

type Viewer = import('../../src/slip-viewer.js').SlipViewer;
type Form = import('../../src/slip-form.js').SlipForm;

const loadDefaultFontsMock = vi.mocked(loadDefaultFonts);

/** 세 로케일이 공통으로 돌려주는 동봉 폰트 이름과 순서 */
const BUNDLED_FONT_NAMES = ['Pretendard', 'Pretendard-Bold', 'Noto Sans JP'];

const HOST_FONTS: readonly SlipFont[] = [{ name: 'Host Sans', data: new Uint8Array([7]), fallback: true }];

installDesignerTestEnv();

/** 조건이 참이 될 때까지 반복해서 확인합니다 — 작성 폼의 미리보기는 디바운스됩니다. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('조건을 기다리다 시간이 초과되었습니다');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 세 컴포넌트를 한 번 등록합니다. 모듈을 평가하고 요소를 정의하는 것만으로는 폰트 청크를 읽지 않아야 합니다. */
async function defineComponents(): Promise<void> {
  const [{ SlipDesigner }, { SlipViewer }, { SlipForm }] = await Promise.all([
    import('../../src/slip-designer.js'),
    import('../../src/slip-viewer.js'),
    import('../../src/slip-form.js'),
  ]);
  if (!customElements.get('slip-designer')) customElements.define('slip-designer', SlipDesigner);
  if (!customElements.get('slip-viewer')) customElements.define('slip-viewer', SlipViewer);
  if (!customElements.get('slip-form')) customElements.define('slip-form', SlipForm);
}

/**
 * 같은 SlipKit으로 양식을 넣은 컴포넌트를 문서에 붙여 렌더시킵니다.
 * 호스트가 하듯 속성을 먼저 지정하고 붙여야 첫 렌더가 `slipkit` 없이 실행되지 않습니다.
 */
async function mount<T extends Designer | Viewer | Form>(
  tag: 'slip-designer' | 'slip-viewer' | 'slip-form',
  slipkit: SlipKit,
): Promise<T> {
  const el = document.createElement(tag) as T;
  el.slipkit = slipkit;
  el.src = '{"valid": true}';
  document.body.appendChild(el);
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

function fontNames(el: Designer): readonly string[] {
  return (el as unknown as { _fontRegistry: { fontNames: readonly string[] } })
    ._fontRegistry.fontNames;
}

function fallbackName(el: Designer): string | undefined {
  return (el as unknown as { _fontRegistry: { fallbackName: string | undefined } })
    ._fontRegistry.fallbackName;
}

/** 렌더러에 넘어간 `getFonts`가 돌려준 배열 자체 — 같은 캐시를 쓰면 모두 같은 객체입니다. */
async function fontListsPassedToRenderer(): Promise<readonly (readonly SlipFont[])[]> {
  return Promise.all(renderSlipToPdfMock.mock.calls.map(([, options]) => options!.getFonts!()));
}

describe('디자이너·작성 폼·뷰어의 동봉 폰트 공유', () => {
  // 청크 평가 횟수가 0인지 확인하는 시험이 가장 먼저 실행됩니다.
  it('호스트 폰트가 있으면 세 컴포넌트 모두 폰트 청크를 읽지 않는다', async () => {
    renderSlipToPdfMock.mockClear();
    loadDefaultFontsMock.mockClear();
    const render = vi.fn(() => Promise.resolve(DUMMY_PDF));
    const slipkit = { locale: 'ko', getFonts: () => HOST_FONTS, render } as unknown as SlipKit;

    await defineComponents();
    const designer = await mount<Designer>('slip-designer', slipkit);
    const viewer = await mount<Viewer>('slip-viewer', slipkit);
    const form = await mount<Form>('slip-form', slipkit);
    // 뷰어는 바로, 작성 폼은 디바운스 뒤에 인스턴스로 렌더링합니다.
    await waitFor(() => render.mock.calls.length >= 2);
    await designer.updateComplete;

    expect(fontNames(designer)).toEqual(['Host Sans']);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();
    expect(loadDefaultFontsMock).not.toHaveBeenCalled();
    expect(chunkEvaluations).toEqual({ pretendard: 0, notoSansJp: 0 });

    designer.remove();
    viewer.remove();
    form.remove();
  });

  it('getFonts가 없으면 두 청크를 각각 한 번만 읽고 세 컴포넌트가 같은 목록을 쓴다', async () => {
    renderSlipToPdfMock.mockClear();
    loadDefaultFontsMock.mockClear();
    const slipkit = createSlipKit({ locale: 'ko' });

    // 디자이너가 처음 폰트를 해석할 때 청크를 읽습니다. 그 뒤 컴포넌트는 같은 결과를 기다립니다.
    const designer = await mount<Designer>('slip-designer', slipkit);
    await waitFor(() => fontNames(designer).length > 0);
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });
    expect(fontNames(designer)).toEqual(BUNDLED_FONT_NAMES);
    expect(fallbackName(designer)).toBe('Pretendard');

    const viewer = await mount<Viewer>('slip-viewer', slipkit);
    const form = await mount<Form>('slip-form', slipkit);
    await waitFor(() => renderSlipToPdfMock.mock.calls.length >= 2);

    // 뷰어와 작성 폼은 인스턴스 렌더링이 아니라 동봉 폰트 공급 함수를 렌더러에 넘깁니다.
    const shared = await loadDefaultFonts('ko');
    const lists = await fontListsPassedToRenderer();
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list).toBe(shared);
    expect(lists[0]!.map((f) => f.name)).toEqual(BUNDLED_FONT_NAMES);

    // 디자이너·뷰어·작성 폼의 요청이 모두 같은 로케일 Promise로 이어졌습니다.
    expect(loadDefaultFontsMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of loadDefaultFontsMock.mock.calls) expect(call[0]).toBe('ko');
    for (const result of loadDefaultFontsMock.mock.results) {
      expect(result.type).toBe('return');
      expect(result.value).toBe(loadDefaultFontsMock.mock.results[0]!.value);
    }
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });

    designer.remove();
    viewer.remove();
    form.remove();
  });

  it('getFonts가 빈 목록을 주는 SlipKit도 같은 동봉 폰트 목록을 쓰고 청크를 다시 읽지 않는다', async () => {
    renderSlipToPdfMock.mockClear();
    loadDefaultFontsMock.mockClear();
    const render = vi.fn(() => Promise.resolve(DUMMY_PDF));
    const slipkit = createSlipKit({ locale: 'ko', getFonts: () => [] });
    (slipkit as { render: SlipKit['render'] }).render = render;

    const designer = await mount<Designer>('slip-designer', slipkit);
    const viewer = await mount<Viewer>('slip-viewer', slipkit);
    const form = await mount<Form>('slip-form', slipkit);
    await waitFor(() => renderSlipToPdfMock.mock.calls.length >= 2);
    await waitFor(() => fontNames(designer).length > 0);

    // 빈 목록은 호스트 폰트로 치지 않으므로 인스턴스 렌더링을 쓰지 않습니다.
    expect(render).not.toHaveBeenCalled();
    expect(fontNames(designer)).toEqual(BUNDLED_FONT_NAMES);
    expect(fallbackName(designer)).toBe('Pretendard');

    const shared = await loadDefaultFonts('ko');
    for (const list of await fontListsPassedToRenderer()) expect(list).toBe(shared);
    expect(chunkEvaluations).toEqual({ pretendard: 1, notoSansJp: 1 });

    designer.remove();
    viewer.remove();
    form.remove();
  });
});
