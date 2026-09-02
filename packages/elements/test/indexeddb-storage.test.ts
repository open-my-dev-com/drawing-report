import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createSlipKit, serializeSlipFile, isEncryptedSlipFile } from '@omdc-slipkit/core';
import { IndexedDbStorage } from '../src/storage/indexeddb-storage.js';
import { getPresets } from '../src/presets.js';
import { getStrings } from '../src/strings.js';

const presets = getPresets();

// fake-indexeddb로 저장소 동작을 재현하고 core 직렬화 API는 실제 구현을 사용한다.

const plainKit = createSlipKit();

let dbCounter = 0;
function freshStorage(pageSize?: number): IndexedDbStorage {
  const options: { dbName: string; pageSize?: number } = { dbName: `test-db-${++dbCounter}` };
  if (pageSize !== undefined) options.pageSize = pageSize;
  return new IndexedDbStorage(plainKit, options);
}

describe('IndexedDbStorage', () => {
  it('save 후 load하면 저장한 파일이 그대로 돌아온다', async () => {
    const storage = freshStorage();
    const file = presets[0]!.create();

    await storage.save('doc-1', file);
    const loaded = await storage.load('doc-1');

    expect(loaded).toEqual(file);
  });

  it('없는 id를 load하면 not-found 오류를 던진다', async () => {
    const storage = freshStorage();
    await expect(storage.load('없는-id')).rejects.toMatchObject({
      name: 'SlipStorageError',
      code: 'not-found',
    });
  });

  it('delete하면 파일이 지워진다', async () => {
    const storage = freshStorage();
    await storage.save('doc-1', presets[0]!.create());
    await storage.delete('doc-1');
    await expect(storage.load('doc-1')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('list는 제목·종류 필터를 지원한다', async () => {
    const storage = freshStorage();
    await storage.save('trade', presets[0]!.create()); // 거래명세서
    await storage.save('invoice', presets[1]!.create()); // 청구서

    const all = await storage.list();
    expect(all.items.length).toBe(2);
    expect(all.nextCursor).toBeUndefined();

    const byQuery = await storage.list({ query: 'Invoi' });
    expect(byQuery.items.map((i) => i.id)).toEqual(['invoice']);
    expect(byQuery.items[0]).toMatchObject({ kind: 'template', title: 'Invoice' });

    const byKind = await storage.list({ kind: 'voucher' });
    expect(byKind.items.length).toBe(0);
  });

  it('list는 페이지 크기 단위로 커서 페이징한다', async () => {
    const storage = freshStorage(1);
    await storage.save('trade', presets[0]!.create());
    await storage.save('invoice', presets[1]!.create());

    const first = await storage.list();
    expect(first.items.length).toBe(1);
    expect(first.nextCursor).toBeDefined();

    const second = await storage.list(undefined, first.nextCursor);
    expect(second.items.length).toBe(1);
    expect(second.nextCursor).toBeUndefined();
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });
});

describe('IndexedDbStorage 열기 실패 복구', () => {
  it('열기가 실패해도 다음 호출이 다시 시도해 복구된다', async () => {
    const storage = freshStorage();

    const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      const req = {
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null,
        error: new Error('일시적 실패'),
      };
      setTimeout(() => req.onerror?.(), 0);
      return req as unknown as IDBOpenDBRequest;
    });

    await expect(storage.save('doc', presets[0]!.create())).rejects.toMatchObject({
      name: 'SlipStorageError',
      code: 'io',
    });
    spy.mockRestore();

    // 첫 열기 실패 후 같은 어댑터가 데이터베이스 열기를 다시 시도해야 한다.
    await storage.save('doc', presets[0]!.create());
    const loaded = await storage.load('doc');
    expect(loaded.kind).toBe('template');
  });

  it('v1(문자열 본문)으로 저장된 것을 현재 버전(Blob·메타데이터)으로 마이그레이션해 로드한다', async () => {
    const dbName = `test-mig-${++dbCounter}`;
    const file = presets[0]!.create();
    // 버전 1 레코드는 본문을 문자열로 저장한다.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('slips', { keyPath: 'id' });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('slips', 'readwrite');
        tx.objectStore('slips').put({
          id: 'old-1',
          kind: file.kind,
          title: 'old',
          updatedAt: '2026-01-01T00:00:00.000Z',
          data: serializeSlipFile(file),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // 현재 버전으로 열 때 문자열 본문을 Blob으로 바꾸고 목록용 메타데이터를 채운다.
    const storage = new IndexedDbStorage(plainKit, { dbName });
    const loaded = await storage.load('old-1');
    expect(loaded).toEqual(file);
    const page = await storage.list();
    expect(page.items).toEqual([
      { id: 'old-1', kind: file.kind, title: 'old', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const raw = await readRawRecord(dbName, 'old-1');
    expect(raw.data).toBe(serializeSlipFile(file));
  });

  it('v2(Blob 본문, 메타데이터 스토어 없음)를 업그레이드해도 기존 데이터를 보존하고 목록에 보인다', async () => {
    const dbName = `test-mig-${++dbCounter}`;
    const file = presets[1]!.create();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 2);
      req.onupgradeneeded = () => req.result.createObjectStore('slips', { keyPath: 'id' });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('slips', 'readwrite');
        tx.objectStore('slips').put({
          id: 'v2-1',
          kind: file.kind,
          title: 'v2 제목',
          updatedAt: '2026-02-02T00:00:00.000Z',
          data: new Blob([serializeSlipFile(file)]),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const storage = new IndexedDbStorage(plainKit, { dbName });
    expect((await storage.list()).items).toEqual([
      { id: 'v2-1', kind: file.kind, title: 'v2 제목', updatedAt: '2026-02-02T00:00:00.000Z' },
    ]);
    expect(await storage.load('v2-1')).toEqual(file);
    // 업그레이드 뒤 저장·삭제도 메타데이터와 본문을 함께 다룬다.
    await storage.save('v2-2', presets[0]!.create());
    expect((await storage.list()).items.map((i) => i.id)).toEqual(['v2-2', 'v2-1']);
    await storage.delete('v2-1');
    expect((await storage.list()).items.map((i) => i.id)).toEqual(['v2-2']);
    await expect(storage.load('v2-1')).rejects.toMatchObject({ code: 'not-found' });
  });
});

/** 저장된 레코드의 본문과 제목을 IndexedDB에서 직접 읽는다. */
function readRawRecord(dbName: string, id: string): Promise<{ data: string; title: string }> {
  return new Promise((resolve, reject) => {
    // 버전을 지정하지 않고 열어 현재 스키마 버전을 그대로 쓴다.
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('slips', 'readonly').objectStore('slips').get(id);
      get.onsuccess = () => {
        const rec = get.result as { data: Blob | string; title: string };
        const done = (data: string) => {
          db.close();
          resolve({ data, title: rec.title });
        };
        if (typeof rec.data === 'string') done(rec.data);
        else rec.data.text().then(done).catch(reject);
      };
      get.onerror = () => reject(get.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('IndexedDbStorage 암호화 — 공통 키 재사용', () => {
  it('createSlipKit에 키를 한 번 설정하면 encryptOnSave: true 저장을 그 키로 잠그고 푼다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    const slipkit = createSlipKit({ encryption: { key: '내-키' } });
    const storage = new IndexedDbStorage(slipkit, { dbName, encryptOnSave: true });

    await storage.save('doc', file);
    expect(await storage.load('doc')).toEqual(file);

    const raw = await readRawRecord(dbName, 'doc');
    expect(isEncryptedSlipFile(raw.data)).toBe(true); // 본문은 잠겨 있다
    expect(raw.title).toBe(file.template.meta.title); // 제목은 평문 — 목록에 그대로 보인다
  });

  it('encryptOnSave를 켰는데 키가 없으면 샘플 키로 대체하지 않고 저장을 거부한다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const storage = new IndexedDbStorage(plainKit, { dbName, encryptOnSave: true });
    await expect(storage.save('doc', presets[0]!.create())).rejects.toMatchObject({
      name: 'SlipEncryptionError',
    });
  });

  it('키 없는 설정으로 암호화 저장분을 읽으면 샘플 키로 대체하지 않고 오류를 던진다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const slipkit = createSlipKit({ encryption: { key: '내-키' } });
    await new IndexedDbStorage(slipkit, { dbName, encryptOnSave: true }).save('doc', presets[0]!.create());

    const keyless = new IndexedDbStorage(plainKit, { dbName });
    await expect(keyless.load('doc')).rejects.toMatchObject({ name: 'SlipEncryptionError' });
  });

  it('틀린 키로 열면 복호화 오류를 던진다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const right = createSlipKit({ encryption: { key: '맞는-키' } });
    await new IndexedDbStorage(right, { dbName, encryptOnSave: true }).save('doc', presets[0]!.create());

    const wrong = new IndexedDbStorage(createSlipKit({ encryption: { key: '틀린-키' } }), {
      dbName,
      encryptOnSave: true,
    });
    await expect(wrong.load('doc')).rejects.toMatchObject({ name: 'SlipEncryptionError' });
  });

  it('encryptOnSave: false면 평문으로 저장되고, 키 설정과 무관하게 읽힌다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    const keyed = createSlipKit({ encryption: { key: '키' } });
    await new IndexedDbStorage(keyed, { dbName, encryptOnSave: false }).save('doc', file);

    const raw = await readRawRecord(dbName, 'doc');
    expect(isEncryptedSlipFile(raw.data)).toBe(false);

    // 평문 레코드는 암호화 키 설정과 관계없이 파싱한다.
    const other = new IndexedDbStorage(createSlipKit({ encryption: { key: '다른-키' } }), {
      dbName,
      encryptOnSave: true,
    });
    expect(await other.load('doc')).toEqual(file);
  });

  it('키를 바꿔도 previousKeys로 옛 키 파일을 읽고, 다시 저장하면 새 키로 옮겨진다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    // 이전 키로 암호화된 레코드를 준비한다.
    const oldKit = createSlipKit({ encryption: { key: '옛-키' } });
    await new IndexedDbStorage(oldKit, { dbName, encryptOnSave: true }).save('doc', file);

    // 현재 키가 실패하면 previousKeys의 이전 키로 복호화한다.
    const rotatedKit = createSlipKit({ encryption: { key: '새-키', previousKeys: ['옛-키'] } });
    const rotated = new IndexedDbStorage(rotatedKit, { dbName, encryptOnSave: true });
    expect(await rotated.load('doc')).toEqual(file);

    // 다시 저장한 본문은 현재 키로 암호화한다.
    await rotated.save('doc', file);
    const newOnly = new IndexedDbStorage(createSlipKit({ encryption: { key: '새-키' } }), {
      dbName,
      encryptOnSave: true,
    });
    expect(await newOnly.load('doc')).toEqual(file);
  });

  it('encryptOnSave를 꺼도 키를 남겨 두면 예전에 잠근 파일을 계속 읽는다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    const keyed = createSlipKit({ encryption: { key: '키' } });
    await new IndexedDbStorage(keyed, { dbName, encryptOnSave: true }).save('doc', file);

    // 저장 정책을 평문으로 바꿔도 기존 봉투는 감지해 공통 키로 복호화한다.
    const off = new IndexedDbStorage(keyed, { dbName, encryptOnSave: false });
    expect(await off.load('doc')).toEqual(file);
  });

  it('공통 설정 도입 전 샘플 키로 저장된 데이터도 previousKeys 등록으로 열린다', async () => {
    // 공통 설정 도입 전 데모의 자동 저장이 쓰던 키 값 — 회귀 방지를 위해 값을 고정한다.
    const legacyKey = 'omdc-slipkit-sample-key';
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    const legacyKit = createSlipKit({ encryption: { key: legacyKey } });
    await new IndexedDbStorage(legacyKit, { dbName, encryptOnSave: true }).save('doc', file);

    const current = new IndexedDbStorage(
      createSlipKit({ encryption: { key: '자체-키', previousKeys: [legacyKey] } }),
      { dbName },
    );
    expect(await current.load('doc')).toEqual(file);
  });

  it('자동 저장(IndexedDB)과 파일 교환이 같은 공통 키를 사용한다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    const slipkit = createSlipKit({ encryption: { key: '공용-키' } });
    await new IndexedDbStorage(slipkit, { dbName, encryptOnSave: true }).save('doc', file);

    // 저장소가 만든 암호화 봉투를 같은 인스턴스의 decrypt(파일 교환의 열기 경로)로 풀 수 있다.
    const raw = await readRawRecord(dbName, 'doc');
    expect(await slipkit.decrypt(raw.data)).toEqual(file);
  });
});

// ---------------------------------------------------------------------------
// 연결 상태와 페이지 크기
// ---------------------------------------------------------------------------

/** 어댑터가 쓰는 연결을 꺼내 온다. */
function openedDb(storage: IndexedDbStorage): Promise<IDBDatabase> {
  return (storage as unknown as { open(): Promise<IDBDatabase> }).open();
}

describe('IndexedDbStorage 연결 상태', () => {
  it('다른 연결이 열려 있어 버전을 올리지 못하면 기다리지 않고 io 오류로 거부하고, 닫힌 뒤에는 복구된다', async () => {
    const dbName = `test-blocked-${++dbCounter}`;
    // 버전 1 연결을 versionchange에 닫지 않고 붙들어 둔다.
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('slips', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const storage = new IndexedDbStorage(plainKit, { dbName });
    const error = await storage.save('doc', presets[0]!.create()).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'SlipStorageError', code: 'io' });
    expect((error as Error).message).toBe(getStrings().storage.openBlocked);

    held.close();
    await storage.save('doc', presets[0]!.create());
    expect((await storage.load('doc')).kind).toBe('template');
  });

  it('브라우저가 연결을 강제로 닫으면 다음 호출에서 다시 연다', async () => {
    const storage = freshStorage();
    await storage.save('doc', presets[0]!.create());
    const db = await openedDb(storage);
    db.close();
    db.onclose?.(new Event('close'));

    expect((await storage.load('doc')).kind).toBe('template');
    expect(await openedDb(storage)).not.toBe(db);
  });

  it('닫힌 연결로 트랜잭션을 열면 SlipStorageError로 알리고 다음 호출은 복구된다', async () => {
    const storage = freshStorage();
    await storage.save('doc', presets[0]!.create());
    (await openedDb(storage)).close();

    await expect(storage.list()).rejects.toMatchObject({ name: 'SlipStorageError', code: 'io' });
    expect((await storage.list()).items.map((i) => i.id)).toEqual(['doc']);
  });

  it('다른 탭이 데이터베이스를 지우면(versionchange) 연결을 닫고 다음 호출에서 새로 만든다', async () => {
    const dbName = `test-vc-${++dbCounter}`;
    const storage = new IndexedDbStorage(plainKit, { dbName });
    await storage.save('doc', presets[0]!.create());

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    expect((await storage.list()).items).toEqual([]);
    await storage.save('doc', presets[0]!.create());
    expect((await storage.load('doc')).kind).toBe('template');
  });
});

describe('IndexedDbStorage pageSize', () => {
  it.each([0, -1, 1.5, Infinity, Number.NaN, 2 ** 53])('pageSize %s는 생성자에서 거부한다', (pageSize) => {
    expect(() => new IndexedDbStorage(plainKit, { dbName: 'x', pageSize })).toThrow(RangeError);
    expect(() => new IndexedDbStorage(plainKit, { dbName: 'x', pageSize })).toThrow(
      getStrings().storage.badPageSize,
    );
  });

  it('가장 큰 안전한 정수는 허용한다', async () => {
    const storage = freshStorage(Number.MAX_SAFE_INTEGER);
    await storage.save('doc', presets[0]!.create());
    expect((await storage.list()).items.length).toBe(1);
  });

  it('커서는 항상 앞으로 나아가 모든 항목을 한 번씩 돌려준다', async () => {
    const storage = freshStorage(2);
    for (let i = 0; i < 5; i += 1) await storage.save(`doc-${i}`, presets[i % 2]!.create());

    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await storage.list(undefined, cursor);
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
      if (pages > 5) throw new Error('커서가 앞으로 나아가지 않습니다');
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(5);
  });

  it('잘못된 커서는 io 오류로 거부한다', async () => {
    const storage = freshStorage();
    await expect(storage.list(undefined, 'abc')).rejects.toMatchObject({ code: 'io' });
    await expect(storage.list(undefined, '-1')).rejects.toMatchObject({ code: 'io' });
  });
});

describe('IndexedDbStorage 목록은 본문을 읽지 않는다', () => {
  it('list는 메타데이터 스토어만 열고 Blob 본문을 읽지 않는다', async () => {
    const storage = freshStorage(10);
    for (let i = 0; i < 30; i += 1) await storage.save(`doc-${i}`, presets[i % 2]!.create());

    const text = vi.spyOn(Blob.prototype, 'text');
    const arrayBuffer = vi.spyOn(Blob.prototype, 'arrayBuffer');
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');

    const page = await storage.list({ query: 'inv' });
    expect(page.items.length).toBeGreaterThan(0);
    expect(text).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]![0]).toBe('slip-meta');

    text.mockRestore();
    arrayBuffer.mockRestore();
    transaction.mockRestore();
  });
});
