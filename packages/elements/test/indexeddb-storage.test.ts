import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createSlipKit, serializeSlipFile, isEncryptedSlipFile } from '@omdc-slipkit/core';
import { IndexedDbStorage } from '../src/storage/indexeddb-storage.js';
import { getPresets } from '../src/presets.js';

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

  it('v1(문자열 본문)으로 저장된 것을 v2(Blob)로 마이그레이션해 로드한다 (ADR-045)', async () => {
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

    // 버전 2로 열 때 문자열 본문을 Blob으로 마이그레이션한다.
    const storage = new IndexedDbStorage(plainKit, { dbName });
    const loaded = await storage.load('old-1');
    expect(loaded).toEqual(file);
    const page = await storage.list();
    expect(page.items.map((i) => i.id)).toContain('old-1');
  });
});

/** 저장된 레코드의 본문과 제목을 IndexedDB에서 직접 읽는다. */
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
