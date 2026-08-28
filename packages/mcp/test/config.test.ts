import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRETENDARD_FONTS } from '@omdc-slipkit/elements/fonts/pretendard';
import { readConfigFile, resolveServerOptions, SlipMcpConfigError } from '../src/config.js';
import { callText, connect, makeTemplate, makeWorkDir, removeWorkDir } from './helpers.js';

let dir: string;

beforeEach(async () => {
  dir = await makeWorkDir();
});

afterEach(async () => {
  await removeWorkDir(dir);
});

/** 작업 디렉터리에 설정 파일을 쓴다. */
async function writeConfig(config: unknown, name = 'slipkit-mcp.json'): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, JSON.stringify(config), 'utf8');
  return filePath;
}

describe('readConfigFile', () => {
  it('올바른 설정을 읽는다', async () => {
    const filePath = await writeConfig({ rootDir: './slips', locale: 'ko' });
    expect(await readConfigFile(filePath)).toEqual({ rootDir: './slips', locale: 'ko' });
  });

  it('없는 파일·잘못된 JSON·모르는 키를 각각 구분해 안내한다', async () => {
    await expect(readConfigFile(path.join(dir, 'none.json'))).rejects.toThrow(
      /Could not read the config file/,
    );

    const badJson = path.join(dir, 'bad.json');
    await writeFile(badJson, '{ locale: ko', 'utf8');
    await expect(readConfigFile(badJson)).rejects.toThrow(/not valid JSON/);

    const unknownKey = await writeConfig({ locale: 'ko', fontDir: './fonts' });
    await expect(readConfigFile(unknownKey)).rejects.toThrow(SlipMcpConfigError);
  });
});

describe('resolveServerOptions', () => {
  it('설정 파일이 없으면 기본값으로 동작한다', async () => {
    const { options, configPath } = await resolveServerOptions({ cwd: dir, env: {} });
    expect(configPath).toBeNull();
    expect(options).toEqual({ rootDir: dir });
  });

  it('작업 디렉터리의 slipkit-mcp.json을 자동으로 찾고 상대 경로를 해석한다', async () => {
    await mkdir(path.join(dir, 'slips'));
    await writeConfig({ rootDir: './slips', locale: 'ja' });
    const { options, configPath } = await resolveServerOptions({ cwd: dir, env: {} });
    expect(configPath).toBe(path.join(dir, 'slipkit-mcp.json'));
    expect(options.rootDir).toBe(path.join(dir, 'slips'));
    expect(options.locale).toBe('ja');
  });

  it('CLI 인자가 설정 파일 값보다 우선한다', async () => {
    await mkdir(path.join(dir, 'slips'));
    await writeConfig({ rootDir: './slips', locale: 'ja' });
    const { options } = await resolveServerOptions({
      cwd: dir,
      cliRootDir: dir,
      cliLocale: 'ko',
      env: {},
    });
    expect(options.rootDir).toBe(dir);
    expect(options.locale).toBe('ko');
  });

  it('--config로 지정한 파일이 없으면 오류를 안내한다', async () => {
    await expect(
      resolveServerOptions({ cwd: dir, configPath: './none.json', env: {} }),
    ).rejects.toThrow(/Could not read the config file/);
  });

  it('작업 디렉터리가 없으면 오류를 안내한다', async () => {
    await writeConfig({ rootDir: './missing' });
    await expect(resolveServerOptions({ cwd: dir, env: {} })).rejects.toThrow(
      /Working directory not found/,
    );
  });

  it('폰트 파일이 없거나 대체 폰트가 둘이면 오류를 안내한다', async () => {
    await writeConfig({ fonts: [{ name: 'MyFont', path: './fonts/missing.ttf' }] });
    await expect(resolveServerOptions({ cwd: dir, env: {} })).rejects.toThrow(
      /Font file for "MyFont" not found/,
    );

    await writeFile(path.join(dir, 'a.ttf'), 'x');
    await writeFile(path.join(dir, 'b.ttf'), 'x');
    await writeConfig({
      fonts: [
        { name: 'A', path: './a.ttf', fallback: true },
        { name: 'B', path: './b.ttf', fallback: true },
      ],
    });
    await expect(resolveServerOptions({ cwd: dir, env: {} })).rejects.toThrow(
      /Only one font can set "fallback"/,
    );
  });

  it('설정 파일이 지정한 환경변수에서 암호화 키를 읽는다', async () => {
    await writeConfig({ encryption: { keyEnv: 'MY_SLIP_KEY' } });
    const { options } = await resolveServerOptions({
      cwd: dir,
      env: { MY_SLIP_KEY: '비밀-키' },
    });
    expect(options.encryption).toEqual({ key: '비밀-키' });

    // 지정한 환경변수가 비어 있으면 시작하지 않는다
    await expect(resolveServerOptions({ cwd: dir, env: {} })).rejects.toThrow(/MY_SLIP_KEY/);
  });

  it('설정 파일이 없어도 기본 환경변수의 키와 이전 키를 읽는다', async () => {
    const { options } = await resolveServerOptions({
      cwd: dir,
      env: { SLIPKIT_MCP_KEY: '키', SLIPKIT_MCP_PREVIOUS_KEYS: '옛키1, 옛키2' },
    });
    expect(options.encryption).toEqual({ key: '키', previousKeys: ['옛키1', '옛키2'] });
  });
});

describe('httpPort 설정', () => {
  it('httpPort를 읽고, 범위를 벗어나면 거부한다', async () => {
    await writeConfig({ httpPort: 8123 });
    const { httpPort } = await resolveServerOptions({ cwd: dir, env: {} });
    expect(httpPort).toBe(8123);

    await writeConfig({ httpPort: 70000 });
    await expect(resolveServerOptions({ cwd: dir, env: {} })).rejects.toThrow(SlipMcpConfigError);
  });

  it('설정이 없으면 링크 서버를 켜지 않는다', async () => {
    const { httpPort } = await resolveServerOptions({ cwd: dir, env: {} });
    expect(httpPort).toBeNull();
  });
});

describe('커스텀 폰트 렌더링', () => {
  it('설정 파일의 폰트로 PDF를 만든다', async () => {
    // 동봉 폰트 바이트를 파일로 꺼내 커스텀 폰트처럼 지정한다
    await mkdir(path.join(dir, 'fonts'));
    await writeFile(path.join(dir, 'fonts/custom.ttf'), PRETENDARD_FONTS[0]!.data);
    await writeConfig({
      fonts: [{ name: 'Pretendard', path: './fonts/custom.ttf', fallback: true }],
    });

    const { options } = await resolveServerOptions({ cwd: dir, env: {} });
    expect(options.fonts).toHaveLength(1);
    expect(options.fonts![0]!.data.length).toBeGreaterThan(1000);

    const { client, close } = await connect(options);
    try {
      await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
      const rendered = await callText(client, 'slip_render_pdf', { path: 'doc' });
      expect(rendered.isError).toBe(false);
      const pdf = await readFile(path.join(dir, 'doc.pdf'));
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      await close();
    }
  });
});
