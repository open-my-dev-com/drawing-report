/**
 * 요소 스타일을 캔버스에 적용할 CSS로 바꾼다.
 *
 * @remarks
 * PDF 출력과 같은 값을 쓰되 표현만 CSS로 옮긴다. 화면 상태에 의존하지 않는다.
 */

import { PX_PER_MM } from './geometry.js';

/**
 * 속성 패널에서 지정하지 않은 스타일에 적용할 기본값.
 * core의 PDF 변환 기본값과 같아야 한다.
 */
export const DEFAULT_FONT_SIZE = 10;

export const DEFAULT_FONT_COLOR = '#000000';

export const DEFAULT_BORDER_COLOR = '#000000';

/** 선 굵기 기본값(mm). core의 `DEFAULT_BORDER_WIDTH`와 같아야 한다. */
export const DEFAULT_LINE_WIDTH = 0.2;

/** 글자 크기를 pt에서 CSS px로 변환한다. */
export function fontPx(size: number | undefined): string {
  return `${(((size ?? DEFAULT_FONT_SIZE) * 4) / 3).toFixed(2)}px`;
}

/** 가로 정렬 값을 flexbox 정렬 값으로 변환한다. */
export function justifyOf(alignment: 'left' | 'center' | 'right' | undefined): string {
  return alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start';
}

/** 수직 정렬 값을 flexbox 정렬 값으로 변환한다. */
export function verticalFlexAlign(v: 'top' | 'middle' | 'bottom' | undefined): string {
  return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
}

/** PDF 렌더링 비율과 맞춘 캔버스용 `stroke-dasharray` 값(px) */
export function dashArrayOf(style: 'solid' | 'dashed' | 'dotted' | undefined): string | undefined {
  if (style === 'dashed') return `${2.4 * PX_PER_MM} ${1.2 * PX_PER_MM}`;
  if (style === 'dotted') return `${0.4 * PX_PER_MM} ${0.8 * PX_PER_MM}`;
  return undefined;
}

/**
 * 글자 스타일을 세미콜론으로 시작하는 인라인 CSS 문자열로 변환한다.
 *
 * @param style - 요소·셀의 글자 스타일
 * @param opts - `omitVerticalAlign`이 true이면 `justify-content`를 생략한다.
 */
export function textStyleCss(
  style: {
    bold?: boolean | undefined;
    underline?: boolean | undefined;
    strikethrough?: boolean | undefined;
    verticalAlignment?: 'top' | 'middle' | 'bottom' | undefined;
    lineHeight?: number | undefined;
    characterSpacing?: number | undefined;
    vertical?: boolean | undefined;
  },
  opts?: { omitVerticalAlign?: boolean },
): string {
  const decorations = [
    style.underline === true ? 'underline' : '',
    style.strikethrough === true ? 'line-through' : '',
  ].filter(Boolean).join(' ');
  // 그리드 셀은 호출부에서 수직 정렬을 적용하므로 여기서는 선택적으로 생략한다.
  const verticalAlign = opts?.omitVerticalAlign
    ? ''
    : `;justify-content:${verticalFlexAlign(style.verticalAlignment)}`;
  // 브라우저의 합성 italic과 PDF의 폰트 변형 처리 방식이 달라 캔버스에는 italic을 적용하지 않는다.
  return (
    (style.bold === true ? ';font-weight:700' : '') +
    (decorations ? `;text-decoration:${decorations}` : '') +
    verticalAlign +
    // CSS의 half-leading만큼 위쪽 여백을 보정해 PDF와 첫 줄 위치를 맞춘다.
    (style.lineHeight !== undefined && style.lineHeight !== 1
      ? `;line-height:${style.lineHeight};margin-top:${(-(style.lineHeight - 1) / 2).toFixed(4)}em`
      : '') +
    (style.characterSpacing !== undefined ? `;letter-spacing:${(style.characterSpacing * 4) / 3}px` : '')
    // 세로쓰기는 PDF와 같은 stackVertically 결과를 사용한다.
  );
}

/** 테두리 굵기 선택지(mm) */
export const BORDER_WIDTH_STEPS = [0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2] as const;
