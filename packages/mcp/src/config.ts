/**
 * `slipkit-mcp.json` 설정 파일 로더.
 *
 * 서버가 자체 설정 파일을 읽어 저장소 경로, 로케일, 커스텀 폰트와 암호화 키
 * 환경변수 이름을 관리한다. AI 클라이언트에는 실행 명령과 설정 파일 경로를 등록한다.
 *
 * 탐색 순서: `--config` 인자 → `SLIPKIT_MCP_CONFIG` 환경변수 → 작업 디렉터리의
 * `slipkit-mcp.json`. 설정 파일이 없으면 기본값으로 동작한다.
 * 작업 디렉터리는 CLI 인자, 로케일은 CLI 인자와 환경변수가 설정 파일보다 우선한다.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SlipFont } from '@omdc-slipkit/core';
import type { SlipMcpServerOptions } from './server.js';

/** 기본 설정 파일 이름 */
export const CONFIG_FILE_NAME = 'slipkit-mcp.json';

/** 암호화 키를 읽을 기본 환경변수 이름 */
export const DEFAULT_KEY_ENV = 'SLIPKIT_MCP_KEY';

/** 이전 키 목록(쉼표 구분)을 읽을 기본 환경변수 이름 */
export const DEFAULT_PREVIOUS_KEYS_ENV = 'SLIPKIT_MCP_PREVIOUS_KEYS';

/** 설정을 읽거나 적용하지 못했을 때 던지는 오류. 메시지가 그대로 시작 실패 안내가 된다. */
export class SlipMcpConfigError extends Error {}

const fontEntrySchema = z.strictObject({
  /** 요소의 `fontName`에서 참조하는 폰트 이름 */
  name: z.string().min(1),
  /** 폰트 파일(ttf·otf) 경로. 설정 파일 위치 기준 상대 경로 */
  path: z.string().min(1),
  /** 대체 폰트 여부. 하나만 지정할 수 있다 */
  fallback: z.boolean().optional(),
});

const configSchema = z.strictObject({
  /** `.slip` 파일을 읽고 쓸 디렉터리. 설정 파일 위치 기준 상대 경로 */
  rootDir: z.string().min(1).optional(),
  /** 오류 메시지 언어 (`ko`, `en`, `ja`) */
  locale: z.string().min(1).optional(),
  /** PDF 렌더링에 사용할 커스텀 폰트. 생략하면 동봉 폰트를 사용한다 */
  fonts: z.array(fontEntrySchema).min(1).optional(),
  /** 암호화 키를 읽을 환경변수 이름 (키 값은 설정 파일에 적지 않는다) */
  encryption: z
    .strictObject({
      keyEnv: z.string().min(1).optional(),
      previousKeysEnv: z.string().min(1).optional(),
    })
    .optional(),
});

/** `slipkit-mcp.json`의 내용 */
export type SlipMcpConfig = z.infer<typeof configSchema>;

/**
 * 설정 파일을 읽고 형식을 검증한다.
 *
 * @param filePath - 설정 파일 경로
 * @returns 검증된 설정
 * @throws SlipMcpConfigError 파일을 읽지 못하거나 JSON·형식이 잘못됐을 때
 */
