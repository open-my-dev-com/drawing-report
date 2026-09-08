/**
 * `knip.jsonc` 설정 자체가 낡았는지 보는 순수 함수 모음.
 *
 * knip은 없는 파일을 진입점으로 적어도, 이미 지운 의존성을 `ignoreDependencies`에 남겨 두어도
 * 아무 말 없이 통과한다. 진입점 하나가 낡으면 그 아래 파일 전체가 조용히 검사 대상에서 빠지므로
 * 설정을 먼저 확인한 뒤에 knip을 돌린다.
 *
 * 예외가 살아 있는지는 **그 워크스페이스가 실제로 분석하는 파일**과 그 워크스페이스의
 * `package.json`만 근거로 삼는다. 루트 워크스페이스의 예외를 다른 패키지나 예제의 import가
 * 살려 주지 않는다 — knip도 그 파일들을 루트 워크스페이스로 보지 않는다.
 */

/** 설정 파일에서 검사하는 glob 항목 */
const GLOB_KEYS = ['entry', 'project'];

/** knip이 production 전용 항목에 붙이는 접미사 */
const PRODUCTION_SUFFIX = '!';

/**
 * 파일이 어느 디렉터리 아래에 있는지 본다.
 *
 * @param file - 워크스페이스 기준 파일 경로 (`/` 구분)
 * @param dir - 워크스페이스 기준 디렉터리 경로 (`/` 구분, 끝에 `/` 없음)
 * @returns `dir` 아래의 파일이면 true
 */
function isUnder(file, dir) {
  return file.startsWith(`${dir}/`);
}

/**
 * 워크스페이스가 실제로 분석하는 파일만 남긴다.
 *
 * knip은 `project`·`entry` glob이 있으면 그 파일만, 없으면 워크스페이스 디렉터리 전체를 보되
 * 어느 쪽이든 안에 든 다른 워크스페이스의 파일은 그 워크스페이스 것으로 넘긴다. 여기서도 같은
 * 규칙으로 고른다 — 루트 워크스페이스의 목록에 `packages/*`·`examples/*` 파일이 섞이지 않는다.
 *
 * @param input - 고를 대상
 * @param input.workspace - `knip.jsonc`의 워크스페이스 설정 하나 (`project`·`entry` glob)
 * @param input.files - 워크스페이스 기준 파일 경로 목록 (`/` 구분)
 * @param input.nestedWorkspaces - 이 워크스페이스 안에 든 다른 워크스페이스의 디렉터리 (워크스페이스 기준 경로)
 * @returns 이 워크스페이스가 소유하는 파일 목록
 */
export function scopeWorkspaceFiles({ workspace, files, nestedWorkspaces = [] }) {
  const patterns = GLOB_KEYS.flatMap((key) => workspace[key] ?? [])
    .filter((pattern) => !pattern.startsWith('!'))
    .map((pattern) => globToRegExp(pattern.replace(/!$/, '')));
  return files.filter((file) => {
    if (nestedWorkspaces.some((dir) => isUnder(file, dir))) return false;
    return patterns.length === 0 || patterns.some((regexp) => regexp.test(file));
  });
}

/**
 * 소스 본문이 의존성 이름을 가져오는지 본다 — 패키지 이름 그대로 또는 그 하위 경로를 따옴표로 감싼 모듈 지정자.
 *
 * @param text - 소스 파일 본문
 * @param name - 패키지 이름
 * @returns `'name'`·`"name"`·`'name/…'`·`"name/…"` 가운데 하나라도 있으면 true
 */
export function hasDependencyReference(text, name) {
  return (
    text.includes(`'${name}'`) ||
    text.includes(`"${name}"`) ||
    text.includes(`'${name}/`) ||
    text.includes(`"${name}/`)
  );
}

/** 의존성 이름을 찾을 때 읽는 파일 확장자 — 소스와 설정 파일만 본다. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.vue', '.html']);

/**
 * `ignoreDependencies` 예외가 살아 있는지 확인할 `hasReference` 함수를 만든다.
 *
 * 워크스페이스마다 {@link scopeWorkspaceFiles}로 고른 소스 파일만 읽는다. 읽은 본문은 워크스페이스별로
 * 한 번만 모아 두고, 예외가 없는 워크스페이스는 읽지 않는다.
 *
 * @param input - 검사 대상
 * @param input.config - `knip.jsonc`를 파싱한 객체
 * @param input.files - 워크스페이스 이름 → 그 워크스페이스 기준 파일 경로 목록
 * @param input.nestedWorkspaces - 워크스페이스 이름 → 그 안에 든 다른 워크스페이스 디렉터리 목록 (워크스페이스 기준 경로)
 * @param input.readFile - `(워크스페이스, 파일) => string` — 파일 본문을 읽는 함수. 읽지 못하면 빈 문자열을 돌려준다
 * @returns `(워크스페이스, 이름) => boolean`
 */
export function createReferenceFinder({ config, files, nestedWorkspaces = {}, readFile }) {
  const sources = new Map();
  const readSources = (name) => {
    if (!sources.has(name)) {
      const workspace = config.workspaces?.[name] ?? {};
      const owned = scopeWorkspaceFiles({ workspace, files: files[name] ?? [], nestedWorkspaces: nestedWorkspaces[name] ?? [] });
      const text = owned
        .filter((file) => CODE_EXTENSIONS.has(file.slice(file.lastIndexOf('.'))))
        .map((file) => readFile(name, file))
        .join('\n');
      sources.set(name, text);
    }
    return sources.get(name);
  };
  return (name, dependency) => hasDependencyReference(readSources(name), dependency);
}

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
 * @param input.hasReference - `(워크스페이스, 이름) => boolean` — 그 워크스페이스가 소유한 파일이 이름을 가져오는지 확인하는 함수 ({@link createReferenceFinder})
 * @param input.workspaceDirs - 저장소의 모든 워크스페이스 디렉터리 (루트 기준 경로). 주면 `ignoreWorkspaces`가 실제 워크스페이스를 가리키는지도 본다
 * @returns 어긋난 점. 비어 있으면 통과
 */
export function checkKnipConfig({ config, files, dependencies, hasReference = () => false, workspaceDirs }) {
  const problems = [];
  const workspaces = config.workspaces ?? {};
  if (workspaceDirs !== undefined) {
    for (const pattern of config.ignoreWorkspaces ?? []) {
      // production 전용 접미사(`!`)를 떼고 본다 — 어느 모드에서든 가리키는 워크스페이스는 있어야 한다.
      const regexp = globToRegExp(pattern.replace(/!$/, ''));
      if (!workspaceDirs.some((dir) => regexp.test(dir))) {
        problems.push(`ignoreWorkspaces "${pattern}"과 맞는 워크스페이스가 없다`);
      }
    }
  }
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
    for (const pattern of Object.keys(workspace.ignoreIssues ?? {})) {
      if (!globMatches(pattern, owned)) {
        problems.push(`워크스페이스 ${name}: ignoreIssues 항목 "${pattern}"과 맞는 파일이 없다`);
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
