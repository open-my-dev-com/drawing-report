/**
 * 요소 종류별 속성 입력 항목 — 글자, 폰트, 이미지, 선, 다각형과 공통 크기·기준점.
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
  GridElement,
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
import { distributeUnits, exceedsPaper, selectionUnits } from '../arrange.js';
import type { AlignEdge, DistributeAxis, DistributeResult } from '../arrange.js';
import { withFontName, type DesignerStrings } from '../../strings.js';
import type { DesignerFonts, FontStyleInput } from '../font-variant.js';
import { applyCellDefaultBorder, applyOutline } from '../grid-border.js';
import { PLACEHOLDER_IMG } from '../image-pick.js';
import { numberRow, borderWidthSelect, borderShapeRow, colorControl, textStyleToggles } from './inputs.js';
import type { PanelKit } from './panel-kit.js';


/** 목록 선택기에서 선택한 셀마다 값이 다를 때 보여 주는, 파일에 저장되지 않는 항목의 값 */
export const MIXED_OPTION = '__mixed__';
/** 요소 속성 줄이 컴포넌트에 요청하는 조작 */
export interface ElementActions {
  /** 선택한 요소를 수정합니다 */
  update(fn: (el: SlipElement) => void): void;
  /** 글자 요소와 필드 요소를 서로 바꿉니다 */
  convertTextField(to: 'text' | 'field'): void;
  /** 이미지 선택 모달을 엽니다 */
  openImageModal(): void;
  /** 이미지 값을 파라미터로 받을지 바꿉니다 */
  setImageVariable(variable: boolean): void;
  /** 이미지 파라미터 선택 상자를 그립니다 */
  imageParameterSelect(current: string): TemplateResult;
  /** 선의 길이와 각도를 적용합니다 */
  applyLineLengthAngle(length: number, angle: number): void;
  /** 요소의 좌표 기준점 번호를 읽습니다 */
  anchorIndex(el: SlipElement): number;
  /** 요소의 좌표 기준점 번호를 바꿉니다 */
  setAnchorIndex(elementId: string, index: number): void;
  /** 폰트 목록과 브라우저 등록 상태 */
  readonly fonts: DesignerFonts;
  /** 필드 요소의 값 소스를 바꿉니다 */
  setFieldSource(kind: 'parameter' | 'formula'): void;
  /** 일반 파라미터 선택 상자를 그립니다 */
  parameterSelect(current: string): TemplateResult;
  /** 바코드 파라미터 선택 상자를 그립니다 */
  barcodeParameterSelect(current: string): TemplateResult;
  /** 호스트가 허용한 바코드 종류 */
  barcodeKinds(): readonly { value: BarcodeKind; label: string }[];
  /** 호스트 바코드 종류를 읽지 못했을 때의 안내. 없으면 null */
  readonly barcodeKindsError: string | null;
  /** 바코드 내용이 규격에 맞는지 알리는 문구 */
  barcodeContentWarning(kind: BarcodeKind, content: string): string | null;
  /** 바코드의 값 소스 종류를 선택합니다 */
  chooseBarcodeSource(kind: 'content' | 'parameter' | 'formula'): void;
  /** 바코드의 값 소스를 저장합니다 */
  setBarcodeSource(kind: 'content' | 'formula', value: string): void;
  /** 현재 페이지의 요소 목록 */
  pageElements(): SlipElement[] | undefined;
  /** id로 요소를 찾습니다 */
  findElement(id: string): SlipElement | undefined;
  /** 선택한 요소들을 묶습니다 */
  groupSelected(): void;
  /** 그룹을 해제합니다 */
  ungroupSelected(): void;
  /** 선택한 요소·그룹의 변이나 중앙선을 맞춥니다 */
  alignSelected(edge: AlignEdge): void;
  /** 선택한 요소·그룹 사이의 간격을 고르게 나눕니다 */
  distributeSelected(axis: DistributeAxis): void;
  /** 편집 중인 양식의 용지 크기(mm). 양식이 없으면 undefined */
  paper(): { width: number; height: number } | undefined;
  /** 지금 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
}

/**
 * 선택한 요소 중 하나라도 용지의 오른쪽·아래쪽을 넘으면 PDF에 출력되지 않는 영역이 있음을 알립니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param els - 판정할 요소들
 * @returns 안내 조각. 넘는 요소가 없으면 빈 것
 */
export function paperOverflowNotice(kit: PanelKit, act: ElementActions, els: readonly SlipElement[]) {
  const paper = act.paper();
  if (paper === undefined || !els.some((el) => exceedsPaper(el, paper))) return nothing;
  return html`<div class="paper-overflow-notice" role="note">${kit.s.paperOverflowNotice}</div>`;
}

/** 정렬 명령의 변·중앙선과 그 문구·아이콘 키 */
const ALIGN_COMMANDS: readonly [AlignEdge, keyof DesignerStrings, keyof typeof icons][] = [
  ['left', 'alignLeftEdges', 'alignLeftEdges'],
  ['hcenter', 'alignHCenters', 'alignHCenters'],
  ['right', 'alignRightEdges', 'alignRightEdges'],
  ['top', 'alignTopEdges', 'alignTop'],
  ['vcenter', 'alignVCenters', 'alignMiddle'],
  ['bottom', 'alignBottomEdges', 'alignBottom'],
];

/**
 * 여러 요소를 함께 선택했을 때 변·중앙선 정렬과 간격 배치 명령을 렌더링합니다.
 *
 * @remarks
 * 실행할 수 없는 간격 배치는 버튼을 비활성화하고 그 이유를 툴팁과 버튼 아래 안내로 보여 줍니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param els - 선택한 요소들
 * @returns 정렬·배치 구역 조각
 */
export function arrangeSection(kit: PanelKit, act: ElementActions, els: readonly SlipElement[]) {
  const s = kit.s;
  const units = selectionUnits(els);
  const canAlign = units.length >= 2;
  const distributes: readonly [DistributeAxis, string, unknown, DistributeResult][] = [
    ['horizontal', s.distributeHorizontally, icons.distributeH, distributeUnits(units, 'horizontal')],
    ['vertical', s.distributeVertically, icons.distributeV, distributeUnits(units, 'vertical')],
  ];
  const reasonOf = (result: DistributeResult): string | null =>
    result.ok ? null : result.reason === 'needsThree' ? s.distributeNeedsThree : s.distributeNoRoom;
  // 같은 이유는 한 번만 보여 주고 두 버튼이 같은 안내를 가리키게 합니다.
  const reasons = new Map<string, string>();
  for (const [axis, , , result] of distributes) {
    const reason = reasonOf(result);
    if (reason !== null && !reasons.has(reason)) reasons.set(reason, `arrange-reason-${axis}`);
  }
  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.arrange}</div>
      <div class="arrange-actions">
        <div class="toggle-group" role="group" aria-label=${s.arrange}>
          ${ALIGN_COMMANDS.map(([edge, key, icon]) => html`
            <button type="button" title=${s[key]} aria-label=${s[key]}
              ?disabled=${!canAlign}
              @click=${() => act.alignSelected(edge)}>${icons[icon]}</button>`)}
        </div>
        <div class="toggle-group" role="group" aria-label=${s.arrange}>
          ${distributes.map(([axis, label, glyph, result]) => {
            const reason = reasonOf(result);
            return html`
            <button type="button"
              title=${reason === null ? label : `${label} — ${reason}`}
              aria-label=${label}
              aria-disabled=${reason === null ? nothing : 'true'}
              aria-describedby=${reason === null ? nothing : reasons.get(reason)!}
              ?disabled=${reason !== null}
              @click=${() => act.distributeSelected(axis)}>${glyph}</button>`;
          })}
        </div>
      </div>
      ${[...reasons].map(([reason, id]) => html`<div id=${id} class="cell-hint">${reason}</div>`)}
    </div>`;
}

/**
 * 텍스트 요소의 내용을 편집하는 패널을 렌더링합니다.
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
        <textarea rows="3" aria-label=${s.content} .value=${el.content}
          @change=${(e: Event) => act.update((el) => {
            if (el.type === 'text') el.content = (e.target as HTMLTextAreaElement).value;
          })}></textarea>
      </div>
    </div>
  `;
}

