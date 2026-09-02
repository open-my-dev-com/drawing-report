// 셀 기본 테두리·그리드 테두리 판정과 이전 표기 이전이 PDF 변환과 같은 우선순위인지 확인합니다.
import { describe, expect, it } from 'vitest';
import type { GridElement } from '@omdc-slipkit/core';
import {
  applyCellDefaultBorder,
  applyOutline,
  borderCss,
  cellDefaultBorderOf,
  hasLegacyGridBorder,
  outlineOf,
} from '../../src/designer/grid-border.js';

function grid(extra: Partial<GridElement> = {}): GridElement {
  return {
    type: 'grid', id: 'g', name: 'g', position: { x: 0, y: 0 },
    columns: [{ width: 10 }], rows: [{ height: 10 }], cells: [],
    ...extra,
  } as GridElement;
}

describe('cellDefaultBorderOf', () => {
  it('아무 설정이 없으면 검정 실선 0.2mm다', () => {
    expect(cellDefaultBorderOf(grid())).toEqual({ color: '#000000', width: 0.2, style: 'solid' });
  });

  it('cellBorder*를 먼저 보고, 없으면 이전 border*를 쓴다', () => {
    expect(cellDefaultBorderOf(grid({ borderColor: '#CC0000', borderWidth: 0.4, borderStyle: 'dashed' })))
      .toEqual({ color: '#CC0000', width: 0.4, style: 'dashed' });
    expect(cellDefaultBorderOf(grid({ borderColor: '#CC0000', cellBorderColor: '#00AA00' })).color)
      .toBe('#00AA00');
  });
});

describe('outlineOf', () => {
  it('outline*이 없으면 두께 0으로 그리지 않는다', () => {
    expect(outlineOf(grid()).width).toBe(0);
    // 이전 border*는 그리드 테두리에 영향을 주지 않는다.
    expect(outlineOf(grid({ borderWidth: 0.5 })).width).toBe(0);
  });

  it('outline*을 그대로 읽는다', () => {
    expect(outlineOf(grid({ outlineColor: '#123456', outlineWidth: 0.6, outlineStyle: 'dotted' })))
      .toEqual({ color: '#123456', width: 0.6, style: 'dotted' });
  });
});

describe('applyCellDefaultBorder', () => {
  it('이전 border*를 쓰던 그리드는 세 값을 모두 옮긴 뒤 바꾼 값을 얹고 border*를 지운다', () => {
    const el = grid({ borderColor: '#CC0000', borderWidth: 0.4, borderStyle: 'dashed' });
    applyCellDefaultBorder(el, { key: 'width', value: 0.8 });
    expect(el.cellBorderColor).toBe('#CC0000');
    expect(el.cellBorderWidth).toBe(0.8);
    expect(el.cellBorderStyle).toBe('dashed');
    expect(hasLegacyGridBorder(el)).toBe(false);
  });

  it('한 항목만 바꿔도 나머지 두 값은 유지된다', () => {
    const el = grid({ borderColor: '#CC0000', borderWidth: 0.4 });
    applyCellDefaultBorder(el, { key: 'style', value: 'dotted' });
    expect(cellDefaultBorderOf(el)).toEqual({ color: '#CC0000', width: 0.4, style: 'dotted' });
  });

  it('기본값과 같은 값은 파일에 남기지 않는다', () => {
    const el = grid({ cellBorderColor: '#CC0000' });
    applyCellDefaultBorder(el, { key: 'color', value: null });
    expect(el).not.toHaveProperty('cellBorderColor');
    applyCellDefaultBorder(el, { key: 'width', value: 0.2 });
    expect(el).not.toHaveProperty('cellBorderWidth');
  });

  it('새 표기만 쓰는 그리드는 이전 속성을 만들지 않는다', () => {
    const el = grid();
    applyCellDefaultBorder(el, { key: 'width', value: 0 });
    expect(el.cellBorderWidth).toBe(0);
    expect(hasLegacyGridBorder(el)).toBe(false);
  });
});

describe('applyOutline', () => {
  it('두께 0과 기본값은 지우고, 그 밖에는 저장한다', () => {
    const el = grid();
    applyOutline(el, { key: 'width', value: 0.5 });
    applyOutline(el, { key: 'color', value: '#123456' });
    applyOutline(el, { key: 'style', value: 'dashed' });
    expect(el.outlineWidth).toBe(0.5);
    expect(el.outlineColor).toBe('#123456');
    expect(el.outlineStyle).toBe('dashed');

    applyOutline(el, { key: 'width', value: 0 });
    applyOutline(el, { key: 'color', value: '#000000' });
    applyOutline(el, { key: 'style', value: null });
    expect(el).not.toHaveProperty('outlineWidth');
    expect(el).not.toHaveProperty('outlineColor');
    expect(el).not.toHaveProperty('outlineStyle');
  });

  it('그리드 테두리를 바꿔도 셀 기본 테두리와 이전 border*는 건드리지 않는다', () => {
    const el = grid({ borderWidth: 0.4 });
    applyOutline(el, { key: 'width', value: 0.5 });
    expect(el.borderWidth).toBe(0.4);
    expect(cellDefaultBorderOf(el).width).toBe(0.4);
  });
});

describe('borderCss', () => {
  it('두께 0이면 none, 아니면 최소 1px의 CSS border 값이다', () => {
    expect(borderCss({ color: '#000000', width: 0, style: 'solid' }, 3.78)).toBe('none');
    expect(borderCss({ color: '#CC0000', width: 0.2, style: 'dashed' }, 3.78)).toBe('1px dashed #CC0000');
    expect(borderCss({ color: '#CC0000', width: 0.6, style: 'solid' }, 3.78)).toBe('2px solid #CC0000');
  });
});
