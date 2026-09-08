/**
 * 작업 디렉터리의 PDF를 `http://127.0.0.1:포트/<토큰>/파일.pdf`로 제공하는 읽기 전용 서버.
 *
 * `httpPort`를 설정하면 렌더 응답에 브라우저에서 열 수 있는 PDF URL을 포함한다.
 * 서버는 127.0.0.1에만 바인딩하며 작업 디렉터리 안의 `.pdf` 파일만 제공한다.
 * 심볼릭 링크를 거쳐 작업 디렉터리 밖에 있는 파일은 제공하지 않는다.
 * 링크에는 프로세스마다 새로 만드는 난수 접근 토큰이 들어가므로, 같은 컴퓨터의 다른 프로그램이나
 * 브라우저 페이지가 파일 이름만 알고 PDF를 읽어 갈 수 없다. 토큰은 프로세스 밖으로 나가지 않아
 * 다른 프로세스가 이미 떠 있는 링크 서버를 함께 쓰지는 못한다.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { assertInsideRootReal, resolveInRoot } from './storage.js';

/** 같은 작업 디렉터리를 제공하는 링크 서버인지 확인하는 상태 경로 (토큰 없이 조회할 수 있다) */
const STATUS_PATH = '/slipkit-mcp/status';

/** 로컬호스트로 들어온 요청인지 확인한다 (DNS 리바인딩 차단). */
function isLocalHostHeader(header: string | undefined): boolean {
  if (header === undefined) return false;
  // 호스트 이름은 대소문자를 구분하지 않는다.
  const value = header.toLowerCase();
  let name: string;
  if (value.startsWith('[')) {
    // IPv6는 대괄호를 벗긴다. 닫는 괄호가 없으면 형식이 잘못된 것이다.
    const end = value.indexOf(']');
    if (end < 0) return false;
    name = value.slice(1, end);
  } else {
    name = value.split(':')[0] ?? '';
  }
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

/** 작업 디렉터리를 비교할 해시값을 만든다. */
function rootToken(rootDir: string): string {
  return createHash('sha256').update(path.resolve(rootDir)).digest('hex');
}

/**
 * 프로세스별 접근 토큰을 만든다.
 *
 * @returns 32바이트 난수의 16진수 문자열
 */
export function createPdfLinkToken(): string {
  return randomBytes(32).toString('hex');
}

/** 두 토큰이 같은지 길이가 다를 때도 일정한 시간에 비교한다. */
function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** PDF 링크 서버의 실행 정보 */
export interface PdfLinkServer {
  /** 링크의 기본 주소. 접근 토큰을 포함한다 (예: `http://127.0.0.1:8123/<token>`) */
  baseUrl: string;
  /** 실제로 바인딩된 포트 */
  port: number;
  /** 링크에 필요한 접근 토큰. 이 토큰이 없거나 다른 요청은 404를 받는다 */
  token: string;
  /** 서버를 종료한다. 열린 연결도 함께 끊는다. */
  close: () => Promise<void>;
}

/**
 * PDF 링크 서버를 시작한다.
 *
 * @param options - PDF 작업 디렉터리, 바인딩할 포트(0이면 자동 선택)
 * @returns 링크 서버의 주소, 포트, 토큰과 종료 함수
 * @throws Error 포트를 사용할 수 없을 때
 */
export async function startPdfLinkServer(options: {
  rootDir: string;
  port: number;
}): Promise<PdfLinkServer> {
  const host = '127.0.0.1';
  const token = createPdfLinkToken();
  const statusBody = JSON.stringify({ server: 'slipkit-mcp', root: rootToken(options.rootDir) });
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
        // 토큰은 돌려주지 않는다.
        if (url.pathname === STATUS_PATH) {
          response.writeHead(200, { 'content-type': 'application/json' }).end(statusBody);
          return;
        }
        // 첫 경로 조각이 접근 토큰이다. 토큰이 없거나 다르면 파일 유무를 알리지 않고 404로 답한다.
        const [, givenToken = '', ...rest] = url.pathname.split('/');
        if (!tokenMatches(token, givenToken)) {
          response.writeHead(404).end('Not found');
          return;
        }
        const relPath = decodeURIComponent(rest.join('/')).replace(/^\/+/, '');
        // 작업 디렉터리 안의 .pdf만 제공한다. .slip 등 다른 파일은 노출하지 않는다.
        if (relPath === '' || !relPath.toLowerCase().endsWith('.pdf')) {
          response.writeHead(404).end('Not found');
          return;
        }
        const abs = resolveInRoot(options.rootDir, relPath);
        // 링크를 거쳐 작업 디렉터리 밖에 있는 파일도 제공하지 않는다.
        await assertInsideRootReal(options.rootDir, abs, undefined, relPath);
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
        baseUrl: `http://${host}:${port}/${token}`,
        port,
        token,
        close: () =>
          new Promise((done) => {
            // keep-alive로 열린 연결이 종료를 붙들지 않게 먼저 끊는다.
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

/**
 * 지정한 포트에 PDF 링크 서버를 시작한다. 그 포트를 이미 다른 프로세스가 쓰고 있으면
 * 무엇이 쓰고 있는지 확인해 대체 포트로 옮기거나 원인을 알리는 오류를 던진다.
 *
 * 접근 토큰은 프로세스마다 새로 만들고 밖으로 알리지 않으므로 이미 떠 있는 서버를 함께 쓰지는 않는다.
 * 같은 작업 디렉터리의 SlipKit 링크 서버가 그 포트를 쓰고 있으면 `fallbackToFreePort`가 true일 때만
 * 자동 선택한 다른 포트에 새 서버를 띄운다.
 *
 * @param options - PDF 작업 디렉터리, 바인딩할 포트, 포트가 막혔을 때 다른 포트로 대체할지
 * @returns 링크 서버의 주소, 포트, 토큰과 종료 함수
 * @throws Error 포트를 다른 프로그램이나 다른 작업 디렉터리의 서버가 쓰고 있을 때, 또는 대체 포트를 허용하지 않았을 때
 */
export async function startOrJoinPdfLinkServer(options: {
  rootDir: string;
  port: number;
  fallbackToFreePort?: boolean;
}): Promise<PdfLinkServer> {
  const startOptions = { rootDir: options.rootDir, port: options.port };
  try {
    return await startPdfLinkServer(startOptions);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== 'EADDRINUSE') throw error;
  }

  const busyMessage =
    `Port ${options.port} is already in use by another program. ` +
    'Change "httpPort" in the config, or stop the program using the port.';
  const origin = `http://127.0.0.1:${options.port}`;
  let status: { server?: unknown; root?: unknown };
  try {
    const response = await fetch(`${origin}${STATUS_PATH}`, { signal: AbortSignal.timeout(1500) });
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

  // 같은 작업 디렉터리의 서버다. 링크 토큰은 프로세스 밖으로 나가지 않으므로 그 서버를 함께 쓰지 않고
  // 빈 포트에 새 서버를 띄운다.
  if (options.fallbackToFreePort === true) {
    return startPdfLinkServer({ ...startOptions, port: 0 });
  }
  throw new Error(
    `Port ${options.port} is used by another slipkit-mcp server for this working directory. ` +
      'Change "httpPort" in the config, or stop that server.',
  );
}
