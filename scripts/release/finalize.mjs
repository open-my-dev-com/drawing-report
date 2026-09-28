/**
 * npm 배포 결과를 확인하고 같은 커밋의 GitHub Release를 만듭니다.
 *
 * 준비 작업이 만든 tarball과 manifest를 다시 검증하고, npm의 다섯 패키지에서 SRI·dist-tag·provenance가
 * 모두 확인된 뒤에만 태그와 Release를 만듭니다. 이미 같은 Release가 있으면 본문·커밋·자산 digest를
 * 검사하고 그대로 사용합니다.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrerelease } from './inputs.mjs';
import { sha256Hex, verifySha256Sums } from './integrity.mjs';
import { buildReleaseBody, readReleaseNotes } from './release-notes.mjs';

/** npm 레지스트리 반영을 기다리는 기본 횟수입니다. */
const REGISTRY_ATTEMPTS = 12;

/** npm 레지스트리 재확인 간격입니다. */
const REGISTRY_DELAY_MS = 5_000;

/**
 * 명령을 실행해 종료 코드와 출력을 반환합니다.
 *
 * @param command - 실행 파일
 * @param args - 명령 인자
 * @param options - 실행 위치 등 프로세스 옵션
 * @param options.cwd - 명령을 실행할 디렉터리
 * @returns 종료 코드와 표준 출력·오류
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * 공개된 정확한 버전을 설치하고 npm의 서명·provenance 검증을 실행합니다.
 *
 * @param options - 검사 설정
 * @param options.manifest - release manifest
 * @param options.npm - npm 실행 함수
 * @returns 완료 시 undefined
 * @throws Error 설치 또는 서명 검증이 실패하면 발생합니다.
 */
