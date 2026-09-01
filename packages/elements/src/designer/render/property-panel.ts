/**
 * 속성 패널의 진입점. 선택 대상에 따라 표시할 설정을 결정합니다.
 *
 * @remarks
 * 대상별 UI는 각 렌더 모듈이 담당하며, 이 모듈은 선택 대상에 맞는 렌더 함수를 호출합니다.
 */

import { html, nothing } from 'lit';
import type { SlipElement } from '@omdc-slipkit/core';
import { ANCHORS, boxOf, round1 } from '../geometry.js';
import { inItemBand } from '../grid-model.js';
import {
  anchorRow,
  sizeRows,
  pagePlacementSection,
  styleGroups,
  groupPanel,
  textProps,
  fieldProps,
  barcodeProps,
  lineProps,
  polygonProps,
  imageProps,
} from './element-props.js';
import type { ElementActions } from './element-props.js';
import { gridProps } from './grid-props.js';
import type { GridActions } from './grid-props.js';
import { pageSettings, formSettings, parameterPanel, parameterFieldPanel } from './form-props.js';
import type { FormActions } from './form-props.js';
import { conditionalFormatsSection } from './conditional-formats.js';
import type { SideSelection } from './sidebar.js';
import type { PanelKit } from './panel-kit.js';

/** 속성 패널이 컴포넌트에서 받는 것 */
export interface PanelContext {
  /** 공통 입력 도구 */
  readonly kit: PanelKit;
  /** 요소 조작 */
  readonly element: ElementActions;
  /** 양식·파라미터 조작 */
  readonly form: FormActions;
  /** 그리드 조작 */
  readonly grid: GridActions;
  /** 사이드바에서 선택한 대상 */
  readonly selection: SideSelection;
  /** 함께 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
  /** 속성 패널이 대상으로 삼는 요소 */
  selectedElement(): SlipElement | undefined;
  /** 요소 종류의 화면 표시 이름 */
  typeName(type: SlipElement['type']): string;
}

/**
 * 선택 대상에 맞는 속성 패널을 오른쪽에 렌더링합니다.
 *
 * @param ctx - 속성 패널 렌더링에 필요한 상태와 동작
 * @returns 속성 패널 조각
 */
