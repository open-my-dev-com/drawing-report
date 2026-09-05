import { describe, expect, it } from 'vitest';
import { convertSlipFile } from '../src/render/convert.js';
import {
  CURRENT_SCHEMA_VERSION,
  SlipLayoutError,
  planGrid,
  planSourcePage,
  type GridBand,
  type GridElement,
  type GridFlow,
  type GridPagination,
  type SlipElement,
  type SlipPage,
  type SlipVoucherFile,
} from '../src/index.js';

// A4·여백 15 → 흐름 영역 15~282mm(267mm). 첫 페이지의 남은 공간은 282 - position.y다.
const PAPER = { width: 210, height: 297, padding: [15, 15, 15, 15] as const };
const FLOW_TOP = 15;
const FLOW_BOTTOM = 282;

/** 행 구간 리터럴을 짧게 만든다. */
function band(id: string, row: number, placement: GridBand['placement'], extra?: Partial<GridBand>): GridBand {
  return { id, fromRow: row, toRow: row, placement, ...extra };
}

/** `position.y`에서 시작하는 절대 배치 흐름. */
function flowAt(y: number): GridFlow {
  return { firstPage: 0, firstTop: y, top: FLOW_TOP, bottom: FLOW_BOTTOM };
}

function items(count: number, group = 'A'): { name: string; amount: number; g: string }[] {
  return Array.from({ length: count }, (_, i) => ({ name: `p${i + 1}`, amount: (i + 1) * 1000, g: group }));
}

/**
 * 행 구간 5종(before-data·page-start·item·after-data·page-end, 각 8mm)을 가진 그리드.
 * 첫 페이지 머리 16 + 꼬리 예약 8 = 24, 항목 8, 마지막 페이지 꼬리 16.
 */
function grid5(
  pagination: GridPagination,
  y: number,
  options: { id?: string; itemHeight?: number; headerPages?: GridBand['pages']; cells?: GridElement['cells'] } = {},
): GridElement {
  return {
    type: 'grid',
    id: options.id ?? 'g',
    name: '표',
    position: { x: 15, y },
    columns: [{ width: 30 }, { width: 30 }, { width: 30 }, { width: 30 }],
    rows: [8, 8, options.itemHeight ?? 8, 8, 8].map((height) => ({ height })),
    cells: options.cells ?? [],
    repeat: {
      parameter: 'items',
      bands: [
        band('b', 0, 'before-data'),
        band('h', 1, 'page-start', options.headerPages === undefined ? {} : { pages: options.headerPages }),
        band('i', 2, 'item'),
        band('a', 3, 'after-data'),
        band('pe', 4, 'page-end'),
      ],
      pagination,
    },
  };
}

/** 그룹 시작·종료 구간을 더한 7종(각 8mm) 그리드. 그룹 첫 항목 블록 16, 항목 8, 마지막 항목 블록 16. */
function grid7(
  pagination: GridPagination,
  y: number,
  options: { itemHeight?: number; repeatOnPageBreak?: boolean } = {},
): GridElement {
  return {
    type: 'grid',
    id: 'g',
    name: '표',
    position: { x: 15, y },
    columns: [{ width: 60 }],
    rows: [8, 8, 8, options.itemHeight ?? 8, 8, 8, 8].map((height) => ({ height })),
    cells: [],
    repeat: {
      parameter: 'items',
      bands: [
        band('b', 0, 'before-data'),
        band('h', 1, 'page-start'),
        band('gs', 2, 'group-start', { repeatOnPageBreak: options.repeatOnPageBreak ?? true }),
        band('i', 3, 'item'),
        band('ge', 4, 'group-end'),
        band('a', 5, 'after-data'),
        band('pe', 6, 'page-end'),
      ],
      pagination,
      groupBy: ['g'],
    },
  };
}

/** 조각의 행 구간 placement 목록 (배치 순서). 빈 항목은 `item(empty)`로 표시한다. */
function placements(plan: ReturnType<typeof planGrid>, fragment: number): string[] {
  return plan.fragments[fragment]!.bands.map((planned) =>
    planned.emptyItem === true ? 'item(empty)' : planned.band.placement,
  );
}

