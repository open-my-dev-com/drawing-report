/**
 * 캔버스 — 용지, 눈금자, 요소 렌더링, 선택 표시와 그리드 미리보기.
 *
 * @remarks
 * 컴포넌트 전체가 아니라 `CanvasContext`만 받는다.
 * 화면과 PDF가 같은 페이지 계획을 쓰므로 계획은 호스트가 계산해 넘긴다.
 */

import { html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import {
  filterVisibleOnPage,
  resolveConditionalFormats,
  stackVertically,
  type ConditionalFormatOverrides,
  type ConditionalFormatRule,
  type FormulaContext,
  type FormulaValue,
  type GridElement,
  type GridCell,
  type GridFragment,
  type GridItem,
  type SlipElement,
  type SlipPage,
  type SlipLayoutError,
  type SlipTemplateFile,
  type SourcePagePlan,
} from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { RULER_PX } from '../../styles/slip-designer.styles.js';
import {
  PX_PER_MM,
  RESIZE_HANDLES,
  boxOf,
  lineEndpoints,
  polygonPointsPx,
  round1,
  trackOffsets,
} from '../geometry.js';
import {
  DEFAULT_BORDER_COLOR,
  DEFAULT_FONT_COLOR,
  DEFAULT_LINE_WIDTH,
  dashArrayOf,
  fontPx,
  justifyOf,
  textStyleCss,
  verticalFlexAlign,
} from '../style-css.js';
import {
  BAND_PLACEMENTS,
  bandAt,
  columnWidths,
  gridDims,
  inItemBand,
  isGrid,
  itemBandOf,
} from '../grid-model.js';
import { PLACEHOLDER_IMG } from '../image-pick.js';
import { BARCODE_KINDS, BARCODE_2D } from '../barcode.js';
import { TYPE_BADGE } from './badges.js';
import type { GridBandPlacement } from '@omdc-slipkit/core';
import type { GridEditController } from '../controllers/grid-edit.js';
import type { DesignerStrings } from './panel-kit.js';

/** 캔버스가 컴포넌트에서 받는 것 */
export interface CanvasContext {
  /** 로케일에 맞는 문구 */
  readonly s: DesignerStrings;
  /** 수식 평가에 쓸 로케일 */
  readonly evalLocale: string | undefined;
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 보고 있는 양식 페이지 (0부터) */
  readonly pageIndex: number;
  /** 보고 있는 출력 페이지 (0부터) */
  readonly outputPage: number;
  /** 반복 그리드를 출력 결과로 볼지 */
  readonly gridPlanPreview: boolean;
  /** 주 선택 요소 */
  readonly selectedId: string | null;
  /** 함께 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
  /** 그리드 셀·행 구간 선택 상태 */
  readonly gridEdit: GridEditController;
  /** 격자 간격(mm). null이면 격자를 그리지 않는다 */
  readonly gridGap: number | null;
  /** 용지 위 커서 위치(mm) */
  readonly cursorMm: { x: number; y: number } | null;
  /** 세로 정렬 안내선 위치(mm) */
  readonly guideX: number | null;
  /** 가로 정렬 안내선 위치(mm) */
  readonly guideY: number | null;
  /** 끌어서 만드는 중인 사각 영역(mm) */
  readonly drawRect: { x: number; y: number; w: number; h: number } | null;
  /** 끌어서 만드는 중인 사각 영역의 시작·끝(mm) */
  readonly draw: {
    type: SlipElement['type'];
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    moved: boolean;
  } | null;
  /** 선을 그리기 시작한 점(mm) */
  readonly lineDraft: { x: number; y: number } | null;
  /** 선의 현재 끝점(mm) */
  readonly lineGhost: { x: number; y: number } | null;
  /** 격자선 색 */
  gridLine(): string;
  /** 현재 양식 페이지의 계획 */
  pagePlan(): { plan: SourcePagePlan | null; error: SlipLayoutError | null };
  /** 계획 오류 */
  planError(): SlipLayoutError | null;
  /** 계획 오류가 난 요소와 행 구간으로 이동한다 */
  focusPlanError(error: SlipLayoutError): void;
  /** 출력 결과 보기를 켜거나 끈다 */
  setGridPlanPreview(enabled: boolean): void;
  /** 용지 위 커서 위치를 갱신한다 */
  trackCursor(event: PointerEvent): void;
  /** 용지 위 커서 표시를 지운다 */
  clearCursor(): void;
  /** 보고 있는 출력 페이지를 옮긴다 */
  setOutputPage(page: number): void;
  /** 속성 패널이 대상으로 삼는 요소 */
  selectedElement(): SlipElement | undefined;
  /** 인라인 편집한 셀 내용을 저장한다 */
  commitCellContent(value: string): void;
  /** 수식을 평가한다 */
  evaluate(source: string, context: FormulaContext): FormulaValue;
  /** 행 구간 역할의 이름 */
  bandLabel(placement: GridBandPlacement): string;
  /** 행 구간 역할의 설명 */
  bandDescription(placement: GridBandPlacement): string;
  /** 행 구간 역할의 아이콘 */
  bandIcon(placement: GridBandPlacement): TemplateResult;
  /** 행 번호를 눌렀을 때 */
  onBandRowClick(row: number, extend: boolean): void;
  /** 행 역할 메뉴를 닫는다 */
  closeBandMenu(clearSelection: boolean): void;
  /** 행 역할 메뉴의 키 조작 */
  onBandMenuKeyDown(event: KeyboardEvent): void;
  /** 고른 행 범위에 역할을 지정한다 */
  setRowBandRole(fromRow: number, toRow: number, placement: GridBandPlacement): void;
  /** 화면을 다시 그린다 */
  refresh(): void;
}

export function canvas(ctx: CanvasContext) {
  if (!ctx.file) return nothing;
  const { paper } = ctx.file.template;
  const page = ctx.file.template.pages[ctx.pageIndex];
  if (!page) return nothing;

  const { plan, error } = ctx.pagePlan();
  const outputPageCount = plan?.outputPageCount ?? 1;
  const outputPage = Math.min(ctx.outputPage, outputPageCount - 1);

  const pw = paper.width * PX_PER_MM;
  const ph = paper.height * PX_PER_MM;
  const [pt, pr, pb, pl] = paper.padding;

  return html`
    <div class="canvas-stack" style="--paper-w:${pw}px;--paper-h:${ph}px">
    ${outputPageBar(ctx, outputPage, outputPageCount, plan)}
    ${error === null
      ? nothing
      : html`<div id="page-plan-error" class="plan-error" role="alert"
          @pointerdown=${(event: PointerEvent) => event.stopPropagation()}>
          <span>${ctx.s.planError}: ${error.message}</span>
          ${error.elementId === undefined
            ? nothing
            : html`<button type="button" @click=${() => ctx.focusPlanError(error)}>
                ${ctx.s.planErrorLocate}
              </button>`}
        </div>`}
    <div class="paper-wrap"
      @pointermove=${(e: PointerEvent) => ctx.trackCursor(e)}
      @pointerleave=${() => {
        if (ctx.cursorMm === null) return;
        ctx.clearCursor();
      }}>
      <div class="ruler-corner"></div>
      ${ruler(ctx, 'h', paper.width, pw)}
      ${ruler(ctx, 'v', paper.height, ph)}
    <div class="paper" style="width:${pw}px;height:${ph}px">
      ${ctx.gridGap !== null
        ? html`<div class="grid-overlay" style="
            background-size:${ctx.gridGap}mm ${ctx.gridGap}mm;
            background-image:
              linear-gradient(to right, ${ctx.gridLine()} 1px, transparent 1px),
              linear-gradient(to bottom, ${ctx.gridLine()} 1px, transparent 1px);
          "></div>`
        : nothing}
      <div class="padding-guide" style="
        left:${pl * PX_PER_MM}px;
        top:${pt * PX_PER_MM}px;
        width:${(paper.width - pl - pr) * PX_PER_MM}px;
        height:${(paper.height - pt - pb) * PX_PER_MM}px;
      "></div>
      ${plan !== null && page.elements.some((el) => el.type === 'grid' && el.repeat?.pagination.mode === 'auto')
        ? html`<div class="flow-guide" aria-label=${ctx.s.flowAreaGuide}
            style="top:${plan.flowArea.bottom * PX_PER_MM}px">
            <span>${ctx.s.flowAreaGuide}</span>
          </div>`
        : nothing}
      ${pageNumberPlaceholder(page, paper, [pt, pr, pb, pl])}
      ${page.elements.map((el) => renderElement(ctx, el, plan, outputPage, outputPageCount))}
      ${selectionOverlay(ctx)}
      ${ctx.guideX !== null
        ? html`<div class="snap-guide vertical" style="left:${ctx.guideX * PX_PER_MM}px"></div>`
        : nothing}
      ${ctx.guideY !== null
        ? html`<div class="snap-guide horizontal" style="top:${ctx.guideY * PX_PER_MM}px"></div>`
        : nothing}
      ${ctx.drawRect
        ? html`<div class="draw-ghost" style="
            left:${ctx.drawRect.x * PX_PER_MM}px;
            top:${ctx.drawRect.y * PX_PER_MM}px;
            width:${ctx.drawRect.w * PX_PER_MM}px;
            height:${ctx.drawRect.h * PX_PER_MM}px;
          "></div>`
        : nothing}
      ${lineGhost(ctx, pw, ph)}
      ${cellEditor(ctx)}
    </div>
    </div>
    </div>
  `;
}

/**
 * 용지 위의 커서 위치를 mm 좌표로 기록하고 용지 밖에서는 지운다.
 */

/**
 * 5mm 간격의 눈금과 10mm 간격의 숫자를 표시하는 눈금자를 렌더링한다.
 * 커서가 용지 위에 있으면 현재 위치도 표시한다.
 *
 * @param axis - 'h'는 위쪽 가로 자, 'v'는 왼쪽 세로 자
 * @param lengthMm - 용지 길이(mm)
 * @param lengthPx - 용지 길이(px)
 * @returns 눈금자 조각
 */
export function ruler(ctx: CanvasContext, axis: 'h' | 'v', lengthMm: number, lengthPx: number) {
  const horizontal = axis === 'h';
  const marks: TemplateResult[] = [];
  for (let mm = 0; mm <= Math.floor(lengthMm); mm += 5) {
    const long = mm % 10 === 0;
    const pos = mm * PX_PER_MM;
    marks.push(svg`<line
      x1=${horizontal ? pos : RULER_PX - (long ? 7 : 4)}
      y1=${horizontal ? RULER_PX - (long ? 7 : 4) : pos}
      x2=${horizontal ? pos : RULER_PX}
      y2=${horizontal ? RULER_PX : pos}
      stroke="currentColor" stroke-width="1" />`);
    if (long && mm > 0) {
      marks.push(svg`<text
        x=${horizontal ? pos + 2 : RULER_PX - 3}
        y=${horizontal ? 8 : pos - 2}
        font-size="8" fill="currentColor"
        text-anchor=${horizontal ? 'start' : 'end'}>${mm}</text>`);
    }
  }
  const cursor = ctx.cursorMm;
  const cursorPos = cursor ? (horizontal ? cursor.x : cursor.y) * PX_PER_MM : null;

  return html`
    <div class="ruler ruler-${axis}"
      style=${horizontal ? `width:${lengthPx}px` : `height:${lengthPx}px`}>
      <svg width=${horizontal ? lengthPx : RULER_PX} height=${horizontal ? RULER_PX : lengthPx}>
        ${marks}
        ${cursorPos === null
          ? nothing
          : svg`<line
              x1=${horizontal ? cursorPos : 0}
              y1=${horizontal ? 0 : cursorPos}
              x2=${horizontal ? cursorPos : RULER_PX}
              y2=${horizontal ? RULER_PX : cursorPos}
              stroke="var(--sk-accent)" stroke-width="1" />`}
      </svg>
    </div>
  `;
}

/**
 * 수식 미리보기에 사용할 값을 만든다.
 * 샘플 값이 없는 파라미터에는 선언된 종류의 기본값을 사용한다.
 *
 * @returns 파라미터 물리명 → 값
 */

/** 출력 페이지 이동과 선택한 반복 그리드의 출력 결과 전환을 렌더링한다. */
export function outputPageBar(ctx: CanvasContext, outputPage: number, outputPageCount: number, plan: SourcePagePlan | null) {
  const s = ctx.s;
  const selected = ctx.selectedElement();
  const canPreviewGrid = selected?.type === 'grid'
    && selected.repeat !== undefined
    && plan?.gridPlans.has(selected.id) === true;
  if (outputPageCount <= 1 && !canPreviewGrid) return nothing;
  return html`
    <div class="output-page-bar" role="group" aria-label=${s.outputPage}
      @pointerdown=${(event: PointerEvent) => event.stopPropagation()}>
      ${canPreviewGrid
        ? html`<button type="button" class="output-preview-toggle"
            aria-pressed=${String(ctx.gridPlanPreview)}
            @click=${() => ctx.setGridPlanPreview(!ctx.gridPlanPreview)}>
            ${ctx.gridPlanPreview ? icons.edit : icons.preview}
            <span>${ctx.gridPlanPreview ? s.gridStructureEdit : s.outputResult}</span>
          </button>`
        : nothing}
      ${outputPageCount <= 1
        ? nothing
        : html`<div class="output-page-nav">
            <button type="button" class="row-btn output-page-prev" aria-label=${s.prevPage}
              ?disabled=${outputPage === 0}
              @click=${() => {
                ctx.setOutputPage(Math.max(0, outputPage - 1));
              }}>${icons.pagePrev}</button>
            <span class="output-page-status" aria-live="polite">
              ${s.outputPage} ${outputPage + 1} / ${outputPageCount}
            </span>
            <button type="button" class="row-btn output-page-next" aria-label=${s.nextPage}
              ?disabled=${outputPage >= outputPageCount - 1}
              @click=${() => {
                ctx.setOutputPage(Math.min(outputPageCount - 1, outputPage + 1));
              }}>${icons.pageNext}</button>
          </div>`}
    </div>`;
}

export function selectionOverlay(ctx: CanvasContext) {
  if (ctx.gridPlanPreview) return nothing;
  // 크기 조절 핸들은 요소 하나만 선택한 경우에 표시한다.
  if (ctx.selectedIds.size > 1) return nothing;
  const el = ctx.selectedElement();
  if (!el) return nothing;
  const box = boxOf(el);
  const x = el.position.x * PX_PER_MM;
  const y = el.position.y * PX_PER_MM;
  const w = box.width * PX_PER_MM;
  const h = box.height * PX_PER_MM;
  // 선 요소에는 영역 핸들 대신 두 끝점 핸들을 표시한다.
  if (el.type === 'line') {
    const [p0, p1] = lineEndpoints(el);
    const rel = (p: { x: number; y: number }) => ({
      x: (p.x - el.position.x) * PX_PER_MM,
      y: (p.y - el.position.y) * PX_PER_MM,
    });
    const r0 = rel(p0);
    const r1 = rel(p1);
    return html`
      <div class="selection-overlay" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
        <svg class="line-highlight" viewBox="0 0 ${Math.max(1, w)} ${Math.max(1, h)}"
          preserveAspectRatio="none">
          ${svg`<line x1=${r0.x} y1=${r0.y} x2=${r1.x} y2=${r1.y}
            stroke="var(--sk-accent)" stroke-width="6" stroke-linecap="round"
            opacity="0.35" />`}
        </svg>
        ${([r0, r1] as const).map((p, index) => html`
          <span class="handle endpoint" data-endpoint=${String(index)}
            style="left:${p.x}px;top:${p.y}px"></span>`)}
      </div>
    `;
  }
  return html`
    <div class="selection-overlay" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      ${RESIZE_HANDLES.map(
        (handle) => html`<span class="handle handle-${handle}" data-handle=${handle}></span>`,
      )}
    </div>
  `;
}

/**
 * 요소 하나를 현재 출력 페이지 계획에 맞춰 렌더링한다.
 *
 * @param el - 렌더링할 요소
 * @param plan - 현재 양식 페이지의 계획 (계획 오류 시 null)
 * @param outputPage - 보고 있는 출력 페이지 (0부터)
 * @param outputPageCount - 전체 출력 페이지 수
 */

/** 선을 생성하는 동안 반투명 미리보기 선을 표시한다. */
export function lineGhost(ctx: CanvasContext, paperW: number, paperH: number) {
  const from = ctx.draw?.type === 'line' && ctx.draw.moved
    ? { x: ctx.draw.startX, y: ctx.draw.startY }
    : ctx.lineDraft;
  const to = ctx.draw?.type === 'line' && ctx.draw.moved
    ? { x: ctx.draw.endX, y: ctx.draw.endY }
    : ctx.lineGhost;
  if (!from || !to) return nothing;
  return html`<svg class="line-ghost" viewBox="0 0 ${paperW} ${paperH}"
    preserveAspectRatio="none">
    ${svg`<line x1=${from.x * PX_PER_MM} y1=${from.y * PX_PER_MM}
      x2=${to.x * PX_PER_MM} y2=${to.y * PX_PER_MM}
      stroke="var(--sk-accent)" stroke-width="2" stroke-linecap="round" />`}
  </svg>`;
}

/** 선택된 셀 위에 인라인 편집 입력을 표시한다. */
export function cellEditor(ctx: CanvasContext) {
  if (!ctx.gridEdit.editing || !ctx.gridEdit.cell) return nothing;
  const el = ctx.selectedElement();
  if (!isGrid(el)) return nothing;
  const { row, column } = ctx.gridEdit.cell;
  const rect = cellRectPx(el, row, column);
  const cell = el.cells.find((c) => c.row === row && c.column === column);
  // 편집 중에도 셀 모양을 유지하도록 셀의 표시 스타일을 입력에 적용한다.
  const bg = cell?.backgroundColor ?? el.backgroundColor;
  const fg = cell?.fontColor ?? el.fontColor;
  const size = cell?.fontSize ?? el.fontSize;
  const align = cell?.alignment ?? el.alignment;
  const inherited = [
    bg ? `background:${bg}` : 'background:transparent',
    fg ? `color:${fg}` : '',
    size ? `font-size:${fontPx(size)}` : '',
    align ? `text-align:${align}` : '',
  ].filter(Boolean).join(';');
  return html`<input class="cell-editor"
    style="left:${rect.left}px;top:${rect.top}px;width:${Math.max(24, rect.width)}px;height:${Math.max(16, rect.height)}px;${inherited}"
    .value=${cell?.content ?? ''}
    @keydown=${(e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        ctx.commitCellContent((e.target as HTMLInputElement).value);
      } else if (e.key === 'Escape') {
        ctx.gridEdit.setEditing(false);
        ctx.refresh();
      }
    }}
    @blur=${(e: Event) => {
      if (ctx.gridEdit.editing) ctx.commitCellContent((e.target as HTMLInputElement).value);
    }}>`;
}

/** 선을 생성하는 동안 반투명 미리보기 선을 표시한다. */

/**
 * 요소 하나를 현재 출력 페이지 계획에 맞춰 렌더링한다.
 *
 * @param el - 렌더링할 요소
 * @param plan - 현재 양식 페이지의 계획 (계획 오류 시 null)
 * @param outputPage - 보고 있는 출력 페이지 (0부터)
 * @param outputPageCount - 전체 출력 페이지 수
 */
export function renderElement(ctx: CanvasContext, el: SlipElement, plan: SourcePagePlan | null, outputPage: number, outputPageCount: number) {
  // 다중 선택된 요소의 영역을 모두 강조한다.
  const selected = ctx.selectedIds.has(el.id);
  const layoutError = ctx.planError();
  const hasLayoutError = layoutError?.elementId === el.id;
  let originY = el.position.y;
  let fragment: GridFragment | null = null;

  if (el.type === 'grid' && el.repeat !== undefined) {
    // 선택한 반복 그리드는 행 구간을 편집할 수 있게 원본 행 구조로 표시한다.
    if ((!selected || ctx.gridPlanPreview) && plan !== null) {
      const gridPlan = plan.gridPlans.get(el.id);
      fragment = gridPlan?.fragments.find((f) => f.outputPage === outputPage) ?? null;
      if (fragment === null) return nothing;
      originY = fragment.y;
    }
  } else if (el.pagePlacement?.mode === 'after') {
    // after 배치 요소는 계획된 위치에 표시한다. 선택 중에는 항상 표시한다.
    const placed = plan?.afterPlacements.get(el.id);
    if (placed !== undefined) {
      if (placed.outputPage !== outputPage && !selected) return nothing;
      originY = placed.y;
    } else if (plan !== null && !selected) {
      // 대상이 표시되는 페이지가 없어 배치되지 않은 요소는 캔버스에도 표시하지 않는다.
      return nothing;
    }
  } else if (!selected) {
    // 절대 배치 요소는 표시 페이지 필터를 따른다. 선택한 요소는 편집을 위해 항상 표시한다.
    const filter = el.pagePlacement?.mode === 'absolute' ? el.pagePlacement.pages : undefined;
    if (!filterVisibleOnPage(filter, outputPage, outputPageCount)) return nothing;
  }

  const box = boxOf(el);
  const x = el.position.x * PX_PER_MM;
  const y = originY * PX_PER_MM;
  const w = box.width * PX_PER_MM;
  const h = (fragment === null ? box.height : fragment.height) * PX_PER_MM;

  let style = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

  // 선과 곡선 도형은 PDF 변환 방식에 맞춰 SVG로 그린다.
  const drawnAsSvg = el.type === 'line' || el.type === 'ellipse' || el.type === 'polygon';
  if (el.type !== 'image' && !drawnAsSvg) {
    const r = el as Record<string, unknown>;
    // 텍스트와 필드는 샘플 값으로 조건부 서식을 미리 적용한다.
    const conditional = el.type === 'text' || el.type === 'field'
      ? previewConditionalColors(ctx, el.conditionalFormats)
      : {};
    const backgroundColor = conditional.backgroundColor ?? (r.backgroundColor as string | undefined);
    const fontColor = conditional.fontColor ?? (r.fontColor as string | undefined);
    if (backgroundColor) style += `;background-color:${backgroundColor}`;
    if (fontColor) style += `;color:${fontColor}`;
    /*
     * 캔버스에는 PDF 변환과 같은 테두리 기본값을 적용한다.
     * 테두리 굵기가 0이면 요소 영역을 확인할 수 있도록 편집 안내선만 표시한다.
     */
    const effectiveWidth = typeof r.borderWidth === 'number'
      ? r.borderWidth
      : (el.type === 'text' || el.type === 'field' ? 0 : DEFAULT_LINE_WIDTH);
    if (effectiveWidth > 0) {
      const color = conditional.borderColor ?? (r.borderColor as string | undefined) ?? DEFAULT_BORDER_COLOR;
      style += `;border-color:${color}`;
      style += `;border-width:${(effectiveWidth * PX_PER_MM).toFixed(2)}px`;
    } else {
      // 테두리 굵기가 0이면 캔버스 안내선만 표시한다.
      style += ';border-color:var(--sk-guide-faint)';
    }
    if (el.type === 'rect') {
      // 모서리 반경과 테두리 형태는 사각형 요소에만 적용한다.
      if (el.radius !== undefined && el.radius > 0) {
        style += `;border-radius:${(el.radius * PX_PER_MM).toFixed(2)}px`;
      }
      if (el.borderStyle === 'dashed' || el.borderStyle === 'dotted') {
        style += `;border-style:${el.borderStyle}`;
      }
    }
  }

  return html`
    <div class="element ${selected ? 'selected' : ''} ${hasLayoutError ? 'layout-error' : ''} type-${el.type}"
         data-id=${el.id}
         tabindex=${hasLayoutError ? '-1' : nothing}
         aria-invalid=${hasLayoutError ? 'true' : nothing}
         aria-describedby=${hasLayoutError ? 'page-plan-error' : nothing}
         style=${style}>
      <span class="badge">${TYPE_BADGE[el.type]}</span>
      ${elementContent(ctx, el, fragment)}
    </div>
  `;
}

export function elementContent(ctx: CanvasContext, el: SlipElement, fragment: GridFragment | null = null) {
  switch (el.type) {
    case 'text': {
      // 조건부 서식의 글자 강조를 샘플 값으로 미리 적용한다.
      const styled = { ...el, ...previewConditionalColors(ctx, el.conditionalFormats) };
      return html`<span class="el-content"
        style="font-size:${fontPx(el.fontSize)};text-align:${el.alignment ?? 'left'}${textStyleCss(styled)}"
        >${stackVertically(el.content, el.vertical)}</span>`;
    }

    case 'grid':
      return gridElementPreview(ctx, el, fragment);

    case 'image': {
      // 변동 이미지는 샘플 이미지가 있으면 표시하고 없으면 파라미터 키를 표시한다.
      if (el.parameter !== undefined) {
        const sample = ctx.file?.template.sampleValues?.[el.parameter];
        return typeof sample === 'string' && sample.startsWith('data:')
          ? html`<img src=${sample} alt="">`
          : html`<span class="el-content">{${el.parameter}}</span>`;
      }
      // 기본 투명 이미지는 이미지가 선택되지 않았음을 나타내는 문구로 표시한다.
      return el.src !== undefined && el.src !== PLACEHOLDER_IMG && el.src.startsWith('data:')
        ? html`<img src=${el.src} alt="">`
        : html`<span class="el-content">${ctx.s.typeImage}</span>`;
    }

    case 'line':
    case 'ellipse':
    case 'polygon':
      return shapePreview(el);

    case 'rect':
      return nothing;

    case 'field': {
      // 필드에는 파라미터 키 또는 수식을 표시한다.
      const label = el.parameter !== undefined ? `{${el.parameter}}` : (el.formula ?? '');
      // 조건부 서식의 글자 강조를 샘플 값으로 미리 적용한다.
      const styled = { ...el, ...previewConditionalColors(ctx, el.conditionalFormats) };
      return html`<span class="el-content"
        style="font-size:${fontPx(el.fontSize)};text-align:${el.alignment ?? 'left'}${textStyleCss(styled)}"
        >${stackVertically(label, el.vertical)}</span>`;
    }

    case 'barcode':
      return barcodePreview(el);
  }
}

/**
 * 편집용 바코드 견본을 캔버스에 표시한다.
 * 실제 바코드는 PDF 미리보기에서 렌더링한다.
 */

/**
 * 편집용 바코드 견본을 캔버스에 표시한다.
 * 실제 바코드는 PDF 미리보기에서 렌더링한다.
 */
export function barcodePreview(el: SlipElement & { type: 'barcode' }) {
  const label = el.content ?? (el.parameter !== undefined ? `{${el.parameter}}` : el.formula ?? '');
  const color = el.fontColor ?? '#000000';
  const kindLabel = BARCODE_KINDS.find((k) => k.value === el.kind)?.label ?? el.kind;
  // 바코드 종류와 현재 값 소스를 함께 표시한다.
  const caption = html`<span class="barcode-caption">${kindLabel}${label ? ` · ${label}` : ''}</span>`;
  if (BARCODE_2D.has(el.kind)) {
    // 2차원 바코드는 위치 탐지 무늬가 있는 격자 형태로 표시한다.
    const n = 11;
    const cells = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => {
        const finder = (r < 3 && c < 3) || (r < 3 && c >= n - 3) || (r >= n - 3 && c < 3);
        const on = finder || (r + c) % 2 === 0;
        return on ? svg`<rect x=${c} y=${r} width="1" height="1" fill=${color} />` : nothing;
      }),
    );
    return html`
      <div class="barcode-preview">
        <svg viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" class="barcode-svg">${cells}</svg>
        ${caption}
      </div>`;
  }
  // 1차원 바코드는 굵기가 다른 세로 막대로 표시한다.
  const pattern = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 2];
  const total = pattern.reduce((sum, w) => sum + w, 0);
  let x = 0;
  const bars = pattern.map((w, i) => {
    const bar = i % 2 === 0 ? svg`<rect x=${x} y="0" width=${w} height="1" fill=${color} />` : nothing;
    x += w;
    return bar;
  });
  return html`
    <div class="barcode-preview">
      <svg viewBox="0 0 ${total} 1" preserveAspectRatio="none" class="barcode-svg">${bars}</svg>
      ${caption}
    </div>`;
}

/**
 * PDF 변환과 같은 규칙으로 도형의 SVG를 만든다.
 * SVG 내부 요소는 Lit의 `svg` 템플릿으로 생성한다.
 */

/**
 * PDF 변환과 같은 규칙으로 도형의 SVG를 만든다.
 * SVG 내부 요소는 Lit의 `svg` 템플릿으로 생성한다.
 */
export function shapePreview(el: SlipElement & { type: 'line' | 'ellipse' | 'polygon' }) {
  const w = Math.max(1, el.width * PX_PER_MM);
  const h = Math.max(1, el.height * PX_PER_MM);
  const stroke = el.borderColor ?? '#000000';
  const strokeWidth = Math.max(1, (el.borderWidth ?? DEFAULT_LINE_WIDTH) * PX_PER_MM);

  if (el.type === 'line') {
    const dash = dashArrayOf(el.borderStyle);
    const direction = el.lineDirection ?? 'horizontal';
    const [x1, y1, x2, y2] =
      direction === 'horizontal' ? [0, h / 2, w, h / 2]
      : direction === 'vertical' ? [w / 2, 0, w / 2, h]
      : direction === 'down' ? [0, 0, w, h]
      : [0, h, w, 0];
    return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      ${svg`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke=${stroke}
        stroke-width=${strokeWidth} stroke-dasharray=${dash ?? nothing} />`}
    </svg>`;
  }
  const fill = el.backgroundColor ?? 'none';
  if (el.type === 'ellipse') {
    // 곡선 테두리는 실선만 지원한다.
    return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      ${svg`<ellipse cx=${w / 2} cy=${h / 2} rx=${Math.max(0, (w - strokeWidth) / 2)}
        ry=${Math.max(0, (h - strokeWidth) / 2)} fill=${fill} stroke=${stroke}
        stroke-width=${strokeWidth} />`}
    </svg>`;
  }
  // 정다각형은 요소 영역에 내접하도록 좌표를 계산한다.
  const points = polygonPointsPx(el.sides, w, h)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    ${svg`<polygon points=${points} fill=${fill} stroke=${stroke}
      stroke-width=${strokeWidth} />`}
  </svg>`;
}

