#!/usr/bin/env node
/**
 * `slipkit-mcp` 실행 파일. 표준 입출력(stdio)으로 통신하는 SlipKit MCP 서버를 시작한다.
 * HTTP 등 다른 전송을 쓰려면 `createSlipMcpServer`로 서버를 만들어 직접 연결한다.
 *
 * 사용법: `slipkit-mcp [작업-디렉터리] [--locale ko] [--config 경로]`
 *
 * 저장소 경로, 로케일, 커스텀 폰트와 암호화 키 환경변수 이름은 설정 파일
 * (`slipkit-mcp.json`)로 관리한다. 탐색 순서는 `--config` 인자,
 * `SLIPKIT_MCP_CONFIG` 환경변수, 작업 디렉터리의 `slipkit-mcp.json` 순서이고
 * 설정 파일이 없으면 기본값으로 동작한다.
 *
 * 환경변수:
 * - `SLIPKIT_MCP_CONFIG` — 설정 파일 경로 (`--config`가 우선)
 * - `SLIPKIT_MCP_LOCALE` — 오류 메시지 언어 (`--locale`이 우선)
 * - `SLIPKIT_MCP_KEY` — 파일 암호화 키 (프로세스 목록에 노출되지 않도록 환경변수로만 받는다.
 *   설정 파일 `encryption.keyEnv`로 다른 변수 이름을 지정할 수 있다)
 * - `SLIPKIT_MCP_PREVIOUS_KEYS` — 키를 바꾸기 전에 쓰던 키 목록 (쉼표로 구분)
 */
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveServerOptions, SlipMcpConfigError } from './config.js';
import { createSlipMcpServer } from './server.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { locale: { type: 'string' }, config: { type: 'string' } },
    allowPositionals: true,
  });

  const configPathArg = values.config ?? process.env['SLIPKIT_MCP_CONFIG'];
  const cliLocale = values.locale ?? process.env['SLIPKIT_MCP_LOCALE'];
  const { options, configPath } = await resolveServerOptions({
    ...(configPathArg === undefined ? {} : { configPath: configPathArg }),
    ...(positionals[0] === undefined ? {} : { cliRootDir: positionals[0] }),
    ...(cliLocale === undefined ? {} : { cliLocale }),
    cwd: process.cwd(),
    env: process.env,
  });

  const { server } = createSlipMcpServer(options);
  await server.connect(new StdioServerTransport());
  // stdout은 MCP 메시지 전용이므로 실행 정보는 stderr로 보낸다.
  const notes = [
    configPath === null ? null : `config ${configPath}`,
    options.fonts === undefined ? null : `${options.fonts.length} custom font(s)`,
    options.encryption === undefined ? null : 'encryption on',
  ].filter((note) => note !== null);
  console.error(
    `slipkit-mcp: serving ${options.rootDir}${notes.length ? ` (${notes.join(', ')})` : ''}`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof SlipMcpConfigError) {
    console.error(`slipkit-mcp: ${error.message}`);
  } else {
    console.error(`slipkit-mcp: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
