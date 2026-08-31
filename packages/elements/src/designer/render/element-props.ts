/**
 * 요소 종류별 속성 입력 항목 — 글자, 폰트, 이미지, 선, 다각형과 공통 크기·기준점.
 *
 * @remarks
 * 컴포넌트 전체가 아니라 `PanelKit`(공통 입력)과 `ElementActions`(요소 조작)만 받는다.
 */

import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { TemplateResult } from 'lit';
import type {
  BarcodeElement,
  BarcodeKind,
  FieldElement,
  ImageElement,
  LineElement,
  PolygonElement,
  OutputPageFilter,
  SlipElement,
  TextElement,
} from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { ANCHORS, round1, boxOf, setElementBox, lineLengthAngle } from '../geometry.js';
import {
  DEFAULT_BORDER_COLOR,
  DEFAULT_FONT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_WIDTH,
} from '../style-css.js';
import { setOptional } from '../patch.js';
import { PLACEHOLDER_IMG } from '../image-pick.js';
import { numberRow, borderWidthSelect, borderShapeRow, colorControl, textStyleToggles } from './inputs.js';
import type { PanelKit } from './panel-kit.js';

/** 요소 속성 줄이 컴포넌트에 요청하는 조작 */
export interface ElementActions {
  /** 선택한 요소를 수정한다 */
  update(fn: (el: SlipElement) => void): void;
  /** 글자 요소와 필드 요소를 서로 바꾼다 */
  convertTextField(to: 'text' | 'field'): void;
  /** 이미지 선택 모달을 연다 */
  openImageModal(): void;
  /** 이미지 값을 파라미터로 받을지 바꾼다 */
  setImageVariable(variable: boolean): void;
  /** 이미지 파라미터 선택 상자를 그린다 */
  imageParameterSelect(current: string): TemplateResult;
  /** 선의 길이와 각도를 적용한다 */
  applyLineLengthAngle(length: number, angle: number): void;
  /** 요소의 좌표 기준점 번호를 읽는다 */
  anchorIndex(el: SlipElement): number;
  /** 요소의 좌표 기준점 번호를 바꾼다 */
  setAnchorIndex(elementId: string, index: number): void;
  /** 등록된 폰트 이름 */
  readonly fontNames: readonly string[];
  /** 수식 편집 모달을 연다 */
  openFormulaModal(): void;
  /** 필드 요소의 값 소스를 바꾼다 */
  setFieldSource(kind: 'parameter' | 'formula'): void;
  /** 일반 파라미터 선택 상자를 그린다 */
  parameterSelect(current: string): TemplateResult;
  /** 바코드 파라미터 선택 상자를 그린다 */
  barcodeParameterSelect(current: string): TemplateResult;
  /** 호스트가 허용한 바코드 종류 */
  barcodeKinds(): readonly { value: BarcodeKind; label: string }[];
  /** 바코드 내용이 규격에 맞는지 알리는 문구 */
  barcodeContentWarning(kind: BarcodeKind, content: string): string | null;
  /** 바코드의 값 소스 종류를 선택한다 */
  chooseBarcodeSource(kind: 'content' | 'parameter' | 'formula'): void;
  /** 바코드의 값 소스를 저장한다 */
  setBarcodeSource(kind: 'content' | 'formula', value: string): void;
  /** 현재 페이지의 요소 목록 */
  pageElements(): SlipElement[] | undefined;
  /** id로 요소를 찾는다 */
  findElement(id: string): SlipElement | undefined;
  /** 선택한 요소들을 묶는다 */
  groupSelected(): void;
  /** 그룹을 해제한다 */
  ungroupSelected(): void;
  /** 지금 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
}

/**
 * 텍스트 요소의 내용을 편집하는 패널을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 텍스트 요소
 * @returns 텍스트 내용 편집 조각
 */
export function textProps(kit: PanelKit, act: ElementActions, el: TextElement) {
  const s = kit.s;
  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.panelValue}</div>
      ${textFieldKindRow(kit, act, 'text')}
      <div class="prop-row stacked">
        <label>${s.content}</label>
        <textarea rows="3" .value=${el.content}
          @change=${(e: Event) => act.update((el) => {
            if (el.type === 'text') el.content = (e.target as HTMLTextAreaElement).value;
          })}></textarea>
      </div>
    </div>
  `;
}

/**
 * 텍스트와 필드 요소 사이를 전환하는 입력을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param current - 현재 요소 종류
 * @returns 종류 전환 조각
 */
export function textFieldKindRow(kit: PanelKit, act: ElementActions, current: 'text' | 'field') {
  const s = kit.s;
  return html`
    <div class="prop-row">
      <label>${s.elementKind}</label>
      <div class="toggle-group text" role="group" aria-label=${s.elementKind}>
        ${([['text', s.typeText], ['field', s.typeField]] as const).map(([kind, label]) => html`
          <button aria-pressed=${String(current === kind)}
            @click=${() => act.convertTextField(kind)}>${label}</button>`)}
      </div>
    </div>`;
}

/**
 * 호스트가 제공한 폰트를 선택하는 입력을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param current - 현재 지정된 폰트 이름
 * @param apply - 저장 콜백 (빈 값이면 지정 해제)
 * @param ariaLabel - 보조기기용 이름
 * @returns 폰트 선택 UI. 선택할 폰트가 없으면 빈 템플릿
 */
export function fontNameRow(
  kit: PanelKit,
  act: ElementActions,
  current: string | undefined,
  apply: (value: string | null) => void,
  ariaLabel?: string,
) {
  const s = kit.s;
  // 선택할 폰트가 없으면 입력을 표시하지 않는다.
  if (act.fontNames.length <= 1 && current === undefined) return nothing;
  const options = current !== undefined && !act.fontNames.includes(current)
    ? [current, ...act.fontNames]
    : act.fontNames;
  return html`
    <div class="prop-row">
      <label>${s.fontName}</label>
      ${kit.listSelect({
        id: 'font-name',
        ariaLabel: ariaLabel ?? s.fontName,
        value: current ?? '',
        className: current === undefined ? 'dim' : '',
        options: [
          { value: '', label: s.fontDefault },
          ...options.map((name) => ({ value: name, label: name })),
        ],
        onPick: (value) => apply(value || null),
      })}
    </div>`;
}

/**
 * 글자 크기, 색, 정렬과 줄 간격 등 글자 스타일을 편집하는 패널을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 요소
 * @returns 글자 스타일 편집 조각
 */
export function fontProps(kit: PanelKit, act: ElementActions, el: SlipElement) {
  if (el.type !== 'text' && el.type !== 'field') return nothing;
  const s = kit.s;

  return html`
    ${fontNameRow(kit, act,
      (el as { fontName?: string }).fontName,
      (v) => act.update((target) => setOptional(target, 'fontName', v)),
    )}
    ${numberRow(kit,
      s.fontSize, el.fontSize, DEFAULT_FONT_SIZE,
      (v) => act.update((target) => setOptional(target, 'fontSize', v)),
      { step: '0.5', min: '0.5', errorKey: 'element-font-size' },
    )}
    <div class="prop-row">
      <label>${s.alignment}</label>
      <div class="toggle-group" role="group" aria-label=${s.alignment}>
        ${([
          ['left', s.alignLeft, icons.alignLeft],
          ['center', s.alignCenter, icons.alignCenter],
          ['right', s.alignRight, icons.alignRight],
        ] as const).map(([value, label, glyph]) => html`
          <button title=${label} aria-label="${s.alignment}: ${label}"
            aria-pressed=${String((el.alignment ?? 'left') === value)}
            @click=${() => act.update((target) =>
              setOptional(target, 'alignment', value !== 'left' ? value : null))}>${glyph}</button>`)}
      </div>
    </div>
    <div class="prop-row">
      <label>${s.verticalAlignment}</label>
      <div class="toggle-group" role="group" aria-label=${s.verticalAlignment}>
        ${([
          ['top', s.alignTop, icons.alignTop],
          ['middle', s.alignMiddle, icons.alignMiddle],
          ['bottom', s.alignBottom, icons.alignBottom],
        ] as const).map(([value, label, glyph]) => html`
          <button title=${label} aria-label="${s.verticalAlignment}: ${label}"
            aria-pressed=${String((el.verticalAlignment ?? 'top') === value)}
            @click=${() => act.update((target) =>
              setOptional(target, 'verticalAlignment', value !== 'top' ? value : null))}>${glyph}</button>`)}
      </div>
    </div>
    ${numberRow(kit,
      s.lineHeight, el.lineHeight, 1,
      (v) => act.update((target) => setOptional(target, 'lineHeight', v)),
      { step: '0.1', min: '0.1', errorKey: 'element-line-height' },
    )}
    ${numberRow(kit,
      s.characterSpacing, el.characterSpacing, 0,
      (v) => act.update((target) => setOptional(target, 'characterSpacing', v)),
      { step: '0.1', errorKey: 'element-character-spacing' },
    )}
    <div class="prop-row">
      <label>${s.verticalWriting}</label>
      <input type="checkbox" aria-label=${s.verticalWriting} .checked=${el.vertical === true}
        @change=${(e: Event) => act.update((target) =>
          setOptional(target, 'vertical', (e.target as HTMLInputElement).checked ? true : null))}>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Render: color props
// ---------------------------------------------------------------------------

/**
 * 이미지 요소의 고정 이미지와 파라미터 이미지를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 이미지 요소
 * @returns 이미지 편집 조각
 */
export function imageProps(kit: PanelKit, act: ElementActions, el: ImageElement) {
  const s = kit.s;
  // 이미지 요소는 고정 소스와 파라미터 중 하나만 사용한다.
  const variable = el.parameter !== undefined;
  // base64 문자열 대신 현재 이미지를 표시한다.
  const chosen = el.src !== undefined && el.src !== PLACEHOLDER_IMG && el.src.startsWith('data:');
  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.panelValue}</div>
      <div class="prop-row">
        <label>${s.imageMode}</label>
        <div class="toggle-group text" role="group" aria-label=${s.imageMode}>
          <button aria-pressed=${String(!variable)}
            @click=${() => act.setImageVariable(false)}>${s.imageFixed}</button>
          <button aria-pressed=${String(variable)}
            @click=${() => act.setImageVariable(true)}>${s.imageVariable}</button>
        </div>
      </div>
      ${variable
        ? act.imageParameterSelect(el.parameter ?? '')
        : html`
          ${chosen
            ? html`<div class="image-current"><img src=${el.src} alt=""></div>`
            : html`<p class="image-hint">${s.imageNone}</p>`}
          <button class="col-modal-open" @click=${() => act.openImageModal()}>
            ${icons.image}<span>${chosen ? s.imageChange : s.imagePick}</span>
          </button>`}
    </div>
  `;
}

/**
 * 선 요소에는 별도의 종류별 속성 패널을 표시하지 않는다.
 * 방향은 캔버스의 끝점 핸들로 변경한다.
 *
 * @param _kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param _el - 선택한 선 요소
 * @returns 빈 조각
 */
export function lineProps(_kit: PanelKit, _el: LineElement) {
  return nothing;
}

/**
 * 정다각형의 변 수를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 다각형 요소
 * @returns 변 수 편집 조각
 */
export function polygonProps(kit: PanelKit, act: ElementActions, el: PolygonElement) {
  const s = kit.s;
  return html`
        <div class="prop-section">
          <div class="prop-section-title">${s.panelStructure}</div>
          <div class="prop-row">
            <label>${s.sides}</label>
            <input type="number" min="3" max="12" step="1" .value=${String(el.sides)}
              aria-invalid=${String(kit.hasError('polygon-sides'))}
              aria-describedby=${kit.hasError('polygon-sides') ? 'error-polygon-sides' : nothing}
              @change=${(e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                // 스키마가 허용하는 3~12 범위만 적용한다.
                if (!Number.isInteger(v) || v < 3 || v > 12) {
                  kit.reject(
                    s.rangeInput.replace('{min}', '3').replace('{max}', '12'),
                    'polygon-sides',
                  );
                  return;
                }
                act.update((el) => {
                  if (el.type === 'polygon') el.sides = v;
                });
              }}>
          </div>
          ${kit.error('polygon-sides')}
        </div>
      `;
}

/**
 * 그리드 또는 선택 셀의 텍스트 표시 방식을 편집하는 선택기를 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param config - 입력 id, 현재 값, 상속 선택지 표시 여부, 접근성 레이블과 저장 콜백
 * @returns 표시 방식 선택기
 */
export function gridOverflowRow(kit: PanelKit, config: {
  id: string;
  value: 'inherit' | 'clip' | 'shrink';
  inherit?: boolean;
  ariaLabel?: string;
  onPick: (value: 'inherit' | 'clip' | 'shrink') => void;
}) {
  const s = kit.s;
  return html`
    <div class="prop-row">
      <label>${s.overflow}</label>
      ${kit.listSelect({
        id: config.id,
        ariaLabel: config.ariaLabel ?? s.overflow,
        value: config.value,
        options: [
          ...(config.inherit ? [{ value: 'inherit', label: s.overflowInherit }] : []),
          { value: 'clip', label: s.overflowClip },
          { value: 'shrink', label: s.overflowShrink },
        ],
        onPick: (value) => config.onPick(value as 'inherit' | 'clip' | 'shrink'),
      })}
    </div>
  `;
}

/**
 * 요소 좌표의 기준점을 선택하는 입력을 렌더링한다. 기준점은 파일에 저장하지 않는다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 요소
 * @returns 기준점 선택 조각
 */
export function anchorRow(kit: PanelKit, act: ElementActions, el: SlipElement) {
  const s = kit.s;
  const current = act.anchorIndex(el);
  const elementId = el.id;
  return html`
    <div class="prop-row">
      <label>${s.anchor}</label>
      <div class="anchor-grid" role="group" aria-label=${s.anchor}>
        ${ANCHORS.map((a, i) => html`
          <button class="anchor-dot" title=${s[a.key]} aria-label="${s.anchor}: ${s[a.key]}"
            aria-pressed=${String(i === current)}
            @click=${() => act.setAnchorIndex(elementId, i)}></button>`)}
      </div>
    </div>
  `;
}

/**
 * 요소 크기 입력을 렌더링한다.
 * 선은 너비와 높이 대신 길이, 각도, 선 굵기로 편집한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 요소
 * @returns 크기 입력 조각
 */
export function sizeRows(kit: PanelKit, act: ElementActions, el: SlipElement) {
  const s = kit.s;
  const box = boxOf(el);
  const setSize = (key: 'width' | 'height') => (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    const errorKey = `element-${key}`;
    if (!Number.isFinite(v) || v < 1) {
      const message = !Number.isFinite(v)
        ? s.numberInput
        : s.minimumInput.replace('{min}', '1');
      kit.reject(message, errorKey);
      return;
    }
    act.update((target) => {
      setElementBox(target, key === 'width' ? v : undefined, key === 'height' ? v : undefined);
    });
  };
  const sizeRow = (label: string, key: 'width' | 'height') => {
    const errorKey = `element-${key}`;
    return html`
      <div class="prop-row">
        <label>${label}</label>
        <input type="number" step="0.5" min="1" .value=${String(box[key])}
               aria-label=${label}
               aria-invalid=${String(kit.hasError(errorKey))}
               aria-describedby=${kit.hasError(errorKey) ? `error-${errorKey}` : nothing}
               @change=${setSize(key)}>
      </div>
      ${kit.error(errorKey)}`;
  };

  // 모든 선 방향에 같은 길이, 각도, 굵기 입력을 사용한다.
  if (el.type === 'line') {
    const { length, angle } = lineLengthAngle(el);
    return html`
      <div class="prop-pair">
        ${numberRow(kit,
          s.length, Number(length.toFixed(1)), length,
          (v) => act.applyLineLengthAngle(v ?? length, angle),
          { step: '0.5', min: '0', errorKey: 'line-length' },
        )}
        ${numberRow(kit,
          s.lineAngle, Number(angle.toFixed(1)), angle,
          (v) => act.applyLineLengthAngle(length, v ?? angle),
          { step: '1', errorKey: 'line-angle' },
        )}
      </div>
      ${borderWidthSelect(kit,
        el.borderWidth,
        DEFAULT_LINE_WIDTH,
        false,
        'borderWidth',
        (v) => act.update((target) => {
          (target as Record<string, unknown>).borderWidth = v;
        }),
        s.lineWidth,
      )}`;
  }
  return html`
    <div class="prop-pair">
      ${sizeRow(s.width, 'width')}
      ${sizeRow(s.height, 'height')}
    </div>`;
}

/**
 * 필드 요소의 값 소스를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 필드 요소
 * @returns 값 소스 편집 조각
 */
export function fieldProps(kit: PanelKit, act: ElementActions, el: FieldElement) {
  const s = kit.s;
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;
  // 필드는 파라미터와 수식 중 하나만 값 소스로 사용한다.
  const source: 'parameter' | 'formula' = el.formula !== undefined ? 'formula' : 'parameter';
  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.panelValue}</div>
      ${textFieldKindRow(kit, act, 'field')}
      <div class="prop-row">
        <label>${s.cellSource}</label>
        ${kit.listSelect({
          id: 'field-source',
          ariaLabel: s.cellSource,
          value: source,
          options: [
            { value: 'parameter', label: s.cellSourceParameter },
            { value: 'formula', label: s.cellSourceFormula },
          ],
          onPick: (value) => act.setFieldSource(value as 'parameter' | 'formula'),
        })}
      </div>
      ${source === 'parameter'
        ? act.parameterSelect(el.parameter ?? '')
        : html`
          <div class="prop-row">
            <label>${s.formula}</label>
            <input .value=${live(el.formula ?? '')}
              @change=${(e: Event) => act.update((target) => {
                if (target.type !== 'field') return;
                setOptional(target, 'formula', valOf(e) || null);
              })}>
            <button class="row-btn" title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
              @click=${() => act.openFormulaModal()}>${icons.formula}</button>
          </div>`}
    </div>
  `;
}

