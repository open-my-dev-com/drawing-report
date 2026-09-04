import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEncryptedSlipFile, serializeSlipFile } from '@omdc-slipkit/core';
import { FileSystemStorage, assertInsideRootReal, resolveInRoot, writeFileAtomic } from '../src/storage.js';
import { makeTemplate, makeWorkDir, removeWorkDir, symlinksUnavailable } from './helpers.js';

// 이름 바꾸기 실패를 흉내 내기 위해 rename만 가로챈다. 기본은 실제 구현을 그대로 쓴다.
const renameFailure = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (renameFailure.error !== null) throw renameFailure.error;
      return actual.rename(from, to);
    },
  };
});

let dir: string;

beforeEach(async () => {
  dir = await makeWorkDir();
});

afterEach(async () => {
  renameFailure.error = null;
  await removeWorkDir(dir);
});

describe('FileSystemStorage', () => {
  it('save와 load가 왕복하고 .slip 확장자를 붙인다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('견적서', makeTemplate());
    expect(await storage.load('견적서.slip')).toEqual(makeTemplate());
    expect(await storage.load('견적서')).toEqual(makeTemplate());
  });

  it('하위 디렉터리 키를 지원하고 필요한 디렉터리를 만든다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('forms/2026/invoice', makeTemplate());
    expect(await storage.load('forms/2026/invoice')).toEqual(makeTemplate());
  });

  it('기준 디렉터리를 벗어나는 경로는 io 오류로 거부한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await expect(storage.load('../outside')).rejects.toMatchObject({
      name: 'SlipStorageError',
      code: 'io',
    });
    await expect(storage.save('/etc/passwd', makeTemplate())).rejects.toMatchObject({
      code: 'io',
    });
  });

  it('빈 이름과 디렉터리로 끝나는 이름은 이름 없는 .slip을 만들지 않고 거부한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    for (const id of ['', '.slip', 'sub/', 'sub/.slip']) {
      await expect(storage.save(id, makeTemplate()), id).rejects.toMatchObject({ code: 'io' });
      await expect(storage.load(id), id).rejects.toMatchObject({ code: 'io' });
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('점 두 개로 시작하는 정상 이름은 상위 디렉터리 참조로 오인하지 않는다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('..hidden', makeTemplate());
    expect(await storage.load('..hidden')).toEqual(makeTemplate());
    expect(resolveInRoot(dir, '...three')).toBe(path.join(dir, '...three'));
    expect(() => resolveInRoot(dir, '..')).toThrow(/outside the working directory/);
    expect(() => resolveInRoot(dir, '../x')).toThrow(/outside the working directory/);
    expect(() => resolveInRoot(dir, 'a/../../x')).toThrow(/outside the working directory/);
  });

  it('저장은 임시 파일을 남기지 않고, 이름 바꾸기가 실패하면 기존 파일을 그대로 둔다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    const original = makeTemplate();
    await storage.save('doc', original);
    expect(await readdir(dir)).toEqual(['doc.slip']);

    const changed = makeTemplate();
    changed.template.meta.title = '바뀐 제목';
    renameFailure.error = Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' });
    await expect(storage.save('doc', changed)).rejects.toMatchObject({
      code: 'io',
      message: expect.stringContaining('EXDEV') as string,
    });
    // 원본은 그대로이고 임시 파일도 남지 않는다.
    expect(await storage.load('doc')).toEqual(original);
    expect(await readdir(dir)).toEqual(['doc.slip']);
  });

  it('writeFileAtomic은 부모 디렉터리를 만들고 바이너리도 그대로 쓴다', async () => {
    const target = path.join(dir, 'out', 'nested', 'file.bin');
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff]);
    await writeFileAtomic(target, bytes);
    expect([...(await readFile(target))]).toEqual([...bytes]);
    expect(await readdir(path.join(dir, 'out', 'nested'))).toEqual(['file.bin']);
  });

  it('없는 파일은 not-found 오류를 던진다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await expect(storage.load('missing')).rejects.toMatchObject({ code: 'not-found' });
    await expect(storage.delete('missing')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('delete가 파일을 지운다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('doc', makeTemplate());
    await storage.delete('doc');
    await expect(storage.load('doc')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('list가 종류·검색어 필터와 제목을 반환한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('a-doc', makeTemplate());
    await storage.save('sub/b-doc', makeTemplate());
    // .slip이 아닌 파일과 손상된 파일은 목록에서 제외된다
    await writeFile(path.join(dir, 'note.txt'), 'x', 'utf8');
    await writeFile(path.join(dir, 'broken.slip'), '{ bad json', 'utf8');

    const page = await storage.list();
    expect(page.items.map((item) => item.id)).toEqual(['a-doc.slip', path.join('sub', 'b-doc.slip')]);
    expect(page.items[0]).toMatchObject({ kind: 'template', title: '거래명세서' });
    expect(page.nextCursor).toBeUndefined();

    expect((await storage.list({ kind: 'voucher' })).items).toEqual([]);
    expect((await storage.list({ query: 'b-doc' })).items).toHaveLength(1);
  });

  it('암호화를 설정하면 봉투로 저장하고 이전 키로도 복호화한다', async () => {
    const encrypted = new FileSystemStorage({ rootDir: dir, encryption: { key: '새-키' } });
    const legacy = new FileSystemStorage({ rootDir: dir, encryption: { key: '옛-키' } });
    await legacy.save('locked', makeTemplate());
    expect(isEncryptedSlipFile(await readFile(path.join(dir, 'locked.slip'), 'utf8'))).toBe(true);

    // 새 키만으로는 열 수 없다
    await expect(encrypted.load('locked')).rejects.toMatchObject({ name: 'SlipEncryptionError' });

    const rotated = new FileSystemStorage({
      rootDir: dir,
      encryption: { key: '새-키', previousKeys: ['옛-키'] },
    });
    expect(await rotated.load('locked')).toEqual(makeTemplate());
  });

  it('키가 없으면 암호화 파일을 안내 문구와 함께 거부하고, 평문 파일은 그대로 읽는다', async () => {
    const withKey = new FileSystemStorage({ rootDir: dir, encryption: { key: '키' } });
    await withKey.save('locked', makeTemplate());
    const plain = new FileSystemStorage({ rootDir: dir });
    await expect(plain.load('locked')).rejects.toMatchObject({
      code: 'io',
      message: expect.stringContaining('SLIPKIT_MCP_KEY') as string,
    });

    await writeFile(path.join(dir, 'open.slip'), serializeSlipFile(makeTemplate()), 'utf8');
    expect(await withKey.load('open')).toEqual(makeTemplate());
  });
});

// 기준 디렉터리 안의 심볼릭 링크를 거쳐 밖의 파일에 닿는 경로를 막는지 실제 링크로 확인한다.
// Windows에서 링크 생성 권한이 없을 때만 건너뛴다.
describe.skipIf(symlinksUnavailable())('FileSystemStorage (심볼릭 링크)', () => {
  /** 기준 디렉터리 밖의 디렉터리 */
  let outside: string;

  beforeEach(async () => {
    outside = await makeWorkDir();
  });

  afterEach(async () => {
    await removeWorkDir(outside);
  });

  /** 링크가 그대로 남아 있는지 확인한다. */
  async function isLink(target: string): Promise<boolean> {
    return (await lstat(target)).isSymbolicLink();
  }

  it('밖을 가리키는 파일 링크로는 읽지도 쓰지도 지우지도 않는다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    const secret = path.join(outside, 'secret.slip');
    await writeFile(secret, serializeSlipFile(makeTemplate()), 'utf8');
    await symlink(secret, path.join(dir, 'link.slip'), 'file');

    await expect(storage.load('link')).rejects.toMatchObject({
      code: 'io',
      message: expect.stringContaining('outside the working directory') as string,
    });

    const changed = makeTemplate();
    changed.template.meta.title = '바뀐 제목';
    await expect(storage.save('link', changed)).rejects.toMatchObject({ code: 'io' });
    expect(await readFile(secret, 'utf8')).toBe(serializeSlipFile(makeTemplate()));
    expect(await isLink(path.join(dir, 'link.slip'))).toBe(true);

    await expect(storage.delete('link')).rejects.toMatchObject({ code: 'io' });
    expect(await isLink(path.join(dir, 'link.slip'))).toBe(true);
    expect(await readdir(outside)).toEqual(['secret.slip']);
    // 링크 옆에 임시 파일도 남기지 않는다.
    expect(await readdir(dir)).toEqual(['link.slip']);
  });

  it('밖을 가리키는 디렉터리 링크 아래의 경로는 깊이와 무관하게 거부한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await symlink(outside, path.join(dir, 'shared'), 'dir');

    await expect(storage.save('shared/doc', makeTemplate())).rejects.toMatchObject({
      code: 'io',
      message: expect.stringContaining('outside the working directory') as string,
    });
    await expect(storage.save('shared/deep/er/doc', makeTemplate())).rejects.toMatchObject({ code: 'io' });
    expect(await readdir(outside)).toEqual([]);

    await writeFile(path.join(outside, 'doc.slip'), serializeSlipFile(makeTemplate()), 'utf8');
    await expect(storage.load('shared/doc')).rejects.toMatchObject({ code: 'io' });
    await expect(storage.delete('shared/doc')).rejects.toMatchObject({ code: 'io' });
    expect(await readdir(outside)).toEqual(['doc.slip']);
  });

  it('가리키는 곳이 안이라도 대상 자체가 링크면 거부하고, 안을 가리키는 디렉터리 링크는 허용한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('real', makeTemplate());
    await symlink(path.join(dir, 'real.slip'), path.join(dir, 'alias.slip'), 'file');
    await expect(storage.load('alias')).rejects.toMatchObject({ code: 'io' });
    await expect(storage.save('alias', makeTemplate())).rejects.toMatchObject({ code: 'io' });
    expect(await isLink(path.join(dir, 'alias.slip'))).toBe(true);

    await mkdir(path.join(dir, 'sub'));
    await symlink(path.join(dir, 'sub'), path.join(dir, 'sub-link'), 'dir');
    await storage.save('sub-link/doc', makeTemplate());
    expect(await storage.load('sub-link/doc')).toEqual(makeTemplate());
    expect(await readdir(path.join(dir, 'sub'))).toEqual(['doc.slip']);
    await storage.delete('sub-link/doc');
    expect(await readdir(path.join(dir, 'sub'))).toEqual([]);
  });

  it('list는 링크 파일과 링크된 디렉터리 안의 파일을 포함하지 않는다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('own', makeTemplate());
    await writeFile(path.join(outside, 'secret.slip'), serializeSlipFile(makeTemplate()), 'utf8');
    await symlink(path.join(outside, 'secret.slip'), path.join(dir, 'link.slip'), 'file');
    await symlink(outside, path.join(dir, 'shared'), 'dir');
    const page = await storage.list();
    expect(page.items.map((item) => item.id)).toEqual(['own.slip']);
  });

  it('기준 디렉터리가 링크면 실제 경로로 고정하고, 그 안의 파일은 정상 처리한다', async () => {
    const rootLink = path.join(outside, 'root-link');
    await symlink(dir, rootLink, 'dir');
    const storage = new FileSystemStorage({ rootDir: rootLink });
    expect(storage.rootDir).toBe(dir);
    await storage.save('doc', makeTemplate());
    expect(await readdir(dir)).toEqual(['doc.slip']);
    expect(await storage.load('doc')).toEqual(makeTemplate());
    // 아직 없는 기준 디렉터리는 절대 경로 그대로 둔다.
    const missing = path.join(dir, 'later');
    expect(new FileSystemStorage({ rootDir: missing }).rootDir).toBe(missing);
  });

  it('assertInsideRootReal은 아직 없는 경로를 가장 가까운 존재하는 상위 경로로 판정한다', async () => {
    await symlink(outside, path.join(dir, 'shared'), 'dir');
    await expect(assertInsideRootReal(dir, path.join(dir, 'new', 'a.slip'))).resolves.toBeUndefined();
    await expect(assertInsideRootReal(dir, path.join(dir, 'shared', 'new', 'a.slip'))).rejects.toMatchObject({
      code: 'io',
      message: expect.stringContaining(path.join('shared', 'new', 'a.slip')) as string,
    });
    await expect(assertInsideRootReal(dir, path.join(dir, 'shared', 'a.slip'), 'ko', 'shared/a.slip')).rejects.toThrow(
      '작업 디렉터리 밖의 경로입니다: shared/a.slip',
    );

    // 기준 디렉터리 자체가 링크면 링크를 풀어 판정한다 — 안의 파일은 허용하고 밖으로 나가는 링크는 거부한다.
    const rootLink = path.join(outside, 'root-link');
    await symlink(dir, rootLink, 'dir');
    await writeFile(path.join(dir, 'real.slip'), '{}', 'utf8');
    await expect(assertInsideRootReal(rootLink, path.join(rootLink, 'real.slip'))).resolves.toBeUndefined();
    await expect(assertInsideRootReal(rootLink, path.join(rootLink, 'new', 'a.slip'))).resolves.toBeUndefined();
    await expect(assertInsideRootReal(rootLink, path.join(rootLink, 'shared', 'a.slip'))).rejects.toMatchObject({
      code: 'io',
    });
  });
});

