/**
 * 디자이너와 `<slip-form>`에서 이미지 파일을 base64로 읽는 공통 함수.
 *
 * @remarks
 * PDF 변환은 `data:`와 `asset://`만 지원하므로 URL은 받지 않습니다.
 * 외부 이미지는 호스트가 base64로 변환해 전달해야 합니다.
 * PDF에 심을 수 있는 PNG·JPEG만 받으며, 파일 확장자나 선언된 MIME이 아니라
 * 파일 내용(서명)으로 형식을 확인합니다.
 */
import { IMAGE_MIME_TYPES, inspectImageBytes } from '@omdc-slipkit/core';

/** 이미지 파일 선택 결과 */
export type ImagePickResult =
  | { ok: true; src: string }
  | { ok: false; reason: 'notImage' | 'tooLarge'; size: number }
  | { ok: false; reason: 'readFailed' };

/** 파일 선택 대화 상자의 `accept` 값 — PDF에 심을 수 있는 형식만 나열합니다. */
const ACCEPT = IMAGE_MIME_TYPES.join(',');

/**
 * 파일 선택 대화 상자를 열어 선택한 이미지를 `data:` base64로 읽습니다.
 *
 * @param maxBytes - 허용하는 최대 파일 크기(바이트)
 * @returns 선택한 이미지의 base64 데이터 또는 오류 종류. 선택을 취소하면 Promise는 완료되지 않습니다
 */
export function pickImageFile(maxBytes: number): Promise<ImagePickResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void readImageFile(file, maxBytes).then(resolve);
    });
    input.click();
  });
}

/**
 * 이미지 파일의 내용을 검사해 `data:` base64 문자열로 읽습니다.
 *
 * @remarks
 * 크기 상한은 파일을 읽기 전에 먼저 확인하고, 형식은 읽은 바이트의 서명으로 판정합니다.
 * 선언된 MIME이 PNG·JPEG가 아니거나 내용과 다르면 거부합니다.
 *
 * @param file - 선택한 파일
 * @param maxBytes - 허용하는 최대 파일 크기(바이트)
 * @returns 검사와 변환 결과
 */
export async function readImageFile(file: Blob, maxBytes: number): Promise<ImagePickResult> {
  if (file.size > maxBytes) return { ok: false, reason: 'tooLarge', size: file.size };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: 'readFailed' };
  }
  const inspected = inspectImageBytes(bytes, {
    maxBytes,
    ...(file.type === '' ? {} : { declaredMimeType: file.type }),
  });
  if (!inspected.ok) {
    return inspected.reason === 'size'
      ? { ok: false, reason: 'tooLarge', size: inspected.bytes }
      : { ok: false, reason: 'notImage', size: inspected.bytes };
  }
  return { ok: true, src: `data:${inspected.mimeType};base64,${toBase64(bytes)}` };
}

/** 바이트를 base64 문자열로 변환합니다. 큰 파일도 인자 개수 제한에 걸리지 않도록 나누어 처리합니다. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * 바이트 수를 오류 메시지에 표시할 단위로 변환합니다.
 *
 * @param bytes - 바이트 수
 * @returns MB·KB·B 단위로 줄인 문자열
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
