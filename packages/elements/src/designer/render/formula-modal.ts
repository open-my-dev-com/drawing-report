/**
 * 수식 편집 모달 — 편집 대상, 수식 입력과 검사 결과, 함수·값 참조.
 *
 * @remarks
 * 대상은 모달을 열 때 확정합니다. 이 모듈은 선택 상태를 보지 않고 컴포넌트가 넘긴
 * {@link FormulaModalView}만 그립니다.
 */

import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { GridCell, SlipElement } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { getFormulaHelp, type FormulaHelpEntry } from '../../formula-help.js';
import { formulaPreviewText } from './sample-values.js';
import type { FormulaCheck } from '../formula-check.js';
import type { ItemChoice, ReservedAvailability, ReservedBlockReason } from '../formula-context.js';
import type { FormulaTarget } from '../formula-target.js';
import type { DesignerStrings } from '../../strings.js';
import type { DialogContext } from './dialogs.js';

/** 모달이 표시하는 편집 대상 */
export interface FormulaTargetView {
  /** 편집 대상 식별 정보 */
  target: FormulaTarget;
  /** 대상 요소 */
  element: SlipElement;
  /** 그리드 셀 대상이면 그 셀 */
  cell?: GridCell;
  /** 조건부 서식의 조건식인지 */
  condition: boolean;
  /** 미리 계산에 쓰는 항목이 놓인 출력 페이지 (0부터). 계획이 없으면 null */
  outputPage: number | null;
  /** 미리 계산에 쓰는 항목이 속한 그룹 (0부터). 그룹 설정이 없으면 null */
  groupIndex: number | null;
}

/** 수식 모달이 화면을 그리는 데 필요한 상태 */
export interface FormulaModalView {
  /**
   * 편집 대상. 대상이 지워졌거나 모달을 연 뒤 내용이 바뀌었으면 null이며,
   * 이때 `check`는 `target-changed`입니다.
   */
  target: FormulaTargetView | null;
  /** 지금 초안의 검사 결과 */
  check: FormulaCheck;
  /** 고를 수 있는 샘플 항목 수 */
  itemCount: number;
  /** 지금 고른 샘플 항목의 자리. 반복 그리드가 아니면 null */
  currentItem: ItemChoice | null;
  /** 예약 참조별 사용 가능 여부 */
  reserved: ReservedAvailability[];
}

/** 예약 참조를 쓸 수 없는 이유별 안내 문구 */
function reasonText(s: DesignerStrings, reason: ReservedBlockReason): string {
  switch (reason) {
    case 'not-repeat': return s.reservedNeedRepeat;
    case 'no-item': return s.reservedNoItem;
    case 'no-group': return s.reservedNoGroup;
    case 'no-plan': return s.reservedNoPlan;
  }
}

/** 자리표시자를 채운 문구를 만듭니다. */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

/** 편집 대상을 한 줄로 설명합니다. */
function targetText(d: DialogContext, view: FormulaTargetView): string {
  const s = d.s;
  const parts = [d.typeName(view.element.type), view.element.name];
  if (view.cell !== undefined) {
    parts.push(
      view.cell.name ??
        fill(s.formulaCellAt, { row: view.cell.row + 1, column: view.cell.column + 1 }),
    );
  }
  const target = view.target;
  if (target.kind === 'element-condition' || target.kind === 'cell-condition') {
    parts.push(fill(s.formulaConditionAt, { index: target.ruleIndex + 1 }));
  } else {
    parts.push(s.formula);
  }
  return parts.join(' · ');
}

/** 지금 고른 샘플 항목이 놓인 자리를 한 줄로 설명합니다. */
function itemChoiceText(s: DesignerStrings, choice: ItemChoice): string {
  const parts = [fill(s.formulaItemAt, { index: choice.index + 1 })];
  if (choice.outputPage !== undefined) {
    parts.push(fill(s.formulaOutputPageAt, { page: choice.outputPage + 1 }));
  }
  if (choice.groupIndex !== undefined) {
    parts.push(fill(s.formulaGroupAt, { group: choice.groupIndex + 1 }));
  }
  return parts.join(' · ');
}

