/**
 * 함수 인자 수 검사 — 값 없이도 확인할 수 있는 규칙.
 *
 * 인자 수가 틀린 수식은 어떤 데이터에서도 계산되지 않는다. 편집기는 이것을
 * 「샘플 값이 없어 계산하지 못함」과 구분해 저장을 막는 데 사용한다.
 */
import { FormulaEvalError } from './errors.js';
import { FORMULA_ARITY, type FormulaFunctionName } from './functions.js';
import { fm, withFormulaLocale } from './messages.js';
import type { FormulaAst } from './parser.js';

/**
 * 함수 하나의 인자 수가 규칙에 맞는지 확인한다.
 *
 * @param name - 함수 이름
 * @param count - 실제 인자 수
 * @throws 인자 수가 규칙에 맞지 않으면 {@link FormulaEvalError}
 */
export function assertArity(name: FormulaFunctionName, count: number): void {
  const { min, max } = FORMULA_ARITY[name];
  if (count >= min && (max === undefined || count <= max)) return;
  // 상한 없이 하나 이상을 받는 함수는 「1개 이상」으로 안내한다.
  if (max === undefined) throw new FormulaEvalError(fm().arityAtLeastOne(name));
  throw new FormulaEvalError(fm().arity(name, min, max));
}

/**
 * 구문 트리 전체를 훑어 함수 인자 수를 확인한다.
 *
 * @param ast - {@link parseFormula}가 만든 구문 트리
 * @param options - 오류 메시지 언어
 * @throws 인자 수가 규칙에 맞지 않는 함수가 있으면 {@link FormulaEvalError}
 */
export function assertFormulaArity(ast: FormulaAst, options?: { locale?: string }): void {
  withFormulaLocale(options?.locale, () => {
    walk(ast);
    return null;
  });
}

function walk(ast: FormulaAst): void {
  switch (ast.type) {
    case 'call':
      assertArity(ast.name, ast.args.length);
      for (const arg of ast.args) walk(arg);
      return;
    case 'unary':
      walk(ast.operand);
      return;
    case 'binary':
      walk(ast.left);
      walk(ast.right);
      return;
    default:
      return;
  }
}
