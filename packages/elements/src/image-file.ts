/**
 * 디자이너와 `<slip-form>`에서 이미지 파일을 base64로 읽는 공통 함수.
 *
 * @remarks
 * PDF 변환은 `data:`와 `asset://`만 지원하므로 URL은 받지 않습니다.
 * 외부 이미지는 호스트가 base64로 변환해 전달해야 합니다.
 */

/** 이미지 파일 선택 결과 */
export type ImagePickResult =
  | { ok: true; src: string }
  | { ok: false; reason: 'notImage' | 'tooLarge'; size: number }
  | { ok: false; reason: 'readFailed' };

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
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        resolve({ ok: false, reason: 'notImage', size: file.size });
        return;
      }
      if (file.size > maxBytes) {
        resolve({ ok: false, reason: 'tooLarge', size: file.size });
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const src = typeof reader.result === 'string' ? reader.result : '';
        if (!src.startsWith('data:')) {
          resolve({ ok: false, reason: 'readFailed' });
          return;
        }
        resolve({ ok: true, src });
      });
      reader.addEventListener('error', () => resolve({ ok: false, reason: 'readFailed' }));
      reader.readAsDataURL(file);
    });
    input.click();
  });
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
