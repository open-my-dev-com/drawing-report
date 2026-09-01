// @vitest-environment happy-dom
// 그리드 편집
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
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import { validateSlipFile } from '@omdc-slipkit/core';
import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  loadDesigner,
  pickListValue,
  addByCanvasClick,
  pickBorderShape,
  selectElement,
} from './helpers.js';

installDesignerTestEnv();

// ---------------------------------------------------------------------------
// 표 내부 편집: 그리드 행·열·칸·병합
// ---------------------------------------------------------------------------

describe('<slip-designer> 표 내부 편집', () => {
  const PX = 96 / 25.4;

  function makeGridFile(): SlipFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const,
      id: 'grid-1',
      name: 'grid',
      position: { x: 10, y: 10 },
      width: 90,
      height: 30,
      rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
      columns: [{ width: 36 }, { width: 27 }, { width: 27 }],
      cells: [{ row: 0, column: 0, content: '라벨' }],
    } as never];
    return file as unknown as SlipFile;
  }

  async function mountGrid() {
    parseSlipFileMock.mockReturnValue(makeGridFile());
    const el = await loadDesigner();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    return el;
  }

  function gridOf(el: Element) {
    return (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as never as {
      width: number; height: number;
      rows: { height: number }[]; columns: { width: number }[];
      cells: { row: number; column: number; content?: string; rowSpan?: number; colSpan?: number }[];
    };
  }

  /** 행·열 수 조절 버튼 (-, +) */
  function stepButton(el: Element, label: string, sign: '-' | '+'): HTMLButtonElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 줄을 찾지 못했습니다: ${label}`);
    return row.querySelectorAll('button')[sign === '-' ? 0 : 1] as HTMLButtonElement;
  }

  function panelField(el: Element, label: string): HTMLInputElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 입력을 찾지 못했습니다: ${label}`);
    return row.querySelector('input') as HTMLInputElement;
  }

  function setField(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** 선택된 그리드를 (mm 좌표로) 한 번 더 클릭합니다 — 셀 선택·인라인 편집 진입 */
  async function clickCell(el: Element, mmX: number, mmY: number) {
    const div = el.shadowRoot!.querySelector('[data-id="grid-1"]') as HTMLElement;
    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: mmX * PX, clientY: mmY * PX, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, composed: true, clientX: mmX * PX, clientY: mmY * PX, pointerId: 1,
    }));
    await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  }

  it('열을 추가하면 기존 열 너비를 유지하고 그리드 너비만 증가한다 (mm 트랙, ADR-037)', async () => {
    const el = await mountGrid();
    stepButton(el, strings.designer.columns, '+').click();
    await el.updateComplete;

    const grid = gridOf(el);
    expect(grid.columns.length).toBe(4);
    // 새 열은 마지막 열 너비를 복사하고 기존 열은 그대로입니다.
    expect(grid.columns.map((c) => c.width)).toEqual([36, 27, 27, 27]);
    el.remove();
  });

  it('행·열을 줄이면 범위 밖 셀이 제거된다', async () => {
    const el = await mountGrid();
    // (2,2)에 셀 추가해 두고 2행 2열로 줄입니다
    gridOf(el).cells.push({ row: 2, column: 2, content: '밖' });
    stepButton(el, strings.designer.rows, '-').click();
    await el.updateComplete;
    stepButton(el, strings.designer.columns, '-').click();
    await el.updateComplete;

    const after = gridOf(el);
    expect(after.rows.length).toBe(2);
    expect(after.columns.length).toBe(2);
    expect(after.cells.some((c) => c.row >= 2 || c.column >= 2)).toBe(false);
    expect(after.cells.some((c) => c.content === '라벨')).toBe(true);
    el.remove();
  });

  it('선택된 그리드를 다시 클릭하면 셀이 선택되고 인라인 입력으로 내용이 저장된다', async () => {
    const el = await mountGrid();
    // 그리드 원점(10,10) + 첫 칸 안쪽 (5,5)
    await clickCell(el, 15, 15);

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe('라벨');

    editor.value = '상호';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.content).toBe('상호');
    expect(el.shadowRoot!.querySelector('.cell-editor')).toBeNull();
    el.remove();
  });

  it('빈 칸을 클릭해 입력하면 새 셀이 만들어진다', async () => {
    const el = await mountGrid();
    // 두 번째 열(40%~70% → 36mm~63mm 폭 기준), (1,1) 칸 근처: x=10+50, y=10+15
    await clickCell(el, 60, 25);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.value = '새 값';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.some((c) => c.content === '새 값')).toBe(true);
    el.remove();
  });

  it('셀 내용을 바꾸지 않고 편집을 끝내면 오류를 표시하지 않는다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15);

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor.value).toBe('라벨');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.content).toBe('라벨');
    expect(el.shadowRoot!.querySelector('.input-error')).toBeNull();
    el.remove();
  });

  it('빈 셀을 비운 채 편집을 끝내면 셀을 만들거나 오류를 표시하지 않는다', async () => {
    const el = await mountGrid();
    await clickCell(el, 60, 25);

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor.value).toBe('');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.some((c) => c.row === 1 && c.column === 1)).toBe(false);
    expect(el.shadowRoot!.querySelector('.input-error')).toBeNull();
    el.remove();
  });

  it('선택 셀의 병합 값을 늘리면 저장되고, 다른 셀과 겹치는 값은 무시된다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15); // (0,0) 선택
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    const colSpanInput = () => Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.merge} ${strings.designer.columns}`) as HTMLInputElement;
    setField(colSpanInput(), '2');
    await el.updateComplete;
    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.colSpan).toBe(2);

    // 다른 셀과 겹치는 병합 값은 적용하지 않습니다.
    gridOf(el).cells.push({ row: 0, column: 2, content: '충돌' });
    setField(colSpanInput(), '3');
    await el.updateComplete;
    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.colSpan).toBe(2);
    expect(colSpanInput().getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.mergeOverlap);
    el.remove();
  });

  it('선택 셀에 배경색·글자 크기·정렬을 지정하면 셀 스타일로 저장된다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15); // (0,0) 선택
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    // 셀 배경색 — 셀 전용 색 버튼을 펼쳐 견본 클릭
    const byAria = (label: string) => Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;
    // 셀 전용 색 버튼 (요소 스타일 섹션과 이름으로 구분됩니다)
    const cellBg = `${strings.designer.cell} ${strings.designer.backgroundColor}`;
    byAria(cellBg).click();
    await el.updateComplete;
    byAria(`${cellBg} #d93025`).click();
    await el.updateComplete;

    // 글자 크기·정렬
    setField(panelField(el, strings.designer.fontSize), '14');
    await el.updateComplete;
    byAria(`${strings.designer.cell} ${strings.designer.alignment}: ${strings.designer.alignCenter}`).click();
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)! as never as Record<string, unknown>;
    expect(cell.backgroundColor).toBe('#d93025');
    expect(cell.fontSize).toBe(14);
    expect(cell.alignment).toBe('center');
    el.remove();
  });

  it('셀 편집 패널은 값·구조·텍스트·배경·테두리를 나누고 그리드 공통 스타일을 섞지 않는다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    const titles = Array.from(el.shadowRoot!.querySelectorAll('.prop-section-title'))
      .map((title) => title.textContent?.trim() ?? '');
    expect(el.shadowRoot!.querySelector('.type-name')?.textContent?.trim())
      .toContain(`${strings.designer.cell} (1, 1)`);
    expect(el.shadowRoot!.querySelector('.grid-back-label')?.textContent?.trim())
      .toBe(strings.designer.gridBack);
    expect(titles).toContain(strings.designer.panelValue);
    expect(titles).toContain(strings.designer.panelStructure);
    expect(titles).toContain(strings.designer.styleText);
    expect(titles).toContain(strings.designer.styleBackground);
    expect(titles).toContain(strings.designer.styleBorder);

    const colorLabels = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .map((button) => button.getAttribute('aria-label'));
    expect(colorLabels).toContain(`${strings.designer.cell} ${strings.designer.fontColor}`);
    expect(colorLabels).not.toContain(strings.designer.fontColor);
    expect(colorLabels).not.toContain(strings.designer.backgroundColor);
    expect(colorLabels).not.toContain(strings.designer.borderColor);
    el.remove();
  });

  it('선택 셀의 테두리를 없음으로 하면 굵기 0이 저장된다 (합계 박스, ADR-033)', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15); // (0,0) 선택
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    // 셀 섹션의 테두리 굵기 버튼(첫 번째)을 펼쳐 없음 선택
    const widthButtons = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'));
    (widthButtons[0] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.menu-backdrop')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.width-pop')?.classList.contains('preset-menu')).toBe(true);
    const noneOption = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
      .find((b) => b.getAttribute('aria-label') ===
        `${strings.designer.borderWidth}: ${strings.designer.colorNone}`) as HTMLButtonElement;
    noneOption.click();
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)! as never as Record<string, unknown>;
    expect(cell.borderWidth).toBe(0);

    // 굵기 단계를 선택하면 선택한 굵기가 저장됩니다
    (el.shadowRoot!.querySelector('.width-btn') as HTMLElement).click();
    await el.updateComplete;
    const step = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
      .find((b) => b.getAttribute('aria-label') === `${strings.designer.borderWidth}: 0.5mm`) as HTMLButtonElement;
    step.click();
    await el.updateComplete;
    expect(cell.borderWidth).toBe(0.5);

    // 셀 테두리 형태를 점선으로 (굵기와 같은 미리보기 버튼 + 펼침 메뉴)
    await pickBorderShape(
      el,
      `${strings.designer.cell} ${strings.designer.borderShape}`,
      strings.designer.borderDotted,
    );
    expect(cell.borderStyle).toBe('dotted');
    el.remove();
  });

});

