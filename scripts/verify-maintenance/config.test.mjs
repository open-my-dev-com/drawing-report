// knip 설정 점검의 단위 시험 — `node --test`로 실행한다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkKnipConfig,
  createReferenceFinder,
  globToRegExp,
  hasDependencyReference,
  parseJsonc,
  scopeWorkspaceFiles,
} from './config.mjs';

/** 저장소를 흉내 낸 워크스페이스 파일 목록 */
const FILES = {
  '.': ['scripts/verify.mjs', 'scripts/release/release.test.mjs', 'scripts/fixtures/app/main.tsx'],
  'packages/elements': ['scripts/generate-pretendard.mjs', 'src/index.ts'],
};

describe('parseJsonc', () => {
  it('한 줄·여러 줄 주석을 걷어내고 읽는다', () => {
    const text = `{
      // 진입점
      "a": 1, /* 가운데 주석 */
      "b": "값"
    }`;
    assert.deepEqual(parseJsonc(text), { a: 1, b: '값' });
  });

  it('문자열 안의 //와 /*는 주석이 아니다', () => {
    assert.deepEqual(parseJsonc('{"url":"https://example.com/a","glob":"src/*"}'), {
      url: 'https://example.com/a',
      glob: 'src/*',
    });
  });

  it('JSON이 아니면 오류를 던진다', () => {
    assert.throws(() => parseJsonc('{ "a": }'), /JSON으로 읽지 못했다/);
  });
});

describe('globToRegExp', () => {
  it('*는 디렉터리 경계를 넘지 않고 **는 넘는다', () => {
    assert.equal(globToRegExp('scripts/*.mjs').test('scripts/a.mjs'), true);
    assert.equal(globToRegExp('scripts/*.mjs').test('scripts/sub/a.mjs'), false);
    assert.equal(globToRegExp('scripts/**/*.test.mjs').test('scripts/a.test.mjs'), true);
    assert.equal(globToRegExp('scripts/**/*.test.mjs').test('scripts/sub/deep/a.test.mjs'), true);
    assert.equal(globToRegExp('scripts/**').test('scripts/sub/a.mjs'), true);
  });

  it('점과 같은 정규식 문자는 글자 그대로 본다', () => {
    assert.equal(globToRegExp('a.mjs').test('axmjs'), false);
    assert.equal(globToRegExp('a.mjs').test('a.mjs'), true);
  });
});

describe('checkKnipConfig', () => {
  it('진입점과 예외가 모두 살아 있으면 지적이 없다', () => {
    const config = {
      workspaces: {
        '.': { project: ['scripts/**'], entry: ['scripts/*.mjs', 'scripts/**/*.test.mjs'], ignoreDependencies: ['publint', 'react'] },
        'packages/elements': { entry: ['scripts/generate-pretendard.mjs'] },
      },
    };
    const hasReference = (workspace, name) => workspace === '.' && (name === 'react' || name === 'publint');
    assert.deepEqual(checkKnipConfig({ config, files: FILES, hasReference }), []);
  });

  it('아무 파일과도 맞지 않는 진입점·project glob을 잡는다', () => {
    const config = {
      workspaces: { '.': { project: ['nope/**'], entry: ['scripts/gone.mjs', 'scripts/*.mjs'] } },
    };
    assert.deepEqual(checkKnipConfig({ config, files: FILES }), [
      '워크스페이스 .: entry 항목 "scripts/gone.mjs"과 맞는 파일이 없다',
      '워크스페이스 .: project 항목 "nope/**"과 맞는 파일이 없다',
    ]);
  });

  it('쓰는 곳이 없는 ignoreDependencies를 잡는다', () => {
    const config = { workspaces: { '.': { entry: ['scripts/*.mjs'], ignoreDependencies: ['지운-도구'] } } };
    assert.deepEqual(checkKnipConfig({ config, files: FILES }), [
      '워크스페이스 .: ignoreDependencies "지운-도구"를 쓰는 곳이 없다',
    ]);
  });

  it('package.json이 선언했다는 것만으로는 예외를 살리지 않는다', () => {
    const config = { workspaces: { '.': { entry: ['scripts/*.mjs'], ignoreDependencies: ['dead-tool'] } } };
    assert.deepEqual(checkKnipConfig({ config, files: FILES, hasReference: () => false }), [
      '워크스페이스 .: ignoreDependencies "dead-tool"를 쓰는 곳이 없다',
    ]);
  });

  it('저장소에 없는 워크스페이스를 잡는다', () => {
    const config = { workspaces: { 'packages/gone': { entry: ['src/index.ts'] } } };
    assert.deepEqual(checkKnipConfig({ config, files: FILES }), [
      '워크스페이스 packages/gone: 저장소에 없다',
    ]);
  });
});

