import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SlipMigrationError,
  SlipParseError,
  migrateSlipDocument,
  parseSlipFile,
  serializeSlipFile,
  validateSlipFile,
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
              columns: [
                { key: '품명', title: '품명', widthPercentage: 40 },
                { key: '수량', title: '수량', widthPercentage: 15 },
                { key: '단가', title: '단가', widthPercentage: 20 },
                { key: '금액', title: '금액', widthPercentage: 25 },
              ],
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
              type: 'line',
              id: 'divider',
              name: '구분선',
              position: { x: 15, y: 32 },
              width: 180,
              height: 0,
              lineDirection: 'horizontal',
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

  it('비율 합의 오차가 0.01 이내(경계 포함)면 허용한다 (SPEC §3)', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').columnWidthPercentages = [30.005, 70.005]; // 합 100.01
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();

    getElement(file, 1, 'fixedGrid').columnWidthPercentages = [30, 70.02]; // 합 100.02
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/비율의 합/);
  });

  it('그리드 범위를 벗어난 병합 셀은 거부한다', () => {
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

  it('에셋 항목 자신의 src가 해소되지 않는 asset:// 참조면 거부한다 (SPEC §3.1)', () => {
    const file = makeTemplate();
    file.template.assets.push({ id: 'alias', mimeType: 'image/png', src: 'asset://missing' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/참조하는 에셋이 없습니다/);
  });

  it('에셋 항목의 asset:// 참조가 존재하는 에셋을 가리키면 허용한다', () => {
    const file = makeTemplate();
    file.template.assets.push({ id: 'alias', mimeType: 'image/png', src: 'asset://logo' });
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();
  });

  it('요소 id가 중복되면 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').id = 'title';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/요소 id가 중복/);
  });
});

