/**
 * 동봉된 Pretendard Regular 및 Bold 폰트.
 *
 * 호스트가 폰트를 제공하지 않았을 때 기본 폰트로 사용한다. 호스트는
 * `@omdc-slipkit/elements/fonts/pretendard`에서 직접 가져올 수도 있다.
 *
 * 폰트 저작권: Copyright (c) 2021, Kil Hyung-jin — SIL Open Font License 1.1.
 * 라이선스 전문은 패키지 루트의 `OFL-Pretendard.txt`.
 */
import type { SlipFont } from '@omdc-slipkit/core';
import { PRETENDARD_REGULAR_B64, PRETENDARD_BOLD_B64 } from './pretendard-data.js';

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Regular를 대체 폰트로 지정한 동봉 폰트 등록 목록. */
export const PRETENDARD_FONTS: SlipFont[] = [
  { name: 'Pretendard', data: decode(PRETENDARD_REGULAR_B64), fallback: true },
  { name: 'Pretendard-Bold', data: decode(PRETENDARD_BOLD_B64) },
];
