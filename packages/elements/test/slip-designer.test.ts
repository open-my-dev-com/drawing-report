// @vitest-environment happy-dom
// 조정 컴포넌트 — 로드, 페이지, 실행 취소, 로케일
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용한다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의한다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import { evaluateFormula } from '@omdc-slipkit/core';
import type { SlipFile, SlipKit } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  renderSlipToPdfMock,
  installDesignerTestEnv,
  createElement,
  loadDesigner,
  flush,
  shadowText,
  toolbarButton,
  addByCanvasClick,
  pageIndicator,
} from './designer/helpers.js';

installDesignerTestEnv();

// ---------------------------------------------------------------------------
// 빈 상태
// ---------------------------------------------------------------------------

describe('<slip-designer> 빈 상태', () => {
  it('src가 없으면 안내 메시지를 표시한다', async () => {
    const el = await createElement();
    await el.updateComplete;
    expect(shadowText(el)).toBe(strings.designer.noTemplate);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 파싱 오류
// ---------------------------------------------------------------------------

describe('<slip-designer> 파싱 오류', () => {
  it('잘못된 src는 파싱 오류를 표시한다', async () => {
    parseSlipFileMock.mockImplementation(() => {
      throw new Error('parse error');
    });
    const el = await createElement();
    el.src = '{ invalid }';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(shadowText(el)).toContain(strings.designer.parseError);
    el.remove();
  });

  it('voucher 파일은 양식 전용 오류를 표시한다', async () => {
    parseSlipFileMock.mockReturnValue({
      schemaVersion: '0.1.0',
      kind: 'voucher',
    } as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"kind":"voucher"}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(shadowText(el)).toContain(strings.designer.onlyTemplate);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 양식 로드
// ---------------------------------------------------------------------------

describe('<slip-designer> 양식 로드', () => {
  it('유효한 src로 캔버스에 요소를 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(2);
    expect(elements?.[0]?.getAttribute('data-id')).toBe('txt-1');
    expect(elements?.[1]?.getAttribute('data-id')).toBe('shp-1');
    el.remove();
  });

  it('용지(paper) 크기만큼 캔버스를 렌더한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const paper = el.shadowRoot?.querySelector('.paper') as HTMLElement;
    expect(paper).not.toBeNull();
    const pxPerMm = 96 / 25.4;
    expect(parseFloat(paper.style.width)).toBeCloseTo(210 * pxPerMm, 0);
    expect(parseFloat(paper.style.height)).toBeCloseTo(297 * pxPerMm, 0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 되돌리기 / 다시 실행
// ---------------------------------------------------------------------------

describe('<slip-designer> 되돌리기·다시 실행', () => {
  it('요소 추가 후 되돌리면 원래 상태로 복구된다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    await addByCanvasClick(el, strings.designer.addText);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    const undoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.undo) as HTMLElement;
    undoBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

    const redoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.redo) as HTMLElement;
    redoBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    el.remove();
  });
});

describe('<slip-designer> 페이지', () => {
  it('페이지 표시기가 현재/전체 페이지를 보여주고, 한 페이지면 삭제가 비활성화된다', async () => {
    const el = await loadDesigner();
    expect(pageIndicator(el)).toBe('1 / 1');
    expect(toolbarButton(el, strings.designer.deletePage).disabled).toBe(true);
    // 페이지 이동 버튼은 사이드바의 페이지 영역에 표시한다.
    expect(toolbarButton(el, strings.designer.prevPage)).toBeUndefined();
    expect(toolbarButton(el, strings.designer.nextPage)).toBeUndefined();
    el.remove();
  });

  it('페이지를 추가하면 빈 새 페이지로 이동하고 slip-change를 발행한다', async () => {
    const el = await loadDesigner();
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    expect(pageIndicator(el)).toBe('2 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(0);
    expect(changes.length).toBe(1);
    expect(changes[0]!.detail.file.template.pages.length).toBe(2);
    expect(changes[0]!.detail.file.template.pages[1].elements).toEqual([]);
    el.remove();
  });

  it('사이드바 페이지 줄로 페이지를 전환하면 해당 페이지 요소가 보인다 (G-34)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const pageRows = () => el.shadowRoot!.querySelectorAll('.page-row');
    (pageRows()[0] as HTMLElement).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('1 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

    (pageRows()[1] as HTMLElement).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('2 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(0);
    el.remove();
  });

  it('현재 페이지를 삭제하면 남은 페이지로 이동한다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    toolbarButton(el, strings.designer.deletePage).click();
    await el.updateComplete;

    expect(pageIndicator(el)).toBe('1 / 1');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(changes[0]!.detail.file.template.pages.length).toBe(1);
    el.remove();
  });

  it('페이지 추가는 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('2 / 2');

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('1 / 1');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });
});

describe('<slip-designer> slipkit 공통 설정', () => {
  it('폰트가 설정된 slipkit이 있으면 미리보기가 같은 인스턴스의 render를 사용한다', async () => {
    const el = await loadDesigner();
    const render = vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    el.slipkit = {
      locale: undefined,
      getFonts: () => [{ name: 'HostFont', data: new Uint8Array([1]) }],
      render,
      evaluate: (source: string, context: Parameters<typeof evaluateFormula>[1]) =>
        evaluateFormula(source, context),
    } as unknown as SlipKit;
    await el.updateComplete;

    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 미리보기가 호스트의 직접 렌더링과 같은 인스턴스를 사용한다.
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// UI 언어
// ---------------------------------------------------------------------------

describe('<slip-designer> UI 언어', () => {
  it('locale="en"이면 툴바가 영어로 표시된다', async () => {
    const el = await createElement();
    el.locale = 'en';
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(toolbarButton(el, 'Text')).toBeTruthy();
    expect(toolbarButton(el, 'Undo')).toBeTruthy();
    el.remove();
  });

  it('locale을 바꾸면 화면 문구가 그 언어로 갱신된다', async () => {
    const el = await loadDesigner(); // 기본 영어
    expect(toolbarButton(el, strings.designer.addText)).toBeTruthy();

    el.locale = 'ko';
    await el.updateComplete;
    expect(toolbarButton(el, '텍스트')).toBeTruthy();
    el.remove();
  });
});
