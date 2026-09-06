#!/usr/bin/env node
/**
 * MCP `FileSystemStorage.list()`의 대규모 목록 조회 비용을 재현 가능하게 측정한다 —
 * 시간, 메모리 변화, 파일 접근 횟수와 목록 캐시 계측을 한 표에 모은다.
 *
 * 실행: `pnpm bench:mcp-list` — Core와 MCP를 먼저 빌드한 뒤 측정하므로 명령 하나로 재현된다.
 * 기준 커밋과 수정 커밋에서 같은 환경으로 실행해 표를 비교하는 용도다. 대형 fixture를 만들기
 * 때문에 검증 게이트(`pnpm verify`)와 CI에는 넣지 않는다.
 *
 * 옵션
 * - `--sizes 1000,10000` 평문·raw 키 시나리오의 파일 수 (기본 `1000,10000`)
 * - `--runs N`           본 측정 반복 수 (기본 5). 예열 1회는 따로 돈다
 * - `--json <path>`      전체 원자료를 저장할 파일. 생략하면 `os.tmpdir()` 아래에 만들고 마지막 줄에 경로를 적는다
 * - `--keep`             fixture 임시 디렉터리를 지우지 않는다 (기본은 `finally`에서 지운다)
 *
 * 측정 대상
 * - 빌드된 `packages/mcp/dist/index.js`의 `FileSystemStorage` 공개 API만 쓴다. 파일 경로로 직접
 *   import하므로 패키지 공개 export를 늘리지 않는다.
 * - 계측 값은 인스턴스에 붙은 전역 심볼 `Symbol.for('@omdc-slipkit/mcp.listMetrics')`에서 읽는다.
 *   심볼이 없는 빌드(캐시 도입 전)에서는 계측 열이 `-`로 나오고 시간·항목 수·커서는 그대로 측정된다.
 *
 * fixture (모두 `os.tmpdir()` 아래 임시 디렉터리)
 * - 파일 수는 `--sizes`가 정한다. 파일은 `shard-000/slip-00000.slip`처럼 하위 디렉터리로 나눈다.
 * - 본문 크기 두 가지 — 최소 유효 양식과 약 16 KiB 양식(더미 텍스트 요소로 채운 유효한 `.slip`).
 * - 색인의 5의 배수는 전표, 나머지는 양식이라 `kind` 필터가 약 80%를 고른다.
 *   색인이 10으로 나눠 3이 남으면 제목에 `alpha`를 붙여 `query` 필터가 약 10%를 고른다.
 * - 암호화: 32바이트 raw 키로 잠근 fixture를 각 규모에서 따로 만들고, 문자열 키는 비용이 커
 *   10개짜리 fixture 두 벌(현재 키로 잠근 것, `previousKeys`의 3번째 키로만 열리는 것)로 잰다.
 *
 * 단계 (한 번의 trial에서 순서대로 돈다. trial마다 fixture를 원래 상태로 되돌리고 인스턴스를 새로 만든다)
 * 1. `cold`   새 인스턴스의 첫 페이지 — 탐색·lstat·본문 읽기·파싱을 모두 새로 한다
 * 2. `warm`   같은 인스턴스에 같은 호출 — 캐시가 있으면 본문 읽기와 파싱이 사라진다
 * 3. `page2`  첫 페이지가 돌려준 커서로 다음 페이지 — 항목 수가 50 이하면 건너뛴다
 * 4. `kind`   `kind: 'template'` 필터 · `query` 검색어 `alpha` 필터
 * 5. `touch`  파일 하나를 저장소 밖에서 고쳐 쓴 뒤 — 바뀐 항목만 다시 읽는지 본다
 * 6. `churn`  파일 하나를 지우고 하나를 새로 만든 뒤 — 사라진 경로 정리와 새 항목 해석을 본다
 * 암호화 시나리오는 `cold`·`warm`만 돈다 (문자열 키 복호화가 파일마다 100ms 남짓 걸린다).
 *
 * 단계마다 남기는 값
 * - 시간 median·p95, `heapUsed`·RSS 변화 median
 * - 디렉터리 항목 수, `.slip` 후보 수, `lstat` 수와 동시 `lstat` 최대치
 * - 본문 read 수·바이트, 파싱 수, 복호화 시도 수(키마다 1)
 * - 캐시 hit·miss·제외 hit와 캐시에 남은 항목 수
 * - 반환 항목 수와 `nextCursor`
 *
 * 단계마다 결과를 검증한다 — 항목 수·커서가 기대와 다르거나, 외부 수정 뒤 제목이 그대로거나,
 * 삭제한 파일이 목록에 남아 있으면 오류로 멈춘다. 캐시가 낡은 값을 돌려주면 여기서 걸린다.
 *
 * 메모리 수치는 GC 시점에 흔들린다. `node --expose-gc scripts/bench-mcp-list.mjs`로 실행하면
 * 단계마다 GC를 돌려 더 안정적인 값을 얻는다.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { median, percentile, formatInt } from './bench-designer/metrics.mjs';
import {
  ADDED_ID,
  CHURN_INDEX,
  QUERY_MARK,
  TOUCH_INDEX,
  countEntries,
  createGenerator,
  expectedCounts,
  relPathOf,
  writeEncryptedFixture,
  writePlainFixture,
} from './bench-mcp-list/fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** 예열 반복 수 — 결과에 넣지 않는다 */
const WARMUP = 1;