const AUTO0: GridPagination = { mode: 'auto', minItems: 0 };
const AUTO3: GridPagination = { mode: 'auto', minItems: 3 };
const FIXED3: GridPagination = { mode: 'fixed', itemsPerPage: 3 };

describe('절대 배치 반복 그리드의 시작 이동 (planGrid)', () => {
  it('자동 확장: 첫 페이지에 첫 항목이 들어가지 않으면 빈 조각 없이 다음 페이지 상단에서 시작한다', () => {
    // 남은 공간 28: 머리 16 + 꼬리 8은 들어가지만 항목 8은 들어가지 않는다.
    const plan = planGrid(grid5(AUTO0, 254), items(2), flowAt(254));
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, height: 48, pageItems: [0, 1], carriedCount: 0 });
    // before-data와 page-start는 첫 페이지에서 소비되지 않고 첫 실제 조각과 함께 움직인다.
    expect(placements(plan, 0)).toEqual(['before-data', 'page-start', 'item', 'item', 'after-data', 'page-end']);
  });

  it('고정 페이지: 묶음이 첫 페이지에 들어가지 않으면 다음 페이지에서 정확히 N자리로 시작한다', () => {
    const plan = planGrid(grid5(FIXED3, 254), items(2), flowAt(254));
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, height: 56, pageItems: [0, 1], carriedCount: 0 });
    expect(placements(plan, 0)).toEqual([
      'before-data', 'page-start', 'item', 'item', 'item(empty)', 'after-data', 'page-end',
    ]);
  });

  it('머리 구간조차 들어가지 않는 첫 페이지도 오류 없이 다음 페이지에서 시작한다', () => {
    // 남은 공간 20 < 머리 16 + 꼬리 8.
    for (const pagination of [AUTO0, AUTO3, FIXED3]) {
      const plan = planGrid(grid5(pagination, 262), items(1), flowAt(262));
      expect(plan.fragments).toHaveLength(1);
      expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, carriedCount: 0, pageItems: [0] });
      expect(placements(plan, 0)[0]).toBe('before-data');
    }
  });

  it('minItems의 빈 항목도 첫 실제 조각에 함께 배치된다', () => {
    const plan = planGrid(grid5(AUTO3, 254), items(1), flowAt(254));
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]!.outputPage).toBe(1);
    expect(placements(plan, 0)).toEqual([
      'before-data', 'page-start', 'item', 'item(empty)', 'item(empty)', 'after-data', 'page-end',
    ]);
  });

  it("pages: 'first' 헤더는 첫 실제 조각에만 나온다", () => {
    // 옮긴 뒤 두 페이지에 걸치는 데이터: 2페이지 머리 16 + 항목 8×n + 꼬리 8.
    const plan = planGrid(grid5(AUTO0, 254, { headerPages: 'first' }), items(40), flowAt(254));
    expect(plan.fragments.length).toBeGreaterThan(1);
    expect(plan.fragments[0]!.outputPage).toBe(1);
    expect(placements(plan, 0).slice(0, 2)).toEqual(['before-data', 'page-start']);
    expect(placements(plan, 1)).not.toContain('page-start');
    expect(plan.fragments[1]!.outputPage).toBe(2);
  });

  it('항목 하나가 정확히 들어가는 경계에서는 기존 분할 규칙이 그대로 적용된다', () => {
    // 남은 공간 32 = 머리 16 + 항목 8 + 꼬리 8.
    const plan = planGrid(grid5(AUTO0, 250), items(2), flowAt(250));
    expect(plan.fragments).toHaveLength(2);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 0, y: 250, pageItems: [0], carriedCount: 0 });
    expect(placements(plan, 0)).toEqual(['before-data', 'page-start', 'item', 'page-end']);
    expect(plan.fragments[1]).toMatchObject({ outputPage: 1, y: FLOW_TOP, pageItems: [1], carriedCount: 1 });
    expect(placements(plan, 1)).toEqual(['page-start', 'item', 'after-data', 'page-end']);
  });

  it('고정 페이지 묶음이 정확히 들어가는 경계에서는 첫 페이지에 배치한다', () => {
    // 1페이지 전체 = 머리 16 + 항목 3×8 + 꼬리 16 = 56 → y=226이 경계다.
    const fits = planGrid(grid5(FIXED3, 226), items(2), flowAt(226));
    expect(fits.fragments).toHaveLength(1);
    expect(fits.fragments[0]).toMatchObject({ outputPage: 0, y: 226, height: 56 });
    const shifted = planGrid(grid5(FIXED3, 227), items(2), flowAt(227));
    expect(shifted.fragments).toHaveLength(1);
    expect(shifted.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, height: 56 });
  });

  it('머리·꼬리 구간이 없는 그리드도 높이 0 조각을 만들지 않고 시작을 옮긴다', () => {
    const only: GridElement = {
      type: 'grid', id: 'g', name: '표', position: { x: 15, y: 30 },
      columns: [{ width: 30 }], rows: [{ height: 267 }], cells: [],
      repeat: { parameter: 'items', bands: [band('i', 0, 'item')], pagination: AUTO0 },
    };
    const plan = planGrid(only, items(2), flowAt(30));
    expect(plan.fragments.map((f) => [f.outputPage, f.y, f.height, f.pageItems])).toEqual([
      [1, FLOW_TOP, 267, [0]],
      [2, FLOW_TOP, 267, [1]],
    ]);
  });
});

