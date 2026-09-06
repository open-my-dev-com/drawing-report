// @vitest-environment happy-dom
// 반복 그리드 출력 결과 전환 — 속성 패널 머리줄, 출력 페이지 이동과 편집 조작의 자동 복귀
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 페이지 계획·수식 엔진은 실제 구현을 사용합니다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  installDesignerTestEnv,
  loadDesigner,
  selectElement,
  clickCanvasAt,
  toolbarButton,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

const s = strings.designer;

/** 테스트가 들여다보는 디자이너 내부 상태 */
type Internals = {
  _gridPlanPreview: boolean;
  _outputPage: number;
  _selectedId: string | null;
  _file: SlipTemplateFile;
  _undoStack: unknown[];
  _selectPage(index: number): void;
};

function internals(el: Designer): Internals {
  return el as unknown as Internals;
}

function elementsOf(el: Designer) {
  return internals(el)._file.template.pages[0]!.elements;
}

/**
 * 출력 페이지가 3장 나오는 반복 그리드(고정 페이지, 항목 5개 ÷ 2), 반복 없는 그리드와 텍스트를 둔 양식.
 *
 * @param itemCount - 샘플 항목 수. 2 이하면 출력 페이지가 한 장이 됩니다
 */
function makeFile(itemCount = 5): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '출력 결과' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
      pages: [{
        elements: [
          {
            type: 'grid' as const,
            id: 'g-1',
            name: 'repeat-grid',
            position: { x: 10, y: 10 },
            columns: [{ width: 30 }, { width: 30 }],
            rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
            repeat: {
              parameter: 'items',
              bands: [
                { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
                { id: 'b-tail', fromRow: 2, toRow: 2, placement: 'after-data' },
              ],
              pagination: { mode: 'fixed', itemsPerPage: 2 },
            },
            cells: [
              { row: 0, column: 0, content: '품명' },
              { row: 1, column: 0, parameter: '품명' },
            ],
          },
          {
            type: 'grid' as const,
            id: 'plain-1',
            name: 'plain-grid',
            position: { x: 10, y: 150 },
            columns: [{ width: 30 }, { width: 30 }],
            rows: [{ height: 10 }, { height: 10 }],
            cells: [{ row: 0, column: 0, content: '라벨' }],
          },
          {
            type: 'text' as const,
            id: 'txt-1',
            name: 'test-text',
            position: { x: 30, y: 250 },
            width: 60,
            height: 10,
            content: '텍스트',
          },
        ],
      }],
      assets: [],
      sampleValues: {
        items: Array.from({ length: itemCount }, (_, index) => ({ 품명: `항목 ${index + 1}` })),
      },
    },
  } as unknown as SlipTemplateFile;
}

async function mount(itemCount = 5): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(makeFile(itemCount) as unknown as SlipFile);
  return loadDesigner();
}

function panelToggle(el: Designer): HTMLButtonElement | null {
  return el.shadowRoot!.querySelector('.prop-panel .output-preview-toggle');
}

function panelNav(el: Designer): HTMLElement | null {
  return el.shadowRoot!.querySelector('.prop-panel .output-page-nav');
}

