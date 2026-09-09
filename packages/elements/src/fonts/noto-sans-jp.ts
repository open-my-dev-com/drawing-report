/**
 * 동봉된 Noto Sans JP Regular 일본어 서브셋입니다.
 *
 * 렌더링 로케일이 `ja`이고 `slipkit.getFonts`가 없을 때 기본 폰트로 사용합니다. 호스트는
 * `@omdc-slipkit/elements/fonts/noto-sans-jp`에서 직접 가져올 수도 있습니다.
 *
 * Regular만 포함하므로 다른 굵기나 글자 범위는 `createSlipKit`의 `getFonts`로 제공해야 합니다.
 *
 * 폰트 저작권: Copyright 2014-2021 Adobe — with Reserved Font Name 'Source'. SIL Open Font License 1.1입니다.
 * 라이선스 전체 내용은 패키지 루트의 `OFL-NotoSansJP.txt`에서 확인할 수 있습니다.
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
 * 동봉 일본어 기본 폰트(Noto Sans JP Regular 서브셋) 등록 목록입니다.
 *
 * 대체 폰트로 등록되어 다른 폰트에 없는 일본어 글자를 처리합니다.
 */
export const NOTO_SANS_JP_FONTS: SlipFont[] = [
  { name: 'Noto Sans JP', data: decode(NOTO_SANS_JP_REGULAR_B64), fallback: true },
];

/** `NOTO_SANS_JP_FONTS`와 같은 목록 — `import fonts from '@omdc-slipkit/elements/fonts/noto-sans-jp'`로도 가져올 수 있습니다. */
export default NOTO_SANS_JP_FONTS;
