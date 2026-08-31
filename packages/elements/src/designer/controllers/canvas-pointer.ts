/**
 * 캔버스 포인터 조작 — 요소 만들기, 옮기기, 크기 조절과 선 끝점 드래그.
 *
 * @remarks
 * 조작 중에만 쓰는 임시 상태(드래그, 크기 조절, 그리는 중인 영역, 안내선)를 여기서 갖는다.
 * 문서를 고치는 일은 호스트에 맡긴다.
 */

import type { ReactiveController } from 'lit';
import type { GridElement, SlipElement, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  MIN_SIZE_MM,
  lineEndpoints,
  PX_PER_MM,
  SNAP_MM,
  bestSnap,
  boxOf,
  lineBoxFromLengthAngle,
  round1,
  setElementBox,
  snapCandidates,
  trackOffsets,
  type ResizeHandle,
  type SnapCandidates,
} from '../geometry.js';
import { columnWidths, gridDims, isGrid } from '../grid-model.js';
import type { CreatableType } from '../grid-view.js';
import type { GridEditController } from './grid-edit.js';
import type { SideSelection } from '../selection.js';

/** 요소를 드래그로 옮기는 중의 상태 */
export interface DragState {
  id: string;
  startPxX: number;
  startPxY: number;
  origMmX: number;
  origMmY: number;
  /** 실제 이동이 시작될 때 생성하는 되돌리기용 스냅샷 */
  snapshot: string | null;
  /** pointerdown 전에 선택된 요소였는지 여부 */
  wasSelected: boolean;
  /** 함께 이동할 선택 요소의 원래 위치 */
  members: { id: string; origX: number; origY: number }[];
}

/** 크기를 조절하는 중의 상태 */
export interface ResizeState {
  id: string;
  handle: ResizeHandle;
  startPxX: number;
  startPxY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  /** 첫 크기 변경 시 생성하는 되돌리기용 스냅샷 */
  snapshot: string | null;
}

/** 선 끝점을 드래그하는 중의 상태 */
export interface LineEndState {
  id: string;
  fixed: { x: number; y: number };
  snapshot: string | null;
  orig: { x: number; y: number; w: number; h: number; direction: string | undefined };
}

/** 포인터 조작이 문서에 요청하는 것 */
export interface PointerHost {
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 조작을 취소하고 조작 직전 상태로 되돌린다 */
  restoreSnapshot(snapshot: string): void;
  /** 도형 메뉴를 닫는다 */
  closeShapeMenu(): void;
  /** 주 선택 요소 */
  readonly selectedId: string | null;
  /** 함께 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
  /** 사이드바에서 고른 대상 */
  readonly sideSelection: SideSelection;
  /** 사이드바 선택을 푼다 */
  clearSideSelection(): void;
  /** 그리드 셀·행 구간 선택 상태 */
  readonly gridEdit: GridEditController;
  /** 출력 결과 보기(읽기 전용)인지 */
  readonly gridPlanPreview: boolean;
  /** 도형 메뉴가 열려 있는지 */
  readonly shapeMenuOpen: boolean;
  /** 캔버스 DOM을 찾을 뿌리 */
  readonly renderRoot: DocumentFragment | HTMLElement;
  /** 현재 페이지의 요소 목록 */
  pageElements(): SlipElement[] | undefined;
  /** id로 요소를 찾는다 */
  findElement(id: string): SlipElement | undefined;
  /** 속성 패널이 대상으로 삼는 요소 */
  selectedElement(): SlipElement | undefined;
  /** 요소를 만든다 */
  addElement(
    type: CreatableType,
    place?: {
      position: { x: number; y: number };
      width?: number;
      height?: number;
      /** 드래그 방향에서 계산한 선 방향 */
      lineDirection?: 'horizontal' | 'vertical' | 'down' | 'up';
    },
  ): void;
  /** 요소를 고른다 */
  selectElement(id: string): void;
  /** 선택을 모두 푼다 */
  clearSelection(): void;
  /** 선택한 요소를 고친다 */
  updateElement(fn: (el: SlipElement) => void): void;
  /** 조작 직전 상태를 되돌리기 기록에 넣는다 */
  pushUndoSnapshot(snapshot: string): void;
  /** 바뀐 양식을 호스트에 알린다 */
  emitChange(): void;
  /** 요소가 쓰는 파라미터를 사이드바에서 펼친다 */
  expandParameterOfElement(id: string): void;
  /** 격자에 맞춘 이동량 */
  gridDelta(value: number): number | null;
  /** 캔버스에 초점을 준다 */
  focusHost(): void;
  /** 화면을 다시 그린다 */
  refresh(): void;
}