/** 목록 한 페이지의 항목 수 (`FileSystemStorage`의 상수와 같다) */
const PAGE_SIZE = 50;

/** 문자열 키 시나리오의 파일 수 — 키 파생이 파일마다 100ms 남짓이라 작게 잡는다 */
const PASSPHRASE_COUNT = 10;

/** 약 16 KiB 양식의 목표 바이트 */
const LARGE_BYTES = 16 * 1024;

/** 인스턴스에서 목록 계측 값을 꺼내는 전역 심볼 */
const LIST_METRICS = Symbol.for('@omdc-slipkit/mcp.listMetrics');

/** 표와 JSON에 남기는 계측 항목 */
const METRIC_KEYS = [
  'directoryEntries',
  'candidates',
  'lstat',
  'maxConcurrentLstat',
  'bodyReads',
  'bodyBytes',
  'parses',
  'decryptAttempts',
  'cacheHits',
  'cacheMisses',
  'excludedHits',
  'cachedEntries',
];

/** 32바이트 raw 키 — 실행마다 같아야 결과를 비교할 수 있어 고정값을 쓴다 */
const RAW_KEY = Uint8Array.from({ length: 32 }, (_, index) => (index * 7 + 11) % 256);

/** 문자열 키 — 현재 키와 이전 키 세 개 */
const CURRENT_PASSPHRASE = 'bench-current-key';
const PREVIOUS_PASSPHRASES = ['bench-previous-1', 'bench-previous-2', 'bench-previous-3'];

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------

/**
 * `--name value` 인자를 읽는다.
 *
 * @param name - 인자 이름
 * @returns 값
 */
