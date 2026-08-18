/**
 * PDF 렌더러 공개 인터페이스 (ADR-016).
 *
 * 이 파일에는 **pdfme 타입·API가 한 줄도 들어오면 안 된다.** 하부 엔진(pdfme)은
 * `pdfme-renderer.ts` 뒤에 숨기고, 호스트에는 이 인터페이스만 노출한다 —
 * 최악의 경우 자체 렌더러로 갈아끼울 수 있는 구조를 유지하기 위함이다.
 */
import type { SlipFile } from '../format/schema.js';

export interface RenderOptions {
  /**
   * 사용자 폰트 등록. 한글 등 CJK 문서는 폰트를 반드시 등록해야 한다 (ADR-012).
   * `fallback: true`인 폰트는 하나만 지정할 수 있으며, 아무것도 지정하지 않으면
   * 첫 번째 폰트를 대체 폰트로 쓴다. 생략하면 하부 엔진의 기본 폰트를 쓴다.
   */
  fonts?: { name: string; data: Uint8Array; fallback?: boolean }[];
}

export interface SlipPdfRenderer {
  /**
   * `.slip` 파일을 PDF 바이트로 렌더한다.
   * - `kind: 'template'` — 값이 비어 있는 빈 양식으로 렌더
   * - `kind: 'voucher'` — `templateSnapshot` + `values`로 렌더 (ADR-008)
   */
  renderToPdf(file: SlipFile): Promise<Uint8Array>;
}
