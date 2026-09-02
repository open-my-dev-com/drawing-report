// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', () => ({
  parseSlipFile: vi.fn(),
  renderSlipToPdf: vi.fn(),
}));

vi.mock('../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의한다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import { parseSlipFile, renderSlipToPdf } from '@omdc-slipkit/core';
import type { SlipFile, SlipKit } from '@omdc-slipkit/core';
import { getStrings } from '../src/strings.js';

// 기본 영어 문구를 기준으로 화면을 확인한다.
const strings = getStrings();

const parseSlipFileMock = vi.mocked(parseSlipFile);
const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);

const DUMMY_FILE: SlipFile = {
  schemaVersion: '0.1.0',
  kind: 'template',
  template: {
    meta: { title: '테스트' },
    paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
    pages: [{ elements: [] }],
  },
} as unknown as SlipFile;

const DUMMY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

let blobUrls: string[];
let revokedUrls: string[];

beforeEach(() => {
  blobUrls = [];
  revokedUrls = [];

  let urlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:test-${++urlCounter}`;
    blobUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revokedUrls.push(url);
  });

  parseSlipFileMock.mockReturnValue(DUMMY_FILE);
  renderSlipToPdfMock.mockResolvedValue(DUMMY_PDF);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createElement(): Promise<import('../src/slip-viewer.js').SlipViewer> {
  const { SlipViewer } = await import('../src/slip-viewer.js');
  if (!customElements.get('slip-viewer')) {
    customElements.define('slip-viewer', SlipViewer);
  }
  const el = document.createElement('slip-viewer') as import('../src/slip-viewer.js').SlipViewer;
  document.body.appendChild(el);
  return el;
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function shadowText(el: Element): string {
  return el.shadowRoot?.textContent?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// 빈 상태
// ---------------------------------------------------------------------------

describe('<slip-viewer> 빈 상태', () => {
  it('src가 없으면 안내 메시지를 표시한다', async () => {
    const el = await createElement();
    await el.updateComplete;
    expect(shadowText(el)).toBe(strings.viewer.noFile);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 파싱 오류
// ---------------------------------------------------------------------------

describe('<slip-viewer> 파싱 오류', () => {
  it('잘못된 JSON이면 파싱 오류를 표시한다', async () => {
    parseSlipFileMock.mockImplementation(() => {
      throw new Error('parse error');
    });
    const el = await createElement();
    el.src = '{ invalid json }';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(shadowText(el)).toBe(strings.viewer.parseError);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// PDF 렌더링 성공
// ---------------------------------------------------------------------------

describe('<slip-viewer> PDF 렌더링', () => {
  it('유효한 src로 PDF를 생성하고 iframe을 표시한다', async () => {
    const el = await createElement();
    el.src = '{"schemaVersion":"0.1.0","kind":"template"}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(parseSlipFileMock).toHaveBeenCalled();
    // 폰트 설정이 없으면 기본 폰트 공급 함수를 렌더러에 전달한다.
    const call = renderSlipToPdfMock.mock.calls.at(-1)!;
    expect(call[0]).toBe(DUMMY_FILE);
    const fonts = await call[1]?.getFonts?.();
    expect(fonts?.length).toBe(2);
    expect(fonts?.[0]?.name).toBe('Pretendard');
    expect(fonts?.[0]?.fallback).toBe(true);

    const iframe = el.shadowRoot?.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toMatch(/^blob:/);
    el.remove();
  });

  it('slipkit을 주면 같은 인스턴스의 render로 미리보기를 만든다', async () => {
    const el = await createElement();
    const fonts = [{ name: 'TestFont', data: new Uint8Array([1, 2, 3]) }];
    const render = vi.fn().mockResolvedValue(DUMMY_PDF);
    el.slipkit = { locale: undefined, getFonts: () => fonts, render } as unknown as SlipKit;
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 미리보기가 호스트의 직접 렌더링과 같은 인스턴스를 사용한다.
    expect(render).toHaveBeenCalledWith(DUMMY_FILE);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();
    el.remove();
  });

  it('slipkit에 폰트가 없으면 인스턴스 로케일의 동봉 폰트를 사용한다', async () => {
    const el = await createElement();
    const render = vi.fn().mockResolvedValue(DUMMY_PDF);
    el.slipkit = { locale: 'ja', getFonts: undefined, render } as unknown as SlipKit;
    el.locale = 'ko';
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(render).not.toHaveBeenCalled();
    const call = renderSlipToPdfMock.mock.calls.at(-1)!;
    expect(call[0]).toBe(DUMMY_FILE);
    expect(call[1]?.locale).toBe('ja');
    const bundledFonts = await call[1]?.getFonts?.();
    expect(bundledFonts?.[0]?.name).toBe('Pretendard');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// PDF 렌더링 오류
// ---------------------------------------------------------------------------

describe('<slip-viewer> 렌더링 오류', () => {
  it('renderSlipToPdf 실패 시 오류 메시지를 표시한다', async () => {
    renderSlipToPdfMock.mockRejectedValue(new Error('render failed'));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(shadowText(el)).toBe(strings.viewer.renderError);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// Blob URL 정리
// ---------------------------------------------------------------------------

describe('<slip-viewer> Blob URL 관리', () => {
  it('src 변경 시 이전 Blob URL을 해제한다', async () => {
    const el = await createElement();
    el.src = '{"first": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const firstUrl = blobUrls[0]!;
    expect(firstUrl).toBeDefined();

    el.src = '{"second": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(revokedUrls).toContain(firstUrl);
    el.remove();
  });

  it('컴포넌트 제거 시 Blob URL을 해제한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const url = blobUrls[0]!;
    el.remove();
    expect(revokedUrls).toContain(url);
  });
});

// ---------------------------------------------------------------------------
// 컴포넌트 생명주기와 Blob URL 정리
// ---------------------------------------------------------------------------

describe('<slip-viewer> 생명주기 정리', () => {
  it('렌더 대기 중 컴포넌트가 제거되면 blob URL을 만들지 않는다', async () => {
    let resolveRender!: (pdf: Uint8Array) => void;
    renderSlipToPdfMock.mockImplementation(
      () => new Promise<Uint8Array>((resolve) => { resolveRender = resolve; }),
    );

    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();

    // 렌더링이 완료되기 전에 컴포넌트를 분리한다.
    el.remove();
    resolveRender(DUMMY_PDF);
    await flush();

    expect(blobUrls.length).toBe(0);
  });
});


describe('<slip-viewer> UI 언어 (ADR-028)', () => {
  it('locale="en"이면 안내 문구가 영어로 표시된다', async () => {
    const el = await createElement();
    el.locale = 'en';
    await el.updateComplete;
    expect(shadowText(el)).toBe('No .slip file to display.');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 로케일·slipkit 변경과 분리·재연결
// ---------------------------------------------------------------------------

describe('<slip-viewer> 로케일 변경과 재연결', () => {
  async function settle(el: Element & { updateComplete: Promise<boolean> }): Promise<void> {
    await el.updateComplete;
    await flush();
    await el.updateComplete;
  }

  it('locale이 바뀌면 그 로케일로 PDF를 다시 만든다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);

    el.locale = 'ja';
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(2);
    expect(renderSlipToPdfMock.mock.calls.at(-1)![1]?.locale).toBe('ja');
    // 이전 미리보기 Blob URL은 해제하고 새 것을 표시한다.
    expect(revokedUrls).toContain(blobUrls[0]!);
    expect(el.shadowRoot?.querySelector('iframe')?.getAttribute('src')).toBe(blobUrls[1]!);
    el.remove();
  });

  it('slipkit이 바뀌면 새 인스턴스로 PDF를 다시 만든다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await settle(el);
    const render = vi.fn().mockResolvedValue(DUMMY_PDF);
    el.slipkit = { locale: 'ko', getFonts: () => [{ name: 'F', data: new Uint8Array([1]) }], render } as unknown as SlipKit;
    await settle(el);
    expect(render).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('로케일이 바뀌면 파싱 오류 문구도 그 언어로 바뀐다', async () => {
    parseSlipFileMock.mockImplementation(() => {
      throw new Error('parse error');
    });
    const el = await createElement();
    el.src = '{ invalid json }';
    await settle(el);
    expect(shadowText(el)).toBe(strings.viewer.parseError);
    el.locale = 'ko';
    await settle(el);
    expect(shadowText(el)).toBe(getStrings('ko').viewer.parseError);
    el.remove();
  });

  it('분리 중 완료된 렌더 결과는 버리고 다시 연결하면 현재 src로 복구한다', async () => {
    let resolveRender!: (pdf: Uint8Array) => void;
    renderSlipToPdfMock.mockImplementationOnce(
      () => new Promise<Uint8Array>((resolve) => { resolveRender = resolve; }),
    );
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();

    el.remove();
    resolveRender(DUMMY_PDF);
    await flush();
    expect(blobUrls.length).toBe(0);

    // 다시 연결하면 분리 중 버린 결과 대신 현재 src로 다시 렌더한다.
    document.body.appendChild(el);
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(2);
    expect(blobUrls.length).toBe(1);
    expect(el.shadowRoot?.querySelector('iframe')?.getAttribute('src')).toBe(blobUrls[0]!);
    el.remove();
    expect(revokedUrls).toContain(blobUrls[0]!);
  });

  it('갱신 중 상태 변경으로 Lit 경고를 내지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = await createElement();
    el.src = '{"first": true}';
    await settle(el);
    el.src = '{"second": true}';
    el.locale = 'ja';
    await settle(el);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes('scheduled an update'))).toEqual([]);
    el.remove();
  });
});
