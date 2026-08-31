/**
 * 왼쪽 사이드바 — 페이지, 요소와 파라미터 목록.
 *
 * @remarks
 * 컴포넌트 전체가 아니라 `PanelKit`(공통 입력)과 `SidebarActions`(선택·목록 조작)만 받는다.
 */

import { html, nothing } from 'lit';
import type { SlipElement, SlipTemplateFile } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { THUMB_WIDTH_PX, boxOf } from '../geometry.js';
import { isGrid } from '../grid-model.js';
import { valueTypeBadge, TYPE_BADGE } from './badges.js';
import { twisty } from './inputs.js';
import type { GridEditController } from '../controllers/grid-edit.js';
import type { ParameterFieldInfo, ParameterInfo } from '../parameters.js';
import type { SideSelection } from '../selection.js';
import type { PanelKit } from './panel-kit.js';

export type { SideSelection };


/** 사이드바가 컴포넌트에 요청하는 조작 */
export interface SidebarActions {
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 보고 있는 양식 페이지 (0부터) */
  readonly pageIndex: number;
  /** 사이드바에서 고른 대상 */
  readonly selection: SideSelection;
  /** 속성 패널이 대상으로 삼는 주 선택 요소 */
  readonly selectedId: string | null;
  /** 함께 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
  /** 하위 셀 목록을 펼친 요소 id 모음 */
  readonly expandedElements: ReadonlySet<string>;
  /** 하위 필드를 펼친 파라미터 키 모음 */
  readonly expandedParameters: ReadonlySet<string>;
  /** 미리보기를 띄운 페이지 번호 */
  readonly thumbPage: number | null;
  /** 페이지 미리보기의 화면 위치 */
  readonly thumbPos: { top: number; left: number } | null;
  /** 그리드 셀 선택 상태 */
  readonly gridEdit: GridEditController;
  /** 정의와 사용처를 합친 파라미터 목록 */
  parameters(): ParameterInfo[];
  /** 페이지 목록에 보일 이름 */
  pageDisplayName(page: { label?: string | undefined }, index: number): string;
  goToPage(index: number): void;
  selectPage(index: number): void;
  showPageThumb(index: number, event: Event): void;
  hidePageThumb(index: number): void;
  addParameter(): void;
  addParameterField(listKey: string): void;
  removeParameterDef(key: string): void;
  removeParameterField(listKey: string, key: string): void;
  selectParameter(key: string): void;
  selectParameterField(listKey: string, field: ParameterFieldInfo): void;
  toggleParameterRow(key: string): void;
  toggleElementRow(id: string): void;
  deleteElementById(pageIndex: number, id: string): void;
  selectFromSidebar(pageIndex: number, id: string, additive?: boolean): void;
  selectGridCell(pageIndex: number, gridId: string, row: number, column: number): void;
  /** 그리드에서 값이 있는 셀 목록 */
  gridValueCells(grid: SlipElement): { row: number; column: number; label: string; at: string }[];
  /** 샘플 데이터 모달을 처음 상태로 연다 */
  openSampleModal(): void;
}

/**
 * 페이지, 요소, 파라미터를 탐색하고 선택하는 왼쪽 사이드바를 렌더링한다.
 *
 * @param kit - 사이드바 렌더링에 필요한 문구와 상태
 * @param side - 사이드바 선택과 편집 동작
 * @returns 사이드바 조각
 */
