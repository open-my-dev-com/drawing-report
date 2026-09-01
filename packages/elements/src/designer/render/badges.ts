/**
 * 요소 종류와 파라미터 종류를 나타내는 작은 배지.
 *
 * @remarks
 * 사이드바와 속성 패널이 같은 배지를 사용합니다.
 */

import type { TemplateResult } from 'lit';
import type { SlipElement } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';

/**
 * 파라미터 값 종류별 아이콘.
 * 종류를 지정하지 않은 파라미터에는 텍스트 아이콘을 사용합니다 (SPEC §4).
 */
export const VALUE_TYPE_BADGE: Record<string, TemplateResult> = {
  text: icons.typeText,
  number: icons.typeNumber,
  date: icons.typeDate,
  boolean: icons.typeBoolean,
  image: icons.typeImage,
  list: icons.typeList,
};

/**
 * 파라미터·하위 필드 줄에 붙일 아이콘.
 *
 * @param valueType - 값 종류 (없으면 글자)
 * @returns 그 종류의 아이콘
 */
export function valueTypeBadge(valueType: string | undefined): TemplateResult {
  return VALUE_TYPE_BADGE[valueType ?? 'text'] ?? icons.typeText;
}

/** 캔버스 요소 종류별 배지 아이콘 */
export const TYPE_BADGE: Record<SlipElement['type'], TemplateResult> = {
  text: icons.text,
  grid: icons.gridElement,
  image: icons.image,
  line: icons.line,
  rect: icons.shape,
  ellipse: icons.ellipse,
  polygon: icons.polygon,
  field: icons.field,
  barcode: icons.barcode,
};
