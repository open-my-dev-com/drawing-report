import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { startOrJoinPdfLinkServer, startPdfLinkServer, type PdfLinkServer } from '../src/http.js';
import { callText, connect, makeTemplate, makeWorkDir, removeWorkDir } from './helpers.js';

let dir: string;
let linkServer: PdfLinkServer;

beforeEach(async () => {
  dir = await makeWorkDir();
  linkServer = await startPdfLinkServer({ rootDir: dir, port: 0 });
});

afterEach(async () => {
  await linkServer.close();
  await removeWorkDir(dir);
});

describe('PDF 링크 서버', () => {
  it('작업 디렉터리의 .pdf 파일을 제공한다', async () => {
    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    const response = await fetch(`${linkServer.baseUrl}/doc.pdf`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toContain('%PDF');
  });

  it('디렉터리 밖 경로와 .pdf가 아닌 파일은 거부한다', async () => {
    await writeFile(path.join(dir, 'secret.slip'), '{}');
    expect((await fetch(`${linkServer.baseUrl}/secret.slip`)).status).toBe(404);
    expect((await fetch(`${linkServer.baseUrl}/../outside.pdf`)).status).toBe(404);
    expect((await fetch(`${linkServer.baseUrl}/missing.pdf`)).status).toBe(404);
  });

  it('같은 작업 디렉터리의 서버가 포트를 쓰고 있으면 기존 서버를 재사용한다', async () => {
    const joined = await startOrJoinPdfLinkServer({ rootDir: dir, port: linkServer.port });
    expect(joined.owned).toBe(false);
    expect(joined.baseUrl).toBe(linkServer.baseUrl);

    await writeFile(path.join(dir, 'doc.pdf'), '%PDF-1.7 test');
    expect((await fetch(`${joined.baseUrl}/doc.pdf`)).status).toBe(200);

    // 재사용한 서버의 close는 기존 서버를 종료하지 않는다.
    await joined.close();
    expect((await fetch(`${linkServer.baseUrl}/doc.pdf`)).status).toBe(200);
  });

  it('다른 작업 디렉터리의 서버나 다른 프로그램이 쓰는 포트는 거부한다', async () => {
    await expect(
      startOrJoinPdfLinkServer({ rootDir: path.join(dir, '..'), port: linkServer.port }),
    ).rejects.toThrow(/different working directory/);

    const foreign = createServer((_, response) => response.writeHead(200).end('hello'));
    await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', () => resolve()));
    const address = foreign.address();
    const foreignPort = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(startOrJoinPdfLinkServer({ rootDir: dir, port: foreignPort })).rejects.toThrow(
        /already in use by another program/,
      );
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  });

  it('렌더 응답에 포함된 링크로 PDF를 조회한다', async () => {
    const { client, close } = await connect({ rootDir: dir, pdfBaseUrl: linkServer.baseUrl });
    try {
      await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
      const rendered = await callText(client, 'slip_render_pdf', { path: 'doc' });
      expect(rendered.isError).toBe(false);
      expect(rendered.text).toContain(`${linkServer.baseUrl}/doc.pdf`);

      const response = await fetch(`${linkServer.baseUrl}/doc.pdf`);
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('%PDF');
    } finally {
      await close();
    }
  });
});
