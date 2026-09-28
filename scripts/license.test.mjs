// 배포하는 모든 패키지가 같은 LICENSE와 Licensed Work 범위를 사용하는지 확인합니다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PACKAGE_DIRS, PACKAGE_NAMES } from './package-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootLicense = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

describe('배포 LICENSE 계약', () => {
  it('다섯 패키지의 LICENSE는 루트 LICENSE와 같다', () => {
    for (const dir of PACKAGE_DIRS) {
      const packageLicense = readFileSync(path.join(ROOT, 'packages', dir, 'LICENSE'), 'utf8');
      assert.equal(packageLicense, rootLicense, `packages/${dir}/LICENSE`);
    }
  });

  it('다섯 공개 패키지가 모두 Licensed Work에 포함된다', () => {
    for (const name of Object.values(PACKAGE_NAMES)) {
      assert.match(rootLicense, new RegExp(`(^|[\\s,(])${name.replace('/', '\\/')}([\\s,)])`), name);
    }
  });
});
