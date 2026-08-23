/**
 * 호스트가 SlipKit 컴포넌트에 자원을 공급하는 인터페이스 (ADR-040).
 *
 * @remarks
 * 렌더 폰트는 호스트가 어디에 두는지(번들·서버 폴더 등) 라이브러리가 정할 수 없어(ADR-002/003),
 * 호스트가 구현하는 공급 인터페이스로 받는다. 값을 돌려받는 pull이라 이벤트보다 메서드가 맞다.
 * 실제 저장 위치는 전적으로 호스트 몫이다.
 */
import type { BarcodeKind, RenderOptions } from '@omdc-slipkit/core';
import { loadDefaultFonts } from './default-fonts.js';
import { normalizeLocale } from './strings.js';

/** 렌더에 쓸 폰트 하나 — `RenderOptions.fonts`의 원소와 같다 */
export type SlipFont = NonNullable<RenderOptions['fonts']>[number];

/**
 * 렌더 폰트를 호스트가 공급하는 인터페이스 — 뷰어·작성폼·디자이너 공용 (ADR-040).
 * 기존 `fonts` 배열 속성을 대체하며, 동기 배열과 비동기(서버 fetch)를 함께 포괄한다.
 */
export interface SlipFontProvider {
  /**
   * 렌더에 쓸 폰트 목록을 돌려준다(동기 배열 또는 Promise).
   *
   * @returns 폰트 목록. 비었거나 주지 않으면 동봉 기본 폰트를 쓴다.
   */
  getFonts?(): SlipFont[] | Promise<SlipFont[]>;
}

/**
 * 디자이너 용지 고르개의 후보 한 개 (ADR-040) — 화면 프리셋이다.
 * `.slip`엔 늘 실제 너비·높이(`paper`)만 담기므로 파일 포맷과 무관하다.
 */
export interface PaperSize {
  /** 고르개에 보일 이름 (예: A4, 라벨 100×150) */
  name: string;
  /** 너비(mm) */
  width: number;
  /** 높이(mm) */
  height: number;
}

/**
 * 디자이너 설정 — 폰트 공급에 용지 목록 공급·저장을 더한다 (ADR-040).
 * 용지 목록 공급은 읽기, 사용자가 직접 입력한 용지 보관은 쓰기다. 셋 다 선택이다.
 */
export interface SlipDesignerSettings extends SlipFontProvider {
  /**
   * 디자이너 바코드 고르개에 보일 종류 목록 — 호스트가 쓰는 것만 남긴다 (ADR-048).
   *
   * @remarks
   * 하부 엔진이 그릴 수 있는 12종을 전부 보이면 대부분의 호스트에 필요 없는 선택지가 늘어난다.
   * 폰트·용지와 같은 방식으로 후보를 좁힌다. 주지 않으면 12종을 모두 보인다.
   *
   * @returns 보일 바코드 종류 목록 (빈 배열이면 12종 전부)
   */
  getBarcodeKinds?(): BarcodeKind[] | Promise<BarcodeKind[]>;
  /**
   * 용지 고르개에 더할 목록을 돌려준다(동봉 4종 뒤에 붙는다).
   *
   * @returns 용지 후보 목록(동기 또는 Promise)
   */
  getPaperSizes?(): PaperSize[] | Promise<PaperSize[]>;
  /**
   * 사용자가 디자이너에서 직접 입력한 용지를 호스트가 보관한다(다음에 `getPaperSizes`로 돌아온다).
   *
   * @param size - 보관할 용지 크기
   */
  savePaperSize?(size: PaperSize): void | Promise<void>;
}

/**
 * 폰트 공급 인터페이스에서 렌더에 쓸 폰트를 해소한다 (ADR-040/042).
 * 호스트가 주면 그 목록을, 비었거나 없으면 언어에 맞는 동봉 기본 폰트를 쓴다.
 *
 * @param provider - 폰트 공급 인터페이스 (없을 수 있음)
 * @param locale - UI 언어. 기본 폰트를 고를 때만 쓴다. 'ja-JP'처럼 지역이 붙어도
 *   언어만 보고 고른다(문구 사전과 같은 규칙, ADR-042).
 * @returns 렌더에 넘길 폰트 목록
 */
export async function resolveFonts(
  provider: SlipFontProvider | undefined,
  locale?: string,
): Promise<SlipFont[]> {
  const supplied = provider?.getFonts ? await provider.getFonts() : undefined;
  return supplied && supplied.length > 0 ? supplied : await loadDefaultFonts(normalizeLocale(locale));
}
