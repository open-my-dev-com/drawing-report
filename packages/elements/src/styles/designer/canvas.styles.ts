/**
 * `<slip-designer>` 스타일 — 캔버스.
 *
 * @remarks
 * 눈금자, 용지, 격자, 요소 표시와 선택 표시.
 * 규칙 순서는 원래 한 파일이던 때와 같습니다 — 순서를 바꾸면 cascade가 달라집니다.
 */
import { css } from 'lit';
import { RULER_PX } from './metrics.js';

export const canvasStyles = css`
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
    /* 생성 도구를 선택한 동안 캔버스 클릭으로 요소를 배치하므로 십자 커서를 사용합니다 */
    .canvas-area.drawing,
    .canvas-area.drawing .element {
      cursor: crosshair;
    }
    .canvas-stack {
      display: flex;
      flex: none;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      width: calc(var(--paper-w) + ${RULER_PX}px);
    }
    .draw-ghost {
      position: absolute;
      border: 1px dashed var(--sk-accent);
      background: var(--sk-accent-soft);
      opacity: 0.6;
      pointer-events: none;
      z-index: 25;
    }
    /* 눈금자와 용지를 함께 스크롤해 눈금 위치를 일치시킵니다  */
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
    /* 격자 — 요소보다 뒤에 표시합니다. 선 색과 간격은 인라인 스타일로 지정합니다 */
    .grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    /* 격자 색 견본 — 격자가 켜져 있을 때만 메뉴에 표시합니다  */
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
    /* 커서 좌표 — 캔버스 오른쪽 아래에 붙어 스크롤해도 자리를 지킵니다  */
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
     * 그리드 외곽선은 PDF처럼 경계 중심에 놓여 요소 상자 바깥으로 반이 나가므로 자르지 않습니다.
     * 반복 그리드의 행 편집 도구도 요소 바깥까지 표시합니다. 미리보기 자체는 계속 자릅니다.
     */
    .element.type-grid {
      overflow: visible;
    }
    /* 저장된 외곽선 전용 레이어 — 편집 안내선·선택 표시와 별개입니다 */
    .element .grid-outline {
      position: absolute;
      pointer-events: none;
      box-sizing: border-box;
    }
    .element.type-grid.selected .grid-preview {
      overflow: hidden;
    }
    /*
     * 요소 종류 배지는 마우스를 올리거나 요소를 선택했을 때 표시합니다.
     * 캔버스와 PDF의 글 위치를 맞추기 위해 요소 상자에 안쪽 여백을 두지 않습니다.
     * 툴바에서 "요소 확인"을 켜면 모든 배지를 표시합니다.
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
      /* flex column으로 수직 정렬(justify-content)을 줍니다 — 기본은 상단 */
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      width: 100%;
      height: 100%;
      overflow: hidden;
      white-space: pre-wrap;
      /* 줄바꿈 위치도 PDF와 맞춥니다 — 낱말 단위로 끊고, 한 낱말이 상자보다 길 때만 낱말 안에서 끊습니다 */
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
    /* 바코드 견본 — 모듈 배열·막대 그림 위에 종류와 값을 겹쳐 표시합니다 */
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
      /* PDF는 셀을 넘치는 글을 낱말 단위로 줄바꿈합니다 — 캔버스도 같게 접어 화면·PDF를 맞춥니다.
         줄바꿈 문자는 pre-line으로 그대로 보입니다 */
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
    /* 선·타원·삼각형에는 편집 영역의 테두리를 표시하지 않습니다 (선택 시 강조는 유지) */
    .element.type-line,
    .element.type-ellipse,
    .element.type-polygon {
      border-color: transparent;
    }
    /* 선 요소는 배지가 선과 겹치므로 표시하지 않습니다. */
    .element.type-line .badge {
      display: none;
    }
    .element.type-line {
      overflow: visible;
    }
    /* PDF와 같이 요소 영역 밖으로 이어지는 선의 두께를 자르지 않습니다. */
    .element.type-line svg {
      overflow: visible;
    }
    /* 선택한 선은 선 강조와 끝점 핸들로 표시합니다. */
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

    /* 선 선택 하이라이트·그리기 미리보기 — 상자 대신 선 자체를 강조합니다  */
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


    /* 계산할 수 없는 수식이 있는 요소·셀 표시 — 편집 캔버스에만 있고 PDF에는 넣지 않습니다 */
    .formula-warning-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      z-index: 3;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: var(--sk-radius);
      background: var(--sk-danger);
      color: #fff;
      pointer-events: none;
    }
    .formula-warning-badge svg {
      width: 11px;
      height: 11px;
    }
    .grid-cell {
      position: relative;
    }
`;
