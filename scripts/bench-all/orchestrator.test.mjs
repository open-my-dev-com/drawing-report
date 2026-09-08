// bench:all 실행 순서 시험 — 깨끗한 사본에서도 빌드부터 하는지, 기준선이 없으면 재기 전에
// 멈추는지 본다. 실제 빌드와 측정은 무거우므로 PATH 앞에 둔 가짜 pnpm으로 빌드 단계만 확인한다.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BENCH_ALL = path.join(ROOT, 'scripts', 'bench-all.mjs');
const BASELINE_DIR = path.join(ROOT, 'scripts', 'bench-baselines');

// Windows에서는 확장자 없는 shim을 PATH로 가로챌 수 없어 이 시험을 돌리지 않는다.
const skip = process.platform === 'win32' ? 'Windows에서는 PATH로 pnpm을 가로챌 수 없다' : false;

const workDirs = [];

after(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * 임시 작업 디렉터리를 만든다. 시험이 끝나면 지운다.
 *
 * @returns {string} 디렉터리 경로
 */
function workDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slipkit-bench-all-test-'));
  workDirs.push(dir);
  return dir;
}

/**
 * 빌드 명령을 기록만 하고 실패로 끝나는 가짜 pnpm을 만든다.
 *
 * @returns {{ bin: string, log: string }} 가짜 pnpm이 든 디렉터리와 기록 파일 경로
 */
function fakePnpm() {
  const dir = workDir();
  const log = path.join(dir, 'pnpm-argv.txt');
  const file = path.join(dir, 'pnpm');
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\nexit 3\n`);
  chmodSync(file, 0o755);
  return { bin: dir, log };
}

/**
 * 가짜 pnpm을 PATH 앞에 두고 bench:all을 돌린다.
 *
 * @param {string[]} args - 공통 실행 인자
 * @returns {{ status: number | null, stderr: string, build: string[] | null }} 종료 코드·stderr와
 *   가짜 pnpm이 받은 인자 (부르지 않았으면 null)
 */
function runBenchAll(args) {
  const pnpm = fakePnpm();
  const child = spawnSync(process.execPath, [BENCH_ALL, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${pnpm.bin}${path.delimiter}${process.env.PATH}` },
  });
  const build = existsSync(pnpm.log) ? readFileSync(pnpm.log, 'utf8').trim().split('\n') : null;
  return { status: child.status, stderr: child.stderr, build };
}

describe('bench:all 실행 순서', { skip }, () => {
  it('빌드 산출물이 없다고 먼저 죽지 않고 필요한 패키지를 빌드한다', () => {
    const result = runBenchAll(['--only', 'core', '--no-baseline']);
    assert.deepEqual(result.build, ['--filter', '@omdc-slipkit/core', 'run', 'build']);
    assert.doesNotMatch(result.stderr, /빌드 산출물이 없다|먼저 .*pnpm build/);
    assert.match(result.stderr, /패키지 빌드가 실패했다 \(exit 3\)/);
  });

  it('고른 benchmark가 쓰는 패키지만 한 번에 빌드한다', () => {
    const result = runBenchAll(['--only', 'mcp-list', '--no-baseline']);
    assert.deepEqual(result.build, [
      '--filter', '@omdc-slipkit/core',
      '--filter', '@omdc-slipkit/elements',
      '--filter', '@omdc-slipkit/mcp',
      'run', 'build',
    ]);
  });

  it('고른 benchmark의 기준선이 없으면 재기 전에 멈춘다', () => {
    const dir = workDir();
    writeFileSync(path.join(dir, 'designer.json'), readFileSync(path.join(BASELINE_DIR, 'designer.json'), 'utf8'));
    const result = runBenchAll(['--only', 'core', '--baselines', dir]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /고른 benchmark의 기준선이 없다: core/);
    assert.equal(result.build, null, '기준선이 없는데 빌드를 시작했다');
  });

  it('기준선 디렉터리가 없으면 멈춘다', () => {
    const result = runBenchAll(['--only', 'core', '--baselines', path.join(workDir(), 'none')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /기준선 디렉터리가 없다/);
    assert.equal(result.build, null);
  });

  it('기준선이 있으면 비교를 켠 채로 빌드까지 간다', () => {
    const dir = workDir();
    writeFileSync(path.join(dir, 'core.json'), readFileSync(path.join(BASELINE_DIR, 'core.json'), 'utf8'));
    const result = runBenchAll(['--only', 'core', '--baselines', dir]);
    assert.deepEqual(result.build, ['--filter', '@omdc-slipkit/core', 'run', 'build']);
  });

  it('--no-baseline 이면 기준선 파일이 없어도 넘어간다', () => {
    const result = runBenchAll(['--only', 'core', '--no-baseline', '--baselines', path.join(workDir(), 'none')]);
    assert.deepEqual(result.build, ['--filter', '@omdc-slipkit/core', 'run', 'build']);
    assert.doesNotMatch(result.stderr, /기준선/);
  });
});
