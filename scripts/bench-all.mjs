#!/usr/bin/env node
/**
 * Core, Designer, fonts, MCP list 성능 측정을 차례로 실행하고 결과를 한곳에 모읍니다.
 *
 * 실행: `pnpm bench:all`. 선택한 측정에 필요한 패키지를 먼저 한 번 빌드하므로 명령 하나로 재현되고,
 * 하위 명령은 각자 그대로 실행되므로(같은 옵션·같은 기본값) 따로 돌린 결과와 여기서 모은 결과가
 * 다르지 않습니다. 하위 명령이 만드는 임시 시험 자료와 소비자 프로젝트는 해당 명령이 지웁니다.
 *
 * 실행 순서
 * 1. 옵션 해석과 하위 실행 선택
 * 2. 기준선 확인: 비교가 켜져 있으면 선택한 측정의 기준선이 모두 있어야 합니다. 하나라도 없으면
 *    재기 전에 멈춥니다.
 * 3. 선택한 측정에 필요한 패키지 빌드(`--only core`면 Core만 한 번 빌드합니다.)
 * 4. 하위 측정 실행과 기준선 비교, 실행 목록 저장
 *
 * 출력
 * - 하위 실행마다 결과 JSON(`core.json`·`designer.json`·`fonts.json`·`mcp-list.json`)과 표 출력 로그를 남깁니다.
 * - 실행 전체를 묶는 `manifest.json`: 하위 실행의 스키마 버전, 결과 파일 경로, 성공 여부,
 *   실행 환경 정보와 기준선 판정을 담습니다.
 * - 출력 디렉터리를 지정하지 않으면 `os.tmpdir()` 아래에 만듭니다. 저장소 작업 트리에는 아무것도
 *   남기지 않습니다.
 *
 * 옵션: 하위 명령에 넘기는 값의 기본은 하위 명령의 기본값과 같습니다. 축소는 명시적 옵션으로만 합니다.
 * - `--out <dir>`           결과를 남길 디렉터리입니다(기본: 임시 디렉터리).
 * - `--only a,b`            실행할 측정만 선택합니다(`core,designer,fonts,mcp-list`).
 * - `--skip a,b`            실행하지 않을 측정입니다.
 * - `--baselines <dir>`     기준선 디렉터리입니다(기본 `scripts/bench-baselines`).
 * - `--no-baseline`         기준선 비교를 건너뜁니다(기준선 파일이 없어도 실행합니다).
 * - `--designer-chromium`   Designer를 Chromium에서도 측정합니다.
 * - `--fonts-runs N`        fonts의 실제 측정 반복 수입니다.
 * - `--fonts-skip-chromium` fonts의 Chromium 측정을 건너뜁니다.
 * - `--mcp-sizes 1000`      MCP list의 시험 파일 수입니다.
 * - `--mcp-runs N`          MCP list의 실제 측정 반복 수입니다.
 *
 * 기준선 비교는 `scripts/bench-shared/baseline.mjs`가 합니다. 환경과 무관하게 같아야 하는 지표가 어긋나면 실패로,
 * 시간·메모리는 실행 환경 정보와 반복 수가 같을 때만 항목별 허용 회귀율로 판정합니다.
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEnvironment, environmentFingerprint } from './bench-shared/env.mjs';
import { compareToBaseline, formatComparison, loadBaselines } from './bench-shared/baseline.mjs';
import { buildManifest, createRunRecord, writeManifestFile } from './bench-shared/manifest.mjs';
import { BenchSchemaError, readResultFile } from './bench-shared/result.mjs';
import { createWorkDir } from './bench-shared/workdir.mjs';
import { buildCommandArgs, buildTargets, missingBaselineTools, parseOptions, selectRuns } from './bench-all/plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);

/** 패키지 관리자 실행 파일입니다. Windows에서는 확장자가 붙은 실행 연결 파일만 실행할 수 있습니다. */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const options = parseOptions(argv);
const baselineDir = options.baselines === undefined
  ? path.join(root, 'scripts', 'bench-baselines')
  : path.resolve(options.baselines);
const selected = selectRuns(options);

