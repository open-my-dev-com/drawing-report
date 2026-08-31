/**
 * 속성 패널의 공통 입력 — 숫자 줄, 펼침 표시, 글자 강조 토글, 테두리와 색 선택.
 *
 * @remarks
 * 모두 `PanelKit`만 받아 그린다. 화면 상태는 컨트롤러가 갖고 여기서는 읽기만 한다.
 */

import { html, nothing } from 'lit';
import { icons } from '../../icons.js';
import { PX_PER_MM } from '../geometry.js';
import { BORDER_WIDTH_STEPS } from '../style-css.js';
import { COLOR_PALETTE } from '../color.js';
import { propertyMenuStyle, listSelectStyle } from '../controllers/popover.js';
import type { PopoverController } from '../controllers/popover.js';
import type { ConditionalFormatRule } from '@omdc-slipkit/core';
import type { PanelKit } from './panel-kit.js';

/**
 * 명시된 값이 없으면 기본값을 표시하는 숫자 입력 행을 만든다.
 * 기본값과 같은 값은 파일에 저장하지 않으며 잘못된 입력은 이전 값으로 되돌린다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param label - 항목 이름
 * @param current - 현재 저장된 값
 * @param fallback - 지정하지 않았을 때 실제로 적용되는 값
 * @param apply - 저장 콜백. 기본값과 같으면 `null`이 와서 필드를 지운다
 * @param opts - `step`·`min` 등 입력 상자 설정
 * @returns 수 입력 한 줄
 */
export function numberRow(
  kit: PanelKit,
  label: string,
  current: number | undefined,
  fallback: number,
  apply: (value: number | null) => void,
  opts: { step?: string; min?: string; ariaLabel?: string; errorKey?: string } = {},
) {
  const errorKey = opts.errorKey ?? 'number-input';
  const commit = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    // 브라우저가 잘못된 숫자 입력을 빈 문자열로 반환하므로 이전 값으로 복원한다.
    if (input.validity.badInput) {
      input.value = String(current ?? fallback);
      kit.reject(kit.s.numberInput, errorKey);
      return;
    }
    const raw = input.value.trim();
    if (raw === '') {
      apply(null);
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || (opts.min !== undefined && v < Number(opts.min))) {
      input.value = String(current ?? fallback);
      const message = !Number.isFinite(v)
        ? kit.s.numberInput
        : kit.s.minimumInput.replace('{min}', opts.min!);
      kit.reject(message, errorKey);
      return;
    }
    apply(v === fallback ? null : v);
  };
  return html`
    <div class="prop-row">
      <label>${label}</label>
      <input type="number" step=${opts.step ?? '0.5'} min=${opts.min ?? nothing}
        aria-label=${opts.ariaLabel ?? label}
        aria-invalid=${String(kit.hasError(errorKey))}
        aria-describedby=${kit.hasError(errorKey) ? `error-${errorKey}` : nothing}
        class=${current === undefined ? 'dim' : ''}
        .value=${String(current ?? fallback)}
        @change=${commit}>
    </div>
    ${kit.error(errorKey)}`;
}

/**
 * 하위 항목이 있는 사이드바 행에 펼침 버튼을 표시한다.
 * 하위 항목이 없으면 같은 너비의 빈 공간을 표시한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param hasChildren - 하위 줄이 있는지
 * @param expanded - 현재 펼침 상태
 * @param name - 무엇을 펼치고 접는지 (읽어 주는 이름에 사용한다)
 * @param toggle - 눌렀을 때 펼침을 뒤집는 처리
 * @returns 펼침 표시 또는 빈 자리
 */
export function twisty(
  kit: PanelKit,
  hasChildren: boolean,
  expanded: boolean,
  name: string,
  toggle: () => void,
) {
  if (!hasChildren) return html`<span class="side-twisty-gap"></span>`;
  const s = kit.s;
  const label = expanded ? s.collapseRow : s.expandRow;
  return html`
    <button class="side-twisty" aria-label="${name} ${label}" title=${label}
      aria-expanded=${String(expanded)}
      @click=${toggle}>${expanded ? icons.treeOpen : icons.treeClosed}</button>`;
}

/**
 * 굵게, 밑줄, 취소선 토글을 렌더링한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param current - 현재 글자 강조 상태
 * @param apply - 바뀐 강조를 저장하는 콜백
 * @param ariaPrefix - 접근성 레이블 앞에 붙일 대상 이름
 * @returns 강조 토글 세 개
 */
