import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import path from 'node:path';
import {
  createPdfLinkToken,
  startOrJoinPdfLinkServer,
  startPdfLinkServer,
  type PdfLinkServer,
} from '../src/http.js';
import { callText, connect, makeTemplate, makeWorkDir, removeWorkDir, symlinksUnavailable } from './helpers.js';

let dir: string;
let linkServer: PdfLinkServer;
/** 토큰을 뺀 서버 주소 (예: `http://127.0.0.1:8123`) */
let origin: string;

beforeEach(async () => {
  dir = await makeWorkDir();
  linkServer = await startPdfLinkServer({ rootDir: dir, port: 0 });
  origin = `http://127.0.0.1:${linkServer.port}`;
});

afterEach(async () => {
  await linkServer.close();
  await removeWorkDir(dir);
});

/** Host 헤더를 직접 지정해 요청하고 상태 코드를 돌려준다 (fetch는 Host를 바꿀 수 없다). */
function statusWithHost(requestPath: string, host: string | null): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: linkServer.port,
        path: requestPath,
        // Host를 아예 빼려면 헤더 자동 추가를 끈다.
        ...(host === null ? { setHost: false } : { headers: { host } }),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('PDF 링크 서버', () => {
  it('토큰이 든 링크로 작업 디렉터리의 .pdf 파일을 제공한다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    expect(linkServer.baseUrl).toBe(`${origin}/${linkServer.token}`);
    expect(linkServer.token).toMatch(/^[0-9a-f]{64}$/);
    const response = await fetch(`${linkServer.baseUrl}/doc.pdf`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toContain('%PDF');
  });

  it('토큰이 없거나 다른 요청은 파일이 있어도 404다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    expect((await fetch(`${origin}/doc.pdf`)).status).toBe(404);
    expect((await fetch(`${origin}/${createPdfLinkToken()}/doc.pdf`)).status).toBe(404);
    // 앞부분만 같은 토큰도 거부한다.
    expect((await fetch(`${origin}/${linkServer.token.slice(0, -1)}/doc.pdf`)).status).toBe(404);
    expect((await fetch(`${origin}/${linkServer.token}x/doc.pdf`)).status).toBe(404);
    // 토큰 없는 상태 조회는 서버 식별 정보만 주고 토큰을 노출하지 않는다.
    const status = await fetch(`${origin}/slipkit-mcp/status`);
    expect(status.status).toBe(200);
    expect(await status.text()).not.toContain(linkServer.token);
  });

  it('디렉터리 밖 경로와 .pdf가 아닌 파일은 올바른 토큰이라도 거부한다', async () => {
    await writeFile(path.join(dir, 'secret.slip'), '{}');
    expect((await fetch(`${linkServer.baseUrl}/secret.slip`)).status).toBe(404);
    expect((await fetch(`${linkServer.baseUrl}/../outside.pdf`)).status).toBe(404);
    expect((await fetch(`${linkServer.baseUrl}/%2e%2e/outside.pdf`)).status).toBe(404);
    expect((await fetch(`${linkServer.baseUrl}/missing.pdf`)).status).toBe(404);
    expect((await fetch(`${linkServer.baseUrl}/`)).status).toBe(404);
  });

  // Windows에서 링크 생성 권한이 없을 때만 건너뛴다.
  it.skipIf(symlinksUnavailable())('작업 디렉터리 안의 링크를 거쳐 밖에 있는 PDF는 제공하지 않는다', async () => {
    const outside = await makeWorkDir();
    try {
      await writeFile(path.join(outside, 'secret.pdf'), '%PDF-1.7 secret');
      await writeFile(path.join(dir, 'own.pdf'), '%PDF-1.7 own');
      await symlink(path.join(outside, 'secret.pdf'), path.join(dir, 'leak.pdf'), 'file');
      await symlink(outside, path.join(dir, 'shared'), 'dir');
      expect((await fetch(`${linkServer.baseUrl}/leak.pdf`)).status).toBe(404);
      expect((await fetch(`${linkServer.baseUrl}/shared/secret.pdf`)).status).toBe(404);
      // 같은 디렉터리의 실제 파일은 그대로 제공한다.
      expect((await fetch(`${linkServer.baseUrl}/own.pdf`)).status).toBe(200);
      expect(await readdir(outside)).toEqual(['secret.pdf']);
    } finally {
      await removeWorkDir(outside);
    }
  });

  it('GET 이외의 메서드는 405다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    expect((await fetch(`${linkServer.baseUrl}/doc.pdf`, { method: 'POST' })).status).toBe(405);
  });

  it('로컬호스트가 아닌 Host 헤더의 요청은 거부한다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    const linkPath = `/${linkServer.token}/doc.pdf`;
    // DNS 리바인딩으로 붙은 브라우저는 공격자 도메인을 Host에 담아 보낸다.
    expect(await statusWithHost(linkPath, 'attacker.example')).toBe(403);
    expect(await statusWithHost(linkPath, `localhost:${linkServer.port}`)).toBe(200);
    expect(await statusWithHost(linkPath, `127.0.0.1:${linkServer.port}`)).toBe(200);
  });

  it('로컬 주소의 여러 표기를 허용하고 비슷한 이름은 거부한다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    const linkPath = `/${linkServer.token}/doc.pdf`;
    // 호스트 이름은 대소문자를 구분하지 않는다.
    expect(await statusWithHost(linkPath, `LOCALHOST:${linkServer.port}`)).toBe(200);
    expect(await statusWithHost(linkPath, `[::1]:${linkServer.port}`)).toBe(200);
    // Host가 없으면 거부한다 — HTTP/1.1 필수 헤더라 Node가 먼저 400으로 걸러낸다.
    expect(await statusWithHost(linkPath, null)).not.toBe(200);
    // 로컬 주소로 시작할 뿐인 공격자 도메인
    expect(await statusWithHost(linkPath, 'localhost.attacker.example')).toBe(403);
    expect(await statusWithHost(linkPath, '127.0.0.1.attacker.example')).toBe(403);
    // 닫는 괄호가 없는 잘못된 IPv6 표기 — Node의 헤더 해석에서 먼저 400으로 걸린다
    expect(await statusWithHost(linkPath, '[::1')).not.toBe(200);
  });

  it('PDF 응답에 콘텐츠 형식 추측 차단 헤더를 붙인다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    const response = await fetch(`${linkServer.baseUrl}/doc.pdf`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('지정한 토큰으로 서버를 띄우고 형식이 잘못된 토큰은 거부한다', async () => {
    const token = 'shared-token-0123456789';
    const own = await startPdfLinkServer({ rootDir: dir, port: 0, token });
    try {
      await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
      expect(own.token).toBe(token);
      expect((await fetch(`${own.baseUrl}/doc.pdf`)).status).toBe(200);
    } finally {
      await own.close();
    }
    await expect(startPdfLinkServer({ rootDir: dir, port: 0, token: 'short' })).rejects.toThrow(
      /at least 16 characters/,
    );
    await expect(startPdfLinkServer({ rootDir: dir, port: 0, token: 'has/slash-0123456789' })).rejects.toThrow(
      /at least 16 characters/,
    );
  });

  it('같은 작업 디렉터리의 서버가 포트를 쓰고 있으면 같은 토큰을 전달한 경우에만 재사용한다', async () => {
    const joined = await startOrJoinPdfLinkServer({
      rootDir: dir,
      port: linkServer.port,
      token: linkServer.token,
    });
    expect(joined.owned).toBe(false);
    expect(joined.baseUrl).toBe(linkServer.baseUrl);
    expect(joined.token).toBe(linkServer.token);

    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    expect((await fetch(`${joined.baseUrl}/doc.pdf`)).status).toBe(200);

    // 재사용한 서버의 close는 기존 서버를 종료하지 않는다.
    await joined.close();
    expect((await fetch(`${linkServer.baseUrl}/doc.pdf`)).status).toBe(200);
  });

  it('토큰이 없거나 다르면 합류하지 않는다', async () => {
    await expect(startOrJoinPdfLinkServer({ rootDir: dir, port: linkServer.port })).rejects.toThrow(
      /link token to share it/,
    );
    await expect(
      startOrJoinPdfLinkServer({ rootDir: dir, port: linkServer.port, token: createPdfLinkToken() }),
    ).rejects.toThrow(/different link token/);
    // 형식이 잘못된 토큰은 요청해 보지 않고 형식 오류로 거부한다.
    await expect(
      startOrJoinPdfLinkServer({ rootDir: dir, port: linkServer.port, token: 'short' }),
    ).rejects.toThrow(/at least 16 characters/);
  });

  it('토큰이 맞지 않을 때 fallbackToFreePort면 다른 포트에 새 서버를 띄운다', async () => {
    const fallback = await startOrJoinPdfLinkServer({
      rootDir: dir,
      port: linkServer.port,
      fallbackToFreePort: true,
    });
    try {
      expect(fallback.owned).toBe(true);
      expect(fallback.port).not.toBe(linkServer.port);
      expect(fallback.token).not.toBe(linkServer.token);
      await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
      expect((await fetch(`${fallback.baseUrl}/doc.pdf`)).status).toBe(200);
      // 서로의 토큰은 통하지 않는다.
      expect((await fetch(`http://127.0.0.1:${fallback.port}/${linkServer.token}/doc.pdf`)).status).toBe(404);
    } finally {
      await fallback.close();
    }
  });

  it('다른 작업 디렉터리의 서버나 다른 프로그램이 쓰는 포트는 대체 포트를 허용해도 거부한다', async () => {
    await expect(
      startOrJoinPdfLinkServer({
        rootDir: path.join(dir, '..'),
        port: linkServer.port,
        token: linkServer.token,
        fallbackToFreePort: true,
      }),
    ).rejects.toThrow(/different working directory/);

    const foreign = createServer((_, response) => response.writeHead(200).end('hello'));
    await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', () => resolve()));
    const address = foreign.address();
    const foreignPort = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(
        startOrJoinPdfLinkServer({ rootDir: dir, port: foreignPort, fallbackToFreePort: true }),
      ).rejects.toThrow(/already in use by another program/);
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  });

  it('close는 열린 keep-alive 연결이 있어도 끝난다', async () => {
    const own = await startPdfLinkServer({ rootDir: dir, port: 0 });
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    // Node fetch는 기본으로 keep-alive 연결을 유지한다.
    expect((await fetch(`${own.baseUrl}/doc.pdf`)).status).toBe(200);
    await own.close();
    await expect(fetch(`${own.baseUrl}/doc.pdf`)).rejects.toThrow();
  });

  it('렌더 응답에 포함된 링크로 PDF를 조회한다', async () => {
    const { client, close } = await connect({ rootDir: dir, pdfBaseUrl: linkServer.baseUrl });
    try {
      await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
      const rendered = await callText(client, 'slip_render_pdf', { path: 'doc' });
      expect(rendered.isError).toBe(false);
      expect(rendered.text).toContain(`${origin}/${linkServer.token}/doc.pdf`);

      const response = await fetch(`${linkServer.baseUrl}/doc.pdf`);
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('%PDF');
    } finally {
      await close();
    }
  });
});
