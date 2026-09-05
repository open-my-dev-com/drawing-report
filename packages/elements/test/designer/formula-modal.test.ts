// @vitest-environment node
// 수식 모달의 계산 문맥·편집 대상·검사 판정
import { describe, expect, it } from 'vitest';
import {
  diagnoseFormula,
  evaluateFormula,
  planSourcePage,
  type GridElement,
  type GridItem,
  type SlipPage,
  type SourcePagePlan,
} from '@omdc-slipkit/core';
import { gridFormulaContext, sampleItemsOf } from '../../src/designer/formula-context.js';
import { checkFormula } from '../../src/designer/formula-check.js';
import {
  resolveFormulaTarget,
  verifyFormulaTarget,
  type FormulaTarget,
} from '../../src/designer/formula-target.js';

const PAPER = { width: 210, height: 297, padding: [10, 10, 10, 10] as const };

/** 항목 4개를 페이지당 2개씩 내는 그룹 그리드 */
function makeGrid(): GridElement {
  return {
    type: 'grid',
    id: 'g1',
    name: '품목 표',
    position: { x: 10, y: 10 },
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
      { row: 0, column: 1, content: '금액' },
      { row: 1, column: 0, parameter: 'itemName' },
      { row: 1, column: 1, formula: 'SUM(@page.$(amount))' },
    ],
  } as unknown as GridElement;
}

const SAMPLE_ITEMS: GridItem[] = [
  { category: '가', itemName: '연필', amount: 100 },
  { category: '가', itemName: '지우개', amount: 200 },
  { category: '나', itemName: '공책', amount: 400 },
  { category: '나', itemName: '자', amount: 800 },
];

function makePage(elements: unknown[]): SlipPage {
  return { elements } as unknown as SlipPage;
}

function planOf(grid: GridElement): SourcePagePlan {
  return planSourcePage(PAPER, makePage([grid]), new Map([[grid.id, SAMPLE_ITEMS]]));
}

const diagnose = (source: string, context: Parameters<typeof diagnoseFormula>[1]) =>
  diagnoseFormula(source, context);