/**
 * 텍스트와 필드 요소 사이를 전환하는 입력을 렌더링합니다.
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

/** 폰트를 지정하지 않았을 때 보여 줄 항목 문구와 그 아래 안내 */
export interface FontDefaultOption {
  /** 선택 목록의 첫 항목 문구 */
  label: string;
  /** 항목 아래에 덧붙일 안내. 없으면 생략합니다 */
  note?: string | undefined;
}

/**
 * 폰트를 지정하지 않은 요소의 `기본값` 항목 문구를 만듭니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param fallback - 지정이 없을 때 적용되는 대체 폰트 이름
 * @returns 기본값 항목 문구
 */
function fontDefaultOption(kit: PanelKit, fallback: string | undefined): FontDefaultOption {
  return { label: fallback === undefined ? kit.s.fontDefault : `${kit.s.fontDefault} (${fallback})` };
}

/**
 * 그리드 셀의 `기본값` 항목 문구를 만듭니다.
 *
 * @remarks
 * 셀은 대체 폰트가 아니라 그리드 공통 폰트를 상속하므로 상속되는 이름을 그대로 보여 줍니다.
 * 그리드 공통 폰트가 등록되어 있지 않으면 저장된 이름을 유지한 채 대체 표시임을 덧붙입니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param fonts - 폰트 목록과 브라우저 등록 상태
 * @param gridFontName - 그리드에 지정된 공통 폰트 이름
 * @returns 기본값 항목 문구
 */
