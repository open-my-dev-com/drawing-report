/** 수식 문법 오류 (파싱 단계) */
export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    /** 오류 위치 (수식 문자열의 0-기반 인덱스) */
    readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

/** 수식 평가 오류 (실행 단계) */
export class FormulaEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaEvalError';
  }
}
