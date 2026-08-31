/**
 * `docs/TEST-PLAN.md`의 성능 기준선을 다시 측정한다.
 *
 * 실행: `pnpm bench` (먼저 `pnpm --filter @omdc-slipkit/core build` 필요)
 *
 * 측정 방법
 * - 각 작업마다 워밍업을 돌린 뒤 본 측정을 반복하고 **중앙값**을 적는다.
 *   중앙값을 쓰는 이유는 가비지 수집이나 다른 프로세스 때문에 드물게 튀는
 *   값이 평균을 끌어올리기 때문이다.
 * - 반복 횟수는 작업당 아래 CASES에 적어 둔다.
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

/** 워밍업 뒤 본 측정을 반복하고 중앙값(ms)을 돌려준다. */
async function median(runs, warmup, fn) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
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

/** [이름, 본 측정 반복, 워밍업 반복, 측정할 함수] */
const CASES = [
  ...[100, 1000, 5000, 20000].map((n) => {
    const page = { elements: [repeatGrid()] };
    const data = makeItems(n);
    return [`페이지 계획 — 항목 ${n}건`, 15, 5, () => planSourcePage(paper, page, new Map([['items', data]]))];
  }),
  [`parseSlipFile — ${(templateJson.length / 1024).toFixed(1)}KB`, 200, 50, () => parseSlipFile(templateJson)],
  ['parseFormula', 2000, 500, () => parseFormula('ROUND(SUM(items.amount) * 1.1, 0)')],
  ['evaluateFormula — 항목 1,000건 합계', 200, 50, () => evaluateFormula(formula, formulaContext)],
  ['암호화 — 암호 (PBKDF2 + AES-GCM)', 10, 3, () => encryptSlipFile(template, passphrase)],
  ['복호화 — 암호', 10, 3, () => decryptSlipFile(envelope, passphrase)],
  ['암호화 — 원시 키 (PBKDF2 없음)', 50, 10, () => encryptSlipFile(template, rawKey)],
];

const cpu = os.cpus()[0];
console.log(`Node ${process.version} · ${os.platform()}/${os.arch()} · ${os.cpus().length} core`);
console.log(`CPU: ${cpu ? cpu.model : '알 수 없음'} · 메모리 ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB`);
console.log('각 값은 워밍업 뒤 본 측정의 중앙값(ms)\n');
console.log('| 작업 | 반복 | 중앙값 |');
console.log('|---|---|---|');
for (const [name, runs, warmup, fn] of CASES) {
  const ms = await median(runs, warmup, fn);
  console.log(`| ${name} | ${runs}회 | ${ms.toFixed(1)}ms |`);
}