function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runs = Number.parseInt(arg('--runs') ?? '5', 10);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs 는 1 이상의 정수여야 한다');
const sizes = (arg('--sizes') ?? '1000,10000').split(',').map((value) => Number.parseInt(value.trim(), 10));
if (sizes.length === 0 || sizes.some((size) => !Number.isInteger(size) || size < 1)) {
  throw new Error('--sizes 는 쉼표로 구분한 1 이상의 정수여야 한다 (예: 1000,10000)');
}
const jsonPath =
  arg('--json') ??
  path.join(os.tmpdir(), `slipkit-bench-mcp-list-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const keep = process.argv.includes('--keep');

/**
 * 진행 상황은 stderr로, 표는 stdout으로 낸다.
 *
 * @param message - 진행 문구
 */
function progress(message) {
  process.stderr.write(`[bench:mcp-list] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 계측 읽기
// ---------------------------------------------------------------------------

/**
 * 인스턴스에 붙은 목록 계측 값을 꺼낸다.
 *
 * @param storage - `FileSystemStorage` 인스턴스
 * @returns 계측 객체. 계측이 없는 빌드면 null
 */
function metricsOf(storage) {
  const value = storage[LIST_METRICS];
  return value === undefined || value === null ? null : value;
}

/**
 * 계측 값을 숫자만 담은 객체로 복사한다.
 *
 * @param metrics - 계측 객체 또는 null
 * @returns 항목별 숫자. 계측이 없으면 null
 */
function snapshotMetrics(metrics) {
  if (metrics === null) return null;
  const out = {};
  for (const key of METRIC_KEYS) out[key] = typeof metrics[key] === 'number' ? metrics[key] : null;
  return out;
}

// ---------------------------------------------------------------------------
// 단계
// ---------------------------------------------------------------------------

/**
 * 항목 수와 offset으로 기대 `nextCursor`를 계산한다.
 *
 * @param total - 필터를 통과한 항목 수
 * @param offset - 현재 페이지의 시작 offset
 * @returns 커서 문자열 또는 null
 */
function cursorFor(total, offset) {
  return offset + PAGE_SIZE < total ? String(offset + PAGE_SIZE) : null;
}

/** 단계 정의 — 순서대로 한 trial 안에서 실행한다 */
const STAGE_DEFS = [
  {
    id: 'cold',
    label: 'cold 첫 페이지',
    note: '새 인스턴스 — 탐색·lstat·본문 읽기·파싱을 모두 새로 한다',
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
  },
  {
    id: 'warm',
    label: 'warm 같은 호출',
    note: '같은 인스턴스에 같은 호출 — 캐시가 있으면 본문 읽기와 파싱이 사라진다',
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
  },
  {
    id: 'page2',
    label: '다음 커서',
    note: 'cold가 돌려준 커서로 두 번째 페이지',
    skip: (scenario) => scenario.expected.total <= PAGE_SIZE,
    call: (trial) => trial.storage.list(undefined, trial.cursor),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total - PAGE_SIZE),
      cursor: cursorFor(scenario.expected.total, PAGE_SIZE),
    }),
  },
  {
    id: 'kind',
    label: 'kind 필터',
    note: "kind: 'template' — 약 80%가 통과한다",
    call: (trial) => trial.storage.list({ kind: 'template' }),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.templates),
      cursor: cursorFor(scenario.expected.templates, 0),
    }),
  },
  {
    id: 'query',
    label: 'query 필터',
    note: `검색어 ${QUERY_MARK} — 약 10%가 통과한다`,
    call: (trial) => trial.storage.list({ query: QUERY_MARK }),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.marked),
      cursor: cursorFor(scenario.expected.marked, 0),
    }),
  },
  {
    id: 'touch',
    label: '외부 수정 뒤',
    note: '파일 하나를 저장소 밖에서 고쳐 쓴 뒤 — 바뀐 항목만 다시 읽어야 한다',
    mutate: (trial) => {
      trial.marker = trial.scenario.mutations.touch();
    },
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
    check: (page, trial) => {
      const title = page.items[0]?.title ?? '';
      if (!title.endsWith(trial.marker)) {
        return `외부 수정이 반영되지 않았다 — 첫 항목 제목 "${title}"에 "${trial.marker}"가 없다`;
      }
      return null;
    },
  },
  {
    id: 'churn',
    label: '삭제·추가 뒤',
    note: '파일 하나를 지우고 하나를 새로 만든 뒤 — 사라진 경로를 정리해야 한다',
    mutate: (trial) => trial.scenario.mutations.churn(),
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
    check: (page) => {
      const removed = relPathOf(CHURN_INDEX);
      if (page.items.some((item) => item.id === removed)) {
        return `삭제한 파일이 목록에 남아 있다 — ${removed}`;
      }
      return null;
    },
  },
];

/** 단계 id → 정의 */
const STAGE_BY_ID = new Map(STAGE_DEFS.map((stage) => [stage.id, stage]));

/** 평문 시나리오가 도는 단계 */
const PLAIN_STAGES = STAGE_DEFS.map((stage) => stage.id);

/** 암호화 시나리오가 도는 단계 */
const ENCRYPTED_STAGES = ['cold', 'warm'];

// ---------------------------------------------------------------------------
// 측정
// ---------------------------------------------------------------------------

/**
 * 목록 호출 한 번을 재고 계측 값을 함께 남긴다.
 *
 * @param metrics - 계측 객체 또는 null
 * @param call - 목록을 부르는 함수
 * @returns 시간·메모리 변화·계측·결과 페이지
 */
