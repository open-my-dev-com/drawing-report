// 의존성 사용 근거 검사의 단위 시험 — `node --test`로 실행한다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkKnipConfig } from './config.mjs';
import { checkDependencyEvidence, createEvidenceFinder, DEPENDENCY_EVIDENCE } from './dependency-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 저장소를 흉내 낸 파일 본문 — `<워크스페이스>/<파일>` 키 */
const SOURCES = {
  './scripts/tool.mjs': "await run('pnpm', ['exec', 'attw', tarball]);",
  './package.json': '{ "scripts": { "cover": "vitest run --coverage.provider=v8" } }',
  './packages/core/src/index.ts': "import 'dead-tool';",
  'packages/core/src/index.ts': "import 'dead-tool';",
};
const hasToken = (workspace, file, token) => (SOURCES[`${workspace}/${file}`] ?? '').includes(token);

const CONFIG = {
  workspaces: {
    '.': { project: ['scripts/**'], ignoreDependencies: ['@arethetypeswrong/cli', '@vitest/coverage-v8'] },
    'packages/core': {},
  },
};
const NESTED = { '.': ['packages/core'], 'packages/core': [] };

const EVIDENCE = [
  {
    workspace: '.',
    dependency: '@arethetypeswrong/cli',
    usedBy: 'scripts/tool.mjs',
    token: "'attw'",
    reason: '실행 파일 이름으로만 부른다',
  },
  {
    workspace: '.',
    dependency: '@vitest/coverage-v8',
    usedBy: 'package.json',
    token: '--coverage.provider=v8',
    reason: '옵션으로만 요구한다',
  },
];

describe('createEvidenceFinder', () => {
  const hasEvidence = createEvidenceFinder({ evidence: EVIDENCE, hasToken, nestedWorkspaces: NESTED });

  it('근거 파일이 그 문자열을 담고 있으면 예외를 살린다', () => {
    assert.equal(hasEvidence('.', '@arethetypeswrong/cli'), true);
    assert.equal(hasEvidence('.', '@vitest/coverage-v8'), true);
  });

  it('근거가 없는 의존성과 다른 워크스페이스의 같은 이름은 살리지 않는다', () => {
    assert.equal(hasEvidence('.', 'dead-tool'), false);
    assert.equal(hasEvidence('packages/core', '@arethetypeswrong/cli'), false);
  });

  it('근거 파일이 문자열을 잃으면 살리지 않는다', () => {
    const finder = createEvidenceFinder({ evidence: EVIDENCE, hasToken: () => false, nestedWorkspaces: NESTED });
    assert.equal(finder('.', '@arethetypeswrong/cli'), false);
  });

  it('다른 워크스페이스의 파일을 근거로 적어도 살리지 않는다', () => {
    const crossing = [{ ...EVIDENCE[0], dependency: 'dead-tool', usedBy: 'packages/core/src/index.ts', token: "'dead-tool'" }];
    const finder = createEvidenceFinder({ evidence: crossing, hasToken, nestedWorkspaces: NESTED });
    assert.equal(finder('.', 'dead-tool'), false);
  });
});

describe('checkDependencyEvidence', () => {
  it('살아 있는 근거만 있으면 지적이 없다', () => {
    assert.deepEqual(
      checkDependencyEvidence({ config: CONFIG, evidence: EVIDENCE, hasToken, nestedWorkspaces: NESTED }),
      [],
    );
  });

  it('없어진 예외를 가리키는 근거를 잡는다', () => {
    const gone = [...EVIDENCE, { workspace: '.', dependency: '지운-도구', usedBy: 'scripts/tool.mjs', token: 'x', reason: '까닭' }];
    assert.deepEqual(checkDependencyEvidence({ config: CONFIG, evidence: gone, hasToken, nestedWorkspaces: NESTED }), [
      '사용 근거 지운-도구 (워크스페이스 .): ignoreDependencies에 없다 (근거를 지운다)',
    ]);
  });

  it('근거 파일이 문자열을 잃은 항목을 잡는다', () => {
    const problems = checkDependencyEvidence({
      config: CONFIG,
      evidence: EVIDENCE,
      hasToken: (workspace, file, token) => token !== "'attw'" && hasToken(workspace, file, token),
      nestedWorkspaces: NESTED,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /scripts\/tool\.mjs에 'attw'이 없다/);
  });

  it('다른 워크스페이스의 파일을 근거로 적은 항목과 까닭 없는 항목, 겹친 항목을 잡는다', () => {
    const config = {
      workspaces: { '.': { ignoreDependencies: ['dead-tool', '까닭없음'] }, 'packages/core': {} },
    };
    const bad = [
      { workspace: '.', dependency: 'dead-tool', usedBy: 'packages/core/src/index.ts', token: "'dead-tool'", reason: '까닭' },
      { workspace: '.', dependency: '까닭없음', usedBy: 'scripts/tool.mjs', token: "'attw'", reason: '' },
      { workspace: '.', dependency: 'dead-tool', usedBy: 'scripts/tool.mjs', token: "'attw'", reason: '까닭' },
    ];
    assert.deepEqual(checkDependencyEvidence({ config, evidence: bad, hasToken, nestedWorkspaces: NESTED }), [
      '사용 근거 dead-tool (워크스페이스 .): 근거로 적은 packages/core/src/index.ts가 다른 워크스페이스의 파일이다',
      '사용 근거 까닭없음 (워크스페이스 .): 까닭을 적지 않았다',
      '사용 근거 dead-tool (워크스페이스 .): 두 번 적혀 있다',
    ]);
  });
});

describe('근거와 예외를 함께 볼 때', () => {
  it('다른 워크스페이스의 import는 루트 예외를 살리지 못하고 근거만 살린다', () => {
    const hasEvidence = createEvidenceFinder({ evidence: EVIDENCE, hasToken, nestedWorkspaces: NESTED });
    const config = {
      workspaces: {
        '.': { project: ['scripts/**'], ignoreDependencies: ['@arethetypeswrong/cli', 'dead-tool'] },
        'packages/core': {},
      },
    };
    const files = { '.': ['scripts/tool.mjs', 'package.json'], 'packages/core': ['src/index.ts'] };
    assert.deepEqual(checkKnipConfig({ config, files, hasReference: hasEvidence }), [
      '워크스페이스 .: ignoreDependencies "dead-tool"를 쓰는 곳이 없다',
    ]);
  });
});

describe('실제 근거 목록', () => {
  it('항목마다 워크스페이스·의존성·근거 파일·문자열·까닭을 적고 파일이 그 문자열을 담고 있다', () => {
    for (const entry of DEPENDENCY_EVIDENCE) {
      assert.ok(entry.workspace && entry.dependency && entry.usedBy && entry.token && entry.reason, JSON.stringify(entry));
      const file = path.resolve(ROOT, entry.workspace, entry.usedBy);
      assert.ok(existsSync(file), `${entry.usedBy} 가 없다`);
      assert.ok(readFileSync(file, 'utf8').includes(entry.token), `${entry.usedBy} 가 ${entry.token}을 담고 있지 않다`);
    }
  });

  it('같은 워크스페이스의 같은 의존성을 두 번 적지 않는다', () => {
    const keys = DEPENDENCY_EVIDENCE.map((entry) => `${entry.workspace}::${entry.dependency}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});
