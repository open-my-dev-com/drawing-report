#!/usr/bin/env node
/**
 * 깨끗한 소비자 환경에서 패키지 설치를 검증합니다.
 *
 * 워크스페이스에 남은 `dist`에 기대지 않도록 산출물을 지우고 다시 빌드한 뒤, 다섯 패키지를
 * 실제 tarball로 만들어 내용·package.json 선언·정적 검사(publint·attw)를 거치고, npm과 pnpm 임시 소비자
 * 프로젝트에 설치해 Node·Vite·React·Vue·MCP CLI·브라우저 PDF·동봉 폰트 청크 요청 시나리오를 실행합니다. 공개 export 표면은
 * 허용 목록(`verify-packages/fixtures/public-exports.json`)과 대조합니다. 런타임 이름은 Node에서 다섯 패키지를
 * 직접 import해 확인하고, 타입 이름은 `public-types` 시험 프로젝트를 tsc로 검사합니다.
 *
 * 앞 단계가 실패해 실행하지 못한 시나리오는 표에서 지우지 않고 `SKIP` 행으로 남깁니다. 전체 시나리오 수는 늘 같습니다.
 *
 * 사용법: `pnpm verify:packages`
 * 환경변수:
 * - `SLIPKIT_VERIFY_KEEP=1`: 실패를 재현할 수 있도록 임시 디렉터리를 삭제하지 않습니다.
 * - `SLIPKIT_CHROMIUM`: 브라우저 시나리오에 사용할 Chromium 실행 파일입니다. 없으면 Playwright가 관리하는 Chromium을 사용합니다.
 *
 * 소비자 프로젝트는 임시 디렉터리에 만들고 저장소 안의 경로를 참조하지 않습니다. pnpm 소비자는 저장소와 같은
 * pnpm 버전을 `packageManager`로 적고 Corepack(`corepack pnpm`)으로 실행합니다.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import { launchChromium, runFontScenario, countRequests, PHASES, FONT_CHUNK_KINDS } from './bench-fonts/chromium.mjs';
import { writeHostFont } from './bench-fonts/host-font.mjs';
import { manifestProblems } from './verify-packages/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'scripts', 'verify-packages', 'fixtures');
const PACKAGES = ['core', 'elements', 'react', 'vue', 'mcp'];
const KEEP = process.env['SLIPKIT_VERIFY_KEEP'] === '1';

/** 소비자 프로젝트에 고정하는 도구 버전 — 저장소 lockfile로 검증된 값입니다. */
const CONSUMER_DEV_DEPENDENCIES = {
  vite: '7.3.6',
  typescript: '5.9.3',
  react: '19.2.8',
  'react-dom': '19.2.8',
  '@types/react': '19.2.18',
  '@types/react-dom': '19.2.4',
  vue: '3.5.41',
  '@vitejs/plugin-vue': '6.0.8',
  'vue-tsc': '3.3.10',
};

/** pnpm 소비자에 Corepack으로 고정하는 pnpm 버전 — 저장소 루트 package.json의 `packageManager`와 같습니다. */
const CONSUMER_PNPM_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).packageManager.replace(/^pnpm@/, '');

/** 각 tarball에 포함해야 하는 항목과 포함하면 안 되는 항목입니다. */
const REQUIRED_ENTRIES = {
  common: ['package/README.md', 'package/LICENSE', 'package/package.json', 'package/dist/index.js', 'package/dist/index.d.ts'],
  core: ['package/schemas/slip.schema.json', 'package/schemas/slip-0.1.0.schema.json'],
  elements: [
    'package/OFL-Pretendard.txt',
    'package/OFL-NotoSansJP.txt',
    'package/dist/fonts/pretendard.js',
    'package/dist/fonts/noto-sans-jp.js',
    'package/dist/default-fonts.js',
  ],
  mcp: ['package/dist/cli.js'],
};
const FORBIDDEN_ENTRY = /^package\/(src|test|scripts)\/|^package\/(tsup|vitest|vite)\.config\.|^package\/tsconfig/;

