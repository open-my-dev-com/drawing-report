// @vitest-environment node
// `$(...)` 명시 참조 — 자동완성·삽입, 파라미터 이름 변경 전파, 검사 분류
import { describe, expect, it, vi } from 'vitest';
import {
  FormulaEvalError,
  FormulaSyntaxError,
  diagnoseFormula,
  evaluateFormula,
  formatReferencePath,
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

describe('columnSuggestion — `$(목록).` 뒤 하위 필드 제안', () => {
  it('`$(목록).` 뒤에서 하위 필드를 모두 제안하고 지울 글자는 없다', () => {
    const found = columnSuggestion('SUM($(items).', 13, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount', 'unit-price']);
    expect(found?.typedLength).toBe(0);
    expect(found?.columns[0]).toMatchObject({ key: 'amount', title: '금액', replaceLength: 0 });
  });

  it('`$(목록).$(` 뒤에서는 연 괄호까지 함께 바꿔 넣는다', () => {
    const found = columnSuggestion('SUM($(items).$(am', 17, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount']);
    expect(found?.typedLength).toBe(2);
    expect(found?.columns[0]?.replaceLength).toBe(4);
  });

  it('`$(목록).이름`처럼 점 뒤에 이름만 친 것도 제안하고 친 이름을 `$(필드)`로 바꾼다', () => {
    const found = columnSuggestion('$(items).un', 11, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['unit-price']);
    expect(found?.columns[0]).toMatchObject({ replaceLength: 2 });
  });

  it('입력한 글자로 시작하는 필드만 남기고 대소문자를 가리지 않는다', () => {
    const found = columnSuggestion('SUM($(items).A', 14, PARAMETERS);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount']);
    expect(found?.typedLength).toBe(1);
  });

  it('커서 앞만 본다 — 뒤에 남은 글은 제안에 영향을 주지 않는다', () => {
    expect(columnSuggestion('SUM($(items).) + 1', 13, PARAMETERS)?.columns).toHaveLength(2);
  });

  it('필드 이름은 파서와 같은 유니코드 규칙으로 읽는다', () => {
    const parameters = [{ key: '품목', fields: [{ key: '수량', title: '수량' }] }];
    expect(columnSuggestion('SUM($(품목).수', 10, parameters)?.columns.map((c) => c.key)).toEqual(['수량']);
  });

  it('이스케이프한 키도 목록 파라미터로 찾는다', () => {
    const parameters = [{ key: 'a)b', fields: [{ key: 'x', title: 'x' }] }];
    expect(columnSuggestion('$(a\\)b).', 8, parameters)?.columns.map((c) => c.key)).toEqual(['x']);
  });

  it('하위 필드가 없는 파라미터, 모르는 이름, 맞는 필드가 없는 입력은 제안하지 않는다', () => {
    expect(columnSuggestion('$(total).', 9, PARAMETERS)).toBeNull();
    expect(columnSuggestion('$(nope).', 8, PARAMETERS)).toBeNull();
    expect(columnSuggestion('$(items).zz', 11, PARAMETERS)).toBeNull();
    expect(columnSuggestion('$(items)', 8, PARAMETERS)).toBeNull();
  });

  it('`$(...)` 없이 적은 `목록.`은 참조가 아니므로 제안하지 않는다', () => {
    expect(columnSuggestion('SUM(items.', 10, PARAMETERS)).toBeNull();
    expect(columnSuggestion('SUM(items.a', 11, PARAMETERS)).toBeNull();
    expect(columnSuggestion('$(total) + items.', 17, PARAMETERS)).toBeNull();
  });

  it('예약 참조 뒤(`@item.`)와 앞 단계가 있는 경로(`$(a).$(items).`)는 목록 파라미터로 보지 않는다', () => {
    const parameters = [{ key: 'item', fields: [{ key: 'x', title: 'x' }] }, ...PARAMETERS];
    expect(columnSuggestion('@item.', 6, parameters)).toBeNull();
    expect(columnSuggestion('@item.$(items).', 15, parameters)).toBeNull();
    expect(columnSuggestion('$(a).$(items).', 14, parameters)).toBeNull();
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

  it('reserved를 지정한 예약 참조 경로는 예약 이름을 그대로 두고 뒤 단계만 감싼다', () => {
    const c = draft('');
    c.insertReference(['@item', 'amount'], { reserved: true });
    expect(c.draft).toBe('@item.$(amount)');
  });

  it('@item이라는 이름의 파라미터는 예약 참조가 아니라 $(@item)으로 넣는다', () => {
    const c = draft('');
    c.insertReference(['@item']);
    expect(c.draft).toBe('$(@item)');
    expect(evaluateFormula(c.draft, { values: { '@item': 5 } })).toBe(5);
  });

  it('초안의 나머지는 바꾸지 않고 커서 자리에 넣기만 한다', () => {
    const c = draftWithSelection('$(a) + ', 7);
    c.insertReference(['b']);
    expect(c.draft).toBe('$(a) + $(b)');
    expect(c.caret).toBe('$(a) + $(b)'.length);
  });

  it('커서가 초안 중간에 있어도 그 자리에 넣는다', () => {
    const c = draftWithSelection('SUM($(items).$(amount)) + $(qty)', 26);
    c.insertReference(['tax']);
    expect(c.draft).toBe('SUM($(items).$(amount)) + $(tax)$(qty)');
    expect(c.caret).toBe('SUM($(items).$(amount)) + $(tax)'.length);
  });

  it('선택한 범위는 지우고 그 자리에 넣는다', () => {
    const c = draftWithSelection('SUM($(old)) * $(rate)', 4, 10);
    c.insertReference(['items', 'amount']);
    expect(c.draft).toBe('SUM($(items).$(amount)) * $(rate)');
  });

  it('아직 끝나지 않은 식(`SUM(1, `) 뒤에도 그대로 넣는다 — 문법 검사가 나머지를 알린다', () => {
    const c = draftWithSelection('SUM(1, ', 7);
    c.insertReference(['b']);
    expect(c.draft).toBe('SUM(1, $(b)');
  });

  it('`$(...)` 없이 적은 참조가 있는 초안도 고쳐 쓰지 않고 넣기만 한다 — 문법 검사가 알린다', () => {
    const c = draftWithSelection('SUM(items.amount) + ', 20);
    c.insertReference(['tax']);
    expect(c.draft).toBe('SUM(items.amount) + $(tax)');
  });
});

describe('FormulaDraftController.complete — 자동완성 적용', () => {
  it('`$(목록).` 뒤에 `$(필드)`를 붙인다', () => {
    const c = draftWithSelection('SUM($(items).', 13);
    const found = columnSuggestion(c.draft, 13, PARAMETERS)!;
    c.complete(found.columns[0]!);
    expect(c.draft).toBe('SUM($(items).$(amount)');
    expect(c.caret).toBe('SUM($(items).$(amount)'.length);
  });

  it('점 뒤에 친 이름은 지우고 `$(필드)`로 바꾼다 — 식별자가 아닌 필드도 이스케이프해 넣는다', () => {
    const c = draftWithSelection('SUM($(items).u', 14);
    const found = columnSuggestion(c.draft, 14, PARAMETERS)!;
    c.complete(found.columns[0]!);
    expect(c.draft).toBe('SUM($(items).$(unit-price)');
  });

  it('연 `$(`까지 `$(필드)`로 바꾼다', () => {
    const c = draftWithSelection('SUM($(items).$(am', 17);
    const found = columnSuggestion(c.draft, 17, PARAMETERS)!;
    c.complete(found.columns[0]!);
    expect(c.draft).toBe('SUM($(items).$(amount)');
    expect(c.caret).toBe('SUM($(items).$(amount)'.length);
  });
});

/** 필드·바코드·텍스트·그리드가 `$(amount)`·`$(items).$(qty)`를 수식과 조건식에서 쓰는 양식 */
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
            formula: '$(amount) * 2 + SUM($(items).$(qty))',
            conditionalFormats: [{ condition: '$(amount) > 1', fontColor: '#FF0000' }],
          },
          {
            type: 'text', id: 't-1', name: 'note', position: { x: 10, y: 20 }, width: 40, height: 8,
            content: 'x', conditionalFormats: [{ condition: '$(amount) > 1', bold: true }],
          },
          {
            type: 'barcode', id: 'b-1', name: 'code', position: { x: 10, y: 30 }, width: 20, height: 20,
            kind: 'qrcode', formula: 'TEXT($(amount)',
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
              { row: 0, column: 0, formula: '$(amount)' },
              { row: 1, column: 0, parameter: 'qty' },
              { row: 1, column: 1, formula: '$(qty) * $(price)', conditionalFormats: [{ condition: '$(qty) > 1', bold: true }] },
              { row: 2, column: 0, formula: 'SUM(@page.$(qty)) + $(amount)' },
              { row: 2, column: 1, formula: 'SUM($(items).$(qty))' },
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
  it('요소·셀의 수식과 조건식에서 `$(키)` 참조를 모두 새 키로 바꾼다', () => {
    const file = makeFormulaFile();
    renameParameterReferences(file, 'amount', 'total');
    const [field, text] = elementsOf(file);
    expect(field!.formula).toBe('$(total) * 2 + SUM($(items).$(qty))');
    expect(conditionOf(field!)).toBe('$(total) > 1');
    expect(conditionOf(text!)).toBe('$(total) > 1');
    expect(cellsOf(file)[0]!.formula).toBe('$(total)');
    expect(cellsOf(file)[3]!.formula).toBe('SUM(@page.$(qty)) + $(total)');
  });

  it('식별자 규칙에 맞지 않는 새 이름도 `$(...)`로 적어 바뀐 데이터로 같은 값을 낸다', () => {
    const file = makeFormulaFile();
    renameParameterReferences(file, 'amount', 'total-amount');
    const field = elementsOf(file)[0]!;
    expect(field.formula).toBe('$(total-amount) * 2 + SUM($(items).$(qty))');
    expect(conditionOf(field)).toBe('$(total-amount) > 1');
    expect(evaluateFormula(field.formula as string, {
      values: { 'total-amount': 5, items: [{ qty: 1 }, { qty: 2 }] },
    })).toBe(13);
  });

  it('파싱할 수 없는 수식은 그대로 둔다', () => {
    const file = makeFormulaFile();
    renameParameterReferences(file, 'amount', 'total');
    expect(elementsOf(file)[2]!.formula).toBe('TEXT($(amount)');
  });

  it('`$(...)` 없이 적은 참조는 문법 오류라 이름을 바꾸지 않고 원문을 그대로 둔다', () => {
    const file = makeFormulaFile();
    (elementsOf(file)[0] as Loose).formula = 'amount * 2 + SUM(items.qty)';
    (elementsOf(file)[1] as Loose).conditionalFormats = [{ condition: 'amount > 1', bold: true }];
    renameParameterReferences(file, 'amount', 'total');
    expect(elementsOf(file)[0]!.formula).toBe('amount * 2 + SUM(items.qty)');
    expect(conditionOf(elementsOf(file)[1]!)).toBe('amount > 1');
  });

  it('앞부분만 겹치는 이름과 문자열·함수 이름은 바꾸지 않는다', () => {
    const file = makeFormulaFile();
    (elementsOf(file)[0] as Loose).formula = '$(amountExtra) + "amount" + SUM($(amount))';
    renameParameterReferences(file, 'amount', 'total');
    expect(elementsOf(file)[0]!.formula).toBe('$(amountExtra) + "amount" + SUM($(total))');
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

  it('`$(목록).$(필드)`, 그 그리드의 `@page.$(필드)`, 항목 구간 셀의 `$(필드)` 참조를 모두 바꾼다', () => {
    const file = makeFormulaFile();
    renameParameterFieldReferences(file, 'items', 'qty', 'count');
    expect(elementsOf(file)[0]!.formula).toBe('$(amount) * 2 + SUM($(items).$(count))');
    const cells = cellsOf(file);
    expect(cells[2]!.formula).toBe('$(count) * $(price)');
    expect(conditionOf(cells[2]!)).toBe('$(count) > 1');
    expect(cells[3]!.formula).toBe('SUM(@page.$(count)) + $(amount)');
    expect(cells[4]!.formula).toBe('SUM($(items).$(count))');
    // 항목 구간 밖 셀의 같은 이름은 하위 필드가 아니므로 바꾸지 않습니다.
    expect(cells[0]!.formula).toBe('$(amount)');
  });

  it('식별자가 아닌 새 필드 이름도 `$(...)`로 적는다', () => {
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
    expect(cellsOf(file)[2]!.formula).toBe('$(qty) * $(price)');
    expect(elementsOf(file)[0]!.formula).toBe('$(amount) * 2 + SUM($(items).$(qty))');
  });

  it('`$(...)` 없이 적은 하위 필드 참조는 문법 오류라 원문을 그대로 둔다', () => {
    const file = makeFormulaFile();
    (elementsOf(file)[0] as Loose).formula = 'SUM(items.qty)';
    (cellsOf(file)[3] as Loose).formula = 'SUM(@page.qty)';
    renameParameterFieldReferences(file, 'items', 'qty', 'count');
    expect(elementsOf(file)[0]!.formula).toBe('SUM(items.qty)');
    expect(cellsOf(file)[3]!.formula).toBe('SUM(@page.qty)');
  });
});

/** 값 없이 검사하는 입력 */
function checkOf(source: string, locale = 'ko') {
  return checkFormula({
    source,
    condition: false,
    emptyAllowed: false,
    locale,
    context: { values: { d: '2026-09-04' } },
    // 컴포넌트는 검사 로케일로 진단하므로 여기서도 같은 로케일을 넘깁니다.
    diagnose: (from, context) => diagnoseFormula(from, { ...context, locale }),
  });
}

describe('checkFormula — 명시 참조와 날짜 패턴 오류 분류', () => {
  it('`$이름`·`$()`·닫히지 않은 참조·형식 섞기는 문법 오류로 적용을 막는다', () => {
    for (const source of ['$amount', '$()', '$(amount', '$(a) + b', '$(a).b']) {
      const found = checkOf(source);
      expect(found.status, source).toBe('syntax-error');
      expect(found.applicable, source).toBe(false);
      expect(found.detail, source).toBeTruthy();
      expect(() => evaluateFormula(source, { values: {} })).toThrow(FormulaSyntaxError);
    }
  });

  it('`$(...)` 없이 적은 업무 값 참조는 문법 오류로 막고 바꿔 적을 예를 그대로 보여 준다', () => {
    const cases: [string, string[], boolean][] = [
      ['amount', ['amount'], false],
      ['items.amount', ['items', 'amount'], false],
      ['SUM(items.amount) + 1', ['items', 'amount'], false],
      ['@item.amount', ['@item', 'amount'], true],
      ['SUM(@page.amount)', ['@page', 'amount'], true],
    ];
    for (const [source, path, reserved] of cases) {
      for (const locale of ['ko', 'en', 'ja']) {
        const found = checkOf(source, locale);
        expect(found.status, `${locale}: ${source}`).toBe('syntax-error');
        expect(found.applicable, `${locale}: ${source}`).toBe(false);
        // 상태 문구는 core의 오류 문구를 그대로 쓰므로 바꿔 적을 `$(...)` 예가 함께 보입니다.
        expect(found.detail, `${locale}: ${source}`).toContain(formatReferencePath(path, { reserved }));
      }
      expect(() => evaluateFormula(source, { values: {} })).toThrow(FormulaSyntaxError);
    }
  });

  it('함수 이름·논리 상수·예약 참조 이름만 적은 것은 참조가 아니므로 문법 오류가 아니다', () => {
    for (const source of ['TRUE', 'AND(TRUE, FALSE)', 'COUNT(@all)', 'TODAY()']) {
      expect(checkOf(source).status, source).not.toBe('syntax-error');
    }
  });

  it('FORMAT_DATE 패턴 오류는 계산 오류로 알리고 적용은 허용한다', () => {
    for (const source of ['FORMAT_DATE($(d), "Date")', 'FORMAT_DATE($(d), "YYYY [년")']) {
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

  it('계산되지 않는 자리마다 검사 결과의 원인을 함께 남긴다', () => {
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

  it('파일에서 읽은 수식이 문법에 맞지 않으면 그 자리도 파서의 문구와 함께 남긴다', () => {
    const detail = "'items.amount' must be written as $(items).$(amount)";
    const warnings = collectFormulaWarnings({
      page,
      check: (_target: FormulaTarget, source: string) =>
        source === 'BAD'
          ? [{ status: 'syntax-error', applicable: false, detail }]
          : [{ status: 'ok', applicable: true }],
    });
    expect(warnings.elements).toEqual(new Set(['f1', 'g1']));
    expect(warnings.details.map((d) => d.message)).toEqual([detail, detail]);
  });
});
