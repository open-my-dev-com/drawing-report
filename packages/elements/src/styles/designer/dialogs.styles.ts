/**
 * `<slip-designer>` 스타일 — 메뉴와 모달.
 *
 * @remarks
 * 툴바 메뉴, 리스트형 선택 목록과 모달 화면.
 * 규칙 순서는 원래 한 파일이던 때와 같습니다 — 순서를 바꾸면 cascade가 달라집니다.
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
      /* 툴바 안에 렌더되므로.toolbar button의 아이콘 버튼 크기 규칙을 되돌립니다 */
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
    /* 이미지 선택 — 경로가 base64라 읽을 수 없으므로 이미지 자체를 표시합니다 */
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
    /* 파라미터 칩의 값 종류 — 값을 선택하기 전에 표시합니다  */
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
    /* 목록 파라미터 뒤에 점을 입력했을 때 표시하는 하위 필드 제안 목록 */
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
    .fn-row {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      padding: 7px 8px;
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
      font-size: 12px;
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

    /* 행 구간 표식 색 — 캔버스와 속성 패널에서 같은 색을 사용합니다 (§7.2) */
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

    /* 수식 모달 — 편집과 참조를 나란히 두어 참조를 보면서 수식을 고칠 수 있게 합니다 */
    .modal.formula-modal {
      width: min(960px, calc(100vw - 48px));
      /* 함수를 골라도 높이가 달라지지 않도록 본문 높이를 고정합니다 */
      height: min(560px, calc(100vh - 48px));
      max-height: calc(100vh - 48px);
    }
    .formula-layout {
      display: grid;
      /* 목록과 설명이 있는 참조 영역을 넓게 둡니다. */
      grid-template-columns: minmax(0, 42fr) minmax(0, 58fr);
      gap: 0;
      /* 본문이 늘어나도 헤더와 하단 버튼이 밀려나지 않도록 축소를 허용합니다 */
      min-height: 0;
      flex: 1;
    }
    .formula-editor,
    .formula-reference {
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: 20px;
    }
    .formula-editor {
      gap: 8px;
      overflow-y: auto;
    }
    .formula-reference {
      border-left: 1px solid var(--sk-border);
    }
    .formula-tabpanel {
      min-height: 0;
      flex: 1;
      /* 함수 탭은 안에서 스크롤하고, 값 탭은 길어지면 이 자리가 스크롤합니다 */
      overflow-y: auto;
    }
    .formula-target {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 6px;
      font-size: 11px;
    }
    .formula-target-label {
      color: var(--sk-text-muted);
    }
    .formula-target-name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    /* 수식 작성이 이 모달의 주 작업이므로 입력란을 가장 크게 둡니다 */
    .formula-modal .formula-input {
      /* 수식 입력란은 220px로 표시하며, 사용자가 세로로 줄이면 140px까지 허용합니다. */
      height: 220px;
      min-height: 140px;
      max-height: 220px;
      font-size: 13px;
    }
    /* 검사 결과 — 상태 제목이 뜻을 설명하고 그 아래에 결과나 까닭을 적습니다 */
    .formula-status {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 48px;
      padding: 8px 10px;
      border-left: 3px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      font-size: 12px;
    }
    .formula-status-title {
      font-size: 12.5px;
      font-weight: 600;
    }
    .formula-status-text {
      overflow-wrap: anywhere;
    }
    .formula-status.ok {
      border-left-color: var(--sk-accent);
      background: var(--sk-accent-soft);
      color: inherit;
    }
    .formula-status.ok .formula-status-text {
      font-size: 13px;
    }
    .formula-status.notice {
      background: var(--sk-surface-alt, rgba(0, 0, 0, 0.04));
      color: var(--sk-text-muted);
    }
    .formula-status.notice .formula-status-title {
      color: inherit;
    }
    .formula-status.error {
      border-left-color: var(--sk-danger);
      background: rgba(194, 65, 12, 0.08);
      color: var(--sk-danger);
    }
    /* 모달 안 탭 — 샘플 데이터 모달과 수식 모달이 같은 모양을 씁니다 */
    .modal-tabs {
      display: inline-flex;
      /* 세로 배치 안에서도 탭 묶음이 내용만큼만 넓어지게 합니다 */
      align-self: flex-start;
      gap: 2px;
      margin-bottom: 8px;
      padding: 2px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
    }
    .modal-tabs button {
      padding: 4px 12px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      font-family: inherit;
      font-size: 13px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .modal-tabs button[aria-selected='true'] {
      background: var(--sk-surface);
      border-color: var(--sk-border-strong);
      color: var(--sk-text);
    }
    .modal-tabs button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    /* 값과 범위 — 코드 이름만으로는 뜻을 알 수 없어 표시 이름을 앞에 둡니다 */
    .value-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 4px;
    }
    .value-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      width: 100%;
      padding: 7px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      font-family: inherit;
      font-size: 12px;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .value-row:hover:not(:disabled) {
      background: var(--sk-accent-soft);
    }
    .value-row:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .value-row:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .value-name {
      font-size: 12.5px;
    }
    .value-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11.5px;
      color: var(--sk-text-muted);
    }
    .value-reason {
      margin-left: auto;
      color: var(--sk-text-muted);
    }
    .formula-items {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      font-size: 11px;
    }
    .formula-item-no {
      width: 4.5em;
      padding: 3px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: inherit;
    }
    .formula-item-total {
      color: var(--sk-text-muted);
    }
    .formula-item-where {
      margin-left: 4px;
      color: var(--sk-text-muted);
    }
    .formula-search {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 13px;
      color: inherit;
    }
    .formula-search:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .fn-categories {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 6px 0;
    }
    .fn-chip {
      padding: 2px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 999px;
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: inherit;
      cursor: pointer;
    }
    .fn-chip:hover,
    .fn-chip.selected {
      border-color: var(--sk-accent);
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    /* 함수 탭 — 목록만 스크롤하고 검색과 상세는 자리를 지킵니다 */
    .fn-panel {
      display: grid;
      grid-template-columns: minmax(0, 44fr) minmax(0, 56fr);
      gap: 14px;
      min-height: 0;
      height: 100%;
    }
    .fn-browse {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .fn-list {
      min-height: 0;
      flex: 1;
      overflow-y: auto;
    }
    .fn-row.selected {
      /* hover와 같은 배경만으로는 상세에 연결된 항목이 어느 것인지 남지 않습니다 */
      background: var(--sk-accent-soft);
      box-shadow: inset 2px 0 var(--sk-accent);
      color: var(--sk-accent);
    }
    .fn-detail {
      min-height: 0;
      padding: 10px 12px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      overflow-y: auto;
    }
    .fn-detail-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      font-weight: 600;
    }
    .fn-insert {
      margin-top: 10px;
    }
    .fn-detail-title {
      margin: 8px 0 2px;
      font-size: 11px;
      font-weight: 600;
      color: var(--sk-text-muted);
    }
    .fn-args {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 2px 10px;
      margin: 0;
      font-size: 11px;
    }
    .fn-args dt {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .fn-args dd {
      margin: 0;
      color: var(--sk-text-muted);
    }
    .fn-optional {
      margin-left: 4px;
      font-family: inherit;
      color: var(--sk-text-muted);
    }
    .parameter-chip:disabled {
      opacity: 0.45;
      cursor: default;
    }
`;
