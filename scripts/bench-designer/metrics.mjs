/**
 * 벤치마크 카운터와 통계 도우미.
 *
 * `installCounters`는 전역 `JSON.stringify`·`structuredClone`을 호출 수를 세는 함수로 감싼다.
 * 감싼 뒤에 가져온 모듈은 전역 객체의 속성을 그대로 참조하므로 dist를 바꾸지 않고도 센다.
 * `planSourcePage` 수는 로더 훅(`core-hooks.mjs`)이 `globalThis.__slipkitPlanCalls`에 쌓는다.
 */

/** 이 길이 이상인 `JSON.stringify` 결과는 문서(양식 전체) 크기로 본다 */
export const DOC_SIZE_CHARS = 10_000;

/** 카운터 저장 위치 — 전역 객체의 이 속성에 둔다 */
const STATE = '__slipkitBenchCounters';

/**
 * 전역 `JSON.stringify`와 `structuredClone`을 감싼다. 한 번만 부른다.
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
 * 카운터를 0으로 되돌린다. 드래그를 시작하기 직전에 부른다.
 *
 * @param global - `installCounters`에 넘긴 전역 객체
 * @param docThreshold - 이 길이 이상을 문서 크기로 볼 문자 수. 양식이 10,000자보다 작으면
 *   양식 길이를 넘겨 그 양식의 스냅샷도 문서 크기로 잡히게 한다
 */
export function resetCounters(global, docThreshold = DOC_SIZE_CHARS) {
  const state = global[STATE];
  for (const key of Object.keys(state)) state[key] = 0;
  state.docThreshold = docThreshold;
  global.__slipkitPlanCalls = 0;
}

/**
 * 마지막 `resetCounters` 이후의 카운터 값을 복사해 돌려준다.
 *
 * @param global - `installCounters`에 넘긴 전역 객체
 * @returns 카운터 묶음 (`planCalls` 포함, 문턱값 제외)
 */
export function readCounters(global) {
  const { docThreshold: _threshold, ...counters } = global[STATE];
  return { ...counters, planCalls: global.__slipkitPlanCalls ?? 0 };
}

/**
 * 중앙값.
 *
 * @param values - 숫자 배열 (비우면 0)
 * @returns 중앙값
 */
export function median(values) {
  return percentile(values, 50);
}

/**
 * 백분위수 (가장 가까운 순위 방식).
 *
 * @param values - 숫자 배열 (비우면 0)
 * @param p - 0~100
 * @returns 백분위 값
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p === 50 && sorted.length % 2 === 0) {
    const mid = sorted.length / 2;
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/**
 * 천 단위 구분 기호를 넣어 적는다. 소수는 반올림한다.
 *
 * @param value - 숫자
 * @returns 문자열
 */
export function formatInt(value) {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * 디자이너의 되돌리기 기록 상태를 읽는다 — 깊이와 되돌리기 스냅샷 문자 수.
 *
 * 기록이 `_history` 컨트롤러로 분리된 코드와 `_undoStack` 배열을 직접 가진 옛 코드를 모두 읽어
 * 기준 커밋과 수정 커밋을 같은 스크립트로 비교할 수 있게 한다.
 *
 * @param {any} el - `<slip-designer>` 인스턴스
 * @returns {{ depth: number, chars: number }}
 */
export function undoState(el) {
  if (el._history !== undefined) {
    return { depth: el._history.undoDepth, chars: el._history.undoSnapshotBytes };
  }
  const stack = el._undoStack ?? [];
  return { depth: stack.length, chars: stack.reduce((sum, entry) => sum + entry.file.length, 0) };
}