/** 소비자 프로젝트에서 Node로 직접 실행하는 시나리오입니다. 이름, 시험 파일과 기대 동작을 정의합니다. */
const NODE_SCENARIOS = [
  ['core ESM import', 'node-esm.mjs', 'parseSlipFile·validateSlipFile·createSlipKit가 동작한다'],
  ['CommonJS require(esm)', 'node-cjs.cjs', 'core와 폰트 하위 경로를 require할 수 있다'],
  ['JSON Schema subpath', 'schema.mjs', '최신·버전 고정 스키마를 하위 경로로 읽는다'],
  ['Node.js PDF', 'node-pdf.mjs', 'PDF 바이트가 %PDF로 시작한다'],
  ['deep import rejected', 'deep-import.mjs', 'dist 내부 경로가 ERR_PACKAGE_PATH_NOT_EXPORTED로 거부된다'],
  ['public exports', 'public-exports.mjs', '다섯 패키지 루트·하위 경로의 런타임 export가 허용 목록과 정확히 같고 뺀 이름이 없다'],
  ['MCP CLI', 'mcp-cli.mjs', 'help·version·사용법 오류·설정 파일 기반 서버 시작이 기준대로 동작한다'],
];

/** 폰트 청크 요청 시나리오의 기대 동작입니다. */
const FONT_REQUESTS_EXPECTED =
  'en: import·elements 단계 폰트 청크 요청 0, resolve 단계 Pretendard 1 + Noto Sans JP 1, share 단계 0, 뷰어 PDF 생성 · user: 모든 단계 폰트 청크 0, host-font.otf 1, 뷰어 PDF 생성';

const results = [];
let failed = false;

/**
 * 명령을 실행하고 stdout·stderr·종료 코드를 모읍니다.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }} [options]
 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 20 * 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.stdin.end(options.input ?? '');
  });
}

/**
 * 시나리오 하나를 실행해 결과를 기록합니다. 실패해도 나머지 시나리오를 계속 실행합니다.
 *
 * @param {string} name
 * @param {string} expected
 * @param {() => Promise<{ command: string; code: number; stdout: string; stderr: string; ok?: boolean; detail?: string }>} body
 */
async function scenario(name, expected, body) {
  const started = Date.now();
  let outcome;
  try {
    outcome = await body();
  } catch (error) {
    outcome = { command: '(script)', code: -1, stdout: '', stderr: error instanceof Error ? error.stack ?? error.message : String(error) };
  }
  const ok = outcome.ok ?? outcome.code === 0;
  results.push({ name, expected, ok, seconds: ((Date.now() - started) / 1000).toFixed(1), ...outcome });
  if (!ok) failed = true;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
  return ok;
}

/**
 * 앞선 단계가 실패해 실행하지 못한 시나리오를 SKIP으로 남깁니다. 표에서 사라지지 않게 해
 * 전체 시나리오 수(분모)를 유지합니다.
 *
 * @param {string} name
 * @param {string} expected
 * @param {string} reason - 건너뛴 이유
 */
function skipScenario(name, expected, reason) {
  results.push({ name, expected, ok: false, skipped: true, command: '(skipped)', code: 0, stdout: '', stderr: '', detail: reason, seconds: '0.0' });
  process.stdout.write(`SKIP  ${name} — ${reason}\n`);
}