export function propertyPanel(ctx: PanelContext) {
  // 선택 대상에 따라 페이지, 파라미터, 그룹 또는 요소 패널을 표시합니다.
  const sel = ctx.selection;
  if (sel?.kind === 'parameter') return parameterPanel(ctx.kit, ctx.form, sel.key);
  if (sel?.kind === 'parameterField') return parameterFieldPanel(ctx.kit, ctx.form, sel.key, sel.field);
  if (sel?.kind === 'page') return pageSettings(ctx.kit, ctx.form);

  // 여러 요소가 선택되면 그룹 패널을 표시합니다.
  if (ctx.selectedIds.size > 1) return groupPanel(ctx.kit, ctx.element);

  const el = ctx.selectedElement();
  if (!el) {
    return formSettings(ctx.kit, ctx.form);
  }

  const s = ctx.kit.s;
  const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;
  const anchor = ANCHORS[ctx.element.anchorIndex(el)] ?? ANCHORS[0];
  const selectedCell = el.type === 'grid' ? ctx.grid.edit.cell : null;
  const cellInBand = selectedCell !== null && el.type === 'grid' && inItemBand(el, selectedCell.row);

  // 셀 선택 상태에서는 그리드 이름·위치·크기 설정을 표시하지 않습니다 (§7.4).
  if (el.type === 'grid' && selectedCell !== null) {
    return html`
      <div class="type-name">
        ${`${s.cell} (${selectedCell.row + 1}, ${selectedCell.column + 1})`}
        ${cellInBand ? html`<span class="cell-band">${s.repeatCellHint}</span>` : nothing}
      </div>
      ${typeProps(ctx, el)}
    `;
  }

  const elBox = boxOf(el);
  return html`
    <div class="type-name">${ctx.typeName(el.type)}</div>

    <div class="prop-section">
      <div class="prop-section-title">${s.panelLayout}</div>
      <div class="prop-row">
        <label>${s.name}</label>
        <input .value=${el.name}
               @change=${(e: Event) => ctx.element.update((el) => { el.name = valOf(e); })}>
      </div>
      ${anchorRow(ctx.kit, ctx.element, el)}
      <div class="prop-pair">
        <div class="prop-row">
          <label>X</label>
          <input type="number" step="0.5" .value=${String(round1(el.position.x + anchor.ax * elBox.width))}
                 aria-invalid=${String(ctx.kit.hasError('element-x'))}
                 aria-describedby=${ctx.kit.hasError('element-x') ? 'error-element-x' : nothing}
                 @change=${(e: Event) => {
                   const v = numOf(e);
                   if (!Number.isFinite(v)) {
                     ctx.kit.reject(s.numberInput, 'element-x');
                     return;
                   }
                   // 입력한 기준점 좌표를 파일의 왼쪽 위 좌표로 변환합니다.
                   ctx.element.update((el) => {
                     el.position.x = Math.max(0, round1(v - anchor.ax * boxOf(el).width));
                   });
                 }}>
        </div>
        <div class="prop-row">
          <label>Y</label>
          <input type="number" step="0.5" .value=${String(round1(el.position.y + anchor.ay * elBox.height))}
                 aria-invalid=${String(ctx.kit.hasError('element-y'))}
                 aria-describedby=${ctx.kit.hasError('element-y') ? 'error-element-y' : nothing}
                 @change=${(e: Event) => {
                   const v = numOf(e);
                   if (!Number.isFinite(v)) {
                     ctx.kit.reject(s.numberInput, 'element-y');
                     return;
                   }
                   ctx.element.update((el) => {
                     el.position.y = Math.max(0, round1(v - anchor.ay * boxOf(el).height));
                   });
                 }}>
        </div>
      </div>
      ${ctx.kit.error('element-x')}
      ${ctx.kit.error('element-y')}
      ${sizeRows(ctx.kit, ctx.element, el)}
    </div>

    ${pagePlacementSection(ctx.kit, ctx.element, el)}
    ${typeProps(ctx, el)}
    ${el.type === 'grid' && ctx.grid.edit.cell !== null ? nothing : styleGroups(ctx.kit, ctx.element, el)}
    ${el.type === 'text' || el.type === 'field'
      ? conditionalFormatsSection(ctx.kit, el.conditionalFormats, 'condFmt', (next) =>
          ctx.element.update((target) => {
            const record = target as Record<string, unknown>;
            if (next.length === 0) delete record.conditionalFormats;
            else record.conditionalFormats = next;
          }),
          (index) => ({
            kind: 'element-condition', elementId: el.id, elementType: el.type, ruleIndex: index,
          }))
      : nothing}
  `;
}

/**
 * 요소 종류별 속성 구역을 렌더링합니다.
 *
 * @param ctx - 속성 패널 렌더링에 필요한 상태와 동작
 * @param el - 선택한 요소
 * @returns 종류별 속성 조각
 */
export function typeProps(ctx: PanelContext, el: SlipElement) {
  switch (el.type) {
    case 'text':
      return textProps(ctx.kit, ctx.element, el);
    case 'field':
      return fieldProps(ctx.kit, ctx.element, el);
    case 'barcode':
      return barcodeProps(ctx.kit, ctx.element, el);
    case 'line':
      return lineProps(ctx.kit, el);
    case 'polygon':
      return polygonProps(ctx.kit, ctx.element, el);
    case 'grid':
      return gridProps(ctx.kit, ctx.element, ctx.grid, el);
    case 'image':
      return imageProps(ctx.kit, ctx.element, el);
    default:
      return nothing;
  }
}