/** 셀 하나의 캔버스 표시 스타일과 내용을 만든다. */

/**
 * 그리드의 캔버스 표시를 만든다.
 *
 * 선택하지 않은 반복 그리드는 현재 출력 페이지의 계획 조각(`fragment`)을 표시하고,
 * 선택한 그리드와 정적 그리드는 원본 행 구조를 표시한다 (§7.5).
 */
export function gridElementPreview(ctx: CanvasContext, el: GridElement, fragment: GridFragment | null = null) {
  const selected = el.id === ctx.selectedId;
  const widths = columnWidths(el);
  const colTracks = widths.map((w) => `${w}fr`).join(' ');
  const lineColor = el.borderColor ?? '#000000';
  const lineWidth = el.borderWidth ?? DEFAULT_LINE_WIDTH;
  const borderCssOf = (cell?: GridCell, overrideColor?: string): string => {
    const width = cell?.borderWidth ?? lineWidth;
    if (width <= 0) return 'none';
    const px = Math.max(1, Math.round(width * PX_PER_MM));
    return `${px}px ${cell?.borderStyle ?? el.borderStyle ?? 'solid'} ${overrideColor ?? cell?.borderColor ?? lineColor}`;
  };

  if (fragment !== null && el.repeat !== undefined) {
    return gridFragment(ctx, el, fragment, { colTracks, borderCssOf });
  }

  // 원본 행 구조 표시 — 항목 구간 셀에는 첫 샘플 항목을 적용한다.
  const heights = el.rows.map((row) => row.height);
  const rowTracks = heights.map((h) => `${h}fr`).join(' ');
  const items = repeatSampleItems(ctx, el);
  const realItems = el.repeat?.maxItems === undefined ? items : items.slice(0, el.repeat.maxItems);
  const gridPlan = el.repeat === undefined ? undefined : ctx.pagePlan().plan?.gridPlans.get(el.id);
  const plannedFragment = gridPlan?.fragments.find((candidate) => candidate.outputPage === ctx.outputPage);
  const itemsOf = (indexes: readonly number[] | undefined): Record<string, unknown>[] => indexes === undefined
    ? realItems
    : indexes.map((index) => realItems[index]).filter(
        (item): item is Record<string, unknown> => item !== undefined,
      );

  const boxes = el.cells.map((cell) => {
    const isSelectedCell =
      selected && ctx.gridEdit.cell?.row === cell.row && ctx.gridEdit.cell?.column === cell.column;
    const inBand = inItemBand(el, cell.row);
    const band = bandAt(el, cell.row);
    const planned = plannedFragment?.bands.find((candidate) => candidate.band.id === band?.id);
    const reserved: Record<string, unknown> | undefined = el.repeat === undefined
      ? undefined
      : {
          '@all': realItems,
          '@page': itemsOf(plannedFragment?.pageItems),
          '@carried': itemsOf(plannedFragment?.carriedItems ?? []),
          '@group': planned?.groupIndex === undefined
            ? realItems
            : itemsOf(gridPlan?.groups[planned.groupIndex]),
        };
    const previewItem = planned?.itemIndex === undefined ? items[0] : realItems[planned.itemIndex];
    if (reserved !== undefined && previewItem !== undefined) reserved['@item'] = previewItem;
    return gridCellBox(ctx, el, cell, { row: cell.row, rowSpan: cell.rowSpan ?? 1 }, {
      item: inBand ? previewItem : undefined,
      ...(reserved === undefined ? {} : { reserved }),
      selected: isSelectedCell,
      borderCssOf,
    });
  });

  // 값이 없는 좌표에도 그리드선을 표시한다 (SPEC §5.7).
  const taken = new Set<string>();
  for (const cell of el.cells) {
    for (let r = cell.row; r < cell.row + (cell.rowSpan ?? 1); r++) {
      for (let c = cell.column; c < cell.column + (cell.colSpan ?? 1); c++) taken.add(`${r},${c}`);
    }
  }
  const blanks = [];
  for (let r = 0; r < heights.length; r++) {
    for (let c = 0; c < widths.length; c++) {
      if (taken.has(`${r},${c}`)) continue;
      const blankSelected =
        selected && ctx.gridEdit.cell?.row === r && ctx.gridEdit.cell?.column === c;
      blanks.push(html`<div class=${blankSelected ? 'cell-selected' : ''}
        style="grid-area:${r + 1}/${c + 1};border:${borderCssOf()}"></div>`);
    }
  }

  // 선택한 반복 그리드에는 행 구간 표식과 행 번호 선택 영역을 함께 표시한다 (§7.2).
  const bandOverlays = el.repeat === undefined
    ? []
    : el.repeat.bands.map((band) => html`<div
        class="band-tint placement-${band.placement}"
        style="grid-area:${band.fromRow + 1}/1/span ${band.toRow - band.fromRow + 1}/span ${widths.length}"></div>`);

  const preview = html`<div class="grid-preview"
    style="grid-template-columns:${colTracks};grid-template-rows:${rowTracks}">${bandOverlays}${blanks}${boxes}</div>`;
  // 셀 편집 중에는 행 역할 조작을 감춰 두 편집 모드가 겹치지 않게 한다.
  if (!selected || el.repeat === undefined || ctx.gridEdit.cell !== null) return preview;
  return html`${preview}${bandStrip(ctx, el, rowTracks)}`;
}