export function sidebar(kit: PanelKit, side: SidebarActions) {
  const file = side.file!;
  const s = kit.s;
  const { paper } = file.template;
  // 용지 비율을 유지하며 페이지 미리보기 크기를 계산한다.
  const thumbW = THUMB_WIDTH_PX;
  const scale = thumbW / paper.width;
  const pages = file.template.pages;
  const parameters = side.parameters();

  return html`
    <div class="side-section">
      <div class="side-title">${s.sidebarPages}</div>
      ${pages.map((page, i) => html`
        <div class="page-row-wrap">
          <span class="side-twisty-gap"></span>
          <button class="side-row page-row ${
            side.selection?.kind === 'page' && i === side.pageIndex
              ? 'selected'
              : i === side.pageIndex ? 'current' : ''
          }"
            aria-label="${s.sidebarPages} ${i + 1}"
            aria-pressed=${String(i === side.pageIndex)}
            @click=${() => side.selectPage(i)}
            @pointerenter=${(e: Event) => side.showPageThumb(i, e)}
            @pointerleave=${() => side.hidePageThumb(i)}
            @focus=${(e: Event) => side.showPageThumb(i, e)}
            @blur=${() => side.hidePageThumb(i)}>
            ${icons.page}<span>${side.pageDisplayName(page, i)}</span>
          </button>
          ${side.thumbPage === i && side.thumbPos
            ? html`<div class="page-thumb-pop" role="presentation"
                style="top:${side.thumbPos.top}px;left:${side.thumbPos.left}px">
                <span class="thumb-paper"
                  style="width:${thumbW}px;height:${(paper.height * scale).toFixed(1)}px">
                  ${page.elements.map((el) => html`<span class="thumb-el" style="
                    left:${(el.position.x * scale).toFixed(1)}px;
                    top:${(el.position.y * scale).toFixed(1)}px;
                    width:${Math.max(2, boxOf(el).width * scale).toFixed(1)}px;
                    height:${Math.max(2, boxOf(el).height * scale).toFixed(1)}px;
                  "></span>`)}
                </span>
              </div>`
            : nothing}
        </div>`)}
    </div>

    <div class="side-section">
      <div class="side-title">${s.sidebarElements}</div>
      ${pages.map((page, i) => html`
        ${pages.length > 1
          ? html`<button class="side-page-head ${i === side.pageIndex ? 'current' : ''}"
              aria-label="${s.sidebarElements} ${s.sidebarPages} ${i + 1}"
              aria-expanded=${String(i === side.pageIndex)}
              @click=${() => side.goToPage(i)}>
              <span>${side.pageDisplayName(page, i)}</span><span>${page.elements.length}</span>
            </button>`
          : nothing}
        ${i !== side.pageIndex
          ? nothing
          : page.elements.length === 0
            ? html`<div class="side-empty">—</div>`
            : page.elements.map((el) => elementRow(kit, side, i, el))}`)}
    </div>

    <div class="side-section">
      <div class="side-title-row">
        <span class="side-title">${s.sidebarParameters}</span>
        <button class="side-mini" title=${s.sampleData} aria-label=${s.sampleData}
          @click=${() => {
            side.openSampleModal();
          }}>${icons.database}</button>
        <button class="side-mini" title=${s.addParameter} aria-label=${s.addParameter}
          @click=${() => side.addParameter()}>${icons.pageAdd}</button>
      </div>
      ${parameters.length === 0
        ? html`<div class="side-empty">—</div>`
        : parameters.map((b) => parameterRow(kit, side, b))}
    </div>
  `;
}

/**
 * 요소와 값이 있는 그리드 셀을 사이드바 행으로 표시한다.
 *
 * @param kit - 사이드바 렌더링에 필요한 문구와 상태
 * @param side - 사이드바 선택과 편집 동작
 * @param pageIndex - 이 요소가 있는 페이지 번호
 * @param el - 그릴 요소
 * @returns 요소 줄과 (그리드면) 펼쳐진 셀 하위 줄
 */
export function elementRow(kit: PanelKit, side: SidebarActions, pageIndex: number, el: SlipElement) {
  const s = kit.s;
  const cells = isGrid(el) ? side.gridValueCells(el) : [];
  const hasCells = cells.length > 0;
  const expanded = hasCells && side.expandedElements.has(el.id);
  // 그리드 셀이 선택된 경우에는 요소 행 대신 해당 셀 행을 강조한다.
  const rowSelected = side.selectedIds.has(el.id) && !side.selection && side.gridEdit.cell === null;
  return html`
    <div class="side-row-wrap">
      ${twisty(kit, hasCells, expanded, el.name, () => side.toggleElementRow(el.id))}
      <button class="side-row ${rowSelected ? 'selected' : ''}" title=${el.name}
        @click=${(e: MouseEvent) => side.selectFromSidebar(pageIndex, el.id, e.ctrlKey || e.metaKey)}>
        ${TYPE_BADGE[el.type]}<span>${el.name}</span>
      </button>
      <button class="side-mini" title=${s.delete} aria-label="${el.name} ${s.delete}"
        @click=${() => side.deleteElementById(pageIndex, el.id)}>${icons.remove}</button>
    </div>
    ${expanded
      ? cells.map((c) => {
          const cellSelected = side.selectedId === el.id
            && side.gridEdit.cell?.row === c.row && side.gridEdit.cell?.column === c.column;
          return html`
            <button class="side-cell-row ${cellSelected ? 'selected' : ''}" title=${c.at}
              @click=${() => side.selectGridCell(pageIndex, el.id, c.row, c.column)}>
              <span>${c.label}</span></button>`;
        })
      : nothing}
  `;
}

/**
 * 이름, 파라미터 또는 수식이 지정된 그리드 셀을 행과 열 순서로 반환한다.
 *
 * @param grid - 그리드 요소
 * @returns 셀의 위치와 표시 이름(셀 이름이 없으면 행과 열 좌표)
 */

/**
 * 파라미터와 목록 하위 필드를 사이드바 행으로 표시한다.
 *
 * @param kit - 사이드바 렌더링에 필요한 문구와 상태
 * @param side - 사이드바 선택과 편집 동작
 * @param b - 표시할 파라미터 정보
 * @returns 파라미터 줄과 (목록이면) 하위 필드 줄
 */
export function parameterRow(kit: PanelKit, side: SidebarActions, b: ParameterInfo) {
  const s = kit.s;
  const sel = side.selection;
  const selected = sel?.kind === 'parameter' && sel.key === b.key;
  const hasFields = b.fields.length > 0;
  const expanded = hasFields && side.expandedParameters.has(b.key);
  return html`
    <div class="side-row-wrap">
      ${twisty(kit, hasFields, expanded, b.label, () => side.toggleParameterRow(b.key))}
      <button class="side-row ${selected ? 'selected' : ''}" title=${b.key}
        @click=${() => side.selectParameter(b.key)}>
        ${valueTypeBadge(b.valueType)}<span>${b.label}</span>
      </button>
      <button class="side-mini" title=${s.delete} aria-label="${b.key} ${s.delete}"
        ?disabled=${!b.defined}
        @click=${() => side.removeParameterDef(b.key)}>${icons.remove}</button>
    </div>
    ${expanded
      ? b.fields.map((f) => {
          const fieldSelected = sel?.kind === 'parameterField' && sel.key === b.key && sel.field === f.key;
          return html`
            <div class="side-row-wrap">
              <span class="side-twisty-gap"></span>
              <button class="side-col-row ${fieldSelected ? 'selected' : ''}" title="${b.key}.${f.key}"
                @click=${() => side.selectParameterField(b.key, f)}
                >${valueTypeBadge(f.valueType)}<span>${f.title}</span></button>
              <button class="side-mini" title=${s.delete} aria-label="${f.key} ${s.delete}"
                @click=${() => side.removeParameterField(b.key, f.key)}>${icons.remove}</button>
            </div>`;
        })
      : nothing}
    ${b.valueType === 'list'
      ? html`
        <div class="side-row-wrap">
          <span class="side-twisty-gap"></span>
          <button class="side-add-field" @click=${() => side.addParameterField(b.key)}>
            ${icons.add}<span>${s.addParameterField}</span>
          </button>
        </div>`
      : nothing}
  `;
}

/** 파라미터의 하위 필드 목록을 열거나 닫는다. */
