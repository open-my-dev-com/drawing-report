/**
 * 조건부 서식 규칙을 평가해 적용할 색과 글자 강조를 계산합니다.
 *
 * 디자이너 캔버스, 작성 폼, 뷰어와 PDF가 같은 결과를 내도록 평가는 이 모듈 한 곳에서
 * 수행합니다. 기본 서식을 먼저 적용한 뒤 이 결과로 색과 글자 강조를 덮어씁니다(SPEC §9.4).
 */
import type { ConditionalFormatRule } from '../format/schema.js';
import { FormulaEvalError } from '../formula/errors.js';
import { evaluateFormula } from '../formula/evaluator.js';
import { SlipRenderError } from './errors.js';
import { rm } from './messages.js';

/** 조건부 서식 평가로 결정된 색과 글자 강조입니다. 조건이 참인 규칙이 없으면 모두 비어 있습니다. */
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
 * 조건부 서식 규칙 목록을 평가해 적용할 색과 글자 강조를 만듭니다.
 *
 * 조건이 참인 규칙을 선언된 순서대로 합성하며, 같은 속성은 뒤에 선언된
 * 규칙의 값을 사용합니다. 강조는 `true`면 적용하고 `false`면 기본 서식의 강조를 끕니다.
 *
 * 값이 없거나 타입이 맞지 않아 계산할 수 없는 조건은 참으로 보지 않고 규칙을
 * 건너뜁니다. 빈 양식과 입력 중인 전표에는 값이 없는 것이 정상 상태이기 때문입니다.
 * 내용이 비어 있는 조건식도 같은 이유로 규칙을 적용하지 않습니다. 논리값이 아닌 결과가
 * 나오는 조건식만 오류로 알립니다.
 *
 * @param rules - 조건부 서식 규칙 목록. 생략하면 빈 결과를 반환합니다.
 * @param scope - 조건식이 참조할 값. 항목 구간 안에서는 전표 값에 현재 항목을 합쳐 전달합니다.
 * @param options - `locale`: 오류 메시지 언어, `subject`: 오류 메시지에 쓸 대상 이름,
 *   `reserved`: 행 구간에서 계획 계층이 전달하는 예약 참조 값
 * @returns 덮어쓸 색과 글자 강조를 반환합니다.
 * @throws SlipRenderError 조건식에 문법 오류가 있거나 결과가 논리값이 아니면 오류를 던집니다.
 */
export function resolveConditionalFormats(
  rules: readonly ConditionalFormatRule[] | undefined,
  scope: Record<string, unknown>,
  options?: { locale?: string; subject?: string; reserved?: Readonly<Record<string, unknown>> },
): ConditionalFormatOverrides {
  const result: ConditionalFormatOverrides = {};
  if (rules === undefined || rules.length === 0) return result;
  const locale = options?.locale;
  const messages = rm(locale);
  const what = options?.subject ?? messages.subjectDefault();
  rules.forEach((rule, index) => {
    // 편집 중인 빈 조건식은 규칙을 적용하지 않습니다.
    if (rule.condition.trim() === '') return;
    let value: unknown;
    try {
      value = evaluateFormula(rule.condition, {
        values: scope,
        ...(locale === undefined ? {} : { locale }),
        ...(options?.reserved === undefined ? {} : { reserved: options.reserved }),
      });
    } catch (error) {
      // 평가 중 실패한 계산(`FormulaEvalError`)은 실패 이유와 관계없이 규칙 미적용으로 처리하고,
      // 파싱 단계에서 나는 문법 오류는 조건식 작성 실수이므로 오류로 알립니다.
      if (error instanceof FormulaEvalError) return;
      throw new SlipRenderError(
        messages.conditionFailed(what, index + 1, error instanceof Error ? error.message : String(error)),
      );
    }
    // 값이 없는 자리는 빈 양식과 입력 중인 전표의 정상 상태이므로 규칙만 건너뜁니다.
    if (value === null || value === undefined) return;
    // 조건식은 논리값을 반환해야 합니다. 숫자·문자열의 암묵 변환은 허용하지 않습니다.
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
