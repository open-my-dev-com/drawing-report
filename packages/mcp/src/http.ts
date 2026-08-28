/**
 * 렌더된 PDF를 `http://127.0.0.1:포트/파일.pdf` 링크로 제공하는 읽기 전용 서버.
 *
 * MCP 응답에는 파일을 첨부할 수 없으므로, 설정(`httpPort`)으로 이 서버를 켜면
 * 사용자가 채팅의 링크를 눌러 브라우저에서 PDF를 열고 저장할 수 있다.
 * 로컬 주소(127.0.0.1)에만 바인딩하고, 작업 디렉터리 안의 `.pdf` 파일만 제공한다.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolveInRoot } from './storage.js';

/** {@link startPdfLinkServer}가 반환하는 실행 정보 */
export interface PdfLinkServer {
  /** 링크의 기본 주소 (예: `http://127.0.0.1:8123`) */
  baseUrl: string;
  /** 실제로 바인딩된 포트 */
  port: number;
  /** 서버를 종료한다. */
  close: () => Promise<void>;
}

/**
 * PDF 링크 서버를 시작한다.
 *
 * @param options - 제공할 작업 디렉터리와 포트 (0이면 임의 포트)
 * @returns 기본 주소와 종료 함수
 * @throws Error 포트를 사용할 수 없을 때
 */
export function startPdfLinkServer(options: {
  rootDir: string;
  port: number;
}): Promise<PdfLinkServer> {
  const host = '127.0.0.1';
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== 'GET') {
          response.writeHead(405).end();
          return;
        }
        const url = new URL(request.url ?? '/', `http://${host}`);
        const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        // 작업 디렉터리 안의 .pdf만 제공한다. .slip 등 다른 파일은 노출하지 않는다.
        if (relPath === '' || !relPath.toLowerCase().endsWith('.pdf')) {
          response.writeHead(404).end('Not found');
          return;
        }
        const abs = resolveInRoot(options.rootDir, relPath);
        const data = await readFile(abs);
        response
          .writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': data.length,
            'cache-control': 'no-store',
          })
          .end(data);
      } catch {
        response.writeHead(404).end('Not found');
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        baseUrl: `http://${host}:${port}`,
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
