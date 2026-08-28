/**
 * 조건부 서식 규칙을 평가해 적용할 색을 계산한다.
 *
 * 디자이너 캔버스, 작성 폼, 뷰어와 PDF가 같은 결과를 내도록 평가는 이 모듈 한 곳에서
 * 수행한다. 기본 서식을 먼저 적용한 뒤 이 결과로 색을 덮어쓴다 (SPEC §9.4).
 */
import type { ConditionalFormatRule } from '../format/schema.js';
import { evaluateFormula } from '../formula/evaluator.js';
import { SlipRenderError } from './errors.js';
import { rm } from './messages.js';

/** 조건부 서식 평가로 결정된 색 덮어쓰기. 조건이 참인 규칙이 없으면 모두 비어 있다. */
export interface ConditionalFormatColors {
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
}

/**
 * 조건부 서식 규칙 목록을 평가해 적용할 색을 만든다.
 *
 * 조건이 참인 규칙을 선언된 순서대로 합성하며, 같은 색 속성은 뒤에 선언된
 * 규칙의 값을 사용한다.
 *
 * @param rules - 조건부 서식 규칙 목록. 생략하면 빈 결과를 반환한다
 * @param scope - 조건식이 참조할 값. 반복 구간 안에서는 전표 값에 현재 항목을 합쳐 전달한다
 * @param options - `locale`: 오류 메시지 언어, `subject`: 오류 메시지에 쓸 대상 이름
 * @returns 덮어쓸 색 목록
 * @throws SlipRenderError 조건식 계산에 실패하거나 결과가 논리값이 아니면
 */
export function resolveConditionalFormats(
  rules: readonly ConditionalFormatRule[] | undefined,
  scope: Record<string, unknown>,
  options?: { locale?: string; subject?: string },
): ConditionalFormatColors {
  const result: ConditionalFormatColors = {};
  if (rules === undefined || rules.length === 0) return result;
  const locale = options?.locale;
  const messages = rm(locale);
  const what = options?.subject ?? messages.subjectDefault();
  rules.forEach((rule, index) => {
    let value: unknown;
    try {
      value = evaluateFormula(
        rule.condition,
        locale === undefined ? { values: scope } : { values: scope, locale },
      );
    } catch (error) {
      throw new SlipRenderError(
        messages.conditionFailed(what, index + 1, error instanceof Error ? error.message : String(error)),
      );
    }
    // 조건식은 논리값을 반환해야 한다. 숫자·문자열의 암묵 변환은 허용하지 않는다.
    if (typeof value !== 'boolean') {
      throw new SlipRenderError(messages.conditionNotBoolean(what, index + 1));
    }
    if (!value) return;
    if (rule.fontColor !== undefined) result.fontColor = rule.fontColor;
    if (rule.backgroundColor !== undefined) result.backgroundColor = rule.backgroundColor;
    if (rule.borderColor !== undefined) result.borderColor = rule.borderColor;
  });
  return result;
}
