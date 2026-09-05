// @vitest-environment happy-dom
// 계산되지 않는 수식의 캔버스 표시, 저장 전 파일 형식 검증, 하위 필드 이름 변경 전파
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진·파일 검증은 실제 구현을 사용합니다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 화면 동작만 확인하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () => Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import { evaluateFormula, type SlipFile, type SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  flush,
  loadDesigner,
  selectElement,
  toolbarButton,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

const s = strings.designer;

const SAMPLE_ITEMS = [
  { itemName: '연필', amount: 100, qty: 2 },
  { itemName: '지우개', amount: 200, qty: 0 },
];

/** 항목 구간 셀에 계산되지 않는 수식이 있는 반복 그리드 */
function makeGrid(formula: string): Record<string, unknown> {
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
      pagination: { mode: 'auto', minItems: 0 },
    },
    cells: [
      { row: 0, column: 0, content: '품명' },
      { row: 0, column: 1, content: '금액' },
      { row: 1, column: 0, parameter: 'itemName' },
      { row: 1, column: 1, formula },
    ],
  };
}

async function mountFile(
  elements: unknown[],
  sampleValues?: Record<string, unknown>,
  parameters?: unknown[],
): Promise<Designer> {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements = elements as never;
  if (sampleValues) file.template.sampleValues = sampleValues as never;
  if (parameters) file.template.parameters = parameters as never;
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

/** 캔버스의 그리드 셀 가운데 수식 오류 표시가 있는 것 */
function errorCells(el: Designer): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>('.grid-cell.formula-error'));
}

function warningList(el: Designer): HTMLElement | null {
  return el.shadowRoot!.querySelector('#formula-warnings');
}

/** core 평가기가 같은 값으로 내는 오류 문구 — PDF 변환도 같은 문구를 알립니다 */
function coreMessage(formula: string, values: Record<string, unknown>): string {
  try {
    evaluateFormula(formula, { values });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`계산 실패를 기대한 수식: ${formula}`);
}

afterEach(() => {
  for (const el of Array.from(document.body.querySelectorAll('slip-designer'))) el.remove();
});

describe('<slip-designer> 계산되지 않는 수식의 캔버스 표시', () => {
  it('계산에 실패한 셀은 수식 원문 대신 오류 표시와 core의 오류 문구를 보여 준다', async () => {
    const formula = '$(amount) / $(qty)';
    const el = await mountFile([makeGrid(formula)], { items: SAMPLE_ITEMS });

    // 고르지 않은 반복 그리드는 출력 결과로 보이므로 항목마다 계산합니다 — 첫 항목은 100 / 2,
    // 두 번째 항목은 0으로 나눠 오류가 됩니다.
    expect(el.shadowRoot!.textContent).toContain('50');
    const failed = errorCells(el);
    expect(failed).toHaveLength(1);
    expect(el.shadowRoot!.textContent).not.toContain(`= ${formula}`);
    const label = failed[0]!.querySelector('.formula-error-text')!;
    expect(label.textContent?.trim()).toBe(s.formulaErrorLabel);
    expect(label.getAttribute('title')).toBe(coreMessage(formula, { items: SAMPLE_ITEMS, ...SAMPLE_ITEMS[1] }));
    // 같은 셀에는 경고 배지도 남습니다.
    expect(failed[0]!.querySelector('.formula-warning-badge')).not.toBeNull();

    // 고르면 원본 행 구조를 첫 샘플 항목으로 계산하므로 오류 표시가 없고, 편집은 그대로 할 수 있습니다.
    selectElement(el, 'g1');
    await el.updateComplete;
    expect(errorCells(el)).toHaveLength(0);
    expect(el.shadowRoot!.querySelector('.grid-cell .formula-warning-badge')).not.toBeNull();
  });

  it('경고 목록에 자리와 원인을 적고, 자리를 누르면 그 셀을 선택한다', async () => {
    const formula = '$(amount) / $(qty)';
    const el = await mountFile([makeGrid(formula)], { items: SAMPLE_ITEMS });
    const list = warningList(el);
    expect(list).not.toBeNull();
    expect(list!.getAttribute('role')).toBe('alert');
    const rows = Array.from(list!.querySelectorAll('li'));
    expect(rows).toHaveLength(1);
    const text = rows[0]!.querySelector('span')!.textContent!;
    expect(text).toContain(s.typeGrid);
    expect(text).toContain('품목 표');
    expect(text).toContain(s.formulaCellAt.replace('{row}', '2').replace('{column}', '2'));
    expect(text).toContain(coreMessage(formula, { items: SAMPLE_ITEMS, ...SAMPLE_ITEMS[1] }));

    (rows[0]!.querySelector('button') as HTMLButtonElement).click();
    await el.updateComplete;
    const state = el as unknown as { _selectedId: string | null; _gridEdit: { cell: { row: number; column: number } | null } };
    expect(state._selectedId).toBe('g1');
    expect(state._gridEdit.cell).toEqual({ row: 1, column: 1 });
  });

  it('필드 수식과 조건식의 실패도 요소 이름·규칙 번호와 함께 목록에 오른다', async () => {
    const el = await mountFile([
      {
        type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 }, width: 40, height: 8,
        formula: '1 / 0',
        conditionalFormats: [{ condition: '$(nope) > 1', fontColor: '#FF0000' }],
      },
    ]);
    const rows = Array.from(warningList(el)!.querySelectorAll('li')).map((li) => li.querySelector('span')!.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(`${s.typeField} · 합계 · ${s.formula}`);
    expect(rows[0]).toContain(coreMessage('1 / 0', {}));
    expect(rows[1]).toContain(s.formulaConditionAt.replace('{index}', '1'));
  });

  it('계산되는 수식으로 고치면 오류 표시와 목록이 사라진다', async () => {
    const el = await mountFile([makeGrid('1 / 0')], { items: SAMPLE_ITEMS });
    expect(warningList(el)).not.toBeNull();
    // 항목 두 벌 모두 계산되지 않습니다.
    expect(errorCells(el)).toHaveLength(2);

    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      const grid = f.template.pages[0]!.elements[0]! as unknown as { cells: Record<string, unknown>[] };
      grid.cells[3]!.formula = '$(amount) * $(qty)';
    });
    await el.updateComplete;
    expect(warningList(el)).toBeNull();
    expect(errorCells(el)).toHaveLength(0);
  });
});

