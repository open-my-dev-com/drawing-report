/**
 * 배포 워크플로 입력을 검사합니다.
 *
 * 워크플로는 입력을 셸 명령에 끼워 넣지 않고 환경변수로 넘기고, 이 스크립트가 다음을 확인합니다.
 * - 실행 ref가 `refs/heads/main`인지
 * - `version`이 정확한 SemVer이고 다섯 패키지의 `package.json` 버전과 모두 같은지
 * - `environment`가 `npm-publish`인지
 * - `dist_tag`가 허용 목록에 있고, 미리 배포 버전(`1.0.0-beta.1` 등)에 `latest`를 붙이지 않는지
 *
 * 사용: `RELEASE_VERSION=… RELEASE_DIST_TAG=… RELEASE_ENVIRONMENT=… GITHUB_REF=… node scripts/release/inputs.mjs`
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 배포할 패키지를 배포 순서대로 나열한 목록입니다. */
export const RELEASE_PACKAGES = ['core', 'elements', 'react', 'vue', 'mcp'];

/** 배포 작업에 허용하는 GitHub Environment 이름입니다. */
export const RELEASE_ENVIRONMENT = 'npm-publish';

/** 배포를 허용하는 ref입니다. */
export const RELEASE_REF = 'refs/heads/main';

/** 배포에 허용하는 dist-tag입니다. */
export const DIST_TAGS = ['latest', 'next'];

/** 미리 배포 버전에 붙일 수 없는 dist-tag — 설치 기본값이라 정식 버전만 가리켜야 합니다. */
const STABLE_DIST_TAG = 'latest';

/** 범위나 접두사가 없는 semver.org 2.0.0의 정확한 버전 형식입니다. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * 정확한 SemVer 문자열인지 확인합니다.
 *
 * @param version - 검사할 문자열
 * @returns SemVer면 true
 */
export function isExactSemver(version) {
  return typeof version === 'string' && SEMVER.test(version);
}

/**
 * 미리 배포(prerelease) 버전인지 확인합니다.
 *
 * @param version - 검사할 문자열
 * @returns `1.0.0-beta.1`처럼 prerelease 식별자가 붙은 정확한 SemVer면 true
 */
export function isPrerelease(version) {
  if (typeof version !== 'string') return false;
  const match = SEMVER.exec(version);
  return match !== null && match[4] !== undefined;
}

/**
 * 배포 입력을 검사해 문제 목록을 반환합니다. 비어 있으면 통과입니다.
 *
 * @param input - 검사 대상
 * @param input.ref - 실행 ref (`GITHUB_REF`)
 * @param input.version - 요청한 버전
 * @param input.distTag - 요청한 npm dist-tag
 * @param input.environment - 요청한 GitHub Environment 이름
 * @param input.packageVersions - 패키지 이름별 `package.json` 버전
 * @returns 문제 설명 목록
 */
export function validateReleaseInputs({ ref, version, distTag, environment, packageVersions }) {
  const problems = [];
  if (ref !== RELEASE_REF) problems.push(`release must run from ${RELEASE_REF}, got ${ref ?? '(unset)'}`);
  if (!isExactSemver(version)) problems.push(`version must be exact SemVer, got ${version ?? '(unset)'}`);
  if (!DIST_TAGS.includes(distTag)) {
    problems.push(`dist_tag must be one of ${DIST_TAGS.join(', ')}, got ${distTag ?? '(unset)'}`);
  } else if (distTag === STABLE_DIST_TAG && isPrerelease(version)) {
    // `latest`는 버전을 지정하지 않은 설치에 적용되는 태그입니다. prerelease를 여기에 붙이면 모든 사용자가 받습니다.
    problems.push(`prerelease version ${version} must not use dist_tag ${STABLE_DIST_TAG}`);
  }
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
 * 워크스페이스 패키지의 이름과 버전을 읽습니다.
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
    distTag: process.env['RELEASE_DIST_TAG'],
    environment: process.env['RELEASE_ENVIRONMENT'],
    packageVersions: await readPackageVersions(root),
  });
  for (const problem of problems) process.stdout.write(`::error::${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(
    `release inputs ok: version ${process.env['RELEASE_VERSION']}, dist-tag ${process.env['RELEASE_DIST_TAG']}, environment ${process.env['RELEASE_ENVIRONMENT']}\n`,
  );
}
