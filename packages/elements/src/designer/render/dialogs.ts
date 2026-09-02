/**
 * 모달 화면 — 수식 편집, 이미지 선택, 샘플 데이터, 저장과 내 양식 목록.
 *
 * @remarks
 * 각 컨트롤러가 초안 상태를 관리하고, 이 모듈은 현재 상태를 렌더링한 뒤 사용자 조작을 호스트에 전달합니다.
 */

import { html, nothing } from 'lit';
import type { SlipElement, SlipTemplateFile } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { formatBytes } from '../../image-file.js';
import { parseSampleScalar, sampleScalarText } from './sample-values.js';
import { PLACEHOLDER_IMG, imageParameterKeys, usedImages } from '../image-pick.js';
import { inItemBand } from '../grid-model.js';
import { MY_FORMS_PAGE_SIZE, SAMPLE_PAGE_SIZE } from '../pagination.js';
import type { DialogsController } from '../controllers/dialogs.js';
import type { FormsController } from '../controllers/forms-storage.js';
import type { FormulaDraftController } from '../controllers/formula-draft.js';
import type { ModalFocusController } from '../controllers/modal-focus.js';
import type { SampleDraftController } from '../controllers/sample-draft.js';
import type { FormulaModalView } from './formula-modal.js';
import type { ParameterInfo } from '../parameters.js';
import type { DesignerStrings } from '../../strings.js';

/** 모달 화면이 컴포넌트에서 받는 것 */
export interface DialogContext {
  /** 로케일에 맞는 문구 */
  readonly s: DesignerStrings;
  /** 수식 파싱·평가에 사용할 로케일 */
  readonly locale: string | undefined;
  /** 열려 있는 모달 */
  readonly dialogs: DialogsController;
  /** 모달의 초점 가두기 */
  readonly modalFocus: ModalFocusController;
  /** 수식 편집 초안 */
  readonly formula: FormulaDraftController;
  /** 샘플 데이터 초안 */
  readonly sample: SampleDraftController;
  /** 저장·내 양식 목록 상태 */
  readonly forms: FormsController;
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 이미지 선택 실패 문구 */
  readonly imageError: string | null;
  /** 허용하는 최대 이미지 크기(바이트) */
  readonly maxImageBytes: number;
  /** 정의와 사용처를 합친 파라미터 목록 */
  parameters(): ParameterInfo[];
  /** 샘플 편집에 표시할 파라미터 키와 이름 */
  parameterKeys(): { key: string; label: string }[];
  /** 선언된 파라미터와 현재 샘플 값을 합친 JSON 초안 */
  sampleSkeleton(): Record<string, unknown>;
  /** 속성 패널이 대상으로 삼는 요소 */
  selectedElement(): SlipElement | undefined;
  /** 요소 종류의 표시 이름 */
  typeName(type: SlipElement['type']): string;
  /** 수식 모달이 그릴 편집 대상, 검사 결과와 참조 목록 */
  formulaView(): FormulaModalView;
  applyFormula(): void;
  closeFormula(): void;
  applyImageSrc(src: string): void;
  closeImage(): void;
  pickImageFile(): void;
  pickSampleImage(key: string): void;
  setSampleValue(key: string, value: unknown): void;
  applySampleJson(): void;
  confirmSave(): void;
  loadMyForm(id: string): void;
  /** 삭제 확인 모달을 엽니다 */
  deleteMyForm(id: string): void;
  /** 삭제 확인 모달이 가리키는 양식. 열려 있지 않으면 null */
  readonly pendingDelete: { id: string; title: string } | null;
  /** 확인 모달에서 삭제를 확정합니다 */
  confirmDeleteMyForm(): void;
  /** 삭제 확인 모달을 닫습니다 */
  cancelDeleteMyForm(): void;
  /** 화면을 다시 그립니다 */
  refresh(): void;
}

