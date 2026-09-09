// tarball package.json 계약 검사의 단위 시험 — `node --test`로 실행합니다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { manifestProblems, REQUIRED_MANIFEST } from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGES = ['core', 'elements', 'react', 'vue', 'mcp'];

/** 계약을 모두 만족하는 package.json 원문입니다. */
function goodManifest(overrides = {}) {
  return JSON.stringify({
    name: '@omdc-slipkit/core',
    version: '0.1.0',
    engines: { node: '>=22.13' },
    license: 'BUSL-1.1',
    publishConfig: { access: 'public' },
    ...overrides,
  });
}

describe('tarball package.json 계약', () => {
  it('필요한 선언이 모두 있으면 문제가 없다', () => {
    assert.deepEqual(manifestProblems(goodManifest()), []);
  });

  it('engines.node를 지우거나 다른 값으로 바꾸면 문제로 보고한다', () => {
    assert.deepEqual(manifestProblems(goodManifest({ engines: {} })), [
      'package.json engines.node is (unset), expected >=22.13',
    ]);
    assert.deepEqual(manifestProblems(goodManifest({ engines: { node: '>=20' } })), [
      'package.json engines.node is >=20, expected >=22.13',
    ]);
  });

  it('라이선스와 공개 배포 설정도 함께 본다', () => {
    const problems = manifestProblems(goodManifest({ license: 'MIT', publishConfig: { access: 'restricted' } }));
    assert.deepEqual(problems, [
      'package.json license is MIT, expected BUSL-1.1',
      'package.json publishConfig.access is restricted, expected public',
    ]);
  });

  it('JSON이 아니면 해석 실패로 보고한다', () => {
    assert.match(manifestProblems('not json')[0], /parse failed/);
  });

  it('저장소의 다섯 package.json이 계약을 지킨다', () => {
    for (const name of PACKAGES) {
      const text = readFileSync(path.join(ROOT, 'packages', name, 'package.json'), 'utf8');
      assert.deepEqual(manifestProblems(text), [], `packages/${name}/package.json`);
    }
    assert.deepEqual(Object.keys(REQUIRED_MANIFEST), ['engines.node', 'license', 'publishConfig.access']);
  });
});
