/**
 * `ignoreDependencies` 예외 가운데 모듈 지정자로 드러나지 않는 의존성의 사용 근거입니다.
 *
 * 대부분의 의존성은 `import 'name'`처럼 소스에 이름이 남으므로 워크스페이스가 소유한 파일을 읽어
 * 확인할 수 있습니다. 실행 파일 이름으로만 부르거나 명령행 옵션으로만 요구하는 의존성은 그렇지 않습니다.
 * 그런 항목만 여기에 근거 파일과 찾을 문자열을 적어 둡니다. `package.json`이 선언했다는 사실 자체는
 * 사용 근거로 세지 않습니다. 그래야 선언만 남고 실제 사용처가 사라진 예외를 잡을 수 있습니다.
 */

/** 실행 파일 이름이나 옵션으로만 쓰는 의존성의 근거입니다. 각 항목에 워크스페이스, 의존성, 근거 파일, 검색 문자열과 이유를 적습니다. */
export const DEPENDENCY_EVIDENCE = [
  {
    workspace: '.',
    dependency: '@arethetypeswrong/cli',
    usedBy: 'scripts/verify-packages.mjs',
    token: "'attw'",
    reason: '`pnpm exec attw`로 실행하므로 패키지 이름이 아니라 실행 파일 이름만 소스에 남습니다.',
  },
  {
    workspace: '.',
    dependency: '@vitest/coverage-v8',
    usedBy: 'package.json',
    token: '--coverage.provider=v8',
    reason: '`test:coverage`가 Vitest 제공자 옵션으로만 사용하며 소스에서 가져오지 않습니다.',
  },
];

/**
 * 근거 파일이 해당 워크스페이스에 속하는지 확인합니다.
 *
 * @param {string} file - 워크스페이스 기준 파일 경로 (`/` 구분)
 * @param {string[]} nested - 이 워크스페이스 안에 든 다른 워크스페이스의 디렉터리(워크스페이스 기준 경로)
 * @returns {boolean} 다른 워크스페이스의 파일이면 false
 */
function isOwnFile(file, nested) {
  return !nested.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

/**
 * 근거 하나가 지금도 성립하는지 확인합니다.
 *
 * @param {{ workspace: string, dependency: string, usedBy: string, token: string }} entry - 근거 항목
 * @param {(workspace: string, file: string, token: string) => boolean} hasToken - 파일이 문자열을 담고 있는지 확인하는 함수
 * @param {string[]} nested - 그 워크스페이스 안에 든 다른 워크스페이스의 디렉터리
 * @returns {boolean} 근거 파일이 해당 워크스페이스에 속하고 찾을 문자열을 담고 있으면 true
 */
function evidenceHolds(entry, hasToken, nested) {
  return isOwnFile(entry.usedBy, nested) && hasToken(entry.workspace, entry.usedBy, entry.token);
}

/**
 * 근거 목록으로 `ignoreDependencies` 예외를 살릴 수 있는지 판정하는 함수를 만듭니다.
 *
 * @param input - 검사 대상
 * @param {Array<object>} [input.evidence] - 근거 목록 (기본값은 이 모듈의 목록)
 * @param {(workspace: string, file: string, token: string) => boolean} input.hasToken - 파일이 문자열을 담고 있는지 확인하는 함수
 * @param {Record<string, string[]>} [input.nestedWorkspaces] - 워크스페이스 이름 → 그 안에 든 다른 워크스페이스 디렉터리 목록
 * @returns {(workspace: string, dependency: string) => boolean} 근거가 성립하면 true를 반환하는 함수
 */
export function createEvidenceFinder({ evidence = DEPENDENCY_EVIDENCE, hasToken, nestedWorkspaces = {} }) {
  return (workspace, dependency) =>
    evidence.some(
      (entry) =>
        entry.workspace === workspace &&
        entry.dependency === dependency &&
        evidenceHolds(entry, hasToken, nestedWorkspaces[workspace] ?? []),
    );
}

/**
 * 근거 목록 자체가 낡았는지 확인합니다. 없어진 예외를 가리키거나 근거 파일에서 문자열이 사라진 항목을 찾습니다.
 *
 * @param input - 검사 대상
 * @param {object} input.config - `knip.jsonc`를 파싱한 객체
 * @param {Array<object>} [input.evidence] - 근거 목록 (기본값은 이 모듈의 목록)
 * @param {(workspace: string, file: string, token: string) => boolean} input.hasToken - 파일이 문자열을 담고 있는지 확인하는 함수
 * @param {Record<string, string[]>} [input.nestedWorkspaces] - 워크스페이스 이름 → 그 안에 든 다른 워크스페이스 디렉터리 목록
 * @returns {string[]} 어긋난 점. 비어 있으면 통과
 */
export function checkDependencyEvidence({ config, evidence = DEPENDENCY_EVIDENCE, hasToken, nestedWorkspaces = {} }) {
  const problems = [];
  const seen = new Set();
  for (const entry of evidence) {
    const id = `${entry.workspace}::${entry.dependency}`;
    const where = `사용 근거 ${entry.dependency}(워크스페이스 ${entry.workspace})`;
    if (seen.has(id)) {
      problems.push(`${where}: 두 번 적혀 있습니다.`);
      continue;
    }
    seen.add(id);
    if (entry.reason === undefined || entry.reason === '') {
      problems.push(`${where}: 이유가 없습니다.`);
      continue;
    }
    const ignored = config.workspaces?.[entry.workspace]?.ignoreDependencies ?? [];
    if (!ignored.includes(entry.dependency)) {
      problems.push(`${where}: ignoreDependencies에 없습니다. 근거 항목을 제거해야 합니다.`);
      continue;
    }
    const nested = nestedWorkspaces[entry.workspace] ?? [];
    if (!isOwnFile(entry.usedBy, nested)) {
      problems.push(`${where}: 근거로 적은 ${entry.usedBy}가 다른 워크스페이스의 파일입니다.`);
      continue;
    }
    if (!hasToken(entry.workspace, entry.usedBy, entry.token)) {
      problems.push(`${where}: 근거로 적은 ${entry.usedBy}에 ${entry.token}이 없습니다.`);
    }
  }
  return problems;
}