// Windows 경로 규칙(드라이브 문자·UNC·역슬래시)에서도 기준 디렉터리 밖 접근이 막히는지 Node의 path 동작 그대로 확인한다.
// 운영 코드에는 OS별 분기가 없으므로 Windows 실행 환경(CI의 windows-latest)에서만 실행한다.
describe.runIf(process.platform === 'win32')('FileSystemStorage (Windows 경로)', () => {
  it('다른 드라이브의 절대 경로는 io 오류로 거부한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    const rootDrive = path.parse(storage.rootDir).root.slice(0, 1).toUpperCase();
    const otherDrive = rootDrive === 'Z' ? 'Y' : 'Z';
    await expect(storage.load(`${otherDrive}:\\outside\\doc`)).rejects.toMatchObject({ code: 'io' });
    await expect(storage.save(`${otherDrive}:\\outside\\doc`, makeTemplate())).rejects.toMatchObject({ code: 'io' });
  });

  it('UNC 절대 경로는 io 오류로 거부한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await expect(storage.load('\\\\server\\share\\doc')).rejects.toMatchObject({ code: 'io' });
    await expect(storage.save('\\\\server\\share\\doc', makeTemplate())).rejects.toMatchObject({ code: 'io' });
  });

  it('..로 기준 디렉터리를 벗어나는 경로는 io 오류로 거부한다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await expect(storage.load('..\\outside')).rejects.toMatchObject({ code: 'io' });
    await expect(storage.load('forms\\..\\..\\outside')).rejects.toMatchObject({ code: 'io' });
    await expect(storage.save('forms/../../outside', makeTemplate())).rejects.toMatchObject({ code: 'io' });
  });

  it('정상 하위 경로는 역슬래시와 슬래시 어느 쪽으로도 저장·조회된다', async () => {
    const storage = new FileSystemStorage({ rootDir: dir });
    await storage.save('forms\\2026\\invoice', makeTemplate());
    expect(await storage.load('forms/2026/invoice')).toEqual(makeTemplate());
    expect(await storage.load('forms\\2026\\invoice.slip')).toEqual(makeTemplate());
    expect(storage.resolvePath('forms\\2026\\invoice')).toBe(path.join(storage.rootDir, 'forms', '2026', 'invoice.slip'));
  });
});
