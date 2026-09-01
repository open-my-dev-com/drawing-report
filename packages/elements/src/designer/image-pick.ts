/**
 * 이미지 선택 결과 처리와 양식에 포함된 이미지 수집.
 *
 * @remarks
 * 이미지 값은 base64(`data:`)만 다룬다 — 외부 URL은 호스트가 변환해 전달한다.
 */

import type { SlipTemplateFile } from '@omdc-slipkit/core';
import { formatBytes, type ImagePickResult } from '../image-file.js';

/** 이미지를 선택하지 않은 요소에 사용하는 투명한 1×1 PNG */
export const PLACEHOLDER_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 이미지 선택 실패를 알릴 때 사용할 문구 */
export interface ImagePickTexts {
  notImage: string;
  readFailed: string;
  /** `{max}`와 `{size}` 자리에 크기를 넣는다 */
  tooLarge: string;
}

/** 이미지 선택 실패 결과 */
export type ImagePickFailure = Extract<ImagePickResult, { ok: false }>;

/**
 * 이미지 선택 실패 사유를 사용자에게 표시할 문구로 바꾼다.
 *
 * @param result - 실패한 선택 결과
 * @param texts - 로케일에 맞는 문구
 * @param maxBytes - 허용하는 최대 크기(바이트)
 * @returns 화면에 표시할 문구
 */
export function imagePickErrorText(
  result: ImagePickFailure,
  texts: ImagePickTexts,
  maxBytes: number,
): string {
  if (result.reason === 'notImage') return texts.notImage;
  if (result.reason === 'readFailed') return texts.readFailed;
  return texts.tooLarge
    .replace('{max}', formatBytes(maxBytes))
    .replace('{size}', formatBytes(result.size));
}

/**
 * 모든 페이지에서 쓰고 있는 이미지를 중복 없이 모은다.
 *
 * @param file - 양식 파일
 * @param placeholder - 제외할 자리표시 이미지
 * @returns 등록된 이미지의 base64 목록
 */
export function usedImages(file: SlipTemplateFile | null, placeholder: string): string[] {
  if (!file) return [];
  const seen = new Set<string>();
  for (const page of file.template.pages) {
    for (const el of page.elements) {
      if (el.type !== 'image') continue;
      if (el.src === undefined || el.src === placeholder || !el.src.startsWith('data:')) continue;
      seen.add(el.src);
    }
  }
  return [...seen];
}

/**
 * 이미지 요소가 참조하거나 이미지 종류로 정의된 파라미터 키를 모은다.
 *
 * @param file - 양식 파일
 * @returns 이미지 값을 갖는 파라미터 키 모음
 */
export function imageParameterKeys(file: SlipTemplateFile | null): Set<string> {
  const keys = new Set<string>();
  if (!file) return keys;
  for (const def of file.template.parameters ?? []) {
    if (def.valueType === 'image') keys.add(def.key);
  }
  for (const page of file.template.pages) {
    for (const el of page.elements) {
      if (el.type === 'image' && el.parameter !== undefined) keys.add(el.parameter);
    }
  }
  return keys;
}
