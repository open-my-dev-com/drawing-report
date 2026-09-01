/**
 * 사이드바의 선택 대상을 나타내는 타입.
 *
 * @remarks
 * 요소를 선택한 경우 이 값은 null이며, 요소 선택 상태는 별도로 관리합니다.
 */

/** 사이드바에서 선택한 대상 */
export type SideSelection =
  | { kind: 'parameter'; key: string }
  | { kind: 'parameterField'; key: string; field: string }
  | { kind: 'page' }
  | null;
