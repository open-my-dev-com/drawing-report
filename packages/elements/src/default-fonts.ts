/**
 * UI 언어에 맞는 기본 폰트를 지연 로딩한다.
 *
 * `settings.getFonts`가 없을 때만 동봉 폰트 모듈을 동적으로 가져오며, 언어별로
 * 한 번 불러온 결과를 재사용한다.
 *
 * 한국어와 영어에는 Pretendard를, 일본어에는 Noto Sans JP를 사용한다. 다른 글자 범위나
 * 굵기가 필요하면 호스트가 `settings.getFonts`로 폰트를 제공한다.
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
 * @param locale - UI 언어. `'ja'`이면 Noto Sans JP, 그 밖에는 Pretendard를 사용한다.
 * @returns PDF 렌더링에 넘길 폰트 등록 목록
 */
export function loadDefaultFonts(locale?: SlipLocale): Promise<FontList> {
  return locale === 'ja' ? loadNotoSansJp() : loadPretendard();
}
