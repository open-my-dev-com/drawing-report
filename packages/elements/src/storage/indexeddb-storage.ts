/**
 * `.slip` 파일을 브라우저 IndexedDB에 저장하는 어댑터.
 * 직렬화와 파싱에는 core API를 사용한다.
 */
import {
  SlipStorageError,
  type SlipFile,
  type SlipListFilter,
  type SlipListItem,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from '../strings.js';
import {
  serializeForStorage,
  deserializeFromStorage,
  type StorageEncryption,
} from './encryption.js';

interface SlipRecord {
  id: string;
  kind: SlipFile['kind'];
  title: string;
  updatedAt: string;
  /**
   * 직렬화된 파일 본문. 목록 조회에서 본문을 읽지 않도록 Blob으로 저장한다.
   * 버전 1에서 저장한 문자열도 마이그레이션과 읽기 과정에서 지원한다.
   */
  data: Blob | string;
}

/** IndexedDbStorage 생성 옵션 */
export interface IndexedDbStorageOptions {
  /**
   * 데이터베이스 이름.
   *
   * @defaultValue `'slipkit'`
   */
  dbName?: string;
  /**
   * list 한 페이지 크기.
   *
   * @defaultValue 50
   */
  pageSize?: number;
  /**
   * 오류 메시지 언어(`ko`, `en`, `ja`).
   *
   * @defaultValue 영어
   */
  locale?: string;
  /**
   * 저장 시 `.slip` 내용을 암호화할지 설정. 생략하거나 `enabled: false`면
   * 평문으로 저장한다. 불러오기는 설정과 무관하게 암호화 봉투를 자동 감지해 푼다.
   */
  encryption?: StorageEncryption;
}

const STORE_NAME = 'slips';
// 버전 2부터 파일 본문을 Blob으로 저장한다.
const DB_VERSION = 2;

function fileTitle(file: SlipFile): string {
  return file.kind === 'template' ? file.template.meta.title : file.templateSnapshot.meta.title;
}

function request<T>(req: IDBRequest<T>, ioError: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new SlipStorageError('io', req.error?.message ?? ioError));
  });
}

/**
 * 저장, 불러오기, 삭제, 필터링된 목록 조회를 지원하는 IndexedDB 저장소 어댑터.
 */
export class IndexedDbStorage implements StorageAdapter {
  private readonly dbName: string;
  private readonly pageSize: number;
  private readonly messages: SlipStrings['storage'];
  private readonly encryption: StorageEncryption | undefined;
  private readonly locale: string | undefined;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * @param options - 데이터베이스 이름·페이지 크기·오류 메시지 언어·암호화 설정
   */
  constructor(options: IndexedDbStorageOptions = {}) {
    this.dbName = options.dbName ?? 'slipkit';
    this.pageSize = options.pageSize ?? 50;
    this.messages = getStrings(options.locale).storage;
    this.encryption = options.encryption;
    this.locale = options.locale;
  }

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        // 버전 1의 문자열 본문을 버전 2의 Blob 형식으로 변환한다.
        if (event.oldVersion >= 1 && event.oldVersion < 2) {
          const store = req.transaction!.objectStore(STORE_NAME);
          store.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            const record = cursor.value as SlipRecord;
            if (typeof record.data === 'string') {
              cursor.update({ ...record, data: new Blob([record.data]) });
            }
            cursor.continue();
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        // 데이터베이스 열기에 실패하면 다음 호출에서 다시 시도한다.
        this.dbPromise = null;
        reject(new SlipStorageError('io', req.error?.message ?? this.messages.ioError));
      };
    });
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  /**
   * 파일을 IndexedDB에 저장한다. 같은 id가 이미 있으면 덮어쓴다.
   *
   * @param id - 저장 키
   * @param file - 저장할 `.slip` 파일
   * @throws SlipStorageError 데이터베이스 쓰기 실패(io) 시
   */
  async save(id: string, file: SlipFile): Promise<void> {
    // 목록 조회에 필요한 메타데이터는 평문으로 두고 파일 본문만 암호화한다.
    const record: SlipRecord = {
      id,
      kind: file.kind,
      title: fileTitle(file),
      updatedAt: new Date().toISOString(),
      data: new Blob([await serializeForStorage(file, this.encryption, this.locale)]),
    };
    await request((await this.store('readwrite')).put(record), this.messages.ioError);
  }

  /**
   * ID에 해당하는 파일을 불러와 파싱한다.
   *
   * @param id - 저장 키
   * @returns 불러온 `.slip` 파일
   * @throws SlipStorageError 없음(not-found)·읽기 실패(io) 시
   * @throws SlipEncryptionError 암호화 저장분인데 키가 맞지 않으면
   */
  async load(id: string): Promise<SlipFile> {
    const record = (await request((await this.store('readonly')).get(id), this.messages.ioError)) as
      | SlipRecord
      | undefined;
    if (!record) {
      throw new SlipStorageError('not-found', `${this.messages.notFound}: ${id}`);
    }
    // 마이그레이션되지 않은 버전 1 문자열도 읽을 수 있다.
    const data = typeof record.data === 'string' ? record.data : await record.data.text();
    return deserializeFromStorage(data, this.encryption, this.locale);
  }

  /**
   * ID에 해당하는 파일을 삭제한다. 파일이 없어도 오류가 발생하지 않는다.
   *
   * @param id - 저장 키
   * @throws SlipStorageError 데이터베이스 쓰기 실패(io) 시
   */
  async delete(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id), this.messages.ioError);
  }

  /**
   * 저장된 파일 목록을 최근 수정순으로 나누어 반환한다.
   *
   * @remarks
   * 목록에는 메타데이터만 포함하며 본문 `data`는 읽지 않는다.
   * 오프셋 커서를 사용하므로 조회 중 데이터가 바뀌면 페이지 경계가 달라질 수 있다.
   *
   * @param filter - 종류·제목 검색어 필터 (생략하면 전체)
   * @param cursor - 이전 페이지가 돌려준 nextCursor (생략하면 첫 페이지)
   * @returns 목록 한 페이지 (pageSize개)
   * @throws SlipStorageError 잘못된 커서·조회 실패(io) 시
   */
  async list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage> {
    const records = (await request((await this.store('readonly')).getAll(), this.messages.ioError)) as SlipRecord[];

    const query = filter?.query?.trim().toLowerCase();
    const matched = records
      .filter((r) => (filter?.kind ? r.kind === filter.kind : true))
      .filter((r) => (query ? r.title.toLowerCase().includes(query) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new SlipStorageError('io', `${this.messages.badCursor}: ${cursor}`);
    }

    const items: SlipListItem[] = matched
      .slice(offset, offset + this.pageSize)
      .map(({ id, kind, title, updatedAt }) => ({ id, kind, title, updatedAt }));

    const next = offset + this.pageSize;
    return next < matched.length ? { items, nextCursor: String(next) } : { items };
  }
}
