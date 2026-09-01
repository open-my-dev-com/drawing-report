/**
 * 그리드의 트랙, 셀과 행 구간을 조회하고 변경하는 로직.
 */

import type { GridBand, GridBandPlacement, GridCell, GridElement, SlipElement } from '@omdc-slipkit/core';

/** 새 그리드의 기본 행 높이(mm) */
export const GRID_DEFAULT_ROW_MM = 8;

/** 새 그리드의 기본 열 너비(mm) */
export const GRID_DEFAULT_COL_MM = 30;

/** 디자이너에서 편집할 수 있는 그리드의 최대 행 및 열 수 */
export const GRID_MAX_TRACKS_UI = 100;

/** 최대 항목 수·최소 표시 항목 수와 페이지당 최대 항목 수의 입력 상한 */
export const GRID_MAX_ITEMS_UI = 100_000;

export const GRID_MAX_PER_PAGE_UI = 1000;

/**
 * 요소가 그리드인지 확인합니다.
 *
 * @param el - 검사할 요소
 * @returns 그리드이면 true
 */
export function isGrid(el: SlipElement | undefined): el is GridElement {
  return el?.type === 'grid';
}

/**
 * 그리드의 행 수와 열 수를 반환합니다.
 *
 * @param el - 대상 그리드
 * @returns 행 수와 열 수
 */
export function gridDims(el: GridElement): { rows: number; columns: number } {
  return { rows: el.rows.length, columns: el.columns.length };
}

/**
 * 캔버스에 그릴 열 너비(mm) 목록
 *
 * @param el - 대상 그리드
 * @returns 열 너비(mm) 목록
 */
export function columnWidths(el: GridElement): number[] {
  return el.columns.map((column) => column.width);
}

/**
 * 지정한 셀을 반환하고 없으면 빈 셀을 생성합니다.
 *
 * @param el - 대상 그리드
 * @param row - 행 번호(0-기반)
 * @param column - 열 번호(0-기반)
 * @returns 찾았거나 새로 만든 셀
 */
export function ensureCell(el: GridElement, row: number, column: number): Record<string, unknown> {
  const found = el.cells.find((c) => c.row === row && c.column === column);
  if (found) return found as unknown as Record<string, unknown>;
  const created: GridCell = { row, column, content: '' };
  el.cells.push(created);
  return created as unknown as Record<string, unknown>;
}

/**
 * 행·열이 줄어든 뒤 그리드 범위를 벗어나는 병합 범위를 줄입니다
 *
 * @param el - 대상 그리드
 */
export function clampGridSpans(el: GridElement): void {
  for (const cell of el.cells) {
    const record = cell as Record<string, unknown>;
    if (cell.rowSpan !== undefined && cell.row + cell.rowSpan > el.rows.length) {
      const clamped = el.rows.length - cell.row;
      if (clamped <= 1) delete record.rowSpan;
      else cell.rowSpan = clamped;
    }
    if (cell.colSpan !== undefined && cell.column + cell.colSpan > el.columns.length) {
      const clamped = el.columns.length - cell.column;
      if (clamped <= 1) delete record.colSpan;
      else cell.colSpan = clamped;
    }
  }
}

/**
 * 항목 구간 위쪽에서 같은 열의 헤더 텍스트를 찾습니다.
 *
 * @param grid - 대상 그리드
 * @param column - 찾을 열 번호(0-기반)
 * @param fromRow - 이 행의 바로 위부터 위로 찾습니다
 * @returns 가장 가까운 비어 있지 않은 셀의 글. 없으면 undefined
 */
export function gridHeaderTitle(grid: GridElement, column: number, fromRow: number): string | undefined {
  for (let row = fromRow - 1; row >= 0; row -= 1) {
    const cell = grid.cells.find((c) => c.row === row && c.column === column);
    if (cell?.content !== undefined && cell.content !== '') return cell.content;
  }
  return undefined;
}

/** 행 구간 placement의 세로 순서 (파일 검증과 같은 순서) */
export const BAND_PLACEMENT_ORDER: Record<GridBandPlacement, number> = {
  'before-data': 0,
  'page-start': 1,
  'group-start': 2,
  item: 3,
  'group-end': 4,
  'after-data': 5,
  'page-end': 6,
};

/** 행 구간 역할을 출력 순서대로 나열한 목록 */
export const BAND_PLACEMENTS: readonly GridBandPlacement[] = [
  'before-data', 'page-start', 'group-start', 'item', 'group-end', 'after-data', 'page-end',
];

