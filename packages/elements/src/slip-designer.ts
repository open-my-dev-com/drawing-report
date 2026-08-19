import { LitElement, css, html, nothing } from 'lit';
import {
  parseSlipFile,
  renderSlipToPdf,
  CURRENT_SCHEMA_VERSION,
  type SlipFile,
  type SlipTemplateFile,
  type SlipElement,
  type RenderOptions,
} from '@slipkit/core';
import { strings } from './strings.js';
import { presets } from './presets.js';

const PX_PER_MM = 96 / 25.4;
const MAX_UNDO = 50;
/** 스냅이 붙는 거리(mm) — 이 안으로 들어오면 후보 선에 끌어붙인다 */
const SNAP_MM = 1.5;
/** 크기 조절 최소 폭·높이(mm) */
const MIN_SIZE_MM = 2;

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** mm 좌표를 0.1mm 단위로 반올림 */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

const PLACEHOLDER_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const TYPE_BADGE: Record<SlipElement['type'], string> = {
  text: 'T',
  fixedGrid: '⊞',
  dynamicTable: '表',
  image: 'IMG',
  shape: '◇',
  field: 'F',
};

interface DragState {
  id: string;
  startPxX: number;
  startPxY: number;
  origMmX: number;
  origMmY: number;
  snapshot: string;
}

interface ResizeState {
  id: string;
  handle: ResizeHandle;
  startPxX: number;
  startPxY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  snapshot: string;
}

