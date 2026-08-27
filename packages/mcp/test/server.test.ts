import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { FileSystemStorage } from '../src/storage.js';
import {
  TINY_PNG_B64,
  callText,
  connect,
  makeTemplate,
  makeWorkDir,
  removeWorkDir,
} from './helpers.js';

let dir: string;
let client: Client;
let close: () => Promise<void>;

beforeEach(async () => {
  dir = await makeWorkDir();
  ({ client, close } = await connect({ rootDir: dir }));
});

afterEach(async () => {
  await close();
  await removeWorkDir(dir);
});

describe('slip_save · slip_list · slip_read', () => {
  it('전체 파일을 저장한 뒤 목록과 요약을 읽을 수 있다', async () => {
    const saved = await callText(client, 'slip_save', {
      path: 'invoice',
      file: makeTemplate(),
    });
    expect(saved.isError).toBe(false);
    expect(saved.text).toContain('invoice');

    const listed = await callText(client, 'slip_list', {});
    expect(listed.isError).toBe(false);
    expect(listed.text).toContain('invoice.slip');
    expect(listed.text).toContain('거래명세서');

    const summary = await callText(client, 'slip_read', { path: 'invoice' });
    expect(summary.isError).toBe(false);
    const parsed = JSON.parse(summary.text) as Record<string, unknown>;
    expect(parsed['kind']).toBe('template');
    // 요약에는 요소 id만 나오고 셀 상세는 나오지 않는다
    expect(summary.text).toContain('items-table');
    expect(summary.text).not.toContain('SUM(items.amount)');
  });

  it('잘못된 파일은 저장하지 않고 오류 목록을 돌려준다', async () => {
    const broken = makeTemplate() as unknown as { template: { pages: unknown[] } };
    broken.template.pages = [];
    const result = await callText(client, 'slip_save', { path: 'broken', file: broken });
    expect(result.isError).toBe(true);
    const listed = await callText(client, 'slip_list', {});
    expect(listed.text).not.toContain('broken');
  });

  it('이미 있는 파일은 overwrite 없이 덮어쓰지 않는다', async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
    const again = await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('slip_edit');
    const forced = await callText(client, 'slip_save', {
      path: 'doc',
      file: makeTemplate(),
      overwrite: true,
    });
    expect(forced.isError).toBe(false);
  });

  it('발행된 전표는 overwrite로 교체할 수 없다', async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
    await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: {},
      outPath: 'issued',
    });
    const storage = new FileSystemStorage({ rootDir: dir });
    const voucher = await storage.load('issued');
    if (voucher.kind !== 'voucher') throw new Error('voucher expected');
    await storage.save('issued', { ...voucher, issued: true });

    const saved = await callText(client, 'slip_save', {
      path: 'issued',
      file: makeTemplate(),
      overwrite: true,
    });
    const built = await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: {},
      outPath: 'issued',
      overwrite: true,
    });
    expect(saved.isError).toBe(true);
    expect(saved.text).toContain('issued');
    expect(built.isError).toBe(true);
    expect(built.text).toContain('issued');
    expect(await storage.load('issued')).toMatchObject({ kind: 'voucher', issued: true });
  });

  it('slip_save로 발행 상태의 전표를 새로 만들 수 없다', async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
    await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: {},
      outPath: 'draft',
    });
    const storage = new FileSystemStorage({ rootDir: dir });
    const draft = await storage.load('draft');
    if (draft.kind !== 'voucher') throw new Error('voucher expected');

    const saved = await callText(client, 'slip_save', {
      path: 'issued-new',
      file: { ...draft, issued: true },
    });
    expect(saved.isError).toBe(true);
    expect(saved.text).toContain('issued');
    await expect(storage.load('issued-new')).rejects.toThrow();
  });

  it('작업 디렉터리 밖 경로를 거부한다', async () => {
    const result = await callText(client, 'slip_save', {
      path: '../escape',
      file: makeTemplate(),
    });
    expect(result.isError).toBe(true);
  });

  it('part=element로 요소 하나를 읽고, base64는 치환된다', async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
    const element = await callText(client, 'slip_read', {
      path: 'doc',
      part: 'element',
      elementId: 'logo',
    });
    expect(element.isError).toBe(false);
    expect(element.text).not.toContain(TINY_PNG_B64.slice(0, 24));
    expect(element.text).toContain('[data ');
  });
});

