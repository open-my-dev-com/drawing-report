/**
 * `<slip-form>`의 스타일 시트.
 */
import { css } from 'lit';

/** `<slip-form>` 스타일 */
export const formStyles = css`
    :host {
      /* 디자이너와 공유하는 디자인 토큰  */
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

    /* :host의 display보다 hidden 속성을 우선한다. */
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

    /* 이미지 입력 */
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
