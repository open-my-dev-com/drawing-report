/**
 * 저장소 전용 정적 검사 게이트 — 미사용 파일·export·의존성을 knip으로 찾아 요약한다.
 *
 * 실행: `pnpm verify:maintenance` (또는 `node scripts/verify-maintenance.mjs`). 소스만 읽으므로
 * 빌드나 브라우저가 없어도 되고, 작업 트리에 아무것도 남기지 않는다.
 *
 * 옵션
 * - `--json <path>`: knip 원본 보고서를 그대로 저장한다 (production 실행 결과는 `.production.json`).
 *
 * 무엇을 보나
 * 1. `knip.jsonc` 설정이 저장소와 맞는지 — 아무 파일과도 맞지 않는 진입점 glob, 이미 지운 의존성을
 *    가리키는 `ignoreDependencies`. 진입점 하나가 낡으면 그 아래가 조용히 검사에서 빠진다.
 * 2. 기본 실행 — 어디서도 가져오지 않는 파일, 아무도 쓰지 않는 export, 쓰지 않는 의존성과
 *    `package.json`에 적히지 않은 의존성.
 * 3. `--production` 실행 — 패키지 진입점과 `bin`에서 닿지 않는 export. 시험만 쓰는 export는
 *    `scripts/verify-maintenance/production.mjs`의 허용 목록에 까닭과 쓰는 파일을 적어 둔 것만 통과한다.
 *
 * 진입점과 개별 예외는 `knip.jsonc`에서 까닭과 함께 관리한다. 자식 프로세스나 `node --import`로만
 * 실행하는 파일은 정적 import가 없어 그곳에 진입점으로 적어야 한다.
 *
 * 출력: 종류별 건수 표와 항목 목록을 stdout에 적는다. 지적이 하나라도 있으면 종료 코드 1로 끝난다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKnipConfig, parseJsonc } from './verify-maintenance/config.mjs';
import { checkProductionExports, exportFindings, renderProductionReport } from './verify-maintenance/production.mjs';
import { collectFindings, formatFinding, renderReport } from './verify-maintenance/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = '사용법: node scripts/verify-maintenance.mjs [--json <path>]';

/** 파일 목록을 모을 때 들어가지 않는 디렉터리 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo']);

/**
 * 명령행 인자를 읽는다.
 *
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{ json: string | undefined }} 옵션
 * @throws {Error} 모르는 옵션이거나 `--json`에 경로가 없을 때
 */
function parseArgs(argv) {
  const options = { json: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--json 뒤에 저장할 파일 경로가 필요하다\n${USAGE}`);
      options.json = path.resolve(value);
    } else if (arg.startsWith('--json=')) {
      options.json = path.resolve(arg.slice('--json='.length));
    } else {
      throw new Error(`알 수 없는 옵션: ${arg}\n${USAGE}`);
    }
  }
  return options;
}

/**
 * knip을 JSON 보고 방식으로 실행한다.
 *
 * @param {string[]} [extraArgs] - 덧붙일 knip 인자 (예: `['--production']`)
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 종료 코드와 출력
 */
function runKnip(extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'knip', '--no-progress', '--reporter', 'json', ...extraArgs], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * knip 실행 결과를 보고서 객체로 읽는다.
 *
 * @param {{ code: number, stdout: string, stderr: string }} result - `runKnip` 결과
 * @param {string} label - 실패 메시지에 적을 실행 이름
 * @returns {object} 파싱한 보고서
 * @throws {Error} 출력이 비었거나 JSON이 아닐 때
 */
function readReport(result, label) {
  const output = result.stdout.trim();
  if (output === '') {
    throw new Error(`knip(${label})이 보고서를 내놓지 않았다 (종료 코드 ${result.code})\n${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`knip(${label}) 출력을 JSON으로 읽지 못했다 (종료 코드 ${result.code})\n${output.slice(0, 500)}`);
  }
}

/**
 * 디렉터리 아래의 파일 경로를 모은다. 산출물·의존성 디렉터리는 들어가지 않는다.
 *
 * @param {string} dir - 절대 경로
 * @returns {string[]} `dir` 기준 상대 경로 목록 (`/` 구분)
 */