export function textStyleToggles(
  kit: PanelKit,
  current: {
    bold?: boolean | undefined;
    underline?: boolean | undefined;
    strikethrough?: boolean | undefined;
  },
  apply: (key: 'bold' | 'underline' | 'strikethrough', value: boolean) => void,
  ariaPrefix = '',
) {
  const s = kit.s;
  return html`
    <div class="prop-row">
      <label>${s.style}</label>
      <div class="toggle-group" role="group" aria-label="${ariaPrefix}${s.style}">
        ${([
          ['bold', s.bold, icons.bold],
          ['underline', s.underline, icons.underline],
          ['strikethrough', s.strikethrough, icons.strikethrough],
        ] as const).map(([key, label, glyph]) => html`
          <button title=${label} aria-label="${ariaPrefix}${label}"
            aria-pressed=${String(current[key] === true)}
            @click=${() => apply(key, current[key] !== true)}>${glyph}</button>`)}
      </div>
    </div>
  `;
}

/**
 * 테두리 굵기 선택기를 선 미리보기와 함께 렌더링한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param current - 명시된 굵기 (미지정이면 fallback이 유효값)
 * @param fallback - 미지정일 때의 유효 굵기 (요소 기본값 또는 셀이 상속하는 요소 값)
 * @param allowNone - 0 굵기 선택지를 표시할지 여부
 * @param key - 펼침 상태를 구분할 키
 * @param apply - 선택한 굵기를 저장하는 콜백
 * @param labelText - 화면에 표시할 레이블
 * @returns 굵기 선택기
 */
export function borderWidthSelect(
  kit: PanelKit,
  current: number | undefined,
  fallback: number,
  allowNone: boolean,
  key: string,
  apply: (value: number) => void,
  labelText?: string,
) {
  const s = kit.s;
  const label = labelText ?? s.borderWidth;
  const effective = current ?? fallback;
  const open = kit.popovers.isOpen('property', key);
  // 기본 선택지에 없는 현재 값도 목록에 포함한다.
  const steps = [...new Set<number>([...BORDER_WIDTH_STEPS, ...(effective > 0 ? [effective] : [])])]
    .sort((a, b) => a - b);
  const previewPx = (w: number): number => Math.min(6, Math.max(1, Math.round(w * PX_PER_MM)));
  const pick = (value: number): void => {
    kit.popovers.close('property');
    apply(value);
  };
  return html`
    <div class="prop-row">
      <label>${label}</label>
      <button class="width-btn" aria-label=${label} aria-haspopup="menu"
        aria-expanded=${String(open)}
        @click=${(event: Event) => kit.togglePropertyMenu(key, event)}>
        ${effective > 0
          ? html`<span class="width-line" style="border-top-width:${previewPx(effective)}px"></span>
              <span class="width-value ${current === undefined ? 'dim' : ''}">${effective}mm</span>`
          : html`<span class="width-value ${current === undefined ? 'dim' : ''}"
              >${s.colorNone}</span>`}
        <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
      </button>
    </div>
    ${open ? html`
      <div class="menu-backdrop" @click=${() => kit.popovers.close('property')}></div>
      <div class="preset-menu width-pop" role="menu" aria-label=${label}
        style=${propertyMenuStyle(kit.popovers.placement('property'))}>
        ${allowNone ? html`
          <button role="menuitem" aria-label="${label}: ${s.colorNone}"
            aria-pressed=${String(effective <= 0)}
            @click=${() => pick(0)}>
            <span class="width-value">${s.colorNone}</span>
          </button>` : nothing}
        ${steps.map((w) => html`
          <button role="menuitem" aria-label="${label}: ${w}mm"
            aria-pressed=${String(w === effective)}
            @click=${() => pick(w)}>
            <span class="width-line" style="border-top-width:${previewPx(w)}px"></span>
            <span class="width-value">${w}mm</span>
          </button>`)}
      </div>` : nothing}
  `;
}

/**
 * 실선, 파선, 점선 선택기를 선 미리보기와 함께 렌더링한다.
 * 실선은 기본값이므로 `null`로 적용한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param current - 명시된 형태 (미지정이면 실선)
 * @param ariaLabel - 보조기기용 이름 (요소·셀 구분)
 * @param key - 펼침 상태를 구분할 키
 * @param apply - 선택한 값을 저장하는 콜백
 * @returns 선 형태 선택기
 */
