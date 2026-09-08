// 실행 환경 수집·비교 시험 — fingerprint가 같은 환경을 같다고 보는지 확인한다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FINGERPRINT_FIELDS, collectEnvironment, compareEnvironments, describeEnvironment, environmentFingerprint } from './env.mjs';

describe('collectEnvironment', () => {
  it('fingerprint 항목을 모두 채운다', () => {
    const environment = collectEnvironment();
    for (const field of FINGERPRINT_FIELDS) {
      assert.ok(field in environment, `${field}가 없다`);
    }
    assert.equal(environment.node, process.version);
    assert.equal(environment.chromium, null);
  });

  it('Chromium 버전을 받아 넣는다', () => {
    assert.equal(collectEnvironment({ chromium: '141.0.0' }).chromium, '141.0.0');
  });
});

describe('environmentFingerprint', () => {
  it('같은 값이면 같은 문자열이 나온다', () => {
    const environment = collectEnvironment();
    assert.equal(environmentFingerprint(environment), environmentFingerprint({ ...environment }));
  });

  it('fingerprint에 없는 항목은 문자열을 바꾸지 않는다', () => {
    const environment = collectEnvironment();
    assert.equal(environmentFingerprint({ ...environment, osRelease: '다른 커널' }), environmentFingerprint(environment));
  });
});

describe('compareEnvironments', () => {
  const base = { node: 'v22.13.0', platform: 'linux', arch: 'x64', cpuModel: 'A', cores: 4, memoryGiB: 16, chromium: null };

  it('같은 환경이면 다른 항목이 없다', () => {
    assert.deepEqual(compareEnvironments(base, { ...base }), { same: true, differences: [] });
  });

  it('다른 항목을 기준선 값과 함께 알려 준다', () => {
    const result = compareEnvironments(base, { ...base, cores: 8, cpuModel: 'B' });
    assert.equal(result.same, false);
    assert.deepEqual(result.differences, [
      { field: 'cpuModel', baseline: 'A', actual: 'B' },
      { field: 'cores', baseline: 4, actual: 8 },
    ]);
  });

  it('Chromium 버전이 다르면 다른 환경으로 본다', () => {
    assert.equal(compareEnvironments(base, { ...base, chromium: '141.0.0' }).same, false);
  });
});

describe('describeEnvironment', () => {
  it('Chromium이 없으면 적지 않는다', () => {
    const line = describeEnvironment({ node: 'v22.13.0', platform: 'linux', arch: 'x64', cpuModel: 'A', cores: 4, memoryGiB: 16, chromium: null });
    assert.match(line, /Node v22\.13\.0/);
    assert.ok(!line.includes('Chromium'));
  });
});
