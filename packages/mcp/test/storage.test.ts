import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEncryptedSlipFile, serializeSlipFile } from '@omdc-slipkit/core';
import { FileSystemStorage } from '../src/storage.js';
import { makeTemplate, makeWorkDir, removeWorkDir } from './helpers.js';

let dir: string;

beforeEach(async () => {
  dir = await makeWorkDir();
});

afterEach(async () => {
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
