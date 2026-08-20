import { LitElement, css, html, nothing } from 'lit';
import {
  computeIntegrity,
  evaluateFormula,
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
  type IntegrityJwk,
  type JsonValue,
  type RenderOptions,
  type SlipFile,
  type SlipTemplateBody,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { loadDefaultFonts } from './default-fonts.js';
import { icons } from './icons.js';

/** PDF 미리보기를 다시 만들기까지 기다리는 시간(ms) — 타자 중 매번 렌더하지 않기 위함 */
const PREVIEW_DEBOUNCE_MS = 500;

/** 작성폼이 만들어 주는 입력 한 칸 */
interface FormInput {
  /** 값을 담을 바인딩 키 (전표 values의 키) */
  key: string;
  /** 화면에 보여줄 이름 — 바인딩 논리명 → 요소 이름 → 물리명 순 */
  label: string;
  /** 표 입력이면 열 구조, 아니면 한 줄 입력 */
  columns?: { key: string; title: string }[];
  /** 수식으로 자동 계산되는 칸이면 그 수식 (입력받지 않고 계산 결과만 보여준다) */
  formula?: string;
}

/**
 * 입력값 해석 — 숫자로 보이는 표기는 수로 담는다. 합계 수식(SUM 등)이 값을
 * 그대로 더할 수 있어야 하기 때문이다 (디자이너 샘플 데이터와 같은 규칙).
 */
function parseInputValue(text: string): string | number {
  const trimmed = text.trim();
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/** 담긴 값을 입력창에 보여줄 문자열로 (객체·배열은 표 입력이 따로 다룬다) */
function inputText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** 계산 결과를 표시용 문자열로 (수식 엔진의 문자열화 규칙과 같은 방향) */
function resultText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * `<slip-form>` — 전표 작성폼 (v2 D-14).
 *
 * 양식(template)이나 작성 중 전표(voucher)를 받아 바인딩마다 입력 칸을 만들고,
 * 동적 표 바인딩은 열 구조대로 행을 넣고 뺄 수 있게 한다. 수식 필드는 입력받지 않고
 * 값이 바뀔 때마다 즉시 계산해 보여주며, 오른쪽 미리보기는 PDF 변환 결과를 그대로
 * 표시한다 (화면·PDF 불일치 불가, ADR-012/016).
 *
 * 발행하면 해시(서명 키를 주면 서명까지)를 기록한 전표를 `slip-issue` 이벤트로 내보내고
 * 폼을 잠근다 (SPEC §7.1·§8). 작성 중 변경은 `slip-change`로 계속 알린다.
 */
export class SlipForm extends LitElement {
  static styles = css`
    :host {
      /* 디자인 토큰 (ADR-031) — 디자이너와 같은 값을 쓴다 */
      --sk-bg: #f6f7f8;
      --sk-surface: #ffffff;
      --sk-canvas-bg: #e2e4e7;
      --sk-border: #d8dadf;
      --sk-border-strong: #c4c7cd;
      --sk-text: #2e3238;
      --sk-text-muted: #798088;
      --sk-accent: #1a73e8;
      --sk-accent-soft: #e7f0fd;
      --sk-danger: #c62828;
      --sk-radius: 4px;

      display: grid;
      grid-template-columns: minmax(320px, 480px) 1fr;
      height: 100%;
      min-height: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif;
      font-size: 13px;
      color: var(--sk-text);
      overflow: hidden;
    }

    /* 호스트가 hidden으로 감출 수 있게 한다 — :host의 display가 기본 규칙을 덮기 때문 */
    :host([hidden]) {
      display: none;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .pane {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border-right: 1px solid var(--sk-border);
      background: var(--sk-bg);
    }
    .pane-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--sk-border);
    }
    .pane-title {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pane-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .field {
      margin-bottom: 10px;
    }
    .field > label {
      display: block;
      margin-bottom: 3px;
      font-size: 12px;
      color: var(--sk-text-muted);
    }
    .field input {
      width: 100%;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 13px;
      font-family: inherit;
      color: inherit;
    }
    .field input:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .field input:disabled {
      background: var(--sk-bg);
      color: var(--sk-text-muted);
    }
    .field.computed input {
      background: var(--sk-accent-soft);
      border-style: dashed;
    }
    .field .hint {
      margin-top: 2px;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .field .hint.error {
      color: var(--sk-danger);
    }

    .row-scroll {
      overflow-x: auto;
    }
    .row-grid {
      display: grid;
      gap: 4px;
      align-items: center;
      width: max-content;
      min-width: 100%;
      margin-bottom: 4px;
    }
    .row-grid .col-title {
      font-size: 10px;
      color: var(--sk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-grid input {
      min-width: 0;
      width: 100%;
      padding: 4px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .row-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .row-remove:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .row-remove:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .row-remove svg {
      width: 12px;
      height: 12px;
    }
    .row-add {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border: 1px dashed var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .row-add:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .row-add:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .row-add svg {
      width: 12px;
      height: 12px;
    }

    .btn {
      padding: 6px 14px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .btn.primary {
      background: var(--sk-accent);
      border-color: var(--sk-accent);
      color: #fff;
    }
    .btn.primary:hover:not(:disabled) {
      color: #fff;
      opacity: 0.9;
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }

    .issued-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      font-size: 11px;
      font-weight: 600;
    }
    .notice {
      margin-bottom: 10px;
      padding: 6px 8px;
      border-radius: var(--sk-radius);
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      font-size: 11px;
      line-height: 1.5;
    }
    .notice.error {
      background: #fdecea;
      color: var(--sk-danger);
    }
    .empty {
      font-size: 12px;
      color: var(--sk-text-muted);
    }

    .preview {
      min-width: 0;
      background: var(--sk-canvas-bg);
    }
    .preview iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--sk-text-muted);
    }
    .status.error {
      color: var(--sk-danger);
    }
    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--sk-text-muted);
      font-size: 14px;
    }
    .empty-state.error {
      color: var(--sk-danger);
    }
  `;

  static properties = {
    src: { type: String },
    locale: { type: String },
    fonts: { attribute: false },
    signingKey: { attribute: false },
    _values: { state: true },
    _issued: { state: true },
    _issuing: { state: true },
    _issueError: { state: true },
    _previewUrl: { state: true },
    _previewError: { state: true },
    _error: { state: true },
  };

  /** .slip JSON 문자열 — 양식(template) 또는 작성 중 전표(voucher) */
  src = '';

  /**
   * UI 언어 ('ko' | 'en') — ADR-028.
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
  fonts?: RenderOptions['fonts'];

  /** 발행 서명에 쓸 개인키 (JWK) — 주지 않으면 해시만 기록한다 (SPEC §8.3) */
  signingKey?: IntegrityJwk;

  private _body: SlipTemplateBody | null = null;
  private _schemaVersion = '';
  private _values: Record<string, unknown> = {};
  private _issued = false;
  private _issuing = false;
  private _issueError: string | null = null;
  private _integrity: SlipVoucherFile['integrity'];
  private _error: string | null = null;
  private _previewUrl: string | null = null;
  private _previewError: string | null = null;
  private _previewGeneration = 0;
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;

  /** 현재 locale의 작성폼 문구 */
  private get _t() {
    return getStrings(this.locale).form;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._previewTimer !== null) clearTimeout(this._previewTimer);
    this._revokePreviewUrl();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
      this._schedulePreview();
    }
  }

  // ---------------------------------------------------------------------------
  // 소스 파싱
  // ---------------------------------------------------------------------------

  private _parseSource(): void {
    this._revokePreviewUrl();
    this._error = null;
    this._issueError = null;
    this._previewError = null;
    this._integrity = undefined;

    if (!this.src) {
      this._body = null;
      this._values = {};
      this._issued = false;
      return;
    }

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src);
    } catch (error) {
      console.error('[slip-form] .slip 파싱 실패:', error);
      this._body = null;
      this._error = this._t.parseError;
      return;
    }

    if (file.kind === 'template') {
      this._body = file.template;
      this._values = {};
      this._issued = false;
    } else {
      this._body = file.templateSnapshot;
      this._values = JSON.parse(JSON.stringify(file.values)) as Record<string, unknown>;
      this._issued = file.issued;
      this._integrity = file.integrity;
    }
    this._schemaVersion = file.schemaVersion;
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 입력 목록 구성
  // ---------------------------------------------------------------------------

  /**
   * 양식에서 입력 칸 목록을 만든다 — 전표에 실리는 순서(문서 읽는 순서)대로 요소를
   * 훑고, 요소가 쓰지 않지만 정의부에만 있는 바인딩(수식에서만 참조하는 값 등)을 뒤에 붙인다.
   */
  private _collectInputs(): FormInput[] {
    const body = this._body;
    if (!body) return [];
    const labelOf = new Map<string, string>(
      (body.bindings ?? []).filter((b) => b.label !== undefined).map((b) => [b.key, b.label!]),
    );
    const inputs: FormInput[] = [];
    const seen = new Set<string>();
    const add = (key: string, input: Omit<FormInput, 'key' | 'label'>, name?: string): void => {
      if (seen.has(key)) return;
      seen.add(key);
      inputs.push({ key, label: labelOf.get(key) ?? name ?? key, ...input });
    };

    for (const page of body.pages) {
      for (const element of page.elements) {
        if (element.type === 'field') {
          add(
            element.binding,
            element.formula === undefined ? {} : { formula: element.formula },
            element.name,
          );
        } else if (element.type === 'dynamicTable') {
          add(
            element.binding,
            { columns: element.columns.map((c) => ({ key: c.key, title: c.title })) },
            element.name,
          );
        }
      }
    }
    for (const def of body.bindings ?? []) add(def.key, {});
    return inputs;
  }

  /** 표 입력의 현재 행 목록 — 객체가 아닌 항목은 버린다 */
  private _rowsOf(key: string): Record<string, unknown>[] {
    const raw = this._values[key];
    return Array.isArray(raw)
      ? raw.filter(
          (row): row is Record<string, unknown> =>
            typeof row === 'object' && row !== null && !Array.isArray(row),
        )
      : [];
  }

  // ---------------------------------------------------------------------------
  // 값 편집
  // ---------------------------------------------------------------------------

  private _setValue(key: string, value: unknown): void {
    if (this._issued) return;
    if (value === undefined || value === '') delete this._values[key];
    else this._values[key] = value;
    this._afterValueChange();
  }

  private _setRows(key: string, rows: Record<string, unknown>[]): void {
    if (this._issued) return;
    if (rows.length === 0) delete this._values[key];
    else this._values[key] = rows;
    this._afterValueChange();
  }

  private _afterValueChange(): void {
    this._issueError = null;
    this._emitChange();
    this._schedulePreview();
    this.requestUpdate();
  }

  /** 입력값을 전부 지운다 (발행 전에만) */
  private _reset(): void {
    if (this._issued) return;
    this._values = {};
    this._afterValueChange();
  }

  // ---------------------------------------------------------------------------
  // 전표 만들기 · 발행
  // ---------------------------------------------------------------------------

  /** 현재 입력 상태의 전표 파일을 만든다 */
  private _buildVoucher(issued: boolean): SlipVoucherFile {
    const voucher: SlipVoucherFile = {
      schemaVersion: this._schemaVersion,
      kind: 'voucher',
      templateSnapshot: JSON.parse(JSON.stringify(this._body)) as SlipTemplateBody,
      values: JSON.parse(JSON.stringify(this._values)) as Record<string, JsonValue>,
      issued,
    };
    if (issued && this._integrity) voucher.integrity = this._integrity;
    return voucher;
  }

  private _emitChange(): void {
    if (!this._body) return;
    this.dispatchEvent(
      new CustomEvent('slip-change', {
        detail: { file: this._buildVoucher(this._issued) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * 발행 — 해시(서명 키가 있으면 서명까지)를 기록하고 발행 규칙(SPEC §7.1)까지
   * 검증한 전표를 `slip-issue`로 내보낸다. 검증에 걸리면 폼은 잠기지 않는다.
   */
  private async _issue(): Promise<void> {
    if (!this._body || this._issued || this._issuing) return;
    this._issuing = true;
    this._issueError = null;
    this.requestUpdate();

    const voucher = this._buildVoucher(true);
    try {
      voucher.integrity = await computeIntegrity(voucher, this.signingKey);
      // 발행 규칙(외부 URL 금지 등)은 파서가 기준이다 — 통과해야 발행으로 인정한다
      parseSlipFile(serializeSlipFile(voucher));
    } catch (error) {
      console.error('[slip-form] 발행 실패:', error);
      this._issueError = `${this._t.issueError} ${error instanceof Error ? error.message : String(error)}`;
      this._issuing = false;
      this.requestUpdate();
      return;
    }

    this._integrity = voucher.integrity;
    this._issued = true;
    this._issuing = false;
    this.dispatchEvent(
      new CustomEvent('slip-issue', { detail: { file: voucher }, bubbles: true, composed: true }),
    );
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 미리보기
  // ---------------------------------------------------------------------------

  private _revokePreviewUrl(): void {
    // 진행 중인 렌더도 무효화한다 — 늦게 끝난 렌더가 회수할 수 없는 blob URL을 만들지 않도록
    this._previewGeneration++;
    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }
  }

  /** 입력이 멈춘 뒤에 한 번만 렌더하도록 미리보기를 예약한다 */
  private _schedulePreview(): void {
    if (this._previewTimer !== null) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      void this._renderPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  private async _renderPreview(): Promise<void> {
    if (!this._body) return;
    this._revokePreviewUrl();
    this._previewError = null;
    const gen = ++this._previewGeneration;
    try {
      // 폰트 미지정 시 동봉 Pretendard 자동 사용 (ADR-012) — 한글 깨짐 방지
      const opts: RenderOptions = {
        fonts: this.fonts?.length ? this.fonts : await loadDefaultFonts(),
      };
      const pdfBytes = await renderSlipToPdf(this._buildVoucher(this._issued), opts);
      if (gen !== this._previewGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-form] PDF 미리보기 생성 실패:', error);
      if (gen !== this._previewGeneration) return;
      this._previewError = this._t.previewError;
    }
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 렌더
  // ---------------------------------------------------------------------------

  override render() {
    if (!this._body) {
      return html`<div class="empty-state ${this._error ? 'error' : ''}">
        ${this._error ?? this._t.noFile}
      </div>`;
    }
    const t = this._t;
    const inputs = this._collectInputs();

    return html`
      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">${this._body.meta.title}</span>
          ${this._issued
            ? html`<span class="issued-badge">${t.issued}</span>`
            : html`
                <button class="btn" ?disabled=${this._issuing} @click=${() => this._reset()}>
                  ${t.reset}
                </button>
                <button class="btn primary" ?disabled=${this._issuing}
                  @click=${() => void this._issue()}>${t.issue}</button>`}
        </div>
        <div class="pane-body">
          ${this._issued ? html`<div class="notice">${t.issuedNotice}</div>` : nothing}
          ${this._issueError ? html`<div class="notice error">${this._issueError}</div>` : nothing}
          ${inputs.length === 0
            ? html`<div class="empty">${t.noInputs}</div>`
            : inputs.map((input) => this._renderInput(input))}
        </div>
      </section>
      <section class="preview">
        ${this._previewUrl
          ? html`<iframe src=${this._previewUrl} title=${t.pdfTitle}></iframe>`
          : this._previewError
            ? html`<div class="status error">${this._previewError}</div>`
            : html`<div class="status">${t.previewLoading}</div>`}
      </section>
    `;
  }

  private _renderInput(input: FormInput) {
    const t = this._t;
    if (input.columns) return this._renderRowInput(input, input.columns);

    if (input.formula !== undefined) {
      // 수식 칸은 입력받지 않는다 — 값이 바뀔 때마다 즉시 계산해 결과만 보여준다
      let text = '';
      let error: string | null = null;
      try {
        text = resultText(evaluateFormula(input.formula, { values: this._values }));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      return html`
        <div class="field computed">
          <label for=${`f-${input.key}`}>${input.label}</label>
          <input id=${`f-${input.key}`} .value=${error ? '' : text} disabled
            aria-label="${input.label} (${t.computed})">
          <div class="hint ${error ? 'error' : ''}">
            ${error ? `${t.calcError}: ${error}` : t.computed}
          </div>
        </div>
      `;
    }

    return html`
      <div class="field">
        <label for=${`f-${input.key}`}>${input.label}</label>
        <input id=${`f-${input.key}`} .value=${inputText(this._values[input.key])}
          aria-label=${input.label} ?disabled=${this._issued}
          @change=${(e: Event) =>
            this._setValue(input.key, parseInputValue((e.target as HTMLInputElement).value))}>
      </div>
    `;
  }

  private _renderRowInput(input: FormInput, columns: { key: string; title: string }[]) {
    const t = this._t;
    const rows = this._rowsOf(input.key);
    return html`
      <div class="field">
        <label>${input.label}</label>
        <div class="row-scroll">
          <div class="row-grid"
            style="grid-template-columns:repeat(${columns.length}, minmax(76px, 1fr)) 22px">
            ${columns.map((col) => html`<span class="col-title">${col.title || col.key}</span>`)}
            <span></span>
            ${rows.map((row, rowIndex) => html`
              ${columns.map((col) => html`
                <input .value=${inputText(row[col.key])}
                  aria-label="${input.label} ${rowIndex + 1} ${col.title || col.key}"
                  ?disabled=${this._issued}
                  @change=${(e: Event) => {
                    const next = rows.map((r) => ({ ...r }));
                    const text = (e.target as HTMLInputElement).value;
                    if (text === '') delete next[rowIndex]![col.key];
                    else next[rowIndex]![col.key] = parseInputValue(text);
                    this._setRows(input.key, next);
                  }}>`)}
              <button class="row-remove" title=${t.deleteRow}
                aria-label="${input.label} ${rowIndex + 1} ${t.deleteRow}"
                ?disabled=${this._issued}
                @click=${() =>
                  this._setRows(input.key, rows.filter((_, i) => i !== rowIndex).map((r) => ({ ...r })))}>
                ${icons.pageRemove}
              </button>`)}
          </div>
        </div>
        <button class="row-add" aria-label="${input.label} ${t.addRow}" ?disabled=${this._issued}
          @click=${() => this._setRows(input.key, [...rows.map((r) => ({ ...r })), {}])}>
          ${icons.pageAdd}<span>${t.addRow}</span>
        </button>
      </div>
    `;
  }
}

customElements.define('slip-form', SlipForm);

declare global {
  interface HTMLElementTagNameMap {
    'slip-form': SlipForm;
  }
}
