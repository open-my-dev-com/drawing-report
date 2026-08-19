/**
 * 로컬 파일 저장소 어댑터 (ADR-021/025).
 *
 * save는 `.slip` 파일 다운로드, load는 파일 선택 대화상자를 연다.
 * 로컬 파일 시스템 특성상 delete/list는 지원하지 않으며 `unsupported` 오류를
 * 던진다 (ADR-025). 직렬화·파싱은 전부 core를 호출한다(ADR-003).
 */
import {
  SlipStorageError,
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from '../strings.js';

export class LocalFileStorage implements StorageAdapter {
  private readonly messages: SlipStrings['storage'];

  constructor(options: { /** 오류 메시지 언어 ('ko' | 'en', 기본 한국어) — ADR-028 */ locale?: string } = {}) {
    this.messages = getStrings(options.locale).storage;
  }

  /** id를 파일명으로 삼아 `.slip` 파일을 다운로드한다 */
  async save(id: string, file: SlipFile): Promise<void> {
    const json = serializeSlipFile(file);
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

  /** 파일 선택 대화상자를 열어 사용자가 고른 `.slip` 파일을 읽는다 (id는 쓰지 않음) */
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
          .then((text) => resolve(parseSlipFile(text)))
          .catch((error: unknown) => reject(error));
      });
      input.addEventListener('cancel', () => {
        cleanup();
        reject(new SlipStorageError('io', this.messages.pickCancelled));
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  delete(_id: string): Promise<void> {
    return Promise.reject(new SlipStorageError('unsupported', this.messages.deleteUnsupported));
  }

  list(): Promise<SlipListPage> {
    return Promise.reject(new SlipStorageError('unsupported', this.messages.listUnsupported));
  }
}