/** 출력 페이지 계획 조각을 캔버스에 표시한다. */

/** 출력 페이지 계획 조각을 캔버스에 표시한다. */
export function gridFragment(
ctx: CanvasContext,
  el: GridElement,
  fragment: GridFragment,
  context: { colTracks: string; borderCssOf: (cell?: GridCell, overrideColor?: string) => string },
) {
  const repeat = el.repeat!;
  const gridPlan = ctx.pagePlan().plan?.gridPlans.get(el.id);
  const sample = repeatSampleItems(ctx, el);
  const real = repeat.maxItems === undefined ? sample : sample.slice(0, repeat.maxItems);
  const itemsOf = (indexes: readonly number[]): Record<string, unknown>[] =>
    indexes.map((i) => real[i]).filter((item): item is Record<string, unknown> => item !== undefined);
  const baseReserved: Record<string, unknown> = {
    '@all': real,
    '@page': itemsOf(fragment.pageItems),
    '@carried': itemsOf(fragment.carriedItems),
  };

  const rowTracks = fragment.rowHeights.map((h) => `${h}fr`).join(' ');
  const autoMergeColumns = new Set<number>();
  el.columns.forEach((column, c) => {
    if (column.autoMerge === true) autoMergeColumns.add(c);
  });
  const cellMerges = (cell: GridCell): boolean => {
    for (let c = cell.column; c < cell.column + (cell.colSpan ?? 1); c++) {
      if (autoMergeColumns.has(c)) return true;
    }
    return false;
  };

  type Placed = {
    cell: GridCell;
    row: number;
    rowSpan: number;
    item: Record<string, unknown> | undefined;
    empty: boolean;
    reserved: Readonly<Record<string, unknown>>;
  };
  const placed: Placed[] = [];
  // 자동 병합은 그룹과 페이지 경계에서 끊는다 (PDF 변환과 같은 규칙).
  const anchors = new Map<string, { entry: Placed; text: string }>();
  let lastGroup: number | undefined;
  const itemBandRows = fragment.bands
    .filter((planned) => planned.band.placement === 'item')
    .map((planned) => planned.band.toRow - planned.band.fromRow + 1)[0] ?? 1;

  for (const planned of fragment.bands) {
    const band = planned.band;
    const isItem = band.placement === 'item';
    if (!isItem || (lastGroup !== undefined && planned.groupIndex !== lastGroup)) anchors.clear();
    lastGroup = isItem ? planned.groupIndex : undefined;
    const item = planned.itemIndex === undefined ? undefined : real[planned.itemIndex];
    const empty = planned.emptyItem === true;
    const reserved: Record<string, unknown> = { ...baseReserved };
    if (item !== undefined) reserved['@item'] = item;
    if (planned.groupIndex !== undefined && gridPlan !== undefined) {
      reserved['@group'] = itemsOf(gridPlan.groups[planned.groupIndex] ?? []);
    }
    for (const cell of el.cells) {
      if (cell.row < band.fromRow || cell.row > band.toRow) continue;
      const row = planned.rowStart + (cell.row - band.fromRow);
      const entry: Placed = { cell, row, rowSpan: cell.rowSpan ?? 1, item, empty, reserved };
      if (!isItem || !cellMerges(cell)) {
        placed.push(entry);
        continue;
      }
      const key = `${cell.row},${cell.column}`;
      const text = empty ? '' : gridCellMergeText(ctx, cell, item, reserved);
      // 빈 값과 빈 항목은 병합 범위를 종료한다.
      if (text === '') {
        anchors.delete(key);
        placed.push(entry);
        continue;
      }
      const anchor = anchors.get(key);
      if (anchor !== undefined && anchor.text === text) {
        anchor.entry.rowSpan += itemBandRows;
        continue;
      }
      placed.push(entry);
      anchors.set(key, { entry, text });
    }
  }

  const boxes = placed.map((entry) =>
    gridCellBox(ctx, el, entry.cell, { row: entry.row, rowSpan: entry.rowSpan }, {
      item: entry.item,
      empty: entry.empty,
      reserved: entry.reserved,
      borderCssOf: context.borderCssOf,
    }));

  // 값이 없는 좌표에도 그리드선을 표시한다.
  const taken = new Set<string>();
  for (const { cell, row, rowSpan } of placed) {
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = cell.column; c < cell.column + (cell.colSpan ?? 1); c++) taken.add(`${r},${c}`);
    }
  }
  const blanks = [];
  for (let r = 0; r < fragment.rowHeights.length; r++) {
    for (let c = 0; c < el.columns.length; c++) {
      if (taken.has(`${r},${c}`)) continue;
      blanks.push(html`<div style="grid-area:${r + 1}/${c + 1};border:${context.borderCssOf()}"></div>`);
    }
  }

  return html`<div class="grid-preview"
    style="grid-template-columns:${context.colTracks};grid-template-rows:${rowTracks}">${blanks}${boxes}</div>`;
}

