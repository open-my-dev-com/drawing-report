// @vitest-environment happy-dom
// 접근성 — 입력의 접근 가능한 이름, 툴바 메뉴 키보드 조작, 편집 뒤 초점, 삭제 확인
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

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  loadDesigner,
  flush,
  toolbarButton,
  selectElement,
  PX_PER_MM,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

/** 모든 요소 종류와 반복 그리드, 파라미터 정의를 담은 양식 */
function makeFile(): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.parameters = [
    { key: 'amount', label: '금액' },
    { key: 'items', valueType: 'list', fields: [{ key: 'qty', label: '수량' }] },
  ];
  file.template.pages[0]!.elements.push(
    { type: 'field', id: 'f-1', name: 'calc', position: { x: 100, y: 10 }, width: 40, height: 8, formula: '1+1' } as never,
    { type: 'image', id: 'i-1', name: 'pic', position: { x: 150, y: 10 }, width: 20, height: 20 } as never,
    { type: 'barcode', id: 'b-1', name: 'code', position: { x: 10, y: 200 }, width: 20, height: 20, kind: 'qrcode', content: '123' } as never,
    { type: 'barcode', id: 'b-2', name: 'code2', position: { x: 40, y: 200 }, width: 20, height: 20, kind: 'qrcode', formula: '"x"' } as never,
    { type: 'polygon', id: 'p-1', name: 'poly', position: { x: 70, y: 200 }, width: 20, height: 20, sides: 5 } as never,
    { type: 'line', id: 'l-1', name: 'rule', position: { x: 100, y: 200 }, width: 40, height: 2, lineDirection: 'horizontal' } as never,
    { type: 'ellipse', id: 'e-1', name: 'oval', position: { x: 150, y: 200 }, width: 20, height: 20 } as never,
    {
      type: 'grid', id: 'grid-1', name: 'table', position: { x: 10, y: 150 },
      rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
      columns: [{ width: 30 }, { width: 30 }, { width: 30 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
          { id: 'b-foot', fromRow: 2, toRow: 2, placement: 'after-data' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 5 },
      },
      cells: [
        { row: 0, column: 0, content: '라벨' },
        { row: 1, column: 0, parameter: 'qty' },
        { row: 2, column: 0, formula: 'SUM(@all.qty)' },
        { row: 2, column: 1, content: '' },
      ],
    } as never,
  );
  file.template.pages.push({ elements: [] });
  return file;
}

async function mount(): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(makeFile() as unknown as SlipFile);
  return loadDesigner();
}

/** 접근 가능한 이름이 없는 입력(input·textarea·select) — aria-label, label[for]=id, 감싸는 label 모두 없는 것 */
function unnamedInputs(el: Element): string[] {
  const root = el.shadowRoot!;
  const labelled = new Set(
    Array.from(root.querySelectorAll('label[for]')).map((l) => l.getAttribute('for')),
  );
  return Array.from(root.querySelectorAll<HTMLElement>('input, textarea, select'))
    .filter((input) => {
      if (input.getAttribute('aria-label')) return false;
      if (input.id && labelled.has(input.id)) return false;
      if (input.closest('label') !== null) return false;
      return true;
    })
    .map((input) => input.outerHTML.slice(0, 80));
}

async function clickCell(el: Designer, mmX: number, mmY: number, init: PointerEventInit = {}): Promise<void> {
  const div = el.shadowRoot!.querySelector('[data-id="grid-1"]') as HTMLElement;
  const options = { bubbles: true, composed: true, clientX: mmX * PX_PER_MM, clientY: mmY * PX_PER_MM, pointerId: 1, ...init };
  div.dispatchEvent(new PointerEvent('pointerdown', options));
  div.dispatchEvent(new PointerEvent('pointerup', options));
  await el.updateComplete;
}

function active(el: Element): Element | null {
  return el.shadowRoot!.activeElement;
}

const byAria = (el: Element, label: string) =>
  Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

