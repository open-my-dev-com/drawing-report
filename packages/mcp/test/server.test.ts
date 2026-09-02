import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MAX_IMAGE_BYTES, type SlipTemplateFile } from '@omdc-slipkit/core';
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

/** 서명만 갖춘 최소 JPEG 바이트 (형식 판정은 앞 3바이트로 한다) */
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

/** PNG 서명으로 시작하지만 크기 상한을 1바이트 넘는 바이트 */
function oversizedPng(): Buffer {
  const bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  Buffer.from(TINY_PNG_B64, 'base64').copy(bytes);
  return bytes;
}

/** 저장된 양식을 읽는다. */
async function loadTemplate(id: string): Promise<SlipTemplateFile> {
  const file = await new FileSystemStorage({ rootDir: dir }).load(id);
  if (file.kind !== 'template') throw new Error('template expected');
  return file;
}

/** 텍스트 요소 하나를 만든다. */
function textElement(id: string, y: number): Record<string, unknown> {
  return { type: 'text', id, name: id, position: { x: 15, y }, width: 100, height: 6, content: id };
}

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
    const customer = elements.find((entry) => entry.id === 'customer');
    if (customer?.type !== 'field') throw new Error('field expected');
    expect(customer.width).toBe(120);
    expect(elements.some((entry) => entry.id === 'footer')).toBe(true);
  });

  it('요소와 셀의 조건부 서식 규칙을 통째로 바꾸고 null로 제거한다 (ADR-062)', async () => {
    const rules = [{ condition: 'total < 0', fontColor: '#FF0000' }];
    const applied = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'set_element', id: 'customer', fields: { conditionalFormats: rules } },
        {
          action: 'set_cell', elementId: 'items-table', row: 1, column: 1,
          fields: { conditionalFormats: [{ condition: 'amount >= 1000', fontColor: '#0000FF' }] },
        },
      ],
    });
    expect(applied.isError).toBe(false);

    const storage = new FileSystemStorage({ rootDir: dir });
    let file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const customer = file.template.pages[0]!.elements.find((entry) => entry.id === 'customer');
    expect((customer as { conditionalFormats?: unknown }).conditionalFormats).toEqual(rules);

    const removed = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_element', id: 'customer', fields: { conditionalFormats: null } }],
    });
    expect(removed.isError).toBe(false);
    file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const after = file.template.pages[0]!.elements.find((entry) => entry.id === 'customer');
    expect((after as { conditionalFormats?: unknown }).conditionalFormats).toBeUndefined();
  });

  it('색과 글자 강조가 모두 없는 조건부 서식 규칙은 저장하지 않는다 (ADR-062)', async () => {
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        {
          action: 'set_element', id: 'customer',
          fields: { conditionalFormats: [{ condition: 'total < 0' }] },
        },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('at least one of fontColor');

    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const customer = file.template.pages[0]!.elements.find((entry) => entry.id === 'customer');
    expect((customer as { conditionalFormats?: unknown }).conditionalFormats).toBeUndefined();
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
    // 셀 병합이 행 구간 경계를 넘게 만든다 (헤더 행 → 항목 구간)
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'set_cell', elementId: 'items-table', row: 0, column: 0, fields: { rowSpan: 2 } },
      ],
    });
    expect(result.isError).toBe(true);
    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const grid = file.template.pages[0]!.elements.find((entry) => entry.id === 'items-table');
    if (grid?.type !== 'grid') throw new Error('grid expected');
    expect(grid.cells.find((cell) => cell.row === 0 && cell.column === 0)?.rowSpan).toBeUndefined();
  });

  it('필드를 null로 지정하면 제거되어 값 소스를 바꿀 수 있다', async () => {
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'set_element', id: 'customer', fields: { parameter: null, formula: 'CONCAT("고객")' } },
        {
          action: 'set_cell',
          elementId: 'items-table',
          row: 1,
          column: 0,
          fields: { parameter: null, formula: 'CONCAT(name, "!")' },
        },
      ],
    });
    expect(result.isError).toBe(false);

    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const customer = file.template.pages[0]!.elements.find((entry) => entry.id === 'customer');
    if (customer?.type !== 'field') throw new Error('field expected');
    expect(customer.parameter).toBeUndefined();
    expect(customer.formula).toBe('CONCAT("고객")');
    const grid = file.template.pages[0]!.elements.find((entry) => entry.id === 'items-table');
    if (grid?.type !== 'grid') throw new Error('grid expected');
    const cell = grid.cells.find((entry) => entry.row === 1 && entry.column === 0);
    expect(cell?.parameter).toBeUndefined();
    expect(cell?.formula).toBe('CONCAT(name, "!")');
  });

  it('set_values의 null은 삭제가 아니라 값으로 저장된다', async () => {
    await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: { customerName: '홍길동' },
      outPath: 'v-null',
    });
    const result = await callText(client, 'slip_edit', {
      path: 'v-null',
      ops: [{ action: 'set_values', values: { customerName: null } }],
    });
    expect(result.isError).toBe(false);
    const storage = new FileSystemStorage({ rootDir: dir });
    const voucher = await storage.load('v-null');
    if (voucher.kind !== 'voucher') throw new Error('voucher expected');
    expect(voucher.values['customerName']).toBeNull();
    expect('customerName' in voucher.values).toBe(true);
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

  it('set_image는 확장자가 아니라 내용으로 PNG·JPEG를 판정한다', async () => {
    await writeFile(path.join(dir, 'photo.JPG'), TINY_JPEG);
    const jpeg = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_image', elementId: 'logo', imagePath: 'photo.JPG' }],
    });
    expect(jpeg.isError).toBe(false);
    let file = await loadTemplate('doc');
    expect(file.template.assets[0]).toMatchObject({ id: 'img-1', mimeType: 'image/jpeg' });

    // 같은 요소에 다시 넣으면 같은 에셋을 갱신한다.
    await writeFile(path.join(dir, 'logo.png'), Buffer.from(TINY_PNG_B64, 'base64'));
    const png = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_image', elementId: 'logo', imagePath: 'logo.png' }],
    });
    expect(png.isError).toBe(false);
    expect(png.text).toContain('replaced asset img-1');
    file = await loadTemplate('doc');
    expect(file.template.assets).toHaveLength(1);
    expect(file.template.assets[0]).toMatchObject({ id: 'img-1', mimeType: 'image/png' });
  });

  it('set_image는 확장자를 위장한 파일과 지원하지 않는 형식을 거부한다', async () => {
    await writeFile(path.join(dir, 'text.png'), 'not an image at all');
    await writeFile(path.join(dir, 'jpeg-inside.png'), TINY_JPEG);
    await writeFile(path.join(dir, 'anim.gif'), Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'));
    await writeFile(path.join(dir, 'pic.webp'), Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'));
    await writeFile(path.join(dir, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(path.join(dir, 'png-as-gif.gif'), Buffer.from(TINY_PNG_B64, 'base64'));
    const cases: [string, RegExp][] = [
      ['text.png', /not image\/png.*signature/],
      ['jpeg-inside.png', /not image\/png.*signature/],
      ['anim.gif', /Unsupported image file.*PNG or JPEG/],
      ['pic.webp', /Unsupported image file.*PNG or JPEG/],
      ['vector.svg', /Unsupported image file.*PNG or JPEG/],
      ['png-as-gif.gif', /Unsupported image file/],
      ['missing.png', /Could not read image file/],
    ];
    for (const [imagePath, pattern] of cases) {
      const result = await callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'set_image', elementId: 'logo', imagePath }],
      });
      expect(result.isError, imagePath).toBe(true);
      expect(result.text, imagePath).toMatch(pattern);
    }
    expect((await loadTemplate('doc')).template.assets).toEqual([]);
  });

  it('set_image는 크기 상한을 넘는 파일을 거부한다', async () => {
    await writeFile(path.join(dir, 'big.png'), oversizedPng());
    const result = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_image', elementId: 'logo', imagePath: 'big.png' }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(`the limit is ${MAX_IMAGE_BYTES / 1024}KB`);
    expect((await loadTemplate('doc')).template.assets).toEqual([]);
  });

  it('add_element·set_element의 data: 이미지도 형식과 크기를 검사한다', async () => {
    const bigDataUrl = `data:image/png;base64,${oversizedPng().toString('base64')}`;
    const image = (src: string): Record<string, unknown> => ({
      type: 'image', id: 'stamp', name: '도장', position: { x: 10, y: 100 }, width: 20, height: 20, src,
    });

    const oversized = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_element', pageIndex: 0, element: image(bigDataUrl) }],
    });
    expect(oversized.isError).toBe(true);
    expect(oversized.text).toMatch(/Image element "stamp" src is \d+KB; the limit is/);

    const gif = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_element', pageIndex: 0, element: image('data:image/gif;base64,R0lGODlhAQABAAAAACw=') }],
    });
    expect(gif.isError).toBe(true);
    expect(gif.text).toContain('image/gif');

    const disguised = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_element', pageIndex: 0, element: image(`data:image/jpeg;base64,${TINY_PNG_B64}`) }],
    });
    expect(disguised.isError).toBe(true);
    expect(disguised.text).toContain('signature');

    const fine = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_element', pageIndex: 0, element: image(`data:image/png;base64,${TINY_PNG_B64}`) }],
    });
    expect(fine.isError).toBe(false);

    const replaced = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_element', id: 'stamp', fields: { src: bigDataUrl } }],
    });
    expect(replaced.isError).toBe(true);
    expect(replaced.text).toContain('the limit is');
    // 기존 요소는 그대로다.
    const stamp = (await loadTemplate('doc')).template.pages[0]!.elements.find((entry) => entry.id === 'stamp');
    expect(stamp?.type === 'image' && stamp.src).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
  });

  it('set_values의 잘못된 이미지 값을 거부한다', async () => {
    await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'add_parameter', parameter: { key: 'stamp', valueType: 'image' } },
        { action: 'set_element', id: 'logo', fields: { src: null, parameter: 'stamp' } },
      ],
    });
    await callText(client, 'slip_build_voucher', { templatePath: 'doc', values: {}, outPath: 'v-img' });

    const oversized = await callText(client, 'slip_edit', {
      path: 'v-img',
      ops: [{ action: 'set_values', values: { stamp: `data:image/png;base64,${oversizedPng().toString('base64')}` } }],
    });
    expect(oversized.isError).toBe(true);
    expect(oversized.text).toMatch(/Value "stamp" is \d+KB; the limit is/);

    const webp = await callText(client, 'slip_edit', {
      path: 'v-img',
      ops: [{ action: 'set_values', values: { stamp: 'data:image/webp;base64,UklGRgAAAABXRUJQ' } }],
    });
    expect(webp.isError).toBe(true);
    expect(webp.text).toContain('image/webp');

    const fine = await callText(client, 'slip_edit', {
      path: 'v-img',
      ops: [{ action: 'set_values', values: { stamp: `data:image/png;base64,${TINY_PNG_B64}` } }],
    });
    expect(fine.isError).toBe(false);
  });

  it('slip_save와 slip_build_voucher도 data: 이미지의 크기 상한을 적용한다', async () => {
    const template = makeTemplate();
    template.template.assets.push({
      id: 'big',
      mimeType: 'image/png',
      src: `data:image/png;base64,${oversizedPng().toString('base64')}`,
    });
    const saved = await callText(client, 'slip_save', { path: 'big-doc', file: template });
    expect(saved.isError).toBe(true);
    expect(saved.text).toMatch(/Asset "big" src is \d+KB; the limit is/);
    expect((await readdir(dir)).includes('big-doc.slip')).toBe(false);

    const built = await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: { customerName: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
      outPath: 'v-bad',
    });
    expect(built.isError).toBe(true);
    expect(built.text).toContain('image/gif');
    expect((await readdir(dir)).includes('v-bad.slip')).toBe(false);
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

describe('slip_edit 페이지·용지·파라미터 연산', () => {
  beforeEach(async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
  });

  it('set_paper는 용지 필드를 병합하고 검증에 어긋나면 저장하지 않는다', async () => {
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_paper', fields: { width: 297, height: 210 } }],
    });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('set_paper: width, height');
    expect((await loadTemplate('doc')).template.paper).toMatchObject({ width: 297, height: 210, padding: [15, 15, 15, 15] });

    const bad = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_paper', fields: { width: -5 } }],
    });
    expect(bad.isError).toBe(true);
    expect((await loadTemplate('doc')).template.paper.width).toBe(297);
  });

  it('remove_element는 id로 요소를 지우고 없는 id는 목록을 안내한다', async () => {
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_element', id: 'title' }],
    });
    expect(ok.isError).toBe(false);
    const ids = (await loadTemplate('doc')).template.pages[0]!.elements.map((entry) => entry.id);
    expect(ids).toEqual(['customer', 'logo', 'items-table']);

    const missing = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_element', id: 'title' }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No element with id "title"');
    expect(missing.text).toContain('customer, logo, items-table');
  });

  it('add_page는 끝이나 지정한 위치에 빈 페이지를 넣고 범위 밖 위치는 거부한다', async () => {
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'add_page' },
        { action: 'add_page', index: 0 },
      ],
    });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('add_page at 1');
    expect(ok.text).toContain('add_page at 0');
    const pages = (await loadTemplate('doc')).template.pages;
    expect(pages).toHaveLength(3);
    expect(pages[0]!.elements).toEqual([]);
    expect(pages[1]!.elements.map((entry) => entry.id)).toContain('title');
    expect(pages[2]!.elements).toEqual([]);

    const outOfRange = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_page', index: 7 }],
    });
    expect(outOfRange.isError).toBe(true);
    expect(outOfRange.text).toContain('Page index 7 is out of range (0..3)');
    expect((await loadTemplate('doc')).template.pages).toHaveLength(3);
  });

  it('remove_page는 페이지를 지우고, 없는 번호와 마지막 페이지 삭제는 거부한다', async () => {
    await callText(client, 'slip_edit', { path: 'doc', ops: [{ action: 'add_page', index: 0 }] });
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_page', index: 0 }],
    });
    expect(ok.isError).toBe(false);
    const pages = (await loadTemplate('doc')).template.pages;
    expect(pages).toHaveLength(1);
    expect(pages[0]!.elements.map((entry) => entry.id)).toContain('title');

    const missing = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_page', index: 5 }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No page at index 5. The file has 1 page(s).');

    // 페이지가 하나도 없는 양식은 검증에서 거부되어 저장되지 않는다.
    const last = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_page', index: 0 }],
    });
    expect(last.isError).toBe(true);
    expect((await loadTemplate('doc')).template.pages).toHaveLength(1);
  });

  it('set_page는 페이지 필드를 병합하고 없는 번호는 거부한다', async () => {
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_page', index: 0, fields: { key: 'front', label: '앞면' } }],
    });
    expect(ok.isError).toBe(false);
    expect((await loadTemplate('doc')).template.pages[0]).toMatchObject({ key: 'front', label: '앞면' });

    const removed = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_page', index: 0, fields: { label: null } }],
    });
    expect(removed.isError).toBe(false);
    expect((await loadTemplate('doc')).template.pages[0]!.label).toBeUndefined();

    const missing = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_page', index: 3, fields: { label: 'x' } }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No page at index 3');
  });

  it('add_parameter는 정의를 추가하고 중복 key는 검증에서 거부한다', async () => {
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_parameter', parameter: { key: 'memo', label: '비고' } }],
    });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('add_parameter memo');
    expect((await loadTemplate('doc')).template.parameters?.map((entry) => entry.key)).toEqual([
      'customerName', 'items', 'memo',
    ]);

    const duplicate = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_parameter', parameter: { key: 'memo' } }],
    });
    expect(duplicate.isError).toBe(true);
    expect((await loadTemplate('doc')).template.parameters).toHaveLength(3);
  });

  it('set_parameter는 key로 정의를 고치고 없는 key는 정의된 key를 안내한다', async () => {
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_parameter', key: 'customerName', fields: { label: '거래처' } }],
    });
    expect(ok.isError).toBe(false);
    expect((await loadTemplate('doc')).template.parameters?.[0]).toMatchObject({ key: 'customerName', label: '거래처' });

    const missing = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_parameter', key: 'nope', fields: { label: 'x' } }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No parameter with key "nope". Defined keys: customerName, items');
  });

  it('remove_parameter는 정의를 지우고 없는 key는 거부한다', async () => {
    await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'add_parameter', parameter: { key: 'memo' } }],
    });
    const ok = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_parameter', key: 'memo' }],
    });
    expect(ok.isError).toBe(false);
    expect((await loadTemplate('doc')).template.parameters?.map((entry) => entry.key)).toEqual(['customerName', 'items']);

    const missing = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'remove_parameter', key: 'memo' }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No parameter with key "memo"');
  });
});

