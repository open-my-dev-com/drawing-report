// 요소 스타일 → 캔버스 CSS 변환 — 화면 없이 직접 확인합니다.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_WIDTH,
  fontPx,
  justifyOf,
  verticalFlexAlign,
  dashArrayOf,
  textStyleCss,
} from '../../src/designer/style-css.js';
import { PX_PER_MM } from '../../src/designer/geometry.js';

describe('fontPx', () => {
  it('pt를 CSS px로 바꾼다 (4/3배)', () => {
    expect(fontPx(12)).toBe('16.00px');
    expect(fontPx(9)).toBe('12.00px');
  });

  it('크기를 지정하지 않으면 기본 크기를 사용한다', () => {
    expect(fontPx(undefined)).toBe(fontPx(DEFAULT_FONT_SIZE));
  });
});

describe('justifyOf · verticalFlexAlign', () => {
  it('가로 정렬을 flexbox 값으로 바꾼다', () => {
    expect(justifyOf('left')).toBe('flex-start');
    expect(justifyOf('center')).toBe('center');
    expect(justifyOf('right')).toBe('flex-end');
    expect(justifyOf(undefined)).toBe('flex-start');
  });

  it('세로 정렬을 flexbox 값으로 바꾼다', () => {
    expect(verticalFlexAlign('top')).toBe('flex-start');
    expect(verticalFlexAlign('middle')).toBe('center');
    expect(verticalFlexAlign('bottom')).toBe('flex-end');
    expect(verticalFlexAlign(undefined)).toBe('flex-start');
  });
});

describe('dashArrayOf', () => {
  it('파선·점선만 dasharray를 만든다', () => {
    expect(dashArrayOf('dashed')).toBe(`${2.4 * PX_PER_MM} ${1.2 * PX_PER_MM}`);
    expect(dashArrayOf('dotted')).toBe(`${0.4 * PX_PER_MM} ${0.8 * PX_PER_MM}`);
    expect(dashArrayOf('solid')).toBeUndefined();
    expect(dashArrayOf(undefined)).toBeUndefined();
  });
});

describe('textStyleCss', () => {
  it('아무 강조도 없으면 세로 정렬만 남는다', () => {
    expect(textStyleCss({})).toBe(';justify-content:flex-start');
  });

  it('굵게와 밑줄·취소선을 함께 적는다', () => {
    const css = textStyleCss({ bold: true, underline: true, strikethrough: true });
    expect(css).toContain(';font-weight:700');
    expect(css).toContain(';text-decoration:underline line-through');
  });

  it('기울임은 캔버스에 적용하지 않는다', () => {
    expect(textStyleCss({ italic: true } as never)).not.toContain('italic');
  });

  it('줄간격이 1이면 아무것도 적지 않고, 다르면 위쪽 여백을 함께 보정한다', () => {
    expect(textStyleCss({ lineHeight: 1 })).not.toContain('line-height');
    const css = textStyleCss({ lineHeight: 1.5 });
    expect(css).toContain(';line-height:1.5');
    expect(css).toContain(';margin-top:-0.2500em');
  });

  it('자간은 pt를 px로 바꿔 적는다', () => {
    expect(textStyleCss({ characterSpacing: 3 })).toContain(';letter-spacing:4px');
    expect(textStyleCss({ characterSpacing: 0 })).toContain(';letter-spacing:0px');
  });

  it('세로 정렬 생략을 요청하면 justify-content를 넣지 않는다', () => {
    const css = textStyleCss({ verticalAlignment: 'middle' }, { omitVerticalAlign: true });
    expect(css).not.toContain('justify-content');
  });

  it('선 굵기 기본값은 core의 변환 기본값과 같다', () => {
    expect(DEFAULT_LINE_WIDTH).toBe(0.2);
  });
});
