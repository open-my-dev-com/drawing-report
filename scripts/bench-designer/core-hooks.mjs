/**
 * `@omdc-slipkit/core`의 `planSourcePage` 호출 횟수를 세는 Node 모듈 로더 훅.
 *
 * `scripts/bench-designer.mjs`가 `node:module`의 `register()`로 등록한다. 디자이너 dist가
 * `@omdc-slipkit/core`를 가져오면 Node는 pnpm 심볼릭 링크를 실제 경로로 풀어
 * `packages/core/dist/index.js`의 URL로 해석한다. 이 훅은 그 URL의 소스만 아래처럼 바꿔 놓는다.
 *
 * - 원본 모듈은 `?orig=1` 쿼리를 붙인 URL로 한 번 더(별도 인스턴스로) 불러온다.
 * - 원본의 모든 export를 그대로 다시 내보내되, `planSourcePage`만 호출 횟수를
 *   `globalThis.__slipkitPlanCalls`에 더하는 함수로 감싼다. 이름이 겹치는 `export *`는
 *   같은 모듈의 직접 export가 우선하므로 감싼 함수가 바깥에 보인다.
 *
 * 디자이너와 벤치 스크립트가 같은 URL을 가져오므로 둘 다 같은 감싼 모듈을 공유한다.
 * `packages/` 아래 파일은 건드리지 않는다.
 */

/** 가로챌 core dist의 URL (쿼리 없음). `initialize`에서 받는다. */
let coreUrl = '';

/**
 * `register()`의 `data`로 넘어온 설정을 저장한다.
 *
 * @param data - `{ coreUrl }` — 실제 경로로 푼 `packages/core/dist/index.js`의 `file:` URL
 */
export function initialize(data) {
  coreUrl = data?.coreUrl ?? '';
}

/**
 * core dist URL의 소스를 감싼 모듈로 바꾼다. 다른 모듈은 기본 로더에 맡긴다.
 *
 * @param url - 해석된 모듈 URL
 * @param context - 로더 컨텍스트
 * @param nextLoad - 다음 로더
 * @returns 모듈 소스
 */
export async function load(url, context, nextLoad) {
  if (coreUrl !== '' && url === coreUrl) {
    const original = `${coreUrl}?orig=1`;
    const source = [
      `export * from ${JSON.stringify(original)};`,
      `import { planSourcePage as __orig } from ${JSON.stringify(original)};`,
      'export function planSourcePage(...args) {',
      '  globalThis.__slipkitPlanCalls = (globalThis.__slipkitPlanCalls ?? 0) + 1;',
      '  return __orig(...args);',
      '}',
      'globalThis.__slipkitPlanHook = true;',
      '',
    ].join('\n');
    return { format: 'module', shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
