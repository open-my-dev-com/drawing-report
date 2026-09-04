// slipkit-mcp 명령줄 — 인자 해석, 도움말·버전 출력, 종료 코드
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { HELP_TEXT, PACKAGE_VERSION, parseCliArgs, runCli } from '../src/cli-command.js';
import { startPdfLinkServer } from '../src/http.js';
import { makeWorkDir, removeWorkDir } from './helpers.js';

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

/** 비어 있는 포트 번호를 하나 얻는다. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** 포트에 HTTP 서버가 응답하는지 확인한다. */
async function portOpen(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/slipkit-mcp/status`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/** 빌드된 CLI를 서버 모드로 띄우고 stderr의 시작 안내를 기다린다. */
function spawnServer(args: string[]): {
  child: ChildProcess;
  stderr: () => string;
  waitForStart: () => Promise<string>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
} {
  const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout!.resume();
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const waitForStart = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const check = (): void => {
        const line = stderr.split('\n').find((entry) => entry.startsWith('slipkit-mcp: serving'));
        if (line !== undefined) resolve(line);
      };
      check();
      child.stderr!.on('data', check);
      void exited.then(() => reject(new Error(`exited before start: ${stderr}`)));
    });
  return { child, stderr: () => stderr, waitForStart, exited };
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

  it('httpPort로 링크 서버를 띄운 뒤 stdin이 닫히면 종료 코드 0으로 끝나고 포트를 놓는다', async () => {
    const dir = await makeWorkDir();
    try {
      const port = await freePort();
      await writeFile(path.join(dir, 'slipkit-mcp.json'), JSON.stringify({ httpPort: port }));
      const { child, stderr, waitForStart, exited } = spawnServer([dir]);
      const line = await waitForStart();
      expect(line).toContain(`pdf links at http://127.0.0.1:${port}`);
      // 링크 토큰은 stderr에 적지 않는다.
      expect(stderr()).not.toMatch(/[0-9a-f]{64}/);
      expect(await portOpen(port)).toBe(true);

      child.stdin!.end();
      const result = await exited;
      expect(result).toEqual({ code: 0, signal: null });
      expect(await portOpen(port)).toBe(false);
    } finally {
      await removeWorkDir(dir);
    }
  });

  it.runIf(process.platform !== 'win32')('SIGTERM을 받으면 링크 서버를 닫고 종료 코드 0으로 끝난다', async () => {
    const dir = await makeWorkDir();
    try {
      const port = await freePort();
      await writeFile(path.join(dir, 'slipkit-mcp.json'), JSON.stringify({ httpPort: port }));
      const { child, waitForStart, exited } = spawnServer([dir]);
      await waitForStart();
      expect(await portOpen(port)).toBe(true);

      child.kill('SIGTERM');
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(await portOpen(port)).toBe(false);
    } finally {
      await removeWorkDir(dir);
    }
  });

  it('같은 작업 디렉터리의 다른 링크 서버가 포트를 쓰면 빈 포트에 새로 띄우고 안내한다', async () => {
    const dir = await makeWorkDir();
    const occupying = await startPdfLinkServer({ rootDir: dir, port: 0 });
    try {
      await writeFile(path.join(dir, 'slipkit-mcp.json'), JSON.stringify({ httpPort: occupying.port }));
      const { child, waitForStart, exited } = spawnServer([dir]);
      const line = await waitForStart();
      const match = /pdf links at http:\/\/127\.0\.0\.1:(\d+) \(port (\d+) was in use\)/.exec(line);
      expect(match, line).not.toBeNull();
      expect(Number(match![2])).toBe(occupying.port);
      expect(Number(match![1])).not.toBe(occupying.port);
      expect(await portOpen(Number(match![1]))).toBe(true);

      child.stdin!.end();
      expect(await exited).toEqual({ code: 0, signal: null });
      // 원래 서버는 그대로 살아 있다.
      expect(await portOpen(occupying.port)).toBe(true);
    } finally {
      await occupying.close();
      await removeWorkDir(dir);
    }
  });
});
