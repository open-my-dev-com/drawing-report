/**
 * `.slip` 파일을 브라우저 IndexedDB에 저장하는 어댑터.
 * 직렬화와 파싱에는 core API를 사용한다.
 */
import {
  SlipStorageError,
  type SlipFile,
  type SlipKit,
  type SlipListFilter,
  type SlipListItem,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from '../strings.js';
import { serializeForStorage, deserializeFromStorage } from './encryption.js';

/** 목록 조회에 쓰는 메타데이터. 본문과 별도 스토어에 두어 목록이 Blob을 읽지 않게 한다. */
interface SlipMetaRecord {
  id: string;
  kind: SlipFile['kind'];
  title: string;
  updatedAt: string;
}

interface SlipRecord extends SlipMetaRecord {
  /**
   * 직렬화된 파일 본문. Blob으로 저장한다.
   * 버전 1에서 저장한 문자열도 마이그레이션과 읽기 과정에서 지원한다.
   */
  data: Blob | string;
}

/** IndexedDbStorage 생성 옵션 — 이 저장소에만 속하는 설정만 받는다. */
export interface IndexedDbStorageOptions {
  /**
   * 데이터베이스 이름.
   *
   * @defaultValue `'slipkit'`
   */
  dbName?: string;
  /**
   * list 한 페이지 크기. 1 이상의 안전한 정수만 허용한다.
   *
   * @defaultValue 50
   */
  pageSize?: number;
  /**
   * 저장 시 `.slip` 내용을 암호화할지 여부. 키와 로케일은 SlipKit 인스턴스의 설정을 쓴다.
   * 불러오기는 이 값과 무관하게 암호화 봉투를 자동 감지해 설정된 키로 푼다.
   *
   * @defaultValue false
   */
  encryptOnSave?: boolean;
}

const STORE_NAME = 'slips';
const META_STORE_NAME = 'slip-meta';
// 버전 2부터 파일 본문을 Blob으로 저장하고, 버전 3부터 목록용 메타데이터를 별도 스토어에 둔다.
const DB_VERSION = 3;

function fileTitle(file: SlipFile): string {
  return file.kind === 'template' ? file.template.meta.title : file.templateSnapshot.meta.title;
}

function metaOf(record: SlipRecord): SlipMetaRecord {
  return { id: record.id, kind: record.kind, title: record.title, updatedAt: record.updatedAt };
}

function request<T>(req: IDBRequest<T>, ioError: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new SlipStorageError('io', req.error?.message ?? ioError));
  });
}

function transactionDone(tx: IDBTransaction, ioError: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new SlipStorageError('io', tx.error?.message ?? ioError));
    tx.onabort = () => reject(new SlipStorageError('io', tx.error?.message ?? ioError));
  });
}

/**
 * 저장, 불러오기, 삭제, 필터링된 목록 조회를 지원하는 IndexedDB 저장소 어댑터.
 */