describe('같은 파일의 동시 편집', () => {
  beforeEach(async () => {
    await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
  });

  it('병렬 slip_edit의 변경이 모두 보존된다', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const results = await Promise.all(
      ids.map((id, index) =>
        callText(client, 'slip_edit', {
          path: 'doc',
          ops: [{ action: 'add_element', pageIndex: 0, element: textElement(id, 100 + index * 8) }],
        }),
      ),
    );
    for (const result of results) expect(result.isError).toBe(false);
    const elementIds = (await loadTemplate('doc')).template.pages[0]!.elements.map((entry) => entry.id);
    for (const id of ids) expect(elementIds).toContain(id);
    expect(elementIds).toHaveLength(4 + ids.length);
  });

  it('병렬 편집 중 실패한 호출은 다른 호출의 변경을 지우지 않는다', async () => {
    const results = await Promise.all([
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'add_element', pageIndex: 0, element: textElement('a', 100) }],
      }),
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'set_element', id: 'missing', fields: { width: 1 } }],
      }),
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'set_meta', fields: { title: '' } }],
      }),
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'add_element', pageIndex: 0, element: textElement('b', 110) }],
      }),
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'set_meta', fields: { title: '병렬' } }],
      }),
    ]);
    expect(results.map((result) => result.isError)).toEqual([false, true, true, false, false]);
    const file = await loadTemplate('doc');
    expect(file.template.meta.title).toBe('병렬');
    const elementIds = file.template.pages[0]!.elements.map((entry) => entry.id);
    expect(elementIds).toContain('a');
    expect(elementIds).toContain('b');
  });

  it('slip_save와 slip_build_voucher도 같은 파일 앞에서 줄을 선다', async () => {
    const changed = makeTemplate();
    changed.template.meta.title = '덮어씀';
    const results = await Promise.all([
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'add_element', pageIndex: 0, element: textElement('x', 100) }],
      }),
      callText(client, 'slip_save', { path: 'doc', file: changed, overwrite: true }),
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'add_element', pageIndex: 0, element: textElement('y', 110) }],
      }),
    ]);
    for (const result of results) expect(result.isError).toBe(false);
    // 순서대로 실행됐으므로 덮어쓴 뒤의 편집(y)은 남고 그 앞의 편집(x)은 덮어써진다.
    const file = await loadTemplate('doc');
    expect(file.template.meta.title).toBe('덮어씀');
    const elementIds = file.template.pages[0]!.elements.map((entry) => entry.id);
    expect(elementIds).not.toContain('x');
    expect(elementIds).toContain('y');

    const vouchers = await Promise.all([
      callText(client, 'slip_build_voucher', { templatePath: 'doc', values: { customerName: 'A' }, outPath: 'v' }),
      callText(client, 'slip_build_voucher', { templatePath: 'doc', values: { customerName: 'B' }, outPath: 'v' }),
    ]);
    // 같은 출력 경로에 두 번 만들면 뒤의 호출은 overwrite 없이는 실패한다.
    expect(vouchers.filter((result) => result.isError)).toHaveLength(1);
    expect(vouchers.find((result) => result.isError)?.text).toContain('already exists');
  });

  it('서로 다른 파일의 병렬 편집은 각각 반영된다', async () => {
    await callText(client, 'slip_save', { path: 'other', file: makeTemplate() });
    const results = await Promise.all([
      callText(client, 'slip_edit', {
        path: 'doc',
        ops: [{ action: 'set_meta', fields: { title: 'doc-1' } }],
      }),
      callText(client, 'slip_edit', {
        path: 'other',
        ops: [{ action: 'set_meta', fields: { title: 'other-1' } }],
      }),
      callText(client, 'slip_edit', {
        path: 'doc.slip',
        ops: [{ action: 'add_element', pageIndex: 0, element: textElement('d', 100) }],
      }),
      callText(client, 'slip_edit', {
        path: 'other.slip',
        ops: [{ action: 'add_element', pageIndex: 0, element: textElement('o', 100) }],
      }),
    ]);
    for (const result of results) expect(result.isError).toBe(false);
    const doc = await loadTemplate('doc');
    const other = await loadTemplate('other');
    expect(doc.template.meta.title).toBe('doc-1');
    expect(doc.template.pages[0]!.elements.map((entry) => entry.id)).toContain('d');
    expect(other.template.meta.title).toBe('other-1');
    expect(other.template.pages[0]!.elements.map((entry) => entry.id)).toContain('o');
    // 임시 파일은 남지 않는다.
    expect((await readdir(dir)).sort()).toEqual(['doc.slip', 'other.slip']);
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
    // 응답에 생성된 PDF의 절대 경로를 포함한다.
    expect(rendered.text).toContain(path.join(dir, 'doc.pdf'));
    const pdf = await readFile(path.join(dir, 'doc.pdf'));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('PDF 출력으로 .slip 파일을 덮어쓰지 않는다', async () => {
    const rendered = await callText(client, 'slip_render_pdf', {
      path: 'doc',
      outPath: 'doc.slip',
    });
    expect(rendered.isError).toBe(true);
    expect(rendered.text).toContain('must end with .pdf');

    const storage = new FileSystemStorage({ rootDir: dir });
    expect(await storage.load('doc')).toMatchObject({ kind: 'template' });
  });

  it('PDF 출력 경로는 대소문자와 무관하게 .pdf여야 하고 없는 디렉터리는 만든다', async () => {
    const upper = await callText(client, 'slip_render_pdf', { path: 'doc', outPath: 'out/UPPER.PDF' });
    expect(upper.isError).toBe(false);
    expect((await readFile(path.join(dir, 'out', 'UPPER.PDF'))).subarray(0, 5).toString()).toBe('%PDF-');

    for (const outPath of ['out.json', 'out.png', 'out', 'out.pdf.bak', 'sub/']) {
      const result = await callText(client, 'slip_render_pdf', { path: 'doc', outPath });
      expect(result.isError, outPath).toBe(true);
      expect(result.text, outPath).toContain(`"${outPath}" must end with .pdf`);
    }
    expect((await readdir(dir)).sort()).toEqual(['doc.slip', 'out']);
  });

  it('기존 PDF 파일은 덮어쓰고 PDF가 아닌 기존 파일은 남겨 둔다', async () => {
    await writeFile(path.join(dir, 'old.pdf'), '%PDF-1.4 old');
    const replaced = await callText(client, 'slip_render_pdf', { path: 'doc', outPath: 'old.pdf' });
    expect(replaced.isError).toBe(false);
    const pdf = await readFile(path.join(dir, 'old.pdf'));
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    await writeFile(path.join(dir, 'notes.pdf'), 'hello, this is not a pdf');
    await writeFile(path.join(dir, 'empty.pdf'), '');
    for (const outPath of ['notes.pdf', 'empty.pdf']) {
      const kept = await callText(client, 'slip_render_pdf', { path: 'doc', outPath });
      expect(kept.isError, outPath).toBe(true);
      expect(kept.text, outPath).toContain(`"${outPath}" already exists and is not a PDF file`);
    }
    expect((await readFile(path.join(dir, 'notes.pdf'), 'utf8'))).toBe('hello, this is not a pdf');
    expect((await readFile(path.join(dir, 'empty.pdf'))).length).toBe(0);

    // 출력 경로가 디렉터리면 쓰지 않는다.
    await mkdir(path.join(dir, 'folder.pdf'));
    const directory = await callText(client, 'slip_render_pdf', { path: 'doc', outPath: 'folder.pdf' });
    expect(directory.isError).toBe(true);
    expect(directory.text).toContain('"folder.pdf"');
  });

  it('작업 디렉터리 밖의 PDF 출력 경로를 거부한다', async () => {
    const outside = await callText(client, 'slip_render_pdf', { path: 'doc', outPath: '../escape.pdf' });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain('outside the working directory');
    const absolute = await callText(client, 'slip_render_pdf', {
      path: 'doc',
      outPath: path.join(path.dirname(dir), 'escape.pdf'),
    });
    expect(absolute.isError).toBe(true);
    expect((await readdir(path.dirname(dir))).includes('escape.pdf')).toBe(false);
  });

  it('`ja`가 아닌 로케일에서도 fontName으로 Noto Sans JP를 사용할 수 있다', async () => {
    const template = makeTemplate();
    template.template.pages[0]!.elements.push({
      type: 'text',
      id: 'jp-note',
      name: '일본어 문구',
      position: { x: 15, y: 250 },
      width: 180,
      height: 8,
      content: '請求書 合計金額',
      fontName: 'Noto Sans JP',
    });
    await callText(client, 'slip_save', { path: 'jp-doc', file: template });
    const rendered = await callText(client, 'slip_render_pdf', { path: 'jp-doc' });
    expect(rendered.isError).toBe(false);
    const pdf = await readFile(path.join(dir, 'jp-doc.pdf'));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('preview를 지정하면 페이지 PNG 이미지가 함께 반환된다', async () => {
    const result = await client.callTool({
      name: 'slip_render_pdf',
      arguments: { path: 'doc', preview: true },
    });
    const content = result.content as { type: string; data?: string; mimeType?: string }[];
    const image = content.find((entry) => entry.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    const bytes = Buffer.from(image?.data ?? '', 'base64');
    // PNG 매직 바이트
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('previewPage가 범위를 벗어나면 오류를 안내한다', async () => {
    const result = await callText(client, 'slip_render_pdf', {
      path: 'doc',
      preview: true,
      previewPage: 99,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('99');
  });

  it('slip_schema가 주제별 안내를 반환한다', async () => {
    const overview = await callText(client, 'slip_schema', { topic: 'overview' });
    expect(overview.text).toContain('schemaVersion');
    const json = await callText(client, 'slip_schema', { topic: 'json-schema' });
    expect(JSON.parse(json.text)).toHaveProperty('$schema');
  });
});

describe('서버 안내', () => {
  it('서버 버전은 패키지 버전과 같다', async () => {
    const { PACKAGE_VERSION } = await import('../src/cli-command.js');
    expect(client.getServerVersion()).toEqual({ name: 'slipkit-mcp-server', version: PACKAGE_VERSION });
  });

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