/**
 * 파일을 업로드하거나 양식에서 사용 중인 이미지를 선택하는 모달을 렌더링합니다.
 * 이미지 값은 base64만 지원하므로 URL 입력은 제공하지 않습니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 이미지 모달. 열려 있지 않으면 빈 것
 */
export function imageModal(d: DialogContext) {
  if (!d.dialogs.isOpen('image')) return nothing;
  const el = d.selectedElement();
  if (!el || el.type !== 'image') return nothing;
  const s = d.s;
  const close = (): void => d.closeImage();
  const used = usedImages(d.file, PLACEHOLDER_IMG);

  return html`
    <div class="menu-backdrop modal-backdrop" @click=${close}></div>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.imageModalTitle}
      @keydown=${(e: KeyboardEvent) => d.modalFocus.handleKeydown(e, close)}>
      <div class="modal-head">
        <span>${s.imageModalTitle}</span>
        <button class="modal-close" title=${s.close} aria-label=${s.close}
          @click=${close}>${icons.close}</button>
      </div>
      <div class="modal-body">
        <button class="btn primary" @click=${() => d.pickImageFile()}>${s.imagePick}</button>
        <p class="image-hint">${s.imageSizeHint
          .replace('{max}', formatBytes(d.maxImageBytes))}</p>
        ${d.imageError
          ? html`<p class="image-error" role="alert">${d.imageError}</p>`
          : nothing}

        <div class="modal-section-title">${s.imageReuse}</div>
        ${used.length === 0
          ? html`<p class="image-hint">${s.imageEmptyReuse}</p>`
          : html`<div class="image-grid">
              ${used.map((src, i) => html`
                <button class="image-choice ${src === el.src ? 'selected' : ''}"
                  aria-label="${s.imageReuse} ${i + 1}"
                  aria-pressed=${String(src === el.src)}
                  @click=${() => d.applyImageSrc(src)}>
                  <img src=${src} alt="">
                </button>`)}
            </div>`}
      </div>
      <div class="modal-foot">
        <button class="btn" @click=${close}>${s.close}</button>
      </div>
    </div>
  `;
}

/**
 * 파라미터별 샘플 데이터를 편집하는 모달을 렌더링합니다.
 * 반복 파라미터는 그리드 열에 맞춰 행 단위로 편집합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 샘플 데이터 모달. 열려 있지 않으면 빈 것
 */
