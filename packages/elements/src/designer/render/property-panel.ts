/**
 * 속성 패널의 진입점. 선택 대상에 따라 표시할 설정을 결정합니다.
 *
 * @remarks
 * 대상별 UI는 각 렌더 모듈이 담당하며, 이 모듈은 선택 대상에 맞는 렌더 함수를 호출합니다.
 */

import { html, nothing } from 'lit';
import type { SlipElement } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { ANCHORS, boxOf, round1 } from '../geometry.js';
import { inItemBand } from '../grid-model.js';
import {
  anchorRow,
  sizeRows,
  pagePlacementSection,
  styleGroups,
  groupPanel,
  paperOverflowNotice,
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
import { pageSettings, formSettings, parameterPanel, parameterFieldPanel, outputPageNav } from './form-props.js';
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
  /** 선택한 반복 그리드를 출력 결과로 보고 있는지 */
  readonly gridPlanPreview: boolean;
  /** 현재 양식 페이지에서 보고 있는 출력 페이지 (0부터) */
  readonly outputPage: number;
  /** 현재 양식 페이지가 만드는 출력 페이지 수 */
  readonly outputPageCount: number;
  /** 속성 패널이 대상으로 삼는 요소 */
  selectedElement(): SlipElement | undefined;
  /** 요소 종류의 화면 표시 이름 */
  typeName(type: SlipElement['type']): string;
  /** 출력 결과 보기를 켜거나 끕니다 */
  setGridPlanPreview(enabled: boolean): void;
  /** 보고 있는 출력 페이지를 옮깁니다 */
  setOutputPage(page: number): void;
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
        ${ctx.grid.edit.multiCell
          ? s.cellsSelected.replace('{count}', String(ctx.grid.edit.cells.length))
          : `${s.cell} (${selectedCell.row + 1}, ${selectedCell.column + 1})`}
        ${cellInBand && !ctx.grid.edit.multiCell ? html`<span class="cell-band">${s.repeatCellHint}</span>` : nothing}
      </div>
      ${typeProps(ctx, el)}
    `;
  }

  const elBox = boxOf(el);
  return html`
    ${panelHeader(ctx, el)}

    <div class="prop-section">
      <div class="prop-section-title">${s.panelLayout}</div>
      <div class="prop-row">
        <label>${s.name}</label>
        <input .value=${el.name} aria-label=${s.name}
               @change=${(e: Event) => ctx.element.update((el) => { el.name = valOf(e); })}>
      </div>
      ${anchorRow(ctx.kit, ctx.element, el)}
      <div class="prop-pair">
        <div class="prop-row">
          <label>X</label>
          <input type="number" step="0.5" .value=${String(round1(el.position.x + anchor.ax * elBox.width))}
                 aria-label="X"
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
                 aria-label="Y"
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
      ${paperOverflowNotice(ctx.kit, ctx.element, [el])}
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
 * 속성 패널의 고정 머리줄을 렌더링합니다.
 * 반복 그리드에는 이름 옆에 출력 결과 전환과, 출력 페이지가 여럿이면 페이지 이동을 함께 둡니다.
 *
 * @param ctx - 속성 패널 렌더링에 필요한 상태와 동작
 * @param el - 선택한 요소
 * @returns 머리줄 조각
 */
export function panelHeader(ctx: PanelContext, el: SlipElement) {
  if (el.type !== 'grid' || el.repeat === undefined) {
    return html`<div class="type-name">${ctx.typeName(el.type)}</div>`;
  }
  const s = ctx.kit.s;
  // 페이지 계획이 없으면 출력 결과를 만들 수 없으므로 전환을 막고 이유를 보여 줍니다.
  const planError = ctx.grid.planError();
  const blocked = planError === null ? null : `${s.planError}: ${planError.message}`;
  return html`
    <div class="type-name has-output-tools">
      <span>${ctx.typeName(el.type)}</span>
      <div class="output-tools">
        <button type="button" class="output-preview-toggle"
          aria-pressed=${String(ctx.gridPlanPreview)}
          ?disabled=${blocked !== null}
          title=${blocked ?? nothing}
          @click=${() => ctx.setGridPlanPreview(!ctx.gridPlanPreview)}>
          ${ctx.gridPlanPreview ? icons.edit : icons.preview}
          <span>${ctx.gridPlanPreview ? s.gridStructureEdit : s.outputResult}</span>
        </button>
        ${ctx.outputPageCount <= 1
          ? nothing
          : outputPageNav(ctx.kit, ctx.outputPage, ctx.outputPageCount, (page) => ctx.setOutputPage(page))}
      </div>
    </div>`;
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
