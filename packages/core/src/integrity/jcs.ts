/**
 * RFC 8785 (JSON Canonicalization Scheme) 구현.
 *
 * 키 정렬 + 결정적 수·문자열 직렬화로 같은 데이터를 항상 같은 바이트로 만든다.
 * JSON.stringify의 수·문자열 출력은 이미 RFC 8785과 일치하므로,
 * 이 구현은 **객체 키 정렬**과 **재귀 직렬화**만 직접 처리한다.
 */

/** 정규화가 허용하는 최대 중첩 깊이 — 적대적 문서의 스택 오버플로 방지 */
export const MAX_CANONICALIZE_DEPTH = 256;

/**
 * 값을 RFC 8785 정규 JSON 문자열로 직렬화한다. undefined 값 키는 건너뛴다.
 *
 * @param value - 직렬화할 값 (JSON으로 표현 가능한 값)
 * @returns 정규 JSON 문자열 — 같은 데이터면 항상 같은 결과
 * @throws RangeError 중첩 깊이가 {@link MAX_CANONICALIZE_DEPTH}를 넘으면
 * @throws TypeError Infinity·NaN·함수 등 JSON으로 표현할 수 없는 값이면
 */
export function canonicalize(value: unknown): string {
  return canonicalizeAt(value, 0);
}

function canonicalizeAt(value: unknown, depth: number): string {
  if (depth > MAX_CANONICALIZE_DEPTH) {
    throw new RangeError(`JCS: 중첩 깊이가 제한(${MAX_CANONICALIZE_DEPTH})을 초과했습니다`);
  }
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('JCS: Infinity와 NaN은 JSON으로 표현할 수 없습니다');
      }
      return JSON.stringify(value);

    case 'string':
      return JSON.stringify(value);

    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((item) => canonicalizeAt(item, depth + 1)).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const entries: string[] = [];
      for (const key of Object.keys(obj).sort()) {
        const v = obj[key];
        if (v !== undefined) {
          entries.push(JSON.stringify(key) + ':' + canonicalizeAt(v, depth + 1));
        }
      }
      return '{' + entries.join(',') + '}';
    }

    default:
      throw new TypeError(`JCS: 지원하지 않는 타입 — ${typeof value}`);
  }
}
