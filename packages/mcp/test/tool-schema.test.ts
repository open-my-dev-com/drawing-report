/**
 * MCP 클라이언트가 도구 목록으로 받는 입력 JSON Schema 테스트.
 *
 * 키 제약이 없는 객체 입력(`fields`·`element`·`parameter`·`values`·`file`)은 `type: "object"`로
 * 공개되어야 AI 클라이언트가 배열이나 문자열을 넣지 않는다. 실제 호출에서도 객체가 아닌 입력은
 * 파일을 쓰기 전에 거부한다.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callText, connect, makeTemplate, makeWorkDir, removeWorkDir } from './helpers.js';

/** 도구 목록에 실리는 JSON Schema에서 이 테스트가 보는 부분 */
interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: unknown;
  propertyNames?: JsonSchema;
  const?: unknown;
}

/** `slip_edit` 연산별로 키 제약이 없는 객체 입력의 이름 */
const OBJECT_INPUT_BY_ACTION: Record<string, string> = {
  set_meta: 'fields',
  set_paper: 'fields',
  set_element: 'fields',
  add_element: 'element',
  set_page: 'fields',
  add_parameter: 'parameter',
  set_parameter: 'fields',
  set_cell: 'fields',
  set_values: 'values',
};

/** 키 제약이 없는 객체 입력이 `z.record`와 같은 계약으로 공개되는지 확인한다. */
function expectOpenObject(schema: JsonSchema | undefined, subject: string): void {
  expect(schema, subject).toBeDefined();
  expect(schema!.type, subject).toBe('object');
  expect(schema!.additionalProperties, subject).toEqual({});
  expect(schema!.propertyNames, subject).toEqual({ type: 'string' });
  expect(schema!.properties, subject).toBeUndefined();
  expect(schema!.description, subject).toBeTypeOf('string');
  expect(schema!.description!.length, subject).toBeGreaterThan(0);
}

describe('도구 입력 JSON Schema', () => {
  let dir: string;
  let close: () => Promise<void>;
  let inputs: Map<string, JsonSchema>;

  beforeAll(async () => {
    dir = await makeWorkDir();
    let client: Client;
    ({ client, close } = await connect({ rootDir: dir }));
    const { tools } = await client.listTools();
    inputs = new Map(tools.map((tool) => [tool.name, tool.inputSchema as unknown as JsonSchema]));
  });

  afterAll(async () => {
    await close();
    await removeWorkDir(dir);
  });

  it('slip_save.file은 필수 객체 입력으로 공개된다', () => {
    const input = inputs.get('slip_save')!;
    expectOpenObject(input.properties?.['file'], 'slip_save.file');
    expect(input.required).toContain('file');
    expect(input.required).toContain('path');
  });

  it('slip_build_voucher.values는 선택 객체 입력으로 공개된다', () => {
    const input = inputs.get('slip_build_voucher')!;
    expectOpenObject(input.properties?.['values'], 'slip_build_voucher.values');
    expect(input.required).not.toContain('values');
    expect(input.required).toContain('templatePath');
    expect(input.required).toContain('outPath');
  });

  it('slip_edit.ops의 연산별 객체 입력은 모두 필수 객체로 공개된다', () => {
    const ops = inputs.get('slip_edit')!.properties?.['ops'];
    expect(ops?.type).toBe('array');
    const variants = ops?.items?.oneOf ?? ops?.items?.anyOf ?? [];
    expect(variants.length).toBeGreaterThan(0);
    const checked = new Set<string>();
    for (const variant of variants) {
      const action = variant.properties?.['action']?.const;
      expect(action).toBeTypeOf('string');
      const key = OBJECT_INPUT_BY_ACTION[action as string];
      if (key === undefined) continue;
      checked.add(action as string);
      expectOpenObject(variant.properties?.[key], `${String(action)}.${key}`);
      expect(variant.required, String(action)).toContain('action');
      expect(variant.required, String(action)).toContain(key);
    }
    expect([...checked].sort()).toEqual(Object.keys(OBJECT_INPUT_BY_ACTION).sort());
  });
});

describe('객체가 아닌 입력의 거부', () => {
  let dir: string;
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    dir = await makeWorkDir();
    ({ client, close } = await connect({ rootDir: dir }));
    const saved = await callText(client, 'slip_save', { path: 'doc', file: makeTemplate() });
    expect(saved.isError).toBe(false);
    const built = await callText(client, 'slip_build_voucher', { templatePath: 'doc', values: {}, outPath: 'v' });
    expect(built.isError).toBe(false);
  });

  afterEach(async () => {
    await close();
    await removeWorkDir(dir);
  });

  const NOT_OBJECTS: unknown[] = [[], ['a'], 'x', 1, true, null];

  it('slip_save·slip_build_voucher는 객체가 아닌 입력을 파일을 쓰기 전에 거부한다', async () => {
    for (const bad of NOT_OBJECTS) {
      const label = JSON.stringify(bad);
      const saved = await callText(client, 'slip_save', { path: 'bad', file: bad });
      expect(saved.isError, `slip_save ${label}`).toBe(true);
      expect(saved.text, `slip_save ${label}`).toMatch(/file/);
      const built = await callText(client, 'slip_build_voucher', {
        templatePath: 'doc',
        values: bad,
        outPath: 'bad',
      });
      expect(built.isError, `slip_build_voucher ${label}`).toBe(true);
      expect(built.text, `slip_build_voucher ${label}`).toMatch(/values/);
    }
    await expect(readFile(path.join(dir, 'bad.slip'))).rejects.toThrow();
  });

  it('slip_edit 연산의 객체 입력이 객체가 아니면 파일을 바꾸지 않는다', async () => {
    const docBefore = await readFile(path.join(dir, 'doc.slip'), 'utf8');
    const voucherBefore = await readFile(path.join(dir, 'v.slip'), 'utf8');
    const ops: { path: string; op: Record<string, unknown> }[] = [];
    for (const bad of NOT_OBJECTS) {
      ops.push(
        { path: 'doc', op: { action: 'set_meta', fields: bad } },
        { path: 'doc', op: { action: 'set_paper', fields: bad } },
        { path: 'doc', op: { action: 'set_element', id: 'title', fields: bad } },
        { path: 'doc', op: { action: 'add_element', pageIndex: 0, element: bad } },
        { path: 'doc', op: { action: 'set_page', index: 0, fields: bad } },
        { path: 'doc', op: { action: 'add_parameter', parameter: bad } },
        { path: 'doc', op: { action: 'set_parameter', key: 'customerName', fields: bad } },
        { path: 'doc', op: { action: 'set_cell', elementId: 'items-table', row: 0, column: 0, fields: bad } },
        { path: 'v', op: { action: 'set_values', values: bad } },
      );
    }
    // 객체 입력을 아예 빠뜨린 연산도 거부한다.
    ops.push(
      { path: 'doc', op: { action: 'set_meta' } },
      { path: 'doc', op: { action: 'add_element', pageIndex: 0 } },
      { path: 'doc', op: { action: 'add_parameter' } },
      { path: 'v', op: { action: 'set_values' } },
    );
    for (const { path: id, op } of ops) {
      const label = JSON.stringify(op);
      const edited = await callText(client, 'slip_edit', { path: id, ops: [op] });
      expect(edited.isError, label).toBe(true);
      expect(edited.text, label).toContain(OBJECT_INPUT_BY_ACTION[op['action'] as string]!);
    }
    expect(await readFile(path.join(dir, 'doc.slip'), 'utf8')).toBe(docBefore);
    expect(await readFile(path.join(dir, 'v.slip'), 'utf8')).toBe(voucherBefore);
  });
});
