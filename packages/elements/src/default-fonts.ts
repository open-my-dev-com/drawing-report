/**
 * 기본 폰트 지연 로딩 (ADR-012/031/042).
 *
 * 컴포넌트가 `settings.getFonts` 없이 PDF를 만들 때만 동봉 폰트 모듈(각 약 3MB)을
 * 동적 import한다 — 번들러가 별도 청크로 분리해, 사용자 폰트를 쓰거나 해당 언어를
 * 쓰지 않는 호스트는 내려받지 않는다. 언어별로 한 번 불러오면 재사용한다.
 *
 * 언어에 따라 기본 폰트가 다르다 — 한국어·영어는 Pretendard(한글+라틴), 일본어는
 * Noto Sans JP(가나+한자)이다. 언어마다 기본 하나는 있게 하되(ADR-042) 더 넓은 범위·
 * 굵기는 호스트가 `settings.getFonts`로 공급한다(ADR-040).
 */
import type { SlipFont } from '@omdc-slipkit/core';
import type { SlipLocale } from './strings.js';

type FontList = SlipFont[];

const cache = new Map<'ko' | 'ja', Promise<FontList>>();

function loadPretendard(): Promise<FontList> {
  let p = cache.get('ko');
  if (!p) {
    p = import('./fonts/pretendard.js').then((m) => m.PRETENDARD_FONTS);
    cache.set('ko', p);
  }
  return p;
}

function loadNotoSansJp(): Promise<FontList> {
  let p = cache.get('ja');
  if (!p) {
    p = import('./fonts/noto-sans-jp.js').then((m) => m.NOTO_SANS_JP_FONTS);
    cache.set('ja', p);
  }
  return p;
}

/**
 * 언어에 맞는 동봉 기본 폰트를 불러온다.
 *
 * @param locale - UI 언어. `'ja'`면 Noto Sans JP, 그 밖(한국어·영어)은 Pretendard.
 * @returns PDF 렌더링에 넘길 폰트 등록 목록
 */
export function loadDefaultFonts(locale?: SlipLocale): Promise<FontList> {
  return locale === 'ja' ? loadNotoSansJp() : loadPretendard();
}