export function cellInheritOption(
  kit: PanelKit,
  fonts: DesignerFonts,
  gridFontName: string | undefined,
): FontDefaultOption {
  if (gridFontName === undefined) return fontDefaultOption(kit, fonts.fallback);
  const label = `${kit.s.gridInherited} (${gridFontName})`;
  if (!fonts.isUnregistered(gridFontName)) return { label };
  const applied = fonts.appliedName({ fontName: gridFontName });
  return applied === undefined
    ? { label }
    : { label, note: withFontName(kit.s.fontUnregisteredShownAs, applied) };
}

/**
 * 호스트가 제공한 폰트를 선택하는 입력을 렌더링합니다.
 *
 * @remarks
 * 등록된 폰트가 하나뿐이어도 숨기지 않습니다. 지정 상태와 기본값으로 되돌린 상태를 구분해야 하고,
 * 현재 표시되는 폰트 이름도 폰트 항목에서 확인할 수 있어야 하기 때문입니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param current - 현재 지정된 폰트 이름
 * @param apply - 저장 콜백 (빈 값이면 지정 해제)
 * @param opts - `ariaLabel`은 보조기기용 이름, `inherit`은 기본값 항목의 문구,
 * `style`은 굵게·기울임까지 반영해 실제 적용 폰트를 찾을 스타일입니다
 * @returns 폰트 선택 UI
 */
export function fontNameRow(
  kit: PanelKit,
  act: ElementActions,
  current: string | undefined,
  apply: (value: string | null) => void,
  opts?: { ariaLabel?: string; inherit?: FontDefaultOption; style?: FontStyleInput; mixed?: boolean },
) {
  const s = kit.s;
  const fonts = act.fonts;
  const inherit = opts?.inherit ?? fontDefaultOption(kit, fonts.fallback);
  // 선택한 셀의 폰트가 서로 다르면 파일에 저장되지 않는 「혼합」 항목을 표시합니다.
  const mixed = opts?.mixed === true;
  // 목록에 없는 이름을 지정한 요소도 그 값을 그대로 고를 수 있어야 합니다.
  const options = current !== undefined && !fonts.selectable.includes(current)
    ? [current, ...fonts.selectable]
    : fonts.selectable;
  // 굵게·기울임 변형의 등록이 실패했을 때도 알려야 하므로 스타일 전체로 판정합니다.
  const style = opts?.style ?? { fontName: current };
  const unregistered = fonts.isUnregistered(current);
  const failed = fonts.hasFailed(style);
  const applied = fonts.appliedName(style);
  return html`
    <div class="prop-row">
      <label>${s.fontName}</label>
      ${kit.listSelect({
        id: 'font-name',
        ariaLabel: opts?.ariaLabel ?? s.fontName,
        value: mixed ? MIXED_OPTION : current ?? '',
        className: mixed ? 'mixed' : current === undefined ? 'dim' : '',
        options: [
          ...(mixed ? [{ value: MIXED_OPTION, label: s.mixed }] : []),
          { value: '', label: inherit.label },
          ...options.map((name) => ({ value: name, label: name })),
        ],
        onPick: (value) => {
          if (value === MIXED_OPTION) return;
          apply(value || null);
        },
      })}
    </div>
    ${mixed
      ? nothing
      : unregistered || failed
      ? html`<div class="font-note">
          <span>${unregistered ? s.fontUnregistered : s.fontLoadFailed}</span>
          ${applied === undefined ? nothing : html`<span>${s.fontApplied}: ${applied}</span>`}
        </div>`
      : current === undefined && inherit.note !== undefined
        ? html`<div class="font-note"><span>${inherit.note}</span></div>`
        : nothing}`;
}

