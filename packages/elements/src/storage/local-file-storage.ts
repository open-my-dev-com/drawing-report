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

/**
 * 로컬 파일 저장소 어댑터 — save는 다운로드, load는 파일 선택 대화상자.
 * delete/list는 매체 특성상 지원하지 않아 `unsupported` 오류를 던진다 (ADR-025).
 */
export class LocalFileStorage implements StorageAdapter {
  private readonly messages: SlipStrings['storage'];

  /**
   * @param options - `locale`: 오류 메시지 언어 ('ko' | 'en' | 'ja', 기본 한국어) — ADR-028/042
   */
  constructor(options: { locale?: string } = {}) {
    this.messages = getStrings(options.locale).storage;
  }

  /**
   * `.slip` 파일을 다운로드로 저장한다.
   *
   * @param id - 파일명으로 쓸 저장 키 (`.slip` 확장자는 없으면 붙인다)
   * @param file - 저장할 .slip 파일
   */
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

  /**
   * 파일 선택 대화상자를 열어 사용자가 고른 `.slip` 파일을 읽는다.
   *
   * @param _id - 쓰지 않음 — 어떤 파일을 열지는 사용자가 대화상자에서 고른다
   * @returns 선택한 파일을 파싱한 .slip 파일
   * @throws SlipStorageError 선택 취소·파일 없음(io) 시
   * @throws SlipParseError 고른 파일이 유효한 .slip이 아니면
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

  /**
   * 지원하지 않는다 — 로컬 파일 매체에는 삭제 개념이 없다 (ADR-025).
   *
   * @param _id - 쓰지 않음
   * @throws SlipStorageError 항상 `unsupported` 코드로 거부
   */
  delete(_id: string): Promise<void> {
    return Promise.reject(new SlipStorageError('unsupported', this.messages.deleteUnsupported));
  }

  /**
   * 지원하지 않는다 — 로컬 파일 매체는 목록을 조회할 수 없다 (ADR-025).
   *
   * @throws SlipStorageError 항상 `unsupported` 코드로 거부
   */
  list(): Promise<SlipListPage> {
    return Promise.reject(new SlipStorageError('unsupported', this.messages.listUnsupported));
  }
}
