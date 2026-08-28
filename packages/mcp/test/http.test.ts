import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startPdfLinkServer, type PdfLinkServer } from '../src/http.js';
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

  it('렌더 응답에 링크가 포함되고 그 링크로 PDF를 받을 수 있다', async () => {
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
