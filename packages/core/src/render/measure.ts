/**
 * 그리드 셀의 줄바꿈 위치와 표시 가능한 줄 수를 계산한다.
 *
 * 셀 높이에 들어가는 줄 수를 렌더링 전에 계산한다. 폭, 높이, 줄바꿈에는 PDF 렌더러와
 * 같은 계산 규칙을 적용한다.
 *
 * - `Intl.Segmenter`로 단어를 구분하며, 셀보다 긴 단어만 글자 단위로 나눈다.
 * - 글자 폭은 폰트의 advance width와 자간으로 계산한다.
 * - 첫 줄 높이는 폰트의 ascent를 사용하고, 다음 줄부터는 `줄간격 x 글자 크기`를 사용한다.
 *
 * 계산한 줄은 `\n`으로 연결해 렌더링 엔진에 전달한다.
 */
import * as fontkit from 'fontkit';
import type { SlipFont } from './types.js';

/** pt → mm */
const PT_TO_MM = 25.4 / 72;

/** 글자 크기 계산에 필요한 fontkit 폰트 정보 */
interface FontMetrics {
  layout(text: string): { glyphs: { advanceWidth: number }[] };
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: { maxY: number; minY: number };
}

/** 셀의 글자 크기 계산에 필요한 스타일 */
export interface MeasureStyle {
  /** 글꼴 이름 (미지정이면 대체 폰트) */
  fontName?: string | undefined;
  /** 글자 크기(pt) */
  fontSize: number;
  /** 자간(pt) */
  characterSpacing?: number | undefined;
  /** 줄간격 배수 */
  lineHeight?: number | undefined;
}

let wordSegmenter: Intl.Segmenter | undefined;

function segmentWords(line: string): string[] {
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  return [...wordSegmenter.segment(line)].map((s) => s.segment);
}

/**
 * 렌더링 폰트로 글자 폭과 줄 수를 계산한다.
 *
 * 사용할 수 있는 폰트가 없으면 계산 메서드는 `undefined`를 반환한다. 호출자는 이 경우
 * 원문을 자르지 않고 렌더링한다.
 */
export class TextMeasurer {
  private readonly fonts = new Map<string, FontMetrics | null>();
  private readonly fallbackName: string | undefined;
  private readonly sources = new Map<string, Uint8Array>();

  /**
   * @param fonts - 렌더 옵션에 등록된 폰트 목록. 비어 있으면 측정하지 않는다
   */
  constructor(fonts: readonly SlipFont[] = []) {
    for (const font of fonts) this.sources.set(font.name, font.data);
    this.fallbackName = fonts.find((f) => f.fallback === true)?.name ?? fonts[0]?.name;
  }

  private metrics(fontName: string | undefined): FontMetrics | undefined {
    const name = fontName !== undefined && this.sources.has(fontName) ? fontName : this.fallbackName;
    if (name === undefined) return undefined;
    const cached = this.fonts.get(name);
    if (cached !== undefined) return cached ?? undefined;
    const data = this.sources.get(name);
    if (data === undefined) {
      this.fonts.set(name, null);
      return undefined;
    }
    let opened: FontMetrics | null = null;
    try {
      // fontkit이 폰트를 읽지 못하면 해당 폰트의 크기 계산을 건너뛴다.
      opened = fontkit.create(data) as unknown as FontMetrics;
    } catch {
      opened = null;
    }
    this.fonts.set(name, opened);
    return opened ?? undefined;
  }

  private widthPt(text: string, metrics: FontMetrics, style: MeasureStyle): number {
    const scale = 1000 / metrics.unitsPerEm;
    const { glyphs } = metrics.layout(text);
    const advance = glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth * scale, 0);
    const spacing = Math.max(text.length - 1, 0) * (style.characterSpacing ?? 0);
    return (advance * style.fontSize) / 1000 + spacing;
  }

  /** 렌더링 엔진과 같은 ascent 기준으로 첫 줄 높이를 계산한다. */
  private firstLineHeightMm(metrics: FontMetrics, fontSize: number): number {
    const scale = 1000 / metrics.unitsPerEm;
    const ascent = (metrics.ascent || metrics.bbox.maxY) * scale;
    const descent = (metrics.descent || metrics.bbox.minY) * scale;
    const heightPt = ((ascent - descent - Math.abs(descent)) / 1000) * fontSize;
    return heightPt * PT_TO_MM;
  }

  /**
   * 셀 폭에 맞춰 줄을 나눈다.
   *
   * @param text - 나눌 글
   * @param widthMm - 글을 담을 폭(mm, 안쪽 여백을 뺀 값)
   * @param style - 글꼴·크기·자간
   * @returns 줄 목록. 잴 수 없으면 `undefined`
   */
  splitLines(text: string, widthMm: number, style: MeasureStyle): string[] | undefined {
    const metrics = this.metrics(style.fontName);
    if (!metrics) return undefined;
    const boxWidthPt = Math.max(widthMm / PT_TO_MM, 0.1);
    const lines: string[] = [];
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      if (rawLine.trim() === '') {
        lines.push('');
        continue;
      }
      let current = '';
      let currentWidth = 0;
      const push = (): void => {
        lines.push(current.trimEnd());
        current = '';
        currentWidth = 0;
      };
      for (const segment of segmentWords(rawLine.trimEnd())) {
        const segmentWidth = this.widthPt(segment, metrics, style);
        if (currentWidth + segmentWidth <= boxWidthPt) {
          current += segment;
          currentWidth += segmentWidth;
        } else if (segment.trim() === '') {
          push();
        } else if (segmentWidth <= boxWidthPt) {
          if (current !== '') push();
          current = segment;
          currentWidth = segmentWidth;
        } else {
          // 셀보다 긴 단어만 글자 단위로 나눈다.
          for (const char of segment) {
            const charWidth = this.widthPt(char, metrics, style);
            if (currentWidth + charWidth > boxWidthPt && current !== '') push();
            current += char;
            currentWidth += charWidth;
          }
        }
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }

  /**
   * 주어진 높이에 들어가는 줄 수.
   *
   * @param heightMm - 글을 담을 높이(mm, 안쪽 여백을 뺀 값)
   * @param style - 글꼴·크기·줄간격
   * @returns 들어가는 줄 수(최소 1). 잴 수 없으면 `undefined`
   */
  fittingLineCount(heightMm: number, style: MeasureStyle): number | undefined {
    const metrics = this.metrics(style.fontName);
    if (!metrics) return undefined;
    const firstLine = this.firstLineHeightMm(metrics, style.fontSize);
    if (heightMm < firstLine) return 1;
    const pitch = (style.lineHeight ?? 1) * style.fontSize * PT_TO_MM;
    if (pitch <= 0) return 1;
    return Math.max(1, Math.floor((heightMm - firstLine) / pitch) + 1);
  }
}