async function measure(metrics, call) {
  metrics?.reset();
  globalThis.gc?.();
  const before = process.memoryUsage();
  const started = performance.now();
  const page = await call();
  const ms = performance.now() - started;
  const after = process.memoryUsage();
  return {
    ms,
    heapDelta: after.heapUsed - before.heapUsed,
    rssDelta: after.rss - before.rss,
    counters: snapshotMetrics(metrics),
    page,
  };
}

/**
 * 한 시나리오의 단계를 순서대로 한 번씩 돈다.
 *
 * @param scenario - 시나리오
 * @param FileSystemStorage - 빌드된 MCP의 저장소 클래스
 * @returns 단계 id → 표본
 * @throws Error 단계 결과가 기대와 다를 때
 */
async function runTrial(scenario, FileSystemStorage) {
  scenario.mutations.restore();
  const storage = new FileSystemStorage(scenario.storageOptions);
  const metrics = metricsOf(storage);
  const trial = { scenario, storage, cursor: undefined, marker: '' };
  const samples = {};
  for (const id of scenario.stages) {
    const stage = STAGE_BY_ID.get(id);
    if (stage.skip?.(scenario)) {
      samples[id] = null;
      continue;
    }
    stage.mutate?.(trial);
    const sample = await measure(metrics, () => stage.call(trial));
    const page = sample.page;
    const expected = stage.expect(scenario);
    const cursor = page.nextCursor ?? null;
    if (page.items.length !== expected.items || cursor !== expected.cursor) {
      throw new Error(
        `${scenario.id}/${id}: 항목 ${page.items.length}개·커서 ${cursor}가 기대(${expected.items}개·커서 ${expected.cursor})와 다르다`,
      );
    }
    const problem = stage.check?.(page, trial);
    if (problem !== null && problem !== undefined) throw new Error(`${scenario.id}/${id}: ${problem}`);
    if (id === 'cold') trial.cursor = page.nextCursor;
    samples[id] = {
      ms: sample.ms,
      heapDelta: sample.heapDelta,
      rssDelta: sample.rssDelta,
      counters: sample.counters,
      items: page.items.length,
      nextCursor: cursor,
      firstId: page.items[0]?.id ?? null,
      firstTitle: page.items[0]?.title ?? null,
    };
  }
  return { samples, metricsAvailable: metrics !== null };
}

/**
 * 여러 trial의 단계 표본을 요약한다.
 *
 * @param samples - 같은 단계의 표본 배열 (예열 제외)
 * @returns 시간 median·p95, 메모리 변화 median, 계측 median, 항목 수와 커서
 */
function summarizeStage(samples) {
  if (samples.length === 0 || samples[0] === null) return null;
  const ms = samples.map((sample) => sample.ms);
  const counters = {};
  for (const key of METRIC_KEYS) {
    const values = samples.map((sample) => sample.counters?.[key]).filter((value) => typeof value === 'number');
    counters[key] = values.length === samples.length ? median(values) : null;
  }
  return {
    msMedian: median(ms),
    msP95: percentile(ms, 95),
    heapDelta: median(samples.map((sample) => sample.heapDelta)),
    rssDelta: median(samples.map((sample) => sample.rssDelta)),
    items: median(samples.map((sample) => sample.items)),
    nextCursor: samples[0].nextCursor,
    counters,
  };
}

// ---------------------------------------------------------------------------
// 시나리오
// ---------------------------------------------------------------------------

/**
 * 파일 바이트 배열을 요약한다.
 *
 * @param bytes - 파일별 바이트
 * @returns 최소·중앙·최대·합계
 */
function summarizeBytes(bytes) {
  return {
    min: Math.min(...bytes),
    median: median(bytes),
    max: Math.max(...bytes),
    total: bytes.reduce((sum, value) => sum + value, 0),
  };
}

/**
 * 평문 fixture를 만들고 시나리오를 구성한다.
 *
 * @param options - 작업 디렉터리, 시나리오 id·설명, 파일 수, 목표 바이트, core 모듈
 * @returns 시나리오
 */
