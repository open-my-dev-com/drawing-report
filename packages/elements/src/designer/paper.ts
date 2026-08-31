/**
 * 자주 사용하는 용지 크기 목록.
 *
 * @remarks
 * 호스트가 공급한 용지 크기와 함께 용지 설정에서 선택할 수 있다.
 */

/** 세로 방향을 기준으로 정의한 기본 용지 크기(mm) */
export const PAPER_PRESETS = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'B5', width: 176, height: 250 },
  { name: 'Letter', width: 215.9, height: 279.4 },
] as const;
