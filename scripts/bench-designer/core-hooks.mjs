/**
 * `@omdc-slipkit/core`의 `planSourcePage` 호출 횟수를 세는 Node 모듈 로더 훅입니다.
 *
 * `scripts/bench-designer.mjs`가 `node:module`의 `register()`로 등록합니다. 디자이너 dist가
 * `@omdc-slipkit/core`를 가져오면 Node는 pnpm 심볼릭 링크를 실제 경로로 해석해
 * `packages/core/dist/index.js`의 URL을 사용합니다. 이 훅은 해당 URL의 소스만 다음과 같이 바꿉니다.
 *
 * - 원본 모듈은 `?orig=1` 쿼리를 붙인 URL로 다시 불러와 별도 인스턴스로 만듭니다.
 * - 원본의 모든 export를 그대로 다시 내보내되, `planSourcePage`만 호출 횟수를
 *   `globalThis.__slipkitPlanCalls`에 더하는 함수로 대체합니다. 이름이 겹치는 `export *`에서는
 *   같은 모듈의 직접 export가 우선하므로 대체한 함수가 외부에 노출됩니다.
 *
 * 디자이너와 벤치마크 스크립트가 같은 URL을 가져오므로 둘 다 같은 모듈 인스턴스를 공유합니다.
 * 이 과정에서는 `packages/` 아래의 원본 파일을 변경하지 않습니다.
 */

/** 호출 횟수를 측정할 core dist의 URL입니다. 쿼리가 없는 값을 `initialize`에서 받습니다. */
let coreUrl = '';

/**
 * `register()`의 `data`로 넘어온 설정을 저장합니다.
 *
 * @param data - `{ coreUrl }` 형식이며, 실제 경로로 해석한 `packages/core/dist/index.js`의 `file:` URL입니다.
 */
export function initialize(data) {
  coreUrl = data?.coreUrl ?? '';
}

/**
 * core dist URL의 소스를 측정용 모듈로 바꿉니다. 다른 모듈은 기본 로더에서 처리합니다.
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