describe('gridFormulaContext — 계산 문맥 공통 helper', () => {
  it('샘플 값에서 객체인 행만 항목으로 읽고 maxItems를 적용한다', () => {
    const grid = makeGrid();
    grid.repeat!.maxItems = 3;
    const sample = { items: [...SAMPLE_ITEMS, '문자열', 42] };
    expect(sampleItemsOf(grid, sample)).toHaveLength(4);

    expect(gridFormulaContext(grid, sample, null).realItems).toHaveLength(3);
  });

  it('고른 항목의 출력 페이지와 그룹을 다시 찾아 예약 참조를 바꾼다', () => {
    const grid = makeGrid();
    const context = gridFormulaContext(grid, { items: SAMPLE_ITEMS }, planOf(grid));
    const band = grid.repeat!.bands[1]!;

    const first = context.slotForItem(0, band);
    expect(first.outputPage).toBe(0);
    expect(first.groupIndex).toBe(0);
    expect(first.item).toEqual(SAMPLE_ITEMS[0]);
    expect(first.reserved!['@page']).toEqual([SAMPLE_ITEMS[0], SAMPLE_ITEMS[1]]);
    expect(first.reserved!['@carried']).toEqual([]);
    expect(first.reserved!['@group']).toEqual([SAMPLE_ITEMS[0], SAMPLE_ITEMS[1]]);

    const third = context.slotForItem(2, band);
    expect(third.outputPage).toBe(1);
    expect(third.groupIndex).toBe(1);
    expect(third.reserved!['@page']).toEqual([SAMPLE_ITEMS[2], SAMPLE_ITEMS[3]]);
    expect(third.reserved!['@carried']).toEqual([SAMPLE_ITEMS[0], SAMPLE_ITEMS[1]]);
    expect(third.reserved!['@all']).toEqual(SAMPLE_ITEMS);
  });

  it('샘플 항목마다 놓이는 출력 페이지와 그룹을 알려 준다', () => {
    const grid = makeGrid();
    const context = gridFormulaContext(grid, { items: SAMPLE_ITEMS }, planOf(grid));
    expect(context.itemCount).toBe(4);
    expect([0, 1, 2, 3].map((i) => context.choiceAt(i))).toEqual([
      { index: 0, outputPage: 0, groupIndex: 0 },
      { index: 1, outputPage: 0, groupIndex: 0 },
      { index: 2, outputPage: 1, groupIndex: 1 },
      { index: 3, outputPage: 1, groupIndex: 1 },
    ]);
    expect(context.choiceAt(4)).toBeUndefined();
  });

  it('항목을 바꾸면 같은 수식의 계산 결과가 달라진다', () => {
    const grid = makeGrid();
    const context = gridFormulaContext(grid, { items: SAMPLE_ITEMS }, planOf(grid));
    const band = grid.repeat!.bands[1]!;
    const valueAt = (index: number): unknown => {
      const slot = context.slotForItem(index, band);
      return evaluateFormula('SUM(@page.$(amount))', {
        values: { ...(slot.item ?? {}) },
        reserved: slot.reserved!,
      });
    };
    expect(valueAt(0)).toBe(300);
    expect(valueAt(2)).toBe(1200);
  });

  it('쓸 수 없는 예약 참조는 이유와 함께 알린다', () => {
    const plain = { ...makeGrid(), repeat: undefined } as GridElement;
    const noRepeat = gridFormulaContext(plain, {}, null);
    expect(noRepeat.availability({
      item: undefined, reserved: undefined, outputPage: undefined, groupIndex: undefined,
    })).toEqual([
      { name: '@item', usable: false, reason: 'not-repeat' },
      { name: '@group', usable: false, reason: 'not-repeat' },
      { name: '@page', usable: false, reason: 'not-repeat' },
      { name: '@all', usable: false, reason: 'not-repeat' },
      { name: '@carried', usable: false, reason: 'not-repeat' },
    ]);

    const grouped = makeGrid();
    const withPlan = gridFormulaContext(grouped, { items: SAMPLE_ITEMS }, planOf(grouped));
    const head = withPlan.slotForItem(0, grouped.repeat!.bands[0]!);
    const reasons = new Map(withPlan.availability(head).map((r) => [r.name, r]));
    // 헤더 행 구간은 항목을 가리키지 않으므로 `@item`과 `@group`을 낼 수 없습니다.
    expect(reasons.get('@item')).toEqual({ name: '@item', usable: false, reason: 'no-item' });
    expect(reasons.get('@group')).toEqual({ name: '@group', usable: false, reason: 'no-item' });
    expect(head.reserved!['@item']).toBeUndefined();
    expect(head.reserved!['@group']).toBeUndefined();
    // 페이지 범위는 그대로 남습니다.
    expect(head.outputPage).toBe(0);
    expect(reasons.get('@page')?.usable).toBe(true);

    const ungrouped = makeGrid();
    delete ungrouped.repeat!.groupBy;
    const noGroup = gridFormulaContext(ungrouped, { items: SAMPLE_ITEMS }, planOf(ungrouped));
    const item = noGroup.slotForItem(0, ungrouped.repeat!.bands[1]!);
    const noGroupReasons = new Map(noGroup.availability(item).map((r) => [r.name, r]));
    expect(noGroupReasons.get('@group')).toEqual({ name: '@group', usable: false, reason: 'no-group' });

    // 계획이 없으면 페이지·그룹 값을 지어내지 않고, 안내도 그 상태에 맞춥니다.
    const unplanned = gridFormulaContext(makeGrid(), { items: SAMPLE_ITEMS }, null);
    const slot = unplanned.slotForItem(0, grouped.repeat!.bands[1]!);
    expect(slot.reserved!['@page']).toBeUndefined();
    expect(slot.reserved!['@carried']).toBeUndefined();
    expect(slot.reserved!['@group']).toBeUndefined();
    expect(slot.reserved!['@item']).toEqual(SAMPLE_ITEMS[0]);
    const withoutPlan = new Map(unplanned.availability(slot).map((r) => [r.name, r]));
    expect(withoutPlan.get('@page')?.reason).toBe('no-plan');
    expect(withoutPlan.get('@carried')?.reason).toBe('no-plan');
    expect(withoutPlan.get('@group')?.reason).toBe('no-plan');
    expect(withoutPlan.get('@all')?.usable).toBe(true);
    expect(withoutPlan.get('@item')?.usable).toBe(true);
  });

  it('한 페이지에 그룹이 여럿이면 고른 항목이 속한 그룹의 인스턴스를 쓴다', () => {
    // 페이지당 4개라 그룹 두 개가 같은 출력 페이지에 들어갑니다.
    const grid = makeGrid();
    grid.repeat!.pagination = { mode: 'fixed', itemsPerPage: 4 };
    grid.rows = [{ height: 8 }, { height: 8 }, { height: 8 }];
    grid.repeat!.bands = [
      { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
      { id: 'b-gstart', fromRow: 1, toRow: 1, placement: 'group-start' },
      { id: 'b-item', fromRow: 2, toRow: 2, placement: 'item' },
    ];
    grid.cells = [
      { row: 0, column: 0, content: '품명' },
      { row: 1, column: 0, formula: 'SUM(@group.$(amount))' },
      { row: 2, column: 0, parameter: 'itemName' },
    ] as never;
    const context = gridFormulaContext(grid, { items: SAMPLE_ITEMS }, planOf(grid));
    const groupStart = grid.repeat!.bands[1]!;

    // 두 그룹이 같은 조각에 있으므로 첫 인스턴스를 집으면 항상 첫 그룹이 됩니다.
    const first = context.slotForItem(0, groupStart);
    expect(first.groupIndex).toBe(0);
    expect(first.reserved!['@item']).toEqual(SAMPLE_ITEMS[0]);
    expect(first.reserved!['@group']).toEqual([SAMPLE_ITEMS[0], SAMPLE_ITEMS[1]]);

    const third = context.slotForItem(2, groupStart);
    expect(third.groupIndex).toBe(1);
    expect(third.reserved!['@item']).toEqual(SAMPLE_ITEMS[2]);
    expect(third.reserved!['@group']).toEqual([SAMPLE_ITEMS[2], SAMPLE_ITEMS[3]]);
    expect(third.outputPage).toBe(0);
  });

  it('캔버스가 쓰는 계획 조각 예약 참조는 PDF 변환과 같은 값을 만든다', () => {
    const grid = makeGrid();
    const context = gridFormulaContext(grid, { items: SAMPLE_ITEMS }, planOf(grid));
    const fragment = context.fragmentAt(1)!;
    const planned = fragment.bands.find((b) => b.band.placement === 'item')!;
    const reserved = context.plannedReserved(fragment, planned);
    expect(reserved['@page']).toEqual([SAMPLE_ITEMS[2], SAMPLE_ITEMS[3]]);
    expect(reserved['@carried']).toEqual([SAMPLE_ITEMS[0], SAMPLE_ITEMS[1]]);
    expect(reserved['@item']).toEqual(SAMPLE_ITEMS[2]);
    expect(reserved['@group']).toEqual([SAMPLE_ITEMS[2], SAMPLE_ITEMS[3]]);
  });
});

describe('checkFormula — 저장 판정', () => {
  const base = { condition: false, emptyAllowed: false, locale: 'ko', context: { values: { a: 1 } }, diagnose };

  it('문법 오류와 샘플 값으로 계산할 수 없는 경우를 구분한다', () => {
    const broken = checkFormula({ ...base, source: 'SUM(1,' });
    expect(broken.status).toBe('syntax-error');
    expect(broken.applicable).toBe(false);

    // 문법은 맞고 지금 자리에 예약 참조가 없을 뿐이라 다른 자리에서는 계산될 수 있습니다.
    const missing = checkFormula({ ...base, source: 'SUM(@page.$(amount))' });
    expect(missing.status).toBe('not-computable');
    expect(missing.applicable).toBe(true);
  });

  it('인자 수가 틀린 수식은 어떤 데이터에서도 계산될 수 없어 적용을 막는다', () => {
    for (const source of ['IF(TRUE)', 'ROUND()', 'MID("가나다", 1)', 'AND()']) {
      const result = checkFormula({ ...base, source });
      expect(result.status, source).toBe('syntax-error');
      expect(result.applicable, source).toBe(false);
    }
    // 인자 수가 맞으면 값이 없어 계산되지 않을 뿐이라 적용은 허용합니다.
    expect(checkFormula({ ...base, source: 'SUM(@page.$(amount))' }).applicable).toBe(true);

    // AVG는 평균 낼 값이 없으면 데이터가 달라져도 계산되지 않으므로 인자가 있어야 합니다.
    expect(checkFormula({ ...base, source: 'AVG()' }).applicable).toBe(false);
    expect(checkFormula({ ...base, source: 'AVG(@page.$(amount))' }).applicable).toBe(true);
  });

  it('계산에 실패해도 원인을 알리고 적용은 허용한다', () => {
    const context = { values: { amount: 10, name: '연필' } };
    for (const source of [
      '1 / 0',
      '$(amount) / 0',
      'FORMAT_NUMBER($(amount), 21)',
      'MID($(name), 0, 1)',
      '1 / (0 * $(amount))',
      '1 / ($(amount) - $(amount))',
      'TO_NUMBER(CONCAT("a", $(amount)))',
      'FORMAT_NUMBER(1, ROUND(21 * $(amount) / $(amount)))',
    ]) {
      const result = checkFormula({ ...base, context, source });
      // 계산에 실패한 두 상태는 적용 허용과 경고 표시가 같습니다.
      expect(['formula-error', 'not-computable'], source).toContain(result.status);
      expect(result.applicable, source).toBe(true);
      expect(result.detail, source).toBeTruthy();
    }
  });

  it('값이 없어서만 계산하지 못한 수식도 원인을 알리고 적용을 허용한다', () => {
    for (const source of ['SUM(@page.$(amount))', 'SUM(@page.$(amount)) + $(a)', 'AVG(@group.$(amount))']) {
      const result = checkFormula({ ...base, source });
      expect(result.status, source).toBe('not-computable');
      expect(result.applicable, source).toBe(true);
    }
  });

  it('실행되지 않은 분기의 참조가 있어도 계산 실패는 그대로 알린다', () => {
    const context = { values: { amount: 10 } };
    for (const source of [
      'IF(TRUE, "not-a-number", $(amount)) + 1',
      'ROUND(IF(TRUE, "not-a-number", $(amount)), 2)',
      '1 / IF(TRUE, 0, $(amount))',
      'IF(FALSE, $(amount), "not-a-number") + 1',
    ]) {
      const result = checkFormula({ ...base, context, source });
      expect(result.status, source).toBe('formula-error');
      expect(result.applicable, source).toBe(true);
    }
  });

  it('문법·등록되지 않은 함수·인자 수 오류만 적용을 막는다', () => {
    for (const source of ['SUM(1,', 'NOPE(1)', 'IF(TRUE)', 'ROUND()', 'AND()']) {
      const result = checkFormula({ ...base, source });
      expect(result.status, source).toBe('syntax-error');
      expect(result.applicable, source).toBe(false);
    }
  });

  it('오류 문구는 넘긴 로케일을 따른다', () => {
    expect(checkFormula({ ...base, source: 'IF(TRUE)' }).detail).toContain('IF 함수의 인자는');
    expect(checkFormula({ ...base, locale: 'en', source: 'IF(TRUE)' }).detail)
      .toContain('The IF function takes');
  });

  it('계산에 성공하면 결과를 함께 돌려준다', () => {
    const ok = checkFormula({ ...base, source: 'ROUND(1.5) + 1' });
    expect(ok.status).toBe('ok');
    expect(ok.value).toBe(3);
    expect(ok.applicable).toBe(true);
  });

  it('조건식만 논리값인지 확인한다', () => {
    expect(checkFormula({ ...base, source: '1 + 1' }).status).toBe('ok');
    const notBoolean = checkFormula({ ...base, condition: true, source: '1 + 1' });
    expect(notBoolean.status).toBe('not-boolean');
    expect(notBoolean.applicable).toBe(false);
    expect(checkFormula({ ...base, condition: true, source: '$(a) > 0' }).status).toBe('ok');
  });

  it('빈 값은 대상에 따라 적용 여부가 갈린다', () => {
    expect(checkFormula({ ...base, source: '  ' }).applicable).toBe(false);
    expect(checkFormula({ ...base, source: '  ', emptyAllowed: true }).applicable).toBe(true);
  });
});

describe('verifyFormulaTarget — 모달 표시 중 대상 확인', () => {
  const field = {
    type: 'field', id: 'f1', name: '합계', position: { x: 0, y: 0 },
    width: 40, height: 8, formula: 'SUM($(items).$(amount))',
    conditionalFormats: [
      { condition: '$(amount) < 0', fontColor: '#FF0000' },
      { condition: '$(amount) > 100', fontColor: '#0000FF' },
    ],
  };
  const target: FormulaTarget = { kind: 'field', elementId: 'f1' };
  const origin = { formula: 'SUM($(items).$(amount))' };

  it('대상이 그대로면 다시 찾은 결과를 돌려준다', () => {
    const page = makePage([structuredClone(field)]);
    expect(verifyFormulaTarget(page, target, origin)).not.toBeNull();
  });

  it('대상 요소가 지워지면 적용을 막는다', () => {
    expect(verifyFormulaTarget(makePage([]), target, origin)).toBeNull();
  });

  it('요소 종류가 바뀌면 적용을 막는다', () => {
    const changed = structuredClone(field) as Record<string, unknown>;
    changed.type = 'text';
    expect(verifyFormulaTarget(makePage([changed]), target, origin)).toBeNull();
  });

  it('저장된 수식이 그 사이 바뀌면 적용을 막는다', () => {
    const changed = structuredClone(field);
    changed.formula = 'SUM($(items).$(qty))';
    expect(verifyFormulaTarget(makePage([changed]), target, origin)).toBeNull();
  });

  it('그리드 셀이 지워지거나 좌표가 달라지면 적용을 막는다', () => {
    const grid = {
      type: 'grid', id: 'g1', name: '표', position: { x: 0, y: 0 },
      rows: [{ height: 8 }], columns: [{ width: 40 }],
      cells: [{ row: 0, column: 0, formula: '1 + 1' }],
    };
    const cell: FormulaTarget = { kind: 'cell', elementId: 'g1', row: 0, column: 0 };
    expect(resolveFormulaTarget(makePage([grid]), cell)?.formula).toBe('1 + 1');

    const moved = structuredClone(grid);
    moved.cells[0]!.column = 1;
    expect(verifyFormulaTarget(makePage([moved]), cell, { formula: '1 + 1' })).toBeNull();
  });

  it('규칙 순서가 바뀌면 같은 순번의 다른 규칙에 덮어쓰지 않는다', () => {
    const rule: FormulaTarget = {
      kind: 'element-condition', elementId: 'f1', elementType: 'field', ruleIndex: 0,
    };
    const ruleOrigin = { formula: '$(amount) < 0', rule: field.conditionalFormats[0]! };
    expect(verifyFormulaTarget(makePage([structuredClone(field)]), rule, ruleOrigin)).not.toBeNull();

    const swapped = structuredClone(field);
    swapped.conditionalFormats.reverse();
    expect(verifyFormulaTarget(makePage([swapped]), rule, ruleOrigin)).toBeNull();
  });

  it('조건식이 같아도 색이 달라지면 다른 규칙으로 본다', () => {
    const rule: FormulaTarget = {
      kind: 'element-condition', elementId: 'f1', elementType: 'field', ruleIndex: 0,
    };
    const recolored = structuredClone(field);
    recolored.conditionalFormats[0]!.fontColor = '#00FF00';
    expect(verifyFormulaTarget(makePage([recolored]), rule, {
      formula: '$(amount) < 0', rule: field.conditionalFormats[0]!,
    })).toBeNull();
  });
});
