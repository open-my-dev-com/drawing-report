import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SlipMigrationError,
  SlipParseError,
  migrateSlipDocument,
  parseSlipFile,
  serializeSlipFile,
  slipFileJsonSchema,
  type SlipElement,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '../src/index.js';

function getElement<T extends SlipElement['type']>(
  file: SlipTemplateFile,
  index: number,
  type: T,
): Extract<SlipElement, { type: T }> {
  const element = file.template.pages[0]?.elements[index];
  if (!element || element.type !== type) throw new Error(`요소 ${index}는 ${type}이어야 합니다`);
  return element as Extract<SlipElement, { type: T }>;
}

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '거래명세서' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
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
              type: 'fixedGrid',
              id: 'supplier',
              name: '공급자 정보',
              position: { x: 15, y: 35 },
              width: 90,
              height: 30,
              rows: 3,
              columns: 2,
              columnWidthPercentages: [30, 70],
              cells: [
                { row: 0, column: 0, content: '상호', backgroundColor: '#EEEEEE' },
                { row: 0, column: 1, content: '{공급자상호}' },
                { row: 1, column: 0, rowSpan: 2, content: '주소' },
                { row: 1, column: 1, content: '{주소1}' },
                { row: 2, column: 1, content: '{주소2}' },
              ],
            },
            {
              type: 'dynamicTable',
              id: 'items',
              name: '품목',
              position: { x: 15, y: 80 },
              width: 180,
              height: 120,
              head: ['품명', '수량', '단가', '금액'],
              headWidthPercentages: [40, 15, 20, 25],
              repeatHead: true,
              binding: 'items',
            },
            {
              type: 'image',
              id: 'logo',
              name: '로고',
              position: { x: 170, y: 15 },
              width: 25,
              height: 12,
              src: 'asset://logo',
            },
            {
              type: 'shape',
              id: 'divider',
              name: '구분선',
              position: { x: 15, y: 32 },
              width: 180,
              height: 0,
              shape: 'line',
              borderColor: '#000000',
              borderWidth: 0.3,
            },
            {
              type: 'field',
              id: 'total',
              name: '합계',
              position: { x: 140, y: 210 },
              width: 55,
              height: 8,
              binding: 'total',
              formula: 'FORMAT_NUMBER(SUM(items.금액))',
              alignment: 'right',
            },
          ],
        },
      ],
      assets: [{ id: 'logo', mimeType: 'image/png', src: PNG_1PX }],
    },
  };
}

function makeIssuedVoucher(): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: makeTemplate().template,
    values: { items: [{ 품명: '노트', 수량: 2, 단가: 1500, 금액: 3000 }], total: 3000 },
    issued: true,
    integrity: { contentHash: 'a'.repeat(64) },
  };
}

describe('.slip 템플릿 파싱', () => {
  it('요소 6종을 담은 템플릿을 직렬화-파싱 왕복할 수 있다', () => {
    const parsed = parseSlipFile(serializeSlipFile(makeTemplate()));
    expect(parsed.kind).toBe('template');
    if (parsed.kind === 'template') {
      expect(parsed.template.pages[0]?.elements).toHaveLength(6);
    }
  });

  it('JSON이 아니면 SlipParseError', () => {
    expect(() => parseSlipFile('not-json')).toThrow(SlipParseError);
  });

  it('kind가 없으면 SlipParseError', () => {
    expect(() => parseSlipFile('{"schemaVersion":"0.1.0"}')).toThrow(SlipParseError);
  });

  it('schemaVersion이 semver가 아니면 SlipParseError', () => {
    expect(() => parseSlipFile('{"schemaVersion":"v1","kind":"template"}')).toThrow(SlipParseError);
  });

  it('알 수 없는 요소 type은 거부한다', () => {
    const file = makeTemplate();
    (getElement(file, 0, 'text') as { type: string }).type = 'video';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(SlipParseError);
  });

  it('열 너비 비율 합이 100이 아니면 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').columnWidthPercentages = [30, 60];
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/비율의 합/);
  });

  it('격자 범위를 벗어난 병합 셀은 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').cells.push({ row: 2, column: 0, rowSpan: 2, content: 'x' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/벗어납니다/);
  });

  it('겹치는 셀은 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').cells.push({ row: 0, column: 1, content: '중복' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/겹칩니다/);
  });

  it('존재하지 않는 asset:// 참조는 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 3, 'image').src = 'asset://missing';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/참조하는 에셋이 없습니다/);
  });

  it('요소 id가 중복되면 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').id = 'title';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/요소 id가 중복/);
  });
});

