/**
 * benchmark가 쓰는 임시 작업 디렉터리.
 *
 * fixture·tarball·소비자 프로젝트는 모두 `os.tmpdir()` 아래에서 만들고 끝나면 지운다 —
 * 성공한 실행이 저장소 작업 트리에 산출물을 남기지 않게 하려는 것이다.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 임시 작업 디렉터리를 만든다. macOS처럼 tmpdir이 심볼릭 링크인 곳에서도 경로 비교가
 * 어긋나지 않도록 실제 경로로 바꿔 돌려준다.
 *
 * @param {string} prefix - 디렉터리 이름 앞부분 (예: `slipkit-bench-fonts-`)
 * @returns {string} 만들어진 디렉터리의 절대 경로
 */
export function createWorkDir(prefix) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * 임시 작업 디렉터리를 정리한다.
 *
 * @param {string} dir - `createWorkDir`가 돌려준 디렉터리
 * @param {{ keep?: boolean }} [options] - `keep`이면 지우지 않고 남긴다
 * @returns {boolean} 지웠으면 true, 남겼으면 false
 */
export function disposeWorkDir(dir, options = {}) {
  if (options.keep === true) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
