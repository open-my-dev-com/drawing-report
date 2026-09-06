// @vitest-environment happy-dom
// 수식 모달 배치 — 입력과 검사 결과를 위에, 함수·값 참조를 아래에
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
import { getStrings } from '../../src/strings.js';

installDesignerTestEnv();

const s = strings.designer;

/** 수식을 가진 필드 하나 — 모달 진입점으로 씁니다 */
const FIELD = {
  type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
  width: 40, height: 8, formula: '1 + 1',
};

async function mountFile(options: {
  parameters?: unknown[];
  locale?: string;
} = {}): Promise<Designer> {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements = [FIELD] as never;
  if (options.parameters) file.template.parameters = options.parameters as never;
  parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
  const el = await createElement();
  if (options.locale !== undefined) el.locale = options.locale;
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

function fileOf(el: Designer): SlipTemplateFile {
  return (el as unknown as { _file: SlipTemplateFile })._file;
}

function query<T extends Element>(el: Designer, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function queryAll<T extends Element>(el: Designer, selector: string): T[] {
  return Array.from(el.shadowRoot!.querySelectorAll<T>(selector));
}

function formulaInput(el: Designer): HTMLTextAreaElement {
  return query<HTMLTextAreaElement>(el, '.formula-input')!;
}

function setDraft(el: Designer, value: string): void {
  const input = formulaInput(el);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function footButton(el: Designer, label: string): HTMLButtonElement {
  return queryAll<HTMLButtonElement>(el, '.modal-foot button')
    .find((b) => b.textContent?.trim() === label)!;
}

/** 필드를 고르고 수식 모달을 엽니다 */
async function openModal(el: Designer): Promise<void> {
  selectElement(el, 'f1');
  await el.updateComplete;
  const button = queryAll<HTMLButtonElement>(el, '.row-btn')
    .find((b) => b.getAttribute('aria-label')?.includes(getStrings(el.locale).designer.formulaModalTitle))!;
  button.focus();
  button.click();
  await el.updateComplete;
}

/** 함수 목록에서 이름으로 함수를 골라 상세를 폅니다 */
async function pickFunction(el: Designer, name: string): Promise<void> {
  queryAll<HTMLButtonElement>(el, '.fn-row')
    .find((b) => b.getAttribute('aria-label') === name)!.click();
  await el.updateComplete;
}

/** 함수 목록에 남은 이름 */
function listedNames(el: Designer): string[] {
  return queryAll(el, '.fn-row').map((b) => b.getAttribute('aria-label')!);
}

/** `a`가 `b`보다 문서 순서에서 앞인지 */
function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

// 떼지 않은 디자이너가 남으면 다음 시험의 렌더링을 방해합니다.
afterEach(() => {
  for (const el of Array.from(document.body.querySelectorAll('slip-designer'))) el.remove();
});

describe('<slip-designer> 수식 모달 배치', () => {
  it('입력 영역을 참조 영역 위에 두고 검사 결과는 입력란 바로 아래에 둔다', async () => {
    const el = await mountFile();
    await openModal(el);

    const editor = query(el, '.formula-editor')!;
    const reference = query(el, '.formula-reference')!;
    expect(precedes(editor, reference)).toBe(true);

    // 편집 대상 → 입력란 → 검사 결과 → 안내 순서로, 모두 입력 영역 안에 있습니다.
    const target = query(el, '.formula-target')!;
    const input = formulaInput(el);
    const status = query(el, '#formula-status')!;
    const hint = query(el, '.formula-hint')!;
    for (const node of [target, input, status, hint]) expect(editor.contains(node)).toBe(true);
    expect(precedes(target, input)).toBe(true);
    expect(input.nextElementSibling).toBe(status);
    expect(precedes(status, hint)).toBe(true);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');

    // 탭·검색·목록은 참조 영역에 있고 입력 영역 뒤에 옵니다.
    const tabs = query(el, '.modal-tabs')!;
    expect(reference.contains(tabs)).toBe(true);
    expect(reference.contains(query(el, '.formula-search')!)).toBe(true);
    expect(reference.contains(query(el, '.fn-list')!)).toBe(true);
    expect(precedes(hint, tabs)).toBe(true);
  });

  it('하단 버튼은 참조 영역 밖에 한 번만 두고 취소와 적용을 담는다', async () => {
    const el = await mountFile();
    await openModal(el);

    const feet = queryAll(el, '.formula-modal .modal-foot');
    expect(feet).toHaveLength(1);
    expect(Array.from(feet[0]!.querySelectorAll('button')).map((b) => b.textContent?.trim()))
      .toEqual([s.cancel, s.apply]);
    expect(precedes(query(el, '.formula-reference')!, feet[0]!)).toBe(true);
    expect(query(el, '.formula-layout')!.contains(feet[0]!)).toBe(false);
  });

  it('함수를 고르기 전에는 상세 없이 목록이 참조 영역 전체를 쓰고, 고르면 옆에 상세를 편다', async () => {
    const el = await mountFile();
    await openModal(el);

    const panel = query(el, '.fn-panel')!;
    expect(query(el, '.fn-browse')).not.toBeNull();
    expect(query(el, '.fn-detail')).toBeNull();
    expect(panel.classList.contains('with-detail')).toBe(false);
    expect(Array.from(panel.children).map((c) => c.className)).toEqual(['fn-browse']);

    await pickFunction(el, 'SUM');
    const detail = query(el, '.fn-detail')!;
    expect(detail).not.toBeNull();
    expect(panel.classList.contains('with-detail')).toBe(true);
    expect(Array.from(panel.children).map((c) => c.className)).toEqual(['fn-browse', 'fn-detail']);
    expect(detail.querySelector('.fn-detail-name')?.textContent?.trim()).toBe('SUM');
    // 삽입 버튼은 상세 안에 하나만 둡니다.
    expect(queryAll(el, '.fn-insert')).toHaveLength(1);
    expect(detail.contains(query(el, '.fn-insert')!)).toBe(true);
    // 목록은 상세 옆에 그대로 남습니다.
    expect(query(el, '.fn-list')).not.toBeNull();
    expect(query(el, '.fn-row.selected')?.getAttribute('aria-label')).toBe('SUM');
  });

  it('다른 함수를 골라도 목록 요소를 다시 만들지 않아 스크롤 위치가 남는다', async () => {
    const el = await mountFile();
    await openModal(el);

    const list = query<HTMLElement>(el, '.fn-list')!;
    const browse = query(el, '.fn-browse')!;
    list.scrollTop = 120;
    const scrolled = list.scrollTop;

    await pickFunction(el, 'SUM');
    expect(query(el, '.fn-list')).toBe(list);
    expect(query(el, '.fn-browse')).toBe(browse);
    expect(list.scrollTop).toBe(scrolled);

    await pickFunction(el, 'ABS');
    expect(query(el, '.fn-list')).toBe(list);
    expect(list.scrollTop).toBe(scrolled);
    expect(query(el, '.fn-detail-name')?.textContent?.trim()).toBe('ABS');
    expect(query(el, '.fn-row.selected')?.getAttribute('aria-label')).toBe('ABS');
    expect(queryAll(el, '.fn-detail')).toHaveLength(1);
  });

  it('상세를 펼친 채로도 검색이 목록을 거르고, 고른 함수가 걸러지면 상세를 접는다', async () => {
    const el = await mountFile();
    await openModal(el);
    await pickFunction(el, 'SUM');

    const search = query<HTMLInputElement>(el, '.formula-search')!;
    const type = async (value: string): Promise<void> => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;
    };

    await type('CountIf');
    expect(listedNames(el)).toEqual(['COUNTIF']);
    expect(query(el, '.fn-detail')).toBeNull();
    expect(query(el, '.fn-panel')!.classList.contains('with-detail')).toBe(false);

    await type('sum');
    expect(listedNames(el)).toContain('SUM');
    expect(query(el, '.fn-detail-name')?.textContent?.trim()).toBe('SUM');
    expect(query(el, '.fn-panel')!.classList.contains('with-detail')).toBe(true);
  });

  it('함수를 삽입하면 입력란으로 초점이 돌아가고 커서는 여는 괄호 뒤에 놓인다', async () => {
    const el = await mountFile();
    await openModal(el);

    setDraft(el, 'ABS()');
    await el.updateComplete;
    formulaInput(el).setSelectionRange(4, 4);

    await pickFunction(el, 'SUM');
    query<HTMLButtonElement>(el, '.fn-insert')!.focus();
    query<HTMLButtonElement>(el, '.fn-insert')!.click();
    await el.updateComplete;
    await flush();

    const input = formulaInput(el);
    expect(input.value).toBe('ABS(SUM())');
    expect(input.selectionStart).toBe('ABS(SUM('.length);
    expect(input.selectionEnd).toBe('ABS(SUM('.length);
    expect(el.shadowRoot!.activeElement).toBe(input);
    // 삽입 뒤에도 상세와 목록은 그대로 남습니다.
    expect(query(el, '.fn-detail-name')?.textContent?.trim()).toBe('SUM');
  });

  it('값 참조를 삽입해도 입력란으로 초점이 돌아가고 커서는 참조 뒤에 놓인다', async () => {
    const el = await mountFile({ parameters: [{ key: 'amount', label: '금액' }] });
    await openModal(el);

    setDraft(el, 'ABS()');
    await el.updateComplete;
    formulaInput(el).setSelectionRange(4, 4);

    await openValuesTab(el);
    const row = queryAll<HTMLButtonElement>(el, '.value-row')
      .find((b) => b.querySelector('.value-code')?.textContent?.trim() === '$(amount)')!;
    row.focus();
    row.click();
    await el.updateComplete;
    await flush();

    const input = formulaInput(el);
    expect(input.value).toBe('ABS($(amount))');
    expect(input.selectionStart).toBe('ABS($(amount)'.length);
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it('값 탭의 값·반복 데이터 범위 줄은 배치와 무관하게 그대로다', async () => {
    const el = await mountFile({ parameters: [{ key: 'amount', label: '금액' }] });
    await openModal(el);
    await openValuesTab(el);

    expect(query(el, '.fn-panel')).toBeNull();
    const values = queryAll(el, '.value-list:not(.reserved-list) .value-row');
    expect(values.map((b) => b.querySelector('.value-code')?.textContent?.trim())).toEqual(['$(amount)']);
    const reserved = queryAll<HTMLButtonElement>(el, '.reserved-list .value-row');
    expect(reserved.map((b) => b.querySelector('.value-code')?.textContent?.trim()))
      .toEqual(['@item', '@group', '@page', '@all', '@carried']);
    expect(reserved.every((b) => b.disabled)).toBe(true);
    // 값 탭도 같은 참조 영역 안에 있고 하단 버튼은 그대로 하나입니다.
    expect(query(el, '.formula-reference')!.contains(query(el, '.reserved-list')!)).toBe(true);
    expect(queryAll(el, '.formula-modal .modal-foot')).toHaveLength(1);
  });

  it('오류·적용 상태는 배치와 무관하게 그대로다', async () => {
    const el = await mountFile();
    await openModal(el);

    setDraft(el, 'SUM(1,');
    await el.updateComplete;
    const status = query(el, '#formula-status')!;
    expect(status.classList.contains('error')).toBe(true);
    expect(status.querySelector('.formula-status-title')?.textContent?.trim()).toBe(s.formulaStatusError);
    expect(footButton(el, s.apply).disabled).toBe(true);

    setDraft(el, 'ROUND(1.5) + 1');
    await el.updateComplete;
    expect(status.classList.contains('ok')).toBe(true);
    expect(status.querySelector('.formula-status-text')?.textContent?.trim()).toBe('3');
    expect(footButton(el, s.apply).disabled).toBe(false);

    footButton(el, s.apply).click();
    await el.updateComplete;
    expect(query(el, '.formula-modal')).toBeNull();
    expect((fileOf(el).template.pages[0]!.elements[0] as { formula?: string }).formula).toBe('ROUND(1.5) + 1');
  });

  it('한국어·영어·일본어 어느 로케일로 열어도 빠진 문구가 없다', async () => {
    for (const locale of ['ko', 'en', 'ja']) {
      const el = await mountFile({ locale });
      const t = getStrings(locale).designer;
      await openModal(el);
      await pickFunction(el, 'SUM');

      const modal = query(el, '.formula-modal')!;
      const text = modal.textContent ?? '';
      expect(text, locale).not.toContain('undefined');
      expect(modal.getAttribute('aria-label'), locale).toBe(t.formulaModalTitle);
      expect(queryAll(el, '.formula-tab').map((b) => b.textContent?.trim()), locale)
        .toEqual([t.formulaFunctionsTab, t.formulaValuesTab]);
      expect(query(el, '.formula-target-label')?.textContent?.trim(), locale).toBe(t.formulaTargetSection);
      expect(query(el, '.formula-status-title')?.textContent?.trim(), locale).toBe(t.previewResult);
      expect(query(el, '.formula-hint')?.textContent?.trim(), locale).toBe(t.formulaQuoteHint);
      expect(query<HTMLInputElement>(el, '.formula-search')?.placeholder, locale).toBe(t.formulaSearch);
      expect(queryAll(el, '.fn-chip')[0]?.textContent?.trim(), locale).toBe(t.formulaAllCategories);
      expect(queryAll(el, '.fn-detail-title').map((n) => n.textContent?.trim()), locale)
        .toEqual([t.formulaArguments, t.formulaReturns]);
      expect(query(el, '.fn-insert')?.textContent?.trim(), locale).toBe(t.formulaInsert);
      expect(footButton(el, t.cancel), locale).toBeDefined();
      expect(footButton(el, t.apply), locale).toBeDefined();
      el.remove();
    }
  });
});
