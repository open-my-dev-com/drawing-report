// 그리드 구조 변경 — 화면 없이 직접 확인한다.
import { describe, expect, it } from 'vitest';
import type { GridBand, GridBandPlacement, GridCell, GridElement } from '@omdc-slipkit/core';
import {
  isGrid,
  gridDims,
  columnWidths,
  ensureCell,
  clampGridSpans,
  gridHeaderTitle,
  BAND_PLACEMENT_ORDER,
  BAND_PLACEMENTS,
  itemBandOf,
  inItemBand,
  bandAt,
  assignBandRole,
  resizeBandRange,
  spanCrossesBand,
  canRemoveLastRow,
  changeRowCount,
  changeColumnCount,
  insertPositionFor,
  insertGridRow,
} from '../../src/designer/grid-model.js';

function makeGrid(rows: number, columns: number, cells: Partial<GridCell>[] = [], bands?: GridBand[]): GridElement {
  return {
    type: 'grid',
    id: 'g-1',
    position: { x: 0, y: 0 },
    rows: Array.from({ length: rows }, () => ({ height: 10 })),
    columns: Array.from({ length: columns }, () => ({ width: 30 })),
    cells: cells as GridCell[],
    ...(bands
      ? { repeat: { parameter: 'items', bands, pagination: { mode: 'auto', minItems: 0 } } }
      : {}),
  } as unknown as GridElement;
}

function band(id: string, fromRow: number, toRow: number, placement: GridBandPlacement): GridBand {
  return { id, fromRow, toRow, placement };
}

describe('isGrid · gridDims · columnWidths', () => {
  it('그리드 요소만 그리드로 본다', () => {
    expect(isGrid(makeGrid(1, 1))).toBe(true);
    expect(isGrid(undefined)).toBe(false);
    expect(isGrid({ type: 'text' } as never)).toBe(false);
  });

  it('행·열 수와 열 너비를 읽는다', () => {
    const el = makeGrid(3, 2);
    expect(gridDims(el)).toEqual({ rows: 3, columns: 2 });
    expect(columnWidths(el)).toEqual([30, 30]);
  });
});

describe('ensureCell', () => {
  it('있는 셀은 그대로 돌려준다', () => {
    const el = makeGrid(2, 2, [{ row: 1, column: 1, content: '기존' }]);
    expect(ensureCell(el, 1, 1)).toBe(el.cells[0]);
    expect(el.cells.length).toBe(1);
  });

  it('없는 셀은 빈 직접 입력으로 만들어 붙인다', () => {
    const el = makeGrid(2, 2);
    const created = ensureCell(el, 0, 1);
    expect(created).toEqual({ row: 0, column: 1, content: '' });
    expect(el.cells.length).toBe(1);
  });
});

describe('clampGridSpans', () => {
  it('격자를 벗어난 병합을 줄인다', () => {
    const el = makeGrid(2, 2, [{ row: 0, column: 0, rowSpan: 5, colSpan: 4 }]);
    clampGridSpans(el);
    expect(el.cells[0]).toMatchObject({ rowSpan: 2, colSpan: 2 });
  });

  it('한 칸까지 줄어들면 병합 키 자체를 지운다', () => {
    const el = makeGrid(2, 2, [{ row: 1, column: 1, rowSpan: 3, colSpan: 3 }]);
    clampGridSpans(el);
    expect('rowSpan' in el.cells[0]!).toBe(false);
    expect('colSpan' in el.cells[0]!).toBe(false);
  });

  it('격자 안에 있는 병합은 건드리지 않는다', () => {
    const el = makeGrid(3, 3, [{ row: 0, column: 0, rowSpan: 2, colSpan: 2 }]);
    clampGridSpans(el);
    expect(el.cells[0]).toMatchObject({ rowSpan: 2, colSpan: 2 });
  });
});