describe('<slip-designer> 입력의 접근 가능한 이름', () => {
  it('양식·페이지·파라미터·하위 필드 패널의 모든 입력에 이름이 있다', async () => {
    const el = await mount();
    expect(unnamedInputs(el)).toEqual([]);

    (el.shadowRoot!.querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(`input[aria-label="${strings.designer.pageKey}"]`)).not.toBeNull();
    expect(unnamedInputs(el)).toEqual([]);

    (Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-row'))
      .find((b) => b.getAttribute('title') === 'amount') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.parameter-key-input')).not.toBeNull();
    expect(unnamedInputs(el)).toEqual([]);

    (Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-row'))
      .find((b) => b.getAttribute('title') === 'items') as HTMLButtonElement).click();
    await el.updateComplete;
    (Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-col-row'))
      .find((b) => b.getAttribute('title') === 'items.qty') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(unnamedInputs(el)).toEqual([]);
    el.remove();
  });

  it('모든 요소 종류의 속성 패널 입력에 이름이 있다', async () => {
    const el = await mount();
    for (const id of ['txt-1', 'shp-1', 'f-1', 'i-1', 'b-1', 'b-2', 'p-1', 'l-1', 'e-1', 'grid-1']) {
      selectElement(el, id);
      await el.updateComplete;
      expect(unnamedInputs(el), id).toEqual([]);
    }
    // 반복 설정을 자동 확장으로 바꿔 최소 항목 수 입력도 확인합니다.
    const auto = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === strings.designer.paginationAuto) as HTMLButtonElement;
    auto.click();
    await el.updateComplete;
    expect(unnamedInputs(el)).toEqual([]);
    el.remove();
  });

  it('셀 편집 패널(직접 입력·수식·병합·크기)과 인라인 편집기에 이름이 있다', async () => {
    const el = await mount();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    // (0,0) 직접 입력 셀 — 인라인 편집기가 열립니다.
    await clickCell(el, 25, 155);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor.getAttribute('aria-label')).toBe(strings.designer.content);
    expect(unnamedInputs(el)).toEqual([]);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(unnamedInputs(el)).toEqual([]);
    // (2,0) 수식 셀
    await clickCell(el, 25, 175);
    expect(el.shadowRoot!.querySelector(`.prop-panel input[aria-label="${strings.designer.formula}"]`)).not.toBeNull();
    expect(unnamedInputs(el)).toEqual([]);
    el.remove();
  });

  it('샘플 데이터·저장 모달의 입력에 이름이 있다', async () => {
    const el = await mount();
    el.storage = { save: vi.fn(), load: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue({ items: [] }) } as never;
    await el.updateComplete;
    byAria(el, strings.designer.sampleData).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).not.toBeNull();
    expect(unnamedInputs(el)).toEqual([]);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    toolbarButton(el, strings.designer.saveAsMyForm).click();
    await el.updateComplete;
    expect(unnamedInputs(el)).toEqual([]);
    el.remove();
  });
});

describe('<slip-designer> 툴바 메뉴 키보드 조작', () => {
  for (const [label, menuLabel] of [
    ['preset', strings.designer.preset],
    ['shape', strings.designer.shape],
    ['grid', strings.designer.grid],
  ] as const) {
    it(`${label} 메뉴를 키보드로 열면 첫 항목에 초점이 가고 방향키로 옮기며 Escape로 닫고 버튼으로 돌아온다`, async () => {
      const el = await mount();
      const button = toolbarButton(el, menuLabel);
      button.focus();
      // 키보드로 누른 클릭은 detail이 0입니다.
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      await el.updateComplete;
      const items = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.toolbar [role="menuitem"]'));
      expect(items.length).toBeGreaterThan(1);
      expect(active(el)).toBe(items[0]);

      items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(active(el)).toBe(items[1]);
      items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(active(el)).toBe(items[items.length - 1]);
      items[items.length - 1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(active(el)).toBe(items[0]);
      items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      expect(active(el)).toBe(items[items.length - 1]);

      (active(el) as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.toolbar [role="menu"]')).toBeNull();
      expect(active(el)).toBe(button);
      el.remove();
    });
  }

  it('메뉴가 열린 채 버튼에서 Escape를 누르면 메뉴만 닫히고 선택 요소는 그대로다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const button = toolbarButton(el, strings.designer.preset);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.toolbar [role="menu"]')).not.toBeNull();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.toolbar [role="menu"]')).toBeNull();
    expect((el as unknown as { _selectedId: string | null })._selectedId).toBe('txt-1');
    el.remove();
  });
});

