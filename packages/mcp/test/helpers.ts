/** MCP 서버·저장소 테스트 공용 도우미. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CURRENT_SCHEMA_VERSION, type SlipTemplateFile } from '@omdc-slipkit/core';
import { createSlipMcpServer, type SlipMcpServerOptions } from '../src/server.js';

/** 임시 작업 디렉터리를 만든다. */
export function makeWorkDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'slipkit-mcp-'));
}

/** 임시 작업 디렉터리를 지운다. */
export function removeWorkDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

/** 1x1 투명 PNG의 base64 */
export const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 테스트용 최소 양식. 필드·그리드·이미지 요소와 목록 파라미터를 포함한다. */
export function makeTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '거래명세서' },
      paper: { width: 210, height: 297, padding: [15, 15, 15, 15] },
      pages: [
        {
          elements: [
            {
              type: 'text',
              id: 'title',
              name: '제목',
              position: { x: 15, y: 20 },
              width: 180,
              height: 10,
              content: '거래명세서',
              fontSize: 18,
              alignment: 'center',
            },
            {
              type: 'field',
              id: 'customer',
              name: '고객명',
              position: { x: 15, y: 35 },
              width: 90,
              height: 8,
              parameter: 'customerName',
            },
            {
              type: 'image',
              id: 'logo',
              name: '로고',
              position: { x: 150, y: 35 },
              width: 30,
              height: 15,
              src: `data:image/png;base64,${TINY_PNG_B64}`,
            },
            {
              type: 'grid',
              id: 'items-table',
              name: '품목표',
              position: { x: 15, y: 60 },
              columns: [{ width: 120 }, { width: 60 }],
              rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
              cells: [
                { row: 0, column: 0, content: '품명' },
                { row: 0, column: 1, content: '금액' },
                { row: 1, column: 0, parameter: 'name' },
                { row: 1, column: 1, parameter: 'amount' },
                { row: 2, column: 0, content: '합계' },
                { row: 2, column: 1, formula: 'SUM(items.amount)' },
              ],
              repeat: {
                parameter: 'items',
                bands: [
                  { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
                  { id: 'items-item', fromRow: 1, toRow: 1, placement: 'item' },
                  { id: 'items-total', fromRow: 2, toRow: 2, placement: 'after-data' },
                ],
                pagination: { mode: 'fixed', itemsPerPage: 3 },
              },
            },
          ],
        },
      ],
      assets: [],
      parameters: [
        { key: 'customerName', label: '고객명' },
        {
          key: 'items',
          label: '품목',
          valueType: 'list',
          fields: [
            { key: 'name', label: '품명' },
            { key: 'amount', label: '금액', valueType: 'number' },
          ],
        },
      ],
    },
  };
}

/** 서버와 연결된 클라이언트 쌍을 만든다. */
export async function connect(options: SlipMcpServerOptions): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const { server } = createSlipMcpServer(options);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** 도구를 호출하고 첫 텍스트 응답을 반환한다. */
export async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  const first = content.find((entry) => entry.type === 'text');
  return { text: first?.text ?? '', isError: result.isError === true };
}