export async function readConfigFile(filePath: string): Promise<SlipMcpConfig> {
  let textContent: string;
  try {
    textContent = await readFile(filePath, 'utf8');
  } catch {
    throw new SlipMcpConfigError(`Could not read the config file: ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textContent);
  } catch (error) {
    throw new SlipMcpConfigError(
      `The config file is not valid JSON (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new SlipMcpConfigError(`Invalid config file (${filePath}): ${issues}`);
  }
  return parsed.data;
}

/**
 * 설정의 폰트 항목을 읽어 렌더링용 폰트 목록으로 만든다.
 *
 * @param entries - 설정 파일의 `fonts` 항목
 * @param baseDir - 상대 경로의 기준 디렉터리 (설정 파일 위치)
 * @returns 파일에서 읽은 폰트 목록
 * @throws SlipMcpConfigError 폰트 파일이 없거나 대체 폰트가 둘 이상일 때
 */
export async function loadConfigFonts(
  entries: NonNullable<SlipMcpConfig['fonts']>,
  baseDir: string,
): Promise<SlipFont[]> {
  if (entries.filter((entry) => entry.fallback === true).length > 1) {
    throw new SlipMcpConfigError('Only one font can set "fallback": true.');
  }
  const fonts: SlipFont[] = [];
  for (const entry of entries) {
    const abs = path.resolve(baseDir, entry.path);
    let data: Buffer;
    try {
      data = await readFile(abs);
    } catch {
      throw new SlipMcpConfigError(`Font file for "${entry.name}" not found: ${abs}`);
    }
    fonts.push({
      name: entry.name,
      data: new Uint8Array(data),
      ...(entry.fallback === undefined ? {} : { fallback: entry.fallback }),
    });
  }
  return fonts;
}

/** 설정 해석에 필요한 실행 환경 입력 */
export interface ResolveInput {
  /** `--config`로 지정한 설정 파일 경로. 지정했는데 없으면 오류 */
  configPath?: string;
  /** 명령 인자로 지정한 작업 디렉터리 (설정 파일보다 우선) */
  cliRootDir?: string;
  /** 명령 인자 또는 환경변수로 지정한 로케일 (설정 파일보다 우선) */
  cliLocale?: string;
  /** 기준 디렉터리 (기본 설정 파일 탐색과 상대 경로 해석의 출발점) */
  cwd: string;
  /** 환경변수 (암호화 키 조회용) */
  env: Record<string, string | undefined>;
}

/**
 * 설정 파일과 실행 인자를 우선순위대로 합쳐 서버 옵션을 만든다.
 *
 * @param input - 실행 인자·환경변수·기준 디렉터리
 * @returns 서버 옵션과 사용한 설정 파일 경로 (없으면 null)
 * @throws SlipMcpConfigError 설정 파일·폰트·작업 디렉터리가 잘못됐을 때
 */
export async function resolveServerOptions(
  input: ResolveInput,
): Promise<{ options: SlipMcpServerOptions; configPath: string | null }> {
  // 1) 설정 파일 위치를 정한다. 명시한 파일이 없으면 오류, 기본 위치는 없어도 된다.
  let configPath: string | null = null;
  let config: SlipMcpConfig = {};
  if (input.configPath !== undefined) {
    configPath = path.resolve(input.cwd, input.configPath);
    config = await readConfigFile(configPath);
  } else {
    const candidate = path.resolve(input.cliRootDir ?? input.cwd, CONFIG_FILE_NAME);
    if (await fileExists(candidate)) {
      configPath = candidate;
      config = await readConfigFile(candidate);
    }
  }
  const baseDir = configPath === null ? input.cwd : path.dirname(configPath);

  // 2) 작업 디렉터리: CLI 인자 → 설정 파일 → 기준 디렉터리
  const rootDir = path.resolve(
    input.cliRootDir ?? (config.rootDir === undefined ? input.cwd : path.resolve(baseDir, config.rootDir)),
  );
  const info = await stat(rootDir).catch(() => null);
  if (!info?.isDirectory()) {
    throw new SlipMcpConfigError(`Working directory not found: ${rootDir}`);
  }

  // 3) 로케일: CLI 인자·환경변수 → 설정 파일
  const locale = input.cliLocale ?? config.locale;

  // 4) 커스텀 폰트: 없으면 동봉 폰트를 쓰도록 비워 둔다
  const fonts = config.fonts === undefined ? undefined : await loadConfigFonts(config.fonts, baseDir);

  // 5) 암호화 키: 설정 파일이 지정한(또는 기본) 환경변수에서 읽는다
  const keyEnv = config.encryption?.keyEnv ?? DEFAULT_KEY_ENV;
  const previousKeysEnv = config.encryption?.previousKeysEnv ?? DEFAULT_PREVIOUS_KEYS_ENV;
  const key = input.env[keyEnv];
  const previousKeys = input.env[previousKeysEnv]
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (config.encryption?.keyEnv !== undefined && key === undefined) {
    throw new SlipMcpConfigError(
      `The config names encryption key variable "${keyEnv}", but it is not set in the environment.`,
    );
  }

  const options: SlipMcpServerOptions = {
    rootDir,
    ...(locale === undefined ? {} : { locale }),
    ...(fonts === undefined ? {} : { fonts }),
    ...(key === undefined
      ? {}
      : { encryption: { key, ...(previousKeys?.length ? { previousKeys } : {}) } }),
  };
  return { options, configPath };
}

/** 파일이 있는지 확인한다. */
async function fileExists(filePath: string): Promise<boolean> {
  const info = await stat(filePath).catch(() => null);
  return info?.isFile() ?? false;
}
