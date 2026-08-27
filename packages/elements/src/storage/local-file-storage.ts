/**
 * 브라우저의 다운로드와 파일 선택 대화상자를 사용하는 저장소 어댑터.
 * 파일 목록 조회와 삭제는 지원하지 않는다.
 */
import {
  SlipStorageError,
  type SlipFile,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from '../strings.js';
import {
  serializeForStorage,
  deserializeFromStorage,
  type StorageEncryption,
} from './encryption.js';

/**
 * `.slip` 파일을 다운로드하거나 파일 선택 대화상자에서 불러온다.
 */
export class LocalFileStorage implements StorageAdapter {
  private readonly messages: SlipStrings['storage'];
  private readonly encryption: StorageEncryption | undefined;
  private readonly locale: string | undefined;

  /**
   * @param options - 오류 메시지 언어와 저장 시 적용할 암호화 설정
   */
  constructor(options: { locale?: string; encryption?: StorageEncryption } = {}) {
    this.messages = getStrings(options.locale).storage;
    this.encryption = options.encryption;
    this.locale = options.locale;
  }

  /**
   * `.slip` 파일을 다운로드로 저장한다.
   *
   * @param id - 파일명으로 쓸 저장 키 (`.slip` 확장자는 없으면 붙인다)
   * @param file - 저장할 `.slip` 파일
   */
  async save(id: string, file: SlipFile): Promise<void> {
    const json = await serializeForStorage(file, this.encryption, this.locale);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = id.endsWith('.slip') ? id : `${id}.slip`;
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
   * @param _id - 인터페이스 호환을 위한 미사용 저장 키
   * @returns 선택한 파일을 파싱한 `.slip` 파일
   * @throws SlipStorageError 선택 취소·파일 없음(io) 시
   * @throws SlipEncryptionError 암호화된 파일의 키가 올바르지 않은 경우
   * @throws SlipParseError 고른 파일이 유효한 `.slip`이 아니면
   */
  load(_id: string): Promise<SlipFile> {
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
          .then((text) => deserializeFromStorage(text, this.encryption, this.locale))
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

  /**
   * 로컬 파일 저장소는 파일 삭제를 지원하지 않는다.
   *
   * @param _id - 쓰지 않음
   * @throws SlipStorageError 항상 `unsupported` 코드로 발생
   */
  delete(_id: string): Promise<void> {
    return Promise.reject(new SlipStorageError('unsupported', this.messages.deleteUnsupported));
  }

  /**
   * 로컬 파일 저장소는 파일 목록 조회를 지원하지 않는다.
   *
   * @throws SlipStorageError 항상 `unsupported` 코드로 발생
   */
  list(): Promise<SlipListPage> {
    return Promise.reject(new SlipStorageError('unsupported', this.messages.listUnsupported));
  }
}
