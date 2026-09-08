/**
 * `knip.jsonc` 설정 자체가 낡았는지 보는 순수 함수 모음.
 *
 * knip은 없는 파일을 진입점으로 적어도, 이미 지운 의존성을 `ignoreDependencies`에 남겨 두어도
 * 아무 말 없이 통과한다. 진입점 하나가 낡으면 그 아래 파일 전체가 조용히 검사 대상에서 빠지므로
 * 설정을 먼저 확인한 뒤에 knip을 돌린다.
 */

/** 설정 파일에서 검사하는 glob 항목 */
const GLOB_KEYS = ['entry', 'project'];

/**
 * 주석이 섞인 JSON(JSONC)을 읽는다. 문자열 안의 `//`·`/* *\/`는 주석으로 보지 않는다.
 *
 * @param text - 파일 원문
 * @returns 파싱한 값
 * @throws Error 주석을 걷어낸 뒤에도 JSON으로 읽히지 않을 때
 */
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    out += char;
  }
  try {
    return JSON.parse(out);
  } catch (error) {
    throw new Error(`knip 설정을 JSON으로 읽지 못했다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * glob 문자열을 정규식으로 바꾼다. `**`는 디렉터리 경계를 넘고 `*`·`?`는 넘지 않는다.
 *
 * @param pattern - `scripts` 아래 시험 파일을 고르는 `scripts/**` + `*.test.mjs` 같은 glob
 * @returns 경로 전체와 맞춰 볼 정규식
 */
export function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/`는 디렉터리가 없어도 맞는다 — `scripts/**/*.mjs`가 `scripts/a.mjs`도 고른다.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * 워크스페이스 안의 파일 하나라도 glob과 맞는지 본다.
 *
 * @param pattern - 워크스페이스 기준 glob
 * @param files - 워크스페이스 기준 파일 경로 목록 (`/` 구분)
 * @returns 맞는 파일이 있으면 true
 */
function globMatches(pattern, files) {
  const regexp = globToRegExp(pattern);
  return files.some((file) => regexp.test(file));
}

/**
 * knip 설정이 실제 저장소 내용과 어긋나는 점을 모은다.
 *
 * @param input - 검사 대상
 * @param input.config - `knip.jsonc`를 파싱한 객체
 * @param input.files - 워크스페이스 이름 → 그 워크스페이스 기준 파일 경로 목록
 * @param input.dependencies - 워크스페이스 이름 → `package.json`이 선언한 의존성 이름 목록
 * @param input.hasReference - `(워크스페이스, 이름) => boolean` — 그 워크스페이스의 파일이 이름을 가져오는지 확인하는 함수
 * @returns 어긋난 점. 비어 있으면 통과
 */
export function checkKnipConfig({ config, files, dependencies, hasReference = () => false }) {
  const problems = [];
  const workspaces = config.workspaces ?? {};
  for (const [name, workspace] of Object.entries(workspaces)) {
    const owned = files[name];
    if (owned === undefined) {
      problems.push(`워크스페이스 ${name}: 저장소에 없다`);
      continue;
    }
    for (const key of GLOB_KEYS) {
      for (const pattern of workspace[key] ?? []) {
        if (!globMatches(pattern, owned)) {
          problems.push(`워크스페이스 ${name}: ${key} 항목 "${pattern}"과 맞는 파일이 없다`);
        }
      }
    }
    const declared = dependencies[name] ?? [];
    for (const dependency of workspace.ignoreDependencies ?? []) {
      // 무시할 대상이 남아 있어야 예외가 살아 있는 것이다 — package.json이 선언했거나(쓰지 않는 의존성),
      // 파일이 가져오고 있거나(적히지 않은 의존성) 둘 중 하나다. 둘 다 아니면 낡은 예외다.
      if (!declared.includes(dependency) && !hasReference(name, dependency)) {
        problems.push(`워크스페이스 ${name}: ignoreDependencies "${dependency}"를 선언하지도 가져오지도 않는다`);
      }
    }
  }
  return problems;
}
