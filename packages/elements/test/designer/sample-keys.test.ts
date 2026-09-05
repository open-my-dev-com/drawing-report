// @vitest-environment happy-dom
// 샘플 값의 프로토타입 이름 키 — `__proto__`·`constructor`·`toString`이 편집·미리보기·저장에서 보통 키처럼 다뤄지는지
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용합니다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import type { FormulaContext, GridCell, SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import { evaluateFormula, validateSlipFile } from '@omdc-slipkit/core';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  loadDesigner,
  selectElement,
} from './helpers.js';
import type { Designer } from './helpers.js';
import {
  cloneOwn,
  deleteOwn,
  entriesOwn,
  hasOwn,
  readOwn,
  renameOwn,
  writeOwn,
} from '../../src/designer/own-map.js';
import { renameParameterReferences, renameSampleFieldKey } from '../../src/designer/parameters.js';
import { gridCellMergeText, gridCellPreviewText } from '../../src/designer/render/canvas.js';
import type { CanvasContext } from '../../src/designer/render/canvas.js';

installDesignerTestEnv();

const PROTO_KEYS = ['__proto__', 'constructor', 'toString'] as const;

/** JSON 본문에서 만든 객체 — `__proto__`가 자체 속성인 상태를 그대로 재현합니다. */
function json<T = Record<string, unknown>>(text: string): T {
  return JSON.parse(text) as T;
}

function fileOf(el: Element): SlipTemplateFile {
  return (el as unknown as { _file: SlipTemplateFile })._file;
}

function samplesOf(el: Element): Record<string, unknown> | undefined {
  return fileOf(el).template.sampleValues as Record<string, unknown> | undefined;
}

function byAria(el: Element, label: string): HTMLButtonElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`버튼을 찾지 못했습니다: ${label}`);
  return found;
}

function inputByAria(el: Element, label: string): HTMLInputElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('.modal input'))
    .find((i) => i.getAttribute('aria-label') === label);
  if (!found) throw new Error(`입력칸을 찾지 못했습니다: ${label}`);
  return found as HTMLInputElement;
}

async function change(el: Designer, input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await el.updateComplete;
}

async function mountWith(file: SlipTemplateFile): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
  return loadDesigner();
}

async function openSampleModal(el: Designer): Promise<void> {
  byAria(el, strings.designer.sampleData).click();
  await el.updateComplete;
}

/** 프로토타입 이름 키 3개를 스칼라 파라미터로 선언하고 필드 요소가 각각 참조하는 양식 */
function makeScalarFile(): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.parameters = PROTO_KEYS.map((key) => ({ key }));
  file.template.pages[0]!.elements = PROTO_KEYS.map((key, i) => ({
    type: 'field' as const, id: `f-${i}`, name: `field-${key}`,
    position: { x: 10, y: 10 + i * 12 }, width: 40, height: 8, parameter: key,
  })) as never;
  return file;
}