/**
 * 그리드 왼쪽의 행 번호 선택 영역을 렌더링한다 (§7.2).
 * 행을 눌러 선택하고 Shift로 연속 범위를 넓힌 뒤 역할 명령을 고른다.
 */

/**
 * 그리드 왼쪽의 행 번호 선택 영역을 렌더링한다 (§7.2).
 * 행을 눌러 선택하고 Shift로 연속 범위를 넓힌 뒤 역할 명령을 고른다.
 */
export function bandStrip(ctx: CanvasContext, el: GridElement, rowTracks: string) {
  const s = ctx.s;
  const select = ctx.gridEdit.bandRange;
  const rows = el.rows.map((_, r) => {
    const band = bandAt(el, r);
    const inSelect = select !== null && r >= Math.min(select.from, select.to) && r <= Math.max(select.from, select.to);
    return html`<button type="button"
      data-band-row=${String(r)}
      class="band-row placement-${band?.placement ?? 'none'} ${inSelect ? 'selected' : ''}"
      title=${band === undefined ? '' : ctx.bandLabel(band.placement)}
      aria-label="${s.bandRow} ${r + 1}"
      aria-haspopup="menu"
      aria-expanded=${String(inSelect && ctx.gridEdit.bandMenuOpen)}
      @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
      @click=${(e: MouseEvent) => ctx.onBandRowClick(r, e.shiftKey)}>${r + 1}</button>`;
  });
  return html`<div class="band-strip" style="grid-template-rows:${rowTracks}"
    @pointerdown=${(e: PointerEvent) => e.stopPropagation()}>${rows}</div>
    ${select === null || !ctx.gridEdit.bandMenuOpen ? nothing : bandMenu(ctx, el)}`;
}

