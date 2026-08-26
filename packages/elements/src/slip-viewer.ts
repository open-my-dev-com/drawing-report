import { LitElement, css, html, nothing } from 'lit';
import {
  parseSlipFile,
  renderSlipToPdf,
  type RenderOptions,
  type SlipFile,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { resolveFonts, type SlipFontProvider } from './settings.js';

/**
 * `.slip` 양식 또는 전표를 PDF로 렌더링해 표시하는 웹 컴포넌트.
 */
export class SlipViewer extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      min-height: 200px;
    }

    /* hidden 속성이 컴포넌트의 기본 display 규칙보다 우선하도록 지정한다. */
    :host([hidden]) {
      display: none;
    }

    iframe {
      display: block;
      width: 100%;
      height: 100%;
      min-height: inherit;
      border: none;
    }

    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: inherit;
      color: #666;
      font-family: sans-serif;
      font-size: 14px;
    }

    .status.error {
      color: #c00;
    }
  `;

  static properties = {
    src: { type: String },
    locale: { type: String },
    settings: { attribute: false },
    _pdfUrl: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  /** 렌더링할 `.slip` JSON 문자열. */
  src = '';

  /**
   * UI 언어 (`ko`, `en`, `ja`).
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /** 렌더링 설정. 폰트 공급자가 없으면 동봉 기본 폰트를 사용한다. */
  settings?: SlipFontProvider;

  private _pdfUrl: string | null = null;
  private _error: string | null = null;
  private _loading = false;
  private _renderGeneration = 0;

  /** 현재 locale의 뷰어 문구 */
  private get _t() {
    return getStrings(this.locale).viewer;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._revokePdfUrl();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src') || changed.has('settings')) {
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

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src, this.locale === undefined ? undefined : { locale: this.locale });
    } catch (error) {
      console.error('[slip-viewer] .slip parse failed:', error);
      this._loading = false;
      this._error = this._t.parseError;
      return;
    }

    try {
      // 호스트가 폰트를 제공하지 않으면 UI 언어에 맞는 동봉 폰트를 사용한다.
      const opts: RenderOptions = {
        getFonts: () => resolveFonts(this.settings, this.locale),
        ...(this.locale === undefined ? {} : { locale: this.locale }),
      };
      const pdfBytes = await renderSlipToPdf(file, opts);
      if (gen !== this._renderGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._pdfUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-viewer] PDF rendering failed:', error);
      if (gen !== this._renderGeneration) return;
      this._error = this._t.renderError;
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
      return html`<div class="status error">${this._error}</div>`;
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