function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const rel = path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep);
    if (rel.some((segment) => SKIP_DIRS.has(segment))) continue;
    files.push(rel.join('/'));
  }
  return files;
}

/** 의존성 이름을 찾을 때 읽는 파일 확장자 — 소스와 설정 파일만 본다. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.vue', '.html']);

/**
 * `knip.jsonc`가 저장소 내용과 맞는지 확인한다.
 *
 * @param {object} config - 파싱한 knip 설정
 * @returns {string[]} 어긋난 점
 */
function knipConfigProblems(config) {
  const files = {};
  const dependencies = {};
  for (const name of Object.keys(config.workspaces ?? {})) {
    const dir = path.resolve(ROOT, name);
    let owned;
    try {
      owned = collectFiles(dir);
    } catch {
      continue;
    }
    files[name] = owned;
    let manifest = {};
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      manifest = {};
    }
    dependencies[name] = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];
  }
  // 이름이 파일에 있는지는 필요할 때만 읽어 확인한다 (워크스페이스 파일을 한 번만 읽는다).
  const sources = new Map();
  const readSources = (workspace) => {
    if (!sources.has(workspace)) {
      const dir = path.resolve(ROOT, workspace);
      const text = (files[workspace] ?? [])
        .filter((file) => CODE_EXTENSIONS.has(path.extname(file)))
        .map((file) => {
          try {
            return readFileSync(path.join(dir, file), 'utf8');
          } catch {
            return '';
          }
        })
        .join('\n');
      sources.set(workspace, text);
    }
    return sources.get(workspace);
  };
  const hasReference = (workspace, name) =>
    readSources(workspace).includes(`'${name}'`) ||
    readSources(workspace).includes(`"${name}"`) ||
    readSources(workspace).includes(`'${name}/`) ||
    readSources(workspace).includes(`"${name}/`);

  return checkKnipConfig({ config, files, dependencies, hasReference });
}

/** 파일이 그 이름을 담고 있는지 본다 (허용 목록의 근거 확인). */
function fileHasName(file, name) {
  try {
    return new RegExp(`\\b${name}\\b`).test(readFileSync(path.resolve(ROOT, file), 'utf8'));
  } catch {
    return false;
  }
}

/**
 * 검사·요약·종료 코드 결정을 수행한다.
 *
 * @param {string[]} argv - 명령행 인자
 * @returns {Promise<number>} 종료 코드
 * @throws {Error} knip을 실행하지 못하거나 출력이 JSON이 아닐 때
 */
async function main(argv) {
  const options = parseArgs(argv);

  const configProblems = knipConfigProblems(parseJsonc(readFileSync(path.join(ROOT, 'knip.jsonc'), 'utf8')));
  console.log('# knip 설정 점검');
  console.log('');
  console.log(
    configProblems.length === 0
      ? '지적 0건 — 진입점 glob이 모두 파일과 맞고 ignoreDependencies가 살아 있는 의존성을 가리킨다.'
      : configProblems.map((problem) => `- ${problem}`).join('\n'),
  );
  console.log('');

  const report = readReport(await runKnip(), '기본');
  const production = readReport(await runKnip(['--production']), 'production');

  if (options.json) {
    mkdirSync(path.dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    const productionPath = options.json.replace(/(\.json)?$/, '.production.json');
    writeFileSync(productionPath, `${JSON.stringify(production, null, 2)}\n`);
  }

  const findings = collectFindings(report);
  console.log(renderReport(findings));
  console.log('');

  const productionResult = checkProductionExports(
    exportFindings(collectFindings(production)),
    undefined,
    fileHasName,
  );
  console.log(renderProductionReport(productionResult, formatFinding));
  if (options.json) {
    console.log('');
    console.log(`JSON 저장: ${options.json}`);
  }

  const total = configProblems.length + findings.length + productionResult.unexpected.length + productionResult.stale.length;
  if (total > 0) {
    console.error(`정적 검사 실패: 지적 ${total}건`);
    return 1;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`정적 검사 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