/**
 * 진행 상황은 stderr로 출력합니다.
 *
 * @param {string} message - 진행 문구
 */
function progress(message) {
  process.stderr.write(`[bench:all] ${message}\n`);
}

/**
 * 하위 측정 하나를 자식 프로세스로 실행합니다. 표 출력은 로그 파일에 쓰고 진행 문구는 그대로 전달합니다.
 *
 * @param {{ script: string, execArgv: string[], args: string[], logFile: string }} spec - 실행할 명령
 * @returns {Promise<{ code: number | null, error: string | null }>} 종료 코드와 오류 문구
 */
function runChild(spec) {
  return new Promise((resolve) => {
    const log = createWriteStream(spec.logFile);
    const child = spawn(process.execPath, [...spec.execArgv, path.join(here, spec.script), ...spec.args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stderrTail = '';
    child.stdout.pipe(log);
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderrTail = `${stderrTail}${text}`.slice(-4000);
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      log.end();
      resolve({ code: -1, error: error.message });
    });
    child.on('close', (code) => {
      log.end();
      resolve({ code, error: code === 0 ? null : stderrTail.trim().split('\n').slice(-5).join('\n') });
    });
  });
}

/**
 * 선택한 측정에 필요한 패키지를 한 번에 빌드합니다.
 *
 * @param {string[]} packages - 빌드할 패키지 이름
 * @returns {Promise<void>} 빌드가 끝나면 이행됩니다.
 * @throws Error 빌드가 실패했을 때
 */
