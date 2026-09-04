// @vitest-environment happy-dom
/**
 * `<slip-form>`이 특수한 파라미터 키를 다루는 방식 테스트.
 *
 * 키는 어떤 문자열이든 될 수 있습니다 — 점·공백·하이픈·숫자 시작·한글은 물론 `__proto__`·
 * `constructor`·`toString`도 업무 데이터의 키입니다. 레이블과 입력은 키가 아닌 순번 id로 잇고,
 * 값 객체는 프로토타입 체인을 거치지 않고 자신의 속성만 읽고 씁니다.
 *
 * PDF 렌더링만 모의하고 파싱과 수식에는 core의 실제 구현을 사용합니다.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return { ...actual, renderSlipToPdf: vi.fn() };
});

vi.mock('../src/default-fonts.js', () => ({
  loadDefaultFonts: () =>
    Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import {
  CURRENT_SCHEMA_VERSION,
  renderSlipToPdf,
  serializeSlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { SlipForm } from '../src/slip-form.js';
import { getStrings } from '../src/strings.js';

// 기본 영어 문구를 기준으로 화면을 확인합니다.
const strings = getStrings();

const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);
const DUMMY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

if (!customElements.get('slip-form')) {
  customElements.define('slip-form', SlipForm);
}

/** 화면에 나타나야 하는 특수 키. 순서는 정의부 순서와 같습니다. */
const SPECIAL_KEYS = ['a.b', 'a-b', 'a b', '1a', '한글', '__proto__', 'constructor', 'toString', 'it"s'];

/** 특수 키를 스칼라 파라미터와 목록 하위 필드로 두루 가진 양식 */
function makeKeyedTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '특수 키 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [{
        elements: [
          {
            type: 'field', id: 'f-proto', name: '프로토 필드',
            position: { x: 15, y: 20 }, width: 60, height: 8, parameter: '__proto__',
          },
          {
            type: 'grid', id: 'g-rows', name: '행 표',
            position: { x: 15, y: 40 },
            columns: [{ width: 90 }, { width: 90 }],
            rows: [{ height: 8 }, { height: 8 }],
            cells: [
              { row: 0, column: 0, content: '프로토' },
              { row: 0, column: 1, content: '수량' },
              { row: 1, column: 0, parameter: '__proto__' },
              { row: 1, column: 1, parameter: 'constructor' },
            ],
            repeat: {
              parameter: 'rows',
              bands: [
                { id: 'rows-header', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'rows-item', fromRow: 1, toRow: 1, placement: 'item' },
              ],
              pagination: { mode: 'auto', minItems: 1 },
            },
          },
        ],
      }],
      assets: [],
      parameters: [
        ...SPECIAL_KEYS.map((key) => ({ key, label: `L:${key}` })),
        { key: 'flag', label: '동의', valueType: 'boolean' },
        {
          key: 'rows', label: '행', valueType: 'list',
          fields: [{ key: '__proto__', label: '프로토' }, { key: 'constructor', label: '수량', valueType: 'number' }],
        },
      ],
    },
  };
}

