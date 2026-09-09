/**
 * pdfme 기반 PDF 렌더러의 내부 구현입니다.
 *
 * pdfme 의존성은 이 파일과 `convert.ts`에 한정하고, 외부에는 `SlipPdfRenderer`를 노출합니다.
 */
import { generate } from '@pdfme/generator';
import type { Font } from '@pdfme/common';
import { barcodes, ellipse, image, line, rectangle, svg, table, text } from '@pdfme/schemas';
import type { SlipFile } from '../format/schema.js';
import { convertSlipFile } from './convert.js';
import { SlipRenderError } from './errors.js';
import { rm } from './messages.js';
import type { RenderOptions, SlipFont, SlipPdfRenderer } from './types.js';

/** 사용자 폰트를 pdfme 형식으로 변환합니다. */
function toEngineFont(fonts: readonly SlipFont[] | undefined, locale?: string): Font | undefined {
  if (!fonts || fonts.length === 0) return undefined;
  const fallbackCount = fonts.filter((font) => font.fallback === true).length;
  if (fallbackCount > 1) {
    throw new SlipRenderError(rm(locale).multipleFallbackFonts());
  }
  const entries = fonts.map((font, index) => {
    const isFallback = font.fallback === true || (fallbackCount === 0 && index === 0);
    return [font.name, { data: font.data, fallback: isFallback }] as const;
  });
  const names = new Set(entries.map(([name]) => name));
  if (names.size !== entries.length) {
    throw new SlipRenderError(rm(locale).duplicateFontName());
  }
  // pdfme의 폰트 타입에 맞추되 바이트 데이터는 복사하지 않습니다.
  return Object.fromEntries(entries) as unknown as Font;
}

/** 렌더러가 캐시하는 폰트 정보입니다. */
interface ResolvedFonts {
  fonts: readonly SlipFont[] | undefined;
  font: Font | undefined;
  fontNames: string[];
  fallbackFontName: string | undefined;
}

/**
 * 같은 폰트와 로케일로 여러 파일을 처리할 수 있는 PDF 렌더러를 생성합니다.
 *
 * @remarks
 * `getFonts`의 결과는 첫 렌더링에서 확인한 뒤 같은 렌더러에서 재사용합니다.
 * 다른 폰트를 적용하려면 렌더러를 새로 생성합니다.
 *
 * @param options - 폰트·로케일 등 렌더링 옵션
 * @returns `.slip` 파일을 PDF로 렌더링하는 객체입니다. `renderToPdf`는 변환 실패와 PDF 생성 실패를
 *   모두 `SlipRenderError`로 반환합니다.
 * @throws SlipRenderError 대체 폰트를 둘 이상 지정했거나 폰트 이름이 중복된 경우
 */
export function createPdfRenderer(options: RenderOptions = {}): SlipPdfRenderer {
  // 폰트 제공 함수의 결과는 첫 렌더링 이후 같은 렌더러에서 재사용합니다.
  let resolvedFonts: Promise<ResolvedFonts> | undefined;
  const resolveFonts = (): Promise<ResolvedFonts> => {
    if (!resolvedFonts) {
      resolvedFonts = (async () => {
        const fonts = options.getFonts ? await options.getFonts() : undefined;
        const font = toEngineFont(fonts, options.locale);
        // 변환 계층에서 굵기와 기울임에 맞는 폰트 이름을 찾을 때 사용합니다.
        const fontNames = fonts?.map((f) => f.name) ?? [];
        const fallbackFontName = fonts?.find((f) => f.fallback === true)?.name ?? fonts?.[0]?.name;
        return { fonts, font, fontNames, fallbackFontName };
      })();
      // 폰트 조회 실패는 캐시하지 않아 다음 렌더링에서 다시 시도합니다.
      resolvedFonts.catch(() => { resolvedFonts = undefined; });
    }
    return resolvedFonts;
  };
  return {
    async renderToPdf(file: SlipFile): Promise<Uint8Array> {
      const { fonts, font, fontNames, fallbackFontName } = await resolveFonts();
      const { template, inputs } = convertSlipFile(file, {
        ...(options.locale === undefined ? {} : { locale: options.locale }),
        fontNames,
        ...(fallbackFontName === undefined ? {} : { fallbackFontName }),
        ...(fonts === undefined ? {} : { fonts: fonts as SlipFont[] }),
      });
      try {
        return await generate({
          template,
          inputs,
          plugins: { text, table, line, rectangle, ellipse, svg, image, ...barcodes },
          ...(font ? { options: { font } } : {}),
        });
      } catch (error) {
        // 렌더링 엔진과 PDF 라이브러리의 예외는 종류가 제각각이라 하나의 렌더 오류로 바꿔 알립니다.
        if (error instanceof SlipRenderError) throw error;
        throw new SlipRenderError(
          rm(options.locale).pdfGenerationFailed(error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
}

/**
 * `.slip` 파일 하나를 PDF로 렌더링합니다.
 *
 * @param file - 렌더할 `.slip` 파일 (양식 또는 전표)
 * @param options - 폰트·로케일 등 렌더링 옵션
 * @returns PDF 파일 바이트
 * @throws SlipRenderError 폰트 지정 오류·변환 실패·PDF 생성 실패 시
 */
export function renderSlipToPdf(file: SlipFile, options?: RenderOptions): Promise<Uint8Array> {
  return createPdfRenderer(options).renderToPdf(file);
}