export type GridRowCommand = 'header' | 'group-subtotal' | 'page-subtotal' | 'final-total';

/**
 * 반복 그리드의 항목 구간을 반환합니다.
 *
 * @param el - 대상 그리드
 * @returns 항목 구간. 반복 설정이 없으면 undefined
 */
export function itemBandOf(el: GridElement): GridBand | undefined {
  return el.repeat?.bands.find((band) => band.placement === 'item');
}

/**
 * 원본 행이 항목 구간에 포함되는지 확인합니다.
 *
 * @param el - 대상 그리드
 * @param row - 원본 행 번호(0-기반)
 * @returns 항목 구간 안이면 true
 */
export function inItemBand(el: GridElement, row: number): boolean {
  const band = itemBandOf(el);
  return band !== undefined && row >= band.fromRow && row <= band.toRow;
}

/**
 * 원본 행이 속한 행 구간을 반환합니다.
 *
 * @param el - 대상 그리드
 * @param row - 원본 행 번호(0-기반)
 * @returns 행이 속한 행 구간. 없으면 undefined
 */
export function bandAt(el: GridElement, row: number): GridBand | undefined {
  return el.repeat?.bands.find((band) => row >= band.fromRow && row <= band.toRow);
}

/**
 * 선택한 행 범위에 행 구간 역할을 지정한 새 구간 목록을 만듭니다.
 * 연속된 같은 역할 행은 하나의 구간으로 합치고, 범위가 같은 기존 구간의 id·설정을 유지합니다.
 *
 * @param el - 반복 설정이 있는 그리드
 * @param fromRow - 역할을 바꿀 시작 행
 * @param toRow - 역할을 바꿀 끝 행
 * @param placement - 지정할 역할
 * @returns 새 구간 목록 또는 규칙 위반 코드
 */
export function assignBandRole(
  el: GridElement,
  fromRow: number,
  toRow: number,
  placement: GridBandPlacement,
): GridBand[] | 'noItem' | 'outOfOrder' {
  const roles: GridBandPlacement[] = el.rows.map((_, r) => bandAt(el, r)?.placement ?? 'before-data');
  for (let r = fromRow; r <= toRow; r++) roles[r] = placement;
  // 항목 구간을 다른 곳에 지정하면 기존 항목 행은 역할을 잃으므로 위·아래 역할로 흡수합니다.
  if (placement === 'item') {
    roles.forEach((role, r) => {
      if (role !== 'item' || (r >= fromRow && r <= toRow)) return;
      roles[r] = r < fromRow ? 'before-data' : 'after-data';
    });
  }
  // 연속된 같은 역할을 하나의 구간으로 합칩니다.
  const bands: GridBand[] = [];
  let start = 0;
  for (let r = 1; r <= roles.length; r++) {
    if (r < roles.length && roles[r] === roles[start]) continue;
    const existing = el.repeat?.bands.find(
      (band) => band.fromRow === start && band.toRow === r - 1 && band.placement === roles[start],
    );
    bands.push(
      existing ?? { id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: start, toRow: r - 1, placement: roles[start]! },
    );
    start = r;
  }
  const itemBands = bands.filter((band) => band.placement === 'item');
  if (itemBands.length !== 1) return 'noItem';
  for (let i = 1; i < bands.length; i++) {
    if (BAND_PLACEMENT_ORDER[bands[i]!.placement] < BAND_PLACEMENT_ORDER[bands[i - 1]!.placement]) {
      return 'outOfOrder';
    }
  }
  return bands;
}

/**
 * 한 행 구간의 시작·종료 행을 바꾸고 맞닿은 구간의 경계를 함께 조정합니다.
 * 선택한 구간과 인접 구간의 식별자·옵션은 유지합니다.
 *
 * @param el - 반복 설정이 있는 그리드
 * @param bandId - 크기를 바꿀 행 구간의 id
 * @param fromRow - 새 시작 행
 * @param toRow - 새 끝 행
 * @returns 새 행 구간 목록. 항목 구간이 사라지면 `noItem`, 세로 순서가 어긋나면 `outOfOrder`
 */
