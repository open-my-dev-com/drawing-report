/**
 * 파라미터 키가 `__proto__`·`constructor`·`toString`이거나 점·공백·한글을 담을 때의 MCP 동작 테스트.
 *
 * 키는 어떤 문자열이든 업무 데이터의 이름이다. 도구 입력, 편집 연산과 요약은 값을 프로토타입
 * 체인이 아닌 객체 자신의 속성으로만 읽고 쓰며, 파일의 프로토타입은 건드리지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CURRENT_SCHEMA_VERSION, type SlipFile, type SlipVoucherFile } from '@omdc-slipkit/core';
import { applyEditOp, editOpSchema, type EditOp } from '../src/edit.js';
import { elideDataUrls } from '../src/summary.js';
import { FileSystemStorage } from '../src/storage.js';
import { callText, connect, makeTemplate, makeWorkDir, removeWorkDir } from './helpers.js';

/** JSON 문자열을 파싱해 `__proto__`가 프로토타입이 아닌 자신의 속성이 되게 한다. */
function fromJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

/** 특수 키 파라미터를 가진 양식. `makeTemplate`의 `customerName`·`items`에 더한다. */
function keyedTemplate() {
  const template = makeTemplate();
  template.template.parameters!.push(
    { key: '__proto__', label: '프로토' },
    { key: 'constructor', label: '생성자' },
    { key: 'toString', label: '문자열' },
    { key: 'a b', label: '공백' },
    { key: '한글', label: '한글' },
    { key: 'a.b', label: '점' },
  );
  const items = template.template.parameters!.find((entry) => entry.key === 'items')!;
  items.fields!.push({ key: '__proto__', label: '행 프로토' }, { key: 'constructor', label: '행 생성자' });
  return template;
}

