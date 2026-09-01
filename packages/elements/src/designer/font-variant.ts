/**
 * 폰트 이름의 변형 선택과 선택 목록 구성.
 *
 * @remarks
 * PDF 변환은 굵게·기울임에 `이름-Bold`처럼 접미사가 붙은 등록 폰트를 사용하고, 등록된 변형이
 * 없으면 원래 폰트를 그대로 씁니다. 캔버스도 같은 결과를 내야 하므로 그 규칙을 이 모듈에 모읍니다.
 */

import type { SlipFont, SlipPage } from '@omdc-slipkit/core';

/** 굵게·기울임에 사용하는 변형 접미사. 찾는 순서대로 둡니다. */
const VARIANT_SUFFIXES = ['BoldItalic', 'Bold', 'Italic'] as const;

/**
 * 변형 접미사를 뗀 기저 이름을 찾습니다.
 *
 * @param name - 등록된 폰트 이름
 * @returns 기저 이름. 변형 접미사가 없으면 undefined
 */
function baseNameOf(name: string): string | undefined {
  for (const suffix of VARIANT_SUFFIXES) {
    const tail = `-${suffix}`;
    if (name.endsWith(tail) && name.length > tail.length) return name.slice(0, -tail.length);
  }
  return undefined;
}

/**
 * 등록 목록에서 대체 폰트 이름을 찾습니다.
 *
 * @param fonts - 등록된 폰트 목록
 * @returns `fallback`으로 지정한 폰트 이름. 지정이 없으면 첫 번째 폰트 이름
 */
export function fallbackFontNameOf(fonts: readonly SlipFont[]): string | undefined {
  return fonts.find((font) => font.fallback === true)?.name ?? fonts[0]?.name;
}

/**
 * 굵게·기울임을 반영한 폰트 이름을 찾습니다. PDF 변환과 같은 순서를 사용합니다.
 *
 * @param fontNames - 등록된 폰트 이름 목록
 * @param fontName - 요소·셀에 지정한 폰트 이름. 지정이 없으면 undefined
 * @param fallbackName - 지정이 없을 때 변형을 찾을 대체 폰트 이름
 * @param bold - 굵게 여부
 * @param italic - 기울임 여부
 * @returns 사용할 폰트 이름. 등록된 변형이 없으면 지정한 이름을 그대로 반환합니다
 */
export function resolveVariantFontName(
  fontNames: readonly string[],
  fontName: string | undefined,
  fallbackName: string | undefined,
  bold: boolean | undefined,
  italic: boolean | undefined,
): string | undefined {
  const variant = (suffix: string): string | undefined => {
    const base = fontName ?? fallbackName;
    if (base === undefined) return undefined;
    const candidate = `${base}-${suffix}`;
    return fontNames.includes(candidate) ? candidate : undefined;
  };
  if (bold === true && italic === true) {
    return variant('BoldItalic') ?? variant('Bold') ?? variant('Italic') ?? fontName;
  }
  if (bold === true) return variant('Bold') ?? fontName;
  if (italic === true) return variant('Italic') ?? fontName;
  return fontName;
}

/**
 * 캔버스에 실제로 적용할 등록된 폰트 이름을 찾습니다.
 *
 * @param fontNames - 등록된 폰트 이름 목록
 * @param fontName - 요소·셀에 지정한 폰트 이름. 지정이 없으면 undefined
 * @param fallbackName - 대체 폰트 이름
 * @param bold - 굵게 여부
 * @param italic - 기울임 여부
 * @returns 적용할 등록된 폰트 이름. 등록된 폰트가 하나도 없으면 undefined
 */
export function effectiveFontName(
  fontNames: readonly string[],
  fontName: string | undefined,
  fallbackName: string | undefined,
  bold: boolean | undefined,
  italic: boolean | undefined,
): string | undefined {
  const resolved = resolveVariantFontName(fontNames, fontName, fallbackName, bold, italic);
  if (resolved !== undefined && fontNames.includes(resolved)) return resolved;
  // 등록되지 않은 이름을 지정한 요소는 대체 폰트로 표시합니다.
  return resolveVariantFontName(fontNames, undefined, fallbackName, bold, italic) ?? fallbackName;
}

/**
 * 폰트 선택 목록에 표시할 이름을 고릅니다.
 *
 * @remarks
 * 기저 이름이 함께 등록된 변형은 굵게·기울임 설정으로 선택하므로 목록에 넣지 않습니다.
 * 기저 이름이 등록되어 있지 않은 변형은 독립된 폰트로 표시합니다.
 *
 * @param fontNames - 등록된 폰트 이름 목록
 * @returns 선택 목록에 표시할 폰트 이름
 */
