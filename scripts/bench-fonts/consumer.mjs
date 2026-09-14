/**
 * 측정용 임시 소비자 프로젝트를 만들고 관리합니다. tarball 생성, `npm install`, 시험 페이지 빌드와
 * `vite preview` 실행을 담당합니다.
 *
 * `scripts/verify-packages.mjs`의 소비자 방식을 따릅니다. core·elements를 `pnpm pack`으로 tarball로 만들어
 * `file:` 의존성으로 설치하고, Vite는 같은 고정 버전을 씁니다. 저장소 안의 경로는 참조하지 않습니다.
 */
import { cpSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';

/** 소비자 프로젝트에 고정하는 Vite 버전입니다. `scripts/verify-packages.mjs`의 `CONSUMER_DEV_DEPENDENCIES`와 같습니다. */
const CONSUMER_VITE_VERSION = '7.3.6';

/**
 * 명령을 실행하고 stdout·stderr·종료 코드를 모읍니다.
 *
 * @param {string} command - 실행 파일
 * @param {string[]} args - 인자
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options] - 작업 디렉터리·환경·제한 시간
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 결과
 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 20 * 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

/**
 * 실패한 명령을 오류로 바꿉니다.
 *
 * @param {string} label - 명령 설명
 * @param {{ code: number, stdout: string, stderr: string }} result - `run` 결과
 * @returns {{ code: number, stdout: string, stderr: string }} 같은 결과 (성공일 때)
 */
export function must(label, result) {
  if (result.code !== 0) {
    throw new Error(`${label} 실패 (exit ${result.code})\n${result.stderr.trim()}\n${result.stdout.trim()}`.trim());
  }
  return result;
}

/**
 * 패키지들을 `pnpm pack`으로 tarball로 만듭니다.
 *
 * @param {string} root - 저장소 루트
 * @param {string[]} names - 패키지 디렉터리 이름 (`core`, `elements` …)
 * @param {string} destination - tarball을 둘 디렉터리
 * @returns {Promise<Record<string, string>>} 이름 → tarball 절대 경로
 */
export async function packTarballs(root, names, destination) {
  mkdirSync(destination, { recursive: true });
  const tarballs = {};
  for (const name of names) {
    must(`pnpm pack (packages/${name})`, await run('pnpm', ['pack', '--pack-destination', destination], { cwd: path.join(root, 'packages', name) }));
    const file = readdirSync(destination).find((entry) => entry.startsWith(`omdc-slipkit-${name}-`) && entry.endsWith('.tgz'));
    if (file === undefined) throw new Error(`packages/${name}의 tarball을 찾지 못했습니다.`);
    tarballs[name] = path.join(destination, file);
  }
  return tarballs;
}

/**
 * 임시 소비자 프로젝트를 만들고 tarball과 Vite를 `npm install`합니다.
 *
 * @param {string} consumer - 생성할 소비자 디렉터리
 * @param {Record<string, string>} tarballs - `packTarballs` 결과
 * @returns {Promise<{ elementsDir: string, coreDir: string }>} 설치된 패키지의 실제 경로
 */
export async function installConsumer(consumer, tarballs) {
  mkdirSync(consumer, { recursive: true });
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'slipkit-bench-fonts-consumer',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(Object.entries(tarballs).map(([name, file]) => [`@omdc-slipkit/${name}`, `file:${file}`])),
    devDependencies: { vite: CONSUMER_VITE_VERSION },
  }, null, 2));
  must('npm install', await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: consumer }));
  const installed = (name) => realpathSync(path.join(consumer, 'node_modules', '@omdc-slipkit', name));
  return { elementsDir: installed('elements'), coreDir: installed('core') };
}

/**
 * 시험 데이터를 소비자 프로젝트로 복사합니다. `font-requests` 앱과 이 앱이 가져오는 `template.mjs`가 대상입니다.
 *
 * @param {string} fixtures - `scripts/verify-packages/fixtures`
 * @param {string} consumer - 소비자 디렉터리
 * @returns {string} 복사된 앱 디렉터리
 */
export function copyFixture(fixtures, consumer) {
  const app = path.join(consumer, 'font-requests');
  cpSync(path.join(fixtures, 'font-requests'), app, { recursive: true });
  cpSync(path.join(fixtures, 'template.mjs'), path.join(consumer, 'template.mjs'));
  return app;
}

/**
 * 소비자에 설치된 Vite를 실행합니다.
 *
 * @param {string} consumer - 소비자 디렉터리
 * @param {string[]} args - vite 인자
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 결과
 */
export function vite(consumer, args) {
  return run('npx', ['--no-install', 'vite', ...args], { cwd: consumer });
}

/**
 * `vite preview`를 프로세스 그룹으로 실행하고 응답할 때까지 기다립니다.
 *
 * @param {string} consumer - 소비자 디렉터리
 * @param {string} app - 앱 디렉터리 이름 (`font-requests`)
 * @param {string} outDir - 빌드 결과 디렉터리
 * @returns {Promise<{ url: string, stop: () => void, log: () => string }>} 주소와 종료 함수
 */
export async function startPreview(consumer, app, outDir) {
  const port = 4300 + Math.floor(Math.random() * 500);
  const args = ['--no-install', 'vite', 'preview', app, '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  // npx 아래에서 vite가 따로 돌므로 프로세스 그룹으로 띄워 한 번에 끝냅니다.
  const preview = spawn('npx', args, { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let log = '';
  preview.stdout.on('data', (chunk) => { log += chunk; });
  preview.stderr.on('data', (chunk) => { log += chunk; });
  const stop = () => {
    if (preview.pid === undefined) return;
    try {
      if (process.platform === 'win32') preview.kill();
      else process.kill(-preview.pid, 'SIGTERM');
    } catch {
      preview.kill();
    }
  };
  const url = `http://127.0.0.1:${port}/`;
  if (!(await waitForServer(url, 30_000))) {
    stop();
    throw new Error(`vite preview가 시작되지 않았습니다.\n${log}`);
  }
  return { url, stop, log: () => log };
}

/**
 * 서버가 응답할 때까지 기다립니다.
 *
 * @param {string} url - 확인할 주소
 * @param {number} timeoutMs - 제한 시간
 * @returns {Promise<boolean>} 제한 시간 안에 응답했으면 true
 */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // 아직 뜨지 않았습니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}
