// 폰트 변형 선택과 선택 목록 구성 — PDF 변환과 같은 규칙을 쓰는지 확인합니다.
import { describe, expect, it } from 'vitest';
import type { SlipFont, SlipPage } from '@omdc-slipkit/core';
import {
  collectUsedFontNames,
  effectiveFontName,
  fallbackFontNameOf,
  resolveVariantFontName,
  selectableFontNames,
  variantFontNames,
} from '../../src/designer/font-variant.js';

const NAMES = ['Pretendard', 'Pretendard-Bold', 'Pretendard-Italic', 'Pretendard-BoldItalic', 'Noto Sans JP'];

function font(name: string, fallback?: boolean): SlipFont {
  return { name, data: new Uint8Array([1]), ...(fallback === true ? { fallback: true } : {}) };
}

describe('fallbackFontNameOf', () => {
  it('fallback으로 지정한 폰트를 고른다', () => {
    expect(fallbackFontNameOf([font('A'), font('B', true)])).toBe('B');
  });

  it('지정이 없으면 첫 번째 폰트를 고른다', () => {
    expect(fallbackFontNameOf([font('A'), font('B')])).toBe('A');
  });

  it('등록된 폰트가 없으면 undefined다', () => {
    expect(fallbackFontNameOf([])).toBeUndefined();
  });
});

describe('resolveVariantFontName', () => {
  it('굵게와 기울임을 함께 쓰면 BoldItalic을 먼저 찾는다', () => {
    expect(resolveVariantFontName(NAMES, 'Pretendard', 'Pretendard', true, true))
      .toBe('Pretendard-BoldItalic');
  });

  it('BoldItalic이 없으면 Bold, Italic, 원래 폰트 순으로 내려간다', () => {
    const names = ['Pretendard', 'Pretendard-Italic'];
    expect(resolveVariantFontName(names, 'Pretendard', 'Pretendard', true, true))
      .toBe('Pretendard-Italic');
    expect(resolveVariantFontName(['Pretendard'], 'Pretendard', 'Pretendard', true, true))
      .toBe('Pretendard');
  });

  it('변형이 없으면 굵게·기울임을 지정해도 원래 폰트를 쓴다', () => {
    expect(resolveVariantFontName(NAMES, 'Noto Sans JP', 'Pretendard', true, undefined))
      .toBe('Noto Sans JP');
  });

  it('폰트를 지정하지 않으면 대체 폰트의 변형을 찾는다', () => {
    expect(resolveVariantFontName(NAMES, undefined, 'Pretendard', true, undefined))
      .toBe('Pretendard-Bold');
    expect(resolveVariantFontName(NAMES, undefined, 'Pretendard', undefined, undefined))
      .toBeUndefined();
  });
});

describe('effectiveFontName', () => {
  it('등록된 폰트를 지정하면 그 폰트를 그대로 쓴다', () => {
    expect(effectiveFontName(NAMES, 'Noto Sans JP', 'Pretendard', undefined, undefined))
      .toBe('Noto Sans JP');
  });

  it('등록되지 않은 이름을 지정하면 대체 폰트로 내려간다', () => {
    expect(effectiveFontName(NAMES, 'NoSuchFont', 'Pretendard', undefined, undefined))
      .toBe('Pretendard');
    expect(effectiveFontName(NAMES, 'NoSuchFont', 'Pretendard', true, undefined))
      .toBe('Pretendard-Bold');
  });

  it('등록된 폰트가 없으면 undefined다', () => {
    expect(effectiveFontName([], 'Pretendard', undefined, undefined, undefined)).toBeUndefined();
  });
});

describe('selectableFontNames', () => {
  it('기저 이름이 함께 등록된 변형은 목록에서 뺀다', () => {
    expect(selectableFontNames(NAMES)).toEqual(['Pretendard', 'Noto Sans JP']);
  });

  it('기저 이름이 없는 변형은 독립된 폰트로 남긴다', () => {
    expect(selectableFontNames(['Pretendard-Bold', 'Noto Sans JP']))
      .toEqual(['Pretendard-Bold', 'Noto Sans JP']);
  });

  it('같은 이름이 두 번 있어도 한 번만 넣는다', () => {
    expect(selectableFontNames(['A', 'A'])).toEqual(['A']);
  });
});