// ---------------------------------------------------------------------------
// 그리드 편집 2단계
// ---------------------------------------------------------------------------

describe('<slip-designer> 그리드 편집 (ADR-037)', () => {
  const PX = 96 / 25.4;
  const s = strings.designer;

  /** 헤더 1행 + 반복 1행 + 꼬리 1행, 행 10mm·열 30mm짜리 그리드 하나만 둔 양식 */
  /** 그리드 편집 컨트롤러 — 셀·행 구간 선택 상태를 확인하고 조작합니다 */
  function gridEdit(el: Element) {
    return (el as unknown as {
      _gridEdit: {
        readonly cell: { row: number; column: number } | null;
        readonly bandRange: { from: number; to: number } | null;
        selectCell(cell: { row: number; column: number }): void;
        setEditing(editing: boolean): void;
      };
    })._gridEdit;
  }

  function makeGridElementFile(): SlipTemplateFile {
    return {
      schemaVersion: '0.1.0',
      kind: 'template',
      template: {
        meta: { title: '그리드' },
        paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
        pages: [{
          elements: [{
            type: 'grid' as const,
            id: 'g-1',
            name: 'test-grid',
            position: { x: 10, y: 10 },
            width: 60,
            height: 60,
            columns: [{ width: 30 }, { width: 30 }],
            rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
            repeat: {
              parameter: 'items',
              bands: [
                { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
                { id: 'b-tail', fromRow: 2, toRow: 2, placement: 'after-data' },
              ],
              pagination: { mode: 'fixed', itemsPerPage: 4 },
            },
            cells: [
              { row: 0, column: 0, content: '품명' },
              { row: 1, column: 0, parameter: '품명' },
            ],
          }],
          assets: [],
        }],
        assets: [],
        sampleValues: { items: [{ 품명: '사과' }, { 품명: '배' }] },
      },
    } as unknown as SlipTemplateFile;
  }

  async function mount() {
    parseSlipFileMock.mockReturnValue(makeGridElementFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;
    return el;
  }

  type TestGrid = {
    columns: { width: number }[];
    rows: { height: number }[];
    repeat?: {
      parameter: string;
      bands: {
        id: string;
        fromRow: number;
        toRow: number;
        placement: string;
        name?: string;
        pages?: string;
      }[];
      pagination: { mode: 'auto'; minItems: number } | { mode: 'fixed'; itemsPerPage: number };
      maxItems?: number;
      groupBy?: string[];
    };
    overflow?: string;
    cells: {
      row: number;
      column: number;
      name?: string;
      content?: string;
      parameter?: string;
      formula?: string;
      rowSpan?: number;
      overflow?: string;
    }[];
  };

  function gridOf(el: Element): TestGrid {
    return (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as unknown as TestGrid;
  }

  function row(el: Element, label: string): Element {
    const found = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!found) throw new Error(`패널 줄을 찾지 못했습니다: ${label}`);
    return found;
  }

  function setNumber(el: Element, label: string, value: string): void {
    const input = row(el, label).querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** 그리드 안 mm 좌표를 눌러 셀을 선택합니다 (선택된 요소 재클릭) */
  async function clickCell(el: Element, mmX: number, mmY: number) {
    const div = el.shadowRoot!.querySelector('[data-id="g-1"]') as HTMLElement;
    for (const type of ['pointerdown', 'pointerup']) {
      div.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, clientX: mmX * PX, clientY: mmY * PX, pointerId: 1,
      }));
    }
    await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  }

  it('툴바에서 그리드를 만들면 반복 설정이 없는 정적 그리드로 생긴다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, s.addGrid);

    const elements = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
    const created = elements[elements.length - 1] as unknown as TestGrid & { type: string };
    expect(created.type).toBe('grid');
    // 새 그리드는 정적 그리드입니다 — 반복은 사용자가 켭니다 (§7.1)
    expect(created.repeat).toBeUndefined();
    expect(created.rows.length).toBe(3);
    expect(created.columns.length).toBe(3);
    el.remove();
  });

  it('선택하지 않은 반복 그리드는 출력 페이지 계획대로 항목 인스턴스를 펼쳐 표시한다', async () => {
    parseSlipFileMock.mockReturnValue(makeGridElementFile() as unknown as SlipFile);
    const el = await loadDesigner();
    // 헤더 1 + 항목 4 + 꼬리 1 = 6줄
    const preview = el.shadowRoot!.querySelector('[data-id="g-1"] .grid-preview') as HTMLElement;
    expect(preview.style.gridTemplateRows.split(' ').length).toBe(6);
    el.remove();
  });

  it('선택한 반복 그리드는 원본 행 구조와 행 번호 선택 영역을 표시한다', async () => {
    const el = await mount();
    const preview = el.shadowRoot!.querySelector('[data-id="g-1"] .grid-preview') as HTMLElement;
    expect(preview.style.gridTemplateRows.split(' ').length).toBe(3);
    // 행 구간 선택 영역을 각 행에 표시합니다 (§7.2)
    const grid = el.shadowRoot!.querySelector('[data-id="g-1"]') as HTMLElement;
    const strip = grid.querySelector('.band-strip') as HTMLElement;
    expect(strip.querySelectorAll('.band-row').length).toBe(3);
    // 행 선택 영역은 요소 바깥에 있어도 잘리지 않고 포인터 입력을 받습니다.
    expect(getComputedStyle(grid).overflow).toBe('visible');
    expect(getComputedStyle(strip).pointerEvents).toBe('auto');
    el.remove();
  });

  it('페이지 계획 오류에서 문제가 있는 요소와 행 구간으로 이동한다', async () => {
    const file = makeGridElementFile();
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.rows[1]!.height = 100;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const canvasError = el.shadowRoot!.querySelector('.plan-error') as HTMLElement;
    expect(canvasError.getAttribute('role')).toBe('alert');
    const move = canvasError.querySelector('button') as HTMLButtonElement;
    move.click();
    await el.updateComplete;

    expect((el as unknown as { _selectedId: string | null })._selectedId).toBe('g-1');
    expect(gridEdit(el).bandRange).toEqual({ from: 1, to: 1 });
    expect(el.shadowRoot!.querySelector('[data-id="g-1"]')?.classList.contains('layout-error')).toBe(true);
    const band = el.shadowRoot!.querySelector('[data-band-id="b-item"]') as HTMLElement;
    expect(band.classList.contains('layout-error')).toBe(true);
    const message = canvasError.querySelector('span')!.textContent!.replace(`${s.planError}: `, '');
    expect(band.querySelector('.band-plan-error')?.textContent?.trim()).toBe(message);
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.remove();
  });

  it('선택한 반복 그리드도 출력 결과 보기에서 페이지별 헤더와 소계를 확인한다', async () => {
    const file = makeGridElementFile();
    file.template.sampleValues = {
      items: Array.from({ length: 5 }, (_, index) => ({ 품명: `항목 ${index + 1}` })),
    };
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.repeat!.pagination = { mode: 'fixed', itemsPerPage: 2 };
    grid.rows.push({ height: 10 });
    grid.repeat!.bands.push({
      id: 'b-page-total', fromRow: 3, toRow: 3, placement: 'page-end',
      name: '페이지 소계', pages: 'non-final',
    });
    grid.cells.push({ row: 3, column: 0, content: '페이지 소계' });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const toggle = el.shadowRoot!.querySelector('.output-preview-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.closest('.canvas-stack')).not.toBeNull();
    expect(toggle.closest('.paper-wrap')).toBeNull();
    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect((el as unknown as { _selectedId: string | null })._selectedId).toBe('g-1');
    toggle.click();
    await el.updateComplete;

    const activeToggle = el.shadowRoot!.querySelector('.output-preview-toggle') as HTMLButtonElement;
    expect(activeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-id="g-1"]')?.textContent).toContain('페이지 소계');

    const next = el.shadowRoot!.querySelector('.output-page-next') as HTMLButtonElement;
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.output-page-status')?.textContent).toContain('3 / 3');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"]')?.textContent).not.toContain('페이지 소계');

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect((el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements)
      .toHaveLength(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.output-preview-toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).not.toBeNull();
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.remove();
  });

  it('행 역할 메뉴는 포커스를 받고 방향키와 Escape로 조작된다', async () => {
    const el = await mount();
    const rowButton = el.shadowRoot!.querySelector('[data-id="g-1"] .band-row') as HTMLButtonElement;
    rowButton.click();
    await el.updateComplete;

    const items = Array.from(el.shadowRoot!.querySelectorAll('.band-menu-item')) as HTMLButtonElement[];
    expect(el.shadowRoot!.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    expect(el.shadowRoot!.activeElement).toBe(items[1]);
    items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.band-menu')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(rowButton);
    rowButton.blur();
    el.remove();
  });

  it('행 표시 방식은 적용 범위와 대표 용도를 선택 전에 설명한다', async () => {
    const el = await mount();
    const rowButton = el.shadowRoot!.querySelector('[data-id="g-1"] .band-row') as HTMLButtonElement;
    rowButton.click();
    await el.updateComplete;

    const once = el.shadowRoot!.querySelector('.band-menu-item.placement-before-data') as HTMLButtonElement;
    expect(once.querySelector('.band-menu-label')?.textContent?.trim()).toBe(s.bandBeforeData);
    expect(once.querySelector('.band-menu-description')?.textContent?.trim()).toBe(s.bandBeforeDataHelp);

    const perPage = el.shadowRoot!.querySelector('.band-menu-item.placement-page-start') as HTMLButtonElement;
    expect(perPage.querySelector('.band-menu-label')?.textContent?.trim()).toBe(s.bandPageStart);
    expect(perPage.querySelector('.band-menu-description')?.textContent?.trim()).toBe(s.bandPageStartHelp);
    expect(Array.from(el.shadowRoot!.querySelectorAll('.band-menu-label'))
      .map((label) => label.textContent?.trim())).toEqual([
      s.bandBeforeData,
      s.bandPageStart,
      s.bandGroupStart,
      s.bandItem,
      s.bandGroupEnd,
      s.bandAfterData,
      s.bandPageEnd,
    ]);

    rowButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    const cancel = Array.from(el.shadowRoot!.querySelectorAll('.band-menu-item'))
      .find((button) => button.textContent?.trim() === s.cancel) as HTMLButtonElement;
    cancel.click();
    await el.updateComplete;

    const addRow = row(el, s.addRow).querySelector('.list-select') as HTMLButtonElement;
    addRow.click();
    await el.updateComplete;
    const option = el.shadowRoot!.querySelector(
      '.list-select-menu button[data-value="after-data"]',
    ) as HTMLButtonElement;
    expect(option.querySelector('.list-select-option-label')?.textContent?.trim()).toBe(s.bandAfterData);
    expect(option.querySelector('.list-select-option-description')?.textContent?.trim())
      .toBe(s.bandAfterDataHelp);
    el.remove();
  });

  it('셀을 편집하는 동안에는 행 역할 선택 영역을 감춘다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).toBeNull();
    expect(el.shadowRoot!.querySelector('.grid-back')).not.toBeNull();
    el.remove();
  });

  it('항목 인스턴스는 샘플 값으로 채워 보이고, 빈 항목은 값 이름을 표시하지 않는다', async () => {
    parseSlipFileMock.mockReturnValue(makeGridElementFile() as unknown as SlipFile);
    const el = await loadDesigner();
    const texts = Array.from(el.shadowRoot!.querySelectorAll('[data-id="g-1"] .grid-preview > div'))
      .map((d) => d.textContent?.trim() ?? '')
      .filter(Boolean);
    expect(texts).toContain('품명');
    expect(texts).toContain('사과');
    expect(texts).toContain('배');
    // 샘플이 2건뿐이라 남는 2벌은 빈 항목입니다 — 값 이름을 출력값처럼 표시하지 않습니다 (§7.5)
    expect(texts).not.toContain('{품명}');
    el.remove();
  });

  it('반복 그리드에 행을 더할 때 편입할 역할을 먼저 선택한다', async () => {
    const el = await mount();
    expect(row(el, s.rows).querySelectorAll('button')).toHaveLength(2);
    const addRow = row(el, 'Add row').querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, addRow, 'page-end');

    const after = gridOf(el);
    expect(after.rows.length).toBe(4);
    expect(after.rows.map((r) => r.height)).toEqual([10, 10, 10, 10]);
    expect(after.repeat!.bands.at(-1)).toMatchObject({ fromRow: 3, toRow: 3, placement: 'page-end' });
    el.remove();
  });

  it('헤더 명령은 추가 결과를 보여 준 뒤 항목 행의 필드 이름으로 행을 만든다', async () => {
    const el = await mount();
    const beforeRows = gridOf(el).rows.length;
    (el.shadowRoot!.querySelector('[data-grid-command="header"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.grid-command-editor') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.textContent).toContain(s.gridCommandPreview);
    expect(gridOf(el).rows).toHaveLength(beforeRows);

    (editor.querySelector('.primary') as HTMLButtonElement).click();
    await el.updateComplete;
    const grid = gridOf(el);
    expect(grid.rows).toHaveLength(beforeRows + 1);
    expect(grid.repeat!.bands).toContainEqual(expect.objectContaining({
      placement: 'page-start',
      name: s.gridCommandHeaderName,
    }));
    expect(grid.cells).toContainEqual(expect.objectContaining({ row: 1, column: 0, content: '품명' }));
    expect(() => validateSlipFile(
      (el as unknown as { _file: SlipTemplateFile })._file,
    )).not.toThrow();
    el.remove();
  });

  it('그룹 기준이 없으면 그룹 소계를 적용하지 않고 설정 오류를 표시한다', async () => {
    const el = await mount();
    (el.shadowRoot!.querySelector('[data-grid-command="group-subtotal"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.grid-command-editor') as HTMLElement;
    expect(editor.textContent).toContain(s.gridCommandGroupRequired);
    expect((editor.querySelector('.primary') as HTMLButtonElement).disabled).toBe(true);
    expect(gridOf(el).rows).toHaveLength(3);
    el.remove();
  });

  it('소계의 기본 필드는 항목 영역의 가장 오른쪽 숫자 필드로 선택한다', async () => {
    const file = makeGridElementFile();
    file.template.parameters = [{
      key: 'items', valueType: 'list',
      fields: [
        { key: '수량', label: 'Qty', valueType: 'number' },
        { key: '금액', label: 'Amount', valueType: 'number' },
      ],
    }];
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.cells.find((cell) => cell.row === 1 && cell.column === 0)!.parameter = '수량';
    grid.cells.push({ row: 1, column: 1, parameter: '금액' });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    (el.shadowRoot!.querySelector('[data-grid-command="page-subtotal"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.grid-command-editor .list-select')?.textContent?.trim()).toBe('Amount');
    el.remove();
  });

  it.each([
    ['group-subtotal', 'group-end', undefined, '@group', 'gridCommandGroupSubtotalName'],
    ['page-subtotal', 'page-end', 'non-final', '@page', 'gridCommandPageSubtotalName'],
    ['final-total', 'after-data', undefined, '@all', 'gridCommandFinalTotalName'],
  ] as const)(
    '%s 명령은 선택한 숫자 필드와 적절한 집계 범위로 행을 만든다',
    async (command, placement, pages, scope, nameKey) => {
      const file = makeGridElementFile();
      file.template.parameters = [{
        key: 'items', label: 'Items', valueType: 'list',
        fields: [
          { key: '분류', label: 'Category', valueType: 'text' },
          { key: '금액', label: 'Amount', valueType: 'number' },
        ],
      }];
      file.template.sampleValues = {
        items: [{ '분류': 'A', '금액': 10 }, { '분류': 'A', '금액': 20 }],
      };
      const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
      grid.cells.push({ row: 1, column: 1, parameter: '금액' });
      if (command === 'group-subtotal') grid.repeat!.groupBy = ['분류'];
      parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
      const el = await loadDesigner();
      selectElement(el, 'g-1');
      await el.updateComplete;

      (el.shadowRoot!.querySelector(`[data-grid-command="${command}"]`) as HTMLButtonElement).click();
      await el.updateComplete;
      const editor = el.shadowRoot!.querySelector('.grid-command-editor') as HTMLElement;
      expect(editor.textContent).toContain('Amount');
      expect(gridOf(el).rows).toHaveLength(3);

      (editor.querySelector('.primary') as HTMLButtonElement).click();
      await el.updateComplete;
      const after = gridOf(el);
      const name = s[nameKey];
      const addedBand = after.repeat!.bands.find((band) => band.name === name);
      expect(addedBand).toEqual(expect.objectContaining({ placement, name }));
      if (pages === undefined) expect(addedBand).not.toHaveProperty('pages');
      else expect(addedBand?.pages).toBe(pages);
      expect(after.cells).toContainEqual(expect.objectContaining({
        column: 1,
        formula: `SUM(${scope}.금액)`,
      }));
      if (command === 'page-subtotal') {
        const canvasText = el.shadowRoot!.querySelector('[data-id="g-1"] .grid-preview')?.textContent ?? '';
        expect(canvasText).toContain('30');
        expect(canvasText).not.toContain(`SUM(${scope}.금액)`);
      }
      expect(() => validateSlipFile(
        (el as unknown as { _file: SlipTemplateFile })._file,
      )).not.toThrow();
      el.remove();
    },
  );

  it('행 높이·열 너비를 mm로 수정하면 그 트랙만 바뀐다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25); // 항목 구간 행 (요소 y=10, 행 10mm)
    await el.updateComplete;

    setNumber(el, s.rowHeight, '20');
    await el.updateComplete;
    expect(gridOf(el).rows.map((r) => r.height)).toEqual([10, 20, 10]);

    setNumber(el, s.columnWidth, '50');
    await el.updateComplete;
    expect(gridOf(el).columns.map((c) => c.width)).toEqual([50, 30]);
    el.remove();
  });

  it('반복을 끄면 사라지고, 다시 켜면 선택한 행이 항목 구간이 된다', async () => {
    const el = await mount();
    const toggle = row(el, s.repeatOn).querySelector('input') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat).toBeUndefined();

    const on = row(el, s.repeatOn).querySelector('input') as HTMLInputElement;
    on.checked = true;
    on.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const repeat = gridOf(el).repeat!;
    // 항목 구간 하나와 자동 확장 방식으로 시작합니다 — perPage를 임의로 지정하지 않습니다 (§7.1)
    expect(repeat.bands.filter((b) => b.placement === 'item').length).toBe(1);
    expect(repeat.pagination).toEqual({ mode: 'auto', minItems: 0 });
    el.remove();
  });

  it('행 번호 선택 영역에서 역할 명령으로 행 구간을 바꾼다 (§7.2)', async () => {
    const el = await mount();
    // 첫 행을 눌러 역할 메뉴를 엽니다
    const stripRow = el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip .band-row') as HTMLButtonElement;
    stripRow.click();
    await el.updateComplete;
    const menu = el.shadowRoot!.querySelector('.band-menu');
    expect(menu).not.toBeNull();

    // 첫 행을 데이터 반복 영역으로 지정하면 기존 항목 행은 아래 역할로 흡수됩니다
    const command = menu!.querySelector('.band-menu-item.placement-item') as HTMLButtonElement;
    command.click();
    await el.updateComplete;

    const bands = gridOf(el).repeat!.bands;
    expect(bands[0]).toMatchObject({ fromRow: 0, toRow: 0, placement: 'item' });
    expect(bands.filter((b) => b.placement === 'item').length).toBe(1);
    el.remove();
  });

  it('속성 패널에서 선택한 행 구간의 역할을 바꾼다', async () => {
    const el = await mount();
    const lastBand = el.shadowRoot!.querySelector('[data-band-id="b-tail"] .band-item-main') as HTMLButtonElement;
    lastBand.click();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.band-editor') as HTMLElement;
    await pickListValue(el, editor.querySelector('.list-select') as HTMLButtonElement, 'page-end');
    expect(gridOf(el).repeat!.bands.at(-1)).toMatchObject({ fromRow: 2, toRow: 2, placement: 'page-end' });
    el.remove();
  });

  it('행 구간의 종료 행을 바꾸면 실제 구간 경계에 즉시 반영한다', async () => {
    const el = await mount();
    const itemBand = el.shadowRoot!.querySelector('[data-band-id="b-item"] .band-item-main') as HTMLButtonElement;
    itemBand.click();
    await el.updateComplete;

    let editor = el.shadowRoot!.querySelector('.band-editor') as HTMLElement;
    let to = editor.querySelector(`[aria-label="${s.bandToRow}"]`) as HTMLInputElement;
    to.value = '3';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat!.bands.find((band) => band.id === 'b-item'))
      .toMatchObject({ fromRow: 1, toRow: 2, placement: 'item' });
    expect(gridEdit(el).bandRange).toEqual({ from: 1, to: 2 });

    editor = el.shadowRoot!.querySelector('.band-editor') as HTMLElement;
    to = editor.querySelector(`[aria-label="${s.bandToRow}"]`) as HTMLInputElement;
    to.value = '2';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat!.bands.find((band) => band.id === 'b-item'))
      .toMatchObject({ fromRow: 1, toRow: 1, placement: 'item' });
    expect(gridOf(el).repeat!.bands.at(-1))
      .toMatchObject({ fromRow: 2, toRow: 2, placement: 'after-data' });
    el.remove();
  });

  it('종료 행 변경으로 병합 셀이 구간 경계를 넘으면 적용하지 않는다', async () => {
    const file = makeGridElementFile();
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.repeat!.bands = [
      { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
      { id: 'b-item', fromRow: 1, toRow: 2, placement: 'item' },
    ];
    grid.cells.push({ row: 1, column: 1, rowSpan: 2, content: '병합' });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const itemBand = el.shadowRoot!.querySelector('[data-band-id="b-item"] .band-item-main') as HTMLButtonElement;
    itemBand.click();
    await el.updateComplete;
    const to = el.shadowRoot!.querySelector(`[aria-label="${s.bandToRow}"]`) as HTMLInputElement;
    to.value = '2';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat!.bands.find((band) => band.id === 'b-item'))
      .toMatchObject({ fromRow: 1, toRow: 2, placement: 'item' });
    expect(el.shadowRoot!.querySelector('#error-band-range')?.textContent?.trim()).toBe(s.repeatMergeError);
    expect(to.getAttribute('aria-invalid')).toBe('true');
    el.remove();
  });

  it('페이지 방식 세그먼트로 자동 확장과 고정 페이지를 전환한다 (§7.3)', async () => {
    const el = await mount();
    // 고정 페이지 상태 — 페이지당 항목 수 입력만 표시합니다
    const labels = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    expect(labels()).toContain(s.itemsPerPage);
    expect(labels()).not.toContain(s.minItems);

    setNumber(el, s.itemsPerPage, '6');
    await el.updateComplete;
    expect(gridOf(el).repeat?.pagination).toEqual({ mode: 'fixed', itemsPerPage: 6 });

    // 자동 확장으로 전환하면 최소 표시 항목 수 입력만 표시합니다
    const auto = Array.from(el.shadowRoot!.querySelectorAll('.segment button'))
      .find((b) => b.textContent?.trim() === s.paginationAuto) as HTMLButtonElement;
    auto.click();
    await el.updateComplete;
    expect(gridOf(el).repeat?.pagination).toEqual({ mode: 'auto', minItems: 0 });
    expect(labels()).toContain(s.minItems);
    expect(labels()).not.toContain(s.itemsPerPage);

    setNumber(el, s.minItems, '3');
    await el.updateComplete;
    expect(gridOf(el).repeat?.pagination).toEqual({ mode: 'auto', minItems: 3 });
    el.remove();
  });

  it('최대 항목 수와 그룹 기준은 고급 설정에 두고 그룹 기준은 필드 목록에서 선택한다', async () => {
    const file = makeGridElementFile();
    file.template.parameters = [{
      key: 'items', label: 'Items', valueType: 'list',
      fields: [
        { key: '품명', label: 'Item name', valueType: 'text' },
        { key: '분류', label: 'Category', valueType: 'text' },
      ],
    }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const advanced = el.shadowRoot!.querySelector('details.advanced-settings') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(row(el, s.repeatMaxItems).closest('details')).toBe(advanced);
    expect(row(el, s.groupBy).querySelector('input[type="text"]')).toBeNull();

    const category = advanced.querySelector('input[data-field="분류"]') as HTMLInputElement;
    category.checked = true;
    category.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(gridOf(el).repeat?.groupBy).toEqual(['분류']);
    el.remove();
  });

  it('maxItems는 페이지당 항목 수보다 작아도 받아들인다', async () => {
    const el = await mount();
    setNumber(el, s.repeatMaxItems, '2');
    await el.updateComplete;
    // 페이지당 항목 수(4)보다 작은 최대 항목 수를 허용합니다 (§5.5)
    expect(gridOf(el).repeat?.maxItems).toBe(2);
    el.remove();
  });

  it('셀의 값 소스를 선택하면 다른 값 소스는 제거된다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25);
    await el.updateComplete;

    await pickListValue(el, row(el, s.cellSource).querySelector('.list-select') as HTMLButtonElement, 'formula');

    const input = row(el, s.formula).querySelector('input') as HTMLInputElement;
    input.value = 'SUM(items.금액)';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 1 && c.column === 0)!;
    expect(cell.formula).toBe('SUM(items.금액)');
    expect(cell.parameter).toBeUndefined();
    expect(cell.content).toBeUndefined();
    el.remove();
  });

  it('선택한 그리드에서 행을 누르면 해당 원본 행의 셀이 선택된다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25); // 항목 구간 행 (y 20~30)
    const item = gridEdit(el).cell;
    await clickCell(el, 15, 35); // 꼬리 행 (y 30~40)
    const tail = gridEdit(el).cell;
    expect(item).toEqual({ row: 1, column: 0 });
    expect(tail).toEqual({ row: 2, column: 0 });
    el.remove();
  });

  it('행 구간 경계를 넘는 병합은 받아들이지 않는다', async () => {
    const el = await mount();
    await clickCell(el, 15, 15); // 헤더 행 (y 10~20)
    await el.updateComplete;
    const merge = el.shadowRoot!.querySelector(`[aria-label="${s.merge} ${s.rows}"]`) as HTMLInputElement;
    merge.value = '2';
    merge.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)!;
    expect(cell.rowSpan).toBeUndefined();
    el.remove();
  });

  it('그리드의 긴 내용 표시 기본값은 텍스트 섹션에서 바꿀 수 있다', async () => {
    const el = await mount();
    const overflowRow = row(el, s.overflow);
    expect(overflowRow.closest('.prop-section')?.querySelector('.prop-section-title')?.textContent?.trim())
      .toBe(s.styleText);
    await pickListValue(el, overflowRow.querySelector('.list-select') as HTMLButtonElement, 'shrink');
    expect(gridOf(el).overflow).toBe('shrink');
    el.remove();
  });

  it('선택 셀은 그리드의 긴 내용 표시 설정을 따르거나 별도로 덮어쓸 수 있다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25);
    await el.updateComplete;

    const overflowSelect = () => row(el, s.overflow).querySelector('.list-select') as HTMLButtonElement;
    expect(overflowSelect().getAttribute('data-value')).toBe('inherit');

    await pickListValue(el, overflowSelect(), 'shrink');
    expect(gridOf(el).cells.find((cell) => cell.row === 1 && cell.column === 0)?.overflow).toBe('shrink');

    await pickListValue(el, overflowSelect(), 'inherit');
    expect(gridOf(el).cells.find((cell) => cell.row === 1 && cell.column === 0)?.overflow).toBeUndefined();
    el.remove();
  });

  it('그리드가 사용하는 파라미터는 사이드바에 표시하고, 항목 구간의 필드는 해당 그리드의 하위 항목으로 표시한다', async () => {
    const el = await mount();
    const labels = Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
      .map((r) => r.textContent?.trim() ?? '');
    expect(labels.some((l) => l.includes('items'))).toBe(true);
    // 항목 구간의 칸은 목록 항목의 필드로 표시합니다.
    expect(Array.from(el.shadowRoot!.querySelectorAll('.side-col-row'))
      .map((r) => r.textContent?.trim())).toEqual(['품명']);
    el.remove();
  });

  it('인라인 칸 편집 상자는 칸의 배경색을 그대로 사용한다 (편집 중 색이 사라지지 않게)', async () => {
    const el = await mount();
    // 셀에 배경색을 지정한 뒤 같은 셀을 두 번 눌러 인라인 편집을 엽니다
    gridEdit(el).selectCell({ row: 0, column: 0 });
    (el as unknown as { _gridCommands: { updateCellStyle(key: string, value: unknown): void } })
      ._gridCommands.updateCellStyle('backgroundColor', '#ffeeaa');
    await el.updateComplete;
    gridEdit(el).setEditing(true);
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor).not.toBeNull();
    expect(editor.getAttribute('style')).toContain('background:#ffeeaa');
    el.remove();
  });

  it('셀 파라미터를 포커스 이동 없이 연달아 바꿔도 매번 반영된다 (Lit select 회귀)', async () => {
    const el = await mount();
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      f.template.parameters = [{
        key: 'items', valueType: 'list',
        fields: [{ key: '품명' }, { key: '수량' }, { key: '단가' }],
      }];
    });
    await el.updateComplete;
    await clickCell(el, 15, 25);
    await el.updateComplete;

    const sel = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === s.parameter)!
      .querySelector('.list-select') as HTMLButtonElement;
    const cellParameter = () => gridOf(el).cells.find((c) => c.row === 1 && c.column === 0)?.parameter;

    for (const value of ['수량', '단가', '품명']) {
      await pickListValue(el, sel(), value);
      expect(cellParameter()).toBe(value);
      expect(sel().getAttribute('data-value')).toBe(value);
    }
    el.remove();
  });

  it('그리드 셀을 선택하면 그리드 공통 설정을 숨기고 상위 그리드로 이동하는 항목을 표시한다 (ADR-034)', async () => {
    const el = await mount();
    // 셀을 선택하기 전에는 그리드 설정(행 수)을 표시합니다
    const labels = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    expect(labels()).toContain(s.rows);

    await clickCell(el, 15, 25);
    await el.updateComplete;
    // 칸을 선택하면 그리드 옵션은 사라지고 칸 편집만 남습니다
    expect(labels()).not.toContain(s.rows);
    expect(labels()).toContain(s.merge);
    // 그리드로 돌아갈 수 있습니다
    const back = el.shadowRoot!.querySelector('.grid-back') as HTMLButtonElement;
    expect(back).not.toBeNull();
    expect(back.textContent).toContain(s.gridBack);
    expect(back.getAttribute('aria-label')).toContain(s.gridBack);
    back.click();
    await el.updateComplete;
    expect(labels()).toContain(s.rows);
    el.remove();
  });

  it('요소 목록에서 그리드를 펼치면 이름·값·수식 셀을 표시하고, 항목을 누르면 해당 셀이 선택된다 (G-44)', async () => {
    const el = await mount(); // 그리드를 선택하면 요소 목록의 해당 항목을 자동으로 펼친다
    const cellRows = () => Array.from(el.shadowRoot!.querySelectorAll('.side-cell-row'));
    // 이름이 없는 직접 입력 칸은 제외하고 파라미터가 지정된 칸을 표시합니다.
    expect(cellRows().length).toBe(1);
    // 이름이 없는 칸은 좌표를 표시합니다 — 헤더나 파라미터에서 이름을 자동으로 만들지 않습니다 (§7.4)
    expect(cellRows()[0]!.textContent?.trim()).toBe('Row 2, Col 1');
    expect(cellRows()[0]!.getAttribute('title')).toContain('Row 2'); // 2행 1열

    // 셀 이름을 지정하면 목록에 그 이름을 우선 표시합니다
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      const grid = f.template.pages[0]!.elements[0]! as unknown as TestGrid;
      grid.cells.find((c) => c.row === 1 && c.column === 0)!.name = '품명 칸';
    });
    await el.updateComplete;
    expect(cellRows()[0]!.textContent?.trim()).toBe('품명 칸');

    // 직접 입력 칸도 이름을 지정하면 요소 목록에서 다시 찾을 수 있습니다.
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      const grid = f.template.pages[0]!.elements[0]! as unknown as TestGrid;
      grid.cells.find((c) => c.row === 0 && c.column === 0)!.name = '품명 머리글';
    });
    await el.updateComplete;
    expect(cellRows().map((item) => item.textContent?.trim())).toEqual(['품명 머리글', '품명 칸']);

    // 그리드의 하위 항목을 선택하면 해당 셀이 선택됩니다
    (cellRows()[1] as HTMLElement).click();
    await el.updateComplete;
    const sel = gridEdit(el).cell;
    expect(sel).toEqual({ row: 1, column: 0 });
    el.remove();
  });

  it('요소 목록에서 펼침 버튼으로 그리드의 하위 항목을 접을 수 있다 (G-44)', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelectorAll('.side-cell-row').length).toBe(1);
    // 요소 목록 그리드 줄의 펼침 표시를 눌러 접습니다
    const twisty = Array.from(el.shadowRoot!.querySelectorAll('.side-twisty'))
      .find((b) => b.getAttribute('aria-label')?.startsWith('test-grid')) as HTMLButtonElement;
    twisty.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-cell-row').length).toBe(0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 행 구간 옵션과 반복 파라미터 — 모듈 분리에서 옮길 상태 경계
