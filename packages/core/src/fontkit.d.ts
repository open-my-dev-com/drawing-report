// fontkit이 타입 정의를 제공하지 않으므로 글자 측정에 필요한 API만 선언합니다.

declare module 'fontkit' {
  interface FontkitGlyph {
    advanceWidth: number;
  }
  interface FontkitLayoutResult {
    glyphs: FontkitGlyph[];
  }
  interface FontkitFont {
    layout(text: string): FontkitLayoutResult;
    hasGlyphForCodePoint(codePoint: number): boolean;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    bbox: { maxY: number; minY: number };
  }
  export function create(buffer: Uint8Array): FontkitFont;
}
