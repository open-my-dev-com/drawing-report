/**
 * PDF 렌더러의 공개 인터페이스를 정의합니다.
 *
 * pdfme 타입과 API는 `pdfme-renderer.ts` 내부에서만 사용하며, 외부에는 이 인터페이스를 노출합니다.
 */
import type { SlipFile } from '../format/schema.js';

/** 등록 폰트 하나입니다. */
export interface SlipFont {
  /** 요소의 `fontName`에서 참조하는 폰트 이름입니다. */
  name: string;
  /** 폰트 파일 바이트 (ttf·otf)입니다. */
  data: Uint8Array;
  /** 대체 폰트 여부. 하나만 지정할 수 있습니다. */
  fallback?: boolean;
}

/** PDF 렌더링 옵션입니다. */
export interface RenderOptions {
  /**
   * 렌더링에 사용할 폰트를 반환하는 함수. 서버나 네트워크에서 비동기로 불러올 수 있습니다.
   * CJK 문서를 렌더링하려면 해당 글자를 포함한 폰트를 제공해야 합니다.
   * `fallback: true`인 폰트는 하나만 지정할 수 있으며, 지정하지 않으면 첫 번째 폰트를 사용합니다.
   *
   * @remarks
   * {@link createSlipKit} 또는 {@link createPdfRenderer}를 생성할 때 지정합니다.
   */
  getFonts?: () => readonly SlipFont[] | Promise<readonly SlipFont[]>;
  /**
   * `FORMAT_NUMBER` 등 형식 함수와 오류 메시지 언어에 사용할 BCP 47 로케일.
   * 예: 'de-DE'를 지정하면 1234.5가 "1.234,5"로 표기됩니다.
   *
   * @defaultValue `'en-US'`
   */
  locale?: string;
}

/** {@link createPdfRenderer}가 반환하는 PDF 렌더러입니다. */
export interface SlipPdfRenderer {
  /**
   * `.slip` 파일을 PDF 바이트로 렌더링합니다.
   * - `kind: 'template'`: 값이 없는 양식으로 렌더링합니다.
   * - `kind: 'voucher'`: `templateSnapshot`과 `values`를 렌더링합니다.
   *
   * @param file - 렌더할 `.slip` 파일
   * @returns PDF 파일 바이트
   */
  renderToPdf(file: SlipFile): Promise<Uint8Array>;
}