function navStatus(el: Designer): string {
  return panelNav(el)?.querySelector('.output-page-status')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** 반복 그리드를 선택하고 출력 결과 보기를 켭니다 */
async function enterOutputResult(el: Designer): Promise<void> {
  selectElement(el, 'g-1');
  await el.updateComplete;
  panelToggle(el)!.click();
  await el.updateComplete;
  expect(internals(el)._gridPlanPreview).toBe(true);
  expect(panelToggle(el)!.getAttribute('aria-pressed')).toBe('true');
}

/** 캔버스 기둥의 구조와 스크롤 위치 — 선택·출력 결과 전환으로 달라지면 안 되는 것 */
function canvasSnapshot(el: Designer) {
  const area = el.shadowRoot!.querySelector('.canvas-area') as HTMLElement;
  const stack = area.querySelector('.canvas-stack') as HTMLElement;
  const wrap = stack.querySelector('.paper-wrap') as HTMLElement;
  return {
    areaChildren: Array.from(area.children).map((child) => child.className),
    stackChildren: Array.from(stack.children).map((child) => child.className),
    wrapChildren: Array.from(wrap.children).map((child) => child.className),
    firstInStack: stack.firstElementChild?.className,
    areaHeight: area.getBoundingClientRect().height,
    stackHeight: stack.getBoundingClientRect().height,
    rulerTop: wrap.querySelector('.ruler-h')!.getBoundingClientRect().top,
    paperTop: wrap.querySelector('.paper')!.getBoundingClientRect().top,
    scrollTop: area.scrollTop,
    scrollLeft: area.scrollLeft,
  };
}

function keydown(el: Designer, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('<slip-designer> 출력 결과 전환 위치', () => {
  it('캔버스에는 출력 페이지 막대가 없고 선택·전환에도 캔버스 구조와 스크롤이 그대로다', async () => {
    const el = await mount();
    const area = el.shadowRoot!.querySelector('.canvas-area') as HTMLElement;
    area.scrollTop = 120;
    area.scrollLeft = 40;
    const before = canvasSnapshot(el);
    expect(before.firstInStack).toBe('paper-wrap');
    expect(before.wrapChildren[0]).toBe('ruler-corner');

    selectElement(el, 'g-1');
    await el.updateComplete;
    expect(canvasSnapshot(el)).toEqual(before);

    panelToggle(el)!.click();
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(true);
    expect(canvasSnapshot(el)).toEqual(before);
    expect(el.shadowRoot!.querySelector('.output-page-bar')).toBeNull();
    expect(el.shadowRoot!.querySelector('.canvas-area .output-preview-toggle')).toBeNull();
    expect(el.shadowRoot!.querySelector('.canvas-area .output-page-nav')).toBeNull();

    panelToggle(el)!.click();
    await el.updateComplete;
    expect(canvasSnapshot(el)).toEqual(before);

    clickCanvasAt(el, 5, 5);
    await el.updateComplete;
    expect(internals(el)._selectedId).toBeNull();
    expect(canvasSnapshot(el)).toEqual(before);
    el.remove();
  });

  it('속성 패널 머리줄의 전환 버튼은 반복 그리드에만 있고 상태를 aria-pressed로 알린다', async () => {
    const el = await mount();
    selectElement(el, 'g-1');
    await el.updateComplete;
    const toggle = panelToggle(el)!;
    expect(toggle.closest('.type-name')).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toContain(s.outputResult);
    expect(panelNav(el)!.closest('.type-name')).not.toBeNull();
    expect(navStatus(el)).toBe(`${s.outputPage} 1 / 3`);

    toggle.click();
    await el.updateComplete;
    expect(panelToggle(el)!.getAttribute('aria-pressed')).toBe('true');
    expect(panelToggle(el)!.textContent).toContain(s.gridStructureEdit);

    selectElement(el, 'plain-1');
    await el.updateComplete;
    expect(panelToggle(el)).toBeNull();
    expect(el.shadowRoot!.querySelector('.prop-panel .type-name')?.textContent?.trim()).toBe(s.typeGrid);

    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(panelToggle(el)).toBeNull();
    el.remove();
  });

  it('출력 페이지가 한 장이면 머리줄에 페이지 이동을 두지 않는다', async () => {
    const el = await mount(2);
    selectElement(el, 'g-1');
    await el.updateComplete;
    expect(panelToggle(el)).not.toBeNull();
    expect(panelNav(el)).toBeNull();
    el.remove();
  });

  it('출력 페이지 이전·다음은 범위를 지키고 출력 결과 상태를 유지한다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const next = () => panelNav(el)!.querySelector('.output-page-next') as HTMLButtonElement;
    const prev = () => panelNav(el)!.querySelector('.output-page-prev') as HTMLButtonElement;
    expect(prev().disabled).toBe(true);

    next().click();
    await el.updateComplete;
    expect(internals(el)._outputPage).toBe(1);
    expect(internals(el)._gridPlanPreview).toBe(true);
    expect(navStatus(el)).toBe(`${s.outputPage} 2 / 3`);

    next().click();
    await el.updateComplete;
    next().click();
    await el.updateComplete;
    expect(internals(el)._outputPage).toBe(2);
    expect(next().disabled).toBe(true);
    expect(internals(el)._gridPlanPreview).toBe(true);

    prev().click();
    await el.updateComplete;
    expect(internals(el)._outputPage).toBe(1);
    expect(internals(el)._gridPlanPreview).toBe(true);
    expect(internals(el)._selectedId).toBe('g-1');
    el.remove();
  });

  it('반복 그리드를 선택하지 않아도 양식·페이지 설정에서 출력 페이지를 옮길 수 있다', async () => {
    const el = await mount();
    expect(internals(el)._selectedId).toBeNull();
    expect(el.shadowRoot!.querySelector('.prop-panel .type-name')?.textContent?.trim()).toBe(s.formSettings);
    expect(navStatus(el)).toBe(`${s.outputPage} 1 / 3`);
    (panelNav(el)!.querySelector('.output-page-next') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(internals(el)._outputPage).toBe(1);
    expect(navStatus(el)).toBe(`${s.outputPage} 2 / 3`);

    internals(el)._selectPage(0);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.prop-panel .type-name')?.textContent?.trim()).toBe(s.pageSettings);
    expect(navStatus(el)).toBe(`${s.outputPage} 2 / 3`);
    el.remove();
  });

  it('출력 페이지가 한 장이면 양식 설정에 출력 페이지 줄을 두지 않는다', async () => {
    const el = await mount(2);
    expect(panelNav(el)).toBeNull();
    el.remove();
  });
});

describe('<slip-designer> 출력 결과 상태의 자동 복귀', () => {
  it('캔버스에서 다른 요소를 누르면 행 구조 편집으로 돌아가며 그 요소가 선택된다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(internals(el)._selectedId).toBe('txt-1');
    el.remove();
  });

  it('생성 도구를 고르면 돌아가고 캔버스 클릭으로 요소가 한 번 만들어진다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const count = elementsOf(el).length;
    toolbarButton(el, s.addText).click();
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    await clickCanvasAt(el, 200, 200);
    expect(elementsOf(el)).toHaveLength(count + 1);
    expect(elementsOf(el).at(-1)?.type).toBe('text');
    el.remove();
  });

  it('사이드바에서 요소를 고르면 돌아가며 그 요소가 선택된다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    (el.shadowRoot!.querySelector('.side-row[title="test-text"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(internals(el)._selectedId).toBe('txt-1');
    el.remove();
  });

  it('속성을 바꾸면 돌아가고 변경이 한 번만 적용된다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const undoDepth = internals(el)._undoStack.length;
    const input = el.shadowRoot!.querySelector(`.prop-panel input[aria-label="${s.name}"]`) as HTMLInputElement;
    input.value = 'renamed';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(elementsOf(el)[0]!.name).toBe('renamed');
    expect(internals(el)._undoStack).toHaveLength(undoDepth + 1);
    el.remove();
  });

  it('Ctrl+Z는 돌아간 뒤 한 단계만 되돌린다', async () => {
    const el = await mount();
    selectElement(el, 'g-1');
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector(`.prop-panel input[aria-label="${s.name}"]`) as HTMLInputElement;
    input.value = 'first';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    input.value = 'second';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(elementsOf(el)[0]!.name).toBe('second');

    panelToggle(el)!.click();
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(true);
    keydown(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(elementsOf(el)[0]!.name).toBe('first');
    el.remove();
  });

  it('Delete는 돌아간 뒤 선택한 그리드를 지운다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const count = elementsOf(el).length;
    keydown(el, 'Delete');
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(elementsOf(el)).toHaveLength(count - 1);
    expect(elementsOf(el).some((element) => element.id === 'g-1')).toBe(false);
    expect(internals(el)._selectedId).toBeNull();
    el.remove();
  });

  it('Ctrl+C·Ctrl+V는 돌아간 뒤 복사·붙여넣기를 한 번 수행한다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const count = elementsOf(el).length;
    keydown(el, 'c', { ctrlKey: true });
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);

    panelToggle(el)!.click();
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(true);
    keydown(el, 'v', { ctrlKey: true });
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(elementsOf(el)).toHaveLength(count + 1);
    el.remove();
  });

  it('그리드 구조 명령은 돌아간 뒤 한 번 적용된다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const grid = elementsOf(el)[0] as { columns: unknown[] };
    expect(grid.columns).toHaveLength(2);
    (el.shadowRoot!.querySelector(`.prop-panel button[aria-label="${s.columns} +"]`) as HTMLButtonElement).click();
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect((elementsOf(el)[0] as { columns: unknown[] }).columns).toHaveLength(3);
    el.remove();
  });

  it('Esc는 상태만 돌리고 다른 것은 바꾸지 않는다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    const count = elementsOf(el).length;
    keydown(el, 'Escape');
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(false);
    expect(internals(el)._selectedId).toBe('g-1');
    expect(elementsOf(el)).toHaveLength(count);
    expect(panelToggle(el)!.getAttribute('aria-pressed')).toBe('false');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).not.toBeNull();
    el.remove();
  });

  it('편집이 아닌 키는 출력 결과 상태를 바꾸지 않는다', async () => {
    const el = await mount();
    await enterOutputResult(el);
    keydown(el, 'Shift');
    keydown(el, 'b', { ctrlKey: true });
    await el.updateComplete;
    expect(internals(el)._gridPlanPreview).toBe(true);
    el.remove();
  });
});