export function borderShapeRow(
  kit: PanelKit,
  current: 'solid' | 'dashed' | 'dotted' | undefined,
  ariaLabel: string,
  key: string,
  apply: (value: 'dashed' | 'dotted' | null) => void,
) {
  const s = kit.s;
  const effective = current ?? 'solid';
  const open = kit.popovers.isOpen('property', key);
  const shapes = [
    ['solid', s.borderSolid],
    ['dashed', s.borderDashed],
    ['dotted', s.borderDotted],
  ] as const;
  const labelOf = (shape: 'solid' | 'dashed' | 'dotted'): string =>
    shapes.find(([value]) => value === shape)![1];
  const pick = (shape: 'solid' | 'dashed' | 'dotted'): void => {
    kit.popovers.close('property');
    apply(shape === 'solid' ? null : shape);
  };

  return html`
    <div class="prop-row">
      <label>${s.borderShape}</label>
      <button class="width-btn" aria-label=${ariaLabel} aria-haspopup="menu"
        aria-expanded=${String(open)}
        @click=${(event: Event) => kit.togglePropertyMenu(key, event)}>
        <span class="shape-line shape-${effective}"></span>
        <span class="width-value ${current === undefined ? 'dim' : ''}">${labelOf(effective)}</span>
        <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
      </button>
    </div>
    ${open ? html`
      <div class="menu-backdrop" @click=${() => kit.popovers.close('property')}></div>
      <div class="preset-menu width-pop" role="menu" aria-label=${ariaLabel}
        style=${propertyMenuStyle(kit.popovers.placement('property'))}>
        ${shapes.map(([value, label]) => html`
          <button role="menuitem" aria-label="${ariaLabel}: ${label}"
            aria-pressed=${String(value === effective)}
            @click=${() => pick(value)}>
            <span class="shape-line shape-${value}"></span>
            <span class="width-value">${label}</span>
          </button>`)}
      </div>` : nothing}
  `;
}

/**
 * 색상 견본, HSV 선택기, 직접 입력, 투명도를 포함한 색상 입력을 렌더링한다.
 * 색상은 파일 스키마와 같은 `#RRGGBB` 또는 `#RRGGBBAA` 형식으로 저장한다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param label - 화면에 보이는 항목 이름
 * @param current - 지정된 색 (없으면 undefined)
 * @param key - 펼침 상태를 구분할 키
 * @param apply - 색을 저장하는 콜백 (없으면 선택 요소의 스타일 필드에 저장)
 * @param fallback - 명시된 값이 없을 때 적용할 색
 * @param ariaLabel - 접근성 레이블
 * @returns 색상 입력 조각
 */
