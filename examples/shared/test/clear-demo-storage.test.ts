// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { SlipStorageError, type SlipFile, type SlipListPage, type StorageAdapter } from '@omdc-slipkit/core';
import {
  AUTOSAVE_KEYS,
  DEMO_SAMPLE_KEY,
  ISSUED_KEY,
  MODE_KEY,
  TEMPLATE_KEY,
  VOUCHER_KEY,
  clearDemoStorage,
  resolveDemoEncryption,
  usesDemoSampleKey,
} from '../src/index.js';

/** 지운 키를 순서대로 기록하고, 지정한 키에서만 실패하는 시험용 저장소 */
class FakeStore implements StorageAdapter {
  readonly deleted: string[] = [];
  readonly items = new Set<string>();

  constructor(keys: string[], private readonly failOn: string[] = []) {
    for (const key of keys) this.items.add(key);
  }

  save(): Promise<void> {
    throw new Error('시험에서 사용하지 않습니다');
  }

  load(): Promise<SlipFile> {
    throw new Error('시험에서 사용하지 않습니다');
  }

  async delete(id: string): Promise<void> {
    this.deleted.push(id);
    if (this.failOn.includes(id)) throw new SlipStorageError('io', `삭제 실패: ${id}`);
    this.items.delete(id);
  }

  list(): Promise<SlipListPage> {
    throw new Error('시험에서 사용하지 않습니다');
  }
}

describe('clearDemoStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('자동 저장 키 세 개를 정해진 순서로 한 번씩 지운다', async () => {
    const store = new FakeStore([TEMPLATE_KEY, VOUCHER_KEY, ISSUED_KEY]);

    await clearDemoStorage(store);

    expect(store.deleted).toEqual([TEMPLATE_KEY, VOUCHER_KEY, ISSUED_KEY]);
    expect(store.deleted).toEqual([...AUTOSAVE_KEYS]);
    expect(store.items.size).toBe(0);
  });

  it('마지막으로 보던 화면 기억도 함께 지운다', async () => {
    localStorage.setItem(MODE_KEY, 'fill');

    await clearDemoStorage(new FakeStore([]));

    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it('removeMode가 false면 마지막으로 보던 화면 기억을 남긴다', async () => {
    localStorage.setItem(MODE_KEY, 'view');

    await clearDemoStorage(new FakeStore([]), { removeMode: false });

    expect(localStorage.getItem(MODE_KEY)).toBe('view');
  });

  it('데모가 만들지 않은 저장 항목은 지우지 않는다', async () => {
    const store = new FakeStore([TEMPLATE_KEY, 'my-template', 'other-demo']);
    localStorage.setItem('unrelated', 'keep');

    await clearDemoStorage(store);

    expect(store.deleted).not.toContain('my-template');
    expect(store.deleted).not.toContain('other-demo');
    expect([...store.items]).toEqual(['my-template', 'other-demo']);
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('키 하나를 지우지 못하면 나머지를 모두 시도한 뒤 오류를 알린다', async () => {
    const store = new FakeStore([TEMPLATE_KEY, VOUCHER_KEY, ISSUED_KEY], [VOUCHER_KEY]);
    localStorage.setItem(MODE_KEY, 'fill');

    await expect(clearDemoStorage(store)).rejects.toThrow(SlipStorageError);

    expect(store.deleted).toEqual([TEMPLATE_KEY, VOUCHER_KEY, ISSUED_KEY]);
    expect([...store.items]).toEqual([VOUCHER_KEY]);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });
});

describe('usesDemoSampleKey', () => {
  it('키를 설정하지 않으면 샘플 키를 쓴다고 알린다', () => {
    expect(usesDemoSampleKey(undefined)).toBe(true);
    expect(usesDemoSampleKey('')).toBe(true);
    expect(usesDemoSampleKey('   ')).toBe(true);
    expect(resolveDemoEncryption(undefined).key).toBe(DEMO_SAMPLE_KEY);
  });

  it('자체 키를 설정하면 샘플 키를 쓰지 않는다고 알린다', () => {
    expect(usesDemoSampleKey('my-key')).toBe(false);
    expect(usesDemoSampleKey('  my-key  ')).toBe(false);
    expect(resolveDemoEncryption('my-key').key).toBe('my-key');
  });
});