export function sampleModal(d: DialogContext) {
  if (!d.dialogs.isOpen('sample') || !d.file) return nothing;
  const s = d.s;
  const template = d.file.template;
  const samples: Record<string, unknown> = template.sampleValues ?? {};
  const close = (): void => {
    d.dialogs.close('sample');
    d.refresh();
  };

  // 반복 파라미터별 열 구조는 해당 파라미터를 처음 사용하는 그리드에서 가져옵니다.
  const tableOf = new Map<string, { key: string; title: string }[]>();
  for (const page of template.pages) {
    for (const el of page.elements) {
      if (el.type !== 'grid' || !el.repeat || tableOf.has(el.repeat.parameter)) continue;
      const fields: { key: string; title: string }[] = [];
      for (const cell of el.cells) {
        if (inItemBand(el, cell.row) && cell.parameter !== undefined
          && !fields.some((f) => f.key === cell.parameter)) {
          fields.push({ key: cell.parameter, title: cell.parameter });
        }
      }
      if (fields.length > 0) tableOf.set(el.repeat.parameter, fields);
    }
  }
  const parameters = d.parameterKeys();
  // 이미지 파라미터는 텍스트 입력 대신 파일 선택기를 사용합니다.
  const imageKeys = imageParameterKeys(d.file);
  // 파라미터 입력을 일정한 개수로 나눠 표시합니다.
  const pageCount = Math.max(1, Math.ceil(parameters.length / SAMPLE_PAGE_SIZE));
  const pageIndex = Math.min(d.sample.page, pageCount - 1);
  const visible = parameters.slice(
    pageIndex * SAMPLE_PAGE_SIZE,
    (pageIndex + 1) * SAMPLE_PAGE_SIZE,
  );

  // JSON 초안이 객체가 아니거나 구문이 잘못되면 적용 버튼을 비활성화합니다.
  let jsonError: string | null = null;
  if (d.sample.jsonMode && d.sample.jsonDraft.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(d.sample.jsonDraft);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        jsonError = s.jsonNotObject;
      }
    } catch {
      jsonError = s.jsonInvalid;
    }
  }

  return html`
    <div class="menu-backdrop modal-backdrop" @click=${close}></div>
    <div class="modal modal-wide" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.sampleModalTitle}
      @keydown=${(e: KeyboardEvent) => d.modalFocus.handleKeydown(e, close)}>
      <div class="modal-head">
        <span>${s.sampleModalTitle}</span>
        <button class="modal-close" title=${s.close} aria-label=${s.close}
          @click=${close}>${icons.close}</button>
      </div>
      <div class="modal-body">
        <div class="modal-tabs" role="tablist" aria-label=${s.sampleModalTitle}>
          ${([
            [false, s.formMode],
            [true, 'JSON'],
          ] as const).map(([jsonMode, label]) => html`
            <button role="tab" aria-selected=${String(d.sample.jsonMode === jsonMode)}
              aria-label="${s.sampleData}: ${label}"
              @click=${() => d.sample.setJsonMode(
                jsonMode,
                // 선언된 파라미터와 현재 샘플 값을 합쳐 JSON 초안을 만듭니다.
                () => JSON.stringify(d.sampleSkeleton(), null, 2),
              )}>${label}</button>`)}
        </div>
        ${d.sample.jsonMode
          ? html`
              <div class="cell-hint">${s.jsonHint}</div>
              <textarea class="sample-json" rows="14" spellcheck="false"
                aria-label="${s.sampleData} JSON"
                .value=${d.sample.jsonDraft}
                @input=${(e: Event) =>
                  d.sample.setJsonDraft((e.target as HTMLTextAreaElement).value)}></textarea>
              <div class="formula-status ${jsonError ? 'error' : ''}">
                ${jsonError ? `${s.syntaxError}: ${jsonError}` : ''}
              </div>`
          : html`
              <div class="cell-hint">${s.sampleHint}</div>
              ${parameters.length === 0 ? html`<div class="side-empty">—</div>` : nothing}
              ${pageCount > 1
                ? html`
                    <div class="sample-pager">
                      <button class="side-mini" title=${s.prevPage}
                        aria-label="${s.sampleData} ${s.prevPage}"
                        ?disabled=${pageIndex === 0}
                        @click=${() => {
                          d.sample.setPage(pageIndex - 1);
                          d.refresh();
                        }}>${icons.pagePrev}</button>
                      ${Array.from({ length: pageCount }, (_, i) => html`
                        <button class="page-btn"
                          aria-label="${s.sampleData} ${s.sidebarPages} ${i + 1}"
                          aria-pressed=${String(i === pageIndex)}
                          @click=${() => {
                            d.sample.setPage(i);
                            d.refresh();
                          }}>${i + 1}</button>`)}
                      <button class="side-mini" title=${s.nextPage}
                        aria-label="${s.sampleData} ${s.nextPage}"
                        ?disabled=${pageIndex >= pageCount - 1}
                        @click=${() => {
                          d.sample.setPage(pageIndex + 1);
                          d.refresh();
                        }}>${icons.pageNext}</button>
                    </div>`
                : nothing}
              ${d.sample.imageError
                ? html`<p class="image-error" role="alert">${d.sample.imageError}</p>`
                : nothing}
              ${visible.map((b) => {
                const columns = tableOf.get(b.key);
                if (columns) return sampleTable(d, b, columns, samples[b.key]);
                if (imageKeys.has(b.key)) return sampleImage(d, b, samples[b.key]);
                return html`
                  <div class="prop-row">
                    <label title=${b.key}>${b.label}</label>
                    <input .value=${sampleScalarText(samples[b.key])}
                      aria-label="${s.sampleData} ${b.key}"
                      @change=${(e: Event) =>
                        d.setSampleValue(b.key, parseSampleScalar((e.target as HTMLInputElement).value))}>
                  </div>`;
              })}`}
      </div>
      <div class="modal-foot">
        ${d.sample.jsonMode
          ? html`<button class="btn primary" ?disabled=${jsonError !== null}
              @click=${() => d.applySampleJson()}>${s.apply}</button>`
          : nothing}
        <button class="btn ${d.sample.jsonMode ? '' : 'primary'}" @click=${close}>
          ${s.close}
        </button>
      </div>
    </div>
  `;
}

