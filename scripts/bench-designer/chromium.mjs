/**
 * `--chromium` 모드 — 같은 드래그 시나리오를 Playwright의 실제 Chromium에서 잰다.
 *
 * 준비
 * - tsup이 쓰는 esbuild로 `packages/core/dist`와 `packages/elements/dist`를 브라우저용 한 파일로
 *   묶는다. 동봉 폰트 청크는 외부 모듈로 남겨 묶음에 넣지 않는다 (페이지는 이름만 있는 폰트를
 *   `getFonts`로 공급하므로 읽지 않는다).
 * - Node `http` 서버가 임시 포트에서 빈 페이지와 묶음을 내준다.
 * - `page.addInitScript`로 `JSON.stringify`·`structuredClone` 카운터를 페이지에 먼저 심는다.
 *   `planSourcePage` 수는 이 모드에서 세지 않는다 (묶음 안의 함수는 밖에서 감쌀 수 없다).
 * - Chromium은 `--js-flags=--expose-gc`로 띄워 본 측정 전후에 `gc()`를 부르고
 *   `performance.memory.usedJSHeapSize` 차이를 적는다.
 *
 * 측정 자체는 페이지 안에서 Node 모드와 같은 순서로 진행한다 — pointerdown, pointermove ×N,
 * pointerup을 shadow root의 `.element[data-id]`에 보내고 이벤트마다 `updateComplete`를 기다린다.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { median, percentile } from './metrics.mjs';

/** Playwright가 관리형 Chromium을 찾지 못할 때 시도하는 실행 파일 후보 (`SLIPKIT_CHROMIUM`이 우선) */
const CHROMIUM_CANDIDATES = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

/**
 * 페이지에 먼저 심는 카운터. `metrics.mjs`의 `installCounters`와 같은 규칙이다.
 * 문자열로 넘기므로 바깥 변수를 참조하지 않는다.
 */
const INIT_SCRIPT = `
(() => {
  const state = { stringifyCalls: 0, stringifyChars: 0, stringifyDocCalls: 0, stringifyDocChars: 0, cloneCalls: 0, docThreshold: 10000 };
  window.__slipkitBenchCounters = state;
  const originalStringify = JSON.stringify;
  JSON.stringify = function stringify(...args) {
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
  const originalClone = window.structuredClone;
  window.structuredClone = function structuredClone(...args) {
    state.cloneCalls += 1;
    return originalClone.apply(this, args);
  };
})();
`;

/**
 * 페이지 안에서 실행하는 측정 본문. Playwright가 함수 소스를 넘기므로 인자 외에는 참조하지 않는다.
 *
 * @param options - 양식 JSON, 끌 요소 id, 반복 수 등
 * @returns 드래그별 표본과 힙 변화
 */
async function runInPage(options) {
  const { fileJson, dragId, warmup, runs, moves, stepPx, docThreshold } = options;
  const { core } = window.__slipkit;
  const counters = window.__slipkitBenchCounters;
  counters.docThreshold = docThreshold;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const gc = typeof window.gc === 'function' ? window.gc : () => {};
  const heapUsed = () => performance.memory?.usedJSHeapSize ?? 0;

  core.parseSlipFile(fileJson);
  const el = document.createElement('slip-designer');
  el.slipkit = core.createSlipKit({
    getFonts: () => [{ name: 'Bench Sans', data: new Uint8Array([0]), fallback: true }],
  });
  document.body.appendChild(el);
  el.src = fileJson;
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  if (!el._file) throw new Error(`디자이너가 양식을 불러오지 못했습니다: ${el._error ?? 'unknown'}`);

  const findElement = () => el._file.template.pages[el._pageIndex].elements.find((c) => c.id === dragId);
  const pointer = (type, clientX, clientY) =>
    new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX, clientY, pointerId: 1, isPrimary: true });
  const reset = () => { for (const key of Object.keys(counters)) if (key !== 'docThreshold') counters[key] = 0; };

  const original = { ...findElement().position };
  const samples = [];
  let heapBefore = 0;
  for (let i = 0; i < warmup + runs; i++) {
    if (i === warmup) {
      gc();
      heapBefore = heapUsed();
    }
    const target = el.shadowRoot.querySelector(`.element[data-id="${dragId}"]`);
    if (!target) throw new Error(`캔버스에 요소가 없습니다: ${dragId}`);
    // 기록이 컨트롤러로 분리된 코드와 옛 배열 코드를 모두 읽는다 (metrics.mjs의 undoState와 같은 규칙).
    const undoState = () => el._history !== undefined
      ? { depth: el._history.undoDepth, chars: el._history.undoSnapshotBytes }
      : { depth: (el._undoStack ?? []).length, chars: (el._undoStack ?? []).reduce((sum, entry) => sum + entry.file.length, 0) };
    const undoBefore = undoState();
    reset();
    const start = performance.now();
    target.dispatchEvent(pointer('pointerdown', 0, 0));
    await el.updateComplete;
    for (let k = 1; k <= moves; k++) {
      target.dispatchEvent(pointer('pointermove', k * stepPx, 0));
      await el.updateComplete;
    }
    target.dispatchEvent(pointer('pointerup', moves * stepPx, 0));
    await el.updateComplete;
    const ms = performance.now() - start;
    const undoAfter = undoState();
    const moved = findElement().position;
    if (moved.x === original.x && moved.y === original.y) throw new Error('드래그 뒤에도 요소가 움직이지 않았습니다');
    if (i >= warmup) {
      samples.push({
        ms,
        stringifyCalls: counters.stringifyCalls,
        stringifyChars: counters.stringifyChars,
        stringifyDocCalls: counters.stringifyDocCalls,
        stringifyDocChars: counters.stringifyDocChars,
        cloneCalls: counters.cloneCalls,
        undoEntries: undoAfter.depth - undoBefore.depth,
        snapshotChars: undoAfter.chars - undoBefore.chars,
      });
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await el.updateComplete;
    const now = findElement().position;
    if (now.x !== original.x || now.y !== original.y) throw new Error('되돌리기 뒤 위치가 다릅니다');
  }
  gc();
  const heapDelta = heapUsed() - heapBefore;
  el.remove();
  return { samples, heapDelta };
}