describe('그룹이 있는 그리드의 시작 이동', () => {
  const data = [...items(3, 'A'), ...items(2, 'B')];

  it('그룹 시작 블록이 첫 페이지에 들어가면 그룹은 그대로 갈라지고 시작 구간을 다시 표시한다', () => {
    // 남은 공간 44 = 머리 16 + (group-start 8 + 항목 8) + 꼬리 8 + 4 여유.
    const plan = planGrid(grid7(AUTO0, 238), data, flowAt(238));
    expect(plan.fragments).toHaveLength(2);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 0, y: 238, pageItems: [0], carriedCount: 0 });
    expect(placements(plan, 0)).toEqual(['before-data', 'page-start', 'group-start', 'item', 'page-end']);
    expect(plan.fragments[1]).toMatchObject({ outputPage: 1, pageItems: [1, 2, 3, 4], carriedCount: 1 });
    expect(placements(plan, 1)).toEqual([
      'page-start', 'group-start', 'item', 'item', 'group-end',
      'group-start', 'item', 'item', 'group-end', 'after-data', 'page-end',
    ]);
    expect(plan.fragments[1]!.bands[1]).toMatchObject({ band: { id: 'gs' }, itemIndex: 0, groupIndex: 0 });
  });

  it('그룹 시작 블록이 첫 페이지에 들어가지 않으면 그룹 전체가 다음 페이지에서 시작한다', () => {
    const plan = planGrid(grid7(AUTO0, 254), data, flowAt(254));
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, pageItems: [0, 1, 2, 3, 4], carriedCount: 0 });
    expect(placements(plan, 0).slice(0, 4)).toEqual(['before-data', 'page-start', 'group-start', 'item']);
  });

  it('고정 페이지 그룹도 같은 규칙으로 시작을 옮긴다', () => {
    const plan = planGrid(grid7(FIXED3, 238), data, flowAt(238));
    expect(plan.fragments).toHaveLength(2);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, pageItems: [0, 1, 2], carriedCount: 0 });
    expect(plan.fragments[1]).toMatchObject({ outputPage: 2, pageItems: [3, 4], carriedCount: 3 });
  });
});

