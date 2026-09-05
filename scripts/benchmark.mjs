/**
 * `docs/TEST-PLAN.md`의 성능 기준선을 다시 측정한다.
 *
 * 실행: `pnpm bench` — Core를 먼저 빌드한 뒤 측정하므로 명령 하나로 재현된다.
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
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import {
  planSourcePage,
  parseSlipFile,
  serializeSlipFile,
  parseFormula,
  evaluateFormula,
  encryptSlipFile,
  decryptSlipFile,
} from '../packages/core/dist/index.js';

/** 측정한 시간들의 중앙값(ms)을 돌려준다. */
function middle(times) {
  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
}

/**
 * 동기 함수를 워밍업한 뒤 `batch`번씩 묶어 `runs`번 재고 중앙값(ms)을 돌려준다.
 * 측정 구간에 `await`를 두지 않아 Promise 비용이 섞이지 않는다.
 */
function medianSync(runs, warmup, batch, fn) {
  for (let i = 0; i < warmup; i++) for (let k = 0; k < batch; k++) fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < batch; k++) fn();
    times.push(performance.now() - start);
  }
  return middle(times);
}

/** 비동기 함수용. 호출마다 결과를 기다린 뒤 다음 호출로 넘어간다. */
async function medianAsync(runs, warmup, batch, fn) {
  for (let i = 0; i < warmup; i++) for (let k = 0; k < batch; k++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < batch; k++) await fn();
    times.push(performance.now() - start);
  }
  return middle(times);
}

/** 호출당 시간을 유효 자릿수가 남게 적는다. */
function perCall(ms) {
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(1)}\u00b5s`;
  return `${(ms * 1_000_000).toFixed(0)}ns`;
}

const paper = { width: 210, height: 297, padding: [20, 15, 20, 15] };

/** 머리·항목·꼬리 세 구간을 가진 반복 그리드. */
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

/** 항목 n건. 값은 측정마다 같도록 색인에서 만든다. */
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
    id: 'bench',
    meta: { title: '벤치마크', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    assets: [],
    paper: { size: 'A4', orientation: 'portrait', width: 210, height: 297, padding: [20, 15, 20, 15] },
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

/**
 * [이름, 본 측정 반복, 워밍업 반복, 한 측정당 호출 수, 측정할 함수, 비동기 여부]
 * 마지막 값이 `true`인 항목만 측정 구간에서 `await`한다.
 */
const CASES = [
  // 페이지 계획은 한 번이 충분히 길어 호출을 묶지 않는다.
  ...[100, 1000, 5000, 20000].map((n) => {
    const page = { elements: [repeatGrid()] };
    const data = makeItems(n);
    return [`페이지 계획 — 항목 ${n}건`, 15, 5, 1, () => planSourcePage(paper, page, new Map([['items', data]])), false];
  }),
  [`parseSlipFile — ${(templateJson.length / 1024).toFixed(1)}KB`, 15, 5, 500, () => parseSlipFile(templateJson), false],
  ['parseFormula', 15, 5, 10_000, () => parseFormula('ROUND(SUM($(items).$(amount)) * 1.1, 0)'), false],
  ['evaluateFormula — 항목 1,000건 합계', 15, 5, 1000, () => evaluateFormula(formula, formulaContext), false],
  // 키 파생은 의도적으로 느리므로 한 번씩 잰다.
  ['암호화 — 암호 (PBKDF2 + AES-GCM)', 10, 3, 1, () => encryptSlipFile(template, passphrase), true],
  ['복호화 — 암호', 10, 3, 1, () => decryptSlipFile(envelope, passphrase), true],
  ['암호화 — 원시 키 (PBKDF2 없음)', 15, 5, 50, () => encryptSlipFile(template, rawKey), true],
];

const cpu = os.cpus()[0];
console.log(`Node ${process.version} · ${os.platform()}/${os.arch()} · ${os.cpus().length} core`);
console.log(`CPU: ${cpu ? cpu.model : '알 수 없음'} · 메모리 ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB`);
console.log('각 값은 워밍업 뒤 본 측정의 중앙값\n');
console.log('| 작업 | 측정 | 한 측정 | 호출당 | 초당 호출 |');
console.log('|---|---|---|---|---|');
for (const [name, runs, warmup, batch, fn, isAsync] of CASES) {
  const ms = isAsync ? await medianAsync(runs, warmup, batch, fn) : medianSync(runs, warmup, batch, fn);
  const each = ms / batch;
  const ops = each > 0 ? Math.round(1000 / each).toLocaleString('en-US') : '—';
  const shape = batch === 1 ? `${runs}회` : `${runs}회 × ${batch.toLocaleString('en-US')}호출`;
  console.log(`| ${name} | ${shape} | ${ms.toFixed(1)}ms | ${perCall(each)} | ${ops} |`);
}
