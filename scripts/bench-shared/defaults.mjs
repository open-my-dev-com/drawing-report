/**
 * 성능 측정 하위 명령의 기본값입니다.
 *
 * 하위 명령과 `bench:all`이 같은 값을 사용하도록 한곳에 모아 둡니다. 옵션 없이 실행하면 하위 명령을
 * 따로 실행할 때와 같은 조건으로 측정하며, 측정 규모는 명시적인 옵션으로만 줄입니다.
 */

/** fonts 실제 측정의 반복 횟수이며 `--runs`로 지정합니다. */
export const FONTS_DEFAULT_RUNS = 5;

/** MCP list 실제 측정의 반복 횟수이며 `--runs`로 지정합니다. */
export const MCP_LIST_DEFAULT_RUNS = 5;

/** MCP list 측정에 사용할 시험 파일 수이며 `--sizes`로 지정합니다. */
export const MCP_LIST_DEFAULT_SIZES = Object.freeze([1000, 10000]);
