/**
 * 조건부 서식 규칙 편집 — 조건식과 색·글자 강조 재정의.
 *
 * @remarks
 * 조건식은 저장 전에 문법과 결과 타입을 확인합니다. 논리값이 아닌 조건식은 저장하지 않습니다.
 */

import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import {
  parseFormula,
  SLIP_LIMITS,
  type ConditionalFormatRule,
  type FormulaContext,
  type FormulaValue,
} from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import { colorControl, conditionalEmphasisRow } from './inputs.js';
import type { PanelKit } from './panel-kit.js';

/** 조건부 서식 편집이 컴포넌트에서 받는 것 */
export interface ConditionalFormatDeps {
  /**
   * 조건식을 평가합니다.
   *
   * @param source - 조건식
   * @param context - 평가에 사용할 값
   * @returns 평가 결과
   */
  evaluate(source: string, context: FormulaContext): FormulaValue;
  /** 샘플 값이 없을 때 사용할 파라미터 종류별 기본값 */
  probeValues(): Record<string, unknown>;
  /** 화면을 다시 그립니다 */
  refresh(): void;
}

/**
 * 값에 따라 색과 글자 강조를 바꾸는 조건부 서식 규칙 목록을 편집하는 구역을 렌더링합니다.
 *
 * @param kit - 속성 패널 렌더링에 필요한 문구와 상태
 * @param deps - 조건식 편집과 미리보기에 필요한 동작
 * @param rules - 현재 규칙 목록
 * @param keyPrefix - 입력 요소 id에 붙일 접두사 — 같은 화면의 다른 구역과 겹치지 않게 합니다
 * @param update - 바뀐 규칙 목록을 저장하는 함수
 * @param probeItem - 조건식 미리보기에 사용할 샘플 항목
 * @param ariaPrefix - 접근성 레이블 앞에 붙일 대상 이름
 * @returns 조건부 서식 편집 구역
 */
