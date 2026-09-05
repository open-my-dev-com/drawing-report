/**
 * 샘플 값·목록 행처럼 사용자가 정한 키를 담는 열린 맵을 자체 속성으로만 다루는 도우미.
 *
 * @remarks
 * `__proto__`·`constructor`·`toString`처럼 `Object.prototype`과 겹치는 키도 보통 키처럼
 * 자체 데이터 속성으로 읽고 씁니다. `key in record`는 상속 속성을 값이 있는 것으로 오해하고,
 * `record[key] = value`와 `Object.assign`은 `__proto__`에 값을 넣는 대신 프로토타입을 바꿔
 * 값을 잃습니다. 키 순서는 넣은 순서를 유지합니다.
 */

/** 문자열 키와 임의 값의 열린 맵 */
export type OwnRecord = Record<string, unknown>;

/**
 * 맵이 키를 자체 속성으로 갖는지 확인합니다.
 *
 * @param record - 확인할 맵. undefined면 갖지 않은 것으로 봅니다
 * @param key - 확인할 키
 * @returns 자체 속성이면 true. 프로토타입에서 물려받은 속성은 false
 */
export function hasOwn(record: Readonly<OwnRecord> | undefined, key: string): boolean {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * 맵의 자체 속성 값을 읽습니다.
 *
 * @param record - 읽을 맵. undefined면 값이 없는 것으로 봅니다
 * @param key - 읽을 키
 * @returns 자체 속성 값. 없거나 물려받은 속성이면 undefined
 */
export function readOwn(record: Readonly<OwnRecord> | undefined, key: string): unknown {
  return record !== undefined && hasOwn(record, key) ? record[key] : undefined;
}

/**
 * 맵에 값을 자체 데이터 속성으로 넣습니다.
 *
 * @remarks
 * 이미 있는 키는 자리를 유지한 채 값만 바뀌고, 새 키는 맨 뒤에 놓입니다.
 *
 * @param record - 수정할 맵
 * @param key - 넣을 키
 * @param value - 넣을 값
 */
export function writeOwn(record: OwnRecord, key: string, value: unknown): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * 맵에서 자체 속성을 지웁니다. 물려받은 속성은 건드리지 않습니다.
 *
 * @param record - 수정할 맵
 * @param key - 지울 키
 */
export function deleteOwn(record: OwnRecord, key: string): void {
  if (hasOwn(record, key)) delete record[key];
}

/**
 * 맵의 자체 열거 속성을 순서대로 키·값 쌍으로 나열합니다.
 *
 * @param record - 나열할 맵
 * @returns 키·값 쌍 목록
 */
export function entriesOwn(record: Readonly<OwnRecord>): [string, unknown][] {
  return Object.keys(record).map((key) => [key, record[key]]);
}

/**
 * 맵의 자체 열거 속성만 같은 순서로 담은 새 맵을 만듭니다 (얕은 복사).
 *
 * @param record - 복사할 맵
 * @returns 새 맵
 */
export function cloneOwn(record: Readonly<OwnRecord>): OwnRecord {
  const out: OwnRecord = {};
  for (const [key, value] of entriesOwn(record)) writeOwn(out, key, value);
  return out;
}

/**
 * 키 하나의 이름을 바꾼 새 맵을 만듭니다. 바뀐 키는 원래 자리를 지킵니다.
 *
 * @remarks
 * 새 이름의 키가 이미 다른 자리에 있으면 그 값은 버리고 옮긴 값이 남습니다.
 * 바꿀 키가 없으면 그대로 복사합니다.
 *
 * @param record - 원본 맵
 * @param key - 현재 키
 * @param next - 새 키
 * @returns 이름을 바꾼 새 맵
 */
export function renameOwn(record: Readonly<OwnRecord>, key: string, next: string): OwnRecord {
  if (!hasOwn(record, key) || key === next) return cloneOwn(record);
  const out: OwnRecord = {};
  for (const [k, value] of entriesOwn(record)) {
    if (k === next) continue;
    writeOwn(out, k === key ? next : k, value);
  }
  return out;
}
