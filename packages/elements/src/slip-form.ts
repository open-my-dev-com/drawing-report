import { LitElement, html, nothing } from 'lit';
import { formStyles } from './styles/slip-form.styles.js';
import {
  buildVoucher,
  evaluateFormula,
  inspectImageDataUrl,
  normalizeNumericParameters,
  parseSlipFile,
  serializeSlipFile,
  type GridElement,
  type JsonValue,
  type ParameterValueType,
  type SlipFile,
  type SlipKit,
  type SlipTemplateBody,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from './strings.js';
import { icons } from './icons.js';
import { pickImageFile, formatBytes, type ImagePickResult } from './image-file.js';
import { renderSlip } from './settings.js';

/** 입력이 끝난 뒤 PDF 미리보기를 갱신하기까지 기다리는 시간(ms) */
const PREVIEW_DEBOUNCE_MS = 500;

/** 업로드할 수 있는 이미지 파일의 기본 최대 크기(바이트) */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 값 형식 오류를 가리키는 문구 키 */
type ValueErrorKey =
  | 'invalidText'
  | 'invalidNumber'
  | 'invalidDate'
  | 'invalidBoolean'
  | 'invalidImage'
  | 'invalidList';

/** 목록형 입력의 열 하나 */
interface FormColumn {
  /** 행 객체에 값을 저장할 하위 필드 키 */
  key: string;
  /** 열 제목 */
  title: string;
  /** 열 값의 형식 */
  valueType: ParameterValueType;
}

/** 작성 폼에 렌더링할 입력 항목. */
interface FormInput {
  /** 전표 `values`에 값을 저장할 파라미터 키 */
  key: string;
  /** 화면에 표시할 이름 */
  label: string;
  /** 파라미터 정의의 값 형식. 이미지 요소가 참조하는 키는 `image`로 본다 */
  valueType: ParameterValueType;
  /** 목록형 입력의 열 구조 */
  columns?: FormColumn[];
  /** 입력 요소 대신 계산 결과를 표시할 수식. */
  formula?: string;
}

/** 발행 실패 상태. 문구는 렌더링 시점의 로케일로 고른다 */
type IssueError = { key: 'issueError'; detail: string } | { key: 'issueInvalid' };

/** 이미지 선택 실패 상태. 문구는 렌더링 시점의 로케일로 고른다 */
type ImageError = { key: string; result: Extract<ImagePickResult, { ok: false }> };

const NUMBER_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 입력 문자열을 형식에 맞는 값으로 변환합니다.
 * 숫자 형식에서만 수로 바꾸고 나머지는 원문을 그대로 둡니다.
 */
function parseInputValue(text: string, valueType: ParameterValueType): unknown {
  if (valueType !== 'number') return text;
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return NUMBER_RE.test(trimmed) ? Number(trimmed) : text;
}

/** `YYYY-MM-DD` 형식이고 실제로 존재하는 날짜인지 확인합니다. */
function isValidDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
}

/** 값이 비어 있어 형식 검사를 건너뛸 수 있는지 확인합니다. */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * 스칼라 값이 선언된 형식에 맞는지 검사합니다.
 *
 * @returns 어긋난 형식의 문구 키. 맞거나 비어 있으면 `null`
 */
function scalarProblem(value: unknown, valueType: ParameterValueType): ValueErrorKey | null {
  if (isEmptyValue(value)) return null;
  switch (valueType) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'invalidNumber';
    case 'date':
      return typeof value === 'string' && isValidDate(value) ? null : 'invalidDate';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'invalidBoolean';
    case 'image':
      return typeof value === 'string' &&
        (value.startsWith('asset://') || inspectImageDataUrl(value).ok)
        ? null
        : 'invalidImage';
    case 'list':
      return Array.isArray(value) ? null : 'invalidList';
    default:
      return typeof value === 'object' ? 'invalidText' : null;
  }
}

