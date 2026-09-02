/**
 * 그리드 속성 패널 — 행·열, 반복 설정, 행 구간 목록과 셀 설정.
 */

import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { bandDescription, bandIcon, bandLabel } from './band-visuals.js';
import type {
  ConditionalFormatRule,
  GridBandPlacement,
  GridCell,
  GridElement,
  OutputPageFilter,
  SlipLayoutError,
} from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import {
  DEFAULT_FONT_COLOR,
  DEFAULT_FONT_SIZE,
} from '../style-css.js';
import {
  BAND_PLACEMENTS,
  GRID_MAX_ITEMS_UI,
  GRID_MAX_PER_PAGE_UI,
  bandAt,
  ensureCell,
  inItemBand,
  type GridRowCommand,
} from '../grid-model.js';
import type { GridEditController } from '../controllers/grid-edit.js';
import { numberRow, colorControl, textStyleToggles, borderShapeRow, borderWidthSelect, resetButton, type TextEmphasisKey } from './inputs.js';
import { cellRecordsOf, summarizeCellValue } from '../cell-selection.js';
import { conditionalFormatsSection } from './conditional-formats.js';
import {
  gridOverflowRow,
  fontNameRow,
  fontVariantNote,
  cellInheritOption,
} from './element-props.js';
import { setOptional } from '../patch.js';
import { cellDefaultBorderOf } from '../grid-border.js';
import type { ElementActions } from './element-props.js';
import type { ParameterInfo } from '../parameters.js';
import type { PanelKit } from './panel-kit.js';

/** 그리드 속성 패널이 컴포넌트에 요청하는 조작 */
export interface GridActions {
  /** 그리드 셀·행 구간 선택 상태 */
  readonly edit: GridEditController;
  /** 화면을 다시 그립니다 */
  refresh(): void;
  /** 리스트형 선택 상자를 열거나 닫습니다 */
  toggleListSelect(id: string, event: Event): void;
  /** 사이드바와 같은 파라미터 목록 */
  parameters(): ParameterInfo[];
  /** 현재 페이지 계획의 오류 */
  planError(): SlipLayoutError | null;
  changeRows(delta: number): void;
  changeColumns(delta: number): void;
  setTrack(kind: 'row' | 'column', index: number, mm: number): void;
  toggleRepeat(on: boolean): void;
  setRepeatParameter(key: string): void;
  setRepeatMaxItems(value: number | null): void;
  setPagination(patch: { mode?: 'auto' | 'fixed'; minItems?: number; itemsPerPage?: number }): void;
  toggleGroupField(key: string, on: boolean): void;
  clearCellSelection(): void;
  setRowBandRole(fromRow: number, toRow: number, placement: GridBandPlacement): void;
  setBandSelectionBoundary(boundary: 'from' | 'to', rowNumber: number, bandId?: string): void;
  setBandPages(bandId: string, pages: OutputPageFilter | ''): void;
  setBandRepeatOnPageBreak(bandId: string, on: boolean): void;
  addRowWithRole(placement: GridBandPlacement, options?: {
    separateBand?: boolean;
    name?: string;
    pages?: OutputPageFilter;
    initialize?: (grid: GridElement, row: number) => void;
  }): number | null;
  openRowCommand(command: GridRowCommand): void;
  applyRowCommand(): void;
  chooseCellSource(kind: 'content' | 'parameter' | 'formula'): void;
  setCellSource(kind: 'content' | 'parameter' | 'formula', value: string): void;
  commitCellContent(value: string): void;
  setCellSpan(kind: 'rowSpan' | 'colSpan', value: number): void;
  updateCellStyle(key: string, value: unknown): void;
  resetCellStyles(keys: readonly string[]): void;
  updateCellConditionalFormats(next: ConditionalFormatRule[]): void;
  cellParameterSelect(el: GridElement, current: string, inBand: boolean): TemplateResult;
}

/**
 * 그리드의 행·열, 행 구간, 페이지 방식과 선택한 셀을 편집하는 패널을 렌더링합니다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param grid - 그리드 편집 동작
 * @param el - 선택한 그리드 요소
 * @returns 그리드 속성 패널 조각
 */
