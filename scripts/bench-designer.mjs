/**
 * 디자이너의 포인터 드래그 비용을 재현 가능하게 측정한다.
 *
 * 실행: `pnpm bench:designer` — Core와 Elements를 먼저 빌드한 뒤 측정하므로 명령 하나로
 * 재현된다. 기준 커밋과 수정 커밋에서 같은 환경으로 실행해 표를 비교하는 용도다.
 *
 * 시나리오 (고정)
 * - happy-dom 위에 `<slip-designer>`를 붙이고 양식을 불러온 뒤 첫 페이지의 텍스트 요소를
 *   누르고(`pointerdown`), `pointermove` 120번, `pointerup` 한 번을 보낸다 — 드래그 한 번.
 * - 이벤트마다 `updateComplete`를 기다려 Lit이 실제로 렌더링하게 한다. 렌더마다 드는 비용이
 *   측정 대상이다.
 * - 양식은 `scripts/bench-designer/templates.mjs`가 결정적으로 만든 두 벌(small·large)이다.
 *   붙이기 전에 `parseSlipFile`로 유효한지 확인한다.
 * - 양식마다 워밍업 5번 뒤 본 측정 30번을 재고 드래그 벽시계 시간의 중앙값과 p95를 적는다.
 * - 드래그 사이에는 호스트에 Ctrl+Z를 보내 되돌린다. 위치가 원래대로 돌아가고 되돌리기
 *   깊이가 1을 넘지 않으므로 매번 같은 조건에서 잰다 (`src`를 다시 넣는 방식은 파싱 비용이
 *   섞여 쓰지 않는다).
 *
 * 카운터 — 드래그 한 번 동안의 값을 모아 본 측정의 중앙값을 적는다
 * - `JSON.stringify`: dist를 가져오기 전에 전역을 감싸 호출 수와 결과 문자 수를 센다.
 *   결과가 10,000자 이상이면 「문서 크기」로 따로 센다 — 양식 자체가 그보다 작으면 양식 길이를
 *   문턱으로 쓴다. 되돌리기 스냅샷과 계획 캐시 키가 여기 들어간다.
 * - `structuredClone`: 같은 방식으로 감싼다.
 * - `planSourcePage`: `node:module`의 `register()`로 로더 훅(`core-hooks.mjs`)을 등록해
 *   `packages/core/dist/index.js`를 원본을 다시 내보내면서 이 함수만 세는 모듈로 바꾼다.
 *   `packages/` 아래는 바꾸지 않는다.
 * - 되돌리기: 드래그 뒤 늘어난 되돌리기 항목 수와 그 스냅샷 문자 수(양식이 ASCII라 바이트와
 *   같다). 최대 보존량은 `50 × 스냅샷 중앙값`으로 계산한다 (되돌리기 상한 50).
 * - 메모리: 본 측정 전후로 `gc()`를 부른 뒤 `heapUsed` 차이. `gc`가 없으면 `--expose-gc`로
 *   자신을 다시 실행한다.
 *
 * `--chromium`: Playwright로 실제 Chromium에서 같은 시나리오를 한 번 더 잰다
 * (`scripts/bench-designer/chromium.mjs`). 이 모드에서는 `planSourcePage` 수를 세지 않는다.
 */
import { register, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { realpathSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import os from 'node:os';
import { benchTemplates } from './bench-designer/templates.mjs';
import { installCounters, resetCounters, readCounters, median, percentile, formatInt, undoState, DOC_SIZE_CHARS } from './bench-designer/metrics.mjs';

const WARMUP = 5;
const RUNS = 30;
const MOVES = 120;
/** pointermove마다 오른쪽으로 옮기는 픽셀. 120번이면 60px ≈ 15.9mm */
const STEP_PX = 0.5;
/** 디자이너의 되돌리기 상한 — 최대 보존량 계산에 쓴다 */
const MAX_UNDO = 50;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const useChromium = process.argv.includes('--chromium');

// heapUsed 차이를 재려면 gc()가 필요하다. 없으면 --expose-gc를 붙여 자신을 다시 실행한다.
if (typeof globalThis.gc !== 'function' && process.env.SLIPKIT_BENCH_CHILD !== '1') {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, SLIPKIT_BENCH_CHILD: '1' } },
  );
  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// 카운터와 로더 훅 — dist를 가져오기 전에 설치한다