/**
 * 굵게·기울임에 쓸 변형 글꼴이 없다는 안내를 렌더링합니다.
 *
 * @remarks
 * PDF는 등록된 변형 글꼴이 없으면 굵게·기울임을 적용하지 않습니다. 캔버스도 같은 규칙을
 * 사용하므로 스타일이 적용되지 않는 이유를 폰트 항목에서 알립니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param fonts - 폰트 목록과 브라우저 등록 상태
 * @param style - 요소·셀에 적용되는 폰트 이름과 굵게·기울임
 * @returns 안내 조각. 알릴 것이 없으면 빈 템플릿
 */
export function fontVariantNote(kit: PanelKit, fonts: DesignerFonts, style: FontStyleInput) {
  if (fonts.names.length === 0) return nothing;
  const bold = style.bold === true;
  const italic = style.italic === true;
  if (!bold && !italic) return nothing;
  const s = kit.s;
  const at = (b?: boolean, i?: boolean): string | undefined =>
    fonts.resolvedName({ fontName: style.fontName, bold: b, italic: i });
  const plain = at();
  const chosen = at(bold, italic);
  // 변형 글꼴이 있으면 고른 폰트가 굵게·기울임을 뺀 결과와 달라집니다.
  if (chosen !== plain && !(bold && italic)) return nothing;
  if (!bold) return html`<div class="font-note"><span>${s.fontNoItalic}</span></div>`;
  if (!italic) {
    return chosen === plain
      ? html`<div class="font-note"><span>${s.fontNoBold}</span></div>`
      : nothing;
  }
  // 굵게와 기울임을 함께 쓰면 BoldItalic, Bold, Italic, 기본 형태 순으로 선택합니다.
  if (chosen !== plain && chosen !== at(true) && chosen !== at(undefined, true)) return nothing;
  const text = chosen === plain
    ? s.fontNoBoldItalic
    : chosen === at(true)
      ? s.fontNoBoldItalicUsesBold
      : s.fontNoBoldItalicUsesItalic;
  return html`<div class="font-note"><span>${text}</span></div>`;
}

/**
 * 글자 크기, 색, 정렬과 줄 간격 등 글자 스타일을 편집하는 패널을 렌더링합니다.
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
      { style: el as FontStyleInput },
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
 * 이미지 요소의 고정 이미지와 파라미터 이미지를 편집하는 패널을 렌더링합니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 이미지 요소
 * @returns 이미지 편집 조각
 */
