// 동봉 폰트 청크가 언제 읽히는지 단계별로 확인하는 페이지. `?scenario=en|ko|ja|user`로 시나리오를 고르고,
// Node 쪽(Playwright)이 `window.__fontBench.runPhase(name)`을 순서대로 불러 단계마다 시간·힙을 받고
// 그 사이의 네트워크 요청을 나눠 기록합니다. 공개 export(`createSlipKit`·`loadDefaultFonts`·커스텀 엘리먼트)만 씁니다.
//
// 단계 (반드시 이 순서로)
// - import: `@omdc-slipkit/elements`와 core를 동적으로 가져와 루트 진입점의 정적 의존 파일을 읽는 시간입니다.
// - elements: `<slip-designer>`, `<slip-form>`, `<slip-viewer>`를 만들어 생성자를 실행합니다. DOM에는 붙이지 않습니다.
//              디자이너는 첫 렌더에서 캔버스 폰트 목록을 위해 폰트를 해석하므로, 붙이는 순간이 곧 폰트 해석 시점입니다
// - resolve  : 기본 시나리오는 `loadDefaultFonts(locale)`, user 시나리오는 호스트 폰트 fetch + `createSlipKit({ getFonts })`
// - share    : 세 컴포넌트에 같은 slipkit·locale·양식을 넣어 DOM에 붙이고 뷰어·폼의 PDF 미리보기가 끝날 때까지 기다립니다
import { template } from '../template.mjs';

type Phase = 'import' | 'elements' | 'resolve' | 'share';
type Scenario = 'en' | 'ko' | 'ja' | 'user';
type ElementsModule = typeof import('@omdc-slipkit/elements');
type CoreModule = typeof import('@omdc-slipkit/core');
type SlipKit = ReturnType<CoreModule['createSlipKit']>;
type SlipElement = HTMLElement & { src: string; locale?: string; slipkit?: SlipKit; updateComplete: Promise<boolean> };

interface PhaseResult {
  ms: number;
  heapBefore: number | null;
  heapAfter: number | null;
  detail: Record<string, unknown>;
}

declare global {
  interface Window {
    __fontBench: {
      scenario: Scenario;
      locale: string;
      results: Partial<Record<Phase, PhaseResult>>;
      runPhase(name: Phase): Promise<PhaseResult>;
    };
    gc?: () => void;
  }
  interface Performance {
    memory?: { usedJSHeapSize: number };
  }
}

const SCENARIOS: readonly Scenario[] = ['en', 'ko', 'ja', 'user'];
const requested = new URLSearchParams(location.search).get('scenario') ?? 'en';
if (!(SCENARIOS as readonly string[]).includes(requested)) throw new Error(`unknown scenario: ${requested}`);
const scenario = requested as Scenario;
const locale = scenario === 'user' ? 'en' : scenario;
const templateJson = JSON.stringify(template);

let elements: ElementsModule | undefined;
let core: CoreModule | undefined;
let created: { designer: SlipElement; form: SlipElement; viewer: SlipElement } | undefined;
let slipkit: SlipKit | undefined;
const results: Partial<Record<Phase, PhaseResult>> = {};

/** `gc()`가 있으면 메모리를 정리한 뒤 힙 사용량을 읽습니다. `performance.memory`가 없으면 `null`입니다. */
function heapUsed(): number | null {
  if (typeof window.gc === 'function') window.gc();
  return performance.memory?.usedJSHeapSize ?? null;
}

/** 단계 본문의 시간과 전후 힙을 측정합니다. */
async function measure(body: () => Promise<Record<string, unknown>>): Promise<PhaseResult> {
  const heapBefore = heapUsed();
  const start = performance.now();
  const detail = await body();
  const ms = performance.now() - start;
  const heapAfter = heapUsed();
  return { ms, heapBefore, heapAfter, detail };
}