export function resizeBandRange(
  el: GridElement,
  bandId: string,
  fromRow: number,
  toRow: number,
): GridBand[] | 'noItem' | 'outOfOrder' {
  if (!el.repeat) return 'outOfOrder';
  const bands = el.repeat.bands.map((band) => ({ ...band }));
  let targetIndex = bands.findIndex((band) => band.id === bandId);
  if (targetIndex < 0) return 'outOfOrder';
  let target = bands[targetIndex]!;
  const previousFrom = target.fromRow;
  const previousTo = target.toRow;

  if (fromRow < previousFrom) {
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      const band = bands[index]!;
      if (band.toRow < fromRow) break;
      if (band.fromRow < fromRow) {
        band.toRow = fromRow - 1;
        break;
      }
      bands.splice(index, 1);
      targetIndex -= 1;
    }
  } else if (fromRow > previousFrom) {
    const previous = bands[targetIndex - 1];
    if (previous !== undefined) {
      previous.toRow = fromRow - 1;
    } else {
      if (BAND_PLACEMENT_ORDER[target.placement] <= BAND_PLACEMENT_ORDER['before-data']) {
        return 'outOfOrder';
      }
      bands.unshift({
        id: `band_${crypto.randomUUID().slice(0, 8)}`,
        fromRow: previousFrom,
        toRow: fromRow - 1,
        placement: 'before-data',
      });
      targetIndex += 1;
    }
  }

  target = bands[targetIndex]!;
  target.fromRow = fromRow;

  if (toRow > previousTo) {
    for (let index = targetIndex + 1; index < bands.length;) {
      const band = bands[index]!;
      if (band.fromRow > toRow) break;
      if (band.toRow > toRow) {
        band.fromRow = toRow + 1;
        break;
      }
      bands.splice(index, 1);
    }
  } else if (toRow < previousTo) {
    const next = bands[targetIndex + 1];
    if (next !== undefined) {
      next.fromRow = toRow + 1;
    } else {
      const targetRank = BAND_PLACEMENT_ORDER[target.placement];
      const placement: GridBandPlacement | null = targetRank < BAND_PLACEMENT_ORDER['after-data']
        ? 'after-data'
        : targetRank < BAND_PLACEMENT_ORDER['page-end'] ? 'page-end' : null;
      if (placement === null) return 'outOfOrder';
      bands.push({
        id: `band_${crypto.randomUUID().slice(0, 8)}`,
        fromRow: toRow + 1,
        toRow: previousTo,
        placement,
      });
    }
  }
  target.toRow = toRow;

  if (bands.filter((band) => band.placement === 'item').length !== 1) return 'noItem';
  let nextRow = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index]!;
    if (band.fromRow !== nextRow) return 'outOfOrder';
    if (index > 0
      && BAND_PLACEMENT_ORDER[band.placement] < BAND_PLACEMENT_ORDER[bands[index - 1]!.placement]) {
      return 'outOfOrder';
    }
    nextRow = band.toRow + 1;
  }
  return nextRow === el.rows.length ? bands : 'outOfOrder';
}

/**
 * 셀 병합이 행 구간 경계를 넘는지 검사합니다.
 *
 * @param bands - 검사에 사용할 행 구간 목록
 * @param cell - 검사할 셀
 * @returns 병합 범위가 두 행 구간에 걸치면 true
 */
export function spanCrossesBand(bands: readonly GridBand[], cell: GridCell): boolean {
  const last = cell.row + (cell.rowSpan ?? 1) - 1;
  const startBand = bands.find((band) => cell.row >= band.fromRow && cell.row <= band.toRow);
  const endBand = bands.find((band) => last >= band.fromRow && last <= band.toRow);
  return startBand !== endBand;
}

/**
 * 마지막 행을 지울 수 있는지 — 항목 구간이 한 행뿐이면 지울 수 없습니다.
 *
 * @param el - 대상 그리드
 * @returns 마지막 행을 지울 수 있으면 true
 */
export function canRemoveLastRow(el: GridElement): boolean {
  if (!el.repeat) return true;
  const band = bandAt(el, el.rows.length - 1);
  return !(band?.placement === 'item' && band.fromRow === band.toRow);
}

/**
 * 마지막 행을 하나 더하거나 뺍니다.
 * 지울 때는 범위를 벗어난 셀과 병합을 정리하고 행 구간의 끝을 함께 줄입니다.
 *
 * @param grid - 수정할 그리드
 * @param delta - 1이면 추가, -1이면 제거
 */
