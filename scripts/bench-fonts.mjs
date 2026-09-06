#!/usr/bin/env node
/**
 * 동봉 폰트 로딩 비용을 재현 가능하게 측정한다 — 정적 크기, 실제 Chromium의 요청·시간·힙, Node cold run.
 *
 * 실행: `pnpm bench:fonts` — Core와 Elements를 먼저 빌드한 뒤 측정하므로 명령 하나로 재현된다.
 * 기준 커밋과 수정 커밋에서 같은 환경으로 실행해 표를 비교하는 용도다.
 *
 * 옵션
 * - `--runs N`        본 측정 반복 수 (기본 5). 예열 1회는 따로 돈다
 * - `--json <path>`   전체 결과(환경·반복 수·정적 측정·시나리오별 원자료)를 저장할 파일. 생략하면 `os.tmpdir()` 아래
 * - `--skip-chromium` Chromium 측정을 건너뛴다
 * - `--skip-node`     Node cold run을 건너뛴다
 * - `--keep`          임시 디렉터리(tarball·소비자 프로젝트)를 지우지 않는다
 * - 환경변수 `SLIPKIT_CHROMIUM` — Chromium 실행 파일. 없으면 알려진 경로 또는 Playwright 관리형 Chromium
 *
 * 준비
 * - `packages/elements`의 정적 측정은 `scripts/verify-font-budget/analyze.mjs`의 `measureElementsDist`가 한다:
 *   `pnpm pack` tarball·unpacked 크기, 루트 진입점의 정적 import closure raw/gzip, 두 폰트 청크 raw/gzip,
 *   디코딩 폰트 바이트. 같은 모듈의 `checkFontBudget`으로 예산과 비교한 결과도 함께 적는다.
 * - core·elements tarball을 따로 만들어 임시 소비자 프로젝트에 `npm install`한다 (`scripts/verify-packages.mjs`와
 *   같은 방식, 같은 Vite 버전). 호스트 폰트 파일 `public/host-font.otf`는 설치된 Elements의
 *   `dist/fonts/pretendard.js`에서 `PRETENDARD_FONTS[0].data`를 꺼내 만든다 — 저장소에 폰트 바이너리를 두지 않는다.
 * - 페이지는 `scripts/verify-packages/fixtures/font-requests/`를 그대로 복사해 쓴다. 검증(`verify:packages`)과
 *   계측이 같은 페이지·같은 단계 프로토콜을 공유한다.
 *
 * 시나리오 (고정) — 기본 폰트 `en`·`ko`·`ja`, 호스트 `getFonts`(`user`)
 *
 * Chromium (Playwright, `--enable-precise-memory-info --js-flags=--expose-gc`)
 * - 시나리오마다 새 브라우저 컨텍스트, CDP `Network.setCacheDisabled(true)` — 매번 cold.
 * - 단계: `import`(Elements 동적 import 시간) → `elements`(세 컴포넌트 생성) → `resolve`(기본: `loadDefaultFonts(locale)`,
 *   user: 호스트 폰트 fetch + `createSlipKit({ getFonts })`) → `share`(세 컴포넌트에 같은 slipkit·locale·양식을 넣어 DOM에
 *   붙이고 뷰어·폼 PDF가 끝날 때까지). 단계마다 페이지가 `{ ms, heapBefore, heapAfter }`를 돌려주고, Node 쪽은
 *   `requestfinished` + `request.sizes()`로 단계별 요청 URL·수·전송 바이트를 모은다.
 * - 요청 분류는 파일 이름으로 한다. 픽스처 `vite.config.ts`의 `manualChunks`가 청크 이름을
 *   `font-pretendard`·`font-noto-sans-jp`·`elements`로 고정한다.
 * - 예열 1회 + 본 측정 N회. 시간은 median·p95, 힙 변화(단계별 after−before)는 median.
 *
 * Node cold run
 * - 반복마다 새 자식 프로세스 `node --expose-gc scripts/bench-fonts/node-run.mjs`를 띄운다. 자식은 로더 훅으로
 *   설치된 Elements 안에서 읽힌 파일을 기록하고, `gc()` 뒤 `process.memoryUsage()`를 시작·import 뒤·해석 뒤에 읽는다.
 * - 기본 시나리오는 `import` 시간과 `loadDefaultFonts(locale)` 시간, user는 `createSlipKit({ getFonts }).render(template)`
 *   시간과 PDF 바이트. 읽힌 파일 중 `dist/fonts/` 청크 수는 기본 2, user 0이어야 한다.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { measureElementsDist, checkFontBudget, CHUNK_LABELS } from './verify-font-budget/analyze.mjs';
import { median, percentile, formatInt } from './bench-designer/metrics.mjs';
import { packTarballs, installConsumer, copyFixture, vite, must, startPreview } from './bench-fonts/consumer.mjs';
import { launchChromium, runFontScenario, countRequests, PHASES, SCENARIOS, FONT_CHUNK_KINDS } from './bench-fonts/chromium.mjs';
import { writeHostFont } from './bench-fonts/host-font.mjs';
import { template } from './verify-packages/fixtures/template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const FIXTURES = path.join(root, 'scripts', 'verify-packages', 'fixtures');
const WARMUP = 1;

/** 시나리오 설명 — 표 제목에 쓴다 */
const SCENARIO_LABELS = {
  en: '기본 폰트, locale en (Pretendard fallback)',
  ko: '기본 폰트, locale ko (Pretendard fallback)',
  ja: '기본 폰트, locale ja (Noto Sans JP fallback)',
  user: '호스트 getFonts (Host Sans = Pretendard Regular 파생, 동봉 폰트 청크 없음)',
};

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------

