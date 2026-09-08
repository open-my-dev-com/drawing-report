#!/usr/bin/env node
/**
 * benchmark 네 갈래를 한 번에 돌리고 결과를 한곳에 모은다 — Core → Designer → fonts → MCP list.
 *
 * 실행: `pnpm bench:all`. 하위 명령은 각자 그대로 실행되므로(같은 옵션·같은 기본값) 따로 돌린
 * 결과와 여기서 모은 결과가 다르지 않다. 하위 명령이 만드는 임시 fixture·소비자 프로젝트는
 * 하위 명령이 스스로 지운다.
 *
 * 출력
 * - 하위 실행마다 결과 JSON(`core.json`·`designer.json`·`fonts.json`·`mcp-list.json`)과 표 출력 로그
 * - 실행 전체를 묶는 `manifest.json` — 하위 실행의 schema 판, 결과 파일 경로, 성공 여부,
 *   실행 환경 fingerprint와 기준선 판정
 * - 출력 디렉터리를 지정하지 않으면 `os.tmpdir()` 아래에 만든다. 저장소 작업 트리에는 아무것도
 *   남기지 않는다.
 *
 * 옵션
 * - `--out <dir>`           결과를 남길 디렉터리 (기본: 임시 디렉터리)
 * - `--only a,b`            돌릴 benchmark만 고른다 (`core,designer,fonts,mcp-list`)
 * - `--skip a,b`            돌리지 않을 benchmark
 * - `--baselines <dir>`     기준선 디렉터리 (기본 `scripts/bench-baselines`)
 * - `--no-baseline`         기준선 비교를 건너뛴다
 * - `--designer-chromium`   Designer benchmark를 Chromium에서도 잰다
 * - `--fonts-runs N`        fonts benchmark의 본 측정 반복 수 (기본 3)
 * - `--fonts-skip-chromium` fonts benchmark의 Chromium 측정을 건너뛴다
 * - `--mcp-sizes 1000`      MCP list benchmark의 fixture 파일 수 (기본 1000)
 * - `--mcp-runs N`          MCP list benchmark의 본 측정 반복 수 (기본 3)
 *
 * 기준선 비교는 `scripts/bench-shared/baseline.mjs`가 한다. 결정적 지표가 어긋나면 실패로,
 * 시간·메모리는 환경 fingerprint와 반복 수가 같을 때만 항목별 허용 회귀율로 판정한다.
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasFlag, readArg, readPositiveInt } from './bench-shared/args.mjs';
import { collectEnvironment, environmentFingerprint } from './bench-shared/env.mjs';
import { compareToBaseline, formatComparison, loadBaselines } from './bench-shared/baseline.mjs';
import { buildManifest, createRunRecord, writeManifestFile } from './bench-shared/manifest.mjs';
import { BenchSchemaError, TOOLS, readResultFile } from './bench-shared/result.mjs';
import { createWorkDir } from './bench-shared/workdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);

const outOption = readArg(argv, '--out');
const baselineDir = readArg(argv, '--baselines') ?? path.join(root, 'scripts', 'bench-baselines');
const useBaseline = !hasFlag(argv, '--no-baseline');
const designerChromium = hasFlag(argv, '--designer-chromium');
const fontsRuns = readPositiveInt(argv, '--fonts-runs', 3);
const fontsSkipChromium = hasFlag(argv, '--fonts-skip-chromium');
const mcpSizes = readArg(argv, '--mcp-sizes') ?? '1000';
const mcpRuns = readPositiveInt(argv, '--mcp-runs', 3);

/**
 * 쉼표로 구분한 benchmark 이름 목록을 읽는다.
 *
 * @param {string} name - 인자 이름
 * @returns {string[]} benchmark 이름 목록
 * @throws Error 알 수 없는 이름이 있을 때
 */
function toolList(name) {
  const raw = readArg(argv, name);
  if (raw === undefined) return [];
  const names = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  const unknown = names.filter((value) => !TOOLS.includes(value));
  if (unknown.length > 0) throw new Error(`${name} 에 알 수 없는 benchmark가 있다: ${unknown.join(', ')}`);
  return names;
}

