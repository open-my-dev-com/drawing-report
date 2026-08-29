/**
 * 동봉된 Pretendard와 Noto Sans JP를 지연 로딩한다.
 *
 * `slipkit.getFonts`가 없을 때 사용하며, 로케일별로 만든 등록 목록을 재사용한다.
 *
 * Pretendard와 Noto Sans JP를 모두 등록하므로 로케일과 관계없이 `fontName`으로 선택할 수 있다.
 * 로케일은 `fontName`을 지정하지 않은 요소에 적용할 대체(fallback) 폰트만 결정한다.
 * 동봉 폰트에 없는 문자를 표시하거나 다른 굵기가 필요하면 호스트가 `createSlipKit`의
 * `getFonts`로 폰트를 제공한다.
 */
import type { SlipFont } from '@omdc-slipkit/core';
import type { SlipLocale } from './strings.js';

type FontList = SlipFont[];

const cache = new Map<'ko' | 'ja', Promise<FontList>>();

/** 지정한 폰트에만 대체(fallback) 속성을 설정한 새 목록을 만든다. */
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
 * @param locale - 대체 폰트를 선택할 로케일. `'ja'`이면 Noto Sans JP, 그 밖에는 Pretendard를 사용한다.
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
