/**
 * `font-requests` 픽스처 페이지를 Playwright Chromium에서 단계별로 돌리며 네트워크 요청을 나눠 기록한다.
 *
 * `scripts/bench-fonts.mjs`(계측)와 `scripts/verify-packages.mjs`(검증)가 같은 페이지·같은 단계 프로토콜을
 * 공유하도록 여기에 둔다. 페이지는 `window.__fontBench.runPhase(name)`으로 단계를 실행하고
 * `{ ms, heapBefore, heapAfter, detail }`을 돌려준다 (`scripts/verify-packages/fixtures/font-requests/main.ts`).
 *
 * - 시나리오마다 새 브라우저 컨텍스트를 만들고 CDP `Network.setCacheDisabled(true)`로 캐시를 끈다 — 매번 cold.
 * - 요청은 `requestfinished`의 `request.sizes()`로 전송 바이트(`responseBodySize` — 서버가 압축했으면 압축된 크기)·헤더
 *   바이트를 모으고,
 *   단계를 시작할 때 바꾸는 현재 단계 이름으로 나눈다. 단계가 끝나면 진행 중인 요청이 없는 상태가 500ms 이어질 때까지
 *   기다린다 (Playwright의 `networkidle`은 PDF iframe이 열리면 도달하지 않을 수 있어 쓰지 않는다).
 * - `http(s):`와 `blob:` 요청만 기록한다. `blob:`은 뷰어·폼이 만든 PDF iframe이다 (`pdf-blob`).
 * - 요청 분류는 URL의 파일 이름으로 한다. 픽스처 `vite.config.ts`의 `manualChunks`가 청크 이름을
 *   `font-pretendard`·`font-noto-sans-jp`·`elements`로 고정하므로 해시가 붙어도 앞부분으로 알 수 있다.
 */
import { existsSync } from 'node:fs';

/** 단계 이름 — 페이지의 `runPhase`가 받는 순서 그대로 */
export const PHASES = ['import', 'elements', 'resolve', 'share'];

/** 시나리오 이름과 페이지에 넘기는 쿼리 값 */
export const SCENARIOS = ['en', 'ko', 'ja', 'user'];

/** 동봉 폰트 청크의 요청 분류 이름 */
export const FONT_CHUNK_KINDS = ['font-pretendard', 'font-noto-sans-jp'];

/** Playwright가 관리형 Chromium을 찾지 못할 때 시도하는 실행 파일 후보 (`SLIPKIT_CHROMIUM`이 우선) */
const CHROMIUM_CANDIDATES = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

/**
 * 요청 URL을 파일 이름으로 분류한다.
 *
 * @param {string} url - 요청 URL
 * @returns {'page' | 'entry' | 'vite-preload' | 'elements' | 'font-pretendard' | 'font-noto-sans-jp' | 'host-font' | 'pdf-blob' | 'other'} 분류
 */
export function classifyRequest(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'blob:') return 'pdf-blob';
  const base = parsed.pathname.split('/').pop() ?? '';
  if (base === '' || base === 'index.html') return 'page';
  if (base === 'host-font.otf') return 'host-font';
  if (base.startsWith('font-pretendard-') || base.startsWith('font-pretendard.')) return 'font-pretendard';
  if (base.startsWith('font-noto-sans-jp-') || base.startsWith('font-noto-sans-jp.')) return 'font-noto-sans-jp';
  if (base.startsWith('elements-') || base.startsWith('elements.')) return 'elements';
  if (base.startsWith('index-') || base.startsWith('index.')) return 'entry';
  if (base.startsWith('vite-preload-') || base.startsWith('vite-preload.')) return 'vite-preload';
  return 'other';
}

/**
 * Chromium 실행 파일을 고른다 — `SLIPKIT_CHROMIUM` → 알려진 후보 → Playwright 기본.
 *
 * @returns {string | undefined} 실행 파일 경로. Playwright 기본을 쓰면 undefined
 */
export function chromiumExecutablePath() {
  return process.env['SLIPKIT_CHROMIUM'] ?? CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate));
}

