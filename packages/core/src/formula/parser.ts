/**
 * 수식 문자열을 자체 문법의 AST로 변환한다. JavaScript 표현식은 실행하지 않는다.
 *
 * 문법 (엑셀 스타일):
 * ```
 * expr    := cmp
 * cmp     := add (('=' | '<>' | '<=' | '>=' | '<' | '>') add)*
 * add     := mul (('+' | '-') mul)*
 * mul     := unary (('*' | '/') unary)*
 * unary   := ('-' | '+') unary | primary
 * primary := number | string | TRUE | FALSE | FUNC '(' args ')' | ref | '(' expr ')'
 * ref     := ('@' ident | ident) ('.' ident)*        # 일반 참조 (예: items.금액, @group.금액)
 *          | ('@' ident '.')? key ('.' key)*         # 명시 참조 (예: $(items).$(금액), @group.$(금액))
 * key     := '$(' chars ')'                          # 키 한 단계. ')'와 '\'는 '\)'·'\\'로 적는다
 * ```
 *
 * 문자열 리터럴은 큰따옴표, 내부 큰따옴표는 "" 로 이스케이프한다.
 * 식별자는 유니코드 문자(한글 포함)·숫자·언더스코어, 숫자로 시작 불가.
 * `@`로 시작하는 참조는 그리드 행 구간에서 계획 계층이 공급하는 예약 참조만 허용한다.
 *
 * `$(...)`는 키 한 단계를 있는 그대로 적는 명시 참조다. 식별자 규칙에 맞지 않는 키
 * (`datas-2`·`customer.name`·공백 포함 등)도 쓸 수 있다. 수식에 명시 참조가 하나라도 있으면
 * 그 수식의 값 참조는 모두 명시 참조여야 하고, 한 경로 안에서 두 형식을 섞을 수 없다.
 * 예약 참조 이름은 어느 형식에서나 `$(...)` 없이 그대로 적는다 — `$(@item)`은 예약 참조가
 * 아니라 `@item`이라는 이름의 값 키다.
 */
import { FormulaSyntaxError } from './errors.js';
import { FORMULA_FUNCTIONS, type FormulaFunctionName } from './functions.js';
import { fm, withFormulaLocale } from './messages.js';

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

/** 비교 연산자 */
export type ComparisonOperator = '=' | '<>' | '<' | '>' | '<=' | '>=';
/** 산술 연산자 */
export type ArithmeticOperator = '+' | '-' | '*' | '/';
/** 이항 연산자 전체 */
export type BinaryOperator = ComparisonOperator | ArithmeticOperator;

/** 참조가 수식 문자열에서 차지하는 범위 (0부터 시작, `end`는 포함하지 않음). */
export interface ReferenceSpan {
  /** 참조 텍스트가 시작하는 인덱스 */
  start: number;
  /** 참조 텍스트 바로 다음 인덱스 */
  end: number;
}

/** 파싱 결과를 나타내는 구문 트리 노드의 판별 유니온. */
export type FormulaAst =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | {
      type: 'reference';
      path: string[];
      /** 경로를 `$(...)` 명시 참조로 적었을 때만 `true` */
      explicit?: true;
      /** 첫 단계를 `$(...)` 없이 `@item`처럼 적은 예약 참조일 때만 `true`. `$(@item)`은 값 키다 */
      reserved?: true;
      /** 원본 수식에서 이 참조가 차지하는 범위 */
      span?: ReferenceSpan;
    }
  | { type: 'call'; name: FormulaFunctionName; args: FormulaAst[] }
  | { type: 'unary'; operator: '-' | '+'; operand: FormulaAst }
  | { type: 'binary'; operator: BinaryOperator; left: FormulaAst; right: FormulaAst };

// ---------------------------------------------------------------------------
// 참조 표기
// ---------------------------------------------------------------------------

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;
const BARE_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * 그리드 행 구간에서 사용할 수 있는 예약 참조 이름.
 * 값은 페이지 계획 계층이 평가 컨텍스트의 `reserved`로 공급한다.
 */
export const RESERVED_REF_NAMES = ['@item', '@group', '@page', '@all', '@carried'] as const;

/** 예약 참조 이름 */
export type ReservedRefName = (typeof RESERVED_REF_NAMES)[number];

