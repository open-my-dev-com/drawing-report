/**
 * 동봉 기본 일본어 폰트 — Noto Sans JP Regular 서브셋 (ADR-012/042).
 *
 * `locale="ja"`이고 `settings.getFonts`로 폰트를 공급하지 않을 때 자동으로 쓰는 폰트이며,
 * 호스트가 `@omdc-slipkit/elements/fonts/noto-sans-jp`로 직접 불러 쓸 수도 있다.
 * 데이터가 커서(약 4.8MB) 컴포넌트는 이 모듈을 동적 import로만 참조한다 —
 * 일본어를 쓰지 않는 호스트의 번들에는 들어가지 않는다.
 *
 * 두께는 Regular 하나만 동봉한다 — 언어마다 기본 하나는 있게 하되(ADR-042),
 * 굵기·더 넓은 글자 범위는 호스트가 `settings.getFonts`로 공급한다(ADR-040).
 *
 * 폰트 저작권: Copyright 2014-2021 Adobe — with Reserved Font Name 'Source'. SIL Open Font License 1.1.
 * 라이선스 전문은 패키지 루트의 `OFL-NotoSansJP.txt`.
 */
import type { RenderOptions } from '@omdc-slipkit/core';
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
 * Regular에 `fallback: true`가 설정되어 있어, 다른 폰트에 없는 일본어 글자를 이 폰트가 그린다.
 */
export const NOTO_SANS_JP_FONTS: NonNullable<RenderOptions['fonts']> = [
  { name: 'Noto Sans JP', data: decode(NOTO_SANS_JP_REGULAR_B64), fallback: true },
];

export default NOTO_SANS_JP_FONTS;
