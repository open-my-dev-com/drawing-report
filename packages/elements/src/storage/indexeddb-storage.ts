/**
 * IndexedDB 저장소 어댑터 (ADR-021/025).
 *
 * `.slip` 파일을 브라우저 IndexedDB에 저장한다. 직렬화·파싱은 전부 core를
 * 호출한다(ADR-003) — 저장 시 `serializeSlipFile`, 읽을 때 `parseSlipFile`로
 * 검증을 거친다.
 */
import {
  SlipStorageError,
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
  type SlipListFilter,
  type SlipListItem,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from '../strings.js';

interface SlipRecord {
  id: string;
  kind: SlipFile['kind'];
  title: string;
  updatedAt: string;
  /** serializeSlipFile 결과 (JSON 문자열) */
  data: string;
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
}

const STORE_NAME = 'slips';
const DB_VERSION = 1;

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
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * @param options - 데이터베이스 이름·페이지 크기·오류 메시지 언어
   */
  constructor(options: IndexedDbStorageOptions = {}) {
    this.dbName = options.dbName ?? 'slipkit';
    this.pageSize = options.pageSize ?? 50;
    this.messages = getStrings(options.locale).storage;
  }

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
    const record: SlipRecord = {
      id,
      kind: file.kind,
      title: fileTitle(file),
      updatedAt: new Date().toISOString(),
      data: serializeSlipFile(file),
    };
    await request((await this.store('readwrite')).put(record), this.messages.ioError);
  }

  /**
   * id의 파일을 불러와 파싱까지 마친 상태로 돌려준다.
   *
   * @param id - 저장 키
   * @returns 불러온 .slip 파일
   * @throws SlipStorageError 없음(not-found)·읽기 실패(io) 시
   */
  async load(id: string): Promise<SlipFile> {
    const record = (await request((await this.store('readonly')).get(id), this.messages.ioError)) as
      | SlipRecord
      | undefined;
    if (!record) {
      throw new SlipStorageError('not-found', `${this.messages.notFound}: ${id}`);
    }
    return parseSlipFile(record.data);
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