function makePlainScenario({ work, id, label, count, targetBytes, core }) {
  const dir = path.join(work, id);
  const generator = createGenerator({
    serializeSlipFile: core.serializeSlipFile,
    schemaVersion: core.CURRENT_SCHEMA_VERSION,
    targetBytes,
  });
  const bytes = writePlainFixture({ dir, count, generator });
  const touchAbs = path.join(dir, relPathOf(TOUCH_INDEX));
  const churnAbs = path.join(dir, relPathOf(CHURN_INDEX));
  const addedAbs = path.join(dir, ADDED_ID);
  let revision = 0;
  return {
    id,
    label,
    dir,
    count,
    bodyLabel: targetBytes === null ? '최소 양식' : `약 ${formatInt(targetBytes / 1024)} KiB 양식`,
    encryptionLabel: '없음',
    storageOptions: { rootDir: dir },
    stages: PLAIN_STAGES,
    expected: expectedCounts(count),
    fixture: { count, entries: countEntries(dir), bytes: summarizeBytes(bytes) },
    mutations: {
      restore() {
        revision = 0;
        writeFileSync(touchAbs, generator.textFor(TOUCH_INDEX, 0), 'utf8');
        writeFileSync(churnAbs, generator.textFor(CHURN_INDEX, undefined), 'utf8');
        rmSync(addedAbs, { force: true });
      },
      touch() {
        revision += 1;
        writeFileSync(touchAbs, generator.textFor(TOUCH_INDEX, revision), 'utf8');
        return `r${String(revision % 100).padStart(2, '0')}`;
      },
      churn() {
        rmSync(churnAbs, { force: true });
        writeFileSync(addedAbs, generator.addedText(), 'utf8');
      },
    },
  };
}

/**
 * 암호화 fixture를 만들고 시나리오를 구성한다. 단계는 `cold`·`warm`만 돈다.
 *
 * @param options - 작업 디렉터리, 시나리오 id·설명, 파일 수, 잠글 키, 저장소 암호화 설정, core 모듈
 * @returns 시나리오
 */