describe('구조 크기 상한 (SPEC §3.2)', () => {
  it('rows가 상한을 넘는 고정 그리드는 거부한다 (렌더 OOM 방지)', () => {
    const file = makeTemplate();
    getElement(file, 1, 'fixedGrid').rows = 1_000_000_000;
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/최대/);
  });

  it('페이지 수가 상한을 넘으면 거부한다', () => {
    const file = makeTemplate();
    file.template.pages = Array.from({ length: 501 }, () => ({ elements: [] }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/최대/);
  });

  it('동적 표 열 수가 상한을 넘으면 거부한다', () => {
    const file = makeTemplate();
    const table = getElement(file, 2, 'dynamicTable');
    table.columns = Array.from({ length: 101 }, (_, i) => ({
      key: `열${i}`, title: `열${i}`, widthPercentage: 100 / 101,
    }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/최대/);
  });
});

describe('schemaVersion 마이그레이션 (구버전 → 0.3.0)', () => {
  it('구버전(0.1.0) 파일은 현재 버전으로 끌어올려 파싱된다', () => {
    const file = makeTemplate();
    (file as { schemaVersion: string }).schemaVersion = '0.1.0';
    const parsed = parseSlipFile(serializeSlipFile(file));
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe('0.3.0');
  });

  it('0.1.1 동적 표(head 방식)는 columns(키=옛 제목)로 변환된다 — 전표 값 호환', () => {
    const file = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    file['schemaVersion'] = '0.1.1';
    const pages = (file['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const table = pages[0]!.elements.find((el) => el['type'] === 'dynamicTable')!;
    delete table['columns'];
    table['head'] = ['품명', '금액'];
    table['headWidthPercentages'] = [60, 40];

    const parsed = parseSlipFile(JSON.stringify(file));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const migrated = parsed.template.pages[0]!.elements.find((el) => el.type === 'dynamicTable')!;
    if (migrated.type !== 'dynamicTable') throw new Error('dynamicTable이어야 한다');
    expect(migrated.columns).toEqual([
      { key: '품명', title: '품명', widthPercentage: 60 },
      { key: '금액', title: '금액', widthPercentage: 40 },
    ]);
    expect('head' in migrated).toBe(false);
  });

  it('0.1.1 shape 요소는 독립 타입(line·rect)으로 분해된다', () => {
    const file = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    file['schemaVersion'] = '0.1.1';
    const pages = (file['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    // 픽스처의 신형 선을 옛 shape 형식으로 되돌리고, 옛 사각형 하나를 추가한다
    const divider = pages[0]!.elements.find((el) => el['id'] === 'divider')!;
    divider['type'] = 'shape';
    divider['shape'] = 'line';
    delete divider['lineDirection'];
    pages[0]!.elements.push({
      type: 'shape', shape: 'rect', id: 'old-box', name: '옛 사각형',
      position: { x: 10, y: 200 }, width: 50, height: 20, backgroundColor: '#EEEEEE',
    });

    const parsed = parseSlipFile(JSON.stringify(file));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const line = parsed.template.pages[0]!.elements.find((el) => el.id === 'divider')!;
    // 가로가 긴 선 → line 타입 + horizontal 명시
    expect(line.type).toBe('line');
    if (line.type !== 'line') throw new Error('line이어야 한다');
    expect(line.lineDirection).toBe('horizontal');
    const box = parsed.template.pages[0]!.elements.find((el) => el.id === 'old-box')!;
    expect(box.type).toBe('rect');
  });
});

describe('validateSlipFile (파싱된 값 검증)', () => {
  it('이미 파싱된 객체를 그대로 검증해 돌려준다', () => {
    const validated = validateSlipFile(makeTemplate());
    expect(validated.kind).toBe('template');
  });

  it('봉투가 잘못된 객체는 SlipParseError를 던진다', () => {
    expect(() => validateSlipFile({ kind: 'template' })).toThrow(SlipParseError);
    expect(() => validateSlipFile(null)).toThrow(SlipParseError);
  });

  it('본문이 잘못된 객체는 SlipParseError를 던진다', () => {
    const file = makeTemplate();
    (file.template.meta as { title: string }).title = '';
    expect(() => validateSlipFile(file)).toThrow(SlipParseError);
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

describe('그리드(grid) 스키마 검증 (ADR-037)', () => {
  type Grid = Extract<SlipElement, { type: 'grid' }>;

  function makeGridFile(patch: Partial<Grid> = {}): SlipTemplateFile {
    const grid: Grid = {
      type: 'grid',
      id: 'items',
      name: '품목',
      position: { x: 15, y: 30 },
      width: 100,
      height: 32,
      columns: [{ width: 60 }, { width: 40 }],
      rows: [{ height: 8 }, { height: 8 }, { height: 8 }],
      repeat: { binding: 'items', fromRow: 1, toRow: 1, perPage: 2, repeatHeader: true },
      cells: [{ row: 0, column: 0, content: '품명' }],
      ...patch,
    };
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: { title: '그리드' },
        paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
        pages: [{ elements: [grid] }],
        assets: [],
      },
    };
  }

  it('열 너비의 합이 width와 같아야 한다', () => {
    expect(() => parseSlipFile(serializeSlipFile(makeGridFile()))).not.toThrow();
    expect(() => parseSlipFile(serializeSlipFile(makeGridFile({ width: 120 })))).toThrow(/열 너비의 합/);
  });

  it('height는 반복 구간이 perPage번 복제된 높이여야 한다', () => {
    // 8(머리) + 2x8(반복) + 8(꼬리) = 32
    expect(() => parseSlipFile(serializeSlipFile(makeGridFile({ height: 24 })))).toThrow(/행 높이의 합/);
    expect(() =>
      parseSlipFile(
        serializeSlipFile(
          makeGridFile({
            height: 40,
            repeat: { binding: 'items', fromRow: 1, toRow: 1, perPage: 3, repeatHeader: true },
          }),
        ),
      ),
    ).not.toThrow();
  });

  it('반복 구간이 없으면 행 높이의 합이 곧 height다', () => {
    const file = makeGridFile({ height: 24 });
    delete (file.template.pages[0]!.elements[0] as { repeat?: unknown }).repeat;
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();
  });

  it('반복 구간이 행 범위를 벗어나면 거부한다', () => {
    expect(() =>
      parseSlipFile(
        serializeSlipFile(
          makeGridFile({ repeat: { binding: 'items', fromRow: 1, toRow: 5, perPage: 2, repeatHeader: true } }),
        ),
      ),
    ).toThrow(/반복 구간/);
  });

  it('셀은 content·binding·formula 중 하나만 가질 수 있다', () => {
    expect(() =>
      parseSlipFile(serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 0, content: 'a', binding: 'b' }] }))),
    ).toThrow(/하나만/);
  });

  it('병합이 반복 구간 경계를 넘으면 거부한다', () => {
    expect(() =>
      parseSlipFile(
        serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 0, rowSpan: 2, content: '머리' }] })),
      ),
    ).toThrow(/반복 구간.*경계/);
  });

  it('셀이 그리드를 벗어나거나 겹치면 거부한다', () => {
    expect(() =>
      parseSlipFile(serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 3, content: 'a' }] }))),
    ).toThrow(/벗어납니다/);
    expect(() =>
      parseSlipFile(
        serializeSlipFile(
          makeGridFile({ cells: [{ row: 0, column: 0, content: 'a' }, { row: 0, column: 0, content: 'b' }] }),
        ),
      ),
    ).toThrow(/겹칩니다/);
  });
});
