/**
 * IndexedDB 저장소 어댑터 (ADR-021/025).
 *
 * `.slip` 파일을 브라우저 IndexedDB에 저장한다. 직렬화·파싱은 전부 core를
 * 호출한다(ADR-003) — 저장 시 `serializeSlipFile`, 읽을 때 `parseSlipFile`로
 * 검증을 거친다.
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
   * serializeSlipFile 결과를 담은 Blob (본문). 목록은 이 필드를 읽지 않아 본문 바이트를
   * 메모리에 올리지 않는다 — IndexedDB는 Blob을 느긋한 핸들로 돌려주기 때문이다 (ADR-045).
   * 옛 버전(v1)은 문자열로 저장했고 마이그레이션에서 Blob으로 바꾼다.
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
   * list() 한 페이지 크기.
   *
   * @defaultValue 50
   */
  pageSize?: number;
  /**
   * 오류 메시지 언어 ('ko' | 'en' | 'ja') — ADR-028/042.
   *
   * @defaultValue 한국어
   */
  locale?: string;
  /**
   * 저장 시 `.slip` 내용을 암호화할지 설정 (ADR-055). 생략하거나 `enabled: false`면
   * 평문으로 저장한다. 불러오기는 설정과 무관하게 암호화 봉투를 자동 감지해 푼다.
   */
  encryption?: StorageEncryption;
}

const STORE_NAME = 'slips';
// v2: 본문을 문자열 → Blob으로 옮겨 목록 조회가 본문을 안 읽게 한다 (ADR-045)
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
 * 브라우저 IndexedDB 저장소 어댑터 (ADR-021/025) —
 * save/load/delete/list 전부 지원, 제목·종류 필터와 커서 페이징 포함.
 */
export class IndexedDbStorage implements StorageAdapter {
  private readonly dbName: string;
  private readonly pageSize: number;
  private readonly messages: SlipStrings['storage'];
  private readonly encryption: StorageEncryption | undefined;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * @param options - 데이터베이스 이름·페이지 크기·오류 메시지 언어·암호화 설정
   */
  constructor(options: IndexedDbStorageOptions = {}) {
    this.dbName = options.dbName ?? 'slipkit';
    this.pageSize = options.pageSize ?? 50;
    this.messages = getStrings(options.locale).storage;
    this.encryption = options.encryption;
  }

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        // v1 → v2: 문자열로 저장된 본문을 Blob으로 옮긴다 (ADR-045). versionchange
        // 트랜잭션 안에서 커서로 훑어 그 자리에서 바꾼다 — 새 DB(oldVersion 0)는 대상이 없다.
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
        // 실패한 열기를 캐시에 남기지 않는다 — 다음 호출이 다시 시도할 수 있게
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
   * @param file - 저장할 .slip 파일
   * @throws SlipStorageError 데이터베이스 쓰기 실패(io) 시
   */
  async save(id: string, file: SlipFile): Promise<void> {
    // 암호화가 켜져 있으면 본문(data)만 잠근다 — id·kind·title은 목록 조회용 메타라
    // 평문으로 남는다(제목은 그대로 보인다). 민감한 내용은 본문 안(파라미터·직접 입력·
    // 이미지)이라 본문 암호화로 가려진다 (ADR-055).
    const record: SlipRecord = {
      id,
      kind: file.kind,
      title: fileTitle(file),
      updatedAt: new Date().toISOString(),
      data: new Blob([await serializeForStorage(file, this.encryption)]),
    };
    await request((await this.store('readwrite')).put(record), this.messages.ioError);
  }

  /**
   * id의 파일을 불러와 파싱까지 마친 상태로 돌려준다.
   *
   * @param id - 저장 키
   * @returns 불러온 .slip 파일
   * @throws SlipStorageError 없음(not-found)·읽기 실패(io) 시
   * @throws SlipEncryptionError 암호화 저장분인데 키가 맞지 않으면 (ADR-055)
   */
  async load(id: string): Promise<SlipFile> {
    const record = (await request((await this.store('readonly')).get(id), this.messages.ioError)) as
      | SlipRecord
      | undefined;
    if (!record) {
      throw new SlipStorageError('not-found', `${this.messages.notFound}: ${id}`);
    }
    // 본문은 Blob(신규)이거나 문자열(마이그레이션 전 옛 데이터)일 수 있다
    const data = typeof record.data === 'string' ? record.data : await record.data.text();
    return deserializeFromStorage(data, this.encryption);
  }

  /**
   * id의 파일을 삭제한다. 없는 id는 조용히 지나간다 (IndexedDB delete 의미론).
   *
   * @param id - 저장 키
   * @throws SlipStorageError 데이터베이스 쓰기 실패(io) 시
   */
  async delete(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id), this.messages.ioError);
  }

  /**
   * 저장된 파일 목록을 최근 수정순으로 페이징해 돌려준다.
   *
   * @remarks
   * 메타(id·kind·title·updatedAt)만 읽어 목록을 만든다 — 본문(`data`)은 Blob이라 여기서
   * 건드리지 않으면 바이트가 메모리에 올라오지 않는다 (ADR-045). 오프셋 커서라 페이지 사이에
   * 저장·삭제가 일어나면 경계가 밀릴 수 있으므로, 화면은 목록을 한 번 받아 그 위에서
   * 페이징하는 편이 안전하다.
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
