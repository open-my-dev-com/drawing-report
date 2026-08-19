import { LitElement, css, html, nothing } from 'lit';
import {
  parseSlipFile,
  renderSlipToPdf,
  type RenderOptions,
  type SlipFile,
} from '@omdc-slipkit/core';
import { strings } from './strings.js';

/**
 * <slip-viewer> — .slip 파일(양식/전표) PDF 미리보기 컴포넌트.
 *
 * 미리보기는 PDF 변환 결과를 그대로 표시한다 — 화면과 PDF가 어긋나는 것이
 * 구조적으로 불가능 (ADR-012/016).
 */
export class SlipViewer extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      min-height: 200px;
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
    fonts: { attribute: false },
    _pdfUrl: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  /** .slip JSON 문자열 */
  src = '';

  /** PDF 렌더링에 사용할 폰트 (JS 프로퍼티 전용) */
  fonts?: RenderOptions['fonts'];

  private _pdfUrl: string | null = null;
  private _error: string | null = null;
  private _loading = false;
  private _renderGeneration = 0;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._revokePdfUrl();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src') || changed.has('fonts')) {
      void this._renderPdf();
    }
  }

  private _revokePdfUrl(): void {
    // 진행 중인 렌더도 무효화한다 — 분리·소스 교체 후 완료되는 렌더가
    // 회수할 수 없는 blob URL을 만드는 것을 막는다
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
      file = parseSlipFile(this.src);
    } catch (error) {
      console.error('[slip-viewer] .slip 파싱 실패:', error);
      this._loading = false;
      this._error = strings.viewer.parseError;
      return;
    }

    try {
      const opts: RenderOptions = {};
      if (this.fonts) opts.fonts = this.fonts;
      const pdfBytes = await renderSlipToPdf(file, opts);
      if (gen !== this._renderGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._pdfUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-viewer] PDF 렌더링 실패:', error);
      if (gen !== this._renderGeneration) return;
      this._error = strings.viewer.renderError;
    } finally {
      if (gen === this._renderGeneration) {
        this._loading = false;
      }
    }
  }

  override render() {
    if (!this.src && !this._loading && !this._error) {
      return html`<div class="status">${strings.viewer.noFile}</div>`;
    }
    if (this._loading) {
      return html`<div class="status">${strings.viewer.loading}</div>`;
    }
    if (this._error) {
      return html`<div class="status error">${this._error}</div>`;
    }
    if (this._pdfUrl) {
      return html`<iframe src=${this._pdfUrl} title=${strings.viewer.pdfTitle}></iframe>`;
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