const RESERVED_REFS = new Set<string>(RESERVED_REF_NAMES);

/**
 * 이름이 `$(...)` 없이 그대로 쓸 수 있는 식별자인지 확인한다.
 *
 * 토크나이저의 식별자 규칙과 같다 — 유니코드 문자 또는 `_`로 시작하고 문자·숫자·`_`만 이어진다.
 * 예약 참조 이름(`@item` 등)은 식별자가 아니다.
 *
 * @param name - 확인할 이름
 * @returns 식별자 규칙에 맞으면 `true`
 */
export function isBareIdentifier(name: string): boolean {
  return BARE_IDENTIFIER.test(name);
}

/**
 * 키 한 단계를 `$(...)` 안에 넣을 수 있게 이스케이프한다.
 *
 * @param key - 이스케이프할 키
 * @returns `\`는 `\\`로, `)`는 `\)`로 바꾼 문자열
 */
export function escapeReferenceKey(key: string): string {
  return key.replace(/[\\)]/g, (ch) => `\\${ch}`);
}

/** 참조 경로를 문자열로 만들 때의 옵션 */
export interface FormatReferenceOptions {
  /**
   * 첫 단계가 예약 참조 이름이면 `true`로 지정한다. 그러면 첫 단계만 `$(...)` 없이 적는다.
   * 이름만으로 판단하지 않으므로 생략하면 `@item`도 값 키 `$(@item)`으로 적는다.
   *
   * @defaultValue false
   */
  reserved?: boolean;
}

/**
 * 참조 경로를 `$(a).$(b)` 형식의 명시 참조 문자열로 만든다.
 *
 * @param path - 참조 경로
 * @param options - 첫 단계를 예약 참조로 적을지 여부
 * @returns 명시 참조 문자열 (예: `$(unit-price)`, `reserved`이면 `@item.$(unit-price)`)
 * @throws RangeError 경로가 비어 있거나, `reserved`인데 첫 단계가 예약 참조 이름이 아닐 때
 */
export function formatReferencePath(
  path: readonly string[],
  options?: FormatReferenceOptions,
): string {
  if (path.length === 0) throw new RangeError('reference path must have at least one step');
  const reserved = options?.reserved === true;
  if (reserved && !RESERVED_REFS.has(path[0]!)) {
    throw new RangeError(`reserved reference path must start with one of ${RESERVED_REF_NAMES.join(', ')}`);
  }
  return path
    .map((step, index) => (index === 0 && reserved ? step : `$(${escapeReferenceKey(step)})`))
    .join('.');
}

// ---------------------------------------------------------------------------
// 토크나이저
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'ident'; value: string; pos: number; end: number }
  | { type: 'key'; value: string; pos: number; end: number } // `$(...)` 키 한 단계
  | { type: 'op'; value: string; pos: number } // 연산자·괄호·쉼표·점
  | { type: 'end'; pos: number };

