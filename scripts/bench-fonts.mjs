#!/usr/bin/env node
/**
 * 동봉 폰트 로딩 비용을 재현 가능하게 측정합니다. 정적 크기, 실제 Chromium의 요청·시간·힙과 Node 최초 실행을 확인합니다.
 *
 * 실행: `pnpm bench:fonts`. Core와 Elements를 먼저 빌드한 뒤 측정하므로 명령 하나로 재현됩니다.
 * 기준 커밋과 수정 커밋에서 같은 환경으로 실행해 표를 비교하는 용도입니다.
 *
 * 옵션
 * - `--runs N`        실제 측정 반복 수입니다(기본 5회). 예열 1회는 따로 실행합니다.
 * - `--json <path>`   전체 결과를 저장할 파일입니다. 형식 버전이 있는 공통 구조(`schema`·`tool`·`environment`·`metrics`)에
 *                     환경·반복 수·정적 측정·시나리오별 원본 데이터를 담습니다. 생략하면 `os.tmpdir()` 아래
 * - `--skip-chromium` Chromium 측정을 건너뜁니다.
 * - `--skip-node`     Node의 캐시 없는 독립 실행을 건너뜁니다.
 * - `--keep`          임시 디렉터리(tarball·소비자 프로젝트)를 지우지 않습니다.
 * - 환경변수 `SLIPKIT_CHROMIUM`: Chromium 실행 파일입니다. 없으면 알려진 경로 또는 Playwright 관리형 Chromium을 사용합니다.
 *
 * 준비
 * - `packages/elements`의 정적 측정은 `scripts/verify-font-budget/analyze.mjs`의 `measureElementsDist`가 수행합니다.
 *   `pnpm pack` tarball과 압축 해제 크기, 루트 진입점의 정적 import 의존 파일 원본·gzip 크기,
 *   두 폰트 청크의 원본·gzip 크기, 디코딩 폰트 바이트를 확인합니다. 같은 모듈의
 *   `checkFontBudget`으로 예산과 비교한 결과도 함께 적습니다.
 * - core·elements tarball을 따로 만들어 임시 소비자 프로젝트에 `npm install`합니다(`scripts/verify-packages.mjs`와
 *   같은 방식, 같은 Vite 버전). 호스트 폰트 파일 `public/host-font.otf`는 설치된 Elements의
 *   `dist/fonts/pretendard.js`에서 `PRETENDARD_FONTS[0].data`를 꺼내 만듭니다. 저장소에 폰트 바이너리를 두지 않습니다.
 * - 페이지는 `scripts/verify-packages/fixtures/font-requests/`를 그대로 복사해 씁니다. 검증(`verify:packages`)과
 *   측정이 같은 페이지·같은 단계 프로토콜을 공유합니다.
 *
 * 시나리오 (고정) — 기본 폰트 `en`·`ko`·`ja`, 호스트 `getFonts`(`user`)
 *
 * Chromium(Playwright, `--enable-precise-memory-info --js-flags=--expose-gc`)
 * - 시나리오마다 새 브라우저 컨텍스트를 만들고 CDP `Network.setCacheDisabled(true)`를 적용해 매번 캐시가 없는 상태로 측정합니다.
 * - 단계는 `import`(Elements 동적 import 시간) → `elements`(세 컴포넌트 생성) → `resolve`(기본: `loadDefaultFonts(locale)`,
 *   user: 호스트 폰트 fetch + `createSlipKit({ getFonts })`) → `share` 순서입니다. `share` 단계에서는 세 컴포넌트에 같은
 *   slipkit·locale·양식을 넣어 DOM에 연결하고 뷰어·폼 PDF가 끝날 때까지 기다립니다. 단계마다 페이지가
 *   `{ ms, heapBefore, heapAfter }`를 반환하고, Node 쪽은
 *   `requestfinished` + `request.sizes()`로 단계별 요청 URL·수·전송 바이트를 모읍니다.
 * - 요청 분류는 파일 이름으로 합니다. 시험용 `vite.config.ts`의 `manualChunks`가 청크 이름을
 *   `font-pretendard`·`font-noto-sans-jp`·`elements`로 고정합니다.
 * - 한 번 예열한 뒤 N회 측정합니다. 시간은 중앙값과 p95를, 힙 변화는 단계별 변화량의 중앙값을 사용합니다.
 *
 * Node의 캐시 없는 독립 실행
 * - 반복마다 새 자식 프로세스 `node --expose-gc scripts/bench-fonts/node-run.mjs`를 시작합니다. 자식은 로더 훅으로
 *   설치된 Elements 안에서 읽힌 파일을 기록하고, `gc()` 뒤 `process.memoryUsage()`를 시작·import 뒤·해석 뒤에 읽습니다.
 * - 기본 시나리오는 `import` 시간과 `loadDefaultFonts(locale)` 시간, user는 `createSlipKit({ getFonts }).render(template)`
 *   시간과 PDF 바이트. 읽힌 파일 중 `dist/fonts/` 청크 수는 기본 2, user 0이어야 합니다.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { measureElementsDist, checkFontBudget, CHUNK_LABELS } from './verify-font-budget/analyze.mjs';
import { hasFlag, readArg, readPositiveInt } from './bench-shared/args.mjs';
import { FONTS_DEFAULT_RUNS } from './bench-shared/defaults.mjs';
import { collectEnvironment } from './bench-shared/env.mjs';
import { median, percentile, formatInt } from './bench-shared/stats.mjs';
import { createResult, metric, writeResultFile } from './bench-shared/result.mjs';
import { createWorkDir, disposeWorkDir } from './bench-shared/workdir.mjs';
import { packTarballs, installConsumer, copyFixture, vite, must, startPreview } from './bench-fonts/consumer.mjs';
import { launchChromium, runFontScenario, countRequests, PHASES, SCENARIOS, FONT_CHUNK_KINDS } from './bench-fonts/chromium.mjs';
import { writeHostFont } from './bench-fonts/host-font.mjs';
import { template } from './verify-packages/fixtures/template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const FIXTURES = path.join(root, 'scripts', 'verify-packages', 'fixtures');
const WARMUP = 1;

/** 시나리오 설명 — 표 제목에 씁니다. */
const SCENARIO_LABELS = {
  en: '기본 폰트, locale en (Pretendard 대체 폰트)',
  ko: '기본 폰트, locale ko (Pretendard 대체 폰트)',
  ja: '기본 폰트, locale ja (Noto Sans JP 대체 폰트)',
  user: '호스트 getFonts (Host Sans = Pretendard Regular 파생, 동봉 폰트 청크 없음)',
};

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const runs = readPositiveInt(argv, '--runs', FONTS_DEFAULT_RUNS);
const jsonPath = readArg(argv, '--json') ?? path.join(os.tmpdir(), `slipkit-bench-fonts-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const skipChromium = hasFlag(argv, '--skip-chromium');
const skipNode = hasFlag(argv, '--skip-node');
const keep = hasFlag(argv, '--keep');

/** 진행 상황은 stderr로, 표는 stdout으로 출력합니다. */
function progress(message) {
  process.stderr.write(`[bench:fonts] ${message}\n`);
}

// ---------------------------------------------------------------------------
// 측정
// ---------------------------------------------------------------------------

/**
 * Node 자식 프로세스 한 번을 띄워 결과 JSON을 받습니다.
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
        reject(new Error(`node-run.mjs(${scenario}) 결과를 해석할 수 없습니다: ${line}\n${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

/**
 * Chromium 반복 결과를 단계별로 요약합니다.
 *
 * @param {Array<Awaited<ReturnType<typeof runFontScenario>>>} samples - 실제 측정 결과(예열 제외)
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
 * Node 반복 결과를 요약합니다.
 *
 * @param {Array<Record<string, any>>} samples - 실제 측정 결과(예열 제외)
 * @returns {Record<string, any>} 시간 중앙값·p95, 메모리 변화 중앙값과 읽힌 파일
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
 * 밀리초를 소수 첫째 자리까지 적습니다.
 *
 * @param {number | undefined} value - 밀리초
 * @returns {string} 문자열
 */
function ms(value) {
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

/**
 * 바이트 변화량을 부호와 함께 적습니다.
 *
 * @param {number | null | undefined} value - 바이트
 * @returns {string} 문자열
 */
function signed(value) {
  if (typeof value !== 'number') return '-';
  return `${value < 0 ? '-' : '+'}${formatInt(Math.abs(value))}`;
}

/**
 * 요청 수와 바이트를 한 셀에 적습니다.
 *
 * @param {{ count: number, bytes: number }} entry - 요약 항목
 * @returns {string} `n (bytes)` 또는 `0`
 */
function cell(entry) {
  return entry.count === 0 ? '0' : `${formatInt(entry.count)} (${formatInt(entry.bytes)} B)`;
}

/**
 * 정적 측정과 예산 표를 출력합니다.
 *
 * @param {Awaited<ReturnType<typeof measureElementsDist>>} measurements - 측정값
 * @param {ReturnType<typeof checkFontBudget>} budget - 예산 비교 결과
 * @param {string} elementsDir - `packages/elements`
 */
function printStatic(measurements, budget, elementsDir) {
  const out = [];
  out.push('## 정적 측정 (packages/elements dist)', '');
  out.push('| 항목 | 측정값 (B) | 상한 (B) | 결과 |', '|---|---:|---:|---|');
  for (const row of budget.rows) out.push(`| ${row.item} | ${formatInt(row.actual)} | ${formatInt(row.limit)} | ${row.ok ? 'OK' : '초과'} |`);
  out.push('', `예산 결과: ${budget.ok ? '전부 통과' : '초과 항목 있음'}`, '');
  const rel = (files) => files.map((file) => path.relative(elementsDir, file)).join(', ') || '(없음)';
  out.push(`- 루트 정적 의존 파일: ${rel(measurements.rootClosure.files)}`);
  for (const [key, chunk] of Object.entries(measurements.chunks)) {
    out.push(`- ${CHUNK_LABELS[key] ?? key}: 진입 ${path.relative(elementsDir, chunk.entry)} (${chunk.exportName}), 파일 ${rel(chunk.files)}`);
  }
  out.push(`- 디코딩 폰트 바이트: ${Object.entries(measurements.decoded).map(([name, bytes]) => `${name} ${formatInt(bytes)}`).join(' · ')}`);
  if (measurements.fileName) out.push(`- tarball: ${measurements.fileName}`);
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

/**
 * Chromium 시나리오 표를 출력합니다.
 *
 * @param {string} scenario - 시나리오 이름
 * @param {ReturnType<typeof summarizeChromium>} summary - 요약
 */
function printChromium(scenario, summary) {
  const out = [];
  out.push(`### Chromium · ${scenario}: ${SCENARIO_LABELS[scenario]}`, '');
  out.push('| 단계 | 요청 수 (전송 B) | Pretendard 청크 | Noto Sans JP 청크 | Elements 청크 | 호스트 폰트 | PDF Blob | 시간 중앙값 (ms) | p95 (ms) | 힙 변화 중앙값 (B) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [phase, row] of Object.entries(summary)) {
    const total = `${formatInt(row.totalCount)} (${formatInt(row.totalBytes)} B)${row.consistent ? '' : ' ※반복마다 다름'}`;
    out.push(`| ${phase} | ${total} | ${cell(row.requests['font-pretendard'])} | ${cell(row.requests['font-noto-sans-jp'])} | ${cell(row.requests.elements)} | ${cell(row.requests['host-font'])} | ${formatInt(row.requests['pdf-blob'].count)} | ${ms(row.msMedian)} | ${ms(row.msP95)} | ${signed(row.heapDeltaMedian)} |`);
  }
  const share = summary.share?.detail;
  const resolve = summary.resolve?.detail;
  out.push('');
  if (resolve) out.push(`- 폰트 해석: ${JSON.stringify(resolve)}`);
  if (share) out.push(`- 공유: 뷰어 ${share.viewer}, 폼 ${share.form}(PDF Blob은 뷰어와 폼이 만든 PDF iframe이며, 크기는 전송 바이트에 포함되지 않습니다.)`);
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

/**
 * Node 시나리오 표를 출력합니다.
 *
 * @param {Record<string, ReturnType<typeof summarizeNode>>} byScenario - 시나리오 → 요약
 */
function printNode(byScenario) {
  const out = [];
  out.push('## Node 최초 실행(반복마다 새 프로세스, --expose-gc)', '');
  out.push('| 시나리오 | 불러오기 중앙값 (ms) | p95 | 해석·렌더링 중앙값 (ms) | p95 | 폰트 청크 파일 | 읽힌 파일 수 | 불러오기 heapUsed 변화 | 불러오기 RSS 변화 | 해석 heapUsed 변화 | 해석 arrayBuffers 변화 | 해석 RSS 변화 | PDF (B) |');
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
// 기준선과 비교할 지표를 정의합니다.
// ---------------------------------------------------------------------------

/** 지표 ID에 쓰는 폰트 이름 표기입니다. */
const FONT_SLUGS = { Pretendard: 'pretendard', 'Pretendard-Bold': 'pretendardBold', 'Noto Sans JP': 'notoSansJp' };

/**
 * 결과에서 기준선과 비교할 지표를 추출합니다.
 *
 * 정적 크기의 상한은 `verify:font-budget`에서 이미 검증하므로 여기서는 그 판정 결과(`budget.ok`)를
 * 그대로 쓰고, 크기 자체는 참고 값으로만 남깁니다. 하드 판정 대상은 폰트 청크 요청 수·읽힌 파일 수처럼
 * 환경이 달라도 같아야 하는 값입니다.
 *
 * @param {Record<string, any>} result - 이 스크립트가 모은 원본 데이터
 * @param {{ runs: number }} options - 실제 측정 반복 수
 * @returns {object[]} 지표 목록
 */
function fontMetrics(result, options) {
  const metrics = [];
  const context = { runs: options.runs };
  const measurements = result.static?.measurements;
  if (result.static !== null) {
    metrics.push(metric('fonts.budget.ok', {
      label: '폰트 예산 통과 여부', unit: 'flag', kind: 'deterministic',
      value: result.static.budget.ok ? 1 : 0, context: { fixture: 'elements-dist' },
    }));
    for (const [name, bytes] of Object.entries(measurements.decoded ?? {})) {
      const slug = FONT_SLUGS[name];
      if (slug === undefined) continue;
      metrics.push(metric(`fonts.static.decoded.${slug}`, {
        label: `${name} 디코딩 데이터 바이트`, unit: 'bytes', kind: 'deterministic',
        value: bytes, context: { fixture: 'elements-dist' },
      }));
    }
    metrics.push(metric('fonts.static.rootClosureRawBytes', {
      label: '루트 정적 의존 파일 원본 바이트', unit: 'bytes', kind: 'deterministic',
      value: measurements.rootClosure.raw, context: { fixture: 'elements-dist' },
    }));
    metrics.push(metric('fonts.static.rootClosureGzipBytes', {
      label: '루트 정적 의존 파일 gzip 바이트', unit: 'bytes', kind: 'deterministic',
      value: measurements.rootClosure.gzip, context: { fixture: 'elements-dist' },
    }));
  }

  for (const scenario of SCENARIOS) {
    const chromium = result.chromium[scenario]?.summary;
    if (chromium !== undefined) {
      const fixture = `chromium-${scenario}`;
      const sum = (kind) => Object.values(chromium).reduce((total, row) => total + row.requests[kind].count, 0);
      const requests = [
        ['fontChunkRequests', '동봉 폰트 청크 요청 수', FONT_CHUNK_KINDS.reduce((total, kind) => total + sum(kind), 0)],
        ['hostFontRequests', '호스트 폰트 요청 수', sum('host-font')],
        ['elementsRequests', 'Elements 청크 요청 수', sum('elements')],
        ['pdfBlobRequests', 'PDF Blob 요청 수', sum('pdf-blob')],
      ];
      for (const [key, label, value] of requests) {
        metrics.push(metric(`fonts.chromium.${scenario}.${key}`, {
          label: `Chromium ${scenario} · ${label}`, unit: 'count', kind: 'deterministic', value,
          context: { fixture },
        }));
      }
      for (const phase of PHASES) {
        const row = chromium[phase];
        if (typeof row?.msMedian !== 'number') continue;
        metrics.push(metric(`fonts.chromium.${scenario}.${phase}.msMedian`, {
          label: `Chromium ${scenario} · ${phase} 중앙값`, unit: 'ms', kind: 'environmental',
          value: row.msMedian, context: { ...context, fixture },
        }));
      }
    }

    const node = result.node[scenario]?.summary;
    if (node !== undefined) {
      const fixture = `node-${scenario}`;
      metrics.push(metric(`fonts.node.${scenario}.fontChunkFiles`, {
        label: `Node ${scenario} · 읽힌 폰트 청크 파일 수`, unit: 'count', kind: 'deterministic',
        value: node.fontChunkCount, context: { fixture },
      }));
      metrics.push(metric(`fonts.node.${scenario}.loadedFiles`, {
        label: `Node ${scenario} · 읽힌 파일 수`, unit: 'count', kind: 'deterministic',
        value: node.loadedFiles.length, context: { fixture },
      }));
      if (typeof node.pdfBytes === 'number') {
        metrics.push(metric(`fonts.node.${scenario}.pdfBytes`, {
          label: `Node ${scenario} · PDF 바이트`, unit: 'bytes', kind: 'deterministic',
          value: node.pdfBytes, context: { fixture },
        }));
      }
      metrics.push(metric(`fonts.node.${scenario}.importMsMedian`, {
        label: `Node ${scenario} · import 중앙값`, unit: 'ms', kind: 'environmental',
        value: node.importMsMedian, context: { ...context, fixture },
      }));
      const work = node.resolveMsMedian ?? node.renderMsMedian;
      if (typeof work === 'number') {
        metrics.push(metric(`fonts.node.${scenario}.workMsMedian`, {
          label: `Node ${scenario} · 해석·렌더 중앙값`, unit: 'ms', kind: 'environmental',
          value: work, context: { ...context, fixture },
        }));
      }
    }
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// 본문
// ---------------------------------------------------------------------------

async function main() {
  const elementsPackage = path.join(root, 'packages', 'elements');
  const work = createWorkDir('slipkit-bench-fonts-');
  const environment = collectEnvironment();
  const result = { env: { ...environment, runs, warmup: WARMUP }, static: null, chromium: {}, node: {} };

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
        environment.chromium = browser.version();
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
    result.env = { ...environment, runs, warmup: WARMUP };
    process.stdout.write(
      `실행 환경: Node ${environment.node} · ${environment.cpuModel} × ${environment.cores} · ` +
        `메모리 ${formatInt(environment.memoryBytes / 1024 / 1024)} MB · ${environment.platform} ${environment.osRelease} · ` +
        `Chromium ${environment.chromium ?? '(생략)'} · 예열 ${WARMUP}회 + 실제 측정 ${runs}회\n\n`,
    );
    printStatic(measurements, budget, elementsPackage);
    if (!skipChromium) {
      process.stdout.write('## Chromium (컨텍스트마다 cold, 캐시 비활성)\n\n');
      for (const scenario of SCENARIOS) printChromium(scenario, result.chromium[scenario].summary);
    }
    if (!skipNode) printNode(Object.fromEntries(SCENARIOS.map((scenario) => [scenario, result.node[scenario].summary])));
    writeResultFile(jsonPath, createResult({
      tool: 'fonts',
      environment,
      options: { runs, warmup: WARMUP, skipChromium, skipNode },
      metrics: fontMetrics(result, { runs }),
      data: result,
    }));
    process.stdout.write(`JSON: ${jsonPath}\n`);
  } finally {
    if (!disposeWorkDir(work, { keep })) process.stdout.write(`임시 디렉터리 보존: ${work}\n`);
  }
}

await main();
