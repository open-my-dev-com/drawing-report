#!/usr/bin/env node
/**
 * `slipkit-mcp` 실행 파일. 표준 입출력(stdio)으로 통신하는 SlipKit MCP 서버를 시작한다.
 * HTTP 등 다른 전송을 쓰려면 `createSlipMcpServer`로 서버를 만들어 직접 연결한다.
 *
 * 사용법: `slipkit-mcp [작업-디렉터리] [--locale ko] [--config 경로]`
 * `--help`는 사용법을, `--version`은 패키지 버전을 stdout에 출력하고 서버를 시작하지 않는다.
 *
 * 저장소 경로, 로케일, 커스텀 폰트, PDF 링크 포트와 암호화 키 환경변수 이름은
 * 설정 파일(`slipkit-mcp.json`)로 관리한다. 탐색 순서는 `--config` 인자,
 * `SLIPKIT_MCP_CONFIG` 환경변수, 작업 디렉터리의 `slipkit-mcp.json` 순서이고
 * 설정 파일이 없으면 기본값으로 동작한다.
 *
 * 환경변수:
 * - `SLIPKIT_MCP_CONFIG` — 설정 파일 경로 (`--config`가 우선)
 * - `SLIPKIT_MCP_LOCALE` — 오류 메시지 언어 (`--locale`이 우선)
 * - `SLIPKIT_MCP_KEY` — 파일 암호화 키 (프로세스 목록에 노출되지 않도록 환경변수로만 받는다.
 *   설정 파일 `encryption.keyEnv`로 다른 변수 이름을 지정할 수 있다)
 * - `SLIPKIT_MCP_PREVIOUS_KEYS` — 키를 바꾸기 전에 쓰던 키 목록 (쉼표로 구분)
 *
 * 종료 코드: 정상 0, 설정·서버 시작 오류 1, 사용법 오류 2.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { runCli, type ServeArgs } from './cli-command.js';
import { resolveServerOptions } from './config.js';
import { startOrJoinPdfLinkServer } from './http.js';
import { createSlipMcpServer } from './server.js';

/** 설정을 읽고 stdio 서버를 시작한다. 오류는 호출부가 stderr와 종료 코드 1로 처리한다. */
async function serve(args: ServeArgs): Promise<void> {
  const configPathArg = args.configPath ?? process.env['SLIPKIT_MCP_CONFIG'];
  const cliLocale = args.locale ?? process.env['SLIPKIT_MCP_LOCALE'];
  const { options, configPath, httpPort } = await resolveServerOptions({
    ...(configPathArg === undefined ? {} : { configPath: configPathArg }),
    ...(args.rootDir === undefined ? {} : { cliRootDir: args.rootDir }),
    ...(cliLocale === undefined ? {} : { cliLocale }),
    cwd: process.cwd(),
    env: process.env,
  });

  // httpPort가 있으면 렌더된 PDF를 브라우저에서 열 수 있는 URL로 제공한다.
  // 같은 작업 디렉터리의 링크 서버가 해당 포트를 사용 중이면 기존 서버를 재사용한다.
  let sharedLinkServer = false;
  if (httpPort !== null) {
    const linkServer = await startOrJoinPdfLinkServer({ rootDir: options.rootDir, port: httpPort });
    options.pdfBaseUrl = linkServer.baseUrl;
    sharedLinkServer = !linkServer.owned;
  }

  const { server } = createSlipMcpServer(options);
  await server.connect(new StdioServerTransport());
  // stdout은 MCP 메시지 전용이므로 실행 정보는 stderr로 보낸다.
  const notes = [
    configPath === null ? null : `config ${configPath}`,
    options.pdfBaseUrl === undefined
      ? null
      : `pdf links at ${options.pdfBaseUrl}${sharedLinkServer ? ' (shared server)' : ''}`,
    options.fonts === undefined ? null : `${options.fonts.length} custom font(s)`,
    options.encryption === undefined ? null : 'encryption on',
  ].filter((note) => note !== null);
  console.error(
    `slipkit-mcp: serving ${options.rootDir}${notes.length ? ` (${notes.join(', ')})` : ''}`,
  );
}

const code = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  serve,
);
// 서버가 떠 있는 동안(0)은 프로세스를 유지하고, 오류일 때만 바로 끝낸다.
if (code !== 0) process.exit(code);
