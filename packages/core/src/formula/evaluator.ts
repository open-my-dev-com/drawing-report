/**
 * 파싱된 AST를 해석해 수식을 평가한다. 임의의 JavaScript 코드는 실행하지 않는다.
 *
 * 참조 경로는 `context.values`에서 조회한다. 경로 중간에 배열이 있으면 남은 경로를
 * 각 원소에 적용해 배열로 반환한다. `IF`, `AND`, `OR`는 단락 평가한다.
 */
import { BUILTIN_FUNCTIONS, toCondition, toNumber, type FormulaContext, type FormulaValue, type Scalar } from './builtins.js';
import { assertArity } from './arity.js';
import { FormulaEvalError, valueError } from './errors.js';
import { fm, withFormulaLocale, type FormulaPlace } from './messages.js';
import { parseFormula, type BinaryOperator, type FormulaAst } from './parser.js';

export type { FormulaContext, FormulaValue };

// ---------------------------------------------------------------------------
// 참조 해소
// ---------------------------------------------------------------------------

/** 값 참조를 순회할 수 있는 최대 깊이. */
const MAX_VALUE_DEPTH = 256;

function guardDepth(depth: number): void {
  // 참조를 푸는 중 나는 오류는 모두 데이터 자체의 모양 때문이다.
  if (depth > MAX_VALUE_DEPTH) {
    throw valueError(fm().valueDepthExceeded(MAX_VALUE_DEPTH), true);
  }
}

function resolvePath(value: unknown, path: string[], index: number, depth = 0): FormulaValue {
  guardDepth(depth);
  if (index >= path.length) return toFormulaValue(value, depth);
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => resolvePath(item, path, index, depth + 1));
  }
  if (typeof value === 'object') {
    return resolvePath((value as Record<string, unknown>)[path[index]!], path, index + 1, depth + 1);
  }
  throw valueError(fm().notAnObject(path.slice(0, index).join('.'), path[index] ?? ''), true);
}

function toFormulaValue(value: unknown, depth = 0): FormulaValue {
  guardDepth(depth);
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toFormulaValue(item, depth + 1));
  throw valueError(fm().objectValueNotUsable(), true);
}

// ---------------------------------------------------------------------------
// 연산자
// ---------------------------------------------------------------------------

function requireScalar(value: FormulaValue, place: FormulaPlace, fromData: boolean): Scalar {
  if (Array.isArray(value)) {
    throw valueError(fm().rangeNotAllowed(place), fromData);
  }
  return value;
}

function equals(a: Scalar, b: Scalar): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  return a === b;
}

function applyBinary(
  operator: BinaryOperator,
  left: FormulaValue,
  right: FormulaValue,
  leftFromData: boolean,
  rightFromData: boolean,
): FormulaValue {
  const place: FormulaPlace = { kind: 'operator', operator };
  const a = requireScalar(left, place, leftFromData);
  const b = requireScalar(right, place, rightFromData);
  switch (operator) {
    case '+': return toNumber(a, 'addOperand', leftFromData) + toNumber(b, 'addOperand', rightFromData);
    case '-': return toNumber(a, 'subtractOperand', leftFromData) - toNumber(b, 'subtractOperand', rightFromData);
    case '*': return toNumber(a, 'multiplyOperand', leftFromData) * toNumber(b, 'multiplyOperand', rightFromData);
    case '/': {
      // 0으로 나누는 잘못은 나누는 쪽 값의 문제다.
      const divisor = toNumber(b, 'divideOperand', rightFromData);
      if (divisor === 0) throw valueError(fm().divideByZero(), rightFromData);
      return toNumber(a, 'divideOperand', leftFromData) / divisor;
    }
    case '=': return equals(a, b);
    case '<>': return !equals(a, b);
    default: {
      // 순서 비교는 두 피연산자가 모두 숫자이거나 모두 문자열일 때만 허용한다.
      if (typeof a === 'number' && typeof b === 'number') {
        if (operator === '<') return a < b;
        if (operator === '>') return a > b;
        if (operator === '<=') return a <= b;
        return a >= b;
      }
      if (typeof a === 'string' && typeof b === 'string') {
        if (operator === '<') return a < b;
        if (operator === '>') return a > b;
        if (operator === '<=') return a <= b;
        return a >= b;
      }
      // 한쪽이라도 데이터에서 왔으면 값이 달라질 때 종류가 맞을 수 있다.
      throw valueError(fm().comparisonTypeMismatch(operator), leftFromData || rightFromData);
    }
  }
}

