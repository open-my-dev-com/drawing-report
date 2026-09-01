/**
 * 그리드의 셀 기본 테두리와 외곽선을 정합니다.
 *
 * @remarks
 * PDF 변환과 같은 우선순위를 씁니다. 셀 기본 테두리는 `cellBorder*`, 없으면 이전 파일 표기인
 * `border*`, 그것도 없으면 검정 실선 0.2mm입니다. 외곽선은 `outline*`만 보고 없으면 그리지
 * 않습니다. 캔버스와 속성 패널이 이 모듈을 함께 씁니다.
 */

import type { GridElement } from '@omdc-slipkit/core';
import { DEFAULT_BORDER_COLOR, DEFAULT_LINE_WIDTH } from './style-css.js';

/** 선 형태 */
export type GridBorderStyle = 'solid' | 'dashed' | 'dotted';

/** 해소된 테두리 값 */
export interface GridBorder {
  color: string;
  width: number;
  style: GridBorderStyle;
}

/**
 * 셀에 테두리 설정이 없을 때 적용되는 셀 기본 테두리를 찾습니다.
 *
 * @param el - 그리드 요소
 * @returns 색·두께·형태
 */
export function cellDefaultBorderOf(el: GridElement): GridBorder {
  return {
    color: el.cellBorderColor ?? el.borderColor ?? DEFAULT_BORDER_COLOR,
    width: el.cellBorderWidth ?? el.borderWidth ?? DEFAULT_LINE_WIDTH,
    style: el.cellBorderStyle ?? el.borderStyle ?? 'solid',
  };
}

/**
 * 그리드 외곽선을 찾습니다.
 *
 * @param el - 그리드 요소
 * @returns 색·두께·형태. 두께가 0이면 그리지 않습니다
 */
export function outlineOf(el: GridElement): GridBorder {
  return {
    color: el.outlineColor ?? DEFAULT_BORDER_COLOR,
    width: el.outlineWidth ?? 0,
    style: el.outlineStyle ?? 'solid',
  };
}

/**
 * 그리드에 이전 파일용 `border*` 속성이 남아 있는지 확인합니다.
 *
 * @param el - 그리드 요소
 * @returns `border*` 가운데 하나라도 있으면 `true`
 */
export function hasLegacyGridBorder(el: GridElement): boolean {
  return el.borderColor !== undefined || el.borderWidth !== undefined || el.borderStyle !== undefined;
}

/** 셀 기본 테두리 한 항목의 변경 */
export type CellDefaultBorderPatch =
  | { key: 'color'; value: string | null }
  | { key: 'width'; value: number }
  | { key: 'style'; value: GridBorderStyle | null };

/**
 * 셀 기본 테두리 한 항목을 바꿉니다. 이전 표기를 쓰던 그리드는 새 표기로 옮깁니다.
 *
 * @remarks
 * 이전 `border*`를 쓰던 그리드에서 한 항목만 바꾸면 나머지 두 값이 기본값으로 돌아가므로,
 * 먼저 지금 적용 중인 세 값을 모두 `cellBorder*`에 적고 바꾼 값을 얹은 뒤 `border*`를 지웁니다.
 * 기본값과 같은 값은 파일에 남기지 않습니다.
 *
 * @param el - 바꿀 그리드 요소 (제자리에서 수정합니다)
 * @param patch - 바꿀 항목과 값. 색과 형태의 null은 기본값으로 되돌립니다
 */
export function applyCellDefaultBorder(el: GridElement, patch: CellDefaultBorderPatch): void {
  const current = cellDefaultBorderOf(el);
  if (hasLegacyGridBorder(el)) {
    // 세 값을 모두 옮겨야 바꾸지 않은 항목이 그대로 남습니다.
    el.cellBorderColor = current.color;
    el.cellBorderWidth = current.width;
    el.cellBorderStyle = current.style;
    delete el.borderColor;
    delete el.borderWidth;
    delete el.borderStyle;
  }
  if (patch.key === 'color') {
    if (patch.value === null) delete el.cellBorderColor;
    else el.cellBorderColor = patch.value;
  } else if (patch.key === 'width') {
    el.cellBorderWidth = patch.value;
  } else if (patch.value === null) {
    delete el.cellBorderStyle;
  } else {
    el.cellBorderStyle = patch.value;
  }
  // 기본값과 같은 값은 지워 새 그리드와 같은 모양으로 둡니다.
  if (el.cellBorderColor === DEFAULT_BORDER_COLOR) delete el.cellBorderColor;
  if (el.cellBorderWidth === DEFAULT_LINE_WIDTH) delete el.cellBorderWidth;
  if (el.cellBorderStyle === 'solid') delete el.cellBorderStyle;
}

/** 외곽선 한 항목의 변경 */
export type OutlinePatch =
  | { key: 'color'; value: string | null }
  | { key: 'width'; value: number }
  | { key: 'style'; value: GridBorderStyle | null };

/**
 * 외곽선 한 항목을 바꿉니다.
 *
 * @param el - 바꿀 그리드 요소 (제자리에서 수정합니다)
 * @param patch - 바꿀 항목과 값. 두께 0과 색·형태의 null은 기본값으로 되돌립니다
 */
export function applyOutline(el: GridElement, patch: OutlinePatch): void {
  if (patch.key === 'color') {
    if (patch.value === null || patch.value === DEFAULT_BORDER_COLOR) delete el.outlineColor;
    else el.outlineColor = patch.value;
  } else if (patch.key === 'width') {
    if (patch.value <= 0) delete el.outlineWidth;
    else el.outlineWidth = patch.value;
  } else if (patch.value === null || patch.value === 'solid') {
    delete el.outlineStyle;
  } else {
    el.outlineStyle = patch.value;
  }
}

/**
 * 테두리를 캔버스 CSS `border` 값으로 바꿉니다.
 *
 * @param border - 해소된 테두리
 * @param pxPerMm - mm당 픽셀 수
 * @returns CSS `border` 값. 두께가 0이면 `none`
 */
export function borderCss(border: GridBorder, pxPerMm: number): string {
  if (border.width <= 0) return 'none';
  const px = Math.max(1, Math.round(border.width * pxPerMm));
  return `${px}px ${border.style} ${border.color}`;
}