/** 목록 파라미터 `items`의 하위 필드로 프로토타입 이름 키를 쓰는 반복 그리드 양식 */
function makeListFile(fieldKeys: readonly string[] = PROTO_KEYS): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.parameters = [
    { key: 'items', valueType: 'list', fields: fieldKeys.map((key) => ({ key })) },
  ];
  file.template.pages[0]!.elements = [{
    type: 'grid' as const, id: 'g-items', name: '품목',
    position: { x: 10, y: 10 },
    rows: [{ height: 8 }, { height: 8 }],
    columns: fieldKeys.map(() => ({ width: 30 })),
    repeat: {
      parameter: 'items',
      bands: [
        { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
        { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
      ],
      pagination: { mode: 'fixed', itemsPerPage: 2 },
    },
    cells: [
      ...fieldKeys.map((key, column) => ({ row: 0, column, content: `헤더 ${key}` })),
      ...fieldKeys.map((key, column) => ({ row: 1, column, parameter: key })),
    ],
  } as never];
  return file;
}

// ---------------------------------------------------------------------------
// 자체 속성 도우미
// ---------------------------------------------------------------------------

describe('own-map 도우미', () => {
  it('물려받은 속성은 없는 값으로 보고 자체 속성만 읽는다', () => {
    const empty: Record<string, unknown> = {};
    for (const key of PROTO_KEYS) {
      expect(hasOwn(empty, key)).toBe(false);
      expect(readOwn(empty, key)).toBeUndefined();
    }
    expect(hasOwn(undefined, 'constructor')).toBe(false);
    expect(readOwn(undefined, 'constructor')).toBeUndefined();

    const filled = json('{"__proto__": 1, "constructor": "c", "toString": null}');
    expect(readOwn(filled, '__proto__')).toBe(1);
    expect(readOwn(filled, 'constructor')).toBe('c');
    expect(hasOwn(filled, 'toString')).toBe(true);
    expect(readOwn(filled, 'toString')).toBeNull();
  });

  it('writeOwn은 프로토타입을 바꾸지 않고 자체 데이터 속성을 넣으며 넣은 순서를 지킨다', () => {
    const record: Record<string, unknown> = {};
    writeOwn(record, 'a', 1);
    writeOwn(record, '__proto__', 2);
    writeOwn(record, 'constructor', 3);
    writeOwn(record, 'toString', 4);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(entriesOwn(record)).toEqual([['a', 1], ['__proto__', 2], ['constructor', 3], ['toString', 4]]);
    // 이미 있는 키는 자리를 지키고 값만 바뀝니다.
    writeOwn(record, '__proto__', 20);
    expect(Object.keys(record)).toEqual(['a', '__proto__', 'constructor', 'toString']);
    expect(JSON.parse(JSON.stringify(record))).toEqual(
      json('{"a": 1, "__proto__": 20, "constructor": 3, "toString": 4}'),
    );
  });

  it('deleteOwn은 자체 속성만 지우고 물려받은 속성은 건드리지 않는다', () => {
    const record = json('{"__proto__": 1, "b": 2}');
    deleteOwn(record, '__proto__');
    deleteOwn(record, 'constructor');
    expect(Object.keys(record)).toEqual(['b']);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(typeof record.constructor).toBe('function');
  });

  it('cloneOwn은 자체 속성만 같은 순서로 복사한다', () => {
    const source = json('{"z": 1, "__proto__": {"nested": true}, "constructor": "c"}');
    const copy = cloneOwn(source);
    expect(copy).not.toBe(source);
    expect(entriesOwn(copy)).toEqual(entriesOwn(source));
    expect(hasOwn(copy, '__proto__')).toBe(true);
    // 얕은 복사라 값 객체는 공유합니다.
    expect(readOwn(copy, '__proto__')).toBe(readOwn(source, '__proto__'));
  });

  it('renameOwn은 키 자리를 유지한 채 이름만 바꾼다', () => {
    const source = json('{"a": 1, "amount": 5, "z": 9}');
    const renamed = renameOwn(source, 'amount', '__proto__');
    expect(entriesOwn(renamed)).toEqual([['a', 1], ['__proto__', 5], ['z', 9]]);
    expect(entriesOwn(renameOwn(renamed, '__proto__', 'constructor')))
      .toEqual([['a', 1], ['constructor', 5], ['z', 9]]);
    // 없는 키나 같은 이름이면 그대로 복사합니다.
    expect(entriesOwn(renameOwn(source, 'constructor', 'x'))).toEqual(entriesOwn(source));
    expect(entriesOwn(renameOwn(source, 'amount', 'amount'))).toEqual(entriesOwn(source));
    // 새 이름이 이미 다른 자리에 있으면 옮긴 값이 남습니다.
    expect(entriesOwn(renameOwn(json('{"a": 1, "b": 2}'), 'a', 'b'))).toEqual([['b', 1]]);
  });
});

// ---------------------------------------------------------------------------
// 키 변경 (순수 함수)
// ---------------------------------------------------------------------------

describe('renameParameterReferences 샘플 키', () => {
  function makeFile(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'amount' }];
    file.template.sampleValues = json('{"a": 1, "amount": 5, "z": 9}') as never;
    return file;
  }

  it.each(PROTO_KEYS)('최상위 키를 %s로 바꿔도 샘플 값과 자리를 유지한다', (next) => {
    const file = makeFile();
    renameParameterReferences(file, 'amount', next);
    const samples = file.template.sampleValues as Record<string, unknown>;
    expect(entriesOwn(samples)).toEqual([['a', 1], [next, 5], ['z', 9]]);
    expect(hasOwn(samples, next)).toBe(true);
    expect(Object.getPrototypeOf(samples)).toBe(Object.prototype);

    // 되돌리면 원래 모양으로 돌아옵니다.
    renameParameterReferences(file, next, 'amount');
    expect(entriesOwn(file.template.sampleValues as Record<string, unknown>))
      .toEqual([['a', 1], ['amount', 5], ['z', 9]]);
  });

  it('샘플이 없는 키를 프로토타입 이름으로 바꿔도 물려받은 값을 샘플로 넣지 않는다', () => {
    const file = makeFile();
    file.template.parameters!.push({ key: 'unused' });
    renameParameterReferences(file, 'unused', 'constructor');
    expect(entriesOwn(file.template.sampleValues as Record<string, unknown>))
      .toEqual([['a', 1], ['amount', 5], ['z', 9]]);
    renameParameterReferences(file, 'constructor', 'other');
    expect(Object.keys(file.template.sampleValues as object)).toEqual(['a', 'amount', 'z']);
  });
});