export function conditionalFormatsSection(
  kit: PanelKit,
  deps: ConditionalFormatDeps,
  rules: readonly ConditionalFormatRule[] | undefined,
  keyPrefix: string,
  update: (next: ConditionalFormatRule[]) => void,
  ariaPrefix = '',
  probeItem?: Record<string, unknown>,
) {
  const s = kit.s;
  const list = rules ?? [];
  const change = (mutate: (next: ConditionalFormatRule[]) => void): void => {
    const next = list.map((rule) => ({ ...rule }));
    mutate(next);
    update(next);
  };
  // 색과 강조가 모두 없는 규칙은 파일 검증에서 거부되므로 마지막 항목은 지울 수 없습니다.
  const effectKeys = [
    'fontColor', 'backgroundColor', 'borderColor', 'bold', 'italic', 'underline', 'strikethrough',
  ] as const;
  const hasOtherEffect = (rule: ConditionalFormatRule, except: (typeof effectKeys)[number]): boolean =>
    effectKeys.some((key) => key !== except && rule[key] !== undefined);
  const setColor = (index: number, key: 'fontColor' | 'backgroundColor' | 'borderColor', value: string | null) => {
    if (value === null && list[index]![key] !== undefined && !hasOtherEffect(list[index]!, key)) {
      kit.popovers.close('property');
      kit.reject(s.conditionEffectRequired, `${keyPrefix}-color-${index}`);
      return;
    }
    change((next) => {
      if (value === null) delete next[index]![key];
      else next[index]![key] = value;
    });
  };
  const setEmphasis = (
    index: number,
    key: 'bold' | 'italic' | 'underline' | 'strikethrough',
    value: boolean | undefined,
  ) => {
    if (value === undefined && list[index]![key] !== undefined && !hasOtherEffect(list[index]!, key)) {
      kit.reject(s.conditionEffectRequired, `${keyPrefix}-color-${index}`);
      return;
    }
    change((next) => {
      if (value === undefined) delete next[index]![key];
      else next[index]![key] = value;
    });
  };
  const swap = (index: number, other: number) => {
    // 색 팝업 상태는 규칙 순번으로 구분하므로, 순서가 바뀌면 닫아 다른 규칙에 붙지 않게 합니다.
    kit.popovers.close('property');
    change((next) => {
      const tmp = next[index]!;
      next[index] = next[other]!;
      next[other] = tmp;
    });
  };
  return html`
    <div class="prop-section">
      <div class="prop-section-title">${s.conditionalFormat}</div>
      ${list.length > 0 ? html`<p class="image-hint">${s.conditionHint}</p>` : nothing}
      ${list.map((rule, index) => {
        const name = `${ariaPrefix}${s.conditionalFormat} ${index + 1}`;
        return html`
          <div class="prop-row">
            <label>${s.condition} ${index + 1}</label>
            <input .value=${live(rule.condition)}
              aria-label="${name}: ${s.condition}"
              aria-invalid=${String(kit.hasError(`${keyPrefix}-cond-${index}`))}
              placeholder=${s.conditionPlaceholder}
              @change=${(e: Event) => {
                // 빈 조건식은 파일 검증에서 거부되므로 저장하지 않습니다.
                const value = (e.target as HTMLInputElement).value.trim();
                if (value === '') {
                  deps.refresh();
                  return;
                }
                // 문법이 깨진 조건식은 저장하지 않고 입력 오류로 안내합니다.
                try {
                  parseFormula(value);
                } catch {
                  kit.reject(s.syntaxError, `${keyPrefix}-cond-${index}`);
                  return;
                }
                // 문법이 맞아도 견본 값으로 계산한 결과가 논리값이 아니면 저장하지 않습니다.
                try {
                  const probe = deps.evaluate(value, {
                    values: { ...deps.probeValues(), ...(probeItem ?? {}) },
                  });
                  if (typeof probe !== 'boolean') {
                    kit.reject(s.conditionNotBoolean, `${keyPrefix}-cond-${index}`);
                    return;
                  }
                } catch {
                  // 견본 값으로 계산할 수 없는 조건은 데이터에 따라 달라질 수 있으므로 막지 않습니다.
                }
                change((next) => { next[index]!.condition = value; });
              }}>
          </div>
          ${kit.error(`${keyPrefix}-cond-${index}`)}
          ${colorControl(kit,
            s.fontColor, rule.fontColor, `${keyPrefix}-font-${index}`,
            (v) => setColor(index, 'fontColor', v), undefined, `${name}: ${s.fontColor}`,
          )}
          ${colorControl(kit,
            s.backgroundColor, rule.backgroundColor, `${keyPrefix}-bg-${index}`,
            (v) => setColor(index, 'backgroundColor', v), undefined, `${name}: ${s.backgroundColor}`,
          )}
          ${colorControl(kit,
            s.borderColor, rule.borderColor, `${keyPrefix}-border-${index}`,
            (v) => setColor(index, 'borderColor', v), undefined, `${name}: ${s.borderColor}`,
          )}
          ${conditionalEmphasisRow(kit,
            rule,
            (key, value) => setEmphasis(index, key, value),
            `${name}: `,
          )}
          ${kit.error(`${keyPrefix}-color-${index}`)}
          <div class="prop-row">
            <label></label>
            <div class="toggle-group" role="group" aria-label=${name}>
              <button title=${s.conditionRuleUp} aria-label="${name}: ${s.conditionRuleUp}"
                ?disabled=${index === 0}
                @click=${() => swap(index, index - 1)}>${icons.up}</button>
              <button title=${s.conditionRuleDown} aria-label="${name}: ${s.conditionRuleDown}"
                ?disabled=${index === list.length - 1}
                @click=${() => swap(index, index + 1)}>${icons.down}</button>
              <button title=${s.deleteConditionRule} aria-label="${name}: ${s.deleteConditionRule}"
                @click=${() => {
                  kit.popovers.close('property');
                  change((next) => { next.splice(index, 1); });
                }}>${icons.remove}</button>
            </div>
          </div>`;
      })}
      <button class="col-modal-open" ?disabled=${list.length >= SLIP_LIMITS.maxConditionalFormats}
        aria-label="${ariaPrefix}${s.addConditionRule}"
        @click=${() => change((next) => { next.push({ condition: 'TRUE', fontColor: '#FF0000' }); })}>
        ${icons.pageAdd}<span>${s.addConditionRule}</span>
      </button>
    </div>
  `;
}
