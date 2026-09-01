/**
 * 선택 속성(생략 가능한 키)을 쓰고 지우는 공통 처리.
 *
 * @remarks
 * 스키마가 `undefined`를 허용하지 않으므로 값을 비울 때는 키 자체를 지웁니다.
 */


/**
 * 요소 또는 셀의 선택 속성을 설정하거나 제거합니다.
 *
 * @remarks
 * 판별 유니온에 동적으로 속성을 적용하는 타입 변환을 이 함수 안으로 제한합니다.
 *
 * @param target - 필드를 수정할 요소·셀 객체
 * @param key - 수정할 선택 필드 이름
 * @param value - 넣을 값 (null·undefined면 필드를 지웁니다)
 */
export function setOptional(target: object, key: string, value: unknown): void {
  const record = target as Record<string, unknown>;
  if (value === null || value === undefined) delete record[key];
  else record[key] = value;
}

/**
 * 셀 또는 바코드의 값 소스를 바꾸기 전에 `content`, `parameter`, `formula`를 제거합니다.
 * 호출부는 제거 후 사용할 소스 하나만 설정합니다 (SPEC §5.6/§5.7).
 *
 * @param record - content·parameter·formula를 가질 수 있는 셀 또는 요소
 */
export function clearValueSources(record: { content?: unknown; parameter?: unknown; formula?: unknown }): void {
  delete record.content;
  delete record.parameter;
  delete record.formula;
}