/**
 * 정밀 메모리 정보와 `gc()`를 켠 Chromium을 띄운다.
 *
 * @returns {Promise<import('playwright').Browser>} 브라우저
 */
export async function launchChromium() {
  const { chromium } = await import('playwright');
  const executablePath = chromiumExecutablePath();
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
}

/**
 * 시나리오 하나를 새 컨텍스트에서 단계별로 실행한다.
 *
 * @param {import('playwright').Browser} browser - `launchChromium`이 돌려준 브라우저
 * @param {{ baseUrl: string, scenario: string, timeoutMs?: number }} options - 미리보기 서버 주소와 시나리오
 * @returns {Promise<{ scenario: string, phases: Record<string, { ms: number, heapBefore: number | null, heapAfter: number | null, detail: Record<string, unknown>, requests: Array<{ url: string, kind: string, bytes: number, headersBytes: number, status: number, failed: boolean }> }>, load: Array<{ url: string, kind: string, bytes: number, headersBytes: number, status: number, failed: boolean }>, errors: string[] }>}
 *   단계별 결과와 요청 목록. `load`는 페이지 자체를 여는 동안의 요청(HTML·진입 모듈)
 */
export async function runFontScenario(browser, { baseUrl, scenario, timeoutMs = 120_000 }) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    let phase = 'load';
    const records = [];
    const pending = [];
    const inflight = new Set();
    const errors = [];
    const tracked = (request) => /^(https?|blob):/.test(request.url());
    const settle = (request, failed) => {
      if (!tracked(request)) return;
      const current = phase;
      pending.push((async () => {
        const sizes = await request.sizes().catch(() => ({ responseBodySize: 0, responseHeadersSize: 0 }));
        const response = await request.response().catch(() => null);
        records.push({
          phase: current,
          url: request.url(),
          kind: classifyRequest(request.url()),
          // `blob:` 요청처럼 크기를 알 수 없으면 Chromium이 음수를 준다 — 0으로 적는다.
          bytes: Math.max(0, sizes.responseBodySize),
          headersBytes: Math.max(0, sizes.responseHeadersSize),
          status: response?.status() ?? 0,
          failed,
        });
        inflight.delete(request);
      })());
    };
    page.on('request', (request) => { if (tracked(request)) inflight.add(request); });
    page.on('requestfinished', (request) => settle(request, false));
    page.on('requestfailed', (request) => settle(request, true));
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
    });
    /** 진행 중인 요청이 없는 상태가 `quietMs` 이어질 때까지 기다린다. */
    const waitForQuiet = async (quietMs = 500) => {
      const deadline = Date.now() + timeoutMs;
      let quietSince = null;
      while (Date.now() < deadline) {
        if (inflight.size === 0) {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= quietMs) return;
        } else {
          quietSince = null;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`네트워크가 잠잠해지지 않았다: ${[...inflight].map((request) => request.url()).join(', ')}`);
    };

    const url = new URL(baseUrl);
    url.searchParams.set('scenario', scenario);
    await page.goto(url.href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fontBench !== undefined);
    await waitForQuiet();

    const phases = {};
    for (const name of PHASES) {
      phase = name;
      const result = await page.evaluate((phaseName) => window.__fontBench.runPhase(phaseName), name);
      await waitForQuiet();
      await Promise.all(pending.splice(0));
      phases[name] = { ...result, requests: records.filter((item) => item.phase === name).map(({ phase: _phase, ...rest }) => rest) };
    }
    const load = records.filter((item) => item.phase === 'load').map(({ phase: _phase, ...rest }) => rest);
    return { scenario, phases, load, errors };
  } finally {
    await context.close();
  }
}

/**
 * 단계의 요청 가운데 분류가 일치하는 것의 수와 바이트 합.
 *
 * @param {Array<{ kind: string, bytes: number }>} requests - 단계의 요청 목록
 * @param {string[]} kinds - 셀 분류 이름
 * @returns {{ count: number, bytes: number }} 수와 전송 바이트 합
 */
export function countRequests(requests, kinds) {
  const matched = requests.filter((request) => kinds.includes(request.kind));
  return { count: matched.length, bytes: matched.reduce((sum, request) => sum + request.bytes, 0) };
}