// ---------------------------------------------------------------------------
// 평가
// ---------------------------------------------------------------------------

/** 이 식의 값이 참조를 통해 데이터에서 오는지 확인한다. */
function fromData(ast: FormulaAst): boolean {
  switch (ast.type) {
    case 'reference': return true;
    case 'call': return ast.args.some(fromData);
    case 'unary': return fromData(ast.operand);
    case 'binary': return fromData(ast.left) || fromData(ast.right);
    default: return false;
  }
}

// 진단 중에만 값이 없어 실패한 자리를 빈 값으로 잇고 계속 평가한다.
let recovery: { error?: FormulaEvalError } | null = null;

function evaluateAst(ast: FormulaAst, context: FormulaContext): FormulaValue {
  try {
    return evaluateNode(ast, context);
  } catch (error) {
    if (!(error instanceof FormulaEvalError)) throw error;
    if (recovery === null || !error.dataDependent) throw error;
    // 값이 채워지면 풀릴 오류는 여기서 멈추지 않는다. 바깥에 남아 있는
    // 식 자체의 잘못을 이 오류가 가리면 고칠 수 없는 수식을 저장하게 된다.
    recovery.error ??= error;
    return null;
  }
}

/**
 * 내장 함수를 부른다.
 *
 * @remarks
 * 진단 중에 데이터 값 때문에 실패하면, 데이터에서 온 인자를 빈 값으로 바꿔 한 번 더 부른다.
 * 그래야 `FORMAT_NUMBER(amount, 21)`처럼 잘못된 상수 인자가 값 오류 뒤에 가려지지 않는다.
 */
function callBuiltin(
  fn: (args: FormulaValue[], ctx: FormulaContext, origins: readonly boolean[]) => FormulaValue,
  args: FormulaValue[],
  origins: boolean[],
  context: FormulaContext,
): FormulaValue {
  try {
    return fn(args, context, origins);
  } catch (error) {
    if (recovery === null || !(error instanceof FormulaEvalError) || !error.dataDependent) throw error;
    recovery.error ??= error;
    const constants = args.map((value, index) => (origins[index] === true ? null : value));
    try {
      return fn(constants, context, origins);
    } catch (again) {
      // 빈 값으로 바꾼 자리 때문에 난 오류는 새로 찾은 잘못이 아니다.
      if (again instanceof FormulaEvalError && again.dataDependent) return null;
      throw again;
    }
  }
}

function evaluateNode(ast: FormulaAst, context: FormulaContext): FormulaValue {
  switch (ast.type) {
    case 'number':
    case 'string':
    case 'boolean':
      return ast.value;
    case 'reference': {
      const head = ast.path[0]!;
      // 예약 참조(@item 등)는 페이지 계획이 공급한 reserved에서만 조회한다.
      if (head.startsWith('@')) {
        if (context.reserved === undefined || !(head in context.reserved)) {
          throw new FormulaEvalError(fm().reservedRefUnavailable(head), 'data');
        }
        return resolvePath(context.reserved[head], ast.path, 1);
      }
      return resolvePath(context.values, ast.path, 0);
    }
    case 'unary': {
      const operandFromData = fromData(ast.operand);
      const operand = requireScalar(
        evaluateAst(ast.operand, context), { kind: 'sign' }, operandFromData,
      );
      const n = toNumber(operand, 'signOperand', operandFromData);
      return ast.operator === '-' ? -n : n;
    }
    case 'binary':
      return applyBinary(
        ast.operator,
        evaluateAst(ast.left, context),
        evaluateAst(ast.right, context),
        fromData(ast.left),
        fromData(ast.right),
      );
    case 'call': {
      // 단락 평가가 필요한 함수는 인수를 개별적으로 평가한다.
      if (ast.name === 'IF') {
        assertArity('IF', ast.args.length);
        const test = ast.args[0]!;
        const condition = toCondition(
          requireScalar(evaluateAst(test, context), { kind: 'ifCondition' }, fromData(test)),
          fromData(test),
        );
        if (condition) return evaluateAst(ast.args[1]!, context);
        return ast.args[2] ? evaluateAst(ast.args[2], context) : null;
      }
      if (ast.name === 'AND' || ast.name === 'OR') {
        assertArity(ast.name, ast.args.length);
        const shortCircuit = ast.name === 'OR';
        const place: FormulaPlace = { kind: 'functionArg', name: ast.name };
        for (const arg of ast.args) {
          const argFromData = fromData(arg);
          const value = toCondition(
            requireScalar(evaluateAst(arg, context), place, argFromData), argFromData,
          );
          if (value === shortCircuit) return shortCircuit;
        }
        return !shortCircuit;
      }
      const fn = BUILTIN_FUNCTIONS[ast.name];
      // 파서에 등록됐지만 평가기에 구현되지 않은 함수를 확인한다.
      if (!fn) throw new FormulaEvalError(fm().notImplementedFunction(ast.name), 'formula');
      return callBuiltin(fn, ast.args.map((arg) => evaluateAst(arg, context)), ast.args.map(fromData), context);
    }
  }
}

