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

function evaluateAst(ast: FormulaAst, context: FormulaContext): FormulaValue {
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
          throw new FormulaEvalError(fm().reservedRefUnavailable(head));
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
      if (!fn) throw new FormulaEvalError(fm().notImplementedFunction(ast.name));
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
    return evaluateAst(ast, context);
  });
}
