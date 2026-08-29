/**
 * `<slip-designer>`의 스타일 시트.
 */
import { css } from 'lit';

/** 캔버스 눈금자의 두께(px). 레이아웃과 눈금 렌더링이 함께 사용한다 */
export const RULER_PX = 18;

/** `<slip-designer>` 스타일 */
export const designerStyles = css`
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
    .side-section {
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--sk-border);
    }
    .side-section:last-child {
      border-bottom: none;
    }
    .side-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--sk-text-muted);
      margin-bottom: 6px;
    }
    /* 페이지 목록은 한 줄로 표시하고 썸네일은 hover 또는 focus 상태에서만 표시한다. */
    .page-row-wrap {
      position: relative;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .page-row-wrap .side-row {
      flex: 1;
      min-width: 0;
    }
    .page-thumb-pop {
      /* 사이드바가 overflow를 자르므로 화면 기준(fixed)으로 띄운다 */
      position: fixed;
      z-index: 30;
      padding: 4px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
      box-shadow: var(--sk-shadow, 0 2px 8px rgba(0, 0, 0, 0.15));
      pointer-events: none;
    }
    .thumb {
      display: block;
      width: 100%;
      padding: 0;
      margin: 0 0 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      text-align: center;
    }
    .thumb:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .thumb.current {
      border-color: var(--sk-accent);
      box-shadow: 0 0 0 1px var(--sk-accent);
    }
    .thumb-paper {
      /* span이 인라인으로 남으면 width·height가 무시돼 축소 상자가 밖으로 흘러나온다 */
      display: block;
      position: relative;
      margin: 4px auto 0;
      background: #fff;
      border: 1px solid var(--sk-border);
      overflow: hidden;
    }
    .thumb-el {
      position: absolute;
      background: var(--sk-accent-soft);
      border: 1px solid var(--sk-border-strong);
    }
    .thumb-label {
      display: block;
      font-size: 11px;
      color: var(--sk-text-muted);
      padding: 2px 0 3px;
    }
    .thumb.current .thumb-label {
      color: var(--sk-accent);
    }
    .side-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 4px 6px;
      margin: 1px 0;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text);
      text-align: left;
    }
    .side-row svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      color: var(--sk-text-muted);
    }
    .side-row span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .side-row:hover {
      background: var(--sk-accent-soft);
    }
    .side-row.selected {
      background: var(--sk-accent-soft);
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .side-row.selected svg {
      color: var(--sk-accent);
    }
    .side-row:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .side-empty {
      font-size: 11px;
      color: var(--sk-text-muted);
      padding: 2px 6px;
    }
    /* 사이드바 파라미터 관리  — 제목 줄의 작은 버튼과 인라인 입력줄 */
    .side-title-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 6px;
    }
    .side-title-row .side-title {
      flex: 1;
      margin-bottom: 0;
    }
    .side-mini {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .side-mini:hover:not(:disabled) {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .side-mini:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .side-mini[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .side-mini svg {
      width: 12px;
      height: 12px;
    }
    .side-mini:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .side-row-wrap {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .side-row-wrap .side-row {
      flex: 1;
      min-width: 0;
    }
    /* 요소 목록의 페이지 묶음 머리 — 현재 페이지만 펼친다  */
    .side-page-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      margin: 4px 0 2px;
      padding: 3px 6px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .side-page-head:hover {
      background: var(--sk-accent-soft);
    }
    .side-page-head.current {
      color: var(--sk-accent);
      font-weight: 600;
    }
    /* 현재 페이지가 선택 대상이 아니어도 이름은 강조한다. */
    .page-row.current {
      font-weight: 600;
    }
    /* 하위 항목이 없는 줄에도 같은 폭을 확보해 목록 이름의 시작 위치를 맞춘다. */
    .side-twisty {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 14px;
      width: 14px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      color: var(--sk-text-muted);
    }
    .side-twisty svg {
      width: 11px;
      height: 11px;
    }
    .side-twisty:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-text);
    }
    /* 펼침 표시가 없는 줄의 빈 자리 — 세 목록의 이름이 같은 자리에서 시작한다 */
    .side-twisty-gap {
      flex: 0 0 14px;
    }
    /* 그리드 값의 반복 구간 필드 — 펼침 표시 아래로 한 단 들여 쓴다  */
    /* 값 목록의 반복 구간 필드 하위 줄(.side-col-row)과 요소 목록의 그리드 셀 하위 줄
       (.side-cell-row, G-44)은 생김새가 같다 */
    .side-col-row,
    .side-cell-row {
      display: flex;
      align-items: center;
      width: calc(100% - 16px);
      margin: 1px 0 1px 16px;
      padding: 3px 6px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      text-align: left;
    }
    .side-col-row svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      margin-right: 4px;
    }
    .side-col-row span,
    .side-cell-row span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .side-col-row:hover,
    .side-cell-row:hover {
      background: var(--sk-accent-soft);
    }
    .side-col-row.selected,
    .side-cell-row.selected {
      background: var(--sk-accent-soft);
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    /* 셀 편집 중 그리드 전체 설정으로 돌아가는 탐색 버튼 */
    .grid-back {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 36px;
      margin: 8px 0 0;
      padding: 6px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      color: var(--sk-text);
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      text-align: left;
    }
    .grid-back:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .grid-back:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .grid-back svg {
      flex: 0 0 14px;
      width: 14px;
      height: 14px;
    }
    .grid-back-label {
      flex: none;
      font-weight: 600;
    }
    .grid-back-name {
      min-width: 0;
      margin-left: auto;
      overflow: hidden;
      color: var(--sk-text-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* 거부된 입력의 원인을 해당 필드 가까이에 표시한다. */
    .input-error {
      margin: 0 0 6px;
      padding: 5px 8px;
      border: 1px solid var(--sk-danger);
      border-radius: var(--sk-radius);
      background: color-mix(in srgb, var(--sk-danger) 8%, transparent);
      font-size: 12px;
      color: var(--sk-danger);
    }
    .input-error.field-error {
      margin: -2px 0 8px 80px;
      padding: 0;
      border: 0;
      background: transparent;
      font-size: 11px;
      line-height: 16px;
    }
    .prop-pair + .input-error.field-error {
      margin-left: 0;
    }
    .prop-pair > .input-error.field-error {
      grid-column: 1 / -1;
      margin: 0;
    }
    .color-pop .input-error.field-error {
      margin: 4px 0 0;
    }
    .prop-row input[aria-invalid='true'],
    .prop-row textarea[aria-invalid='true'],
    .prop-row .list-select[aria-invalid='true'] {
      border-color: var(--sk-danger);
      outline: 1px solid color-mix(in srgb, var(--sk-danger) 22%, transparent);
      outline-offset: -1px;
    }
    .prop-add-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      margin-top: 4px;
      padding: 5px 6px;
      border: 1px dashed var(--sk-border);
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-muted);
    }
    .prop-add-row:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .prop-add-row svg {
      width: 12px;
      height: 12px;
    }
    /* 하위 필드를 더하는 줄 — 하위 줄과 같은 자리에 놓되 목록 항목은 아니다 */
    .side-add-field {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      padding: 3px 6px 3px 18px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      text-align: left;
      color: var(--sk-text-muted);
    }
    .side-add-field:hover {
      color: var(--sk-accent);
    }
    .side-add-field svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      margin-right: 4px;
    }
    .usage-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      height: 32px;
      margin: 0;
      padding: 5px 8px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text);
      text-align: left;
    }
    .usage-row + .usage-row {
      margin-top: 6px;
    }
    .prop-row > .usage-row {
      flex: 1;
      min-width: 0;
      width: 0;
    }
    .usage-row:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .usage-row svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
    }
    .usage-row > span:first-of-type {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .usage-page {
      flex: none;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    /* 샘플 데이터 모달의 행 편집 그리드  — 열이 많으면 가로 스크롤 */
    .modal.modal-wide {
      width: min(760px, calc(100vw - 32px));
    }
    .sample-tabs {
      display: inline-flex;
      gap: 2px;
      margin-bottom: 8px;
      padding: 2px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
    }
    .sample-tabs button {
      padding: 4px 12px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .sample-tabs button[aria-selected='true'] {
      background: var(--sk-surface);
      border-color: var(--sk-border-strong);
      color: var(--sk-text);
    }
    .sample-tabs button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .sample-json {
      width: 100%;
      resize: vertical;
      padding: 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: inherit;
    }
    .sample-json:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .sample-pager {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 4px;
      margin: 6px 0;
    }
    .page-btn {
      min-width: 22px;
      height: 22px;
      padding: 0 5px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .page-btn:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .page-btn[aria-pressed='true'] {
      background: var(--sk-accent);
      border-color: var(--sk-accent);
      color: #fff;
    }
    .page-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .sample-scroll {
      overflow-x: auto;
      margin-bottom: 4px;
    }
    .sample-grid {
      display: grid;
      gap: 4px;
      align-items: center;
      margin-bottom: 4px;
      /* 열이 많으면 그리드 상자를 내용 크기로 키워 스크롤 컨테이너가 끝까지 스크롤되게 한다 */
      width: max-content;
      min-width: 100%;
    }
    .sample-col {
      font-size: 10px;
      color: var(--sk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sample-grid input {
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

    .canvas-area {
      grid-row: 2;
      grid-column: 2;
      overflow: auto;
      background: var(--sk-canvas-bg);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 24px;
    }
    /* 생성 도구 선택 중 — 캔버스 어디를 눌러도 그리기이므로 십자 커서로 알린다 */
    .canvas-area.drawing,
    .canvas-area.drawing .element {
      cursor: crosshair;
    }
    .draw-ghost {
      position: absolute;
      border: 1px dashed var(--sk-accent);
      background: var(--sk-accent-soft);
      opacity: 0.6;
      pointer-events: none;
      z-index: 25;
    }
    /* 눈금자 + 용지 묶음 — 자와 용지가 함께 스크롤돼 눈금이 어긋나지 않는다  */
    .paper-wrap {
      display: grid;
      grid-template-columns: ${RULER_PX}px auto;
      grid-template-rows: ${RULER_PX}px auto;
      flex-shrink: 0;
    }
    .ruler-corner {
      grid-row: 1;
      grid-column: 1;
      background: var(--sk-surface);
      border-right: 1px solid var(--sk-border);
      border-bottom: 1px solid var(--sk-border);
    }
    .ruler {
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      overflow: hidden;
    }
    .ruler-h {
      grid-row: 1;
      grid-column: 2;
      height: ${RULER_PX}px;
      border-bottom: 1px solid var(--sk-border);
    }
    .ruler-v {
      grid-row: 2;
      grid-column: 1;
      width: ${RULER_PX}px;
      border-right: 1px solid var(--sk-border);
    }
    .paper {
      grid-row: 2;
      grid-column: 2;
      position: relative;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }
    /* 격자 — 요소보다 뒤에 깔린다. 선 색·간격은 인라인 스타일로  */
    .grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    /* 격자 색 견본 줄 — 격자가 켜져 있을 때만 메뉴에 보인다  */
    .grid-colors {
      display: flex;
      gap: 6px;
      padding: 6px 10px;
      border-top: 1px solid var(--sk-border);
      margin-top: 4px;
    }
    .preset-menu .grid-colors button {
      display: inline-block;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 3px;
    }
    .preset-menu .grid-colors button[aria-pressed='true'] {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    /* 커서 좌표 — 캔버스 오른쪽 아래에 붙어 스크롤해도 자리를 지킨다  */
    .coords {
      grid-row: 2;
      grid-column: 2;
      align-self: end;
      justify-self: end;
      margin: 8px;
      padding: 2px 8px;
      border-radius: var(--sk-radius);
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    .padding-guide {
      position: absolute;
      border: 1px dashed rgba(0, 0, 0, 0.1);
      pointer-events: none;
    }
    /* 페이지 번호 자리표시  — 실제 번호는 PDF 후처리, 캔버스는 X / X만 */
    .page-number-mark {
      position: absolute;
      display: flex;
      align-items: center;
      font-size: 9px;
      color: var(--sk-text-muted);
      pointer-events: none;
    }

    .element {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid var(--sk-guide-faint);
      cursor: move;
      overflow: hidden;
      touch-action: none;
      user-select: none;
      font-size: 11px;
      line-height: 1.3;
    }
    .element > * {
      pointer-events: none;
    }
    .element.selected {
      box-shadow: 0 0 0 2px var(--sk-accent);
      z-index: 10;
    }
    /*
     * 요소 종류 배지는 마우스를 올리거나 요소를 선택했을 때 표시한다.
     * 캔버스와 PDF의 글 위치를 맞추기 위해 요소 상자에 안쪽 여백을 두지 않는다.
     * 툴바의 "요소 확인"을 켜면 전부 보인다.
     */
    .element .badge {
      position: absolute;
      top: 1px;
      left: 1px;
      /* 표·그리드 미리보기가 나중에 그려져 배지를 덮지 않도록 */
      z-index: 1;
      display: none;
      align-items: center;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 2px;
      color: var(--sk-text-muted);
    }
    .element:hover .badge,
    .element.selected .badge,
    .canvas-area.show-badges .badge {
      display: inline-flex;
    }
    .element .badge svg {
      width: 11px;
      height: 11px;
    }
    /* 텍스트·필드 표시 — PDF(pdfme)와 같게: 위쪽 정렬, 줄바꿈 유지, 넘치면 자동 줄바꿈 */
    .element .el-content {
      /* flex column으로 수직 정렬(justify-content)을 준다 — 기본은 상단 */
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      width: 100%;
      height: 100%;
      overflow: hidden;
      white-space: pre-wrap;
      /* 줄바꿈 위치도 PDF와 맞춘다 — 낱말 단위로 끊고, 한 낱말이 상자보다 길 때만 낱말 안에서 끊는다 */
      word-break: keep-all;
      overflow-wrap: break-word;
      line-height: 1;
    }
    .element.type-image {
      background: #f5f5f5;
    }
    .element.type-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      position: absolute;
      inset: 0;
    }
    /* 바코드 견본  — 격자·막대 그림 위에 종류·값을 겹쳐 보여준다 */
    .element .barcode-preview {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .element .barcode-svg {
      flex: 1;
      width: 100%;
      min-height: 0;
    }
    .element .barcode-caption {
      flex: 0 0 auto;
      padding: 0 1px;
      font-size: 8px;
      line-height: 1.1;
      color: var(--sk-text-muted);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .element .grid-preview {
      position: absolute;
      inset: 0;
      display: grid;
    }
    .element .grid-preview > div {
      display: flex;
      align-items: center;
      /* PDF 변환 계층의 셀 안쪽 여백과 같은 값 (GRID_CELL_PADDING = 1mm, 사방) */
      padding: 1mm;
      overflow: hidden;
      /* PDF는 셀을 넘치는 글을 낱말 단위로 줄바꿈한다 — 캔버스도 같게 접어 화면·PDF를 맞춘다.
         줄바꿈 문자는 pre-line으로 그대로 보인다 */
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .element .table-preview {
      position: absolute;
      inset: 0;
      display: flex;
    }
    .element .table-preview > div {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(0, 0, 0, 0.2);
      font-size: 10px;
      overflow: hidden;
    }
    .element.type-line svg,
    .element.type-ellipse svg,
    .element.type-polygon svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    /* 선·타원·삼각형은 도형 자체만 보이게 — 편집용 상자 테두리를 지운다 (선택 시 강조는 유지) */
    .element.type-line,
    .element.type-ellipse,
    .element.type-polygon {
      border-color: transparent;
    }
    /* 선 요소는 배지가 선과 겹치므로 표시하지 않는다. */
    .element.type-line .badge {
      display: none;
    }
    .element.type-line {
      overflow: visible;
    }
    /* PDF와 같이 요소 영역 밖으로 이어지는 선의 두께를 자르지 않는다. */
    .element.type-line svg {
      overflow: visible;
    }
    /* 선택한 선은 선 강조와 끝점 핸들로 표시한다. */
    .element.type-line.selected {
      box-shadow: none;
    }

    .selection-overlay {
      position: absolute;
      pointer-events: none;
      z-index: 15;
    }
    .selection-overlay .handle {
      pointer-events: auto;
      touch-action: none;
      position: absolute;
      width: 8px;
      height: 8px;
      background: #fff;
      border: 1px solid var(--sk-accent);
      border-radius: 1px;
      box-sizing: border-box;
    }
    .handle-nw { left: -4px; top: -4px; cursor: nwse-resize; }
    .handle-n { left: calc(50% - 4px); top: -4px; cursor: ns-resize; }
    .handle-ne { right: -4px; top: -4px; cursor: nesw-resize; }
    .handle-e { right: -4px; top: calc(50% - 4px); cursor: ew-resize; }
    .handle-se { right: -4px; bottom: -4px; cursor: nwse-resize; }
    .handle-s { left: calc(50% - 4px); bottom: -4px; cursor: ns-resize; }
    .handle-sw { left: -4px; bottom: -4px; cursor: nesw-resize; }
    .handle-w { left: -4px; top: calc(50% - 4px); cursor: ew-resize; }

    /* 선 선택 하이라이트·그리기 미리보기 — 상자 대신 선 자체를 강조한다  */
    .selection-overlay .line-highlight {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .selection-overlay .endpoint {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      cursor: move;
    }
    .line-ghost {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0.5;
      pointer-events: none;
      z-index: 25;
    }

    .snap-guide {
      position: absolute;
      pointer-events: none;
      background: var(--sk-guide);
      z-index: 20;
    }
    .snap-guide.vertical {
      top: 0;
      bottom: 0;
      width: 1px;
    }
    .snap-guide.horizontal {
      left: 0;
      right: 0;
      height: 1px;
    }

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
    /* 조건부 서식 강조의 '해제' 상태 — 기본 서식의 강조를 끄는 규칙을 사선으로 표시한다 */
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

    /* 인라인 편집기는 선택한 셀의 배경과 텍스트 스타일을 상속한다. */
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
    /* 반복 구간 안의 셀임을 알리는 표시 */
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
    }
    .element .band-strip .band-row.selected {
      background: var(--sk-accent);
      color: #fff;
    }

    /* 행 구간 역할 명령 메뉴 */
    .element .band-menu {
      position: absolute;
      top: 0;
      right: calc(100% + 20px);
      z-index: 4;
      min-width: 168px;
      display: flex;
      flex-direction: column;
      background: var(--sk-panel-bg, #fff);
      border: 1px solid var(--sk-border, #ccc);
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
      padding: 4px;
    }
    .element .band-menu .band-menu-title {
      font-size: 11px;
      color: var(--sk-text-muted, #666);
      padding: 4px 6px;
    }
    .element .band-menu .band-menu-item {
      display: flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: none;
      text-align: left;
      font-size: 12px;
      padding: 5px 6px;
      border-radius: 4px;
      cursor: pointer;
    }
    .element .band-menu .band-menu-item::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: var(--sk-band, transparent);
      flex: 0 0 auto;
    }
    .element .band-menu .band-menu-item:hover {
      background: var(--sk-hover, #f2f2f2);
    }

    /* 속성 패널의 행 구간 목록 */
    .band-list .band-item {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      padding: 4px 0;
      font-size: 12px;
    }
    .band-list .band-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--sk-band, #ccc);
      flex: 0 0 auto;
    }
    .band-list .band-range {
      color: var(--sk-text-muted, #666);
    }
    .band-list .band-repeat-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
    }
    .band-list .band-hint {
      font-size: 11px;
      color: var(--sk-text-muted, #666);
      margin-top: 4px;
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

    /* 출력 페이지 전환 막대 */
    .output-page-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 12px;
      color: var(--sk-text-muted, #666);
    }

    /* 자동 확장 흐름 영역 하단 안내선 */
    .flow-guide {
      position: absolute;
      left: 0;
      right: 0;
      border-top: 1px dashed var(--sk-accent);
      opacity: 0.6;
      pointer-events: none;
      z-index: 2;
    }

    /* 페이지 계획 오류 안내 */
    .plan-error {
      margin-top: 6px;
      padding: 6px 10px;
      border-radius: 6px;
      background: #fdecea;
      color: #c5221f;
      font-size: 12px;
    }
  `;
