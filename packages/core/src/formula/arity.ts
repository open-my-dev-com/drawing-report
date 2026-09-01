/**
 * 함수 인자 수 검사 — 데이터 없이 확인할 수 있는 규칙.
 *
 * 인자 수가 잘못된 수식은 데이터가 달라져도 계산할 수 없습니다. 편집기는 이를
 * 현재 샘플 값이 없어 계산할 수 없는 경우와 구분하여 저장을 차단합니다.
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
  // 최대 인자 수가 없고 최소 한 개가 필요한 함수는 "1개 이상"으로 안내합니다.
  if (max === undefined) throw new FormulaEvalError(fm().arityAtLeastOne(name), 'formula');
  throw new FormulaEvalError(fm().arity(name, min, max), 'formula');
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
