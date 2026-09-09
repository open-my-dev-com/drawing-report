/**
 * `docs/TEST-PLAN.md`의 성능 기준선을 다시 측정한다.
 *
 * 실행: `pnpm bench` — Core를 먼저 빌드한 뒤 측정하므로 명령 하나로 재현된다.
 *
 * 옵션
 * - `--json <path>` 환경·fixture·반복 원자료·median·p95와 결정적 결과를 판 번호가 있는 JSON으로 남긴다.
 *   생략하면 표만 출력한다.
 *
 * 측정 방법
 * - 각 작업마다 워밍업을 돌린 뒤 본 측정을 반복하고 **중앙값**을 적는다.
 *   중앙값을 쓰는 이유는 가비지 수집이나 다른 프로세스 때문에 드물게 튀는
 *   값이 평균을 끌어올리기 때문이다.
 * - 한 번의 호출이 측정 오차보다 짧은 작업은 한 측정 안에서 여러 번 돌린다
 *   (`batch`). 그러면 시계 읽기의 비중이 줄고, 호출당 시간을 유효 자릿수까지
 *   볼 수 있다. 워밍업도 본 측정과 같은 횟수만큼 돌려 최적화 상태를 맞춘다.
 * - 동기 함수는 반복문에서 그대로 호출하고, 비동기 함수만 `await`한다.
 *   동기 함수를 `await`하면 호출마다 Promise를 만들고 마이크로태스크로
 *   넘어가는 비용이 측정에 섞여, 호출이 짧은 작업일수록 왜곡이 커진다.
 * - 표에는 한 측정의 소요 시간, 호출당 시간, 초당 호출 수를 함께 적는다.
 * - 이 스크립트는 Node.js 기준선이다. 브라우저 주 스레드 점유 시간은
 *   별도로 측정해야 한다.
 *
 * 결정적 결과 — 환경이 달라도 같아야 하는 값이라 JSON에 따로 남긴다
 * - 양식 직렬화 문자 수
 * - 항목 수별 페이지 계획의 출력 페이지 수
 * - 작은·대형 전표 PDF의 페이지 수·바이트 수와 `%PDF` 서명 확인
 *   (PDF에는 생성 시각이 들어가 압축 결과가 몇 바이트 흔들린다)
 */
import { performance } from 'node:perf_hooks';
import {
  planSourcePage,
  parseSlipFile,
  serializeSlipFile,
  parseFormula,
  evaluateFormula,
  encryptSlipFile,
  decryptSlipFile,
  buildVoucher,
  createSlipKit,
} from '../packages/core/dist/index.js';
import { readArg } from './bench-shared/args.mjs';
import { collectEnvironment } from './bench-shared/env.mjs';
import { median, percentile } from './bench-shared/stats.mjs';
import { createResult, metric, writeResultFile } from './bench-shared/result.mjs';

const argv = process.argv.slice(2);
const jsonPath = readArg(argv, '--json');

/**
 * 동기 함수를 워밍업한 뒤 `batch`번씩 묶어 `runs`번 잰다.
 * 측정 구간에 `await`를 두지 않아 Promise 비용이 섞이지 않는다.
 *
 * @param {number} runs - 본 측정 반복 수
 * @param {number} warmup - 워밍업 반복 수
 * @param {number} batch - 한 측정당 호출 수
 * @param {() => unknown} fn - 잴 함수
 * @returns {number[]} 측정마다의 소요 시간(ms)
 */
function sampleSync(runs, warmup, batch, fn) {
  for (let i = 0; i < warmup; i++) for (let k = 0; k < batch; k++) fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < batch; k++) fn();
    times.push(performance.now() - start);
  }
  return times;
}

/**
 * 비동기 함수용. 호출마다 결과를 기다린 뒤 다음 호출로 넘어간다.
 *
 * @param {number} runs - 본 측정 반복 수
 * @param {number} warmup - 워밍업 반복 수
 * @param {number} batch - 한 측정당 호출 수
 * @param {() => Promise<unknown>} fn - 잴 함수
 * @returns {Promise<number[]>} 측정마다의 소요 시간(ms)
 */
async function sampleAsync(runs, warmup, batch, fn) {
  for (let i = 0; i < warmup; i++) for (let k = 0; k < batch; k++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < batch; k++) await fn();
    times.push(performance.now() - start);
  }
  return times;
}

/**
 * 호출당 시간을 유효 자릿수가 남게 적는다.
 *
 * @param {number} ms - 호출당 밀리초
 * @returns {string} 문자열
 */
