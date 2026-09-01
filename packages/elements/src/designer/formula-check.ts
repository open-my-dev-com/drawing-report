/**
 * 수식·조건식 검사 — 인라인 입력과 수식 모달이 함께 쓰는 판정.
 *
 * @remarks
 * 값이 달라져도 계산되지 않는 수식과 현재 샘플 값으로만 계산할 수 없는 수식을 구분합니다.
 * 전자는 적용을 막고, 후자는 실제 전표 값으로 계산할 수 있으므로 적용을 허용합니다.
 * 두 가지를 가르는 것은 core가 평가 오류에 담아 주는 판정이며, 오류 문구를 비교하지 않습니다.
 */

import {
  assertFormulaArity,
  parseFormula,
  type FormulaContext,
  type FormulaDiagnosis,
  type FormulaValue,
} from '@omdc-slipkit/core';

/** 수식·조건식 검사 결과의 종류 */
export type FormulaCheckStatus =
  /** 비어 있음 */
  | 'empty'
  /** 문법이나 함수 인자 수가 잘못되어 데이터와 무관하게 유효하지 않음 */
  | 'syntax-error'
  /** 문법과 인자 수는 맞지만 값이 달라져도 계산할 수 없음 */
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
   * 수식을 계산할 수 있는지 진단합니다.
   *
   * @param source - 진단할 수식
   * @param context - 평가에 사용할 값
   * @returns 계산 결과와 발견한 오류
   */
  diagnose(source: string, context: FormulaContext): FormulaDiagnosis;
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
  try {
    // 인자 수는 데이터와 무관한 규칙이라 값 없이도 확인합니다.
    assertFormulaArity(parseFormula(source, options), options);
  } catch (error) {
    return { status: 'syntax-error', applicable: false, ...reasonOf(error) };
  }

  // 값이 달라져도 풀리지 않는 잘못이 값 부족 뒤에 가려지지 않도록 core가 끝까지 진단합니다.
  const found = input.diagnose(source, input.context);
  if (found.formulaError !== undefined) {
    return { status: 'formula-error', applicable: false, ...reasonOf(found.formulaError) };
  }
  if (found.dataError !== undefined) {
    return { status: 'not-computable', applicable: true, ...reasonOf(found.dataError) };
  }
  if (input.condition && typeof found.value !== 'boolean') {
    return { status: 'not-boolean', applicable: false };
  }
  return { status: 'ok', applicable: true, value: found.value };
}

/** 오류에서 표시할 원인 문구를 꺼냅니다. 문구가 없으면 빈 것을 돌려줍니다. */
function reasonOf(error: unknown): { detail?: string } {
  return error instanceof Error ? { detail: error.message } : {};
}