/**
 * 반복 파라미터의 샘플 행을 열 구조에 맞춰 편집합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @param b - 편집할 목록 파라미터의 키와 논리명
 * @param columns - 그리드 셀에서 모은 열 키와 제목
 * @param raw - 현재 샘플 값
 * @returns 샘플 행 편집 표
 */
export function sampleTable(
  d: DialogContext,
  b: { key: string; label: string },
  columns: { key: string; title: string }[],
  raw: unknown,
) {
  const s = d.s;
  const rows = Array.isArray(raw)
    ? raw.filter(
        (r): r is Record<string, unknown> =>
          typeof r === 'object' && r !== null && !Array.isArray(r),
      )
    : [];
  const commitRows = (next: Record<string, unknown>[]): void =>
    d.setSampleValue(b.key, next.length > 0 ? next : undefined);
  return html`
    <div class="modal-section-title" title=${b.key}>${b.label}</div>
    <div class="sample-scroll">
      <div class="sample-grid"
        style="grid-template-columns:repeat(${columns.length}, minmax(90px, 1fr)) 22px">
        ${columns.map((col) => html`<span class="sample-col">${col.title || col.key}</span>`)}
        <span></span>
        ${rows.map((row, rowIndex) => html`
          ${columns.map((col) => html`
            <input .value=${sampleScalarText(row[col.key])}
              aria-label="${b.key} ${rowIndex + 1} ${col.key}"
              @change=${(e: Event) => {
                const next = rows.map((r) => ({ ...r }));
                const text = (e.target as HTMLInputElement).value;
                if (text === '') delete next[rowIndex]![col.key];
                else next[rowIndex]![col.key] = parseSampleScalar(text);
                commitRows(next);
              }}>`)}
          <button class="col-remove" title=${s.delete}
            aria-label="${b.key} ${rowIndex + 1} ${s.delete}"
            @click=${() => commitRows(rows.filter((_, i) => i !== rowIndex).map((r) => ({ ...r })))}>
            ${icons.pageRemove}
          </button>`)}
      </div>
    </div>
    <button class="col-add" aria-label="${b.key} ${s.addRow}"
      @click=${() => commitRows([...rows.map((r) => ({ ...r })), {}])}>
      ${icons.pageAdd}<span>${s.addRow}</span>
    </button>
  `;
}

// ---------------------------------------------------------------------------
// 내 양식 저장 및 불러오기
// ---------------------------------------------------------------------------

/**
 * 이미지 파라미터의 샘플 파일을 선택하고 미리보기를 표시합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @param b - 편집할 이미지 파라미터의 키와 논리명
 * @param raw - 현재 샘플 값
 * @returns 파일 선택과 미리보기 조각
 */