/**
 * 수식을 평가한다.
 *
 * @param source - 수식 문자열 또는 미리 파싱한 AST
 * @param context - 실행 문맥 (전표 values·기준 시각·로케일)
 * @returns 평가 결과 값
 * @throws FormulaSyntaxError 문자열 파싱 중 문법 오류 시
 * @throws FormulaEvalError 타입 불일치·0 나눗셈 등 평가 오류 시
 *
 * @example
 * ```ts
 * evaluateFormula('SUM(items.금액)', {
 *   values: { items: [{ 금액: 1000 }, { 금액: 2000 }] },
 * }); // 3000
 * ```
 */
export function evaluateFormula(source: string | FormulaAst, context: FormulaContext): FormulaValue {
  return withFormulaLocale(context.locale, () => {
    const ast = typeof source === 'string' ? parseFormula(source) : source;
    // 평가는 첫 오류에서 멈춘다. 진단 중에 불려도 오류를 이어 붙이지 않는다.
    const previous = recovery;
    recovery = null;
    try {
      return evaluateAst(ast, context);
    } finally {
      recovery = previous;
    }
  });
}

/** 수식을 계산할 수 있는지 진단한 결과 */
export interface FormulaDiagnosis {
  /**
   * 계산 결과.
   *
   * @remarks
   * `formulaError`나 `dataError`가 있으면 진단 과정에서 나온 값이므로 결과로 사용하지 않는다.
   */
  value: FormulaValue;
  /** 값이 달라져도 계산되지 않는 오류. 수식을 고쳐야 한다 */
  formulaError?: FormulaEvalError;
  /** 지금 값으로만 계산하지 못한 오류. 값이 채워지면 계산될 수 있다 */
  dataError?: FormulaEvalError;
}

/**
 * 수식을 계산할 수 있는지 진단한다.
 *
 * @remarks
 * 평가와 달리 첫 오류에서 멈추지 않는다. 값이 없거나 예약 범위를 쓸 수 없어 실패한 자리는
 * 빈 값으로 이어 끝까지 계산하므로, `SUM(@page.amount) / 0`처럼 값이 채워져도 풀리지 않는
 * 잘못이 값 부족 뒤에 가려지지 않는다. 편집기가 저장 여부를 정할 때 사용한다.
 *
 * @param source - 진단할 수식 문자열 또는 미리 파싱한 AST
 * @param context - 실행 문맥 (전표 values·기준 시각·로케일)
 * @returns 계산 결과와 발견한 오류
 * @throws FormulaSyntaxError 문자열 파싱 중 문법 오류 시
 *
 * @example
 * ```ts
 * const found = diagnoseFormula('SUM(@page.amount)', { values: {} });
 * found.dataError !== undefined; // true — 예약 범위가 없어 지금은 계산할 수 없다
 * found.formulaError === undefined; // true — 값이 채워지면 계산된다
 * ```
 */
export function diagnoseFormula(
  source: string | FormulaAst,
  context: FormulaContext,
): FormulaDiagnosis {
  return withFormulaLocale(context.locale, () => {
    const ast = typeof source === 'string' ? parseFormula(source) : source;
    const previous = recovery;
    const found: { error?: FormulaEvalError } = {};
    recovery = found;
    try {
      const value = evaluateAst(ast, context);
      return found.error === undefined ? { value } : { value, dataError: found.error };
    } catch (error) {
      if (!(error instanceof FormulaEvalError)) throw error;
      return found.error === undefined
        ? { value: null, formulaError: error }
        : { value: null, formulaError: error, dataError: found.error };
    } finally {
      recovery = previous;
    }
  });
}
