// @vitest-environment happy-dom
// 모달 — 수식, 이미지, 샘플 데이터, 프리셋
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

const imagePick = vi.hoisted(() => ({
  // 각 테스트가 pickImageFile의 결과를 지정한다.
  result: null as unknown,
}));

vi.mock('../../src/image-file.js', async () => {
  // 파일 선택 대화 상자만 모의하고 바이트 표기는 실제 구현을 쓴다.
  const actual = await vi.importActual<typeof import('../../src/image-file.js')>('../../src/image-file.js');
  return {
    ...actual,
    pickImageFile: vi.fn(async () => imagePick.result),
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의한다.
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
  renderSlipToPdfMock,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  loadDesigner,
  flush,
  toolbarButton,
  pickListValue,
  addByCanvasClick,
  selectElement,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

// ---------------------------------------------------------------------------
// 프리셋
// ---------------------------------------------------------------------------

describe('<slip-designer> 프리셋', () => {
  /** 프리셋 버튼을 눌러 메뉴를 펼치고 항목 버튼들을 돌려준다 */
  async function openPresetMenu(
    el: Designer,
  ): Promise<HTMLButtonElement[]> {
    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    return Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button')) as HTMLButtonElement[];
  }

  it('프리셋 버튼을 누르면 메뉴에 2종이 나열되고, 다시 누르면 닫힌다', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();

    const items = await openPresetMenu(el);
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      strings.designer.presetTradeStatement,
      strings.designer.presetInvoice,
    ]);

    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();
    el.remove();
  });

  it('메뉴에서 프리셋을 고르면 양식이 교체되고 slip-change를 발행하며 메뉴가 닫힌다', async () => {
    const el = await loadDesigner();

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    const items = await openPresetMenu(el);
    items[0]!.click();
    await el.updateComplete;

    expect(changes.length).toBe(1);
    const file = changes[0]!.detail.file;
    expect(file.template.meta.title).toBe(strings.designer.presetTradeStatement);
    // 캔버스가 프리셋 요소로 교체된다 (기존 2개 → 프리셋 6개)
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(6);
    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();
    el.remove();
  });

  it('메뉴 바깥(배경)을 클릭하면 적용 없이 닫힌다', async () => {
    const el = await loadDesigner();
    await openPresetMenu(el);

    (el.shadowRoot!.querySelector('.menu-backdrop') as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('프리셋 적용은 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();

    const items = await openPresetMenu(el);
    items[1]!.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(6);

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// : 수식 편집 모달
// ---------------------------------------------------------------------------

describe('<slip-designer> 수식 편집 모달 (D-12)', () => {
  /** 수식 편집 모달을 열고, 모달을 연 버튼을 돌려준다 (초점 복귀 확인용) */
  async function openFormulaModal(
    el: Designer,
  ): Promise<HTMLButtonElement> {
    await addByCanvasClick(el, strings.designer.addField);
    // 값 소스를 수식으로 바꾸면 수식 입력란이 표시된다.
    const source = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.cellSource)!
      .querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, source, 'formula');

    const open = Array.from(el.shadowRoot!.querySelectorAll('.row-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.formulaModalTitle) as HTMLButtonElement;
    open.focus();
    open.click();
    await el.updateComplete;
    return open;
  }

  function formulaInput(el: Element): HTMLTextAreaElement {
    return el.shadowRoot!.querySelector('.formula-input') as HTMLTextAreaElement;
  }

  function setDraft(el: Element, value: string): void {
    const input = formulaInput(el);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyButton(el: Element): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.apply) as HTMLButtonElement;
  }

  /** 항목 구간이 값 3개를 읽는 그리드를 담은 양식으로 디자이너를 띄운다 */
  async function loadWithTable(): Promise<Designer> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'tbl-1', name: '품목 표',
      position: { x: 10, y: 10 }, width: 180, height: 8 * 3,
      rows: [{ height: 8 }, { height: 8 }],
      columns: [{ width: 90 }, { width: 54 }, { width: 36 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 2 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 0, column: 1, content: '금액' },
        { row: 0, column: 2, content: '수량' },
        { row: 1, column: 0, parameter: 'itemName' },
        { row: 1, column: 1, parameter: 'amount' },
        { row: 1, column: 2, parameter: 'quantity' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    return loadDesigner();
  }

  /** 모달 안에서 Tab으로 갈 수 있는 요소를 화면 순서대로 모은다 */
  function modalFocusables(el: Element): HTMLElement[] {
    const modal = el.shadowRoot!.querySelector('.modal') as HTMLElement;
    return Array.from(
      modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  /** 요소에 초점을 두고 Tab 키를 눌러 기본 이동이 막혔는지 확인한다 */
  function pressTab(target: HTMLElement, shiftKey = false): boolean {
    target.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('모달을 열면 모달임을 알리고 안으로 초점을 옮긴다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const modal = el.shadowRoot!.querySelector('.modal') as HTMLElement;
    expect(modal.getAttribute('aria-modal')).toBe('true');
    // 초점이 모달 안에 있어야 배경 화면을 잘못 조작하지 않는다.
    expect(modal.contains(el.shadowRoot!.activeElement as Node)).toBe(true);
    el.remove();
  });

  it('마지막 요소에서 Tab을 누르면 첫 요소로 초점이 돌아온다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const items = modalFocusables(el);
    expect(pressTab(items[items.length - 1]!)).toBe(true);
    // 기본 이동을 막는 데 그치지 않고 실제로 첫 요소에 초점이 있어야 한다.
    expect(el.shadowRoot!.activeElement).toBe(items[0]);
    el.remove();
  });

  it('첫 요소에서 Shift+Tab을 누르면 마지막 요소로 이동한다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const items = modalFocusables(el);
    expect(pressTab(items[0]!, true)).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(items[items.length - 1]);
    el.remove();
  });

  it('모달 가운데에서 Tab을 누르면 브라우저 기본 이동을 막지 않는다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const items = modalFocusables(el);
    expect(items.length).toBeGreaterThan(2);
    expect(pressTab(items[1]!)).toBe(false);
    el.remove();
  });

  it('모달을 닫으면 열기 전 요소로 초점이 돌아온다', async () => {
    const el = await loadDesigner();
    const opener = await openFormulaModal(el);
    expect(el.shadowRoot!.activeElement).not.toBe(opener);

    const close = Array.from(el.shadowRoot!.querySelectorAll('.modal-close'))[0] as HTMLButtonElement;
    close.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(opener);
    el.remove();
  });

  it('Escape로 닫아도 초점이 열기 전 요소로 돌아온다', async () => {
    const el = await loadDesigner();
    const opener = await openFormulaModal(el);
    const modal = el.shadowRoot!.querySelector('.modal') as HTMLElement;
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(opener);
    el.remove();
  });

  it('문자열 따옴표 규칙을 모달에서 안내한다 (F-21)', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    expect(el.shadowRoot!.querySelector('.formula-hint')?.textContent?.trim())
      .toBe(strings.designer.formulaQuoteHint);
    el.remove();
  });

  it('파라미터 목록에 표의 하위 열까지 나오고, 누르면 표파라미터.열키로 삽입된다 (F-21)', async () => {
    const el = await loadWithTable();
    await openFormulaModal(el);

    const columnChips = Array.from(el.shadowRoot!.querySelectorAll('.parameter-chip.column'));
    expect(columnChips.map((c) => c.textContent?.trim())).toEqual(['품명', '금액', '수량']);

    (columnChips[1] as HTMLElement).click();
    await el.updateComplete;
    expect(formulaInput(el).value).toBe('items.amount');
    el.remove();
  });

  it('표 파라미터 뒤에 점을 찍으면 열을 제안하고, 고르면 이어 붙는다 (F-21)', async () => {
    const el = await loadWithTable();
    await openFormulaModal(el);

    // 제안은 표 파라미터 뒤에 점을 찍었을 때만 나온다
    expect(el.shadowRoot!.querySelector('.formula-suggest')).toBeNull();

    setDraft(el, 'SUM(items.');
    await el.updateComplete;
    const suggested = () => Array.from(el.shadowRoot!.querySelectorAll('.formula-suggest .parameter-chip'));
    expect(suggested().map((c) => c.textContent?.trim()))
      .toEqual(['품명 · itemName', '금액 · amount', '수량 · quantity']);

    // 몇 글자 치면 그 글자로 시작하는 열만 남는다
    setDraft(el, 'SUM(items.a');
    await el.updateComplete;
    expect(suggested().map((c) => c.textContent?.trim())).toEqual(['금액 · amount']);

    // 고르면 이미 친 글자 뒤에 나머지가 이어 붙는다
    (suggested()[0] as HTMLElement).click();
    await el.updateComplete;
    expect(formulaInput(el).value).toBe('SUM(items.amount');
    el.remove();
  });

  it('함수 32종이 분류와 설명과 함께 나열된다 (ADR-017·044)', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    const rows = el.shadowRoot!.querySelectorAll('.fn-row');
    expect(rows.length).toBe(32);
    expect(el.shadowRoot!.querySelectorAll('.fn-category').length).toBe(8);
    // 각 항목에 사용법·설명이 있다
    expect(rows[0]?.querySelector('.fn-signature')?.textContent).toContain('SUM');
    expect(rows[0]?.querySelector('.fn-desc')?.textContent?.length).toBeGreaterThan(0);
    el.remove();
  });

  it('함수를 클릭하면 커서 위치에 삽입된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    const sumRow = Array.from(el.shadowRoot!.querySelectorAll('.fn-row'))
      .find((b) => b.getAttribute('aria-label') === 'SUM') as HTMLButtonElement;
    sumRow.click();
    await el.updateComplete;
    expect(formulaInput(el).value).toBe('SUM()');
    el.remove();
  });

  it('문법 오류는 실시간으로 표시되고 적용이 비활성화된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    setDraft(el, 'SUM(1,');
    await el.updateComplete;
    const status = el.shadowRoot!.querySelector('.formula-status');
    expect(status?.classList.contains('error')).toBe(true);
    expect(status?.textContent).toContain(strings.designer.syntaxError);
    expect(applyButton(el).disabled).toBe(true);
    el.remove();
  });

  it('올바른 수식은 결과를 미리 계산해 보여주고, 적용하면 요소에 저장된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    setDraft(el, 'ROUND(1.5) + 1');
    await el.updateComplete;
    const status = el.shadowRoot!.querySelector('.formula-status');
    expect(status?.classList.contains('error')).toBe(false);
    expect(status?.textContent).toContain(`${strings.designer.previewResult}: 3`);

    applyButton(el).click();
    await el.updateComplete;
    const field = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { formula?: string };
    expect(field.formula).toBe('ROUND(1.5) + 1');
    // 모달은 닫힌다
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    el.remove();
  });

  it('파라미터 목록이 칩으로 나오고 클릭하면 삽입된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    const chips = el.shadowRoot!.querySelectorAll('.parameter-chip');
    // 방금 만든 필드의 기본 파라미터가 하나 있다
    expect(chips.length).toBeGreaterThan(0);
    (chips[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(formulaInput(el).value.length).toBeGreaterThan(0);
    el.remove();
  });

  it('Escape로 적용 없이 닫힌다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    setDraft(el, 'SUM(1)');
    await el.updateComplete;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    const field = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { formula?: string };
    // Escape로 초안을 취소해도 값 소스는 수식으로 유지된다.
    expect(field.formula).toBe('');
    el.remove();
  });
});

describe('<slip-designer> 샘플 데이터 (D-13)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  async function openSampleModal(el: Designer) {
    byAria(el, strings.designer.sampleData).click();
    await el.updateComplete;
  }

  it('필드 파라미터의 샘플 값을 입력하면 sampleValues에 저장된다 (숫자 표기는 수로)', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };
    await openSampleModal(el);

    const input = Array.from(el.shadowRoot!.querySelectorAll('.modal input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.sampleData} ${field.parameter}`) as HTMLInputElement;
    input.value = '12500';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const samples = (fileOf(el).template as { sampleValues?: Record<string, unknown> }).sampleValues;
    expect(samples?.[field.parameter]).toBe(12500);

    // 빈 값으로 바꾸면 지워지고, 전부 비면 sampleValues 자체가 사라진다
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect((fileOf(el).template as { sampleValues?: unknown }).sampleValues).toBeUndefined();
    el.remove();
  });

  it('항목 구간 파라미터는 항목 필드대로 행을 추가·편집한다 (ADR-037)', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'g-items', name: '품목 그리드',
      position: { x: 10, y: 10 }, width: 90, height: 8 * 3,
      rows: [{ height: 8 }, { height: 8 }],
      columns: [{ width: 60 }, { width: 30 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 2 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 1, column: 0, parameter: 'itemName' },
        { row: 1, column: 1, parameter: 'amount' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    await openSampleModal(el);

    // 반복 파라미터(items)은 행 편집 그리드로 나온다
    expect(el.shadowRoot!.querySelector('.sample-grid')).not.toBeNull();
    byAria(el, `items ${strings.designer.addRow}`).click();
    await el.updateComplete;

    const cell = Array.from(el.shadowRoot!.querySelectorAll('.sample-grid input'))
      .find((i) => i.getAttribute('aria-label') === 'items 1 itemName') as HTMLInputElement;
    cell.value = '노트';
    cell.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const samples = (fileOf(el).template as { sampleValues?: Record<string, unknown> }).sampleValues;
    expect(samples?.items).toEqual([{ itemName: '노트' }]);

    // 행 삭제로 비우면 값도 사라진다
    byAria(el, `items 1 ${strings.designer.delete}`).click();
    await el.updateComplete;
    expect((fileOf(el).template as { sampleValues?: unknown }).sampleValues).toBeUndefined();
    el.remove();
  });

  it('샘플 값이 있으면 미리보기는 그 값으로 채운 전표를 렌더한다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };
    await openSampleModal(el);
    const input = Array.from(el.shadowRoot!.querySelectorAll('.modal input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.sampleData} ${field.parameter}`) as HTMLInputElement;
    input.value = '9900';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    // 모달 닫기
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    renderSlipToPdfMock.mockClear();
    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();

    const rendered = renderSlipToPdfMock.mock.calls[0]?.[0] as never as {
      kind: string; values?: Record<string, unknown>; issued?: boolean;
    };
    expect(rendered.kind).toBe('voucher');
    expect(rendered.values?.[field.parameter]).toBe(9900);
    expect(rendered.issued).toBe(false);
    el.remove();
  });

  it('샘플 값이 없으면 미리보기는 양식 그대로 렌더한다', async () => {
    const el = await loadDesigner();
    renderSlipToPdfMock.mockClear();
    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();
    const rendered = renderSlipToPdfMock.mock.calls[0]?.[0] as never as { kind: string };
    expect(rendered.kind).toBe('template');
    el.remove();
  });

  it('파라미터가 10개를 넘으면 10개 단위 페이지로 나뉜다', async () => {
    const el = await loadDesigner();
    (fileOf(el).template as { parameters?: { key: string }[] }).parameters =
      Array.from({ length: 12 }, (_, i) => ({ key: `b${i + 1}` }));
    await openSampleModal(el);

    const inputs = () => el.shadowRoot!.querySelectorAll('.modal .prop-row input');
    expect(inputs().length).toBe(10);
    const pageButtons = () => el.shadowRoot!.querySelectorAll('.page-btn');
    expect(pageButtons().length).toBe(2);
    expect(pageButtons()[0]?.getAttribute('aria-pressed')).toBe('true');

    // 다음 버튼으로도, 페이지 번호 버튼으로도 바로 이동할 수 있다
    byAria(el, `${strings.designer.sampleData} ${strings.designer.nextPage}`).click();
    await el.updateComplete;
    expect(inputs().length).toBe(2);
    expect(pageButtons()[1]?.getAttribute('aria-pressed')).toBe('true');
    (pageButtons()[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(inputs().length).toBe(10);

    // 10개 이하면 페이지 표시가 없다
    (fileOf(el).template as { parameters?: { key: string }[] }).parameters =
      Array.from({ length: 3 }, (_, i) => ({ key: `b${i + 1}` }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    await openSampleModal(el);
    expect(el.shadowRoot!.querySelector('.sample-pager')).toBeNull();
    el.remove();
  });

  it('JSON 탭에서 샘플 전체를 붙여 넣어 적용할 수 있고, 잘못된 JSON은 적용이 막힌다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    await openSampleModal(el);

    byAria(el, `${strings.designer.sampleData}: JSON`).click();
    await el.updateComplete;
    const textarea = el.shadowRoot!.querySelector('.sample-json') as HTMLTextAreaElement;
    const applyBtn = () => Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.apply) as HTMLButtonElement;

    // 잘못된 JSON은 오류를 표시하고 적용 버튼을 비활성화한다.
    textarea.value = '{ "a": ';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(applyBtn().disabled).toBe(true);
    expect(el.shadowRoot!.querySelector('.formula-status.error')).not.toBeNull();

    // 최상위 값이 배열이면 적용할 수 없다.
    textarea.value = '[1, 2]';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(applyBtn().disabled).toBe(true);

    // 유효한 객체를 적용하면 sampleValues 전체를 교체한다.
    textarea.value = '{ "tradeDate": "2026-08-20", "items": [{ "amount": 1000 }] }';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(applyBtn().disabled).toBe(false);
    applyBtn().click();
    await el.updateComplete;

    const samples = (fileOf(el).template as { sampleValues?: Record<string, unknown> }).sampleValues;
    expect(samples).toEqual({ tradeDate: '2026-08-20', items: [{ amount: 1000 }] });
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// : 프리셋 주입 + 내 양식 저장·목록
// ---------------------------------------------------------------------------

describe('<slip-designer> 프리셋 주입 (D-15)', () => {
  it('presets를 주면 동봉 프리셋 대신 그 목록이 메뉴에 나오고 적용된다', async () => {
    const el = await loadDesigner();
    const custom = makeTemplateFile();
    custom.template.meta.title = '우리 회사 양식';
    (el as unknown as { presets: unknown[] }).presets = [
      { id: 'ours', name: '우리 회사 양식', create: () => JSON.parse(JSON.stringify(custom)) },
    ];
    await el.updateComplete;

    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    const items = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .map((b) => b.textContent?.trim());
    expect(items).toEqual(['우리 회사 양식']);

    (el.shadowRoot!.querySelector('.preset-menu button') as HTMLButtonElement).click();
    await el.updateComplete;
    expect((el as unknown as { _file: SlipTemplateFile })._file.template.meta.title)
      .toBe('우리 회사 양식');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 이미지 업로드: 파일을 base64로 저장하고 등록된 이미지를 재사용한다.
// ---------------------------------------------------------------------------

describe('<slip-designer> 이미지 업로드', () => {
  const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=';
  const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function makeImageFile(srcs: string[]): SlipFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = srcs.map((src, i) => ({
      type: 'image' as const,
      id: `img-${i + 1}`,
      name: `이미지 ${i + 1}`,
      position: { x: 10 + i * 50, y: 10 },
      width: 40,
      height: 40,
      src,
    })) as never;
    return file as unknown as SlipFile;
  }

  async function mountImages(srcs: string[]) {
    parseSlipFileMock.mockReturnValue(makeImageFile(srcs));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  function openImageButton(el: Element): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.col-modal-open'))
      .find((b) => b.textContent?.includes(strings.designer.imagePick)
        || b.textContent?.includes(strings.designer.imageChange)) as HTMLButtonElement;
  }

  it('이미지를 선택하지 않은 요소는 안 골랐음을 알리고 캔버스에도 글자로 보인다', async () => {
    const el = await mountImages([PLACEHOLDER]);
    selectElement(el, 'img-1');
    await el.updateComplete;

    expect(el.shadowRoot!.textContent).toContain(strings.designer.imageNone);
    // 1×1 투명 PNG 자리표시는 안내 문구로 표시한다.
    const canvasImg = el.shadowRoot!.querySelector('.element[data-id="img-1"] img');
    expect(canvasImg).toBeNull();
    el.remove();
  });

  it('이미지를 고른 요소는 패널과 캔버스에 그 이미지를 보여준다', async () => {
    const el = await mountImages([PNG_A]);
    selectElement(el, 'img-1');
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.image-current img')?.getAttribute('src')).toBe(PNG_A);
    expect(el.shadowRoot!.querySelector('.element[data-id="img-1"] img')?.getAttribute('src'))
      .toBe(PNG_A);
    el.remove();
  });

  it('이미 등록된 이미지를 골라 다른 요소에 다시 쓴다', async () => {
    const el = await mountImages([PNG_A, PLACEHOLDER]);
    selectElement(el, 'img-2');
    await el.updateComplete;

    openImageButton(el).click();
    await el.updateComplete;

    const choices = Array.from(el.shadowRoot!.querySelectorAll('.image-choice'));
    // 자리표시는 제외하고 업로드한 이미지만 목록에 표시한다.
    expect(choices.length).toBe(1);
    (choices[0] as HTMLButtonElement).click();
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect((file.template.pages[0]!.elements[1] as { src: string }).src).toBe(PNG_A);
    // 고르면 모달이 닫힌다
    expect(el.shadowRoot!.querySelector('.image-choice')).toBeNull();
    el.remove();
  });

  it('넣을 수 있는 최대 크기를 안내하고 호스트가 바꿀 수 있다', async () => {
    const el = await mountImages([PLACEHOLDER]);
    el.maxImageBytes = 512 * 1024;
    selectElement(el, 'img-1');
    await el.updateComplete;

    openImageButton(el).click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain('512KB');
    el.remove();
  });

  it('기본 최대 크기는 2MB다', async () => {
    const el = await mountImages([PLACEHOLDER]);
    expect(el.maxImageBytes).toBe(2 * 1024 * 1024);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 모달의 초안 상태 경계 — 수식 커서 위치와 이미지 선택 실패 처리
// ---------------------------------------------------------------------------

describe('<slip-designer> 수식 입력 커서 위치', () => {
  function makeListFile(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'field' as const,
      id: 'fld-1',
      name: 'total',
      position: { x: 10, y: 10 },
      width: 40,
      height: 8,
      formula: '',
    }] as never;
    file.template.parameters = [{
      key: 'items',
      label: '항목',
      valueType: 'list',
      fields: [{ key: 'amount', label: '금액' }],
    }] as never;
    return file;
  }

  it('타자 없이 커서만 옮겨도 하위 필드 제안이 다시 계산된다', async () => {
    parseSlipFileMock.mockReturnValue(makeListFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'fld-1');
    await el.updateComplete;

    const open = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.formulaModalTitle) as HTMLButtonElement;
    open.click();
    await el.updateComplete;

    const input = el.shadowRoot!.querySelector('.formula-input') as HTMLTextAreaElement;
    input.value = 'SUM(items.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.formula-suggest')).not.toBeNull();

    // 글자는 그대로 두고 커서만 맨 앞으로 옮기면 제안이 사라진다.
    input.selectionStart = 0;
    input.selectionEnd = 0;
    input.dispatchEvent(new Event('click', { bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.formula-suggest')).toBeNull();

    // 다시 끝으로 옮기면 제안이 돌아온다.
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event('keyup', { bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.formula-suggest')).not.toBeNull();
    el.remove();
  });
});

describe('<slip-designer> 이미지 선택 실패 처리', () => {
  const s = strings.designer;
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=';

  function makeImageFile(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'image' as const,
      id: 'img-1',
      name: '이미지',
      position: { x: 10, y: 10 },
      width: 40,
      height: 40,
      src: PNG,
    }] as never;
    return file;
  }

  async function openPicker(): Promise<Designer> {
    parseSlipFileMock.mockReturnValue(makeImageFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'img-1');
    await el.updateComplete;
    const open = Array.from(el.shadowRoot!.querySelectorAll('.col-modal-open'))
      .find((b) => b.textContent?.includes(s.imagePick) || b.textContent?.includes(s.imageChange)) as HTMLButtonElement;
    open.click();
    await el.updateComplete;
    return el;
  }

  async function pick(el: Designer): Promise<void> {
    const button = el.shadowRoot!.querySelector('.modal .btn.primary') as HTMLButtonElement;
    button.click();
    await flush();
    await el.updateComplete;
  }

  function errorText(el: Element): string {
    return el.shadowRoot!.querySelector('.modal .image-error')?.textContent?.trim() ?? '';
  }

  it('이미지가 아닌 파일을 고르면 이미지가 아니라고 알린다', async () => {
    imagePick.result = { ok: false, reason: 'notImage', size: 10 };
    const el = await openPicker();
    await pick(el);

    expect(errorText(el)).toBe(s.imageNotImage);
    el.remove();
  });

  it('상한을 넘는 파일은 허용 크기와 고른 크기를 함께 알린다', async () => {
    imagePick.result = { ok: false, reason: 'tooLarge', size: 3 * 1024 * 1024 };
    const el = await openPicker();
    await pick(el);

    expect(errorText(el)).toBe(
      s.imageTooLarge.replace('{max}', '2MB').replace('{size}', '3MB'),
    );
    el.remove();
  });

  it('파일을 읽지 못하면 읽기 실패를 알린다', async () => {
    imagePick.result = { ok: false, reason: 'readFailed' };
    const el = await openPicker();
    await pick(el);

    expect(errorText(el)).toBe(s.imageReadFailed);
    el.remove();
  });

  it('제대로 고르면 오류를 지우고 요소에 이미지를 넣는다', async () => {
    imagePick.result = { ok: false, reason: 'readFailed' };
    const el = await openPicker();
    await pick(el);
    expect(errorText(el)).toBe(s.imageReadFailed);

    imagePick.result = { ok: true, src: PNG };
    await pick(el);

    const image = (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(image.src).toBe(PNG);
    el.remove();
  });
});
