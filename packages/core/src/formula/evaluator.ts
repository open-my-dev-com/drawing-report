/**
 * 파싱된 AST를 해석해 수식을 평가한다. 임의의 JavaScript 코드는 실행하지 않는다.
 *
 * 참조 경로는 `context.values`에서 조회한다. 경로 중간에 배열이 있으면 남은 경로를
 * 각 원소에 적용해 배열로 반환한다. `IF`, `AND`, `OR`는 단락 평가한다.
 */
import { BUILTIN_FUNCTIONS, toCondition, toNumber, type FormulaContext, type FormulaValue, type Scalar } from './builtins.js';
import { assertArity } from './arity.js';
import { FormulaEvalError } from './errors.js';
import { fm, withFormulaLocale, type FormulaPlace } from './messages.js';
import { parseFormula, type BinaryOperator, type FormulaAst } from './parser.js';

export type { FormulaContext, FormulaValue };

// ---------------------------------------------------------------------------
// 참조 해소
// ---------------------------------------------------------------------------

/** 값 참조를 순회할 수 있는 최대 깊이. */
const MAX_VALUE_DEPTH = 256;

function guardDepth(depth: number): void {
  if (depth > MAX_VALUE_DEPTH) {
    throw new FormulaEvalError(fm().valueDepthExceeded(MAX_VALUE_DEPTH));
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
  throw new FormulaEvalError(fm().notAnObject(path.slice(0, index).join('.'), path[index] ?? ''));
}

function toFormulaValue(value: unknown, depth = 0): FormulaValue {
  guardDepth(depth);
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toFormulaValue(item, depth + 1));
  throw new FormulaEvalError(fm().objectValueNotUsable());
}

// ---------------------------------------------------------------------------
// 연산자
// ---------------------------------------------------------------------------

function requireScalar(value: FormulaValue, place: FormulaPlace): Scalar {
  if (Array.isArray(value)) {
    throw new FormulaEvalError(fm().rangeNotAllowed(place));
  }
  return value;
}

function equals(a: Scalar, b: Scalar): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  return a === b;
}

function applyBinary(operator: BinaryOperator, left: FormulaValue, right: FormulaValue): FormulaValue {
  const place: FormulaPlace = { kind: 'operator', operator };
  const a = requireScalar(left, place);
  const b = requireScalar(right, place);
  switch (operator) {
    case '+': return toNumber(a, 'addOperand') + toNumber(b, 'addOperand');
    case '-': return toNumber(a, 'subtractOperand') - toNumber(b, 'subtractOperand');
    case '*': return toNumber(a, 'multiplyOperand') * toNumber(b, 'multiplyOperand');
    case '/': {
      const divisor = toNumber(b, 'divideOperand');
      if (divisor === 0) throw new FormulaEvalError(fm().divideByZero());
      return toNumber(a, 'divideOperand') / divisor;
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
      throw new FormulaEvalError(fm().comparisonTypeMismatch(operator));
    }
  }
}

// ---------------------------------------------------------------------------
// 평가
// ---------------------------------------------------------------------------

/** 수식이 값이나 예약 참조를 하나라도 참조하는지 확인한다. */
function hasReference(ast: FormulaAst): boolean {
  switch (ast.type) {
    case 'reference': return true;
    case 'call': return ast.args.some(hasReference);
    case 'unary': return hasReference(ast.operand);
    case 'binary': return hasReference(ast.left) || hasReference(ast.right);
    default: return false;
  }
}

/**
 * 이 자리의 계산에 쓴 값이 모두 데이터에서 왔는지 확인한다.
 *
 * @remarks
 * 상수가 하나라도 섞이면 그 상수가 오류의 원인일 수 있으므로 데이터에서 왔다고 보지 않는다.
 * 참조를 푸는 중 난 오류는 데이터 자체에서 온 것이다.
 */
function operandsFromData(ast: FormulaAst): boolean {
  switch (ast.type) {
    case 'reference': return true;
    case 'unary': return hasReference(ast.operand);
    case 'binary': return hasReference(ast.left) && hasReference(ast.right);
    case 'call': return ast.args.length > 0 && ast.args.every(hasReference);
    default: return false;
  }
}

// 진단 중에만 값이 없어 실패한 자리를 빈 값으로 잇고 계속 평가한다.
let recovery: { error?: FormulaEvalError } | null = null;

function evaluateAst(ast: FormulaAst, context: FormulaContext): FormulaValue {
  try {
    return evaluateNode(ast, context);
  } catch (error) {
    // 오류를 실제로 낸 가장 안쪽 자리에서만 값 출처가 정해진다.
    if (!(error instanceof FormulaEvalError)) throw error;
    error.locate(operandsFromData(ast));
    if (recovery === null || !error.dataDependent) throw error;
    // 값이 채워지면 풀릴 오류는 여기서 멈추지 않는다. 바깥에 남아 있는
    // 식 자체의 잘못을 이 오류가 가리면 고칠 수 없는 수식을 저장하게 된다.
    recovery.error ??= error;
    return null;
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
      const operand = requireScalar(evaluateAst(ast.operand, context), { kind: 'sign' });
      const n = toNumber(operand, 'signOperand');
      return ast.operator === '-' ? -n : n;
    }
    case 'binary':
      return applyBinary(ast.operator, evaluateAst(ast.left, context), evaluateAst(ast.right, context));
    case 'call': {
      // 단락 평가가 필요한 함수는 인수를 개별적으로 평가한다.
      if (ast.name === 'IF') {
        assertArity('IF', ast.args.length);
        const condition = toCondition(requireScalar(evaluateAst(ast.args[0]!, context), { kind: 'ifCondition' }));
        if (condition) return evaluateAst(ast.args[1]!, context);
        return ast.args[2] ? evaluateAst(ast.args[2], context) : null;
      }
      if (ast.name === 'AND' || ast.name === 'OR') {
        assertArity(ast.name, ast.args.length);
        const shortCircuit = ast.name === 'OR';
        for (const arg of ast.args) {
          const value = toCondition(requireScalar(evaluateAst(arg, context), { kind: 'functionArg', name: ast.name }));
          if (value === shortCircuit) return shortCircuit;
        }
        return !shortCircuit;
      }
      const fn = BUILTIN_FUNCTIONS[ast.name];
      // 파서에 등록됐지만 평가기에 구현되지 않은 함수를 확인한다.
      if (!fn) throw new FormulaEvalError(fm().notImplementedFunction(ast.name), 'formula');
      return fn(ast.args.map((arg) => evaluateAst(arg, context)), context);
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
   * `dataError`가 있으면 값이 없는 자리를 빈 값으로 이어 계산한 것이라 결과로 쓰지 않는다.
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