describe('gridHeaderTitle', () => {
  it('같은 열에서 위로 올라가며 가장 가까운 글을 찾는다', () => {
    const el = makeGrid(4, 2, [
      { row: 0, column: 0, content: '맨 위' },
      { row: 1, column: 0, content: '품명' },
    ]);
    expect(gridHeaderTitle(el, 0, 3)).toBe('품명');
  });

  it('빈 글은 건너뛴다', () => {
    const el = makeGrid(3, 1, [
      { row: 0, column: 0, content: '품명' },
      { row: 1, column: 0, content: '' },
    ]);
    expect(gridHeaderTitle(el, 0, 2)).toBe('품명');
  });

  it('위쪽에 글이 없으면 없음을 돌려준다', () => {
    expect(gridHeaderTitle(makeGrid(2, 1), 0, 1)).toBeUndefined();
  });
});

describe('행 구간 조회', () => {
  const bands = [
    band('b-head', 0, 0, 'page-start'),
    band('b-item', 1, 2, 'item'),
    band('b-tail', 3, 3, 'after-data'),
  ];
  const el = makeGrid(4, 2, [], bands);

  it('placement 순서는 파일 검증과 같다', () => {
    expect(BAND_PLACEMENTS.map((p) => BAND_PLACEMENT_ORDER[p]))
      .toEqual([...BAND_PLACEMENTS.map((p) => BAND_PLACEMENT_ORDER[p])].sort((a, b) => a - b));
  });

  it('항목 구간과 그 행을 찾는다', () => {
    expect(itemBandOf(el)?.id).toBe('b-item');
    expect(inItemBand(el, 1)).toBe(true);
    expect(inItemBand(el, 3)).toBe(false);
  });

  it('행이 속한 구간을 찾는다', () => {
    expect(bandAt(el, 0)?.id).toBe('b-head');
    expect(bandAt(el, 2)?.id).toBe('b-item');
    expect(bandAt(el, 9)).toBeUndefined();
  });

  it('반복 설정이 없으면 항목 구간도 없다', () => {
    expect(itemBandOf(makeGrid(2, 1))).toBeUndefined();
    expect(inItemBand(makeGrid(2, 1), 0)).toBe(false);
  });
});

describe('assignBandRole', () => {
  const base = () => makeGrid(4, 2, [], [
    band('b-head', 0, 0, 'page-start'),
    band('b-item', 1, 1, 'item'),
    band('b-tail', 2, 3, 'after-data'),
  ]);

  it('연속된 같은 역할을 한 구간으로 합친다', () => {
    const el = makeGrid(4, 2, [], [
      band('b-pre', 0, 0, 'before-data'),
      band('b-head', 1, 1, 'page-start'),
      band('b-item', 2, 2, 'item'),
      band('b-tail', 3, 3, 'after-data'),
    ]);
    const bands = assignBandRole(el, 2, 3, 'item') as GridBand[];
    expect(bands.map((b) => [b.fromRow, b.toRow, b.placement])).toEqual([
      [0, 0, 'before-data'],
      [1, 1, 'page-start'],
      [2, 3, 'item'],
    ]);
  });

  it('항목 구간을 옮기면 원래 항목 행은 위·아래 역할로 흡수된다', () => {
    const el = makeGrid(3, 2, [], [
      band('b-item', 0, 0, 'item'),
      band('b-tail', 1, 2, 'after-data'),
    ]);
    const bands = assignBandRole(el, 1, 2, 'item') as GridBand[];
    // 원래 항목 행(0)은 새 항목 구간보다 위라 데이터 앞으로 바뀐다.
    expect(bands.map((b) => [b.fromRow, b.toRow, b.placement])).toEqual([
      [0, 0, 'before-data'],
      [1, 2, 'item'],
    ]);
  });

  it('범위가 같은 기존 구간은 식별자를 유지한다', () => {
    const bands = assignBandRole(base(), 3, 3, 'after-data') as GridBand[];
    expect(bands.find((b) => b.placement === 'page-start')?.id).toBe('b-head');
  });

  it('항목 구간을 없애면 거부한다', () => {
    expect(assignBandRole(base(), 1, 1, 'after-data')).toBe('noItem');
  });

  it('세로 순서를 어기면 거부한다', () => {
    // 데이터 뒤 구간 아래에 페이지 시작을 둘 수 없다.
    expect(assignBandRole(base(), 3, 3, 'page-start')).toBe('outOfOrder');
  });
});

