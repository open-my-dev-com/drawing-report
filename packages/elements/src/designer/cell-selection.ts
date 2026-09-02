/**
 * 그리드 셀 복수 선택에 필요한 범위 계산과 공통값 판정을 제공합니다.
 *
 * @remarks
 * 화면 상태를 읽지 않습니다. 병합 셀은 원점 셀 하나로만 다루며, 범위에 병합 셀의 일부만
 * 들어와도 그 병합 셀 전체를 선택합니다.
 */

import type { GridCell, GridElement } from '@omdc-slipkit/core';

/** 셀 좌표 (0부터) */
export interface CellRef {
  row: number;
  column: number;
}

/**
 * 셀 좌표를 집합의 키로 씁니다.
 *
 * @param cell - 셀 좌표
 * @returns `행,열` 문자열
 */
export function cellKey(cell: CellRef): string {
  return `${cell.row},${cell.column}`;
}

/**
 * 두 셀 좌표가 같은지 확인합니다.
 *
 * @param a - 비교할 셀
 * @param b - 비교할 셀
 * @returns 행과 열이 모두 같으면 `true`
 */
export function sameCell(a: CellRef | null | undefined, b: CellRef | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined
    && a.row === b.row && a.column === b.column;
}

/**
 * 좌표를 덮고 있는 셀의 원점을 찾습니다. 병합 범위 안이면 병합 시작 셀입니다.
 *
 * @param el - 대상 그리드
 * @param row - 행 번호 (0부터)
 * @param column - 열 번호 (0부터)
 * @returns 그 좌표를 대표하는 셀 좌표
 */
export function cellOriginAt(el: GridElement, row: number, column: number): CellRef {
  for (const cell of el.cells) {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    if (row >= cell.row && row < cell.row + rowSpan && column >= cell.column && column < cell.column + colSpan) {
      return { row: cell.row, column: cell.column };
    }
  }
  return { row, column };
}

/**
 * 두 셀을 모서리로 하는 사각형 범위에 들어오는 셀을 원점 기준으로 모읍니다.
 *
 * @param el - 대상 그리드
 * @param from - 범위의 한쪽 모서리 (기준 셀)
 * @param to - 범위의 다른 모서리 (클릭한 셀)
 * @returns 행 우선으로 정렬된 셀 좌표 목록. 병합 셀은 한 번만 포함합니다.
 */
export function cellsInRectangle(el: GridElement, from: CellRef, to: CellRef): CellRef[] {
  const rows = el.rows.length;
  const columns = el.columns.length;
  const r0 = Math.max(0, Math.min(from.row, to.row));
  const r1 = Math.min(rows - 1, Math.max(from.row, to.row));
  const c0 = Math.max(0, Math.min(from.column, to.column));
  const c1 = Math.min(columns - 1, Math.max(from.column, to.column));
  const found = new Map<string, CellRef>();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const origin = cellOriginAt(el, r, c);
      const key = cellKey(origin);
      if (!found.has(key)) found.set(key, origin);
    }
  }
  return [...found.values()];
}

/**
 * 선택한 각 셀의 저장 레코드를 찾습니다. 레코드가 없는 빈 셀은 `undefined`입니다.
 *
 * @param el - 대상 그리드
 * @param cells - 선택한 셀 좌표 목록
 * @returns 셀 좌표 순서와 같은 레코드 목록
 */
export function cellRecordsOf(el: GridElement, cells: readonly CellRef[]): (GridCell | undefined)[] {
  return cells.map((at) => el.cells.find((cell) => cell.row === at.row && cell.column === at.column));
}

/** 선택한 셀의 속성값 요약 결과 */
export interface CellValueSummary<T> {
  /** 실제 적용값이 서로 다르면 `true` */
  mixed: boolean;
  /** 실제 적용값이 모두 같을 때 그 값. 혼합이면 `undefined` */
  effective: T | undefined;
  /** 모든 셀이 같은 값을 직접 갖고 있을 때 그 값. 하나라도 상속하거나 값이 다르면 `undefined` */
  stored: T | undefined;
}

/**
 * 선택한 셀의 속성값을 실제 적용값 기준으로 요약합니다.
 *
 * @remarks
 * 직접 지정한 값과 그리드에서 물려받은 값이 같으면 혼합으로 보지 않습니다.
 * 입력 상자는 `stored`가 있으면 그 값을, 없으면 물려받는 값을 흐리게 표시합니다.
 *
 * @param records - 선택한 각 셀의 레코드 (빈 셀은 `undefined`)
 * @param pick - 레코드에서 속성을 꺼내는 함수
 * @param inherited - 셀에 값이 없을 때 적용되는 값
 * @returns 혼합 여부와 공통값
 */
export function summarizeCellValue<T>(
  records: readonly (GridCell | undefined)[],
  pick: (cell: GridCell) => T | undefined,
  inherited: T,
): CellValueSummary<T> {
  const own = records.map((record) => (record === undefined ? undefined : pick(record)));
  const effectiveValues = own.map((value) => (value === undefined ? inherited : value));
  const first = effectiveValues[0];
  const mixed = effectiveValues.some((value) => !Object.is(value, first));
  const firstOwn = own[0];
  const allStored = !mixed && firstOwn !== undefined && own.every((value) => Object.is(value, firstOwn));
  return {
    mixed,
    effective: mixed ? undefined : first,
    stored: allStored ? firstOwn : undefined,
  };
}
