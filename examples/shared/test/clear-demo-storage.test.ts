import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlipStorageError, type SlipFile, type SlipListPage, type StorageAdapter } from '@omdc-slipkit/core';
import {
  AUTOSAVE_KEYS,
  DEMO_SAMPLE_KEY,
  ISSUED_KEY,
  MODE_KEY,
  TEMPLATE_KEY,
  VOUCHER_KEY,
  clearDemoStorage,
  createDemoStorageQueue,
  demoFontLocale,
  getMessages,
  initialTemplate,
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

/** Node 버전의 내장 localStorage 상태와 무관하게 동작하는 시험용 구현 */
class FakeLocalStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new FakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearDemoStorage', () => {
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

describe('createDemoStorageQueue', () => {
  it('진행 중인 자동 저장이 끝난 뒤 저장 데이터 삭제를 시작한다', async () => {
    const calls: string[] = [];
    let finishSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const store: StorageAdapter = {
      async save(id: string): Promise<void> {
        calls.push(`save:start:${id}`);
        await saveGate;
        calls.push(`save:end:${id}`);
      },
      load(): Promise<SlipFile> {
        throw new Error('시험에서 사용하지 않습니다');
      },
      async delete(id: string): Promise<void> {
        calls.push(`delete:${id}`);
      },
      list(): Promise<SlipListPage> {
        throw new Error('시험에서 사용하지 않습니다');
      },
    };
    const queue = createDemoStorageQueue(store);

    const saving = queue.save([[TEMPLATE_KEY, initialTemplate('ko')]]);
    const clearing = queue.clear({ removeMode: false });
    await Promise.resolve();

    expect(calls).toEqual(['save:start:autosave-template']);
    finishSave();
    await Promise.all([saving, clearing]);
    expect(calls).toEqual([
      'save:start:autosave-template',
      'save:end:autosave-template',
      'delete:autosave-template',
      'delete:autosave-voucher',
      'delete:autosave-issued',
    ]);
  });

  it('앞선 작업이 실패해도 다음 삭제를 실행한다', async () => {
    const store = new FakeStore([]);
    const queue = createDemoStorageQueue(store);

    await expect(queue.save([[TEMPLATE_KEY, initialTemplate('ko')]])).rejects.toThrow('시험에서 사용하지 않습니다');
    await queue.clear({ removeMode: false });

    expect(store.deleted).toEqual([TEMPLATE_KEY, VOUCHER_KEY, ISSUED_KEY]);
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

describe('저장 데이터 삭제 안내 문구', () => {
  // 지우는 대상은 자동 저장분과 마지막으로 보던 화면뿐이므로, 남는 것도 함께 알려야 합니다.
  const kept = { ko: '내 양식', en: 'My templates', ja: 'マイテンプレート' } as const;

  for (const locale of ['ko', 'en', 'ja'] as const) {
    it(`${locale} 문구는 지우는 범위와 남는 양식을 함께 알린다`, () => {
      const messages = getMessages(locale);
      expect(messages.storageNotice).toContain(kept[locale]);
      expect(messages.clearConfirmBody).toContain(kept[locale]);
      expect(messages.cleared).toContain(kept[locale]);
    });
  }
});

describe('demoFontLocale', () => {
  it('일본어만 일본어 폰트를 고르고 나머지는 기본 폰트를 쓴다', () => {
    expect(demoFontLocale('ja-JP')).toBe('ja');
    expect(demoFontLocale('ko-KR')).toBe('ko');
    expect(demoFontLocale('en-US')).toBe('en');
    expect(demoFontLocale(undefined)).toBe('en');
  });
});
