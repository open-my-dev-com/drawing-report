/**
 * 렌더링 계층 진입점. 밖으로 나가는 것은 인터페이스와 생성 함수뿐이며
 * pdfme 타입은 이 경계를 넘지 않는다 (ADR-016).
 */
export type { RenderOptions, SlipFont, SlipPdfRenderer } from './types.js';
export { SlipRenderError } from './errors.js';
export { createPdfRenderer, renderSlipToPdf } from './pdfme-renderer.js';
export { stackVertically } from './text-layout.js';