export function gridProps(kit: PanelKit, act: ElementActions, grid: GridActions, el: GridElement) {
  const s = kit.s;
  const cellTarget = grid.edit.cell;
  const cellDef = cellTarget
    ? el.cells.find((c) => c.row === cellTarget.row && c.column === cellTarget.column)
    : undefined;
  const repeat = el.repeat;
  const source: 'content' | 'parameter' | 'formula' =
    grid.edit.sourceKind
    ?? (cellDef?.parameter !== undefined ? 'parameter' : cellDef?.formula !== undefined ? 'formula' : 'content');
  const inBand = cellTarget !== null && inItemBand(el, cellTarget.row);
  const numberOf = (e: Event): number => Number((e.target as HTMLInputElement).value);
  const planError = grid.planError();
  const gridPlanError = planError !== null && planError.elementId === el.id ? planError : null;
  const repeatFields = repeat === undefined
    ? []
    : (grid.parameters().find((parameter) => parameter.key === repeat.parameter)?.fields ?? []);
  // 셀이 선택된 동안에는 그리드 전체 설정을 숨깁니다 (§7.4).
  const gridOwnProps = html`
        <div class="prop-section">
          <div class="prop-section-title">${s.panelStructure}</div>
          <div class="prop-row">
              <label>${s.rows}</label>
              <div class="step-inputs">
                <button class="row-btn" aria-label="${s.rows} -" @click=${() => grid.changeRows(-1)}>-</button>
                <span>${el.rows.length}</span>
                ${repeat === undefined
                  ? html`<button class="row-btn" aria-label="${s.rows} +"
                      @click=${() => grid.changeRows(1)}>+</button>`
                  : html`<button class="row-btn" aria-label=${s.addRow}
                      @click=${(event: Event) => grid.toggleListSelect('band-add-row', event)}>+</button>`}
              </div>
            </div>
            <div class="prop-row">
              <label>${s.columns}</label>
              <div class="step-inputs">
                <button class="row-btn" aria-label="${s.columns} -" @click=${() => grid.changeColumns(-1)}>-</button>
                <span>${el.columns.length}</span>
                <button class="row-btn" aria-label="${s.columns} +" @click=${() => grid.changeColumns(1)}>+</button>
              </div>
            </div>
        </div>

        <div class="prop-section">
          <div class="prop-section-title">${s.styleText}</div>
          ${fontNameRow(kit, act,
            el.fontName,
            (v) => act.update((target) => setOptional(target, 'fontName', v)),
            { ariaLabel: `${s.typeGrid} ${s.fontName}`, style: el },
          )}
        </div>

        <div class="prop-section">
          <div class="prop-section-title">${s.repeatSection}</div>
          <div class="prop-row">
            <label>${s.repeatOn}</label>
            <input type="checkbox" aria-label=${s.repeatOn} .checked=${repeat !== undefined}
              @change=${(e: Event) => grid.toggleRepeat((e.target as HTMLInputElement).checked)}>
          </div>
          ${kit.error('repeat-on')}
          ${repeat
            ? html`
              <div class="prop-row">
                <label>${s.parameter}</label>
                ${kit.listSelect({
                  id: 'repeat-parameter',
                  ariaLabel: `${s.repeatSection} ${s.parameter}`,
                  value: repeat.parameter,
                  className: 'parameter-select',
                  options: [
                    ...grid.parameters()
                      .filter((b) => b.valueType === 'list' || b.key === repeat.parameter)
                      .map((b) => ({ value: b.key, label: b.label })),
                    ...(grid.parameters().some((b) => b.key === repeat.parameter)
                      ? []
                      : [{ value: repeat.parameter, label: repeat.parameter }]),
                  ],
                  onPick: (value) => grid.setRepeatParameter(value),
                })}
              </div>
              <div class="prop-row">
                <label>${s.paginationMode}</label>
                <div class="segment" role="radiogroup" aria-label=${s.paginationMode}>
                  <button type="button" role="radio" class=${repeat.pagination.mode === 'auto' ? 'active' : ''}
                    aria-checked=${String(repeat.pagination.mode === 'auto')}
                    @click=${() => grid.setPagination({ mode: 'auto' })}>${s.paginationAuto}</button>
                  <button type="button" role="radio" class=${repeat.pagination.mode === 'fixed' ? 'active' : ''}
                    aria-checked=${String(repeat.pagination.mode === 'fixed')}
                    @click=${() => grid.setPagination({ mode: 'fixed' })}>${s.paginationFixed}</button>
                </div>
              </div>
              ${repeat.pagination.mode === 'auto'
                ? html`
                  <div class="prop-row">
                    <label>${s.minItems}</label>
                    <input type="number" min="0" max=${String(GRID_MAX_ITEMS_UI)}
                      aria-label=${s.minItems}
                      .value=${String(repeat.pagination.minItems)}
                      aria-invalid=${String(kit.hasError('repeat-min-items'))}
                      aria-describedby=${kit.hasError('repeat-min-items') ? 'error-repeat-min-items' : nothing}
                      @change=${(e: Event) => grid.setPagination({ minItems: numberOf(e) })}>
                  </div>
                  ${kit.error('repeat-min-items')}`
                : html`
                  <div class="prop-row">
                    <label>${s.itemsPerPage}</label>
                    <input type="number" min="1" max=${String(GRID_MAX_PER_PAGE_UI)}
                      aria-label=${s.itemsPerPage}
                      .value=${String(repeat.pagination.itemsPerPage)}
                      aria-invalid=${String(kit.hasError('repeat-per-page') || gridPlanError !== null)}
                      aria-describedby=${kit.hasError('repeat-per-page')
                        ? 'error-repeat-per-page'
                        : gridPlanError?.bandId !== undefined ? `grid-plan-error-${gridPlanError.bandId}` : nothing}
                      @change=${(e: Event) => grid.setPagination({ itemsPerPage: numberOf(e) })}>
                  </div>
                  ${kit.error('repeat-per-page')}`}
              <details class="advanced-settings">
                <summary><span>${s.advancedSettings}</span>${icons.down}</summary>
                <div class="advanced-settings-body">
                  <div class="prop-row">
                    <label>${s.repeatMaxItems}</label>
                    <input type="number" min="1" max=${String(GRID_MAX_ITEMS_UI)}
                      aria-label=${s.repeatMaxItems}
                      class=${repeat.maxItems === undefined ? 'dim' : ''}
                      placeholder=${s.repeatMaxItemsNone}
                      .value=${repeat.maxItems === undefined ? '' : String(repeat.maxItems)}
                      aria-invalid=${String(kit.hasError('repeat-max-items'))}
                      aria-describedby=${kit.hasError('repeat-max-items') ? 'error-repeat-max-items' : nothing}
                      @change=${(e: Event) => {
                        const raw = (e.target as HTMLInputElement).value.trim();
                        grid.setRepeatMaxItems(raw === '' ? null : Number(raw));
                      }}>
                  </div>
                  ${kit.error('repeat-max-items')}
                  <div class="prop-row stacked group-fields-row">
                    <label>${s.groupBy}</label>
                    <div class="field-check-list" role="group" aria-label=${s.groupBy}>
                      ${repeatFields.length === 0
                        ? html`<span class="field-check-empty">—</span>`
                        : repeatFields.map((field) => html`
                          <label class="field-check" title=${field.key}>
                            <input type="checkbox" data-field=${field.key}
                              aria-label="${s.groupBy}: ${field.key}"
                              .checked=${repeat.groupBy?.includes(field.key) === true}
                              @change=${(e: Event) => grid.toggleGroupField(
                                field.key,
                                (e.target as HTMLInputElement).checked,
                              )}>
                            <span>${field.title}</span>
                          </label>`)}
                    </div>
                  </div>
                  ${kit.error('repeat-group-by')}
                </div>
              </details>
              ${gridPlanError === null || gridPlanError.bandId !== undefined
                ? nothing
                : html`<div class="input-error" role="alert" id="grid-plan-error">${gridPlanError.message}</div>`}`
            : nothing}
        </div>
        ${repeat === undefined ? nothing : bandList(kit, grid, el)}`;
  return html`
        ${cellTarget === null
          ? gridOwnProps
          : html`
            <button class="grid-back" title=${el.name}
              aria-label="${s.gridBack}: ${el.name}"
              @click=${() => grid.clearCellSelection()}>
              ${icons.pagePrev}
              <span class="grid-back-label">${s.gridBack}</span>
              <span class="grid-back-name">${el.name}</span>
            </button>`}
        ${grid.edit.multiCell
          ? cellStyleSections(kit, act, grid, el, grid.edit.cells)
          : gridCellProps(kit, act, grid, el, cellTarget, cellDef, source, inBand)}
      `;
}