// ---------------------------------------------------------------------------

installCounters(globalThis);

const coreDist = realpathSync(path.join(root, 'packages/core/dist/index.js'));
const elementsDist = realpathSync(path.join(root, 'packages/elements/dist/index.js'));
register(pathToFileURL(path.join(here, 'bench-designer/core-hooks.mjs')), {
  data: { coreUrl: pathToFileURL(coreDist).href },
});

// ---------------------------------------------------------------------------
// happy-dom 전역 — vitest의 happy-dom 환경이 하는 일을 따른다
// ---------------------------------------------------------------------------

const elementsRequire = createRequire(path.join(root, 'packages/elements/package.json'));
const happyDomPackage = JSON.parse(readFileSync(elementsRequire.resolve('happy-dom/package.json'), 'utf8'));
const { GlobalWindow } = await import(pathToFileURL(elementsRequire.resolve('happy-dom')).href);

/**
 * happy-dom 창의 속성을 Node 전역에 올린다.
 *
 * Node에 이미 있는 이름은 DOM 동작에 필요한 것만 덮어쓴다. 소문자 함수는 창에 묶어 둔다.
 *
 * @param win - happy-dom `GlobalWindow`
 */
function populateGlobal(win) {
  const overrideExisting = new Set([
    'navigator', 'Event', 'EventTarget', 'CustomEvent', 'MessageEvent', 'DOMException',
    'Blob', 'File', 'FormData', 'Headers', 'AbortController', 'AbortSignal', 'Storage',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
  ]);
  const skip = new Set(['window', 'self', 'top', 'parent', 'globalThis', 'structuredClone', 'JSON']);
  for (const key of Object.getOwnPropertyNames(win)) {
    if (skip.has(key)) continue;
    if (key in globalThis && !overrideExisting.has(key)) continue;
    const value = win[key];
    const bound = typeof value === 'function' && key[0] !== key[0].toUpperCase() ? value.bind(win) : null;
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => bound ?? win[key],
      set: (v) => { win[key] = v; },
    });
  }
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.top = globalThis;
  globalThis.parent = globalThis;
  Object.defineProperty(globalThis.document, 'defaultView', { configurable: true, get: () => globalThis });
}

const win = new GlobalWindow({ url: 'http://localhost:3000', settings: { disableErrorCapturing: true } });
populateGlobal(win);

// Node의 localStorage는 --localstorage-file 없이는 동작하지 않으므로 메모리 저장소를 둔다.
{
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, String(value)); },
    },
  });
}

// ---------------------------------------------------------------------------
// 모듈 로드 — 이 시점부터 core는 훅이 감싼 모듈이다
// ---------------------------------------------------------------------------

const core = await import(pathToFileURL(coreDist).href);
const elements = await import(pathToFileURL(elementsDist).href);
if (!customElements.get('slip-designer')) {
  customElements.define('slip-designer', elements.SlipDesigner);
}

/** 동봉 폰트(수 MB)를 읽지 않도록 이름만 있는 폰트를 공급하는 SlipKit 인스턴스 */
const slipkit = core.createSlipKit({
  getFonts: () => [{ name: 'Bench Sans', data: new Uint8Array([0]), fallback: true }],
});

/** 마이크로태스크와 타이머 한 바퀴를 비운다. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 디자이너를 만들어 양식을 불러오고 첫 렌더가 끝날 때까지 기다린다.
 *
 * @param file - 양식 객체 (검증은 호출자가 한다)
 * @returns 붙여진 `<slip-designer>`
 */
async function mountDesigner(file) {
  const el = document.createElement('slip-designer');
  el.slipkit = slipkit;
  document.body.appendChild(el);
  el.src = JSON.stringify(file);
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  if (el._file === null || el._file === undefined) {
    throw new Error(`디자이너가 양식을 불러오지 못했습니다: ${el._error ?? 'unknown'}`);
  }
  return el;
}

