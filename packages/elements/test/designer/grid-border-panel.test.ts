// @vitest-environment happy-dom
// 셀 기본 테두리·그리드 테두리의 속성 패널과 캔버스 표시
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

vi.mock('../../src/default-fonts.js', () => ({
  loadDefaultFonts: () =>
    Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import type { GridElement, SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  createElement,
  flush,
  selectElement,
  type Designer,
} from './helpers.js';

const s = strings.designer;

function gridElement(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
    columns: [{ width: 30 }, { width: 30 }],
    rows: [{ height: 10 }],
    cells: [{ row: 0, column: 0, content: '품명' }],
    ...extra,
  };
}

async function mount(extra: Record<string, unknown> = {}): Promise<Designer> {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements = [gridElement(extra)] as never;
  parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
  const el = await createElement();
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  selectElement(el, 'g1');
  await el.updateComplete;
  return el;
}

function gridOf(el: Designer): GridElement {
  return (el as unknown as { _file: SlipTemplateFile })._file
    .template.pages[0]!.elements[0] as GridElement;
}

function titles(el: Designer): string[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.prop-section-title'))
    .map((t) => t.textContent?.trim() ?? '');
}

function widthButton(el: Designer, ariaLabel: string): HTMLButtonElement {
  const button = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'))
    .find((b) => b.getAttribute('aria-label') === ariaLabel) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`굵기 버튼을 찾지 못했습니다: ${ariaLabel}`);
  return button;
}

async function pickWidth(el: Designer, ariaLabel: string, optionSuffix: string): Promise<void> {
  widthButton(el, ariaLabel).click();
  await el.updateComplete;
  const option = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
    .find((b) => b.getAttribute('aria-label') === `${ariaLabel}: ${optionSuffix}`) as HTMLButtonElement | undefined;
  if (!option) throw new Error(`굵기 항목을 찾지 못했습니다: ${optionSuffix}`);
  option.click();
  await el.updateComplete;
}

function gridEdit(el: Designer) {
  return (el as unknown as {
    _gridEdit: { selectCell(c: { row: number; column: number }): void };
  })._gridEdit;
}

describe('<slip-designer> 그리드 테두리 속성 패널', () => {
  it('그리드를 고르면 셀 기본 테두리와 그리드 테두리 구역이 따로 보인다', async () => {
    const el = await mount();
    const found = titles(el);
    expect(found).toContain(s.styleCellDefaultBorder);
    expect(found).toContain(s.styleOutline);
    expect(found).not.toContain(s.styleBorder);
    el.remove();
  });

  it('새 그리드는 셀 기본 테두리 0.2mm, 그리드 테두리 없음으로 표시되고 파일에 값을 적지 않는다', async () => {
    const el = await mount();
    const cellLabel = `${s.styleCellDefaultBorder} ${s.borderWidth}`;
    const outlineLabel = `${s.styleOutline} ${s.borderWidth}`;
    expect(widthButton(el, cellLabel).textContent).toContain('0.2mm');
    expect(widthButton(el, outlineLabel).textContent).toContain(s.colorNone);
    const grid = gridOf(el) as unknown as Record<string, unknown>;
    for (const key of ['cellBorderWidth', 'cellBorderColor', 'cellBorderStyle', 'outlineWidth', 'outlineColor', 'outlineStyle']) {
      expect(grid).not.toHaveProperty(key);
    }
    el.remove();
  });

  it('그리드 테두리 굵기를 고르면 outlineWidth에 저장되고 셀 기본 테두리는 그대로다', async () => {
    const el = await mount();
    await pickWidth(el, `${s.styleOutline} ${s.borderWidth}`, '0.5mm');
    const grid = gridOf(el);
    expect(grid.outlineWidth).toBe(0.5);
    expect(grid).not.toHaveProperty('cellBorderWidth');
    expect(grid).not.toHaveProperty('borderWidth');
    el.remove();
  });

  it('셀 기본 테두리를 없음으로 해도 그리드 테두리는 남는다', async () => {
    const el = await mount({ outlineWidth: 0.4 });
    await pickWidth(el, `${s.styleCellDefaultBorder} ${s.borderWidth}`, s.colorNone);
    const grid = gridOf(el);
    expect(grid.cellBorderWidth).toBe(0);
    expect(grid.outlineWidth).toBe(0.4);
    el.remove();
  });

  it('이전 파일의 grid.border*는 셀 기본 테두리의 적용값으로 보이고, 한 항목을 바꾸면 세 값을 모두 옮긴다', async () => {
    const el = await mount({ borderColor: '#CC0000', borderWidth: 0.4, borderStyle: 'dashed' });
    const cellLabel = `${s.styleCellDefaultBorder} ${s.borderWidth}`;
    expect(widthButton(el, cellLabel).textContent).toContain('0.4mm');
    // 그리드 테두리 구역에는 이전 셀 기본값이 나타나지 않는다.
    expect(widthButton(el, `${s.styleOutline} ${s.borderWidth}`).textContent).toContain(s.colorNone);

    await pickWidth(el, cellLabel, '0.8mm');
    const grid = gridOf(el);
    expect(grid.cellBorderColor).toBe('#CC0000');
    expect(grid.cellBorderWidth).toBe(0.8);
    expect(grid.cellBorderStyle).toBe('dashed');
    expect(grid).not.toHaveProperty('borderColor');
    expect(grid).not.toHaveProperty('borderWidth');
    expect(grid).not.toHaveProperty('borderStyle');
    el.remove();
  });

  it('이전 파일을 건드리지 않으면 저장값이 그대로다', async () => {
    const el = await mount({ borderColor: '#CC0000', borderWidth: 0.4 });
    await pickWidth(el, `${s.styleOutline} ${s.borderWidth}`, '0.3mm');
    const grid = gridOf(el);
    expect(grid.borderColor).toBe('#CC0000');
    expect(grid.borderWidth).toBe(0.4);
    expect(grid).not.toHaveProperty('cellBorderWidth');
    el.remove();
  });

  it('셀을 고르면 구역 이름이 셀 테두리이고 기본값은 셀 기본 테두리를 따른다', async () => {
    const el = await mount({ cellBorderWidth: 0.5 });
    gridEdit(el).selectCell({ row: 0, column: 0 });
    await el.updateComplete;
    expect(titles(el)).toContain(s.styleCellBorder);
    expect(titles(el)).not.toContain(s.styleCellDefaultBorder);
    expect(widthButton(el, s.borderWidth).textContent).toContain('0.5mm');
    el.remove();
  });
});

describe('<slip-designer> 그리드 테두리 캔버스 표시', () => {
  function gridBox(el: Designer): HTMLElement {
    return el.shadowRoot!.querySelector('.element.type-grid') as HTMLElement;
  }

  it('요소 상자는 저장된 테두리를 그리지 않고, 그리드 테두리가 없으면 레이어도 없다', async () => {
    const el = await mount({ borderWidth: 0.6, borderColor: '#CC0000' });
    const box = gridBox(el);
    expect(box.getAttribute('style')).not.toContain('#CC0000');
    expect(box.getAttribute('style')).toContain('var(--sk-guide-faint)');
    expect(box.querySelector('.grid-outline')).toBeNull();
    // 이전 border*는 셀 경계선에는 그대로 적용된다.
    const cell = box.querySelector('.grid-cell') as HTMLElement;
    expect(cell.getAttribute('style')).toContain('#CC0000');
    el.remove();
  });

  it('그리드 테두리가 있으면 경계 중심에 놓인 전용 레이어를 그린다', async () => {
    const el = await mount({ outlineWidth: 0.6, outlineColor: '#123456', outlineStyle: 'dashed' });
    const layer = gridBox(el).querySelector('.grid-outline') as HTMLElement;
    expect(layer).not.toBeNull();
    const style = layer.getAttribute('style') ?? '';
    // 0.6mm ≈ 2px → 반인 1px만큼 바깥으로 나간다.
    expect(style).toContain('inset:-1px');
    expect(style).toContain('2px dashed #123456');
    el.remove();
  });

  it('셀 기본 테두리 없음과 그리드 테두리는 서로 독립이다', async () => {
    const el = await mount({ cellBorderWidth: 0, outlineWidth: 0.4 });
    const box = gridBox(el);
    expect((box.querySelector('.grid-cell') as HTMLElement).getAttribute('style')).toContain('border:none');
    expect(box.querySelector('.grid-outline')).not.toBeNull();
    el.remove();
  });

  it('cellBorder*가 이전 border*보다 우선해 셀 경계선에 적용된다', async () => {
    const el = await mount({ borderColor: '#CC0000', cellBorderColor: '#00AA00' });
    const cell = gridBox(el).querySelector('.grid-cell') as HTMLElement;
    expect(cell.getAttribute('style')).toContain('#00AA00');
    expect(cell.getAttribute('style')).not.toContain('#CC0000');
    el.remove();
  });
});
