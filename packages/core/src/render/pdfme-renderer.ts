/**
 * pdfme 기반 렌더러 구현 (내부 전용, ADR-016).
 *
 * pdfme 의존은 이 파일과 convert.ts 안에만 존재한다 — 공개 API는 `types.ts`의
 * `SlipPdfRenderer`뿐이라 하부 엔진을 갈아끼워도 호스트 코드는 그대로다.
 */
import { generate } from '@pdfme/generator';
import type { Font } from '@pdfme/common';
import { image, line, rectangle, table, text } from '@pdfme/schemas';
import type { SlipFile } from '../format/schema.js';
import { convertSlipFile } from './convert.js';
import { SlipRenderError } from './errors.js';
import type { RenderOptions, SlipPdfRenderer } from './types.js';

/** 사용자 폰트를 하부 엔진 형식으로 옮긴다. 없으면 undefined(엔진 기본 폰트). */
function toEngineFont(fonts: RenderOptions['fonts']): Font | undefined {
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
 * @throws SlipRenderError 폰트 지정이 잘못된 경우(대체 폰트 2개 이상, 이름 중복)
 */
export function createPdfRenderer(options: RenderOptions = {}): SlipPdfRenderer {
  const font = toEngineFont(options.fonts);
  return {
    async renderToPdf(file: SlipFile): Promise<Uint8Array> {
      const { template, inputs } = convertSlipFile(
        file,
        options.locale === undefined ? undefined : { locale: options.locale },
      );
      return generate({
        template,
        inputs,
        plugins: { text, table, line, rectangle, image },
        ...(font ? { options: { font } } : {}),
      });
    },
  };
}

/** `.slip` 파일 하나를 PDF 바이트로 렌더하는 편의 함수 */
export function renderSlipToPdf(file: SlipFile, options?: RenderOptions): Promise<Uint8Array> {
  return createPdfRenderer(options).renderToPdf(file);
}
