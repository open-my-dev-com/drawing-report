// 배포 도우미의 단위 시험 — `node --test`로 실행한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { formatSha256Sums, parseSha256Sums, sha256Hex, sriSha512, verifySha256Sums } from './integrity.mjs';
import { isExactSemver, isPrerelease, validateReleaseInputs } from './inputs.mjs';
import { buildManifest, tarballFileName } from './pack.mjs';
import { decidePublish, interpretView, publishAll } from './publish.mjs';

const ALL_SAME = {
  '@omdc-slipkit/core': '0.1.0',
  '@omdc-slipkit/elements': '0.1.0',
  '@omdc-slipkit/react': '0.1.0',
  '@omdc-slipkit/vue': '0.1.0',
  '@omdc-slipkit/mcp': '0.1.0',
};

describe('inputs', () => {
  it('정확한 SemVer만 허용한다', () => {
    for (const ok of ['0.0.1', '1.2.3', '1.0.0-beta.1', '1.0.0+build.5', '1.0.0-rc.1+sha.abc']) assert.equal(isExactSemver(ok), true, ok);
    for (const bad of ['v1.2.3', '1.2', '^1.2.3', '1.02.3', '1.2.3 ', '', undefined, 'latest']) assert.equal(isExactSemver(bad), false, String(bad));
  });

  it('prerelease 식별자가 붙은 버전을 가려낸다', () => {
    for (const yes of ['1.0.0-beta.1', '0.1.0-rc.1+sha.abc', '2.0.0-0']) assert.equal(isPrerelease(yes), true, yes);
    for (const no of ['1.0.0', '0.1.0+build.5', '1.0', undefined]) assert.equal(isPrerelease(no), false, String(no));
  });

  it('main·SemVer·dist-tag·환경·다섯 패키지 버전 일치를 모두 요구한다', () => {
    const base = { ref: 'refs/heads/main', version: '0.1.0', distTag: 'latest', environment: 'npm-publish', packageVersions: ALL_SAME };
    assert.deepEqual(validateReleaseInputs(base), []);
    assert.match(validateReleaseInputs({ ...base, ref: 'refs/heads/feat/x' })[0], /refs\/heads\/main/);
    assert.match(validateReleaseInputs({ ...base, version: '0.1' })[0], /exact SemVer/);
    assert.match(validateReleaseInputs({ ...base, environment: 'staging' })[0], /npm-publish/);
    const mismatch = validateReleaseInputs({ ...base, packageVersions: { ...ALL_SAME, '@omdc-slipkit/mcp': '0.0.9' } });
    assert.deepEqual(mismatch, ['@omdc-slipkit/mcp is 0.0.9, expected 0.1.0']);
    const missing = validateReleaseInputs({ ...base, packageVersions: { '@omdc-slipkit/core': '0.1.0' } });
    assert.match(missing[0], /expected 5 packages, got 1/);
  });

  it('허용 목록 밖의 dist-tag와 prerelease의 latest를 거부한다', () => {
    const prerelease = { '@omdc-slipkit/core': '1.0.0-beta.1', '@omdc-slipkit/elements': '1.0.0-beta.1', '@omdc-slipkit/react': '1.0.0-beta.1', '@omdc-slipkit/vue': '1.0.0-beta.1', '@omdc-slipkit/mcp': '1.0.0-beta.1' };
    const base = { ref: 'refs/heads/main', version: '0.1.0', distTag: 'latest', environment: 'npm-publish', packageVersions: ALL_SAME };
    assert.match(validateReleaseInputs({ ...base, distTag: 'beta' })[0], /dist_tag must be one of latest, next/);
    assert.match(validateReleaseInputs({ ...base, distTag: undefined })[0], /got \(unset\)/);
    const pre = { ...base, version: '1.0.0-beta.1', packageVersions: prerelease };
    assert.deepEqual(validateReleaseInputs(pre), ['prerelease version 1.0.0-beta.1 must not use dist_tag latest']);
    assert.deepEqual(validateReleaseInputs({ ...pre, distTag: 'next' }), []);
  });
});