/**
 * 내부 구간 조합 대신 작업 목적으로 행을 추가하는 명령을 렌더링합니다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param grid - 그리드 편집 동작
 * @param el - 선택한 그리드 요소
 * @returns 행 추가 명령 조각
 */
export function gridRowCommands(kit: PanelKit, grid: GridActions, el: GridElement) {
  const s = kit.s;
  const command = grid.edit.rowCommand;
  const fields = grid.parameters()
    .find((parameter) => parameter.key === el.repeat?.parameter)?.fields ?? [];
  const numericFields = fields.filter((field) => field.valueType === 'number');
  const selectedField = numericFields.find((field) => field.key === grid.edit.rowCommandField);
  const definitions: { command: GridRowCommand; label: string; icon: unknown }[] = [
    { command: 'header', label: s.gridCommandHeaderName, icon: icons.up },
    { command: 'group-subtotal', label: s.gridCommandGroupSubtotalName, icon: icons.treeClosed },
    { command: 'page-subtotal', label: s.gridCommandPageSubtotalName, icon: icons.down },
    { command: 'final-total', label: s.gridCommandFinalTotalName, icon: icons.formula },
  ];
  const needsField = command !== null && command !== 'header';
  const groupReady = command !== 'group-subtotal'
    || (el.repeat?.groupBy !== undefined && el.repeat.groupBy.length > 0);
  const fieldReady = !needsField || selectedField !== undefined;
  const location = command === 'header' ? bandLabel(kit.s, 'page-start')
    : command === 'group-subtotal' ? bandLabel(kit.s, 'group-end')
    : command === 'page-subtotal' ? bandLabel(kit.s, 'page-end')
    : bandLabel(kit.s, 'after-data');
  const display = command === 'group-subtotal' ? s.gridCommandEachGroup
    : command === 'page-subtotal' ? s.pagesNonFinal
    : command === 'final-total' ? s.gridCommandOnce
    : s.pagesAll;
  const calculation = command === 'header' ? s.gridCommandNone
    : command === 'group-subtotal'
      ? s.gridCommandGroupCalculation.replace('{field}', selectedField?.title ?? s.gridCommandFieldMissing)
      : command === 'page-subtotal'
        ? s.gridCommandPageCalculation.replace('{field}', selectedField?.title ?? s.gridCommandFieldMissing)
        : s.gridCommandFinalCalculation.replace('{field}', selectedField?.title ?? s.gridCommandFieldMissing);

  return html`
    <div class="prop-subsection-title">${s.gridCommandSection}</div>
    <div class="grid-command-list">
      ${definitions.map((definition) => html`
        <button type="button" data-grid-command=${definition.command}
          aria-pressed=${String(command === definition.command)}
          class=${command === definition.command ? 'selected' : ''}
          @click=${() => {
            if (command === definition.command) {
              grid.edit.clearRowCommand();
            } else {
              grid.openRowCommand(definition.command);
            }
          }}>
          <span>${definition.icon}</span>
          <span>${definition.label}</span>
        </button>`)}
    </div>
    ${command === null
      ? nothing
      : html`<div class="grid-command-editor">
          ${needsField
            ? html`<div class="prop-row">
                <label>${s.gridCommandField}</label>
                ${kit.listSelect({
                  id: 'grid-row-command-field',
                  ariaLabel: s.gridCommandField,
                  value: selectedField?.key ?? '',
                  placeholder: s.gridCommandFieldMissing,
                  options: numericFields.map((field) => ({ value: field.key, label: field.title })),
                  onPick: (value) => { grid.edit.setRowCommandField(value); },
                })}
              </div>`
            : nothing}
          ${!groupReady
            ? html`<div class="grid-command-requirement">${s.gridCommandGroupRequired}</div>`
            : !fieldReady
              ? html`<div class="grid-command-requirement">${s.gridCommandNumberRequired}</div>`
              : nothing}
          <div class="grid-command-preview-title">${s.gridCommandPreview}</div>
          <div class="grid-command-preview" aria-label=${s.gridCommandPreview}>
            <div><span>${s.gridCommandLocation}</span><strong>${location}</strong></div>
            <div><span>${s.gridCommandDisplay}</span><strong>${display}</strong></div>
            <div><span>${s.gridCommandCalculation}</span><strong>${calculation}</strong></div>
          </div>
          ${kit.error('grid-row-command')}
          <div class="grid-command-actions">
            <button type="button"
              @click=${() => grid.edit.clearRowCommand()}>${s.cancel}</button>
            <button type="button" class="primary" ?disabled=${!groupReady || !fieldReady}
              @click=${() => grid.applyRowCommand()}>${s.gridCommandApply}</button>
          </div>
        </div>`}
    <div class="prop-subsection-title band-manual-title">${s.gridCommandManual}</div>
  `;
}

