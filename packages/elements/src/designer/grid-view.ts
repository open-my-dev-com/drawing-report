/**
 * 캔버스 격자(모눈)의 간격과 색 — 화면 전용 설정.
 *
 * @remarks
 * 격자는 파일에 저장하지 않는다. 그리드(요소)와 다른 것이다.
 */

import type { SlipElement } from '@omdc-slipkit/core';

/** 캔버스 격자 간격 선택지(mm) */
export const GRID_GAPS = [1, 5, 10] as const;

/**
 * 캔버스 격자 색상 선택지.
 * `swatch`는 메뉴에 표시할 색이고 `line`은 캔버스에 그릴 색이다.
 */
export const GRID_COLORS = [
  { id: 'gray', nameKey: 'colorGray', swatch: '#80868b', line: 'rgba(0, 0, 0, 0.08)' },
  { id: 'blue', nameKey: 'colorBlue', swatch: '#1a73e8', line: 'rgba(26, 115, 232, 0.2)' },
  { id: 'red', nameKey: 'colorRed', swatch: '#d93025', line: 'rgba(217, 48, 37, 0.16)' },
  { id: 'green', nameKey: 'colorGreen', swatch: '#188038', line: 'rgba(24, 128, 56, 0.16)' },
] as const;

/** 격자 색상 ID */
export type GridColorId = (typeof GRID_COLORS)[number]['id'];

/** 디자이너가 만들 수 있는 요소 종류 */
export type CreatableType = SlipElement['type'];
