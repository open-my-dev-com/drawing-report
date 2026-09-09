#!/usr/bin/env node
/**
 * MCP `FileSystemStorage.list()`의 대규모 목록 조회 비용을 재현할 수 있도록 측정합니다.
 * 시간, 메모리 변화, 파일 접근 횟수와 목록 캐시 측정값을 한 표에 모읍니다.
 *
 * `pnpm bench:mcp-list`를 실행하면 Core와 MCP를 먼저 빌드한 뒤 측정하므로 명령 하나로 재현할 수 있습니다.
 * 기준 커밋과 수정 커밋에서 같은 환경으로 실행해 표를 비교하는 용도입니다. 대규모 시험 데이터를
 * 만들기 때문에 검증 게이트(`pnpm verify`)와 CI에는 넣지 않습니다.
 *
 * 옵션
 * - `--sizes 1000,10000` 평문·원시 키 시나리오의 파일 수입니다(기본 `1000,10000`).
 * - `--runs N`           실제 측정 반복 수입니다(기본 5회). 예열 1회는 따로 실행합니다.
 * - `--json <path>`      전체 원본 데이터를 보존할 파일입니다. 형식 버전이 있는 공통 구조(`schema`·`tool`·`environment`·
 *                        `metrics`)에 담습니다. 생략하면 시험 데이터와 함께 임시로 만들고 정리합니다.
 * - `--keep`             시험 데이터와 기본 JSON 원본 데이터를 지우지 않습니다. 기본값은 `finally`에서 정리합니다.
 *
 * 측정 대상
 * - 빌드된 `packages/mcp/dist/index.js`의 `FileSystemStorage` 공개 API만 사용합니다. 파일 경로로 직접
 *   가져오므로 패키지의 공개 export를 늘리지 않습니다.
 * - 측정값은 인스턴스에 붙은 전역 심볼 `Symbol.for('@omdc-slipkit/mcp.listMetrics')`에서 읽습니다.
 *   심볼이 없는 빌드에서는 측정값 열이 `-`로 나오고 시간·항목 수·커서는 그대로 측정됩니다.
 *
 * 시험 데이터는 모두 `os.tmpdir()` 아래의 임시 디렉터리에 만듭니다.
 * - 파일 수는 `--sizes`로 정합니다. 파일은 `shard-000/slip-00000.slip`처럼 하위 디렉터리로 나눕니다.
 * - 본문 크기 두 가지 — 최소 유효 양식과 약 16 KiB 양식(더미 텍스트 요소로 채운 유효한 `.slip`).
 * - 색인이 5의 배수인 파일은 전표이고 나머지는 양식이므로 `kind` 필터는 약 80%를 선택합니다.
 *   색인을 10으로 나눈 나머지가 3이면 제목에 `alpha`를 붙여 `query` 필터가 약 10%를 선택합니다.
 * - 32바이트 원시 키로 암호화한 시험 데이터는 각 규모에서 따로 만듭니다. 문자열 키는 처리 비용이 커서
 *   파일 10개짜리 시험 데이터 두 종류를 사용합니다. 하나는 현재 키로, 다른 하나는 세 번째 이전 키로만 열립니다.
 *
 * 한 번 측정할 때 다음 단계를 순서대로 실행합니다. 매번 시험 데이터를 원래 상태로 되돌리고 인스턴스를 새로 만듭니다.
 * 1. `cold`   새 인스턴스의 첫 페이지에서 탐색·lstat·본문 읽기·파싱을 모두 새로 수행합니다.
 * 2. `warm`   같은 인스턴스에 같은 요청을 보내 캐시가 본문 읽기와 파싱을 없애는지 확인합니다.
 * 3. `page2`  첫 페이지가 반환한 커서로 다음 페이지를 읽습니다. 항목 수가 50개 이하면 건너뜁니다.
 * 4. `kind`   `kind: 'template'` 필터 · `query` 검색어 `alpha` 필터
 * 5. `touch`  파일 하나를 저장소 밖에서 수정한 뒤 바뀐 항목만 다시 읽는지 확인합니다.
 * 6. `churn`  파일 하나를 지우고 새로 만든 뒤 사라진 경로 정리와 새 항목 해석을 확인합니다.
 * 암호화 시나리오는 `cold`와 `warm`만 실행합니다. 문자열 키 복호화에는 파일마다 약 100ms가 걸립니다.
 *
 * 단계마다 남기는 값
 * - 시간 중앙값·p95, `heapUsed`·RSS 변화 중앙값
 * - 디렉터리 항목 수, `.slip` 후보 수, `lstat` 수와 동시 `lstat` 최대치
 * - 본문 read 수·바이트, 파싱 수, 복호화 시도 수(키마다 1)
 * - 캐시 hit·miss·제외 hit와 캐시에 남은 항목 수
 * - 반환 항목 수와 `nextCursor`
 *
 * 단계마다 결과를 검증합니다. 항목 수나 커서가 예상과 다르거나, 외부 수정 뒤 제목이 바뀌지 않거나,
 * 삭제한 파일이 목록에 남아 있으면 오류로 중단합니다. 캐시가 이전 값을 반환하는 문제도 여기서 확인합니다.
 *
 * 메모리 수치는 GC 시점에 따라 달라집니다. `node --expose-gc scripts/bench-mcp-list.mjs`로 실행하면
 * 단계마다 GC를 실행해 더 안정적인 값을 얻을 수 있습니다.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasFlag, readArg, readPositiveInt, readPositiveIntList } from './bench-shared/args.mjs';
import { MCP_LIST_DEFAULT_RUNS, MCP_LIST_DEFAULT_SIZES } from './bench-shared/defaults.mjs';
import { collectEnvironment } from './bench-shared/env.mjs';
import { median, percentile, formatInt } from './bench-shared/stats.mjs';
import { createResult, metric, writeResultFile } from './bench-shared/result.mjs';
import { createWorkDir, disposeWorkDir } from './bench-shared/workdir.mjs';
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

/** 예열 반복 수입니다. 결과에는 포함하지 않습니다. */
const WARMUP = 1;

