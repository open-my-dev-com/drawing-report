/**
 * PDF 렌더러 공개 인터페이스 (ADR-016).
 *
 * 이 파일에는 **pdfme 타입·API가 한 줄도 들어오면 안 된다.** 하부 엔진(pdfme)은
 * `pdfme-renderer.ts` 뒤에 숨기고, 호스트에는 이 인터페이스만 노출한다 —
 * 최악의 경우 자체 렌더러로 갈아끼울 수 있는 구조를 유지하기 위함이다.
 */
import type { SlipFile } from '../format/schema.js';

/** 등록 폰트 하나 */
export interface SlipFont {
  /** 폰트 이름 — 요소의 `fontName`이 이 이름을 가리킨다 */
  name: string;
  /** 폰트 파일 바이트 (ttf·otf) */
  data: Uint8Array;
  /** 대체 폰트로 쓸지 — 하나만 지정할 수 있다 */
  fallback?: boolean;
}

/** PDF 렌더링 옵션 */
export interface RenderOptions {
  /**
   * 사용자 폰트 등록. 한글 등 CJK 문서는 폰트를 반드시 등록해야 한다 (ADR-012).
   * `fallback: true`인 폰트는 하나만 지정할 수 있으며, 아무것도 지정하지 않으면
   * 첫 번째 폰트를 대체 폰트로 쓴다. 생략하면 하부 엔진의 기본 폰트를 쓴다.
   */
  fonts?: SlipFont[];
  /**
   * 폰트를 **당겨 오는 공급 함수** (선택, ADR-040) — 서버 폴더·네트워크 등에서 비동기로
   * 받아야 할 때 쓴다. 주면 렌더 시 호출해 그 결과를 `fonts`보다 우선해 쓴다. core는 이 함수를
   * 호출(await)만 할 뿐 I/O를 직접 하지 않는다(ADR-002).
   */
  getFonts?: () => readonly SlipFont[] | Promise<readonly SlipFont[]>;
  /**
   * FORMAT_NUMBER 등 수식 포맷 함수의 로케일 (BCP-47) — ADR-013.
   * 예: 'de-DE'를 지정하면 1234.5가 "1.234,5"로 표기된다.
   *
   * @defaultValue `'ko-KR'`
   */
  locale?: string;
}

/** PDF 렌더러 — createPdfRenderer로 만든다 */
export interface SlipPdfRenderer {
  /**
   * `.slip` 파일을 PDF 바이트로 렌더한다.
   * - `kind: 'template'` — 값이 비어 있는 빈 양식으로 렌더
   * - `kind: 'voucher'` — `templateSnapshot` + `values`로 렌더 (ADR-008)
   *
   * @param file - 렌더할 .slip 파일
   * @returns PDF 파일 바이트
   */
  renderToPdf(file: SlipFile): Promise<Uint8Array>;
}
