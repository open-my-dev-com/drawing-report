/**
 * 그리드 셀의 줄바꿈 위치와 표시 가능한 줄 수를 계산한다.
 *
 * 셀 높이에 들어가는 줄 수를 렌더링 전에 계산한다. 폭, 높이, 줄바꿈에는 PDF 렌더러와
 * 같은 계산 규칙을 적용한다.
 *
 * - `Intl.Segmenter`로 단어를 구분하며, 셀보다 긴 단어만 글자 단위로 나눈다.
 * - 글자 폭은 폰트의 advance width와 자간으로 계산하고, 조각을 이을 때마다 자간을 한 번 더 더한다.
 * - 일본어 글자가 있으면 행두·행말 금칙 문자를 앞뒤 줄로 옮긴다.
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
  hasGlyphForCodePoint(codePoint: number): boolean;
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

/** 줄 첫머리에 올 수 없는 문자 (일본어 행두 금칙) */
const LINE_START_FORBIDDEN = new Set([
  '、', '。', ',', '.', '」', '』', ')', '}', '】', '>', '≫', ']', '・', 'ー', '―', '-', '!', '！',
  '?', '？', ':', '：', ';', '；', '/', '／', 'ゝ', '々', '〃', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'っ',
  'ゃ', 'ゅ', 'ょ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ッ', 'ャ', 'ュ', 'ョ',
]);

/** 줄 끝에 올 수 없는 문자 (일본어 행말 금칙) */
const LINE_END_FORBIDDEN = new Set([
  '「', '『', '（', '｛', '【', '＜', '≪', '［', '〘', '〖', '〝', '‘', '“', '｟', '«',
]);

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/** 행두 금칙 문자를 앞 줄 끝으로 옮긴다. 뒤 줄부터 거슬러 처리한다. */
function moveLineStartForbidden(lines: readonly string[]): string[] {
  const filtered: string[] = [];
  let carry: string | null = null;
  for (const line of [...lines].reverse()) {
    if (line.trim().length === 0) {
      filtered.push('');
      continue;
    }
    const first = line.charAt(0);
    if (LINE_START_FORBIDDEN.has(first)) {
      if (line.trim().length === 1) {
        filtered.push(line);
        carry = null;
      } else {
        filtered.push(carry ? line.slice(1) + carry : line.slice(1));
        carry = first;
      }
    } else if (carry) {
      filtered.push(line + carry);
      carry = null;
    } else {
      filtered.push(line);
    }
  }
  if (carry) {
    const first = filtered[0] ?? '';
    return [carry + first, ...filtered.slice(1)].reverse();
  }
  return filtered.reverse();
}

/** 행말 금칙 문자를 다음 줄 첫머리로 옮긴다. */
function moveLineEndForbidden(lines: readonly string[]): string[] {
  const filtered: string[] = [];
  let carry: string | null = null;
  for (const line of lines) {
    if (line.trim().length === 0) {
      filtered.push('');
      continue;
    }
    const last = line.slice(-1);
    if (LINE_END_FORBIDDEN.has(last)) {
      if (line.trim().length === 1) {
        filtered.push(line);
        carry = null;
      } else {
        filtered.push(carry ? carry + line.slice(0, -1) : line.slice(0, -1));
        carry = last;
      }
    } else if (carry) {
      filtered.push(carry + line);
      carry = null;
    } else {
      filtered.push(line);
    }
  }
  if (carry) {
    const last = filtered[filtered.length - 1] ?? '';
    return [...filtered.slice(0, -1), last + carry];
  }
  return filtered;
}

/** 글리프 검사에서 제외하는 제어·서식 문자 (줄바꿈·탭·제로폭 문자) */
const GLYPH_CHECK_EXEMPT = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/** 글리프가 없어도 표시에 영향이 없는 변형 선택자(U+FE00–FE0F, U+E0100–E01EF)인지 확인한다. */
function isVariationSelector(codePoint: number): boolean {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
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
    // 렌더링 엔진과 같이 글자 사이마다 자간을 더한다 (한 글자면 0, 빈 문자열이면 음수).
    const spacing = (text.length - 1) * (style.characterSpacing ?? 0);
    return (advance * style.fontSize) / 1000 + spacing;
  }

  /**
   * 한 문단을 폭에 맞춰 줄로 나눈다. 조각을 이을 때마다 자간을 한 번 더 누적하는 규칙과
   * 일본어 금칙 처리까지 렌더링 엔진의 계산을 그대로 따른다.
   */
  private splitParagraph(paragraph: string, boxWidthPt: number, metrics: FontMetrics, style: MeasureStyle): string[] {
    if (paragraph.trim() === '') return [''];
    const spacing = style.characterSpacing ?? 0;
    const lines: (string | undefined)[] = [];
    let index = 0;
    let current = 0;
    const append = (piece: string, width: number): void => {
      const head = lines[index];
      if (head) {
        lines[index] = head + piece;
        current += width + spacing;
      } else {
        lines[index] = piece;
        current = width + spacing;
      }
    };
    for (const segment of segmentWords(paragraph.trimEnd())) {
      const segmentWidth = this.widthPt(segment, metrics, style);
      if (current + segmentWidth <= boxWidthPt) {
        append(segment, segmentWidth);
      } else if (segment.trim() === '') {
        lines[++index] = '';
        current = 0;
      } else if (segmentWidth <= boxWidthPt) {
        lines[++index] = segment;
        current = segmentWidth + spacing;
      } else {
        // 셀보다 긴 단어만 글자 단위로 나눈다.
        for (const char of segment) {
          const charWidth = this.widthPt(char, metrics, style);
          if (current + charWidth <= boxWidthPt) {
            append(char, charWidth);
          } else {
            lines[++index] = char;
            current = charWidth + spacing;
          }
        }
      }
    }
    const filled = lines.map((line) => line ?? '');
    const adjusted = filled.some((line) => JAPANESE.test(line))
      ? moveLineEndForbidden(moveLineStartForbidden(filled))
      : filled;
    return adjusted.map((line) => line.trimEnd());
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
    for (const paragraph of text.split(/\r\n|\r|\n|\f|\v/)) {
      lines.push(...this.splitParagraph(paragraph, boxWidthPt, metrics, style));
    }
    return lines;
  }

  /**
   * 글에 폰트가 그릴 수 없는 문자가 있는지 찾는다. 줄바꿈·탭·제로폭 문자는 검사하지 않는다.
   *
   * @param text - 렌더할 글
   * @param fontName - 렌더에 쓸 폰트 이름 (미지정이면 대체 폰트)
   * @returns 글리프가 없는 첫 문자와 검사한 폰트 이름. 모두 그릴 수 있거나 잴 폰트가 없으면 `undefined`
   */
  missingGlyph(text: string, fontName: string | undefined): { char: string; fontName: string } | undefined {
    const name = fontName !== undefined && this.sources.has(fontName) ? fontName : this.fallbackName;
    const metrics = this.metrics(fontName);
    if (!metrics || name === undefined) return undefined;
    for (const char of text) {
      const codePoint = char.codePointAt(0)!;
      if (GLYPH_CHECK_EXEMPT.has(codePoint) || isVariationSelector(codePoint)) continue;
      if (!metrics.hasGlyphForCodePoint(codePoint)) return { char, fontName: name };
    }
    return undefined;
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
