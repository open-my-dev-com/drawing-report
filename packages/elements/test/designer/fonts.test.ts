// @vitest-environment happy-dom
// 요소·셀 폰트 선택과 캔버스 적용
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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
  // 굵은 변형이 있는 폰트와 없는 폰트를 함께 두어 변형 대체를 확인합니다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
      { name: 'Noto Sans JP', data: new Uint8Array([3]) },
    ]),
}));

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import { getStrings } from '../../src/strings.js';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  createElement,
  flush,
  listOptionLabels,
  pickListValue,
  selectElement,
  type Designer,
} from './helpers.js';

/** 폰트 등록을 흉내 내는 FontFace. 실제 폰트 데이터를 읽지 않습니다. */
class FakeFontFace {
  constructor(readonly family: string, readonly source: unknown) {}
  load(): Promise<this> {
    return Promise.resolve(this);
  }
}

/** 등록에 성공하는 `document.fonts` 대역을 설치합니다. */
function installFontFace(face: unknown): void {
  (globalThis as { FontFace?: unknown }).FontFace = face;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: () => undefined },
  });
}

/** 설치한 대역을 걷어 냅니다. */
function removeFontFace(): void {
  delete (globalThis as { FontFace?: unknown }).FontFace;
  Reflect.deleteProperty(document, 'fonts');
}