describe('<slip-designer> 인라인 셀 편집 뒤의 초점', () => {
  it('Enter로 마치면 그리드 요소가 초점을 받고 단축키가 계속 듣는다', async () => {
    const el = await mount();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    await clickCell(el, 25, 155);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.value = '상호';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    await flush();
    expect(el.shadowRoot!.querySelector('.cell-editor')).toBeNull();
    expect(active(el)).toBe(el.shadowRoot!.querySelector('[data-id="grid-1"]'));

    // 초점이 요소에 있으므로 Ctrl+Z가 호스트에 닿아 방금 입력을 되돌립니다.
    (active(el) as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    await el.updateComplete;
    const grid = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements
      .find((e) => e.id === 'grid-1') as { cells: { row: number; column: number; content?: string }[] };
    expect(grid.cells.find((c) => c.row === 0 && c.column === 0)?.content).toBe('라벨');
    el.remove();
  });

  it('Escape로 마쳐도 그리드 요소가 초점을 받는다', async () => {
    const el = await mount();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    await clickCell(el, 25, 155);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    await flush();
    expect(active(el)).toBe(el.shadowRoot!.querySelector('[data-id="grid-1"]'));
    el.remove();
  });
});

describe('<slip-designer> 저장된 양식 삭제 확인', () => {
  function makeStorage() {
    return {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(makeTemplateFile()),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        items: [
          { id: 'a', kind: 'template', title: '거래명세서' },
          { id: 'b', kind: 'template', title: '청구서' },
        ],
      }),
    };
  }

  it('삭제는 확인 모달을 거치며 취소하면 지우지 않고, 확인하면 어댑터에 위임한다', async () => {
    const storage = makeStorage();
    const el = await loadDesigner();
    el.storage = storage as never;
    await el.updateComplete;
    toolbarButton(el, strings.designer.myFormsList).click();
    await flush();
    await el.updateComplete;

    const deleteButton = byAria(el, `청구서 ${strings.designer.delete}`);
    deleteButton.focus();
    deleteButton.click();
    await el.updateComplete;
    const confirm = el.shadowRoot!.querySelector('.modal-confirm') as HTMLElement;
    expect(confirm).not.toBeNull();
    expect(confirm.textContent).toContain(strings.designer.deleteFormConfirm.replace('{title}', '청구서'));
    expect(storage.delete).not.toHaveBeenCalled();
    expect(confirm.contains(active(el))).toBe(true);

    // Tab은 확인 모달 안에 갇힙니다.
    const last = confirm.querySelector('.confirm-delete') as HTMLButtonElement;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(confirm.contains(active(el))).toBe(true);

    (confirm.querySelector('.confirm-cancel') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal-confirm')).toBeNull();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(2);
    expect(active(el)).toBe(byAria(el, `청구서 ${strings.designer.delete}`));

    byAria(el, `청구서 ${strings.designer.delete}`).click();
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.modal-confirm .confirm-delete') as HTMLButtonElement).click();
    await flush();
    await el.updateComplete;
    expect(storage.delete).toHaveBeenCalledWith('b');
    expect(el.shadowRoot!.querySelector('.modal-confirm')).toBeNull();
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(1);
    expect(el.shadowRoot!.querySelector('.modal')).not.toBeNull();
    el.remove();
  });

  it('확인 모달에서 Escape는 확인만 닫고 내 양식 목록은 남긴다', async () => {
    const storage = makeStorage();
    const el = await loadDesigner();
    el.storage = storage as never;
    await el.updateComplete;
    toolbarButton(el, strings.designer.myFormsList).click();
    await flush();
    await el.updateComplete;
    byAria(el, `청구서 ${strings.designer.delete}`).click();
    await el.updateComplete;
    const confirm = el.shadowRoot!.querySelector('.modal-confirm') as HTMLElement;
    confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal-confirm')).toBeNull();
    expect(el.shadowRoot!.querySelectorAll('.modal').length).toBe(1);
    expect(storage.delete).not.toHaveBeenCalled();
    el.remove();
  });
});
