import { LitElement, html, nothing } from 'lit';
import { viewerStyles } from './styles/slip-viewer.styles.js';
import { parseSlipFile, type SlipFile, type SlipKit } from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { renderSlip } from './settings.js';

/** 표시할 오류 종류. 문구는 렌더링 시점의 로케일로 고른다 */
type ViewerError = 'parseError' | 'renderError';

/**
 * `.slip` 양식 또는 전표를 PDF로 렌더링해 표시하는 웹 컴포넌트.
 */
export class SlipViewer extends LitElement {
  static styles = viewerStyles;

  static properties = {
    src: { type: String },
    locale: { type: String },
    slipkit: { attribute: false },
    _pdfUrl: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  /** 렌더링할 `.slip` JSON 문자열. */
  src = '';

  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string;

  /**
   * 폰트·로케일 공통 설정 인스턴스. PDF 렌더링은 이 인스턴스의 설정을 사용한다.
   * `getFonts`가 없으면 동봉 기본 폰트로 렌더링한다.
   */
  slipkit?: SlipKit;

  private _pdfUrl: string | null = null;
  private _error: ViewerError | null = null;
  private _loading = false;
  private _renderGeneration = 0;

  /** 컴포넌트 속성이 우선하고, 없으면 slipkit 설정을 따르는 유효 로케일 */
  private get _locale(): string | undefined {
    return this.locale ?? this.slipkit?.locale;
  }

  /** 현재 locale의 뷰어 문구 */
  private get _t() {
    return getStrings(this._locale).viewer;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // 분리됐다 다시 연결되면 분리 중 버린 결과 대신 현재 src로 미리보기를 복구한다.
    if (this.hasUpdated && this.src) void this._renderPdf();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._revokePdfUrl();
  }

  // 렌더 시작은 갱신 전에 처리해 같은 갱신에 로딩 상태가 반영되게 한다.
  // 갱신이 끝난 뒤 동기적으로 상태를 바꾸면 Lit이 중복 갱신을 경고한다.
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src') || changed.has('slipkit') || changed.has('locale')) {
      void this._renderPdf();
    }
  }

  private _revokePdfUrl(): void {
    // 분리되거나 소스가 바뀐 뒤 완료된 렌더 결과는 사용하지 않는다.
    this._renderGeneration++;
    if (this._pdfUrl) {
      URL.revokeObjectURL(this._pdfUrl);
      this._pdfUrl = null;
    }
  }

  private async _renderPdf(): Promise<void> {
    this._revokePdfUrl();
    this._error = null;

    if (!this.src) {
      this._loading = false;
      return;
    }

    this._loading = true;
    const gen = ++this._renderGeneration;

    const locale = this._locale;
    let file: SlipFile;
    try {
      file = parseSlipFile(this.src, locale === undefined ? undefined : { locale });
    } catch (error) {
      console.error('[slip-viewer] .slip parse failed:', error);
      this._loading = false;
      this._error = 'parseError';
      return;
    }

    try {
      const pdfBytes = await renderSlip(this.slipkit, file, locale);
      // 분리됐거나 새 렌더가 시작됐으면 결과를 버린다 — Blob URL은 만들지 않는다.
      if (gen !== this._renderGeneration || !this.isConnected) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._pdfUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-viewer] PDF rendering failed:', error);
      if (gen !== this._renderGeneration || !this.isConnected) return;
      this._error = 'renderError';
    } finally {
      if (gen === this._renderGeneration) {
        this._loading = false;
      }
    }
  }

  override render() {
    if (!this.src && !this._loading && !this._error) {
      return html`<div class="status">${this._t.noFile}</div>`;
    }
    if (this._loading) {
      return html`<div class="status">${this._t.loading}</div>`;
    }
    if (this._error) {
      return html`<div class="status error">${this._t[this._error]}</div>`;
    }
    if (this._pdfUrl) {
      return html`<iframe src=${this._pdfUrl} title=${this._t.pdfTitle}></iframe>`;
    }
    return nothing;
  }
}

customElements.define('slip-viewer', SlipViewer);

declare global {
  interface HTMLElementTagNameMap {
    'slip-viewer': SlipViewer;
  }
}
