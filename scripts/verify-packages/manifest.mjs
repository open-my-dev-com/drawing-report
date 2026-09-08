/**
 * 배포 tarball 안 `package.json`의 계약 검사.
 *
 * 소비자가 설치할 때 필요한 선언(Node.js 지원 하한, 라이선스, 공개 배포 설정)이 실제 tarball에
 * 그대로 담겨 있는지 본다. 다섯 패키지가 같은 값을 선언한다.
 */

/** 배포 tarball의 package.json이 선언해야 하는 값 */
export const REQUIRED_MANIFEST = {
  'engines.node': '>=22.13',
  license: 'BUSL-1.1',
  'publishConfig.access': 'public',
};

/**
 * tarball에서 꺼낸 `package.json`이 배포 계약대로 선언하는지 확인한다.
 *
 * @param {string} text - `package/package.json` 원문
 * @returns {string[]} 어긋난 점. 비어 있으면 통과
 */
export function manifestProblems(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return [`package.json parse failed: ${error instanceof Error ? error.message : String(error)}`];
  }
  const actual = {
    'engines.node': manifest.engines?.node,
    license: manifest.license,
    'publishConfig.access': manifest.publishConfig?.access,
  };
  return Object.entries(REQUIRED_MANIFEST)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => `package.json ${key} is ${actual[key] ?? '(unset)'}, expected ${value}`);
}
