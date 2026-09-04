// 열린 맵(values·sampleValues·목록 행)이 어떤 키든 객체가 직접 가진 속성으로 왕복하는지 확인한다.
import { describe, expect, it } from 'vitest';
import { buildVoucher, normalizeNumericParameters, parseSlipFile, serializeSlipFile, validateSlipFile } from '../src/index.js';
import type { JsonValue, SlipTemplateFile } from '../src/index.js';
import { CURRENT_SCHEMA_VERSION } from '../src/index.js';

const SPECIAL_KEYS = ['__proto__', 'constructor', 'toString', 'a.b', 'a-b', 'a b', '1a', '한글'] as const;

function template(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '열린 맵' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{ elements: [] }],
      assets: [],
      parameters: [
        { key: '__proto__', label: '프로토', valueType: 'number' },
        { key: 'items', label: '목록', valueType: 'list', fields: [{ key: '__proto__', label: '프로토 필드' }] },
      ],
      sampleValues: Object.fromEntries(SPECIAL_KEYS.map((key, index) => [key, index])),
    },
  } as unknown as SlipTemplateFile;
}

function ownKeys(record: unknown): string[] {
  return Object.keys(record as object);
}

describe('열린 맵의 특수 키 보존', () => {
  it('values·sampleValues·목록 행의 __proto__ 키가 파싱 뒤에도 직접 가진 속성으로 남는다', () => {
    const rows = [JSON.parse('{"__proto__": 1, "constructor": 2, "n": 3}') as JsonValue];
    const voucher = buildVoucher(template(), { ...Object.fromEntries(SPECIAL_KEYS.map((key, index) => [key, index])), items: rows });
    const parsed = parseSlipFile(serializeSlipFile(voucher));
    expect(parsed.kind).toBe('voucher');
    if (parsed.kind !== 'voucher') return;
    for (const key of SPECIAL_KEYS) expect(Object.hasOwn(parsed.values, key)).toBe(true);
    expect(ownKeys(parsed.values).slice(0, SPECIAL_KEYS.length)).toEqual([...SPECIAL_KEYS]);
    expect(Object.getPrototypeOf(parsed.values)).toBe(Object.prototype);
    const row = (parsed.values['items'] as Record<string, unknown>[])[0]!;
    expect(ownKeys(row)).toEqual(['__proto__', 'constructor', 'n']);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    const samples = parsed.templateSnapshot.sampleValues!;
    for (const key of SPECIAL_KEYS) expect(Object.hasOwn(samples, key)).toBe(true);
  });

  it('validateSlipFile도 같은 결과를 돌려주고 잘못된 값은 키 경로로 보고한다', () => {
    const voucher = buildVoucher(template(), JSON.parse('{"__proto__": 5}') as Record<string, JsonValue>);
    const valid = validateSlipFile(JSON.parse(serializeSlipFile(voucher)));
    expect(valid.kind === 'voucher' && Object.hasOwn(valid.values, '__proto__') && valid.values['__proto__']).toBe(5);
    const broken = JSON.parse(serializeSlipFile(voucher)) as { values: Record<string, unknown> };
    Object.defineProperty(broken.values, '__proto__', { value: 'x'.repeat(3_000_001), enumerable: true, configurable: true, writable: true });
    expect(() => validateSlipFile(broken)).toThrow(/values/);
  });

  it('숫자 파라미터의 빈 값 정규화가 __proto__ 키에도 0을 기록한다', () => {
    const normalized = normalizeNumericParameters({}, [{ key: '__proto__', label: 'p', valueType: 'number' }]);
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true);
    expect(normalized['__proto__']).toBe(0);
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
  });
});
