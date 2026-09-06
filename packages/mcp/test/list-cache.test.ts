import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename, symlink, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_SCHEMA_VERSION,
  encryptSlipFile,
  serializeSlipFile,
  type SlipListItem,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { FileSystemStorage } from '../src/storage.js';
import { LIST_METRICS, MAX_LSTAT_CONCURRENCY, type ListMetrics } from '../src/list-cache.js';
import { makeTemplate, makeWorkDir, removeWorkDir, symlinksUnavailable } from './helpers.js';

// 파일 접근 횟수를 계측과 따로 세고, 쓰기·삭제 실패를 흉내 낸다. 기본은 실제 구현을 그대로 쓴다.
const fsCalls = vi.hoisted(() => ({
  readFile: 0,
  lstat: 0,
  activeLstat: 0,
  maxLstat: 0,
  renameError: null as Error | null,
  unlinkErrorFor: null as string | null,
  reset(): void {
    fsCalls.readFile = 0;
    fsCalls.lstat = 0;
    fsCalls.activeLstat = 0;
    fsCalls.maxLstat = 0;
    fsCalls.renameError = null;
    fsCalls.unlinkErrorFor = null;
  },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  type AnyCall = (...args: unknown[]) => Promise<unknown>;
  return {
    ...actual,
    readFile: async (...args: unknown[]): Promise<unknown> => {
      fsCalls.readFile += 1;
      return (actual.readFile as unknown as AnyCall)(...args);
    },
    // 후보 지문을 구하는 호출만 센다. 경로 검사에 쓰는 호출은 bigint 옵션이 없다.
    lstat: async (...args: unknown[]): Promise<unknown> => {
      const bigint = (args[1] as { bigint?: unknown } | undefined)?.bigint === true;
      if (bigint) {
        fsCalls.lstat += 1;
        fsCalls.activeLstat += 1;
        if (fsCalls.activeLstat > fsCalls.maxLstat) fsCalls.maxLstat = fsCalls.activeLstat;
      }
      try {
        return await (actual.lstat as unknown as AnyCall)(...args);
      } finally {
        if (bigint) fsCalls.activeLstat -= 1;
      }
    },
    rename: async (from: string, to: string): Promise<void> => {
      if (fsCalls.renameError !== null) throw fsCalls.renameError;
      return actual.rename(from, to);
    },
    unlink: async (target: string): Promise<void> => {
      if (fsCalls.unlinkErrorFor !== null && target.endsWith(fsCalls.unlinkErrorFor)) {
        throw new Error('삭제 실패');
      }
      return actual.unlink(target);
    },
  };
});

/** 인스턴스에 붙은 목록 계측 값을 꺼낸다. */
function metricsOf(storage: FileSystemStorage): ListMetrics {
  const metrics = (storage as unknown as Record<symbol, ListMetrics | undefined>)[LIST_METRICS];
  if (metrics === undefined) throw new Error('목록 계측 값이 없습니다');
  return metrics;
}

/** 제목만 바꾼 양식 텍스트를 만든다. */
function templateText(title = '거래명세서'): string {
  const file = makeTemplate();
  file.template.meta.title = title;
  return serializeSlipFile(file);
}

/** 전표 텍스트를 만든다. */
function voucherText(title = '거래명세서'): string {
  const template = makeTemplate();
  template.template.meta.title = title;
  const file: SlipVoucherFile = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: template.template,
    values: { customerName: '홍길동' },
    issued: false,
  };
  return serializeSlipFile(file);
}

/** 파일 하나를 직접 쓴다. 필요한 디렉터리는 만든다. */
function writeSlip(dir: string, name: string, text: string): string {
  const abs = path.join(dir, name);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
  return abs;
}

/** 같은 내용의 유효한 양식 파일을 개수만큼 만든다. */
function writeBulk(dir: string, count: number, prefix = 'doc'): string[] {
  const text = templateText();
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = `${prefix}-${String(index).padStart(5, '0')}.slip`;
    writeFileSync(path.join(dir, name), text, 'utf8');
    names.push(name);
  }
  return names.sort();
}

