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

/** 파싱한 수식을 평가할 수 없을 때 발생하는 오류. */
export class FormulaEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaEvalError';
  }
}