describe('빈 페이지 전체에도 들어가지 않는 구성의 오류', () => {
  const emptyPage = /full flow area of an empty page/;
  const firstPage = /remaining space of the first page/;

  it('항목이 빈 페이지 전체보다 크면 빈 조각 없이 바로 항목 오류를 반환한다', () => {
    for (const pagination of [AUTO0, AUTO3]) {
      const grid = grid5(pagination, 30, { itemHeight: 270 });
      expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(SlipLayoutError);
      expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(/An item area/);
      expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(emptyPage);
      expect(() => planGrid(grid, items(1), flowAt(30))).not.toThrow(firstPage);
    }
    let caught: unknown;
    try { planGrid(grid5(AUTO0, 30, { itemHeight: 270 }), items(1), flowAt(30)); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ elementId: 'g', bandId: 'i' });
  });

  it('머리 구간이 붙어 빈 페이지에 들어가지 않는 항목도 첫 페이지에 아무것도 남기지 않고 오류다', () => {
    // 2페이지 전체 267 < before-data 8 + page-start 8 + 항목 250 + page-end 8.
    expect(() => planGrid(grid5(AUTO0, 30, { itemHeight: 250 }), items(1), flowAt(30))).toThrow(emptyPage);
  });

  it('그룹 시작 구간이 붙은 항목 블록이 빈 페이지에 들어가지 않으면 그룹 시작 블록 오류를 반환한다', () => {
    const grid = grid7(AUTO0, 30, { itemHeight: 240 });
    expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(SlipLayoutError);
    expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(/carries the group start band/);
    expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(emptyPage);
  });

  it('고정 페이지 묶음이 빈 페이지에 들어가지 않으면 빈 페이지 기준 오류를 반환한다', () => {
    const grid = grid5(FIXED3, 30, { itemHeight: 100 });
    expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(/itemsPerPage 3/);
    expect(() => planGrid(grid, items(1), flowAt(30))).toThrow(emptyPage);
  });

  it('머리·꼬리 구간이 빈 페이지에 들어가지 않으면 빈 페이지 기준 구간 오류를 반환한다', () => {
    const grid = grid5(AUTO0, 254);
    grid.rows[0] = { height: 262 };
    expect(() => planGrid(grid, items(1), flowAt(254))).toThrow(/fixed row bands/);
    expect(() => planGrid(grid, items(1), flowAt(254))).toThrow(emptyPage);
  });

  it('데이터가 없는 절대 배치 그리드는 첫 페이지 남은 공간 기준 오류를 그대로 반환한다', () => {
    expect(() => planGrid(grid5(FIXED3, 254), [], flowAt(254))).toThrow(/itemsPerPage 3/);
    expect(() => planGrid(grid5(FIXED3, 254), [], flowAt(254))).toThrow(firstPage);
    expect(() => planGrid(grid5(AUTO0, 262), [], flowAt(262))).toThrow(/fixed row bands/);
    expect(() => planGrid(grid5(AUTO0, 262), [], flowAt(262))).toThrow(firstPage);
  });

  it('로케일에 따라 공간 표현이 바뀐다', () => {
    expect(() => planGrid(grid5(FIXED3, 254), [], flowAt(254), 'ko')).toThrow(/첫 페이지의 남은 공간/);
    expect(() => planGrid(grid5(FIXED3, 30, { itemHeight: 100 }), items(1), flowAt(30), 'ko')).toThrow(/빈 페이지의 흐름 영역 전체/);
    expect(() => planGrid(grid5(FIXED3, 254), [], flowAt(254), 'ja')).toThrow(/最初のページの残り領域/);
    expect(() => planGrid(grid5(FIXED3, 30, { itemHeight: 100 }), items(1), flowAt(30), 'ja')).toThrow(/空ページのフロー領域全体/);
  });
});