beforeEach(() => {
  let counter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++counter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  renderSlipToPdfMock.mockReset();
  renderSlipToPdfMock.mockResolvedValue(DUMMY_PDF);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function mount(file: SlipTemplateFile | SlipVoucherFile = makeKeyedTemplate()): Promise<SlipForm> {
  const el = document.createElement('slip-form') as SlipForm;
  document.body.appendChild(el);
  el.src = serializeSlipFile(file);
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

function inputByLabel(el: SlipForm, label: string): HTMLInputElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('input'))
    .find((i) => i.getAttribute('aria-label') === label);
  if (!found) throw new Error(`입력을 찾지 못했습니다: ${label}`);
  return found;
}

function buttonByLabel(el: SlipForm, label: string): HTMLButtonElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
  if (!found) throw new Error(`버튼을 찾지 못했습니다: ${label}`);
  return found as HTMLButtonElement;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 마지막 `slip-change` 이벤트의 전표를 돌려주는 기록기 */
function trackChange(el: SlipForm): () => SlipVoucherFile {
  let last: SlipVoucherFile | null = null;
  el.addEventListener('slip-change', (e) => {
    last = (e as CustomEvent<{ file: SlipVoucherFile }>).detail.file;
  });
  return () => {
    if (!last) throw new Error('slip-change가 발생하지 않았습니다');
    return last;
  };
}

/** 폼의 현재 값 객체 (테스트 전용 내부 접근) */
function valuesOf(el: SlipForm): Record<string, unknown> {
  return (el as unknown as { _values: Record<string, unknown> })._values;
}

describe('<slip-form> 특수 키의 레이블 연결', () => {
  it('키에 점·공백·따옴표·한글이 있어도 레이블의 for가 실제 입력 id를 가리킨다', async () => {
    const el = await mount();
    const root = el.shadowRoot!;
    const labels = Array.from(root.querySelectorAll('label[for]'));
    expect(labels.length).toBeGreaterThanOrEqual(SPECIAL_KEYS.length);
    for (const label of labels) {
      const target = root.getElementById(label.getAttribute('for')!);
      expect(target, `label "${label.textContent?.trim()}"`).not.toBeNull();
      expect(target!.tagName).toBe('INPUT');
      // 레이블 문구가 그 입력의 aria-label과 같아야 서로 잇는 것이다.
      expect(target!.getAttribute('aria-label')).toBe(label.textContent?.trim());
    }
    // 키 자체는 id에 들어가지 않는다 — 공백·따옴표가 있는 키도 id 문법과 무관하다.
    const ids = Array.from(root.querySelectorAll('input[id]')).map((i) => i.id);
    for (const key of SPECIAL_KEYS) expect(ids).not.toContain(`f-${key}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('특수 키마다 논리명으로 입력 칸을 만든다', async () => {
    const el = await mount();
    for (const key of SPECIAL_KEYS) {
      expect(inputByLabel(el, `L:${key}`).type).toBe('text');
    }
    expect(inputByLabel(el, '동의').type).toBe('checkbox');
  });
});

describe('<slip-form> 특수 키 값의 왕복', () => {
  it('__proto__·constructor·toString 값이 자신의 속성으로 저장되고 slip-change에 실린다', async () => {
    const el = await mount();
    const lastChange = trackChange(el);
    const rawValues = valuesOf(el);
    const prototype = Object.getPrototypeOf(rawValues);

    setInput(inputByLabel(el, 'L:__proto__'), 'proto-value');
    setInput(inputByLabel(el, 'L:constructor'), 'ctor-value');
    setInput(inputByLabel(el, 'L:toString'), 'ts-value');
    setInput(inputByLabel(el, 'L:a b'), 'space-value');
    await el.updateComplete;

    const values = valuesOf(el);
    expect(Object.hasOwn(values, '__proto__')).toBe(true);
    expect(values['__proto__']).toBe('proto-value');
    expect(Object.hasOwn(values, 'constructor')).toBe(true);
    expect(Object.hasOwn(values, 'toString')).toBe(true);
    // 값 객체의 프로토타입은 바뀌지 않는다.
    expect(Object.getPrototypeOf(values)).toBe(prototype);
    expect(Object.getPrototypeOf(values)).toBeNull();

    const emitted = lastChange().values;
    expect(Object.hasOwn(emitted, '__proto__')).toBe(true);
    expect(emitted['__proto__']).toBe('proto-value');
    expect(emitted['constructor']).toBe('ctor-value');
    expect(emitted['toString']).toBe('ts-value');
    expect(emitted['a b']).toBe('space-value');
    // JSON으로 내보내도 키가 남는다.
    const json = JSON.parse(serializeSlipFile(lastChange())) as { values: Record<string, unknown> };
    expect(Object.hasOwn(json.values, '__proto__')).toBe(true);
    expect(json.values['__proto__']).toBe('proto-value');
    expect(json.values['constructor']).toBe('ctor-value');

    // 다시 표시해도 값이 프로토타입이 아닌 자신의 값으로 읽힌다.
    expect(inputByLabel(el, 'L:__proto__').value).toBe('proto-value');
    expect(inputByLabel(el, 'L:constructor').value).toBe('ctor-value');
  });

  it('입력하지 않은 __proto__·constructor 키는 프로토타입 값 대신 빈 값으로 보인다', async () => {
    const el = await mount();
    expect(inputByLabel(el, 'L:__proto__').value).toBe('');
    expect(inputByLabel(el, 'L:constructor').value).toBe('');
    expect(inputByLabel(el, 'L:toString').value).toBe('');
    const values = valuesOf(el);
    expect(Object.hasOwn(values, 'constructor')).toBe(false);
    expect(Object.hasOwn(values, 'toString')).toBe(false);
  });

  it('값을 지우면 자신의 속성만 없어지고 프로토타입은 그대로다', async () => {
    const el = await mount();
    setInput(inputByLabel(el, 'L:__proto__'), 'x');
    setInput(inputByLabel(el, 'L:constructor'), 'y');
    await el.updateComplete;
    setInput(inputByLabel(el, 'L:__proto__'), '');
    await el.updateComplete;
    expect(Object.hasOwn(valuesOf(el), '__proto__')).toBe(false);
    expect(Object.hasOwn(valuesOf(el), 'constructor')).toBe(true);
    expect(Object.getPrototypeOf(valuesOf(el))).toBeNull();

    buttonByLabel(el, strings.form.reset).click();
    await el.updateComplete;
    expect(Object.keys(valuesOf(el))).toEqual([]);
    expect(Object.getPrototypeOf(valuesOf(el))).toBeNull();

    el.reset();
    await el.updateComplete;
    expect(Object.keys(valuesOf(el))).toEqual([]);
    expect(Object.getPrototypeOf(valuesOf(el))).toBeNull();
  });

  it('전표 src의 constructor·toString·공백 키 값을 자신의 속성으로 읽어 표시한다', async () => {
    const el = await mount({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: makeKeyedTemplate().template,
      values: { constructor: 'from-file', toString: 'ts-file', 'a b': 'ab-file', '한글': '값' },
      issued: false,
    });
    expect(inputByLabel(el, 'L:constructor').value).toBe('from-file');
    expect(inputByLabel(el, 'L:toString').value).toBe('ts-file');
    expect(inputByLabel(el, 'L:a b').value).toBe('ab-file');
    expect(inputByLabel(el, 'L:한글').value).toBe('값');
    expect(Object.getPrototypeOf(valuesOf(el))).toBeNull();
    expect(Object.hasOwn(valuesOf(el), 'constructor')).toBe(true);
  });
});

describe('<slip-form> 특수 키를 가진 목록 행', () => {
  it('__proto__·constructor 하위 필드 값이 행 객체 자신의 속성으로 저장된다', async () => {
    const el = await mount();
    const lastChange = trackChange(el);
    buttonByLabel(el, `행 ${strings.form.addRow}`).click();
    await el.updateComplete;
    // 새 행은 하위 필드 값이 없으므로 프로토타입의 constructor가 보이지 않는다.
    expect(inputByLabel(el, '행 1 프로토').value).toBe('');
    expect(inputByLabel(el, '행 1 수량').value).toBe('');

    setInput(inputByLabel(el, '행 1 프로토'), 'row-proto');
    await el.updateComplete;
    setInput(inputByLabel(el, '행 1 수량'), '3');
    await el.updateComplete;

    const rows = lastChange().values['rows'] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.hasOwn(row, '__proto__')).toBe(true);
    expect(row['__proto__']).toBe('row-proto');
    expect(Object.hasOwn(row, 'constructor')).toBe(true);
    expect(row['constructor']).toBe(3);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(inputByLabel(el, '행 1 프로토').value).toBe('row-proto');
    expect(inputByLabel(el, '행 1 수량').value).toBe('3');

    const json = JSON.parse(serializeSlipFile(lastChange())) as { values: { rows: Record<string, unknown>[] } };
    expect(Object.hasOwn(json.values.rows[0]!, '__proto__')).toBe(true);
    expect(json.values.rows[0]!['constructor']).toBe(3);

    // 값을 비우면 행 자신의 속성만 빠진다.
    setInput(inputByLabel(el, '행 1 프로토'), '');
    await el.updateComplete;
    const cleared = (lastChange().values['rows'] as Record<string, unknown>[])[0]!;
    expect(Object.hasOwn(cleared, '__proto__')).toBe(false);
    expect(cleared['constructor']).toBe(3);
  });

  it('전표 src의 행에 든 constructor 값을 그대로 표시하고 편집한다', async () => {
    const el = await mount({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: makeKeyedTemplate().template,
      values: { rows: [{ constructor: 7 }] },
      issued: false,
    });
    const lastChange = trackChange(el);
    expect(inputByLabel(el, '행 1 수량').value).toBe('7');
    setInput(inputByLabel(el, '행 1 수량'), '8');
    await el.updateComplete;
    const row = (lastChange().values['rows'] as Record<string, unknown>[])[0]!;
    expect(Object.hasOwn(row, 'constructor')).toBe(true);
    expect(row['constructor']).toBe(8);
  });
});