export function sampleImage(d: DialogContext, b: { key: string; label: string }, raw: unknown) {
  const s = d.s;
  const chosen = typeof raw === 'string' && raw.startsWith('data:');
  return html`
    <div class="prop-row sample-image">
      <label title=${b.key}>${b.label}</label>
      <div class="sample-image-body">
        ${chosen
          ? html`<div class="image-current"><img src=${raw as string} alt=""></div>`
          : html`<p class="image-hint">${s.imageNone}</p>`}
        <div class="sample-image-btns">
          <button class="col-modal-open" aria-label="${b.label} ${s.imagePick}"
            @click=${() => d.pickSampleImage(b.key)}>
            ${icons.image}<span>${chosen ? s.imageChange : s.imagePick}</span>
          </button>
          ${chosen
            ? html`<button class="side-mini" title=${s.imageClear}
                aria-label="${b.label} ${s.imageClear}"
                @click=${() => d.setSampleValue(b.key, undefined)}>${icons.close}</button>`
            : nothing}
        </div>
      </div>
    </div>
  `;
}

/**
 * 양식 제목과 새 저장 여부를 입력하는 저장 모달을 렌더링합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 저장 모달. 열려 있지 않으면 빈 것
 */
export function saveModal(d: DialogContext) {
  if (!d.dialogs.isOpen('save') || !d.file) return nothing;
  const s = d.s;
  const close = (): void => {
    d.dialogs.close('save');
    d.refresh();
  };
  return html`
    <div class="menu-backdrop modal-backdrop" @click=${close}></div>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.saveAsMyForm}
      @keydown=${(e: KeyboardEvent) => d.modalFocus.handleKeydown(e, close)}>
      <div class="modal-head">
        <span>${s.saveAsMyForm}</span>
        <button class="modal-close" title=${s.close} aria-label=${s.close}
          @click=${close}>${icons.close}</button>
      </div>
      <div class="modal-body">
        <div class="prop-row">
          <label>${s.formTitle}</label>
          <input class="save-title" .value=${d.forms.title} aria-label=${s.formTitle}
            @input=${(e: Event) =>
              d.forms.setTitle((e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') void d.confirmSave();
            }}>
        </div>
        ${d.forms.savedId
          ? html`
              <label class="save-as-new">
                <input type="checkbox" .checked=${d.forms.asNew} aria-label=${s.saveAsNew}
                  @change=${(e: Event) =>
                    d.forms.setAsNew((e.target as HTMLInputElement).checked)}>
                <span>${s.saveAsNew}</span>
              </label>`
          : nothing}
        ${d.forms.error
          ? html`<div class="formula-status error">${d.forms.error}</div>`
          : nothing}
      </div>
      <div class="modal-foot">
        <button class="btn" @click=${close}>${s.cancel}</button>
        <button class="btn primary" @click=${() => void d.confirmSave()}>${s.save}</button>
      </div>
    </div>
  `;
}

/**
 * 저장된 양식을 검색하고 불러오거나 삭제하는 모달을 렌더링합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 양식 목록 모달. 열려 있지 않으면 빈 것
 */
export function myFormsModal(d: DialogContext) {
  if (!d.dialogs.isOpen('myForms')) return nothing;
  const s = d.s;
  const close = (): void => {
    d.dialogs.close('myForms');
    d.refresh();
  };
  return html`
    <div class="menu-backdrop modal-backdrop" @click=${close}></div>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.myFormsList}
      @keydown=${(e: KeyboardEvent) => d.modalFocus.handleKeydown(e, close)}>
      <div class="modal-head">
        <span>${s.myFormsList}</span>
        <button class="modal-close" title=${s.close} aria-label=${s.close}
          @click=${close}>${icons.close}</button>
      </div>
      <div class="modal-body">
        <div class="prop-row">
          <label>${s.search}</label>
          <input class="forms-search" .value=${d.forms.query} aria-label=${s.search}
            @input=${(e: Event) =>
              d.forms.setQuery((e.target as HTMLInputElement).value)}>
        </div>
        ${d.forms.error
          ? html`<div class="formula-status error">${d.forms.error}</div>`
          : nothing}
        ${myFormsPage(d)}
      </div>
      <div class="modal-foot">
        <button class="btn primary" @click=${close}>${s.close}</button>
      </div>
    </div>
  `;
}