describe('데이터가 없는 그리드는 시작을 옮기지 않는다', () => {
  it('고정 페이지 데이터 0건은 position.y에서 빈 항목 N개로 한 조각을 만든다', () => {
    const plan = planGrid(grid5(FIXED3, 20), [], flowAt(20));
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 0, y: 20, pageItems: [], carriedCount: 0 });
    expect(placements(plan, 0)).toEqual([
      'before-data', 'page-start', 'item(empty)', 'item(empty)', 'item(empty)', 'after-data', 'page-end',
    ]);
  });

  it('자동 확장 minItems 3 데이터 0건은 고정 페이지 0건과 같은 한 조각이다', () => {
    const plan = planGrid(grid5(AUTO3, 20), [], flowAt(20));
    expect(plan.fragments).toHaveLength(1);
    expect(placements(plan, 0)).toEqual([
      'before-data', 'page-start', 'item(empty)', 'item(empty)', 'item(empty)', 'after-data', 'page-end',
    ]);
  });

  it('자동 확장 minItems 0 데이터 0건은 고정 구간만으로 한 조각이다', () => {
    // 남은 공간 32 = 최종 구간 전체(before-data·page-start·after-data·page-end).
    const plan = planGrid(grid5(AUTO0, 250), [], flowAt(250));
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 0, y: 250, height: 32 });
    expect(placements(plan, 0)).toEqual(['before-data', 'page-start', 'after-data', 'page-end']);
  });

  it('데이터 0건에서 최종 구간이 첫 페이지에 들어가지 않으면 시작을 옮기지 않고 새 마지막 페이지를 만든다', () => {
    // 남은 공간 28 < 32 — 첫 페이지는 비최종 구간으로 마감하고 after-data는 다음 페이지로 간다.
    const plan = planGrid(grid5(AUTO0, 254), [], flowAt(254));
    expect(plan.fragments.map((f) => [f.outputPage, f.y])).toEqual([[0, 254], [1, FLOW_TOP]]);
    expect(placements(plan, 0)).toEqual(['before-data', 'page-start', 'page-end']);
    expect(placements(plan, 1)).toEqual(['page-start', 'after-data', 'page-end']);
  });

  it('after 배치 흐름은 데이터가 없어도 첫 페이지에 들어가지 않으면 시작을 옮긴다', () => {
    const plan = planGrid(grid5(FIXED3, 0), [], { ...flowAt(254), allowStartShift: true });
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, height: 56 });
  });
});