/**
 * 검사 결과를 표시할 문구와 심각도를 만듭니다.
 *
 * @param s - 로케일에 맞는 문구
 * @param check - 표시할 검사 결과
 * @param emptyAllowed - 비어 있어도 적용할 수 있는 대상인지
 * @returns 표시 문구와 오류로 볼지 여부
 */
export function formulaCheckText(s: DesignerStrings, check: FormulaCheck, emptyAllowed: boolean): {
  text: string;
  error: boolean;
} {
  switch (check.status) {
    case 'empty':
      return emptyAllowed
        ? { text: s.formulaCellEmptyHint, error: false }
        : { text: s.formulaRequired, error: true };
    case 'syntax-error':
      return { text: `${s.syntaxError}${check.detail ? `: ${check.detail}` : ''}`, error: true };
    case 'not-boolean':
      return { text: s.conditionNotBoolean, error: true };
    case 'not-computable':
      return {
        text: `${s.previewUnavailable}${check.detail ? `: ${check.detail}` : ''}`,
        error: false,
      };
    case 'target-changed':
      return { text: s.formulaTargetChanged, error: true };
    case 'ok':
      return { text: `${s.previewResult}: ${formulaPreviewText(check.value ?? null)}`, error: false };
  }
}

/**
 * 수식 편집 모달을 렌더링합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 수식 모달. 열려 있지 않으면 빈 것
 */
export function formulaModal(d: DialogContext) {
  if (!d.dialogs.isOpen('formula')) return nothing;
  const s = d.s;
  const view = d.formulaView();
  const close = (): void => d.closeFormula();

  return html`
    <div class="menu-backdrop modal-backdrop" @click=${close}></div>
    <div class="modal formula-modal" role="dialog" aria-modal="true" tabindex="-1"
      aria-label=${s.formulaModalTitle}
      @keydown=${(e: KeyboardEvent) => d.modalFocus.handleKeydown(e, close)}>
      <div class="modal-head">
        <span>${s.formulaModalTitle}</span>
        <button class="modal-close" title=${s.close} aria-label=${s.close}
          @click=${close}>${icons.close}</button>
      </div>
      <div class="formula-layout">
        <div class="formula-editor">${editorColumn(d, view)}</div>
        <div class="formula-reference">${functionSection(d)}${valueSection(d, view)}</div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click=${close}>${s.cancel}</button>
        <button class="btn primary" ?disabled=${!view.check.applicable}
          @click=${() => d.applyFormula()}>${s.apply}</button>
      </div>
    </div>
  `;
}

/** 편집 대상, 수식 입력, 검사 결과와 샘플 항목 선택을 렌더링합니다. */
function editorColumn(d: DialogContext, view: FormulaModalView) {
  const s = d.s;
  const emptyAllowed = view.target?.target.kind === 'cell';
  const result = formulaCheckText(s, view.check, emptyAllowed);

  return html`
    ${view.target === null
      ? nothing
      : html`<div class="formula-target">
          <span class="formula-target-label">${s.formulaTargetSection}</span>
          <span class="formula-target-name">${targetText(d, view.target)}</span>
        </div>`}
    <textarea class="formula-input" rows="4" spellcheck="false"
      aria-label=${view.target?.condition === true ? s.condition : s.formula}
      .value=${live(d.formula.draft)}
      @input=${(e: Event) => {
        const input = e.target as HTMLTextAreaElement;
        d.formula.setDraft(input.value, input.selectionStart);
      }}
      @keyup=${(e: Event) => d.formula.syncCaret((e.target as HTMLTextAreaElement).selectionStart)}
      @click=${(e: Event) => d.formula.syncCaret((e.target as HTMLTextAreaElement).selectionStart)}></textarea>
    <div id="formula-status" class="formula-status ${result.error ? 'error' : ''}"
      role="status" aria-live="polite" tabindex="-1">${result.text}</div>
    ${columnSuggestions(d)}
    <div class="formula-hint">${s.formulaQuoteHint}</div>
    ${sampleItemPicker(d, view)}
  `;
}

/**
 * 반복 그리드의 미리 계산에 쓸 샘플 항목을 고르는 자리를 렌더링합니다.
 *
 * 항목 이름을 훑는 곳이 아니라 번호를 고르는 곳이라, 항목이 몇 개든 조작부 수가 같은
 * 번호 입력과 이전·다음 버튼으로 만듭니다.
 */