export function colorControl(
  kit: PanelKit,
  label: string,
  current: string | undefined,
  key: string,
  apply?: (value: string | null) => void,
  fallback?: string | undefined,
  ariaLabel?: string,
) {
  // apply가 없으면 선택된 요소의 색상 속성을 변경한다.
  const commit = (value: string | null): void => {
    if (apply) {
      if (value) kit.picker.seed(value);
      apply(value);
    } else {
      kit.applyElementColor(key, value);
    }
  };
  const s = kit.s;
  const base = current?.slice(0, 7) ?? '#000000';
  const alphaPct = current && current.length === 9
    ? Math.round((parseInt(current.slice(7, 9), 16) / 255) * 100)
    : 100;
  const compose = (hex: string, pct: number): string => {
    const clamped = Math.max(0, Math.min(100, pct));
    if (clamped >= 100) return hex;
    return hex + Math.round((clamped / 100) * 255).toString(16).padStart(2, '0');
  };
  const open = kit.popovers.isOpen('property', key);
  // 명시된 값이 없으면 상속값 또는 기본값을 표시한다.
  const shown = current ?? fallback;
  // 요소와 셀의 같은 속성을 구분할 접근성 레이블을 사용한다.
  const name = ariaLabel ?? label;

  return html`
    <div class="prop-row">
      <label>${label}</label>
      <button class="color-btn" aria-label=${name} aria-expanded=${String(open)}
        @click=${() => {
          // 색 팝오버는 스타일로 자리를 잡으므로 자리 계산 없이 연다.
          kit.popovers.toggle('property', key);
          // 열 때 현재 색으로, 지정된 색이 없으면 기본 빨강으로 선택기를 맞춘다.
          if (!open) kit.picker.seed(current ?? '#ff0000');
        }}>
        <span class="color-chip ${shown ? '' : 'none'}"
          style=${shown ? `background:${shown.slice(0, 7)}` : nothing}></span>
        <span class="color-value ${current === undefined ? 'dim' : ''}"
          >${shown ?? s.colorNone}</span>
      </button>
    </div>
    ${open ? html`
      <div class="color-pop">
        <div class="color-extras">
          <button class="swatch none" title=${s.colorNone} aria-label="${name}: ${s.colorNone}"
            aria-pressed=${String(current === undefined)}
            @click=${() => commit(null)}></button>
          ${COLOR_PALETTE.map((c) => html`<button class="swatch" style="background:${c}"
            title=${c} aria-label="${name} ${c}"
            aria-pressed=${String(current?.slice(0, 7).toLowerCase() === c)}
            @click=${() => commit(compose(c, alphaPct))}></button>`)}
          ${kit.picker.customColors().map((c) => html`<button class="swatch custom" style="background:${c}"
            title=${c} aria-label="${name} ${c}"
            aria-pressed=${String(current?.toLowerCase() === c.toLowerCase())}
            @click=${() => commit(c)}></button>`)}
          <button class="swatch-save" title=${s.saveColor} aria-label="${name}: ${s.saveColor}"
            ?disabled=${!current}
            @click=${() => {
              // 기본 팔레트에 있는 색상은 사용자 지정 목록에 저장하지 않는다.
              if (!current || (COLOR_PALETTE as readonly string[]).includes(current)) return;
              kit.picker.saveCustomColor(current);
            }}>${icons.pageAdd}</button>
        </div>
        <div class="sv-area" aria-label="${name} ${s.style}"
          style="background:linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${kit.picker.hue}, 100%, 50%))"
          @pointerdown=${(e: PointerEvent) => {
            kit.picker.startDrag(key);
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
            kit.picker.pointTo(e);
          }}
          @pointermove=${(e: PointerEvent) => {
            if (kit.picker.isDragging(key)) kit.picker.pointTo(e);
          }}
          @pointerup=${(e: PointerEvent) => {
            if (!kit.picker.isDragging(key)) return;
            kit.picker.endDrag();
            kit.picker.pointTo(e);
            commit(compose(kit.picker.hex, alphaPct));
          }}
          @pointercancel=${() => kit.picker.endDrag()}>
          <span class="sv-thumb"
            style="left:${(kit.picker.saturation * 100).toFixed(1)}%;top:${((1 - kit.picker.value) * 100).toFixed(1)}%"></span>
        </div>
        <input type="range" class="hue-slider" min="0" max="360" step="1"
          .value=${String(Math.round(kit.picker.hue))}
          title="${name} ${s.hue}" aria-label="${name} ${s.hue}"
          @input=${(e: Event) => {
            kit.picker.setHue(Number((e.target as HTMLInputElement).value));
          }}
          @change=${() =>
            commit(compose(kit.picker.hex, alphaPct))}>
        <div class="color-pop-row">
          <input .value=${current ?? ''} placeholder="#RRGGBB"
            aria-invalid=${String(kit.hasError(`color-${key}`))}
            aria-describedby=${kit.hasError(`color-${key}`) ? `error-color-${key}` : nothing}
            @change=${(e: Event) => {
              // 파일 스키마가 허용하는 HEX 색상만 적용한다.
              const v = (e.target as HTMLInputElement).value;
              if (v && !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
                kit.reject(s.colorFormatError, `color-${key}`);
                return;
              }
              commit(v || null);
            }}>
          <input type="number" class="alpha-input" min="0" max="100" .value=${String(alphaPct)}
            title=${s.opacity} aria-label="${label} ${s.opacity}"
            aria-invalid=${String(kit.hasError(`opacity-${key}`))}
            aria-describedby=${kit.hasError(`opacity-${key}`) ? `error-opacity-${key}` : nothing}
            @change=${(e: Event) => {
              if (!current) return;
              const value = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(value) || value < 0 || value > 100) {
                kit.reject(
                  s.rangeInput.replace('{min}', '0').replace('{max}', '100'),
                  `opacity-${key}`,
                );
                return;
              }
              commit(compose(base, value));
            }}>
          <span class="alpha-suffix">%</span>
        </div>
        ${kit.error(`color-${key}`)}
        ${kit.error(`opacity-${key}`)}
      </div>` : nothing}
  `;
}

