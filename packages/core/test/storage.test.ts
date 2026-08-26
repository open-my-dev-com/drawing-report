import { describe, expect, it } from 'vitest';
import { SlipStorageError, supportsVersions, type StorageAdapter } from '../src/index.js';

function makeAdapter(extra: Record<string, unknown> = {}): StorageAdapter {
  return {
    save: () => Promise.resolve(),
    load: () => Promise.reject(new SlipStorageError('not-found', '저장된 파일이 없습니다')),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ items: [] }),
    ...extra,
  } as StorageAdapter;
}

describe('supportsVersions (선택적 버전 이력 인터페이스, ADR-021)', () => {
  it('listVersions·loadVersion을 모두 구현한 어댑터만 true', () => {
    expect(supportsVersions(makeAdapter())).toBe(false);
    expect(supportsVersions(makeAdapter({ listVersions: () => Promise.resolve([]) }))).toBe(false);
    expect(
      supportsVersions(
        makeAdapter({
          listVersions: () => Promise.resolve([]),
          loadVersion: () => Promise.reject(new Error('없음')),
        }),
      ),
    ).toBe(true);
  });
});

describe('SlipStorageError', () => {
  it('code와 메시지를 담는다', () => {
    const error = new SlipStorageError('unsupported', '지원하지 않습니다');
    expect(error.name).toBe('SlipStorageError');
    expect(error.code).toBe('unsupported');
    expect(error.message).toBe('지원하지 않습니다');
    expect(error).toBeInstanceOf(Error);
  });
});
