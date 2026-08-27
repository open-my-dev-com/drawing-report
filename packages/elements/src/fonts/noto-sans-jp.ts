/**
 * 동봉된 Noto Sans JP Regular 일본어 서브셋.
 *
 * `locale="ja"`이고 `settings.getFonts`가 없을 때 기본 폰트로 사용한다. 호스트는
 * `@omdc-slipkit/elements/fonts/noto-sans-jp`에서 직접 가져올 수도 있다.
 *
 * Regular만 포함하므로 다른 굵기나 글자 범위는 `settings.getFonts`로 제공해야 한다.
 *
 * 폰트 저작권: Copyright 2014-2021 Adobe — with Reserved Font Name 'Source'. SIL Open Font License 1.1.
 * 라이선스 전문은 패키지 루트의 `OFL-NotoSansJP.txt`.
 */
import type { SlipFont } from '@omdc-slipkit/core';
import { NOTO_SANS_JP_REGULAR_B64 } from './noto-sans-jp-data.js';

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 동봉 일본어 기본 폰트(Noto Sans JP Regular 서브셋) 등록 목록.
 *
 * `fallback: true`로 등록되어 다른 폰트에 없는 일본어 글자를 처리한다.
 */
export const NOTO_SANS_JP_FONTS: SlipFont[] = [
  { name: 'Noto Sans JP', data: decode(NOTO_SANS_JP_REGULAR_B64), fallback: true },
];

export default NOTO_SANS_JP_FONTS;
