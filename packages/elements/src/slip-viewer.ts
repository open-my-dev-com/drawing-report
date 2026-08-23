import { LitElement, css, html, nothing } from 'lit';
import {
  parseSlipFile,
  renderSlipToPdf,
  verifyIntegrity,
  type IntegrityJwk,
  type RenderOptions,
  type SlipFile,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { resolveFonts, type SlipFontProvider } from './settings.js';

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

    /* 호스트가 hidden으로 감출 수 있게 한다 — :host의 display가 기본 규칙을 덮기 때문 */
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
    verificationKey: { attribute: false },
    _pdfUrl: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  /** .slip JSON 문자열 */
  src = '';

  /**
   * UI 언어 ('ko' | 'en' | 'ja') — ADR-028/042.
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /** 렌더 폰트를 공급하는 호스트 인터페이스 (ADR-040, JS 프로퍼티 전용) — 없으면 동봉 기본 */
  settings?: SlipFontProvider;

  /**
   * 발행 전표 무결성 검증에 쓸 공개키 (JWK, JS 프로퍼티 전용, SPEC §8).
   * 발행된 전표는 로드 시 해시를 재계산해 변조를 검사하며, 이 키가 있으면 서명까지 확인한다.
   * 검증에 실패하면 PDF를 그리지 않고 오류를 표시한다(변조된 문서를 그대로 보여주지 않는다).
   */
  verificationKey?: IntegrityJwk;

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
    if (changed.has('src') || changed.has('settings') || changed.has('verificationKey')) {
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
      this._error = this._t.parseError;
      return;
    }

    // 발행된 전표는 렌더 전에 무결성을 검증한다 — 해시 재계산으로 변조를 잡고, 공개키가
    // 있으면 서명까지 확인한다. 실패하면 변조 가능성이 있는 문서를 그리지 않고 오류를 낸다 (SPEC §8).
    if (file.kind === 'voucher' && file.issued) {
      try {
        await verifyIntegrity(file, this.verificationKey);
      } catch (error) {
        console.error('[slip-viewer] 무결성 검증 실패:', error);
        if (gen !== this._renderGeneration) return;
        this._loading = false;
        this._error = this._t.integrityError;
        return;
      }
      if (gen !== this._renderGeneration) return;
    }

    try {
      // 폰트 미공급 시 동봉 Pretendard 자동 사용 (ADR-012/040) — 한글 깨짐 방지
      const opts: RenderOptions = {
        fonts: await resolveFonts(this.settings, this.locale),
      };
      const pdfBytes = await renderSlipToPdf(file, opts);
      if (gen !== this._renderGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._pdfUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-viewer] PDF 렌더링 실패:', error);
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
