/**
 * 준비 작업이 만든 tarball을 npm에 배포한다.
 *
 * 순서는 `manifest.json`의 순서(core → elements → react → vue → mcp)이고 한 패키지라도 실패하면
 * 즉시 멈춘다. 다시 실행하면 레지스트리에 같은 버전이 있는지 확인해 다음처럼 처리한다.
 * - 없음(E404): 배포한다.
 * - 있고 `dist.integrity`가 로컬 tarball의 SHA-512 SRI와 같음: 이전 실행에서 올린 같은 파일이므로 건너뛴다.
 * - 있고 값이 다름, 또는 E404가 아닌 오류: 실패한다.
 * 배포한 뒤에는 버전·`dist.integrity`·dist-tag를 다시 조회해 일치할 때만 다음 패키지로 넘어간다.
 *
 * 사용: `TARBALL_DIR=<dir> DIST_TAG=<latest|next> DRY_RUN=<true|false> node scripts/release/publish.mjs`
 * 실행 전에 `SHA256SUMS`로 tarball을 검증하고, 다시 빌드하거나 pack하지 않는다.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sriSha512, verifySha256Sums } from './integrity.mjs';

/** 배포에 허용하는 dist-tag */
export const DIST_TAGS = ['latest', 'next'];

/**
 * `npm view <name>@<version> dist.integrity --json` 결과를 해석한다.
 *
 * @param result - npm 실행 결과
 * @returns `found`(integrity 포함), `missing`(E404), `error`(그 밖의 실패) 중 하나
 */
export function interpretView(result) {
  if (result.code === 0) {
    const value = JSON.parse(result.stdout);
    if (typeof value !== 'string' || !value.startsWith('sha512-')) {
      return { status: 'error', message: `unexpected dist.integrity value: ${result.stdout.trim()}` };
    }
    return { status: 'found', integrity: value };
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = undefined;
  }
  const code = payload?.error?.code;
  if (code === 'E404') return { status: 'missing' };
  return { status: 'error', message: `npm view failed (${code ?? `exit ${result.code}`}): ${(payload?.error?.summary ?? result.stderr).trim()}` };
}

/**
 * 레지스트리 조회 결과와 로컬 tarball의 SRI로 배포 여부를 정한다.
 *
 * @param view - {@link interpretView} 결과
 * @param localIntegrity - 로컬 tarball의 SHA-512 SRI
 * @returns `publish` 또는 `skip`
 * @throws Error 같은 버전이 다른 내용으로 이미 있거나 조회 자체가 실패하면
 */
export function decidePublish(view, localIntegrity) {
  if (view.status === 'missing') return 'publish';
  if (view.status === 'error') throw new Error(view.message);
  if (view.integrity === localIntegrity) return 'skip';
  throw new Error(`already published with different content: registry ${view.integrity}, local ${localIntegrity}`);
}

/**
 * manifest의 패키지를 순서대로 배포한다.
 *
 * @param options - 배포 설정
 * @param options.dir - tarball과 manifest가 있는 디렉터리
 * @param options.manifest - `manifest.json` 항목 목록 (배포 순서)
 * @param options.distTag - 붙일 dist-tag
 * @param options.dryRun - true면 `npm publish --dry-run`만 실행하고 배포 후 확인은 건너뛴다
 * @param options.npm - npm을 실행하는 함수 `(args) => Promise<{ code, stdout, stderr }>`
 * @param options.log - 진행 메시지 출력 함수
 * @returns 패키지별 결과 (`published` / `skipped` / `dry-run`)
 * @throws Error 검증·조회·배포·배포 후 확인이 실패하면 (그 시점에서 중단)
 */
export async function publishAll({ dir, manifest, distTag, dryRun, npm, log = () => {} }) {
  if (!DIST_TAGS.includes(distTag)) throw new Error(`dist_tag must be one of ${DIST_TAGS.join(', ')}, got ${distTag}`);
  const results = [];
  for (const entry of manifest) {
    const spec = `${entry.name}@${entry.version}`;
    const data = await readFile(path.join(dir, entry.file));
    const localIntegrity = sriSha512(data);
    if (localIntegrity !== entry.integrity) {
      throw new Error(`${entry.file} does not match manifest integrity`);
    }
    const view = interpretView(await npm(['view', spec, 'dist.integrity', '--json']));
    const decision = decidePublish(view, localIntegrity);
    if (decision === 'skip') {
      log(`${spec}: already published with the same tarball, skipping`);
      results.push({ name: entry.name, outcome: 'skipped' });
      continue;
    }
    const args = ['publish', path.join(dir, entry.file), '--provenance', '--access', 'public', '--tag', distTag];
    if (dryRun) args.push('--dry-run');
    log(`${spec}: npm ${args.join(' ')}`);
    const published = await npm(args);
    if (published.code !== 0) {
      throw new Error(`npm publish failed for ${spec} (exit ${published.code})\n${published.stderr}`);
    }
    if (dryRun) {
      results.push({ name: entry.name, outcome: 'dry-run' });
      continue;
    }
    const check = interpretView(await npm(['view', spec, 'dist.integrity', '--json']));
    if (check.status !== 'found' || check.integrity !== localIntegrity) {
      throw new Error(`post-publish check failed for ${spec}: ${check.status === 'found' ? `integrity ${check.integrity}` : check.message ?? 'not found'}`);
    }
    const tags = await npm(['view', entry.name, 'dist-tags', '--json']);
    const tagged = tags.code === 0 ? JSON.parse(tags.stdout)?.[distTag] : undefined;
    if (tagged !== entry.version) {
      throw new Error(`post-publish check failed for ${spec}: dist-tag ${distTag} is ${tagged ?? '(unset)'}`);
    }
    log(`${spec}: published and verified (${distTag})`);
    results.push({ name: entry.name, outcome: 'published' });
  }
  return results;
}

/** npm CLI를 실행해 종료 코드와 출력을 모은다. */
function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.env['TARBALL_DIR'];
  const distTag = process.env['DIST_TAG'];
  const dryRunValue = process.env['DRY_RUN'];
  if (dir === undefined || distTag === undefined || !['true', 'false'].includes(dryRunValue ?? '')) {
    process.stderr.write('usage: TARBALL_DIR=<dir> DIST_TAG=<latest|next> DRY_RUN=<true|false> node scripts/release/publish.mjs\n');
    process.exit(2);
  }
  const absDir = path.resolve(dir);
  try {
    const files = await verifySha256Sums(absDir, await readFile(path.join(absDir, 'SHA256SUMS'), 'utf8'));
    process.stdout.write(`SHA256SUMS ok: ${files.join(', ')}\n`);
    const manifest = JSON.parse(await readFile(path.join(absDir, 'manifest.json'), 'utf8'));
    const results = await publishAll({
      dir: absDir,
      manifest,
      distTag,
      dryRun: dryRunValue === 'true',
      npm: runNpm,
      log: (message) => process.stdout.write(`${message}\n`),
    });
    for (const result of results) process.stdout.write(`${result.name}: ${result.outcome}\n`);
  } catch (error) {
    process.stdout.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
