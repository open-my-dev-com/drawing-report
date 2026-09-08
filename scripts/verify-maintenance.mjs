/**
 * 저장소 전용 정적 검사 게이트 — 미사용 파일·export·의존성을 knip으로 찾아 요약한다.
 *
 * 실행: `pnpm verify:maintenance` (또는 `node scripts/verify-maintenance.mjs`). 소스만 읽으므로
 * 빌드나 브라우저가 없어도 되고, 작업 트리에 아무것도 남기지 않는다.
 *
 * 옵션
 * - `--json <path>`: knip 원본 보고서를 그대로 저장한다.
 *
 * 무엇을 보나
 * - 어디서도 가져오지 않는 파일
 * - 패키지 밖으로 나가지 않는데 `export`가 붙은 이름 (같은 파일에서만 쓰는 것 포함)
 * - `package.json`에 있지만 쓰지 않는 의존성, 반대로 쓰는데 적히지 않은 의존성
 *
 * 진입점과 개별 예외는 `knip.jsonc`에서 까닭과 함께 관리한다. 자식 프로세스나 `node --import`로만
 * 실행하는 파일은 정적 import가 없어 그곳에 진입점으로 적어야 한다.
 *
 * 출력: 종류별 건수 표와 항목 목록을 stdout에 적는다. 지적이 하나라도 있으면 종료 코드 1로 끝난다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFindings, renderReport } from './verify-maintenance/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = '사용법: node scripts/verify-maintenance.mjs [--json <path>]';

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
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 종료 코드와 출력
 */
function runKnip() {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'knip', '--no-progress', '--reporter', 'json'], {
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
 * 검사·요약·종료 코드 결정을 수행한다.
 *
 * @param {string[]} argv - 명령행 인자
 * @returns {Promise<number>} 종료 코드
 * @throws {Error} knip을 실행하지 못하거나 출력이 JSON이 아닐 때
 */
async function main(argv) {
  const options = parseArgs(argv);
  const result = await runKnip();
  const output = result.stdout.trim();
  if (output === '') {
    throw new Error(`knip이 보고서를 내놓지 않았다 (종료 코드 ${result.code})\n${result.stderr.trim()}`);
  }

  let report;
  try {
    report = JSON.parse(output);
  } catch {
    throw new Error(`knip 출력을 JSON으로 읽지 못했다 (종료 코드 ${result.code})\n${output.slice(0, 500)}`);
  }

  if (options.json) {
    mkdirSync(path.dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  }

  const findings = collectFindings(report);
  console.log(renderReport(findings));
  if (options.json) {
    console.log('');
    console.log(`JSON 저장: ${options.json}`);
  }

  if (findings.length > 0) {
    console.error(`정적 검사 실패: 지적 ${findings.length}건`);
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
