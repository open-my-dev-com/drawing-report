/**
 * 조건부 서식 규칙을 평가해 적용할 색과 글자 강조를 계산한다.
 *
 * 디자이너 캔버스, 작성 폼, 뷰어와 PDF가 같은 결과를 내도록 평가는 이 모듈 한 곳에서
 * 수행한다. 기본 서식을 먼저 적용한 뒤 이 결과로 색과 글자 강조를 덮어쓴다 (SPEC §9.4).
 */
import type { ConditionalFormatRule } from '../format/schema.js';
import { FormulaEvalError } from '../formula/errors.js';
import { evaluateFormula } from '../formula/evaluator.js';
import { SlipRenderError } from './errors.js';
import { rm } from './messages.js';

/** 조건부 서식 평가로 결정된 색·글자 강조 덮어쓰기. 조건이 참인 규칙이 없으면 모두 비어 있다. */
export interface ConditionalFormatOverrides {
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

/**
 * 조건부 서식 규칙 목록을 평가해 적용할 색과 글자 강조를 만든다.
 *
 * 조건이 참인 규칙을 선언된 순서대로 합성하며, 같은 속성은 뒤에 선언된
 * 규칙의 값을 사용한다. 강조는 `true`면 적용하고 `false`면 기본 서식의 강조를 끈다.
 *
 * 값이 없거나 타입이 맞지 않아 계산할 수 없는 조건은 참으로 보지 않고 규칙을
 * 건너뛴다 — 빈 양식과 입력 중인 전표에는 값이 없는 것이 정상 상태이기 때문이다.
 *
 * @param rules - 조건부 서식 규칙 목록. 생략하면 빈 결과를 반환한다
 * @param scope - 조건식이 참조할 값. 반복 구간 안에서는 전표 값에 현재 항목을 합쳐 전달한다
 * @param options - `locale`: 오류 메시지 언어, `subject`: 오류 메시지에 쓸 대상 이름
 * @returns 덮어쓸 색·강조 목록
 * @throws SlipRenderError 조건식에 문법 오류가 있거나 결과가 논리값이 아니면
 */
export function resolveConditionalFormats(
  rules: readonly ConditionalFormatRule[] | undefined,
  scope: Record<string, unknown>,
  options?: { locale?: string; subject?: string },
): ConditionalFormatOverrides {
  const result: ConditionalFormatOverrides = {};
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
      // 데이터에 따라 달라지는 계산 오류(값 없음·타입 불일치)는 규칙 미적용으로 처리하고,
      // 데이터와 무관한 문법 오류는 조건식 작성 실수이므로 오류로 알린다.
      if (error instanceof FormulaEvalError) return;
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
    if (rule.bold !== undefined) result.bold = rule.bold;
    if (rule.italic !== undefined) result.italic = rule.italic;
    if (rule.underline !== undefined) result.underline = rule.underline;
    if (rule.strikethrough !== undefined) result.strikethrough = rule.strikethrough;
  });
  return result;
}
