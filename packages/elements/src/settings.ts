/**
 * 호스트가 SlipKit 컴포넌트에 디자이너 전용 정보를 제공하는 인터페이스.
 *
 * @remarks
 * 사용자 폰트와 로케일은 `createSlipKit` 인스턴스(`slipkit` 속성)가 공급하므로 여기서 받지 않는다.
 */
import {
  renderSlipToPdf,
  type BarcodeKind,
  type RenderOptions,
  type SlipFile,
  type SlipFont,
  type SlipKit,
} from '@omdc-slipkit/core';
import { loadDefaultFonts } from './default-fonts.js';
import { normalizeLocale } from './strings.js';

/** core의 렌더링 폰트 타입을 다시 내보낸다. */
export type { SlipFont };

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
 * 바코드 종류와 용지 정보를 제공하는 디자이너 설정.
 */
export interface SlipDesignerSettings {
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
 * SlipKit 인스턴스에 설정된 렌더링 폰트를 가져온다.
 * `getFonts`가 없거나 빈 목록을 반환하면 로케일에 맞는 동봉 기본 폰트를 사용한다.
 *
 * @param slipkit - 공통 설정 인스턴스 (생략 가능)
 * @param locale - 기본 폰트를 선택할 로케일. 지역 코드가 포함되면 언어 코드만 사용한다
 * @returns 렌더에 넘길 폰트 목록
 */
export async function resolveFonts(
  slipkit: SlipKit | undefined,
  locale?: string,
): Promise<readonly SlipFont[]> {
  const supplied = slipkit?.getFonts ? await slipkit.getFonts() : undefined;
  return supplied && supplied.length > 0 ? supplied : await loadDefaultFonts(normalizeLocale(locale));
}

/**
 * `.slip` 파일을 컴포넌트 미리보기용 PDF로 렌더링한다.
 * 사용자 폰트를 실제로 제공한 SlipKit 인스턴스는 해당 인스턴스로 렌더링한다.
 * `getFonts`가 없거나 빈 목록을 반환하면 렌더 로케일에 맞는 동봉 기본 폰트를 사용한다 —
 * 디자이너 캔버스도 같은 기준을 쓰므로 화면과 출력의 폰트가 어긋나지 않는다.
 *
 * @param slipkit - 공통 설정 인스턴스 (생략 가능)
 * @param file - 렌더할 `.slip` 파일
 * @param locale - 인스턴스가 없을 때 동봉 기본 폰트와 렌더 메시지에 사용할 로케일
 * @returns PDF 파일 바이트
 */
export async function renderSlip(
  slipkit: SlipKit | undefined,
  file: SlipFile,
  locale?: string,
): Promise<Uint8Array> {
  const supplied = slipkit?.getFonts ? await slipkit.getFonts() : undefined;
  if (supplied !== undefined && supplied.length > 0) return slipkit!.render(file);
  const renderLocale = slipkit?.locale ?? locale;
  const options: RenderOptions = {
    getFonts: () => resolveFonts(undefined, renderLocale),
    ...(renderLocale === undefined ? {} : { locale: renderLocale }),
  };
  return renderSlipToPdf(file, options);
}
