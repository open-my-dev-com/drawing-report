/**
 * `slipkit-mcp` 명령줄 인자 해석과 도움말·버전 출력.
 *
 * @remarks
 * 서버 시작 코드와 분리해 두어 설정 파일이나 서버 없이도 인자 처리를 시험할 수 있습니다.
 * 패키지 공개 API에는 포함하지 않습니다.
 */

import { parseArgs } from 'node:util';

/** 빌드 설정이 package.json의 버전으로 바꿔 넣는 상수 */
declare const __SLIPKIT_MCP_VERSION__: string;

/** `--version`이 출력하는 패키지 버전 */
export const PACKAGE_VERSION: string = __SLIPKIT_MCP_VERSION__;

/** `--help`가 stdout에 출력하는 본문 */
export const HELP_TEXT = `Usage: slipkit-mcp [working-directory] [options]

Start the SlipKit MCP server over stdio.

Arguments:
  working-directory        Directory used to read and write .slip files
                           (default: current directory)

Options:
  --config <path>          Path to slipkit-mcp.json
  --locale <locale>        Locale for messages and bundled fallback fonts
                           (for example: ko, en, ja)
  -h, --help               Show this help and exit
  -v, --version            Show the package version and exit

Environment:
  SLIPKIT_MCP_CONFIG       Config file path; overridden by --config
  SLIPKIT_MCP_LOCALE       Message and fallback-font locale; overridden by --locale
  SLIPKIT_MCP_KEY          Encryption key
  SLIPKIT_MCP_PREVIOUS_KEYS
                           Previous encryption keys, separated by commas

Configuration lookup:
  1. --config
  2. SLIPKIT_MCP_CONFIG
  3. slipkit-mcp.json in the working directory

The positional working directory overrides rootDir from the config file.
The locale precedence is --locale, SLIPKIT_MCP_LOCALE, then the config file.
`;

/** 서버를 시작할 때 명령줄에서 받은 값 */
export interface ServeArgs {
  /** 위치 인자로 받은 작업 디렉터리 */
  rootDir?: string;
  /** `--config` 값 */
  configPath?: string;
  /** `--locale` 값 */
  locale?: string;
}

/** 명령줄 인자를 해석한 결과 */
export type CliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'serve'; args: ServeArgs }
  | { kind: 'usage-error'; message: string };

/**
 * 명령줄 인자를 해석합니다.
 *
 * @remarks
 * 모르는 옵션, 옵션 값 누락, 작업 디렉터리 위치 인자 2개 이상은 사용법 오류입니다.
 * 인자가 모두 유효할 때 `--help`와 `--version`이 함께 있으면 `--help`가 우선합니다.
 *
 * @param argv - 실행 파일 뒤의 인자 목록 (`process.argv.slice(2)`)
 * @returns 실행할 명령
 */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return { kind: 'usage-error', message: usageMessage(error) };
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    return {
      kind: 'usage-error',
      message: `unexpected argument '${positionals[1]}' (only one working directory is accepted)`,
    };
  }
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  return {
    kind: 'serve',
    args: {
      ...(positionals[0] === undefined ? {} : { rootDir: positionals[0] }),
      ...(values.config === undefined ? {} : { configPath: values.config }),
      ...(values.locale === undefined ? {} : { locale: values.locale }),
    },
  };
}

const OPTIONS = {
  config: { type: 'string' },
  locale: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** `parseArgs` 오류를 사용자에게 보일 한 줄 원인으로 바꿉니다. */
function usageMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Node의 문구는 따옴표와 마침표가 섞여 있어 원인만 남깁니다.
  return raw.replace(/\.\s*To specify.*$/s, '').replace(/\.$/, '');
}

/** 명령이 쓰는 표준 출력·오류 스트림 */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/**
 * 명령줄 인자대로 도움말·버전을 출력하거나 서버를 시작하고 종료 코드를 돌려줍니다.
 *
 * @remarks
 * 도움말과 버전은 설정 파일·작업 디렉터리·폰트·서버를 건드리지 않습니다.
 * 사용법 오류는 종료 코드 2, 서버 시작 중 오류는 종료 코드 1입니다.
 *
 * @param argv - 실행 파일 뒤의 인자 목록
 * @param io - 표준 출력과 표준 오류에 쓰는 함수
 * @param serve - 서버를 시작하는 함수. 오류를 던지면 메시지를 stderr에 내고 1을 돌려줍니다
 * @returns 프로세스 종료 코드
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  serve: (args: ServeArgs) => Promise<void>,
): Promise<number> {
  const command = parseCliArgs(argv);
  switch (command.kind) {
    case 'help':
      io.stdout(HELP_TEXT);
      return 0;
    case 'version':
      io.stdout(`${PACKAGE_VERSION}\n`);
      return 0;
    case 'usage-error':
      io.stderr(`slipkit-mcp: ${command.message}\nRun 'slipkit-mcp --help' for usage.\n`);
      return 2;
    case 'serve':
      try {
        await serve(command.args);
        return 0;
      } catch (error) {
        io.stderr(`slipkit-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
  }
}
