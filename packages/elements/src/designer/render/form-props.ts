/**
 * 양식·페이지 설정과 파라미터 설정 패널.
 *
 * @remarks
 * 요소를 선택하지 않았을 때 표시하는 패널이다. 컴포넌트 전체가 아니라
 * `PanelKit`(공통 입력)과 `FormActions`(양식·파라미터 조작)만 받는다.
 */

import { html, nothing } from 'lit';
import type { PageNumberPosition, SlipTemplateFile } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { PAPER_PRESETS } from '../paper.js';
import { round1 } from '../geometry.js';
import type { PaperSize } from '../../settings.js';
import { valueTypeBadge, TYPE_BADGE } from './badges.js';
import { BINDING_VALUE_TYPES, BINDING_FIELD_VALUE_TYPES } from '../parameters.js';
import type { ParameterFieldInfo, ParameterInfo } from '../parameters.js';
import type { PanelKit } from './panel-kit.js';

/** 하위 필드를 가리키는 위치 */
export interface CellReference {
  pageIndex: number;
  gridId: string;
  row: number;
  column: number;
}

/** 양식·파라미터 패널이 컴포넌트에 요청하는 조작 */
export interface FormActions {
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 보고 있는 양식 페이지 (0부터) */
  readonly pageIndex: number;
  /** 페이지 키 입력에 오류가 있는지 */
  readonly pageKeyError: boolean;
  /** 파라미터 물리명이 겹치는지 */
  readonly parameterKeyError: boolean;
  /** 호스트가 공급한 용지 크기 */
  readonly hostPaperSizes: readonly PaperSize[];
  /** 용지 크기 저장 입력의 내용 */
  readonly paperSaveName: string;
  /** 용지 크기 저장 입력의 내용을 반영한다 */
  setPaperSaveName(value: string): void;
  /** 호스트가 용지 크기 저장을 지원하는지 */
  readonly canSavePaperSize: boolean;
  /** 양식을 수정한다 */
  updateFile(fn: (file: SlipTemplateFile) => void): void;
  /** 양식의 페이지 수 */
  pageCount(): number;
  /** 현재 페이지를 앞뒤로 옮긴다 */
  movePage(delta: number): void;
  /** 페이지 키를 저장한다 */
  commitPageKey(index: number, raw: string): void;
  /** 페이지 번호 표시를 켜거나 끈다 */
  togglePageNumber(index: number, on: boolean): void;
  /** 현재 용지 크기를 이름 붙여 저장한다 */
  savePaperSize(name: string): void;
  /** 사이드바와 같은 파라미터 목록 */
  parameters(): ParameterInfo[];
  addParameterField(listKey: string): void;
  commitParameterLabel(key: string, label: string): void;
  renameParameterKey(key: string, next: string, input?: HTMLInputElement): void;
  setParameterValueType(key: string, valueType: string): void;
  renameParameterField(listKey: string, key: string, next: string, input?: HTMLInputElement): void;
  updateParameterField(listKey: string, key: string, patch: { label?: string; valueType?: string }): void;
  selectFromSidebar(pageIndex: number, id: string, additive?: boolean): void;
  selectParameter(key: string): void;
  selectParameterField(listKey: string, field: ParameterFieldInfo): void;
  selectGridCellAt(at: CellReference): void;
}

/**
 * 현재 페이지의 이름, 페이지 번호, 순서를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param form - 양식·페이지·파라미터 편집 동작
 * @returns 페이지 설정 패널 조각
 */
