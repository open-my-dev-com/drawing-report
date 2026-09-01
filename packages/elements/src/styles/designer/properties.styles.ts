/**
 * `<slip-designer>` 스타일 — 속성 패널.
 *
 * @remarks
 * 공통 입력, 색·테두리 선택과 셀 편집.
 * 규칙 순서는 원래 한 파일이던 때와 같습니다 — 순서를 바꾸면 cascade가 달라집니다.
 */
import { css } from 'lit';

export const propertiesStyles = css`
    .prop-panel {
      grid-row: 2;
      grid-column: 3;
      border-left: 1px solid var(--sk-border);
      padding: 0 14px 20px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
      background: #fafbfc;
    }
    .prop-section {
      margin: 0;
      padding: 14px 0;
      border-bottom: 1px solid var(--sk-border);
    }
    .prop-section:last-child {
      border-bottom: none;
    }
    .prop-section-title {
      margin: 0 0 10px;
      font-size: 12px;
      font-weight: 600;
      line-height: 18px;
      color: var(--sk-text);
    }
    .type-name {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      margin: 0 -14px;
      padding: 12px 14px 11px;
      border-bottom: 1px solid var(--sk-border);
      background: rgba(250, 251, 252, 0.96);
      font-size: 13px;
      font-weight: 700;
      line-height: 20px;
      color: var(--sk-text);
      backdrop-filter: blur(4px);
    }
    .group-actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
      gap: 8px;
      margin: 0;
    }
    .group-actions .btn {
      min-height: 32px;
      padding-inline: 10px;
    }
    .prop-row {
      display: flex;
      align-items: center;
      min-height: 32px;
      margin: 0 0 8px;
      gap: 8px;
    }
    .prop-row:last-child {
      margin-bottom: 0;
    }
    .prop-row label {
      width: 72px;
      flex: none;
      font-size: 12px;
      line-height: 16px;
      word-break: keep-all;
      overflow-wrap: anywhere;
      color: var(--sk-text-muted);
    }
    .prop-row.stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
    .prop-row.stacked label {
      width: auto;
    }
    .prop-row.stacked input:not([type='checkbox']),
    .prop-row.stacked textarea,
    .prop-row.stacked .list-select {
      flex: none;
      width: 100%;
    }
    /* 네이티브 select를 대신하는 리스트형 선택 상자 */
    .list-select {
      flex: 1;
      min-width: 0;
      width: 0;
      min-height: 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .list-select:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .list-select .list-select-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .list-select .list-select-caret {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 14px;
      height: 14px;
      color: var(--sk-text-muted);
    }
    .list-select .list-select-caret svg {
      width: 14px;
      height: 14px;
    }
    .prop-row.stacked .list-select {
      width: 100%;
    }
    .list-select-menu {
      overflow-y: auto;
    }
    .list-select-menu button[aria-selected='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      font-weight: 600;
    }
    .list-select-menu button.described {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      white-space: normal;
    }
    .list-select-option-label {
      display: block;
    }
    .list-select-option-description {
      display: block;
      color: var(--sk-text-muted);
      font-size: 11px;
      font-weight: 400;
      line-height: 15px;
    }
    .prop-row input,
    .prop-row textarea {
      flex: 1;
      min-width: 0;
      width: 0;
      min-height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .prop-row input[type='checkbox'] {
      appearance: none;
      -webkit-appearance: none;
      flex: none;
      width: 32px;
      min-height: 0;
      height: 18px;
      margin: 0 0 0 auto;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 9px;
      background:
        radial-gradient(circle at 8px 50%, #fff 0 5px, transparent 5.5px),
        #aeb4bc;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .prop-row input[type='checkbox']:checked {
      border-color: var(--sk-accent);
      background:
        radial-gradient(circle at 23px 50%, #fff 0 5px, transparent 5.5px),
        var(--sk-accent);
    }
    .prop-row input:focus-visible,
    .prop-row textarea:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .prop-row textarea {
      min-height: 76px;
      resize: vertical;
    }
    .prop-pair {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 0 0 10px;
    }
    .prop-pair:last-child {
      margin-bottom: 0;
    }
    .prop-pair .prop-row {
      flex-direction: column;
      align-items: stretch;
      min-width: 0;
      margin: 0;
      gap: 5px;
    }
    .prop-pair .prop-row label {
      width: auto;
      min-height: 16px;
    }
    .prop-pair .prop-row input,
    .prop-pair .prop-row .list-select {
      flex: none;
      width: 100%;
    }

    .toggle-group {
      display: inline-flex;
      min-width: 0;
      gap: 0;
    }
    .toggle-group button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 0;
      background: var(--sk-surface);
      color: var(--sk-text);
      cursor: pointer;
    }
    .toggle-group button + button {
      margin-left: -1px;
    }
    .toggle-group button:first-child {
      border-radius: var(--sk-radius) 0 0 var(--sk-radius);
    }
    .toggle-group button:last-child {
      border-radius: 0 var(--sk-radius) var(--sk-radius) 0;
    }
    .toggle-group button:only-child {
      border-radius: var(--sk-radius);
    }
    .toggle-group button svg {
      width: 14px;
      height: 14px;
    }
    .toggle-group.text button {
      width: auto;
      min-width: 54px;
      height: 32px;
      padding: 0 12px;
      font-family: inherit;
      font-size: 12px;
      white-space: nowrap;
    }
    .prop-row > .toggle-group.text {
      flex: 1;
    }
    .prop-row > .toggle-group.text button {
      flex: 1;
    }
    .toggle-group button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    /* 조건부 서식 강조의 '해제' 상태 — 기본 서식의 강조를 끄는 규칙을 사선으로 표시합니다 */
    .toggle-group button[aria-pressed='mixed'] {
      position: relative;
      background: var(--sk-accent-soft);
      color: var(--sk-text);
      border-color: var(--sk-accent);
    }
    .toggle-group button[aria-pressed='mixed']::after {
      content: '';
      position: absolute;
      left: 6px;
      right: 6px;
      top: 50%;
      border-top: 1.5px solid var(--sk-accent);
      transform: rotate(-18deg);
    }
    .anchor-grid {
      display: grid;
      grid-template-columns: repeat(3, 16px);
      gap: 4px;
    }
    .anchor-dot {
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 3px;
      background: var(--sk-surface);
      cursor: pointer;
    }
    .anchor-dot[aria-pressed='true'] {
      background: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .anchor-dot:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }

    .toggle-group button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }

    .color-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .color-btn[aria-expanded='true'] {
      border-color: var(--sk-accent);
    }
    .color-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .color-chip {
      flex: 0 0 16px;
      width: 16px;
      height: 16px;
      border: 1px solid var(--sk-border);
      border-radius: 3px;
    }
    /* 색 미지정 상태 — 검정으로 오해하지 않게 '없음'(사선)으로 표시 */
    .color-chip.none {
      background:
        linear-gradient(to top left, transparent 44%, var(--sk-guide) 45%, var(--sk-guide) 55%, transparent 56%),
        var(--sk-surface);
    }
    .color-value {
      font-size: 11px;
      color: var(--sk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .color-pop {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: -2px 0 12px;
      padding: 10px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    .color-pop-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 52px auto;
      align-items: center;
      gap: 6px;
    }
    .color-pop-row input:not(.alpha-input) {
      min-width: 0;
      width: 100%;
      min-height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .sv-area {
      position: relative;
      height: 104px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      cursor: crosshair;
      touch-action: none;
    }
    .sv-thumb {
      position: absolute;
      width: 10px;
      height: 10px;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .hue-slider {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      height: 14px;
      margin: 0;
      border: 1px solid var(--sk-border);
      border-radius: 7px;
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      cursor: pointer;
    }
    .hue-slider::-webkit-slider-thumb {
      appearance: none;
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .hue-slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .color-extras {
      display: grid;
      grid-template-columns: repeat(auto-fill, 18px);
      align-items: center;
      gap: 6px;
    }
    .swatch {
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 4px;
      cursor: pointer;
    }
    .swatch[aria-pressed='true'] {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .swatch:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .swatch.none {
      background:
        linear-gradient(to top left, transparent 44%, var(--sk-guide) 45%, var(--sk-guide) 55%, transparent 56%),
        var(--sk-surface);
    }
    .swatch-save {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px dashed var(--sk-border-strong);
      border-radius: 4px;
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .swatch-save svg {
      width: 11px;
      height: 11px;
    }
    .swatch-save:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .swatch-save:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .swatch-save:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .alpha-input {
      width: 52px;
      min-height: 32px;
      padding: 5px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
    }
    .alpha-suffix {
      font-size: 11px;
      color: var(--sk-text-muted);
    }

    /* 테두리 굵기 선택 버튼과 미리보기 */
    .width-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .width-btn:hover {
      border-color: var(--sk-accent);
    }
    .width-btn[aria-expanded='true'] {
      border-color: var(--sk-accent);
    }
    .width-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .width-line {
      flex: 1;
      min-width: 24px;
      border-top: 1px solid currentColor;
    }
    /* 테두리 형태 미리보기 */
    .shape-line {
      flex: 1;
      min-width: 24px;
      border-top: 2px solid currentColor;
    }
    .shape-line.shape-dashed {
      border-top-style: dashed;
    }
    .shape-line.shape-dotted {
      border-top-style: dotted;
    }
    /* 지정하지 않아 기본값·상속값이 적용 중인 항목  */
    .dim {
      opacity: 0.55;
    }
    .width-value {
      font-size: 11px;
      color: var(--sk-text-muted);
      white-space: nowrap;
    }
    .preset-menu.width-pop {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      overflow-y: auto;
    }
    .preset-menu.width-pop button {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .preset-menu.width-pop button:hover {
      background: var(--sk-accent-soft);
    }
    .preset-menu.width-pop button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .preset-menu.width-pop button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }

    /* 인라인 편집기는 선택한 셀의 배경과 텍스트 스타일을 상속합니다. */
    .cell-editor {
      position: absolute;
      z-index: 30;
      padding: 1px 3px;
      border: 2px solid var(--sk-accent);
      border-radius: 2px;
      font-family: inherit;
      font-size: 12px;
      color: inherit;
    }
    .grid-preview .cell-selected {
      outline: 2px solid var(--sk-accent);
      outline-offset: -2px;
    }
    .step-inputs {
      flex: 1;
      min-width: 0;
      display: grid;
      grid-template-columns: 32px 40px 32px;
      align-items: center;
      justify-content: flex-start;
      gap: 4px;
    }
    .step-inputs span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    /* 항목 구간 안의 셀임을 알리는 표시 */
    .cell-band {
      margin-left: 6px;
      padding: 0 5px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 500;
      color: var(--sk-accent);
      background: var(--sk-accent-soft);
    }
    .merge-inputs {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .merge-inputs span {
      font-size: 11px;
      color: var(--sk-text-muted);
      flex-shrink: 0;
    }
    .merge-inputs input {
      flex: 1;
      min-width: 0;
      width: 0;
      padding: 3px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }

    .cell-hint {
      font-size: 11px;
      color: var(--sk-text-muted);
      line-height: 1.5;
    }
    /* 폰트 선택 아래의 대체·변형 안내 */
    .font-note {
      display: flex;
      flex-direction: column;
      gap: 1px;
      margin: -2px 0 4px;
      font-size: 11px;
      line-height: 1.5;
      color: var(--sk-text-muted);
    }
    .font-note span:first-child {
      color: var(--sk-danger);
    }
    .cell-hint.error {
      color: var(--sk-danger);
    }
    .col-edit-head {
      display: grid;
      grid-template-columns: 1fr 52px;
      gap: 4px;
      font-size: 10px;
      color: var(--sk-text-muted);
      margin-bottom: 2px;
    }
    .col-edit {
      display: grid;
      grid-template-columns: 1fr 52px;
      gap: 4px;
      margin: 2px 0;
      align-items: center;
    }
    .col-edit input {
      min-width: 0;
      width: 100%;
      padding: 3px 4px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 11px;
      font-family: inherit;
      color: inherit;
    }
    .col-remove {
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
    .col-remove svg {
      width: 12px;
      height: 12px;
    }
    .col-remove:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .col-modal-actions {
      display: flex;
      gap: 6px;
    }
    .col-add,
    .col-modal-open {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      padding: 4px 8px;
      border: 1px dashed var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .prop-panel .col-modal-open {
      justify-content: center;
      width: 100%;
      min-height: 32px;
      margin-top: 0;
      border-style: solid;
      font-size: 12px;
    }
    .col-add:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .col-add svg,
    .col-modal-open svg {
      width: 12px;
      height: 12px;
    }
    .col-add:hover,
    .col-modal-open:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }

`;