/**
 * 포인터 이벤트를 만든다. Shadow DOM을 넘어 호스트까지 올라가도록 `composed`를 켠다.
 *
 * @param type - 이벤트 이름
 * @param clientX - X 좌표(px)
 * @param clientY - Y 좌표(px)
 * @returns PointerEvent
 */
function pointer(type, clientX, clientY) {
  return new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX, clientY, pointerId: 1 });
}

/**
 * 드래그 한 번: pointerdown → pointermove × MOVES → pointerup. 이벤트마다 렌더를 기다린다.
 *
 * @param el - 디자이너
 * @param id - 끌 요소 id
 * @returns 벽시계 시간(ms)
 */
async function dragGesture(el, id) {
  const target = el.shadowRoot.querySelector(`.element[data-id="${id}"]`);
  if (!target) throw new Error(`캔버스에 요소가 없습니다: ${id}`);
  const start = performance.now();
  target.dispatchEvent(pointer('pointerdown', 0, 0));
  await el.updateComplete;
  for (let i = 1; i <= MOVES; i++) {
    target.dispatchEvent(pointer('pointermove', i * STEP_PX, 0));
    await el.updateComplete;
  }
  target.dispatchEvent(pointer('pointerup', MOVES * STEP_PX, 0));
  await el.updateComplete;
  return performance.now() - start;
}

/**
 * Ctrl+Z로 마지막 드래그를 되돌리고 위치가 돌아왔는지 확인한다.
 *
 * @param el - 디자이너
 * @param id - 끌었던 요소 id
 * @param original - 드래그 전 위치
 */
async function undoGesture(el, id, original) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await el.updateComplete;
  const now = findElement(el, id).position;
  if (now.x !== original.x || now.y !== original.y) {
    throw new Error(`되돌리기 뒤 위치가 다릅니다: ${JSON.stringify(now)} ≠ ${JSON.stringify(original)}`);
  }
}

/**
 * 현재 페이지에서 id로 요소를 찾는다.
 *
 * @param el - 디자이너
 * @param id - 요소 id
 * @returns 요소 객체
 */
function findElement(el, id) {
  return el._file.template.pages[el._pageIndex].elements.find((candidate) => candidate.id === id);
}

/**
 * 양식 하나를 측정한다.
 *
 * @param spec - `benchTemplates()`의 항목
 * @returns 표 한 행에 쓸 집계
 */
async function benchTemplate(spec) {
  // 유효하지 않은 양식은 디자이너가 조용히 거절하므로 먼저 파서로 확인한다.
  const fileJson = JSON.stringify(spec.file);
  core.parseSlipFile(fileJson);
  // small처럼 10,000자가 안 되는 양식은 그 길이를 문턱으로 삼아 스냅샷이 문서 크기로 잡히게 한다.
  const docThreshold = Math.min(DOC_SIZE_CHARS, fileJson.length);
  const el = await mountDesigner(spec.file);
  const original = { ...findElement(el, spec.dragId).position };

  const samples = [];
  const undoDepthBefore = undoState(el).depth;
  let heapBefore = 0;
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const measured = i >= WARMUP;
    if (i === WARMUP) {
      globalThis.gc();
      heapBefore = process.memoryUsage().heapUsed;
    }
    const undoBefore = undoState(el);
    resetCounters(globalThis, docThreshold);
    const ms = await dragGesture(el, spec.dragId);
    const counters = readCounters(globalThis);
    const undoAfter = undoState(el);
    const moved = findElement(el, spec.dragId).position;
    if (moved.x === original.x && moved.y === original.y) {
      throw new Error(`드래그 뒤에도 요소가 움직이지 않았습니다: ${spec.name}`);
    }
    if (measured) {
      samples.push({
        ms,
        ...counters,
        undoEntries: undoAfter.depth - undoBefore.depth,
        snapshotChars: undoAfter.chars - undoBefore.chars,
      });
    }
    await undoGesture(el, spec.dragId, original);
  }
  globalThis.gc();
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;
  if (undoState(el).depth !== undoDepthBefore) {
    throw new Error(`되돌리기 깊이가 늘었습니다: ${undoDepthBefore} → ${undoState(el).depth}`);
  }
  el.remove();

  const pick = (key) => median(samples.map((s) => s[key]));
  const snapshotMedian = pick('snapshotChars');
  return {
    name: spec.name,
    description: spec.description,
    medianMs: pick('ms'),
    p95Ms: percentile(samples.map((s) => s.ms), 95),
    stringifyCalls: pick('stringifyCalls'),
    stringifyDocCalls: pick('stringifyDocCalls'),
    stringifyChars: pick('stringifyChars'),
    stringifyDocChars: pick('stringifyDocChars'),
    cloneCalls: pick('cloneCalls'),
    planCalls: pick('planCalls'),
    undoEntries: pick('undoEntries'),
    snapshotChars: snapshotMedian,
    retainedMax: MAX_UNDO * snapshotMedian,
    heapDelta,
    templateChars: fileJson.length,
    docThreshold,
  };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