/** 행 구간 역할 명령 메뉴를 렌더링한다. */

/** 행 구간 역할 명령 메뉴를 렌더링한다. */
export function bandMenu(ctx: CanvasContext, el: GridElement) {
  const s = ctx.s;
  const select = ctx.gridEdit.bandRange!;
  const from = Math.min(select.from, select.to);
  const to = Math.max(select.from, select.to);
  const top = el.rows.slice(0, from).reduce((sum, row) => sum + row.height * PX_PER_MM, 0);
  const menuLabel = s.bandMenuTitle
    .replace('{from}', String(from + 1))
    .replace('{to}', String(to + 1));
  return html`<div class="band-menu" role="menu" aria-label=${menuLabel} style="top:${top}px"
    @keydown=${ctx.onBandMenuKeyDown}
    @pointerdown=${(e: PointerEvent) => e.stopPropagation()}>
    <div class="band-menu-title">${menuLabel}</div>
    ${BAND_PLACEMENTS.map((placement) => html`<button type="button" role="menuitem"
      class="band-menu-item placement-${placement}"
      @click=${() => {
        ctx.setRowBandRole(from, to, placement);
        ctx.closeBandMenu(true);
      }}><span class="band-menu-icon">${ctx.bandIcon(placement)}</span>
        <span class="band-menu-copy">
          <span class="band-menu-label">${ctx.bandLabel(placement)}</span>
          <span class="band-menu-description">${ctx.bandDescription(placement)}</span>
        </span>
      </button>`)}
    <button type="button" role="menuitem" class="band-menu-item"
      @click=${() => ctx.closeBandMenu(true)}>${s.cancel}</button>
  </div>`;
}