describe('renameSampleFieldKey', () => {
  function makeFile(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.sampleValues = json(
      '{"items": [{"a": 1, "name": "x", "z": 2}, {"qty": 3}, "junk", null], "name": "top"}',
    ) as never;
    return file;
  }

  it.each(PROTO_KEYS)('하위 필드 키를 %s로 바꾸면 그 키가 있는 행만 자리를 지키며 옮긴다', (next) => {
    const file = makeFile();
    renameSampleFieldKey(file, 'items', 'name', next);
    const rows = readOwn(file.template.sampleValues, 'items') as unknown[];
    expect(entriesOwn(rows[0] as Record<string, unknown>)).toEqual([['a', 1], [next, 'x'], ['z', 2]]);
    expect(rows[1]).toEqual({ qty: 3 });
    expect(rows.slice(2)).toEqual(['junk', null]);
    // 최상위의 같은 이름 키는 하위 필드가 아니므로 그대로 둡니다.
    expect(readOwn(file.template.sampleValues, 'name')).toBe('top');

    renameSampleFieldKey(file, 'items', next, 'name');
    const back = readOwn(file.template.sampleValues, 'items') as unknown[];
    expect(entriesOwn(back[0] as Record<string, unknown>)).toEqual([['a', 1], ['name', 'x'], ['z', 2]]);
  });

  it('샘플이 없거나 목록이 아니면 아무것도 바꾸지 않는다', () => {
    const file = makeTemplateFile();
    expect(() => renameSampleFieldKey(file, 'items', 'name', '__proto__')).not.toThrow();
    expect(file.template.sampleValues).toBeUndefined();
    file.template.sampleValues = json('{"items": "text"}') as never;
    renameSampleFieldKey(file, 'items', 'name', '__proto__');
    expect(file.template.sampleValues).toEqual({ items: 'text' });
    // 물려받은 `constructor`를 목록으로 오해하지 않습니다.
    renameSampleFieldKey(file, 'constructor', 'name', '__proto__');
    expect(Object.keys(file.template.sampleValues as object)).toEqual(['items']);
  });
});

// ---------------------------------------------------------------------------
// 디자이너 화면
// ---------------------------------------------------------------------------