export function changeRowCount(grid: GridElement, delta: number): void {
  if (delta > 0) {
    grid.rows.push({ height: grid.rows[grid.rows.length - 1]?.height ?? GRID_DEFAULT_ROW_MM });
    return;
  }
  const removed = grid.rows.length - 1;
  grid.rows.pop();
  grid.cells = grid.cells.filter((cell) => cell.row < grid.rows.length);
  clampGridSpans(grid);
  if (!grid.repeat) return;
  const band = grid.repeat.bands.find((b) => removed >= b.fromRow && removed <= b.toRow);
  // 행이 하나뿐인 구간은 통째로 사라집니다.
  if (band !== undefined && band.fromRow === band.toRow) {
    grid.repeat.bands = grid.repeat.bands.filter((b) => b !== band);
  } else if (band !== undefined) {
    band.toRow -= 1;
  }
}

/**
 * 마지막 열을 하나 더하거나 뺍니다.
 *
 * @param grid - 수정할 그리드
 * @param delta - 1이면 추가, -1이면 제거
 */
export function changeColumnCount(grid: GridElement, delta: number): void {
  if (delta > 0) {
    grid.columns.push({ width: grid.columns[grid.columns.length - 1]?.width ?? GRID_DEFAULT_COL_MM });
    return;
  }
  grid.columns.pop();
  grid.cells = grid.cells.filter((cell) => cell.column < grid.columns.length);
  clampGridSpans(grid);
}

/** 역할 행을 새로 넣을 때의 부가 설정 */
export interface InsertRowOptions {
  /** 같은 역할의 기존 구간에 붙이지 않고 새 구간으로 만들지 */
  separateBand?: boolean | undefined;
  /** 새 구간의 이름 */
  name?: string | undefined;
  /** 새 구간의 출력 페이지 */
  pages?: GridBand['pages'] | undefined;
}

/**
 * 지정한 역할의 행을 넣을 자리를 찾습니다.
 * 같은 역할의 구간이 있으면 그 뒤, 없으면 다음 역할의 구간 앞입니다.
 *
 * @param el - 반복 설정이 있는 그리드
 * @param placement - 넣을 행의 역할
 * @returns 넣을 행 번호와 붙일 구간의 식별자
 */
export function insertPositionFor(
  el: GridElement,
  placement: GridBandPlacement,
): { insertAt: number; sameBandId: string | undefined } {
  const sameRole = el.repeat?.bands.filter((band) => band.placement === placement).at(-1);
  const nextRole = el.repeat?.bands.find(
    (band) => BAND_PLACEMENT_ORDER[band.placement] > BAND_PLACEMENT_ORDER[placement],
  );
  const insertAt = sameRole?.toRow !== undefined ? sameRole.toRow + 1 : (nextRole?.fromRow ?? el.rows.length);
  return { insertAt, sameBandId: sameRole?.id };
}

/**
 * 행을 하나 넣고 셀 좌표·병합과 행 구간 경계를 함께 밀어 줍니다.
 *
 * @param grid - 수정할 그리드 (반복 설정이 있어야 합니다)
 * @param insertAt - 넣을 행 번호
 * @param placement - 넣을 행의 역할
 * @param targetBandId - 붙일 구간의 식별자. 없으면 새 구간을 만듭니다
 * @param options - 새 구간의 이름과 출력 페이지
 * @param height - 새 행의 높이(mm)
 */
export function insertGridRow(
  grid: GridElement,
  insertAt: number,
  placement: GridBandPlacement,
  targetBandId: string | undefined,
  options: InsertRowOptions,
  height: number,
): void {
  grid.rows.splice(insertAt, 0, { height });
  for (const cell of grid.cells) {
    if (cell.row >= insertAt) {
      cell.row += 1;
    } else if (cell.row + (cell.rowSpan ?? 1) > insertAt) {
      // 넣는 자리를 가로지르는 병합은 한 칸 더 걸치게 됩니다.
      cell.rowSpan = (cell.rowSpan ?? 1) + 1;
    }
  }

  const bands = grid.repeat?.bands ?? [];
  for (const band of bands) {
    if (band.id === targetBandId) {
      band.toRow += 1;
    } else if (band.fromRow >= insertAt) {
      band.fromRow += 1;
      band.toRow += 1;
    } else if (band.toRow >= insertAt) {
      band.toRow += 1;
    }
  }
  if (targetBandId !== undefined) return;

  const band: GridBand = {
    id: `band_${crypto.randomUUID().slice(0, 8)}`,
    fromRow: insertAt,
    toRow: insertAt,
    placement,
  };
  if (options.name !== undefined) band.name = options.name;
  if (options.pages !== undefined) band.pages = options.pages;
  bands.push(band);
  bands.sort((a, b) => a.fromRow - b.fromRow);
}