/** 행 번호 선택 영역의 클릭을 처리한다. Shift 클릭은 연속 범위를 넓힌다. */

/**
 * 캔버스에 페이지 번호 자리표시를 렌더링한다.
 * 실제 페이지 번호는 PDF 후처리에서 결정되므로 캔버스에는 `X / X`를 표시한다.
 *
 * @param page - 현재 페이지
 * @param paper - 용지 크기
 * @param padding - 여백 `[상, 우, 하, 좌]`(mm)
 * @returns 번호 자리표시 조각. 번호 표시가 꺼져 있으면 빈 것
 */
export function pageNumberPlaceholder(
  page: SlipPage,
  paper: { width: number; height: number },
  padding: [number, number, number, number],
) {
  const setting = page.pageNumber;
  if (!setting) return nothing;
  const [pt, pr, pb, pl] = padding;
  const isTop = setting.position.startsWith('top-');
  const align = setting.position.endsWith('-left')
    ? 'flex-start'
    : setting.position.endsWith('-right') ? 'flex-end' : 'center';
  const boxH = 6;
  const left = pl * PX_PER_MM;
  const width = (paper.width - pl - pr) * PX_PER_MM;
  const top = (isTop ? Math.max(0, pt - boxH) : paper.height - pb) * PX_PER_MM;
  return html`<div class="page-number-mark" style="
    left:${left}px; top:${top}px; width:${width}px; height:${boxH * PX_PER_MM}px;
    justify-content:${align};
  ">X / X</div>`;
}

