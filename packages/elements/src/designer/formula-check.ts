/**
 * 수식·조건식 검사 — 인라인 입력과 수식 모달이 함께 쓰는 판정.
 *
 * @remarks
 * 수식·조건식의 문법과 현재 값에서의 계산 결과를 검사합니다. 문법 오류, 등록되지 않은 함수,
 * 함수 인자 수 오류와 결과가 논리값이 아닌 조건식은 적용을 막습니다. 그 밖의 평가 실패는
 * 원인을 표시하고 적용을 허용하며, 저장 후 디자이너에 경고를 남깁니다.
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
  /** 문법이 깨졌거나 등록되지 않은 함수·잘못된 인자 수를 썼음 */
  | 'syntax-error'
  /** 현재 값으로 계산하다 식에서 오류가 났음 */
  | 'formula-error'
  /** 현재 값으로 계산됨 */
  | 'ok'
  /** 조건식인데 결과가 논리값이 아님 */
  | 'not-boolean'
  /** 값이 없거나 지금 자리에서 쓸 수 없어 현재 값으로 계산하지 못했음 */
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
    // 문법과 인자 수는 값 없이도 확정할 수 있으므로 여기서만 적용을 막습니다.
    assertFormulaArity(parseFormula(source, options), options);
  } catch (error) {
    return { status: 'syntax-error', applicable: false, ...reasonOf(error) };
  }

  // 평가 실패는 원인을 알리고 적용은 허용합니다. 계산 한 번으로 어떤 값에서도
  // 계산되지 않는다는 것을 증명할 수는 없으므로 저장을 막지 않습니다.
  const found = input.diagnose(source, input.context);
  if (found.formulaError !== undefined) {
    return { status: 'formula-error', applicable: true, ...reasonOf(found.formulaError) };
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