describe('<slip-designer> 샘플 데이터의 프로토타입 이름 키', () => {
  const JSON_BODY = '{"__proto__": 7, "constructor": "c", "toString": "t", "items": [{"__proto__": 1, "name": "x", "toString": "row"}]}';

  /** 스칼라 3개와 목록 `items`(하위 필드 `__proto__`·`name`·`toString`)를 함께 선언한 양식 */
  function makeJsonFile(): SlipTemplateFile {
    const file = makeListFile(['__proto__', 'name', 'toString']);
    file.template.parameters!.push(...PROTO_KEYS.map((key) => ({ key })));
    file.template.pages[0]!.elements.push(...makeScalarFile().template.pages[0]!.elements);
    return file;
  }

  async function applyJson(el: Designer, text: string): Promise<void> {
    byAria(el, `${strings.designer.sampleData}: JSON`).click();
    await el.updateComplete;
    const textarea = el.shadowRoot!.querySelector('.sample-json') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    const apply = Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.apply) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    apply.click();
    await el.updateComplete;
  }

  /** 자체 속성만 깊이 비교할 수 있도록 JSON으로 다시 만든 값 */
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it('JSON 편집으로 넣은 값을 입력한 그대로 순서까지 보관하고 변경 이벤트와 저장 본문에도 남긴다', async () => {
    const el = await mountWith(makeJsonFile());
    const changes: SlipTemplateFile[] = [];
    el.addEventListener('slip-change', (e) => changes.push((e as CustomEvent<{ file: SlipTemplateFile }>).detail.file));
    await openSampleModal(el);
    await applyJson(el, JSON_BODY);

    const samples = samplesOf(el)!;
    expect(Object.keys(samples)).toEqual(['__proto__', 'constructor', 'toString', 'items']);
    expect(plain(samples)).toEqual(json(JSON_BODY));
    expect(Object.getPrototypeOf(samples)).toBe(Object.prototype);
    const row = (readOwn(samples, 'items') as Record<string, unknown>[])[0]!;
    expect(hasOwn(row, '__proto__')).toBe(true);
    expect(Object.keys(row)).toEqual(['__proto__', 'name', 'toString']);

    // 변경 이벤트의 복제본과 저장 본문(JSON)도 같은 값을 담습니다.
    const emitted = changes.at(-1)!.template.sampleValues as Record<string, unknown>;
    expect(Object.keys(emitted)).toEqual(['__proto__', 'constructor', 'toString', 'items']);
    expect(plain(emitted)).toEqual(json(JSON_BODY));
    expect(plain(JSON.parse(JSON.stringify(fileOf(el))).template.sampleValues)).toEqual(json(JSON_BODY));

    // 폼 편집으로 돌아오면 입력칸에 그 값이 보입니다 (물려받은 함수가 아니라).
    byAria(el, `${strings.designer.sampleData}: ${strings.designer.formMode}`).click();
    await el.updateComplete;
    expect(inputByAria(el, `${strings.designer.sampleData} __proto__`).value).toBe('7');
    expect(inputByAria(el, `${strings.designer.sampleData} constructor`).value).toBe('c');
    expect(inputByAria(el, `${strings.designer.sampleData} toString`).value).toBe('t');
    el.remove();
  });

  it('폼 편집의 스칼라 입력은 값이 없으면 비어 보이고, 넣고 지운 값은 자체 속성으로만 오간다', async () => {
    const el = await mountWith(makeScalarFile());
    await openSampleModal(el);
    for (const key of PROTO_KEYS) {
      expect(inputByAria(el, `${strings.designer.sampleData} ${key}`).value).toBe('');
    }

    await change(el, inputByAria(el, `${strings.designer.sampleData} __proto__`), '12');
    expect(entriesOwn(samplesOf(el)!)).toEqual([['__proto__', 12]]);
    expect(Object.getPrototypeOf(samplesOf(el))).toBe(Object.prototype);

    await change(el, inputByAria(el, `${strings.designer.sampleData} constructor`), 'abc');
    await change(el, inputByAria(el, `${strings.designer.sampleData} toString`), 'T');
    expect(entriesOwn(samplesOf(el)!)).toEqual([['__proto__', 12], ['constructor', 'abc'], ['toString', 'T']]);
    expect(inputByAria(el, `${strings.designer.sampleData} constructor`).value).toBe('abc');

    // 값을 지우면 자체 속성만 사라지고 나머지 순서는 그대로입니다.
    await change(el, inputByAria(el, `${strings.designer.sampleData} __proto__`), '');
    expect(entriesOwn(samplesOf(el)!)).toEqual([['constructor', 'abc'], ['toString', 'T']]);
    expect(inputByAria(el, `${strings.designer.sampleData} __proto__`).value).toBe('');
    await change(el, inputByAria(el, `${strings.designer.sampleData} constructor`), '');
    await change(el, inputByAria(el, `${strings.designer.sampleData} toString`), '');
    expect(fileOf(el).template.sampleValues).toBeUndefined();
    el.remove();
  });

  it('폼 편집의 목록 표는 행마다 프로토타입 이름 키를 자체 속성으로 넣고 지운다', async () => {
    const el = await mountWith(makeListFile());
    await openSampleModal(el);
    byAria(el, `items ${strings.designer.addRow}`).click();
    await el.updateComplete;
    for (const key of PROTO_KEYS) {
      expect(inputByAria(el, `items 1 ${key}`).value).toBe('');
    }

    await change(el, inputByAria(el, `items 1 __proto__`), 'x');
    await change(el, inputByAria(el, `items 1 constructor`), '5');
    await change(el, inputByAria(el, `items 1 toString`), 'T');
    const rows = () => readOwn(samplesOf(el), 'items') as Record<string, unknown>[];
    expect(rows().map(entriesOwn)).toEqual([[['__proto__', 'x'], ['constructor', 5], ['toString', 'T']]]);
    expect(Object.getPrototypeOf(rows()[0])).toBe(Object.prototype);
    expect(inputByAria(el, `items 1 __proto__`).value).toBe('x');
    expect(inputByAria(el, `items 1 constructor`).value).toBe('5');

    // 행을 하나 더 넣어도 앞 행의 `__proto__`가 복사에서 빠지지 않습니다.
    byAria(el, `items ${strings.designer.addRow}`).click();
    await el.updateComplete;
    expect(rows().map(entriesOwn)).toEqual([[['__proto__', 'x'], ['constructor', 5], ['toString', 'T']], []]);

    await change(el, inputByAria(el, `items 1 __proto__`), '');
    expect(rows().map(entriesOwn)).toEqual([[['constructor', 5], ['toString', 'T']], []]);

    byAria(el, `items 2 ${strings.designer.delete}`).click();
    await el.updateComplete;
    expect(rows().map(entriesOwn)).toEqual([[['constructor', 5], ['toString', 'T']]]);
    byAria(el, `items 1 ${strings.designer.delete}`).click();
    await el.updateComplete;
    expect(fileOf(el).template.sampleValues).toBeUndefined();
    el.remove();
  });

  it('사이드바에서 최상위 키를 프로토타입 이름으로 바꾸고 되돌려도 샘플 값과 자리가 남는다', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'amount' }];
    file.template.pages[0]!.elements = [{
      type: 'field' as const, id: 'f-1', name: 'amount-field',
      position: { x: 10, y: 10 }, width: 40, height: 8, parameter: 'amount',
    }] as never;
    file.template.sampleValues = json('{"a": 1, "amount": 5, "z": 9}') as never;
    const el = await mountWith(file);

    const rename = async (from: string, to: string): Promise<void> => {
      const row = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-row'))
        .find((b) => b.getAttribute('title') === from);
      if (!row) throw new Error(`파라미터 줄을 찾지 못했습니다: ${from}`);
      row.click();
      await el.updateComplete;
      await change(el, el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement, to);
    };

    let current = 'amount';
    for (const next of [...PROTO_KEYS, 'amount']) {
      await rename(current, next);
      expect(entriesOwn(samplesOf(el)!)).toEqual([['a', 1], [next, 5], ['z', 9]]);
      expect(fileOf(el).template.parameters![0]!.key).toBe(next);
      expect((fileOf(el).template.pages[0]!.elements[0] as { parameter?: string }).parameter).toBe(next);
      current = next;
    }
    el.remove();
  });

  it('사이드바에서 하위 필드 키를 프로토타입 이름으로 바꾸고 되돌려도 샘플 행의 값과 자리가 남는다', async () => {
    const file = makeListFile(['name', 'qty']);
    file.template.sampleValues = json('{"items": [{"a": 1, "name": "x", "qty": 2}, {"qty": 3}]}') as never;
    const el = await mountWith(file);
    const twisty = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-twisty'))
      .find((b) => b.getAttribute('aria-label')?.startsWith('items '));
    twisty!.click();
    await el.updateComplete;

    const rename = async (from: string, to: string): Promise<void> => {
      const row = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.side-col-row'))
        .find((b) => b.getAttribute('title') === `items.${from}`);
      if (!row) throw new Error(`하위 필드 줄을 찾지 못했습니다: ${from}`);
      row.click();
      await el.updateComplete;
      await change(el, el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement, to);
    };

    let current = 'name';
    for (const next of [...PROTO_KEYS, 'name']) {
      await rename(current, next);
      const rows = readOwn(samplesOf(el), 'items') as Record<string, unknown>[];
      expect(rows.map(entriesOwn)).toEqual([[['a', 1], [next, 'x'], ['qty', 2]], [['qty', 3]]]);
      expect(fileOf(el).template.parameters![0]!.fields!.map((f) => f.key)).toEqual([next, 'qty']);
      const grid = fileOf(el).template.pages[0]!.elements[0] as { cells: { row: number; column: number; parameter?: string }[] };
      expect(grid.cells.find((c) => c.row === 1 && c.column === 0)!.parameter).toBe(next);
      current = next;
    }
    el.remove();
  });

  it('JSON 초안 뼈대와 수식 검사용 값은 프로토타입 이름 키를 선언대로 채우고 기존 값을 잃지 않는다', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [
      { key: 'constructor' },
      { key: 'toString', valueType: 'number' },
      { key: 'items', valueType: 'list', fields: [{ key: '__proto__' }, { key: 'toString', valueType: 'number' }] },
    ];
    file.template.sampleValues = json('{"constructor": "c", "items": [{"__proto__": 1, "extra": 2}]}') as never;
    const el = await mountWith(file);
    const internals = el as unknown as {
      _sampleSkeleton(): Record<string, unknown>;
      _formulaProbeValues(): Record<string, unknown>;
    };

    const skeleton = internals._sampleSkeleton();
    // 기존 키는 순서대로 그대로 두고, 선언됐지만 없는 toString만 뒤에 덧붙입니다. 행에도 빠진 필드를 넣지 않습니다.
    expect(Object.keys(skeleton)).toEqual(['constructor', 'items', 'toString']);
    expect(plain(skeleton)).toEqual(json('{"constructor": "c", "items": [{"__proto__": 1, "extra": 2}], "toString": 0}'));
    const row = (readOwn(skeleton, 'items') as Record<string, unknown>[])[0]!;
    expect(Object.keys(row)).toEqual(['__proto__', 'extra']);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    // JSON 편집 탭의 초안도 같은 본문입니다.
    await openSampleModal(el);
    byAria(el, `${strings.designer.sampleData}: JSON`).click();
    await el.updateComplete;
    const textarea = el.shadowRoot!.querySelector('.sample-json') as HTMLTextAreaElement;
    expect(json(textarea.value)).toEqual(plain(skeleton));

    // 검사용 값은 있는 샘플을 그대로 두고 없는 것만 종류에 맞는 값으로 채웁니다.
    const probe = internals._formulaProbeValues();
    expect(Object.keys(probe)).toEqual(['constructor', 'items', 'toString']);
    expect(readOwn(probe, 'constructor')).toBe('c');
    expect(readOwn(probe, 'toString')).toBe(1);
    expect(plain(readOwn(probe, 'items'))).toEqual(json('[{"__proto__": 1, "extra": 2}]'));

    // 샘플이 하나도 없으면 목록 항목의 프로토타입 이름 필드도 자체 속성으로 채웁니다.
    delete (fileOf(el).template as { sampleValues?: unknown }).sampleValues;
    const bare = internals._formulaProbeValues();
    expect(Object.keys(bare)).toEqual(['constructor', 'toString', 'items']);
    const bareRow = (readOwn(bare, 'items') as Record<string, unknown>[])[0]!;
    expect(entriesOwn(bareRow)).toEqual([['__proto__', '가'], ['toString', 1]]);
    el.remove();
  });

  it('셀 미리보기 글은 물려받은 속성을 값으로 읽지 않는다', () => {
    const file = makeTemplateFile();
    file.template.sampleValues = json('{"__proto__": "top"}') as never;
    const ctx = {
      file,
      evaluate: (source: string, context: FormulaContext) => evaluateFormula(source, context),
    } as unknown as CanvasContext;
    const cell = (parameter: string): GridCell => ({ row: 0, column: 0, parameter }) as GridCell;
    expect(gridCellPreviewText(ctx, cell('constructor'), undefined).text).toBe('{constructor}');
    expect(gridCellPreviewText(ctx, cell('toString'), undefined).text).toBe('{toString}');
    expect(gridCellPreviewText(ctx, cell('toString'), json('{"toString": "T"}')).text).toBe('T');
    expect(gridCellPreviewText(ctx, cell('__proto__'), undefined).text).toBe('top');
    expect(gridCellPreviewText(ctx, cell('__proto__'), json('{"__proto__": "row"}')).text).toBe('row');
    expect(gridCellMergeText(ctx, cell('constructor'), undefined)).toBe('');
    expect(gridCellMergeText(ctx, cell('__proto__'), json('{"__proto__": 0}'))).toBe('0');
  });

  it('캔버스 미리보기는 값이 없는 프로토타입 이름 셀에 자리표시자를 보이고 값이 있으면 그 값을 보인다', async () => {
    const el = await mountWith(makeListFile());
    // 선택한 그리드는 원본 행 구조를 보이므로 항목 구간 셀에 첫 샘플 항목이 적용됩니다.
    selectElement(el, 'g-items');
    await el.updateComplete;
    const itemCells = () => Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > .grid-cell'))
      .slice(PROTO_KEYS.length)
      .map((c) => c.textContent?.trim());
    expect(itemCells()).toEqual(['{__proto__}', '{constructor}', '{toString}']);

    fileOf(el).template.sampleValues = json('{"items": [{"__proto__": "abc", "toString": 0}]}') as never;
    el.requestUpdate();
    await el.updateComplete;
    expect(itemCells()).toEqual(['abc', '{constructor}', '0']);
    el.remove();
  });

  it('이미지 요소는 `__proto__` 파라미터의 샘플 이미지를 표시하고 없으면 키를 표시한다', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: '__proto__', valueType: 'image' }, { key: 'constructor', valueType: 'image' }];
    file.template.pages[0]!.elements = [
      { type: 'image' as const, id: 'img-1', name: 'a', position: { x: 10, y: 10 }, width: 20, height: 20, parameter: '__proto__' },
      { type: 'image' as const, id: 'img-2', name: 'b', position: { x: 40, y: 10 }, width: 20, height: 20, parameter: 'constructor' },
    ] as never;
    const el = await mountWith(file);
    const box = (id: string) => el.shadowRoot!.querySelector(`[data-id="${id}"]`)!;
    expect(box('img-1').textContent).toContain('{__proto__}');
    expect(box('img-2').textContent).toContain('{constructor}');

    fileOf(el).template.sampleValues = json('{"__proto__": "data:image/png;base64,AAAA"}') as never;
    el.requestUpdate();
    await el.updateComplete;
    expect(box('img-1').querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(box('img-2').textContent).toContain('{constructor}');
    el.remove();
  });

  it('저장 본문으로 다시 연 양식도 입력한 샘플 값을 순서대로 담는다', async () => {
    const el = await mountWith(makeJsonFile());
    await openSampleModal(el);
    await applyJson(el, JSON_BODY);
    const body = JSON.stringify(fileOf(el));
    el.remove();

    const reopened = await mountWith(json<SlipTemplateFile>(body));
    const samples = samplesOf(reopened)!;
    expect(Object.keys(samples)).toEqual(['__proto__', 'constructor', 'toString', 'items']);
    expect(plain(samples)).toEqual(json(JSON_BODY));
    await openSampleModal(reopened);
    expect(inputByAria(reopened, `${strings.designer.sampleData} __proto__`).value).toBe('7');
    expect(inputByAria(reopened, `items 1 __proto__`).value).toBe('1');
    expect(inputByAria(reopened, `items 1 toString`).value).toBe('row');
    reopened.remove();
  });
});

