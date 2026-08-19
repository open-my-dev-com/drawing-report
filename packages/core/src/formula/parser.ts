/**
 * 수식 파서 (ADR-010: 자체 파서, 임의 코드 실행 절대 금지).
 *
 * 문법 (엑셀 스타일):
 * ```
 * expr    := cmp
 * cmp     := add (('=' | '<>' | '<=' | '>=' | '<' | '>') add)*
 * add     := mul (('+' | '-') mul)*
 * mul     := unary (('*' | '/') unary)*
 * unary   := ('-' | '+') unary | primary
 * primary := number | string | TRUE | FALSE | FUNC '(' args ')' | ref | '(' expr ')'
 * ref     := ident ('.' ident)*        — 전표 values 참조 (예: items.금액)
 * ```
 *
 * 문자열 리터럴은 큰따옴표, 내부 큰따옴표는 "" 로 이스케이프한다.
 * 식별자는 유니코드 문자(한글 포함)·숫자·언더스코어, 숫자로 시작 불가.
 */
import { FormulaSyntaxError } from './errors.js';
import { FORMULA_FUNCTIONS, type FormulaFunctionName } from './functions.js';

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

/** 비교 연산자 */
export type ComparisonOperator = '=' | '<>' | '<' | '>' | '<=' | '>=';
/** 산술 연산자 */
export type ArithmeticOperator = '+' | '-' | '*' | '/';
/** 이항 연산자 전체 */
export type BinaryOperator = ComparisonOperator | ArithmeticOperator;

/** 파싱 결과 구문 트리 — 노드 7종 판별 유니온 */
export type FormulaAst =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'reference'; path: string[] }
  | { type: 'call'; name: FormulaFunctionName; args: FormulaAst[] }
  | { type: 'unary'; operator: '-' | '+'; operand: FormulaAst }
  | { type: 'binary'; operator: BinaryOperator; left: FormulaAst; right: FormulaAst };

