/**
 * benchmark 하위 명령의 기본값.
 *
 * 하위 명령과 `bench:all`이 같은 값을 쓰도록 한곳에 모아 둔다 — 옵션을 주지 않은 공통 실행이
 * 하위 명령을 따로 돌린 것과 다른 측정이 되지 않게 하려는 것이다. 축소는 명시적 옵션으로만 한다.
 */

/** fonts benchmark의 본 측정 반복 수 (`--runs`) */
export const FONTS_DEFAULT_RUNS = 5;

/** MCP list benchmark의 본 측정 반복 수 (`--runs`) */
export const MCP_LIST_DEFAULT_RUNS = 5;

/** MCP list benchmark의 fixture 파일 수 (`--sizes`) */
export const MCP_LIST_DEFAULT_SIZES = Object.freeze([1000, 10000]);