export class IndexedDbStorage implements StorageAdapter {
  private readonly slipkit: SlipKit;
  private readonly dbName: string;
  private readonly pageSize: number;
  private readonly messages: SlipStrings['storage'];
  private readonly encryptOnSave: boolean;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * @param slipkit - 로케일과 암호화 키를 공급하는 공통 설정 인스턴스
   * @param options - 데이터베이스 이름·페이지 크기·저장 시 암호화 여부
   * @throws RangeError `pageSize`가 1 이상의 안전한 정수가 아닐 때
   */
  constructor(slipkit: SlipKit, options: IndexedDbStorageOptions = {}) {
    this.slipkit = slipkit;
    this.dbName = options.dbName ?? 'slipkit';
    this.messages = getStrings(slipkit.locale).storage;
    const pageSize = options.pageSize ?? 50;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new RangeError(`${this.messages.badPageSize}: ${String(options.pageSize)}`);
    }
    this.pageSize = pageSize;
    this.encryptOnSave = options.encryptOnSave ?? false;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      let settled = false;
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction!;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META_STORE_NAME)) {
          const meta = db.createObjectStore(META_STORE_NAME, { keyPath: 'id' });
          meta.createIndex('updatedAt', 'updatedAt');
        }
        if (event.oldVersion >= 1 && event.oldVersion < DB_VERSION) {
          // 버전 1의 문자열 본문은 Blob으로 바꾸고, 버전 3의 메타데이터 스토어를 기존 본문에서 채운다.
          const store = tx.objectStore(STORE_NAME);
          const meta = tx.objectStore(META_STORE_NAME);
          store.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            const record = cursor.value as SlipRecord;
            if (typeof record.data === 'string') {
              cursor.update({ ...record, data: new Blob([record.data]) });
            }
            meta.put(metaOf(record));
            cursor.continue();
          };
        }
      };
      req.onblocked = () => {
        // 다른 연결이 열려 있어 버전을 올리지 못하면 기다리지 않고 알린다.
        // 뒤늦게 열리더라도 그 연결은 쓰지 않고 닫는다 — 다음 호출이 새로 연다.
        if (settled) return;
        settled = true;
        this.dbPromise = null;
        reject(new SlipStorageError('io', this.messages.openBlocked));
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        // 다른 탭이 버전을 올리거나 삭제하면 연결을 닫고 다음 호출에서 다시 연다.
        db.onversionchange = () => {
          db.close();
          if (this.dbPromise === promise) this.dbPromise = null;
        };
        // 브라우저가 연결을 강제로 닫으면 다음 호출에서 다시 연다.
        db.onclose = () => {
          if (this.dbPromise === promise) this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        if (settled) return;
        settled = true;
        // 데이터베이스 열기에 실패하면 다음 호출에서 다시 시도한다.
        this.dbPromise = null;
        reject(new SlipStorageError('io', req.error?.message ?? this.messages.ioError));
      };
    });
    this.dbPromise = promise;
    return promise;
  }

  /** 트랜잭션을 연다. 연결이 이미 닫혀 있으면 오류로 알리고 다음 호출에서 다시 연다. */
  private async transaction(stores: string | string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    const db = await this.open();
    try {
      return db.transaction(stores, mode);
    } catch (error) {
      this.dbPromise = null;
      throw new SlipStorageError('io', error instanceof Error ? error.message : this.messages.ioError);
    }
  }

  /**
   * 파일을 IndexedDB에 저장한다. 같은 id가 이미 있으면 덮어쓴다.
   *
   * @param id - 저장 키
   * @param file - 저장할 `.slip` 파일
   * @throws SlipStorageError 데이터베이스 쓰기 실패(io) 시
   * @throws SlipEncryptionError 암호화 저장인데 SlipKit 설정에 키가 없을 때
   */
  async save(id: string, file: SlipFile): Promise<void> {
    // 목록 조회에 필요한 메타데이터는 평문으로 두고 파일 본문만 암호화한다.
    const record: SlipRecord = {
      id,
      kind: file.kind,
      title: fileTitle(file),
      updatedAt: new Date().toISOString(),
      data: new Blob([await serializeForStorage(this.slipkit, file, this.encryptOnSave)]),
    };
    const tx = await this.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.objectStore(META_STORE_NAME).put(metaOf(record));
    await transactionDone(tx, this.messages.ioError);
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
    const tx = await this.transaction(STORE_NAME, 'readonly');
    const record = (await request(tx.objectStore(STORE_NAME).get(id), this.messages.ioError)) as
      | SlipRecord
      | undefined;
    if (!record) {
      throw new SlipStorageError('not-found', `${this.messages.notFound}: ${id}`);
    }
    // 마이그레이션되지 않은 버전 1 문자열도 읽을 수 있다.
    const data = typeof record.data === 'string' ? record.data : await record.data.text();
    return deserializeFromStorage(this.slipkit, data);
  }

  /**
   * ID에 해당하는 파일을 삭제한다. 파일이 없어도 오류가 발생하지 않는다.
   *
   * @param id - 저장 키
   * @throws SlipStorageError 데이터베이스 쓰기 실패(io) 시
   */
  async delete(id: string): Promise<void> {
    const tx = await this.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(META_STORE_NAME).delete(id);
    await transactionDone(tx, this.messages.ioError);
  }

  /**
   * 저장된 파일 목록을 최근 수정순으로 나누어 반환한다.
   *
   * @remarks
   * 메타데이터 스토어만 읽으므로 본문 Blob은 읽지 않는다.
   * 오프셋 커서를 사용하므로 조회 중 데이터가 바뀌면 페이지 경계가 달라질 수 있다.
   *
   * @param filter - 종류·제목 검색어 필터 (생략하면 전체)
   * @param cursor - 이전 페이지가 돌려준 nextCursor (생략하면 첫 페이지)
   * @returns 목록 한 페이지 (pageSize개)
   * @throws SlipStorageError 잘못된 커서·조회 실패(io) 시
   */
  async list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage> {
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new SlipStorageError('io', `${this.messages.badCursor}: ${cursor}`);
    }

    const tx = await this.transaction(META_STORE_NAME, 'readonly');
    const records = (await request(tx.objectStore(META_STORE_NAME).getAll(), this.messages.ioError)) as
      SlipMetaRecord[];

    const query = filter?.query?.trim().toLowerCase();
    const matched = records
      .filter((r) => (filter?.kind ? r.kind === filter.kind : true))
      .filter((r) => (query ? r.title.toLowerCase().includes(query) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const items: SlipListItem[] = matched
      .slice(offset, offset + this.pageSize)
      .map(({ id, kind, title, updatedAt }) => ({ id, kind, title, updatedAt }));

    const next = offset + this.pageSize;
    return next < matched.length ? { items, nextCursor: String(next) } : { items };
  }
}