describe('slip_edit', () => {
  beforeEach(async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
  });

  it('id로 지정한 연산을 원자적으로 적용한다', async () => {
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'set_meta', fields: { title: '청구서' } },
        { action: 'set_element', id: 'customer', fields: { width: 120 } },
        {
          action: 'add_element',
          pageIndex: 0,
          element: {
            type: 'text',
            id: 'footer',
            name: '하단',
            position: { x: 15, y: 280 },
            width: 180,
            height: 6,
            content: '감사합니다',
          },
        },
        { action: 'set_cell', elementId: 'items-table', row: 0, column: 0, fields: { content: '항목' } },
      ],
    });
    expect(result.isError).toBe(false);

    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    expect(file.template.meta.title).toBe('청구서');
    const elements = file.template.pages[0]!.elements;
    expect(elements.find((entry) => entry.id === 'customer')?.width).toBe(120);
    expect(elements.some((entry) => entry.id === 'footer')).toBe(true);
  });

  it('없는 id는 사용할 수 있는 id 목록을 안내하고 아무것도 저장하지 않는다', async () => {
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'set_meta', fields: { title: '바뀌면 안 됨' } },
        { action: 'set_element', id: 'nope', fields: { width: 1 } },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('items-table');

    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    expect(file.template.meta.title).toBe('거래명세서');
  });

  it('검증에 어긋나는 결과는 저장하지 않는다', async () => {
    // 그리드 열 너비 합이 요소 너비와 어긋나게 만든다
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_element', id: 'items-table', fields: { width: 100 } }],
    });
    expect(result.isError).toBe(true);
    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const grid = file.template.pages[0]!.elements.find((entry) => entry.id === 'items-table');
    expect(grid?.width).toBe(180);
  });

  it('set_image가 파일을 에셋으로 넣고 요소를 연결한다', async () => {
    await writeFile(path.join(dir, 'logo.png'), Buffer.from(TINY_PNG_B64, 'base64'));
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_image', elementId: 'logo', imagePath: 'logo.png' }],
    });
    expect(result.isError).toBe(false);

    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    expect(file.template.assets).toHaveLength(1);
    expect(file.template.assets[0]).toMatchObject({ id: 'img-1', mimeType: 'image/png' });
    const logo = file.template.pages[0]!.elements.find((entry) => entry.id === 'logo');
    expect(logo?.type === 'image' && logo.src).toBe('asset://img-1');
  });

  it('발행된 전표는 수정을 거부한다', async () => {
    await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: { customerName: '홍길동', items: [] },
      outPath: 'v1',
    });
    const storage = new FileSystemStorage({ rootDir: dir });
    const voucher = await storage.load('v1');
    if (voucher.kind !== 'voucher') throw new Error('voucher expected');
    await storage.save('v1', { ...voucher, issued: true });

    const result = await callText(client, 'slip_edit', {
      path: 'v1',
      ops: [{ action: 'set_values', values: { customerName: '아무개' } }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('issued');
  });
});

describe('slip_build_voucher · slip_render_pdf · slip_schema', () => {
  beforeEach(async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
  });

  it('양식과 값으로 전표를 만들고 값을 고칠 수 있다', async () => {
    const built = await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: { customerName: '홍길동', items: [{ name: '연필', amount: 500 }] },
      outPath: 'voucher-1',
    });
    expect(built.isError).toBe(false);
    expect(built.text).toContain('voucher');

    const edited = await callText(client, 'slip_edit', {
      path: 'voucher-1',
      ops: [{ action: 'set_values', values: { customerName: '김철수' } }],
    });
    expect(edited.isError).toBe(false);
  });

  it('전표를 지정하면 오류를 안내한다', async () => {
    await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: {},
      outPath: 'v',
    });
    const result = await callText(client, 'slip_build_voucher', {
      templatePath: 'v',
      values: {},
      outPath: 'v2',
    });
    expect(result.isError).toBe(true);
  });

  it('PDF를 렌더링해 파일로 저장한다', async () => {
    const rendered = await callText(client, 'slip_render_pdf', { path: 'doc' });
    expect(rendered.isError).toBe(false);
    const pdf = await readFile(path.join(dir, 'doc.pdf'));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('PDF 출력으로 .slip 파일을 덮어쓰지 않는다', async () => {
    const rendered = await callText(client, 'slip_render_pdf', {
      path: 'doc',
      outPath: 'doc.slip',
    });
    expect(rendered.isError).toBe(true);

    const storage = new FileSystemStorage({ rootDir: dir });
    expect(await storage.load('doc')).toMatchObject({ kind: 'template' });
  });

  it('slip_schema가 주제별 안내를 반환한다', async () => {
    const overview = await callText(client, 'slip_schema', { topic: 'overview' });
    expect(overview.text).toContain('schemaVersion');
    const json = await callText(client, 'slip_schema', { topic: 'json-schema' });
    expect(JSON.parse(json.text)).toHaveProperty('$schema');
  });
});

describe('서버 안내', () => {
  it('도구 7종이 등록되어 있다', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'slip_build_voucher',
      'slip_edit',
      'slip_list',
      'slip_read',
      'slip_render_pdf',
      'slip_save',
      'slip_schema',
    ]);
  });

  it('AI가 도구 인자와 파일 변경 가능성을 판단할 설명을 제공한다', async () => {
    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

    const listProperties = byName.get('slip_list')?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    const readProperties = byName.get('slip_read')?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    const buildProperties = byName.get('slip_build_voucher')?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;

    for (const tool of tools.tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      const properties = tool.inputSchema.properties as
        | Record<string, { description?: string }>
        | undefined;
      for (const [name, property] of Object.entries(properties ?? {})) {
        expect(property.description, `${tool.name}.${name} description`).toBeTruthy();
      }
    }

    expect(listProperties?.['kind']?.description).toBeTruthy();
    expect(listProperties?.['query']?.description).toBeTruthy();
    expect(readProperties?.['part']?.description).toContain('summary');
    expect(readProperties?.['pageIndex']?.description).toContain('0-based');
    expect(buildProperties?.['templatePath']?.description).toBeTruthy();
    expect(buildProperties?.['overwrite']?.description).toContain('existing');
    expect(JSON.stringify(byName.get('slip_edit')?.inputSchema)).toContain('0-based row index');
    expect(JSON.stringify(byName.get('slip_edit')?.inputSchema)).toContain('never pass base64');
    expect(byName.get('slip_save')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('slip_build_voucher')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('slip_render_pdf')?.annotations?.destructiveHint).toBe(true);
  });
});