describe('integrity', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'slipkit-release-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('SHA256SUMS를 만들고 다시 읽는다', () => {
    const text = formatSha256Sums([{ file: 'a.tgz', sha256: 'a'.repeat(64) }, { file: 'b c.tgz', sha256: 'b'.repeat(64) }]);
    assert.equal(text, `${'a'.repeat(64)}  a.tgz\n${'b'.repeat(64)}  b c.tgz\n`);
    assert.deepEqual(parseSha256Sums(text), [{ sha256: 'a'.repeat(64), file: 'a.tgz' }, { sha256: 'b'.repeat(64), file: 'b c.tgz' }]);
    assert.throws(() => parseSha256Sums('zz  a.tgz\n'), /malformed/);
  });

  it('파일 해시가 목록과 같을 때만 통과한다', async () => {
    const data = Buffer.from('tarball bytes');
    await writeFile(path.join(dir, 'a.tgz'), data);
    const good = formatSha256Sums([{ file: 'a.tgz', sha256: sha256Hex(data) }]);
    assert.deepEqual(await verifySha256Sums(dir, good), ['a.tgz']);
    const bad = formatSha256Sums([{ file: 'a.tgz', sha256: '0'.repeat(64) }]);
    await assert.rejects(verifySha256Sums(dir, bad), /SHA-256 mismatch for a\.tgz/);
    const missing = formatSha256Sums([{ file: 'nope.tgz', sha256: sha256Hex(data) }]);
    await assert.rejects(verifySha256Sums(dir, missing), /missing: nope\.tgz/);
    await assert.rejects(verifySha256Sums(dir, ''), /no entries/);
  });

  it('SRI는 npm dist.integrity 형식이다', () => {
    const sri = sriSha512(Buffer.from('x'));
    assert.match(sri, /^sha512-[A-Za-z0-9+/]+=*$/);
    assert.equal(Buffer.from(sri.slice(7), 'base64').length, 64);
  });
});

describe('pack', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'slipkit-release-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('pnpm pack 파일명 규칙을 따른다', () => {
    assert.equal(tarballFileName('@omdc-slipkit/core', '0.1.0'), 'omdc-slipkit-core-0.1.0.tgz');
  });

  it('manifest에 순서·해시·SRI를 기록하고 없는 파일은 오류다', async () => {
    const a = Buffer.from('core');
    const b = Buffer.from('elements');
    await writeFile(path.join(dir, 'a.tgz'), a);
    await writeFile(path.join(dir, 'b.tgz'), b);
    const manifest = await buildManifest(dir, [
      { name: '@omdc-slipkit/core', version: '0.1.0', file: 'a.tgz' },
      { name: '@omdc-slipkit/elements', version: '0.1.0', file: 'b.tgz' },
    ]);
    assert.deepEqual(manifest.map((entry) => entry.name), ['@omdc-slipkit/core', '@omdc-slipkit/elements']);
    assert.equal(manifest[0].sha256, sha256Hex(a));
    assert.equal(manifest[1].integrity, sriSha512(b));
    await assert.rejects(buildManifest(dir, [{ name: 'x', version: '1.0.0', file: 'missing.tgz' }]), /missing: missing\.tgz/);
  });
});

