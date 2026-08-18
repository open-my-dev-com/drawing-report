import { LitElement, css, html } from 'lit';
import { parseSlipFile, type SlipFile } from '@slipkit/core';

/**
 * <slip-viewer> — .slip 파일(양식/전표) 조회 컴포넌트 골격.
 * 실제 렌더링은 feat/elements-viewer에서 구현한다.
 */
export class SlipViewer extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: sans-serif;
    }
  `;

  static properties = {
    src: { type: String },
  };

  /** .slip JSON 문자열 */
  src = '';

  private get file(): SlipFile | null {
    if (!this.src) return null;
    try {
      return parseSlipFile(this.src);
    } catch {
      return null;
    }
  }

  render() {
    const file = this.file;
    if (!file) return html`<p>표시할 .slip 파일이 없습니다.</p>`;
    const title =
      file.kind === 'template' ? file.template.meta.title : file.templateSnapshot.meta.title;
    return html`<p>[${file.kind}] ${title} — 렌더러 구현 예정</p>`;
  }
}

customElements.define('slip-viewer', SlipViewer);

declare global {
  interface HTMLElementTagNameMap {
    'slip-viewer': SlipViewer;
  }
}