/** 목록 한 페이지의 항목 수입니다. `FileSystemStorage`의 상수와 같습니다. */
const PAGE_SIZE = 50;

/** 문자열 키 시나리오의 파일 수입니다. 키 파생에 파일마다 약 100ms가 걸리므로 작게 설정합니다. */
const PASSPHRASE_COUNT = 10;

/** 약 16KiB 양식의 목표 바이트 수입니다. */
const LARGE_BYTES = 16 * 1024;

/** 인스턴스에서 목록 측정값을 읽는 전역 심볼입니다. */
const LIST_METRICS = Symbol.for('@omdc-slipkit/mcp.listMetrics');

/** 표와 JSON에 기록하는 측정 항목입니다. */
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

/** 실행 결과를 비교할 수 있도록 고정한 32바이트 원시 키입니다. */
const RAW_KEY = Uint8Array.from({ length: 32 }, (_, index) => (index * 7 + 11) % 256);

/** 현재 문자열 키와 이전 문자열 키 세 개입니다. */
const CURRENT_PASSPHRASE = 'bench-current-key';
const PREVIOUS_PASSPHRASES = ['bench-previous-1', 'bench-previous-2', 'bench-previous-3'];

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const runs = readPositiveInt(argv, '--runs', MCP_LIST_DEFAULT_RUNS);
const sizes = readPositiveIntList(argv, '--sizes', [...MCP_LIST_DEFAULT_SIZES]);
const requestedJsonPath = readArg(argv, '--json');
const keep = hasFlag(argv, '--keep');

/**
 * 진행 상황은 stderr로, 표는 stdout으로 출력합니다.
 *
 * @param message - 진행 문구입니다.
 */
