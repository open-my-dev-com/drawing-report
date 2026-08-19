import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorage } from '../src/storage/indexeddb-storage.js';
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
});