/** `$(` 다음부터 짝이 맞는 `)`까지 읽어 키 토큰을 만든다. 반환값은 `)` 다음 인덱스. */
function readReferenceKey(source: string, start: number, tokens: Token[]): number {
  let value = '';
  let i = start + 2;
  for (;;) {
    if (i >= source.length) throw new FormulaSyntaxError(fm().unterminatedReference(), start);
    const ch = source[i]!;
    if (ch === '\\') {
      const escaped = source[i + 1];
      if (escaped === undefined) throw new FormulaSyntaxError(fm().unterminatedReference(), start);
      if (escaped !== ')' && escaped !== '\\') {
        throw new FormulaSyntaxError(fm().invalidReferenceEscape(`\\${escaped}`), i);
      }
      value += escaped;
      i += 2;
      continue;
    }
    if (ch === ')') {
      i++;
      break;
    }
    value += ch;
    i++;
  }
  if (value === '') throw new FormulaSyntaxError(fm().emptyReferenceKey(), start);
  tokens.push({ type: 'key', value, pos: start, end: i });
  return i;
}

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
      if (!match) throw new FormulaSyntaxError(fm().invalidNumberFormat(), pos);
      const num = Number(match[0]);
      // 유한하지 않은 숫자 리터럴은 평가 결과로 사용할 수 없다.
      if (!Number.isFinite(num)) throw new FormulaSyntaxError(fm().numberTooLarge(), pos);
      tokens.push({ type: 'number', value: num, pos });
      i += match[0].length;
      continue;
    }
    if (ch === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length) throw new FormulaSyntaxError(fm().unterminatedString(), pos);
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
    if (ch === '$') {
      if (source[i + 1] === '(') {
        i = readReferenceKey(source, i, tokens);
        continue;
      }
      // `$name`처럼 괄호 없이 쓴 참조는 `$(name)`으로 고치도록 안내한다.
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j]!)) j++;
      const name = source.slice(i + 1, j);
      if (name === '') throw new FormulaSyntaxError(fm().unknownCharacter(ch), pos);
      throw new FormulaSyntaxError(fm().referenceNeedsParens(name), pos);
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j]!)) j++;
      tokens.push({ type: 'ident', value: source.slice(i, j), pos, end: j });
      i = j;
      continue;
    }
    // '@' 뒤에 식별자가 이어지면 예약 참조 이름으로 읽는다.
    if (ch === '@' && IDENT_START.test(source[i + 1] ?? '')) {
      let j = i + 2;
      while (j < source.length && IDENT_PART.test(source[j]!)) j++;
      tokens.push({ type: 'ident', value: source.slice(i, j), pos, end: j });
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
    throw new FormulaSyntaxError(fm().unknownCharacter(ch), pos);
  }
  tokens.push({ type: 'end', pos: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// 파서 (재귀 하강)
// ---------------------------------------------------------------------------

const FUNCTION_NAMES = new Set<string>(FORMULA_FUNCTIONS);

type StepToken = Extract<Token, { type: 'ident' | 'key' }>;

class Parser {
  private index = 0;

  /** 수식에 `$(...)` 참조가 하나라도 있으면 값 참조는 모두 명시 참조여야 한다. */
  private readonly explicit: boolean;

  constructor(private readonly tokens: Token[]) {
    this.explicit = tokens.some((token) => token.type === 'key');
  }

  parse(): FormulaAst {
    const expr = this.comparison();
    const token = this.peek();
    if (token.type !== 'end') {
      throw new FormulaSyntaxError(fm().trailingContent(), token.pos);
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

  private expectClosingParen(): void {
    if (!this.matchOp(')')) {
      throw new FormulaSyntaxError(fm().expectedClosingParen(), this.peek().pos);
    }
  }

  /** 재귀 하강 파서가 허용하는 최대 중첩 깊이. */
  private depth = 0;

  private enter(): void {
    if (++this.depth > MAX_FORMULA_DEPTH) {
      throw new FormulaSyntaxError(fm().formulaTooDeep(MAX_FORMULA_DEPTH), this.peek().pos);
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

  /**
   * 왼쪽 결합 이항 연산 사슬을 파싱한다.
   *
   * `1+1+…`처럼 항이 이어질 때마다 트리가 한 단계 깊어지므로, 두 번째 항부터는 중첩 깊이에
   * 포함해 평가기·진단·인자 수 검사가 긴 사슬에서 호출 스택을 넘치지 않게 한다.
   */
  private chain(ops: readonly string[], operand: () => FormulaAst): FormulaAst {
    let left = operand();
    let chained = 0;
    try {
      for (;;) {
        const op = this.matchOp(...ops);
        if (!op) return left;
        this.enter();
        chained++;
        left = { type: 'binary', operator: op as BinaryOperator, left, right: operand() };
      }
    } finally {
      this.depth -= chained;
    }
  }

  private comparisonInner(): FormulaAst {
    return this.chain(['=', '<>', '<=', '>=', '<', '>'], () => this.additive());
  }

  private additive(): FormulaAst {
    return this.chain(['+', '-'], () => this.multiplicative());
  }

  private multiplicative(): FormulaAst {
    return this.chain(['*', '/'], () => this.unary());
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
      this.expectClosingParen();
      return expr;
    }
    if (token.type === 'key') return this.reference(token);
    if (token.type === 'ident') {
      // 예약 참조는 정해진 이름만 허용한다. 값은 평가 컨텍스트가 공급한다.
      if (token.value.startsWith('@') && !RESERVED_REFS.has(token.value)) {
        throw new FormulaSyntaxError(fm().unknownReservedRef(token.value), token.pos);
      }
      const upper = token.value.toUpperCase();
      if (upper === 'TRUE') return { type: 'boolean', value: true };
      if (upper === 'FALSE') return { type: 'boolean', value: false };
      // 등록된 함수 이름 뒤에 여는 괄호가 오면 함수 호출로 파싱한다.
      const isCall = this.peek().type === 'op' && (this.peek() as { value?: string }).value === '(';
      if (isCall) {
        if (!FUNCTION_NAMES.has(upper)) {
          throw new FormulaSyntaxError(fm().unknownFunction(token.value), token.pos);
        }
        this.next(); // '('
        const args: FormulaAst[] = [];
        if (!this.matchOp(')')) {
          do {
            args.push(this.comparison());
          } while (this.matchOp(','));
          this.expectClosingParen();
        }
        return { type: 'call', name: upper as FormulaFunctionName, args };
      }
      return this.reference(token);
    }
    throw new FormulaSyntaxError(fm().expectedValue(), token.pos);
  }

  /** 첫 단계 토큰 뒤에 점으로 이어지는 단계를 읽어 값 참조 경로를 만든다. */
  private reference(head: StepToken): FormulaAst {
    const path = [head.value];
    let end = head.end;
    // `$(@item)`은 키 토큰이라 예약 참조가 아니다. 예약 참조는 `@item`을 그대로 적은 식별자뿐이다.
    const reserved = head.type === 'ident' && head.value.startsWith('@');
    // 예약 참조 이름은 어느 형식에서나 그대로 적으므로 경로의 형식은 그 뒤 첫 단계가 정한다.
    let stepType: StepToken['type'] | undefined = reserved ? undefined : head.type;
    while (this.matchOp('.')) {
      const segment = this.next();
      if (segment.type !== 'ident' && segment.type !== 'key') {
        throw new FormulaSyntaxError(fm().expectedFieldAfterDot(), segment.pos);
      }
      if (stepType === undefined) stepType = segment.type;
      else if (stepType !== segment.type) {
        throw new FormulaSyntaxError(fm().mixedReferenceSteps(), segment.pos);
      }
      path.push(segment.value);
      end = segment.end;
    }
    const explicit = stepType === 'key';
    // 명시 참조를 쓰는 수식에서는 예약 참조 이름 하나만 적은 경우 말고는 모두 명시 참조여야 한다.
    if (this.explicit && !explicit && (!reserved || path.length > 1)) {
      throw new FormulaSyntaxError(
        fm().bareReferenceInExplicit(path.join('.'), formatReferencePath(path, { reserved })),
        head.pos,
      );
    }
    const span: ReferenceSpan = { start: head.pos, end };
    return {
      type: 'reference',
      path,
      ...(explicit ? { explicit: true as const } : {}),
      ...(reserved ? { reserved: true as const } : {}),
      span,
    };
  }
}

/** 파서가 허용하는 수식 문자열의 최대 길이. */
export const MAX_FORMULA_LENGTH = 10_000;
/** 괄호, 함수 인수, 단항 연산자와 이항 연산 사슬을 포함한 수식의 최대 중첩 깊이. */
export const MAX_FORMULA_DEPTH = 100;

/**
 * 수식 문자열을 AST로 파싱한다.
 *
 * @param source - 수식 문자열 (예: `SUM(items.금액) * 1.1`, `SUM($(items).$(금액)) * 1.1`)
 * @param options - 오류 메시지에 사용할 로케일 설정 (생략하면 영어)
 * @returns 파싱된 구문 트리
 * @throws FormulaSyntaxError 문법 오류·미등록 함수·길이/깊이 제한 초과 시
 */
export function parseFormula(source: string, options?: { locale?: string }): FormulaAst {
  return withFormulaLocale(options?.locale, () => {
    if (!source.trim()) throw new FormulaSyntaxError(fm().emptyFormula(), 0);
    if (source.length > MAX_FORMULA_LENGTH) {
      throw new FormulaSyntaxError(fm().formulaTooLong(MAX_FORMULA_LENGTH), 0);
    }
    return new Parser(tokenize(source)).parse();
  });
}