/** 조건이 값을 반환할 때까지 50ms마다 확인합니다. */
function waitFor<T>(probe: () => T | null, what: string, timeoutMs = 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const value = probe();
      if (value !== null) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for ${what}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * 뷰어·폼의 PDF 미리보기 상태. 두 컴포넌트는 성공하면 shadow DOM에 `blob:` iframe을, 실패하면
 * `.status.error`를 표시합니다(`slip-viewer.ts`·`slip-form.ts`의 render).
 */
function previewState(el: HTMLElement): 'pdf' | 'error' | null {
  const root = el.shadowRoot;
  if (!root) return null;
  if (root.querySelector('iframe[src^="blob:"]')) return 'pdf';
  if (root.querySelector('.status.error')) return 'error';
  return null;
}

function requireDone<T>(value: T | undefined, phase: Phase): T {
  if (value === undefined) throw new Error(`run the "${phase}" phase first`);
  return value;
}

const phases: Record<Phase, () => Promise<Record<string, unknown>>> = {
  async import() {
    const [elementsModule, coreModule] = await Promise.all([import('@omdc-slipkit/elements'), import('@omdc-slipkit/core')]);
    elements = elementsModule;
    core = coreModule;
    return { elementsExports: Object.keys(elementsModule).length, coreExports: Object.keys(coreModule).length };
  },

  async elements() {
    const mod = requireDone(elements, 'import');
    const designer = document.createElement('slip-designer') as SlipElement;
    const form = document.createElement('slip-form') as SlipElement;
    const viewer = document.createElement('slip-viewer') as SlipElement;
    const defined = [
      designer instanceof mod.SlipDesigner,
      form instanceof mod.SlipForm,
      viewer instanceof mod.SlipViewer,
    ];
    if (!defined.every(Boolean)) throw new Error(`custom elements not upgraded: ${defined.join(',')}`);
    created = { designer, form, viewer };
    return { created: ['slip-designer', 'slip-form', 'slip-viewer'] };
  },

  async resolve() {
    const mod = requireDone(elements, 'import');
    const coreModule = requireDone(core, 'import');
    if (scenario === 'user') {
      const response = await fetch('/host-font.otf');
      if (!response.ok) throw new Error(`host font request failed: ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      const hostFonts = [{ name: 'Host Sans', data, fallback: true }];
      slipkit = coreModule.createSlipKit({ locale, getFonts: () => hostFonts });
      return { hostFontBytes: data.byteLength, fonts: hostFonts.map((font) => font.name) };
    }
    const fonts = await mod.loadDefaultFonts(locale);
    slipkit = coreModule.createSlipKit({ locale });
    return {
      fonts: fonts.map((font) => font.name),
      fallback: fonts.filter((font) => font.fallback === true).map((font) => font.name),
      decodedBytes: fonts.reduce((sum, font) => sum + font.data.byteLength, 0),
    };
  },

  async share() {
    const kit = requireDone(slipkit, 'resolve');
    const { designer, form, viewer } = requireDone(created, 'elements');
    for (const el of [designer, form, viewer]) {
      el.slipkit = kit;
      el.locale = locale;
      el.src = templateJson;
      document.body.appendChild(el);
    }
    await Promise.all([designer.updateComplete, form.updateComplete, viewer.updateComplete]);
    const viewerState = await waitFor(() => previewState(viewer), 'slip-viewer PDF');
    const formState = await waitFor(() => previewState(form), 'slip-form preview PDF');
    await designer.updateComplete;
    // 디자이너가 캔버스에 등록한 FontFace 읽기가 끝날 때까지 기다립니다.
    await document.fonts.ready;
    return { viewer: viewerState, form: formState };
  },
};

window.__fontBench = {
  scenario,
  locale,
  results,
  async runPhase(name) {
    const body = phases[name];
    if (body === undefined) throw new Error(`unknown phase: ${name}`);
    if (results[name] !== undefined) throw new Error(`phase already run: ${name}`);
    const result = await measure(body);
    results[name] = result;
    document.getElementById('result')!.textContent = JSON.stringify({ scenario, locale, results }, null, 2);
    return result;
  },
};

document.getElementById('result')!.textContent = JSON.stringify({ scenario, locale, results: {} });
