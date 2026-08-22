/**
 * 글자 재기 — 칸 안에서 줄이 바뀌는 자리와 줄 높이를 구한다 (ADR-037).
 *
 * 그리드의 칸은 높이가 정해져 있어, 칸을 넘치는 글을 잘라내려면 **몇 줄이 들어가는지**를
 * 그리기 전에 알아야 한다. 하부 엔진의 계산 규칙과 어긋나면 화면과 PDF가 달라지므로
 * (ADR-012), 폭·높이 계산과 줄 나누기를 엔진과 같은 규칙으로 맞춘다:
 *
 * - 낱말 나누기는 `Intl.Segmenter`(granularity `word`) — 낱말 중간에서 끊지 않고,
 *   낱말 하나가 칸보다 길 때만 글자 단위로 쪼갠다.
 * - 글자 폭은 폰트의 advance width 합 + 자간.
 * - 첫 줄 높이는 폰트의 ascent 기준, 둘째 줄부터는 `줄간격 x 글자 크기`.
 *
 * 미리 줄을 나눠 `\n`으로 이어 넘기면 엔진은 그 줄을 그대로 그린다(줄바꿈 문자를 먼저
 * 자르고 각 줄을 폭에 맞춰 나누므로, 이미 폭에 맞는 줄은 다시 나뉘지 않는다).
 */
import * as fontkit from 'fontkit';
import type { SlipFont } from './types.js';

/** pt → mm */
const PT_TO_MM = 25.4 / 72;

/** 재기에 쓰는 폰트 지표 — fontkit이 연 폰트에서 필요한 값만 뽑아 둔다 */
interface FontMetrics {
  layout(text: string): { glyphs: { advanceWidth: number }[] };
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: { maxY: number; minY: number };
}

/** 한 칸의 글자 모양 — 재기에 필요한 값만 */
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
 * 글자 재기 도구 — 렌더 옵션의 폰트로 만든다.
 *
 * 폰트를 못 얻으면(호스트가 폰트를 주지 않은 경우) 재기를 포기하고 `undefined`를 돌려주는
 * 메서드를 갖는다. 그때 호출 쪽은 자르지 않고 그대로 그린다 — 잘못 자르는 것보다 낫다.
 */
export class TextMeasurer {
  private readonly fonts = new Map<string, FontMetrics | null>();
  private readonly fallbackName: string | undefined;
  private readonly sources = new Map<string, Uint8Array>();

  /**
   * @param fonts - 렌더 옵션에 등록된 폰트 목록. 비우면 재기를 하지 않는다
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
      // fontkit은 Buffer 계열을 받는다 — 폰트가 깨져 있으면 재기를 포기한다
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

  /** 첫 줄 높이(mm) — 폰트 ascent 기준 (하부 엔진과 같은 규칙) */
  private firstLineHeightMm(metrics: FontMetrics, fontSize: number): number {
    const scale = 1000 / metrics.unitsPerEm;
    const ascent = (metrics.ascent || metrics.bbox.maxY) * scale;
    const descent = (metrics.descent || metrics.bbox.minY) * scale;
    const heightPt = ((ascent - descent - Math.abs(descent)) / 1000) * fontSize;
    return heightPt * PT_TO_MM;
  }

  /**
   * 칸 폭에 맞춰 줄을 나눈다.
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
          // 낱말 하나가 칸보다 길다 — 이때만 글자 단위로 쪼갠다
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
