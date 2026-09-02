import { describe, expect, it } from 'vitest';
import type { GridElement } from '@omdc-slipkit/core';
import {
  cellKey,
  cellOriginAt,
  cellRecordsOf,
  cellsInRectangle,
  sameCell,
  summarizeCellValue,
} from '../../src/designer/cell-selection.js';

/** 3×3 그리드 — (0,0)이 2×2로 병합되어 있고 (2,2)는 굵게 */
function grid(): GridElement {
  return {
    type: 'grid', id: 'g', name: '그리드', position: { x: 0, y: 0 },
    rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
    columns: [{ width: 20 }, { width: 20 }, { width: 20 }],
    cells: [
      { row: 0, column: 0, content: '', rowSpan: 2, colSpan: 2 },
      { row: 2, column: 2, content: '', bold: true, fontSize: 12 },
      { row: 0, column: 2, content: '', fontSize: 12 },
    ],
  } as GridElement;
}

describe('셀 복수 선택 계산', () => {
  it('병합 범위 안의 좌표는 병합 시작 셀을 가리킨다', () => {
    const el = grid();
    expect(cellOriginAt(el, 1, 1)).toEqual({ row: 0, column: 0 });
    expect(cellOriginAt(el, 0, 1)).toEqual({ row: 0, column: 0 });
    expect(cellOriginAt(el, 2, 0)).toEqual({ row: 2, column: 0 });
    expect(cellKey({ row: 2, column: 1 })).toBe('2,1');
    expect(sameCell({ row: 1, column: 1 }, { row: 1, column: 1 })).toBe(true);
    expect(sameCell(null, { row: 1, column: 1 })).toBe(false);
  });

  it('사각형 범위는 모서리 순서와 무관하고 병합 셀은 일부만 걸쳐도 한 번만 든다', () => {
    const el = grid();
    const forward = cellsInRectangle(el, { row: 1, column: 1 }, { row: 2, column: 2 });
    const backward = cellsInRectangle(el, { row: 2, column: 2 }, { row: 1, column: 1 });
    expect(forward).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 2 },
      { row: 2, column: 1 },
      { row: 2, column: 2 },
    ]);
    expect(backward).toEqual(forward);
  });

  it('그리드 밖으로 나간 범위는 그리드 안으로 잘린다', () => {
    const el = grid();
    const cells = cellsInRectangle(el, { row: 2, column: 2 }, { row: 9, column: 9 });
    expect(cells).toEqual([{ row: 2, column: 2 }]);
  });

  it('레코드가 없는 빈 셀은 undefined로 찾는다', () => {
    const el = grid();
    const records = cellRecordsOf(el, [{ row: 2, column: 2 }, { row: 2, column: 0 }]);
    expect(records[0]?.bold).toBe(true);
    expect(records[1]).toBeUndefined();
  });

  it('실제 적용값이 같으면 직접 지정과 상속을 섞어도 혼합이 아니다', () => {
    const el = grid();
    // (0,2)는 12를 직접 갖고, (2,0)은 없어 그리드 공통값 12를 물려받는다.
    const records = cellRecordsOf(el, [{ row: 0, column: 2 }, { row: 2, column: 0 }]);
    const size = summarizeCellValue(records, (cell) => cell.fontSize, 12);
    expect(size).toEqual({ mixed: false, effective: 12, stored: undefined });
    // 둘 다 12를 직접 가지면 저장값도 공통이다.
    const both = cellRecordsOf(el, [{ row: 0, column: 2 }, { row: 2, column: 2 }]);
    expect(summarizeCellValue(both, (cell) => cell.fontSize, 10))
      .toEqual({ mixed: false, effective: 12, stored: 12 });
  });

  it('실제 적용값이 다르면 혼합이다', () => {
    const el = grid();
    const records = cellRecordsOf(el, [{ row: 2, column: 2 }, { row: 2, column: 0 }]);
    const bold = summarizeCellValue(records, (cell) => cell.bold, false);
    expect(bold).toEqual({ mixed: true, effective: undefined, stored: undefined });
    // 그리드 공통값이 굵게이면 (2,0)도 굵게로 보아 혼합이 아니다.
    expect(summarizeCellValue(records, (cell) => cell.bold, true).mixed).toBe(false);
  });
});