/**
 * 현재 양식 페이지의 출력 페이지 계획을 만든다.
 * 같은 입력이면 캐시를 재사용하고, 계획 오류는 오류 상태로 반환한다.
 */

/** 셀 하나의 캔버스 표시 스타일과 내용을 만든다. */
export function gridCellBox(
ctx: CanvasContext,
  el: GridElement,
  cell: GridCell,
  at: { row: number; rowSpan: number },
  context: {
    item?: Record<string, unknown> | undefined;
    empty?: boolean;
    reserved?: Readonly<Record<string, unknown>> | undefined;
    selected?: boolean;
    borderCssOf: (cell?: GridCell, overrideColor?: string) => string;
  },
) {
  // 빈 항목 인스턴스에는 값이 없으므로 조건부 서식을 평가하지 않는다 (PDF 변환과 동일).
  const conditional = context.empty === true
    ? {}
    : previewConditionalColors(ctx, cell.conditionalFormats, context.item, context.reserved);
  const backgroundColor = conditional.backgroundColor ?? cell.backgroundColor;
  const fontColor = conditional.fontColor ?? cell.fontColor ?? el.fontColor;
  // 그리드 셀은 수직 정렬을 별도로 적용하므로 textStyleCss에서는 생략한다.
  // 조건부 서식의 글자 강조는 셀 스타일 위에 덮어쓴다.
  const merged = { ...el, ...cell, ...conditional };
  const style = [
    `grid-area:${at.row + 1}/${cell.column + 1}/span ${at.rowSpan}/span ${cell.colSpan ?? 1}`,
    `border:${context.borderCssOf(cell, conditional.borderColor)}`,
    `font-size:${fontPx(cell.fontSize ?? el.fontSize)}`,
    `justify-content:${justifyOf(cell.alignment ?? el.alignment)}`,
    `align-items:${verticalFlexAlign(merged.verticalAlignment)}`,
    // 세로쓰기에서 추가한 줄바꿈을 유지한다.
    cell.vertical === true ? 'white-space:pre-wrap' : '',
    backgroundColor ? `background-color:${backgroundColor}` : '',
    fontColor ? `color:${fontColor}` : '',
  ].filter(Boolean).join(';') + textStyleCss(merged, { omitVerticalAlign: true });
  // 빈 항목은 파라미터 이름을 출력값처럼 표시하지 않는다 (§7.5).
  const text = context.empty === true
    ? ''
    : gridCellPreviewText(ctx, cell, context.item, context.reserved);
  return html`<div class=${context.selected === true ? 'cell-selected' : ''} style=${style}
    >${stackVertically(text, cell.vertical)}</div>`;
}