/**
 * 바코드 종류와 값 소스를 편집하는 패널을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 바코드 요소
 * @returns 바코드 편집 조각
 */
export function barcodeProps(kit: PanelKit, act: ElementActions, el: BarcodeElement) {
  const s = kit.s;
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;
  // 설정된 속성으로 현재 값 소스 종류를 결정한다 (SPEC §5.6).
      const source: 'content' | 'parameter' | 'formula' =
        el.parameter !== undefined ? 'parameter' : el.formula !== undefined ? 'formula' : 'content';
      // 직접 입력한 값만 편집 중에 바코드 형식을 검사한다.
      const warning = source === 'content' ? act.barcodeContentWarning(el.kind, el.content ?? '') : null;
      return html`
        <div class="prop-section">
          <div class="prop-section-title">${s.panelValue}</div>
          <div class="prop-row">
            <label>${s.barcodeKind}</label>
            ${kit.listSelect({
              id: 'barcode-kind',
              ariaLabel: s.barcodeKind,
              value: el.kind,
              options: [
                ...(act.barcodeKinds().some((k) => k.value === el.kind)
                  ? []
                  : [{ value: el.kind, label: el.kind }]),
                ...act.barcodeKinds().map((k) => ({ value: k.value, label: k.label })),
              ],
              onPick: (value) => act.update((target) => {
                if (target.type === 'barcode') target.kind = value as BarcodeKind;
              }),
            })}
          </div>
          <div class="prop-row">
            <label>${s.barcodeValue}</label>
            ${kit.listSelect({
              id: 'barcode-source',
              ariaLabel: s.barcodeValue,
              value: source,
              options: [
                { value: 'content', label: s.cellSourceText },
                { value: 'parameter', label: s.cellSourceParameter },
                { value: 'formula', label: s.cellSourceFormula },
              ],
              onPick: (value) =>
                act.chooseBarcodeSource(value as 'content' | 'parameter' | 'formula'),
            })}
          </div>
          ${source === 'content'
            ? html`
              <div class="prop-row">
                <label>${s.content}</label>
                <input .value=${el.content ?? ''}
                  @change=${(e: Event) => act.setBarcodeSource('content', valOf(e))}>
              </div>
              ${warning ? html`<p class="image-error" role="alert">${warning}</p>` : nothing}`
            : source === 'parameter'
              ? act.barcodeParameterSelect(el.parameter ?? '')
              : html`
                <div class="prop-row">
                  <label>${s.formula}</label>
                  <input .value=${el.formula ?? ''}
                    @change=${(e: Event) => act.setBarcodeSource('formula', valOf(e))}>
                </div>`}
        </div>
      `;
}

