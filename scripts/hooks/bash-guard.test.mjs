import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'bash-guard.mjs');

/** Bash 훅에 명령을 전달하고 종료 결과를 반환합니다. */
function guard(command) {
  return spawnSync(process.execPath, [HOOK], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({ cwd: ROOT, tool_input: { command } }),
  });
}

describe('bash-guard의 main 푸시 차단', () => {
  for (const command of [
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin refs/heads/main',
    'git push origin HEAD:refs/heads/main',
    'git push --force origin +HEAD:refs/heads/main',
  ]) {
    it(`차단: ${command}`, () => {
      const result = guard(command);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /main에 직접 푸시할 수 없습니다/);
    });
  }

  it('main이 아닌 목적지는 허용한다', () => {
    const result = guard('git push origin HEAD:refs/heads/fix/repo-topic');
    assert.equal(result.status, 0, result.stderr);
  });

  it('main을 출발점으로 쓰더라도 목적지가 다른 브랜치면 허용한다', () => {
    const result = guard('git push origin refs/heads/main:refs/heads/fix/repo-topic');
    assert.equal(result.status, 0, result.stderr);
  });
});
