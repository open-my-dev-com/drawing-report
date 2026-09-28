import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'bash-guard.mjs');
let workRoot;
let mainRoot;

/** 지정한 브랜치가 체크아웃된 최소 Git 저장소를 만듭니다. */
function createRepository(branch) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'slipkit-bash-guard-'));
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, directory]);
  execFileSync(
    'git',
    [
      '-C',
      directory,
      '-c',
      'user.name=SlipKit Test',
      '-c',
      'user.email=slipkit-test@example.invalid',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'test fixture',
    ],
    { stdio: 'ignore' },
  );
  return directory;
}

/** Bash 훅에 명령을 전달하고 종료 결과를 반환합니다. */
function guard(command, cwd) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({ cwd, tool_input: { command } }),
  });
}

describe('bash-guard의 main 푸시 차단', () => {
  before(() => {
    workRoot = createRepository('fix/repo-hook-test');
    mainRoot = createRepository('main');
  });

  after(() => {
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(mainRoot, { recursive: true, force: true });
  });

  for (const command of [
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin refs/heads/main',
    'git push origin HEAD:refs/heads/main',
    'git push --force origin +HEAD:refs/heads/main',
  ]) {
    it(`차단: ${command}`, () => {
      const result = guard(command, workRoot);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /main에 직접 푸시할 수 없습니다/);
    });
  }

  it('main이 아닌 목적지는 허용한다', () => {
    const result = guard('git push origin HEAD:refs/heads/fix/repo-topic', workRoot);
    assert.equal(result.status, 0, result.stderr);
  });

  it('main을 출발점으로 쓰더라도 목적지가 다른 브랜치면 허용한다', () => {
    const result = guard('git push origin refs/heads/main:refs/heads/fix/repo-topic', workRoot);
    assert.equal(result.status, 0, result.stderr);
  });

  it('현재 브랜치가 main이면 다른 목적지로도 푸시할 수 없다', () => {
    const result = guard('git push origin HEAD:refs/heads/fix/repo-topic', mainRoot);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /현재 브랜치가 main입니다/);
  });
});