const only = toolList('--only');
const skip = toolList('--skip');

/** 하위 실행 정의 — 순서대로 돈다 */
const RUN_DEFS = [
  {
    tool: 'core',
    script: 'benchmark.mjs',
    execArgv: [],
    needs: ['packages/core/dist/index.js'],
    args: () => [],
  },
  {
    tool: 'designer',
    script: 'bench-designer.mjs',
    // 되돌리기 스냅샷의 heapUsed 차이를 재려면 gc()가 필요하다 (없으면 스스로 다시 실행한다).
    execArgv: ['--expose-gc'],
    needs: ['packages/core/dist/index.js', 'packages/elements/dist/index.js'],
    args: () => (designerChromium ? ['--chromium'] : []),
  },
  {
    tool: 'fonts',
    script: 'bench-fonts.mjs',
    execArgv: [],
    needs: ['packages/core/dist/index.js', 'packages/elements/dist/index.js'],
    args: () => ['--runs', String(fontsRuns), ...(fontsSkipChromium ? ['--skip-chromium'] : [])],
  },
  {
    tool: 'mcp-list',
    script: 'bench-mcp-list.mjs',
    execArgv: ['--expose-gc'],
    needs: ['packages/core/dist/index.js', 'packages/mcp/dist/index.js'],
    args: () => ['--sizes', mcpSizes, '--runs', String(mcpRuns)],
  },
];

const selected = RUN_DEFS.filter((def) => (only.length === 0 || only.includes(def.tool)) && !skip.includes(def.tool));
if (selected.length === 0) throw new Error('돌릴 benchmark가 없다 — --only 와 --skip 을 확인한다');

const missing = [...new Set(selected.flatMap((def) => def.needs))].filter((rel) => !existsSync(path.join(root, rel)));
if (missing.length > 0) {
  throw new Error(`빌드 산출물이 없다: ${missing.join(', ')} — 먼저 \`pnpm build\`를 실행한다`);
}

const outDir = outOption === undefined ? createWorkDir('slipkit-bench-all-') : path.resolve(outOption);
mkdirSync(outDir, { recursive: true });

/**
 * 진행 상황은 stderr로 낸다.
 *
 * @param {string} message - 진행 문구
 */
function progress(message) {
  process.stderr.write(`[bench:all] ${message}\n`);
}

/**
 * 하위 benchmark 하나를 자식 프로세스로 돌린다. 표 출력은 로그 파일에, 진행 문구는 그대로 흘린다.
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

if (useBaseline && !existsSync(baselineDir)) {
  throw new Error(`기준선 디렉터리가 없다: ${baselineDir} — --baselines 로 경로를 주거나 --no-baseline 으로 비교를 건너뛴다`);
}
const baselines = useBaseline ? loadBaselines(baselineDir) : new Map();
const environment = collectEnvironment();
const fingerprint = environmentFingerprint(environment);
const startedAt = new Date().toISOString();
const records = [];

progress(`출력 디렉터리: ${outDir}`);
progress(`실행 환경: ${fingerprint}`);

for (const def of selected) {
  const resultFile = path.join(outDir, `${def.tool}.json`);
  const logFile = path.join(outDir, `${def.tool}.log`);
  const args = [...def.args(), '--json', resultFile];
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
      // 기준선과 결과의 형식이 어긋나면 비교 자체를 실패로 남긴다.
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
  baselineDir: useBaseline ? path.relative(root, baselineDir) : null,
  environment,
  fingerprint,
  options: { designerChromium, fontsRuns, fontsSkipChromium, mcpSizes, mcpRuns },
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
out.push('| benchmark | 결과 | 소요 | 지표 수 | 결과 파일 | 기준선 (통과/실패/비교 불가) |');
out.push('|---|---|---:|---:|---|---|');
for (const record of manifest.runs) {
  const verdict = record.comparison === null
    ? '(기준선 없음)'
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
