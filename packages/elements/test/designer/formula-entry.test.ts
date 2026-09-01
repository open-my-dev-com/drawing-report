// @vitest-environment happy-dom
// 수식 모달 진입점 4곳 — 필드·바코드·그리드 셀·조건부 서식
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  // 모달 조작만 확인하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () => Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  flush,
  selectElement,
  openValuesTab,
} from './helpers.js';
import type { Designer } from './helpers.js';
import { dialogsStyles } from '../../src/styles/designer/dialogs.styles.js';

installDesignerTestEnv();

const s = strings.designer;

const SAMPLE_ITEMS = [
  { category: '가', itemName: '연필', amount: 100 },
  { category: '가', itemName: '지우개', amount: 200 },
  { category: '나', itemName: '공책', amount: 400 },
  { category: '나', itemName: '자', amount: 800 },
];

/** 페이지당 2개씩 내는 그룹 반복 그리드 */
function makeGrid(): Record<string, unknown> {
  return {
    type: 'grid', id: 'g1', name: '품목 표', position: { x: 10, y: 10 },
    rows: [{ height: 8 }, { height: 8 }],
    columns: [{ width: 100 }, { width: 60 }],
    repeat: {
      parameter: 'items',
      bands: [
        { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
        { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
      ],
      pagination: { mode: 'fixed', itemsPerPage: 2 },
      groupBy: ['category'],
    },
    cells: [
      { row: 0, column: 0, content: '품명' },
      { row: 0, column: 1, formula: '"금액"' },
      { row: 1, column: 0, parameter: 'itemName' },
      { row: 1, column: 1, formula: 'SUM(@page.amount)' },
    ],
  };
}

async function mountFile(
  elements: unknown[],
  sampleValues?: Record<string, unknown>,
): Promise<Designer> {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements = elements as never;
  if (sampleValues) file.template.sampleValues = sampleValues as never;
  parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
  const el = await createElement();
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

function fileOf(el: Designer): SlipTemplateFile {
  return (el as unknown as { _file: SlipTemplateFile })._file;
}

function elementsOf(el: Designer): Record<string, unknown>[] {
  return fileOf(el).template.pages[0]!.elements as unknown as Record<string, unknown>[];
}

/** 선택한 셀을 바꿉니다 */
function selectCell(el: Designer, cell: { row: number; column: number }): void {
  (el as unknown as { _gridEdit: { selectCell(c: { row: number; column: number }): void } })
    ._gridEdit.selectCell(cell);
}

function modal(el: Designer): HTMLElement | null {
  return el.shadowRoot!.querySelector('.formula-modal');
}

function formulaInput(el: Designer): HTMLTextAreaElement {
  return el.shadowRoot!.querySelector('.formula-input') as HTMLTextAreaElement;
}

function status(el: Designer): HTMLElement {
  return el.shadowRoot!.querySelector('#formula-status') as HTMLElement;
}

/** 검사 결과의 상태 제목 */
function statusTitle(el: Designer): string {
  return status(el).querySelector('.formula-status-title')!.textContent!.trim();
}

/** 검사 결과의 내용 — 결과 값이나 그렇게 판정한 까닭 */
function statusText(el: Designer): string {
  return status(el).querySelector('.formula-status-text')!.textContent!.trim();
}

function setDraft(el: Designer, value: string): void {
  const input = formulaInput(el);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function footButton(el: Designer, label: string): HTMLButtonElement {
  return Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
}

/** 수식 모달을 여는 버튼들 — 아이콘 버튼이라 aria-label로 찾습니다 */
function openButtons(el: Designer): HTMLButtonElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.row-btn'))
    .filter((b) => b.getAttribute('aria-label')?.includes(s.formulaModalTitle));
}

/** 첫 번째 수식 모달 버튼을 눌러 모달을 엽니다 */
async function openModal(el: Designer, index = 0): Promise<HTMLButtonElement> {
  const button = openButtons(el)[index]!;
  button.focus();
  button.click();
  await el.updateComplete;
  return button;
}

/** 「값과 범위」 탭의 반복 데이터 범위 줄 */
function reservedRows(el: Designer): HTMLButtonElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.reserved-list .value-row'));
}

/** 반복 데이터 범위 줄을 코드 이름으로 찾을 수 있게 모읍니다 */
function reservedByCode(el: Designer): Map<string, HTMLButtonElement> {
  return new Map(reservedRows(el)
    .map((b) => [b.querySelector('.value-code')!.textContent!.trim(), b]));
}

/** 모든 줄이 같은 이유로 막혔을 때 한 번만 적는 안내. 없으면 null */
function reservedNotice(el: Designer): string | null {
  const list = el.shadowRoot!.querySelector('.reserved-list');
  const notice = list?.previousElementSibling;
  return notice?.classList.contains('image-hint') === true
    ? notice.textContent!.trim()
    : null;
}

// 떼지 않은 디자이너가 남으면 다음 시험의 렌더링을 방해합니다.
afterEach(() => {
  for (const el of Array.from(document.body.querySelectorAll('slip-designer'))) el.remove();
});

describe('<slip-designer> 수식 모달 진입점', () => {
  it('필드 요소의 수식을 모달에서 고쳐 저장한다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;

    await openModal(el);
    expect(formulaInput(el).value).toBe('1 + 1');
    expect(el.shadowRoot!.querySelector('.formula-target-name')?.textContent)
      .toContain('합계');

    setDraft(el, 'ROUND(1.5) + 1');
    await el.updateComplete;
    expect(statusTitle(el)).toBe(s.previewResult);
    expect(statusText(el)).toBe('3');

    footButton(el, s.apply).click();
    await el.updateComplete;
    expect(elementsOf(el)[0]!.formula).toBe('ROUND(1.5) + 1');
    expect(modal(el)).toBeNull();
  });

  it('필드 수식은 비워서 적용할 수 없다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);

    setDraft(el, '   ');
    await el.updateComplete;
    expect(statusTitle(el)).toBe(s.formulaStatusError);
    expect(statusText(el)).toBe(s.formulaRequired);
    expect(footButton(el, s.apply).disabled).toBe(true);
  });

  it('인라인 수식 입력도 모달과 같은 검사를 거친다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });
    const input = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((row) => row.querySelector('label')?.textContent?.trim() === s.formula)!
      .querySelector('input') as HTMLInputElement;
    input.value = 'SUM(1,';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(changed).toBe(false);
    expect(elementsOf(el)[0]!.formula).toBe('1 + 1');
    expect(el.shadowRoot!.querySelector('.input-error')?.textContent).toContain(s.syntaxError);
  });

  it('참조가 없는데 계산되지 않는 수식은 인라인 입력에서도 저장되지 않는다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });
    const input = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((row) => row.querySelector('label')?.textContent?.trim() === s.formula)!
      .querySelector('input') as HTMLInputElement;

    for (const source of ['1 / 0', 'FORMAT_NUMBER(1, 21)', 'MID("abc", 0, 1)', 'DATE_ADD("not-a-date", 1)']) {
      input.value = source;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      expect(changed, source).toBe(false);
      expect(elementsOf(el)[0]!.formula, source).toBe('1 + 1');
      expect(el.shadowRoot!.querySelector('.input-error')?.textContent, source)
        .toContain(s.formulaError);
    }
  });

  it('바코드 요소의 수식을 모달에서 고쳐 저장한다', async () => {
    const el = await mountFile([{
      type: 'barcode', id: 'b1', name: '코드', position: { x: 10, y: 10 },
      width: 40, height: 20, kind: 'code128', formula: '"A"',
    }]);
    selectElement(el, 'b1');
    await el.updateComplete;

    await openModal(el);
    setDraft(el, 'CONCAT("A", "B")');
    await el.updateComplete;
    footButton(el, s.apply).click();
    await el.updateComplete;
    expect(elementsOf(el)[0]!.formula).toBe('CONCAT("A", "B")');
  });

  it('그리드 셀의 수식을 모달에서 고쳐 저장하고, 비우면 수식을 지운다', async () => {
    const el = await mountFile([makeGrid()], { items: SAMPLE_ITEMS });
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;

    await openModal(el);
    expect(formulaInput(el).value).toBe('SUM(@page.amount)');
    setDraft(el, 'SUM(@group.amount)');
    await el.updateComplete;
    footButton(el, s.apply).click();
    await el.updateComplete;
    const cells = elementsOf(el)[0]!.cells as Record<string, unknown>[];
    expect(cells[3]!.formula).toBe('SUM(@group.amount)');

    // 셀 수식은 비워서 적용하면 값 소스가 사라집니다.
    await openModal(el);
    setDraft(el, '   ');
    await el.updateComplete;
    expect(statusTitle(el)).toBe(s.formulaStatusUnavailable);
    expect(statusText(el)).toBe(s.formulaCellEmptyHint);
    footButton(el, s.apply).click();
    await el.updateComplete;
    expect((elementsOf(el)[0]!.cells as Record<string, unknown>[])[3]!.formula).toBeUndefined();
  });

  it('요소 조건부 서식의 조건식을 모달에서 고쳐 저장한다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: '제목', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    selectElement(el, 't1');
    await el.updateComplete;

    await openModal(el);
    expect(el.shadowRoot!.querySelector('.formula-target-name')?.textContent)
      .toContain(s.formulaConditionAt.replace('{index}', '1'));

    setDraft(el, 'FALSE');
    await el.updateComplete;
    footButton(el, s.apply).click();
    await el.updateComplete;
    const rules = elementsOf(el)[0]!.conditionalFormats as Record<string, unknown>[];
    expect(rules[0]!.condition).toBe('FALSE');
  });

  it('그리드 셀 조건부 서식의 조건식을 모달에서 고쳐 저장한다', async () => {
    const grid = makeGrid();
    (grid.cells as Record<string, unknown>[])[3]!.conditionalFormats =
      [{ condition: 'TRUE', fontColor: '#FF0000' }];
    const el = await mountFile([grid], { items: SAMPLE_ITEMS });
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;

    // 셀 수식 버튼 다음이 조건부 서식 규칙 버튼입니다.
    await openModal(el, 1);
    setDraft(el, 'amount > 100');
    await el.updateComplete;
    footButton(el, s.apply).click();
    await el.updateComplete;
    const cells = elementsOf(el)[0]!.cells as Record<string, unknown>[];
    expect((cells[3]!.conditionalFormats as Record<string, unknown>[])[0]!.condition)
      .toBe('amount > 100');
  });

  it('모달을 연 뒤 대상이 사라지면 적용을 막고 모달과 초안을 남긴다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);
    setDraft(el, '2 + 2');
    await el.updateComplete;

    // 모달이 열린 채로 대상 요소를 지웁니다.
    elementsOf(el).length = 0;
    el.requestUpdate();
    await el.updateComplete;

    expect(statusText(el)).toBe(s.formulaTargetChanged);
    expect(footButton(el, s.apply).disabled).toBe(true);
    footButton(el, s.apply).click();
    await el.updateComplete;
    // 초안을 잃지 않도록 모달을 그대로 둡니다.
    expect(modal(el)).not.toBeNull();
    expect(formulaInput(el).value).toBe('2 + 2');
  });

  it('모달 밖에서 원래 수식이 바뀌면 그 자리에서 적용을 막는다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);
    setDraft(el, '2 + 2');
    await el.updateComplete;
    expect(footButton(el, s.apply).disabled).toBe(false);

    // 되돌리기 등 모달 밖의 경로로 대상의 수식이 바뀐 상황입니다.
    elementsOf(el)[0]!.formula = '9 + 9';
    el.requestUpdate();
    await el.updateComplete;

    expect(statusText(el)).toBe(s.formulaTargetChanged);
    expect(footButton(el, s.apply).disabled).toBe(true);
    footButton(el, s.apply).click();
    await el.updateComplete;
    expect(modal(el)).not.toBeNull();
    expect(formulaInput(el).value).toBe('2 + 2');
    expect(elementsOf(el)[0]!.formula).toBe('9 + 9');
  });

  it('조건부 서식 규칙의 색이 바뀌거나 순서가 밀리면 적용을 막는다', async () => {
    const rules = () => elementsOf(el)[0]!.conditionalFormats as Record<string, unknown>[];
    const el = await mountFile([{
      type: 'text', id: 't1', name: '제목', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [
        { condition: 'TRUE', fontColor: '#FF0000' },
        { condition: 'FALSE', fontColor: '#0000FF' },
      ],
    }]);
    selectElement(el, 't1');
    await el.updateComplete;

    // 첫 규칙의 조건식을 편집하는 중에 그 규칙의 색만 바뀌면 다른 규칙으로 봅니다.
    await openModal(el, 0);
    setDraft(el, 'FALSE');
    await el.updateComplete;
    rules()[0]!.fontColor = '#00FF00';
    el.requestUpdate();
    await el.updateComplete;
    expect(statusText(el)).toBe(s.formulaTargetChanged);
    expect(footButton(el, s.apply).disabled).toBe(true);
    footButton(el, s.cancel).click();
    await el.updateComplete;

    // 순서가 밀려 같은 순번에 다른 규칙이 오면 덮어쓰지 않습니다.
    rules()[0]!.fontColor = '#FF0000';
    el.requestUpdate();
    await el.updateComplete;
    await openModal(el, 0);
    setDraft(el, 'FALSE');
    await el.updateComplete;
    rules().reverse();
    el.requestUpdate();
    await el.updateComplete;
    expect(statusText(el)).toBe(s.formulaTargetChanged);
    footButton(el, s.apply).click();
    await el.updateComplete;
    expect(modal(el)).not.toBeNull();
    expect(rules().map((r) => r.condition)).toEqual(['FALSE', 'TRUE']);
  });

  it('문법 오류, 계산 불가와 논리값 아님을 구분해 안내한다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: '제목', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    selectElement(el, 't1');
    await el.updateComplete;
    await openModal(el);

    setDraft(el, 'SUM(1,');
    await el.updateComplete;
    expect(statusText(el)).toContain(s.syntaxError);
    expect(footButton(el, s.apply).disabled).toBe(true);

    // 조건식이 아닌 자리에서는 막지 않는 값이지만 조건식은 논리값이어야 합니다.
    setDraft(el, '1 + 1');
    await el.updateComplete;
    expect(statusText(el)).toBe(s.conditionNotBoolean);
    expect(footButton(el, s.apply).disabled).toBe(true);

    // 지금 자리에 없는 예약 참조는 실제 전표에서 계산될 수 있어 적용을 허용합니다.
    setDraft(el, 'SUM(@page.amount) > 0');
    await el.updateComplete;
    expect(statusText(el)).toContain(s.previewUnavailable);
    // 왜 계산되지 않았는지는 안내 뒤에 괄호로 덧붙입니다.
    expect(statusText(el)).toMatch(/\(.+\)/);
    expect(status(el).classList.contains('notice')).toBe(true);
    expect(footButton(el, s.apply).disabled).toBe(false);

    // 참조가 없으면 값이 달라져도 같은 오류라 적용을 막습니다.
    setDraft(el, '1 / 0 > 0');
    await el.updateComplete;
    expect(statusText(el)).toContain(s.formulaError);
    expect(status(el).classList.contains('error')).toBe(true);
    expect(footButton(el, s.apply).disabled).toBe(true);
  });

  it('샘플 항목을 바꾸면 출력 페이지와 계산 결과가 함께 바뀐다', async () => {
    const el = await mountFile([makeGrid()], { items: SAMPLE_ITEMS });
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;
    await openModal(el);

    const itemNo = (): HTMLInputElement =>
      el.shadowRoot!.querySelector('.formula-item-no') as HTMLInputElement;
    const where = (): string =>
      el.shadowRoot!.querySelector('.formula-item-where')!.textContent!.trim();

    expect(itemNo().value).toBe('1');
    expect(el.shadowRoot!.querySelector('.formula-item-total')?.textContent).toContain('4');
    expect(where()).toContain(s.formulaOutputPageAt.replace('{page}', '1'));
    expect(statusText(el)).toBe('300');

    // 번호를 직접 적어 다른 출력 페이지의 항목으로 옮깁니다.
    itemNo().value = '3';
    itemNo().dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(where()).toContain(s.formulaOutputPageAt.replace('{page}', '2'));
    expect(statusText(el)).toBe('1200');

    // 다음 항목 버튼으로도 옮길 수 있고, 끝에서는 더 갈 수 없습니다.
    const next = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.formula-items .row-btn'))
      .find((b) => b.getAttribute('aria-label') === s.formulaNextItem)!;
    next.click();
    await el.updateComplete;
    expect(itemNo().value).toBe('4');
    expect(next.disabled).toBe(true);
  });

  it('항목 번호에 빈 값·소수·범위 밖 값을 넣어도 실제 항목으로 맞춘다', async () => {
    const el = await mountFile([makeGrid()], { items: SAMPLE_ITEMS });
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;
    await openModal(el);

    const itemNo = (): HTMLInputElement =>
      el.shadowRoot!.querySelector('.formula-item-no') as HTMLInputElement;
    const where = (): string =>
      el.shadowRoot!.querySelector('.formula-item-where')!.textContent!.trim();
    const type = async (value: string): Promise<void> => {
      itemNo().value = value;
      itemNo().dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
    };

    // 범위를 넘으면 마지막 항목으로 맞추고 입력란 표시도 함께 고칩니다.
    await type('999');
    expect(itemNo().value).toBe('4');
    expect(where()).toContain(s.formulaItemAt.replace('{index}', '4'));

    // 이미 마지막 항목이라 선택이 그대로여도 입력란은 어긋난 채 남지 않습니다.
    await type('999');
    expect(itemNo().value).toBe('4');

    await type('0');
    expect(itemNo().value).toBe('1');
    await type('2.4');
    expect(itemNo().value).toBe('2');
    expect(where()).toContain(s.formulaItemAt.replace('{index}', '2'));
  });

  it('항목 번호를 비우거나 숫자가 아닌 값을 넣으면 고른 항목을 유지한다', async () => {
    const el = await mountFile([makeGrid()], { items: SAMPLE_ITEMS });
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;
    await openModal(el);

    const itemNo = (): HTMLInputElement =>
      el.shadowRoot!.querySelector('.formula-item-no') as HTMLInputElement;
    const type = async (value: string): Promise<void> => {
      itemNo().value = value;
      itemNo().dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
    };

    // 마지막 항목으로 옮긴 뒤 지워도 첫 항목으로 되돌아가지 않아야 합니다.
    await type('4');
    expect(statusText(el)).toBe('1200');
    await type('');
    expect(itemNo().value).toBe('4');
    expect(statusText(el)).toBe('1200');
    await type('   ');
    expect(itemNo().value).toBe('4');
    expect(statusText(el)).toBe('1200');
  });

  it('샘플 항목이 많아도 선택 조작부 수는 늘지 않는다', async () => {
    const many = Array.from({ length: 500 }, (_row, i) => ({
      category: i < 250 ? '가' : '나', itemName: `품목 ${i}`, amount: i,
    }));
    const el = await mountFile([makeGrid()], { items: many });
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;
    await openModal(el);

    // 번호 입력과 이전·다음 버튼만 둡니다 — 항목마다 버튼을 만들지 않습니다.
    expect(el.shadowRoot!.querySelectorAll('.formula-items .row-btn').length).toBe(2);
    expect(el.shadowRoot!.querySelectorAll('.formula-item-no').length).toBe(1);
    expect(el.shadowRoot!.querySelector('.formula-item-total')?.textContent).toContain('500');
  });

  it('쓸 수 없는 예약 참조는 이유와 함께 비활성으로 표시한다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);
    await openValuesTab(el);
    // 반복 그리드가 아니어도 목록에는 두고 왜 쓸 수 없는지 알려 줍니다.
    const notRepeat = reservedRows(el);
    expect(notRepeat.map((b) => b.querySelector('.value-code')?.textContent?.trim()))
      .toEqual(['@item', '@group', '@page', '@all', '@carried']);
    // 코드 이름만으로는 뜻을 알 수 없으므로 사용자 이름을 함께 적습니다.
    expect(notRepeat.map((b) => b.querySelector('.value-name')?.textContent?.trim()))
      .toEqual([
        s.formulaReservedItem, s.formulaReservedGroup, s.formulaReservedPage,
        s.formulaReservedAll, s.formulaReservedCarried,
      ]);
    expect(notRepeat.every((b) => b.disabled)).toBe(true);
    // 모두 같은 이유로 막혔으므로 이유는 한 번만 적습니다.
    expect(notRepeat.some((b) => b.querySelector('.value-reason') !== null)).toBe(false);
    expect(reservedNotice(el)).toBe(s.reservedNeedRepeat);
    el.remove();

    const grid = await mountFile([makeGrid()], { items: SAMPLE_ITEMS });
    selectElement(grid, 'g1');
    selectCell(grid, { row: 0, column: 1 });
    await grid.updateComplete;
    await openModal(grid);
    await openValuesTab(grid);

    const reserved = reservedByCode(grid);
    // 헤더 행 구간에는 항목이 없습니다.
    expect(reserved.get('@item')!.disabled).toBe(true);
    expect(reserved.get('@item')!.querySelector('.value-reason')?.textContent?.trim())
      .toBe(s.reservedNoItem);
    expect(reserved.get('@page')!.disabled).toBe(false);
    // 막힌 이유가 서로 다르면 한 번만 적을 수 없으므로 줄마다 적습니다.
    expect(reservedNotice(grid)).toBeNull();
  });

  it('정적 그리드 셀에서도 예약 참조를 이유와 함께 비활성으로 보여 준다', async () => {
    const grid = makeGrid();
    delete grid.repeat;
    (grid.cells as Record<string, unknown>[])[3]!.formula = '1 + 1';
    const el = await mountFile([grid]);
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;
    await openModal(el);
    await openValuesTab(el);

    const reserved = reservedRows(el);
    expect(reserved).toHaveLength(5);
    expect(reserved.every((b) => b.disabled)).toBe(true);
    expect(reservedNotice(el)).toBe(s.reservedNeedRepeat);
  });

  it('샘플 항목이 없어도 계획이 주는 예약 참조는 그대로 쓴다', async () => {
    // 반복 그리드지만 샘플 값이 없는 상태입니다.
    const grid = makeGrid();
    (grid.cells as Record<string, unknown>[])[3]!.formula = 'COUNT(@all)';
    const el = await mountFile([grid]);
    selectElement(el, 'g1');
    selectCell(el, { row: 1, column: 1 });
    await el.updateComplete;
    await openModal(el);

    // 항목이 0개여도 `@all`은 빈 목록으로 계산됩니다.
    expect(statusText(el)).toBe('0');
    await openValuesTab(el);
    const reserved = reservedByCode(el);
    expect(reserved.get('@all')!.disabled).toBe(false);
    expect(reserved.get('@item')!.disabled).toBe(true);
    expect(reserved.get('@item')!.querySelector('.value-reason')?.textContent?.trim())
      .toBe(s.reservedNoItem);
    // 고를 항목이 없으므로 선택 자리는 두지 않습니다.
    expect(el.shadowRoot!.querySelector('.formula-item-no')).toBeNull();
  });

  it('참조 영역을 함수와 값 두 탭으로 나누고 한 번에 한쪽만 보여 준다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);

    const tabs = (): HTMLButtonElement[] =>
      Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.formula-tab'));
    expect(tabs().map((b) => b.textContent?.trim()))
      .toEqual([s.formulaFunctionsTab, s.formulaValuesTab]);

    // 수식을 쓸 때 먼저 찾는 것이 함수라 함수 탭에서 시작합니다.
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(el.shadowRoot!.querySelectorAll('.fn-row').length).toBeGreaterThan(0);
    expect(el.shadowRoot!.querySelector('.reserved-list')).toBeNull();

    await openValuesTab(el);
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(el.shadowRoot!.querySelector('.reserved-list')).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll('.fn-row').length).toBe(0);
  });

  it('모달 안 탭과 주요 버튼을 디자이너의 다른 화면과 같게 쓴다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);

    // 샘플 데이터 모달과 같은 공통 탭 모양을 씁니다.
    expect(el.shadowRoot!.querySelector('.modal-tabs .formula-tab')).not.toBeNull();
    expect(dialogsStyles.cssText).toContain('.modal-tabs button[aria-selected=\'true\']');

    // 탭 이름이 이미 「함수」이므로 목록 위에 같은 제목을 다시 두지 않습니다.
    expect(el.shadowRoot!.querySelector('.fn-browse .modal-section-title')).toBeNull();

    // 최종 저장인 「적용」만 주요 동작으로 강조합니다.
    const primary = Array.from(el.shadowRoot!.querySelectorAll('.formula-modal .btn.primary'));
    expect(primary.map((b) => b.textContent?.trim())).toEqual([s.apply]);

    // 고른 함수는 잠깐 지나가는 hover와 달리 표시선과 강조색으로 남습니다.
    Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.fn-row'))
      .find((b) => b.getAttribute('aria-label') === 'SUM')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.fn-row.selected')?.getAttribute('aria-label')).toBe('SUM');
    expect(el.shadowRoot!.querySelectorAll('.fn-insert')).toHaveLength(1);
    const selected = dialogsStyles.cssText.slice(dialogsStyles.cssText.indexOf('.fn-row.selected'));
    expect(selected).toContain('box-shadow: inset 2px 0 var(--sk-accent);');
  });

  it('함수를 이름과 로케일 설명으로 찾고, 분류와 검색어를 함께 적용한다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);

    const search = el.shadowRoot!.querySelector('.formula-search') as HTMLInputElement;
    const names = (): string[] => Array.from(el.shadowRoot!.querySelectorAll('.fn-row'))
      .map((b) => b.getAttribute('aria-label')!);

    const type = async (value: string): Promise<void> => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;
    };

    // 이름 검색은 대소문자를 가리지 않습니다.
    await type('CountIf');
    expect(names()).toEqual(['COUNTIF']);

    // 이름에 없는 말이라도 현재 로케일의 설명에서 찾습니다.
    await type('absolute');
    expect(names()).toEqual(['ABS']);

    // 분류를 고르면 검색어와 함께 좁힙니다.
    const chips = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.fn-chip'));
    chips.find((c) => c.textContent?.trim() === 'Aggregation')!.click();
    await el.updateComplete;
    expect(names()).toEqual([]);
    expect(el.shadowRoot!.querySelector('.fn-list .image-hint')?.textContent)
      .toBe(s.formulaSearchEmpty);

    await type('criteria');
    expect(names()).toEqual(['SUMIF', 'COUNTIF']);
  });

  it('선택 범위를 삽입한 글로 바꾸고 커서를 괄호 안에 둔다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);

    setDraft(el, 'ABS(old)');
    await el.updateComplete;
    const input = formulaInput(el);
    input.setSelectionRange(4, 7);

    const abs = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.fn-row'))
      .find((b) => b.getAttribute('aria-label') === 'SUM')!;
    abs.click();
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.fn-insert') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(formulaInput(el).value).toBe('ABS(SUM())');
    // 이어서 인자를 적을 수 있도록 커서를 여는 괄호 뒤에 둡니다.
    expect(formulaInput(el).selectionStart).toBe('ABS(SUM('.length);
  });

  it('취소·Escape·적용 어느 쪽으로 닫아도 연 버튼으로 초점이 돌아온다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;

    const cancel = await openModal(el);
    footButton(el, s.cancel).click();
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(cancel);

    const escape = await openModal(el);
    modal(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(escape);

    const apply = await openModal(el);
    setDraft(el, '2 + 2');
    await el.updateComplete;
    footButton(el, s.apply).click();
    await el.updateComplete;
    expect(modal(el)).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(apply);
  });

  it('헤더와 하단 버튼을 본문 밖에 두고 뷰포트 너비와 무관하게 2단을 유지한다', async () => {
    const el = await mountFile([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 + 1',
    }]);
    selectElement(el, 'f1');
    await el.updateComplete;
    await openModal(el);

    // 본문이 길어져도 제목과 적용 버튼이 밀려나지 않도록 스크롤 영역 밖에 둡니다.
    const children = Array.from(modal(el)!.children).map((c) => c.className);
    expect(children).toEqual(['modal-head', 'formula-layout', 'modal-foot']);
    const layout = el.shadowRoot!.querySelector('.formula-layout')!;
    expect(Array.from(layout.children).map((c) => c.className))
      .toEqual(['formula-editor', 'formula-reference']);

    // 디자이너는 데스크톱 전용이라 너비에 따라 배치를 바꾸지 않습니다.
    const css = dialogsStyles.cssText;
    expect(css).not.toContain('@media');
    expect(css).toContain('grid-template-columns: minmax(0, 42fr) minmax(0, 58fr);');
  });
});