async function makeEncryptedScenario({ work, id, label, encryptionLabel, count, lockKey, encryption, core }) {
  const dir = path.join(work, id);
  const generator = createGenerator({
    serializeSlipFile: core.serializeSlipFile,
    schemaVersion: core.CURRENT_SCHEMA_VERSION,
    targetBytes: null,
  });
  const bytes = await writeEncryptedFixture({
    dir,
    count,
    generator,
    encryptSlipFile: core.encryptSlipFile,
    key: lockKey,
  });
  return {
    id,
    label,
    dir,
    count,
    bodyLabel: '최소 양식',
    encryptionLabel,
    storageOptions: { rootDir: dir, encryption },
    stages: ENCRYPTED_STAGES,
    expected: expectedCounts(count),
    fixture: { count, entries: countEntries(dir), bytes: summarizeBytes(bytes) },
    mutations: { restore() {}, touch: () => '', churn() {} },
  };
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

/**
 * 밀리초를 소수 둘째 자리까지 적는다.
 *
 * @param value - 밀리초
 * @returns 문자열
 */
function ms(value) {
  return typeof value === 'number' ? value.toFixed(2) : '-';
}

/**
 * 바이트 변화량을 부호와 함께 적는다.
 *
 * @param value - 바이트
 * @returns 문자열
 */
function signed(value) {
  if (typeof value !== 'number') return '-';
  return `${value < 0 ? '-' : '+'}${formatInt(Math.abs(value))}`;
}

/**
 * 계측 값을 표 칸에 적는다. 계측이 없는 빌드면 `-`.
 *
 * @param value - 계측 값 또는 null
 * @returns 문자열
 */
function counter(value) {
  return typeof value === 'number' ? formatInt(value) : '-';
}

/**
 * fixture 표를 출력한다.
 *
 * @param scenarios - 시나리오 배열
 */
function printFixtures(scenarios) {
  const out = ['## fixture', ''];
  out.push('| 시나리오 | 파일 수 | 본문 | 암호화 | 디렉터리 항목 | 파일 바이트 min / median / max | 전체 바이트 | 양식 | 전표 | query 일치 |');
  out.push('|---|---:|---|---|---:|---:|---:|---:|---:|---:|');
  for (const scenario of scenarios) {
    const { bytes } = scenario.fixture;
    const counts = scenario.expected;
    out.push(
      `| ${scenario.id} | ${formatInt(scenario.count)} | ${scenario.bodyLabel} | ${scenario.encryptionLabel} | ` +
        `${formatInt(scenario.fixture.entries)} | ${formatInt(bytes.min)} / ${formatInt(bytes.median)} / ${formatInt(bytes.max)} | ` +
        `${formatInt(bytes.total)} | ${formatInt(counts.templates)} | ${formatInt(counts.total - counts.templates)} | ${formatInt(counts.marked)} |`,
    );
  }
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

/**
 * 시나리오 하나의 단계 표를 출력한다.
 *
 * @param scenario - 시나리오
 * @param summary - 단계 id → 요약
 */
function printScenario(scenario, summary) {
  const out = [`### ${scenario.id} — ${scenario.label}`, ''];
  out.push(
    '| 단계 | ms median | ms p95 | heapUsed Δ | RSS Δ | 디렉터리 항목 | 후보 | lstat | 동시 lstat 최대 | 본문 read | read 바이트 | parse | 복호화 시도 | 캐시 hit | miss | 제외 hit | 캐시 항목 | 항목 수 | nextCursor |',
  );
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const id of scenario.stages) {
    const stage = STAGE_BY_ID.get(id);
    const row = summary[id];
    if (row === null || row === undefined) {
      out.push(`| ${stage.label} | (건너뜀) | | | | | | | | | | | | | | | | | |`);
      continue;
    }
    const c = row.counters;
    out.push(
      `| ${stage.label} | ${ms(row.msMedian)} | ${ms(row.msP95)} | ${signed(row.heapDelta)} | ${signed(row.rssDelta)} | ` +
        `${counter(c.directoryEntries)} | ${counter(c.candidates)} | ${counter(c.lstat)} | ${counter(c.maxConcurrentLstat)} | ` +
        `${counter(c.bodyReads)} | ${counter(c.bodyBytes)} | ${counter(c.parses)} | ${counter(c.decryptAttempts)} | ` +
        `${counter(c.cacheHits)} | ${counter(c.cacheMisses)} | ${counter(c.excludedHits)} | ${counter(c.cachedEntries)} | ` +
        `${formatInt(row.items)} | ${row.nextCursor ?? '-'} |`,
    );
  }
  out.push('');
  for (const id of scenario.stages) {
    const stage = STAGE_BY_ID.get(id);
    out.push(`- ${stage.label}: ${stage.note}`);
  }
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// 본문
// ---------------------------------------------------------------------------

/**
 * 빌드된 dist 모듈을 읽는다.
 *
 * @param relative - 리포 기준 상대 경로
 * @returns 모듈
 * @throws Error 빌드 산출물이 없을 때
 */
async function loadDist(relative) {
  const abs = path.join(root, relative);
  if (!existsSync(abs)) {
    throw new Error(`빌드 산출물이 없다: ${relative} — 먼저 \`pnpm bench:mcp-list\`로 실행한다`);
  }
  return import(pathToFileURL(abs).href);
}

async function main() {
  const core = await loadDist('packages/core/dist/index.js');
  const { FileSystemStorage } = await loadDist('packages/mcp/dist/index.js');

  const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'slipkit-bench-mcp-list-')));
  const env = {
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryBytes: os.totalmem(),
    platform: `${os.platform()} ${os.release()}`,
    runs,
    warmup: WARMUP,
    sizes,
    gcExposed: typeof globalThis.gc === 'function',
  };
  const result = { env, workDir: work, scenarios: [] };

  try {
    const scenarios = [];
    for (const size of sizes) {
      progress(`fixture 만드는 중 — 평문 ${formatInt(size)}개 (최소 양식)`);
      scenarios.push(
        makePlainScenario({
          work,
          id: `plain-${size}-min`,
          label: `평문 ${formatInt(size)}개 · 최소 유효 양식`,
          count: size,
          targetBytes: null,
          core,
        }),
      );
      progress(`fixture 만드는 중 — 평문 ${formatInt(size)}개 (약 16 KiB 양식)`);
      scenarios.push(
        makePlainScenario({
          work,
          id: `plain-${size}-16k`,
          label: `평문 ${formatInt(size)}개 · 약 16 KiB 양식`,
          count: size,
          targetBytes: LARGE_BYTES,
          core,
        }),
      );
      progress(`fixture 만드는 중 — raw 키 암호화 ${formatInt(size)}개`);
      scenarios.push(
        await makeEncryptedScenario({
          work,
          id: `raw-${size}`,
          label: `32바이트 raw 키 암호화 ${formatInt(size)}개 · 최소 유효 양식`,
          encryptionLabel: 'raw 32B (현재 키)',
          count: size,
          lockKey: RAW_KEY,
          encryption: { key: RAW_KEY },
          core,
        }),
      );
    }

    const passphraseEncryption = {
      key: CURRENT_PASSPHRASE,
      previousKeys: [...PREVIOUS_PASSPHRASES],
    };
    progress(`fixture 만드는 중 — 문자열 키(현재) ${PASSPHRASE_COUNT}개`);
    scenarios.push(
      await makeEncryptedScenario({
        work,
        id: 'passphrase-current',
        label: `문자열 현재 키로 잠근 ${PASSPHRASE_COUNT}개 — 파일마다 키 파생 1회`,
        encryptionLabel: '문자열 키 (현재)',
        count: PASSPHRASE_COUNT,
        lockKey: CURRENT_PASSPHRASE,
        encryption: passphraseEncryption,
        core,
      }),
    );
    progress(`fixture 만드는 중 — 문자열 키(previousKeys 3번째) ${PASSPHRASE_COUNT}개`);
    scenarios.push(
      await makeEncryptedScenario({
        work,
        id: 'passphrase-previous3',
        label: `previousKeys 3번째 키로만 열리는 ${PASSPHRASE_COUNT}개 — 파일마다 키 파생 4회`,
        encryptionLabel: '문자열 키 (previousKeys 3번째)',
        count: PASSPHRASE_COUNT,
        lockKey: PREVIOUS_PASSPHRASES[2],
        encryption: passphraseEncryption,
        core,
      }),
    );

    let metricsAvailable = false;
    for (const scenario of scenarios) {
      const trials = [];
      for (let i = 0; i < WARMUP + runs; i += 1) {
        progress(`${scenario.id} ${i < WARMUP ? '예열' : `${i - WARMUP + 1}/${runs}`}`);
        const trial = await runTrial(scenario, FileSystemStorage);
        metricsAvailable = metricsAvailable || trial.metricsAvailable;
        if (i >= WARMUP) trials.push(trial.samples);
      }
      const summary = {};
      for (const id of scenario.stages) {
        summary[id] = summarizeStage(trials.map((samples) => samples[id]));
      }
      scenario.summary = summary;
      result.scenarios.push({
        id: scenario.id,
        label: scenario.label,
        count: scenario.count,
        bodyLabel: scenario.bodyLabel,
        encryptionLabel: scenario.encryptionLabel,
        stages: scenario.stages,
        expected: scenario.expected,
        fixture: scenario.fixture,
        trials,
        summary,
      });
    }
    env.metricsAvailable = metricsAvailable;

    process.stdout.write(
      `실행 환경: Node ${env.node} · ${env.cpu} × ${env.cores} · 메모리 ${formatInt(env.memoryBytes / 1024 / 1024)} MB · ${env.platform} · ` +
        `예열 ${WARMUP}회 + 본 측정 ${runs}회 · fixture 규모 ${sizes.map((size) => formatInt(size)).join('·')}개(문자열 키는 ${PASSPHRASE_COUNT}개) · ` +
        `목록 계측 심볼 ${metricsAvailable ? '있음' : '없음 (계측 열은 -)'} · GC 노출 ${env.gcExposed ? '있음' : '없음'}\n\n`,
    );
    printFixtures(scenarios);
    process.stdout.write('## 단계별 측정\n\n');
    for (const scenario of scenarios) printScenario(scenario, scenario.summary);
    writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    process.stdout.write(`JSON: ${jsonPath}\n`);
  } finally {
    if (keep) process.stdout.write(`fixture 임시 디렉터리 보존: ${work}\n`);
    else rmSync(work, { recursive: true, force: true });
  }
}

await main();
