/**
 * Node의 캐시 없는 독립 실행 한 번입니다. `scripts/bench-fonts.mjs`가 반복마다 새 자식 프로세스로 실행합니다.
 *
 * 실행: `node --expose-gc scripts/bench-fonts/node-run.mjs --elements-dir <dir> --core-dir <dir> --scenario <en|ko|ja|user>
 *        [--host-font <file>] [--template <json 파일>]`
 *
 * - `--elements-dir`·`--core-dir`는 소비자에 설치된 패키지의 실제 경로입니다. 루트 진입점은 `dist/index.js`를 `file:` URL로
 *   import합니다. 패키지 이름만 쓴 import 경로는 이 스크립트 위치에서 해석되지 않습니다.
 * - 설치된 Elements 안에서 읽힌 파일은 로더 훅(`node-hooks.mjs`)이 `globalThis.__slipkitLoadedUrls`에 모읍니다.
 * - 메모리는 시작·import 뒤·해석 뒤에 `gc()`를 부른 다음 `process.memoryUsage()`로 읽습니다.
 * - 기본 시나리오는 `loadDefaultFonts(locale)` 시간을, user 시나리오는 호스트 폰트로
 *   `createSlipKit({ getFonts }).render(template)` 시간과 PDF 바이트를 측정합니다.
 *
 * 결과는 하나의 JSON 객체로 stdout에 출력합니다.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * `--name value` 인자를 읽습니다.
 *
 * @param {string} name - 인자 이름 (`--` 포함)
 * @returns {string | undefined} 값
 */
function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const elementsDir = arg('--elements-dir');
const coreDir = arg('--core-dir');
const scenario = arg('--scenario') ?? 'en';
const hostFontPath = arg('--host-font');
const templatePath = arg('--template');
if (!elementsDir || !coreDir) throw new Error('--elements-dir와 --core-dir가 필요합니다.');
if (scenario === 'user' && (!hostFontPath || !templatePath)) throw new Error('user 시나리오에는 --host-font와 --template이 필요합니다.');

const gc = typeof globalThis.gc === 'function' ? globalThis.gc : () => {};

/**
 * `gc()`를 실행한 뒤의 메모리 사용량입니다.
 *
 * @returns {{ heapUsed: number, arrayBuffers: number, rss: number }} 바이트
 */
function memory() {
  gc();
  const { heapUsed, arrayBuffers, rss } = process.memoryUsage();
  return { heapUsed, arrayBuffers, rss };
}

globalThis.__slipkitLoadedUrls = [];
const elementsUrl = pathToFileURL(path.join(elementsDir, path.sep)).href;
register(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'node-hooks.mjs')), {
  data: { prefix: elementsUrl },
});

const start = memory();

const importStart = performance.now();
const elements = await import(pathToFileURL(path.join(elementsDir, 'dist', 'index.js')).href);
const importMs = performance.now() - importStart;
const afterImport = memory();

let resolveMs;
let renderMs;
let pdfBytes;
let fontNames;
if (scenario === 'user') {
  const core = await import(pathToFileURL(path.join(coreDir, 'dist', 'index.js')).href);
  const hostFont = { name: 'Host Sans', data: new Uint8Array(readFileSync(hostFontPath)), fallback: true };
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  const renderStart = performance.now();
  const pdf = await core.createSlipKit({ locale: 'en', getFonts: () => [hostFont] }).render(template);
  renderMs = performance.now() - renderStart;
  pdfBytes = pdf.byteLength;
  fontNames = [hostFont.name];
  if (new TextDecoder().decode(pdf.slice(0, 4)) !== '%PDF') throw new Error('PDF 결과가 %PDF로 시작하지 않습니다.');
} else {
  const resolveStart = performance.now();
  const fonts = await elements.loadDefaultFonts(scenario);
  resolveMs = performance.now() - resolveStart;
  fontNames = fonts.map((font) => font.name);
}
const afterResolve = memory();

const loadedFiles = globalThis.__slipkitLoadedUrls.map((url) => path.relative(elementsDir, fileURLToPath(url)));
const fontChunkFiles = loadedFiles.filter((file) => file.split(path.sep).join('/').startsWith('dist/fonts/'));

process.stdout.write(`${JSON.stringify({
  scenario,
  importMs,
  ...(resolveMs === undefined ? {} : { resolveMs }),
  ...(renderMs === undefined ? {} : { renderMs, pdfBytes }),
  fontNames,
  loadedFiles,
  fontChunkFiles,
  memory: { start, afterImport, afterResolve },
})}\n`);
