// @vitest-environment happy-dom
// 그리드 셀 복수 선택과 일괄 스타일 편집
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용합니다.
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
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  loadDesigner,
  pickBorderShape,
  selectElement,
} from './helpers.js';

installDesignerTestEnv();

const s = strings.designer;
const PX = 96 / 25.4;

type CellRecord = Record<string, unknown> & { row: number; column: number };
type GridRecord = Record<string, unknown> & { cells: CellRecord[] };
type GridEdit = {
  cell: { row: number; column: number } | null;
  cells: readonly { row: number; column: number }[];
  editing: boolean;
};

/** 3×3 그리드 (원점 10,10 · 열 36/27/27 · 행 10) — 셀과 그리드 공통값은 시험마다 지정합니다 */
function makeGridFile(cells: CellRecord[], gridExtra: Record<string, unknown> = {}): SlipFile {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements = [{
    type: 'grid' as const,
    id: 'grid-1',
    name: 'grid',
    position: { x: 10, y: 10 },
    rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
    columns: [{ width: 36 }, { width: 27 }, { width: 27 }],
    cells,
    ...gridExtra,
  } as never];
  return file as unknown as SlipFile;
}

async function mount(cells: CellRecord[], gridExtra: Record<string, unknown> = {}, select = true) {
  parseSlipFileMock.mockReturnValue(makeGridFile(cells, gridExtra));
  const el = await loadDesigner();
  if (select) {
    selectElement(el, 'grid-1');
    await el.updateComplete;
  }
  return el;
}

function gridOf(el: Element): GridRecord {
  return (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as never as GridRecord;
}

function cellOf(el: Element, row: number, column: number): CellRecord | undefined {
  return gridOf(el).cells.find((c) => c.row === row && c.column === column);
}

function gridEdit(el: Element): GridEdit {
  return (el as unknown as { _gridEdit: GridEdit })._gridEdit;
}

function selectedId(el: Element): string | null {
  return (el as unknown as { _selectedId: string | null })._selectedId;
}

/** 셀 중심의 mm 좌표 */
const CENTER_X = [28, 59.5, 86.5] as const;
const centerY = (row: number): number => 15 + row * 10;

/** 그리드를 (mm 좌표로) 클릭합니다 — 보조키를 함께 누를 수 있습니다 */
async function clickCell(
  el: Element,
  row: number,
  column: number,
  keys: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  const div = el.shadowRoot!.querySelector('[data-id="grid-1"]') as HTMLElement;
  const init = {
    bubbles: true, composed: true, pointerId: 1,
    clientX: CENTER_X[column]! * PX, clientY: centerY(row) * PX, ...keys,
  };
  div.dispatchEvent(new PointerEvent('pointerdown', init));
  div.dispatchEvent(new PointerEvent('pointerup', init));
  await (el as { updateComplete?: Promise<unknown> }).updateComplete;
}

/** 보조키 없이 셀을 골라 기준 셀로 만들고, 열린 인라인 편집기는 닫습니다 */
async function pickAnchor(el: Element, row: number, column: number) {
  await clickCell(el, row, column);
  const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement | null;
  if (editor) {
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  }
}

function byAria(el: Element, label: string): HTMLButtonElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  if (!found) throw new Error(`버튼을 찾지 못했습니다: ${label}`);
  return found;
}

function panelInput(el: Element, ariaLabel: string): HTMLInputElement {
  const found = el.shadowRoot!.querySelector(`input[aria-label="${ariaLabel}"]`) as HTMLInputElement | null;
  if (!found) throw new Error(`입력을 찾지 못했습니다: ${ariaLabel}`);
  return found;
}

