import { describe, expect, it } from 'vitest';
import {
  SlipLayoutError,
  filterVisibleOnPage,
  planGrid,
  planSourcePage,
  type GridBand,
  type GridElement,
  type GridFlow,
  type GridPagination,
  type SlipElement,
  type SlipPage,
} from '../src/index.js';

/** 행 구간 리터럴을 짧게 만든다. */
function band(
  id: string,
  fromRow: number,
  toRow: number,
  placement: GridBand['placement'],
  extra?: Partial<GridBand>,
): GridBand {
  return { id, fromRow, toRow, placement, ...extra };
}

/** 계획 테스트용 반복 그리드. 행 높이는 목록 그대로, 열은 50mm 한 개다. */
function makeGrid(options: {
  id?: string;
  rows: number[];
  bands: GridBand[];
  pagination: GridPagination;
  groupBy?: string[];
  maxItems?: number;
  position?: { x: number; y: number };
}): GridElement {
  return {
    type: 'grid',
    id: options.id ?? 'g',
    name: '표',
    position: options.position ?? { x: 15, y: 20 },
    rows: options.rows.map((height) => ({ height })),
    columns: [{ width: 50 }],
    cells: [],
    repeat: {
      parameter: 'items',
      bands: options.bands,
      pagination: options.pagination,
      ...(options.groupBy === undefined ? {} : { groupBy: options.groupBy }),
      ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
    },
  };
}

/** 첫 페이지는 y=20부터(70mm), 이어지는 페이지는 y=10부터(80mm) 쓰는 흐름. */
const FLOW: GridFlow = { firstPage: 0, firstTop: 20, top: 10, bottom: 90 };

function items(count: number, group = 'A'): { 금액: number; g: string }[] {
  return Array.from({ length: count }, (_, i) => ({ 금액: (i + 1) * 1000, g: group }));
}

/** 조각의 행 구간 placement 목록 (배치 순서) */
function placements(plan: ReturnType<typeof planGrid>, fragment: number): string[] {
  return plan.fragments[fragment]!.bands.map((planned) => planned.band.placement);
}

/** 헤더(page-start) + 항목 1행 + 합계(after-data) 그리드 */
function headerItemTail(pagination: GridPagination): GridElement {
  return makeGrid({
    rows: [10, 10, 10],
    bands: [
      band('h', 0, 0, 'page-start'),
      band('i', 1, 1, 'item'),
      band('t', 2, 2, 'after-data'),
    ],
    pagination,
  });
}

