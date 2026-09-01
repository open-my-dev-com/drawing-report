// 폰트의 브라우저 등록과 재사용 — 대역으로 등록 성공·중복·실패와 출처 분리를 확인합니다.
import { describe, expect, it, vi } from 'vitest';
import type { SlipFont } from '@omdc-slipkit/core';
import {
  FontRegistryController,
  browserFontFaceAdapter,
  fontSourceKey,
  type FontFaceAdapter,
} from '../../src/designer/controllers/font-registry.js';

const FONTS: SlipFont[] = [
  { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
  { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
];

/** 등록 요청을 기록하고 결과를 지정할 수 있는 대역 */
function stubAdapter(fail = false) {
  const calls: string[] = [];
  const adapter: FontFaceAdapter = {
    register(family) {
      calls.push(family);
      return fail ? Promise.reject(new Error('읽기 실패')) : Promise.resolve();
    },
  };
  return { adapter, calls };
}

function makeHost() {
  return { requestUpdate: vi.fn() };
}

/** 등록 Promise가 처리될 때까지 기다립니다. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FontRegistryController', () => {
  it('가져온 폰트의 이름과 대체 폰트를 노출한다', async () => {
    const registry = new FontRegistryController(makeHost(), stubAdapter().adapter);
    registry.use({}, () => Promise.resolve(FONTS));
    await settle();
    expect(registry.fontNames).toEqual(['Pretendard', 'Pretendard-Bold']);
    expect(registry.fallbackName).toBe('Pretendard');
  });

  it('요청한 폰트만 등록하고 등록이 끝나야 CSS 이름을 준다', async () => {
    const { adapter, calls } = stubAdapter();
    const registry = new FontRegistryController(makeHost(), adapter);
    registry.use({}, () => Promise.resolve(FONTS));
    await settle();

    expect(registry.familyOf('Pretendard')).toBeUndefined();
    registry.ensure(['Pretendard']);
    expect(calls).toHaveLength(1);
    expect(registry.familyOf('Pretendard')).toBeUndefined();
    await settle();
    expect(registry.familyOf('Pretendard')).toBe(calls[0]);
    expect(registry.familyOf('Pretendard-Bold')).toBeUndefined();
  });

  it('같은 폰트를 다시 요청해도 등록을 반복하지 않는다', async () => {
    const { adapter, calls } = stubAdapter();
    const registry = new FontRegistryController(makeHost(), adapter);
    registry.use({}, () => Promise.resolve(FONTS));
    await settle();
    registry.ensure(['Pretendard', 'Pretendard']);
    registry.ensure(['Pretendard']);
    await settle();
    registry.ensure(['Pretendard']);
    expect(calls).toEqual([calls[0]]);
  });

  it('등록 목록에 없는 이름과 undefined는 건너뛴다', async () => {
    const { adapter, calls } = stubAdapter();
    const registry = new FontRegistryController(makeHost(), adapter);
    registry.use({}, () => Promise.resolve(FONTS));
    await settle();
    registry.ensure(['NoSuchFont', undefined]);
    expect(calls).toEqual([]);
    expect(registry.familyOf('NoSuchFont')).toBeUndefined();
  });

  it('출처가 다르면 이름이 같아도 CSS 이름을 나눈다', async () => {
    const { adapter } = stubAdapter();
    const first = new FontRegistryController(makeHost(), adapter);
    const second = new FontRegistryController(makeHost(), adapter);
    first.use({}, () => Promise.resolve(FONTS));
    second.use({}, () => Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([9]) }]));
    await settle();
    first.ensure(['Pretendard']);
    second.ensure(['Pretendard']);
    await settle();
    expect(first.familyOf('Pretendard')).not.toBe(second.familyOf('Pretendard'));
  });

  it('같은 출처는 다른 디자이너에서도 폰트를 다시 가져오지 않는다', async () => {
    const load = vi.fn(() => Promise.resolve(FONTS));
    const key = {};
    const first = new FontRegistryController(makeHost(), stubAdapter().adapter);
    const second = new FontRegistryController(makeHost(), stubAdapter().adapter);
    first.use(key, load);
    await settle();
    second.use(key, load);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(second.fontNames).toEqual(['Pretendard', 'Pretendard-Bold']);
  });

  it('등록에 실패하면 CSS 이름을 주지 않고 실패 상태를 알린다', async () => {
    const host = makeHost();
    const registry = new FontRegistryController(host, stubAdapter(true).adapter);
    registry.use({}, () => Promise.resolve(FONTS));
    await settle();
    registry.ensure(['Pretendard']);
    await settle();
    expect(registry.familyOf('Pretendard')).toBeUndefined();
    expect(registry.failed('Pretendard')).toBe(true);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('등록 수단이 없으면 예외 없이 대체 폰트 상태로 남는다', async () => {
    const registry = new FontRegistryController(makeHost(), null);
    registry.use({}, () => Promise.resolve(FONTS));
    await settle();
    expect(() => registry.ensure(['Pretendard'])).not.toThrow();
    expect(registry.familyOf('Pretendard')).toBeUndefined();
    expect(registry.failed('Pretendard')).toBe(false);
    expect(registry.fallbackName).toBe('Pretendard');
  });

  it('폰트를 가져오기 전에는 빈 목록을 준다', () => {
    const registry = new FontRegistryController(makeHost(), stubAdapter().adapter);
    expect(registry.fontNames).toEqual([]);
    expect(registry.fallbackName).toBeUndefined();
    expect(registry.familyOf('Pretendard')).toBeUndefined();
  });
});

describe('fontSourceKey', () => {
  it('slipkit 인스턴스가 있으면 그 인스턴스를 키로 쓴다', () => {
    const slipkit = {};
    expect(fontSourceKey(slipkit, 'ko')).toBe(slipkit);
    expect(fontSourceKey(slipkit, 'ja')).toBe(slipkit);
  });

  it('인스턴스가 없으면 로케일별로 키를 나눈다', () => {
    expect(fontSourceKey(undefined, 'ko')).toBe(fontSourceKey(undefined, 'ko'));
    expect(fontSourceKey(undefined, 'ko')).not.toBe(fontSourceKey(undefined, 'ja'));
  });
});

describe('browserFontFaceAdapter', () => {
  it('FontFace가 없는 환경에서는 등록 수단을 만들지 않는다', () => {
    expect(browserFontFaceAdapter()).toBeNull();
  });
});