export class CanvasPointerController implements ReactiveController {
  /** 요소를 드래그로 옮기는 중의 상태 */
  private _drag: DragState | null = null;
  /** 크기를 조절하는 중의 상태 */
  private _resize: ResizeState | null = null;
  /** 선 끝점을 드래그하는 중의 상태 */
  private _lineEnd: LineEndState | null = null;
  /** 드래그로 만드는 중인 요소 */
  private _draw: {
    type: CreatableType;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    moved: boolean;
  } | null = null;
  /** 드래그로 만드는 중인 사각 영역(mm) */
  private _drawRect: { x: number; y: number; w: number; h: number } | null = null;
  /** 선을 그리기 시작한 점(mm) */
  private _lineDraft: { x: number; y: number } | null = null;
  /** 선의 현재 끝점(mm) */
  private _lineGhost: { x: number; y: number } | null = null;
  /** 세로 정렬 안내선 위치(mm) */
  private _guideX: number | null = null;
  /** 가로 정렬 안내선 위치(mm) */
  private _guideY: number | null = null;
  /** 용지 위 커서 위치(mm) */
  private _cursorMm: { x: number; y: number } | null = null;
  /** 고른 생성 도구 */
  private _pendingTool: CreatableType | null = null;
  /** 다각형 도구로 만들 변의 수 */
  private _pendingSides = 3;

  constructor(private readonly host: PointerHost) {}

  /** 요소가 화면에서 빠지면 진행 중이던 포인터 조작과 안내선을 버린다. */
  hostDisconnected(): void {
    this._drag = null;
    this._resize = null;
    this._lineEnd = null;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this._guideX = null;
    this._guideY = null;
    this._cursorMm = null;
  }

  /** 요소를 드래그로 옮기는 중의 상태 */
  get drag(): DragState | null {
    return this._drag;
  }

  /** 크기를 조절하는 중의 상태 */
  get resize(): ResizeState | null {
    return this._resize;
  }

  /** 드래그로 만드는 중인 요소 */
  get draw(): CanvasPointerController['_draw'] {
    return this._draw;
  }

  /** 드래그로 만드는 중인 사각 영역(mm) */
  get drawRect(): { x: number; y: number; w: number; h: number } | null {
    return this._drawRect;
  }

  /** 선을 그리기 시작한 점(mm) */
  get lineDraft(): { x: number; y: number } | null {
    return this._lineDraft;
  }

  /** 선의 현재 끝점(mm) */
  get lineGhost(): { x: number; y: number } | null {
    return this._lineGhost;
  }

  /** 세로 정렬 안내선 위치(mm) */
  get guideX(): number | null {
    return this._guideX;
  }

  /** 가로 정렬 안내선 위치(mm) */
  get guideY(): number | null {
    return this._guideY;
  }

  /** 용지 위 커서 위치(mm) */
  get cursorMm(): { x: number; y: number } | null {
    return this._cursorMm;
  }

  /** 고른 생성 도구 */
  get pendingTool(): CreatableType | null {
    return this._pendingTool;
  }

  /** 다각형 도구로 만들 변의 수 */
  get pendingSides(): number {
    return this._pendingSides;
  }

  /** 진행 중인 만들기·그리기를 취소한다. 화면 갱신은 호출부가 처리한다. */
  cancelDrawing(): void {
    this._pendingTool = null;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
  }

  /** 선을 그리는 중인 상태를 지운다. 화면 갱신은 호출부가 처리한다. */
  cancelLine(): void {
    this._lineDraft = null;
    this._lineGhost = null;
    this._lineEnd = null;
  }

