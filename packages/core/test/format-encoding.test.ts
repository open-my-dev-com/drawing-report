import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SlipParseError,
  parseSlipFile,
  serializeSlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '../src/index.js';

/** UTF-8 BOM (U+FEFF) */
const BOM = '\uFEFF';
/** 완성형 '각' (NFC, U+AC01) */
const NFC_KEY = '\uAC01';
/** 자모 분해형 '각' (NFD, U+1100 U+1161 U+11A8) */
const NFD_KEY = '\u1100\u1161\u11A8';

function template(overrides?: Partial<SlipTemplateFile['template']>): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '거래명세서' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      parameters: [{ key: 'total', valueType: 'number' }],
      pages: [{ elements: [] }],
      assets: [],
      ...overrides,
    },
  };
}

function reparse(file: SlipTemplateFile | SlipVoucherFile) {
  return parseSlipFile(serializeSlipFile(parseSlipFile(serializeSlipFile(file))));
}

describe('.slip 텍스트의 BOM 처리', () => {
  it('맨 앞의 UTF-8 BOM 하나는 제거하고 파싱한다', () => {
    const file = template();
    expect(parseSlipFile(BOM + serializeSlipFile(file))).toEqual(file);
  });

  it('BOM만 있는 텍스트는 SlipParseError', () => {
    expect(() => parseSlipFile(BOM)).toThrow(SlipParseError);
  });

  it('BOM이 두 개면 첫 번째만 제거하므로 SlipParseError', () => {
    expect(() => parseSlipFile(BOM + BOM + serializeSlipFile(template()))).toThrow(SlipParseError);
  });

  it('텍스트 중간·끝의 U+FEFF는 문서 내용으로 보존한다 (제목·파라미터 키)', () => {
    const title = `A${BOM}B`;
    const key = `k${BOM}`;
    const file = template({ meta: { title }, parameters: [{ key }] });
    const parsed = reparse(file);
    expect(parsed.kind).toBe('template');
    if (parsed.kind !== 'template') return;
    expect(parsed.template.meta.title).toBe(title);
    expect(parsed.template.meta.title).toHaveLength(3);
    expect(parsed.template.parameters?.[0]?.key).toBe(key);
  });

  it('serializeSlipFile 결과에는 BOM을 붙이지 않는다', () => {
    const text = serializeSlipFile(template());
    expect(text.charAt(0)).toBe('{');
    expect(text).not.toContain(BOM);
  });
});

describe('.slip 문자열의 유니코드 정규화 없음', () => {
  it('NFC와 NFD로 적은 같은 글자는 서로 다른 파라미터 키다', () => {
    expect(NFC_KEY.normalize('NFC')).toBe(NFD_KEY.normalize('NFC'));
    expect(NFC_KEY).not.toBe(NFD_KEY);

    const file = template({ parameters: [{ key: NFC_KEY }, { key: NFD_KEY }] });
    const parsed = reparse(file);
    expect(parsed.kind).toBe('template');
    if (parsed.kind !== 'template') return;
    expect(parsed.template.parameters?.map((p) => p.key)).toEqual([NFC_KEY, NFD_KEY]);
    expect(parsed.template.parameters?.[0]?.key).toHaveLength(1);
    expect(parsed.template.parameters?.[1]?.key).toHaveLength(3);
  });

  it('전표 values의 NFC·NFD 키도 따로 보존한다', () => {
    const voucher: SlipVoucherFile = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: template({ parameters: [{ key: NFC_KEY }, { key: NFD_KEY }] }).template,
      values: { [NFC_KEY]: 'nfc', [NFD_KEY]: 'nfd' },
      issued: false,
    };
    const parsed = reparse(voucher);
    expect(parsed.kind).toBe('voucher');
    if (parsed.kind !== 'voucher') return;
    expect(Object.keys(parsed.values)).toEqual([NFC_KEY, NFD_KEY]);
    expect(parsed.values[NFC_KEY]).toBe('nfc');
    expect(parsed.values[NFD_KEY]).toBe('nfd');
  });

  it('제목 등 문서 문자열의 코드 포인트를 그대로 보존한다', () => {
    const file = template({ meta: { title: NFD_KEY } });
    const parsed = reparse(file);
    if (parsed.kind !== 'template') throw new Error('template expected');
    expect(parsed.template.meta.title).toBe(NFD_KEY);
    expect(parsed.template.meta.title).not.toBe(NFC_KEY);
  });
});
