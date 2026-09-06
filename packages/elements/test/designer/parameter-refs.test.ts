// @vitest-environment happy-dom
// 파라미터 참조 무결성 — 키 변경과 정의 삭제가 모든 요소 종류와 샘플 값에 함께 적용되는지
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
} from './helpers.js';
import type { Designer } from './helpers.js';
import {
  collectParameterUses,
  ensureParameterDef,
  parameterUsesOf,
  renameParameterReferences,
} from '../../src/designer/parameters.js';

installDesignerTestEnv();

type ElementRecord = { id: string; type: string; parameter?: string; repeat?: { parameter: string };
  cells?: { row: number; column: number; parameter?: string }[] };

/** 필드·이미지·바코드·그리드가 같은 파라미터 `amount`를 쓰고 샘플 값도 있는 양식 */
function makeRefFile(): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.parameters = [
    { key: 'amount', label: '금액' },
    { key: 'items', valueType: 'list', fields: [{ key: 'qty' }] },
    { key: 'unused' },
  ];
  file.template.sampleValues = { amount: 5 } as never;
  file.template.pages = [
    { elements: [
      { type: 'field', id: 'f-1', name: 'amount-field', position: { x: 10, y: 10 }, width: 40, height: 8, parameter: 'amount' },
      { type: 'image', id: 'i-1', name: 'photo', position: { x: 10, y: 30 }, width: 20, height: 20, parameter: 'amount' },
    ] },
    { elements: [
      { type: 'barcode', id: 'b-1', name: 'code', position: { x: 10, y: 10 }, width: 20, height: 20, kind: 'qrcode', parameter: 'amount' },
      {
        type: 'grid', id: 'g-1', name: 'table', position: { x: 10, y: 40 },
        rows: [{ height: 8 }, { height: 8 }], columns: [{ width: 40 }, { width: 40 }],
        repeat: {
          parameter: 'items',
          bands: [
            { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
            { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
          ],
          pagination: { mode: 'auto', minItems: 0 },
        },
        cells: [{ row: 0, column: 0, parameter: 'amount' }, { row: 1, column: 0, parameter: 'qty' }],
      },
    ] },
  ] as never;
  return file;
}

function fileOf(el: Element): SlipTemplateFile {
  return (el as unknown as { _file: SlipTemplateFile })._file;
}

function elementOf(el: Element, pageIndex: number, id: string): ElementRecord {
  return fileOf(el).template.pages[pageIndex]!.elements.find((e) => e.id === id) as unknown as ElementRecord;
}

function undoDepth(el: Element): number {
  return (el as unknown as { _history: { undoDepth: number } })._history.undoDepth;
}

function paramKeys(el: Element): string[] {
  return (fileOf(el).template.parameters ?? []).map((p) => p.key);
}

async function mount(): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(makeRefFile() as unknown as SlipFile);
  return loadDesigner();
}

/** 사이드바에서 파라미터를 골라 설정 패널을 엽니다 */
async function selectParameter(el: Designer, key: string): Promise<void> {
  const row = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-row'))
    .find((b) => b.getAttribute('title') === key);
  if (!row) throw new Error(`파라미터 줄을 찾지 못했습니다: ${key}`);
  row.click();
  await el.updateComplete;
}

async function renameKey(el: Designer, next: string): Promise<HTMLInputElement> {
  const input = el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement;
  input.value = next;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await el.updateComplete;
  return input;
}

