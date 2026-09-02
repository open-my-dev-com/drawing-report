// 설치된 slipkit-mcp 실행 파일: help·version·사용법 오류와 설정 파일 기반 서버 시작을 확인한다.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 소비자가 쓰는 그대로 `node_modules/.bin/slipkit-mcp` 링크를 실행한다. package.json은 exports에 없으므로
// 진입점(dist/index.js) 위치에서 거슬러 올라가 기대 버전을 읽는다.
const bin = path.resolve('node_modules', '.bin', process.platform === 'win32' ? 'slipkit-mcp.cmd' : 'slipkit-mcp');
if (!existsSync(bin)) throw new Error(`bin link missing: ${bin}`);
const entry = fileURLToPath(import.meta.resolve('@omdc-slipkit/mcp'));
const expectedVersion = JSON.parse(readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')).version;

function run(args, { closeStdin = false, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      // 서버가 뜬 것을 stderr로 확인한 뒤 stdin을 닫아 종료시킨다.
      if (closeStdin && stderr.includes('serving')) child.stdin.end();
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout: ${args.join(' ')}`)); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    if (!closeStdin) child.stdin.end();
  });
}

const help = await run(['--help']);
if (help.code !== 0 || !help.stdout.startsWith('Usage: slipkit-mcp') || help.stderr !== '') {
  throw new Error(`--help: code ${help.code} stderr ${JSON.stringify(help.stderr)}`);
}
const version = await run(['--version']);
if (version.code !== 0 || version.stdout !== `${expectedVersion}\n` || version.stderr !== '') {
  throw new Error(`--version: code ${version.code} stdout ${JSON.stringify(version.stdout)}`);
}
const usage = await run(['--bogus']);
if (usage.code !== 2 || usage.stdout !== '' || !usage.stderr.includes("Run 'slipkit-mcp --help' for usage.")) {
  throw new Error(`--bogus: code ${usage.code} stderr ${JSON.stringify(usage.stderr)}`);
}

const workDir = path.resolve('mcp-work');
mkdirSync(workDir, { recursive: true });
const configPath = path.resolve('slipkit-mcp.json');
writeFileSync(configPath, JSON.stringify({ rootDir: './mcp-work', locale: 'en' }));
const serve = await run(['--config', configPath], { closeStdin: true });
if (serve.code !== 0 || serve.stdout !== '' || !serve.stderr.includes(`config ${configPath}`)) {
  throw new Error(`serve: code ${serve.code} stdout ${JSON.stringify(serve.stdout)} stderr ${JSON.stringify(serve.stderr)}`);
}
console.log('mcp cli ok');