/**
 * 행 구간 목록을 렌더링합니다.
 * 캔버스의 행 번호 선택 영역과 같은 색상 표식·이름으로 구간을 식별합니다 (§7.2).
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param grid - 그리드 편집 동작
 * @param el - 선택한 그리드 요소
 * @returns 행 구간 목록 조각. 반복 설정이 없으면 행 명령만 표시합니다
 */
export function bandList(kit: PanelKit, grid: GridActions, el: GridElement) {
  const s = kit.s;
  const bands = el.repeat?.bands ?? [];
  const planError = grid.planError();
  const errorBandId = planError?.elementId === el.id ? planError.bandId : undefined;
  const selected = grid.edit.bandRange === null
    ? null
    : {
        from: Math.min(grid.edit.bandRange.from, grid.edit.bandRange.to),
        to: Math.max(grid.edit.bandRange.from, grid.edit.bandRange.to),
      };
  const selectedRoles = selected === null
    ? []
    : [...new Set(Array.from(
        { length: selected.to - selected.from + 1 },
        (_, offset) => bandAt(el, selected.from + offset)?.placement,
      ).filter((role): role is GridBandPlacement => role !== undefined))];
  const selectedRole = selectedRoles.length === 1 ? selectedRoles[0]! : '';
  const selectedBand = selected === null
    ? undefined
    : bands.find((band) => band.fromRow === selected.from && band.toRow === selected.to);
  const roleOptions = BAND_PLACEMENTS.map((placement) => ({
    value: placement,
    label: bandLabel(kit.s, placement),
    description: bandDescription(kit.s, placement),
  }));
  return html`
    <div class="prop-section band-list">
      <div class="prop-section-title">${s.bandSection}</div>
      ${gridRowCommands(kit, grid, el)}
      <div class="prop-row">
        <label>${s.addRow}</label>
        ${kit.listSelect({
          id: 'band-add-row',
          ariaLabel: s.addRow,
          value: '',
          placeholder: s.selectRole,
          options: roleOptions,
          onPick: (value) => grid.addRowWithRole(value as GridBandPlacement),
        })}
      </div>
      ${kit.error('band-role')}
      ${bands.map((band) => html`
        <div data-band-id=${band.id}
          class="band-item ${selected?.from === band.fromRow && selected.to === band.toRow ? 'selected' : ''} ${errorBandId === band.id ? 'layout-error' : ''}">
          <button type="button" class="band-item-main"
            title=${band.name === undefined
              ? bandLabel(kit.s, band.placement)
              : `${band.name} · ${bandLabel(kit.s, band.placement)}`}
            aria-pressed=${String(selected?.from === band.fromRow && selected.to === band.toRow)}
            aria-invalid=${errorBandId === band.id ? 'true' : nothing}
            aria-describedby=${errorBandId === band.id ? `grid-plan-error-${band.id}` : nothing}
            @click=${() => {
              grid.edit.selectBand({ from: band.fromRow, to: band.toRow });
              grid.edit.closeBandMenu(false);
              grid.refresh();
            }}>
            <span class="band-swatch placement-${band.placement}"></span>
            <span class="band-icon">${bandIcon(band.placement)}</span>
            <span class="band-label">${band.name ?? bandLabel(kit.s, band.placement)}</span>
            <span class="band-range">${band.fromRow === band.toRow
              ? s.bandRowOne.replace('{row}', String(band.fromRow + 1))
              : s.bandRowRange.replace('{from}', String(band.fromRow + 1)).replace('{to}', String(band.toRow + 1))}</span>
          </button>
          ${errorBandId === band.id
            ? html`<div class="band-plan-error" id="grid-plan-error-${band.id}" role="alert">
                ${planError?.message}
              </div>`
            : nothing}
          ${band.placement === 'page-start' || band.placement === 'page-end'
            ? html`<div class="band-option-row">
                <span>${s.pagePlacementPages}</span>
                ${kit.listSelect({
                  id: `band-pages-${band.id}`,
                  ariaLabel: `${bandLabel(kit.s, band.placement)} ${s.pagePlacementPages}`,
                  value: band.pages ?? 'all',
                  options: [
                    { value: 'all', label: s.pagesAll },
                    { value: 'first', label: s.pagesFirst },
                    { value: 'continuation', label: s.pagesContinuation },
                    { value: 'non-final', label: s.pagesNonFinal },
                    { value: 'last', label: s.pagesLast },
                  ],
                  onPick: (value) => grid.setBandPages(band.id, value as OutputPageFilter),
                })}
              </div>`
            : nothing}
          ${band.placement === 'group-start'
            ? html`<label class="band-repeat-toggle band-option-row">
                <input type="checkbox" .checked=${band.repeatOnPageBreak === true}
                  aria-label=${s.bandRepeatOnBreak}
                  @change=${(e: Event) =>
                    grid.setBandRepeatOnPageBreak(band.id, (e.target as HTMLInputElement).checked)}>
                <span>${s.bandRepeatOnBreak}</span>
              </label>`
            : nothing}
        </div>`)}
      ${selected === null
        ? nothing
        : html`<div class="band-editor">
            <div class="prop-pair">
              <div class="prop-row">
                <label>${s.bandFromRow}</label>
                <input type="number" min="1" max=${String(el.rows.length)}
                  aria-label=${s.bandFromRow}
                  aria-invalid=${String(kit.hasError('band-range'))}
                  aria-describedby=${kit.hasError('band-range') ? 'error-band-range' : nothing}
                  .value=${String(selected.from + 1)}
                  @change=${(e: Event) => grid.setBandSelectionBoundary(
                    'from',
                    Number((e.target as HTMLInputElement).value),
                    selectedBand?.id,
                  )}>
              </div>
              <div class="prop-row">
                <label>${s.bandToRow}</label>
                <input type="number" min="1" max=${String(el.rows.length)}
                  aria-label=${s.bandToRow}
                  aria-invalid=${String(kit.hasError('band-range'))}
                  aria-describedby=${kit.hasError('band-range') ? 'error-band-range' : nothing}
                  .value=${String(selected.to + 1)}
                  @change=${(e: Event) => grid.setBandSelectionBoundary(
                    'to',
                    Number((e.target as HTMLInputElement).value),
                    selectedBand?.id,
                  )}>
              </div>
            </div>
            ${kit.error('band-range')}
            <div class="prop-row">
              <label>${s.bandRole}</label>
              ${kit.listSelect({
                id: 'band-role-editor',
                ariaLabel: s.bandRole,
                value: selectedRole,
                placeholder: s.selectRole,
                options: roleOptions,
                onPick: (value) => grid.setRowBandRole(
                  selected.from,
                  selected.to,
                  value as GridBandPlacement,
                ),
              })}
            </div>
          </div>`}
    </div>`;
}