function sampleItemPicker(d: DialogContext, view: FormulaModalView) {
  // 고를 것이 하나뿐이면 선택지를 두지 않습니다.
  const current = view.currentItem;
  if (current === null || view.itemCount < 2) return nothing;
  const s = d.s;
  /** 범위를 벗어나거나 정수가 아닌 항목 번호를 실제 항목으로 맞춥니다. */
  const clamp = (to: number): number => Math.min(Math.max(Math.round(to), 0), view.itemCount - 1);
  /** 입력한 글을 항목 번호로 읽습니다. 비어 있거나 숫자가 아니면 고른 항목을 유지합니다. */
  const parse = (typed: string): number => {
    if (typed.trim() === '') return current.index;
    const value = Number(typed);
    return Number.isFinite(value) ? clamp(value - 1) : current.index;
  };

  return html`
    <div class="modal-section-title">${s.formulaSampleItem}</div>
    <div class="formula-items" role="group" aria-label=${s.formulaSampleItem}>
      <button class="row-btn" title=${s.formulaPrevItem} aria-label=${s.formulaPrevItem}
        ?disabled=${current.index === 0}
        @click=${() => d.formula.selectItem(clamp(current.index - 1))}>${icons.pagePrev}</button>
      <input type="number" class="formula-item-no" min="1" max=${view.itemCount} step="1"
        aria-label=${s.formulaSampleItem} .value=${live(String(current.index + 1))}
        @change=${(e: Event) => {
          const input = e.target as HTMLInputElement;
          const next = parse(input.value);
          // 고른 항목이 그대로면 다시 그리지 않으므로 입력란을 여기서 맞춥니다.
          input.value = String(next + 1);
          d.formula.selectItem(next);
        }}>
      <span class="formula-item-total">/ ${view.itemCount}</span>
      <button class="row-btn" title=${s.formulaNextItem} aria-label=${s.formulaNextItem}
        ?disabled=${current.index === view.itemCount - 1}
        @click=${() => d.formula.selectItem(clamp(current.index + 1))}>${icons.pageNext}</button>
      <span class="formula-item-where">${itemChoiceText(s, current)}</span>
    </div>
  `;
}

/** 함수 검색, 분류, 검색 결과와 상세를 렌더링합니다. */
function functionSection(d: DialogContext) {
  const s = d.s;
  const categories = getFormulaHelp(d.locale);
  const query = d.formula.query.trim().toLowerCase();
  const category = d.formula.category;
  const matches = categories
    .filter((group) => category === null || group.title === category)
    .flatMap((group) => group.functions)
    .filter((fn) => query === '' || [fn.name, fn.signature, fn.description]
      .some((text) => text.toLowerCase().includes(query)));
  const picked = matches.find((fn) => fn.name === d.formula.picked);

  return html`
    <div class="modal-section-title">${s.formulaFunctions}</div>
    <input class="formula-search" type="search" placeholder=${s.formulaSearch}
      aria-label=${s.formulaSearch} .value=${live(d.formula.query)}
      @input=${(e: Event) => d.formula.setQuery((e.target as HTMLInputElement).value)}>
    <div class="fn-categories" role="group" aria-label=${s.formulaFunctions}>
      <button class="fn-chip ${category === null ? 'selected' : ''}"
        aria-pressed=${String(category === null)}
        @click=${() => d.formula.setCategory(null)}>${s.formulaAllCategories}</button>
      ${categories.map((group) => html`
        <button class="fn-chip ${group.title === category ? 'selected' : ''}"
          aria-pressed=${String(group.title === category)}
          @click=${() => d.formula.setCategory(group.title)}>${group.title}</button>`)}
    </div>
    <div class="fn-list">
      ${matches.length === 0
        ? html`<p class="image-hint">${s.formulaSearchEmpty}</p>`
        : matches.map((fn) => html`
          <button class="fn-row ${fn.name === d.formula.picked ? 'selected' : ''}"
            aria-label=${fn.name} aria-pressed=${String(fn.name === d.formula.picked)}
            @click=${() => d.formula.pick(fn.name)}>
            <span class="fn-signature">${fn.signature}</span>
            <span class="fn-desc">${fn.description}</span>
          </button>`)}
    </div>
    ${picked === undefined ? nothing : functionDetail(d, picked)}
  `;
}

