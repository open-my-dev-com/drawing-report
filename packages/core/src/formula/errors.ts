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
  /** 계산에 쓴 값이 잘못됐습니다. 그 값이 모두 데이터에서 왔을 때만 값이 달라지면 계산될 수 있습니다 */
  | 'value'
  /** 식 자체가 잘못됐습니다. 값이 달라져도 계산되지 않습니다 */
  | 'formula';

/** 파싱한 수식을 평가할 수 없을 때 발생하는 오류. */
export class FormulaEvalError extends Error {
  /** 오류가 난 자리를 이미 확인했는지 — 가장 안쪽 자리에서 한 번만 표시합니다 */
  private located = false;
  /** 잘못된 값이 모두 데이터에서 왔는지 */
  private fromData = false;

  constructor(
    message: string,
    /** 평가에 실패한 까닭의 종류 */
    readonly reason: FormulaEvalReason = 'value',
  ) {
    super(message);
    this.name = 'FormulaEvalError';
  }

  /**
   * 오류가 난 자리의 값 출처를 표시합니다.
   *
   * @remarks
   * 평가기가 오류를 밖으로 올리면서 호출합니다. 오류를 실제로 낸 가장 안쪽 자리에서
   * 한 번만 적용되고, 그 바깥 자리에서 다시 부르면 아무 일도 하지 않습니다.
   *
   * @param fromData - 그 자리에서 쓴 값이 모두 데이터에서 왔는지
   */
  locate(fromData: boolean): void {
    if (this.located) return;
    this.located = true;
    this.fromData = fromData;
  }

  /**
   * 값이 달라지면 계산될 수 있는 오류인지.
   *
   * @remarks
   * 참인 오류는 지금 샘플 값으로만 계산하지 못한 것이라 수식을 그대로 저장해도 됩니다.
   * 거짓인 오류는 어떤 데이터에서도 같은 오류가 나므로 수식을 고쳐야 합니다.
   */
  get dataDependent(): boolean {
    if (this.reason === 'data') return true;
    if (this.reason === 'formula') return false;
    return this.fromData;
  }
}
