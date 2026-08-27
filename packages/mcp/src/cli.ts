#!/usr/bin/env node
/**
 * `slipkit-mcp` 실행 파일 — stdio 전송으로 SlipKit MCP 서버를 시작한다.
 *
 * 사용법: `slipkit-mcp [작업-디렉터리] [--locale ko]`
 *
 * 환경변수:
 * - `SLIPKIT_MCP_LOCALE` — 오류 메시지 언어 (`--locale`이 우선)
 * - `SLIPKIT_MCP_KEY` — 파일 암호화 키 (명령 인자는 프로세스 목록에 노출되므로 환경변수만 받는다)
 * - `SLIPKIT_MCP_PREVIOUS_KEYS` — 키를 바꾸기 전에 쓰던 키 목록 (쉼표로 구분)
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSlipMcpServer, type SlipMcpServerOptions } from './server.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { locale: { type: 'string' } },
    allowPositionals: true,
  });

  const rootDir = path.resolve(positionals[0] ?? process.cwd());
  const info = await stat(rootDir).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`slipkit-mcp: working directory not found: ${rootDir}`);
    process.exit(1);
  }

  const locale = values.locale ?? process.env['SLIPKIT_MCP_LOCALE'];
  const key = process.env['SLIPKIT_MCP_KEY'];
  const previousKeys = process.env['SLIPKIT_MCP_PREVIOUS_KEYS']
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  const options: SlipMcpServerOptions = {
    rootDir,
    ...(locale === undefined ? {} : { locale }),
    ...(key === undefined
      ? {}
      : { encryption: { key, ...(previousKeys?.length ? { previousKeys } : {}) } }),
  };

  const { server } = createSlipMcpServer(options);
  await server.connect(new StdioServerTransport());
  // stdout은 MCP 전송에 쓰므로 안내는 stderr로 출력한다.
  console.error(`slipkit-mcp: serving ${rootDir}${key === undefined ? '' : ' (encryption on)'}`);
}

main().catch((error: unknown) => {
  console.error(`slipkit-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
