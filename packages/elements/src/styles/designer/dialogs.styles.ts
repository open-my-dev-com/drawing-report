/**
 * `<slip-designer>` 스타일 — 메뉴와 모달.
 *
 * @remarks
 * 툴바 메뉴, 리스트형 선택 목록과 모달 화면.
 * 규칙 순서는 원래 한 파일이던 때와 같다 — 순서를 바꾸면 cascade가 달라진다.
 */
import { css } from 'lit';

export const dialogsStyles = css`
    .menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
    }
    .preset-menu {
      position: fixed;
      z-index: 41;
      display: flex;
      flex-direction: column;
      min-width: 140px;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .preset-menu button {
      /* 툴바 안에 렌더되므로.toolbar button의 아이콘 버튼 크기 규칙을 되돌린다 */
      display: block;
      min-width: 0;
      height: auto;
      padding: 6px 10px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      text-align: left;
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      cursor: pointer;
    }
    .preset-menu button:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .preset-menu button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }

    /* 모달 — 편집 항목이 많은 기능은 패널 대신 모달로 (편집 UI 배치 원칙) */
    .modal-backdrop {
      background: rgba(0, 0, 0, 0.35);
      z-index: 50;
    }
    .modal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, calc(100vw - 32px));
      max-height: min(680px, calc(100vh - 48px));
      display: flex;
      flex-direction: column;
      z-index: 51;
      background: var(--sk-surface);
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--sk-border);
      font-size: 13px;
      font-weight: 600;
    }
    .modal-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .modal-close:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .modal-close svg {
      width: 14px;
      height: 14px;
    }
    .modal-body {
      padding: 12px 14px;
      overflow-y: auto;
    }
    .modal-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--sk-border);
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
    .formula-input {
      width: 100%;
      resize: vertical;
      padding: 6px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: inherit;
    }
    .formula-input:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .formula-status {
      min-height: 18px;
      margin: 4px 0 6px;
      font-size: 11px;
      color: var(--sk-text-muted);
      overflow-wrap: break-word;
    }
    .formula-status.error {
      color: var(--sk-danger);
    }
    .modal-section-title {
      margin: 10px 0 4px;
      font-size: 11px;
      font-weight: 600;
      color: var(--sk-text-muted);
    }
    /* 이미지 선택  — 경로는 base64라 못 읽으니 이미지 자체를 보여준다 */
    .image-hint {
      margin: 6px 0;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .image-error {
      margin: 6px 0;
      font-size: 11px;
      color: var(--sk-danger, #c0392b);
    }
    .image-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 6px;
    }
    .image-choice {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 72px;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
      cursor: pointer;
    }
    .image-choice.selected {
      border-color: var(--sk-accent);
      box-shadow: 0 0 0 1px var(--sk-accent);
    }
    .image-choice img,
    .image-current img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .image-current {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 104px;
      margin-bottom: 8px;
      padding: 6px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
    }
    /* 샘플 데이터 모달의 변동 이미지 입력  */
    .sample-image {
      align-items: flex-start;
    }
    .sample-image-body {
      flex: 1;
      min-width: 0;
    }
    .sample-image-btns {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .parameter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    /* 파라미터 칩의 값 종류 — 무엇을 넣는지 고르기 전에 보이게 한다  */
    .chip-type {
      margin-left: 4px;
      opacity: 0.6;
      font-size: 10px;
    }
    .parameter-chip {
      padding: 3px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 10px;
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: inherit;
      cursor: pointer;
    }
    .parameter-chip:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    /* 표 파라미터의 하위 열 칩 — 상위 값과 구분되게 옅게  */
    .parameter-chip.column {
      border-style: dashed;
      color: var(--sk-text-muted);
    }
    /* 수식 규칙 안내 한 줄  */
    .formula-hint {
      margin-top: 6px;
      font-size: 11px;
      color: var(--sk-text-muted);
      line-height: 1.5;
    }
    /* 표 파라미터 뒤에 점을 찍었을 때 뜨는 열 제안 줄  */
    .formula-suggest {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding: 6px 8px;
      border: 1px solid var(--sk-accent);
      border-radius: var(--sk-radius);
      background: var(--sk-accent-soft);
    }
    .formula-suggest-label {
      font-size: 11px;
      color: var(--sk-accent);
    }
    .formula-suggest .parameter-chip {
      border-style: solid;
      color: inherit;
    }
    .fn-category {
      margin: 8px 0 2px;
      font-size: 11px;
      font-weight: 600;
    }
    .fn-row {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      width: 100%;
      padding: 4px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      font-family: inherit;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .fn-row:hover {
      background: var(--sk-accent-soft);
    }
    .fn-row:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .fn-signature {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11.5px;
    }
    .fn-desc {
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .row-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .row-btn:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .row-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .row-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .row-btn svg {
      width: 14px;
      height: 14px;
    }
    .col-modal-head {
      display: grid;
      grid-template-columns: 46px 1fr 1fr 56px 24px;
      gap: 4px;
      font-size: 10px;
      color: var(--sk-text-muted);
      margin-bottom: 2px;
    }
    .col-modal-row {
      display: grid;
      grid-template-columns: 46px 1fr 1fr 56px 24px;
      gap: 4px;
      align-items: center;
      margin: 2px 0;
    }
    .col-modal-row input {
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
    .col-order {
      display: inline-flex;
      gap: 2px;
    }
    .col-order button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .col-order button:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .col-order button:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .col-order button svg {
      width: 12px;
      height: 12px;
    }

    /* 내 양식 목록 행  */
    .form-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 2px 0;
    }
    .form-open {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .form-open:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .form-open:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .form-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .form-date {
      flex: none;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .save-as-new {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 8px 0 0 74px;
      font-size: 12px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }

    .saved-notice {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      font-size: 11px;
      white-space: nowrap;
    }

    .preview-area {
      grid-column: 1 / -1;
    }
    .preview-area iframe {
      width: 100%;
      height: 100%;
      border: none;
    }

    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      font-size: 14px;
    }
    .empty-state.error {
      color: #c00;
    }
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
    }

    /* 행 구간 표식 색 — 캔버스와 속성 패널에서 같은 색을 쓴다 (§7.2) */
    .placement-before-data { --sk-band: #8d6e63; }
    .placement-page-start { --sk-band: #1a73e8; }
    .placement-group-start { --sk-band: #188038; }
    .placement-item { --sk-band: #f9ab00; }
    .placement-group-end { --sk-band: #009688; }
    .placement-after-data { --sk-band: #9334e6; }
    .placement-page-end { --sk-band: #d93025; }

    /* 선택한 반복 그리드의 행 구간 배경 표식 */
    .element .grid-preview .band-tint {
      pointer-events: none;
      padding: 0;
      border: none;
      background: color-mix(in srgb, var(--sk-band, transparent) 10%, transparent);
    }

    /* 그리드 왼쪽의 행 번호 선택 영역 */
    .element .band-strip {
      position: absolute;
      top: 0;
      bottom: 0;
      right: 100%;
      width: 18px;
      display: grid;
      z-index: 3;
      pointer-events: auto;
    }
    .element .band-strip .band-row {
      box-sizing: border-box;
      border: 1px solid var(--sk-border, #ccc);
      border-left-width: 4px;
      border-left-color: var(--sk-band, #ccc);
      background: var(--sk-panel-bg, #fff);
      color: var(--sk-text-muted, #666);
      font-size: 9px;
      padding: 0;
      cursor: pointer;
      overflow: hidden;
      pointer-events: auto;
    }
    .element .band-strip .band-row.selected {
      background: var(--sk-accent);
      color: #fff;
    }

    /* 행 구간 역할 명령 메뉴 */
    .element .band-menu {
      position: absolute;
      left: 22px;
      z-index: 4;
      width: min(240px, calc(100vw - 24px));
      display: flex;
      flex-direction: column;
      background: var(--sk-panel-bg, #fff);
      border: 1px solid var(--sk-border, #ccc);
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
      padding: 4px;
      pointer-events: auto;
    }
    .element .band-menu .band-menu-title {
      font-size: 11px;
      color: var(--sk-text-muted, #666);
      padding: 4px 6px;
    }
    .element .band-menu .band-menu-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      border: none;
      background: none;
      text-align: left;
      font-size: 12px;
      padding: 5px 6px;
      border-radius: 4px;
      cursor: pointer;
      pointer-events: auto;
    }
    .element .band-menu .band-menu-item::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: var(--sk-band, transparent);
      flex: 0 0 auto;
      margin-top: 4px;
    }
    .element .band-menu .band-menu-item:hover {
      background: var(--sk-hover, #f2f2f2);
    }
    .element .band-menu .band-menu-item:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -2px;
      background: var(--sk-accent-soft);
    }
    .element .band-menu .band-menu-icon {
      display: inline-flex;
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      margin-top: 1px;
    }
    .element .band-menu .band-menu-icon svg {
      width: 14px;
      height: 14px;
    }
    .element .band-menu .band-menu-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 1px;
    }
    .element .band-menu .band-menu-label {
      line-height: 16px;
    }
    .element .band-menu .band-menu-description {
      color: var(--sk-text-muted);
      font-size: 11px;
      line-height: 15px;
    }

    .prop-subsection-title {
      margin: 2px 0 8px;
      color: var(--sk-text-muted);
      font-size: 11px;
      font-weight: 600;
      line-height: 16px;
    }
`;