/** 실패 보고에 사용할 문자열의 마지막 부분만 반환합니다. */
function tail(text, lines = 40) {
  const all = text.trim().split('\n');
  return all.slice(-lines).join('\n');
}

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), 'slipkit-verify-'));
  const tarballDir = path.join(work, 'tarballs');
  mkdirSync(tarballDir);
  process.stdout.write(`work dir: ${work}\n`);

  try {
    // 1. 기존 산출물을 지우고 다시 빌드합니다.
    await scenario('clean build', '다섯 패키지의 dist를 지운 뒤 빌드가 성공한다', async () => {
      for (const name of PACKAGES) rmSync(path.join(ROOT, 'packages', name, 'dist'), { recursive: true, force: true });
      const build = await run('pnpm', ['-r', '--filter', './packages/*', 'run', 'build']);
      return { command: 'pnpm -r --filter ./packages/* run build', ...build };
    });

    // 2. tarball을 만들고 내용을 검사합니다.
    const tarballs = {};
    for (const name of PACKAGES) {
      const dir = path.join(ROOT, 'packages', name);
      await scenario(`pack dry-run: ${name}`, 'npm pack --dry-run이 성공한다', async () => {
        const dry = await run('npm', ['pack', '--dry-run', '--json'], { cwd: dir });
        return { command: `npm pack --dry-run --json (packages/${name})`, ...dry };
      });
      await scenario(`pack: ${name}`, 'pnpm pack이 tarball을 만들고 필수 파일만 담으며 package.json이 engines.node·license·publishConfig.access를 선언한다', async () => {
        const packed = await run('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: dir });
        if (packed.code !== 0) return { command: `pnpm pack (packages/${name})`, ...packed };
        const file = readdirSync(tarballDir).find((entry) => entry.startsWith(`omdc-slipkit-${name}-`) && entry.endsWith('.tgz'));
        if (file === undefined) return { command: `pnpm pack (packages/${name})`, code: 1, stdout: packed.stdout, stderr: 'tarball not found' };
        tarballs[name] = path.join(tarballDir, file);
        const list = await run('tar', ['-tzf', tarballs[name]]);
        if (list.code !== 0) return { command: `tar -tzf ${file}`, ...list };
        const entries = list.stdout.trim().split('\n');
        const missing = [...REQUIRED_ENTRIES.common, ...(REQUIRED_ENTRIES[name] ?? [])].filter((entry) => !entries.includes(entry));
        const forbidden = entries.filter((entry) => FORBIDDEN_ENTRY.test(entry));
        const manifest = await run('tar', ['-xzOf', tarballs[name], 'package/package.json']);
        const workspaceDeps = manifest.stdout.includes('workspace:');
        const problems = [
          ...missing.map((entry) => `missing ${entry}`),
          ...forbidden.map((entry) => `forbidden ${entry}`),
          ...(workspaceDeps ? ['package.json still contains workspace: dependencies'] : []),
          ...manifestProblems(manifest.stdout),
        ];
        return {
          command: `pnpm pack (packages/${name}) + tar -tzf`,
          code: problems.length === 0 ? 0 : 1,
          stdout: entries.join('\n'),
          stderr: problems.join('\n'),
          detail: `${entries.length} entries`,
        };
      });
    }
    if (Object.keys(tarballs).length !== PACKAGES.length) throw new Error('tarball 생성에 실패해 소비자 검증을 진행할 수 없습니다');

    // 3. 정적 검사 — publint는 tarball을 풀어 검사하고 attw는 tarball을 그대로 받습니다.
    const extractDir = path.join(work, 'extract');
    for (const name of PACKAGES) {
      const target = path.join(extractDir, name);
      mkdirSync(target, { recursive: true });
      await run('tar', ['-xzf', tarballs[name], '-C', target]);
      await scenario(`publint: ${name}`, 'publint가 오류 없이 끝난다', async () => {
        const result = await run('pnpm', ['exec', 'publint', path.join(target, 'package'), '--pack', 'false']);
        return { command: `publint <tarball of ${name}> --pack false`, ...result, detail: tail(result.stdout, 1) };
      });
      // 다섯 패키지는 ESM 전용이고 `require` 조건은 Node 22.13+의 require(esm)으로 같은 ESM 파일을 줍니다.
      // attw의 `esm-only` 프로필이 이 배포 방식에 해당하며, node10 해석과 CJS→ESM 경고를 제외한 나머지 검사는 전부 적용됩니다.
      await scenario(`attw: ${name}`, 'arethetypeswrong(esm-only 프로필)이 문제를 찾지 않는다', async () => {
        const result = await run('pnpm', ['exec', 'attw', '--profile', 'esm-only', tarballs[name]]);
        return { command: `attw --profile esm-only ${path.basename(tarballs[name])}`, ...result, detail: result.code === 0 ? 'No problems found' : tail(result.stdout, 1) };
      });
    }

    // 4. npm·pnpm 소비자 프로젝트를 검증합니다.
    for (const pm of ['npm', 'pnpm']) {
      const consumer = path.join(work, `consumer-${pm}`);
      mkdirSync(consumer);
      cpSync(FIXTURES, consumer, { recursive: true });
      const dependencies = Object.fromEntries(PACKAGES.map((name) => [`@omdc-slipkit/${name}`, `file:${tarballs[name]}`]));
      // pnpm은 tarball 안의 `@omdc-slipkit/*` 의존성(예: mcp → core)을 레지스트리에서 찾으므로, 아직 배포되지 않은
      // 패키지를 같은 tarball로 대체하는 overrides가 필요합니다. npm은 최상위 file: 의존성으로 해소하므로 두지 않습니다.
      // pnpm 소비자는 저장소와 같은 pnpm 버전을 Corepack으로 고정합니다. 임시 디렉터리에서 `pnpm`만 실행하면 Corepack이
      // 최신 pnpm을 고를 수 있고, pnpm 11은 package.json의 `pnpm.overrides`를 읽지 않아 아래 overrides가 무시됩니다.
      const pnpmConsumer = pm === 'pnpm' ? { packageManager: `pnpm@${CONSUMER_PNPM_VERSION}`, pnpm: { overrides: dependencies } } : {};
      writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
        name: `slipkit-consumer-${pm}`,
        private: true,
        type: 'module',
        dependencies,
        devDependencies: CONSUMER_DEV_DEPENDENCIES,
        ...pnpmConsumer,
      }, null, 2));
      const exec = (bin, args, options = {}) =>
        pm === 'npm'
          ? run('npx', ['--no-install', bin, ...args], { cwd: consumer, ...options })
          : run('corepack', ['pnpm', 'exec', bin, ...args], { cwd: consumer, ...options });

      const installed = await scenario(`${pm}: install tarballs`, '다섯 개의 tarball과 고정한 도구 버전이 설치된다', async () => {
        const version = pm === 'npm'
          ? await run('npm', ['--version'], { cwd: consumer })
          : await run('corepack', ['pnpm', '--version'], { cwd: consumer });
        if (version.code !== 0) return { command: `${pm} --version`, ...version };
        const selected = `${pm} ${version.stdout.trim()}`;
        if (pm === 'pnpm' && version.stdout.trim() !== CONSUMER_PNPM_VERSION) {
          return { command: 'corepack pnpm --version', code: 1, stdout: version.stdout, stderr: `expected pnpm ${CONSUMER_PNPM_VERSION}` };
        }
        const result = pm === 'npm'
          ? await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: consumer })
          : await run('corepack', ['pnpm', 'install', '--no-frozen-lockfile', '--reporter=append-only'], { cwd: consumer });
        return { command: pm === 'npm' ? 'npm install' : 'corepack pnpm install', ...result, detail: selected };
      });
      // 5. 소비자 프로젝트 시나리오입니다. 설치가 실패하면 아래 항목을 모두 SKIP으로 남겨 전체 시나리오 수를 유지합니다.
      //    브라우저 PDF 실행은 앞선 빌드가 성공했을 때만 의미가 있어 `needs`로 잇습니다.
      const browserOut = path.join(consumer, 'out', 'browser-pdf');
      const consumerScenarios = [
        ...NODE_SCENARIOS.map(([name, file, expected]) => ({
          name,
          expected,
          run: async () => {
            const result = await run(process.execPath, [file], { cwd: consumer, timeoutMs: 120_000 });
            return { command: `node ${file}`, ...result, detail: tail(result.stdout, 1) };
          },
        })),
        {
          name: 'public types typecheck',
          expected: '허용 목록의 값·타입 이름을 d.ts가 선언하고 뺀 이름은 @ts-expect-error로 없음이 확인된다',
          run: async () => ({ command: 'tsc -p public-types/tsconfig.json', ...(await exec('tsc', ['-p', 'public-types/tsconfig.json'])) }),
        },
        {
          name: 'Vite + Elements build',
          expected: 'vite build가 성공한다',
          run: async () => ({ command: 'vite build elements-app', ...(await exec('vite', ['build', 'elements-app', '--outDir', path.join(consumer, 'out', 'elements'), '--logLevel', 'warn'])) }),
        },
        {
          name: 'React typecheck',
          expected: 'tsc --noEmit이 통과한다',
          run: async () => ({ command: 'tsc -p react-app/tsconfig.json', ...(await exec('tsc', ['-p', 'react-app/tsconfig.json'])) }),
        },
        {
          name: 'React build',
          expected: 'vite build가 성공한다',
          run: async () => ({ command: 'vite build react-app', ...(await exec('vite', ['build', 'react-app', '--outDir', path.join(consumer, 'out', 'react'), '--logLevel', 'warn'])) }),
        },
        {
          name: 'Vue typecheck',
          expected: 'vue-tsc --noEmit이 통과한다',
          run: async () => ({ command: 'vue-tsc -p vue-app/tsconfig.json --noEmit', ...(await exec('vue-tsc', ['-p', 'vue-app/tsconfig.json', '--noEmit'])) }),
        },
        {
          name: 'Vue build',
          expected: 'vite build가 성공한다',
          run: async () => ({ command: 'vite build vue-app', ...(await exec('vite', ['build', 'vue-app', '--outDir', path.join(consumer, 'out', 'vue'), '--logLevel', 'warn'])) }),
        },
        {
          name: 'browser PDF build',
          expected: 'vite build가 성공한다',
          run: async () => ({ command: 'vite build browser-pdf', ...(await exec('vite', ['build', 'browser-pdf', '--outDir', browserOut, '--logLevel', 'warn'])) }),
        },
        {
          name: 'browser PDF (Chromium)',
          expected: '브라우저에서 만든 PDF가 Uint8Array이고 %PDF로 시작한다',
          needs: 'browser PDF build',
          run: () => browserPdfOutcome(pm, consumer, browserOut),
        },
        {
          name: 'font chunk requests (Chromium)',
          expected: FONT_REQUESTS_EXPECTED,
          run: () => fontRequestsOutcome(pm, consumer, extractDir, exec),
        },
      ];

      const passedNames = new Set();
      for (const item of consumerScenarios) {
        const label = `${pm}: ${item.name}`;
        if (!installed) {
          skipScenario(label, item.expected, `${pm} 설치 실패로 실행하지 않음`);
          continue;
        }
        if (item.needs !== undefined && !passedNames.has(item.needs)) {
          skipScenario(label, item.expected, `${item.needs} 실패로 실행하지 않음`);
          continue;
        }
        if (await scenario(label, item.expected, item.run)) passedNames.add(item.name);
      }
    }
  } finally {
    report();
    if (KEEP || failed) {
      process.stdout.write(`\n임시 디렉터리: ${work}${KEEP ? ' (보존)' : ''}\n`);
    }
    if (!KEEP) {
      if (failed) process.stdout.write('실패를 재현하려면 SLIPKIT_VERIFY_KEEP=1로 다시 실행해 임시 디렉터리를 보존하세요.\n');
      rmSync(work, { recursive: true, force: true });
    }
  }
  process.exitCode = failed ? 1 : 0;
}