// ---------------------------------------------------------------------------
// JSON 초안과 변경 없는 적용의 보존
// ---------------------------------------------------------------------------

describe('<slip-designer> 샘플 JSON 초안은 기존 값의 모양과 미정의 키를 그대로 둔다', () => {
  /** 정의에 없는 키, 프로토타입 이름 키, 비배열 목록 값, 빈 배열, 원시값·null·일부 필드만 있는 행을 함께 둔 샘플 */
  const SAMPLE = '{"z": 1, "__proto__": 7, "constructor": "c", "items": "text", "rows": [], "flags": [1, null, {"name": "x"}], "a.b": {"__proto__": "n", "toString": "s"}}';
  /** 폼 → JSON 초안: 기존 키는 순서대로, 선언됐지만 없는 toString만 끝에 빈 값으로 덧붙는다 */
  const DRAFT = SAMPLE.slice(0, -1) + ', "toString": ""}';
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  function makeFile(): SlipTemplateFile {
    const file = makeListFile(['__proto__', 'name', 'toString']);
    file.template.parameters!.push(
      ...PROTO_KEYS.map((key) => ({ key })),
      { key: 'rows', valueType: 'list', fields: [{ key: 'name' }, { key: 'qty', valueType: 'number' }] },
      { key: 'flags', valueType: 'list', fields: [{ key: 'name' }] },
    );
    file.template.pages[0]!.elements.push(...makeScalarFile().template.pages[0]!.elements);
    file.template.sampleValues = json(SAMPLE) as never;
    return file;
  }

  function jsonTextarea(el: Designer): HTMLTextAreaElement {
    return el.shadowRoot!.querySelector('.sample-json') as HTMLTextAreaElement;
  }

  async function toJsonMode(el: Designer): Promise<void> {
    byAria(el, `${strings.designer.sampleData}: JSON`).click();
    await el.updateComplete;
  }

  async function toFormMode(el: Designer): Promise<void> {
    byAria(el, `${strings.designer.sampleData}: ${strings.designer.formMode}`).click();
    await el.updateComplete;
  }

  async function applyWithoutEditing(el: Designer): Promise<void> {
    const apply = Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.apply) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    apply.click();
    await el.updateComplete;
  }

  it('폼 → JSON 초안이 기존 값을 순서까지 담고 없는 파라미터만 빈 값으로 덧붙인다', async () => {
    const el = await mountWith(makeFile());
    await openSampleModal(el);
    await toJsonMode(el);
    const draft = json(jsonTextarea(el).value);
    expect(Object.keys(draft)).toEqual(['z', '__proto__', 'constructor', 'items', 'rows', 'flags', 'a.b', 'toString']);
    expect(plain(draft)).toEqual(json(DRAFT));
    // 비배열 목록 값·빈 배열·원시값·null·일부 필드만 있는 행이 그대로다.
    expect(readOwn(draft, 'items')).toBe('text');
    expect(readOwn(draft, 'rows')).toEqual([]);
    expect(plain(readOwn(draft, 'flags'))).toEqual([1, null, { name: 'x' }]);
    expect(Object.keys(readOwn(draft, 'a.b') as object)).toEqual(['__proto__', 'toString']);
    el.remove();
  });

  it('JSON → 폼 → JSON을 오가도 초안이 같고, 고치지 않고 적용해도 기존 값이 깊은 동등으로 남는다', async () => {
    const el = await mountWith(makeFile());
    const changes: SlipTemplateFile[] = [];
    el.addEventListener('slip-change', (e) => changes.push((e as CustomEvent<{ file: SlipTemplateFile }>).detail.file));
    await openSampleModal(el);
    await toJsonMode(el);
    const first = jsonTextarea(el).value;
    await toFormMode(el);
    await toJsonMode(el);
    expect(jsonTextarea(el).value).toBe(first);

    await applyWithoutEditing(el);
    const samples = samplesOf(el)!;
    expect(Object.keys(samples)).toEqual(['z', '__proto__', 'constructor', 'items', 'rows', 'flags', 'a.b', 'toString']);
    expect(plain(samples)).toEqual(json(DRAFT));
    expect(Object.getPrototypeOf(samples)).toBe(Object.prototype);
    expect(hasOwn(samples, '__proto__')).toBe(true);
    expect(hasOwn(readOwn(samples, 'a.b') as Record<string, unknown>, '__proto__')).toBe(true);

    // 변경 이벤트의 복제본, 직렬화 본문, core 파서를 거친 결과가 모두 같다.
    const emitted = changes.at(-1)!.template.sampleValues as Record<string, unknown>;
    expect(Object.keys(emitted)).toEqual(Object.keys(samples));
    expect(plain(emitted)).toEqual(json(DRAFT));
    const text = JSON.stringify(fileOf(el));
    expect(plain(JSON.parse(text).template.sampleValues)).toEqual(json(DRAFT));
    const reparsed = validateSlipFile(JSON.parse(text));
    if (reparsed.kind !== 'template') throw new Error('template expected');
    expect(Object.keys(reparsed.template.sampleValues as object)).toEqual(Object.keys(samples));
    expect(plain(reparsed.template.sampleValues)).toEqual(json(DRAFT));

    // 다시 JSON 초안을 열어도 같은 본문이다.
    await toFormMode(el);
    await toJsonMode(el);
    expect(json(jsonTextarea(el).value)).toEqual(json(DRAFT));
    el.remove();
  });
});
