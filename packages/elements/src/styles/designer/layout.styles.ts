/**
 * `<slip-designer>` 스타일 — 레이아웃과 툴바.
 *
 * @remarks
 * 호스트 레이아웃, 디자인 토큰과 상단 툴바.
 * 규칙 순서는 원래 한 파일이던 때와 같다 — 순서를 바꾸면 cascade가 달라진다.
 */
import { css } from 'lit';

export const layoutStyles = css`
    :host {
      /* 컴포넌트 디자인 토큰  */
      --sk-bg: #f6f7f8;
      --sk-surface: #ffffff;
      --sk-canvas-bg: #e2e4e7;
      --sk-border: #d8dadf;
      --sk-border-strong: #c4c7cd;
      --sk-text: #2e3238;
      --sk-text-muted: #798088;
      --sk-accent: #1a73e8;
      --sk-accent-soft: #e7f0fd;
      --sk-guide: #e91e63;
      /* 테두리가 없는 요소의 영역을 표시하는 캔버스 안내선 */
      --sk-guide-faint: rgba(0, 0, 0, 0.15);
      --sk-danger: #c62828;
      --sk-radius: 4px;

      display: grid;
      grid-template-rows: auto 1fr;
      grid-template-columns: 176px 1fr 300px;
      height: 100%;
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

    .toolbar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-bottom: 1px solid var(--sk-border);
      background: var(--sk-bg);
      overflow-x: auto;
    }
    .tool-group {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
    }
    .toolbar button {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 44px;
      height: 44px;
      padding: 4px 5px 3px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      color: var(--sk-text);
      font-family: inherit;
    }
    .toolbar button svg {
      width: 16px;
      height: 16px;
    }
    .toolbar .btn-label {
      font-size: 10px;
      line-height: 1;
      white-space: nowrap;
      color: var(--sk-text-muted);
    }
    .toolbar button:hover:not(:disabled) .btn-label,
    .toolbar button[aria-pressed='true'] .btn-label {
      color: inherit;
    }
    .toolbar button:hover:not(:disabled) {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .toolbar button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .toolbar button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .toolbar button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .toolbar .page-indicator {
      min-width: 40px;
      text-align: center;
      font-size: 12px;
      color: var(--sk-text-muted);
    }

    .sidebar {
      grid-row: 2;
      grid-column: 1;
      border-right: 1px solid var(--sk-border);
      background: var(--sk-bg);
      overflow-y: auto;
      overflow-x: hidden;
      padding: 10px;
    }
`;
