/**
 * `<slip-designer>` 스타일 — 사이드바.
 *
 * @remarks
 * 페이지·요소·파라미터 목록과 샘플 데이터 편집.
 * 규칙 순서는 원래 한 파일이던 때와 같다 — 순서를 바꾸면 cascade가 달라진다.
 */
import { css } from 'lit';

export const sidebarStyles = css`
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

`;
