import { LitElement, html, nothing } from 'lit';
import { formStyles } from './styles/slip-form.styles.js';
import {
  buildVoucher,
  evaluateFormula,
  normalizeNumericParameters,
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
  type GridElement,
  type JsonValue,
  type RenderOptions,
  type SlipFile,
  type SlipTemplateBody,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { icons } from './icons.js';
import { pickImageFile, formatBytes } from './image-file.js';
import { resolveFonts, type SlipFontProvider } from './settings.js';

/** 입력이 끝난 뒤 PDF 미리보기를 갱신하기까지 기다리는 시간(ms) */
const PREVIEW_DEBOUNCE_MS = 500;

/** 업로드할 수 있는 이미지 파일의 기본 최대 크기(바이트) */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 작성 폼에 렌더링할 입력 항목. */
interface FormInput {
  /** 전표 `values`에 값을 저장할 파라미터 키 */
  key: string;
  /** 화면에 표시할 이름 */
  label: string;
  /** 목록형 입력의 열 구조 */
  columns?: { key: string; title: string }[];
  /** 입력 요소 대신 계산 결과를 표시할 수식. */
  formula?: string;
  /** 이미지 업로드 입력 여부 */
  image?: boolean;
}

/**
 * 입력값이 숫자 형식이면 숫자로 변환한다.
 * 디자이너의 샘플 데이터와 같은 변환 규칙을 사용한다.
 */
function parseInputValue(text: string): string | number {
  const trimmed = text.trim();
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/**
 * 반복 구간 위쪽에서 같은 열의 헤더 텍스트를 찾는다.
 */
function gridHeaderTitle(grid: GridElement, column: number, fromRow: number): string | undefined {
  for (let row = fromRow - 1; row >= 0; row -= 1) {
    const cell = grid.cells.find((c) => c.row === row && c.column === column);
    if (cell?.content !== undefined && cell.content !== '') return cell.content;
  }
  return undefined;
}

/** 스칼라 값을 입력 필드에 표시할 문자열로 변환한다. */
function inputText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** 수식 계산 결과를 표시용 문자열로 변환한다. */
function resultText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * 양식에 정의된 파라미터 값을 입력하고 전표를 발행하는 `<slip-form>` 컴포넌트.
 *
 * 양식이나 작성 중인 전표에서 입력 필드를 구성한다. 목록 파라미터는 행을 추가하거나
 * 삭제할 수 있으며 수식 필드는 입력값이 바뀔 때 계산 결과를 갱신한다. 미리보기는
 * PDF 렌더링 결과를 사용한다.
 *
 * 발행하면 확정된 전표를 `slip-issue` 이벤트로 전달하고 입력을 잠근다 (SPEC §7.1).
 * 작성 중인 값은 `slip-change` 이벤트로 전달한다.
 */
export class SlipForm extends LitElement {
  static styles = formStyles;

  static properties = {
    src: { type: String },
    locale: { type: String },
    settings: { attribute: false },
    maxImageBytes: { type: Number, attribute: 'max-image-bytes' },
    _values: { state: true },
    _issued: { state: true },
    _issuing: { state: true },
    _issueError: { state: true },
    _previewUrl: { state: true },
    _previewError: { state: true },
    _error: { state: true },
    _imageError: { state: true },
  };

  /** 양식 또는 작성 중인 전표의 `.slip` JSON 문자열. */
  src = '';

  /**
   * UI 언어 (`ko`, `en`, `ja`).
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /** 렌더링 폰트를 제공하는 호스트 인터페이스. 생략하면 기본 폰트를 사용한다. */
  settings?: SlipFontProvider;

  /**
   * 업로드할 수 있는 이미지 파일의 최대 크기(바이트).
   *
   * @defaultValue 2MB
   */
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES;

  private _body: SlipTemplateBody | null = null;
  private _imageError: string | null = null;
  private _schemaVersion = '';
  private _values: Record<string, unknown> = {};
  private _issued = false;
  private _issuing = false;
  private _issueError: string | null = null;
  private _error: string | null = null;
  private _previewUrl: string | null = null;
  private _previewError: string | null = null;
  private _previewGeneration = 0;
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;

  /** 현재 로케일의 작성 폼 문구 */
  private get _t() {
    return getStrings(this.locale).form;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._previewTimer !== null) clearTimeout(this._previewTimer);
    this._revokePreviewUrl();
  }

  // 파싱 결과가 같은 렌더링에 반영되도록 렌더링 전에 처리한다.
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
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

    if (!this.src) {
      this._body = null;
      this._values = {};
      this._issued = false;
      return;
    }

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src, this.locale === undefined ? undefined : { locale: this.locale });
    } catch (error) {
      console.error('[slip-form] .slip parse failed:', error);
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
    }
    this._schemaVersion = file.schemaVersion;
  }

  // ---------------------------------------------------------------------------
  // 입력 목록 구성
  // ---------------------------------------------------------------------------

  /**
   * 문서 순서대로 입력 필드를 수집하고 요소가 직접 사용하지 않는 파라미터를 뒤에 추가한다.
   */
  private _collectInputs(): FormInput[] {
    const body = this._body;
    if (!body) return [];
    const labelOf = new Map<string, string>(
      (body.parameters ?? []).filter((b) => b.label !== undefined).map((b) => [b.key, b.label!]),
    );
    const inputs: FormInput[] = [];
    const seen = new Set<string>();
    const add = (key: string, input: Omit<FormInput, 'key' | 'label'>, name?: string): void => {
      if (seen.has(key)) return;
      seen.add(key);
      inputs.push({ key, label: labelOf.get(key) ?? name ?? key, ...input });
    };

    // 이미지 파라미터와 이미지 요소가 참조하는 키에는 파일 입력을 사용한다.
    const imageKeys = new Set<string>(
      (body.parameters ?? []).filter((b) => b.valueType === 'image').map((b) => b.key),
    );
    for (const page of body.pages) {
      for (const el of page.elements) {
        if (el.type === 'image' && el.parameter !== undefined) imageKeys.add(el.parameter);
      }
    }

    for (const page of body.pages) {
      for (const element of page.elements) {
        if (element.type === 'field') {
          // 수식 필드는 입력값이 아니므로 요소 ID를 행 식별자로 사용한다.
          if (element.parameter !== undefined) add(element.parameter, {}, element.name);
          else if (element.formula !== undefined) {
            add(element.id, { formula: element.formula }, element.name);
          }
        } else if (element.type === 'image' && element.parameter !== undefined) {
          add(element.parameter, { image: true }, element.name);
        } else if (element.type === 'grid' && element.repeat) {
          // 반복 구간 셀이 참조하는 항목 필드로 입력 표의 열을 구성한다.
          const { fromRow, toRow } = element.repeat;
          const band = element.cells
            .filter((cell) => cell.row >= fromRow && cell.row <= toRow && cell.parameter !== undefined)
            .sort((a, b) => a.column - b.column || a.row - b.row);
          const columns: { key: string; title: string }[] = [];
          for (const cell of band) {
            const key = cell.parameter as string;
            if (columns.some((c) => c.key === key)) continue;
            columns.push({ key, title: gridHeaderTitle(element, cell.column, fromRow) ?? key });
          }
          add(element.repeat.parameter, { columns }, element.name);
        }
      }
    }
    for (const def of body.parameters ?? []) {
      add(def.key, imageKeys.has(def.key) ? { image: true } : {});
    }
    return inputs;
  }

  /** 목록형 입력에서 객체로 구성된 행만 반환한다. */
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

  /** 발행 전 입력값을 모두 지운다. */
  private _reset(): void {
    if (this._issued) return;
    this._values = {};
    this._afterValueChange();
  }

  // ---------------------------------------------------------------------------
  // 전표 만들기 · 발행
  // ---------------------------------------------------------------------------

  /** 현재 입력값으로 전표 파일을 만든다. */
  private _buildVoucher(issued: boolean): SlipVoucherFile {
    const template: SlipTemplateFile = {
      schemaVersion: this._schemaVersion,
      kind: 'template',
      // 이 메서드는 body가 준비된 상태에서만 호출된다.
      template: this._body as SlipTemplateBody,
    };
    const voucher = buildVoucher(template, this._values as Record<string, JsonValue>);
    voucher.issued = issued;
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
   * 현재 값을 확정하고 발행 규칙을 검증한 전표를 `slip-issue`로 전달한다.
   * 검증에 실패하면 입력 상태를 유지한다 (SPEC §7.1).
   */
  private async _issue(): Promise<void> {
    if (!this._body || this._issued || this._issuing) return;
    this._issuing = true;
    this._issueError = null;
    this.requestUpdate();

    const voucher = this._buildVoucher(true);
    try {
      // 파서로 외부 URL 금지 등 발행 전표의 제약을 검증한다.
      parseSlipFile(serializeSlipFile(voucher), this.locale === undefined ? undefined : { locale: this.locale });
    } catch (error) {
      console.error('[slip-form] issue failed:', error);
      this._issueError = `${this._t.issueError} ${error instanceof Error ? error.message : String(error)}`;
      this._issuing = false;
      this.requestUpdate();
      return;
    }

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
    // 진행 중인 렌더링 결과가 새 Blob URL을 적용하지 못하도록 세대를 갱신한다.
    this._previewGeneration++;
    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }
  }

  /** 입력이 멈춘 뒤 한 번만 실행하도록 미리보기 갱신을 예약한다. */
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
      // 설정된 폰트가 없으면 기본 폰트를 사용한다.
      const opts: RenderOptions = {
        getFonts: () => resolveFonts(this.settings, this.locale),
        ...(this.locale === undefined ? {} : { locale: this.locale }),
      };
      const pdfBytes = await renderSlipToPdf(this._buildVoucher(this._issued), opts);
      if (gen !== this._previewGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-form] PDF preview failed:', error);
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
          ${this._imageError ? html`<div class="notice error" role="alert">${this._imageError}</div>` : nothing}
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
    if (input.image) return this._renderImageInput(input);

    if (input.formula !== undefined) {
      // 수식 필드는 입력 대신 현재 계산 결과를 표시한다.
      let text = '';
      let error: string | null = null;
      try {
        // 빈 number 파라미터를 0으로 정규화한 뒤 계산한다.
        const values = normalizeNumericParameters(this._values, this._body?.parameters);
        text = resultText(
          evaluateFormula(input.formula, {
            values,
            ...(this.locale === undefined ? {} : { locale: this.locale }),
          }),
        );
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

  /** base64 이미지 파일 선택과 현재 이미지 미리보기를 렌더링한다. */
  private _renderImageInput(input: FormInput) {
    const t = this._t;
    const raw = this._values[input.key];
    const chosen = typeof raw === 'string' && raw.startsWith('data:');
    return html`
      <div class="field">
        <label>${input.label}</label>
        ${chosen
          ? html`<div class="image-current"><img src=${raw as string} alt=""></div>`
          : html`<p class="image-hint">${t.imageNone}</p>`}
        <div class="image-btns">
          <button type="button" class="image-pick" ?disabled=${this._issued}
            aria-label="${input.label} ${t.imageUpload}"
            @click=${() => this._pickImage(input.key)}>${t.imageUpload}</button>
          ${chosen
            ? html`<button type="button" class="image-clear" ?disabled=${this._issued}
                aria-label="${input.label} ${t.imageClear}"
                @click=${() => this._setValue(input.key, undefined)}>${t.imageClear}</button>`
            : nothing}
        </div>
      </div>
    `;
  }

  /** 선택한 이미지 파일을 base64로 변환해 전표 값에 저장한다. */
  private async _pickImage(key: string): Promise<void> {
    if (this._issued) return;
    const t = this._t;
    const result = await pickImageFile(this.maxImageBytes);
    if (result.ok) {
      this._imageError = null;
      this._setValue(key, result.src);
      return;
    }
    if (result.reason === 'notImage') this._imageError = t.imageNotImage;
    else if (result.reason === 'readFailed') this._imageError = t.imageReadFailed;
    else {
      this._imageError = t.imageTooLarge
        .replace('{max}', formatBytes(this.maxImageBytes))
        .replace('{size}', formatBytes(result.size));
    }
    this.requestUpdate();
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