describe('<slip-designer> 저장 전 파일 형식 검증', () => {
  function makeStorage() {
    return {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(makeTemplateFile()),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ items: [] }),
    };
  }

  async function confirmSave(el: Designer): Promise<void> {
    toolbarButton(el, s.saveAsMyForm).click();
    await el.updateComplete;
    (Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === s.save) as HTMLButtonElement).click();
    await flush();
    await el.updateComplete;
  }

  it('파일 형식에 맞지 않는 양식은 저장하지 않고 위치와 원인을 알린다', async () => {
    const storage = makeStorage();
    const el = await loadDesigner();
    (el as unknown as { storage: unknown }).storage = storage;
    await el.updateComplete;
    // 스키마가 거부하는 값(음수 너비)을 화면 검증을 거치지 않고 직접 넣습니다.
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      (f.template.pages[0]!.elements[0] as { width: number }).width = -1;
    });
    await confirmSave(el);

    expect(storage.save).not.toHaveBeenCalled();
    const error = el.shadowRoot!.querySelector('.modal .formula-status.error');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain(s.saveInvalidFile.split('{detail}')[0]!.trim());
    expect(error!.textContent).toContain('template.pages.0.elements.0.width');
    // 저장 모달은 열린 채이고 저장 완료 안내는 나오지 않습니다.
    expect(el.shadowRoot!.querySelector('.save-title')).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(s.savedNotice);
  });

  it('형식에 맞는 양식은 그대로 저장된다', async () => {
    const storage = makeStorage();
    const el = await loadDesigner();
    (el as unknown as { storage: unknown }).storage = storage;
    await el.updateComplete;
    await confirmSave(el);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.textContent).toContain(s.savedNotice);
  });
});

describe('<slip-designer> 하위 필드 이름 변경', () => {
  it('셀·수식·그룹 설정·샘플 항목이 함께 바뀌고 되돌리기 한 단위로 남는다', async () => {
    const grid = makeGrid('$(amount) * $(qty)');
    (grid.repeat as Record<string, unknown>).groupBy = ['qty'];
    const el = await mountFile(
      [
        grid,
        {
          type: 'field', id: 'f1', name: '수량 합', position: { x: 10, y: 60 }, width: 40, height: 8,
          formula: 'SUM($(items).$(qty))',
        },
      ],
      { items: SAMPLE_ITEMS },
      [{ key: 'items', valueType: 'list', fields: [{ key: 'itemName' }, { key: 'amount' }, { key: 'qty' }] }],
    );
    const designer = el as unknown as {
      _renameParameterField(listKey: string, key: string, next: string): void;
      _undoStack: unknown[];
    };
    const before = designer._undoStack.length;
    designer._renameParameterField('items', 'qty', 'count');
    await el.updateComplete;

    const file = fileOf(el);
    const saved = file.template.pages[0]!.elements as unknown as Record<string, unknown>[];
    expect((saved[0]!.cells as Record<string, unknown>[])[3]!.formula).toBe('$(amount) * $(count)');
    expect((saved[0]!.repeat as Record<string, unknown>).groupBy).toEqual(['count']);
    expect(saved[1]!.formula).toBe('SUM($(items).$(count))');
    expect(file.template.parameters![0]!.fields!.map((f) => f.key)).toEqual(['itemName', 'amount', 'count']);
    const rows = (file.template.sampleValues as Record<string, unknown>).items as Record<string, unknown>[];
    expect(Object.keys(rows[0]!)).toEqual(['itemName', 'amount', 'count']);
    expect(designer._undoStack.length).toBe(before + 1);

    // 바뀐 수식은 캔버스에서 그대로 계산됩니다.
    selectElement(el, 'g1');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.grid-cell.formula-error')).toBeNull();
  });
});
