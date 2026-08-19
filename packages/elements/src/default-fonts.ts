/**
 * 기본 폰트 지연 로딩 (ADR-012/031).
 *
 * 컴포넌트가 `fonts` 미지정으로 PDF를 만들 때만 동봉 Pretendard 모듈(약 3MB)을
 * 동적 import한다 — 번들러가 별도 청크로 분리해, 사용자 폰트를 쓰는 호스트는
 * 내려받지 않는다. 한 번 불러오면 재사용한다.
 */
import type { RenderOptions } from '@omdc-slipkit/core';

let cached: Promise<NonNullable<RenderOptions['fonts']>> | null = null;

/**
 * 동봉 기본 폰트(Pretendard Regular·Bold)를 불러온다.
 *
 * @returns PDF 렌더링에 넘길 폰트 등록 목록
 */
export function loadDefaultFonts(): Promise<NonNullable<RenderOptions['fonts']>> {
  cached ??= import('./fonts/pretendard.js').then((m) => m.PRETENDARD_FONTS);
  return cached;
}