/** 커서를 끝까지 따라가며 모든 페이지의 항목을 모은다. */
async function collectAll(
  storage: FileSystemStorage,
): Promise<{ items: SlipListItem[]; cursors: (string | undefined)[] }> {
  const items: SlipListItem[] = [];
  const cursors: (string | undefined)[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await storage.list(undefined, cursor);
    items.push(...page.items);
    cursors.push(page.nextCursor);
    if (page.nextCursor === undefined) return { items, cursors };
    // 커서가 앞으로 나아가지 않으면 무한 반복이므로 바로 실패시킨다.
    if (cursor !== undefined && Number(page.nextCursor) <= Number(cursor)) {
      throw new Error(`커서가 나아가지 않습니다: ${cursor} → ${page.nextCursor}`);
    }
    cursor = page.nextCursor;
  }
}

let dir: string;

beforeEach(async () => {
  fsCalls.reset();
  dir = await makeWorkDir();
});

afterEach(async () => {
  fsCalls.reset();
  await removeWorkDir(dir);
});

describe('목록 메타데이터 캐시', () => {
  it('두 번째 조회는 본문을 다시 읽지 않고 캐시한 항목을 쓴다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    writeSlip(dir, 'a.slip', templateText('가'));
    writeSlip(dir, 'sub/b.slip', templateText('나'));
    writeSlip(dir, 'c.slip', templateText('다'));

    const first = await storage.list();
    expect(first.items.map((item) => item.title)).toEqual(['가', '다', '나']);
    expect(metrics.bodyReads).toBe(3);
    expect(metrics.parses).toBe(3);
    expect(metrics.cacheMisses).toBe(3);
    expect(metrics.cachedEntries).toBe(3);

    metrics.reset();
    fsCalls.reset();
    const second = await storage.list();
    expect(second).toEqual(first);
    expect(metrics.bodyReads).toBe(0);
    expect(metrics.parses).toBe(0);
    expect(metrics.decryptAttempts).toBe(0);
    expect(fsCalls.readFile).toBe(0);
    expect(metrics.cacheHits).toBe(3);
    expect(metrics.cacheMisses).toBe(0);
  });

  it('다른 인스턴스는 캐시를 나눠 쓰지 않는다', async () => {
    writeSlip(dir, 'a.slip', templateText('가'));
    const first = new FileSystemStorage({ rootDir: dir });
    await first.list();
    const second = new FileSystemStorage({ rootDir: dir });
    await second.list();
    expect(metricsOf(second).bodyReads).toBe(1);
    expect(metricsOf(second).cacheHits).toBe(0);
  });

  it('lstat은 조회마다 후보 수만큼 하고 동시에 32개를 넘지 않는다', async () => {
    writeBulk(dir, 100);
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);

    await storage.list();
    expect(metrics.candidates).toBe(100);
    expect(metrics.lstat).toBe(100);
    expect(fsCalls.lstat).toBe(100);
    expect(metrics.maxConcurrentLstat).toBeLessThanOrEqual(MAX_LSTAT_CONCURRENCY);
    expect(metrics.maxConcurrentLstat).toBe(MAX_LSTAT_CONCURRENCY);
    expect(fsCalls.maxLstat).toBeLessThanOrEqual(MAX_LSTAT_CONCURRENCY);
    // 첫 페이지와 다음 페이지 존재 여부만 판정하면 되므로 51개까지만 연다.
    expect(metrics.bodyReads).toBe(51);

    metrics.reset();
    fsCalls.reset();
    await storage.list();
    expect(metrics.lstat).toBe(100);
    expect(fsCalls.lstat).toBe(100);
    expect(metrics.bodyReads).toBe(0);
    expect(metrics.maxConcurrentLstat).toBeLessThanOrEqual(MAX_LSTAT_CONCURRENCY);
  });

  it('다음 페이지는 앞 페이지가 캐시한 항목을 재사용하고 남은 항목만 읽는다', async () => {
    writeBulk(dir, 60);
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);

    const first = await storage.list();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe('50');
    expect(metrics.bodyReads).toBe(51);

    metrics.reset();
    fsCalls.reset();
    const second = await storage.list(undefined, '50');
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).toBeUndefined();
    expect(metrics.cacheHits).toBe(51);
    expect(metrics.bodyReads).toBe(9);
    expect(fsCalls.readFile).toBe(9);
  });

  it('커서를 끝까지 따라가면 모든 항목을 한 번씩만 얻는다', async () => {
    const names = writeBulk(dir, 120);
    const storage = new FileSystemStorage({ rootDir: dir });
    const { items, cursors } = await collectAll(storage);
    expect(items.map((item) => item.id)).toEqual(names);
    expect(new Set(items.map((item) => item.id)).size).toBe(120);
    expect(cursors).toEqual(['50', '100', undefined]);
  });

  it('필터를 바꿔도 이미 해석한 메타데이터를 다시 읽지 않는다', async () => {
    writeSlip(dir, 'alpha.slip', templateText('견적서'));
    writeSlip(dir, 'beta.slip', voucherText('거래명세서'));
    writeSlip(dir, 'sub/gamma.slip', templateText('청구서'));
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    await storage.list();
    expect(metrics.bodyReads).toBe(3);

    metrics.reset();
    fsCalls.reset();
    expect((await storage.list({ kind: 'voucher' })).items.map((item) => item.id)).toEqual([
      'beta.slip',
    ]);
    expect((await storage.list({ query: '청구' })).items.map((item) => item.id)).toEqual([
      path.join('sub', 'gamma.slip'),
    ]);
    expect((await storage.list({ query: 'ALPHA' })).items.map((item) => item.id)).toEqual([
      'alpha.slip',
    ]);
    expect((await storage.list({ kind: 'template', query: 'sub' })).items).toHaveLength(1);
    expect(metrics.bodyReads).toBe(0);
    expect(fsCalls.readFile).toBe(0);
    expect(metrics.cacheHits).toBe(12);
  });

  it('외부에서 만든 파일을 다음 조회에 넣는다', async () => {
    writeSlip(dir, 'a.slip', templateText('가'));
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    await storage.list();

    writeSlip(dir, 'b.slip', templateText('나'));
    metrics.reset();
    const page = await storage.list();
    expect(page.items.map((item) => item.title)).toEqual(['가', '나']);
    expect(metrics.bodyReads).toBe(1);
    expect(metrics.cacheHits).toBe(1);
  });

  it('내용·제목·종류가 바뀐 파일을 다시 읽는다', async () => {
    const abs = writeSlip(dir, 'a.slip', templateText('가'));
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    expect((await storage.list()).items[0]).toMatchObject({ kind: 'template', title: '가' });

    writeFileSync(abs, templateText('가나다라마'), 'utf8');
    metrics.reset();
    expect((await storage.list()).items[0]).toMatchObject({ title: '가나다라마' });
    expect(metrics.bodyReads).toBe(1);

    writeFileSync(abs, voucherText('전표'), 'utf8');
    metrics.reset();
    expect((await storage.list()).items[0]).toMatchObject({ kind: 'voucher', title: '전표' });
    expect(metrics.bodyReads).toBe(1);
  });

  it('크기와 수정 시각이 같은 원자적 교체도 다시 읽는다', async () => {
    const fixed = new Date('2026-01-02T03:04:05.000Z');
    const abs = writeSlip(dir, 'swap.slip', templateText('거래명세서'));
    await utimes(abs, fixed, fixed);
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    expect((await storage.list()).items[0]).toMatchObject({ title: '거래명세서' });

    // 같은 크기의 다른 내용을 임시 파일에 쓰고 이름을 바꿔 교체한 뒤 수정 시각을 되돌린다.
    const temp = path.join(dir, 'swap.tmp');
    const replaced = templateText('거래명세표');
    writeFileSync(temp, replaced, 'utf8');
    await rename(temp, abs);
    await utimes(abs, fixed, fixed);

    metrics.reset();
    const page = await storage.list();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ title: '거래명세표' });
    expect(page.items[0]?.updatedAt).toBe(fixed.toISOString());
    expect(metrics.bodyReads).toBe(1);
    expect(metrics.bodyBytes).toBe(Buffer.byteLength(replaced, 'utf8'));
  });

  it('외부 삭제와 이름 변경을 다음 조회에 반영한다', async () => {
    const abs = writeSlip(dir, 'a.slip', templateText('가'));
    writeSlip(dir, 'b.slip', templateText('나'));
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    await storage.list();
    expect(metrics.cachedEntries).toBe(2);

    await rename(abs, path.join(dir, 'z.slip'));
    metrics.reset();
    const renamed = await storage.list();
    expect(renamed.items.map((item) => item.id)).toEqual(['b.slip', 'z.slip']);
    expect(metrics.bodyReads).toBe(1);
    expect(metrics.cachedEntries).toBe(2);

    await unlink(path.join(dir, 'z.slip'));
    metrics.reset();
    const removed = await storage.list();
    expect(removed.items.map((item) => item.id)).toEqual(['b.slip']);
    expect(metrics.bodyReads).toBe(0);
    expect(metrics.cachedEntries).toBe(1);
  });

  it('손상된 파일의 제외 결과를 재사용하고 유효해지면 다시 판정한다', async () => {
    const abs = writeSlip(dir, 'x.slip', '{ 손상된 내용');
    writeSlip(dir, 'ok.slip', templateText('정상'));
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    expect((await storage.list()).items.map((item) => item.id)).toEqual(['ok.slip']);

    metrics.reset();
    expect((await storage.list()).items.map((item) => item.id)).toEqual(['ok.slip']);
    expect(metrics.excludedHits).toBe(1);
    expect(metrics.bodyReads).toBe(0);

    writeFileSync(abs, templateText('되살림'), 'utf8');
    metrics.reset();
    expect((await storage.list()).items.map((item) => item.title)).toEqual(['정상', '되살림']);
    expect(metrics.bodyReads).toBe(1);

    writeFileSync(abs, '다시 손상', 'utf8');
    metrics.reset();
    expect((await storage.list()).items.map((item) => item.id)).toEqual(['ok.slip']);
    expect(metrics.bodyReads).toBe(1);
    expect(metrics.excludedHits).toBe(0);
  });

  it('평문과 암호화 사이의 전환을 다시 판정한다', async () => {
    const abs = writeSlip(dir, 'doc.slip', templateText('평문'));
    const storage = new FileSystemStorage({ rootDir: dir, encryption: { key: '키' } });
    const metrics = metricsOf(storage);
    expect((await storage.list()).items[0]).toMatchObject({ title: '평문' });
    expect(metrics.decryptAttempts).toBe(0);

    const template = makeTemplate();
    template.template.meta.title = '봉투';
    writeFileSync(abs, await encryptSlipFile(template, '키'), 'utf8');
    metrics.reset();
    expect((await storage.list()).items[0]).toMatchObject({ title: '봉투' });
    expect(metrics.decryptAttempts).toBe(1);
    expect(metrics.parses).toBe(1);

    metrics.reset();
    expect((await storage.list()).items[0]).toMatchObject({ title: '봉투' });
    expect(metrics.decryptAttempts).toBe(0);
    expect(metrics.cacheHits).toBe(1);

    writeFileSync(abs, await encryptSlipFile(template, '다른-키'), 'utf8');
    metrics.reset();
    expect((await storage.list()).items).toEqual([]);
    expect(metrics.decryptAttempts).toBe(1);
  });

  it('이전 키로 연 파일을 재사용하고 맞는 키가 없으면 제외한 채 재사용한다', async () => {
    const template = makeTemplate();
    template.template.meta.title = '옛 키';
    writeSlip(dir, 'legacy.slip', await encryptSlipFile(template, '키3'));

    const rotated = new FileSystemStorage({
      rootDir: dir,
      encryption: { key: '키4', previousKeys: ['키1', '키2', '키3'] },
    });
    const rotatedMetrics = metricsOf(rotated);
    expect((await rotated.list()).items[0]).toMatchObject({ title: '옛 키' });
    // 현재 키와 이전 키를 순서대로 시도해 네 번째에 열린다.
    expect(rotatedMetrics.decryptAttempts).toBe(4);
    rotatedMetrics.reset();
    expect((await rotated.list()).items).toHaveLength(1);
    expect(rotatedMetrics.decryptAttempts).toBe(0);
    expect(rotatedMetrics.cacheHits).toBe(1);

    const wrong = new FileSystemStorage({ rootDir: dir, encryption: { key: '엉뚱한-키' } });
    const wrongMetrics = metricsOf(wrong);
    expect((await wrong.list()).items).toEqual([]);
    expect(wrongMetrics.decryptAttempts).toBe(1);
    wrongMetrics.reset();
    expect((await wrong.list()).items).toEqual([]);
    expect(wrongMetrics.decryptAttempts).toBe(0);
    expect(wrongMetrics.excludedHits).toBe(1);

    const none = new FileSystemStorage({ rootDir: dir });
    expect((await none.list()).items).toEqual([]);
  });

  it('save 성공은 캐시를 무효화하고 실패는 캐시를 유지한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    writeSlip(dir, 'doc.slip', templateText('처음'));
    await storage.list();
    expect(metrics.cachedEntries).toBe(1);

    const changed = makeTemplate();
    changed.template.meta.title = '저장으로 바꾼 제목';
    await storage.save('doc', changed);
    expect(metrics.cachedEntries).toBe(0);
    metrics.reset();
    expect((await storage.list()).items[0]).toMatchObject({ title: '저장으로 바꾼 제목' });
    expect(metrics.bodyReads).toBe(1);

    // 이름 바꾸기가 실패하면 파일도 캐시도 그대로다.
    fsCalls.renameError = new Error('rename 실패');
    await expect(storage.save('doc', makeTemplate())).rejects.toMatchObject({ code: 'io' });
    fsCalls.renameError = null;
    expect(metrics.cachedEntries).toBe(1);
    metrics.reset();
    expect((await storage.list()).items[0]).toMatchObject({ title: '저장으로 바꾼 제목' });
    expect(metrics.bodyReads).toBe(0);
    expect(metrics.cacheHits).toBe(1);
  });

  it('delete 성공은 캐시에서 지우고 실패는 캐시를 유지한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);
    writeSlip(dir, 'a.slip', templateText('가'));
    writeSlip(dir, 'b.slip', templateText('나'));
    await storage.list();
    expect(metrics.cachedEntries).toBe(2);

    fsCalls.unlinkErrorFor = 'a.slip';
    await expect(storage.delete('a')).rejects.toMatchObject({ code: 'io' });
    fsCalls.unlinkErrorFor = null;
    expect(metrics.cachedEntries).toBe(2);

    await storage.delete('a');
    expect(metrics.cachedEntries).toBe(1);
    metrics.reset();
    expect((await storage.list()).items.map((item) => item.id)).toEqual(['b.slip']);
    expect(metrics.bodyReads).toBe(0);

    // 없는 파일 삭제는 not-found로 끝나고 남은 캐시를 건드리지 않는다.
    await expect(storage.delete('a')).rejects.toMatchObject({ code: 'not-found' });
    expect(metrics.cachedEntries).toBe(1);
  });

  it('동시에 부른 list가 진행 중인 해석을 나눠 쓴다', async () => {
    writeSlip(dir, 'a.slip', templateText('가'));
    writeSlip(dir, 'b.slip', templateText('나'));
    writeSlip(dir, 'c.slip', templateText('다'));
    const storage = new FileSystemStorage({ rootDir: dir });
    const metrics = metricsOf(storage);

    const pages = await Promise.all([storage.list(), storage.list(), storage.list()]);
    expect(pages[1]).toEqual(pages[0]);
    expect(pages[2]).toEqual(pages[0]);
    expect(metrics.listCalls).toBe(3);
    expect(metrics.bodyReads).toBe(3);
    expect(fsCalls.readFile).toBe(3);
    expect(metrics.cacheMisses).toBe(3);
    expect(metrics.cachedEntries).toBe(3);
  });

  it('제외되는 파일이 앞에 섞여 있어도 페이지가 멈추지 않는다', async () => {
    const valid = writeBulk(dir, 60, 'doc');
    for (let index = 0; index < 10; index += 1) {
      writeSlip(dir, `0-broken-${index}.slip`, '{ 손상');
    }
    writeSlip(dir, '0-empty.slip', '');
    const storage = new FileSystemStorage({ rootDir: dir });

    const { items, cursors } = await collectAll(storage);
    expect(items.map((item) => item.id)).toEqual(valid);
    expect(cursors).toEqual(['50', undefined]);
    // 두 페이지를 도는 동안 후보 수는 매번 같고, 손상 파일은 두 번째부터 캐시한 제외 결과로 걸러진다.
    const metrics = metricsOf(storage);
    expect(metrics.listCalls).toBe(2);
    expect(metrics.candidates).toBe(71 * 2);
    expect(metrics.excludedHits).toBe(11);
    // 첫 페이지에서 손상 파일 11개와 유효 파일 51개를 열고, 다음 페이지에서 남은 9개만 더 연다.
    expect(metrics.bodyReads).toBe(11 + 51 + 9);
  });

  it.skipIf(symlinksUnavailable())(
    '캐시한 파일이 링크로 바뀌면 제외하고 본문을 읽지 않는다',
    async () => {
      const outside = await makeWorkDir();
      try {
        const abs = writeSlip(dir, 'own.slip', templateText('내 파일'));
        writeSlip(outside, 'secret.slip', templateText('바깥 파일'));
        const storage = new FileSystemStorage({ rootDir: dir });
        const metrics = metricsOf(storage);
        expect((await storage.list()).items.map((item) => item.id)).toEqual(['own.slip']);

        await unlink(abs);
        await symlink(path.join(outside, 'secret.slip'), abs, 'file');
        metrics.reset();
        fsCalls.reset();
        expect((await storage.list()).items).toEqual([]);
        expect(metrics.bodyReads).toBe(0);
        expect(fsCalls.readFile).toBe(0);
        expect(metrics.cachedEntries).toBe(0);
      } finally {
        await removeWorkDir(outside);
      }
    },
  );

  it.skipIf(symlinksUnavailable())(
    '링크된 디렉터리 아래로 옮긴 파일은 목록에서 빠진다',
    async () => {
      const outside = await makeWorkDir();
      try {
        writeSlip(dir, 'real/keep.slip', templateText('남는 파일'));
        writeSlip(outside, 'moved.slip', templateText('옮긴 파일'));
        await symlink(outside, path.join(dir, 'shared'), 'dir');
        const storage = new FileSystemStorage({ rootDir: dir });
        const metrics = metricsOf(storage);

        expect((await storage.list()).items.map((item) => item.id)).toEqual([
          path.join('real', 'keep.slip'),
        ]);
        metrics.reset();
        fsCalls.reset();
        expect((await storage.list()).items).toHaveLength(1);
        expect(fsCalls.readFile).toBe(0);
      } finally {
        await removeWorkDir(outside);
      }
    },
  );
});