function progress(message) {
  process.stderr.write(`[bench:mcp-list] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 측정 읽기
// ---------------------------------------------------------------------------

/**
 * 인스턴스에 붙은 목록 측정값을 읽습니다.
 *
 * @param storage - `FileSystemStorage` 인스턴스입니다.
 * @returns 측정값 객체를 반환합니다. 측정 기능이 없는 빌드이면 `null`을 반환합니다.
 */
function metricsOf(storage) {
  const value = storage[LIST_METRICS];
  return value === undefined || value === null ? null : value;
}

/**
 * 측정값을 숫자만 담은 객체로 복사합니다.
 *
 * @param metrics - 측정값 객체 또는 `null`입니다.
 * @returns 항목별 숫자를 반환합니다. 측정값이 없으면 `null`을 반환합니다.
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
 * 항목 수와 offset으로 예상 `nextCursor`를 계산합니다.
 *
 * @param total - 필터를 통과한 항목 수입니다.
 * @param offset - 현재 페이지의 시작 offset입니다.
 * @returns 커서 문자열 또는 `null`을 반환합니다.
 */
function cursorFor(total, offset) {
  return offset + PAGE_SIZE < total ? String(offset + PAGE_SIZE) : null;
}

/** 한 번의 측정에서 순서대로 실행할 단계를 정의합니다. */
const STAGE_DEFS = [
  {
    id: 'cold',
    label: 'cold 첫 페이지',
    note: '새 인스턴스에서 탐색, lstat, 본문 읽기와 파싱을 모두 새로 수행합니다.',
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
  },
  {
    id: 'warm',
    label: 'warm 같은 호출',
    note: '같은 인스턴스에서 같은 요청을 반복하면 캐시를 사용해 본문 읽기와 파싱을 생략합니다.',
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
  },
  {
    id: 'page2',
    label: '다음 커서',
    note: 'cold 단계가 반환한 커서로 두 번째 페이지를 조회합니다.',
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
    note: "kind: 'template' 필터를 적용하면 약 80%가 통과합니다.",
    call: (trial) => trial.storage.list({ kind: 'template' }),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.templates),
      cursor: cursorFor(scenario.expected.templates, 0),
    }),
  },
  {
    id: 'query',
    label: 'query 필터',
    note: `검색어 ${QUERY_MARK}를 적용하면 약 10%가 통과합니다.`,
    call: (trial) => trial.storage.list({ query: QUERY_MARK }),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.marked),
      cursor: cursorFor(scenario.expected.marked, 0),
    }),
  },
  {
    id: 'touch',
    label: '외부 수정 뒤',
    note: '파일 하나를 저장소 밖에서 고친 뒤에는 바뀐 항목만 다시 읽어야 합니다.',
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
        return `외부 수정이 반영되지 않았습니다. 첫 항목 제목 "${title}"에 "${trial.marker}"가 없습니다.`;
      }
      return null;
    },
  },
  {
    id: 'churn',
    label: '삭제·추가 뒤',
    note: '파일 하나를 지우고 새로 만든 뒤에는 사라진 경로를 정리해야 합니다.',
    mutate: (trial) => trial.scenario.mutations.churn(),
    call: (trial) => trial.storage.list(),
    expect: (scenario) => ({
      items: Math.min(PAGE_SIZE, scenario.expected.total),
      cursor: cursorFor(scenario.expected.total, 0),
    }),
    check: (page) => {
      const removed = relPathOf(CHURN_INDEX);
      if (page.items.some((item) => item.id === removed)) {
        return `삭제한 파일이 목록에 남아 있습니다: ${removed}`;
      }
      const added = path.normalize(ADDED_ID);
      if (!page.items.some((item) => item.id === added)) {
        return `새로 만든 파일이 목록에 없습니다: ${added}`;
      }
      return null;
    },
  },
];

/** 단계 ID와 정의를 연결합니다. */
const STAGE_BY_ID = new Map(STAGE_DEFS.map((stage) => [stage.id, stage]));

/** 평문 시나리오에서 실행할 단계입니다. */
const PLAIN_STAGES = STAGE_DEFS.map((stage) => stage.id);

/** 암호화 시나리오에서 실행할 단계입니다. */
const ENCRYPTED_STAGES = ['cold', 'warm'];

// ---------------------------------------------------------------------------
// 측정
// ---------------------------------------------------------------------------

/**
 * 목록 호출 한 번의 시간과 측정값을 함께 기록합니다.
 *
 * @param metrics - 측정값 객체 또는 `null`입니다.
 * @param call - 목록을 조회하는 함수입니다.
 * @returns 시간, 메모리 변화, 측정값과 결과 페이지를 반환합니다.
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
 * 한 시나리오의 단계를 순서대로 한 번씩 실행합니다.
 *
 * @param scenario - 실행할 시나리오입니다.
 * @param FileSystemStorage - 빌드된 MCP의 저장소 클래스입니다.
 * @returns 단계 ID별 표본을 반환합니다.
 * @throws 단계 결과가 예상과 다르면 {@link Error}가 발생합니다.
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
 * 여러 번 측정한 단계별 표본을 요약합니다.
 *
 * @param samples - 예열을 제외한 같은 단계의 표본 배열입니다.
 * @returns 시간 중앙값·p95, 메모리 변화 중앙값, 측정값 중앙값, 항목 수와 커서를 반환합니다.
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
 * 파일별 바이트 수를 요약합니다.
 *
 * @param bytes - 파일별 바이트 수입니다.
 * @returns 최솟값, 중앙값, 최댓값과 합계를 반환합니다.
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
 * 평문 시험 데이터를 만들고 시나리오를 구성합니다.
 *
 * @param options - 작업 디렉터리, 시나리오 ID와 설명, 파일 수, 목표 바이트 수와 core 모듈입니다.
 * @returns 구성한 시나리오를 반환합니다.
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
 * 암호화 시험 데이터를 만들고 시나리오를 구성합니다. `cold`와 `warm` 단계만 실행합니다.
 *
 * @param options - 작업 디렉터리, 시나리오 ID와 설명, 파일 수, 암호화 키, 저장소 암호화 설정과 core 모듈입니다.
 * @returns 구성한 시나리오를 반환합니다.
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
 * 밀리초를 소수 둘째 자리까지 표시합니다.
 *
 * @param value - 밀리초 단위 값입니다.
 * @returns 표시할 문자열을 반환합니다.
 */
function ms(value) {
  return typeof value === 'number' ? value.toFixed(2) : '-';
}

/**
 * 바이트 변화량을 부호와 함께 표시합니다.
 *
 * @param value - 바이트 단위 값입니다.
 * @returns 표시할 문자열을 반환합니다.
 */
function signed(value) {
  if (typeof value !== 'number') return '-';
  return `${value < 0 ? '-' : '+'}${formatInt(Math.abs(value))}`;
}

/**
 * 측정값을 표에 표시합니다. 측정 기능이 없는 빌드이면 `-`를 표시합니다.
 *
 * @param value - 측정값 또는 `null`입니다.
 * @returns 표시할 문자열을 반환합니다.
 */
function counter(value) {
  return typeof value === 'number' ? formatInt(value) : '-';
}

/**
 * 시험 데이터 표를 출력합니다.
 *
 * @param scenarios - 시나리오 배열입니다.
 */
function printFixtures(scenarios) {
  const out = ['## 시험 자료', ''];
  out.push('| 시나리오 | 파일 수 | 본문 | 암호화 | 디렉터리 항목 | 파일 바이트 최솟값 / 중앙값 / 최댓값 | 전체 바이트 | 양식 | 전표 | 검색어 일치 |');
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
 * 시나리오 하나의 단계 표를 출력합니다.
 *
 * @param scenario - 출력할 시나리오입니다.
 * @param summary - 단계 ID별 요약입니다.
 */
function printScenario(scenario, summary) {
  const out = [`### ${scenario.id} — ${scenario.label}`, ''];
  out.push(
    '| 단계 | 시간 중앙값 (ms) | 시간 p95 (ms) | heapUsed 변화 | RSS 변화 | 디렉터리 항목 | 후보 | lstat | 최대 동시 lstat | 본문 읽기 | 읽은 바이트 | 파싱 | 복호화 시도 | 캐시 적중 | 캐시 미적중 | 제외 캐시 적중 | 캐시 항목 | 결과 항목 수 | nextCursor |',
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
// 기준선과 비교할 지표를 정의합니다.
// ---------------------------------------------------------------------------

/** 기준선과 비교할 측정 항목입니다. 파일 접근 횟수와 캐시 동작은 환경과 관계없이 같아야 합니다. */
const BASELINE_COUNTERS = [
  'lstat', 'maxConcurrentLstat', 'bodyReads', 'parses', 'decryptAttempts', 'cacheHits', 'cacheMisses',
];

/**
 * 결과에서 기준선과 비교할 지표를 추출합니다.
 *
 * @param {Record<string, any>} result - 이 스크립트가 모은 원본 데이터
 * @param {{ runs: number }} options - 실제 측정 반복 수
 * @returns {object[]} 지표 목록
 */
function listMetrics(result, options) {
  const metrics = [];
  for (const scenario of result.scenarios) {
    const fixture = scenario.id;
    const files = scenario.count;
    for (const stage of scenario.stages) {
      const row = scenario.summary[stage];
      if (row === null || row === undefined) continue;
      const context = { fixture, files };
      for (const key of BASELINE_COUNTERS) {
        const value = row.counters[key];
        if (typeof value !== 'number') continue;
        metrics.push(metric(`mcp.${fixture}.${stage}.${key}`, {
          label: `${scenario.id} ${stage} · ${key}`, unit: 'count', kind: 'deterministic', value, context,
        }));
      }
      metrics.push(metric(`mcp.${fixture}.${stage}.items`, {
        label: `${scenario.id} ${stage} · 반환 항목 수`, unit: 'count', kind: 'deterministic',
        value: row.items, context,
      }));
      if (typeof row.nextCursor === 'string') {
        metrics.push(metric(`mcp.${fixture}.${stage}.nextCursorOffset`, {
          label: `${scenario.id} ${stage} · 다음 커서 offset`, unit: 'count', kind: 'deterministic',
          value: Number(row.nextCursor), context,
        }));
      }
      metrics.push(metric(`mcp.${fixture}.${stage}.msMedian`, {
        label: `${scenario.id} ${stage} · 중앙값`, unit: 'ms', kind: 'environmental',
        value: row.msMedian, context: { ...context, runs: options.runs },
      }));
    }
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// 본문
// ---------------------------------------------------------------------------

/**
 * 빌드된 dist 모듈을 읽습니다.
 *
 * @param relative - 저장소 기준 상대 경로입니다.
 * @returns 읽은 모듈을 반환합니다.
 * @throws 빌드 산출물이 없으면 {@link Error}가 발생합니다.
 */
async function loadDist(relative) {
  const abs = path.join(root, relative);
  if (!existsSync(abs)) {
    throw new Error(`빌드 산출물이 없습니다: ${relative}. 먼저 \`pnpm bench:mcp-list\`를 실행하세요.`);
  }
  return import(pathToFileURL(abs).href);
}

async function main() {
  const core = await loadDist('packages/core/dist/index.js');
  const { FileSystemStorage } = await loadDist('packages/mcp/dist/index.js');

  const work = createWorkDir('slipkit-bench-mcp-list-');
  const jsonPath = requestedJsonPath ?? path.join(work, 'result.json');
  const environment = collectEnvironment();
  const env = {
    ...environment,
    runs,
    warmup: WARMUP,
    sizes,
    gcExposed: typeof globalThis.gc === 'function',
  };
  const result = { env, workDir: work, scenarios: [] };

  try {
    const scenarios = [];
    for (const size of sizes) {
      progress(`시험 자료를 만드는 중입니다: 평문 ${formatInt(size)}개(최소 양식)`);
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
      progress(`시험 자료를 만드는 중입니다: 평문 ${formatInt(size)}개(약 16 KiB 양식)`);
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
      progress(`시험 자료를 만드는 중입니다: 원시 키로 암호화한 파일 ${formatInt(size)}개`);
      scenarios.push(
        await makeEncryptedScenario({
          work,
          id: `raw-${size}`,
          label: `32바이트 원시 키로 암호화한 파일 ${formatInt(size)}개 · 최소 유효 양식`,
          encryptionLabel: '32바이트 원시 키(현재 키)',
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
    progress(`시험 자료를 만드는 중입니다: 현재 문자열 키로 암호화한 파일 ${PASSPHRASE_COUNT}개`);
    scenarios.push(
      await makeEncryptedScenario({
        work,
        id: 'passphrase-current',
        label: `문자열 현재 키로 잠근 ${PASSPHRASE_COUNT}개 · 파일마다 키 파생 1회`,
        encryptionLabel: '문자열 키 (현재)',
        count: PASSPHRASE_COUNT,
        lockKey: CURRENT_PASSPHRASE,
        encryption: passphraseEncryption,
        core,
      }),
    );
    progress(`시험 자료를 만드는 중입니다: 세 번째 previousKeys 키로 암호화한 파일 ${PASSPHRASE_COUNT}개`);
    scenarios.push(
      await makeEncryptedScenario({
        work,
        id: 'passphrase-previous3',
        label: `previousKeys 3번째 키로만 열리는 ${PASSPHRASE_COUNT}개 · 파일마다 키 파생 4회`,
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
      `실행 환경: Node ${env.node} · ${env.cpuModel} × ${env.cores} · 메모리 ${formatInt(env.memoryBytes / 1024 / 1024)} MB · ` +
        `${env.platform} ${env.osRelease} · ` +
        `예열 ${WARMUP}회 + 실제 측정 ${runs}회 · 시험 자료 규모 ${sizes.map((size) => formatInt(size)).join('·')}개(문자열 키는 ${PASSPHRASE_COUNT}개) · ` +
        `목록 측정 심볼 ${metricsAvailable ? '있음' : '없음 (측정 열은 -)'} · GC 노출 ${env.gcExposed ? '있음' : '없음'}\n\n`,
    );
    printFixtures(scenarios);
    process.stdout.write('## 단계별 측정\n\n');
    for (const scenario of scenarios) printScenario(scenario, scenario.summary);
    writeResultFile(jsonPath, createResult({
      tool: 'mcp-list',
      environment,
      options: { runs, warmup: WARMUP, sizes, passphraseCount: PASSPHRASE_COUNT, gcExposed: env.gcExposed },
      metrics: listMetrics(result, { runs }),
      data: result,
    }));
    process.stdout.write(
      requestedJsonPath !== undefined || keep
        ? `JSON: ${jsonPath}\n`
        : 'JSON 원본 데이터: 시험 자료 임시 디렉터리와 함께 정리했습니다.\n',
    );
  } finally {
    if (!disposeWorkDir(work, { keep })) process.stdout.write(`시험 자료 임시 디렉터리를 보존했습니다: ${work}\n`);
  }
}

await main();