export function imageProps(kit: PanelKit, act: ElementActions, el: ImageElement) {
  const s = kit.s;
  // 이미지 요소는 고정 소스와 파라미터 중 하나만 사용합니다.
  const variable = el.parameter !== undefined;
  // base64 문자열 대신 현재 이미지를 표시합니다.
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
 * 선 요소에는 별도의 종류별 속성 패널을 표시하지 않습니다.
 * 방향은 캔버스의 끝점 핸들로 변경합니다.
 *
 * @param _kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param _el - 선택한 선 요소
 * @returns 빈 조각
 */
export function lineProps(_kit: PanelKit, _el: LineElement) {
  return nothing;
}

/**
 * 정다각형의 변 수를 편집하는 패널을 렌더링합니다.
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
              aria-label=${s.sides}
              aria-invalid=${String(kit.hasError('polygon-sides'))}
              aria-describedby=${kit.hasError('polygon-sides') ? 'error-polygon-sides' : nothing}
              @change=${(e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                // 스키마가 허용하는 3~12 범위만 적용합니다.
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
 * 그리드 또는 선택 셀의 텍스트 표시 방식을 편집하는 선택기를 렌더링합니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param config - 입력 id, 현재 값, 상속 선택지 표시 여부, 접근성 레이블과 저장 콜백
 * @returns 표시 방식 선택기
 */
export function gridOverflowRow(kit: PanelKit, config: {
  id: string;
  /** 현재 값. `mixed`는 선택한 셀마다 달라 저장되지 않는 「혼합」 항목을 표시합니다 */
  value: 'inherit' | 'clip' | 'shrink' | 'mixed';
  inherit?: boolean;
  ariaLabel?: string;
  onPick: (value: 'inherit' | 'clip' | 'shrink') => void;
}) {
  const s = kit.s;
  const mixed = config.value === 'mixed';
  return html`
    <div class="prop-row">
      <label>${s.overflow}</label>
      ${kit.listSelect({
        id: config.id,
        ariaLabel: config.ariaLabel ?? s.overflow,
        value: mixed ? MIXED_OPTION : config.value,
        className: mixed ? 'mixed' : '',
        options: [
          ...(mixed ? [{ value: MIXED_OPTION, label: s.mixed }] : []),
          ...(config.inherit ? [{ value: 'inherit', label: s.overflowInherit }] : []),
          { value: 'clip', label: s.overflowClip },
          { value: 'shrink', label: s.overflowShrink },
        ],
        onPick: (value) => {
          if (value === MIXED_OPTION) return;
          config.onPick(value as 'inherit' | 'clip' | 'shrink');
        },
      })}
    </div>
  `;
}

/**
 * 요소 좌표의 기준점을 선택하는 입력을 렌더링합니다. 기준점은 파일에 저장하지 않습니다.
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
 * 요소 크기 입력을 렌더링합니다.
 * 선은 너비와 높이 대신 길이, 각도, 선 굵기로 편집합니다.
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

  // 모든 선 방향에 같은 길이, 각도, 굵기 입력을 사용합니다.
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
 * 필드 요소의 값 소스를 편집하는 패널을 렌더링합니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 필드 요소
 * @returns 값 소스 편집 조각
 */
export function fieldProps(kit: PanelKit, act: ElementActions, el: FieldElement) {
  const s = kit.s;
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;
  // 필드는 파라미터와 수식 중 하나만 값 소스로 사용합니다.
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
            <input .value=${live(el.formula ?? '')} aria-label=${s.formula}
              aria-invalid=${String(kit.hasError('field-formula'))}
              @change=${(e: Event) => {
                const value = valOf(e);
                if (!kit.acceptFormula({ kind: 'field', elementId: el.id }, value, 'field-formula')) return;
                act.update((target) => {
                  if (target.type !== 'field') return;
                  setOptional(target, 'formula', value.trim() || null);
                });
              }}>
            <button class="row-btn"
              title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
              @click=${() => kit.openFormulaModal({ kind: 'field', elementId: el.id })}
              >${icons.formula}</button>
          </div>
          ${kit.error('field-formula')}`}
    </div>
  `;
}

/**
 * 바코드 종류와 값 소스를 편집하는 패널을 렌더링합니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 선택한 바코드 요소
 * @returns 바코드 편집 조각
 */
export function barcodeProps(kit: PanelKit, act: ElementActions, el: BarcodeElement) {
  const s = kit.s;
  const valOf = (e: Event) => (e.target as HTMLInputElement).value;
  // 설정된 속성으로 현재 값 소스 종류를 결정합니다 (SPEC §5.6).
      const source: 'content' | 'parameter' | 'formula' =
        el.parameter !== undefined ? 'parameter' : el.formula !== undefined ? 'formula' : 'content';
      // 직접 입력한 값만 편집 중에 바코드 형식을 검사합니다.
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
          ${act.barcodeKindsError
            ? html`<div class="input-error field-error barcode-kinds-error" role="alert">${act.barcodeKindsError}</div>`
            : nothing}
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
                <input .value=${el.content ?? ''} aria-label=${s.content}
                  @change=${(e: Event) => act.setBarcodeSource('content', valOf(e))}>
              </div>
              ${warning ? html`<p class="image-error" role="alert">${warning}</p>` : nothing}`
            : source === 'parameter'
              ? act.barcodeParameterSelect(el.parameter ?? '')
              : html`
                <div class="prop-row">
                  <label>${s.formula}</label>
                  <input .value=${live(el.formula ?? '')} aria-label=${s.formula}
                    aria-invalid=${String(kit.hasError('barcode-formula'))}
                    @change=${(e: Event) => {
                      const value = valOf(e);
                      if (!kit.acceptFormula({ kind: 'barcode', elementId: el.id }, value, 'barcode-formula')) return;
                      act.setBarcodeSource('formula', value.trim());
                    }}>
                  <button class="row-btn"
                    title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
                    @click=${() => kit.openFormulaModal({ kind: 'barcode', elementId: el.id })}
                    >${icons.formula}</button>
                </div>
                ${kit.error('barcode-formula')}`}
        </div>
      `;
}

/**
 * 요소를 어느 출력 페이지에 낼지 선택하는 구역을 렌더링합니다.
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
  // 자신과, 자신을 뒤따르는 요소는 이어서 배치의 대상으로 선택할 수 없습니다 (순환 방지).
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
 * 글자, 테두리, 배경 스타일 구역을 요소 종류에 맞게 묶어 렌더링합니다.
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
  // 선 요소에는 선 색상과 형태를 표시하고 굵기는 크기 입력에서 편집합니다.
  const isLine = el.type === 'line';
  // 파선과 점선은 직선 테두리를 사용하는 요소에만 지원합니다.
  const hasBorderShape = el.type === 'line' || el.type === 'rect' || el.type === 'grid';
  // 텍스트와 필드는 기본 테두리가 없고 나머지 요소는 기본 굵기를 사용합니다.
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
        ${hasTextDecor ? fontVariantNote(kit, act.fonts, el as FontStyleInput) : nothing}
      </div>` : nothing}
    ${hasBackground ? html`
      <div class="prop-section">
        <div class="prop-section-title">${s.styleBackground}</div>
        ${colorControl(kit, s.backgroundColor, r.backgroundColor as string | undefined, 'backgroundColor')}
      </div>` : nothing}
    ${el.type === 'grid' ? gridBorderSections(kit, act, el) : html`
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
        // 텍스트와 필드의 0 굵기는 기본값이므로 파일에 저장하지 않습니다.
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
              if (v === 'solid') delete t.borderStyle;
              else {
                t.borderStyle = v;
                // 모서리 반경은 파선 또는 점선과 함께 사용할 수 없습니다.
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
    </div>`}
  `;
}

/**
 * 여러 요소를 함께 선택했을 때 정렬과 그룹화 명령을 렌더링합니다.
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
      ${paperOverflowNotice(kit, act, els)}
    </div>
    ${arrangeSection(kit, act, els)}
  `;
}

/**
 * 그리드의 「셀 기본 테두리」와 「그리드 테두리」 구역을 렌더링합니다.
 *
 * @remarks
 * 셀 기본 테두리는 셀에 설정이 없을 때 쓰는 값이고, 그리드 테두리는 그리드를 감싸는 별도
 * 그리드 테두리입니다. 이전 파일의 `border*` 값은 셀 기본 테두리의 현재 적용값으로 보여 주고,
 * 한 항목이라도 바꾸면 새 표기로 옮깁니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param act - 요소 편집 동작
 * @param el - 그리드 요소
 * @returns 두 구역 조각
 */
export function gridBorderSections(kit: PanelKit, act: ElementActions, el: GridElement) {
  const s = kit.s;
  const onGrid = (fn: (grid: GridElement) => void) =>
    act.update((target) => {
      if (target.type === 'grid') fn(target);
    });
  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.styleCellDefaultBorder}</div>
      ${colorControl(kit,
        s.borderColor, el.cellBorderColor ?? el.borderColor, 'cellDefaultBorderColor',
        (v) => onGrid((grid) => applyCellDefaultBorder(grid, { key: 'color', value: v })),
        DEFAULT_BORDER_COLOR,
        `${s.styleCellDefaultBorder} ${s.borderColor}`,
      )}
      ${borderWidthSelect(kit,
        el.cellBorderWidth ?? el.borderWidth,
        DEFAULT_LINE_WIDTH,
        true,
        'cellDefaultBorderWidth',
        (v) => onGrid((grid) => applyCellDefaultBorder(grid, { key: 'width', value: v })),
        `${s.styleCellDefaultBorder} ${s.borderWidth}`,
      )}
      ${borderShapeRow(kit,
        el.cellBorderStyle ?? el.borderStyle,
        `${s.styleCellDefaultBorder} ${s.borderShape}`,
        'cellDefaultBorderStyle',
        (v) => onGrid((grid) => applyCellDefaultBorder(grid, { key: 'style', value: v === 'solid' ? null : v })),
      )}
    </div>
    <div class="prop-section">
      <div class="prop-section-title">${s.styleOutline}</div>
      ${colorControl(kit,
        s.borderColor, el.outlineColor, 'outlineColor',
        (v) => onGrid((grid) => applyOutline(grid, { key: 'color', value: v })),
        DEFAULT_BORDER_COLOR,
        `${s.styleOutline} ${s.borderColor}`,
      )}
      ${borderWidthSelect(kit,
        el.outlineWidth,
        0,
        true,
        'outlineWidth',
        (v) => onGrid((grid) => applyOutline(grid, { key: 'width', value: v })),
        `${s.styleOutline} ${s.borderWidth}`,
      )}
      ${borderShapeRow(kit,
        el.outlineStyle,
        `${s.styleOutline} ${s.borderShape}`,
        'outlineStyle',
        (v) => onGrid((grid) => applyOutline(grid, { key: 'style', value: v === 'solid' ? null : v })),
      )}
    </div>`;
}