describe('.slip 전표(voucher) 파싱', () => {
  it('발행된 전표를 파싱할 수 있다', () => {
    const parsed = parseSlipFile(serializeSlipFile(makeIssuedVoucher()));
    expect(parsed.kind).toBe('voucher');
    if (parsed.kind === 'voucher') expect(parsed.issued).toBe(true);
  });

  it('발행된 전표에 integrity가 없으면 거부한다 (ADR-019)', () => {
    const voucher = makeIssuedVoucher();
    delete voucher.integrity;
    expect(() => parseSlipFile(serializeSlipFile(voucher))).toThrow(/integrity/);
  });

  it('발행된 전표에 외부 URL 이미지가 있으면 거부한다 (ADR-014)', () => {
    const voucher = makeIssuedVoucher();
    voucher.templateSnapshot.assets[0]!.src = 'https://example.com/logo.png';
    expect(() => parseSlipFile(serializeSlipFile(voucher))).toThrow(/외부 URL/);
  });

  it('작성 중(미발행) 전표는 외부 URL 이미지와 integrity 생략을 허용한다', () => {
    const voucher = makeIssuedVoucher();
    voucher.issued = false;
    delete voucher.integrity;
    voucher.templateSnapshot.assets[0]!.src = 'https://example.com/logo.png';
    expect(parseSlipFile(serializeSlipFile(voucher)).kind).toBe('voucher');
  });

  it('contentHash 형식이 틀리면 거부한다', () => {
    const voucher = makeIssuedVoucher();
    voucher.integrity = { contentHash: 'XYZ' };
    expect(() => parseSlipFile(serializeSlipFile(voucher))).toThrow(/contentHash/);
  });
});

describe('schemaVersion 마이그레이션 (ADR-007)', () => {
  it('구버전 문서는 등록된 단계로 현재 버전까지 끌어올린다', () => {
    const legacy = { schemaVersion: '0.0.9', kind: 'template', legacyField: 1 };
    const migrated = migrateSlipDocument(legacy, [
      {
        from: '0.0.9',
        to: CURRENT_SCHEMA_VERSION,
        migrate: ({ legacyField: _drop, ...rest }) => ({ ...rest, migratedField: 2 }),
      },
    ]);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.migratedField).toBe(2);
    expect(migrated).not.toHaveProperty('legacyField');
  });

  it('현재보다 새로운 버전은 거부한다', () => {
    expect(() => migrateSlipDocument({ schemaVersion: '999.0.0' })).toThrow(SlipMigrationError);
  });

  it('경로가 없는 구버전은 거부한다', () => {
    expect(() => migrateSlipDocument({ schemaVersion: '0.0.1' })).toThrow(/마이그레이션 경로가 없습니다/);
  });

  it('parseSlipFile도 경로 없는 구버전을 SlipParseError로 거부한다', () => {
    expect(() => parseSlipFile('{"schemaVersion":"0.0.1","kind":"template"}')).toThrow(SlipParseError);
  });
});

describe('JSON Schema 산출 (ADR-022)', () => {
  it('draft 2020-12 JSON Schema를 산출한다', () => {
    const schema = slipFileJsonSchema();
    expect(schema.$schema).toContain('2020-12');
    expect(schema.$id).toBe(`urn:slipkit:schema:slip:${CURRENT_SCHEMA_VERSION}`);
    expect(JSON.stringify(schema)).toContain('templateSnapshot');
  });
});