describe('목록 메타데이터 캐시 — 대량 디렉터리', () => {
  let smallDir: string;
  let largeDir: string;
  let smallNames: string[];

  beforeAll(async () => {
    smallDir = await makeWorkDir();
    largeDir = await makeWorkDir();
    smallNames = writeBulk(smallDir, 1_000);
    writeBulk(largeDir, 10_000);
  });

  afterAll(() => {
    rmSync(smallDir, { recursive: true, force: true });
    rmSync(largeDir, { recursive: true, force: true });
  });

  it('1,000개 디렉터리의 첫 페이지는 본문을 51개만 읽고 다시 조회하면 읽지 않는다', async () => {
    const storage = new FileSystemStorage({ rootDir: smallDir });
    const metrics = metricsOf(storage);
    fsCalls.reset();

    const page = await storage.list();
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe('50');
    expect(metrics.candidates).toBe(1_000);
    expect(metrics.lstat).toBe(1_000);
    // 첫 페이지와 다음 페이지 존재 여부를 판정할 만큼만 연다.
    expect(metrics.bodyReads).toBe(51);
    expect(metrics.parses).toBe(51);
    expect(fsCalls.readFile).toBe(51);
    expect(metrics.maxConcurrentLstat).toBeLessThanOrEqual(MAX_LSTAT_CONCURRENCY);

    metrics.reset();
    fsCalls.reset();
    const again = await storage.list();
    expect(again).toEqual(page);
    expect(metrics.bodyReads).toBe(0);
    expect(metrics.parses).toBe(0);
    expect(metrics.decryptAttempts).toBe(0);
    expect(fsCalls.readFile).toBe(0);
    expect(metrics.lstat).toBe(1_000);
    expect(metrics.cacheHits).toBe(51);
  });

  it('10,000개 디렉터리의 첫 페이지는 본문을 51개만 읽고 다시 조회하면 읽지 않는다', async () => {
    const storage = new FileSystemStorage({ rootDir: largeDir });
    const metrics = metricsOf(storage);
    fsCalls.reset();

    const page = await storage.list();
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe('50');
    expect(metrics.candidates).toBe(10_000);
    expect(metrics.lstat).toBe(10_000);
    // 첫 페이지와 다음 페이지 존재 여부를 판정할 만큼만 연다.
    expect(metrics.bodyReads).toBe(51);
    expect(metrics.parses).toBe(51);
    expect(fsCalls.readFile).toBe(51);
    expect(metrics.maxConcurrentLstat).toBeLessThanOrEqual(MAX_LSTAT_CONCURRENCY);
    expect(fsCalls.maxLstat).toBeLessThanOrEqual(MAX_LSTAT_CONCURRENCY);

    metrics.reset();
    fsCalls.reset();
    const again = await storage.list();
    expect(again).toEqual(page);
    expect(metrics.bodyReads).toBe(0);
    expect(metrics.parses).toBe(0);
    expect(metrics.decryptAttempts).toBe(0);
    expect(fsCalls.readFile).toBe(0);
    expect(metrics.lstat).toBe(10_000);
    expect(metrics.cacheHits).toBe(51);
  });

  it('1,000개 디렉터리를 커서로 끝까지 돌아도 항목이 겹치거나 빠지지 않는다', async () => {
    const storage = new FileSystemStorage({ rootDir: smallDir });
    const metrics = metricsOf(storage);
    const { items, cursors } = await collectAll(storage);
    expect(items.map((item) => item.id)).toEqual(smallNames);
    expect(new Set(items.map((item) => item.id)).size).toBe(1_000);
    expect(cursors).toHaveLength(20);
    expect(cursors[19]).toBeUndefined();
    // 순회가 끝나면 모든 항목이 캐시에 남고 본문은 파일마다 한 번씩만 읽는다.
    expect(metrics.bodyReads).toBe(1_000);
    expect(metrics.cachedEntries).toBe(1_000);
  });
});
