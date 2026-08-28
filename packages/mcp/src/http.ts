/**
 * 렌더된 PDF를 `http://127.0.0.1:포트/파일.pdf` 링크로 제공하는 읽기 전용 서버.
 *
 * MCP 응답에는 파일을 첨부할 수 없으므로, 설정(`httpPort`)으로 이 서버를 켜면
 * 사용자가 채팅의 링크를 눌러 브라우저에서 PDF를 열고 저장할 수 있다.
 * 로컬 주소(127.0.0.1)에만 바인딩하고, 작업 디렉터리 안의 `.pdf` 파일만 제공한다.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { resolveInRoot } from './storage.js';

/** 포트를 차지한 서버가 같은 링크 서버인지 확인하는 상태 응답 경로 */
const STATUS_PATH = '/slipkit-mcp/status';

/** 작업 디렉터리 경로를 그대로 노출하지 않도록 해시로 바꾼 대조 값을 만든다. */
function rootToken(rootDir: string): string {
  return createHash('sha256').update(path.resolve(rootDir)).digest('hex');
}

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
        // 다른 인스턴스가 포트 공유 여부를 판단할 수 있게 서버 이름과 디렉터리 대조 값을 알린다.
        if (url.pathname === STATUS_PATH) {
          const body = JSON.stringify({ server: 'slipkit-mcp', root: rootToken(options.rootDir) });
          response.writeHead(200, { 'content-type': 'application/json' }).end(body);
          return;
        }
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

/**
 * PDF 링크 서버를 시작하거나, 포트를 이미 차지한 같은 서버에 합류한다.
 *
 * Claude Desktop처럼 호스트가 서버 프로세스를 여러 개 띄우면 같은 포트를 두 번 열 수 없다.
 * 포트를 차지한 쪽이 같은 작업 디렉터리를 제공하는 이 링크 서버라면 새로 열지 않고
 * 그 서버의 링크 주소를 그대로 쓴다. 합류한 쪽의 `close`는 원래 서버를 끄지 않는다.
 *
 * @param options - 제공할 작업 디렉터리와 포트
 * @returns 기본 주소와 종료 함수. `owned`가 false면 다른 인스턴스의 서버에 합류한 것이다
 * @throws Error 포트를 다른 프로그램이나 다른 작업 디렉터리의 서버가 쓰고 있을 때
 */
export async function startOrJoinPdfLinkServer(options: {
  rootDir: string;
  port: number;
}): Promise<PdfLinkServer & { owned: boolean }> {
  try {
    return { ...(await startPdfLinkServer(options)), owned: true };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== 'EADDRINUSE') throw error;
  }

  const busyMessage =
    `Port ${options.port} is already in use by another program. ` +
    'Change "httpPort" in the config, or stop the program using the port.';
  const baseUrl = `http://127.0.0.1:${options.port}`;
  let status: { server?: unknown; root?: unknown };
  try {
    const response = await fetch(`${baseUrl}${STATUS_PATH}`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    status = (await response.json()) as { server?: unknown; root?: unknown };
  } catch {
    throw new Error(busyMessage);
  }
  if (status.server !== 'slipkit-mcp' || typeof status.root !== 'string') {
    throw new Error(busyMessage);
  }
  if (status.root !== rootToken(options.rootDir)) {
    throw new Error(
      `Port ${options.port} is used by another slipkit-mcp server with a different working directory. ` +
        'Change "httpPort" in the config.',
    );
  }
  return { baseUrl, port: options.port, close: () => Promise.resolve(), owned: false };
}
