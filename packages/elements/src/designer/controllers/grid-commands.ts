/**
 * 그리드를 고치는 조작 — 행·열, 반복 설정, 행 구간과 셀 값·스타일.
 *
 * @remarks
 * `GridEditController`가 편집 대상을 관리하고, 이 컨트롤러는 선택된 대상의 변경을 파일에 반영한다.
 * 입력 검증에 실패하면 호스트에 오류 표시를 맡기고 파일은 고치지 않는다.
 */

import type {
  ConditionalFormatRule,
  GridBand,
  GridBandPlacement,
  GridCell,
  GridElement,
  OutputPageFilter,
  SlipElement,
} from '@omdc-slipkit/core';
import { MIN_SIZE_MM, round1 } from '../geometry.js';
import { clearValueSources } from '../patch.js';
import {
  GRID_DEFAULT_ROW_MM,
  GRID_MAX_ITEMS_UI,
  GRID_MAX_PER_PAGE_UI,
  GRID_MAX_TRACKS_UI,
  assignBandRole,
  canRemoveLastRow,
  changeColumnCount,
  changeRowCount,
  ensureCell,
  gridDims,
  insertGridRow,
  insertPositionFor,
  isGrid,
  itemBandOf,
  resizeBandRange,
  spanCrossesBand,
  type GridRowCommand,
} from '../grid-model.js';
import type { ParameterInfo } from '../parameters.js';
import type { GridEditController } from './grid-edit.js';
import type { DesignerStrings } from '../../strings.js';

/** 그리드 조작이 컴포넌트에 요청하는 것 */
export interface GridCommandsHost {
  /** 로케일에 맞는 문구 */
  readonly s: DesignerStrings;
  /** 그리드 셀·행 구간 선택 상태 */
  readonly edit: GridEditController;
  /** 속성 패널이 대상으로 삼는 요소 */
  selectedElement(): SlipElement | undefined;
  /** 선택한 요소를 수정한다 */
  updateElement(fn: (el: SlipElement) => void): void;
  /** 입력값을 되돌리고 오류를 표시한다 */
  reject(message?: string, field?: string): void;
  /** 패널의 오류 표시를 모두 지운다 */
  resetPanelErrors(): void;
  /** 입력 오류 하나를 지운다 */
  clearInputError(): void;
  /** 파라미터 정의가 없으면 만든다 */
  ensureParameterDef(key: string, valueType?: string): void;
  /** 정의와 사용처를 합친 파라미터 목록 */
  parameters(): ParameterInfo[];
  /** 샘플 값이 없을 때 사용할 파라미터 종류별 기본값 */
  probeValues(): Record<string, unknown>;
  /** 화면을 다시 그린다 */
  refresh(): void;
}

export class GridCommandsController {
  constructor(private readonly host: GridCommandsHost) {}

  /** 그리드를 수정한다. 크기는 행과 열의 합에서 계산하므로 따로 저장하지 않는다. */
  updateGrid(fn: (el: GridElement) => void): void {
    this.host.updateElement((el) => {
      if (el.type !== 'grid') return;
      fn(el);
    });
  }

