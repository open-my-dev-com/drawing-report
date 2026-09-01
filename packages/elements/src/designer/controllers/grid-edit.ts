/**
 * 그리드 편집의 선택 상태 — 셀 선택, 인라인 편집, 행 구간 선택과 행 추가 명령.
 *
 * @remarks
 * 값 변경은 호출부가 담당하고, 이 컨트롤러는 편집 대상을 관리한다.
 * 그리드가 아닌 요소를 선택하거나 양식을 다시 불러오면 `reset`으로 한꺼번에 지운다.
 */

import type { ReactiveController } from 'lit';
import type { GridRowCommand } from '../grid-model.js';

export interface GridEditHost {
  requestUpdate(): void;
}

/** 선택한 셀의 좌표 (0부터) */
export interface CellPosition {
  row: number;
  column: number;
}

/** 행 번호 선택 영역에서 선택한 행 범위 (0부터) */
export interface BandRange {
  from: number;
  to: number;
}

/** 그리드 셀에서 편집 중인 값 소스 종류 */
export type CellSourceKind = 'content' | 'parameter' | 'formula';

export class GridEditController implements ReactiveController {
  private _cell: CellPosition | null = null;
  private _sourceKind: CellSourceKind | null = null;
  private _editing = false;
  private _bandRange: BandRange | null = null;
  private _bandMenuOpen = false;
  private _focusBandMenu = false;
  private _rowCommand: GridRowCommand | null = null;
  private _rowCommandField = '';

  constructor(private readonly host: GridEditHost) {}

  hostConnected(): void {
    this.host.requestUpdate();
  }

  /** 병합과 인라인 편집의 대상인 셀. 선택한 셀이 없으면 null */
  get cell(): CellPosition | null {
    return this._cell;
  }

  /** 셀에서 편집 중인 값 소스 종류 */
  get sourceKind(): CellSourceKind | null {
    return this._sourceKind;
  }

  /** 셀을 캔버스에서 직접 편집 중인지 */
  get editing(): boolean {
    return this._editing;
  }

  /** 역할 명령 메뉴가 대상으로 삼는 행 범위 */
  get bandRange(): BandRange | null {
    return this._bandRange;
  }

  /** 행 역할 명령 메뉴가 열려 있는지 */
  get bandMenuOpen(): boolean {
    return this._bandMenuOpen;
  }

  /** 적용 전 결과를 확인 중인 행 추가 명령 */
  get rowCommand(): GridRowCommand | null {
    return this._rowCommand;
  }

  /** 소계·합계 명령에서 집계할 목록 필드 */
  get rowCommandField(): string {
    return this._rowCommandField;
  }

  /**
   * 셀을 선택한다.
   *
   * @param cell - 선택할 셀의 좌표
   */
  selectCell(cell: CellPosition): void {
    this._cell = cell;
    this.host.requestUpdate();
  }

  /** 셀 선택과 인라인 편집을 함께 해제한다. 값 소스 종류는 그대로 둔다. */
  clearCell(): void {
    this._cell = null;
    this._editing = false;
    this.host.requestUpdate();
  }

  /** 셀 선택, 인라인 편집과 값 소스 종류를 모두 해제한다. */
  clearCellAndSource(): void {
    this._sourceKind = null;
    this.clearCell();
  }

  /**
   * 인라인 편집을 켜거나 끈다.
   *
   * @param editing - 편집 중이면 true
   */
  setEditing(editing: boolean): void {
    this._editing = editing;
    this.host.requestUpdate();
  }

  /**
   * 편집 중인 값 소스 종류를 바꾼다.
   *
   * @param kind - 값 소스 종류. null이면 정하지 않은 상태
   */
  setSourceKind(kind: CellSourceKind | null): void {
    this._sourceKind = kind;
    this.host.requestUpdate();
  }

  /**
   * 행 범위를 선택한다.
   *
   * @param range - 선택할 행 범위. null이면 해제
   */
  selectBand(range: BandRange | null): void {
    this._bandRange = range;
    this.host.requestUpdate();
  }

  /**
   * 행 역할 명령 메뉴를 연다.
   *
   * @param focusFirst - 열자마자 첫 명령으로 초점을 옮기면 true
   */
  openBandMenu(focusFirst: boolean): void {
    this._bandMenuOpen = true;
    this._focusBandMenu = focusFirst;
    this.host.requestUpdate();
  }

  /**
   * 행 역할 명령 메뉴를 닫는다.
   *
   * @param clearRange - 선택한 행 범위도 함께 해제하면 true
   */
  closeBandMenu(clearRange: boolean): void {
    this._bandMenuOpen = false;
    if (clearRange) this._bandRange = null;
    this.host.requestUpdate();
  }

  /**
   * 메뉴를 연 뒤 초점을 옮길 차례인지 확인하고 그 표시를 지운다.
   *
   * @remarks
   * 화면을 그린 직후에 부르므로 여기서 화면 갱신을 요청하지 않는다 — 다시 그리게 된다.
   *
   * @returns 이번에 초점을 옮겨야 하면 true
   */
  takeFocusBandMenu(): boolean {
    if (!this._focusBandMenu) return false;
    this._focusBandMenu = false;
    return true;
  }

  /**
   * 행 추가 명령을 시작한다.
   *
   * @param command - 확인할 명령
   * @param field - 집계할 목록 필드 (없으면 빈 문자열)
   */
  startRowCommand(command: GridRowCommand, field: string): void {
    this._rowCommand = command;
    this._rowCommandField = field;
    this.host.requestUpdate();
  }

  /**
   * 행 추가 명령에서 집계할 필드를 바꾼다.
   *
   * @param field - 선택한 목록 필드
   */
  setRowCommandField(field: string): void {
    this._rowCommandField = field;
    this.host.requestUpdate();
  }

  /** 행 추가 명령을 취소한다. */
  clearRowCommand(): void {
    this._rowCommand = null;
    this._rowCommandField = '';
    this.host.requestUpdate();
  }

  /** 그리드 편집 상태를 모두 지운다. 화면 갱신은 호출부가 처리한다. */
  reset(): void {
    this._cell = null;
    this._sourceKind = null;
    this._editing = false;
    this._bandRange = null;
    this._bandMenuOpen = false;
    this._focusBandMenu = false;
    this._rowCommand = null;
    this._rowCommandField = '';
  }
}