/**
 * core·elements dist를 브라우저용 한 파일로 묶는다.
 *
 * @param options - `root`, `coreDist`, `elementsDist`, `outDir`
 * @returns 묶음 파일 경로
 */
async function bundle({ root, coreDist, elementsDist, outDir }) {
  // esbuild는 tsup의 의존성이라 tsup 위치에서 찾는다.
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const tsupRequire = createRequire(rootRequire.resolve('tsup/package.json'));
  const esbuild = await import(pathToFileURL(tsupRequire.resolve('esbuild')).href);
  const entry = path.join(outDir, 'entry.mjs');
  writeFileSync(entry, [
    `import * as core from ${JSON.stringify(coreDist)};`,
    `import * as elements from ${JSON.stringify(elementsDist)};`,
    'window.__slipkit = { core, elements };',
    '',
  ].join('\n'));
  const outfile = path.join(outDir, 'bundle.js');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile,
    logLevel: 'silent',
    external: ['*/fonts/pretendard.js', '*/fonts/noto-sans-jp.js'],
  });
  return outfile;
}

/**
 * Chromium에서 양식마다 드래그를 측정한다.
 *
 * @param options - 경로·양식·반복 수. `templates`는 `benchTemplates()` 결과
 * @returns `bench-designer.mjs`의 표 행과 같은 모양의 결과 목록
 */
export async function benchInChromium(options) {
  const { root, coreDist, elementsDist, templates, warmup, runs, moves, stepPx, maxUndo } = options;
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'slipkit-bench-designer-'));
  // playwright는 리포 루트의 devDependency다. scripts/에서 바로 가져온다.
  const { chromium } = await import('playwright');
  let server = null;
  let browser = null;
  try {
    const bundlePath = await bundle({ root, coreDist, elementsDist, outDir });
    const bundleSource = readFileSync(bundlePath);
    server = createServer((req, res) => {
      if (req.url === '/bundle.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(bundleSource);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>bench</title></head><body><script type="module" src="/bundle.js"></script></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    // 관리형 Chromium이 기본 위치에 없으면 SLIPKIT_CHROMIUM 또는 알려진 후보 경로를 쓴다.
    const executablePath = process.env['SLIPKIT_CHROMIUM'] ?? CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate));
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--js-flags=--expose-gc'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error('[chromium] page error:', error.message));
    await page.addInitScript(INIT_SCRIPT);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__slipkit !== undefined);
    await page.evaluate(() => {
      const { elements } = window.__slipkit;
      if (!customElements.get('slip-designer')) customElements.define('slip-designer', elements.SlipDesigner);
    });
    const version = browser.version();

    const rows = [];
    for (const spec of templates) {
      const fileJson = JSON.stringify(spec.file);
      const docThreshold = Math.min(10_000, fileJson.length);
      const { samples, heapDelta } = await page.evaluate(runInPage, {
        fileJson, dragId: spec.dragId, warmup, runs, moves, stepPx, docThreshold,
      });
      const pick = (key) => median(samples.map((s) => s[key]));
      const snapshotMedian = pick('snapshotChars');
      rows.push({
        name: spec.name,
        description: `${spec.description}, Chromium ${version}`,
        medianMs: pick('ms'),
        p95Ms: percentile(samples.map((s) => s.ms), 95),
        stringifyCalls: pick('stringifyCalls'),
        stringifyDocCalls: pick('stringifyDocCalls'),
        stringifyChars: pick('stringifyChars'),
        stringifyDocChars: pick('stringifyDocChars'),
        cloneCalls: pick('cloneCalls'),
        planCalls: 0,
        undoEntries: pick('undoEntries'),
        snapshotChars: snapshotMedian,
        retainedMax: maxUndo * snapshotMedian,
        heapDelta,
        templateChars: fileJson.length,
        docThreshold,
      });
    }
    return rows;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(outDir, { recursive: true, force: true });
  }
}