/** 고른 함수의 인자와 반환값 설명, 삽입 버튼을 렌더링합니다. */
function functionDetail(d: DialogContext, fn: FormulaHelpEntry) {
  const s = d.s;
  return html`
    <div class="fn-detail">
      <div class="fn-detail-head">
        <span class="fn-signature">${fn.signature}</span>
        <button class="btn primary" @click=${() => d.formula.insert(`${fn.name}(`, ')')}>
          ${s.formulaInsert}
        </button>
      </div>
      <p class="fn-desc">${fn.description}</p>
      ${fn.args.length === 0
        ? nothing
        : html`
          <div class="fn-detail-title">${s.formulaArguments}</div>
          <dl class="fn-args">
            ${fn.args.map((arg) => html`
              <dt>${arg.name}${arg.variadic === true ? ', …' : ''}${
                arg.optional === true
                  ? html`<span class="fn-optional">${s.formulaOptionalArgument}</span>`
                  : nothing
              }</dt>
              <dd>${arg.description}</dd>`)}
          </dl>`}
      <div class="fn-detail-title">${s.formulaReturns}</div>
      <p class="fn-desc">${fn.returns}</p>
    </div>
  `;
}

/** 파라미터, 하위 필드와 예약 참조 목록을 렌더링합니다. */
function valueSection(d: DialogContext, view: FormulaModalView) {
  const s = d.s;
  const parameters = d.parameters();
  const blocked = view.reserved.filter(
    (ref): ref is ReservedAvailability & { reason: ReservedBlockReason } =>
      !ref.usable && ref.reason !== undefined,
  );
  return html`
    <div class="modal-section-title">${s.formulaValues}</div>
    ${parameters.length === 0
      ? nothing
      : html`
        <div class="parameter-chips">
          ${parameters.map((b) => html`
            <button class="parameter-chip" title="${b.key}${b.valueType ? ` (${b.valueType})` : ''}"
              @click=${() => d.formula.insert(b.key)}>${b.label}${
                b.valueType ? html`<span class="chip-type">${b.valueType}</span>` : nothing
              }</button>
            ${b.fields.map((field) => html`
              <button class="parameter-chip column" title="${b.key}.${field.key}"
                @click=${() => d.formula.insert(`${b.key}.${field.key}`)}
                >${field.title}</button>`)}`)}
        </div>`}
    ${view.reserved.length === 0
      ? nothing
      : html`
        <div class="modal-section-title">${s.formulaReserved}</div>
        <div class="parameter-chips">
          ${view.reserved.map((ref) => html`
            <button class="parameter-chip reserved" ?disabled=${!ref.usable}
              title=${ref.usable || ref.reason === undefined ? ref.name : reasonText(s, ref.reason)}
              @click=${() => d.formula.insert(ref.name)}>${ref.name}</button>`)}
        </div>
        ${blocked.length === 0
          ? nothing
          : html`<ul class="formula-reserved-reasons">
              ${blocked.map((ref) => html`
                <li><code>${ref.name}</code> ${reasonText(s, ref.reason)}</li>`)}
            </ul>`}`}
  `;
}

/**
 * 목록 파라미터의 하위 필드 자동완성 항목을 렌더링합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 자동완성 목록. 후보가 없으면 빈 것
 */
export function columnSuggestions(d: DialogContext) {
  const suggestion = d.formula.suggestion(d.parameters());
  if (!suggestion) return nothing;
  const s = d.s;

  return html`
    <div class="formula-suggest" role="group" aria-label=${s.formulaColumnSuggest}>
      <span class="formula-suggest-label">${s.formulaColumnSuggest}</span>
      ${suggestion.columns.map((col) => html`
        <button class="parameter-chip column" title=${col.key}
          @click=${() => d.formula.insert(col.key.slice(suggestion.typedLength))}
          >${col.title ? `${col.title} · ${col.key}` : col.key}</button>`)}
    </div>
  `;
}
