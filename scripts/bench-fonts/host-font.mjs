/**
 * 호스트 `getFonts` 시나리오에 쓸 폰트 파일을 동봉 폰트 청크에서 파생한다.
 *
 * 저장소에 폰트 바이너리를 추가하지 않기 위해, 설치·추출된 Elements 패키지의 `dist/fonts/pretendard.js`를
 * Node에서 import해 `PRETENDARD_FONTS[0].data`(Pretendard Regular)를 그대로 파일로 쓴다. 페이지는 이 파일을
 * `fetch`해 `createSlipKit({ getFonts })`에 넘기므로, 폰트 데이터는 같지만 동봉 폰트 청크를 읽는 경로는 거치지 않는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Pretendard 청크 모듈에서 첫 폰트의 바이트를 파일로 쓴다.
 *
 * @param {string} pretendardModulePath - `dist/fonts/pretendard.js`의 절대 경로
 * @param {string} outFile - 만들 파일 경로 (디렉터리는 만든다)
 * @returns {Promise<{ name: string, bytes: number }>} 쓴 폰트 이름과 바이트 수
 */
export async function writeHostFont(pretendardModulePath, outFile) {
  const mod = await import(pathToFileURL(pretendardModulePath).href);
  const font = mod.PRETENDARD_FONTS?.[0];
  if (!font || !(font.data instanceof Uint8Array)) throw new Error(`${pretendardModulePath} 에 PRETENDARD_FONTS[0].data 가 없다`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, font.data);
  return { name: font.name, bytes: font.data.byteLength };
}
