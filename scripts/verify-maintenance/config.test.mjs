// knip 설정 점검의 단위 시험 — `node --test`로 실행한다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkKnipConfig, globToRegExp, parseJsonc } from './config.mjs';

/** 저장소를 흉내 낸 워크스페이스 파일 목록 */
const FILES = {
  '.': ['scripts/verify.mjs', 'scripts/release/release.test.mjs', 'scripts/fixtures/app/main.tsx'],
  'packages/elements': ['scripts/generate-pretendard.mjs', 'src/index.ts'],
};

const DEPENDENCIES = { '.': ['publint'], 'packages/elements': [] };

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
    const hasReference = (workspace, name) => workspace === '.' && name === 'react';
    assert.deepEqual(checkKnipConfig({ config, files: FILES, dependencies: DEPENDENCIES, hasReference }), []);
  });

  it('아무 파일과도 맞지 않는 진입점·project glob을 잡는다', () => {
    const config = {
      workspaces: { '.': { project: ['nope/**'], entry: ['scripts/gone.mjs', 'scripts/*.mjs'] } },
    };
    assert.deepEqual(checkKnipConfig({ config, files: FILES, dependencies: DEPENDENCIES }), [
      '워크스페이스 .: entry 항목 "scripts/gone.mjs"과 맞는 파일이 없다',
      '워크스페이스 .: project 항목 "nope/**"과 맞는 파일이 없다',
    ]);
  });

  it('선언하지도 가져오지도 않는 ignoreDependencies를 잡는다', () => {
    const config = { workspaces: { '.': { entry: ['scripts/*.mjs'], ignoreDependencies: ['지운-도구'] } } };
    assert.deepEqual(checkKnipConfig({ config, files: FILES, dependencies: DEPENDENCIES }), [
      '워크스페이스 .: ignoreDependencies "지운-도구"를 선언하지도 가져오지도 않는다',
    ]);
  });

  it('저장소에 없는 워크스페이스를 잡는다', () => {
    const config = { workspaces: { 'packages/gone': { entry: ['src/index.ts'] } } };
    assert.deepEqual(checkKnipConfig({ config, files: FILES, dependencies: DEPENDENCIES }), [
      '워크스페이스 packages/gone: 저장소에 없다',
    ]);
  });
});
