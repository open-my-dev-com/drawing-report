/**
 * 동봉 기본 폰트를 지연 로딩한다.
 *
 * `settings.getFonts`가 없을 때 사용하며, 언어별로 한 번 만든 목록을 재사용한다.
 *
 * Pretendard(한국어·영어)와 Noto Sans JP(일본어)를 항상 함께 등록해, 어떤 언어 설정에서도
 * `fontName`으로 다른 언어의 폰트를 지정할 수 있다. 언어는 폰트 사용 가능 여부가 아니라
 * `fontName`을 지정하지 않은 요소에 적용되는 대체(fallback) 폰트만 결정한다.
 * 다른 글자 범위나 굵기가 필요하면 호스트가 `settings.getFonts`로 폰트를 제공한다.
 */
import type { SlipFont } from '@omdc-slipkit/core';
import type { SlipLocale } from './strings.js';

type FontList = SlipFont[];

const cache = new Map<'ko' | 'ja', Promise<FontList>>();

/** 대체(fallback) 표시를 지정한 이름에만 남긴 사본 목록을 만든다. */
function withFallbackOn(fonts: readonly SlipFont[], fallbackName: string): FontList {
  return fonts.map((font) => ({
    name: font.name,
    data: font.data,
    ...(font.name === fallbackName ? { fallback: true } : {}),
  }));
}

/**
 * 동봉 기본 폰트 목록을 불러온다. Pretendard와 Noto Sans JP를 모두 포함한다.
 *
 * @param locale - UI 언어. `'ja'`이면 Noto Sans JP, 그 밖에는 Pretendard가 대체 폰트가 된다
 * @returns PDF 렌더링에 넘길 폰트 등록 목록
 */
export function loadDefaultFonts(locale?: SlipLocale): Promise<FontList> {
  const key = locale === 'ja' ? 'ja' : 'ko';
  let loading = cache.get(key);
  if (!loading) {
    loading = Promise.all([import('./fonts/pretendard.js'), import('./fonts/noto-sans-jp.js')]).then(
      ([pretendard, notoSansJp]) => {
        const fallbackName = key === 'ja' ? 'Noto Sans JP' : 'Pretendard';
        return [
          ...withFallbackOn(pretendard.PRETENDARD_FONTS, fallbackName),
          ...withFallbackOn(notoSansJp.NOTO_SANS_JP_FONTS, fallbackName),
        ];
      },
    );
    cache.set(key, loading);
  }
  return loading;
}