/**
 * 선택한 그리드 셀의 값, 병합, 글자, 색상, 테두리를 편집하는 패널을 렌더링합니다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param grid - 그리드 편집 동작
 * @param el - 셀이 속한 그리드 요소
 * @param cellTarget - 선택한 셀의 행·열. 선택이 없으면 null
 * @param cellDef - 선택한 셀의 정의. 아직 만들지 않았으면 undefined
 * @param source - 셀이 사용하는 값 소스
 * @param inBand - 선택한 셀이 항목 구간 안인지
 * @returns 셀 편집 패널 조각. 선택한 셀이 없으면 빈 것
 */
export function gridCellProps(
  kit: PanelKit,
  act: ElementActions,
  grid: GridActions,
  el: GridElement,
  cellTarget: { row: number; column: number } | null,
  cellDef: GridCell | undefined,
  source: 'content' | 'parameter' | 'formula',
  inBand: boolean,
) {
  const s = kit.s;
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;
  return cellTarget
    ? html`
        <div class="prop-section">
          <div class="prop-section-title">${s.panelValue}</div>
          <div class="prop-row">
            <label>${s.cellName}</label>
            <input .value=${cellDef?.name ?? ''}
              placeholder=${s.cellNameNone}
              aria-label=${s.cellName}
              @change=${(e: Event) => {
                const name = valOf(e).trim();
                act.update((element) => {
                  if (element.type !== 'grid') return;
                  const record = ensureCell(element, cellTarget.row, cellTarget.column);
                  if (name === '') delete record.name;
                  else record.name = name;
                });
              }}>
          </div>
          <div class="prop-row">
            <label>${s.cellSource}</label>
            ${kit.listSelect({
              id: 'grid-cell-source',
              ariaLabel: s.cellSource,
              value: source,
              options: [
                { value: 'content', label: s.cellSourceText },
                { value: 'parameter', label: s.cellSourceParameter },
                { value: 'formula', label: s.cellSourceFormula },
              ],
              onPick: (value) =>
                grid.chooseCellSource(value as 'content' | 'parameter' | 'formula'),
            })}
          </div>
          ${source === 'content'
            ? html`
              <div class="prop-row">
                <label>${s.content}</label>
                <input .value=${cellDef?.content ?? ''} aria-label=${s.content}
                  @change=${(e: Event) => {
                    grid.edit.selectCell(cellTarget);
                    grid.commitCellContent(valOf(e));
                  }}>
              </div>`
            : source === 'parameter'
              ? html`
                <div class="prop-row">
                  <label>${s.parameter}</label>
                  ${grid.cellParameterSelect(el, cellDef?.parameter ?? '', inBand)}
                </div>`
              : html`
                <div class="prop-row">
                  <label>${s.formula}</label>
                  <input .value=${cellDef?.formula ?? ''} aria-label=${s.formula}
                    aria-invalid=${String(kit.hasError('cell-formula'))}
                    @change=${(e: Event) => {
                      const value = valOf(e);
                      const target = { kind: 'cell', elementId: el.id, ...cellTarget } as const;
                      if (!kit.acceptFormula(target, value, 'cell-formula')) return;
                      grid.setCellSource('formula', value.trim());
                    }}>
                  <button class="row-btn"
                    title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
                    @click=${() => kit.openFormulaModal({ kind: 'cell', elementId: el.id, ...cellTarget })}
                    >${icons.formula}</button>
                </div>
                ${kit.error('cell-formula')}`}
        </div>

        <div class="prop-section">
          <div class="prop-section-title">${s.panelStructure}</div>
          <div class="prop-pair">
            <div class="prop-row">
              <label>${s.rowHeight}</label>
              <input type="number" min="2" step="0.5" aria-label=${s.rowHeight}
                .value=${String(el.rows[cellTarget.row]?.height ?? '')}
                aria-invalid=${String(kit.hasError('cell-row-height'))}
                aria-describedby=${kit.hasError('cell-row-height') ? 'error-cell-row-height' : nothing}
                @change=${(e: Event) =>
                  grid.setTrack('row', cellTarget.row, Number((e.target as HTMLInputElement).value))}>
            </div>
            <div class="prop-row">
              <label>${s.columnWidth}</label>
              <input type="number" min="2" step="0.5" aria-label=${s.columnWidth}
                .value=${String(el.columns[cellTarget.column]?.width ?? '')}
                aria-invalid=${String(kit.hasError('cell-column-width'))}
                aria-describedby=${kit.hasError('cell-column-width') ? 'error-cell-column-width' : nothing}
                @change=${(e: Event) =>
                  grid.setTrack('column', cellTarget.column, Number((e.target as HTMLInputElement).value))}>
            </div>
          </div>
          ${kit.error('cell-row-height')}
          ${kit.error('cell-column-width')}
          <div class="prop-row">
            <label>${s.merge}</label>
            <div class="merge-inputs">
              <span>${s.rows}</span>
              <input type="number" min="1" .value=${String(cellDef?.rowSpan ?? 1)}
                aria-label="${s.merge} ${s.rows}"
                aria-invalid=${String(kit.hasError('cell-row-span'))}
                aria-describedby=${kit.hasError('cell-row-span') ? 'error-cell-row-span' : nothing}
                @change=${(e: Event) => grid.setCellSpan('rowSpan', Number(valOf(e)))}>
              <span>${s.columns}</span>
              <input type="number" min="1" .value=${String(cellDef?.colSpan ?? 1)}
                aria-label="${s.merge} ${s.columns}"
                aria-invalid=${String(kit.hasError('cell-column-span'))}
                aria-describedby=${kit.hasError('cell-column-span') ? 'error-cell-column-span' : nothing}
                @change=${(e: Event) => grid.setCellSpan('colSpan', Number(valOf(e)))}>
            </div>
          </div>
          ${kit.error('cell-row-span')}
          ${kit.error('cell-column-span')}
        </div>

        ${cellStyleSections(kit, act, grid, el, [cellTarget])}
        ${conditionalFormatsSection(kit,
          cellDef?.conditionalFormats,
          'cellCondFmt',
          (next) => grid.updateCellConditionalFormats(next),
          (index) => ({ kind: 'cell-condition', elementId: el.id, ...cellTarget, ruleIndex: index }),
          `${s.cell} `,
        )}`
    : nothing;
}

