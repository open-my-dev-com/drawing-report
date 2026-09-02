/**
 * 배포할 tarball을 만든다.
 *
 * 다섯 패키지를 배포 순서대로 `pnpm pack`해 출력 디렉터리에 모으고, 배포 작업이 같은 파일만
 * 쓰도록 `SHA256SUMS`와 `manifest.json`(이름·버전·파일명·SHA-256·SHA-512 SRI)을 함께 남긴다.
 * 빌드는 하지 않는다 — 호출 전에 `pnpm verify`·`pnpm verify:packages`로 빌드와 검증을 마친다.
 *
 * 사용: `node scripts/release/pack.mjs --out <dir>`
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSha256Sums, sha256Hex, sriSha512 } from './integrity.mjs';
import { RELEASE_PACKAGES } from './inputs.mjs';

/**
 * 출력 디렉터리의 tarball에서 manifest 항목을 만든다.
 *
 * @param outDir - tarball이 있는 디렉터리
 * @param packages - 이름·버전·tarball 파일명 목록 (배포 순서)
 * @returns manifest 항목 목록 (같은 순서)
 * @throws Error tarball 파일이 없으면
 */
export async function buildManifest(outDir, packages) {
  const entries = [];
  for (const { name, version, file } of packages) {
    let data;
    try {
      data = await readFile(path.join(outDir, file));
    } catch {
      throw new Error(`tarball is missing: ${file}`);
    }
    entries.push({ name, version, file, sha256: sha256Hex(data), integrity: sriSha512(data) });
  }
  return entries;
}

/**
 * `pnpm pack`이 만드는 tarball 파일명 (`@scope/name` → `scope-name-<version>.tgz`).
 *
 * @param name - 패키지 이름
 * @param version - 패키지 버전
 * @returns tarball 파일명
 */
export function tarballFileName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** 명령을 실행하고 실패하면 stderr를 담아 던진다. */
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} failed (exit ${code})\n${output}`));
    });
  });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outIndex = process.argv.indexOf('--out');
  const outDir = outIndex === -1 ? undefined : process.argv[outIndex + 1];
  if (outDir === undefined) {
    process.stderr.write('usage: node scripts/release/pack.mjs --out <dir>\n');
    process.exit(2);
  }
  const absOut = path.resolve(outDir);
  await mkdir(absOut, { recursive: true });
  if ((await readdir(absOut)).length > 0) {
    process.stderr.write(`output directory is not empty: ${absOut}\n`);
    process.exit(1);
  }
  try {
    const packages = [];
    for (const dir of RELEASE_PACKAGES) {
      const packageDir = path.join(root, 'packages', dir);
      const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
      await run('pnpm', ['pack', '--pack-destination', absOut], packageDir);
      packages.push({ name: manifest.name, version: manifest.version, file: tarballFileName(manifest.name, manifest.version) });
    }
    const entries = await buildManifest(absOut, packages);
    await writeFile(path.join(absOut, 'SHA256SUMS'), formatSha256Sums(entries));
    await writeFile(path.join(absOut, 'manifest.json'), `${JSON.stringify(entries, null, 2)}\n`);
    for (const entry of entries) process.stdout.write(`${entry.file}  ${entry.sha256}\n`);
  } catch (error) {
    process.stdout.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