export function pageSettings(kit: PanelKit, form: FormActions) {
  const file = form.file!;
  const s = kit.s;
  const index = form.pageIndex;
  const page = file.template.pages[index];
  if (!page) return formSettings(kit, form);
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;

  // 페이지 번호는 위쪽 또는 아래쪽의 왼쪽, 가운데, 오른쪽에 배치할 수 있다 (SPEC §4).
  const positions: { value: PageNumberPosition; label: string }[] = [
    { value: 'bottom-left', label: s.pagePosBottomLeft },
    { value: 'bottom-center', label: s.pagePosBottomCenter },
    { value: 'bottom-right', label: s.pagePosBottomRight },
    { value: 'top-left', label: s.pagePosTopLeft },
    { value: 'top-center', label: s.pagePosTopCenter },
    { value: 'top-right', label: s.pagePosTopRight },
  ];
  const pageNumber = page.pageNumber;

  return html`
    <div class="type-name">${s.pageSettings}</div>

    <div class="prop-section">
      <div class="prop-section-title">${s.panelBasic}</div>
      <div class="prop-row">
        <label>${s.pageName}</label>
        <input .value=${page.label ?? ''}
          placeholder=${s.pageLabel.replace('{n}', String(index + 1))}
          @change=${(e: Event) => {
            const v = valOf(e).trim();
            form.updateFile((f) => {
              const target = f.template.pages[index]!;
              if (v === '') delete target.label;
              else target.label = v;
            });
          }}>
      </div>
      <div class="prop-row">
        <label>${s.pageKey}</label>
        <input class=${form.pageKeyError ? 'error' : ''} .value=${page.key ?? ''}
          aria-invalid=${String(form.pageKeyError)}
          aria-describedby=${form.pageKeyError ? 'error-page-key' : nothing}
          @change=${(e: Event) => form.commitPageKey(index, valOf(e))}>
      </div>
      ${form.pageKeyError
        ? html`<div id="error-page-key" class="input-error field-error" role="alert">${s.keyInUse}</div>`
        : nothing}
    </div>

    <div class="prop-section">
      <div class="prop-section-title">${s.panelPageNumber}</div>
      <div class="prop-row">
        <label>${s.pageNumberShow}</label>
        <input type="checkbox" aria-label=${s.pageNumberShow} .checked=${pageNumber !== undefined}
          @change=${(e: Event) => form.togglePageNumber(index, (e.target as HTMLInputElement).checked)}>
      </div>
      ${pageNumber
        ? html`
          <div class="prop-row">
            <label>${s.pageNumberPosition}</label>
            ${kit.listSelect({
              id: 'page-number-position',
              ariaLabel: s.pageNumberPosition,
              value: pageNumber.position,
              options: positions,
              onPick: (value) =>
                form.updateFile((f) => {
                  f.template.pages[index]!.pageNumber = {
                    ...f.template.pages[index]!.pageNumber!,
                    position: value as PageNumberPosition,
                  };
                }),
            })}
          </div>`
        : nothing}
    </div>

    <div class="prop-section">
      <div class="prop-section-title">${s.pageOrder}</div>
      <div class="prop-row">
        <div class="step-inputs">
          <button class="row-btn" aria-label=${s.pageMoveForward}
            ?disabled=${index === 0} @click=${() => form.movePage(-1)}>${icons.up}</button>
          <span>${index + 1} / ${form.pageCount()}</span>
          <button class="row-btn" aria-label=${s.pageMoveBackward}
            ?disabled=${index >= form.pageCount() - 1} @click=${() => form.movePage(1)}>${icons.down}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * 양식 제목, 용지 크기, 방향, 여백을 편집하는 패널을 렌더링한다.
 * 방향과 프리셋은 파일에 별도로 저장하지 않고 용지 너비와 높이에 반영한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param form - 양식·페이지·파라미터 편집 동작
 * @returns 양식 설정 패널 조각
 */
export function formSettings(kit: PanelKit, form: FormActions) {
  const file = form.file!;
  const s = kit.s;
  const { paper } = file.template;
  const [pt, pr, pb, pl] = paper.padding;
  const landscape = paper.width > paper.height;
  // 기본 용지 뒤에 호스트가 제공한 용지를 추가한다.
  const allSizes: PaperSize[] = [...PAPER_PRESETS, ...form.hostPaperSizes];
  // 현재 크기와 방향을 제외하고 일치하는 용지를 찾는다.
  const presetIndex = allSizes.findIndex(
    (p) =>
      (p.width === paper.width && p.height === paper.height) ||
      (p.width === paper.height && p.height === paper.width),
  );
  // 목록에 없는 크기이며 저장 함수가 있으면 사용자 지정 용지 저장 기능을 표시한다.
  const canSaveSize = presetIndex < 0 && form.canSavePaperSize;

  // 본문 영역이 남지 않는 용지 크기는 적용하지 않는다.
  const setSize = (width: number, height: number, errorKey = 'paper-size'): void => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      kit.reject(s.numberInput, errorKey);
      return;
    }
    if (width <= pl + pr || height <= pt + pb) {
      kit.reject(s.paperAreaError, errorKey);
      return;
    }
    form.updateFile((f) => {
      f.template.paper.width = round1(width);
      f.template.paper.height = round1(height);
    });
  };
  const setPadding = (index: 0 | 1 | 2 | 3, value: number): void => {
    const errorKey = `paper-margin-${index}`;
    if (Number.isNaN(value) || value < 0) {
      kit.reject(Number.isNaN(value) ? s.numberInput : s.nonNegativeInput, errorKey);
      return;
    }
    const next = [...paper.padding] as [number, number, number, number];
    next[index] = round1(value);
    if (next[3] + next[1] >= paper.width || next[0] + next[2] >= paper.height) {
      kit.reject(s.marginAreaError, errorKey);
      return;
    }
    form.updateFile((f) => {
      f.template.paper.padding = next;
    });
  };
  const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);

  return html`
    <div class="type-name">${s.formSettings}</div>

    <div class="prop-section">
      <div class="prop-section-title">${s.panelBasic}</div>
      <div class="prop-row">
        <label>${s.formTitle}</label>
        <input .value=${file.template.meta.title}
               aria-invalid=${String(kit.hasError('form-title'))}
               aria-describedby=${kit.hasError('form-title') ? 'error-form-title' : nothing}
               @change=${(e: Event) => {
                 const v = (e.target as HTMLInputElement).value.trim();
                 // 빈 제목은 스키마에서 허용하지 않는다.
                 if (!v) {
                   kit.reject(s.requiredInput, 'form-title');
                   return;
                 }
                 form.updateFile((f) => { f.template.meta.title = v; });
               }}>
      </div>
      ${kit.error('form-title')}
    </div>

    <div class="prop-section">
      <div class="prop-section-title">${s.panelPaper}</div>
      <div class="prop-row">
        <label>${s.paperSize}</label>
        ${kit.listSelect({
          id: 'paper-size',
          ariaLabel: s.paperSize,
          value: presetIndex >= 0 ? String(presetIndex) : 'custom',
          options: [
            ...allSizes.map((p, i) => ({ value: String(i), label: `${p.name} (${p.width}×${p.height})` })),
            { value: 'custom', label: s.paperCustom },
          ],
          onPick: (v) => {
            if (v === 'custom') return;
            const p = allSizes[Number(v)]!;
            // 세로 기준 프리셋을 현재 용지 방향에 맞춰 적용한다.
            setSize(landscape ? p.height : p.width, landscape ? p.width : p.height);
          },
        })}
      </div>
      ${canSaveSize
        ? html`
          <div class="prop-row">
            <label>${s.paperSaveThis}</label>
            <input class="paper-save-name" .value=${form.paperSaveName}
                   placeholder=${s.paperSizeName}
                   aria-label=${s.paperSizeName}
                   @input=${(e: Event) => { form.setPaperSaveName((e.target as HTMLInputElement).value); }}>
            <button class="row-btn" title=${s.paperSaveThis} aria-label=${s.paperSaveThis}
              ?disabled=${form.paperSaveName.trim() === ''}
              @click=${() => void form.savePaperSize(form.paperSaveName)}>${icons.save}</button>
          </div>`
        : nothing}
      <div class="prop-pair">
        <div class="prop-row">
          <label>${s.width}</label>
          <input type="number" step="0.5" min="1" .value=${String(paper.width)}
                 aria-invalid=${String(kit.hasError('paper-width'))}
                 aria-describedby=${kit.hasError('paper-width') ? 'error-paper-width' : nothing}
                 @change=${(e: Event) => setSize(numOf(e), paper.height, 'paper-width')}>
        </div>
        <div class="prop-row">
          <label>${s.height}</label>
          <input type="number" step="0.5" min="1" .value=${String(paper.height)}
                 aria-invalid=${String(kit.hasError('paper-height'))}
                 aria-describedby=${kit.hasError('paper-height') ? 'error-paper-height' : nothing}
                 @change=${(e: Event) => setSize(paper.width, numOf(e), 'paper-height')}>
        </div>
      </div>
      ${kit.error('paper-width')}
      ${kit.error('paper-height')}
      ${kit.error('paper-size')}
      <div class="prop-row">
        <label>${s.orientation}</label>
        <div class="toggle-group text" role="group" aria-label=${s.orientation}>
          ${([
            [false, s.portrait],
            [true, s.landscape],
          ] as const).map(([toLandscape, label]) => html`
            <button title=${label} aria-label="${s.orientation}: ${label}"
              aria-pressed=${String(landscape === toLandscape)}
              @click=${() => {
                if (landscape === toLandscape) return;
                setSize(paper.height, paper.width);
              }}>${label}</button>`)}
        </div>
      </div>
    </div>

    <div class="prop-section">
      <div class="prop-section-title">${s.margin}</div>
      <div class="prop-pair">
        <div class="prop-row">
          <label>${s.marginTop}</label>
          <input type="number" step="1" min="0" .value=${String(pt)}
                 aria-invalid=${String(kit.hasError('paper-margin-0'))}
                 aria-describedby=${kit.hasError('paper-margin-0') ? 'error-paper-margin-0' : nothing}
                 @change=${(e: Event) => setPadding(0, numOf(e))}>
        </div>
        <div class="prop-row">
          <label>${s.marginRight}</label>
          <input type="number" step="1" min="0" .value=${String(pr)}
                 aria-invalid=${String(kit.hasError('paper-margin-1'))}
                 aria-describedby=${kit.hasError('paper-margin-1') ? 'error-paper-margin-1' : nothing}
                 @change=${(e: Event) => setPadding(1, numOf(e))}>
        </div>
      </div>
      ${kit.error('paper-margin-0')}
      ${kit.error('paper-margin-1')}
      <div class="prop-pair">
        <div class="prop-row">
          <label>${s.marginBottom}</label>
          <input type="number" step="1" min="0" .value=${String(pb)}
                 aria-invalid=${String(kit.hasError('paper-margin-2'))}
                 aria-describedby=${kit.hasError('paper-margin-2') ? 'error-paper-margin-2' : nothing}
                 @change=${(e: Event) => setPadding(2, numOf(e))}>
        </div>
        <div class="prop-row">
          <label>${s.marginLeft}</label>
          <input type="number" step="1" min="0" .value=${String(pl)}
                 aria-invalid=${String(kit.hasError('paper-margin-3'))}
                 aria-describedby=${kit.hasError('paper-margin-3') ? 'error-paper-margin-3' : nothing}
                 @change=${(e: Event) => setPadding(3, numOf(e))}>
        </div>
      </div>
      ${kit.error('paper-margin-2')}
      ${kit.error('paper-margin-3')}
    </div>
  `;
}

/**
 * 파라미터의 물리명, 논리명, 값 종류와 목록 하위 필드를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param form - 양식·페이지·파라미터 편집 동작
 * @param key - 편집할 파라미터의 물리명
 * @returns 파라미터 설정 패널. 없는 키면 양식 설정 패널
 */
export function parameterPanel(kit: PanelKit, form: FormActions, key: string) {
  const s = kit.s;
  const info = form.parameters().find((b) => b.key === key);
  if (!info) return formSettings(kit, form);
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;

  return html`
    <div class="type-name">${s.sidebarParameters}</div>

    <div class="prop-section">
      <div class="prop-section-title">${s.panelBasic}</div>
      <div class="prop-row">
        <label>${s.parameterKey}</label>
        <input class="parameter-key-input" .value=${info.key}
          aria-invalid=${String(form.parameterKeyError || kit.hasError('parameter-key'))}
          aria-describedby=${form.parameterKeyError || kit.hasError('parameter-key')
            ? 'error-parameter-key' : nothing}
          @change=${(e: Event) =>
            form.renameParameterKey(info.key, valOf(e), e.target as HTMLInputElement)}>
      </div>
      ${form.parameterKeyError
        ? html`<div id="error-parameter-key" class="input-error field-error" role="alert">${s.keyInUse}</div>`
        : kit.error('parameter-key')}
      <div class="prop-row">
        <label>${s.parameterLabel}</label>
        <input class="parameter-label-input" .value=${info.rawLabel ?? ''} placeholder=${info.key}
          @change=${(e: Event) => form.commitParameterLabel(info.key, valOf(e))}>
      </div>
      <div class="prop-row">
        <label>${s.parameterValueType}</label>
        ${kit.listSelect({
          id: 'parameter-value-type',
          ariaLabel: s.parameterValueType,
          value: info.valueType ?? '',
          options: BINDING_VALUE_TYPES.map((t) => ({ value: t.value, label: s[t.stringKey] })),
          onPick: (value) => form.setParameterValueType(info.key, value),
        })}
      </div>
    </div>

    ${info.valueType === 'list'
      ? html`
        <div class="prop-section">
          <div class="prop-section-title">${s.parameterFields}</div>
          ${info.fields.length === 0
            ? html`<div class="side-empty">${s.parameterFieldsEmpty}</div>`
            : info.fields.map((f) => html`
                <button class="usage-row field-row" title="${info.key}.${f.key}"
                  @click=${() => form.selectParameterField(info.key, f)}>
                  ${valueTypeBadge(f.valueType)}<span>${f.title}</span>
                </button>`)}
          <button class="prop-add-row" @click=${() => form.addParameterField(info.key)}>
            ${icons.add}<span>${s.addParameterField}</span>
          </button>
        </div>`
      : nothing}

    <div class="prop-section">
      <div class="prop-section-title">${s.parameterUsage}</div>
      ${info.uses.length === 0
        ? html`<div class="side-empty">${s.parameterUnused}</div>`
        : info.uses.map((u) => html`
            <button class="usage-row" title=${u.name}
              @click=${() => form.selectFromSidebar(u.pageIndex, u.id)}>
              ${TYPE_BADGE[u.type]}<span>${u.name}</span>
              <span class="usage-page">${s.sidebarPages} ${u.pageIndex + 1}</span>
            </button>`)}
    </div>
  `;
}

/**
 * 목록 파라미터의 하위 필드 하나를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param form - 양식·페이지·파라미터 편집 동작
 * @param listKey - 하위 필드를 가진 목록 파라미터의 물리명
 * @param fieldKey - 편집할 하위 필드의 물리명
 * @returns 하위 필드 설정 패널. 없는 키면 양식 설정 패널
 */
export function parameterFieldPanel(kit: PanelKit, form: FormActions, listKey: string, fieldKey: string) {
  const s = kit.s;
  const parent = form.parameters().find((b) => b.key === listKey);
  const info = parent?.fields.find((f) => f.key === fieldKey);
  if (!parent || !info) return formSettings(kit, form);
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;

  return html`
    <div class="type-name">${s.parameterField}</div>
    <div class="prop-section">
      <div class="prop-section-title">${s.panelBasic}</div>
      <div class="prop-row">
        <label>${s.parameterParent}</label>
        <button class="usage-row parent-row" @click=${() => form.selectParameter(listKey)}>
          ${valueTypeBadge(parent.valueType)}<span>${parent.label}</span>
        </button>
      </div>
      <div class="prop-row">
        <label>${s.parameterKey}</label>
        <input class="parameter-key-input" .value=${info.key}
          aria-invalid=${String(form.parameterKeyError || kit.hasError('parameter-key'))}
          aria-describedby=${form.parameterKeyError || kit.hasError('parameter-key')
            ? 'error-parameter-key' : nothing}
          @change=${(e: Event) =>
            form.renameParameterField(listKey, info.key, valOf(e), e.target as HTMLInputElement)}>
      </div>
      ${form.parameterKeyError
        ? html`<div id="error-parameter-key" class="input-error field-error" role="alert">${s.keyInUse}</div>`
        : kit.error('parameter-key')}
      <div class="prop-row">
        <label>${s.parameterLabel}</label>
        <input .value=${info.rawLabel ?? ''} placeholder=${info.key}
          @change=${(e: Event) => form.updateParameterField(listKey, info.key, { label: valOf(e) })}>
      </div>
      <div class="prop-row">
        <label>${s.parameterValueType}</label>
        ${kit.listSelect({
          id: 'field-value-type',
          ariaLabel: s.parameterValueType,
          value: info.valueType ?? '',
          options: BINDING_FIELD_VALUE_TYPES.map((t) => ({ value: t.value, label: s[t.stringKey] })),
          onPick: (value) => form.updateParameterField(listKey, info.key, { valueType: value }),
        })}
      </div>
    </div>

    <div class="prop-section">
      <div class="prop-section-title">${s.parameterUsage}</div>
      ${info.at === undefined
        ? html`<div class="side-empty">${s.parameterUnused}</div>`
        : html`
          <button class="usage-row"
            @click=${() => form.selectGridCellAt(info.at!)}>
            ${TYPE_BADGE.grid}<span>${s.cell} (${info.at.row + 1}, ${info.at.column + 1})</span>
            <span class="usage-page">${s.sidebarPages} ${info.at.pageIndex + 1}</span>
          </button>`}
    </div>
  `;
}

/** 하위 필드를 사용하는 그리드 셀로 이동한다. */