  /** 그리드의 마지막 행을 추가하거나 제거한다. 반복 그리드의 추가는 역할 지정 명령을 사용한다. */
  changeRows(delta: number): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid') return;
    if (delta > 0 && el.repeat) return;
    const next = el.rows.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    // 항목 구간이 한 행뿐이면 그 행은 제거할 수 없다.
    if (delta < 0 && !canRemoveLastRow(el)) return;
    this.updateGrid((grid) => changeRowCount(grid, delta));
  }

  /** 선택한 역할의 행을 알맞은 구간 위치에 추가한다. */
  addRowWithRole(
    placement: GridBandPlacement,
    options: {
      separateBand?: boolean;
      name?: string;
      pages?: OutputPageFilter;
      initialize?: (grid: GridElement, row: number) => void;
    } = {},
  ): number | null {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat || el.rows.length >= GRID_MAX_TRACKS_UI) return null;
    if ((placement === 'group-start' || placement === 'group-end')
      && (el.repeat.groupBy === undefined || el.repeat.groupBy.length === 0)) {
      this.host.reject(this.host.s.bandNeedsGroupBy, 'band-role');
      return null;
    }

    const { insertAt, sameBandId } = insertPositionFor(el, placement);
    const sourceRow = el.rows[Math.max(0, Math.min(insertAt - 1, el.rows.length - 1))];
    const targetBandId = options.separateBand ? undefined : sameBandId;

    this.host.resetPanelErrors();
    this.updateGrid((grid) => {
      insertGridRow(
        grid,
        insertAt,
        placement,
        targetBandId,
        options,
        sourceRow?.height ?? GRID_DEFAULT_ROW_MM,
      );
      options.initialize?.(grid, insertAt);
    });
    this.host.edit.selectBand({ from: insertAt, to: insertAt });
    this.host.edit.closeBandMenu(false);
    this.host.refresh();
    return insertAt;
  }

  /** 그리드의 마지막 열을 추가하거나 제거한다. */
  changeColumns(delta: number): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid') return;
    const next = el.columns.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    this.updateGrid((grid) => changeColumnCount(grid, delta));
  }

  /** 지정한 행의 높이 또는 열의 너비(mm)를 변경한다. */
  setTrack(kind: 'row' | 'column', index: number, mm: number): void {
    const errorKey = kind === 'row' ? 'cell-row-height' : 'cell-column-width';
    if (!Number.isFinite(mm) || mm < MIN_SIZE_MM) {
      const message = !Number.isFinite(mm)
        ? this.host.s.numberInput
        : this.host.s.minimumInput.replace('{min}', String(MIN_SIZE_MM));
      this.host.reject(message, errorKey);
      return;
    }
    this.updateGrid((grid) => {
      if (kind === 'row') {
        const row = grid.rows[index];
        if (row) row.height = round1(mm);
      } else {
        const column = grid.columns[index];
        if (column) column.width = round1(mm);
      }
    });
  }

  /**
   * 반복 설정을 켜거나 끈다.
   * 켜면 선택한 행(없으면 마지막 행)을 항목 구간으로 하고, 위쪽 행은 데이터 앞,
   * 아래쪽 행은 데이터 뒤 구간으로 지정한다. 페이지 방식은 자동 확장으로 시작한다 (§7.1).
   */
  toggleRepeat(on: boolean): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid') return;
    if (!on) {
      this.updateGrid((grid) => {
        delete (grid as { repeat?: unknown }).repeat;
      });
      return;
    }
    const row = Math.min(this.host.edit.cell?.row ?? el.rows.length - 1, el.rows.length - 1);
    // 항목 구간 경계를 넘는 병합이 있으면 반복을 켤 수 없다.
    const bands: GridBand[] = [
      ...(row > 0 ? [{ id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: 0, toRow: row - 1, placement: 'before-data' as const }] : []),
      { id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: row, toRow: row, placement: 'item' as const },
      ...(row < el.rows.length - 1
        ? [{ id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: row + 1, toRow: el.rows.length - 1, placement: 'after-data' as const }]
        : []),
    ];
    if (el.cells.some((cell) => spanCrossesBand(bands, cell))) {
      this.host.reject(this.host.s.repeatMergeError, 'repeat-on');
      return;
    }
    const key = `items_${el.id.slice(0, 4)}`;
    this.host.ensureParameterDef(key, 'list');
    this.updateGrid((grid) => {
      grid.repeat = {
        parameter: key,
        bands,
        pagination: { mode: 'auto', minItems: 0 },
      };
    });
  }

  /** 반복 설정의 목록 파라미터를 변경한다. */
  setRepeatParameter(key: string): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    this.host.ensureParameterDef(key, 'list');
    this.updateGrid((grid) => {
      grid.repeat!.parameter = key;
    });
  }

  /** 최대 항목 수를 변경한다. null은 제한 없음이다. */
  setRepeatMaxItems(value: number | null): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > GRID_MAX_ITEMS_UI)) {
      this.host.reject(
        this.host.s.rangeInput.replace('{min}', '1').replace('{max}', String(GRID_MAX_ITEMS_UI)),
        'repeat-max-items',
      );
      return;
    }
    this.updateGrid((grid) => {
      if (value === null) delete (grid.repeat as { maxItems?: unknown }).maxItems;
      else grid.repeat!.maxItems = value;
    });
  }

  /**
   * 페이지 방식을 변경한다.
   *
   * @param patch - `mode`: 방식 전환, `minItems`: 자동 확장의 최소 표시 항목 수,
   *   `itemsPerPage`: 고정 페이지의 페이지당 항목 수
   */
  setPagination(patch: { mode?: 'auto' | 'fixed'; minItems?: number; itemsPerPage?: number }): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const current = el.repeat.pagination;
    if (patch.minItems !== undefined
      && (!Number.isInteger(patch.minItems) || patch.minItems < 0 || patch.minItems > GRID_MAX_ITEMS_UI)) {
      this.host.reject(
        this.host.s.rangeInput.replace('{min}', '0').replace('{max}', String(GRID_MAX_ITEMS_UI)),
        'repeat-min-items',
      );
      return;
    }
    if (patch.itemsPerPage !== undefined
      && (!Number.isInteger(patch.itemsPerPage) || patch.itemsPerPage < 1 || patch.itemsPerPage > GRID_MAX_PER_PAGE_UI)) {
      this.host.reject(
        this.host.s.rangeInput.replace('{min}', '1').replace('{max}', String(GRID_MAX_PER_PAGE_UI)),
        'repeat-per-page',
      );
      return;
    }
    this.updateGrid((grid) => {
      const mode = patch.mode ?? current.mode;
      if (mode === 'auto') {
        const minItems = patch.minItems ?? (current.mode === 'auto' ? current.minItems : 0);
        grid.repeat!.pagination = { mode: 'auto', minItems };
      } else {
        const itemsPerPage = patch.itemsPerPage ?? (current.mode === 'fixed' ? current.itemsPerPage : 1);
        grid.repeat!.pagination = { mode: 'fixed', itemsPerPage };
      }
    });
  }

  /**
   * 선택한 행 범위에 행 구간 역할을 지정한다.
   * 구간 규칙(항목 구간 하나·세로 순서·병합 경계)을 어기는 지정은 거부한다.
   */
  setRowBandRole(fromRow: number, toRow: number, placement: GridBandPlacement): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const s = this.host.s;
    // 그룹 구간은 그룹 기준이 있어야 한다.
    if ((placement === 'group-start' || placement === 'group-end')
      && (el.repeat.groupBy === undefined || el.repeat.groupBy.length === 0)) {
      this.host.reject(s.bandNeedsGroupBy, 'band-role');
      return;
    }
    const result = assignBandRole(el, fromRow, toRow, placement);
    if (result === 'noItem') {
      this.host.reject(s.bandNeedsItem, 'band-role');
      return;
    }
    if (result === 'outOfOrder') {
      this.host.reject(s.bandOrderError, 'band-role');
      return;
    }
    if (el.cells.some((cell) => spanCrossesBand(result, cell))) {
      this.host.reject(s.repeatMergeError, 'band-role');
      return;
    }
    this.host.resetPanelErrors();
    this.updateGrid((grid) => {
      grid.repeat!.bands = result;
    });
  }

  /** 속성 패널에서 선택한 행 구간의 시작 또는 종료 행을 변경한다. */
  setBandSelectionBoundary(boundary: 'from' | 'to', rowNumber: number, bandId?: string): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat || this.host.edit.bandRange === null) return;
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > el.rows.length) {
      this.host.reject(
        this.host.s.rangeInput.replace('{min}', '1').replace('{max}', String(el.rows.length)),
        'band-range',
      );
      return;
    }
    const index = rowNumber - 1;
    const from = Math.min(this.host.edit.bandRange.from, this.host.edit.bandRange.to);
    const to = Math.max(this.host.edit.bandRange.from, this.host.edit.bandRange.to);
    const nextFrom = boundary === 'from' ? index : from;
    const nextTo = boundary === 'to' ? index : to;
    if (nextFrom > nextTo) {
      this.host.reject(this.host.s.bandRangeOrder, 'band-range');
      return;
    }

    if (bandId !== undefined) {
      const result = resizeBandRange(el, bandId, nextFrom, nextTo);
      if (result === 'noItem') {
        this.host.reject(this.host.s.bandNeedsItem, 'band-range');
        return;
      }
      if (result === 'outOfOrder') {
        this.host.reject(this.host.s.bandOrderError, 'band-range');
        return;
      }
      if (el.cells.some((cell) => spanCrossesBand(result, cell))) {
        this.host.reject(this.host.s.repeatMergeError, 'band-range');
        return;
      }
      this.host.resetPanelErrors();
      this.updateGrid((grid) => {
        grid.repeat!.bands = result;
      });
      this.host.edit.selectBand({ from: nextFrom, to: nextTo });
      this.host.edit.closeBandMenu(false);
      this.host.refresh();
      return;
    }

    this.host.resetPanelErrors();
    this.host.edit.selectBand({ from: nextFrom, to: nextTo });
    this.host.edit.closeBandMenu(false);
    this.host.refresh();
  }

  /** page-start·page-end 구간의 표시 페이지 필터를 변경한다. */
  setBandPages(bandId: string, pages: OutputPageFilter | ''): void {
    this.updateGrid((grid) => {
      const band = grid.repeat?.bands.find((b) => b.id === bandId);
      if (!band) return;
      if (pages === '' || pages === 'all') delete (band as { pages?: unknown }).pages;
      else band.pages = pages;
    });
  }

  /** group-start 구간의 페이지 이월 시 반복 표시를 켜거나 끈다. */
  setBandRepeatOnPageBreak(bandId: string, on: boolean): void {
    this.updateGrid((grid) => {
      const band = grid.repeat?.bands.find((b) => b.id === bandId);
      if (!band) return;
      if (on) band.repeatOnPageBreak = true;
      else delete (band as { repeatOnPageBreak?: unknown }).repeatOnPageBreak;
    });
  }

  /** 그룹 기준 필드의 선택 상태를 변경한다. */
  toggleGroupField(key: string, on: boolean): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const fields = this.host.parameters().find((parameter) => parameter.key === el.repeat!.parameter)?.fields ?? [];
    if (!fields.some((field) => field.key === key)) return;
    const selected = new Set(el.repeat.groupBy ?? []);
    if (on) selected.add(key);
    else selected.delete(key);
    const keys = fields.map((field) => field.key).filter((field) => selected.has(field));
    const hasGroupBands = el.repeat.bands.some(
      (band) => band.placement === 'group-start' || band.placement === 'group-end',
    );
    if (keys.length === 0 && hasGroupBands) {
      this.host.reject(this.host.s.bandNeedsGroupBy, 'repeat-group-by');
      return;
    }
    this.host.resetPanelErrors();
    this.updateGrid((grid) => {
      if (keys.length === 0) delete (grid.repeat as { groupBy?: unknown }).groupBy;
      else grid.repeat!.groupBy = keys;
    });
  }

  /** 행 추가 명령을 고르고 집계 필드의 기본값을 설정한다. */
  openRowCommand(command: GridRowCommand): void {
    const el = this.host.selectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const numericFields = this.host.parameters()
      .find((parameter) => parameter.key === el.repeat!.parameter)
      ?.fields.filter((field) => field.valueType === 'number') ?? [];
    if (!numericFields.some((field) => field.key === this.host.edit.rowCommandField)) {
      const itemBand = itemBandOf(el);
      const columnOf = (key: string): number => itemBand === undefined
        ? -1
        : Math.max(
            -1,
            ...el.cells
              .filter((cell) => cell.parameter === key
                && cell.row >= itemBand.fromRow && cell.row <= itemBand.toRow)
              .map((cell) => cell.column),
          );
      this.host.edit.setRowCommandField(
        [...numericFields].sort((a, b) => columnOf(b.key) - columnOf(a.key))[0]?.key
          ?? numericFields.at(-1)?.key
          ?? '',
      );
    }
    this.host.edit.startRowCommand(command, this.host.edit.rowCommandField);
    this.host.resetPanelErrors();
  }

  /** 항목 행의 스타일을 바탕으로 행·소계·합계 명령을 한 번에 적용한다. */
  applyRowCommand(): void {
    const el = this.host.selectedElement();
    const command = this.host.edit.rowCommand;
    if (el?.type !== 'grid' || !el.repeat || command === null) return;
    const s = this.host.s;
    const itemBand = itemBandOf(el);
    if (itemBand === undefined) {
      this.host.reject(s.bandNeedsItem, 'grid-row-command');
      return;
    }
    if (command === 'group-subtotal'
      && (el.repeat.groupBy === undefined || el.repeat.groupBy.length === 0)) {
      this.host.reject(s.gridCommandGroupRequired, 'grid-row-command');
      return;
    }

    const fields = this.host.parameters()
      .find((parameter) => parameter.key === el.repeat!.parameter)?.fields ?? [];
    const numericField = fields.find(
      (field) => field.key === this.host.edit.rowCommandField && field.valueType === 'number',
    );
    if (command !== 'header' && numericField === undefined) {
      this.host.reject(s.gridCommandNumberRequired, 'grid-row-command');
      return;
    }

    const itemCells = el.cells.filter(
      (cell) => cell.row >= itemBand.fromRow && cell.row <= itemBand.toRow,
    );
    const firstItemRowCells = itemCells.filter((cell) => cell.row === itemBand.fromRow);
    const fieldTitles = new Map(fields.map((field) => [field.key, field.title]));
    const placement: GridBandPlacement = command === 'header'
      ? 'page-start'
      : command === 'group-subtotal'
        ? 'group-end'
        : command === 'page-subtotal'
          ? 'page-end'
          : 'after-data';
    const bandName = command === 'header'
      ? s.gridCommandHeaderName
      : command === 'group-subtotal'
        ? s.gridCommandGroupSubtotalName
        : command === 'page-subtotal'
          ? s.gridCommandPageSubtotalName
          : s.gridCommandFinalTotalName;

    const cloneCellStyle = (source: GridCell | undefined, row: number, column: number): GridCell => {
      const cell: GridCell = source === undefined
        ? { row, column, content: '' }
        : { ...structuredClone(source), row, column };
      delete (cell as { name?: unknown }).name;
      delete (cell as { rowSpan?: unknown }).rowSpan;
      delete (cell as { content?: unknown }).content;
      delete (cell as { parameter?: unknown }).parameter;
      delete (cell as { formula?: unknown }).formula;
      delete (cell as { conditionalFormats?: unknown }).conditionalFormats;
      return cell;
    };

    const added = this.addRowWithRole(placement, {
      separateBand: true,
      name: bandName,
      ...(command === 'page-subtotal' ? { pages: 'non-final' as const } : {}),
      initialize: (grid, row) => {
        if (command === 'header') {
          for (const source of firstItemRowCells) {
            const cell = cloneCellStyle(source, row, source.column);
            cell.content = source.parameter === undefined
              ? (source.content ?? '')
              : (fieldTitles.get(source.parameter) ?? source.parameter);
            grid.cells.push(cell);
          }
          return;
        }

        const fieldSource = itemCells.find((cell) => cell.parameter === numericField!.key);
        const targetColumn = fieldSource?.column
          ?? Math.max(0, ...firstItemRowCells.map((cell) => cell.column), grid.columns.length - 1);
        if (targetColumn > 0) {
          const labelSource = itemCells.find(
            (cell) => cell.column === 0 && cell.row === itemBand.fromRow,
          );
          const labelCell = cloneCellStyle(labelSource, row, 0);
          labelCell.content = bandName;
          if (targetColumn > 1) labelCell.colSpan = targetColumn;
          else delete (labelCell as { colSpan?: unknown }).colSpan;
          grid.cells.push(labelCell);
        }
        const valueCell = cloneCellStyle(fieldSource, row, targetColumn);
        const scope = command === 'group-subtotal' ? '@group'
          : command === 'page-subtotal' ? '@page' : '@all';
        valueCell.formula = `SUM(${scope}.${numericField!.key})`;
        grid.cells.push(valueCell);
      },
    });
    if (added === null) return;
    this.host.edit.clearRowCommand();
  }

  /**
   * 인라인 편집으로 입력한 셀의 직접 입력 값을 저장한다.
   * 파라미터나 수식을 쓰는 셀은 값 소스가 하나뿐이라 저장하지 않고 거부한다 (SPEC §5.7).
   *
   * @param value - 입력한 글
   */
  commitCellContent(value: string): void {
    const target = this.host.edit.cell;
    if (!target) return;
    this.host.edit.setEditing(false);
    const el = this.host.selectedElement();
    if (!isGrid(el)) return;
    const existing = el.cells.find((c) => c.row === target.row && c.column === target.column);
    // 셀은 직접 입력, 파라미터, 수식 중 하나만 사용할 수 있다 (SPEC §5.7).
    if (existing && ('parameter' in existing || 'formula' in existing)) {
      this.host.reject();
      return;
    }
    if (!existing && value === '') {
      this.host.clearInputError();
      return;
    }
    if (existing && existing.content === value) {
      this.host.clearInputError();
      return;
    }
    this.host.updateElement((element) => {
      if (!isGrid(element)) return;
      ensureCell(element, target.row, target.column).content = value;
    });
  }

  /** 선택 셀의 병합 범위를 변경한다. 유효하지 않은 범위는 거부한다. */
  setCellSpan(kind: 'rowSpan' | 'colSpan', value: number): void {
    const target = this.host.edit.cell;
    const el = this.host.selectedElement();
    if (!target || !isGrid(el)) return;
    const errorKey = kind === 'rowSpan' ? 'cell-row-span' : 'cell-column-span';
    if (!Number.isInteger(value) || value < 1) {
      this.host.reject(this.host.s.minimumInput.replace('{min}', '1'), errorKey);
      return;
    }
    const dims = gridDims(el);
    const current = el.cells.find((c) => c.row === target.row && c.column === target.column);
    const rowSpan = kind === 'rowSpan' ? value : (current?.rowSpan ?? 1);
    const colSpan = kind === 'colSpan' ? value : (current?.colSpan ?? 1);
    // 그리드 범위 검사
    if (target.row + rowSpan > dims.rows || target.column + colSpan > dims.columns) {
      this.host.reject(this.host.s.mergeOutOfGrid, errorKey);
      return;
    }
    // 병합 범위는 하나의 행 구간 안에 완전히 포함되어야 한다 (SPEC §5.7).
    if (el.repeat && rowSpan > 1) {
      const probe: GridCell = { row: target.row, column: target.column, rowSpan };
      if (spanCrossesBand(el.repeat.bands, probe)) {
        this.host.reject(this.host.s.mergeCrossRepeat, errorKey);
        return;
      }
    }
    // 다른 셀의 범위와 겹치는지 검사한다.
    const overlaps = el.cells.some((cell) => {
      if (cell === current) return false;
      const cellRowSpan = cell.rowSpan ?? 1;
      const cellColSpan = cell.colSpan ?? 1;
      return (
        target.row < cell.row + cellRowSpan &&
        cell.row < target.row + rowSpan &&
        target.column < cell.column + cellColSpan &&
        cell.column < target.column + colSpan
      );
    });
    if (overlaps) {
      this.host.reject(this.host.s.mergeOverlap, errorKey);
      return;
    }
    this.host.updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (rowSpan > 1) record.rowSpan = rowSpan;
      else delete record.rowSpan;
      if (colSpan > 1) record.colSpan = colSpan;
      else delete record.colSpan;
    });
  }

  /** 선택 셀의 스타일 속성을 설정하거나 제거한다. */
  updateCellStyle(key: string, value: unknown): void {
    const target = this.host.edit.cell;
    if (!target) return;
    this.host.updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (value === null || value === undefined || value === '') delete record[key];
      else record[key] = value;
    });
  }

  // ---------------------------------------------------------------------------
  // 그리드 편집
  // ---------------------------------------------------------------------------

  /**
   * 셀의 값 소스 종류를 선택한다.
   * 파라미터와 수식은 빈 값으로 저장할 수 없어 입력 전에는 화면 상태로만 유지한다.
   */
  chooseCellSource(kind: 'content' | 'parameter' | 'formula'): void {
    this.host.edit.setSourceKind(kind);
    const target = this.host.edit.cell;
    if (!target) return;
    this.host.updateElement((element) => {
      if (element.type !== 'grid') return;
      const cell = ensureCell(element, target.row, target.column);
      clearValueSources(cell);
      if (kind === 'content') cell.content = '';
    });
  }

  /**
   * 셀의 값 소스를 설정하고 다른 종류의 값 소스를 제거한다 (SPEC §5.7).
   */
  setCellSource(kind: 'content' | 'parameter' | 'formula', value: string): void {
    const target = this.host.edit.cell;
    // 선택된 셀이 없으면 입력을 적용하지 않고 오류를 표시한다.
    if (!target) {
      this.host.reject();
      return;
    }
    this.host.updateElement((element) => {
      if (element.type !== 'grid') return;
      const cell = ensureCell(element, target.row, target.column);
      clearValueSources(cell);
      if (value !== '') cell[kind] = value;
      else if (kind === 'content') cell.content = '';
    });
  }

  // ---------------------------------------------------------------------------
  // Snap helpers
  // ---------------------------------------------------------------------------

  /** 선택 셀의 조건부 서식 규칙 목록을 저장한다. 빈 목록이면 속성을 제거한다. */
  updateCellConditionalFormats(next: ConditionalFormatRule[]): void {
    const target = this.host.edit.cell;
    if (!target) return;
    this.host.updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (next.length === 0) delete record.conditionalFormats;
      else record.conditionalFormats = next;
    });
  }

  // ---------------------------------------------------------------------------
  // 모달 렌더링
  // ---------------------------------------------------------------------------

  /** 셀 선택과 값 소스 편집 상태를 해제한다. */
  clearCellSelection(): void {
    this.host.resetPanelErrors();
    this.host.edit.clearCellAndSource();
    this.host.refresh();
  }

  /**
   * 조건부 서식 미리보기에 사용할 항목 하나를 반복 파라미터의 샘플에서 선택한다.
   *
   * @param el - 대상 그리드
   * @returns 첫 번째 샘플 항목. 반복 설정이나 샘플이 없으면 undefined
   */
  repeatProbeItem(el: GridElement): Record<string, unknown> | undefined {
    if (!el.repeat) return undefined;
    const list = this.host.probeValues()[el.repeat.parameter];
    const item = Array.isArray(list) ? list[0] : undefined;
    return typeof item === 'object' && item !== null && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : undefined;
  }
}
