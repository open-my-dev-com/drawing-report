/**
 * 수식 안의 값 참조를 찾고 `$(...)` 명시 참조로 고쳐 쓰는 도우미.
 *
 * 참조 텍스트는 정규식이 아니라 파서가 남긴 범위(`span`)로 찾아 바꾸므로 문자열 리터럴이나
 * 함수 이름 안의 비슷한 글자를 건드리지 않는다.
 */
import {
  RESERVED_REF_NAMES,
  escapeReferenceKey,
  formatReferencePath,
  isBareIdentifier,
  parseFormula,
  type FormatReferenceOptions,
  type FormulaAst,
  type ReferenceSpan,
} from './parser.js';

export { escapeReferenceKey, formatReferencePath, isBareIdentifier, type FormatReferenceOptions };

/** 수식에서 찾은 값 참조 하나 */
export interface FormulaReference {
  /** 참조 경로 (예약 참조는 첫 단계가 `@item` 등) */
  path: string[];
  /** `$(...)` 명시 참조로 적었는지 */
  explicit: boolean;
  /** 첫 단계를 `@item`처럼 그대로 적은 예약 참조인지. `$(@item)`은 값 키라 `false`다 */
  reserved: boolean;
  /** 원본 수식에서 이 참조가 차지하는 범위 */
  span: ReferenceSpan;
}

/** 수식 파싱 옵션 */
export interface ReferenceOptions {
  /** 오류 메시지에 사용할 로케일 (생략하면 영어) */
  locale?: string;
}

/** 참조 이름 변경 옵션 */
export interface RenameReferenceOptions extends ReferenceOptions {
  /**
   * `from`·`to`의 첫 단계가 그리드 예약 참조 이름(`@item` 등)이면 `true`로 지정한다. 그러면
   * `@item`을 그대로 적은 예약 참조만 바꾸고 새 경로의 첫 단계도 그대로 적는다. 생략하면
   * 두 경로를 모두 값 키로 다뤄 `$(@item)`처럼 적은 참조만 바꾼다.
   *
   * @defaultValue false
   */
  reservedRoot?: boolean;
}

const RESERVED_REFS = new Set<string>(RESERVED_REF_NAMES);

function walk(ast: FormulaAst, out: FormulaReference[]): void {
  switch (ast.type) {
    case 'reference':
      // 파서는 모든 참조에 범위를 남기므로 없는 경우는 없다.
      if (ast.span !== undefined) {
        out.push({
          path: [...ast.path],
          explicit: ast.explicit === true,
          reserved: ast.reserved === true,
          span: { ...ast.span },
        });
      }
      return;
    case 'call':
      for (const arg of ast.args) walk(arg, out);
      return;
    case 'unary':
      walk(ast.operand, out);
      return;
    case 'binary':
      walk(ast.left, out);
      walk(ast.right, out);
      return;
    default:
      return;
  }
}

/**
 * 수식에서 값 참조를 모두 찾는다.
 *
 * @param source - 수식 문자열
 * @param options - 파싱 옵션
 * @returns 원본에서 나타나는 순서대로 정렬한 참조 목록. 예약 참조 이름만 적은 것(`@item`)도 포함한다
 * @throws FormulaSyntaxError 수식에 문법 오류가 있을 때
 */
export function collectFormulaReferences(
  source: string,
  options?: ReferenceOptions,
): FormulaReference[] {
  const refs: FormulaReference[] = [];
  walk(parseFormula(source, options), refs);
  return refs.sort((a, b) => a.span.start - b.span.start);
}

/** 참조 범위를 뒤에서부터 바꿔 앞쪽 범위가 어긋나지 않게 한다. */
function rewrite(
  source: string,
  refs: readonly FormulaReference[],
  replacement: (ref: FormulaReference) => string | undefined,
): string {
  let out = source;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!;
    const text = replacement(ref);
    if (text === undefined) continue;
    out = out.slice(0, ref.span.start) + text + out.slice(ref.span.end);
  }
  return out;
}

/**
 * 수식의 값 참조를 모두 `$(...)` 명시 참조로 고쳐 쓴다.
 *
 * 함수 이름·상수·문자열 리터럴·예약 참조 이름은 그대로 두고, 이미 명시 참조를 쓰는 수식은
 * 바꾸지 않고 돌려준다.
 *
 * @param source - 수식 문자열
 * @param options - 파싱 옵션
 * @returns 명시 참조로 고쳐 쓴 수식
 * @throws FormulaSyntaxError 수식에 문법 오류가 있을 때
 */
