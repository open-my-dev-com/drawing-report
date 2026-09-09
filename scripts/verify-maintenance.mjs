/**
 * 저장소 전용 정적 검사 게이트입니다. knip으로 미사용 파일·export·의존성을 찾아 요약합니다.
 *
 * 실행: `pnpm verify:maintenance` (또는 `node scripts/verify-maintenance.mjs`). 소스만 읽으므로
 * 빌드나 브라우저가 없어도 되고, 작업 트리에 아무것도 남기지 않습니다.
 *
 * 옵션
 * - `--json <path>`: knip 원본 보고서를 그대로 저장합니다. production 실행 결과는 `.production.json`에 저장합니다.
 *
 * 다음 항목을 확인합니다.
 * 1. `knip.jsonc` 설정이 저장소와 일치하는지 확인합니다. 일치하는 파일이 없는 진입점 glob과 사용처가 사라진
 *    `ignoreDependencies`를 찾습니다. 진입점 하나가 오래된 상태로 남으면 그 아래 파일이 검사 대상에서 빠집니다.
 *    실행 파일 이름·옵션으로만 쓰는 의존성의 근거는 `scripts/verify-maintenance/dependency-evidence.mjs`에
 *    적어 두고, 그 근거가 사라졌는지도 함께 확인합니다.
 * 2. 기본 실행에서는 어디에서도 가져오지 않는 파일, 사용하지 않는 export와 의존성,
 *    `package.json`에 선언하지 않은 의존성을 찾습니다.
 * 3. `--production` 실행에서는 패키지 진입점과 `bin`에서 참조하지 않는 파일과 export를 찾습니다. 시험에서만 사용하는 export와
 *    명령으로만 실행하는 도구 파일은 `scripts/verify-maintenance/production.mjs`의 허용 목록에 이유를
 *    적어 둔 것만 통과합니다. 예제 앱에서만 사용하는 코드는 배포 코드의 사용 근거로 세지 않습니다.
 *
 * 진입점과 개별 예외는 `knip.jsonc`에서 이유와 함께 관리합니다. 자식 프로세스나 `node --import`로만
 * 실행하는 파일은 정적 import가 없어 그곳에 진입점으로 적어야 합니다.
 *
 * 출력: 종류별 건수 표와 항목 목록을 stdout에 적습니다. 문제가 하나라도 있으면 종료 코드 1로 끝납니다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKnipConfig, createReferenceFinder, parseJsonc } from './verify-maintenance/config.mjs';
import { checkDependencyEvidence, createEvidenceFinder } from './verify-maintenance/dependency-evidence.mjs';
import {
  checkProductionExports,
  checkProductionFiles,
  exportFindings,
  fileFindings,
  renderProductionReport,
} from './verify-maintenance/production.mjs';
import { collectFindings, formatFinding, renderReport } from './verify-maintenance/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = '사용법: node scripts/verify-maintenance.mjs [--json <path>]';

/** 파일 목록을 만들 때 제외하는 디렉터리입니다. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo']);

/**
 * 명령행 인자를 읽습니다.
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
      if (value === undefined) throw new Error(`--json 뒤에 저장할 파일 경로가 필요합니다.\n${USAGE}`);
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
 * knip을 JSON 보고 방식으로 실행합니다.
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
 * knip 실행 결과를 보고서 객체로 읽습니다.
 *
 * @param {{ code: number, stdout: string, stderr: string }} result - `runKnip` 결과
 * @param {string} label - 실패 메시지에 적을 실행 이름
 * @returns {object} 파싱한 보고서
 * @throws {Error} 출력이 비었거나 JSON이 아닐 때
 */
