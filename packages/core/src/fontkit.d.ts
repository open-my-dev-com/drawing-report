// fontkit 최소 타입 선언 — 패키지가 타입 정의를 동봉하지 않는다(v2).
// 글자 재기(render/measure.ts)에 쓰는 지표·layout만 선언한다.

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