  /** 고른 생성 도구를 취소한다. 화면 갱신은 호출부가 처리한다. */
  cancelTool(): void {
    this._pendingTool = null;
  }

  /** 용지 위 커서 표시를 지운다. */
  clearCursor(): void {
    this._cursorMm = null;
    this.host.refresh();
  }

  /** 진행 중인 조작과 도구 선택을 모두 지운다. 화면 갱신은 호출부가 처리한다. */
  reset(): void {
    this._drag = null;
    this._resize = null;
    this._lineEnd = null;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this._guideX = null;
    this._guideY = null;
    this._cursorMm = null;
    this._pendingTool = null;
  }
  /** 포인터 좌표를 용지 기준 mm 좌표로 (용지 밖은 가장자리로 보정) */
  paperPoint(e: PointerEvent): { x: number; y: number } {
    const rect = (this.host.renderRoot.querySelector('.paper') as HTMLElement | null)
      ?.getBoundingClientRect();
    const { paper } = this.host.file!.template;
    return {
      x: Math.max(0, Math.min((e.clientX - (rect?.left ?? 0)) / PX_PER_MM, paper.width)),
      y: Math.max(0, Math.min((e.clientY - (rect?.top ?? 0)) / PX_PER_MM, paper.height)),
    };
  }

  onPointerDown = (e: PointerEvent): void => {
    if (!this.host.file) return;
    // preventDefault로 기본 포커스 이동이 막히므로 호스트에 포커스를 설정해 단축키를 유지한다.
    this.host.focusHost();

    // 출력 결과 보기는 계획 결과를 확인하는 읽기 전용 상태다.
    if (this.host.gridPlanPreview) {
      e.preventDefault();
      return;
    }

    // 생성 도구가 선택돼 있으면 클릭·드래그는 요소 생성이다 (선택·이동보다 우선)
    if (this._pendingTool) {
      const p = this.paperPoint(e);
      this._draw = { type: this._pendingTool, startX: p.x, startY: p.y, endX: p.x, endY: p.y, moved: false };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    // 반대쪽 끝점을 고정하고 선택한 끝점만 이동한다.
    const endpointEl = (e.target as HTMLElement).closest?.('.endpoint') as HTMLElement | null;
    if (endpointEl && this.host.selectedId) {
      const el = this.host.selectedElement();
      if (!el || el.type !== 'line') return;
      const which = endpointEl.dataset.endpoint === '1' ? 1 : 0;
      const points = lineEndpoints(el);
      this._lineEnd = {
        id: el.id,
        fixed: points[which === 0 ? 1 : 0]!,
        snapshot: null,
        orig: {
          x: el.position.x, y: el.position.y, w: el.width, h: el.height,
          direction: el.lineDirection,
        },
      };
      endpointEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const handleEl = (e.target as HTMLElement).closest?.('.handle') as HTMLElement | null;
    if (handleEl && this.host.selectedId) {
      const el = this.host.selectedElement();
      const handle = handleEl.dataset.handle as ResizeHandle | undefined;
      if (!el || !handle) return;
      const elBox = boxOf(el);
      this._resize = {
        id: el.id,
        handle,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origX: el.position.x,
        origY: el.position.y,
        origW: elBox.width,
        origH: elBox.height,
        snapshot: null,
      };
      handleEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 인라인 셀 입력 상자 안 클릭은 편집기에 맡긴다 (여기서 가로채면 입력이 불가능)
    if ((e.target as HTMLElement).closest?.('.cell-editor')) return;

    const target = (e.target as HTMLElement).closest?.('.element') as HTMLElement | null;

    if (target) {
      const id = target.dataset.id;
      if (!id) return;
      const wasSelected = this.host.selectedId === id;
      // 그룹에 속하면 그룹 전체가 함께 선택된다
      this.host.selectElement(id);
      this.host.clearSideSelection();
      this.host.expandParameterOfElement(id);
      if (!wasSelected) {
        this.host.gridEdit.clearCell();
      }

      const el = this.host.findElement(id);
      if (!el) return;

      // 선택된 요소(그룹·다중)를 함께 옮기려 각 원래 위치를 기억한다
      const members = [...this.host.selectedIds]
        .map((mid) => this.host.findElement(mid))
        .filter((m): m is SlipElement => m !== undefined)
        .map((m) => ({ id: m.id, origX: m.position.x, origY: m.position.y }));
      this._drag = {
        id,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origMmX: el.position.x,
        origMmY: el.position.y,
        snapshot: null,
        wasSelected,
        members,
      };
      target.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      this.host.clearSelection();
      this.host.clearSideSelection();
      this.host.gridEdit.clearCellAndSource();
    }
    this.host.refresh();
  };

  onPointerMove = (e: PointerEvent): void => {
    if (this._draw) {
      const p = this.paperPoint(e);
      this._draw.endX = p.x;
      this._draw.endY = p.y;
      const w = Math.abs(p.x - this._draw.startX);
      const h = Math.abs(p.y - this._draw.startY);
      // 1mm 넘게 움직였을 때만 드래그로 본다 (클릭 손떨림은 기본 크기 생성)
      if (w > 1 || h > 1) this._draw.moved = true;
      if (this._draw.type === 'line') {
        // 선은 상자 대신 시작점→커서 미리보기 선으로 보여준다
        this.host.refresh();
        return;
      }
      this._drawRect = {
        x: round1(Math.min(this._draw.startX, p.x)),
        y: round1(Math.min(this._draw.startY, p.y)),
        w: round1(w),
        h: round1(h),
      };
      this.host.refresh();
      return;
    }
    // 두 번째 끝점을 선택할 때까지 커서 위치에 미리보기 선을 표시한다.
    if (this._lineDraft && this._pendingTool === 'line') {
      this._lineGhost = this.paperPoint(e);
      this.host.refresh();
      return;
    }
    if (this._lineEnd) {
      this.onLineEndMove(e);
      return;
    }
    if (this._resize) {
      this.onResizeMove(e);
      return;
    }
    if (!this._drag) return;

    const el = this.host.findElement(this._drag.id);
    if (!el) return;
    this._drag.snapshot ??= JSON.stringify(this.host.file);

    const dx = (e.clientX - this._drag.startPxX) / PX_PER_MM;
    const dy = (e.clientY - this._drag.startPxY) / PX_PER_MM;
    let nx = this._drag.origMmX + dx;
    let ny = this._drag.origMmY + dy;

    // Alt를 누르면 스냅 없이 자유 이동
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!e.altKey) {
      // 함께 움직이는 선택 요소는 스냅 후보에서 뺀다
      const { xs, ys } = this.snapCandidatesFor(new Set(this._drag.members.map((m) => m.id)));
      const dragBox = boxOf(el);
      const sx = bestSnap([nx, nx + dragBox.width / 2, nx + dragBox.width], xs);
      const sy = bestSnap([ny, ny + dragBox.height / 2, ny + dragBox.height], ys);
      if (sx) {
        nx += sx.delta;
        guideX = sx.line;
      } else {
        // 붙을 요소·여백선이 없으면 격자에 맞춘다
        const g = this.host.gridDelta(nx);
        if (g !== null) nx += g;
      }
      if (sy) {
        ny += sy.delta;
        guideY = sy.line;
      } else {
        const g = this.host.gridDelta(ny);
        if (g !== null) ny += g;
      }
    }

    // 주 요소를 옮긴 만큼(스냅 반영) 선택된 요소를 모두 같은 양으로 옮긴다
    const deltaX = nx - this._drag.origMmX;
    const deltaY = ny - this._drag.origMmY;
    for (const m of this._drag.members) {
      const me = this.host.findElement(m.id);
      if (!me) continue;
      me.position.x = Math.max(0, round1(m.origX + deltaX));
      me.position.y = Math.max(0, round1(m.origY + deltaY));
    }
    this._guideX = guideX;
    this._guideY = guideY;
    this.host.refresh();
  };

  /**
   * 크기 조절 손잡이를 드래그하는 동안 요소의 위치와 크기를 갱신한다.
   *
   * @param e - 포인터 이동 이벤트
   */
  onResizeMove(e: PointerEvent): void {
    const r = this._resize!;
    const el = this.host.findElement(r.id);
    if (!el) return;
    r.snapshot ??= JSON.stringify(this.host.file);

    const dx = (e.clientX - r.startPxX) / PX_PER_MM;
    const dy = (e.clientY - r.startPxY) / PX_PER_MM;
    const h = r.handle;

    let left = r.origX;
    let top = r.origY;
    let right = r.origX + r.origW;
    let bottom = r.origY + r.origH;
    if (h.includes('w')) left += dx;
    if (h.includes('e')) right += dx;
    if (h.includes('n')) top += dy;
    if (h.includes('s')) bottom += dy;

    // 움직이는 변만 후보 선에 스냅한다 (Alt로 해제)
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!e.altKey) {
      const { xs, ys } = this.snapCandidatesFor(r.id);
      // 붙을 요소·여백선이 없는 변은 격자에 맞춘다
      const toGrid = (value: number): number => value + (this.host.gridDelta(value) ?? 0);
      if (h.includes('w')) {
        const s = bestSnap([left], xs);
        if (s) { left += s.delta; guideX = s.line; }
        else left = toGrid(left);
      }
      if (h.includes('e')) {
        const s = bestSnap([right], xs);
        if (s) { right += s.delta; guideX = s.line; }
        else right = toGrid(right);
      }
      if (h.includes('n')) {
        const s = bestSnap([top], ys);
        if (s) { top += s.delta; guideY = s.line; }
        else top = toGrid(top);
      }
      if (h.includes('s')) {
        const s = bestSnap([bottom], ys);
        if (s) { bottom += s.delta; guideY = s.line; }
        else bottom = toGrid(bottom);
      }
    }

    if (h.includes('w')) left = Math.min(Math.max(0, left), right - MIN_SIZE_MM);
    if (h.includes('e')) right = Math.max(right, left + MIN_SIZE_MM);
    if (h.includes('n')) top = Math.min(Math.max(0, top), bottom - MIN_SIZE_MM);
    if (h.includes('s')) bottom = Math.max(bottom, top + MIN_SIZE_MM);

    el.position.x = round1(left);
    el.position.y = round1(top);
    setElementBox(el, round1(right - left), round1(bottom - top));
    this._guideX = guideX;
    this._guideY = guideY;
    this.host.refresh();
  }

  /** 선 끝점 드래그 — 고정 끝점→커서 벡터로 상자와 선 방향을 다시 계산한다  */
  onLineEndMove(e: PointerEvent): void {
    const state = this._lineEnd!;
    const el = this.host.findElement(state.id);
    if (!el || el.type !== 'line') return;
    state.snapshot ??= JSON.stringify(this.host.file);

    const p = this.paperPoint(e);
    const dx = p.x - state.fixed.x;
    const dy = p.y - state.fixed.y;
    // 드래그 생성과 같은 규칙: 1mm 이내는 수평·수직, 그 밖은 기울기 부호로 사선 방향
    el.lineDirection =
      Math.abs(dy) <= 1 ? 'horizontal'
      : Math.abs(dx) <= 1 ? 'vertical'
      : dx * dy > 0 ? 'down' : 'up';
    el.position.x = round1(Math.min(p.x, state.fixed.x));
    el.position.y = round1(Math.min(p.y, state.fixed.y));
    el.width = round1(Math.abs(dx));
    el.height = round1(Math.abs(dy));
    this.host.refresh();
  }

  onPointerCancel = (): void => {
    // 포인터 동작이 취소되면 편집 전 스냅샷을 복원하고 드래그 상태를 초기화한다.
    const snapshot = this._drag?.snapshot ?? this._resize?.snapshot ?? this._lineEnd?.snapshot;
    if (snapshot) {
      this.host.restoreSnapshot(snapshot);
    }
    this._drag = null;
    this._resize = null;
    this._lineEnd = null;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this._guideX = null;
    this._guideY = null;
    this.host.refresh();
  };

  /**
   * 드래그·크기 조절·끝점 이동이 실제로 값을 바꿨으면 스냅샷을 되돌리기에 쌓고 변경을 알린다.
   *
   * @param snapshot - 조작 시작 시 찍어 둔 되돌리기 스냅샷 (없으면 커밋하지 않음)
   * @param changed - 위치·크기가 실제로 바뀌었는지
   * @returns 커밋했으면 true
   */
  commitIfMoved(snapshot: string | null, changed: boolean): boolean {
    if (snapshot !== null && changed) {
      this.host.pushUndoSnapshot(snapshot);
      this.host.emitChange();
      return true;
    }
    return false;
  }

  onPointerUp = (e: PointerEvent): void => {
    if (this._draw) {
      const d = this._draw;
      const rect = this._drawRect;
      this._draw = null;
      this._drawRect = null;
      if (d.type === 'line') {
        this.finishLineDraw(d);
        return;
      }
      this._pendingTool = null;
      if (d.moved && rect) {
        // 드래그: 만들어진 사각형의 위치·크기로 생성 (최소 크기는 _addElement가 보정)
        this.host.addElement(d.type, {
          position: { x: rect.x, y: rect.y }, width: rect.w, height: rect.h,
        });
      } else {
        // 클릭: 그 위치에 종류별 기본 크기로 생성
        this.host.addElement(d.type, { position: { x: round1(d.startX), y: round1(d.startY) } });
      }
      return;
    }

    // 안내선은 Lit 상태가 아니므로 지운 뒤 직접 다시 그리게 한다.
    this._guideX = null;
    this._guideY = null;
    this.host.refresh();

    if (this._lineEnd) {
      const state = this._lineEnd;
      this._lineEnd = null;
      const el = this.host.findElement(state.id);
      const changed = !!el && el.type === 'line' &&
        (el.position.x !== state.orig.x || el.position.y !== state.orig.y ||
          el.width !== state.orig.w || el.height !== state.orig.h ||
          el.lineDirection !== state.orig.direction);
      this.commitIfMoved(state.snapshot, changed);
      this.host.refresh();
      return;
    }

    if (this._resize) {
      const r = this._resize;
      const el = this.host.findElement(r.id);
      const resizedBox = el === undefined ? undefined : boxOf(el);
      const changed = !!el && resizedBox !== undefined &&
        (el.position.x !== r.origX || el.position.y !== r.origY ||
          resizedBox.width !== r.origW || resizedBox.height !== r.origH);
      this.commitIfMoved(r.snapshot, changed);
      this._resize = null;
      this.host.refresh();
      return;
    }

    if (!this._drag) return;
    const drag = this._drag;
    this._drag = null;
    const el = this.host.findElement(drag.id);
    const dragChanged = !!el &&
      (el.position.x !== drag.origMmX || el.position.y !== drag.origMmY);
    if (this.commitIfMoved(drag.snapshot, dragChanged)) return;
    // 선택된 그리드를 다시 클릭하면 해당 셀의 인라인 편집을 시작한다.
    if (isGrid(el) && drag.wasSelected && drag.snapshot === null) {
      const cell = this.cellAtPoint(el, e);
      if (cell) {
        if (this.host.gridEdit.cell?.row !== cell.row || this.host.gridEdit.cell?.column !== cell.column) {
          this.host.gridEdit.setSourceKind(null);
        }
        this.host.gridEdit.selectCell(cell);
        this.host.gridEdit.closeBandMenu(true);
        const definition = el.cells.find((item) => item.row === cell.row && item.column === cell.column);
        // 파라미터와 수식 셀은 속성 패널에서 편집하며 캔버스 입력기는 열지 않는다.
        this.host.gridEdit.setEditing(
          definition === undefined
            || (definition.parameter === undefined && definition.formula === undefined),
        );
        this.host.refresh();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 그리드 셀 편집
  // ---------------------------------------------------------------------------

  /** 포인터가 가리키는 셀의 시작 좌표를 반환한다. */
  cellAtPoint(
    el: GridElement,
    e: PointerEvent,
  ): { row: number; column: number } | null {
    const point = this.paperPoint(e);
    const relX = point.x - el.position.x;
    const relY = point.y - el.position.y;
    const gridBox = boxOf(el);
    if (relX < 0 || relY < 0 || relX > gridBox.width || relY > gridBox.height) return null;

    const colOffsets = trackOffsets(columnWidths(el));
    const rowOffsets = trackOffsets(el.rows.map((r) => r.height));
    const dims = gridDims(el);
    // 오른쪽과 아래쪽 경계는 마지막 셀에 포함한다.
    const indexOf = (value: number, offsets: number[], count: number): number => {
      const found = offsets.findIndex((offset) => value < offset) - 1;
      return found < 0 ? count - 1 : Math.min(count - 1, found);
    };
    const column = indexOf(relX, colOffsets, dims.columns);
    const row = indexOf(relY, rowOffsets, dims.rows);

    // 병합된 셀 안의 좌표는 병합 시작 셀로 변환한다.
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
   * 눈금자에 표시할 커서의 용지 좌표를 기록하고 용지 밖에서는 지운다.
   *
   * @param e - 포인터 이동 이벤트
   */
  trackCursor(e: PointerEvent): void {
    const paper = this.host.renderRoot.querySelector('.paper');
    if (!paper) return;
    const rect = paper.getBoundingClientRect();
    const x = (e.clientX - rect.left) / PX_PER_MM;
    const y = (e.clientY - rect.top) / PX_PER_MM;
    const { paper: size } = this.host.file!.template;
    const inside = x >= 0 && y >= 0 && x <= size.width && y <= size.height;
    const next = inside ? { x: round1(x), y: round1(y) } : null;
    if (next?.x === this._cursorMm?.x && next?.y === this._cursorMm?.y) return;
    this._cursorMm = next;
    this.host.refresh();
  }

  /** 스냅 후보 선: 용지 가장자리·여백선 + 다른 요소들의 가장자리·중앙선 (mm) */
  snapCandidatesFor(exclude: string | ReadonlySet<string>): SnapCandidates {
    // 그룹·다중 이동 때는 함께 움직이는 요소들을 후보에서 모두 뺀다
    const excluded = typeof exclude === 'string' ? new Set([exclude]) : exclude;
    return snapCandidates(this.host.file!.template.paper, this.host.pageElements() ?? [], excluded);
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  /**
   * 드래그 또는 두 번의 클릭으로 선을 생성한다.
   * 첫 클릭은 시작점을 저장하고 두 번째 클릭은 끝점을 지정한다.
   */
  finishLineDraw(d: { startX: number; startY: number; endX: number; endY: number; moved: boolean }): void {
    if (!d.moved && !this._lineDraft) {
      this._lineDraft = { x: d.startX, y: d.startY };
      this._lineGhost = { x: d.endX, y: d.endY };
      this.host.refresh();
      return;
    }
    const from = this._lineDraft ?? { x: d.startX, y: d.startY };
    this._lineDraft = null;
    this._lineGhost = null;
    this._pendingTool = null;
    this.createLineBetween(from, { x: d.endX, y: d.endY });
  }

  /** 두 점을 잇는 선 요소를 만든다. */
  createLineBetween(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    this.host.addElement('line', {
      position: { x: round1(Math.min(from.x, to.x)), y: round1(Math.min(from.y, to.y)) },
      width: Math.abs(dx),
      height: Math.abs(dy),
      lineDirection:
        Math.abs(dy) <= 1 ? 'horizontal'
        : Math.abs(dx) <= 1 ? 'vertical'
        : dx * dy > 0 ? 'down' : 'up',
    });
  }

  /** 생성 도구를 선택하거나 같은 도구를 다시 선택해 해제한다. */
  selectTool(type: CreatableType): void {
    this._pendingTool = this._pendingTool === type ? null : type;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this.host.refresh();
  }

  /** 도형 종류와 다각형의 변 수를 선택한다. */
  selectShapeTool(type: 'rect' | 'ellipse' | 'polygon', sides = 3): void {
    this.host.closeShapeMenu();
    this._pendingSides = sides;
    this._pendingTool = type;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this.host.refresh();
  }
}