export async function verifyProvenanceSignatures({ manifest, npm }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slipkit-release-audit-'));
  try {
    const dependencies = Object.fromEntries(manifest.map((entry) => [entry.name, entry.version]));
    await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`);
    const installed = await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir });
    if (installed.code !== 0) throw new Error(`npm install for provenance audit failed: ${installed.stderr.trim()}`);
    const audited = await npm(['audit', 'signatures', '--include-attestations', '--json'], { cwd: dir });
    if (audited.code !== 0) throw new Error(`npm provenance audit failed: ${audited.stderr.trim() || audited.stdout.trim()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * JSON 명령 출력을 읽습니다.
 *
 * @param result - 명령 실행 결과
 * @param label - 오류에 표시할 작업 이름
 * @returns 해석한 JSON 값
 * @throws Error 명령이 실패하거나 출력이 JSON이 아니면 발생합니다.
 */
export function parseJsonResult(result, label) {
  if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}): ${result.stderr.trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * npm에 공개된 한 패키지가 배포 산출물과 같은지 검사합니다.
 *
 * @param options - 검사 대상
 * @param options.entry - release manifest 항목
 * @param options.dist - npm의 `dist` 값
 * @param options.tags - npm dist-tag 값
 * @param options.distTag - 이번 배포의 dist-tag
 * @returns 아직 확인되지 않은 항목 목록
 * @throws Error 같은 버전의 SRI가 다르면 발생합니다.
 */
export function inspectPublishedPackage({ entry, dist, tags, distTag }) {
  if (dist?.integrity !== entry.integrity) {
    throw new Error(`${entry.name}@${entry.version} integrity is ${dist?.integrity ?? '(unset)'}, expected ${entry.integrity}`);
  }
  const problems = [];
  if (tags?.[distTag] !== entry.version) {
    problems.push(`dist-tag ${distTag} is ${tags?.[distTag] ?? '(unset)'}`);
  }
  const attestations = dist?.attestations;
  if (
    typeof attestations?.url !== 'string'
    || attestations.url === ''
    || typeof attestations?.provenance?.predicateType !== 'string'
    || attestations.provenance.predicateType === ''
  ) {
    problems.push('provenance attestation is missing');
  }
  return problems;
}

/**
 * npm 레지스트리에서 한 패키지의 배포 결과를 확인합니다.
 *
 * @param options - 검사 설정
 * @param options.entry - release manifest 항목
 * @param options.distTag - 이번 배포의 dist-tag
 * @param options.npm - npm 실행 함수
 * @returns 확인되지 않은 항목 목록
 */
export async function checkPublishedPackage({ entry, distTag, npm }) {
  const spec = `${entry.name}@${entry.version}`;
  const dist = parseJsonResult(await npm(['view', spec, 'dist', '--json']), `npm view ${spec} dist`);
  const tags = parseJsonResult(await npm(['view', entry.name, 'dist-tags', '--json']), `npm view ${entry.name} dist-tags`);
  return inspectPublishedPackage({ entry, dist, tags, distTag });
}

/**
 * npm 레지스트리에 SRI·dist-tag·provenance가 반영될 때까지 확인합니다.
 *
 * @param options - 검사 설정
 * @param options.manifest - release manifest
 * @param options.distTag - 이번 배포의 dist-tag
 * @param options.npm - npm 실행 함수
 * @param options.attempts - 최대 확인 횟수
 * @param options.delay - 다음 확인 전 대기 함수
 * @param options.log - 진행 메시지 출력 함수
 * @returns 완료 시 undefined
 * @throws Error 제한 횟수 안에 확인되지 않으면 발생합니다.
 */
export async function verifyPublishedPackages({
  manifest,
  distTag,
  npm,
  attempts = REGISTRY_ATTEMPTS,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  for (const entry of manifest) {
    let lastProblems = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        lastProblems = await checkPublishedPackage({ entry, distTag, npm });
      } catch (error) {
        lastProblems = [error instanceof Error ? error.message : String(error)];
        if (lastProblems[0].includes('integrity is')) throw error;
      }
      if (lastProblems.length === 0) {
        log(`${entry.name}@${entry.version}: SRI, ${distTag}, provenance verified`);
        break;
      }
      if (attempt === attempts) {
        throw new Error(`${entry.name}@${entry.version} was not fully visible in npm: ${lastProblems.join(', ')}`);
      }
      log(`${entry.name}@${entry.version}: waiting for npm registry (${lastProblems.join(', ')})`);
      await delay(REGISTRY_DELAY_MS);
    }
  }
}

/**
 * GitHub API 조회 결과를 `found`와 `missing`으로 구분합니다.
 *
 * @param result - `gh api` 실행 결과
 * @param label - 오류에 표시할 대상
 * @returns 조회 상태와 값
 * @throws Error 404가 아닌 API 오류면 발생합니다.
 */
export function interpretGitHubLookup(result, label) {
  if (result.code === 0) return { status: 'found', value: parseJsonResult(result, label) };
  if (/HTTP 404|status code 404|Not Found/i.test(result.stderr)) return { status: 'missing' };
  throw new Error(`${label} failed (exit ${result.code}): ${result.stderr.trim()}`);
}

/**
 * GitHub Release 자산으로 올릴 파일과 SHA-256을 반환합니다.
 *
 * @param dir - 배포 산출물 디렉터리
 * @param manifest - release manifest
 * @returns 파일 경로·이름·digest 목록
 */
export async function releaseAssets(dir, manifest) {
  const names = [...manifest.map((entry) => entry.file), 'manifest.json', 'SHA256SUMS'];
  return Promise.all(names.map(async (name) => {
    const file = path.join(dir, name);
    return { file, name, digest: `sha256:${sha256Hex(await readFile(file))}` };
  }));
}

/**
 * 기존 GitHub Release가 이번 배포와 같은지 검사합니다.
 *
 * @param options - 검사 대상
 * @param options.release - GitHub Release API 응답
 * @param options.tagCommit - 태그가 가리키는 커밋
 * @param options.version - 배포 버전
 * @param options.sha - 워크플로 커밋
 * @param options.body - 기대하는 Release 본문
 * @param options.assets - 기대하는 자산
 * @returns 누락된 자산 목록
 * @throws Error 커밋·본문·자산 내용이 다르면 발생합니다.
 */
export function inspectExistingRelease({ release, tagCommit, version, sha, body, assets }) {
  if (tagCommit !== sha) throw new Error(`tag v${version} points to ${tagCommit}, expected ${sha}`);
  if (release.name !== `SlipKit ${version}`) throw new Error(`release title is ${release.name}, expected SlipKit ${version}`);
  if (release.body?.trim() !== body.trim()) throw new Error(`release v${version} has different notes`);
  if (Boolean(release.prerelease) !== isPrerelease(version)) throw new Error(`release v${version} has the wrong prerelease state`);
  if (release.draft) throw new Error(`release v${version} is still a draft`);
  const existing = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
  const missing = [];
  for (const asset of assets) {
    const uploaded = existing.get(asset.name);
    if (uploaded === undefined) {
      missing.push(asset);
    } else if (uploaded.digest !== asset.digest) {
      throw new Error(`release asset ${asset.name} digest is ${uploaded.digest ?? '(unset)'}, expected ${asset.digest}`);
    }
  }
  return missing;
}

/**
 * 생성하거나 보완한 GitHub Release를 API에서 다시 읽어 최종 상태를 검사합니다.
 *
 * @param options - 검사 대상
 * @param options.gh - GitHub CLI 실행 함수
 * @param options.releaseEndpoint - Release API 경로
 * @param options.refEndpoint - 태그 ref API 경로
 * @param options.version - 배포 버전
 * @param options.sha - 워크플로 커밋
 * @param options.body - 기대하는 Release 본문
 * @param options.assets - 기대하는 자산
 * @returns 완료 시 undefined
 */
async function verifyGitHubRelease({ gh, releaseEndpoint, refEndpoint, version, sha, body, assets }) {
  const [releaseLookup, refLookup] = await Promise.all([
    gh(['api', releaseEndpoint]),
    gh(['api', refEndpoint]),
  ]);
  const releaseState = interpretGitHubLookup(releaseLookup, `GitHub Release v${version}`);
  const refState = interpretGitHubLookup(refLookup, `Git tag v${version}`);
  if (releaseState.status !== 'found' || refState.status !== 'found') {
    throw new Error(`GitHub Release v${version} was not visible after creation`);
  }
  const missing = inspectExistingRelease({
    release: releaseState.value,
    tagCommit: refState.value?.object?.sha,
    version,
    sha,
    body,
    assets,
  });
  if (missing.length > 0) {
    throw new Error(`GitHub Release v${version} is missing assets after upload: ${missing.map((asset) => asset.name).join(', ')}`);
  }
}

/**
 * GitHub Release를 생성하거나 같은 Release가 이미 있음을 확인합니다.
 *
 * @param options - Release 설정
 * @param options.dir - 배포 산출물 디렉터리
 * @param options.manifest - release manifest
 * @param options.version - 배포 버전
 * @param options.repo - `owner/repository`
 * @param options.sha - 워크플로 커밋
 * @param options.body - Release 본문
 * @param options.gh - GitHub CLI 실행 함수
 * @param options.log - 진행 메시지 출력 함수
 * @returns `created` 또는 `existing`
 */
export async function ensureGitHubRelease({ dir, manifest, version, repo, sha, body, gh, log = () => {} }) {
  const tag = `v${version}`;
  const releaseEndpoint = `repos/${repo}/releases/tags/${tag}`;
  const refEndpoint = `repos/${repo}/git/ref/tags/${tag}`;
  const [releaseLookup, refLookup] = await Promise.all([
    gh(['api', releaseEndpoint]),
    gh(['api', refEndpoint]),
  ]);
  const releaseState = interpretGitHubLookup(releaseLookup, `GitHub Release ${tag}`);
  const refState = interpretGitHubLookup(refLookup, `Git tag ${tag}`);
  const assets = await releaseAssets(dir, manifest);
  if (releaseState.status === 'found') {
    if (refState.status !== 'found') throw new Error(`release ${tag} exists without a tag ref`);
    const missing = inspectExistingRelease({
      release: releaseState.value,
      tagCommit: refState.value?.object?.sha,
      version,
      sha,
      body,
      assets,
    });
    if (missing.length > 0) {
      const uploaded = await gh(['release', 'upload', tag, ...missing.map((asset) => asset.file), '--repo', repo]);
      if (uploaded.code !== 0) throw new Error(`gh release upload failed: ${uploaded.stderr.trim()}`);
      await verifyGitHubRelease({ gh, releaseEndpoint, refEndpoint, version, sha, body, assets });
    }
    log(`${tag}: existing GitHub Release verified`);
    return 'existing';
  }
  if (refState.status === 'found' && refState.value?.object?.sha !== sha) {
    throw new Error(`tag ${tag} points to ${refState.value?.object?.sha ?? '(unset)'}, expected ${sha}`);
  }
  const notesFile = path.join(dir, 'release-notes.md');
  await writeFile(notesFile, body);
  const args = [
    'release', 'create', tag,
    ...assets.map((asset) => asset.file),
    '--repo', repo,
    '--title', `SlipKit ${version}`,
    '--notes-file', notesFile,
  ];
  if (refState.status === 'found') args.push('--verify-tag');
  else args.push('--target', sha);
  if (isPrerelease(version)) args.push('--prerelease', '--latest=false');
  else args.push('--latest');
  const created = await gh(args);
  if (created.code !== 0) throw new Error(`gh release create failed: ${created.stderr.trim()}`);
  await verifyGitHubRelease({ gh, releaseEndpoint, refEndpoint, version, sha, body, assets });
  log(`${tag}: GitHub Release created`);
  return 'created';
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dirValue = process.env['TARBALL_DIR'];
  const version = process.env['RELEASE_VERSION'];
  const distTag = process.env['DIST_TAG'];
  const repo = process.env['GITHUB_REPOSITORY'];
  const sha = process.env['GITHUB_SHA'];
  if ([dirValue, version, distTag, repo, sha].some((value) => value === undefined || value === '')) {
    process.stderr.write('usage: TARBALL_DIR, RELEASE_VERSION, DIST_TAG, GITHUB_REPOSITORY, and GITHUB_SHA are required\n');
    process.exit(2);
  }
  const dir = path.resolve(dirValue);
  const npm = (args, options) => runCommand('npm', args, options);
  const gh = (args) => runCommand('gh', args);
  try {
    await verifySha256Sums(dir, await readFile(path.join(dir, 'SHA256SUMS'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    if (manifest.length !== 5 || manifest.some((entry) => entry.version !== version)) {
      throw new Error(`manifest must contain five packages at version ${version}`);
    }
    await verifyPublishedPackages({ manifest, distTag, npm, log: (message) => process.stdout.write(`${message}\n`) });
    await verifyProvenanceSignatures({ manifest, npm });
    process.stdout.write('npm registry signatures and provenance attestations verified\n');
    const localizedNotes = await readReleaseNotes(root, version);
    const generated = parseJsonResult(
      await gh(['api', '--method', 'POST', `repos/${repo}/releases/generate-notes`, '-f', `tag_name=v${version}`, '-f', `target_commitish=${sha}`]),
      `generate notes for v${version}`,
    );
    const body = buildReleaseBody(localizedNotes, generated.body ?? '');
    await ensureGitHubRelease({ dir, manifest, version, repo, sha, body, gh, log: (message) => process.stdout.write(`${message}\n`) });
  } catch (error) {
    process.stdout.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