describe('resizeBandRange', () => {
  const base = () => makeGrid(4, 2, [], [
    band('b-head', 0, 0, 'page-start'),
    band('b-item', 1, 2, 'item'),
    band('b-tail', 3, 3, 'after-data'),
  ]);

  it('경계를 넓히면 맞닿은 구간이 줄어든다', () => {
    const bands = resizeBandRange(base(), 'b-item', 0, 2) as GridBand[];
    expect(bands.map((b) => [b.id, b.fromRow, b.toRow]))
      .toEqual([['b-item', 0, 2], ['b-tail', 3, 3]]);
  });

  it('경계를 줄이면 맞닿은 구간이 늘어난다', () => {
    const bands = resizeBandRange(base(), 'b-item', 2, 2) as GridBand[];
    expect(bands.map((b) => [b.id, b.fromRow, b.toRow]))
      .toEqual([['b-head', 0, 1], ['b-item', 2, 2], ['b-tail', 3, 3]]);
  });

  it('모르는 구간이면 거부한다', () => {
    expect(resizeBandRange(base(), 'b-none', 0, 1)).toBe('outOfOrder');
  });

  it('반복 설정이 없으면 거부한다', () => {
    expect(resizeBandRange(makeGrid(2, 1), 'b-item', 0, 1)).toBe('outOfOrder');
  });
});

describe('spanCrossesBand', () => {
  const bands = [band('b-head', 0, 0, 'page-start'), band('b-item', 1, 2, 'item')];

  it('구간 안에 머무는 병합은 넘지 않는다', () => {
    expect(spanCrossesBand(bands, { row: 1, column: 0, rowSpan: 2 } as GridCell)).toBe(false);
  });

  it('구간 경계를 넘는 병합을 찾아낸다', () => {
    expect(spanCrossesBand(bands, { row: 0, column: 0, rowSpan: 2 } as GridCell)).toBe(true);
  });

  it('병합하지 않은 셀은 넘지 않는다', () => {
    expect(spanCrossesBand(bands, { row: 2, column: 0 } as GridCell)).toBe(false);
  });
});

describe('changeRowCount · changeColumnCount', () => {
  it('행을 더하면 마지막 행 높이를 따라간다', () => {
    const el = makeGrid(2, 2);
    el.rows[1]!.height = 25;
    changeRowCount(el, 1);
    expect(el.rows.map((r) => r.height)).toEqual([10, 25, 25]);
  });

  it('행을 지우면 범위를 벗어난 셀과 병합을 정리한다', () => {
    const el = makeGrid(3, 2, [
      { row: 2, column: 0, content: '사라질 셀' },
      { row: 1, column: 0, rowSpan: 2 },
    ]);
    changeRowCount(el, -1);
    expect(el.rows.length).toBe(2);
    expect(el.cells.map((c) => c.row)).toEqual([1]);
    expect('rowSpan' in el.cells[0]!).toBe(false);
  });

  it('행이 하나뿐인 구간은 행을 지우면 함께 사라진다', () => {
    const el = makeGrid(3, 1, [], [
      band('b-item', 0, 1, 'item'),
      band('b-tail', 2, 2, 'after-data'),
    ]);
    changeRowCount(el, -1);
    expect(el.repeat!.bands.map((b) => b.id)).toEqual(['b-item']);
  });

  it('여러 행을 가진 구간은 끝만 줄어든다', () => {
    const el = makeGrid(3, 1, [], [band('b-item', 0, 2, 'item')]);
    changeRowCount(el, -1);
    expect(el.repeat!.bands[0]).toMatchObject({ fromRow: 0, toRow: 1 });
  });

  it('열도 마지막 너비를 따라 더하고, 지우면 셀을 정리한다', () => {
    const el = makeGrid(1, 2, [{ row: 0, column: 1, colSpan: 2 }]);
    el.columns[1]!.width = 45;
    changeColumnCount(el, 1);
    expect(el.columns.map((c) => c.width)).toEqual([30, 45, 45]);

    changeColumnCount(el, -1);
    changeColumnCount(el, -1);
    expect(el.columns.length).toBe(1);
    expect(el.cells).toEqual([]);
  });
});