/**
 * `--name value` 인자를 읽는다.
 *
 * @param {string} name - 인자 이름
 * @returns {string | undefined} 값
 */
function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runs = Number.parseInt(arg('--runs') ?? '5', 10);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs 는 1 이상의 정수여야 한다');
const jsonPath = arg('--json') ?? path.join(os.tmpdir(), `slipkit-bench-fonts-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const skipChromium = process.argv.includes('--skip-chromium');
const skipNode = process.argv.includes('--skip-node');
const keep = process.argv.includes('--keep');

/** 진행 상황은 stderr로, 표는 stdout으로 낸다. */
function progress(message) {
  process.stderr.write(`[bench:fonts] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 측정
// ---------------------------------------------------------------------------

/**
 * Node 자식 프로세스 한 번을 띄워 결과 JSON을 받는다.
 *
 * @param {{ consumer: string, elementsDir: string, coreDir: string, scenario: string, hostFont: string, templatePath: string }} options - 경로와 시나리오
 * @returns {Promise<Record<string, any>>} `node-run.mjs`의 JSON
 */
function nodeColdRun({ consumer, elementsDir, coreDir, scenario, hostFont, templatePath }) {
  return new Promise((resolve, reject) => {
    const args = [
      '--expose-gc', path.join(here, 'bench-fonts', 'node-run.mjs'),
      '--elements-dir', elementsDir, '--core-dir', coreDir, '--scenario', scenario,
      '--host-font', hostFont, '--template', templatePath,
    ];
    const child = spawn(process.execPath, args, { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`node-run.mjs (${scenario}) exit ${code}\n${stderr.trim()}`));
        return;
      }
      const line = stdout.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`node-run.mjs (${scenario}) 결과를 해석할 수 없다: ${line}\n${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

/**
 * Chromium 반복 결과를 단계별로 요약한다.
 *
 * @param {Array<Awaited<ReturnType<typeof runFontScenario>>>} samples - 본 측정 결과 (예열 제외)
 * @returns {Record<string, any>} 단계 → 요청 수·바이트·시간·힙 요약
 */
function summarizeChromium(samples) {
  const kinds = [...FONT_CHUNK_KINDS, 'elements', 'host-font', 'pdf-blob', 'vite-preload', 'entry', 'page', 'other'];
  const summary = {};
  const rows = ['load', ...PHASES];
  for (const phase of rows) {
    const per = samples.map((sample) => (phase === 'load' ? { requests: sample.load } : sample.phases[phase]));
    const requests = {};
    let consistent = true;
    for (const kind of kinds) {
      const counts = per.map((entry) => countRequests(entry.requests, [kind]));
      const first = counts[0];
      if (counts.some((count) => count.count !== first.count)) consistent = false;
      requests[kind] = { count: median(counts.map((count) => count.count)), bytes: median(counts.map((count) => count.bytes)) };
    }
    const total = per.map((entry) => entry.requests.length);
    const totalBytes = per.map((entry) => entry.requests.reduce((sum, request) => sum + request.bytes, 0));
    const ms = per.map((entry) => entry.ms).filter((value) => typeof value === 'number');
    const heapDelta = per
      .map((entry) => (typeof entry.heapAfter === 'number' && typeof entry.heapBefore === 'number' ? entry.heapAfter - entry.heapBefore : null))
      .filter((value) => value !== null);
    summary[phase] = {
      requests,
      totalCount: median(total),
      totalBytes: median(totalBytes),
      consistent,
      ...(ms.length > 0 ? { msMedian: median(ms), msP95: percentile(ms, 95) } : {}),
      heapDeltaMedian: heapDelta.length > 0 ? median(heapDelta) : null,
      detail: phase === 'load' ? undefined : samples[0].phases[phase].detail,
    };
  }
  return summary;
}

/**
 * Node 반복 결과를 요약한다.
 *
 * @param {Array<Record<string, any>>} samples - 본 측정 결과 (예열 제외)
 * @returns {Record<string, any>} 시간 median·p95, 메모리 변화 median, 읽힌 파일
 */
function summarizeNode(samples) {
  const pick = (key) => samples.map((sample) => sample[key]).filter((value) => typeof value === 'number');
  const delta = (from, to, field) => median(samples.map((sample) => sample.memory[to][field] - sample.memory[from][field]));
  const importMs = pick('importMs');
  const resolveMs = pick('resolveMs');
  const renderMs = pick('renderMs');
  return {
    importMsMedian: median(importMs), importMsP95: percentile(importMs, 95),
    ...(resolveMs.length > 0 ? { resolveMsMedian: median(resolveMs), resolveMsP95: percentile(resolveMs, 95) } : {}),
    ...(renderMs.length > 0 ? { renderMsMedian: median(renderMs), renderMsP95: percentile(renderMs, 95), pdfBytes: median(pick('pdfBytes')) } : {}),
    importHeapDelta: delta('start', 'afterImport', 'heapUsed'),
    importRssDelta: delta('start', 'afterImport', 'rss'),
    resolveHeapDelta: delta('afterImport', 'afterResolve', 'heapUsed'),
    resolveArrayBuffersDelta: delta('afterImport', 'afterResolve', 'arrayBuffers'),
    resolveRssDelta: delta('afterImport', 'afterResolve', 'rss'),
    loadedFiles: samples[0].loadedFiles,
    fontChunkFiles: samples[0].fontChunkFiles,
    fontChunkCount: median(samples.map((sample) => sample.fontChunkFiles.length)),
    fontNames: samples[0].fontNames,
  };
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

/**
 * 밀리초를 소수 첫째 자리까지 적는다.
 *
 * @param {number | undefined} value - 밀리초
 * @returns {string} 문자열
 */
function ms(value) {
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

/**
 * 바이트 변화량을 부호와 함께 적는다.
 *
 * @param {number | null | undefined} value - 바이트
 * @returns {string} 문자열
 */
function signed(value) {
  if (typeof value !== 'number') return '-';
  return `${value < 0 ? '-' : '+'}${formatInt(Math.abs(value))}`;
}

/**
 * 요청 수와 바이트를 한 셀에 적는다.
 *
 * @param {{ count: number, bytes: number }} entry - 요약 항목
 * @returns {string} `n (bytes)` 또는 `0`
 */
function cell(entry) {
  return entry.count === 0 ? '0' : `${formatInt(entry.count)} (${formatInt(entry.bytes)} B)`;
}

/**
 * 정적 측정과 예산 표를 출력한다.
 *
 * @param {Awaited<ReturnType<typeof measureElementsDist>>} measurements - 측정값
 * @param {ReturnType<typeof checkFontBudget>} budget - 예산 비교 결과
 * @param {string} elementsDir - `packages/elements`
 */
function printStatic(measurements, budget, elementsDir) {
  const out = [];
  out.push('## 정적 측정 (packages/elements dist)', '');
  out.push('| 항목 | 실측 (B) | 상한 (B) | 결과 |', '|---|---:|---:|---|');
  for (const row of budget.rows) out.push(`| ${row.item} | ${formatInt(row.actual)} | ${formatInt(row.limit)} | ${row.ok ? 'OK' : '초과'} |`);
  out.push('', `예산 결과: ${budget.ok ? '전부 통과' : '초과 항목 있음'}`, '');
  const rel = (files) => files.map((file) => path.relative(elementsDir, file)).join(', ') || '(없음)';
  out.push(`- 루트 정적 closure 파일: ${rel(measurements.rootClosure.files)}`);
  for (const [key, chunk] of Object.entries(measurements.chunks)) {
    out.push(`- ${CHUNK_LABELS[key] ?? key}: 진입 ${path.relative(elementsDir, chunk.entry)} (${chunk.exportName}), 파일 ${rel(chunk.files)}`);
  }
  out.push(`- 디코딩 폰트 바이트: ${Object.entries(measurements.decoded).map(([name, bytes]) => `${name} ${formatInt(bytes)}`).join(' · ')}`);
  if (measurements.fileName) out.push(`- tarball: ${measurements.fileName}`);
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

/**
 * Chromium 시나리오 표를 출력한다.
 *
 * @param {string} scenario - 시나리오 이름
 * @param {ReturnType<typeof summarizeChromium>} summary - 요약
 */
function printChromium(scenario, summary) {
  const out = [];
  out.push(`### Chromium — ${scenario}: ${SCENARIO_LABELS[scenario]}`, '');
  out.push('| 단계 | 요청 수 (전송 B) | Pretendard 청크 | Noto Sans JP 청크 | elements 청크 | 호스트 폰트 | PDF blob | 시간 median (ms) | p95 (ms) | heap Δ median (B) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [phase, row] of Object.entries(summary)) {
    const total = `${formatInt(row.totalCount)} (${formatInt(row.totalBytes)} B)${row.consistent ? '' : ' ※반복마다 다름'}`;
    out.push(`| ${phase} | ${total} | ${cell(row.requests['font-pretendard'])} | ${cell(row.requests['font-noto-sans-jp'])} | ${cell(row.requests.elements)} | ${cell(row.requests['host-font'])} | ${formatInt(row.requests['pdf-blob'].count)} | ${ms(row.msMedian)} | ${ms(row.msP95)} | ${signed(row.heapDeltaMedian)} |`);
  }
  const share = summary.share?.detail;
  const resolve = summary.resolve?.detail;
  out.push('');
  if (resolve) out.push(`- resolve: ${JSON.stringify(resolve)}`);
  if (share) out.push(`- share: 뷰어 ${share.viewer}, 폼 ${share.form} (PDF blob은 뷰어·폼이 만든 PDF iframe — 크기는 전송 바이트에 잡히지 않는다)`);
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

/**
 * Node 시나리오 표를 출력한다.
 *
 * @param {Record<string, ReturnType<typeof summarizeNode>>} byScenario - 시나리오 → 요약
 */
function printNode(byScenario) {
  const out = [];
  out.push('## Node cold run (반복마다 새 프로세스, --expose-gc)', '');
  out.push('| 시나리오 | import median (ms) | p95 | 해석/렌더 median (ms) | p95 | 폰트 청크 파일 | 읽힌 파일 수 | import heapUsed Δ | import rss Δ | 해석 heapUsed Δ | 해석 arrayBuffers Δ | 해석 rss Δ | PDF (B) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [scenario, row] of Object.entries(byScenario)) {
    const work = row.resolveMsMedian !== undefined ? [row.resolveMsMedian, row.resolveMsP95] : [row.renderMsMedian, row.renderMsP95];
    out.push(`| ${scenario} | ${ms(row.importMsMedian)} | ${ms(row.importMsP95)} | ${ms(work[0])} | ${ms(work[1])} | ${formatInt(row.fontChunkCount)} | ${formatInt(row.loadedFiles.length)} | ${signed(row.importHeapDelta)} | ${signed(row.importRssDelta)} | ${signed(row.resolveHeapDelta)} | ${signed(row.resolveArrayBuffersDelta)} | ${signed(row.resolveRssDelta)} | ${row.pdfBytes === undefined ? '-' : formatInt(row.pdfBytes)} |`);
  }
  out.push('');
  for (const [scenario, row] of Object.entries(byScenario)) {
    out.push(`- ${scenario}: 폰트 ${row.fontNames.join(', ')} · 읽힌 파일 ${row.loadedFiles.join(', ')}`);
  }
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// 본문
// ---------------------------------------------------------------------------

async function main() {
  const elementsPackage = path.join(root, 'packages', 'elements');
  const work = mkdtempSync(path.join(os.tmpdir(), 'slipkit-bench-fonts-'));
  const env = {
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryBytes: os.totalmem(),
    platform: `${os.platform()} ${os.release()}`,
    chromium: null,
    runs,
    warmup: WARMUP,
  };
  const result = { env, static: null, chromium: {}, node: {} };

  try {
    progress('정적 측정 (pnpm pack 포함)');
    const measurements = await measureElementsDist(elementsPackage, { pack: true });
    const budget = checkFontBudget(measurements);
    result.static = { measurements, budget };

    progress('tarball 생성과 소비자 npm install');
    const tarballs = await packTarballs(root, ['core', 'elements'], path.join(work, 'tarballs'));
    const consumer = path.join(work, 'consumer');
    const { elementsDir, coreDir } = await installConsumer(consumer, tarballs);
    const app = copyFixture(FIXTURES, consumer);
    const hostFontFile = path.join(app, 'public', 'host-font.otf');
    const hostFont = await writeHostFont(path.join(elementsDir, 'dist', 'fonts', 'pretendard.js'), hostFontFile);
    const templatePath = path.join(work, 'template.json');
    writeFileSync(templatePath, JSON.stringify(template));
    result.hostFont = hostFont;

    if (!skipChromium) {
      progress('vite build');
      const outDir = path.join(consumer, 'out', 'font-requests');
      must('vite build font-requests', await vite(consumer, ['build', 'font-requests', '--outDir', outDir, '--logLevel', 'warn']));
      const preview = await startPreview(consumer, 'font-requests', outDir);
      const browser = await launchChromium();
      try {
        env.chromium = browser.version();
        for (const scenario of SCENARIOS) {
          const samples = [];
          for (let i = 0; i < WARMUP + runs; i++) {
            progress(`Chromium ${scenario} ${i < WARMUP ? '예열' : `${i - WARMUP + 1}/${runs}`}`);
            const sample = await runFontScenario(browser, { baseUrl: preview.url, scenario });
            if (sample.errors.length > 0) throw new Error(`Chromium ${scenario}: 페이지 오류\n${sample.errors.join('\n')}`);
            if (i >= WARMUP) samples.push(sample);
          }
          result.chromium[scenario] = { samples, summary: summarizeChromium(samples) };
        }
      } finally {
        await browser.close();
        preview.stop();
      }
    }

    if (!skipNode) {
      for (const scenario of SCENARIOS) {
        const samples = [];
        for (let i = 0; i < WARMUP + runs; i++) {
          progress(`Node ${scenario} ${i < WARMUP ? '예열' : `${i - WARMUP + 1}/${runs}`}`);
          const sample = await nodeColdRun({ consumer, elementsDir, coreDir, scenario, hostFont: hostFontFile, templatePath });
          if (i >= WARMUP) samples.push(sample);
        }
        result.node[scenario] = { samples, summary: summarizeNode(samples) };
      }
    }

    // 출력
    process.stdout.write(`실행 환경: Node ${env.node} · ${env.cpu} × ${env.cores} · 메모리 ${formatInt(env.memoryBytes / 1024 / 1024)} MB · ${env.platform} · Chromium ${env.chromium ?? '(생략)'} · 예열 ${WARMUP}회 + 본 측정 ${runs}회\n\n`);
    printStatic(measurements, budget, elementsPackage);
    if (!skipChromium) {
      process.stdout.write('## Chromium (컨텍스트마다 cold, 캐시 비활성)\n\n');
      for (const scenario of SCENARIOS) printChromium(scenario, result.chromium[scenario].summary);
    }
    if (!skipNode) printNode(Object.fromEntries(SCENARIOS.map((scenario) => [scenario, result.node[scenario].summary])));
    writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    process.stdout.write(`JSON: ${jsonPath}\n`);
  } finally {
    if (keep) process.stdout.write(`임시 디렉터리 보존: ${work}\n`);
    else rmSync(work, { recursive: true, force: true });
  }
}

await main();
