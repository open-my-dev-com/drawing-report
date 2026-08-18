/**
 * 수식 평가기 (ADR-010: 임의 코드 실행 금지 — AST 해석만 수행).
 *
 * - 참조(path)는 context.values에서 해소한다. 경로 도중 배열을 만나면
 *   나머지 경로를 각 원소에 사상해 범위(배열)를 만든다 (예: items.금액).
 * - IF / AND / OR는 지연(단락) 평가한다.
 */
import { BUILTIN_FUNCTIONS, toCondition, toNumber, type FormulaContext, type FormulaValue } from './builtins.js';
import { FormulaEvalError } from './errors.js';
import { parseFormula, type BinaryOperator, type FormulaAst } from './parser.js';

export type { FormulaContext, FormulaValue };

// ---------------------------------------------------------------------------
// 참조 해소
// ---------------------------------------------------------------------------

function resolvePath(value: unknown, path: string[], index: number): FormulaValue {
  if (index >= path.length) return toFormulaValue(value);
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => resolvePath(item, path, index));
  }
  if (typeof value === 'object') {
    return resolvePath((value as Record<string, unknown>)[path[index]!], path, index + 1);
  }
  throw new FormulaEvalError(`'${path.slice(0, index).join('.')}'은(는) 객체가 아니라서 '.${path[index]}'를 읽을 수 없습니다`);
}

function toFormulaValue(value: unknown): FormulaValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(toFormulaValue);
  throw new FormulaEvalError('객체 값은 수식에서 직접 쓸 수 없습니다 (하위 필드를 참조하세요)');
}

// ---------------------------------------------------------------------------
// 연산자
// ---------------------------------------------------------------------------

type Scalar = number | string | boolean | null;

function requireScalar(value: FormulaValue, what: string): Scalar {
  if (Array.isArray(value)) {
    throw new FormulaEvalError(`${what}에 범위를 직접 쓸 수 없습니다 (SUM 등 집계 함수를 사용하세요)`);
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
  const a = requireScalar(left, `'${operator}' 연산`);
  const b = requireScalar(right, `'${operator}' 연산`);
  switch (operator) {
    case '+': return toNumber(a, '더하기 대상') + toNumber(b, '더하기 대상');
    case '-': return toNumber(a, '빼기 대상') - toNumber(b, '빼기 대상');
    case '*': return toNumber(a, '곱하기 대상') * toNumber(b, '곱하기 대상');
    case '/': {
      const divisor = toNumber(b, '나누기 대상');
      if (divisor === 0) throw new FormulaEvalError('0으로 나눌 수 없습니다');
      return toNumber(a, '나누기 대상') / divisor;
    }
    case '=': return equals(a, b);
    case '<>': return !equals(a, b);
    default: {
      // < > <= >= : 숫자끼리 또는 문자열끼리
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
      throw new FormulaEvalError(`'${operator}' 비교는 숫자끼리 또는 문자열끼리만 가능합니다`);
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
    case 'reference':
      return resolvePath(context.values, ast.path, 0);
    case 'unary': {
      const operand = requireScalar(evaluateAst(ast.operand, context), '부호 연산');
      const n = toNumber(operand, '부호 연산 대상');
      return ast.operator === '-' ? -n : n;
    }
    case 'binary':
      return applyBinary(ast.operator, evaluateAst(ast.left, context), evaluateAst(ast.right, context));
    case 'call': {
      // 지연(단락) 평가 함수
      if (ast.name === 'IF') {
        if (ast.args.length < 2 || ast.args.length > 3) {
          throw new FormulaEvalError('IF 함수의 인자는 2~3개여야 합니다');
        }
        const condition = toCondition(requireScalar(evaluateAst(ast.args[0]!, context), 'IF 조건'));
        if (condition) return evaluateAst(ast.args[1]!, context);
        return ast.args[2] ? evaluateAst(ast.args[2], context) : null;
      }
      if (ast.name === 'AND' || ast.name === 'OR') {
        if (ast.args.length === 0) throw new FormulaEvalError(`${ast.name} 함수의 인자는 1개 이상이어야 합니다`);
        const shortCircuit = ast.name === 'OR';
        for (const arg of ast.args) {
          const value = toCondition(requireScalar(evaluateAst(arg, context), `${ast.name} 인자`));
          if (value === shortCircuit) return shortCircuit;
        }
        return !shortCircuit;
      }
      const fn = BUILTIN_FUNCTIONS[ast.name];
      // 파서가 함수명을 검증하므로 여기 도달하면 구현 누락이다
      if (!fn) throw new FormulaEvalError(`구현되지 않은 함수입니다: ${ast.name}`);
      return fn(ast.args.map((arg) => evaluateAst(arg, context)), context);
    }
  }
}

/**
 * 수식을 평가한다. source는 수식 문자열 또는 미리 파싱한 AST.
 * 문법 오류는 FormulaSyntaxError, 평가 오류는 FormulaEvalError를 던진다.
 */
export function evaluateFormula(source: string | FormulaAst, context: FormulaContext): FormulaValue {
  const ast = typeof source === 'string' ? parseFormula(source) : source;
  return evaluateAst(ast, context);
}