/**
 * 저장된 양식을 지우기 전에 확인하는 모달을 렌더링합니다.
 * 내 양식 목록 모달 위에 열리며 초점은 이 모달 안에 머뭅니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 삭제 확인 모달. 열려 있지 않으면 빈 것
 */
export function confirmDeleteModal(d: DialogContext) {
  const pending = d.pendingDelete;
  if (!d.dialogs.isOpen('confirmDelete') || pending === null) return nothing;
  const s = d.s;
  const close = (): void => d.cancelDeleteMyForm();
  return html`
    <div class="menu-backdrop modal-backdrop" @click=${close}></div>
    <div class="modal modal-confirm" role="alertdialog" aria-modal="true" tabindex="-1"
      aria-label=${s.deleteFormTitle} aria-describedby="confirm-delete-text"
      @keydown=${(e: KeyboardEvent) => d.modalFocus.handleKeydown(e, close)}>
      <div class="modal-head">
        <span>${s.deleteFormTitle}</span>
        <button class="modal-close" title=${s.close} aria-label=${s.close}
          @click=${close}>${icons.close}</button>
      </div>
      <div class="modal-body">
        <p id="confirm-delete-text" class="confirm-text">${s.deleteFormConfirm.replace('{title}', pending.title)}</p>
      </div>
      <div class="modal-foot">
        <button class="btn confirm-cancel" @click=${close}>${s.cancel}</button>
        <button class="btn primary confirm-delete" @click=${() => d.confirmDeleteMyForm()}>${s.delete}</button>
      </div>
    </div>
  `;
}

/**
 * 검색 결과를 페이지 단위로 나눠 목록 모달에 렌더링합니다.
 *
 * @param d - 모달 렌더링에 필요한 상태와 동작
 * @returns 현재 페이지의 양식 목록
 */
export function myFormsPage(d: DialogContext) {
  const s = d.s;
  const filtered = d.forms.filtered();
  if (filtered.length === 0) {
    return d.forms.error ? nothing : html`<div class="side-empty">${s.noSavedForms}</div>`;
  }
  const pageCount = Math.ceil(filtered.length / MY_FORMS_PAGE_SIZE);
  const page = Math.min(d.forms.page, pageCount - 1);
  const items = filtered.slice(page * MY_FORMS_PAGE_SIZE, (page + 1) * MY_FORMS_PAGE_SIZE);
  return html`
    ${items.map((item) => html`
      <div class="form-row">
        <button class="form-open" aria-label="${item.title} ${s.edit}"
          @click=${() => void d.loadMyForm(item.id)}>
          <span class="form-title">${item.title}</span>
          ${item.updatedAt
            ? html`<span class="form-date">${item.updatedAt.slice(0, 10)}</span>`
            : nothing}
        </button>
        <button class="col-remove" title=${s.delete} aria-label="${item.title} ${s.delete}"
          @click=${() => void d.deleteMyForm(item.id)}>${icons.remove}</button>
      </div>`)}
    ${pageCount > 1
      ? html`
        <div class="sample-pager">
          <button class="side-mini" title=${s.prevPage} aria-label="${s.myFormsList} ${s.prevPage}"
            ?disabled=${page === 0}
            @click=${() => d.forms.setPage(page - 1)}>${icons.pagePrev}</button>
          ${Array.from({ length: pageCount }, (_, i) => html`
            <button class="page-btn" aria-label="${s.myFormsList} ${s.sidebarPages} ${i + 1}"
              aria-pressed=${String(i === page)}
              @click=${() => d.forms.setPage(i)}>${i + 1}</button>`)}
          <button class="side-mini" title=${s.nextPage} aria-label="${s.myFormsList} ${s.nextPage}"
            ?disabled=${page >= pageCount - 1}
            @click=${() => d.forms.setPage(page + 1)}>${icons.pageNext}</button>
        </div>`
      : nothing}
  `;
}