describe('그리드 페이지 계획 (planGrid)', () => {
  it('반복 설정이 없는 그리드는 첫 페이지에 조각 하나로 배치한다', () => {
    const grid: GridElement = {
      type: 'grid', id: 's', name: '고정', position: { x: 15, y: 20 },
      rows: [{ height: 10 }, { height: 10 }], columns: [{ width: 50 }], cells: [],
    };
    const plan = planGrid(grid, [], FLOW);
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 0, y: 20, height: 20 });
    expect(plan.itemCount).toBe(0);
  });

  it('자동 확장 데이터 0건·minItems 0은 항목 없이 고정 구간만 배치한다', () => {
    const plan = planGrid(headerItemTail({ mode: 'auto', minItems: 0 }), [], FLOW);
    expect(plan.fragments).toHaveLength(1);
    expect(placements(plan, 0)).toEqual(['page-start', 'after-data']);
    expect(plan.fragments[0]!.height).toBe(20);
    expect(plan.fragments[0]!.pageItems).toEqual([]);
  });

  it('자동 확장에서 minItems 미만 데이터는 빈 항목으로 채운다', () => {
    const plan = planGrid(headerItemTail({ mode: 'auto', minItems: 5 }), items(2), FLOW);
    expect(plan.fragments).toHaveLength(1);
    expect(placements(plan, 0)).toEqual([
      'page-start', 'item', 'item', 'item', 'item', 'item', 'after-data',
    ]);
    // 실제 항목은 2개뿐이고 나머지 3개는 빈 항목이다.
    expect(plan.fragments[0]!.pageItems).toEqual([0, 1]);
    expect(plan.fragments[0]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(3);
  });

  it('자동 확장에서 minItems와 같거나 많은 데이터는 빈 항목을 만들지 않는다', () => {
    const same = planGrid(headerItemTail({ mode: 'auto', minItems: 3 }), items(3), FLOW);
    expect(same.fragments[0]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(0);
    const more = planGrid(headerItemTail({ mode: 'auto', minItems: 3 }), items(5), FLOW);
    expect(more.fragments[0]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(0);
    expect(more.fragments[0]!.pageItems).toEqual([0, 1, 2, 3, 4]);
  });

  it('자동 확장은 공간이 차면 페이지를 넘기고, 남은 전체가 들어가는 페이지가 마지막이다', () => {
    const plan = planGrid(headerItemTail({ mode: 'auto', minItems: 0 }), items(10), FLOW);
    expect(plan.fragments).toHaveLength(2);
    // 첫 페이지: 70mm에 헤더 10 + 항목 6개(60mm)
    expect(plan.fragments[0]!.pageItems).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.fragments[0]!.y).toBe(20);
    expect(plan.fragments[0]!.height).toBe(70);
    // 이어지는 페이지는 흐름 영역 위(10mm)부터 시작하고 합계가 마지막에 붙는다
    expect(plan.fragments[1]!.outputPage).toBe(1);
    expect(plan.fragments[1]!.y).toBe(10);
    expect(plan.fragments[1]!.pageItems).toEqual([6, 7, 8, 9]);
    expect(placements(plan, 1)).toEqual(['page-start', 'item', 'item', 'item', 'item', 'after-data']);
  });

  it('고정 페이지 데이터 0건은 빈 항목만으로 한 페이지를 만든다', () => {
    const plan = planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 3 }), [], FLOW);
    expect(plan.fragments).toHaveLength(1);
    expect(placements(plan, 0)).toEqual(['page-start', 'item', 'item', 'item', 'after-data']);
    expect(plan.fragments[0]!.pageItems).toEqual([]);
    expect(plan.fragments[0]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(3);
  });

  it('고정 페이지는 한 페이지 미만 데이터를 빈 항목으로 채우고, 같은 수면 채우지 않는다', () => {
    const less = planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 4 }), items(2), FLOW);
    expect(less.fragments).toHaveLength(1);
    expect(less.fragments[0]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(2);
    const exact = planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 4 }), items(4), FLOW);
    expect(exact.fragments).toHaveLength(1);
    expect(exact.fragments[0]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(0);
  });

  it('고정 페이지는 여러 페이지로 나뉘고 마지막 페이지만 빈 항목을 채운다', () => {
    const plan = planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 4 }), items(10), FLOW);
    expect(plan.fragments).toHaveLength(3);
    expect(plan.fragments.map((f) => f.pageItems)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    expect(plan.fragments[2]!.bands.filter((b) => b.emptyItem === true)).toHaveLength(2);
    // 합계는 마지막 페이지에만 붙는다
    expect(placements(plan, 0)).not.toContain('after-data');
    expect(placements(plan, 2)).toContain('after-data');
  });

  it('복수 행 항목 구간은 페이지 사이에서 나뉘지 않는다', () => {
    const grid = makeGrid({
      rows: [10, 10, 10],
      bands: [band('h', 0, 0, 'page-start'), band('i', 1, 2, 'item')],
      pagination: { mode: 'auto', minItems: 0 },
    });
    const plan = planGrid(grid, items(4), FLOW);
    expect(plan.fragments).toHaveLength(2);
    // 첫 페이지 70mm: 헤더 10 + 20mm 항목 3개 — 4번째(60→80mm)는 통째로 다음 페이지로
    expect(plan.fragments[0]!.pageItems).toEqual([0, 1, 2]);
    expect(plan.fragments[0]!.rowHeights).toHaveLength(1 + 3 * 2);
    expect(plan.fragments[1]!.pageItems).toEqual([3]);
  });

  it("헤더 없음·첫 페이지만(pages: 'first')·모든 페이지 헤더를 구분한다", () => {
    const twoPages = { mode: 'fixed', itemsPerPage: 4 } as const;
    const none = planGrid(
      makeGrid({ rows: [10], bands: [band('i', 0, 0, 'item')], pagination: twoPages }),
      items(8), FLOW,
    );
    expect(placements(none, 0)).not.toContain('page-start');

    const firstOnly = planGrid(
      makeGrid({
        rows: [10, 10],
        bands: [band('h', 0, 0, 'page-start', { pages: 'first' }), band('i', 1, 1, 'item')],
        pagination: twoPages,
      }),
      items(8), FLOW,
    );
    expect(placements(firstOnly, 0)).toContain('page-start');
    expect(placements(firstOnly, 1)).not.toContain('page-start');

    const all = planGrid(headerItemTail(twoPages), items(8), FLOW);
    expect(placements(all, 0)).toContain('page-start');
    expect(placements(all, 1)).toContain('page-start');
  });

  it('그룹 시작·종료 구간은 그룹의 첫·마지막 항목과 함께 배치된다', () => {
    const grid = makeGrid({
      rows: [10, 10, 10],
      bands: [band('gs', 0, 0, 'group-start'), band('i', 1, 1, 'item'), band('ge', 2, 2, 'group-end')],
      pagination: { mode: 'auto', minItems: 0 },
      groupBy: ['g'],
    });
    const data = [...items(2, 'A'), ...items(1, 'B')];
    const plan = planGrid(grid, data, FLOW);
    expect(plan.groupOf).toEqual([0, 0, 1]);
    expect(plan.groups).toEqual([[0, 1], [2]]);
    expect(placements(plan, 0)).toEqual([
      'group-start', 'item', 'item', 'group-end',
      'group-start', 'item', 'group-end',
    ]);
    const bands = plan.fragments[0]!.bands;
    expect(bands[0]).toMatchObject({ itemIndex: 0, groupIndex: 0 });
    expect(bands[3]).toMatchObject({ itemIndex: 1, groupIndex: 0 });
  });

  it('페이지를 넘긴 그룹의 시작 구간을 repeatOnPageBreak로 다음 페이지에 다시 표시한다', () => {
    const grid = makeGrid({
      rows: [10, 10],
      bands: [band('gs', 0, 0, 'group-start', { repeatOnPageBreak: true }), band('i', 1, 1, 'item')],
      pagination: { mode: 'auto', minItems: 0 },
      groupBy: ['g'],
    });
    const plan = planGrid(grid, items(8), FLOW);
    expect(plan.fragments).toHaveLength(2);
    // 이어지는 페이지 머리에 같은 그룹의 시작 구간이 다시 나온다 (그룹의 첫 항목을 가리킨다)
    const head = plan.fragments[1]!.bands[0]!;
    expect(head.band.id).toBe('gs');
    expect(head).toMatchObject({ itemIndex: 0, groupIndex: 0 });
  });

  it('고정 페이지에서도 페이지를 넘긴 그룹의 시작 구간을 다시 표시한다', () => {
    const grid = makeGrid({
      rows: [10, 10],
      bands: [band('gs', 0, 0, 'group-start', { repeatOnPageBreak: true }), band('i', 1, 1, 'item')],
      pagination: { mode: 'fixed', itemsPerPage: 2 },
      groupBy: ['g'],
    });
    const plan = planGrid(grid, items(3), FLOW);
    expect(plan.fragments).toHaveLength(2);
    const head = plan.fragments[1]!.bands[0]!;
    expect(head.band.id).toBe('gs');
    expect(head).toMatchObject({ itemIndex: 0, groupIndex: 0 });
  });

  it("pages: 'last'인 구간은 항목과 함께 들어가지 않으면 새 마지막 페이지에 배치된다", () => {
    const grid = makeGrid({
      rows: [10, 70],
      bands: [band('i', 0, 0, 'item'), band('pe', 1, 1, 'page-end', { pages: 'last' })],
      pagination: { mode: 'auto', minItems: 0 },
    });
    const plan = planGrid(grid, items(1), FLOW);
    expect(plan.fragments).toHaveLength(2);
    expect(placements(plan, 0)).toEqual(['item']);
    expect(placements(plan, 1)).toEqual(['page-end']);
  });

  it("pages: 'last'인 구간은 항목과 함께 들어가면 같은 페이지에 붙는다", () => {
    const grid = makeGrid({
      rows: [10, 10],
      bands: [band('i', 0, 0, 'item'), band('pe', 1, 1, 'page-end', { pages: 'last' })],
      pagination: { mode: 'auto', minItems: 0 },
    });
    const plan = planGrid(grid, items(2), FLOW);
    expect(plan.fragments).toHaveLength(1);
    expect(placements(plan, 0)).toEqual(['item', 'item', 'page-end']);
  });

  it('페이지 머리 구간이 흐름 영역에 들어가지 않으면 오류를 반환한다', () => {
    const grid = makeGrid({
      rows: [80, 10],
      bands: [band('bd', 0, 0, 'before-data'), band('i', 1, 1, 'item')],
      pagination: { mode: 'auto', minItems: 0 },
    });
    expect(() => planGrid(grid, items(1), FLOW)).toThrow(SlipLayoutError);
    expect(() => planGrid(grid, items(1), FLOW)).toThrow(/do not fit/);
  });

  it('새 마지막 페이지의 최종 구간이 흐름 영역보다 크면 오류를 반환한다', () => {
    const grid = makeGrid({
      rows: [10, 90],
      bands: [band('i', 0, 0, 'item'), band('t', 1, 1, 'after-data')],
      pagination: { mode: 'auto', minItems: 0 },
    });
    expect(() => planGrid(grid, items(7), FLOW)).toThrow(SlipLayoutError);
    expect(() => planGrid(grid, items(7), FLOW)).toThrow(/do not fit/);
  });

  it('이월된 그룹 머리 때문에 빈 페이지에서도 항목이 들어가지 않으면 즉시 오류를 반환한다', () => {
    // 첫 페이지(90mm)에는 page-start 20 + 그룹 시작 20 + 항목 50이 정확히 들어가고,
    // 이어지는 페이지(80mm)에는 page-start 20 + 이월 그룹 머리 20 + 항목 50이 들어가지 않는다.
    const grid = makeGrid({
      rows: [20, 20, 50],
      bands: [
        band('ps', 0, 0, 'page-start'),
        band('gs', 1, 1, 'group-start', { repeatOnPageBreak: true }),
        band('i', 2, 2, 'item'),
      ],
      pagination: { mode: 'auto', minItems: 0 },
      groupBy: ['g'],
    });
    const flow: GridFlow = { firstPage: 0, firstTop: 0, top: 10, bottom: 90 };
    expect(() => planGrid(grid, items(2), flow)).toThrow(SlipLayoutError);
    // 출력 페이지 상한까지 빈 페이지를 만들지 않고 그룹 오류로 바로 알린다.
    expect(() => planGrid(grid, items(2), flow)).toThrow(/group/);
  });

  it('after 배치로 줄어든 첫 페이지에 고정 묶음이 들어가지 않으면 다음 페이지에서 시작한다', () => {
    const grid = makeGrid({
      rows: [10],
      bands: [band('i', 0, 0, 'item')],
      pagination: { mode: 'fixed', itemsPerPage: 2 },
    });
    // 남은 공간 10mm < 묶음 20mm — 빈 조각 없이 다음 페이지 상단에서 시작한다.
    const plan = planGrid(grid, items(2), {
      firstPage: 0, firstTop: 80, top: 10, bottom: 90, allowStartShift: true,
    });
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: 10, height: 20 });
  });

  it('after 배치로 줄어든 첫 페이지에 머리 구간이 들어가지 않으면 다음 페이지에서 시작한다', () => {
    const grid = makeGrid({
      rows: [20, 10],
      bands: [band('h', 0, 0, 'page-start'), band('i', 1, 1, 'item')],
      pagination: { mode: 'auto', minItems: 0 },
    });
    const plan = planGrid(grid, items(1), {
      firstPage: 0, firstTop: 85, top: 10, bottom: 90, allowStartShift: true,
    });
    expect(plan.fragments).toHaveLength(1);
    expect(plan.fragments[0]).toMatchObject({ outputPage: 1, y: 10 });
    expect(placements(plan, 0)).toEqual(['page-start', 'item']);
  });

  it('pageItems·carriedItems가 @page·@carried 범위대로 쌓인다', () => {
    const plan = planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 4 }), items(10), FLOW);
    expect(plan.fragments.map((f) => f.carriedItems)).toEqual([
      [], [0, 1, 2, 3], [0, 1, 2, 3, 4, 5, 6, 7],
    ]);
    // 빈 항목은 pageItems(@page)와 carriedItems(@carried)에 들어가지 않는다
    expect(plan.fragments[2]!.pageItems).toEqual([8, 9]);
  });

  it('maxItems를 넘는 항목은 계획에서 제외한다', () => {
    const plan = planGrid(
      makeGrid({
        rows: [10], bands: [band('i', 0, 0, 'item')],
        pagination: { mode: 'auto', minItems: 0 }, maxItems: 3,
      }),
      items(10), FLOW,
    );
    expect(plan.itemCount).toBe(3);
    expect(plan.fragments[0]!.pageItems).toEqual([0, 1, 2]);
  });

  it('마지막 합계가 남은 공간에 들어가지 않으면 새 출력 페이지에 배치한다', () => {
    const grid = makeGrid({
      rows: [10, 10],
      bands: [band('i', 0, 0, 'item'), band('t', 1, 1, 'after-data')],
      pagination: { mode: 'auto', minItems: 0 },
    });
    // 첫 페이지 70mm를 항목 7개가 꽉 채워 합계 자리가 없다.
    const plan = planGrid(grid, items(7), FLOW);
    expect(plan.fragments).toHaveLength(2);
    expect(plan.fragments[0]!.pageItems).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(placements(plan, 0)).not.toContain('after-data');
    expect(placements(plan, 1)).toEqual(['after-data']);
    expect(plan.fragments[1]!.carriedItems).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('고정 페이지 묶음이 흐름 영역에 들어가지 않으면 오류를 반환한다', () => {
    expect(() =>
      planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 10 }), items(1), FLOW),
    ).toThrow(SlipLayoutError);
    expect(() =>
      planGrid(headerItemTail({ mode: 'fixed', itemsPerPage: 10 }), items(1), FLOW),
    ).toThrow(/does not fit/);
  });

  it('빈 이어지는 페이지에도 들어가지 않는 항목 구간은 오류를 반환한다', () => {
    const grid = makeGrid({
      rows: [90], bands: [band('i', 0, 0, 'item')],
      pagination: { mode: 'auto', minItems: 0 },
    });
    expect(() => planGrid(grid, items(1), FLOW)).toThrow(SlipLayoutError);
  });
});