/**
 * 요소를 어느 출력 페이지에 낼지 선택하는 구역을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 요소
 * @returns 출력 페이지 배치 조각
 */
export function pagePlacementSection(kit: PanelKit, act: ElementActions, el: SlipElement) {
  const s = kit.s;
  const placement = el.pagePlacement;
  const mode = placement?.mode ?? 'absolute';
  const pages = placement?.mode === 'absolute' ? (placement.pages ?? 'all') : 'all';
  const elements = act.pageElements() ?? [];
  // 자신과, 자신을 뒤따르는 요소는 이어서 배치의 대상으로 선택할 수 없다 (순환 방지).
  const followers = new Set<string>();
  const collect = (id: string): void => {
    followers.add(id);
    for (const other of elements) {
      if (other.pagePlacement?.mode === 'after' && other.pagePlacement.target === id && !followers.has(other.id)) {
        collect(other.id);
      }
    }
  };
  collect(el.id);
  const targets = elements.filter((other) => !followers.has(other.id));
  const currentTarget = placement?.mode === 'after' ? placement.target : (targets[0]?.id ?? '');

  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.pagePlacementSection}</div>
      <div class="prop-row">
        <label>${s.pagePlacementMode}</label>
        ${kit.listSelect({
          id: 'page-placement-mode',
          ariaLabel: s.pagePlacementMode,
          value: mode,
          options: [
            { value: 'absolute', label: s.pagePlacementAbsolute },
            { value: 'after', label: s.pagePlacementAfter },
          ],
          onPick: (value) => {
            if (value === 'absolute') {
              act.update((target) => {
                delete (target as { pagePlacement?: unknown }).pagePlacement;
              });
              return;
            }
            if (targets.length === 0) {
              kit.reject(s.afterNoTarget, 'page-placement-mode');
              return;
            }
            act.update((target) => {
              target.pagePlacement = { mode: 'after', target: targets[0]!.id };
            });
          },
        })}
      </div>
      ${mode === 'absolute'
        ? html`
          <div class="prop-row">
            <label>${s.pagePlacementPages}</label>
            ${kit.listSelect({
              id: 'page-placement-pages',
              ariaLabel: s.pagePlacementPages,
              value: pages,
              options: [
                { value: 'all', label: s.pagesAll },
                { value: 'first', label: s.pagesFirst },
                { value: 'continuation', label: s.pagesContinuation },
                { value: 'non-final', label: s.pagesNonFinal },
                { value: 'last', label: s.pagesLast },
              ],
              onPick: (value) => {
                act.update((target) => {
                  if (value === 'all') delete (target as { pagePlacement?: unknown }).pagePlacement;
                  else target.pagePlacement = { mode: 'absolute', pages: value as OutputPageFilter };
                });
              },
            })}
          </div>`
        : html`
          <div class="prop-row">
            <label>${s.afterTarget}</label>
            ${kit.listSelect({
              id: 'page-placement-target',
              ariaLabel: s.afterTarget,
              value: currentTarget,
              options: targets.map((other) => ({ value: other.id, label: other.name })),
              onPick: (value) => {
                act.update((target) => {
                  const gap = target.pagePlacement?.mode === 'after' ? target.pagePlacement.gap : undefined;
                  target.pagePlacement = { mode: 'after', target: value, ...(gap === undefined ? {} : { gap }) };
                });
              },
            })}
          </div>
          <div class="prop-row">
            <label>${s.afterGap}</label>
            <input type="number" step="0.5" min="0"
              .value=${String(placement?.mode === 'after' ? (placement.gap ?? 0) : 0)}
              aria-label=${s.afterGap}
              aria-invalid=${String(kit.hasError('after-gap'))}
              aria-describedby=${kit.hasError('after-gap') ? 'error-after-gap' : nothing}
              @change=${(e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!Number.isFinite(v) || v < 0) {
                  kit.reject(s.numberInput, 'after-gap');
                  return;
                }
                act.update((target) => {
                  if (target.pagePlacement?.mode !== 'after') return;
                  target.pagePlacement = {
                    mode: 'after',
                    target: target.pagePlacement.target,
                    ...(v === 0 ? {} : { gap: round1(v) }),
                  };
                });
              }}>
          </div>
          ${kit.error('after-gap')}`}
      ${kit.error('page-placement-mode')}
    </div>`;
}

/**
 * 글자, 테두리, 배경 스타일 구역을 요소 종류에 맞게 묶어 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 요소
 * @returns 스타일 구역 조각
 */
export function styleGroups(kit: PanelKit, act: ElementActions, el: SlipElement) {
  if (el.type === 'image') return nothing;
  const s = kit.s;
  const r = el as Record<string, unknown>;
  const hasFontColor = el.type === 'text' || el.type === 'field' || el.type === 'grid';
  const hasTextDecor = el.type === 'text' || el.type === 'field';
  const hasBackground = el.type !== 'line';
  // 선 요소에는 선 색상과 형태를 표시하고 굵기는 크기 입력에서 편집한다.
  const isLine = el.type === 'line';
  // 파선과 점선은 직선 테두리를 사용하는 요소에만 지원한다.
  const hasBorderShape = el.type === 'line' || el.type === 'rect' || el.type === 'grid';
  // 텍스트와 필드는 기본 테두리가 없고 나머지 요소는 기본 굵기를 사용한다.
  const defaultWidth = el.type === 'text' || el.type === 'field' ? 0 : DEFAULT_LINE_WIDTH;

  return html`
    ${hasFontColor ? html`
      <div class="prop-section">
        <div class="prop-section-title">${s.styleText}</div>
        ${colorControl(kit,
          s.fontColor, r.fontColor as string | undefined, 'fontColor', undefined, DEFAULT_FONT_COLOR,
        )}
        ${el.type === 'grid'
          ? gridOverflowRow(kit, {
              id: 'grid-overflow',
              value: el.overflow ?? 'clip',
              onPick: (value) => act.update((target) => {
                if (target.type !== 'grid') return;
                if (value === 'clip') delete target.overflow;
                else if (value === 'shrink') target.overflow = value;
              }),
            })
          : nothing}
        ${hasTextDecor ? fontProps(kit, act, el) : nothing}
        ${hasTextDecor
          ? textStyleToggles(kit,
              el as { bold?: boolean; underline?: boolean; strikethrough?: boolean },
              (key, value) => act.update((target) =>
                setOptional(target, key, value ? true : null)),
            )
          : nothing}
      </div>` : nothing}
    ${hasBackground ? html`
      <div class="prop-section">
        <div class="prop-section-title">${s.styleBackground}</div>
        ${colorControl(kit, s.backgroundColor, r.backgroundColor as string | undefined, 'backgroundColor')}
      </div>` : nothing}
    <div class="prop-section">
      <div class="prop-section-title">${isLine ? s.styleLine : s.styleBorder}</div>
      ${colorControl(kit,
        isLine ? s.lineColor : s.borderColor,
        r.borderColor as string | undefined, 'borderColor', undefined, DEFAULT_BORDER_COLOR,
      )}
      ${isLine ? nothing : borderWidthSelect(kit,
        r.borderWidth as number | undefined,
        defaultWidth,
        true,
        'borderWidth',
        // 텍스트와 필드의 0 굵기는 기본값이므로 파일에 저장하지 않는다.
        (v) => act.update((target) =>
          setOptional(target, 'borderWidth', v === 0 && defaultWidth === 0 ? null : v)),
      )}
      ${hasBorderShape
        ? borderShapeRow(kit,
            r.borderStyle as 'solid' | 'dashed' | 'dotted' | undefined,
            isLine ? s.lineShape : `${s.styleBorder} ${s.borderShape}`,
            'borderStyle',
            (v) => act.update((target) => {
              const t = target as Record<string, unknown>;
              if (v === null) delete t.borderStyle;
              else {
                t.borderStyle = v;
                // 모서리 반경은 파선 또는 점선과 함께 사용할 수 없다.
                if (target.type === 'rect') delete t.radius;
              }
            }),
          )
        : nothing}
      ${el.type === 'rect' ? html`
        <div class="prop-row">
          <label>${s.cornerRadius}</label>
          <input type="number" step="0.5" min="0" class=${el.radius === undefined ? 'dim' : ''}
            .value=${String(el.radius ?? '')} placeholder="0"
            aria-label=${s.cornerRadius}
            aria-invalid=${String(kit.hasError('corner-radius'))}
            aria-describedby=${kit.hasError('corner-radius') ? 'error-corner-radius' : nothing}
            ?disabled=${el.borderStyle === 'dashed' || el.borderStyle === 'dotted'}
            @change=${(e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              if (Number.isNaN(v) || v < 0) {
                kit.reject(
                  Number.isNaN(v) ? s.numberInput : s.nonNegativeInput,
                  'corner-radius',
                );
                return;
              }
              act.update((target) => {
                if (target.type !== 'rect') return;
                setOptional(target, 'radius', v > 0 ? v : null);
              });
            }}>
        </div>
        ${kit.error('corner-radius')}` : nothing}
    </div>
  `;
}

/**
 * 여러 요소를 함께 선택했을 때 정렬과 그룹화 명령을 렌더링한다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @returns 다중 선택 명령 조각
 */
export function groupPanel(kit: PanelKit, act: ElementActions) {
  const s = kit.s;
  const els = [...act.selectedIds]
    .map((id) => act.findElement(id))
    .filter((el): el is SlipElement => el !== undefined);
  const groups = new Set(els.map((el) => el.group));
  const allSameGroup = els.length > 0 && groups.size === 1 && !groups.has(undefined);
  const anyGrouped = els.some((el) => el.group !== undefined);
  return html`
    <div class="type-name">${s.groupSelection}</div>
    <div class="prop-section">
      <div class="prop-section-title">${s.panelBasic}</div>
      <div class="prop-row">
        <label>${s.selectedCount}</label>
        <span>${els.length}</span>
      </div>
      <div class="group-actions">
        ${allSameGroup
          ? nothing
          : html`<button class="btn primary" @click=${() => act.groupSelected()}>
              ${s.groupElements}</button>`}
        ${anyGrouped
          ? html`<button class="btn" @click=${() => act.ungroupSelected()}>
              ${s.ungroupElements}</button>`
          : nothing}
      </div>
    </div>
  `;
}

/** 선택한 요소에 같은 그룹 ID를 지정한다. */
