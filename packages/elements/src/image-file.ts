/**
 * 이미지 파일을 base64로 읽는 공용 도우미 — 디자이너(고정·변동 이미지·샘플 값)와
 * 작성폼(`<slip-form>`)이 함께 쓴다 (G-36 · G-47).
 *
 * @remarks
 * 주소(URL)는 받지 않는다 — PDF 변환이 `data:`·`asset://`만 풀 수 있어 주소로 두면
 * 미리보기부터 깨진다 (ADR-036). 주소로 받아야 하는 이미지는 호스트 서버가 중계해
 * base64로 바꿔 넘긴다.
 */

/** 이미지 파일 선택 결과 — 성공(src) 또는 오류 종류 */
export type ImagePickResult =
  | { ok: true; src: string }
  | { ok: false; reason: 'notImage' | 'tooLarge'; size: number }
  | { ok: false; reason: 'readFailed' };

/**
 * 파일 선택 대화 상자를 열어 고른 이미지를 `data:` base64로 읽는다.
 *
 * @param maxBytes - 허용하는 최대 파일 크기(바이트)
 * @returns 고른 이미지의 base64 또는 오류 종류. 파일을 고르지 않고 대화 상자를 닫으면
 *   Promise는 resolve되지 않는다(취소로 본다)
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

/** 바이트 수를 사람이 읽는 크기로 (오류 문구용) */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
