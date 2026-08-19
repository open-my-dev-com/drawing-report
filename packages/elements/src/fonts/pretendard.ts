/**
 * 동봉 기본 한글 폰트 — Pretendard Regular·Bold (ADR-012/031).
 *
 * 뷰어·디자이너가 `fonts` 미지정 시 자동으로 쓰는 폰트이며, 호스트가
 * `@omdc-slipkit/elements/fonts/pretendard`로 직접 불러 쓸 수도 있다.
 * 데이터가 커서(약 3MB) 컴포넌트는 이 모듈을 동적 import로만 참조한다 —
 * 사용자 폰트만 쓰는 호스트의 번들에는 들어가지 않는다.
 *
 * 폰트 저작권: Copyright (c) 2021, Kil Hyung-jin — SIL Open Font License 1.1.
 * 라이선스 전문은 패키지 루트의 `OFL-Pretendard.txt`.
 */
import type { RenderOptions } from '@omdc-slipkit/core';
import { PRETENDARD_REGULAR_B64, PRETENDARD_BOLD_B64 } from './pretendard-data.js';

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 동봉 폰트 등록 목록 — Regular가 대체(fallback) 폰트다 */
export const PRETENDARD_FONTS: NonNullable<RenderOptions['fonts']> = [
  { name: 'Pretendard', data: decode(PRETENDARD_REGULAR_B64), fallback: true },
  { name: 'Pretendard-Bold', data: decode(PRETENDARD_BOLD_B64) },
];
