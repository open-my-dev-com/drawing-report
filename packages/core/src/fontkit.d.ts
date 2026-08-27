// 타입 정의를 제공하지 않는 fontkit에서 글자 측정에 필요한 API만 선언한다.

declare module 'fontkit' {
  interface FontkitGlyph {
    advanceWidth: number;
  }
  interface FontkitLayoutResult {
    glyphs: FontkitGlyph[];
  }
  interface FontkitFont {
    layout(text: string): FontkitLayoutResult;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    bbox: { maxY: number; minY: number };
  }
  export function create(buffer: Uint8Array): FontkitFont;
}