export function toExplicitReferences(source: string, options?: ReferenceOptions): string {
  const refs = collectFormulaReferences(source, options);
  if (refs.some((ref) => ref.explicit)) return source;
  return rewrite(source, refs, (ref) => formatReferencePath(ref.path, { reserved: ref.reserved }));
}

/** 경로 전체를 `$(...)` 없이 적을 수 있는지 확인한다. */
function isBarePath(path: readonly string[], reserved: boolean): boolean {
  return path.every((step, index) => {
    if (index === 0) {
      if (reserved) return true;
      // 첫 단계가 TRUE·FALSE면 참조가 아니라 논리 상수로 읽힌다.
      const upper = step.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') return false;
    }
    return isBareIdentifier(step);
  });
}

/**
 * 수식에서 `from` 경로로 시작하는 값 참조를 `to` 경로로 바꾼다.
 *
 * `from`은 참조 경로의 앞부분과 단계 단위로 정확히 일치해야 한다 (`['items']`는 `items.amount`와
 * 맞고 `itemsExtra`와는 맞지 않는다). `from`·`to`는 값 키 경로로 다루므로 `['@item']`은
 * `$(@item)`으로 적은 값 키와 맞고 예약 참조 `@item`과는 맞지 않는다. 그리드 예약 참조 뒤의
 * 하위 필드를 바꾸려면 `reservedRoot`를 지정한다.
 *
 * 일반 참조만 쓰는 수식에서는 새 이름을 그대로 적을 수 있으면 형식을 유지하고, 식별자 규칙에
 * 맞지 않는 이름(`.`·`-`·공백 포함, 숫자로 시작, `@item` 등)이면 수식 전체를 명시 참조로 바꾼 뒤
 * 이름을 바꾼다. 명시 참조를 쓰는 수식은 명시 참조로 바꿔 넣는다.
 *
 * @param source - 수식 문자열
 * @param from - 바꿀 참조 경로의 앞부분
 * @param to - 새 경로. `from`과 일치한 부분을 이것으로 바꾼다
 * @param options - 파싱 옵션과 첫 단계를 예약 참조로 볼지 여부
 * @returns 이름을 바꾼 수식. 일치하는 참조가 없으면 입력을 그대로 돌려준다
 * @throws FormulaSyntaxError 수식에 문법 오류가 있을 때
 * @throws RangeError `from` 또는 `to`가 비어 있거나, `reservedRoot`인데 첫 단계가 예약 참조 이름이 아닐 때
 */
export function renameFormulaReferences(
  source: string,
  from: readonly string[],
  to: readonly string[],
  options?: RenameReferenceOptions,
): string {
  if (from.length === 0 || to.length === 0) {
    throw new RangeError('reference paths must have at least one step');
  }
  const reserved = options?.reservedRoot === true;
  if (reserved && (!RESERVED_REFS.has(from[0]!) || !RESERVED_REFS.has(to[0]!))) {
    throw new RangeError(`reserved reference paths must start with one of ${RESERVED_REF_NAMES.join(', ')}`);
  }
  const refs = collectFormulaReferences(source, options);
  const matches = (ref: FormulaReference): boolean =>
    ref.reserved === reserved &&
    ref.path.length >= from.length &&
    from.every((step, index) => ref.path[index] === step);
  const renamed = (ref: FormulaReference): string[] => [...to, ...ref.path.slice(from.length)];
  const targets = refs.filter(matches);
  if (targets.length === 0) return source;

  if (refs.some((ref) => ref.explicit)) {
    return rewrite(source, refs, (ref) =>
      matches(ref) ? formatReferencePath(renamed(ref), { reserved }) : undefined);
  }
  if (targets.every((ref) => isBarePath(renamed(ref), reserved))) {
    return rewrite(source, refs, (ref) => (matches(ref) ? renamed(ref).join('.') : undefined));
  }
  // 새 이름을 그대로 적을 수 없으므로 수식 전체를 명시 참조로 바꾸면서 이름을 바꾼다.
  return rewrite(source, refs, (ref) =>
    formatReferencePath(matches(ref) ? renamed(ref) : ref.path, { reserved: ref.reserved }));
}
