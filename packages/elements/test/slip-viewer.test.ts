// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', () => ({
  parseSlipFile: vi.fn(),
  renderSlipToPdf: vi.fn(),
}));

import { parseSlipFile, renderSlipToPdf } from '@omdc-slipkit/core';
import type { SlipFile } from '@omdc-slipkit/core';
import { strings } from '../src/strings.js';

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
    expect(renderSlipToPdfMock).toHaveBeenCalledWith(DUMMY_FILE, { fonts: undefined });

    const iframe = el.shadowRoot?.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toMatch(/^blob:/);
    el.remove();
  });

  it('fonts 프로퍼티를 renderSlipToPdf에 전달한다', async () => {
    const el = await createElement();
    const fonts = [{ name: 'TestFont', data: new Uint8Array([1, 2, 3]) }];
    el.fonts = fonts;
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(renderSlipToPdfMock).toHaveBeenCalledWith(DUMMY_FILE, { fonts });
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
// 생명주기 정리 (blob URL 누수 방지)
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

    // 렌더가 끝나기 전에 분리
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
