/** 패키지 디렉터리와 공개 npm 이름의 대응 관계입니다. */
export const PACKAGE_NAMES = Object.freeze({
  core: '@omdc/slipkit',
  elements: '@omdc/slipkit-elements',
  react: '@omdc/slipkit-react',
  vue: '@omdc/slipkit-vue',
  mcp: '@omdc/slipkit-mcp',
});

/** 의존 순서에 따른 패키지 디렉터리 목록입니다. */
export const PACKAGE_DIRS = Object.freeze(Object.keys(PACKAGE_NAMES));

/**
 * 패키지 디렉터리에 대응하는 공개 npm 이름을 반환합니다.
 *
 * @param {string} dir - `packages` 아래의 디렉터리 이름
 * @returns {string} 공개 npm 패키지 이름
 * @throws {Error} 등록되지 않은 디렉터리 이름이면 발생합니다.
 */
export function packageName(dir) {
  const name = PACKAGE_NAMES[dir];
  if (name === undefined) throw new Error(`알 수 없는 패키지 디렉터리입니다: ${dir}`);
  return name;
}

/**
 * `pnpm pack`이 만드는 tarball 파일명의 접두사를 반환합니다.
 *
 * @param {string} dir - `packages` 아래의 디렉터리 이름
 * @returns {string} 버전 앞까지의 tarball 파일명
 */
export function packageTarballPrefix(dir) {
  return `${packageName(dir).replace(/^@/, '').replace('/', '-')}-`;
}
