/**
 * 수식 편집 모달 — 위쪽에 편집 대상, 수식 입력과 검사 결과를, 아래쪽에 함수·값 참조를 둡니다.
 *
 * @remarks
 * 대상은 모달을 열 때 확정합니다. 이 모듈은 선택 상태를 보지 않고 컴포넌트가 넘긴
 * {@link FormulaModalView}만 그립니다.
 */

import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { formatReferencePath, type GridCell, type SlipElement } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { getFormulaHelp, type FormulaHelpEntry } from '../../formula-help.js';
import { formulaPreviewText } from './sample-values.js';
import type { FormulaCheck } from '../formula-check.js';
import type { ItemChoice, ReservedAvailability, ReservedBlockReason } from '../formula-context.js';
import { describeFormulaTarget, type FormulaTarget } from '../formula-target.js';
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

/** 반복 데이터 범위를 쓸 수 없는 이유별 안내 문구 */
function reasonText(s: DesignerStrings, reason: ReservedBlockReason): string {
  switch (reason) {
    case 'not-repeat': return s.reservedNeedRepeat;
    case 'no-item': return s.reservedNoItem;
    case 'no-group': return s.reservedNoGroup;
    case 'no-plan': return s.reservedNoPlan;
  }
}

/** 반복 데이터 범위의 사용자 이름 — 코드 이름만으로는 뜻을 알 수 없습니다 */
function reservedLabel(s: DesignerStrings, name: string): string {
  switch (name) {
    case '@item': return s.formulaReservedItem;
    case '@group': return s.formulaReservedGroup;
    case '@page': return s.formulaReservedPage;
    case '@all': return s.formulaReservedAll;
    case '@carried': return s.formulaReservedCarried;
    default: return name;
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
  return describeFormulaTarget(d.s, (type) => d.typeName(type), view.target, view);
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

/** 검사 결과를 어떤 상태로 보여 줄지 — 색만이 아니라 제목과 문구가 뜻을 설명합니다 */
export type FormulaCheckTone = 'ok' | 'notice' | 'warning' | 'error';

/** 검사 결과를 표시할 상태, 제목과 내용 */
export interface FormulaCheckText {
  /** 상태 제목 */
  title: string;
  /** 결과 값이나 그렇게 판정한 까닭 */
  text: string;
  /** 적용은 할 수 있음을 알리는 덧붙임. 없으면 빈 값 */
  hint?: string;
  /** 표시 상태 */
  tone: FormulaCheckTone;
}

/**
 * 검사 결과를 표시할 상태 제목과 내용으로 바꿉니다.
 *
 * @param s - 로케일에 맞는 문구
 * @param check - 표시할 검사 결과
 * @param emptyAllowed - 비어 있어도 적용할 수 있는 대상인지
 * @returns 상태 제목, 내용과 표시 상태
 */
export function formulaCheckText(
  s: DesignerStrings,
  check: FormulaCheck,
  emptyAllowed: boolean,
): FormulaCheckText {
  /** 원인 문구가 있으면 괄호로 덧붙입니다. */
  const withDetail = (text: string): string => (check.detail ? `${text} (${check.detail})` : text);
  const error = (text: string): FormulaCheckText =>
    ({ title: s.formulaStatusError, text, tone: 'error' });
  // 계산에 실패했지만 적용할 수 있는 상태 — 저장 뒤 요소에 남는 경고를 함께 알립니다.
  const warning = (): FormulaCheckText => ({
    title: s.formulaStatusWarning,
    text: check.detail ?? s.formulaCannotCalculate,
    hint: s.formulaWarningHint,
    tone: 'warning',
  });

  switch (check.status) {
    case 'empty':
      return emptyAllowed
        ? { title: s.formulaStatusEmpty, text: s.formulaCellEmptyHint, tone: 'notice' }
        : error(s.formulaRequired);
    case 'syntax-error':
      return error(withDetail(s.syntaxError));
    case 'formula-error':
    case 'not-computable':
      return warning();
    case 'not-boolean':
      return error(s.conditionNotBoolean);
    case 'target-changed':
      return error(s.formulaTargetChanged);
    case 'ok':
      return { title: s.previewResult, text: formulaPreviewText(check.value ?? null), tone: 'ok' };
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
        <div class="formula-editor">${editorArea(d, view)}</div>
        <div class="formula-reference">${referenceArea(d, view)}</div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click=${close}>${s.cancel}</button>
        <button class="btn primary" ?disabled=${!view.check.applicable}
          @click=${() => d.applyFormula()}>${s.apply}</button>
      </div>
    </div>
  `;
}

/**
 * 편집 대상, 수식 입력, 검사 결과와 샘플 항목 선택을 렌더링합니다.
 *
 * 수식 작성이 이 모달의 주 작업이라 모달 너비 전체를 입력란에 주고, 검사 결과는 입력란
 * 바로 아래에 두어 고친 결과를 시선을 옮기지 않고 확인할 수 있게 합니다.
 */
function editorArea(d: DialogContext, view: FormulaModalView) {
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
    <div id="formula-status" class="formula-status ${result.tone}"
      role="status" aria-live="polite" tabindex="-1">
      <span class="formula-status-title">${result.title}</span>
      <span class="formula-status-text">${result.text}</span>
      ${result.hint === undefined
        ? nothing
        : html`<span class="formula-status-hint">${result.hint}</span>`}
    </div>
    ${columnSuggestions(d)}
    <div class="formula-hint">${s.formulaQuoteHint}</div>
    ${sampleItemPicker(d, view)}
  `;
}

/**
 * 참조 영역을 렌더링합니다.
 *
 * 함수는 골라서 상세를 본 뒤 삽입하고 값은 누르면 바로 들어가므로, 조작이 다른 둘을
 * 탭으로 나눠 무엇을 하는 자리인지 분명히 합니다.
 */
function referenceArea(d: DialogContext, view: FormulaModalView) {
  const s = d.s;
  const tab = d.formula.tab;
  const tabButton = (value: 'functions' | 'values', label: string) => html`
    <button class="formula-tab" role="tab" aria-selected=${String(tab === value)}
      @click=${() => d.formula.setTab(value)}>${label}</button>`;

  return html`
    <div class="modal-tabs" role="tablist" aria-label=${s.formulaModalTitle}>
      ${tabButton('functions', s.formulaFunctionsTab)}
      ${tabButton('values', s.formulaValuesTab)}
    </div>
    <div class="formula-tabpanel ${tab}" role="tabpanel">
      ${tab === 'functions' ? functionSection(d) : valueSection(d, view)}
    </div>
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

/**
 * 함수 검색, 분류, 검색 결과와 상세를 렌더링합니다.
 *
 * 함수를 고르기 전에는 검색·분류·목록이 참조 영역 전체를 쓰고, 고르면 그 옆(좁은 모달은
 * 아래)에 상세를 폅니다. 상세만 조건부로 그리므로 다른 함수를 골라도 목록은 다시 만들지
 * 않아 스크롤 위치가 남고, 목록과 상세는 각자 안에서 스크롤해 입력란과 하단 버튼을 밀지
 * 않습니다.
 */
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
    <div class="fn-panel ${picked === undefined ? '' : 'with-detail'}">
      <div class="fn-browse">
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
      </div>
      ${picked === undefined
        ? nothing
        : html`<div class="fn-detail">${functionDetail(d, picked)}</div>`}
    </div>
  `;
}

/** 고른 함수의 이름, 사용 형식, 설명, 인자와 반환값, 삽입 버튼을 렌더링합니다. */
function functionDetail(d: DialogContext, fn: FormulaHelpEntry) {
  const s = d.s;
  return html`
    <div class="fn-detail-name">${fn.name}</div>
    <div class="fn-signature">${fn.signature}</div>
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
    <button class="btn fn-insert" @click=${() => d.formula.insert(`${fn.name}(`, ')')}>
      ${s.formulaInsert}
    </button>
  `;
}

/**
 * 값 한 줄을 렌더링합니다.
 *
 * 표시 이름과 함께 실제로 삽입될 참조를 화면에 두어 무엇이 들어가는지 보고 알 수 있게
 * 합니다. 값은 `$(...)` 참조로 넣고 예약 참조 이름은 그대로 넣습니다. 쓸 수 없는 줄은
 * 흐리게 두되 이름과 참조는 그대로 읽힙니다.
 */
function valueRow(options: {
  name: string;
  code: string;
  reason?: string;
  disabled?: boolean;
  insert: () => void;
}) {
  return html`
    <button class="value-row" ?disabled=${options.disabled === true} @click=${options.insert}>
      <span class="value-name">${options.name}</span>
      <span class="value-code">${options.code}</span>
      ${options.reason === undefined
        ? nothing
        : html`<span class="value-reason">${options.reason}</span>`}
    </button>
  `;
}

/** 일반 값, 목록 항목의 필드와 반복 데이터 범위를 세 구역으로 렌더링합니다. */
function valueSection(d: DialogContext, view: FormulaModalView) {
  const s = d.s;
  const parameters = d.parameters();
  const fields = parameters.flatMap((b) => b.fields.map((field) => ({ parameter: b, field })));
  const blocked = view.reserved.filter(
    (ref): ref is ReservedAvailability & { reason: ReservedBlockReason } =>
      !ref.usable && ref.reason !== undefined,
  );
  // 모두 같은 이유로 막혔으면 이유를 목록 위에 한 번만 적습니다.
  const sharedReason = blocked.length === view.reserved.length && view.reserved.length > 0
    && blocked.every((ref) => ref.reason === blocked[0]!.reason)
    ? blocked[0]!.reason
    : null;

  return html`
    ${parameters.length === 0
      ? nothing
      : html`
        <div class="modal-section-title">${s.formulaValues}</div>
        <div class="value-list">
          ${parameters.map((b) => valueRow({
            name: b.label,
            code: formatReferencePath([b.key]),
            insert: () => d.formula.insertReference([b.key]),
          }))}
        </div>`}
    ${fields.length === 0
      ? nothing
      : html`
        <div class="modal-section-title">${s.formulaItemFields}</div>
        <div class="value-list">
          ${fields.map(({ parameter, field }) => valueRow({
            name: field.title,
            code: formatReferencePath([parameter.key, field.key]),
            insert: () => d.formula.insertReference([parameter.key, field.key]),
          }))}
        </div>`}
    ${view.reserved.length === 0
      ? nothing
      : html`
        <div class="modal-section-title">${s.formulaReserved}</div>
        ${sharedReason === null
          ? nothing
          : html`<p class="image-hint">${reasonText(s, sharedReason)}</p>`}
        <div class="value-list reserved-list">
          ${view.reserved.map((ref) => valueRow({
            name: reservedLabel(s, ref.name),
            code: ref.name,
            disabled: !ref.usable,
            ...(ref.usable || sharedReason !== null || ref.reason === undefined
              ? {}
              : { reason: reasonText(s, ref.reason) }),
            insert: () => d.formula.insert(ref.name),
          }))}
        </div>`}
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
          @click=${() => d.formula.complete(col)}
          >${col.title ? `${col.title} · ${col.key}` : col.key}</button>`)}
    </div>
  `;
}
