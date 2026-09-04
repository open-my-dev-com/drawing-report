// @vitest-environment node
// `$(...)` 명시 참조 — 자동완성·삽입 시 변환, 파라미터 이름 변경 전파, 검사 분류
import { describe, expect, it, vi } from 'vitest';
import {
  FormulaEvalError,
  FormulaSyntaxError,
  diagnoseFormula,
  evaluateFormula,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';
import {
  FormulaDraftController,
  columnSuggestion,
} from '../../src/designer/controllers/formula-draft.js';
import {
  renameParameterFieldReferences,
  renameParameterReferences,
} from '../../src/designer/parameters.js';
import { checkFormula } from '../../src/designer/formula-check.js';
import { collectFormulaWarnings } from '../../src/designer/formula-warning.js';
import type { FormulaTarget } from '../../src/designer/formula-target.js';

const FIELD_TARGET = { kind: 'field', elementId: 'e1' } as const;

function host() {
  return { requestUpdate: vi.fn(), updateComplete: Promise.resolve(true) };
}

/** 입력란 없이 초안만 다루는 컨트롤러 */
function draft(formula: string, caret?: number): FormulaDraftController {
  const c = new FormulaDraftController(host(), () => null);
  c.start(FIELD_TARGET, { formula });
  if (caret !== undefined) c.syncCaret(caret);
  return c;
}

/** 선택 범위를 가진 입력란을 흉내 낸 컨트롤러 */
function draftWithSelection(formula: string, start: number, end = start): FormulaDraftController {
  const input = { selectionStart: start, selectionEnd: end, focus() {}, setSelectionRange() {} };
  const c = new FormulaDraftController(host(), () => input as unknown as HTMLTextAreaElement);
  c.start(FIELD_TARGET, { formula });
  return c;
}

const PARAMETERS = [
  { key: 'items', fields: [{ key: 'amount', title: '금액' }, { key: 'unit-price', title: '단가' }] },
  { key: 'total', fields: [] },
];

describe('columnSuggestion — 명시 참조 입력', () => {
  it('`$(목록).` 뒤에서 하위 필드를 제안하고 `$(필드)`로 완성한다', () => {
    const found = columnSuggestion('SUM($(items).', 13, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount', 'unit-price']);
    expect(found?.typedLength).toBe(0);
    // `$(items).`은 이미 있으므로 필드 한 단계만 넣습니다.
    expect(found?.columns[0]).toMatchObject({ replaceLength: 0, text: null, path: ['amount'] });
  });

  it('`$(목록).$(` 뒤에서는 연 괄호까지 함께 바꿔 넣는다', () => {
    const found = columnSuggestion('SUM($(items).$(am', 17, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount']);
    expect(found?.typedLength).toBe(2);
    expect(found?.columns[0]?.replaceLength).toBe(4);
  });

  it('`$(목록).이름`처럼 점 뒤에 이름만 친 것도 제안하고 `$(필드)`로 바꾼다', () => {
    const found = columnSuggestion('$(items).un', 11, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['unit-price']);
    expect(found?.columns[0]).toMatchObject({ replaceLength: 2, text: null });
  });

  it('이스케이프한 키도 목록 파라미터로 찾는다', () => {
    const parameters = [{ key: 'a)b', fields: [{ key: 'x', title: 'x' }] }];
    expect(columnSuggestion('$(a\\)b).', 8, parameters)?.columns.map((c) => c.key)).toEqual(['x']);
  });

  it('초안에 `$(`가 있으면 일반 참조 `목록.`은 제안하지 않는다', () => {
    expect(columnSuggestion('$(total) + items.', 17, PARAMETERS)).toBeNull();
  });
});

describe('columnSuggestion — 일반 참조 입력', () => {
  it('`목록.` 뒤에서는 식별자 필드를 이름 그대로 완성한다', () => {
    const found = columnSuggestion('SUM(items.a', 11, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount']);
    expect(found?.columns[0]).toMatchObject({ replaceLength: 1, text: 'amount' });
  });

  it('식별자 규칙에 맞지 않는 필드는 `목록.`까지 지우고 `$(...)` 참조로 완성한다', () => {
    const found = columnSuggestion('SUM(items.u', 11, PARAMETERS);
    expect(found?.columns[0]).toMatchObject({
      key: 'unit-price', replaceLength: 'items.u'.length, text: null, path: ['items', 'unit-price'],
    });
  });

  it('식별자는 파서와 같은 유니코드 규칙으로 읽는다', () => {
    const parameters = [{ key: '품목', fields: [{ key: '수량', title: '수량' }] }];
    expect(columnSuggestion('SUM(품목.수', 8, parameters)?.columns.map((c) => c.key)).toEqual(['수량']);
  });

  it('예약 참조 뒤(`@item.`)와 앞 단계가 있는 경로(`a.items.`)는 목록 파라미터로 보지 않는다', () => {
    const parameters = [{ key: 'item', fields: [{ key: 'x', title: 'x' }] }, ...PARAMETERS];
    expect(columnSuggestion('@item.', 6, parameters)).toBeNull();
    expect(columnSuggestion('a.items.', 8, parameters)).toBeNull();
  });
});

describe('FormulaDraftController.insertReference — 명시 참조 삽입', () => {
  it('빈 초안에는 `$(키)`를 넣는다', () => {
    const c = draft('');
    c.insertReference(['amount']);
    expect(c.draft).toBe('$(amount)');
    expect(c.caret).toBe(9);
  });

  it('식별자가 아닌 키와 여러 단계 경로를 이스케이프해 넣는다', () => {
    const c = draft('');
    c.insertReference(['items', 'unit-price']);
    expect(c.draft).toBe('$(items).$(unit-price)');
    c.insertReference(['a)b']);
    expect(c.draft).toBe('$(items).$(unit-price)$(a\\)b)');
  });

  it('예약 참조로 시작하는 경로는 예약 이름을 그대로 두고 뒤 단계만 감싼다', () => {
    const c = draft('');
    c.insertReference(['@item', 'amount']);
    expect(c.draft).toBe('@item.$(amount)');
  });

  it('일반 참조만 쓰던 초안은 먼저 전체를 명시 참조로 바꿔 두 형식이 섞이지 않게 한다', () => {
    const c = draftWithSelection('SUM(items.amount) + ', 20);
    c.insertReference(['tax']);
    expect(c.draft).toBe('SUM($(items).$(amount)) + $(tax)');
    expect(() => evaluateFormula(c.draft, { values: { items: [{ amount: 1 }], tax: 2 } })).not.toThrow();
  });

  it('커서가 초안 중간에 있어도 바뀐 자리에 맞춰 넣는다', () => {
    // `SUM(items.amount) + qty`의 `+ ` 뒤(커서 20)에 넣으면 앞 참조가 길어진 만큼 밀립니다.
    const c = draftWithSelection('SUM(items.amount) + qty', 20);
    c.insertReference(['tax']);
    expect(c.draft).toBe('SUM($(items).$(amount)) + $(tax)$(qty)');
    expect(c.caret).toBe('SUM($(items).$(amount)) + $(tax)'.length);
  });

  it('아직 끝나지 않은 식(`a + `) 뒤에 넣어도 앞의 일반 참조를 함께 바꾼다', () => {
    const c = draftWithSelection('SUM(a) + ', 9);
    c.insertReference(['b']);
    expect(c.draft).toBe('SUM($(a)) + $(b)');
    expect(c.caret).toBe('SUM($(a)) + $(b)'.length);
  });

  it('참조 한가운데 있던 커서는 그 참조 바로 뒤로 옮긴다', () => {
    const c = draftWithSelection('items.amount', 3);
    c.insertReference(['tax']);
    expect(c.draft).toBe('$(items).$(amount)$(tax)');
  });

  it('선택한 범위는 지우고 그 자리에 넣는다', () => {
    const c = draftWithSelection('SUM(old) * rate', 4, 7);
    c.insertReference(['items', 'amount']);
    expect(c.draft).toBe('SUM($(items).$(amount)) * $(rate)');
  });

  it('이미 명시 참조를 쓰는 초안은 바꾸지 않고 넣기만 한다', () => {
    const c = draftWithSelection('$(a) + ', 7);
    c.insertReference(['b']);
    expect(c.draft).toBe('$(a) + $(b)');
  });

  it('파싱할 수 없는 초안은 바꾸지 않고 그대로 넣는다 — 문법 검사가 알린다', () => {
    const c = draftWithSelection('SUM(a, ', 7);
    c.insertReference(['b']);
    expect(c.draft).toBe('SUM(a, $(b)');
  });

  it('문자열·함수 이름·예약 참조 이름·논리 상수는 변환에서 건드리지 않는다', () => {
    const c = draftWithSelection('IF(TRUE, "items.x", SUM(@item.amount)) + ', 42);
    c.insertReference(['tax']);
    expect(c.draft).toBe('IF(TRUE, "items.x", SUM(@item.$(amount))) + $(tax)');
  });
});

describe('FormulaDraftController.complete — 자동완성 적용', () => {
  it('일반 참조 초안은 이름 그대로 완성해 일반 형식을 유지한다', () => {
    const c = draftWithSelection('SUM(items.a', 11);
    const found = columnSuggestion(c.draft, 11, PARAMETERS)!;
    c.complete(found.columns[0]!);
    expect(c.draft).toBe('SUM(items.amount');
  });

  it('식별자가 아닌 필드는 `목록.`을 지우고 `$(목록).$(필드)`로 넣는다', () => {
    const c = draftWithSelection('SUM(items.u', 11);
    const found = columnSuggestion(c.draft, 11, PARAMETERS)!;
    c.complete(found.columns[0]!);
    expect(c.draft).toBe('SUM($(items).$(unit-price)');
  });

  it('명시 참조 초안은 연 `$(`까지 `$(필드)`로 바꾼다', () => {
    const c = draftWithSelection('SUM($(items).$(am', 17);
    const found = columnSuggestion(c.draft, 17, PARAMETERS)!;
    c.complete(found.columns[0]!);
    expect(c.draft).toBe('SUM($(items).$(amount)');
    expect(c.caret).toBe('SUM($(items).$(amount)'.length);
  });
});

/** 필드·바코드·텍스트·그리드가 `amount`·`items.qty`를 수식과 조건식에서 쓰는 양식 */
function makeFormulaFile(): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '수식' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      parameters: [
        { key: 'amount' },
        { key: 'items', valueType: 'list', fields: [{ key: 'qty' }, { key: 'price' }] },
      ],
      sampleValues: {
        amount: 5,
        items: [{ name: 'A', qty: 1, price: 10 }, { qty: 2, name: 'B', price: 20 }],
      },
      pages: [{
        elements: [
          {
            type: 'field', id: 'f-1', name: 'sum', position: { x: 10, y: 10 }, width: 40, height: 8,
            formula: 'amount * 2 + SUM(items.qty)',
            conditionalFormats: [{ condition: 'amount > 1', fontColor: '#FF0000' }],
          },
          {
            type: 'text', id: 't-1', name: 'note', position: { x: 10, y: 20 }, width: 40, height: 8,
            content: 'x', conditionalFormats: [{ condition: '$(amount) > 1', bold: true }],
          },
          {
            type: 'barcode', id: 'b-1', name: 'code', position: { x: 10, y: 30 }, width: 20, height: 20,
            kind: 'qrcode', formula: 'TEXT(amount',
          },
          {
            type: 'grid', id: 'g-1', name: 'table', position: { x: 10, y: 60 },
            rows: [{ height: 8 }, { height: 8 }, { height: 8 }], columns: [{ width: 40 }, { width: 40 }],
            repeat: {
              parameter: 'items',
              bands: [
                { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
                { id: 'b-foot', fromRow: 2, toRow: 2, placement: 'page-end' },
              ],
              pagination: { mode: 'auto', minItems: 0 },
              groupBy: ['qty'],
            },
            cells: [
              { row: 0, column: 0, formula: 'amount' },
              { row: 1, column: 0, parameter: 'qty' },
              { row: 1, column: 1, formula: 'qty * price', conditionalFormats: [{ condition: 'qty > 1', bold: true }] },
              { row: 2, column: 0, formula: 'SUM(@page.qty) + amount' },
              { row: 2, column: 1, formula: 'SUM(items.qty)' },
            ],
          },
        ],
      }],
      assets: [],
    },
  } as unknown as SlipTemplateFile;
}

type Loose = Record<string, unknown>;
const elementsOf = (file: SlipTemplateFile): Loose[] => file.template.pages[0]!.elements as unknown as Loose[];
const cellsOf = (file: SlipTemplateFile): Loose[] => elementsOf(file)[3]!.cells as Loose[];
const conditionOf = (owner: Loose, index = 0): string =>
  (owner.conditionalFormats as { condition: string }[])[index]!.condition;

describe('renameParameterReferences — 수식·조건식 전파', () => {
  it('일반 참조 수식은 이름만 바꿔 형식을 유지하고, 명시 참조 수식은 명시 참조로 바꾼다', () => {
    const file = makeFormulaFile();
    renameParameterReferences(file, 'amount', 'total');
    const [field, text] = elementsOf(file);
    expect(field!.formula).toBe('total * 2 + SUM(items.qty)');
    expect(conditionOf(field!)).toBe('total > 1');
    expect(conditionOf(text!)).toBe('$(total) > 1');
    expect(cellsOf(file)[0]!.formula).toBe('total');
    expect(cellsOf(file)[3]!.formula).toBe('SUM(@page.qty) + total');
  });

  it('식별자 규칙에 맞지 않는 새 이름이면 수식 전체를 명시 참조로 바꾼다', () => {
    const file = makeFormulaFile();
    renameParameterReferences(file, 'amount', 'total-amount');
    const field = elementsOf(file)[0]!;
    expect(field.formula).toBe('$(total-amount) * 2 + SUM($(items).$(qty))');
    expect(conditionOf(field)).toBe('$(total-amount) > 1');
    // 바꾼 수식은 바뀐 데이터로 같은 값을 냅니다.
    expect(evaluateFormula(field.formula as string, {
      values: { 'total-amount': 5, items: [{ qty: 1 }, { qty: 2 }] },
    })).toBe(13);
  });

  it('파싱할 수 없는 수식은 그대로 둔다', () => {
    const file = makeFormulaFile();
    renameParameterReferences(file, 'amount', 'total');
    expect(elementsOf(file)[2]!.formula).toBe('TEXT(amount');
  });

  it('앞부분만 겹치는 이름과 문자열·함수 이름은 바꾸지 않는다', () => {
    const file = makeFormulaFile();
    (elementsOf(file)[0] as Loose).formula = 'amountExtra + "amount" + SUM(amount)';
    renameParameterReferences(file, 'amount', 'total');
    expect(elementsOf(file)[0]!.formula).toBe('amountExtra + "amount" + SUM(total)');
  });
});

describe('renameParameterFieldReferences — 하위 필드 이름 변경 전파', () => {
  it('정의·항목 구간 셀·groupBy·샘플 항목 키를 함께 바꾸고 샘플 항목의 순서와 다른 키는 유지한다', () => {
    const file = makeFormulaFile();
    renameParameterFieldReferences(file, 'items', 'qty', 'count');
    expect(file.template.parameters![1]!.fields).toEqual([{ key: 'count' }, { key: 'price' }]);
    expect(cellsOf(file)[1]!.parameter).toBe('count');
    expect((elementsOf(file)[3]!.repeat as Loose).groupBy).toEqual(['count']);
    const rows = (file.template.sampleValues as Loose).items as Loose[];
    expect(Object.keys(rows[0]!)).toEqual(['name', 'count', 'price']);
    expect(Object.keys(rows[1]!)).toEqual(['count', 'name', 'price']);
    expect(rows[1]!.count).toBe(2);
    // 최상위 파라미터의 샘플 값은 그대로입니다.
    expect((file.template.sampleValues as Loose).amount).toBe(5);
  });

  it('`목록.필드`, 그 그리드의 `@page.필드`, 항목 구간 셀의 필드 이름 참조를 모두 바꾼다', () => {
    const file = makeFormulaFile();
    renameParameterFieldReferences(file, 'items', 'qty', 'count');
    expect(elementsOf(file)[0]!.formula).toBe('amount * 2 + SUM(items.count)');
    const cells = cellsOf(file);
    expect(cells[2]!.formula).toBe('count * price');
    expect(conditionOf(cells[2]!)).toBe('count > 1');
    expect(cells[3]!.formula).toBe('SUM(@page.count) + amount');
    expect(cells[4]!.formula).toBe('SUM(items.count)');
    // 항목 구간 밖 셀의 같은 이름은 하위 필드가 아니므로 바꾸지 않습니다.
    expect(cells[0]!.formula).toBe('amount');
  });

  it('식별자가 아닌 새 필드 이름이면 명시 참조로 바꾼다', () => {
    const file = makeFormulaFile();
    renameParameterFieldReferences(file, 'items', 'qty', 'unit qty');
    expect(elementsOf(file)[0]!.formula).toBe('$(amount) * 2 + SUM($(items).$(unit qty))');
    expect(cellsOf(file)[2]!.formula).toBe('$(unit qty) * $(price)');
    expect(cellsOf(file)[3]!.formula).toBe('SUM(@page.$(unit qty)) + $(amount)');
  });

  it('다른 목록을 반복하는 그리드의 필드 참조는 바꾸지 않는다', () => {
    const file = makeFormulaFile();
    file.template.parameters!.push({ key: 'others', valueType: 'list', fields: [{ key: 'qty' }] });
    renameParameterFieldReferences(file, 'others', 'qty', 'count');
    expect(cellsOf(file)[1]!.parameter).toBe('qty');
    expect(cellsOf(file)[2]!.formula).toBe('qty * price');
    expect(elementsOf(file)[0]!.formula).toBe('amount * 2 + SUM(items.qty)');
  });
});

/** 값 없이 검사하는 입력 */
function checkOf(source: string) {
  return checkFormula({
    source,
    condition: false,
    emptyAllowed: false,
    locale: 'ko',
    context: { values: { d: '2026-09-04' } },
    // 컴포넌트는 검사 로케일로 진단하므로 여기서도 같은 로케일을 넘깁니다.
    diagnose: (from, context) => diagnoseFormula(from, { ...context, locale: 'ko' }),
  });
}

describe('checkFormula — 명시 참조와 날짜 패턴 오류 분류', () => {
  it('`$이름`·`$()`·닫히지 않은 참조·형식 섞기는 문법 오류로 적용을 막는다', () => {
    for (const source of ['$amount', '$()', '$(amount', 'a + $(b)', '$(a).b']) {
      const found = checkOf(source);
      expect(found.status, source).toBe('syntax-error');
      expect(found.applicable, source).toBe(false);
      expect(found.detail, source).toBeTruthy();
      expect(() => evaluateFormula(source, { values: {} })).toThrow(FormulaSyntaxError);
    }
  });

  it('FORMAT_DATE 패턴 오류는 계산 오류로 알리고 적용은 허용한다', () => {
    for (const source of ['FORMAT_DATE(d, "Date")', 'FORMAT_DATE(d, "YYYY [년")']) {
      const found = checkOf(source);
      expect(found.status, source).toBe('formula-error');
      expect(found.applicable, source).toBe(true);
      let thrown: unknown;
      try {
        evaluateFormula(source, { values: { d: '2026-09-04' }, locale: 'ko' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FormulaEvalError);
      expect((thrown as FormulaEvalError).reason).toBe('formula');
      expect(found.detail).toBe((thrown as Error).message);
    }
  });
});

describe('collectFormulaWarnings — 원인 문구', () => {
  it('계산되지 않는 자리마다 검사 결과의 원인을 함께 남긴다', () => {
    const page = {
      elements: [
        { type: 'field', id: 'f1', name: '합계', position: { x: 0, y: 0 }, width: 40, height: 8, formula: 'BAD' },
        {
          type: 'grid', id: 'g1', name: '표', position: { x: 0, y: 0 },
          rows: [{ height: 8 }], columns: [{ width: 40 }],
          cells: [{ row: 0, column: 0, formula: 'OK', conditionalFormats: [{ condition: 'BAD' }] }],
        },
      ],
    } as never;
    const warnings = collectFormulaWarnings({
      page,
      check: (_target: FormulaTarget, source: string) =>
        source === 'BAD'
          ? [{ status: 'ok', applicable: true }, { status: 'formula-error', applicable: true, detail: '0으로 나눌 수 없습니다' }]
          : [{ status: 'ok', applicable: true }],
    });
    expect(warnings.details).toEqual([
      { target: { kind: 'field', elementId: 'f1' }, message: '0으로 나눌 수 없습니다' },
      { target: { kind: 'cell-condition', elementId: 'g1', row: 0, column: 0, ruleIndex: 0 }, message: '0으로 나눌 수 없습니다' },
    ]);
  });
});
