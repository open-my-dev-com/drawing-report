/**
 * 수식·조건식 검사 — 인라인 입력과 수식 모달이 함께 쓰는 판정.
 *
 * @remarks
 * 데이터와 무관하게 유효하지 않은 수식과 현재 샘플 값으로만 계산할 수 없는 수식을 구분합니다.
 * 전자는 적용을 막고, 후자는 실제 전표 값으로 계산할 수 있으므로 적용을 허용합니다.
 */

import {
  assertFormulaArity,
  parseFormula,
  type FormulaAst,
  type FormulaContext,
  type FormulaValue,
} from '@omdc-slipkit/core';

/** 수식·조건식 검사 결과의 종류 */
export type FormulaCheckStatus =
  /** 비어 있음 */
  | 'empty'
  /** 문법이나 함수 인자 수가 잘못되어 데이터와 무관하게 유효하지 않음 */
  | 'syntax-error'
  /** 문법과 인자 수는 맞지만 데이터와 무관하게 계산할 수 없음 */
  | 'formula-error'
  /** 샘플 값으로 계산됨 */
  | 'ok'
  /** 조건식인데 결과가 논리값이 아님 */
  | 'not-boolean'
  /** 현재 샘플 값으로만 계산할 수 없음 */
  | 'not-computable'
  /** 편집 대상이 지워졌거나 바뀜 */
  | 'target-changed';

/** 수식·조건식 검사 결과 */
export interface FormulaCheck {
  status: FormulaCheckStatus;
  /** 지금 이대로 저장할 수 있는지 */
  applicable: boolean;
  /** 계산에 성공했을 때의 결과 */
  value?: FormulaValue;
  /** 잘못된 수식·계산 실패의 원인 */
  detail?: string;
}

/** 검사에 필요한 것 */
export interface FormulaCheckInput {
  /** 검사할 수식·조건식 */
  source: string;
  /** 조건식이면 결과가 논리값인지도 확인합니다 */
  condition: boolean;
  /** 비어 있어도 적용할 수 있는지 — 그리드 셀 수식은 비우면 수식을 제거합니다 */
  emptyAllowed: boolean;
  /** 오류 문구에 사용할 로케일. 평가 오류와 같은 언어로 맞춥니다 */
  locale: string | undefined;
  /** 평가에 사용할 값과 예약 참조 */
  context: FormulaContext;
  /**
   * 수식을 평가합니다.
   *
   * @param source - 평가할 수식
   * @param context - 평가에 사용할 값
   * @returns 평가 결과
   */
  evaluate(source: string, context: FormulaContext): FormulaValue;
}

/** 편집 대상이 바뀌어 적용할 수 없는 결과 */
export const TARGET_CHANGED: FormulaCheck = { status: 'target-changed', applicable: false };

/**
 * 수식·조건식을 검사합니다.
 *
 * @param input - 검사할 수식과 평가에 필요한 것
 * @returns 검사 결과와 적용 가능 여부
 */
export function checkFormula(input: FormulaCheckInput): FormulaCheck {
  const source = input.source.trim();
  if (source === '') return { status: 'empty', applicable: input.emptyAllowed };

  const options = input.locale === undefined ? undefined : { locale: input.locale };
  let ast: FormulaAst;
  try {
    ast = parseFormula(source, options);
    // 인자 수는 데이터와 무관한 규칙이라 값 없이도 확인합니다.
    assertFormulaArity(ast, options);
  } catch (error) {
    return { status: 'syntax-error', applicable: false, ...reasonOf(error) };
  }

  try {
    const value = input.evaluate(source, input.context);
    if (input.condition && typeof value !== 'boolean') {
      return { status: 'not-boolean', applicable: false };
    }
    return { status: 'ok', applicable: true, value };
  } catch (error) {
    // 참조가 하나도 없는 수식은 값이 달라져도 결과가 같으므로 적용을 막습니다.
    // 실제로 평가한 결과만 보므로 `IF(TRUE, 1, 1 / 0)`처럼 실행되지 않는 분기는 문제가 되지 않습니다.
    if (!hasReference(ast)) return { status: 'formula-error', applicable: false, ...reasonOf(error) };
    return { status: 'not-computable', applicable: true, ...reasonOf(error) };
  }
}

/** 수식이 값이나 예약 참조를 하나라도 참조하는지 확인합니다. */
function hasReference(ast: FormulaAst): boolean {
  switch (ast.type) {
    case 'reference':
      return true;
    case 'call':
      return ast.args.some(hasReference);
    case 'unary':
      return hasReference(ast.operand);
    case 'binary':
      return hasReference(ast.left) || hasReference(ast.right);
    default:
      return false;
  }
}

/** 던져진 오류에서 표시할 원인 문구를 꺼냅니다. 문구가 없으면 빈 것을 돌려줍니다. */
function reasonOf(error: unknown): { detail?: string } {
  return error instanceof Error ? { detail: error.message } : {};
}