/**
 * 그리드의 캔버스 표시를 만든다.
 *
 * 선택하지 않은 반복 그리드는 현재 출력 페이지의 계획 조각(`fragment`)을 표시하고,
 * 선택한 그리드와 정적 그리드는 원본 행 구조를 표시한다 (§7.5).
 */

/** 인라인 편집에 사용할 셀의 캔버스 영역(px)을 계산한다. */
export function cellRectPx(
  el: GridElement,
  row: number,
  column: number,
): { left: number; top: number; width: number; height: number } {
  const colOffsets = trackOffsets(columnWidths(el));
  const rowOffsets = trackOffsets(el.rows.map((r) => r.height));
  const cell = el.cells.find((c) => c.row === row && c.column === column);
  const rowSpan = cell?.rowSpan ?? 1;
  const colSpan = cell?.colSpan ?? 1;
  const left = (el.position.x + (colOffsets[column] ?? 0)) * PX_PER_MM;
  const top = (el.position.y + (rowOffsets[row] ?? 0)) * PX_PER_MM;
  const width = ((colOffsets[column + colSpan] ?? 0) - (colOffsets[column] ?? 0)) * PX_PER_MM;
  const height = ((rowOffsets[row + rowSpan] ?? 0) - (rowOffsets[row] ?? 0)) * PX_PER_MM;
  return { left, top, width, height };
}

/** 인라인 편집 값을 기존 셀에 적용하거나 새 셀을 만든다. */

/** 직접 입력, 파라미터 또는 수식으로 셀의 표시 텍스트를 만든다. */
export function gridCellPreviewText(
ctx: CanvasContext,
  cell: GridCell,
  item: Record<string, unknown> | undefined,
  reserved?: Readonly<Record<string, unknown>>,
): string {
  const values = { ...(ctx.file?.template.sampleValues ?? {}), ...(item ?? {}) };
  if (cell.parameter !== undefined) {
    const value = values[cell.parameter];
    return value === undefined || value === null ? `{${cell.parameter}}` : String(value);
  }
  if (cell.formula !== undefined) {
    try {
      const result = ctx.evaluate(cell.formula, {
        values,
        ...(reserved === undefined ? {} : { reserved }),
      });
      return result === null ? '' : String(result);
    } catch {
      return `= ${cell.formula}`;
    }
  }
  return cell.content ?? '';
}

/**
 * 자동 병합 비교에 사용할 실제 셀 값을 반환한다.
 * 빈 값은 빈 문자열로 변환해 병합하지 않는다.
 */

/**
 * 자동 병합 비교에 사용할 실제 셀 값을 반환한다.
 * 빈 값은 빈 문자열로 변환해 병합하지 않는다.
 */
export function gridCellMergeText(
ctx: CanvasContext,
  cell: GridCell,
  item: Record<string, unknown> | undefined,
  reserved?: Readonly<Record<string, unknown>>,
): string {
  const values = { ...(ctx.file?.template.sampleValues ?? {}), ...(item ?? {}) };
  if (cell.parameter !== undefined) {
    const value = values[cell.parameter];
    return value === null || value === undefined ? '' : String(value);
  }
  if (cell.formula !== undefined) {
    try {
      const result = ctx.evaluate(cell.formula, {
        values,
        ...(reserved === undefined ? {} : { reserved }),
      });
      return result === null ? '' : String(result);
    } catch {
      return '';
    }
  }
  return cell.content ?? '';
}

// ---------------------------------------------------------------------------
// Render: property panel
// ---------------------------------------------------------------------------

/** 양식 속성을 변경하고 되돌리기 이력을 남긴다. */

/**
 * 캔버스 미리보기에 적용할 조건부 서식 색·강조를 샘플 값으로 계산한다.
 * 규칙별로 평가해 아직 완성되지 않은 조건식은 건너뛴다.
 *
 * @param rules - 조건부 서식 규칙 목록
 * @param item - 항목 구간의 현재 샘플 항목 (없으면 샘플 값만 사용)
 * @param reserved - 행 구간의 예약 참조 값 (`@page` 등)
 * @returns 덮어쓸 색·강조 목록
 */
export function previewConditionalColors(
ctx: CanvasContext,
  rules: readonly ConditionalFormatRule[] | undefined,
  item?: Record<string, unknown>,
  reserved?: Readonly<Record<string, unknown>>,
): ConditionalFormatOverrides {
  if (rules === undefined || rules.length === 0) return {};
  const scope = { ...(ctx.file?.template.sampleValues ?? {}), ...(item ?? {}) };
  const result: ConditionalFormatOverrides = {};
  for (const rule of rules) {
    try {
      Object.assign(
        result,
        resolveConditionalFormats([rule], scope, {
          ...(ctx.evalLocale === undefined ? {} : { locale: ctx.evalLocale }),
          ...(reserved === undefined ? {} : { reserved }),
        }),
      );
    } catch {
      // 조건식이 계산되지 않으면 기본 서식으로 표시한다. 오류는 PDF 미리보기에서 안내한다.
    }
  }
  return result;
}

/** 항목 구간에 사용할 샘플 항목 배열을 반환한다. */

/** 항목 구간에 사용할 샘플 항목 배열을 반환한다. */
export function repeatSampleItems(ctx: CanvasContext, el: GridElement): Record<string, unknown>[] {
  if (!el.repeat) return [];
  const sample = ctx.file?.template.sampleValues?.[el.repeat.parameter];
  if (!Array.isArray(sample)) return [];
  return sample
    .filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
    .map((row) => row as unknown as Record<string, unknown>);
}

/** 직접 입력, 파라미터 또는 수식으로 셀의 표시 텍스트를 만든다. */
