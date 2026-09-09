/**
 * 성능 측정 명령이 공통으로 사용하는 인자를 읽습니다.
 *
 * 각 명령의 옵션 이름과 기본값은 그대로 두고, `--name value` 를 읽는 방법만 모읍니다.
 */

/**
 * `--name value` 인자를 읽습니다.
 *
 * @param {string[]} argv - 인자 배열 (`process.argv.slice(2)`)
 * @param {string} name - 인자 이름 (`--` 포함)
 * @returns {string | undefined} 값. 없으면 undefined
 */
export function readArg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * 플래그가 있는지 확인합니다.
 *
 * @param {string[]} argv - 인자 배열
 * @param {string} name - 플래그 이름 (`--` 포함)
 * @returns {boolean} 있으면 true
 */
export function hasFlag(argv, name) {
  return argv.includes(name);
}

/**
 * 1 이상의 정수 인자를 읽습니다.
 *
 * @param {string[]} argv - 인자 배열
 * @param {string} name - 인자 이름 (`--` 포함)
 * @param {number} fallback - 인자가 없을 때 쓸 값
 * @returns {number} 정수
 * @throws Error 값이 1 이상의 정수가 아닐 때
 */
export function readPositiveInt(argv, name, fallback) {
  const raw = readArg(argv, name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name}: 1 이상의 정수를 입력해야 합니다.`);
  return value;
}

/**
 * 쉼표로 구분한 1 이상의 정수 목록을 읽습니다.
 *
 * @param {string[]} argv - 인자 배열
 * @param {string} name - 인자 이름 (`--` 포함)
 * @param {number[]} fallback - 인자가 없을 때 쓸 값
 * @returns {number[]} 정수 목록
 * @throws Error 목록이 비었거나 1 이상의 정수가 아닌 값이 있을 때
 */
export function readPositiveIntList(argv, name, fallback) {
  const raw = readArg(argv, name);
  if (raw === undefined) return fallback;
  const values = raw.split(',').map((value) => Number.parseInt(value.trim(), 10));
  if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error(`${name}: 1 이상의 정수를 쉼표로 구분해 입력해야 합니다(예: 1000,10000).`);
  }
  return values;
}