describe('<slip-designer> 폰트 선택과 캔버스 적용', () => {
  const s = strings.designer;
  beforeEach(() => installFontFace(FakeFontFace));
  afterEach(removeFontFace);

  /**
   * 등록이 끝난 폰트의 CSS 이름.
   * 등록은 출처별로 한 번만 하므로 시험마다 다시 등록되지 않습니다.
   */
  function familyOf(el: Designer, name: string): string | undefined {
    return (el as unknown as { _fontRegistry: { familyOf(n: string): string | undefined } })
      ._fontRegistry.familyOf(name);
  }

  function row(el: Element, label: string): Element {
    const found = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!found) throw new Error(`패널 줄을 찾지 못했습니다: ${label}`);
    return found;
  }

  function fontSelect(el: Element): HTMLButtonElement {
    return row(el, s.fontName).querySelector('.list-select') as HTMLButtonElement;
  }

  function elementsOf(el: Designer): Record<string, unknown>[] {
    return (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements as unknown as Record<string, unknown>[];
  }

  async function mount(elements: unknown[]): Promise<Designer> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = elements as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  function textElement(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목', ...extra,
    };
  }

  async function mountText(extra: Record<string, unknown> = {}): Promise<Designer> {
    const el = await mount([textElement(extra)]);
    selectElement(el, 't1');
    await el.updateComplete;
    return el;
  }

  it('선택 목록에 기본값과 기저 폰트만 넣고, 기본값에 대체 폰트 이름을 적는다', async () => {
    const el = await mountText();
    expect(await listOptionLabels(el, fontSelect(el)))
      .toEqual([`${s.fontDefault} (Pretendard)`, 'Pretendard', 'Noto Sans JP']);
    el.remove();
  });

  it('등록된 폰트가 하나뿐이어도 폰트 선택을 숨기지 않는다', async () => {
    const el = await mountText();
    // 기본값과 지정 상태를 구분할 수 있어야 하므로 목록은 항상 보입니다.
    expect(fontSelect(el)).not.toBeNull();
    el.remove();
  });

  it('폰트를 고르면 저장하고 기본값으로 되돌리면 지운다', async () => {
    const el = await mountText();
    await pickListValue(el, fontSelect(el), 'Noto Sans JP');
    expect(elementsOf(el)[0]!.fontName).toBe('Noto Sans JP');

    await pickListValue(el, fontSelect(el), '');
    expect(elementsOf(el)[0]).not.toHaveProperty('fontName');
    el.remove();
  });

  it('등록이 끝난 폰트를 캔버스에 적용한다', async () => {
    const el = await mountText({ fontName: 'Noto Sans JP' });
    await flush();
    await el.updateComplete;
    const content = el.shadowRoot!.querySelector('.el-content') as HTMLElement;
    const family = familyOf(el, 'Noto Sans JP');
    expect(family).toBeDefined();
    expect(content.getAttribute('style')).toContain(`font-family:${family}`);
    el.remove();
  });

  it('굵게는 등록된 변형 폰트로 표현한다', async () => {
    const el = await mountText({ fontName: 'Pretendard', bold: true });
    await flush();
    await el.updateComplete;
    const bold = familyOf(el, 'Pretendard-Bold');
    expect(bold).toBeDefined();
    const content = el.shadowRoot!.querySelector('.el-content') as HTMLElement;
    expect(content.getAttribute('style')).toContain(`font-family:${bold}`);
    expect(content.style.fontWeight).toBe('');
    el.remove();
  });

  it('굵은 변형이 없는 폰트에는 그 사실을 알린다', async () => {
    const el = await mountText({ fontName: 'Noto Sans JP', bold: true });
    await flush();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(s.fontNoBold);
    el.remove();
  });

  it('등록된 폰트에는 변형 안내를 넣지 않는다', async () => {
    const el = await mountText({ fontName: 'Pretendard', bold: true });
    await flush();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain(s.fontNoBold);
    el.remove();
  });

  it('미등록 폰트는 값을 지우지 않고 대체 폰트 사용을 알린다', async () => {
    const el = await mountText({ fontName: 'NoSuchFont' });
    await flush();
    await el.updateComplete;
    expect(elementsOf(el)[0]!.fontName).toBe('NoSuchFont');
    const note = el.shadowRoot!.querySelector('.font-note') as HTMLElement;
    expect(note.textContent).toContain(s.fontUnregistered);
    expect(note.textContent).toContain('Pretendard');
    // 저장된 이름을 그대로 고를 수 있어야 합니다.
    expect(await listOptionLabels(el, fontSelect(el))).toContain('NoSuchFont');
    el.remove();
  });

  it('등록된 변형 이름을 저장한 요소는 미등록으로 표시하지 않는다', async () => {
    const el = await mountText({ fontName: 'Pretendard-Bold' });
    await flush();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.font-note')).toBeNull();
    expect(await listOptionLabels(el, fontSelect(el))).toContain('Pretendard-Bold');
    el.remove();
  });
  /** 셀 두 개를 가진 그리드 하나만 둔 양식 */
  function gridElement(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
      columns: [{ width: 30 }, { width: 30 }],
      rows: [{ height: 10 }],
      cells: [{ row: 0, column: 0, content: '품명' }],
      ...extra,
    };
  }

  function gridEdit(el: Designer) {
    return (el as unknown as {
      _gridEdit: {
        selectCell(cell: { row: number; column: number }): void;
        setEditing(editing: boolean): void;
      };
    })._gridEdit;
  }

  async function mountGrid(extra: Record<string, unknown> = {}): Promise<Designer> {
    const el = await mount([gridElement(extra)]);
    selectElement(el, 'g1');
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  it('그리드 공통 폰트를 지정하면 저장한다', async () => {
    const el = await mountGrid();
    await pickListValue(el, fontSelect(el), 'Noto Sans JP');
    expect(elementsOf(el)[0]!.fontName).toBe('Noto Sans JP');
    el.remove();
  });

  it('셀의 기본값은 그리드 공통 폰트를 상속한다', async () => {
    const el = await mountGrid({ fontName: 'Noto Sans JP' });
    gridEdit(el).selectCell({ row: 0, column: 0 });
    await el.updateComplete;
    expect(await listOptionLabels(el, fontSelect(el)))
      .toContain(`${s.gridInherited} (Noto Sans JP)`);
    el.remove();
  });

  it('셀에서 지정한 폰트가 그리드 공통 폰트를 덮어쓰고 기본값으로 되돌아간다', async () => {
    const el = await mountGrid({ fontName: 'Noto Sans JP' });
    gridEdit(el).selectCell({ row: 0, column: 0 });
    await el.updateComplete;

    await pickListValue(el, fontSelect(el), 'Pretendard');
    const cellOf = (): Record<string, unknown> =>
      (elementsOf(el)[0]!.cells as Record<string, unknown>[])[0]!;
    expect(cellOf().fontName).toBe('Pretendard');

    await pickListValue(el, fontSelect(el), '');
    expect(cellOf()).not.toHaveProperty('fontName');
    el.remove();
  });

  it('인라인 셀 편집에도 셀에 적용되는 폰트를 쓴다', async () => {
    const el = await mountGrid({ fontName: 'Noto Sans JP' });
    gridEdit(el).selectCell({ row: 0, column: 0 });
    await el.updateComplete;
    gridEdit(el).setEditing(true);
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor.getAttribute('style'))
      .toContain(`font-family:${familyOf(el, 'Noto Sans JP')}`);
    el.remove();
  });
  it('그리드 공통 폰트가 미등록이면 저장된 이름을 유지하고 대체 표시를 알린다', async () => {
    const el = await mountGrid({ fontName: 'NoSuchFont' });
    gridEdit(el).selectCell({ row: 0, column: 0 });
    await el.updateComplete;
    expect(await listOptionLabels(el, fontSelect(el)))
      .toContain(`${s.gridInherited} (NoSuchFont)`);
    const note = el.shadowRoot!.querySelector('.font-note') as HTMLElement;
    expect(note.textContent).toContain(s.fontUnregisteredShownAs);
    expect(note.textContent).toContain('Pretendard');
    el.remove();
  });
});

describe('<slip-designer> 폰트 등록 실패', () => {
  /** 항상 읽기에 실패하는 FontFace */
  class FailingFontFace {
    constructor(readonly family: string, readonly source: unknown) {}
    load(): Promise<this> {
      return Promise.reject(new Error('읽기 실패'));
    }
  }

  beforeEach(() => installFontFace(FailingFontFace));
  afterEach(removeFontFace);

  it('폰트를 읽지 못하면 속성 패널에 대체 폰트 사용 상태를 표시한다', async () => {
    // 폰트 등록은 출처별로 한 번만 하므로 앞선 시험과 다른 로케일로 새 출처를 만듭니다.
    const ja = getStrings('ja').designer;
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목', fontName: 'Noto Sans JP',
    }] as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.locale = 'ja';
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    selectElement(el, 't1');
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const note = el.shadowRoot!.querySelector('.font-note') as HTMLElement;
    expect(note.textContent).toContain(ja.fontLoadFailed);
    el.remove();
  });
});
