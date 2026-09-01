/**
 * `<slip-designer>` 스타일 — 그리드 행 편집.
 *
 * @remarks
 * 행 추가 명령, 행 구간 목록과 출력 페이지 이동.
 * 규칙 순서는 원래 한 파일이던 때와 같습니다 — 순서를 바꾸면 cascade가 달라집니다.
 */
import { css } from 'lit';

export const gridStyles = css`
    .grid-command-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 8px;
    }
    .grid-command-list button {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      min-width: 0;
      min-height: 36px;
      padding: 6px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text);
      font: inherit;
      font-size: 12px;
      line-height: 15px;
      text-align: left;
      cursor: pointer;
    }
    .grid-command-list button:hover,
    .grid-command-list button.selected {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .grid-command-list button.selected {
      background: var(--sk-accent-soft);
    }
    .grid-command-list button > span:first-child {
      display: inline-flex;
      flex: 0 0 14px;
      width: 14px;
      height: 14px;
    }
    .grid-command-list button svg {
      width: 14px;
      height: 14px;
    }
    .grid-command-editor {
      margin: 10px 0 12px;
      padding: 2px 0 2px 10px;
      border-left: 2px solid var(--sk-accent);
    }
    .grid-command-requirement {
      margin: 0 0 8px;
      color: var(--sk-danger);
      font-size: 11px;
      line-height: 16px;
    }
    .grid-command-preview {
      display: grid;
      gap: 5px;
      margin: 2px 0 10px;
    }
    .grid-command-preview-title {
      margin: 2px 0 6px;
      color: var(--sk-text);
      font-size: 11px;
      font-weight: 600;
      line-height: 16px;
    }
    .grid-command-preview > div {
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      font-size: 11px;
      line-height: 16px;
    }
    .grid-command-preview span {
      color: var(--sk-text-muted);
    }
    .grid-command-preview strong {
      min-width: 0;
      color: var(--sk-text);
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .grid-command-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }
    .grid-command-actions button {
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .grid-command-actions button.primary {
      border-color: var(--sk-accent);
      background: var(--sk-accent);
      color: #fff;
    }
    .grid-command-actions button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .band-manual-title {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--sk-border);
    }

    /* 속성 패널의 행 구간 목록 */
    .band-list .band-item {
      border-top: 1px solid var(--sk-border);
    }
    .band-list .band-item-main {
      display: grid;
      grid-template-columns: 10px 16px minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      width: 100%;
      min-height: 36px;
      padding: 5px 4px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--sk-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .band-list .band-item-main:hover {
      background: var(--sk-hover);
    }
    .band-list .band-item.selected .band-item-main {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .band-list .band-item.layout-error .band-item-main {
      box-shadow: inset 3px 0 0 var(--sk-danger);
      background: color-mix(in srgb, var(--sk-danger) 7%, transparent);
    }
    .band-plan-error {
      margin: 0 4px 7px 32px;
      color: var(--sk-danger);
      font-size: 11px;
      line-height: 16px;
      overflow-wrap: anywhere;
    }
    .band-list .band-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--sk-band, #ccc);
      flex: 0 0 auto;
    }
    .band-list .band-icon {
      display: inline-flex;
      width: 16px;
      height: 16px;
    }
    .band-list .band-icon svg {
      width: 16px;
      height: 16px;
    }
    .band-list .band-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .band-list .band-range {
      color: var(--sk-text-muted, #666);
      font-size: 11px;
      white-space: nowrap;
    }
    .band-list .band-option-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      margin: 0 4px 6px 32px;
      color: var(--sk-text-muted);
      font-size: 11px;
    }
    .band-list .band-option-row > span:first-child {
      flex: 0 0 64px;
    }
    .band-list .band-option-row .list-select {
      width: 0;
    }
    .band-list .band-repeat-toggle {
      cursor: pointer;
    }
    .band-list .band-repeat-toggle input {
      margin-left: auto;
      order: 2;
    }
    .band-editor {
      margin-top: 10px;
      padding: 10px 0 2px 10px;
      border-left: 2px solid var(--sk-accent);
    }

    /* 페이지 방식 세그먼트 선택 */
    .segment {
      display: inline-flex;
      border: 1px solid var(--sk-border, #ccc);
      border-radius: 6px;
      overflow: hidden;
    }
    .segment button {
      border: none;
      background: none;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .segment button.active {
      background: var(--sk-accent);
      color: #fff;
    }

    .advanced-settings {
      margin-top: 10px;
      border-top: 1px solid var(--sk-border);
    }
    .advanced-settings summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 34px;
      color: var(--sk-text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      list-style: none;
    }
    .advanced-settings summary::-webkit-details-marker {
      display: none;
    }
    .advanced-settings summary svg {
      width: 14px;
      height: 14px;
      color: var(--sk-text-muted);
      transition: transform 120ms ease;
    }
    .advanced-settings[open] summary svg {
      transform: rotate(180deg);
    }
    .advanced-settings-body {
      padding: 4px 0 2px;
    }
    .field-check-list {
      display: grid;
      gap: 2px;
      border: 1px solid var(--sk-border);
      background: var(--sk-surface);
    }
    .field-check {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      padding: 4px 7px;
      color: var(--sk-text);
      font-size: 12px;
      cursor: pointer;
    }
    .field-check:hover {
      background: var(--sk-hover);
    }
    .field-check input[type='checkbox'] {
      appearance: auto;
      -webkit-appearance: checkbox;
      width: 15px;
      height: 15px;
      min-height: 15px;
      margin: 0;
      border: initial;
      border-radius: 0;
      background: initial;
      accent-color: var(--sk-accent);
    }
    .field-check span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .field-check-empty {
      padding: 7px;
      color: var(--sk-text-muted);
      font-size: 12px;
    }

    /* 출력 페이지 전환 막대 */
    .output-page-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 42px;
      padding: 6px 10px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      color: var(--sk-text-muted, #666);
    }
    .output-preview-toggle,
    .output-page-nav {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .output-preview-toggle {
      gap: 5px;
      min-height: 30px;
      padding: 4px 9px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text);
      font: inherit;
      cursor: pointer;
    }
    .output-preview-toggle[aria-pressed='true'] {
      border-color: var(--sk-accent);
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .output-preview-toggle svg {
      width: 14px;
      height: 14px;
    }
    .output-preview-toggle:focus-visible,
    .output-page-nav button:focus-visible,
    .plan-error button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .output-page-nav {
      gap: 6px;
    }
    .output-page-status {
      min-width: 112px;
      text-align: center;
    }

    /* 자동 확장 흐름 영역 하단 안내선 */
    .flow-guide {
      position: absolute;
      left: 0;
      right: 0;
      border-top: 1px dashed var(--sk-accent);
      pointer-events: none;
      z-index: 2;
    }
    .flow-guide span {
      position: absolute;
      right: 4px;
      bottom: 2px;
      padding: 1px 4px;
      background: color-mix(in srgb, #fff 88%, transparent);
      color: var(--sk-accent);
      font-size: 9px;
      line-height: 13px;
    }

    .element.layout-error {
      outline: 2px solid var(--sk-danger);
      outline-offset: 2px;
    }

    /* 페이지 계획 오류 안내 */
    .plan-error {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0;
      padding: 6px 10px;
      border-radius: 6px;
      background: #fdecea;
      color: #c5221f;
      font-size: 12px;
    }
    .plan-error span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .plan-error button {
      flex: none;
      min-height: 28px;
      padding: 4px 8px;
      border: 1px solid currentColor;
      border-radius: var(--sk-radius);
      background: #fff;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    @media (max-width: 960px) {
      :host {
        grid-template-columns: 156px minmax(0, 1fr) 280px;
      }
      .sidebar {
        padding-inline: 8px;
      }
      .canvas-area {
        padding: 16px;
      }
      .prop-panel {
        padding-inline: 10px;
      }
      .type-name {
        margin-inline: -10px;
        padding-inline: 10px;
      }
    }
`;