/**
 * vite preview로 빌드 결과를 제공하고 Playwright Chromium에서 PDF 바이트를 확인합니다.
 *
 * @param {string} pm - 소비자 프로젝트의 패키지 관리자
 * @param {string} consumer - 소비자 프로젝트 경로
 * @param {string} outDir - 빌드 결과 디렉터리
 * @returns {Promise<{ command: string; code: number; stdout: string; stderr: string; ok?: boolean; detail?: string }>} 시나리오 실행 결과
 */
async function browserPdfOutcome(pm, consumer, outDir) {
  const port = 4300 + Math.floor(Math.random() * 500);
  const previewArgs = ['preview', 'browser-pdf', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  // npx·pnpm 래퍼 아래에서 vite가 따로 돌므로 프로세스 그룹으로 띄워 한 번에 끝냅니다. 래퍼만 죽이면 vite가 남아
  // 파이프를 잡고 있어 이 스크립트가 종료되지 않습니다.
  const preview = spawn(pm === 'npm' ? 'npx' : 'corepack', pm === 'npm' ? ['--no-install', 'vite', ...previewArgs] : ['pnpm', 'exec', 'vite', ...previewArgs], {
    cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let previewLog = '';
  preview.stdout.on('data', (chunk) => { previewLog += chunk; });
  preview.stderr.on('data', (chunk) => { previewLog += chunk; });
  const command = `vite preview browser-pdf --port ${port} + playwright chromium`;
  try {
    const url = `http://127.0.0.1:${port}/`;
    const ready = await waitForServer(url, 30_000);
    if (!ready) return { command, code: 1, stdout: previewLog, stderr: 'vite preview did not start' };
    const { chromium } = await import('playwright');
    const executablePath = process.env['SLIPKIT_CHROMIUM'];
    let browser;
    try {
      browser = await chromium.launch(executablePath ? { executablePath } : {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        command, code: 1, stdout: previewLog,
        stderr: `Chromium을 시작하지 못했습니다. SLIPKIT_CHROMIUM으로 실행 파일을 지정하거나 'pnpm exec playwright install chromium'을 실행하세요.\n${message}`,
      };
    }
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(url, { waitUntil: 'load' });
      const summary = await page.evaluate(() => window.__slipkitPdf);
      const ok = summary.isUint8Array === true && summary.head === '%PDF' && summary.length > 0 && errors.length === 0;
      return {
        command, code: ok ? 0 : 1, ok,
        stdout: JSON.stringify(summary),
        stderr: errors.join('\n'),
        detail: `${summary.head} ${summary.length} bytes`,
      };
    } finally {
      await browser.close();
    }
  } finally {
    stopPreview(preview);
  }
}

/**
 * `en`·`user` 시나리오의 단계별 요청이 동봉 폰트 계약과 어긋나는 점을 모읍니다.
 *
 * - `en`: `import`·`elements` 단계에 폰트 청크 요청이 없고, `resolve` 단계에 Pretendard 1 + Noto Sans JP 1,
 *   `share` 단계에는 없습니다. 세 컴포넌트가 같은 Promise를 재사용하며 뷰어가 PDF를 만듭니다.
 * - `user`: 모든 단계에 폰트 청크 요청이 없고 `host-font.otf` 요청이 정확히 1입니다. 뷰어가 PDF를 만듭니다.
 *
 * @param {Record<string, Awaited<ReturnType<typeof runFontScenario>>>} results - 시나리오 이름 → 실행 결과
 * @returns {string[]} 어긋난 점. 비어 있으면 통과
 */
function fontRequestProblems(results) {
  const problems = [];
  const labels = { 'font-pretendard': 'Pretendard 청크', 'font-noto-sans-jp': 'Noto Sans JP 청크' };
  for (const [scenario, result] of Object.entries(results)) {
    for (const error of result.errors) problems.push(`${scenario}: ${error}`);
    for (const name of PHASES) {
      const phase = result.phases[name];
      for (const kind of FONT_CHUNK_KINDS) {
        const expected = scenario === 'en' && name === 'resolve' ? 1 : 0;
        const actual = countRequests(phase.requests, [kind]).count;
        if (actual !== expected) problems.push(`${scenario} ${name}: ${labels[kind]} 요청 ${actual} (기대 ${expected})`);
      }
      for (const request of phase.requests.filter((item) => item.failed && item.kind !== 'pdf-blob')) {
        problems.push(`${scenario} ${name}: 요청 실패 ${request.url}`);
      }
    }
    const hostFont = PHASES.reduce((sum, name) => sum + countRequests(result.phases[name].requests, ['host-font']).count, 0);
    const expectedHostFont = scenario === 'user' ? 1 : 0;
    if (hostFont !== expectedHostFont) problems.push(`${scenario}: host-font.otf 요청 ${hostFont} (기대 ${expectedHostFont})`);
    if (result.phases.share.detail.viewer !== 'pdf') problems.push(`${scenario} share: 뷰어 상태 ${String(result.phases.share.detail.viewer)} (기대 pdf)`);
    if (result.phases.share.detail.form !== 'pdf') problems.push(`${scenario} share: 작성 폼 상태 ${String(result.phases.share.detail.form)} (기대 pdf)`);
  }
  return problems;
}

/**
 * 시나리오의 단계별 폰트 청크·호스트 폰트 요청 수와 전송 바이트를 한 줄로 적습니다.
 *
 * @param {Awaited<ReturnType<typeof runFontScenario>>} result - 실행 결과
 * @returns {string} 예: `import 0 / elements 0 / resolve P1(2,540,719 B)+N1(3,237,095 B) / share 0`
 */
function fontRequestDetail(result) {
  return PHASES.map((name) => {
    const requests = result.phases[name].requests;
    const parts = [
      ['P', countRequests(requests, ['font-pretendard'])],
      ['N', countRequests(requests, ['font-noto-sans-jp'])],
      ['H', countRequests(requests, ['host-font'])],
    ].filter(([, count]) => count.count > 0).map(([tag, count]) => `${tag}${count.count}(${count.bytes.toLocaleString('en-US')} B)`);
    return `${name} ${parts.length === 0 ? '0' : parts.join('+')}`;
  }).join(' / ');
}

/**
 * `font-requests` 시험 페이지를 빌드해 vite preview로 제공하고, Chromium에서 `?scenario=en`·`?scenario=user`를 차례로
 * 실행해 단계별 폰트 청크 요청 수를 검증합니다. 호스트 폰트 파일은 추출한 elements tarball의 Pretendard 청크에서 만듭니다.
 *
 * @param {string} pm - 소비자 프로젝트의 패키지 관리자
 * @param {string} consumer - 소비자 프로젝트 경로
 * @param {string} extractDir - tarball을 푼 디렉터리
 * @param {(bin: string, args: string[], options?: object) => Promise<{ code: number; stdout: string; stderr: string }>} exec - 소비자 프로젝트에서 실행 파일을 부르는 함수
 * @returns {Promise<{ command: string; code: number; stdout: string; stderr: string; ok?: boolean; detail?: string }>} 시나리오 실행 결과
 */
async function fontRequestsOutcome(pm, consumer, extractDir, exec) {
  const outDir = path.join(consumer, 'out', 'font-requests');
  const port = 4300 + Math.floor(Math.random() * 500);
  const command = `vite build font-requests + vite preview --port ${port} + playwright chromium (?scenario=en, ?scenario=user)`;
  await writeHostFont(
    path.join(extractDir, 'elements', 'package', 'dist', 'fonts', 'pretendard.js'),
    path.join(consumer, 'font-requests', 'public', 'host-font.otf'),
  );
  const build = await exec('vite', ['build', 'font-requests', '--outDir', outDir, '--logLevel', 'warn']);
  if (build.code !== 0) return { command, ...build };

  const previewArgs = ['preview', 'font-requests', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  const preview = spawn(pm === 'npm' ? 'npx' : 'corepack', pm === 'npm' ? ['--no-install', 'vite', ...previewArgs] : ['pnpm', 'exec', 'vite', ...previewArgs], {
    cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let previewLog = '';
  preview.stdout.on('data', (chunk) => { previewLog += chunk; });
  preview.stderr.on('data', (chunk) => { previewLog += chunk; });
  try {
    const url = `http://127.0.0.1:${port}/`;
    const ready = await waitForServer(url, 30_000);
    if (!ready) return { command, code: 1, stdout: previewLog, stderr: 'vite preview did not start' };
    let browser;
    try {
      browser = await launchChromium();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        command, code: 1, stdout: previewLog,
        stderr: `Chromium을 시작하지 못했습니다. SLIPKIT_CHROMIUM으로 실행 파일을 지정하거나 'pnpm exec playwright install chromium'을 실행하세요.\n${message}`,
      };
    }
    try {
      const results = {};
      for (const name of ['en', 'user']) results[name] = await runFontScenario(browser, { baseUrl: url, scenario: name });
      const problems = fontRequestProblems(results);
      const summary = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.phases]));
      return {
        command, code: problems.length === 0 ? 0 : 1,
        stdout: JSON.stringify(summary),
        stderr: problems.join('\n'),
        detail: `en: ${fontRequestDetail(results.en)} · user: ${fontRequestDetail(results.user)}`,
      };
    } finally {
      await browser.close();
    }
  } finally {
    stopPreview(preview);
  }
}

/** vite preview와 그 래퍼(npx·pnpm)를 프로세스 그룹째 종료합니다. */
function stopPreview(preview) {
  if (preview.pid === undefined) return;
  try {
    if (process.platform === 'win32') preview.kill();
    else process.kill(-preview.pid, 'SIGTERM');
  } catch {
    preview.kill();
  }
}

/** 서버가 응답할 때까지 기다립니다. */
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

/** 시나리오별 결과 표와 실패 상세를 출력합니다. 건너뛴 시나리오도 SKIP 행으로 남겨 분모를 유지합니다. */
function report() {
  process.stdout.write('\n| 결과 | 시나리오 | 명령 | 기대 | 확인 | 시간(s) |\n|---|---|---|---|---|---|\n');
  for (const item of results) {
    const detail = (item.detail ?? '').replace(/\s+/g, ' ').trim();
    const mark = item.skipped === true ? 'SKIP' : item.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`| ${mark} | ${item.name} | \`${item.command}\` | ${item.expected} | ${detail} | ${item.seconds} |\n`);
  }
  const skipped = results.filter((item) => item.skipped === true);
  const failures = results.filter((item) => !item.ok && item.skipped !== true);
  const passed = results.length - failures.length - skipped.length;
  process.stdout.write(`\n${passed}/${results.length} 통과, 실패 ${failures.length}건, 건너뜀 ${skipped.length}건\n`);
  for (const item of skipped) {
    process.stdout.write(`SKIP ${item.name}: ${item.detail}\n`);
  }
  for (const item of failures) {
    process.stdout.write(`\n=== FAIL ${item.name} (exit ${item.code})\n$ ${item.command}\n`);
    if (item.stdout.trim()) process.stdout.write(`--- stdout\n${tail(item.stdout)}\n`);
    if (item.stderr.trim()) process.stdout.write(`--- stderr\n${tail(item.stderr)}\n`);
  }
}

await main();