/**
 * 선택한 셀의 텍스트, 배경과 셀 테두리 설정을 렌더링합니다. 단일 선택과 복수 선택에서 같은 스타일 편집 UI를 사용합니다.
 *
 * @remarks
 * 값은 셀 값, 없으면 그리드 공통값, 그것도 없으면 렌더러 기본값을 실제 적용값으로 보고
 * 서로 다르면 「혼합」으로 표시합니다. 고른 값은 모든 선택 셀에 적용하되 그리드 공통값과 같은
 * 값은 저장하지 않고 물려받게 합니다. 기본값으로 되돌리기만 셀별 값을 지웁니다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param grid - 그리드 편집 동작
 * @param el - 선택한 그리드 요소
 * @param targets - 선택한 셀 좌표 목록 (하나 이상)
 * @returns 스타일 구역 세 개
 */
export function cellStyleSections(
  kit: PanelKit,
  act: ElementActions,
  grid: GridActions,
  el: GridElement,
  targets: readonly { row: number; column: number }[],
) {
  const s = kit.s;
  const records = cellRecordsOf(el, targets);
  const summary = <T,>(pick: (cell: GridCell) => T | undefined, inherited: T) =>
    summarizeCellValue(records, pick, inherited);
  // 그리드 공통값과 같은 값은 저장하지 않아 그대로 물려받습니다.
  const applyRelative = (key: string, value: unknown, gridValue: unknown): void =>
    grid.updateCellStyle(key, Object.is(value, gridValue) ? null : value);
  // 셀에 설정이 없을 때 적용되는 셀 기본 테두리 — 이전 파일의 border*도 반영합니다.
  const cellDefault = cellDefaultBorderOf(el);

  const fontName = summary((cell) => cell.fontName, el.fontName);
  const fontSize = summary((cell) => cell.fontSize, el.fontSize ?? DEFAULT_FONT_SIZE);
  const overflow = summary((cell) => cell.overflow, undefined as 'clip' | 'shrink' | undefined);
  const gridAlignment = el.alignment ?? 'left';
  const alignment = summary((cell) => cell.alignment, gridAlignment);
  const gridVerticalAlignment = el.verticalAlignment ?? 'top';
  const verticalAlignment = summary((cell) => cell.verticalAlignment, gridVerticalAlignment);
  const lineHeight = summary((cell) => cell.lineHeight, el.lineHeight ?? 1);
  const characterSpacing = summary((cell) => cell.characterSpacing, el.characterSpacing ?? 0);
  const emphasisKeys: readonly TextEmphasisKey[] = ['bold', 'italic', 'underline', 'strikethrough'];
  const emphasis = {
    bold: summary((cell) => cell.bold, el.bold === true),
    italic: summary((cell) => cell.italic, el.italic === true),
    underline: summary((cell) => cell.underline, el.underline === true),
    strikethrough: summary((cell) => cell.strikethrough, el.strikethrough === true),
  };
  const mixedEmphasis = new Set(emphasisKeys.filter((key) => emphasis[key].mixed));
  const fontColor = summary((cell) => cell.fontColor, el.fontColor ?? DEFAULT_FONT_COLOR);
  const backgroundColor = summary((cell) => cell.backgroundColor, el.backgroundColor);
  const borderColor = summary((cell) => cell.borderColor, cellDefault.color);
  const borderWidth = summary((cell) => cell.borderWidth, cellDefault.width);
  const borderStyle = summary((cell) => cell.borderStyle, cellDefault.style);
  // 변형 글꼴 안내는 실제 적용값으로 판정합니다.
  const effectiveStyle = {
    fontName: fontName.effective,
    bold: emphasis.bold.effective,
    italic: emphasis.italic.effective,
  };

  const alignGroup = <V extends string>(
    label: string,
    key: 'alignment' | 'verticalAlignment',
    options: readonly (readonly [V, string, unknown])[],
    state: { mixed: boolean; effective: V | undefined },
    gridValue: V,
  ) => html`
          <div class="prop-row">
            <label>${label}</label>
            <div class="toggle-group" role="group" aria-label="${s.cell} ${label}">
              ${options.map(([value, name, glyph]) => html`
                <button title=${name} aria-label="${s.cell} ${label}: ${name}"
                  aria-pressed=${String(!state.mixed && state.effective === value)}
                  @click=${() => applyRelative(key, value, gridValue)}>${glyph}</button>`)}
            </div>
            ${resetButton(kit, `${s.cell} ${label}`, () => grid.resetCellStyles([key]))}
          </div>`;

  return html`
        <div class="prop-section">
          <div class="prop-section-title">${s.styleText}</div>
          ${fontNameRow(kit, act,
            fontName.stored,
            (v) => grid.updateCellStyle('fontName', v),
            {
              ariaLabel: `${s.cell} ${s.fontName}`,
              inherit: cellInheritOption(kit, act.fonts, el.fontName),
              style: effectiveStyle,
              mixed: fontName.mixed,
            },
          )}
          ${numberRow(kit,
            s.fontSize, fontSize.stored, el.fontSize ?? DEFAULT_FONT_SIZE,
            (v) => grid.updateCellStyle('fontSize', v),
            { step: '0.5', min: '0.5', ariaLabel: `${s.cell} ${s.fontSize}`, errorKey: 'cell-font-size', mixed: fontSize.mixed },
          )}
          ${gridOverflowRow(kit, {
            id: 'grid-cell-overflow',
            value: overflow.mixed ? 'mixed' : overflow.stored ?? 'inherit',
            inherit: true,
            ariaLabel: `${s.cell} ${s.overflow}`,
            onPick: (value) =>
              grid.updateCellStyle('overflow', value === 'inherit' ? null : value),
          })}
          ${alignGroup(s.alignment, 'alignment', [
            ['left', s.alignLeft, icons.alignLeft],
            ['center', s.alignCenter, icons.alignCenter],
            ['right', s.alignRight, icons.alignRight],
          ] as const, alignment, gridAlignment)}
          ${alignGroup(s.verticalAlignment, 'verticalAlignment', [
            ['top', s.alignTop, icons.alignTop],
            ['middle', s.alignMiddle, icons.alignMiddle],
            ['bottom', s.alignBottom, icons.alignBottom],
          ] as const, verticalAlignment, gridVerticalAlignment)}
          ${numberRow(kit,
            s.lineHeight, lineHeight.stored, el.lineHeight ?? 1,
            (v) => grid.updateCellStyle('lineHeight', v),
            { step: '0.1', min: '0.1', ariaLabel: `${s.cell} ${s.lineHeight}`, errorKey: 'cell-line-height', mixed: lineHeight.mixed },
          )}
          ${numberRow(kit,
            s.characterSpacing, characterSpacing.stored, el.characterSpacing ?? 0,
            (v) => grid.updateCellStyle('characterSpacing', v),
            { step: '0.1', ariaLabel: `${s.cell} ${s.characterSpacing}`, errorKey: 'cell-character-spacing', mixed: characterSpacing.mixed },
          )}
          ${textStyleToggles(kit,
            {
              bold: emphasis.bold.effective,
              italic: emphasis.italic.effective,
              underline: emphasis.underline.effective,
              strikethrough: emphasis.strikethrough.effective,
            },
            (key, value) => applyRelative(key, value, el[key] === true),
            `${s.cell} `,
            {
              keys: emphasisKeys,
              mixed: mixedEmphasis,
              onReset: () => grid.resetCellStyles(emphasisKeys),
            },
          )}
          ${fontName.mixed || emphasis.bold.mixed || emphasis.italic.mixed
            ? nothing
            : fontVariantNote(kit, act.fonts, effectiveStyle)}
          ${colorControl(kit,
            s.fontColor, fontColor.stored, 'cellFontColor',
            (v) => grid.updateCellStyle('fontColor', v),
            el.fontColor ?? DEFAULT_FONT_COLOR,
            `${s.cell} ${s.fontColor}`,
            { mixed: fontColor.mixed },
          )}
        </div>

        <div class="prop-section">
          <div class="prop-section-title">${s.styleBackground}</div>
          ${colorControl(kit,
            s.backgroundColor, backgroundColor.stored, 'cellBackgroundColor',
            (v) => grid.updateCellStyle('backgroundColor', v),
            undefined,
            `${s.cell} ${s.backgroundColor}`,
            { mixed: backgroundColor.mixed },
          )}
        </div>

        <div class="prop-section">
          <div class="prop-section-title">${s.styleCellBorder}</div>
          ${colorControl(kit,
            s.borderColor, borderColor.stored, 'cellBorderColor',
            (v) => grid.updateCellStyle('borderColor', v),
            cellDefault.color,
            `${s.cell} ${s.borderColor}`,
            { mixed: borderColor.mixed },
          )}
          ${borderWidthSelect(kit,
            borderWidth.stored,
            cellDefault.width,
            true,
            'cellBorderWidth',
            (v) => applyRelative('borderWidth', v, cellDefault.width),
            undefined,
            { mixed: borderWidth.mixed },
          )}
          ${borderShapeRow(kit,
            borderStyle.stored,
            `${s.cell} ${s.borderShape}`,
            'cellBorderStyle',
            (v) => applyRelative('borderStyle', v, cellDefault.style),
            {
              fallback: cellDefault.style,
              mixed: borderStyle.mixed,
              resetTarget: s.styleCellBorder,
              onReset: () => grid.resetCellStyles(['borderColor', 'borderWidth', 'borderStyle']),
            },
          )}
        </div>`;
}