describe('scopeWorkspaceFiles', () => {
  const files = [
    'scripts/verify-packages/fixtures/react-app/main.tsx',
    'packages/react/src/index.ts',
    'examples/react-demo/src/main.tsx',
  ];

  it('project·entry glob이 있으면 그 glob과 맞는 파일만 남긴다', () => {
    assert.deepEqual(scopeWorkspaceFiles({ workspace: { project: ['scripts/**'] }, files }), [
      'scripts/verify-packages/fixtures/react-app/main.tsx',
    ]);
  });

  it('glob이 없으면 안에 든 다른 워크스페이스의 파일만 뺀다', () => {
    assert.deepEqual(
      scopeWorkspaceFiles({ workspace: {}, files, nestedWorkspaces: ['packages/react', 'examples/react-demo'] }),
      ['scripts/verify-packages/fixtures/react-app/main.tsx'],
    );
  });

  it('production 접미사가 붙은 glob도 같은 패턴으로 본다', () => {
    assert.deepEqual(scopeWorkspaceFiles({ workspace: { entry: ['scripts/**!'] }, files }), [
      'scripts/verify-packages/fixtures/react-app/main.tsx',
    ]);
  });
});

describe('hasDependencyReference', () => {
  it('패키지 이름과 하위 경로 모듈 지정자를 찾는다', () => {
    assert.equal(hasDependencyReference("import x from 'vite';", 'vite'), true);
    assert.equal(hasDependencyReference('import x from "vite/client";', 'vite'), true);
    assert.equal(hasDependencyReference("import x from '@vitejs/plugin-vue';", '@vitejs/plugin-vue'), true);
  });

  it('이름이 일부만 겹치는 다른 패키지는 찾지 않는다', () => {
    assert.equal(hasDependencyReference("import x from 'vitest';", 'vite'), false);
    assert.equal(hasDependencyReference('// vite 라는 낱말만 있는 주석', 'vite'), false);
  });
});

describe('createReferenceFinder', () => {
  const config = {
    workspaces: {
      '.': { project: ['scripts/**'] },
      'packages/react': {},
    },
  };
  const files = {
    '.': ['scripts/tool.mjs', 'packages/react/src/index.ts', 'examples/react-demo/src/main.tsx'],
    'packages/react': ['src/index.ts'],
  };
  const nestedWorkspaces = { '.': ['packages/react', 'examples/react-demo'], 'packages/react': [] };
  const sources = {
    './scripts/tool.mjs': 'console.log("도구");',
    './packages/react/src/index.ts': "import React from 'react';",
    './examples/react-demo/src/main.tsx': "import React from 'react';",
    'packages/react/src/index.ts': "import React from 'react';",
  };
  const readFile = (workspace, file) => sources[`${workspace}/${file}`] ?? '';

  it('다른 패키지·예제의 import는 루트 예외를 살리지 못한다', () => {
    const hasReference = createReferenceFinder({ config, files, nestedWorkspaces, readFile });
    assert.equal(hasReference('.', 'react'), false);
    assert.equal(hasReference('packages/react', 'react'), true);
  });

  it('워크스페이스가 소유한 파일이 가져오면 예외가 살아 있다', () => {
    const own = { ...sources, './scripts/tool.mjs': "import React from 'react';" };
    const hasReference = createReferenceFinder({
      config,
      files,
      nestedWorkspaces,
      readFile: (workspace, file) => own[`${workspace}/${file}`] ?? '',
    });
    assert.equal(hasReference('.', 'react'), true);
  });

  it('삭제된 동적 의존성 예외를 checkKnipConfig가 지적한다', () => {
    const withException = {
      workspaces: {
        '.': { project: ['scripts/**'], ignoreDependencies: ['react'] },
        'packages/react': {},
      },
    };
    const hasReference = createReferenceFinder({ config: withException, files, nestedWorkspaces, readFile });
    assert.deepEqual(
      checkKnipConfig({ config: withException, files, hasReference }),
      ['워크스페이스 .: ignoreDependencies "react"를 쓰는 곳이 없다'],
    );
  });
});

describe('checkKnipConfig의 ignoreWorkspaces', () => {
  const config = { workspaces: {}, ignoreWorkspaces: ['examples/*!'] };

  it('맞는 워크스페이스가 있으면 지적하지 않는다', () => {
    assert.deepEqual(
      checkKnipConfig({ config, files: {}, workspaceDirs: ['.', 'examples/demo', 'packages/core'] }),
      [],
    );
  });

  it('맞는 워크스페이스가 없으면 낡은 예외로 잡는다', () => {
    assert.deepEqual(checkKnipConfig({ config, files: {}, workspaceDirs: ['.', 'packages/core'] }), [
      'ignoreWorkspaces "examples/*!"과 맞는 워크스페이스가 없다',
    ]);
  });

  it('workspaceDirs를 주지 않으면 ignoreWorkspaces를 보지 않는다', () => {
    assert.deepEqual(checkKnipConfig({ config, files: {} }), []);
  });
});
