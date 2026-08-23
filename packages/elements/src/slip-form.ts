import { LitElement, css, html, nothing } from 'lit';
import {
  computeIntegrity,
  evaluateFormula,
  normalizeNumericBindings,
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
  type GridElement,
  type IntegrityJwk,
  type JsonValue,
  type RenderOptions,
  type SlipFile,
  type SlipTemplateBody,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { icons } from './icons.js';
import { pickImageFile, formatBytes } from './image-file.js';
import { resolveFonts, type SlipFontProvider } from './settings.js';

/** PDF 미리보기를 다시 만들기까지 기다리는 시간(ms) — 타자 중 매번 렌더하지 않기 위함 */
const PREVIEW_DEBOUNCE_MS = 500;

/** 넣을 수 있는 이미지 파일의 기본 최대 크기(바이트, 2MB) — 호스트가 `maxImageBytes`로 바꾼다 (G-47) */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 작성폼이 만들어 주는 입력 한 칸 */
interface FormInput {
  /** 값을 담을 파라미터 키 (전표 values의 키) */
  key: string;
  /** 화면에 보여줄 이름 — 파라미터 논리명 → 요소 이름 → 물리명 순 */
  label: string;
  /** 표 입력이면 열 구조, 아니면 한 줄 입력 */
  columns?: { key: string; title: string }[];
  /** 수식으로 자동 계산되는 칸이면 그 수식 (입력받지 않고 계산 결과만 보여준다) */
  formula?: string;
  /** 변동 이미지 값이면 이미지 업로드 입력을 낸다 (G-47) */
  image?: boolean;
}

/**
 * 입력값 해석 — 숫자로 보이는 표기는 수로 담는다. 합계 수식(SUM 등)이 값을
 * 그대로 더할 수 있어야 하기 때문이다 (디자이너 샘플 데이터와 같은 규칙).
 */
function parseInputValue(text: string): string | number {
  const trimmed = text.trim();
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/**
 * 반복 구간 열의 이름 — 반복 구간 바로 위 행부터 거슬러 올라가며 같은 열에 직접 입력된 글을 찾는다.
 * 그리드 헤더에 적힌 이름을 그대로 쓰면 작성폼의 열 이름이 전표와 같아진다 (ADR-037).
 */
function gridHeaderTitle(grid: GridElement, column: number, fromRow: number): string | undefined {
  for (let row = fromRow - 1; row >= 0; row -= 1) {
    const cell = grid.cells.find((c) => c.row === row && c.column === column);
    if (cell?.content !== undefined && cell.content !== '') return cell.content;
  }
  return undefined;
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
 * 양식(template)이나 작성 중 전표(voucher)를 받아 파라미터마다 입력 칸을 만들고,
 * 반복 구간이 쓰는 값은 항목 필드대로 행을 넣고 뺄 수 있게 한다. 수식 필드는 입력받지 않고
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

    /* 변동 이미지 입력 (G-47) */
    .image-current {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 96px;
      margin: 4px 0;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
    }
    .image-current img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .image-hint {
      margin: 4px 0;
      font-size: 12px;
      color: var(--sk-text-muted);
    }
    .image-btns {
      display: flex;
      gap: 6px;
    }
    .image-pick,
    .image-clear {
      padding: 4px 10px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .image-pick:hover:not(:disabled),
    .image-clear:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .image-pick:disabled,
    .image-clear:disabled {
      opacity: 0.35;
      cursor: default;
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
    settings: { attribute: false },
    signingKey: { attribute: false },
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

  /** .slip JSON 문자열 — 양식(template) 또는 작성 중 전표(voucher) */
  src = '';

  /**
   * UI 언어 ('ko' | 'en' | 'ja') — ADR-028/042.
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /** 렌더 폰트를 공급하는 호스트 인터페이스 (ADR-040, JS 프로퍼티 전용) — 없으면 동봉 기본 */
  settings?: SlipFontProvider;

  /** 발행 서명에 쓸 개인키 (JWK) — 주지 않으면 해시만 기록한다 (SPEC §8.3) */
  signingKey?: IntegrityJwk;

  /**
   * 넣을 수 있는 변동 이미지 파일의 최대 크기(바이트) — 호스트가 자기 시스템에 맞게 조인다 (G-47).
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
   * 훑고, 요소가 쓰지 않지만 정의부에만 있는 파라미터(수식에서만 참조하는 값 등)을 뒤에 붙인다.
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

    // 변동 이미지 값은 텍스트가 아니라 이미지 업로드로 받는다 (G-47) — 값 종류가 이미지인
    // 정의부 키도 포함한다
    const imageKeys = new Set<string>(
      (body.bindings ?? []).filter((b) => b.valueType === 'image').map((b) => b.key),
    );
    for (const page of body.pages) {
      for (const el of page.elements) {
        if (el.type === 'image' && el.binding !== undefined) imageKeys.add(el.binding);
      }
    }

    for (const page of body.pages) {
      for (const element of page.elements) {
        if (element.type === 'field') {
          add(
            element.binding,
            element.formula === undefined ? {} : { formula: element.formula },
            element.name,
          );
        } else if (element.type === 'image' && element.binding !== undefined) {
          add(element.binding, { image: true }, element.name);
        } else if (element.type === 'grid' && element.repeat) {
          // 반복 구간 칸이 읽는 항목 필드가 곧 입력 표의 열이 된다 (ADR-037)
          const { fromRow, toRow } = element.repeat;
          const band = element.cells
            .filter((cell) => cell.row >= fromRow && cell.row <= toRow && cell.binding !== undefined)
            .sort((a, b) => a.column - b.column || a.row - b.row);
          const columns: { key: string; title: string }[] = [];
          for (const cell of band) {
            const key = cell.binding as string;
            if (columns.some((c) => c.key === key)) continue;
            columns.push({ key, title: gridHeaderTitle(element, cell.column, fromRow) ?? key });
          }
          add(element.repeat.binding, { columns }, element.name);
        }
      }
    }
    for (const def of body.bindings ?? []) {
      add(def.key, imageKeys.has(def.key) ? { image: true } : {});
    }
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
    // number 파라미터의 빈 값을 0으로 정규화한다 (ADR-044) — 엄격 타입 수식이 미입력을 0으로 보게.
    const values = normalizeNumericBindings(
      JSON.parse(JSON.stringify(this._values)) as Record<string, unknown>,
      this._body?.bindings,
    ) as Record<string, JsonValue>;
    const voucher: SlipVoucherFile = {
      schemaVersion: this._schemaVersion,
      kind: 'voucher',
      templateSnapshot: JSON.parse(JSON.stringify(this._body)) as SlipTemplateBody,
      values,
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
        fonts: await resolveFonts(this.settings, this.locale),
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
      // 수식 칸은 입력받지 않는다 — 값이 바뀔 때마다 즉시 계산해 결과만 보여준다
      let text = '';
      let error: string | null = null;
      try {
        // number 파라미터 빈 값→0을 반영해 계산한다 (ADR-044) — 미리보기·발행과 같은 값.
        const values = normalizeNumericBindings(this._values, this._body?.bindings);
        text = resultText(evaluateFormula(input.formula, { values }));
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

  /** 변동 이미지 입력 (G-47) — 파일에서 골라 base64로 담고, 넣은 이미지를 보여준다 */
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

  /** 파일에서 이미지를 골라 base64로 값에 담는다 (G-47) */
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