describe('slip_edit 연산의 자신의 속성 읽기·쓰기', () => {
  const context = { resolveFilePath: async (relPath: string) => relPath };

  it('도구 입력 스키마는 __proto__ 키를 자신의 속성으로 보존하고 키 순서를 유지한다', () => {
    const op = fromJson<Record<string, unknown>>(
      '{"action":"set_values","values":{"__proto__":"p","constructor":"c","a b":1}}',
    );
    const parsed = editOpSchema.parse(op);
    if (parsed.action !== 'set_values') throw new Error('set_values expected');
    expect(Object.getPrototypeOf(parsed.values)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed.values, '__proto__')).toBe(true);
    expect(parsed.values['__proto__']).toBe('p');
    expect(parsed.values['constructor']).toBe('c');
    expect(Object.keys(parsed.values)).toEqual(['__proto__', 'constructor', 'a b']);
    // 검사 중에 쓰는 임시 키 이름은 결과에 남지 않고, 입력 객체도 바뀌지 않는다.
    expect(Object.keys(parsed.values).some((key) => key.includes(String.fromCharCode(0)))).toBe(false);
    expect(Object.keys(op['values'] as object)).toEqual(['__proto__', 'constructor', 'a b']);

    const fields = fromJson<Record<string, unknown>>('{"action":"set_meta","fields":{"__proto__":{"x":1}}}');
    const merged = editOpSchema.parse(fields);
    if (merged.action !== 'set_meta') throw new Error('set_meta expected');
    expect(Object.hasOwn(merged.fields, '__proto__')).toBe(true);
    expect(merged.fields['__proto__']).toEqual({ x: 1 });

    // __proto__ 키가 없는 객체는 그대로 통과하고 중첩 값은 같은 참조로 남는다.
    const nested = { title: '제목', deep: { keep: true } };
    const plain = editOpSchema.parse({ action: 'set_meta', fields: nested });
    if (plain.action !== 'set_meta') throw new Error('set_meta expected');
    expect(plain.fields).toEqual(nested);
    expect(plain.fields['deep']).toBe(nested.deep);

    expect(editOpSchema.safeParse({ action: 'set_values', values: [] }).success).toBe(false);
    expect(editOpSchema.safeParse({ action: 'set_values', values: 'x' }).success).toBe(false);
    expect(editOpSchema.safeParse({ action: 'set_values', values: null }).success).toBe(false);
    expect(editOpSchema.safeParse({ action: 'set_values' }).success).toBe(false);
  });

  it('set_values는 __proto__·constructor 값을 전표 자신의 속성으로 쓰고 프로토타입을 바꾸지 않는다', async () => {
    const template = keyedTemplate();
    const file: SlipVoucherFile = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: template.template,
      values: { customerName: '홍길동' },
      issued: false,
    };
    const op = editOpSchema.parse(
      fromJson(
        '{"action":"set_values","values":{"__proto__":{"polluted":true},"constructor":"c","toString":"t",' +
          '"a b":"space","items":[{"__proto__":"row","constructor":3}]}}',
      ),
    );
    const line = await applyEditOp(file, op, context);
    expect(line).toContain('__proto__');

    const values = file.values as Record<string, unknown>;
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect((values as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.hasOwn(values, '__proto__')).toBe(true);
    expect(values['__proto__']).toEqual({ polluted: true });
    expect(values['constructor']).toBe('c');
    expect(values['toString']).toBe('t');
    expect(values['a b']).toBe('space');
    expect(values['customerName']).toBe('홍길동');
    const row = (values['items'] as Record<string, unknown>[])[0]!;
    expect(Object.hasOwn(row, '__proto__')).toBe(true);
    expect(row['__proto__']).toBe('row');
    // 전역 프로토타입도 오염되지 않는다.
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();

    // JSON으로 내보내도 키가 남는다.
    const json = fromJson<{ values: Record<string, unknown> }>(JSON.stringify(file));
    expect(Object.hasOwn(json.values, '__proto__')).toBe(true);
  });

  it('set_meta·set_parameter의 필드 병합도 자신의 속성으로 쓰고 null은 자신의 속성만 지운다', async () => {
    const file: SlipFile = keyedTemplate();
    await applyEditOp(
      file,
      editOpSchema.parse(fromJson('{"action":"set_meta","fields":{"__proto__":"m","title":"제목"}}')),
      context,
    );
    const meta = file.template.meta as unknown as Record<string, unknown>;
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    expect(Object.hasOwn(meta, '__proto__')).toBe(true);
    expect(meta['title']).toBe('제목');

    await applyEditOp(file, editOpSchema.parse(fromJson('{"action":"set_meta","fields":{"__proto__":null}}')), context);
    expect(Object.hasOwn(meta, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);

    // 정의된 파라미터 key 자체가 __proto__여도 key 문자열로 찾는다.
    await applyEditOp(
      file,
      { action: 'set_parameter', key: '__proto__', fields: { label: '바뀐 프로토' } },
      context,
    );
    expect(file.template.parameters!.find((entry) => entry.key === '__proto__')?.label).toBe('바뀐 프로토');
    await applyEditOp(file, { action: 'remove_parameter', key: '__proto__' }, context);
    expect(file.template.parameters!.some((entry) => entry.key === '__proto__')).toBe(false);
  });

  it('add_parameter는 key를 자신의 속성에서 읽어 안내한다', async () => {
    const file: SlipFile = makeTemplate();
    const line = await applyEditOp(
      file,
      editOpSchema.parse(fromJson('{"action":"add_parameter","parameter":{"key":"__proto__","label":"p"}}')),
      context,
    );
    expect(line).toBe('add_parameter __proto__');
    const missing = await applyEditOp(
      file,
      { action: 'add_parameter', parameter: Object.create(Object.prototype) as Record<string, unknown> },
      context,
    );
    expect(missing).toBe('add_parameter (no key)');
  });

  it('요약의 data URL 치환은 __proto__ 키를 자신의 속성으로 옮긴다', () => {
    const elided = elideDataUrls(fromJson('{"__proto__":{"deep":1},"constructor":"c"}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(elided)).toBe(Object.prototype);
    expect(Object.hasOwn(elided, '__proto__')).toBe(true);
    expect(elided['__proto__']).toEqual({ deep: 1 });
    expect(elided['constructor']).toBe('c');
  });
});

describe('특수 키의 저장·읽기 왕복', () => {
  let dir: string;
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    dir = await makeWorkDir();
    ({ client, close } = await connect({ rootDir: dir }));
    const saved = await callText(client, 'slip_save', { path: 'doc', file: keyedTemplate() });
    expect(saved.isError).toBe(false);
  });

  afterEach(async () => {
    await close();
    await removeWorkDir(dir);
  });

  async function loadVoucher(id: string): Promise<SlipVoucherFile> {
    const file = await new FileSystemStorage({ rootDir: dir }).load(id);
    if (file.kind !== 'voucher') throw new Error('voucher expected');
    return file;
  }

  it('정의부의 __proto__·constructor 키가 저장·읽기·수정을 거쳐 그대로 남는다', async () => {
    const summary = await callText(client, 'slip_read', { path: 'doc' });
    expect(summary.isError).toBe(false);
    for (const key of ['__proto__', 'constructor', 'toString', 'a b', '한글', 'a.b']) {
      expect(summary.text).toContain(key);
    }

    const edited = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [
        { action: 'set_parameter', key: '__proto__', fields: { label: '바뀐 프로토' } },
        { action: 'set_parameter', key: 'a b', fields: { valueType: 'number' } },
        { action: 'add_parameter', parameter: { key: 'valueOf', label: 'v' } },
      ],
    });
    expect(edited.isError).toBe(false);
    const storage = new FileSystemStorage({ rootDir: dir });
    const file = await storage.load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    const byKey = new Map(file.template.parameters!.map((entry) => [entry.key, entry]));
    expect(byKey.get('__proto__')?.label).toBe('바뀐 프로토');
    expect(byKey.get('a b')?.valueType).toBe('number');
    expect(byKey.has('valueOf')).toBe(true);
  });

  it('slip_build_voucher의 특수 키 값이 파일에 자신의 속성으로 남고 다시 읽힌다', async () => {
    const built = await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: fromJson(
        '{"__proto__":"p","constructor":"c","toString":"t","a b":"space","한글":"값","a.b":"dot",' +
          '"items":[{"name":"연필","amount":500,"__proto__":"row","constructor":"rc"}]}',
      ),
      outPath: 'voucher',
    });
    expect(built.isError).toBe(false);

    // 저장된 JSON 자체에 모든 키가 남는다.
    const raw = fromJson<{ values: Record<string, unknown> }>(
      await readFile(path.join(dir, 'voucher.slip'), 'utf8'),
    );
    expect(Object.hasOwn(raw.values, '__proto__')).toBe(true);
    expect(raw.values['__proto__']).toBe('p');
    expect(Object.hasOwn((raw.values['items'] as Record<string, unknown>[])[0]!, '__proto__')).toBe(true);

    // core 파서로 다시 읽어도 자신의 속성으로 읽힌다.
    const loaded = await loadVoucher('voucher');
    const values = loaded.values as Record<string, unknown>;
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    for (const [key, expected] of [
      ['__proto__', 'p'], ['constructor', 'c'], ['toString', 't'], ['a b', 'space'], ['한글', '값'], ['a.b', 'dot'],
    ] as const) {
      expect(Object.hasOwn(values, key), key).toBe(true);
      expect(values[key]).toBe(expected);
    }
    const row = (values['items'] as Record<string, unknown>[])[0]!;
    expect(Object.hasOwn(row, 'constructor')).toBe(true);
    expect(row['constructor']).toBe('rc');
    expect(Object.hasOwn(row, '__proto__')).toBe(true);
    expect(row['__proto__']).toBe('row');

    const full = await callText(client, 'slip_read', { path: 'voucher', part: 'full' });
    expect(full.isError).toBe(false);
    expect(full.text).toContain('"__proto__": "p"');
    expect(full.text).toContain('"constructor": "c"');
    expect(full.text).toContain('"a b": "space"');
  });

  it('set_values의 constructor·toString·공백 키 값이 저장을 거쳐 자신의 속성으로 읽힌다', async () => {
    await callText(client, 'slip_build_voucher', { templatePath: 'doc', values: {}, outPath: 'v' });
    const edited = await callText(client, 'slip_edit', {
      path: 'v',
      ops: [
        {
          action: 'set_values',
          values: fromJson(
            '{"constructor":"c","toString":"t","a b":"space","한글":"값","items":[{"name":"지우개","constructor":"rc"}]}',
          ),
        },
      ],
    });
    expect(edited.isError).toBe(false);
    expect(edited.text).toContain('constructor, toString, a b, 한글, items');

    const values = (await loadVoucher('v')).values as Record<string, unknown>;
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.hasOwn(values, 'constructor')).toBe(true);
    expect(values['constructor']).toBe('c');
    expect(values['toString']).toBe('t');
    expect(values['a b']).toBe('space');
    expect(values['한글']).toBe('값');
    expect((values['items'] as Record<string, unknown>[])[0]!['constructor']).toBe('rc');

    // 값이 없는 키는 프로토타입 값이 아닌 빈 값으로 요약된다.
    const summary = await callText(client, 'slip_read', { path: 'v' });
    expect(summary.text).not.toContain('function Object');
  });

  it('slip_save로 저장한 전표의 __proto__·constructor 값이 자신의 속성으로 남고 다시 읽힌다', async () => {
    const voucher: SlipVoucherFile = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: keyedTemplate().template,
      values: fromJson(
        '{"__proto__":"p","constructor":"c","toString":"t","customerName":"홍길동",' +
          '"items":[{"name":"연필","amount":500,"__proto__":"row","constructor":"rc"}]}',
      ),
      issued: false,
    };
    const saved = await callText(client, 'slip_save', { path: 'saved', file: voucher });
    expect(saved.isError).toBe(false);

    const raw = fromJson<{ values: Record<string, unknown> }>(await readFile(path.join(dir, 'saved.slip'), 'utf8'));
    expect(Object.hasOwn(raw.values, '__proto__')).toBe(true);
    expect(raw.values['__proto__']).toBe('p');
    expect(Object.keys(raw.values)).toEqual(['__proto__', 'constructor', 'toString', 'customerName', 'items']);

    const values = (await loadVoucher('saved')).values as Record<string, unknown>;
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    for (const [key, expected] of [['__proto__', 'p'], ['constructor', 'c'], ['toString', 't']] as const) {
      expect(Object.hasOwn(values, key), key).toBe(true);
      expect(values[key]).toBe(expected);
    }
    const row = (values['items'] as Record<string, unknown>[])[0]!;
    expect(row['__proto__']).toBe('row');
    expect(row['constructor']).toBe('rc');

    const full = await callText(client, 'slip_read', { path: 'saved', part: 'full' });
    expect(full.isError).toBe(false);
    expect(full.text).toContain('"__proto__": "p"');
    expect(full.text).toContain('"constructor": "rc"');
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('set_meta의 __proto__ 필드는 도구 입력을 거쳐도 자신의 속성으로 병합되고 프로토타입을 바꾸지 않는다', async () => {
    const edited = await callText(client, 'slip_edit', {
      path: 'doc',
      ops: [{ action: 'set_meta', fields: fromJson('{"__proto__":{"polluted":true},"title":"바뀐 제목"}') }],
    });
    expect(edited.isError).toBe(false);
    // 적용 결과 줄은 병합한 필드의 자신의 키 목록이므로 __proto__가 키로 도착했음을 보여 준다.
    expect(edited.text).toContain('set_meta: __proto__, title');

    // 고정 구조인 meta에 남길지는 core의 구조 검증이 정한다. 여기서는 프로토타입이 바뀌지 않았는지만 본다.
    const file = await new FileSystemStorage({ rootDir: dir }).load('doc');
    if (file.kind !== 'template') throw new Error('template expected');
    expect(file.template.meta.title).toBe('바뀐 제목');
    expect(Object.getPrototypeOf(file.template.meta)).toBe(Object.prototype);
    expect((file.template.meta as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('값 도구 입력이 객체가 아니면 저장하지 않고 거부한다', async () => {
    const built = await callText(client, 'slip_build_voucher', {
      templatePath: 'doc',
      values: ['not', 'an', 'object'],
      outPath: 'bad',
    });
    expect(built.isError).toBe(true);
    await expect(readFile(path.join(dir, 'bad.slip'))).rejects.toThrow();
  });
});
