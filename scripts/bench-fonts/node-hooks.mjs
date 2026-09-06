/**
 * 설치된 Elements 패키지 안에서 실제로 읽힌 모듈 파일을 기록하는 Node 모듈 로더 훅.
 *
 * `scripts/bench-fonts/node-run.mjs`가 `node:module`의 `register()`로 등록한다. 훅은 별도 스레드에서
 * 돌아 전역을 공유하지 않으므로, 기록 대상 URL의 모듈 소스 맨 앞에 `globalThis.__slipkitLoadedUrls`에
 * 자기 URL을 넣는 문장을 덧붙인다 — 그 문장은 모듈이 평가될 때 메인 스레드에서 실행된다. import 선언은
 * 끌어올려지므로 앞에 문장을 두어도 동작이 달라지지 않는다. `packages/`나 설치 파일은 건드리지 않는다.
 */

/** 기록할 모듈 URL의 접두어 (`initialize`에서 받는다) */
let prefix = '';

/**
 * `register()`의 `data`로 넘어온 설정을 저장한다.
 *
 * @param data - `{ prefix }` — 설치된 Elements 패키지 디렉터리의 `file:` URL
 */
export function initialize(data) {
  prefix = data?.prefix ?? '';
}

/**
 * 접두어 아래 ESM 모듈의 소스에 기록 문장을 덧붙인다. 다른 모듈은 그대로 둔다.
 *
 * @param url - 해석된 모듈 URL
 * @param context - 로더 컨텍스트
 * @param nextLoad - 다음 로더
 * @returns 모듈 소스
 */
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (prefix !== '' && url.startsWith(prefix) && result.format === 'module' && result.source != null) {
    const marker = `globalThis.__slipkitLoadedUrls?.push(${JSON.stringify(url)});\n`;
    return { ...result, source: marker + String(result.source) };
  }
  return result;
}