describe('양식 페이지 계획과 렌더링에서의 시작 이동', () => {
  const extras: SlipElement[] = [
    { type: 'text', id: 't-first', name: 'first', position: { x: 15, y: 10 }, width: 50, height: 5, content: 'FIRST',
      pagePlacement: { mode: 'absolute', pages: 'first' } },
    { type: 'text', id: 't-last', name: 'last', position: { x: 70, y: 10 }, width: 50, height: 5, content: 'LAST',
      pagePlacement: { mode: 'absolute', pages: 'last' } },
    { type: 'text', id: 't-cont', name: 'cont', position: { x: 15, y: 20 }, width: 50, height: 5, content: 'CONT',
      pagePlacement: { mode: 'absolute', pages: 'continuation' } },
    { type: 'text', id: 't-nonfinal', name: 'nonfinal', position: { x: 80, y: 20 }, width: 50, height: 5, content: 'NONFINAL',
      pagePlacement: { mode: 'absolute', pages: 'non-final' } },
    { type: 'text', id: 't-after', name: 'after', position: { x: 15, y: 25 }, width: 50, height: 5, content: 'AFTER-EL',
      pagePlacement: { mode: 'after', target: 'g', gap: 2 } },
  ];

  it('첫 페이지에는 조각이 없고 출력 페이지 수는 실제 조각으로 정해진다', () => {
    const page: SlipPage = { elements: [grid5(AUTO0, 254), ...extras] };
    const plan = planSourcePage(PAPER, page, new Map([['g', items(2)]]));
    expect(plan.outputPageCount).toBe(2);
    const fragments = plan.gridPlans.get('g')!.fragments;
    expect(fragments.map((f) => f.outputPage)).toEqual([1]);
    // after 요소는 첫 실제 조각(y 15, 높이 48) 뒤 2mm에 놓인다.
    expect(plan.afterPlacements.get('t-after')).toEqual({ outputPage: 1, y: 65 });
  });

  it('첫 페이지에 겹침 검사 사각형을 남기지 않는다', () => {
    // g가 예전에 빈 조각을 남기던 자리(y 254~278)에 다른 독립 그리드가 닿아도 겹침이 아니다.
    const other: GridElement = {
      type: 'grid', id: 'g2', name: '표2', position: { x: 15, y: 200 },
      columns: [{ width: 30 }], rows: [{ height: 10 }], cells: [],
      repeat: { parameter: 'items', bands: [band('i2', 0, 'item')], pagination: AUTO0 },
    };
    const page: SlipPage = { elements: [grid5(AUTO0, 254), other] };
    const plan = planSourcePage(PAPER, page, new Map([['g', items(2)], ['g2', items(7)]]));
    expect(plan.gridPlans.get('g2')!.fragments[0]).toMatchObject({ outputPage: 0, y: 200, height: 70 });
    expect(plan.gridPlans.get('g')!.fragments[0]!.outputPage).toBe(1);
  });

  it('after 배치로 줄어든 시작에서도 같은 규칙으로 옮긴다', () => {
    const anchor: SlipElement = {
      type: 'text', id: 'anchor', name: 'A', position: { x: 15, y: 246 }, width: 50, height: 8, content: 'ANCHOR',
      pagePlacement: { mode: 'absolute', pages: 'first' },
    };
    const grid: GridElement = { ...grid5(FIXED3, 0), pagePlacement: { mode: 'after', target: 'anchor', gap: 0 } };
    const plan = planSourcePage(PAPER, { elements: [anchor, grid] }, new Map([['g', items(2)]]));
    expect(plan.outputPageCount).toBe(2);
    expect(plan.gridPlans.get('g')!.fragments[0]).toMatchObject({ outputPage: 1, y: FLOW_TOP, height: 56 });
  });

  /** 반복 그리드 하나와 부가 요소로 이루어진 전표. */
  function voucher(grid: GridElement, values: SlipVoucherFile['values'], elements: SlipElement[] = []): SlipVoucherFile {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: {
        meta: { title: '시작 이동' },
        paper: { width: PAPER.width, height: PAPER.height, padding: [...PAPER.padding] },
        pages: [{ elements: [grid, ...elements], pageNumber: { position: 'bottom-center', format: '{n}/{total}' } }],
        assets: [],
      },
      values,
      issued: false,
    };
  }

  type Schema = { name: string; type: string; position: { x: number; y: number } };

  it('데이터가 있는 전표에서 page-end의 AVG(@page)는 그리드 위치와 무관하게 성공한다', () => {
    const grid = grid5(AUTO0, 254, {
      cells: [
        { row: 1, column: 0, content: 'HDR' },
        { row: 2, column: 0, parameter: 'name' },
        { row: 2, column: 1, parameter: 'amount' },
        { row: 4, column: 0, formula: 'AVG(@page.$(amount))' },
        { row: 4, column: 1, formula: 'SUM(@carried.$(amount))' },
      ],
    });
    const { template, inputs } = convertSlipFile(voucher(grid, { items: items(2) }, extras));
    const schemas = template.schemas as Schema[][];
    expect(schemas).toHaveLength(2);
    const cellNames = (page: number): string[] =>
      schemas[page]!.filter((s) => s.name.includes('__cell-')).map((s) => s.name);
    // 첫 페이지에는 그리드 셀도 괘선도 없다.
    expect(cellNames(0)).toEqual([]);
    expect(schemas[0]!.filter((s) => s.type === 'line')).toEqual([]);
    const values = inputs[0]!;
    // page-end 행은 2페이지 y = 15 + before-data 8 + page-start 8 + 항목 16 + after-data 8.
    const cellValue = (page: number, x: number, y: number): unknown => {
      const schema = schemas[page]!.find((s) =>
        s.name.includes('__cell-') && s.position.x === x && s.position.y === y);
      expect(schema).toBeDefined();
      return values[schema!.name];
    };
    expect(cellValue(1, 15, 55)).toBe('1500');
    expect(cellValue(1, 45, 55)).toBe('0');
    // 페이지 번호와 표시 페이지 필터는 실제 출력 페이지 수(2)를 따른다.
    expect(values['__page-number-0']).toBe('1/2');
    expect(values['__page-number-1']).toBe('2/2');
    const names = (page: number): string[] => schemas[page]!.map((s) => s.name);
    expect(names(0)).toEqual(expect.arrayContaining(['t-first', 't-nonfinal']));
    expect(names(0)).not.toEqual(expect.arrayContaining(['t-last']));
    expect(names(0)).not.toEqual(expect.arrayContaining(['t-cont']));
    expect(names(0)).not.toEqual(expect.arrayContaining(['t-after']));
    expect(names(1)).toEqual(expect.arrayContaining(['t-last', 't-cont', 't-after']));
    expect(names(1)).not.toEqual(expect.arrayContaining(['t-first']));
    expect(schemas[1]!.find((s) => s.name === 't-after')!.position.y).toBe(65);
  });
});