describe('variantFontNames', () => {
  it('기준 폰트와 등록된 변형을 모두 모은다', () => {
    expect(variantFontNames(NAMES, 'Pretendard'))
      .toEqual(['Pretendard', 'Pretendard-BoldItalic', 'Pretendard-Bold', 'Pretendard-Italic']);
  });

  it('등록되지 않은 이름이면 아무것도 모으지 않는다', () => {
    expect(variantFontNames(NAMES, 'NoSuchFont')).toEqual([]);
  });
});

describe('collectUsedFontNames', () => {
  it('요소와 그리드 셀이 지정한 이름을 모은다', () => {
    const pages = [{
      elements: [
        { type: 'text', id: 't1', position: { x: 0, y: 0 }, width: 10, height: 10, fontName: 'A' },
        { type: 'text', id: 't2', position: { x: 0, y: 0 }, width: 10, height: 10 },
        {
          type: 'grid', id: 'g1', position: { x: 0, y: 0 },
          columns: [{ width: 10 }], rows: [{ height: 10 }], fontName: 'B',
          cells: [{ row: 0, column: 0, fontName: 'C' }, { row: 0, column: 1 }],
        },
      ],
    }] as unknown as SlipPage[];
    expect(collectUsedFontNames(pages).sort()).toEqual(['A', 'B', 'C']);
  });

  it('페이지가 없으면 빈 목록이다', () => {
    expect(collectUsedFontNames([])).toEqual([]);
  });
});

// 이 표는 `packages/core/test/render.test.ts`의 같은 표와 짝입니다.
// 캔버스가 고르는 폰트와 PDF가 고르는 폰트를 같은 기대값으로 확인합니다.
// core는 대체 폰트를 쓸 때 이름을 넣지 않으므로 그 자리를 대체 폰트 이름으로 적습니다.
describe('캔버스와 PDF의 폰트 선택 일치', () => {
  // core 시험과 같은 등록 목록을 씁니다 — BoldItalic 변형은 없습니다.
  const PARITY_NAMES = ['Pretendard', 'Pretendard-Bold', 'Pretendard-Italic', 'Noto Sans JP'];
  const cases: {
    label: string;
    style: { fontName?: string; bold?: boolean; italic?: boolean };
    expected: string;
  }[] = [
    { label: '지정 없음', style: {}, expected: 'Pretendard' },
    { label: '지정 없음 + 굵게', style: { bold: true }, expected: 'Pretendard-Bold' },
    { label: '등록된 폰트', style: { fontName: 'Noto Sans JP' }, expected: 'Noto Sans JP' },
    {
      label: '등록된 폰트 + 굵게 (변형 없음)',
      style: { fontName: 'Noto Sans JP', bold: true },
      expected: 'Noto Sans JP',
    },
    {
      label: '등록된 폰트 + 굵게 (변형 있음)',
      style: { fontName: 'Pretendard', bold: true },
      expected: 'Pretendard-Bold',
    },
    {
      label: '등록된 폰트 + 기울임',
      style: { fontName: 'Pretendard', italic: true },
      expected: 'Pretendard-Italic',
    },
    {
      label: '등록된 폰트 + 굵게·기울임',
      style: { fontName: 'Pretendard', bold: true, italic: true },
      expected: 'Pretendard-Bold',
    },
    {
      label: '등록된 변형 이름',
      style: { fontName: 'Pretendard-Bold' },
      expected: 'Pretendard-Bold',
    },
    { label: '미등록 폰트', style: { fontName: 'NoSuchFont' }, expected: 'Pretendard' },
    {
      label: '미등록 폰트 + 굵게',
      style: { fontName: 'NoSuchFont', bold: true },
      expected: 'Pretendard-Bold',
    },
    {
      label: '미등록 폰트 + 굵게·기울임',
      style: { fontName: 'NoSuchFont', bold: true, italic: true },
      expected: 'Pretendard-Bold',
    },
  ];

  for (const { label, style, expected } of cases) {
    it(`${label}에서 정해진 폰트를 고른다`, () => {
      expect(effectiveFontName(PARITY_NAMES, style.fontName, 'Pretendard', style.bold, style.italic))
        .toBe(expected);
    });
  }
});