/** 목록 값의 행마다 열 형식을 검사합니다. */
function listProblem(value: unknown, columns: FormColumn[]): ValueErrorKey | null {
  if (isEmptyValue(value)) return null;
  if (!Array.isArray(value)) return 'invalidList';
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return 'invalidList';
    for (const column of columns) {
      if (scalarProblem((row as Record<string, unknown>)[column.key], column.valueType) !== null) {
        return 'invalidList';
      }
    }
  }
  return null;
}

/** 입력 항목의 현재 값이 형식에 맞지 않으면 문구 키를 돌려줍니다. */
function inputProblem(input: FormInput, value: unknown): ValueErrorKey | null {
  if (input.formula !== undefined) return null;
  if (input.columns) return listProblem(value, input.columns);
  return scalarProblem(value, input.valueType);
}

/**
 * 항목 구간 위쪽에서 같은 열의 헤더 텍스트를 찾습니다.
 */
function gridHeaderTitle(grid: GridElement, column: number, fromRow: number): string | undefined {
  for (let row = fromRow - 1; row >= 0; row -= 1) {
    const cell = grid.cells.find((c) => c.row === row && c.column === column);
    if (cell?.content !== undefined && cell.content !== '') return cell.content;
  }
  return undefined;
}

/** 스칼라 값을 입력 필드에 표시할 문자열로 변환합니다. */
function inputText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** 수식 계산 결과를 표시용 문자열로 변환합니다. */
function resultText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/** 형식별 `<input type>` — 텍스트 외 형식은 브라우저의 전용 컨트롤을 사용합니다. */
function inputTypeOf(valueType: ParameterValueType): string {
  switch (valueType) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'boolean':
      return 'checkbox';
    default:
      return 'text';
  }
}

/**
 * 양식에 정의된 파라미터 값을 입력하고 전표를 발행하는 `<slip-form>` 컴포넌트.
 *
 * 양식이나 작성 중인 전표에서 입력 필드를 구성합니다. 파라미터의 값 형식에 맞는 입력
 * 컨트롤을 쓰고, 목록 파라미터는 행을 추가하거나 삭제할 수 있으며 수식 필드는 입력값이
 * 바뀔 때 계산 결과를 갱신합니다. 미리보기는 PDF 렌더링 결과를 사용합니다.
 *
 * 발행하면 확정된 전표를 `slip-issue` 이벤트로 전달하고 입력을 잠급니다 (SPEC §7.1).
 * 선언된 형식에 맞지 않는 값이 있으면 발행하지 않고 해당 입력 아래에 이유를 표시합니다.
 * 작성 중인 값은 `slip-change` 이벤트로 전달합니다.
 */
export class SlipForm extends LitElement {
  static styles = formStyles;

  static properties = {
    src: { type: String },
    locale: { type: String },
    slipkit: { attribute: false },
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
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따릅니다.
   *
   * @defaultValue 영어
   */
  locale?: string;

  /**
   * 폰트·로케일 공통 설정 인스턴스. PDF 미리보기와 수식 평가는 이 인스턴스의 설정을
   * 사용합니다. `getFonts`가 없으면 동봉 기본 폰트로 렌더링합니다.
   */
  slipkit?: SlipKit;

  /**
   * 업로드할 수 있는 이미지 파일의 최대 크기(바이트).
   *
   * @defaultValue 2MB
   */
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES;

  private _body: SlipTemplateBody | null = null;
  private _imageError: ImageError | null = null;
  private _schemaVersion = '';
  private _values: Record<string, unknown> = {};
  private _issued = false;
  private _issuing = false;
  private _issueError: IssueError | null = null;
  private _error: 'parseError' | null = null;
  private _previewUrl: string | null = null;
  private _previewError = false;
  private _previewGeneration = 0;
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;

  /** 컴포넌트 속성이 우선하고, 없으면 slipkit 설정을 따르는 유효 로케일 */
  private get _locale(): string | undefined {
    return this.locale ?? this.slipkit?.locale;
  }

  /** 현재 로케일의 작성 폼 문구 */
  private get _t(): SlipStrings['form'] {
    return getStrings(this._locale).form;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // 분리됐다 다시 연결되면 분리 중 버린 미리보기를 현재 값으로 복구합니다.
    if (this.hasUpdated && this._body) this._schedulePreview();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._previewTimer !== null) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
    this._revokePreviewUrl();
  }