export class SlipDesigner extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      grid-template-columns: 1fr 260px;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #333;
      overflow: hidden;
    }

    .toolbar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 8px;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }
    .toolbar button {
      padding: 4px 10px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .toolbar button:hover:not(:disabled) {
      background: #e8e8e8;
    }
    .toolbar button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .toolbar select {
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: #fff;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      cursor: pointer;
    }
    .toolbar .page-indicator {
      min-width: 40px;
      text-align: center;
      font-size: 12px;
      color: #555;
    }
    .toolbar .sep {
      width: 1px;
      height: 20px;
      background: #ddd;
      margin: 0 4px;
    }

    .canvas-area {
      grid-row: 2;
      grid-column: 1;
      overflow: auto;
      background: #e0e0e0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 24px;
    }
    .paper {
      position: relative;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }
    .padding-guide {
      position: absolute;
      border: 1px dashed rgba(0, 0, 0, 0.1);
      pointer-events: none;
    }

    .element {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid rgba(0, 0, 0, 0.15);
      cursor: move;
      overflow: hidden;
      user-select: none;
      font-size: 11px;
      line-height: 1.3;
    }
    .element > * {
      pointer-events: none;
    }
    .element.selected {
      box-shadow: 0 0 0 2px #1a73e8;
      z-index: 10;
    }
    .element .badge {
      position: absolute;
      top: 1px;
      left: 1px;
      padding: 0 3px;
      font-size: 9px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 2px;
      color: #666;
      line-height: 14px;
    }
    .element .el-content {
      display: flex;
      align-items: center;
      width: 100%;
      height: 100%;
      padding: 2px 4px 2px 22px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .element.type-image {
      background: #f5f5f5;
    }
    .element.type-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      position: absolute;
      inset: 0;
    }
    .element .grid-preview {
      position: absolute;
      inset: 0;
      display: grid;
    }
    .element .grid-preview > div {
      border: 1px solid rgba(0, 0, 0, 0.15);
    }
    .element .table-preview {
      position: absolute;
      inset: 0;
      display: flex;
    }
    .element .table-preview > div {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(0, 0, 0, 0.2);
      font-size: 10px;
      overflow: hidden;
    }
    .element.type-shape svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .selection-overlay {
      position: absolute;
      pointer-events: none;
      z-index: 15;
    }
    .selection-overlay .handle {
      pointer-events: auto;
      position: absolute;
      width: 8px;
      height: 8px;
      background: #fff;
      border: 1px solid #1a73e8;
      border-radius: 1px;
      box-sizing: border-box;
    }
    .handle-nw { left: -4px; top: -4px; cursor: nwse-resize; }
    .handle-n { left: calc(50% - 4px); top: -4px; cursor: ns-resize; }
    .handle-ne { right: -4px; top: -4px; cursor: nesw-resize; }
    .handle-e { right: -4px; top: calc(50% - 4px); cursor: ew-resize; }
    .handle-se { right: -4px; bottom: -4px; cursor: nwse-resize; }
    .handle-s { left: calc(50% - 4px); bottom: -4px; cursor: ns-resize; }
    .handle-sw { left: -4px; bottom: -4px; cursor: nesw-resize; }
    .handle-w { left: -4px; top: calc(50% - 4px); cursor: ew-resize; }

    .snap-guide {
      position: absolute;
      pointer-events: none;
      background: #e91e63;
      z-index: 20;
    }
    .snap-guide.vertical {
      top: 0;
      bottom: 0;
      width: 1px;
    }
    .snap-guide.horizontal {
      left: 0;
      right: 0;
      height: 1px;
    }

    .prop-panel {
      grid-row: 2;
      grid-column: 2;
      border-left: 1px solid #ddd;
      padding: 12px;
      overflow-y: auto;
      background: #fafafa;
    }
    .panel-empty {
      color: #999;
      text-align: center;
      padding-top: 40px;
    }
    .prop-section {
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
    }
    .prop-section:last-child {
      border-bottom: none;
    }
    .prop-section-title {
      font-size: 11px;
      font-weight: 600;
      color: #888;
      margin-bottom: 6px;
    }
    .type-name {
      font-size: 12px;
      font-weight: 600;
      color: #444;
      margin-bottom: 10px;
    }
    .prop-row {
      display: flex;
      align-items: center;
      margin: 3px 0;
      gap: 6px;
    }
    .prop-row label {
      min-width: 52px;
      font-size: 12px;
      color: #666;
      flex-shrink: 0;
    }
    .prop-row input,
    .prop-row select,
    .prop-row textarea {
      flex: 1;
      min-width: 0;
      padding: 3px 6px;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .prop-row input[type='number'] {
      width: 65px;
      flex: 0 0 65px;
    }
    .prop-row textarea {
      resize: vertical;
    }
    .prop-pair {
      display: flex;
      gap: 6px;
    }
    .prop-pair .prop-row {
      flex: 1;
    }

    .preview-area {
      grid-column: 1 / -1;
    }
    .preview-area iframe {
      width: 100%;
      height: 100%;
      border: none;
    }

    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      font-size: 14px;
    }
    .empty-state.error {
      color: #c00;
    }
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
    }
  `;

  static properties = {
    src: { type: String },
    fonts: { attribute: false },
    _file: { state: true },
    _pageIndex: { state: true },
    _selectedId: { state: true },
    _previewMode: { state: true },
    _previewUrl: { state: true },
    _error: { state: true },
    _guideX: { state: true },
    _guideY: { state: true },
  };

  src = '';
  fonts?: RenderOptions['fonts'];

  private _file: SlipTemplateFile | null = null;
  private _pageIndex = 0;
  private _selectedId: string | null = null;
  private _undoStack: string[] = [];
  private _redoStack: string[] = [];
  private _previewMode = false;
  private _previewUrl: string | null = null;
  private _error: string | null = null;
  private _drag: DragState | null = null;
  private _resize: ResizeState | null = null;
  private _clipboard: SlipElement | null = null;
  private _guideX: number | null = null;
  private _guideY: number | null = null;
  private _previewGeneration = 0;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this._onKeyDown);
    if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '0');
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._onKeyDown);
    this._revokePreviewUrl();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
    }
  }

  // ---------------------------------------------------------------------------
  // Source parsing
  // ---------------------------------------------------------------------------

  private _parseSource(): void {
    this._revokePreviewUrl();
    this._error = null;
    this._selectedId = null;
    this._undoStack = [];
    this._redoStack = [];
    this._previewMode = false;
    this._pageIndex = 0;
    this._drag = null;
    this._resize = null;
    this._guideX = null;
    this._guideY = null;
    this._clipboard = null;

    if (!this.src) {
      this._file = null;
      return;
    }

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src);
    } catch {
      this._file = null;
      this._error = strings.designer.parseError;
      return;
    }

    if (file.kind !== 'template') {
      this._file = null;
      this._error = strings.designer.onlyTemplate;
      return;
    }

    this._file = file;
  }

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------

  private _pushUndo(): void {
    if (!this._file) return;
    this._pushUndoSnapshot(JSON.stringify(this._file));
  }

  private _pushUndoSnapshot(snapshot: string): void {
    this._undoStack.push(snapshot);
    this._redoStack = [];
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
  }

  private _undo(): void {
    if (this._undoStack.length === 0 || !this._file) return;
    this._redoStack.push(JSON.stringify(this._file));
    this._file = JSON.parse(this._undoStack.pop()!) as SlipTemplateFile;
    this._clampPageIndex();
    this._validateSelection();
    this._emitChange();
  }

  private _redo(): void {
    if (this._redoStack.length === 0 || !this._file) return;
    this._undoStack.push(JSON.stringify(this._file));
    this._file = JSON.parse(this._redoStack.pop()!) as SlipTemplateFile;
    this._clampPageIndex();
    this._validateSelection();
    this._emitChange();
  }

  /** 페이지 수가 줄어드는 복원 뒤에도 현재 페이지가 범위 안에 있도록 보정 */
  private _clampPageIndex(): void {
    this._pageIndex = Math.max(0, Math.min(this._pageIndex, this._pageCount() - 1));
  }

  // ---------------------------------------------------------------------------
  // Pages (ADR-026)
  // ---------------------------------------------------------------------------

  private _pageCount(): number {
    return this._file?.template.pages.length ?? 0;
  }

  private _goToPage(index: number): void {
    if (!this._file) return;
    const clamped = Math.max(0, Math.min(index, this._pageCount() - 1));
    if (clamped === this._pageIndex) return;
    this._pageIndex = clamped;
    this._selectedId = null;
  }

  /** 현재 페이지 뒤에 빈 페이지를 추가하고 그 페이지로 이동한다 */
  private _addPage(): void {
    if (!this._file) return;
    this._pushUndo();
    this._file.template.pages.splice(this._pageIndex + 1, 0, { elements: [] });
    this._pageIndex += 1;
    this._selectedId = null;
    this._emitChange();
    this.requestUpdate();
  }

  /** 현재 페이지를 삭제한다 (마지막 한 페이지는 삭제 불가) */
  private _deletePage(): void {
    if (!this._file || this._pageCount() <= 1) return;
    this._pushUndo();
    this._file.template.pages.splice(this._pageIndex, 1);
    this._clampPageIndex();
    this._selectedId = null;
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Element helpers
  // ---------------------------------------------------------------------------

  private _currentElements(): SlipElement[] | undefined {
    return this._file?.template.pages[this._pageIndex]?.elements;
  }

  private _findElement(id: string): SlipElement | undefined {
    return this._currentElements()?.find((el) => el.id === id);
  }

  private _findSelectedElement(): SlipElement | undefined {
    return this._selectedId ? this._findElement(this._selectedId) : undefined;
  }

  private _validateSelection(): void {
    if (this._selectedId && !this._findElement(this._selectedId)) {
      this._selectedId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Element CRUD
  // ---------------------------------------------------------------------------

  private _addElement(type: SlipElement['type']): void {
    const elements = this._currentElements();
    if (!elements || !this._file) return;

    this._pushUndo();

    const id = crypto.randomUUID();
    const { paper } = this._file.template;
    const [padTop, , , padLeft] = paper.padding;
    const offset = (elements.length * 5) % 50;
    const position = { x: padLeft + offset, y: padTop + offset };
    const name = `${type}-${id.slice(0, 4)}`;

    let element: SlipElement;
    switch (type) {
      case 'text':
        element = { type: 'text', id, name, position, width: 60, height: 10, content: '' };
        break;
      case 'fixedGrid':
        element = {
          type: 'fixedGrid', id, name, position, width: 180, height: 40,
          rows: 3, columns: 3, columnWidthPercentages: [34, 33, 33], cells: [],
        };
        break;
      case 'dynamicTable':
        element = {
          type: 'dynamicTable', id, name, position, width: 180, height: 20,
          head: [...strings.designer.defaultTableHead],
          headWidthPercentages: [40, 30, 30],
          repeatHead: true, binding: 'items',
        };
        break;
      case 'image':
        element = {
          type: 'image', id, name, position, width: 40, height: 40, src: PLACEHOLDER_IMG,
        };
        break;
      case 'shape':
        element = { type: 'shape', id, name, position, width: 60, height: 30, shape: 'rect' };
        break;
      case 'field':
        element = {
          type: 'field', id, name, position, width: 60, height: 10,
          binding: `field_${id.slice(0, 4)}`,
        };
        break;
    }

    elements.push(element);
    this._selectedId = id;
    this._emitChange();
    this.requestUpdate();
  }

  private _copySelected(): void {
    const el = this._findSelectedElement();
    if (!el) return;
    this._clipboard = JSON.parse(JSON.stringify(el)) as SlipElement;
    this.requestUpdate();
  }

  private _paste(): void {
    const elements = this._currentElements();
    if (!elements || !this._clipboard) return;

    this._pushUndo();

    const copy = JSON.parse(JSON.stringify(this._clipboard)) as SlipElement;
    copy.id = crypto.randomUUID();
    copy.position = {
      x: round1(copy.position.x + 5),
      y: round1(copy.position.y + 5),
    };
    // 연속으로 붙여넣으면 계단식으로 내려가도록 클립보드 위치를 갱신
    this._clipboard.position = { ...copy.position };

    elements.push(copy);
    this._selectedId = copy.id;
    this._emitChange();
    this.requestUpdate();
  }

  private _deleteSelected(): void {
    const elements = this._currentElements();
    if (!elements || !this._selectedId) return;
    const idx = elements.findIndex((el) => el.id === this._selectedId);
    if (idx < 0) return;

    this._pushUndo();
    elements.splice(idx, 1);
    this._selectedId = null;
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Change emission
  // ---------------------------------------------------------------------------

  private _emitChange(): void {
    if (!this._file) return;
    const file = JSON.parse(JSON.stringify(this._file)) as SlipFile;
    this.dispatchEvent(
      new CustomEvent('slip-change', { detail: { file }, bubbles: true, composed: true }),
    );
  }

  private _updateElement(fn: (el: SlipElement) => void): void {
    const el = this._findSelectedElement();
    if (!el) return;
    this._pushUndo();
    fn(el);
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Pointer events (canvas drag)
  // ---------------------------------------------------------------------------

  private _onPointerDown = (e: PointerEvent): void => {
    if (!this._file) return;

    const handleEl = (e.target as HTMLElement).closest?.('.handle') as HTMLElement | null;
    if (handleEl && this._selectedId) {
      const el = this._findSelectedElement();
      const handle = handleEl.dataset.handle as ResizeHandle | undefined;
      if (!el || !handle) return;
      this._resize = {
        id: el.id,
        handle,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origX: el.position.x,
        origY: el.position.y,
        origW: el.width,
        origH: el.height,
        snapshot: JSON.stringify(this._file),
      };
      handleEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const target = (e.target as HTMLElement).closest?.('.element') as HTMLElement | null;

    if (target) {
      const id = target.dataset.id;
      if (!id) return;
      this._selectedId = id;

      const el = this._findElement(id);
      if (!el) return;

      this._drag = {
        id,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origMmX: el.position.x,
        origMmY: el.position.y,
        snapshot: JSON.stringify(this._file),
      };
      target.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      this._selectedId = null;
    }
    this.requestUpdate();
  };

  private _onPointerMove = (e: PointerEvent): void => {
    if (this._resize) {
      this._onResizeMove(e);
      return;
    }
    if (!this._drag) return;

    const el = this._findElement(this._drag.id);
    if (!el) return;

    const dx = (e.clientX - this._drag.startPxX) / PX_PER_MM;
    const dy = (e.clientY - this._drag.startPxY) / PX_PER_MM;
    let nx = this._drag.origMmX + dx;
    let ny = this._drag.origMmY + dy;

    // Alt를 누르면 스냅 없이 자유 이동
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!e.altKey) {
      const { xs, ys } = this._snapCandidates(el.id);
      const sx = this._bestSnap([nx, nx + el.width / 2, nx + el.width], xs);
      const sy = this._bestSnap([ny, ny + el.height / 2, ny + el.height], ys);
      if (sx) {
        nx += sx.delta;
        guideX = sx.line;
      }
      if (sy) {
        ny += sy.delta;
        guideY = sy.line;
      }
    }

    el.position.x = Math.max(0, round1(nx));
    el.position.y = Math.max(0, round1(ny));
    this._guideX = guideX;
    this._guideY = guideY;
    this.requestUpdate();
  };

  private _onResizeMove(e: PointerEvent): void {
    const r = this._resize!;
    const el = this._findElement(r.id);
    if (!el) return;

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
      const { xs, ys } = this._snapCandidates(r.id);
      if (h.includes('w')) {
        const s = this._bestSnap([left], xs);
        if (s) { left += s.delta; guideX = s.line; }
      }
      if (h.includes('e')) {
        const s = this._bestSnap([right], xs);
        if (s) { right += s.delta; guideX = s.line; }
      }
      if (h.includes('n')) {
        const s = this._bestSnap([top], ys);
        if (s) { top += s.delta; guideY = s.line; }
      }
      if (h.includes('s')) {
        const s = this._bestSnap([bottom], ys);
        if (s) { bottom += s.delta; guideY = s.line; }
      }
    }

    if (h.includes('w')) left = Math.min(Math.max(0, left), right - MIN_SIZE_MM);
    if (h.includes('e')) right = Math.max(right, left + MIN_SIZE_MM);
    if (h.includes('n')) top = Math.min(Math.max(0, top), bottom - MIN_SIZE_MM);
    if (h.includes('s')) bottom = Math.max(bottom, top + MIN_SIZE_MM);

    el.position.x = round1(left);
    el.position.y = round1(top);
    el.width = round1(right - left);
    el.height = round1(bottom - top);
    this._guideX = guideX;
    this._guideY = guideY;
    this.requestUpdate();
  }

  private _onPointerUp = (): void => {
    this._guideX = null;
    this._guideY = null;

    if (this._resize) {
      const r = this._resize;
      const el = this._findElement(r.id);
      if (
        el &&
        (el.position.x !== r.origX || el.position.y !== r.origY ||
          el.width !== r.origW || el.height !== r.origH)
      ) {
        this._pushUndoSnapshot(r.snapshot);
        this._emitChange();
      }
      this._resize = null;
      this.requestUpdate();
      return;
    }

    if (!this._drag) return;
    const el = this._findElement(this._drag.id);
    if (el && (el.position.x !== this._drag.origMmX || el.position.y !== this._drag.origMmY)) {
      this._pushUndoSnapshot(this._drag.snapshot);
      this._emitChange();
    }
    this._drag = null;
  };

  // ---------------------------------------------------------------------------
  // Snap helpers
  // ---------------------------------------------------------------------------

  /** 스냅 후보 선: 용지 가장자리·여백선 + 다른 요소들의 가장자리·중앙선 (mm) */
  private _snapCandidates(excludeId: string): { xs: number[]; ys: number[] } {
    const { paper } = this._file!.template;
    const [pt, pr, pb, pl] = paper.padding;
    const xs = [0, pl, paper.width - pr, paper.width];
    const ys = [0, pt, paper.height - pb, paper.height];
    for (const el of this._currentElements() ?? []) {
      if (el.id === excludeId) continue;
      xs.push(el.position.x, el.position.x + el.width / 2, el.position.x + el.width);
      ys.push(el.position.y, el.position.y + el.height / 2, el.position.y + el.height);
    }
    return { xs, ys };
  }

  /** edges 중 후보 선까지의 거리가 SNAP_MM 이내인 가장 가까운 이동량을 찾는다 */
  private _bestSnap(
    edges: number[],
    candidates: number[],
  ): { delta: number; line: number } | null {
    let best: { delta: number; line: number } | null = null;
    for (const edge of edges) {
      for (const line of candidates) {
        const delta = line - edge;
        if (Math.abs(delta) <= SNAP_MM && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, line };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private _onKeyDown = (e: KeyboardEvent): void => {
    // 입력 필드 안에서는 편집기 단축키를 가로채지 않는다
    const inFormField =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement;

    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedId && !inFormField) {
      e.preventDefault();
      this._deleteSelected();
    }
    if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !inFormField) {
      this._copySelected();
    }
    if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !inFormField) {
      e.preventDefault();
      this._paste();
    }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) this._redo();
      else this._undo();
    }
    if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._redo();
    }
  };

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  private _revokePreviewUrl(): void {
    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }
  }

  private async _togglePreview(): Promise<void> {
    if (this._previewMode) {
      this._previewMode = false;
      this._revokePreviewUrl();
      return;
    }
    if (!this._file) return;

    this._previewMode = true;
    this._revokePreviewUrl();

    const gen = ++this._previewGeneration;
    try {
      const opts: RenderOptions = {};
      if (this.fonts) opts.fonts = this.fonts;
      const pdfBytes = await renderSlipToPdf(this._file, opts);
      if (gen !== this._previewGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._previewUrl = URL.createObjectURL(blob);
    } catch {
      if (gen !== this._previewGeneration) return;
      this._error = strings.designer.previewError;
      this._previewMode = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Render: top-level
  // ---------------------------------------------------------------------------

  override render() {
    if (!this._file) {
      return html`<div class="empty-state ${this._error ? 'error' : ''}">
        ${this._error ?? strings.designer.noTemplate}
      </div>`;
    }

    return html`
      <div class="toolbar">${this._renderToolbar()}</div>
      ${this._previewMode
        ? html`<div class="preview-area">
            ${this._previewUrl
              ? html`<iframe src=${this._previewUrl} title=${strings.designer.pdfTitle}></iframe>`
              : html`<div class="status">${strings.designer.previewLoading}</div>`}
          </div>`
        : html`
            <div class="canvas-area"
                 @pointerdown=${this._onPointerDown}
                 @pointermove=${this._onPointerMove}
                 @pointerup=${this._onPointerUp}>
              ${this._renderCanvas()}
            </div>
            <div class="prop-panel">${this._renderPropertyPanel()}</div>
          `}
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: toolbar
  // ---------------------------------------------------------------------------

  private _renderToolbar() {
    const s = strings.designer;
    return html`
      <button @click=${() => this._addElement('text')}>${s.addText}</button>
      <button @click=${() => this._addElement('fixedGrid')}>${s.addFixedGrid}</button>
      <button @click=${() => this._addElement('dynamicTable')}>${s.addDynamicTable}</button>
      <button @click=${() => this._addElement('image')}>${s.addImage}</button>
      <button @click=${() => this._addElement('shape')}>${s.addShape}</button>
      <button @click=${() => this._addElement('field')}>${s.addField}</button>
      <span class="sep"></span>
      <button @click=${() => this._deleteSelected()} ?disabled=${!this._selectedId}>
        ${s.delete}
      </button>
      <button @click=${() => this._copySelected()} ?disabled=${!this._selectedId}>
        ${s.copy}
      </button>
      <button @click=${() => this._paste()} ?disabled=${!this._clipboard}>
        ${s.paste}
      </button>
      <span class="sep"></span>
      <button @click=${() => this._undo()} ?disabled=${this._undoStack.length === 0}>
        ${s.undo}
      </button>
      <button @click=${() => this._redo()} ?disabled=${this._redoStack.length === 0}>
        ${s.redo}
      </button>
      <span class="sep"></span>
      <button class="page-prev" title=${s.prevPage}
              @click=${() => this._goToPage(this._pageIndex - 1)}
              ?disabled=${this._pageIndex === 0}>◀</button>
      <span class="page-indicator">${this._pageIndex + 1} / ${this._pageCount()}</span>
      <button class="page-next" title=${s.nextPage}
              @click=${() => this._goToPage(this._pageIndex + 1)}
              ?disabled=${this._pageIndex >= this._pageCount() - 1}>▶</button>
      <button @click=${() => this._addPage()}>${s.addPage}</button>
      <button @click=${() => this._deletePage()} ?disabled=${this._pageCount() <= 1}>
        ${s.deletePage}
      </button>
      <span class="sep"></span>
      <button @click=${() => this._togglePreview()}>
        ${this._previewMode ? s.edit : s.preview}
      </button>
      <span class="sep"></span>
      <select class="preset-select" @change=${this._onPresetChange}>
        <option value="" selected>${s.preset}</option>
        ${presets.map((p, index) => html`<option value=${String(index)}>${p.name}</option>`)}
      </select>
    `;
  }

  private _onPresetChange = (e: Event): void => {
    const select = e.target as HTMLSelectElement;
    const value = select.value;
    select.value = '';
    if (value === '' || !this._file) return;
    const preset = presets[Number(value)];
    if (!preset) return;

    this._pushUndo();
    this._file = preset.create();
    this._selectedId = null;
    this._pageIndex = 0;
    this._previewMode = false;
    this._emitChange();
    this.requestUpdate();
  };

  // ---------------------------------------------------------------------------
  // Render: canvas
  // ---------------------------------------------------------------------------

  private _renderCanvas() {
    if (!this._file) return nothing;
    const { paper } = this._file.template;
    const page = this._file.template.pages[this._pageIndex];
    if (!page) return nothing;

    const pw = paper.width * PX_PER_MM;
    const ph = paper.height * PX_PER_MM;
    const [pt, pr, pb, pl] = paper.padding;

    return html`
      <div class="paper" style="width:${pw}px;height:${ph}px">
        <div class="padding-guide" style="
          left:${pl * PX_PER_MM}px;
          top:${pt * PX_PER_MM}px;
          width:${(paper.width - pl - pr) * PX_PER_MM}px;
          height:${(paper.height - pt - pb) * PX_PER_MM}px;
        "></div>
        ${page.elements.map((el) => this._renderElement(el))}
        ${this._renderSelectionOverlay()}
        ${this._guideX !== null
          ? html`<div class="snap-guide vertical" style="left:${this._guideX * PX_PER_MM}px"></div>`
          : nothing}
        ${this._guideY !== null
          ? html`<div class="snap-guide horizontal" style="top:${this._guideY * PX_PER_MM}px"></div>`
          : nothing}
      </div>
    `;
  }

  private _renderSelectionOverlay() {
    const el = this._findSelectedElement();
    if (!el) return nothing;
    const x = el.position.x * PX_PER_MM;
    const y = el.position.y * PX_PER_MM;
    const w = el.width * PX_PER_MM;
    const h = el.height * PX_PER_MM;
    return html`
      <div class="selection-overlay" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
        ${RESIZE_HANDLES.map(
          (handle) => html`<span class="handle handle-${handle}" data-handle=${handle}></span>`,
        )}
      </div>
    `;
  }

  private _renderElement(el: SlipElement) {
    const x = el.position.x * PX_PER_MM;
    const y = el.position.y * PX_PER_MM;
    const w = el.width * PX_PER_MM;
    const h = el.height * PX_PER_MM;
    const selected = el.id === this._selectedId;

    let style = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

    if (el.type !== 'image') {
      const r = el as Record<string, unknown>;
      if (r.backgroundColor) style += `;background-color:${r.backgroundColor}`;
      if (r.fontColor) style += `;color:${r.fontColor}`;
      if (r.borderColor) style += `;border-color:${r.borderColor}`;
    }

    return html`
      <div class="element ${selected ? 'selected' : ''} type-${el.type}"
           data-id=${el.id}
           style=${style}>
        <span class="badge">${TYPE_BADGE[el.type]}</span>
        ${this._renderElementContent(el)}
      </div>
    `;
  }

  private _renderElementContent(el: SlipElement) {
    switch (el.type) {
      case 'text':
        return html`<span class="el-content">${el.content}</span>`;

      case 'fixedGrid':
        return html`<div class="grid-preview"
          style="grid-template-columns:repeat(${el.columns},1fr);grid-template-rows:repeat(${el.rows},1fr)">
          ${Array.from({ length: el.rows * el.columns }, () => html`<div></div>`)}
        </div>`;

      case 'dynamicTable':
        return html`<div class="table-preview">
          ${el.head.map((h, i) =>
            html`<div style="flex:${el.headWidthPercentages[i]}">${h}</div>`,
          )}
        </div>`;

      case 'image':
        return el.src.startsWith('data:')
          ? html`<img src=${el.src} alt="">`
          : html`<span class="el-content">${strings.designer.typeImage}</span>`;

      case 'shape':
        return el.shape === 'line'
          ? html`<svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="0" y1="100" x2="100" y2="0" stroke="#333" stroke-width="2" />
            </svg>`
          : nothing;

      case 'field':
        return html`<span class="el-content">{${el.binding}}</span>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Render: property panel
  // ---------------------------------------------------------------------------

  private _renderPropertyPanel() {
    const el = this._findSelectedElement();
    if (!el) {
      return html`<div class="panel-empty">${strings.designer.noSelection}</div>`;
    }

    const s = strings.designer;
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="type-name">${this._typeName(el.type)}</div>

      <div class="prop-section">
        <div class="prop-row">
          <label>${s.name}</label>
          <input .value=${el.name}
                 @change=${(e: Event) => this._updateElement((el) => { el.name = valOf(e); })}>
        </div>
        <div class="prop-pair">
          <div class="prop-row">
            <label>X</label>
            <input type="number" step="0.5" .value=${String(el.position.x)}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) this._updateElement((el) => { el.position.x = Math.max(0, v); });
                   }}>
          </div>
          <div class="prop-row">
            <label>Y</label>
            <input type="number" step="0.5" .value=${String(el.position.y)}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) this._updateElement((el) => { el.position.y = Math.max(0, v); });
                   }}>
          </div>
        </div>
        <div class="prop-pair">
          <div class="prop-row">
            <label>${s.width}</label>
            <input type="number" step="0.5" min="1" .value=${String(el.width)}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) this._updateElement((el) => { el.width = Math.max(0, v); });
                   }}>
          </div>
          <div class="prop-row">
            <label>${s.height}</label>
            <input type="number" step="0.5" min="1" .value=${String(el.height)}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) this._updateElement((el) => { el.height = Math.max(0, v); });
                   }}>
          </div>
        </div>
      </div>

      ${this._renderTypeProps(el)}
      ${el.type !== 'image' ? this._renderColorProps(el) : nothing}
    `;
  }

  private _typeName(type: SlipElement['type']): string {
    const s = strings.designer;
    const map: Record<SlipElement['type'], string> = {
      text: s.typeText,
      fixedGrid: s.typeFixedGrid,
      dynamicTable: s.typeDynamicTable,
      image: s.typeImage,
      shape: s.typeShape,
      field: s.typeField,
    };
    return map[type];
  }

  // ---------------------------------------------------------------------------
  // Render: type-specific props
  // ---------------------------------------------------------------------------

  private _renderTypeProps(el: SlipElement) {
    const s = strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    switch (el.type) {
      case 'text':
        return html`
          <div class="prop-section">
            <div class="prop-section-title">${s.content}</div>
            <div class="prop-row">
              <textarea rows="3" .value=${el.content}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type === 'text') el.content = (e.target as HTMLTextAreaElement).value;
                })}></textarea>
            </div>
            ${this._renderFontProps(el)}
          </div>
        `;

      case 'field':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.binding}</label>
              <input .value=${el.binding}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type === 'field') el.binding = valOf(e);
                })}>
            </div>
            <div class="prop-row">
              <label>${s.formula}</label>
              <input .value=${el.formula ?? ''}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type !== 'field') return;
                  const v = valOf(e);
                  const r = el as Record<string, unknown>;
                  if (v) r.formula = v;
                  else delete r.formula;
                })}>
            </div>
            ${this._renderFontProps(el)}
          </div>
        `;

      case 'shape':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.shapeType}</label>
              <select .value=${el.shape}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type === 'shape') el.shape = valOf(e) as 'line' | 'rect';
                })}>
                <option value="rect">${s.shapeRect}</option>
                <option value="line">${s.shapeLine}</option>
              </select>
            </div>
          </div>
        `;

      case 'fixedGrid':
        return html`
          <div class="prop-section">
            <div class="prop-pair">
              <div class="prop-row">
                <label>${s.rows}</label>
                <input type="number" .value=${String(el.rows)} disabled>
              </div>
              <div class="prop-row">
                <label>${s.columns}</label>
                <input type="number" .value=${String(el.columns)} disabled>
              </div>
            </div>
          </div>
        `;

      case 'dynamicTable':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.binding}</label>
              <input .value=${el.binding}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type === 'dynamicTable') el.binding = valOf(e);
                })}>
            </div>
            <div class="prop-row">
              <label>${s.head}</label>
              <input .value=${el.head.join(', ')} disabled>
            </div>
          </div>
        `;

      case 'image':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.src}</label>
              <input .value=${el.src.length > 40 ? el.src.slice(0, 40) + '…' : el.src} disabled>
            </div>
          </div>
        `;

      default:
        return nothing;
    }
  }

  private _renderFontProps(el: SlipElement) {
    if (el.type !== 'text' && el.type !== 'field') return nothing;
    const s = strings.designer;
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="prop-row">
        <label>${s.fontSize}</label>
        <input type="number" step="0.5" .value=${String(el.fontSize ?? '')}
          @change=${(e: Event) => {
            const v = numOf(e);
            this._updateElement((el) => {
              const r = el as Record<string, unknown>;
              if (v > 0) r.fontSize = v;
              else delete r.fontSize;
            });
          }}>
      </div>
      <div class="prop-row">
        <label>${s.alignment}</label>
        <select .value=${el.alignment ?? 'left'}
          @change=${(e: Event) => this._updateElement((el) => {
            const v = valOf(e) as 'left' | 'center' | 'right';
            const r = el as Record<string, unknown>;
            if (v !== 'left') r.alignment = v;
            else delete r.alignment;
          })}>
          <option value="left">${s.alignLeft}</option>
          <option value="center">${s.alignCenter}</option>
          <option value="right">${s.alignRight}</option>
        </select>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: color props
  // ---------------------------------------------------------------------------

  private _renderColorProps(el: SlipElement) {
    if (el.type === 'image') return nothing;
    const s = strings.designer;
    const r = el as Record<string, unknown>;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="prop-section">
        <div class="prop-section-title">${s.style}</div>
        <div class="prop-row">
          <label>${s.backgroundColor}</label>
          <input .value=${(r.backgroundColor as string) ?? ''} placeholder="#RRGGBB"
            @change=${(e: Event) => this._updateElement((el) => {
              const v = valOf(e);
              const r = el as Record<string, unknown>;
              if (v) r.backgroundColor = v;
              else delete r.backgroundColor;
            })}>
        </div>
        <div class="prop-row">
          <label>${s.fontColor}</label>
          <input .value=${(r.fontColor as string) ?? ''} placeholder="#RRGGBB"
            @change=${(e: Event) => this._updateElement((el) => {
              const v = valOf(e);
              const r = el as Record<string, unknown>;
              if (v) r.fontColor = v;
              else delete r.fontColor;
            })}>
        </div>
        <div class="prop-row">
          <label>${s.borderColor}</label>
          <input .value=${(r.borderColor as string) ?? ''} placeholder="#RRGGBB"
            @change=${(e: Event) => this._updateElement((el) => {
              const v = valOf(e);
              const r = el as Record<string, unknown>;
              if (v) r.borderColor = v;
              else delete r.borderColor;
            })}>
        </div>
      </div>
    `;
  }
}

customElements.define('slip-designer', SlipDesigner);

declare global {
  interface HTMLElementTagNameMap {
    'slip-designer': SlipDesigner;
  }
}
