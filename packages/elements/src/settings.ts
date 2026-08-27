/**
 * 호스트가 SlipKit 컴포넌트에 폰트와 용지 정보를 제공하는 인터페이스.
 *
 * @remarks
 * 폰트의 저장 위치와 로딩 방식은 호스트가 결정하므로 메서드를 통해 전달받는다.
 */
import type { BarcodeKind, SlipFont } from '@omdc-slipkit/core';
import { loadDefaultFonts } from './default-fonts.js';
import { normalizeLocale } from './strings.js';

/** core의 렌더링 폰트 타입을 다시 내보낸다. */
export type { SlipFont };

/**
 * 뷰어, 작성 폼, 디자이너에 렌더링 폰트를 제공하는 인터페이스.
 */
export interface SlipFontProvider {
  /**
   * 렌더링에 사용할 폰트 목록을 반환한다.
   *
   * @returns 폰트 목록 또는 폰트 목록을 반환하는 Promise
   */
  getFonts?(): SlipFont[] | Promise<SlipFont[]>;
}

/**
 * 디자이너의 용지 선택 목록에 표시할 크기 정보.
 */
export interface PaperSize {
  /** 용지 선택기에 표시할 이름. 예: A4, 라벨 100×150. */
  name: string;
  /** 너비(mm) */
  width: number;
  /** 높이(mm) */
  height: number;
}

/**
 * 폰트와 용지 정보를 제공하는 디자이너 설정.
 */
export interface SlipDesignerSettings extends SlipFontProvider {
  /**
   * 디자이너에 표시할 바코드 종류를 반환한다.
   *
   * @remarks
   * 생략하거나 빈 배열을 반환하면 지원하는 바코드 종류를 모두 표시한다.
   *
   * @returns 표시할 바코드 종류 목록. 빈 배열이면 지원하는 종류를 모두 표시한다
   */
  getBarcodeKinds?(): BarcodeKind[] | Promise<BarcodeKind[]>;
  /**
   * 기본 용지 뒤에 추가할 용지 목록을 반환한다.
   *
   * @returns 용지 후보 목록(동기 또는 Promise)
   */
  getPaperSizes?(): PaperSize[] | Promise<PaperSize[]>;
  /**
   * 디자이너에서 직접 입력한 용지 크기를 저장한다.
   *
   * @param size - 보관할 용지 크기
   */
  savePaperSize?(size: PaperSize): void | Promise<void>;
}

/**
 * 호스트가 제공한 렌더링 폰트를 가져온다.
 * 제공된 폰트가 없으면 로케일에 맞는 기본 폰트를 사용한다.
 *
 * @param provider - 폰트 공급 인터페이스
 * @param locale - 기본 폰트를 선택할 UI 언어. 지역 코드가 포함되면 언어 코드만 사용한다
 * @returns 렌더에 넘길 폰트 목록
 */
export async function resolveFonts(
  provider: SlipFontProvider | undefined,
  locale?: string,
): Promise<SlipFont[]> {
  const supplied = provider?.getFonts ? await provider.getFonts() : undefined;
  return supplied && supplied.length > 0 ? supplied : await loadDefaultFonts(normalizeLocale(locale));
}
