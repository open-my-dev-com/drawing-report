/**
 * 브라우저의 다운로드와 파일 선택 대화상자로 `.slip` 파일을 주고받는 기능.
 *
 * 저장소가 아니므로 {@link StorageAdapter}를 구현하지 않는다 — 목록과 삭제가 없고,
 * 내려받기와 열기 두 동작만 제공한다.
 */
import { SlipStorageError, type SlipFile, type SlipKit } from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from '../strings.js';
import { serializeForStorage, deserializeFromStorage } from './encryption.js';

/** SlipFileExchange 생성 옵션 — 파일 교환에만 속하는 설정만 받는다. */
export interface SlipFileExchangeOptions {
  /**
   * 내려받는 파일을 암호화할지 여부. 키와 로케일은 SlipKit 인스턴스의 설정을 쓴다.
   * 열기는 이 값과 무관하게 암호화 봉투를 자동 감지해 설정된 키로 푼다.
   *
   * @defaultValue false
   */
  encryptOnSave?: boolean;
}

/**
 * `.slip` 파일을 다운로드로 내보내고 파일 선택 대화상자에서 불러온다.
 */
export class SlipFileExchange {
  private readonly slipkit: SlipKit;
  private readonly messages: SlipStrings['storage'];
  private readonly encryptOnSave: boolean;

  /**
   * @param slipkit - 로케일과 암호화 키를 공급하는 공통 설정 인스턴스
   * @param options - 내려받기 시 암호화 여부
   */
  constructor(slipkit: SlipKit, options: SlipFileExchangeOptions = {}) {
    this.slipkit = slipkit;
    this.messages = getStrings(slipkit.locale).storage;
    this.encryptOnSave = options.encryptOnSave ?? false;
  }

  /**
   * `.slip` 파일을 브라우저 다운로드로 내려받는다.
   *
   * @param name - 파일 이름 (`.slip` 확장자는 없으면 붙인다)
   * @param file - 내려받을 `.slip` 파일
   * @throws SlipEncryptionError 암호화 내려받기인데 SlipKit 설정에 키가 없을 때
   */
  async download(name: string, file: SlipFile): Promise<void> {
    const json = await serializeForStorage(this.slipkit, file, this.encryptOnSave);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name.endsWith('.slip') ? name : `${name}.slip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * 파일 선택 대화상자에서 선택한 `.slip` 파일을 읽는다.
   *
   * @returns 선택한 파일을 파싱한 `.slip` 파일
   * @throws SlipStorageError 선택 취소(cancelled)·파일 없음(io) 시
   * @throws SlipEncryptionError 암호화된 파일을 설정된 키로 풀 수 없는 경우
   * @throws SlipParseError 고른 파일이 유효한 `.slip`이 아니면
   */
  open(): Promise<SlipFile> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.slip,application/json';
      input.style.display = 'none';

      const cleanup = () => input.remove();

      input.addEventListener('change', () => {
        const picked = input.files?.[0];
        cleanup();
        if (!picked) {
          reject(new SlipStorageError('io', this.messages.noFileSelected));
          return;
        }
        picked
          .text()
          .then((text) => deserializeFromStorage(this.slipkit, text))
          .then(resolve)
          .catch((error: unknown) => reject(error));
      });
      input.addEventListener('cancel', () => {
        cleanup();
        reject(new SlipStorageError('cancelled', this.messages.pickCancelled));
      });

      document.body.appendChild(input);
      input.click();
    });
  }
}