function setField(field: HTMLInputElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function sectionTitles(el: Element): string[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.prop-section-title'))
    .map((title) => title.textContent?.trim() ?? '');
}

function keys(cells: readonly { row: number; column: number }[]): string[] {
  return cells.map((c) => `${c.row},${c.column}`);
}

describe('<slip-designer> 그리드 셀 복수 선택', () => {
  it('그리드가 선택되지 않은 상태의 Shift·Ctrl 클릭은 그리드 요소만 선택하고 셀은 고르지 않는다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }], {}, false);
    await clickCell(el, 0, 0, { shiftKey: true });
    expect(selectedId(el)).toBe('grid-1');
    expect(gridEdit(el).cell).toBeNull();
    expect(gridEdit(el).cells).toHaveLength(0);

    await clickCell(el, 1, 1, { ctrlKey: true });
    // 이미 선택된 그리드 안의 Ctrl 클릭은 셀을 더하지만 인라인 편집은 열지 않는다.
    expect(keys(gridEdit(el).cells)).toEqual(['1,1']);
    expect(gridEdit(el).editing).toBe(false);
    expect(el.shadowRoot!.querySelector('.cell-editor')).toBeNull();
    el.remove();
  });

  it('Shift 클릭은 기준 셀부터 사각형 범위를 선택하고 병합 셀은 일부만 걸쳐도 전체가 든다', async () => {
    const el = await mount([
      { row: 0, column: 0, content: '라벨' },
      { row: 1, column: 1, content: '', colSpan: 2 },
    ]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 1, { shiftKey: true });
    const edit = gridEdit(el);
    expect(edit.cell).toEqual({ row: 0, column: 0 });
    expect(keys(edit.cells).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(edit.editing).toBe(false);

    // 캔버스 표시 — 선택 셀 4개, 기준 셀 하나만 진한 외곽선
    const preview = el.shadowRoot!.querySelector('.grid-preview')!;
    expect(preview.querySelectorAll('.cell-selected')).toHaveLength(4);
    const anchors = preview.querySelectorAll('.cell-anchor');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.textContent?.trim()).toBe('라벨');
    expect(el.shadowRoot!.querySelector('.type-name')?.textContent?.trim())
      .toBe(s.cellsSelected.replace('{count}', '4'));

    // 다른 셀을 Shift 클릭하면 범위가 기준 셀부터 다시 계산된다.
    await clickCell(el, 0, 2, { shiftKey: true });
    expect(keys(gridEdit(el).cells).sort()).toEqual(['0,0', '0,1', '0,2']);
    expect(gridEdit(el).cell).toEqual({ row: 0, column: 0 });
    el.remove();
  });

  it('Ctrl/Cmd 클릭은 떨어진 셀을 더하고 빼며, 기준 셀을 빼면 가장 최근에 더한 셀이 기준이 된다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 2, 2, { ctrlKey: true });
    await clickCell(el, 1, 0, { metaKey: true });
    expect(keys(gridEdit(el).cells)).toEqual(['0,0', '2,2', '1,0']);
    expect(gridEdit(el).cell).toEqual({ row: 1, column: 0 });

    // 기준 셀을 빼면 남은 셀 가운데 가장 최근에 더한 (2,2)가 기준이 된다.
    await clickCell(el, 1, 0, { ctrlKey: true });
    expect(keys(gridEdit(el).cells)).toEqual(['0,0', '2,2']);
    expect(gridEdit(el).cell).toEqual({ row: 2, column: 2 });

    // 기준이 아닌 셀을 빼면 기준 셀은 그대로다.
    await clickCell(el, 0, 0, { ctrlKey: true });
    expect(keys(gridEdit(el).cells)).toEqual(['2,2']);
    expect(gridEdit(el).cell).toEqual({ row: 2, column: 2 });

    // 마지막 셀을 빼면 셀 선택이 비고 그리드 설정으로 돌아간다.
    await clickCell(el, 2, 2, { ctrlKey: true });
    expect(gridEdit(el).cell).toBeNull();
    expect(gridEdit(el).cells).toHaveLength(0);
    expect(selectedId(el)).toBe('grid-1');
    expect(el.shadowRoot!.querySelector('.grid-back')).toBeNull();
    expect(sectionTitles(el)).toContain(s.panelStructure);
    el.remove();
  });

  it('Ctrl/Cmd+Shift 클릭은 사각형 범위를 기존 선택에 더하고 기준 셀을 유지한다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 2, 2, { ctrlKey: true });
    await clickCell(el, 2, 0, { ctrlKey: true, shiftKey: true });
    expect(keys(gridEdit(el).cells).sort()).toEqual(['0,0', '2,0', '2,1', '2,2']);
    expect(gridEdit(el).cell).toEqual({ row: 2, column: 2 });
    el.remove();
  });

  it('복수 선택 패널은 선택 개수와 텍스트·배경·셀 테두리 구역만 보여 준다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨', name: '이름' }]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 1, { shiftKey: true });
    const titles = sectionTitles(el);
    expect(titles).toEqual([s.styleText, s.styleBackground, s.styleCellBorder]);
    expect(el.shadowRoot!.querySelector('.grid-back-label')?.textContent?.trim()).toBe(s.gridBack);
    expect(el.shadowRoot!.querySelector(`input[aria-label="${s.cellName}"]`)).toBeNull();
    expect(el.shadowRoot!.querySelector(`[aria-label="${s.merge} ${s.rows}"]`)).toBeNull();
    // 강조 토글은 굵게·기울임·밑줄·취소선 순서다.
    const group = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group'))
      .find((g) => g.getAttribute('aria-label') === `${s.cell} ${s.style}`)!;
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')))
      .toEqual([`${s.cell} ${s.bold}`, `${s.cell} ${s.italic}`, `${s.cell} ${s.underline}`, `${s.cell} ${s.strikethrough}`]);
    el.remove();
  });

  it('셀 하나를 골라도 기울임 토글과 되돌리기 버튼이 같은 순서로 있다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }]);
    await pickAnchor(el, 0, 0);
    const group = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group'))
      .find((g) => g.getAttribute('aria-label') === `${s.cell} ${s.style}`)!;
    expect(group.querySelectorAll('button')).toHaveLength(4);
    byAria(el, `${s.cell} ${s.italic}`).click();
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.italic).toBe(true);
    byAria(el, `${s.cell} ${s.style}: ${s.resetToDefault}`).click();
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.italic).toBeUndefined();
    el.remove();
  });

  it('서로 다른 값은 혼합으로 표시되고, 값을 고르면 모든 선택 셀에 같은 값이 적용된다', async () => {
    const el = await mount([
      { row: 0, column: 0, content: '라벨', fontSize: 14, bold: true, backgroundColor: '#ffee00' },
      { row: 0, column: 1, content: '', fontSize: 9 },
    ], { fontSize: 9 });
    await pickAnchor(el, 0, 0);
    await clickCell(el, 0, 2, { shiftKey: true }); // (0,0)·(0,1)·(0,2) — (0,2)는 그리드 값 9를 물려받는다

    const size = panelInput(el, `${s.cell} ${s.fontSize}`);
    expect(size.value).toBe('');
    expect(size.getAttribute('placeholder')).toBe(s.mixed);
    const bold = byAria(el, `${s.cell} ${s.bold}: ${s.mixed}`);
    expect(bold.getAttribute('aria-pressed')).toBe('mixed');
    expect(bold.classList.contains('mixed-value')).toBe(true);
    const bg = byAria(el, `${s.cell} ${s.backgroundColor}`);
    expect(bg.querySelector('.color-chip')?.classList.contains('mixed')).toBe(true);
    expect(bg.querySelector('.color-value')?.textContent?.trim()).toBe(s.mixed);
    // (0,1)은 9를 직접 갖고 (0,2)는 9를 물려받지만 글자색은 모두 같아 혼합이 아니다.
    const color = byAria(el, `${s.cell} ${s.fontColor}`);
    expect(color.querySelector('.color-chip')?.classList.contains('mixed')).toBe(false);

    // 혼합 상태의 토글을 처음 누르면 모든 셀을 켠다.
    bold.click();
    await el.updateComplete;
    for (const column of [0, 1, 2]) expect(cellOf(el, 0, column)?.bold).toBe(true);
    expect(byAria(el, `${s.cell} ${s.bold}`).getAttribute('aria-pressed')).toBe('true');

    // 숫자를 넣으면 모든 셀에 같은 값이 저장되고 혼합 표시가 사라진다.
    setField(size, '12');
    await el.updateComplete;
    for (const column of [0, 1, 2]) expect(cellOf(el, 0, column)?.fontSize).toBe(12);
    expect(panelInput(el, `${s.cell} ${s.fontSize}`).value).toBe('12');

    // 그리드 값과 같은 9를 넣으면 셀 값을 지워 물려받는다.
    setField(panelInput(el, `${s.cell} ${s.fontSize}`), '9');
    await el.updateComplete;
    for (const column of [0, 1, 2]) expect(cellOf(el, 0, column)?.fontSize).toBeUndefined();
    el.remove();
  });

  it('그리드 공통값이 가운데 정렬·굵게일 때 셀에 왼쪽·끔을 일괄 적용하면 값을 명시해 저장한다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }], { alignment: 'center', bold: true });
    await pickAnchor(el, 0, 0);
    await clickCell(el, 0, 1, { shiftKey: true });
    // 물려받은 가운데·굵게가 눌린 상태로 보인다.
    expect(byAria(el, `${s.cell} ${s.alignment}: ${s.alignCenter}`).getAttribute('aria-pressed')).toBe('true');
    expect(byAria(el, `${s.cell} ${s.bold}`).getAttribute('aria-pressed')).toBe('true');

    byAria(el, `${s.cell} ${s.alignment}: ${s.alignLeft}`).click();
    await el.updateComplete;
    byAria(el, `${s.cell} ${s.bold}`).click();
    await el.updateComplete;
    for (const column of [0, 1]) {
      expect(cellOf(el, 0, column)?.alignment).toBe('left');
      expect(cellOf(el, 0, column)?.bold).toBe(false);
    }
    expect(byAria(el, `${s.cell} ${s.alignment}: ${s.alignLeft}`).getAttribute('aria-pressed')).toBe('true');
    expect(byAria(el, `${s.cell} ${s.bold}`).getAttribute('aria-pressed')).toBe('false');

    // 그리드 공통값과 같은 가운데를 고르면 셀 값을 지워 물려받는다.
    byAria(el, `${s.cell} ${s.alignment}: ${s.alignCenter}`).click();
    await el.updateComplete;
    for (const column of [0, 1]) expect(cellOf(el, 0, column)?.alignment).toBeUndefined();
    el.remove();
  });

  it('기본값으로 되돌리기는 선택 셀의 해당 속성만 지워 그리드 공통값을 물려받게 한다', async () => {
    const el = await mount([
      { row: 0, column: 0, content: '라벨', alignment: 'right', bold: true, underline: true, fontSize: 14 },
      { row: 0, column: 1, content: '', italic: true, verticalAlignment: 'bottom' },
      { row: 2, column: 2, content: '', bold: true },
    ]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 0, 1, { ctrlKey: true });
    byAria(el, `${s.cell} ${s.alignment}: ${s.resetToDefault}`).click();
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.alignment).toBeUndefined();
    expect(cellOf(el, 0, 1)?.verticalAlignment).toBe('bottom');
    byAria(el, `${s.cell} ${s.style}: ${s.resetToDefault}`).click();
    await el.updateComplete;
    for (const column of [0, 1]) {
      const cell = cellOf(el, 0, column)!;
      expect(cell.bold).toBeUndefined();
      expect(cell.italic).toBeUndefined();
      expect(cell.underline).toBeUndefined();
    }
    // 선택하지 않은 셀과 다른 속성은 그대로다.
    expect(cellOf(el, 0, 0)?.fontSize).toBe(14);
    expect(cellOf(el, 0, 0)?.content).toBe('라벨');
    expect(cellOf(el, 2, 2)?.bold).toBe(true);
    el.remove();
  });

  it('일괄 변경은 실행 취소 한 번으로 모든 셀이 되돌아간다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 0, 2, { shiftKey: true });
    setField(panelInput(el, `${s.cell} ${s.fontSize}`), '14');
    await el.updateComplete;
    for (const column of [0, 1, 2]) expect(cellOf(el, 0, column)?.fontSize).toBe(14);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.fontSize).toBeUndefined();
    expect(cellOf(el, 0, 1)).toBeUndefined();
    expect(cellOf(el, 0, 2)).toBeUndefined();
    // 선택은 유지되어 다시 실행할 수 있다.
    expect(keys(gridEdit(el).cells).sort()).toEqual(['0,0', '0,1', '0,2']);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await el.updateComplete;
    for (const column of [0, 1, 2]) expect(cellOf(el, 0, column)?.fontSize).toBe(14);
    el.remove();
  });

  it('셀의 내용·이름·수식·병합·조건부 서식은 일괄 편집에서 바뀌지 않는다', async () => {
    const rule = { condition: '1 = 1', bold: true };
    const el = await mount([
      { row: 0, column: 0, content: '라벨', name: '제목', colSpan: 2 },
      { row: 1, column: 1, formula: '1 + 1', conditionalFormats: [rule] },
    ]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 1, { ctrlKey: true });
    byAria(el, `${s.cell} ${s.backgroundColor}`).click();
    await el.updateComplete;
    byAria(el, `${s.cell} ${s.backgroundColor} #d93025`).click();
    await el.updateComplete;

    const first = cellOf(el, 0, 0)!;
    const second = cellOf(el, 1, 1)!;
    expect(first.backgroundColor).toBe('#d93025');
    expect(second.backgroundColor).toBe('#d93025');
    expect(first.content).toBe('라벨');
    expect(first.name).toBe('제목');
    expect(first.colSpan).toBe(2);
    expect(second.formula).toBe('1 + 1');
    expect(second.content).toBeUndefined();
    expect(second.conditionalFormats).toEqual([rule]);
    expect(gridOf(el).cells).toHaveLength(2);
    el.remove();
  });

  it('반복 구간 안과 밖의 셀을 함께 선택해도 스타일만 바뀐다', async () => {
    parseSlipFileMock.mockReturnValue((() => {
      const file = makeGridFile([
        { row: 0, column: 0, content: '헤더' },
        { row: 1, column: 0, parameter: 'n' },
      ], {
        repeat: {
          parameter: 'items',
          bands: [{ id: 'b', fromRow: 1, toRow: 1, placement: 'item' }],
          pagination: { mode: 'fixed', itemsPerPage: 3 },
        },
      });
      (file as unknown as SlipTemplateFile).template.parameters = [
        { key: 'items', valueType: 'list', fields: [{ key: 'n', valueType: 'text' }] },
      ] as never;
      return file;
    })());
    const el = await loadDesigner();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 0, { ctrlKey: true });
    expect(keys(gridEdit(el).cells)).toEqual(['0,0', '1,0']);
    byAria(el, `${s.cell} ${s.underline}`).click();
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.underline).toBe(true);
    expect(cellOf(el, 1, 0)?.underline).toBe(true);
    expect(cellOf(el, 1, 0)?.parameter).toBe('n');
    expect(cellOf(el, 0, 0)?.content).toBe('헤더');
    el.remove();
  });

  it('Esc는 셀 선택을 모두 풀고 그리드 요소 선택은 유지한다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }]);
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 1, { shiftKey: true });
    expect(gridEdit(el).cells.length).toBeGreaterThan(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(gridEdit(el).cell).toBeNull();
    expect(gridEdit(el).cells).toHaveLength(0);
    expect(selectedId(el)).toBe('grid-1');
    expect(el.shadowRoot!.querySelector('.grid-back')).toBeNull();
    el.remove();
  });

  it('다른 요소를 선택하면 셀 복수 선택이 풀린다', async () => {
    parseSlipFileMock.mockReturnValue((() => {
      const file = makeGridFile([{ row: 0, column: 0, content: '라벨' }]);
      (file as unknown as SlipTemplateFile).template.pages[0]!.elements.push({
        type: 'text', id: 'text-1', name: 't', position: { x: 10, y: 60 }, width: 40, height: 10, content: '글',
      } as never);
      return file;
    })());
    const el = await loadDesigner();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 1, { shiftKey: true });
    selectElement(el, 'text-1');
    await el.updateComplete;
    expect(selectedId(el)).toBe('text-1');
    expect(gridEdit(el).cells).toHaveLength(0);
    el.remove();
  });

  it('그리드 공통 셀 테두리가 점선일 때 실선을 고르면 셀마다 solid를 저장하고 캔버스도 실선이 된다', async () => {
    const el = await mount([{ row: 0, column: 0, content: '라벨' }], {
      cellBorderStyle: 'dotted', cellBorderWidth: 0.5, cellBorderColor: '#336699',
    });
    await pickAnchor(el, 0, 0);
    await clickCell(el, 1, 1, { shiftKey: true });
    // 물려받는 점선이 흐리게 표시된다.
    const shapeValue = () => Array.from(el.shadowRoot!.querySelectorAll('.width-btn'))
      .find((b) => b.getAttribute('aria-label') === `${s.cell} ${s.borderShape}`)!
      .querySelector('.width-value')!;
    expect(shapeValue().textContent?.trim()).toBe(s.borderDotted);
    expect(shapeValue().classList.contains('dim')).toBe(true);
    await pickBorderShape(el, `${s.cell} ${s.borderShape}`, s.borderSolid);
    expect(shapeValue().textContent?.trim()).toBe(s.borderSolid);
    expect(shapeValue().classList.contains('dim')).toBe(false);
    const targets = [[0, 0], [0, 1], [1, 0], [1, 1]] as const;
    for (const [row, column] of targets) expect(cellOf(el, row, column)?.borderStyle).toBe('solid');
    const cells = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview .cell-selected')) as HTMLElement[];
    expect(cells).toHaveLength(4);
    for (const cell of cells) expect(cell.style.border).toContain('solid');

    // 그리드 공통값과 같은 점선을 고르면 셀 값을 지워 물려받는다.
    await pickBorderShape(el, `${s.cell} ${s.borderShape}`, s.borderDotted);
    for (const [row, column] of targets) expect(cellOf(el, row, column)?.borderStyle).toBeUndefined();
    el.remove();
  });

  it('셀 테두리 되돌리기는 색·굵기·형태를 함께 지우고, 적용과 되돌리기는 각각 실행 취소 한 단위다', async () => {
    const el = await mount([
      { row: 0, column: 0, content: '라벨', borderColor: '#ff0000', borderWidth: 1, borderStyle: 'dashed' },
      { row: 0, column: 1, content: '', borderWidth: 0 },
    ], { cellBorderStyle: 'dotted' });
    await pickAnchor(el, 0, 0);
    await clickCell(el, 0, 1, { ctrlKey: true });
    await pickBorderShape(el, `${s.cell} ${s.borderShape}`, s.borderSolid);
    expect(cellOf(el, 0, 0)?.borderStyle).toBe('solid');
    expect(cellOf(el, 0, 1)?.borderStyle).toBe('solid');

    const reset = byAria(el, `${s.styleCellBorder}: ${s.resetToDefault}`);
    expect(reset.getAttribute('title')).toBe(s.resetToDefault);
    reset.click();
    await el.updateComplete;
    for (const column of [0, 1]) {
      const cell = cellOf(el, 0, column)!;
      expect(cell.borderColor).toBeUndefined();
      expect(cell.borderWidth).toBeUndefined();
      expect(cell.borderStyle).toBeUndefined();
    }
    expect(cellOf(el, 0, 0)?.content).toBe('라벨');

    // 실행 취소 한 번 — 되돌리기 전(실선)으로, 두 번 — 적용 전(파선·없음)으로 돌아간다.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.borderStyle).toBe('solid');
    expect(cellOf(el, 0, 0)?.borderColor).toBe('#ff0000');
    expect(cellOf(el, 0, 1)?.borderStyle).toBe('solid');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(cellOf(el, 0, 0)?.borderStyle).toBe('dashed');
    expect(cellOf(el, 0, 1)?.borderStyle).toBeUndefined();
    expect(cellOf(el, 0, 1)?.borderWidth).toBe(0);
    el.remove();
  });

  it('폰트가 혼합이면 단일 폰트용 안내를 감추고, 공통 폰트를 고른 뒤에만 그 안내를 보여 준다', async () => {
    const el = await mount([
      { row: 0, column: 0, content: '라벨', fontName: 'NoSuchFont' },
      { row: 0, column: 1, content: '' },
    ]);
    await pickAnchor(el, 0, 0);
    // 셀 하나(미등록 폰트)에서는 안내가 보인다.
    expect(el.shadowRoot!.querySelector('.font-note')).not.toBeNull();
    await clickCell(el, 0, 1, { ctrlKey: true });
    const fontSelect = el.shadowRoot!.querySelector(`[aria-label="${s.cell} ${s.fontName}"]`)!;
    expect(fontSelect.querySelector('.list-select-value')?.textContent?.trim()).toBe(s.mixed);
    expect(el.shadowRoot!.querySelector('.font-note')).toBeNull();

    // 같은 선택에 미등록 폰트를 공통으로 적용하면 그 폰트의 안내가 나타난다.
    (el as unknown as { _gridCommands: { updateCellStyle(key: string, value: unknown): void } })
      ._gridCommands.updateCellStyle('fontName', 'NoSuchFont');
    await el.updateComplete;
    expect(cellOf(el, 0, 1)?.fontName).toBe('NoSuchFont');
    expect(fontSelect.querySelector('.list-select-value')?.textContent?.trim()).toBe('NoSuchFont');
    expect(el.shadowRoot!.querySelector('.font-note')?.textContent).toContain(s.fontUnregistered);
    el.remove();
  });
});
