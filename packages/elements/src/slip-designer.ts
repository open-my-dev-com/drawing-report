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

const PX_PER_MM = 96 / 25.4;
const MAX_UNDO = 50;

const PLACEHOLDER_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const TYPE_BADGE: Record<SlipElement['type'], string> = {
  text: 'T',
  fixedGrid: '格',
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
    _selectedId: { state: true },
    _previewMode: { state: true },
    _previewUrl: { state: true },
    _error: { state: true },
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
    this._undoStack.push(JSON.stringify(this._file));
    this._redoStack = [];
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
  }

  private _undo(): void {
    if (this._undoStack.length === 0 || !this._file) return;
    this._redoStack.push(JSON.stringify(this._file));
    this._file = JSON.parse(this._undoStack.pop()!) as SlipTemplateFile;
    this._validateSelection();
    this._emitChange();
  }

  private _redo(): void {
    if (this._redoStack.length === 0 || !this._file) return;
    this._undoStack.push(JSON.stringify(this._file));
    this._file = JSON.parse(this._redoStack.pop()!) as SlipTemplateFile;
    this._validateSelection();
    this._emitChange();
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
          head: ['\u{D56D}\u{BAA9}', '\u{C218}\u{B7C9}', '\u{AE08}\u{C561}'],
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
    if (!this._drag) return;

    const el = this._findElement(this._drag.id);
    if (!el) return;

    const dx = (e.clientX - this._drag.startPxX) / PX_PER_MM;
    const dy = (e.clientY - this._drag.startPxY) / PX_PER_MM;
    el.position.x = Math.max(0, Math.round((this._drag.origMmX + dx) * 10) / 10);
    el.position.y = Math.max(0, Math.round((this._drag.origMmY + dy) * 10) / 10);
    this.requestUpdate();
  };

  private _onPointerUp = (): void => {
    if (!this._drag) return;
    const el = this._findElement(this._drag.id);
    if (el && (el.position.x !== this._drag.origMmX || el.position.y !== this._drag.origMmY)) {
      this._undoStack.push(this._drag.snapshot);
      this._redoStack = [];
      if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
      this._emitChange();
    }
    this._drag = null;
  };

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      this._selectedId &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !(e.target instanceof HTMLSelectElement)
    ) {
      e.preventDefault();
      this._deleteSelected();
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
              ? html`<iframe src=${this._previewUrl} title="PDF"></iframe>`
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
      <span class="sep"></span>
      <button @click=${() => this._undo()} ?disabled=${this._undoStack.length === 0}>
        ${s.undo}
      </button>
      <button @click=${() => this._redo()} ?disabled=${this._redoStack.length === 0}>
        ${s.redo}
      </button>
      <span class="sep"></span>
      <button @click=${() => this._togglePreview()}>
        ${this._previewMode ? s.edit : s.preview}
      </button>
    `;
  }

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
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);

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