// ---------------------------------------------------------------------------
// 토크나이저
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'ident'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number } // 연산자·괄호·쉼표·점
  | { type: 'end'; pos: number };

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const pos = i;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) throw new FormulaSyntaxError('숫자 형식이 잘못되었습니다', pos);
      tokens.push({ type: 'number', value: Number(match[0]), pos });
      i += match[0].length;
      continue;
    }
    if (ch === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length) throw new FormulaSyntaxError('문자열이 닫히지 않았습니다', pos);
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          value += source[i];
          i++;
        }
      }
      tokens.push({ type: 'string', value, pos });
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j]!)) j++;
      tokens.push({ type: 'ident', value: source.slice(i, j), pos });
      i = j;
      continue;
    }
    if (ch === '<' && (source[i + 1] === '>' || source[i + 1] === '=')) {
      tokens.push({ type: 'op', value: source.slice(i, i + 2), pos });
      i += 2;
      continue;
    }
    if (ch === '>' && source[i + 1] === '=') {
      tokens.push({ type: 'op', value: '>=', pos });
      i += 2;
      continue;
    }
    if ('+-*/=<>(),.'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`알 수 없는 문자입니다: '${ch}'`, pos);
  }
  tokens.push({ type: 'end', pos: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// 파서 (재귀 하강)
// ---------------------------------------------------------------------------

const FUNCTION_NAMES = new Set<string>(FORMULA_FUNCTIONS);

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaAst {
    const expr = this.comparison();
    const token = this.peek();
    if (token.type !== 'end') {
      throw new FormulaSyntaxError('수식 끝에 해석할 수 없는 내용이 있습니다', token.pos);
    }
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  private matchOp(...ops: string[]): string | null {
    const token = this.peek();
    if (token.type === 'op' && ops.includes(token.value)) {
      this.index++;
      return token.value;
    }
    return null;
  }

  private expectOp(op: string, what: string): void {
    if (!this.matchOp(op)) {
      throw new FormulaSyntaxError(`${what}이(가) 필요합니다`, this.peek().pos);
    }
  }

  /** 재귀 하강 깊이 제한 — 적대적 수식의 스택 오버플로 방지 (SPEC §5.6) */
  private depth = 0;

  private enter(): void {
    if (++this.depth > MAX_FORMULA_DEPTH) {
      throw new FormulaSyntaxError(
        `수식 중첩이 너무 깊습니다 (최대 ${MAX_FORMULA_DEPTH}단계)`,
        this.peek().pos,
      );
    }
  }

  private comparison(): FormulaAst {
    this.enter();
    try {
      return this.comparisonInner();
    } finally {
      this.depth--;
    }
  }

  private comparisonInner(): FormulaAst {
    let left = this.additive();
    for (;;) {
      const op = this.matchOp('=', '<>', '<=', '>=', '<', '>');
      if (!op) return left;
      left = { type: 'binary', operator: op as ComparisonOperator, left, right: this.additive() };
    }
  }

  private additive(): FormulaAst {
    let left = this.multiplicative();
    for (;;) {
      const op = this.matchOp('+', '-');
      if (!op) return left;
      left = { type: 'binary', operator: op as '+' | '-', left, right: this.multiplicative() };
    }
  }

  private multiplicative(): FormulaAst {
    let left = this.unary();
    for (;;) {
      const op = this.matchOp('*', '/');
      if (!op) return left;
      left = { type: 'binary', operator: op as '*' | '/', left, right: this.unary() };
    }
  }

  private unary(): FormulaAst {
    const op = this.matchOp('-', '+');
    if (op) {
      this.enter();
      try {
        return { type: 'unary', operator: op as '-' | '+', operand: this.unary() };
      } finally {
        this.depth--;
      }
    }
    return this.primary();
  }

  private primary(): FormulaAst {
    const token = this.next();
    if (token.type === 'number') return { type: 'number', value: token.value };
    if (token.type === 'string') return { type: 'string', value: token.value };
    if (token.type === 'op' && token.value === '(') {
      const expr = this.comparison();
      this.expectOp(')', '닫는 괄호');
      return expr;
    }
    if (token.type === 'ident') {
      const upper = token.value.toUpperCase();
      if (upper === 'TRUE') return { type: 'boolean', value: true };
      if (upper === 'FALSE') return { type: 'boolean', value: false };
      // 함수 호출: 알려진 함수명(대소문자 무관) + '('
      const isCall = this.peek().type === 'op' && (this.peek() as { value?: string }).value === '(';
      if (isCall) {
        if (!FUNCTION_NAMES.has(upper)) {
          throw new FormulaSyntaxError(`지원하지 않는 함수입니다: ${token.value}`, token.pos);
        }
        this.next(); // '('
        const args: FormulaAst[] = [];
        if (!this.matchOp(')')) {
          do {
            args.push(this.comparison());
          } while (this.matchOp(','));
          this.expectOp(')', '닫는 괄호');
        }
        return { type: 'call', name: upper as FormulaFunctionName, args };
      }
      // 참조 경로: ident ('.' ident)*
      const path = [token.value];
      while (this.matchOp('.')) {
        const segment = this.next();
        if (segment.type !== 'ident') {
          throw new FormulaSyntaxError("'.' 뒤에는 필드 이름이 와야 합니다", segment.pos);
        }
        path.push(segment.value);
      }
      return { type: 'reference', path };
    }
    throw new FormulaSyntaxError('값·참조·함수가 필요합니다', token.pos);
  }
}

/** 수식 문자열 최대 길이 — 적대적 수식의 토크나이저 부하 방지 (SPEC §5.6) */
export const MAX_FORMULA_LENGTH = 10_000;
/** 수식 최대 중첩 깊이 (괄호·함수 인자·부호 포함) — 스택 오버플로 방지 (SPEC §5.6) */
export const MAX_FORMULA_DEPTH = 100;

/**
 * 수식 문자열을 AST로 파싱한다.
 *
 * @param source - 수식 문자열 (예: `SUM(items.금액) * 1.1`)
 * @returns 파싱된 구문 트리
 * @throws FormulaSyntaxError 문법 오류·미등록 함수·길이/깊이 제한 초과 시
 */
export function parseFormula(source: string): FormulaAst {
  if (!source.trim()) throw new FormulaSyntaxError('빈 수식입니다', 0);
  if (source.length > MAX_FORMULA_LENGTH) {
    throw new FormulaSyntaxError(`수식이 너무 깁니다 (최대 ${MAX_FORMULA_LENGTH}자)`, 0);
  }
  return new Parser(tokenize(source)).parse();
}
