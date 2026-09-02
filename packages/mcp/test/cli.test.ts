// slipkit-mcp 명령줄 — 인자 해석, 도움말·버전 출력, 종료 코드
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { HELP_TEXT, PACKAGE_VERSION, parseCliArgs, runCli } from '../src/cli-command.js';

const execFileAsync = promisify(execFile);
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(packageDir, 'dist', 'cli.js');
const packageVersion = (JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
  version: string;
}).version;

/** 빌드된 CLI를 자식 프로세스로 실행해 stdout·stderr·종료 코드를 모은다. */
async function runBuiltCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args]);
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout: string; stderr: string; code: number };
    return { stdout: failed.stdout, stderr: failed.stderr, code: failed.code };
  }
}

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => { out.push(t); }, stderr: (t: string) => { err.push(t); } },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

describe('slipkit-mcp 인자 해석', () => {
  it('인자가 없으면 서버 시작이고 위치 인자·옵션은 그대로 전달한다', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'serve', args: {} });
    expect(parseCliArgs(['./work', '--config', 'a.json', '--locale', 'ko'])).toEqual({
      kind: 'serve',
      args: { rootDir: './work', configPath: 'a.json', locale: 'ko' },
    });
  });

  it('--help와 -h는 도움말, --version과 -v는 버전이고 둘이 함께 오면 도움말이 우선한다', () => {
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseCliArgs(['-v'])).toEqual({ kind: 'version' });
    expect(parseCliArgs(['--version', '--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['./work', '-v', '-h'])).toEqual({ kind: 'help' });
  });

  it('모르는 옵션, 옵션 값 누락, 위치 인자 2개 이상은 사용법 오류다', () => {
    expect(parseCliArgs(['--bogus'])).toMatchObject({ kind: 'usage-error' });
    expect(parseCliArgs(['--config'])).toMatchObject({ kind: 'usage-error' });
    expect(parseCliArgs(['a', 'b'])).toEqual({
      kind: 'usage-error',
      message: "unexpected argument 'b' (only one working directory is accepted)",
    });
    // 인자가 유효하지 않으면 --help가 있어도 사용법 오류다.
    expect(parseCliArgs(['--help', '--bogus'])).toMatchObject({ kind: 'usage-error' });
  });

  it('버전 상수는 package.json의 버전과 같다', () => {
    expect(PACKAGE_VERSION).toBe(packageVersion);
  });
});

describe('slipkit-mcp 실행', () => {
  it('도움말은 stdout에 본문만 내고 서버를 시작하지 않으며 종료 코드 0이다', async () => {
    const serve = vi.fn(async () => undefined);
    const { io, stdout, stderr } = fakeIo();
    expect(await runCli(['--help'], io, serve)).toBe(0);
    expect(stdout()).toBe(HELP_TEXT);
    expect(stderr()).toBe('');
    expect(serve).not.toHaveBeenCalled();
  });

  it('버전은 stdout에 버전 한 줄만 내고 서버를 시작하지 않으며 종료 코드 0이다', async () => {
    const serve = vi.fn(async () => undefined);
    const { io, stdout, stderr } = fakeIo();
    expect(await runCli(['-v'], io, serve)).toBe(0);
    expect(stdout()).toBe(`${packageVersion}\n`);
    expect(stderr()).toBe('');
    expect(serve).not.toHaveBeenCalled();
  });

  it('사용법 오류는 stderr 두 줄과 종료 코드 2이고 서버를 시작하지 않는다', async () => {
    const serve = vi.fn(async () => undefined);
    const { io, stdout, stderr } = fakeIo();
    expect(await runCli(['--bogus'], io, serve)).toBe(2);
    expect(stdout()).toBe('');
    const lines = stderr().split('\n');
    expect(lines[0]).toMatch(/^slipkit-mcp: .*--bogus/);
    expect(lines[1]).toBe("Run 'slipkit-mcp --help' for usage.");
    expect(serve).not.toHaveBeenCalled();
  });

  it('서버 시작은 해석한 인자를 넘기고, 시작 중 오류는 stderr 한 줄과 종료 코드 1이다', async () => {
    const ok = vi.fn(async () => undefined);
    const good = fakeIo();
    expect(await runCli(['./work', '--locale', 'ja'], good.io, ok)).toBe(0);
    expect(ok).toHaveBeenCalledWith({ rootDir: './work', locale: 'ja' });
    expect(good.stdout()).toBe('');

    const failing = vi.fn(async () => { throw new Error('config broken'); });
    const bad = fakeIo();
    expect(await runCli([], bad.io, failing)).toBe(1);
    expect(bad.stderr()).toBe('slipkit-mcp: config broken\n');
    expect(bad.stdout()).toBe('');
  });
});

describe.skipIf(!existsSync(cliPath))('빌드된 dist/cli.js', () => {
  it('--help는 stdout에 도움말을 내고 stderr 없이 종료 코드 0이다', async () => {
    const result = await runBuiltCli(['--help']);
    expect(result).toEqual({ stdout: HELP_TEXT, stderr: '', code: 0 });
  });

  it('--version은 package.json의 버전만 내고 stderr 없이 종료 코드 0이다', async () => {
    const result = await runBuiltCli(['--version']);
    expect(result).toEqual({ stdout: `${packageVersion}\n`, stderr: '', code: 0 });
  });

  it('모르는 옵션은 stderr에 원인과 도움말 안내를 내고 종료 코드 2이다', async () => {
    const result = await runBuiltCli(['--bogus']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^slipkit-mcp: .*--bogus.*\nRun 'slipkit-mcp --help' for usage\.\n$/);
  });
});