describe('publish', () => {
  const SRI = 'sha512-AAAA';
  const e404 = { code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: 'Not Found' } }), stderr: 'npm error 404' };
  const e401 = { code: 1, stdout: JSON.stringify({ error: { code: 'E401', summary: 'Unauthorized' } }), stderr: 'npm error 401' };
  const network = { code: 1, stdout: '', stderr: 'npm error code ENOTFOUND' };

  it('조회 결과를 found·missing·error로 나눈다', () => {
    assert.deepEqual(interpretView({ code: 0, stdout: `"${SRI}"\n`, stderr: '' }), { status: 'found', integrity: SRI });
    assert.deepEqual(interpretView(e404), { status: 'missing' });
    assert.equal(interpretView(e401).status, 'error');
    assert.match(interpretView(e401).message, /E401/);
    assert.equal(interpretView(network).status, 'error');
    assert.match(interpretView(network).message, /ENOTFOUND/);
    assert.equal(interpretView({ code: 0, stdout: '{"weird":1}', stderr: '' }).status, 'error');
  });

  it('성공했는데 출력이 비었거나 JSON이 아니면 원인을 적은 조회 오류다', () => {
    for (const stdout of ['', '   \n', undefined]) {
      const view = interpretView({ code: 0, stdout, stderr: '' });
      assert.equal(view.status, 'error');
      assert.match(view.message, /no dist\.integrity output/);
    }
    const broken = interpretView({ code: 0, stdout: 'sha512-AAAA', stderr: '' });
    assert.equal(broken.status, 'error');
    assert.match(broken.message, /not JSON/);
  });

  it('E404는 배포, 같은 SRI는 건너뜀, 다른 SRI·조회 오류는 실패다', () => {
    assert.equal(decidePublish({ status: 'missing' }, SRI), 'publish');
    assert.equal(decidePublish({ status: 'found', integrity: SRI }, SRI), 'skip');
    assert.throws(() => decidePublish({ status: 'found', integrity: 'sha512-BBBB' }, SRI), /different content/);
    assert.throws(() => decidePublish({ status: 'error', message: 'npm view failed (E401)' }, SRI), /E401/);
  });

  describe('publishAll', () => {
    let dir;
    let manifest;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'slipkit-release-'));
      manifest = [];
      for (const [name, content] of [['@omdc-slipkit/core', 'core'], ['@omdc-slipkit/elements', 'elements'], ['@omdc-slipkit/mcp', 'mcp']]) {
        const file = tarballFileName(name, '0.1.0');
        const data = Buffer.from(content);
        await writeFile(path.join(dir, file), data);
        manifest.push({ name, version: '0.1.0', file, sha256: sha256Hex(data), integrity: sriSha512(data) });
      }
    });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    /** 레지스트리 상태를 흉내 내는 npm 실행 함수. 호출 기록을 남긴다. */
    function fakeNpm(registry, { publishFails = [], tagAfterPublish = 'latest' } = {}) {
      const calls = [];
      const npm = async (args) => {
        calls.push(args);
        if (args[0] === 'view' && args[2] === 'dist.integrity') {
          const state = registry[args[1]];
          if (state === undefined) return e404;
          if (state.error !== undefined) return state.error;
          return { code: 0, stdout: `"${state.integrity}"\n`, stderr: '' };
        }
        if (args[0] === 'view' && args[2] === 'dist-tags') {
          const tags = {};
          for (const [spec, state] of Object.entries(registry)) {
            if (spec.startsWith(`${args[1]}@`) && state.tag !== undefined) tags[state.tag] = spec.slice(args[1].length + 1);
          }
          return { code: 0, stdout: JSON.stringify(tags), stderr: '' };
        }
        if (args[0] === 'publish') {
          const file = path.basename(args[1]);
          const entry = manifest.find((item) => item.file === file);
          if (publishFails.includes(entry.name)) return { code: 1, stdout: '', stderr: 'npm error E403' };
          if (!args.includes('--dry-run')) registry[`${entry.name}@${entry.version}`] = { integrity: entry.integrity, tag: tagAfterPublish };
          return { code: 0, stdout: '', stderr: '' };
        }
        throw new Error(`unexpected npm call: ${args.join(' ')}`);
      };
      return { npm, calls };
    }

    it('없는 패키지를 순서대로 배포하고 배포 후 확인을 거친다', async () => {
      const { npm, calls } = fakeNpm({});
      const results = await publishAll({ dir, manifest, distTag: 'latest', dryRun: false, npm });
      assert.deepEqual(results.map((result) => result.outcome), ['published', 'published', 'published']);
      const publishes = calls.filter((args) => args[0] === 'publish');
      assert.deepEqual(publishes.map((args) => path.basename(args[1])), manifest.map((entry) => entry.file));
      assert.deepEqual(publishes[0].slice(2), ['--provenance', '--access', 'public', '--tag', 'latest']);
    });

    it('같은 tarball이 이미 있으면 건너뛰고 나머지를 이어서 배포한다', async () => {
      const { npm, calls } = fakeNpm({ '@omdc-slipkit/core@0.1.0': { integrity: manifest[0].integrity, tag: 'latest' } });
      const results = await publishAll({ dir, manifest, distTag: 'latest', dryRun: false, npm });
      assert.deepEqual(results.map((result) => result.outcome), ['skipped', 'published', 'published']);
      assert.equal(calls.filter((args) => args[0] === 'publish').length, 2);
    });

    it('같은 버전이 다른 내용이면 즉시 실패하고 뒤 패키지를 건드리지 않는다', async () => {
      const { npm, calls } = fakeNpm({ '@omdc-slipkit/core@0.1.0': { integrity: 'sha512-other', tag: 'latest' } });
      await assert.rejects(publishAll({ dir, manifest, distTag: 'latest', dryRun: false, npm }), /different content/);
      assert.equal(calls.filter((args) => args[0] === 'publish').length, 0);
    });

    it('E404가 아닌 조회 오류(인증·통신)는 실패다', async () => {
      for (const error of [e401, network]) {
        const { npm, calls } = fakeNpm({ '@omdc-slipkit/core@0.1.0': { error } });
        await assert.rejects(publishAll({ dir, manifest, distTag: 'latest', dryRun: false, npm }), /npm view failed/);
        assert.equal(calls.filter((args) => args[0] === 'publish').length, 0);
      }
    });

    it('배포가 실패하면 그 자리에서 멈춘다', async () => {
      const { npm, calls } = fakeNpm({}, { publishFails: ['@omdc-slipkit/elements'] });
      await assert.rejects(publishAll({ dir, manifest, distTag: 'latest', dryRun: false, npm }), /npm publish failed for @omdc-slipkit\/elements/);
      assert.deepEqual(calls.filter((args) => args[0] === 'publish').map((args) => path.basename(args[1])), [manifest[0].file, manifest[1].file]);
    });

    it('배포 후 dist-tag가 요청과 다르면 실패한다', async () => {
      const { npm } = fakeNpm({}, { tagAfterPublish: 'latest' });
      await assert.rejects(publishAll({ dir, manifest, distTag: 'next', dryRun: false, npm }), /dist-tag next is \(unset\)/);
    });

    it('dry-run은 --dry-run으로 명령만 확인하고 배포 후 확인을 하지 않는다', async () => {
      const { npm, calls } = fakeNpm({});
      const results = await publishAll({ dir, manifest, distTag: 'next', dryRun: true, npm });
      assert.deepEqual(results.map((result) => result.outcome), ['dry-run', 'dry-run', 'dry-run']);
      const publishes = calls.filter((args) => args[0] === 'publish');
      assert.equal(publishes.length, 3);
      assert.ok(publishes.every((args) => args.includes('--dry-run') && args.includes('--provenance')));
      assert.equal(calls.filter((args) => args[2] === 'dist-tags').length, 0);
    });

    it('tarball이 manifest와 다르거나 dist-tag가 허용 목록 밖이면 실패한다', async () => {
      await writeFile(path.join(dir, manifest[0].file), Buffer.from('tampered'));
      const { npm } = fakeNpm({});
      await assert.rejects(publishAll({ dir, manifest, distTag: 'latest', dryRun: true, npm }), /does not match manifest integrity/);
      await assert.rejects(publishAll({ dir, manifest, distTag: 'beta', dryRun: true, npm }), /dist_tag must be one of/);
    });
  });
});

