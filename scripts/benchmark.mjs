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
 *   (`batch`). 그러면 `await`와 시계 읽기의 비중이 줄고, 호출당 시간을
 *   유효 자릿수까지 볼 수 있다.
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

/**
 * 워밍업 뒤 본 측정을 반복하고 중앙값(ms)을 돌려준다.
 * 한 측정은 `batch`번의 호출을 묶어 잰다.
 */
async function median(runs, warmup, batch, fn) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < batch; k++) await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
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
const formula = parseFormula('ROUND(SUM(items.amount) * 1.1, 0)');
const formulaContext = { values: { items: makeItems(1000) } };
const rawKey = new Uint8Array(32).fill(7);
const passphrase = 'correct-horse-battery-staple';
const envelope = await encryptSlipFile(template, passphrase);

/** [이름, 본 측정 반복, 워밍업 반복, 한 측정당 호출 수, 측정할 함수] */
const CASES = [
  // 페이지 계획은 한 번이 충분히 길어 호출을 묶지 않는다.
  ...[100, 1000, 5000, 20000].map((n) => {
    const page = { elements: [repeatGrid()] };
    const data = makeItems(n);
    return [`페이지 계획 — 항목 ${n}건`, 15, 5, 1, () => planSourcePage(paper, page, new Map([['items', data]]))];
  }),
  [`parseSlipFile — ${(templateJson.length / 1024).toFixed(1)}KB`, 15, 5, 500, () => parseSlipFile(templateJson)],
  ['parseFormula', 15, 5, 10_000, () => parseFormula('ROUND(SUM(items.amount) * 1.1, 0)')],
  ['evaluateFormula — 항목 1,000건 합계', 15, 5, 1000, () => evaluateFormula(formula, formulaContext)],
  // 키 파생은 의도적으로 느리므로 한 번씩 잰다.
  ['암호화 — 암호 (PBKDF2 + AES-GCM)', 10, 3, 1, () => encryptSlipFile(template, passphrase)],
  ['복호화 — 암호', 10, 3, 1, () => decryptSlipFile(envelope, passphrase)],
  ['암호화 — 원시 키 (PBKDF2 없음)', 15, 5, 50, () => encryptSlipFile(template, rawKey)],
];

const cpu = os.cpus()[0];
console.log(`Node ${process.version} · ${os.platform()}/${os.arch()} · ${os.cpus().length} core`);
console.log(`CPU: ${cpu ? cpu.model : '알 수 없음'} · 메모리 ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB`);
console.log('각 값은 워밍업 뒤 본 측정의 중앙값\n');
console.log('| 작업 | 측정 | 한 측정 | 호출당 | 초당 호출 |');
console.log('|---|---|---|---|---|');
for (const [name, runs, warmup, batch, fn] of CASES) {
  const ms = await median(runs, warmup, batch, fn);
  const each = ms / batch;
  const ops = each > 0 ? Math.round(1000 / each).toLocaleString('en-US') : '—';
  const shape = batch === 1 ? `${runs}회` : `${runs}회 × ${batch.toLocaleString('en-US')}호출`;
  console.log(`| ${name} | ${shape} | ${ms.toFixed(1)}ms | ${perCall(each)} | ${ops} |`);
}