  // 파싱 결과가 같은 렌더링에 반영되도록 렌더링 전에 처리합니다.
  // slipkit·locale 변경으로는 다시 파싱하지 않습니다 — 입력 중인 값을 지우지 않기 위해서입니다.
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
    }
    if (changed.has('src') || changed.has('slipkit') || changed.has('locale')) {
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
    this._imageError = null;
    this._previewError = false;

    if (!this.src) {
      this._body = null;
      this._values = {};
      this._issued = false;
      return;
    }

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src, this._locale === undefined ? undefined : { locale: this._locale });
    } catch (error) {
      console.error('[slip-form] .slip parse failed:', error);
      this._body = null;
      this._error = 'parseError';
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

  /**
   * 현재 `src`의 양식에서 빈 전표로 되돌립니다. 입력값을 모두 지우고 발행 상태를
   * 해제한 뒤 빈 전표를 `slip-change`로 알립니다. `src`가 발행된 전표여도 같은 양식의
   * 새 전표를 시작할 수 있습니다.
   *
   * @remarks
   * `src`를 같은 문자열로 다시 지정해도 변경으로 보지 않으므로, 발행 뒤 같은 양식으로
   * 새 전표를 시작하려면 이 메서드를 호출합니다. `src`가 없거나 읽을 수 없으면 아무 일도
   * 하지 않습니다.
   */
  reset(): void {
    this._parseSource();
    if (!this._body) {
      this.requestUpdate();
      return;
    }
    this._values = {};
    this._issued = false;
    this._issuing = false;
    this._afterValueChange();
  }

  // ---------------------------------------------------------------------------
  // 입력 목록 구성
  // ---------------------------------------------------------------------------

  /**
   * 문서 순서대로 입력 필드를 수집하고 요소가 직접 사용하지 않는 파라미터를 뒤에 추가합니다.
   */
  private _collectInputs(): FormInput[] {
    const body = this._body;
    if (!body) return [];
    const defs = new Map((body.parameters ?? []).map((def) => [def.key, def]));

    // 이미지 요소가 참조하는 키는 값 형식 선언이 없어도 이미지 입력을 사용합니다.
    const imageKeys = new Set<string>();
    for (const page of body.pages) {
      for (const el of page.elements) {
        if (el.type === 'image' && el.parameter !== undefined) imageKeys.add(el.parameter);
      }
    }
    const valueTypeOf = (key: string): ParameterValueType => {
      const declared = defs.get(key)?.valueType;
      if (imageKeys.has(key) && (declared === undefined || declared === 'text')) return 'image';
      return declared ?? 'text';
    };
    const columnsOf = (key: string, fromGrid: FormColumn[]): FormColumn[] => {
      const columns = fromGrid.map((column) => ({ ...column }));
      for (const field of defs.get(key)?.fields ?? []) {
        const existing = columns.find((column) => column.key === field.key);
        if (existing) {
          existing.valueType = field.valueType ?? 'text';
          if (field.label !== undefined) existing.title = field.label;
        } else {
          columns.push({ key: field.key, title: field.label ?? field.key, valueType: field.valueType ?? 'text' });
        }
      }
      return columns;
    };

    const inputs: FormInput[] = [];
    const seen = new Set<string>();
    const add = (key: string, input: Omit<FormInput, 'key' | 'label' | 'valueType'>, name?: string): void => {
      if (seen.has(key)) return;
      seen.add(key);
      const valueType = valueTypeOf(key);
      const columns =
        input.columns !== undefined || valueType === 'list' ? columnsOf(key, input.columns ?? []) : undefined;
      inputs.push({
        key,
        label: defs.get(key)?.label ?? name ?? key,
        valueType,
        ...input,
        ...(columns === undefined ? {} : { columns }),
      });
    };

    for (const page of body.pages) {
      for (const element of page.elements) {
        if (element.type === 'field') {
          // 수식 필드는 입력값이 아니므로 요소 ID를 행 식별자로 사용합니다.
          if (element.parameter !== undefined) add(element.parameter, {}, element.name);
          else if (element.formula !== undefined) {
            add(element.id, { formula: element.formula }, element.name);
          }
        } else if (element.type === 'image' && element.parameter !== undefined) {
          add(element.parameter, {}, element.name);
        } else if (element.type === 'grid' && element.repeat) {
          // 항목 구간 셀이 참조하는 항목 필드로 입력 표의 열을 구성합니다.
          const itemBand = element.repeat.bands.find((band) => band.placement === 'item');
          if (itemBand === undefined) continue;
          const band = element.cells
            .filter((cell) =>
              cell.row >= itemBand.fromRow && cell.row <= itemBand.toRow && cell.parameter !== undefined)
            .sort((a, b) => a.column - b.column || a.row - b.row);
          const columns: FormColumn[] = [];
          for (const cell of band) {
            const key = cell.parameter as string;
            if (columns.some((c) => c.key === key)) continue;
            // 열 제목은 셀 이름을 우선 사용하고, 없으면 항목 구간 위쪽의 헤더 텍스트를 사용합니다.
            columns.push({
              key,
              title: cell.name ?? gridHeaderTitle(element, cell.column, itemBand.fromRow) ?? key,
              valueType: 'text',
            });
          }
          add(element.repeat.parameter, { columns }, element.name);
        }
      }
    }
    for (const def of body.parameters ?? []) {
      add(def.key, {});
    }
    return inputs;
  }

  /** 목록형 입력에서 객체로 구성된 행만 반환합니다. */
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

  /** 발행 전 입력값을 모두 지웁니다. 파라미터에 없는 값은 남겨 둡니다. */
  private _clearValues(): void {
    if (this._issued) return;
    for (const input of this._collectInputs()) delete this._values[input.key];
    this._afterValueChange();
  }

  // ---------------------------------------------------------------------------
  // 전표 만들기 · 발행
  // ---------------------------------------------------------------------------

  /** 현재 입력값으로 전표 파일을 만듭니다. */
  private _buildVoucher(issued: boolean): SlipVoucherFile {
    const template: SlipTemplateFile = {
      schemaVersion: this._schemaVersion,
      kind: 'template',
      // 이 메서드는 body가 준비된 상태에서만 호출됩니다.
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

  /** 형식에 맞지 않는 값이 있는 입력이 하나라도 있는지 확인합니다. */
  private _hasInvalidValues(): boolean {
    return this._collectInputs().some((input) => inputProblem(input, this._values[input.key]) !== null);
  }

  /**
   * 현재 값을 확정하고 발행 규칙을 검증한 전표를 `slip-issue`로 전달합니다.
   * 검증에 실패하면 입력 상태를 유지합니다 (SPEC §7.1).
   */
  private async _issue(): Promise<void> {
    if (!this._body || this._issued || this._issuing) return;
    if (this._hasInvalidValues()) {
      this._issueError = { key: 'issueInvalid' };
      this.requestUpdate();
      return;
    }
    this._issuing = true;
    this._issueError = null;
    this.requestUpdate();

    const voucher = this._buildVoucher(true);
    try {
      // 파서로 외부 URL 금지 등 발행 전표의 제약을 검증합니다.
      parseSlipFile(serializeSlipFile(voucher), this._locale === undefined ? undefined : { locale: this._locale });
    } catch (error) {
      console.error('[slip-form] issue failed:', error);
      this._issueError = {
        key: 'issueError',
        detail: error instanceof Error ? error.message : String(error),
      };
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
    // 진행 중인 렌더링 결과가 새 Blob URL을 적용하지 못하도록 세대를 갱신합니다.
    this._previewGeneration++;
    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }
  }

  /** 입력이 멈춘 뒤 한 번만 실행하도록 미리보기 갱신을 예약합니다. */
  private _schedulePreview(): void {
    if (this._previewTimer !== null) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      void this._renderPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  private async _renderPreview(): Promise<void> {
    if (!this._body || !this.isConnected) return;
    this._revokePreviewUrl();
    this._previewError = false;
    const gen = ++this._previewGeneration;
    try {
      const pdfBytes = await renderSlip(this.slipkit, this._buildVoucher(this._issued), this._locale);
      // 분리됐거나 새 렌더가 시작됐으면 결과를 버립니다 — Blob URL은 만들지 않습니다.
      if (gen !== this._previewGeneration || !this.isConnected) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-form] PDF preview failed:', error);
      if (gen !== this._previewGeneration || !this.isConnected) return;
      this._previewError = true;
    }
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 렌더
  // ---------------------------------------------------------------------------

  /** 발행 실패 상태를 현재 로케일 문구로 바꿉니다. */
  private _issueErrorText(): string | null {
    const error = this._issueError;
    if (error === null) return null;
    return error.key === 'issueInvalid' ? this._t.issueInvalid : `${this._t.issueError} ${error.detail}`;
  }

  /** 이미지 선택 실패 상태를 현재 로케일 문구로 바꿉니다. */
  private _imageErrorText(): string | null {
    const error = this._imageError;
    if (error === null) return null;
    const t = this._t;
    const result = error.result;
    if (result.reason === 'notImage') return t.imageUnsupported;
    if (result.reason === 'readFailed') return t.imageReadFailed;
    return t.imageTooLarge
      .replace('{max}', formatBytes(this.maxImageBytes))
      .replace('{size}', formatBytes(result.size));
  }

  override render() {
    if (!this._body) {
      return html`<div class="empty-state ${this._error ? 'error' : ''}">
        ${this._error ? this._t[this._error] : this._t.noFile}
      </div>`;
    }
    const t = this._t;
    const inputs = this._collectInputs();
    const issueError = this._issueErrorText();
    const imageError = this._imageErrorText();

    return html`
      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">${this._body.meta.title}</span>
          ${this._issued
            ? html`<span class="issued-badge">${t.issued}</span>`
            : html`
                <button class="btn" ?disabled=${this._issuing} @click=${() => this._clearValues()}>
                  ${t.reset}
                </button>
                <button class="btn primary" ?disabled=${this._issuing}
                  @click=${() => void this._issue()}>${t.issue}</button>`}
        </div>
        <div class="pane-body">
          ${this._issued ? html`<div class="notice">${t.issuedNotice}</div>` : nothing}
          ${issueError ? html`<div class="notice error" role="alert">${issueError}</div>` : nothing}
          ${imageError ? html`<div class="notice error" role="alert">${imageError}</div>` : nothing}
          ${inputs.length === 0
            ? html`<div class="empty">${t.noInputs}</div>`
            : inputs.map((input) => this._renderInput(input))}
        </div>
      </section>
      <section class="preview">
        ${this._previewUrl
          ? html`<iframe src=${this._previewUrl} title=${t.pdfTitle}></iframe>`
          : this._previewError
            ? html`<div class="status error">${t.previewError}</div>`
            : html`<div class="status">${t.previewLoading}</div>`}
      </section>
    `;
  }

  /** 입력 아래에 형식 오류 문구를 표시합니다. 문제가 없으면 아무것도 그리지 않습니다. */
  private _renderProblem(input: FormInput) {
    const problem = inputProblem(input, this._values[input.key]);
    if (problem === null) return nothing;
    return html`<div class="hint error" id=${`e-${input.key}`}>${this._t[problem]}</div>`;
  }

  private _renderInput(input: FormInput) {
    const t = this._t;
    if (input.columns) return this._renderRowInput(input, input.columns);
    if (input.valueType === 'image') return this._renderImageInput(input);

    if (input.formula !== undefined) {
      // 수식 필드는 입력 대신 현재 계산 결과를 표시합니다.
      let text = '';
      let error: string | null = null;
      try {
        // 빈 number 파라미터를 0으로 정규화한 뒤 계산합니다.
        const values = normalizeNumericParameters(this._values, this._body?.parameters);
        // slipkit이 있으면 수식도 같은 인스턴스로 평가해 PDF와 같은 로케일을 사용합니다.
        // 컴포넌트 locale은 UI 언어 전용이라 수식 컨텍스트에 넣지 않습니다.
        text = resultText(
          this.slipkit
            ? this.slipkit.evaluate(input.formula, { values })
            : evaluateFormula(input.formula, {
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

    const value = this._values[input.key];
    const problem = inputProblem(input, value);
    if (input.valueType === 'boolean') {
      return html`
        <div class="field boolean">
          <label class="check">
            <input id=${`f-${input.key}`} type="checkbox" .checked=${value === true}
              aria-label=${input.label} ?disabled=${this._issued}
              aria-invalid=${problem !== null ? 'true' : 'false'}
              @change=${(e: Event) => this._setValue(input.key, (e.target as HTMLInputElement).checked)}>
            <span>${input.label}</span>
          </label>
          ${this._renderProblem(input)}
        </div>
      `;
    }

    return html`
      <div class="field">
        <label for=${`f-${input.key}`}>${input.label}</label>
        <input id=${`f-${input.key}`} type=${inputTypeOf(input.valueType)}
          step=${input.valueType === 'number' ? 'any' : nothing}
          .value=${inputText(value)}
          aria-label=${input.label} ?disabled=${this._issued}
          aria-invalid=${problem !== null ? 'true' : 'false'}
          @change=${(e: Event) =>
            this._setValue(input.key, parseInputValue((e.target as HTMLInputElement).value, input.valueType))}>
        ${this._renderProblem(input)}
      </div>
    `;
  }

  /** base64 이미지 파일 선택과 현재 이미지 미리보기를 렌더링합니다. */
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
        ${this._renderProblem(input)}
      </div>
    `;
  }

  /** 선택한 이미지 파일을 base64로 변환해 전표 값에 저장합니다. */
  private async _pickImage(key: string): Promise<void> {
    if (this._issued) return;
    const result = await pickImageFile(this.maxImageBytes);
    if (result.ok) {
      this._imageError = null;
      this._setValue(key, result.src);
      return;
    }
    this._imageError = { key, result };
    this.requestUpdate();
  }

  private _renderRowInput(input: FormInput, columns: FormColumn[]) {
    const t = this._t;
    const rows = this._rowsOf(input.key);
    const cellValue = (column: FormColumn, e: Event): unknown => {
      const target = e.target as HTMLInputElement;
      if (column.valueType === 'boolean') return target.checked;
      return parseInputValue(target.value, column.valueType);
    };
    return html`
      <div class="field">
        <label>${input.label}</label>
        <div class="row-scroll">
          <div class="row-grid"
            style="grid-template-columns:repeat(${columns.length}, minmax(56px, 1fr)) 22px">
            ${columns.map((col) => html`<span class="col-title">${col.title || col.key}</span>`)}
            <span></span>
            ${rows.map((row, rowIndex) => html`
              ${columns.map((col) => html`
                <input type=${inputTypeOf(col.valueType)}
                  step=${col.valueType === 'number' ? 'any' : nothing}
                  .value=${col.valueType === 'boolean' ? 'on' : inputText(row[col.key])}
                  .checked=${col.valueType === 'boolean' && row[col.key] === true}
                  aria-label="${input.label} ${rowIndex + 1} ${col.title || col.key}"
                  aria-invalid=${scalarProblem(row[col.key], col.valueType) !== null ? 'true' : 'false'}
                  ?disabled=${this._issued}
                  @change=${(e: Event) => {
                    const next = rows.map((r) => ({ ...r }));
                    const value = cellValue(col, e);
                    if (value === '') delete next[rowIndex]![col.key];
                    else next[rowIndex]![col.key] = value;
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
        ${this._renderProblem(input)}
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
