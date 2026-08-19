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

export interface IndexedDbStorageOptions {
  /** 데이터베이스 이름 (기본 'slipkit') */
  dbName?: string;
  /** list() 한 페이지 크기 (기본 50) */
  pageSize?: number;
  /** 오류 메시지 언어 ('ko' | 'en', 기본 한국어) — ADR-028 */
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

export class IndexedDbStorage implements StorageAdapter {
  private readonly dbName: string;
  private readonly pageSize: number;
  private readonly messages: SlipStrings['storage'];
  private dbPromise: Promise<IDBDatabase> | null = null;

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

  async load(id: string): Promise<SlipFile> {
    const record = (await request((await this.store('readonly')).get(id), this.messages.ioError)) as
      | SlipRecord
      | undefined;
    if (!record) {
      throw new SlipStorageError('not-found', `${this.messages.notFound}: ${id}`);
    }
    return parseSlipFile(record.data);
  }

  async delete(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id), this.messages.ioError);
  }

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
