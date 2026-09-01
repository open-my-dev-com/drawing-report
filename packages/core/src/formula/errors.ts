/** 수식을 파싱할 수 없을 때 발생하는 오류. */
export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    /** 수식 문자열에서 오류가 발생한 위치의 0부터 시작하는 인덱스. */
    readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

/**
 * 현재 평가 실패의 원인을 데이터 부족, 입력값, 수식 구성으로 구분합니다.
 * 오류 문구 비교에는 사용하지 않습니다.
 */
export type FormulaEvalReason =
  /** 현재 평가 문맥에 필요한 값이나 예약 범위가 없음 */
  | 'data'
  /** 현재 평가에 사용한 값이 연산 또는 함수의 조건을 충족하지 않음 */
  | 'value'
  /** 현재 평가에서 수식 구성에 관한 오류로 분류됨 */
  | 'formula';

/**
 * 오류를 일으킨 값이 데이터에서 왔는지 기록합니다.
 *
 * @remarks
 * 오류 객체의 공개 표면에 두면 밖에서 판정을 바꿀 수 있으므로 모듈 안에만 둔다.
 */
const fromDataOf = new WeakMap<FormulaEvalError, boolean>();

/** 파싱한 수식을 평가할 수 없을 때 발생하는 오류. */
export class FormulaEvalError extends Error {
  constructor(
    message: string,
    /** 평가에 실패한 까닭의 종류 */
    readonly reason: FormulaEvalReason = 'value',
  ) {
    super(message);
    this.name = 'FormulaEvalError';
  }

  /**
   * 현재 평가 실패가 입력 데이터에 의존하는지 나타내는 진단 정보입니다.
   *
   * @remarks
   * false여도 다른 입력에서 항상 실패한다는 뜻이 아니며 저장 여부를 판정하는 데
   * 사용하지 않습니다.
   */
  get dataDependent(): boolean {
    if (this.reason === 'data') return true;
    if (this.reason === 'formula') return false;
    return fromDataOf.get(this) ?? false;
  }
}

/**
 * 값이 잘못돼 계산하지 못한 오류를 만든다.
 *
 * @param message - 사용자에게 보여 줄 오류 문구
 * @param fromData - 오류를 일으킨 값이 참조를 통해 데이터에서 왔는지
 * @returns 값 출처를 담은 평가 오류
 */
export function valueError(message: string, fromData: boolean): FormulaEvalError {
  const error = new FormulaEvalError(message, 'value');
  fromDataOf.set(error, fromData);
  return error;
}
