// @vitest-environment happy-dom
// 모달과 셀 선택 중에는 삭제·되돌리기 같은 문서 단축키가 양식에 닿지 않는지
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

/** 텍스트·수식 필드·고정 이미지·그리드를 한 페이지에 둔 양식 */
function makeFile(): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements.push(
    { type: 'field', id: 'f-1', name: 'calc', position: { x: 100, y: 10 }, width: 40, height: 8, formula: '1+1' } as never,
    { type: 'image', id: 'i-1', name: 'pic', position: { x: 150, y: 10 }, width: 20, height: 20 } as never,
    {
      type: 'grid', id: 'grid-1', name: 'table', position: { x: 10, y: 150 },
      rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
      columns: [{ width: 30 }, { width: 30 }, { width: 30 }],
      cells: [{ row: 0, column: 0, content: '라벨' }],
    } as never,
  );
  return file;
}

function elementsOf(el: Element) {
  return (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
}

function undoDepth(el: Element): number {
  return (el as unknown as { _undoStack: unknown[] })._undoStack.length;
}

function badges(el: Element): boolean {
  return (el as unknown as { _showBadges: boolean })._showBadges;
}

function gridEdit(el: Element) {
  return (el as unknown as { _gridEdit: { cell: unknown; cells: readonly unknown[]; editing: boolean } })._gridEdit;
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** 삭제·되돌리기·다시 실행·붙여넣기·배지 전환을 한꺼번에 눌러 봅니다 */
async function pressDestructiveKeys(el: Designer): Promise<void> {
  press(el, 'Delete');
  press(el, 'Backspace');
  press(el, 'z', { ctrlKey: true });
  press(el, 'Z', { ctrlKey: true, shiftKey: true });
  press(el, 'y', { ctrlKey: true });
  press(el, 'v', { ctrlKey: true });
  press(el, 'b', { ctrlKey: true });
  await el.updateComplete;
}

/** 요소 이름을 바꿔 되돌릴 거리를 하나 만들어 둡니다 */
async function makeUndoable(el: Designer): Promise<void> {
  const name = el.shadowRoot!.querySelector(`.prop-panel input[aria-label="${strings.designer.name}"]`) as HTMLInputElement;
  name.value = '바뀐 이름';
  name.dispatchEvent(new Event('change', { bubbles: true }));
  await el.updateComplete;
}

async function mount(selectId = 'txt-1'): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(makeFile() as unknown as SlipFile);
  const el = await loadDesigner();
  selectElement(el, selectId);
  await el.updateComplete;
  await makeUndoable(el);
  return el;
}

async function clickCell(el: Element, mmX: number, mmY: number, init: PointerEventInit = {}): Promise<void> {
  const div = el.shadowRoot!.querySelector('[data-id="grid-1"]') as HTMLElement;
  const options = { bubbles: true, composed: true, clientX: mmX * PX_PER_MM, clientY: mmY * PX_PER_MM, pointerId: 1, ...init };
  div.dispatchEvent(new PointerEvent('pointerdown', options));
  div.dispatchEvent(new PointerEvent('pointerup', options));
  await (el as Designer).updateComplete;
}

/** 모달 종류별로 여는 방법 */
const openers: Record<string, (el: Designer) => Promise<void>> = {
  formula: async (el) => {
    selectElement(el, 'f-1');
    await el.updateComplete;
    (Array.from(el.shadowRoot!.querySelectorAll('.row-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.formulaModalTitle) as HTMLButtonElement).click();
    await el.updateComplete;
  },
  image: async (el) => {
    selectElement(el, 'i-1');
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.col-modal-open') as HTMLButtonElement).click();
    await el.updateComplete;
  },
  sample: async (el) => {
    (Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.sampleData) as HTMLButtonElement).click();
    await el.updateComplete;
  },
  save: async (el) => {
    toolbarButton(el, strings.designer.saveAsMyForm).click();
    await el.updateComplete;
  },
  myForms: async (el) => {
    toolbarButton(el, strings.designer.myFormsList).click();
    await flush();
    await el.updateComplete;
  },
  confirmDelete: async (el) => {
    await openers.myForms!(el);
    (Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === `청구서 ${strings.designer.delete}`) as HTMLButtonElement).click();
    await el.updateComplete;
  },
};

describe('<slip-designer> 모달이 열려 있는 동안의 단축키', () => {
  for (const kind of Object.keys(openers)) {
    it(`${kind} 모달이 열려 있으면 Delete·되돌리기·다시 실행·붙여넣기·배지 단축키를 무시한다`, async () => {
      const el = await mount();
      el.storage = {
        save: vi.fn(), load: vi.fn(), delete: vi.fn(),
        list: vi.fn().mockResolvedValue({ items: [{ id: 'b', kind: 'template', title: '청구서' }] }),
      } as never;
      await el.updateComplete;
      await openers[kind]!(el);
      expect(el.shadowRoot!.querySelector('.modal')).not.toBeNull();

      const count = elementsOf(el).length;
      const depth = undoDepth(el);
      const showBadges = badges(el);
      await pressDestructiveKeys(el);

      expect(elementsOf(el).length).toBe(count);
      expect(undoDepth(el)).toBe(depth);
      expect(badges(el)).toBe(showBadges);
      expect(el.shadowRoot!.querySelector('.modal')).not.toBeNull();
      el.remove();
    });
  }

  it('모달이 닫힌 뒤에는 선택한 요소를 Delete로 지운다', async () => {
    const el = await mount();
    await openers.sample!(el);
    press(el, 'Escape');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();

    const count = elementsOf(el).length;
    press(el, 'Delete');
    await el.updateComplete;
    expect(elementsOf(el).length).toBe(count - 1);
    expect(elementsOf(el).some((e) => e.id === 'txt-1')).toBe(false);
    el.remove();
  });
});

describe('<slip-designer> 셀 선택 중의 Delete·Backspace', () => {
  it('셀 하나를 고른 동안에는 그리드 요소를 지우지 않는다', async () => {
    const el = await mount('grid-1');
    await clickCell(el, 25, 165);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(gridEdit(el).cell).not.toBeNull();
    expect(gridEdit(el).editing).toBe(false);

    const count = elementsOf(el).length;
    const depth = undoDepth(el);
    press(el, 'Delete');
    press(el, 'Backspace');
    await el.updateComplete;
    expect(elementsOf(el).length).toBe(count);
    expect(undoDepth(el)).toBe(depth);
    expect(gridEdit(el).cell).not.toBeNull();
    el.remove();
  });

  it('셀을 여럿 고른 동안에도 그리드 요소를 지우지 않는다', async () => {
    const el = await mount('grid-1');
    await clickCell(el, 25, 165);
    (el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    await clickCell(el, 55, 175, { ctrlKey: true });
    expect(gridEdit(el).cells.length).toBe(2);

    const count = elementsOf(el).length;
    press(el, 'Delete');
    await el.updateComplete;
    expect(elementsOf(el).length).toBe(count);
    expect(gridEdit(el).cells.length).toBe(2);
    el.remove();
  });

  it('인라인 편집 중에도 그리드 요소를 지우지 않는다', async () => {
    const el = await mount('grid-1');
    await clickCell(el, 25, 165);
    expect(gridEdit(el).editing).toBe(true);

    const count = elementsOf(el).length;
    press(el, 'Delete');
    await el.updateComplete;
    expect(elementsOf(el).length).toBe(count);
    expect(el.shadowRoot!.querySelector('.cell-editor')).not.toBeNull();
    el.remove();
  });

  it('셀 선택을 풀면(Escape) 그리드 요소를 Delete로 지운다', async () => {
    const el = await mount('grid-1');
    await clickCell(el, 25, 165);
    (el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    press(el, 'Escape');
    await el.updateComplete;
    expect(gridEdit(el).cell).toBeNull();

    const count = elementsOf(el).length;
    press(el, 'Delete');
    await el.updateComplete;
    expect(elementsOf(el).length).toBe(count - 1);
    expect(elementsOf(el).some((e) => e.id === 'grid-1')).toBe(false);
    el.remove();
  });
});
