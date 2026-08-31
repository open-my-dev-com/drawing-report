/**
 * 작업 디렉터리의 PDF를 `http://127.0.0.1:포트/파일.pdf`로 제공하는 읽기 전용 서버.
 *
 * `httpPort`를 설정하면 렌더 응답에 브라우저에서 열 수 있는 PDF URL을 포함한다.
 * 서버는 127.0.0.1에만 바인딩하며 작업 디렉터리 안의 `.pdf` 파일만 제공한다.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { resolveInRoot } from './storage.js';

/** 같은 작업 디렉터리를 제공하는 링크 서버인지 확인하는 상태 경로 */
const STATUS_PATH = '/slipkit-mcp/status';

/** 로컬호스트로 들어온 요청인지 확인한다 (DNS 리바인딩 차단). */
function isLocalHostHeader(header: string | undefined): boolean {
  if (header === undefined) return false;
  // 포트를 뗀 호스트 이름만 비교한다. IPv6는 대괄호를 벗긴다.
  const name = header.startsWith('[')
    ? header.slice(1, header.indexOf(']'))
    : (header.split(':')[0] ?? '');
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

/** 작업 디렉터리를 비교할 해시값을 만든다. */
function rootToken(rootDir: string): string {
  return createHash('sha256').update(path.resolve(rootDir)).digest('hex');
}

/** PDF 링크 서버의 실행 정보 */
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
 * @param options - PDF 작업 디렉터리와 바인딩할 포트. 0이면 사용 가능한 포트를 자동으로 선택한다.
 * @returns 링크 서버의 주소, 포트와 종료 함수
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
        // 브라우저가 DNS 리바인딩으로 이 서버에 붙는 것을 막는다.
        // 로컬 주소로 들어온 요청만 처리하고 다른 이름의 요청은 거부한다.
        if (!isLocalHostHeader(request.headers.host)) {
          response.writeHead(403).end('Forbidden');
          return;
        }
        const url = new URL(request.url ?? '/', `http://${host}`);
        // 다른 프로세스가 같은 작업 디렉터리의 링크 서버인지 확인할 수 있게 식별 정보를 반환한다.
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
            'x-content-type-options': 'nosniff',
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
 * PDF 링크 서버를 시작하거나 기존 서버를 재사용한다.
 *
 * 지정한 포트를 같은 작업 디렉터리의 SlipKit 링크 서버가 사용 중이면 해당 서버의
 * 주소를 반환한다. 이때 반환되는 `close`는 기존 서버를 종료하지 않는다.
 *
 * @param options - PDF 작업 디렉터리와 바인딩할 포트
 * @returns 링크 서버의 실행 정보. `owned`가 false면 기존 서버를 재사용한 것이다.
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
