/**
 * pdfme 기반 렌더러 구현 (내부 전용, ADR-016).
 *
 * pdfme 의존은 이 파일과 convert.ts 안에만 존재한다 — 공개 API는 `types.ts`의
 * `SlipPdfRenderer`뿐이라 하부 엔진을 갈아끼워도 호스트 코드는 그대로다.
 */
import { generate } from '@pdfme/generator';
import type { Font } from '@pdfme/common';
import { barcodes, ellipse, image, line, rectangle, svg, table, text } from '@pdfme/schemas';
import type { SlipFile } from '../format/schema.js';
import { convertSlipFile } from './convert.js';
import { SlipRenderError } from './errors.js';
import type { RenderOptions, SlipFont, SlipPdfRenderer } from './types.js';

/** 사용자 폰트를 하부 엔진 형식으로 옮긴다. 없으면 undefined(엔진 기본 폰트). */
function toEngineFont(fonts: readonly SlipFont[] | undefined): Font | undefined {
  if (!fonts || fonts.length === 0) return undefined;
  const fallbackCount = fonts.filter((font) => font.fallback === true).length;
  if (fallbackCount > 1) {
    throw new SlipRenderError('대체(fallback) 폰트는 하나만 지정할 수 있습니다');
  }
  const entries = fonts.map((font, index) => {
    const isFallback = font.fallback === true || (fallbackCount === 0 && index === 0);
    return [font.name, { data: font.data, fallback: isFallback }] as const;
  });
  const names = new Set(entries.map(([name]) => name));
  if (names.size !== entries.length) {
    throw new SlipRenderError('폰트 이름이 중복되었습니다');
  }
  // 폰트 데이터 타입만 하부 엔진 표현으로 맞춘다 (Uint8Array 그대로 전달)
  return Object.fromEntries(entries) as unknown as Font;
}

/**
 * PDF 렌더러를 만든다 — 같은 폰트·로케일로 여러 파일을 렌더할 때 재사용한다.
 *
 * @param options - 폰트·로케일 등 렌더링 옵션
 * @returns .slip 파일을 PDF로 렌더하는 렌더러
 * @throws SlipRenderError 폰트 지정이 잘못된 경우(대체 폰트 2개 이상, 이름 중복)
 */
export function createPdfRenderer(options: RenderOptions = {}): SlipPdfRenderer {
  return {
    async renderToPdf(file: SlipFile): Promise<Uint8Array> {
      // 폰트 공급 함수(getFonts)가 있으면 그 결과를 `fonts`보다 우선한다 (ADR-040).
      // 비동기 공급이라 렌더 시점에 해석한다 — core는 함수를 호출만 하고 I/O는 안 한다(ADR-002).
      const fonts = options.getFonts ? await options.getFonts() : options.fonts;
      const font = toEngineFont(fonts);
      // 굵게 폰트 탐색용 정보 — 변환 계층이 `<이름>-Bold` 폰트를 찾을 수 있게 한다 (ADR-032)
      const fontNames = fonts?.map((f) => f.name) ?? [];
      const fallbackFontName = fonts?.find((f) => f.fallback === true)?.name ?? fonts?.[0]?.name;
      const { template, inputs } = convertSlipFile(file, {
        ...(options.locale === undefined ? {} : { locale: options.locale }),
        fontNames,
        ...(fallbackFontName === undefined ? {} : { fallbackFontName }),
        ...(fonts === undefined ? {} : { fonts: fonts as SlipFont[] }),
      });
      return generate({
        template,
        inputs,
        plugins: { text, table, line, rectangle, ellipse, svg, image, ...barcodes },
        ...(font ? { options: { font } } : {}),
      });
    },
  };
}

/**
 * `.slip` 파일 하나를 PDF로 렌더하는 편의 함수.
 *
 * @param file - 렌더할 .slip 파일 (양식 또는 전표)
 * @param options - 폰트·로케일 등 렌더링 옵션
 * @returns PDF 파일 바이트
 * @throws SlipRenderError 폰트 지정 오류·변환 실패 시
 */
export function renderSlipToPdf(file: SlipFile, options?: RenderOptions): Promise<Uint8Array> {
  return createPdfRenderer(options).renderToPdf(file);
}
