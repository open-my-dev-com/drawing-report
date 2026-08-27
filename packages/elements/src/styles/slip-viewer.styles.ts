/**
 * `<slip-viewer>`의 스타일 시트.
 */
import { css } from 'lit';

/** `<slip-viewer>` 스타일 */
export const viewerStyles = css`
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
