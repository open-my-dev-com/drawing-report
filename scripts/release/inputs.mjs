/**
 * 배포 워크플로 입력을 검사한다.
 *
 * 워크플로는 입력을 셸 명령에 끼워 넣지 않고 환경변수로 넘기고, 이 스크립트가 다음을 확인한다.
 * - 실행 ref가 `refs/heads/main`인지
 * - `version`이 정확한 SemVer이고 다섯 패키지의 `package.json` 버전과 모두 같은지
 * - `environment`가 `npm-publish`인지
 *
 * 사용: `RELEASE_VERSION=… RELEASE_ENVIRONMENT=… GITHUB_REF=… node scripts/release/inputs.mjs`
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 배포하는 패키지 (배포 순서) */
export const RELEASE_PACKAGES = ['core', 'elements', 'react', 'vue', 'mcp'];

/** 배포 작업에 허용하는 GitHub Environment 이름 */
export const RELEASE_ENVIRONMENT = 'npm-publish';

/** 배포를 허용하는 ref */
export const RELEASE_REF = 'refs/heads/main';

/** semver.org 2.0.0의 정확한 버전 형식 (범위·접두사 없음) */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * 정확한 SemVer 문자열인지 확인한다.
 *
 * @param version - 검사할 문자열
 * @returns SemVer면 true
 */
export function isExactSemver(version) {
  return typeof version === 'string' && SEMVER.test(version);
}

/**
 * 배포 입력을 검사해 문제 목록을 돌려준다. 비어 있으면 통과다.
 *
 * @param input - 검사 대상
 * @param input.ref - 실행 ref (`GITHUB_REF`)
 * @param input.version - 요청한 버전
 * @param input.environment - 요청한 GitHub Environment 이름
 * @param input.packageVersions - 패키지 이름별 `package.json` 버전
 * @returns 문제 설명 목록
 */
export function validateReleaseInputs({ ref, version, environment, packageVersions }) {
  const problems = [];
  if (ref !== RELEASE_REF) problems.push(`release must run from ${RELEASE_REF}, got ${ref ?? '(unset)'}`);
  if (!isExactSemver(version)) problems.push(`version must be exact SemVer, got ${version ?? '(unset)'}`);
  if (environment !== RELEASE_ENVIRONMENT) {
    problems.push(`environment must be ${RELEASE_ENVIRONMENT}, got ${environment ?? '(unset)'}`);
  }
  const names = Object.keys(packageVersions);
  if (names.length !== RELEASE_PACKAGES.length) {
    problems.push(`expected ${RELEASE_PACKAGES.length} packages, got ${names.length}`);
  }
  for (const [name, packageVersion] of Object.entries(packageVersions)) {
    if (packageVersion !== version) problems.push(`${name} is ${packageVersion}, expected ${version}`);
  }
  return problems;
}

/**
 * 워크스페이스 패키지의 이름과 버전을 읽는다.
 *
 * @param root - 저장소 루트
 * @returns 패키지 이름별 버전
 */
export async function readPackageVersions(root) {
  const versions = {};
  for (const dir of RELEASE_PACKAGES) {
    const manifest = JSON.parse(await readFile(path.join(root, 'packages', dir, 'package.json'), 'utf8'));
    versions[manifest.name] = manifest.version;
  }
  return versions;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const problems = validateReleaseInputs({
    ref: process.env['GITHUB_REF'],
    version: process.env['RELEASE_VERSION'],
    environment: process.env['RELEASE_ENVIRONMENT'],
    packageVersions: await readPackageVersions(root),
  });
  for (const problem of problems) process.stdout.write(`::error::${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`release inputs ok: version ${process.env['RELEASE_VERSION']}, environment ${process.env['RELEASE_ENVIRONMENT']}\n`);
}