// ---------------------------------------------------------------------------

describe('<slip-designer> 행 구간 옵션·반복 파라미터', () => {
  const s = strings.designer;

  /** page-start·group-start 구간을 함께 가진 반복 그리드 */
  function makeBandFile(): SlipTemplateFile {
    return {
      schemaVersion: '0.1.0',
      kind: 'template',
      template: {
        meta: { title: '행 구간' },
        paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
        pages: [{
          elements: [{
            type: 'grid' as const,
            id: 'g-1',
            name: 'band-grid',
            position: { x: 10, y: 10 },
            columns: [{ width: 30 }, { width: 30 }],
            rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
            repeat: {
              parameter: 'items',
              bands: [
                { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'b-group', fromRow: 1, toRow: 1, placement: 'group-start' },
                { id: 'b-item', fromRow: 2, toRow: 2, placement: 'item' },
              ],
              pagination: { mode: 'auto', minItems: 0 },
              groupBy: ['분류'],
            },
            cells: [
              { row: 0, column: 0, content: '품명' },
              { row: 1, column: 0, parameter: '분류' },
              { row: 2, column: 0, parameter: '품명' },
            ],
          }],
          assets: [],
        }],
        assets: [],
        parameters: [
          {
            key: 'items',
            label: '항목',
            valueType: 'list',
            fields: [{ key: '분류', label: '분류' }, { key: '품명', label: '품명' }],
          },
          { key: 'other', label: '다른 목록', valueType: 'list', fields: [{ key: 'x', label: 'x' }] },
        ],
      },
    } as unknown as SlipTemplateFile;
  }

  type BandGrid = {
    repeat?: {
      parameter: string;
      bands: { id: string; placement: string; pages?: string; repeatOnPageBreak?: boolean }[];
    };
  };

  function gridOf(el: Element): BandGrid {
    return (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as unknown as BandGrid;
  }

  function bandOf(el: Element, id: string) {
    return gridOf(el).repeat!.bands.find((b) => b.id === id)!;
  }

  async function mount() {
    parseSlipFileMock.mockReturnValue(makeBandFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;
    return el;
  }

  function bandSelect(el: Element, bandId: string): HTMLElement {
    const found = el.shadowRoot!.querySelector(
      `[data-band-id="${bandId}"] .list-select`,
    ) as HTMLElement | null;
    if (!found) throw new Error(`행 구간 선택 상자를 찾지 못했습니다: ${bandId}`);
    return found;
  }

  it('page-start 구간의 표시 페이지를 선택하면 pages에 저장되고, 모든 페이지로 되돌리면 키가 사라진다', async () => {
    const el = await mount();
    expect(bandOf(el, 'b-head').pages).toBeUndefined();

    await pickListValue(el, bandSelect(el, 'b-head'), 'first');
    expect(bandOf(el, 'b-head').pages).toBe('first');

    await pickListValue(el, bandSelect(el, 'b-head'), 'all');
    expect('pages' in bandOf(el, 'b-head')).toBe(false);
    el.remove();
  });

  it('group-start 구간의 이월 시 다시 표시를 켜고 끄면 repeatOnPageBreak가 붙었다 사라진다', async () => {
    const el = await mount();
    const toggle = el.shadowRoot!.querySelector(
      '[data-band-id="b-group"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(bandOf(el, 'b-group').repeatOnPageBreak).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect('repeatOnPageBreak' in bandOf(el, 'b-group')).toBe(false);
    el.remove();
  });

  it('반복 파라미터를 바꾸면 그리드의 parameter가 바뀐다', async () => {
    const el = await mount();
    const trigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((b) => b.getAttribute('aria-label') === `${s.repeatSection} ${s.parameter}`) as HTMLElement;

    await pickListValue(el, trigger, 'other');
    expect(gridOf(el).repeat!.parameter).toBe('other');
    el.remove();
  });

  it('정의에 없는 키로 반복하던 그리드는 그 키를 목록 파라미터로 등록한다', async () => {
    const file = makeBandFile();
    file.template.parameters = [{ key: 'other', label: '다른 목록', valueType: 'list' }] as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const trigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((b) => b.getAttribute('aria-label') === `${s.repeatSection} ${s.parameter}`) as HTMLElement;
    await pickListValue(el, trigger, 'other');

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters ?? [];
    expect(defs.find((d) => d.key === 'other')?.valueType).toBe('list');
    expect(gridOf(el).repeat!.parameter).toBe('other');
    el.remove();
  });
});