const cpu = os.cpus()[0];
console.log(`Node ${process.version} · ${os.platform()}/${os.arch()} · ${os.cpus().length} core · ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB`);
console.log(`CPU: ${cpu ? cpu.model : '알 수 없음'}`);
console.log(`happy-dom ${happyDomPackage.version} · Chromium ${useChromium ? '사용 (--chromium)' : '미사용'} · planSourcePage 훅 ${globalThis.__slipkitPlanHook === true ? '적용' : '미적용'}`);
console.log(`드래그 = pointerdown + pointermove ×${MOVES} + pointerup · 워밍업 ${WARMUP}회 · 본 측정 ${RUNS}회 · 드래그 사이 Ctrl+Z`);
console.log('시간은 드래그 한 번의 벽시계 시간, 카운터는 드래그 한 번 동안의 값 — 모두 본 측정의 중앙값(p95만 95번째 백분위)');
console.log('heapUsed 변화는 본 측정 30회 전후 gc() 뒤의 차이. Node 표에는 happy-dom 자체 캐시가 섞이므로 디자이너의 보존량은 Chromium 표를 기준으로 본다\n');

const rows = [];
for (const spec of benchTemplates()) {
  rows.push(await benchTemplate(spec));
}

/**
 * 결과 표를 마크다운으로 찍는다.
 *
 * @param title - 표 제목
 * @param results - `benchTemplate` 결과 목록
 * @param withPlan - planSourcePage 열을 넣을지
 */
function printTable(title, results, withPlan) {
  console.log(`### ${title}\n`);
  const head = ['양식', '중앙값', 'p95', 'stringify 호출 (문서 크기/전체)', 'stringify 문자', 'structuredClone'];
  if (withPlan) head.push('planSourcePage');
  head.push('되돌리기 항목', '스냅샷 바이트', '최대 보존량 (50개)', 'heapUsed 변화');
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const r of results) {
    const cells = [
      `${r.name} (${r.description}, ${formatInt(r.templateChars)}자, 문서 크기 ≥ ${formatInt(r.docThreshold)}자)`,
      `${r.medianMs.toFixed(1)}ms`,
      `${r.p95Ms.toFixed(1)}ms`,
      `${formatInt(r.stringifyDocCalls)} / ${formatInt(r.stringifyCalls)}`,
      `${formatInt(r.stringifyChars)} (문서 크기 ${formatInt(r.stringifyDocChars)})`,
      formatInt(r.cloneCalls),
    ];
    if (withPlan) cells.push(formatInt(r.planCalls));
    cells.push(
      formatInt(r.undoEntries),
      formatInt(r.snapshotChars),
      `${(r.retainedMax / 1024 ** 2).toFixed(1)}MB`,
      `${(r.heapDelta / 1024 ** 2).toFixed(1)}MB`,
    );
    console.log(`| ${cells.join(' | ')} |`);
  }
  console.log('');
}

printTable('Node + happy-dom', rows, true);

if (useChromium) {
  const { benchInChromium } = await import('./bench-designer/chromium.mjs');
  const chromiumRows = await benchInChromium({
    root, elementsDist, coreDist, templates: benchTemplates(), warmup: WARMUP, runs: RUNS, moves: MOVES, stepPx: STEP_PX, maxUndo: MAX_UNDO,
  });
  printTable('Chromium (Playwright)', chromiumRows, false);
}

// happy-dom 창이 잡고 있는 타이머 때문에 프로세스가 남지 않도록 정리한다.
await win.happyDOM.close();
