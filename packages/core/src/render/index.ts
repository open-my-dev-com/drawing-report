/** 렌더링 인터페이스와 생성 함수를 공개하고 pdfme 구현 타입은 노출하지 않는다. */
export type { RenderOptions, SlipFont, SlipPdfRenderer } from './types.js';
export { SlipRenderError } from './errors.js';
export { resolveConditionalFormats, type ConditionalFormatOverrides } from './conditional.js';
export { createPdfRenderer, renderSlipToPdf } from './pdfme-renderer.js';
export { stackVertically } from './text-layout.js';