function perCall(ms) {
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(1)}µs`;
  return `${(ms * 1_000_000).toFixed(0)}ns`;
}

const paper = { width: 210, height: 297, padding: [20, 15, 20, 15] };

/**
 * 머리·항목·꼬리 세 구간을 가진 반복 그리드.
 *
 * @returns {Record<string, any>} 그리드 요소
 */
function repeatGrid() {
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 5; column++) cells.push({ row, column, content: `r${row}c${column}` });
  }
  return {
    id: 'items',
    type: 'grid',
    name: '품목표',
    position: { x: 15, y: 40 },
    columns: [{ width: 60 }, { width: 40 }, { width: 25 }, { width: 25 }, { width: 30 }],
    rows: [{ height: 8 }, { height: 8 }, { height: 8 }],
    cells,
    repeat: {
      parameter: 'items',
      bands: [
        { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
        { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        { id: 'b-tail', fromRow: 2, toRow: 2, placement: 'after-data' },
      ],
      pagination: { mode: 'auto', minItems: 0 },
    },
  };
}

/**
 * 항목 n건. 값은 측정마다 같도록 색인에서 만든다.
 *
 * @param {number} n - 항목 수
 * @returns {Array<Record<string, unknown>>} 항목 목록
 */
const makeItems = (n) =>
  Array.from({ length: n }, (_, i) => ({
    itemName: `품목 ${i}`,
    quantity: i % 7,
    unitPrice: 1000 + i,
    amount: (i % 7) * (1000 + i),
  }));

const template = {
  schemaVersion: '0.1.0',
  kind: 'template',
  template: {
    meta: { title: '벤치마크', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    assets: [],
    paper: { ...paper },
    parameters: [
      {
        key: 'items',
        label: '품목',
        valueType: 'list',
        fields: [
          { key: 'itemName', label: '품명' },
          { key: 'quantity', label: '수량', valueType: 'number' },
          { key: 'unitPrice', label: '단가', valueType: 'number' },
          { key: 'amount', label: '금액', valueType: 'number' },
        ],
      },
    ],
    pages: [{ elements: [repeatGrid()] }],
  },
};

const templateJson = serializeSlipFile(template);
const formula = parseFormula('ROUND(SUM($(items).$(amount)) * 1.1, 0)');
const formulaContext = { values: { items: makeItems(1000) } };
const rawKey = new Uint8Array(32).fill(7);
const passphrase = 'correct-horse-battery-staple';
const envelope = await encryptSlipFile(template, passphrase);

/** PDF 생성에 쓰는 전표 — 작은 것과 대형 것 두 벌 */
const PDF_ITEMS = { small: 5, large: 200 };
const vouchers = {
  small: buildVoucher(template, { items: makeItems(PDF_ITEMS.small) }),
  large: buildVoucher(template, { items: makeItems(PDF_ITEMS.large) }),
};
/** 호스트가 폰트를 주지 않는 기본 경로 — 렌더링 엔진의 기본 폰트를 쓴다 */
const slipkit = createSlipKit({ locale: 'en' });

/**
 * 페이지 계획의 출력 페이지 수를 센다.
 *
 * @param {number} count - 항목 수
 * @returns {number} 출력 페이지 수
 */
function outputPages(count) {
  return planSourcePage(paper, template.template.pages[0], new Map([['items', makeItems(count)]])).outputPageCount;
}

/**
 * 전표 PDF를 한 번 만들어 결정적 결과를 모은다.
 *
 * @param {'small' | 'large'} size - 전표 크기
 * @returns {Promise<{ bytes: number, pages: number, header: boolean }>} 바이트 수·페이지 수·서명 확인
 */
async function pdfFacts(size) {
  const pdf = await slipkit.render(vouchers[size]);
  return {
    bytes: pdf.byteLength,
    pages: outputPages(PDF_ITEMS[size]),
    header: new TextDecoder().decode(pdf.slice(0, 4)) === '%PDF',
  };
}

/**
 * 측정 항목.
 * `async`가 참인 항목만 측정 구간에서 `await`한다.
 */
const CASES = [
  // 페이지 계획은 한 번이 충분히 길어 호출을 묶지 않는다.
  ...[100, 1000, 5000, 20000].map((n) => {
    const page = { elements: [repeatGrid()] };
    const data = makeItems(n);
    return {
      id: `core.plan.${n}`,
      name: `페이지 계획 — 항목 ${n}건`,
      fixture: `plan-${n}`,
      runs: 15, warmup: 5, batch: 1, async: false,
      fn: () => planSourcePage(paper, page, new Map([['items', data]])),
    };
  }),
  {
    id: 'core.parse', name: `parseSlipFile — ${(templateJson.length / 1024).toFixed(1)}KB`, fixture: 'bench-template',
    runs: 15, warmup: 5, batch: 500, async: false, fn: () => parseSlipFile(templateJson),
  },
  {
    id: 'core.formula.parse', name: 'parseFormula', fixture: 'bench-formula',
    runs: 15, warmup: 5, batch: 10_000, async: false,
    fn: () => parseFormula('ROUND(SUM($(items).$(amount)) * 1.1, 0)'),
  },
  {
    id: 'core.formula.evaluate', name: 'evaluateFormula — 항목 1,000건 합계', fixture: 'bench-formula-1000',
    runs: 15, warmup: 5, batch: 1000, async: false, fn: () => evaluateFormula(formula, formulaContext),
  },
  // 키 파생은 의도적으로 느리므로 한 번씩 잰다.
  {
    id: 'core.encrypt.passphrase', name: '암호화 — 암호 (PBKDF2 + AES-GCM)', fixture: 'bench-template',
    runs: 10, warmup: 3, batch: 1, async: true, fn: () => encryptSlipFile(template, passphrase),
  },
  {
    id: 'core.decrypt.passphrase', name: '복호화 — 암호', fixture: 'bench-template',
    runs: 10, warmup: 3, batch: 1, async: true, fn: () => decryptSlipFile(envelope, passphrase),
  },
  {
    id: 'core.encrypt.rawKey', name: '암호화 — 원시 키 (PBKDF2 없음)', fixture: 'bench-template',
    runs: 15, warmup: 5, batch: 50, async: true, fn: () => encryptSlipFile(template, rawKey),
  },
  {
    id: 'core.pdf.small', name: `PDF 생성 — 작은 전표 (항목 ${PDF_ITEMS.small}건)`, fixture: `pdf-${PDF_ITEMS.small}`,
    runs: 10, warmup: 3, batch: 1, async: true, fn: () => slipkit.render(vouchers.small),
  },
  {
    id: 'core.pdf.large', name: `PDF 생성 — 대형 전표 (항목 ${PDF_ITEMS.large}건)`, fixture: `pdf-${PDF_ITEMS.large}`,
    runs: 5, warmup: 1, batch: 1, async: true, fn: () => slipkit.render(vouchers.large),
  },
];

const environment = collectEnvironment();
console.log(`Node ${environment.node} · ${environment.platform}/${environment.arch} · ${environment.cores} core`);
console.log(`CPU: ${environment.cpuModel} · 메모리 ${(environment.memoryBytes / 1024 ** 3).toFixed(1)}GB`);
console.log('각 값은 워밍업 뒤 본 측정의 중앙값\n');
console.log('| 작업 | 측정 | 한 측정 | 호출당 | 초당 호출 |');
console.log('|---|---|---|---|---|');

const measurements = [];
for (const item of CASES) {
  const times = item.async
    ? await sampleAsync(item.runs, item.warmup, item.batch, item.fn)
    : sampleSync(item.runs, item.warmup, item.batch, item.fn);
  const ms = median(times);
  const each = ms / item.batch;
  const ops = each > 0 ? Math.round(1000 / each).toLocaleString('en-US') : '—';
  const shape = item.batch === 1 ? `${item.runs}회` : `${item.runs}회 × ${item.batch.toLocaleString('en-US')}호출`;
  console.log(`| ${item.name} | ${shape} | ${ms.toFixed(1)}ms | ${perCall(each)} | ${ops} |`);
  measurements.push({
    id: item.id, name: item.name, fixture: item.fixture,
    runs: item.runs, warmup: item.warmup, batch: item.batch,
    times, medianMs: ms, p95Ms: percentile(times, 95), perCallMs: each,
  });
}

if (jsonPath !== undefined) {
  const deterministic = {
    templateChars: templateJson.length,
    planPages: Object.fromEntries([100, 1000, 5000, 20000].map((n) => [n, outputPages(n)])),
    pdf: { small: await pdfFacts('small'), large: await pdfFacts('large') },
  };
  const metrics = [
    metric('core.template.serializedChars', {
      label: '양식 직렬화 문자 수', unit: 'count', kind: 'deterministic',
      value: deterministic.templateChars, context: { fixture: 'bench-template' },
    }),
  ];
  for (const [count, pages] of Object.entries(deterministic.planPages)) {
    metrics.push(metric(`core.plan.${count}.outputPages`, {
      label: `페이지 계획 출력 페이지 수 — 항목 ${count}건`, unit: 'count', kind: 'deterministic',
      value: pages, context: { fixture: `plan-${count}`, items: Number(count) },
    }));
  }
  for (const size of ['small', 'large']) {
    const facts = deterministic.pdf[size];
    const items = PDF_ITEMS[size];
    metrics.push(metric(`core.pdf.${size}.pages`, {
      label: `PDF 페이지 수 — 항목 ${items}건`, unit: 'count', kind: 'deterministic',
      value: facts.pages, context: { fixture: `pdf-${items}`, items },
    }));
    metrics.push(metric(`core.pdf.${size}.bytes`, {
      label: `PDF 바이트 — 항목 ${items}건`, unit: 'bytes', kind: 'deterministic',
      value: facts.bytes, context: { fixture: `pdf-${items}`, items },
    }));
    metrics.push(metric(`core.pdf.${size}.header`, {
      label: `PDF 서명 확인 — 항목 ${items}건`, unit: 'flag', kind: 'deterministic',
      value: facts.header ? 1 : 0, context: { fixture: `pdf-${items}`, items },
    }));
  }
  for (const row of measurements) {
    metrics.push(metric(`${row.id}.medianMs`, {
      label: `${row.name} — 한 측정 중앙값`, unit: 'ms', kind: 'environmental',
      value: row.medianMs, context: { fixture: row.fixture, runs: row.runs, batch: row.batch },
    }));
  }
  const result = createResult({
    tool: 'core',
    environment,
    options: { cases: CASES.length },
    metrics,
    data: { measurements, deterministic },
  });
  writeResultFile(jsonPath, result);
  console.log(`\nJSON: ${jsonPath}`);
}