/**
 * 조건부 서식 규칙의 강조 4종을 3단계로 편집하는 토글 행을 렌더링한다.
 * 각 버튼은 기본 유지(미지정) → 적용(true) → 해제(false) 순서로 바뀐다.
 *
 * @param kit - 패널 렌더링에 필요한 문구와 상태
 * @param rule - 편집 중인 규칙
 * @param apply - 강조 값을 저장하는 콜백 (`undefined`는 기본 유지)
 * @param ariaPrefix - 접근성 레이블 접두사 (규칙 이름)
 * @returns 강조 토글 네 개
 */
export function conditionalEmphasisRow(
  kit: PanelKit,
  rule: ConditionalFormatRule,
  apply: (key: 'bold' | 'italic' | 'underline' | 'strikethrough', value: boolean | undefined) => void,
  ariaPrefix: string,
) {
  const s = kit.s;
  const stateLabel = (value: boolean | undefined): string =>
    value === undefined ? s.emphasisKeep : value ? s.emphasisApply : s.emphasisClear;
  const nextOf = (value: boolean | undefined): boolean | undefined =>
    value === undefined ? true : value ? false : undefined;
  return html`
    <div class="prop-row">
      <label>${s.style}</label>
      <div class="toggle-group" role="group" aria-label="${ariaPrefix}${s.style}">
        ${([
          ['bold', s.bold, icons.bold],
          ['italic', s.italic, icons.italic],
          ['underline', s.underline, icons.underline],
          ['strikethrough', s.strikethrough, icons.strikethrough],
        ] as const).map(([key, label, glyph]) => {
          const value = rule[key];
          return html`<button title="${label}: ${stateLabel(value)}"
            aria-label="${ariaPrefix}${label}: ${stateLabel(value)}"
            aria-pressed=${value === undefined ? 'false' : value ? 'true' : 'mixed'}
            @click=${() => apply(key, nextOf(value))}>${glyph}</button>`;
        })}
      </div>
    </div>
  `;
}

/**
 * 네이티브 select 대신 쓰는 리스트형 선택 상자를 렌더링한다.
 * 트리거 버튼을 누르면 버튼 아래 화면 고정 위치에 항목 목록이 열린다.
 *
 * @param pop - 팝오버 열림 상태
 * @param toggle - 트리거를 눌렀을 때 목록을 열고 닫는 처리
 * @param config - 입력 id, 접근성 레이블, 현재 값, 선택지, 선택 콜백과 표시 설정
 * @returns 선택 상자 조각
 */
export function listSelect(
  pop: PopoverController,
  toggle: (id: string, event: Event) => void,
  config: {
    id: string;
    ariaLabel: string;
    value: string;
    options: { value: string; label: string; description?: string }[];
    onPick: (value: string) => void;
    className?: string;
    placeholder?: string;
  },
) {
  const open = pop.isOpen('list', config.id);
  const current = config.options.find((o) => o.value === config.value);
  return html`
    <button type="button" class="list-select ${config.className ?? ''}"
      aria-haspopup="listbox" aria-expanded=${String(open)} aria-label=${config.ariaLabel}
      data-value=${config.value}
      @click=${(e: Event) => toggle(config.id, e)}>
      <span class="list-select-value">${current?.label ?? config.placeholder ?? config.value}</span>
      <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
    </button>
    ${open
      ? html`
        <div class="menu-backdrop" @click=${() => pop.close('list')}></div>
        <div class="preset-menu list-select-menu" role="listbox" aria-label=${config.ariaLabel}
          style=${listSelectStyle(pop.placement('list'))}>
          ${config.options.map((o) => html`
            <button type="button" role="option" data-value=${o.value}
              class=${o.description === undefined ? '' : 'described'}
              aria-selected=${String(o.value === config.value)}
              @click=${() => {
                pop.close('list');
                config.onPick(o.value);
              }}>
              <span class="list-select-option-label">${o.label}</span>
              ${o.description === undefined
                ? nothing
                : html`<span class="list-select-option-description">${o.description}</span>`}
            </button>`)}
        </div>`
      : nothing}
  `;
}
