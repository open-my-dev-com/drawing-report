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
 * 평가에 실패한 까닭의 종류.
 *
 * @remarks
 * 편집기는 이 값으로 「값이 채워지면 계산될 수 있는 수식」과 「값이 달라져도 계산되지 않는
 * 수식」을 가릅니다. 오류 문구를 비교하지 않습니다.
 */
export type FormulaEvalReason =
  /** 값이 없거나 지금 자리에서 쓸 수 없어 계산하지 못했습니다. 값이 채워지면 계산될 수 있습니다 */
  | 'data'
  /** 계산에 쓴 값이 잘못됐습니다. 그 값이 데이터에서 왔을 때만 값이 달라지면 계산될 수 있습니다 */
  | 'value'
  /** 식 자체가 잘못됐습니다. 값이 달라져도 계산되지 않습니다 */
  | 'formula';

/**
 * 오류를 낸 값이 데이터에서 왔는지.
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
   * 값이 달라지면 계산될 수 있는 오류인지.
   *
   * @remarks
   * 참인 오류는 지금 값으로만 계산하지 못한 것이라 수식을 그대로 저장해도 됩니다.
   * 거짓인 오류는 어떤 값으로도 같은 오류가 나므로 수식을 고쳐야 합니다.
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
 * @param fromData - 잘못된 그 값이 참조를 통해 데이터에서 왔는지
 * @returns 값 출처를 담은 평가 오류
 */
export function valueError(message: string, fromData: boolean): FormulaEvalError {
  const error = new FormulaEvalError(message, 'value');
  fromDataOf.set(error, fromData);
  return error;
}
