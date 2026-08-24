import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { serializeSlipFile, isEncryptedSlipFile } from '@omdc-slipkit/core';
import { IndexedDbStorage } from '../src/storage/indexeddb-storage.js';
import { SAMPLE_ENCRYPTION_KEY } from '../src/storage/encryption.js';
import { presets } from '../src/presets.js';

// fake-indexeddb로 실제 IndexedDB 동작을 재현한다 — core 모킹 없음

let dbCounter = 0;
function freshStorage(pageSize?: number): IndexedDbStorage {
  const options: { dbName: string; pageSize?: number } = { dbName: `test-db-${++dbCounter}` };
  if (pageSize !== undefined) options.pageSize = pageSize;
  return new IndexedDbStorage(options);
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

    const byQuery = await storage.list({ query: '청구' });
    expect(byQuery.items.map((i) => i.id)).toEqual(['invoice']);
    expect(byQuery.items[0]).toMatchObject({ kind: 'template', title: '청구서' });

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

    // 실패한 열기가 캐시로 남아 있지 않아야 한다
    await storage.save('doc', presets[0]!.create());
    const loaded = await storage.load('doc');
    expect(loaded.kind).toBe('template');
  });

  it('v1(문자열 본문)으로 저장된 것을 v2(Blob)로 마이그레이션해 로드한다 (ADR-045)', async () => {
    const dbName = `test-mig-${++dbCounter}`;
    const file = presets[0]!.create();
    // 옛 v1 형식으로 직접 저장한다 — data가 문자열
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

    // v2로 열며 마이그레이션 → 문자열 본문도 그대로 로드된다
    const storage = new IndexedDbStorage({ dbName });
    const loaded = await storage.load('old-1');
    expect(loaded).toEqual(file);
    // 목록에도 그대로 나온다
    const page = await storage.list();
    expect(page.items.map((i) => i.id)).toContain('old-1');
  });
});

/** 저장된 레코드의 본문(data)·메타(title)를 어댑터를 거치지 않고 직접 읽는다 */
function readRawRecord(dbName: string, id: string): Promise<{ data: string; title: string }> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 2);
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

describe('IndexedDbStorage 암호화 (ADR-055)', () => {
  it('키를 주면 저장 시 잠그고 같은 키로 풀어 원본을 돌려준다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    const storage = new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '내-키' } });

    await storage.save('doc', file);
    expect(await storage.load('doc')).toEqual(file);
  });

  it('키 없이 켜면 샘플 기본키로 잠근다 — 설정 없는 어댑터도 읽을 수 있다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    await new IndexedDbStorage({ dbName, encryption: { enabled: true } }).save('doc', file);

    // 설정 없는 어댑터(기본이 샘플키)로도, 샘플키를 명시한 어댑터로도 열린다
    expect(await new IndexedDbStorage({ dbName }).load('doc')).toEqual(file);
    const sample = new IndexedDbStorage({ dbName, encryption: { enabled: true, key: SAMPLE_ENCRYPTION_KEY } });
    expect(await sample.load('doc')).toEqual(file);
  });

  it('틀린 키로 열면 복호화 오류를 던진다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    await new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '맞는-키' } }).save(
      'doc',
      presets[0]!.create(),
    );

    const wrong = new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '틀린-키' } });
    await expect(wrong.load('doc')).rejects.toMatchObject({ name: 'SlipEncryptionError' });
  });

  it('비활성이면 평문으로 저장돼 아무 키 없이 그대로 읽힌다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    await new IndexedDbStorage({ dbName, encryption: { enabled: false, key: '키' } }).save('doc', file);

    // 평문이라 봉투가 아니므로 복호화를 타지 않는다 — 다른 키를 든 어댑터로도 읽힌다
    const other = new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '다른-키' } });
    expect(await other.load('doc')).toEqual(file);
  });

  it('본문은 암호화 봉투로, 제목 메타는 평문으로 저장된다 (목록 조회용)', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    await new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '키' } }).save('doc', file);

    const raw = await readRawRecord(dbName, 'doc');
    expect(isEncryptedSlipFile(raw.data)).toBe(true); // 본문은 잠겨 있다
    expect(raw.title).toBe(file.template.meta.title); // 제목은 평문 — 목록에 그대로 보인다
  });

  it('키를 바꿔도 previousKeys로 옛 키 파일을 읽고, 다시 저장하면 새 키로 옮겨진다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    // 옛 키로 저장
    await new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '옛-키' } }).save('doc', file);

    // 새 키 + 옛 키를 previousKeys로: 옛 파일이 그대로 열린다
    const rotated = new IndexedDbStorage({
      dbName,
      encryption: { enabled: true, key: '새-키', previousKeys: ['옛-키'] },
    });
    expect(await rotated.load('doc')).toEqual(file);

    // 다시 저장하면 새 키로 옮겨진다 — 옛 키 없이 새 키만으로 열린다
    await rotated.save('doc', file);
    const newOnly = new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '새-키' } });
    expect(await newOnly.load('doc')).toEqual(file);
  });

  it('암호화를 꺼도 키를 남겨 두면 예전에 잠근 파일을 계속 읽는다', async () => {
    const dbName = `test-enc-${++dbCounter}`;
    const file = presets[0]!.create();
    await new IndexedDbStorage({ dbName, encryption: { enabled: true, key: '키' } }).save('doc', file);

    // enabled:false여도 봉투는 자동 감지 — 남겨 둔 키로 읽힌다. 새 저장은 평문이 된다
    const off = new IndexedDbStorage({ dbName, encryption: { enabled: false, key: '키' } });
    expect(await off.load('doc')).toEqual(file);
  });
});