async function buildPackages(packages) {
  const args = buildCommandArgs(packages);
  progress(`빌드 — pnpm ${args.join(' ')}`);
  const result = await new Promise((resolve) => {
    const child = spawn(PNPM, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    child.on('error', (error) => resolve({ code: -1, error: error.message }));
    child.on('close', (code) => resolve({ code, error: null }));
  });
  if (result.code !== 0) {
    const reason = result.error === null ? `exit ${result.code}` : result.error;
    throw new Error(`패키지 빌드에 실패했습니다(${reason}): pnpm ${args.join(' ')}`);
  }
}

// ---------------------------------------------------------------------------
// 기준선은 측정 전에 확인합니다.
// ---------------------------------------------------------------------------

let baselines = new Map();
if (options.useBaseline) {
  if (!existsSync(baselineDir)) {
    throw new Error(`기준선 디렉터리가 없습니다: ${baselineDir}. --baselines로 경로를 지정하거나 --no-baseline로 비교를 건너뛰세요.`);
  }
  baselines = loadBaselines(baselineDir);
  const missing = missingBaselineTools(selected, baselines);
  if (missing.length > 0) {
    const files = missing.map((tool) => path.join(baselineDir, `${tool}.json`)).join(', ');
    throw new Error(
      `선택한 성능 측정의 기준선이 없습니다: ${missing.join(', ')}(${files}). ` +
        '기준선을 먼저 측정하거나 --no-baseline로 비교를 건너뛰세요.',
    );
  }
}

// ---------------------------------------------------------------------------
// 빌드와 측정
// ---------------------------------------------------------------------------

await buildPackages(buildTargets(selected));

const missingDist = [...new Set(selected.flatMap((run) => run.needs))].filter((rel) => !existsSync(path.join(root, rel)));
if (missingDist.length > 0) {
  throw new Error(`빌드 뒤에도 산출물이 없습니다: ${missingDist.join(', ')}. 빌드 로그를 확인하세요.`);
}

const outDir = options.out === undefined ? createWorkDir('slipkit-bench-all-') : path.resolve(options.out);
mkdirSync(outDir, { recursive: true });

const environment = collectEnvironment();
const fingerprint = environmentFingerprint(environment);
const startedAt = new Date().toISOString();
const records = [];

progress(`출력 디렉터리: ${outDir}`);
progress(`실행 환경: ${fingerprint}`);

for (const def of selected) {
  const resultFile = path.join(outDir, `${def.tool}.json`);
  const logFile = path.join(outDir, `${def.tool}.log`);
  const args = [...def.args, '--json', resultFile];
  const command = `node ${def.execArgv.join(' ')} scripts/${def.script} ${args.join(' ')}`.replace(/\s+/g, ' ');
  progress(`${def.tool} 시작 — ${command}`);
  const started = Date.now();
  const child = await runChild({ script: def.script, execArgv: def.execArgv, args, logFile });
  const durationMs = Date.now() - started;

  let result = null;
  let error = child.error;
  if (child.code === 0) {
    try {
      result = readResultFile(resultFile);
    } catch (failure) {
      error = failure instanceof BenchSchemaError ? failure.message : String(failure);
    }
  }
  const success = child.code === 0 && result !== null;
  let comparison = null;
  if (success && baselines.has(def.tool)) {
    try {
      comparison = compareToBaseline(baselines.get(def.tool), result);
    } catch (failure) {
      // 기준선과 결과의 형식이 어긋나면 비교 자체를 실패로 남깁니다.
      const message = failure instanceof BenchSchemaError ? failure.message : String(failure);
      comparison = { tool: def.tool, ok: false, baselineCommit: baselines.get(def.tool).baselineCommit,
        environment: { same: false, differences: [] }, findings: [], unlisted: [],
        counts: { pass: 0, fail: 1, incomparable: 0, unlisted: 0 }, error: message };
      error = error ?? message;
    }
  }
  records.push(createRunRecord({
    tool: def.tool,
    command,
    argv: args,
    success,
    exitCode: child.code,
    durationMs,
    resultFile: success ? path.relative(outDir, resultFile) : null,
    logFile: path.relative(outDir, logFile),
    resultSchema: result?.schema ?? null,
    environment: result?.environment ?? null,
    fingerprint: result === null ? null : environmentFingerprint(result.environment),
    metricCount: result?.metrics.length ?? 0,
    comparison,
    error,
  }));
  progress(`${def.tool} ${success ? '완료' : '실패'} — ${(durationMs / 1000).toFixed(1)}초`);
}

const manifest = buildManifest({
  startedAt,
  finishedAt: new Date().toISOString(),
  outDir,
  baselineDir: options.useBaseline ? path.relative(root, baselineDir) : null,
  environment,
  fingerprint,
  options: {
    designerChromium: options.designerChromium,
    fontsRuns: options.fontsRuns,
    fontsSkipChromium: options.fontsSkipChromium,
    mcpSizes: options.mcpSizes,
    mcpRuns: options.mcpRuns,
  },
  runs: records,
});
writeManifestFile(path.join(outDir, 'manifest.json'), manifest);

// ---------------------------------------------------------------------------
// 요약
// ---------------------------------------------------------------------------

const out = [];
out.push('# bench:all', '');
out.push(`실행 환경: ${fingerprint}`);
out.push(`출력 디렉터리: ${outDir}`);
out.push(`전체 소요: ${(manifest.durationMs / 1000).toFixed(1)}초`, '');
out.push('| 성능 측정 | 결과 | 소요 시간 | 지표 수 | 결과 파일 | 기준선(통과/실패/비교 불가) |');
out.push('|---|---|---:|---:|---|---|');
for (const record of manifest.runs) {
  const verdict = record.comparison === null
    ? '(비교 안 함)'
    : `${record.comparison.ok ? '통과' : '실패'} (${record.comparison.counts.pass}/${record.comparison.counts.fail}/${record.comparison.counts.incomparable})`;
  out.push(
    `| ${record.tool} | ${record.success ? '성공' : `실패 (exit ${record.exitCode})`} | ` +
      `${(record.durationMs / 1000).toFixed(1)}초 | ${record.metricCount} | ${record.resultFile ?? '-'} | ${verdict} |`,
  );
}
out.push('');
for (const record of manifest.runs) {
  if (record.comparison === null) continue;
  out.push(...formatComparison(record.comparison), '');
}
for (const record of manifest.runs) {
  if (record.success) continue;
  out.push(`### ${record.tool} 실패`, '', '```', record.error ?? '(사유 없음)', '```', '');
}
out.push(`manifest: ${path.join(outDir, 'manifest.json')}`);
process.stdout.write(`${out.join('\n')}\n`);

process.exitCode = manifest.ok ? 0 : 1;