describe('canRemoveLastRow', () => {
  it('반복이 없으면 언제나 지울 수 있다', () => {
    expect(canRemoveLastRow(makeGrid(1, 1))).toBe(true);
  });

  it('항목 구간이 한 행뿐이면 그 행은 지킬 수 없다', () => {
    const el = makeGrid(2, 1, [], [band('b-head', 0, 0, 'page-start'), band('b-item', 1, 1, 'item')]);
    expect(canRemoveLastRow(el)).toBe(false);
  });

  it('항목 구간이 여러 행이면 지울 수 있다', () => {
    const el = makeGrid(2, 1, [], [band('b-item', 0, 1, 'item')]);
    expect(canRemoveLastRow(el)).toBe(true);
  });
});

describe('insertPositionFor · insertGridRow', () => {
  const bands = () => [
    band('b-head', 0, 0, 'page-start'),
    band('b-item', 1, 1, 'item'),
    band('b-tail', 2, 2, 'after-data'),
  ];

  it('같은 역할의 구간이 있으면 그 뒤에 넣는다', () => {
    const el = makeGrid(3, 1, [], bands());
    expect(insertPositionFor(el, 'page-start')).toEqual({ insertAt: 1, sameBandId: 'b-head' });
  });

  it('같은 역할이 없으면 다음 역할의 구간 앞에 넣는다', () => {
    const el = makeGrid(3, 1, [], bands());
    expect(insertPositionFor(el, 'before-data')).toEqual({ insertAt: 0, sameBandId: undefined });
  });

  it('넣은 자리 아래의 셀 좌표가 한 칸씩 밀린다', () => {
    const el = makeGrid(3, 1, [{ row: 0, column: 0 }, { row: 2, column: 0 }], bands());
    insertGridRow(el, 1, 'page-start', 'b-head', {}, 12);
    expect(el.rows.length).toBe(4);
    expect(el.rows[1]!.height).toBe(12);
    expect(el.cells.map((c) => c.row)).toEqual([0, 3]);
  });

  it('넣는 자리를 가로지르는 병합은 한 칸 더 걸친다', () => {
    const el = makeGrid(3, 1, [{ row: 0, column: 0, rowSpan: 3 }], bands());
    insertGridRow(el, 1, 'page-start', 'b-head', {}, 10);
    expect(el.cells[0]!.rowSpan).toBe(4);
  });

  it('붙일 구간은 끝이 늘고 아래 구간은 통째로 밀린다', () => {
    const el = makeGrid(3, 1, [], bands());
    insertGridRow(el, 1, 'page-start', 'b-head', {}, 10);
    expect(el.repeat!.bands.map((b) => [b.id, b.fromRow, b.toRow])).toEqual([
      ['b-head', 0, 1],
      ['b-item', 2, 2],
      ['b-tail', 3, 3],
    ]);
  });

  it('붙일 구간을 지정하지 않으면 새 구간을 만들어 행 순서대로 끼운다', () => {
    const el = makeGrid(3, 1, [], bands());
    insertGridRow(el, 1, 'page-start', undefined, { name: '헤더', pages: 'first' }, 10);
    const created = el.repeat!.bands[1]!;
    expect(created).toMatchObject({ fromRow: 1, toRow: 1, placement: 'page-start', name: '헤더', pages: 'first' });
    expect(el.repeat!.bands.map((b) => b.fromRow)).toEqual([0, 1, 2, 3]);
  });
});
