import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PACKAGE_DIRS, PACKAGE_NAMES, packageName, packageTarballPrefix } from './package-names.mjs';

describe('공개 npm 패키지 이름', () => {
  it('다섯 패키지를 의존 순서대로 연결한다', () => {
    assert.deepEqual(PACKAGE_DIRS, ['core', 'elements', 'react', 'vue', 'mcp']);
    assert.deepEqual(PACKAGE_NAMES, {
      core: '@omdc/slipkit',
      elements: '@omdc/slipkit-elements',
      react: '@omdc/slipkit-react',
      vue: '@omdc/slipkit-vue',
      mcp: '@omdc/slipkit-mcp',
    });
  });

  it('공개 이름에 맞는 tarball 접두사를 만든다', () => {
    assert.equal(packageTarballPrefix('core'), 'omdc-slipkit-');
    assert.equal(packageTarballPrefix('elements'), 'omdc-slipkit-elements-');
    assert.equal(packageTarballPrefix('mcp'), 'omdc-slipkit-mcp-');
  });

  it('등록되지 않은 디렉터리 이름을 거부한다', () => {
    assert.throws(() => packageName('unknown'), /알 수 없는 패키지 디렉터리/);
  });
});
