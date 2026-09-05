/**
 * 전표 값·항목 행처럼 외부에서 들어온 객체의 키를 읽을 때 사용하는 공통 조회.
 *
 * 프로토타입 체인은 보지 않으므로 `constructor`·`toString`·`__proto__` 같은 키도
 * 객체가 직접 가진 값일 때만 읽히고, 없으면 `undefined`가 된다.
 */

/**
 * 객체가 직접 가진 키의 값을 읽는다.
 *
 * @param record - 값을 읽을 객체
 * @param key - 읽을 키
 * @returns 객체가 직접 가진 키면 그 값, 아니면 `undefined`
 */
export function readOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * 객체에 키를 직접 가진 속성으로 기록한다.
 *
 * 일반 대입은 `__proto__` 같은 키에서 프로토타입을 바꿔 버리므로, 어떤 키든 객체가 직접
 * 가진 열거 가능한 속성이 되도록 정의한다.
 *
 * @param record - 값을 기록할 객체
 * @param key - 기록할 키
 * @param value - 기록할 값
 */
export function writeOwn(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}