const WORKFLOW_TEXT = readFileSync(fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url)), 'utf8');

/**
 * release.yml의 최상위 `jobs:` 아래를 작업 이름별 원문 블록으로 나눈다.
 *
 * @returns 작업 이름을 키로, 해당 작업의 YAML 원문을 값으로 갖는 Map.
 */
function workflowJobs() {
  const lines = WORKFLOW_TEXT.split('\n');
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, 'release.yml에 최상위 jobs: 키가 없다');
  const blocks = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    // 들여쓰기가 없는 줄은 다음 최상위 키다.
    if (line.trim() !== '' && !line.startsWith(' ')) break;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header !== null) {
      current = header[1];
      blocks.set(current, []);
      continue;
    }
    if (current !== null) blocks.get(current).push(line);
  }
  return new Map([...blocks].map(([name, body]) => [name, body.join('\n')]));
}

describe('release workflow', () => {
  const jobs = workflowJobs();
  const publishJobs = ['publish-dry-run', 'publish'];

  it('작업 구성은 prepare · publish-dry-run · publish · status다', () => {
    assert.deepEqual([...jobs.keys()], ['prepare', 'publish-dry-run', 'publish', 'status']);
  });

  it('tarball을 만드는 pack은 prepare에서만 실행한다', () => {
    assert.match(jobs.get('prepare'), /scripts\/release\/pack\.mjs/);
    for (const name of publishJobs) {
      assert.doesNotMatch(jobs.get(name), /pack\.mjs|pnpm pack/, `${name}이 tarball을 다시 만든다`);
    }
  });

  it('publish 작업은 prepare가 올린 artifact를 그대로 내려받는다', () => {
    const uploaded = /uses: actions\/upload-artifact@[^\n]+\n\s+with:\n\s+name: ([^\n]+)\n/.exec(jobs.get('prepare'));
    assert.ok(uploaded !== null, 'prepare가 artifact를 올리지 않는다');
    for (const name of publishJobs) {
      const job = jobs.get(name);
      assert.match(job, /^\s+needs: prepare$/m, `${name}이 prepare를 needs로 두지 않는다`);
      const downloaded = /uses: actions\/download-artifact@[^\n]+\n\s+with:\n\s+name: ([^\n]+)\n/.exec(job);
      assert.ok(downloaded !== null, `${name}이 artifact를 내려받지 않는다`);
      assert.equal(downloaded[1], uploaded[1]);
    }
  });

  it('publish 작업은 소스를 다시 빌드하지 않는다', () => {
    for (const name of publishJobs) {
      assert.doesNotMatch(jobs.get(name), /pnpm install|pnpm verify|pnpm build|corepack/, `${name}이 빌드 단계를 갖는다`);
    }
  });

  it('artifact 보존 기간은 재개할 수 있도록 7일이다', () => {
    assert.match(jobs.get('prepare'), /^\s+retention-days: 7$/m);
  });

  it('배포 실패 안내는 원래 실행의 Re-run failed jobs를 가리킨다', () => {
    const status = jobs.get('status');
    assert.match(status, /Re-run failed jobs/);
    assert.match(status, /Re-run all jobs/);
    assert.match(status, /Run workflow/);
    // 새 workflow 실행으로 오해하게 하던 이전 문구가 남아 있으면 안 된다.
    assert.doesNotMatch(status, /같은 입력으로 다시 실행/);
    assert.doesNotMatch(status, /다시 실행하면/);
  });
});