export function selectableFontNames(fontNames: readonly string[]): string[] {
  const registered = new Set(fontNames);
  const picked: string[] = [];
  for (const name of fontNames) {
    if (picked.includes(name)) continue;
    const base = baseNameOf(name);
    if (base !== undefined && registered.has(base)) continue;
    picked.push(name);
  }
  return picked;
}

/**
 * 지정한 폰트와 그 폰트의 등록된 변형을 모두 찾습니다.
 *
 * @remarks
 * 굵게·기울임 조합마다 다른 변형이 필요하므로 브라우저 등록 대상을 모을 때 함께 씁니다.
 *
 * @param fontNames - 등록된 폰트 이름 목록
 * @param fontName - 기준이 되는 폰트 이름
 * @returns 기준 폰트와 등록된 변형의 이름
 */
export function variantFontNames(fontNames: readonly string[], fontName: string): string[] {
  const found = fontNames.includes(fontName) ? [fontName] : [];
  for (const suffix of VARIANT_SUFFIXES) {
    const candidate = `${fontName}-${suffix}`;
    if (fontNames.includes(candidate)) found.push(candidate);
  }
  return found;
}

/**
 * 요소와 그리드 셀이 지정한 폰트 이름을 모두 모읍니다.
 *
 * @param pages - 양식의 페이지 목록
 * @returns 지정된 폰트 이름. 지정이 없는 요소는 제외합니다
 */
export function collectUsedFontNames(pages: readonly SlipPage[]): string[] {
  const used = new Set<string>();
  const add = (name: string | undefined): void => {
    if (name !== undefined) used.add(name);
  };
  for (const page of pages) {
    for (const element of page.elements) {
      if ('fontName' in element) add(element.fontName);
      if (element.type === 'grid') {
        for (const cell of element.cells) add(cell.fontName);
      }
    }
  }
  return [...used];
}

/** 속성 패널과 캔버스가 함께 쓰는 폰트 등록 상태 */
export interface DesignerFonts {
  /** 등록 목록의 모든 폰트 이름 */
  readonly names: readonly string[];
  /** 선택 목록에 표시할 폰트 이름 */
  readonly selectable: readonly string[];
  /** 대체 폰트 이름. 등록된 폰트가 없으면 undefined */
  readonly fallback: string | undefined;
  /**
   * 변형 규칙만으로 정해지는 폰트 이름을 찾습니다. 브라우저 등록 상태는 보지 않습니다.
   *
   * @param style - 요소·셀의 폰트 이름과 굵게·기울임
   * @returns 규칙이 고른 폰트 이름. 등록 목록이 비어 있으면 undefined
   */
  resolvedName(style: FontStyleInput): string | undefined;
  /**
   * 지금 화면에 그리는 데 쓰는 폰트 이름을 찾습니다.
   *
   * @remarks
   * 지정한 폰트의 브라우저 등록이 끝나지 않았거나 실패하면 대체 폰트를 씁니다.
   *
   * @param style - 요소·셀의 폰트 이름과 굵게·기울임
   * @returns 적용되는 폰트 이름. 등록 목록이 비어 있으면 undefined
   */
  appliedName(style: FontStyleInput): string | undefined;
  /**
   * 캔버스에 적용할 CSS `font-family` 값을 찾습니다.
   *
   * @param style - 요소·셀의 폰트 이름과 굵게·기울임
   * @returns CSS 이름. 브라우저 등록이 끝나지 않았으면 undefined
   */
  cssFamily(style: FontStyleInput): string | undefined;
  /**
   * 등록 목록에 없는 폰트 이름인지 확인합니다.
   *
   * @param fontName - 요소·셀에 지정한 폰트 이름
   * @returns 지정이 있고 등록 목록에 없으면 true
   */
  isUnregistered(fontName: string | undefined): boolean;
  /**
   * 브라우저 등록에 실패한 폰트인지 확인합니다.
   *
   * @param style - 요소·셀의 폰트 이름과 굵게·기울임
   * @returns 적용할 폰트의 등록이 실패했으면 true
   */
  hasFailed(style: FontStyleInput): boolean;
}

/** 폰트를 결정하는 글자 스타일 */
export interface FontStyleInput {
  fontName?: string | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
}

/** 폰트를 아직 가져오지 못했을 때 쓰는 빈 상태 */
export const NO_DESIGNER_FONTS: DesignerFonts = {
  names: [],
  selectable: [],
  fallback: undefined,
  resolvedName: () => undefined,
  appliedName: () => undefined,
  cssFamily: () => undefined,
  isUnregistered: () => false,
  hasFailed: () => false,
};
