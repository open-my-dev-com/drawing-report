/**
 * 사이드바에서 무엇을 골랐는지 나타내는 타입.
 *
 * @remarks
 * 요소를 고르면 여기서는 null이고 요소 선택 상태가 따로 남는다.
 */

/** 사이드바에서 선택한 대상 */
export type SideSelection =
  | { kind: 'parameter'; key: string }
  | { kind: 'parameterField'; key: string; field: string }
  | { kind: 'page' }
  | null;