describe('양식 페이지 계획 (planSourcePage)', () => {
  const paper = { width: 210, height: 100, padding: [10, 10, 10, 10] as const };

  function repeatGrid(id: string, x: number, itemsPerPage: number): GridElement {
    return makeGrid({
      id, position: { x, y: 20 }, rows: [10],
      bands: [band(`${id}-i`, 0, 0, 'item')],
      pagination: { mode: 'fixed', itemsPerPage },
    });
  }

  it('독립된 여러 그리드는 각자 흐름을 만들고 출력 페이지 수는 가장 긴 흐름을 따른다', () => {
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), repeatGrid('b', 110, 2)] };
    const plan = planSourcePage(paper, page, new Map([
      ['a', items(5)],
      ['b', items(1)],
    ]));
    expect(plan.outputPageCount).toBe(3);
    expect(plan.gridPlans.get('a')!.fragments).toHaveLength(3);
    expect(plan.gridPlans.get('b')!.fragments).toHaveLength(1);
  });

  it('독립 흐름의 출력 영역이 같은 페이지에서 겹치면 오류를 반환한다', () => {
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), repeatGrid('b', 30, 2)] };
    expect(() =>
      planSourcePage(paper, page, new Map([
        ['a', items(2)],
        ['b', items(2)],
      ])),
    ).toThrow(SlipLayoutError);
    expect(() =>
      planSourcePage(paper, page, new Map([
        ['a', items(2)],
        ['b', items(2)],
      ])),
    ).toThrow(/overlap/);
  });

  it('after 배치 요소는 대상의 마지막 출력 조각 뒤에 놓인다', () => {
    const note: SlipElement = {
      type: 'text', id: 'note', name: '비고', position: { x: 10, y: 0 },
      width: 60, height: 10, content: '메모',
      pagePlacement: { mode: 'after', target: 'a', gap: 5 },
    };
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), note] };
    const plan = planSourcePage(paper, page, new Map([['a', items(3)]]));
    // 그리드는 2페이지 — 마지막 조각(둘째 페이지, y=10, 높이 20) 뒤 5mm 간격
    const placement = plan.afterPlacements.get('note')!;
    expect(placement).toEqual({ outputPage: 1, y: 35 });
    expect(plan.outputPageCount).toBe(2);
  });

  it('after 배치 요소가 남은 공간에 들어가지 않으면 다음 출력 페이지로 넘어간다', () => {
    const note: SlipElement = {
      type: 'text', id: 'note', name: '비고', position: { x: 10, y: 0 },
      width: 60, height: 10, content: '메모',
      pagePlacement: { mode: 'after', target: 'a', gap: 60 },
    };
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), note] };
    const plan = planSourcePage(paper, page, new Map([['a', items(3)]]));
    expect(plan.afterPlacements.get('note')).toEqual({ outputPage: 2, y: 10 });
    expect(plan.outputPageCount).toBe(3);
  });

  it('after 배치는 대상이 마지막으로 표시되는 출력 페이지를 따른다', () => {
    const follow = (pages: 'all' | 'continuation' | 'non-final'): number => {
      const target: SlipElement = {
        type: 'text', id: 'target', name: '대상', position: { x: 100, y: 20 },
        width: 60, height: 10, content: 'T',
        pagePlacement: { mode: 'absolute', pages },
      };
      const note: SlipElement = {
        type: 'text', id: 'note', name: '비고', position: { x: 100, y: 0 },
        width: 60, height: 10, content: 'N',
        pagePlacement: { mode: 'after', target: 'target' },
      };
      const page: SlipPage = { elements: [repeatGrid('a', 10, 2), target, note] };
      // 그리드가 3페이지를 만드는 문서
      const plan = planSourcePage(paper, page, new Map([['a', items(5)]]));
      return plan.afterPlacements.get('note')!.outputPage;
    };
    expect(follow('all')).toBe(2);
    expect(follow('continuation')).toBe(2);
    expect(follow('non-final')).toBe(1);
  });

  it('표시되는 페이지가 없는 대상을 따르는 요소는 출력되지 않는다', () => {
    const target: SlipElement = {
      type: 'text', id: 'target', name: '대상', position: { x: 100, y: 20 },
      width: 60, height: 10, content: 'T',
      pagePlacement: { mode: 'absolute', pages: 'continuation' },
    };
    const note: SlipElement = {
      type: 'text', id: 'note', name: '비고', position: { x: 100, y: 0 },
      width: 60, height: 10, content: 'N',
      pagePlacement: { mode: 'after', target: 'target' },
    };
    // 출력 페이지가 하나뿐이라 continuation 대상은 표시되지 않는다.
    const plan = planSourcePage(paper, { elements: [target, note] }, new Map());
    expect(plan.outputPageCount).toBe(1);
    expect(plan.afterPlacements.has('note')).toBe(false);
  });

  it("pages: 'last' 요소를 대상으로 한 after 배치는 대상이 표시되는 마지막 페이지에 놓인다", () => {
    const target: SlipElement = {
      type: 'text', id: 'target', name: '대상', position: { x: 100, y: 20 },
      width: 60, height: 10, content: 'T',
      pagePlacement: { mode: 'absolute', pages: 'last' },
    };
    const note: SlipElement = {
      type: 'text', id: 'note', name: '비고', position: { x: 100, y: 0 },
      width: 60, height: 10, content: 'N',
      pagePlacement: { mode: 'after', target: 'target', gap: 5 },
    };
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), target, note] };
    const plan = planSourcePage(paper, page, new Map([['a', items(5)]]));
    expect(plan.outputPageCount).toBe(3);
    expect(plan.afterPlacements.get('note')).toEqual({ outputPage: 2, y: 35 });
  });

  it('마지막 페이지 전용 요소 뒤의 배치가 페이지를 늘리기만 하면 오류를 반환한다', () => {
    const target: SlipElement = {
      type: 'text', id: 'target', name: '대상', position: { x: 100, y: 80 },
      width: 60, height: 10, content: 'T',
      pagePlacement: { mode: 'absolute', pages: 'last' },
    };
    const note: SlipElement = {
      type: 'text', id: 'note', name: '비고', position: { x: 100, y: 0 },
      width: 60, height: 10, content: 'N',
      pagePlacement: { mode: 'after', target: 'target' },
    };
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), target, note] };
    expect(() => planSourcePage(paper, page, new Map([['a', items(5)]]))).toThrow(SlipLayoutError);
    expect(() => planSourcePage(paper, page, new Map([['a', items(5)]]))).toThrow(/does not settle/);
  });

  it('after 배치 요소가 다른 독립 흐름과 겹치면 오류를 반환한다', () => {
    const gridB = makeGrid({
      id: 'b', position: { x: 110, y: 20 }, rows: [30],
      bands: [band('b-i', 0, 0, 'item')],
      pagination: { mode: 'fixed', itemsPerPage: 2 },
    });
    const note: SlipElement = {
      type: 'text', id: 'note', name: '비고', position: { x: 110, y: 0 },
      width: 60, height: 40, content: 'N',
      pagePlacement: { mode: 'after', target: 'a' },
    };
    const page: SlipPage = { elements: [repeatGrid('a', 10, 2), gridB, note] };
    expect(() =>
      planSourcePage(paper, page, new Map([
        ['a', items(2)],
        ['b', items(2)],
      ])),
    ).toThrow(/overlap/);
  });

  it('흐름 영역은 기본으로 여백을 따르고, flowArea 설정이 있으면 그것을 쓴다', () => {
    const base: SlipPage = { elements: [repeatGrid('a', 10, 2)] };
    expect(planSourcePage(paper, base, new Map()).flowArea).toEqual({ top: 10, bottom: 90 });
    const custom: SlipPage = { ...base, flowArea: { top: 30, bottom: 80 } };
    const plan = planSourcePage(paper, custom, new Map([['a', items(5)]]));
    expect(plan.flowArea).toEqual({ top: 30, bottom: 80 });
    // 이어지는 조각은 흐름 영역 상단부터 시작한다
    expect(plan.gridPlans.get('a')!.fragments[1]!.y).toBe(30);
  });
});

describe('일반 요소의 표시 페이지 (filterVisibleOnPage)', () => {
  it('first·continuation·non-final·last·all을 출력 페이지 번호로 판정한다', () => {
    expect(filterVisibleOnPage('all', 1, 3)).toBe(true);
    expect(filterVisibleOnPage(undefined, 1, 3)).toBe(true);
    expect(filterVisibleOnPage('first', 0, 3)).toBe(true);
    expect(filterVisibleOnPage('first', 1, 3)).toBe(false);
    expect(filterVisibleOnPage('continuation', 0, 3)).toBe(false);
    expect(filterVisibleOnPage('continuation', 2, 3)).toBe(true);
    expect(filterVisibleOnPage('non-final', 1, 3)).toBe(true);
    expect(filterVisibleOnPage('non-final', 2, 3)).toBe(false);
    expect(filterVisibleOnPage('last', 2, 3)).toBe(true);
    expect(filterVisibleOnPage('last', 1, 3)).toBe(false);
  });
});
