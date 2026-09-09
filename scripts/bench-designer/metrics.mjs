/**
 * 디자이너 벤치마크의 카운터입니다.
 *
 * `installCounters`는 전역 `JSON.stringify`·`structuredClone`을 호출 수를 세는 함수로 감쌉니다.
 * 감싼 뒤에 가져온 모듈은 전역 객체의 속성을 그대로 참조하므로 dist를 바꾸지 않고도 셉니다.
 * `planSourcePage` 수는 로더 훅(`core-hooks.mjs`)이 `globalThis.__slipkitPlanCalls`에 쌓습니다.
 * 중앙값·백분위수 같은 통계는 `scripts/bench-shared/stats.mjs`에 있습니다.
 */

/** 이 길이 이상인 `JSON.stringify` 결과는 문서(양식 전체) 크기로 봅니다. */
export const DOC_SIZE_CHARS = 10_000;

/** 카운터 저장 위치 — 전역 객체의 이 속성에 둡니다. */
const STATE = '__slipkitBenchCounters';

/**
 * 전역 `JSON.stringify`와 `structuredClone`을 감쌉니다. 한 번만 호출합니다.
 *
 * @param global - 감쌀 전역 객체 (`globalThis`)
 */
export function installCounters(global) {
  if (global[STATE] !== undefined) return;
  const state = {
    stringifyCalls: 0, stringifyChars: 0, stringifyDocCalls: 0, stringifyDocChars: 0, cloneCalls: 0,
    docThreshold: DOC_SIZE_CHARS,
  };
  global[STATE] = state;

  const originalStringify = global.JSON.stringify;
  global.JSON.stringify = function stringify(...args) {
    const result = originalStringify.apply(this, args);
    state.stringifyCalls += 1;
    if (typeof result === 'string') {
      state.stringifyChars += result.length;
      if (result.length >= state.docThreshold) {
        state.stringifyDocCalls += 1;
        state.stringifyDocChars += result.length;
      }
    }
    return result;
  };

  const originalClone = global.structuredClone;
  if (typeof originalClone === 'function') {
    global.structuredClone = function structuredClone(...args) {
      state.cloneCalls += 1;
      return originalClone.apply(this, args);
    };
  }
}

/**
 * 카운터를 0으로 되돌립니다. 드래그를 시작하기 직전에 호출합니다.
 *
 * @param global - `installCounters`에 넘긴 전역 객체
 * @param docThreshold - 이 길이 이상을 문서 크기로 볼 문자 수. 양식이 10,000자보다 작으면
 *   양식 길이를 넘겨 그 양식의 스냅샷도 문서 크기로 잡히게 합니다.
 */
export function resetCounters(global, docThreshold = DOC_SIZE_CHARS) {
  const state = global[STATE];
  for (const key of Object.keys(state)) state[key] = 0;
  state.docThreshold = docThreshold;
  global.__slipkitPlanCalls = 0;
}

/**
 * 마지막 `resetCounters` 이후의 카운터 값을 복사해 반환합니다.
 *
 * @param global - `installCounters`에 넘긴 전역 객체
 * @returns 카운터 묶음(`planCalls` 포함, 기준값 제외)
 */
export function readCounters(global) {
  const { docThreshold: _threshold, ...counters } = global[STATE];
  return { ...counters, planCalls: global.__slipkitPlanCalls ?? 0 };
}

/**
 * 디자이너의 되돌리기 기록 상태를 읽습니다. 기록 단계 수와 되돌리기 스냅샷의 문자 수를 반환합니다.
 *
 * 기록이 `_history` 컨트롤러로 분리된 코드와 `_undoStack` 배열을 직접 가진 옛 코드를 모두 읽어
 * 기준 커밋과 수정 커밋을 같은 스크립트로 비교할 수 있게 합니다.
 *
 * @param {any} el - `<slip-designer>` 인스턴스
 * @returns {{ depth: number, chars: number }}
 */
export function undoState(el) {
  if (el._history !== undefined) {
    return { depth: el._history.undoDepth, chars: el._history.undoSnapshotChars };
  }
  const stack = el._undoStack ?? [];
  return { depth: stack.length, chars: stack.reduce((sum, entry) => sum + entry.file.length, 0) };
}