function press(el: Designer, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

/** `amount`를 참조하는 모든 자리가 `key`를 가리키는지 */
function expectAllRefs(el: Designer, key: string): void {
  expect(elementOf(el, 0, 'f-1').parameter).toBe(key);
  expect(elementOf(el, 0, 'i-1').parameter).toBe(key);
  expect(elementOf(el, 1, 'b-1').parameter).toBe(key);
  const grid = elementOf(el, 1, 'g-1');
  expect(grid.cells!.find((c) => c.row === 0)!.parameter).toBe(key);
  // 항목 구간 안의 셀은 하위 필드라 최상위 키 변경의 대상이 아닙니다.
  expect(grid.cells!.find((c) => c.row === 1)!.parameter).toBe('qty');
  expect(grid.repeat!.parameter).toBe('items');
  expect(paramKeys(el)).toContain(key);
  expect((fileOf(el).template.sampleValues as Record<string, unknown>)[key]).toBe(5);
}

describe('파라미터 참조 헬퍼 (상태 비의존)', () => {
  it('필드·그리드·이미지·바코드의 사용 위치를 한 목록으로 모은다', () => {
    const { uses, fieldAt } = collectParameterUses(makeRefFile());
    expect(uses.get('amount')!.map((u) => `${u.type}:${u.id}@${u.pageIndex}`))
      .toEqual(['field:f-1@0', 'image:i-1@0', 'barcode:b-1@1', 'grid:g-1@1']);
    expect(uses.get('items')!.map((u) => u.id)).toEqual(['g-1']);
    // 항목 구간 셀의 파라미터는 최상위 키가 아니라 하위 필드 자리로 기록됩니다.
    expect(uses.has('qty')).toBe(false);
    expect(fieldAt.get('items')!.get('qty')).toEqual({ pageIndex: 1, gridId: 'g-1', row: 1, column: 0 });
    expect(parameterUsesOf(makeRefFile(), 'unused')).toEqual([]);
  });

  it('키 변경은 정의·모든 참조·샘플 값을 함께 바꾸고, 정의가 없던 키는 새 정의를 만든다', () => {
    const file = makeRefFile();
    renameParameterReferences(file, 'amount', 'total');
    const ids = collectParameterUses(file).uses.get('total')!.map((u) => u.id);
    expect(ids).toEqual(['f-1', 'i-1', 'b-1', 'g-1']);
    expect(collectParameterUses(file).uses.has('amount')).toBe(false);
    expect(file.template.parameters!.find((p) => p.key === 'total')?.label).toBe('금액');
    expect(file.template.sampleValues).toEqual({ total: 5 });

    const bare = makeRefFile();
    delete bare.template.parameters;
    renameParameterReferences(bare, 'amount', 'total');
    expect(bare.template.parameters).toEqual([{ key: 'total' }]);
  });

  it('정의 등록은 없을 때만 만들고, 있으면 비어 있는 값 종류만 채운다', () => {
    const file = makeRefFile();
    ensureParameterDef(file, 'amount', 'number', '무시되는 이름');
    expect(file.template.parameters!.find((p) => p.key === 'amount')).toEqual({ key: 'amount', label: '금액', valueType: 'number' });
    ensureParameterDef(file, 'amount', 'text');
    expect(file.template.parameters!.find((p) => p.key === 'amount')!.valueType).toBe('number');
    ensureParameterDef(file, 'fresh', 'image', '사진');
    expect(file.template.parameters!.find((p) => p.key === 'fresh')).toEqual({ key: 'fresh', label: '사진', valueType: 'image' });
    ensureParameterDef(file, '', 'text');
    expect(file.template.parameters!.some((p) => p.key === '')).toBe(false);
  });
});

describe('<slip-designer> 파라미터 키 변경', () => {
  it('키를 바꾸면 필드·그리드·이미지·바코드와 샘플 값이 함께 바뀌고 되돌리기 한 단위로 남는다', async () => {
    const el = await mount();
    await selectParameter(el, 'amount');
    const before = undoDepth(el);

    await renameKey(el, 'total');
    expectAllRefs(el, 'total');
    expect(paramKeys(el)).not.toContain('amount');
    expect(undoDepth(el)).toBe(before + 1);

    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expectAllRefs(el, 'amount');
    expect(paramKeys(el)).not.toContain('total');
    expect(undoDepth(el)).toBe(before);

    press(el, 'y', { ctrlKey: true });
    await el.updateComplete;
    expectAllRefs(el, 'total');
    el.remove();
  });

  it('반복 그리드의 목록 키를 바꾸면 반복 설정이 따라오고 하위 필드는 그대로다', async () => {
    const el = await mount();
    await selectParameter(el, 'items');
    await renameKey(el, 'lines');
    const grid = elementOf(el, 1, 'g-1');
    expect(grid.repeat!.parameter).toBe('lines');
    expect(grid.cells!.find((c) => c.row === 1)!.parameter).toBe('qty');
    expect(fileOf(el).template.parameters!.find((p) => p.key === 'lines')!.fields).toEqual([{ key: 'qty' }]);
    el.remove();
  });

  it('이미 있는 키로는 바꿀 수 없고 입력은 원래 키로 돌아간다', async () => {
    const el = await mount();
    await selectParameter(el, 'amount');
    const before = undoDepth(el);
    const input = await renameKey(el, 'unused');
    expect(input.value).toBe('amount');
    expectAllRefs(el, 'amount');
    expect(undoDepth(el)).toBe(before);
    expect(el.shadowRoot!.querySelector('#error-parameter-key')?.textContent).toContain(strings.designer.keyInUse);

    // 같은 키(공백만 다름)는 변경으로 치지 않습니다.
    await renameKey(el, ' amount ');
    expect(undoDepth(el)).toBe(before);
    el.remove();
  });
});

describe('<slip-designer> 파라미터 정의 삭제', () => {
  const deleteButton = (el: Designer, key: string) =>
    Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.getAttribute('aria-label') === `${key} ${strings.designer.delete}`)!;

  it('요소가 쓰는 정의는 지우지 않고 사용 위치(요소 이름·페이지)를 안내한다', async () => {
    const el = await mount();
    const before = undoDepth(el);
    deleteButton(el, 'amount').click();
    await el.updateComplete;

    expect(paramKeys(el)).toContain('amount');
    expect(undoDepth(el)).toBe(before);
    const message = el.shadowRoot!.querySelector('.prop-panel .input-error')?.textContent ?? '';
    const page = (n: number) => strings.designer.pageLabel.replace('{n}', String(n));
    expect(message).toContain(strings.designer.parameterInUse.split('{uses}')[0]);
    for (const at of [`amount-field (${page(1)})`, `photo (${page(1)})`, `code (${page(2)})`, `table (${page(2)})`]) {
      expect(message).toContain(at);
    }
    el.remove();
  });

  it('쓰이지 않는 정의는 바로 지워지고 선택도 해제된다', async () => {
    const el = await mount();
    await selectParameter(el, 'unused');
    deleteButton(el, 'unused').click();
    await el.updateComplete;
    expect(paramKeys(el)).not.toContain('unused');
    expect(el.shadowRoot!.querySelector('.parameter-key-input')).toBeNull();
    el.remove();
  });
});