function readReport(result, label) {
  const output = result.stdout.trim();
  if (output === '') {
    throw new Error(`knip(${label})이 보고서를 출력하지 않았습니다. 종료 코드: ${result.code}\n${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`knip(${label}) 출력을 JSON으로 읽지 못했습니다. 종료 코드: ${result.code}\n${output.slice(0, 500)}`);
  }
}

/**
 * 디렉터리 아래의 파일 경로를 모읍니다. 산출물·의존성 디렉터리는 들어가지 않습니다.
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

/** 워크스페이스를 찾을 때 사용하는 매니페스트 파일 이름입니다. */
const MANIFEST = 'package.json';

/**
 * 저장소의 워크스페이스 디렉터리를 모읍니다. `package.json`이 있는 디렉터리와 저장소 루트를 반환합니다.
 *
 * @param {string[]} files - 루트 기준 파일 경로 목록 (`/` 구분)
 * @returns {string[]} 루트 기준 디렉터리 경로 목록 (`/` 구분). 루트는 `.`
 */
function workspaceDirsFrom(files) {
  const dirs = new Set(['.']);
  for (const file of files) {
    if (file.endsWith(`/${MANIFEST}`)) dirs.add(file.slice(0, -(MANIFEST.length + 1)));
  }
  return [...dirs].sort();
}

/**
 * 워크스페이스 안에 든 다른 워크스페이스의 디렉터리를 그 워크스페이스 기준 경로로 반환합니다.
 *
 * @param {string} name - 기준 워크스페이스 이름 (루트 기준 경로, 루트는 `.`)
 * @param {string[]} workspaceDirs - 저장소 루트를 기준으로 한 모든 워크스페이스 디렉터리
 * @returns {string[]} `name` 안에 든 워크스페이스의 `name` 기준 경로 목록
 */
function nestedWorkspacesOf(name, workspaceDirs) {
  const prefix = name === '.' ? '' : `${name}/`;
  return workspaceDirs
    .filter((dir) => dir !== '.' && dir !== name && dir.startsWith(prefix))
    .map((dir) => dir.slice(prefix.length));
}

/**
 * `knip.jsonc`가 저장소 내용과 맞는지 확인합니다.
 *
 * @param {object} config - 파싱한 knip 설정
 * @returns {string[]} 어긋난 점
 */
function knipConfigProblems(config) {
  const repoFiles = collectFiles(ROOT);
  const workspaceDirs = workspaceDirsFrom(repoFiles);
  const files = {};
  const nestedWorkspaces = {};
  for (const name of Object.keys(config.workspaces ?? {})) {
    const dir = path.resolve(ROOT, name);
    let owned;
    if (name === '.') {
      owned = repoFiles;
    } else {
      try {
        owned = collectFiles(dir);
      } catch {
        continue;
      }
    }
    files[name] = owned;
    nestedWorkspaces[name] = nestedWorkspacesOf(name, workspaceDirs);
  }
  const readFile = (workspace, file) => {
    try {
      return readFileSync(path.resolve(ROOT, workspace, file), 'utf8');
    } catch {
      return '';
    }
  };
  const hasToken = (workspace, file, token) => readFile(workspace, file).includes(token);
  const importsName = createReferenceFinder({ config, files, nestedWorkspaces, readFile });
  const hasEvidence = createEvidenceFinder({ hasToken, nestedWorkspaces });
  const hasReference = (workspace, dependency) =>
    importsName(workspace, dependency) || hasEvidence(workspace, dependency);
  return [
    ...checkKnipConfig({ config, files, hasReference, workspaceDirs }),
    ...checkDependencyEvidence({ config, hasToken, nestedWorkspaces }),
  ];
}

/** 허용 목록의 근거를 확인하기 위해 파일에 해당 이름이 있는지 검사합니다. */
function fileHasName(file, name) {
  try {
    return new RegExp(`\\b${name}\\b`).test(readFileSync(path.resolve(ROOT, file), 'utf8'));
  } catch {
    return false;
  }
}

/**
 * 검사·요약·종료 코드 결정을 수행합니다.
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
      ? '문제가 없습니다. 모든 진입점 glob이 파일과 일치하고 ignoreDependencies가 실제로 사용하는 의존성을 가리킵니다.'
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

  const productionFindings = collectFindings(production);
  const productionResult = {
    exports: checkProductionExports(exportFindings(productionFindings), undefined, fileHasName),
    files: checkProductionFiles(fileFindings(productionFindings)),
  };
  console.log(renderProductionReport(productionResult, formatFinding));
  if (options.json) {
    console.log('');
    console.log(`JSON 저장: ${options.json}`);
  }

  const total =
    configProblems.length +
    findings.length +
    productionResult.exports.unexpected.length +
    productionResult.exports.stale.length +
    productionResult.files.unexpected.length +
    productionResult.files.stale.length;
  if (total > 0) {
    console.error(`정적 검사 실패: 문제 ${total}건`);
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
