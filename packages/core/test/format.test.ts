import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SlipMigrationError,
  SlipParseError,
  buildVoucher,
  migrateSlipDocument,
  normalizeNumericParameters,
  parseSlipFile,
  serializeSlipFile,
  validateSlipFile,
  slipFileJsonSchema,
  type ParameterDef,
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
              type: 'grid',
              id: 'supplier',
              name: '공급자 정보',
              position: { x: 15, y: 35 },
              rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
              columns: [{ width: 27 }, { width: 63 }],
              cells: [
                { row: 0, column: 0, content: '상호', backgroundColor: '#EEEEEE' },
                { row: 0, column: 1, content: '{공급자상호}' },
                { row: 1, column: 0, rowSpan: 2, content: '주소' },
                { row: 1, column: 1, content: '{주소1}' },
                { row: 2, column: 1, content: '{주소2}' },
              ],
            },
            {
              type: 'grid',
              id: 'items',
              name: '품목',
              position: { x: 15, y: 80 },
              columns: [{ width: 72 }, { width: 27 }, { width: 36 }, { width: 45 }],
              rows: [{ height: 8 }, { height: 8 }],
              repeat: {
                parameter: 'items',
                bands: [
                  { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
                  { id: 'items-item', fromRow: 1, toRow: 1, placement: 'item' },
                ],
                pagination: { mode: 'fixed', itemsPerPage: 10 },
              },
              cells: [
                { row: 0, column: 0, content: '품명' },
                { row: 1, column: 0, parameter: '품명' },
              ],
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
              formula: 'FORMAT_NUMBER(SUM($(items).$(금액)))',
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

  it('그리드 범위를 벗어난 병합 셀은 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').cells.push({ row: 2, column: 0, rowSpan: 2, content: 'x' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/is outside/);
  });

  it('겹치는 셀은 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').cells.push({ row: 0, column: 1, content: '중복' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/overlaps/);
  });

  it('존재하지 않는 asset:// 참조는 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 3, 'image').src = 'asset://missing';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/Referenced asset does not exist/);
  });

  it('에셋 항목 자신의 src가 해소되지 않는 asset:// 참조면 거부한다 (SPEC §3.1)', () => {
    const file = makeTemplate();
    file.template.assets.push({ id: 'alias', mimeType: 'image/png', src: 'asset://missing' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/Referenced asset does not exist/);
  });

  it('에셋 항목의 asset:// 참조가 존재하는 에셋을 가리키면 허용한다', () => {
    const file = makeTemplate();
    file.template.assets.push({ id: 'alias', mimeType: 'image/png', src: 'asset://logo' });
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();
  });

  it('요소 id가 중복되면 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').id = 'title';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/Duplicate element id/);
  });

  it('페이지 물리명(key)이 중복되면 거부한다 (SPEC §4)', () => {
    const file = makeTemplate();
    file.template.pages[0]!.key = 'cover';
    file.template.pages.push({ elements: [], key: 'cover' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/Duplicate page key/);
  });
});

describe('구조 크기 상한 (SPEC §3.2)', () => {
  it('행 수가 상한을 넘는 그리드는 거부한다 (렌더 OOM 방지)', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').rows = Array.from({ length: 1001 }, () => ({ height: 1 }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/at most/);
  });

  it('페이지 수가 상한을 넘으면 거부한다', () => {
    const file = makeTemplate();
    file.template.pages = Array.from({ length: 501 }, () => ({ elements: [] }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/at most/);
  });

  it('열 수가 상한을 넘는 그리드는 거부한다', () => {
    const file = makeTemplate();
    const grid = getElement(file, 2, 'grid');
    grid.columns = Array.from({ length: 101 }, () => ({ width: 1 }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/at most/);
  });
});

describe('현재 스키마(0.1.0) 필드 검증', () => {
  it('현재 버전은 0.1.0이고 그 파일은 그대로 파싱된다 (공개 전 변경은 0.1.0에 포함)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('0.1.0');
    const parsed = parseSlipFile(serializeSlipFile(makeTemplate()));
    expect(parsed.schemaVersion).toBe('0.1.0');
  });

  it('텍스트·필드 요소와 그리드 셀은 조건부 서식 규칙을 담을 수 있다 (ADR-062)', () => {
    const file = makeTemplate();
    getElement(file, 0, 'text').conditionalFormats = [
      { condition: '$(total) < 0', fontColor: '#FF0000' },
    ];
    getElement(file, 5, 'field').conditionalFormats = [
      { condition: '$(total) < 0', fontColor: '#FF0000' },
      { condition: '$(total) = 0', backgroundColor: '#EEEEEE', borderColor: '#333333' },
    ];
    getElement(file, 2, 'grid').cells[1]!.conditionalFormats = [
      { condition: '$(금액) < 0', fontColor: '#FF0000' },
    ];
    const parsed = parseSlipFile(serializeSlipFile(file));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const field = parsed.template.pages[0]!.elements.find((el) => el.id === 'total')!;
    if (field.type !== 'field') throw new Error('field여야 한다');
    expect(field.conditionalFormats).toHaveLength(2);
    expect(field.conditionalFormats?.[1]?.backgroundColor).toBe('#EEEEEE');
  });

  it('색과 강조를 모두 지정하지 않은 조건부 서식 규칙은 거부한다 (ADR-062·063)', () => {
    const file = makeTemplate();
    getElement(file, 0, 'text').conditionalFormats = [{ condition: '$(total) < 0' }];
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/at least one of fontColor/);

    // 강조만 지정한 규칙은 유효하다.
    getElement(file, 0, 'text').conditionalFormats = [{ condition: '$(total) < 0', bold: true }];
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();
  });

  it('조건부 서식 규칙 수가 상한을 넘으면 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 0, 'text').conditionalFormats = Array.from({ length: 21 }, () => ({
      condition: '$(total) < 0',
      fontColor: '#FF0000',
    }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/At most 20 conditional format rules/);
  });

  it('이미지는 src와 parameter 중 하나만 가진다', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const pages = (base['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const image = { type: 'image', id: 'img-x', name: '서명', position: { x: 10, y: 10 }, width: 20, height: 10 };

    pages[0]!.elements.push({ ...image });
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/src or parameter/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...image, src: 'data:image/png;base64,AA==', parameter: 'sign' };
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/cannot have both/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...image, parameter: 'sign' };
    expect(() => parseSlipFile(JSON.stringify(base))).not.toThrow();
  });

  it('바코드는 content·parameter·formula 중 하나만 가진다', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const pages = (base['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const barcode = {
      type: 'barcode', id: 'bc-1', name: '전표번호', kind: 'qrcode',
      position: { x: 10, y: 10 }, width: 20, height: 20,
    };

    pages[0]!.elements.push({ ...barcode });
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/exactly one of/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...barcode, content: 'A', parameter: 'code' };
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/exactly one of/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...barcode, parameter: 'code' };
    const parsed = parseSlipFile(JSON.stringify(base));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const saved = parsed.template.pages[0]!.elements.at(-1)!;
    expect(saved.type).toBe('barcode');
  });

  it('항목 구간 셀이 구간 전체를 덮지 않는 열은 자동 병합을 켤 수 없다 (ADR-038)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'items')!;
    // 자동 병합할 열의 항목 구간(2행)을 두 개의 독립된 셀로 구성한다.
    grid['rows'] = [{ height: 8 }, { height: 8 }, { height: 8 }];
    (grid['repeat'] as Record<string, unknown>)['bands'] = [
      { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
      { id: 'items-item', fromRow: 1, toRow: 2, placement: 'item' },
    ];
    grid['cells'] = [
      { row: 0, column: 0, content: '품명' },
      { row: 1, column: 0, parameter: '품명' },
      { row: 2, column: 0, parameter: '규격' },
    ];
    (grid['columns'] as Record<string, unknown>[])[0]!['autoMerge'] = true;
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/cover the whole band height/);
  });

  it('반복 설정이 없는 그리드의 열은 자동 병합을 켤 수 없다 (ADR-038)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'supplier')!;
    (grid['columns'] as Record<string, unknown>[])[0]!['autoMerge'] = true;
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/requires repeat settings/);
  });

  it('maxItems는 itemsPerPage보다 작아도 허용한다', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'items')!;
    (grid['repeat'] as Record<string, unknown>)['maxItems'] = 3;
    expect(() => parseSlipFile(JSON.stringify(base))).not.toThrow();
  });

  it('필드는 파라미터와 수식 중 하나만 가져야 한다 (ADR-049)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const field = template.pages[0]!.elements.find((el) => el['id'] === 'total')!;
    field['parameter'] = 'total';
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/exactly one of parameter or formula/);
  });

  it('필드에 파라미터도 수식도 없으면 거부한다 (ADR-049)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const field = template.pages[0]!.elements.find((el) => el['id'] === 'total')!;
    delete field['formula'];
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/exactly one of parameter or formula/);
  });

  it('목록 파라미터는 항목의 하위 필드를 정의부에 담을 수 있다 (ADR-047)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { parameters?: unknown };
    template.parameters = [
      { key: 'items', label: '품목', valueType: 'list', fields: [
        { key: 'name', label: '품명' },
        { key: 'amount', label: '금액', valueType: 'number' },
      ] },
    ];
    const parsed = parseSlipFile(JSON.stringify(base));
    const defs = (parsed as { template: { parameters?: { key: string; fields?: { key: string; valueType?: string }[] }[] } })
      .template.parameters!;
    expect(defs[0]!.fields?.map((f) => f.key)).toEqual(['name', 'amount']);
    expect(defs[0]!.fields?.[1]?.valueType).toBe('number');
  });

  it('목록이 아닌 파라미터에는 하위 필드를 둘 수 없다 (ADR-047)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { parameters?: unknown };
    template.parameters = [{ key: 'total', valueType: 'number', fields: [{ key: 'x' }] }];
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/valueType is 'list'/);
  });

  it('하위 필드 이름이 겹치면 거부한다 (ADR-047)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { parameters?: unknown };
    template.parameters = [{ key: 'items', valueType: 'list', fields: [{ key: 'a' }, { key: 'a' }] }];
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/Duplicate sub-field name/);
  });

  it('그리드 열의 자동 병합과 페이지 이름·번호를 담을 수 있다', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as {
      pages: { elements: Record<string, unknown>[]; key?: string; label?: string; pageNumber?: unknown }[];
      parameters?: { key: string; label?: string; valueType?: string }[];
    };
    // 한 행짜리 항목 구간은 열 전체를 하나의 셀이 차지하므로 자동 병합 조건을 충족한다.
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'items')!;
    (grid['columns'] as Record<string, unknown>[])[0]!['autoMerge'] = true;
    template.pages[0]!.key = 'first';
    template.pages[0]!.label = '첫 장';
    template.pages[0]!.pageNumber = { position: 'bottom-center' };
    template.parameters = [{ key: 'items', label: '품목', valueType: 'list' }];

    const parsed = parseSlipFile(JSON.stringify(base));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const page = parsed.template.pages[0]!;
    expect(page.label).toBe('첫 장');
    expect(page.pageNumber?.position).toBe('bottom-center');
    expect(parsed.template.parameters?.[0]?.valueType).toBe('list');
    const saved = page.elements.find((el) => el.id === 'items')!;
    if (saved.type !== 'grid') throw new Error('grid여야 한다');
    expect(saved.columns[0]?.autoMerge).toBe(true);
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

  it('발행된 전표에 외부 URL 이미지가 있으면 거부한다 (ADR-036)', () => {
    const voucher = makeIssuedVoucher();
    voucher.templateSnapshot.assets[0]!.src = 'https://example.com/logo.png';
    expect(() => parseSlipFile(serializeSlipFile(voucher))).toThrow(/external URL/);
  });

  it('작성 중(미발행) 전표는 외부 URL 이미지를 허용한다', () => {
    const voucher = makeIssuedVoucher();
    voucher.issued = false;
    voucher.templateSnapshot.assets[0]!.src = 'https://example.com/logo.png';
    expect(parseSlipFile(serializeSlipFile(voucher)).kind).toBe('voucher');
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
    expect(() => migrateSlipDocument({ schemaVersion: '0.0.1' })).toThrow(/no migration path/);
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

describe('그리드(grid) 스키마 검증 — 행 구간 모델', () => {
  type Grid = Extract<SlipElement, { type: 'grid' }>;

  function makeGridFile(patch: Partial<Grid> = {}): SlipTemplateFile {
    const grid: Grid = {
      type: 'grid',
      id: 'items',
      name: '품목',
      position: { x: 15, y: 30 },
      columns: [{ width: 60 }, { width: 40 }],
      rows: [{ height: 8 }, { height: 8 }, { height: 8 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'detail', fromRow: 1, toRow: 1, placement: 'item' },
          { id: 'total', fromRow: 2, toRow: 2, placement: 'after-data' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 2 },
      },
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

  const repeatOf = (patch: Partial<NonNullable<Grid['repeat']>>): Grid['repeat'] => ({
    parameter: 'items',
    bands: [
      { id: 'head', fromRow: 0, toRow: 0, placement: 'page-start' },
      { id: 'detail', fromRow: 1, toRow: 1, placement: 'item' },
      { id: 'total', fromRow: 2, toRow: 2, placement: 'after-data' },
    ],
    pagination: { mode: 'fixed', itemsPerPage: 2 },
    ...patch,
  });

  it('행 구간 모델의 반복 그리드가 직렬화 왕복을 통과한다', () => {
    const file = makeGridFile();
    expect(parseSlipFile(serializeSlipFile(file))).toEqual(file);
  });

  it('정적 그리드는 행 구간 없이 유효하다', () => {
    const file = makeGridFile();
    delete (file.template.pages[0]!.elements[0] as { repeat?: unknown }).repeat;
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();
  });

  it('여러 행으로 구성된 item 구간을 허용한다', () => {
    const file = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'detail', fromRow: 1, toRow: 2, placement: 'item' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(file))).not.toThrow();
  });

  it('반복 그리드에는 item 구간이 정확히 하나 필요하다', () => {
    const noItem = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'head', fromRow: 0, toRow: 2, placement: 'page-start' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(noItem))).toThrow(/exactly one item band/);
    const twoItems = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'a', fromRow: 0, toRow: 0, placement: 'item' },
          { id: 'b', fromRow: 1, toRow: 2, placement: 'item' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(twoItems))).toThrow(/exactly one item band/);
  });

  it('행 구간의 누락·겹침·범위 초과를 거부한다', () => {
    const gap = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'detail', fromRow: 2, toRow: 2, placement: 'item' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(gap))).toThrow(/without gaps or overlaps/);
    const overlap = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'head', fromRow: 0, toRow: 1, placement: 'page-start' },
          { id: 'detail', fromRow: 1, toRow: 2, placement: 'item' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(overlap))).toThrow(/without gaps or overlaps/);
    const outside = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'detail', fromRow: 1, toRow: 5, placement: 'item' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(outside))).toThrow(/outside the rows/);
  });

  it('행 구간은 출력 시점의 세로 순서를 따라야 한다', () => {
    const outOfOrder = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'detail', fromRow: 0, toRow: 0, placement: 'item' },
          { id: 'head', fromRow: 1, toRow: 1, placement: 'page-start' },
          { id: 'total', fromRow: 2, toRow: 2, placement: 'after-data' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(outOfOrder))).toThrow(/out of order/);
  });

  it('자동 확장과 고정 페이지 설정의 혼용을 거부한다', () => {
    const raw = JSON.parse(serializeSlipFile(makeGridFile())) as Record<string, unknown>;
    const grid = (raw as { template: { pages: { elements: { repeat: { pagination: Record<string, unknown> } }[] }[] } })
      .template.pages[0]!.elements[0]!;
    grid.repeat.pagination = { mode: 'auto', minItems: 3, itemsPerPage: 5 };
    expect(() => parseSlipFile(JSON.stringify(raw))).toThrow(SlipParseError);
    grid.repeat.pagination = { mode: 'fixed', itemsPerPage: 5, minItems: 3 };
    expect(() => parseSlipFile(JSON.stringify(raw))).toThrow(SlipParseError);
  });

  it('그룹 설정 없는 그룹 행 구간을 거부한다', () => {
    const file = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'gs', fromRow: 0, toRow: 0, placement: 'group-start' },
          { id: 'detail', fromRow: 1, toRow: 2, placement: 'item' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/groupBy/);
  });

  it('pages는 page-start·page-end 구간에만 지정할 수 있다', () => {
    const file = makeGridFile({
      repeat: repeatOf({
        bands: [
          { id: 'head', fromRow: 0, toRow: 0, placement: 'page-start', pages: 'continuation' },
          { id: 'detail', fromRow: 1, toRow: 1, placement: 'item', pages: 'first' },
          { id: 'total', fromRow: 2, toRow: 2, placement: 'after-data' },
        ],
      }),
    });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/pages can only be set/);
  });

  it('셀 이름을 저장하고 직렬화한다', () => {
    const file = makeGridFile({ cells: [{ row: 0, column: 0, name: '품명 헤더', content: '품명' }] });
    const parsed = parseSlipFile(serializeSlipFile(file));
    const grid = parsed.kind === 'template' ? parsed.template.pages[0]!.elements[0] : undefined;
    expect(grid?.type === 'grid' ? grid.cells[0]?.name : undefined).toBe('품명 헤더');
  });

  it('셀은 content·parameter·formula 중 하나만 가질 수 있다', () => {
    expect(() =>
      parseSlipFile(serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 0, content: 'a', parameter: 'b' }] }))),
    ).toThrow(/only one of/);
  });

  it('병합이 행 구간 경계를 넘으면 거부한다', () => {
    expect(() =>
      parseSlipFile(
        serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 0, rowSpan: 2, content: '헤더' }] })),
      ),
    ).toThrow(/crosses a row band boundary/);
  });

  it('셀이 그리드를 벗어나거나 겹치면 거부한다', () => {
    expect(() =>
      parseSlipFile(serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 3, content: 'a' }] }))),
    ).toThrow(/is outside/);
    expect(() =>
      parseSlipFile(
        serializeSlipFile(
          makeGridFile({ cells: [{ row: 0, column: 0, content: 'a' }, { row: 0, column: 0, content: 'b' }] }),
        ),
      ),
    ).toThrow(/overlaps/);
  });
});

describe('스키마 방어 보강 (G-48)', () => {
  it('에셋이 자기 자신을 asset://로 참조하면 거부한다', () => {
    const file = makeTemplate();
    file.template.assets = [{ id: 'logo', mimeType: 'image/png', src: 'asset://logo' }];
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/references itself/);
  });

  it('값 중첩이 지나치게 깊으면 RangeError가 아니라 SlipParseError를 던진다', () => {
    // JSON 직렬화의 재귀 한계에 먼저 도달하지 않도록 반복문으로 깊은 배열을 만든다.
    let nested: unknown = 0;
    for (let i = 0; i < 50000; i++) nested = [nested];
    const raw = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: makeTemplate().template,
      values: { deep: nested },
      issued: false,
    };
    expect(() => validateSlipFile(raw)).toThrow(SlipParseError);
  });

  it('병합 칸이 행 구간을 통째로 감싸면 거부한다', () => {
    const file = makeTemplate();
    const page = file.template.pages[0]!;
    page.elements = [
      {
        type: 'grid',
        id: 'g',
        name: '표',
        position: { x: 10, y: 10 },
        columns: [{ width: 50 }],
        rows: [{ height: 8 }, { height: 8 }, { height: 8 }],
        repeat: {
          parameter: 'items',
          bands: [
            { id: 'head', fromRow: 0, toRow: 0, placement: 'before-data' },
            { id: 'detail', fromRow: 1, toRow: 1, placement: 'item' },
            { id: 'tail', fromRow: 2, toRow: 2, placement: 'page-end' },
          ],
          pagination: { mode: 'fixed', itemsPerPage: 2 },
        },
        cells: [{ row: 0, column: 0, rowSpan: 3, content: '감싸기' }],
      },
    ];
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/boundary/);
  });

  it('항목 구간에 칸이 없는 열의 autoMerge는 거부한다', () => {
    const file = makeTemplate();
    const page = file.template.pages[0]!;
    page.elements = [
      {
        type: 'grid',
        id: 'g',
        name: '표',
        position: { x: 10, y: 10 },
        columns: [{ width: 25 }, { width: 25, autoMerge: true }],
        rows: [{ height: 8 }, { height: 8 }],
        repeat: {
          parameter: 'items',
          bands: [
            { id: 'head', fromRow: 0, toRow: 0, placement: 'before-data' },
            { id: 'detail', fromRow: 1, toRow: 1, placement: 'item' },
          ],
          pagination: { mode: 'fixed', itemsPerPage: 2 },
        },
        cells: [{ row: 1, column: 0, parameter: '품명' }],
      },
    ];
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/cover the whole band height/);
  });
});

describe('발행 전표 변동 이미지 값 검증 (G-48)', () => {
  function voucherWithImageParameter(value: unknown): unknown {
    const template = makeTemplate().template;
    template.pages[0]!.elements.push({
      type: 'image', id: 'stamp', name: '도장',
      position: { x: 10, y: 10 }, width: 20, height: 20, parameter: 'stamp',
    });
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: template,
      values: { items: [], total: 0, stamp: value },
      issued: true,
    };
  }
  it('변동 이미지 값이 외부 URL이면 거부한다', () => {
    expect(() => parseSlipFile(JSON.stringify(voucherWithImageParameter('http://evil.com/x.png'))))
      .toThrow(/external URL images/);
  });
  it('변동 이미지 값이 깨진 data:면 거부한다', () => {
    expect(() => parseSlipFile(JSON.stringify(voucherWithImageParameter('data:nonsense'))))
      .toThrow(/data:.*base64/);
  });
  it('변동 이미지 값이 올바른 data: base64면 통과한다', () => {
    expect(() => parseSlipFile(JSON.stringify(voucherWithImageParameter(PNG_1PX)))).not.toThrow();
  });
  it('변동 이미지 값이 비어 있으면(이미지 없음) 통과한다', () => {
    expect(() => parseSlipFile(JSON.stringify(voucherWithImageParameter('')))).not.toThrow();
  });
});

describe('normalizeNumericParameters (ADR-044)', () => {
  const parameters: ParameterDef[] = [
    { key: '금액', valueType: 'number' },
    { key: '적요', valueType: 'text' },
    { key: '수량' },
  ];

  it('number 파라미터의 빈 값(미입력·null·빈 문자열)을 0으로 바꾼다', () => {
    expect(normalizeNumericParameters({ 금액: '' }, parameters)).toEqual({ 금액: 0 });
    expect(normalizeNumericParameters({ 금액: null }, parameters)).toEqual({ 금액: 0 });
    expect(normalizeNumericParameters({}, parameters)).toEqual({ 금액: 0 });
  });

  it('number가 아닌 파라미터·이미 수인 값은 건드리지 않는다', () => {
    expect(normalizeNumericParameters({ 금액: 1500, 적요: '', 수량: '' }, parameters)).toEqual({
      금액: 1500,
      적요: '',
      수량: '',
    });
  });

  it('바뀔 값이 없으면 입력 객체를 그대로(같은 참조) 돌려준다', () => {
    const values = { 금액: 1500, 적요: '메모' };
    expect(normalizeNumericParameters(values, parameters)).toBe(values);
    const noParameters = { 금액: '' };
    expect(normalizeNumericParameters(noParameters)).toBe(noParameters);
  });
});

describe('buildVoucher (ADR-052)', () => {
  function template(): SlipTemplateFile {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: { title: '거래명세서' },
        paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        parameters: [
          { key: 'tradeDate', valueType: 'date' },
          { key: 'total', valueType: 'number' },
          { key: 'items', valueType: 'list', fields: [{ key: 'amount', valueType: 'number' }] },
        ],
        pages: [{ elements: [] }],
        assets: [],
      },
    };
  }

  it('양식+값으로 발행 전(issued:false) 전표를 조립한다', () => {
    const voucher = buildVoucher(template(), { tradeDate: '2026-08-24' });
    expect(voucher.kind).toBe('voucher');
    expect(voucher.issued).toBe(false);
    expect(voucher.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(voucher.templateSnapshot.meta.title).toBe('거래명세서');
    expect(voucher.values.tradeDate).toBe('2026-08-24');
  });

  it('number 파라미터의 빈 값은 0으로 맞추고, 목록 값은 그대로 담는다 (ADR-044)', () => {
    const voucher = buildVoucher(template(), {
      total: '',
      items: [{ amount: 1000 }, { amount: 2000 }],
    });
    expect(voucher.values.total).toBe(0);
    expect(voucher.values.items).toEqual([{ amount: 1000 }, { amount: 2000 }]);
  });

  it('입력 양식·값과 참조를 공유하지 않는다 (전표를 고쳐도 원본 불변)', () => {
    const values = { items: [{ amount: 1000 }] };
    const source = template();
    const voucher = buildVoucher(source, values);
    (voucher.values.items as { amount: number }[])[0]!.amount = 9999;
    voucher.templateSnapshot.meta.title = '바뀜';
    expect(values.items[0]!.amount).toBe(1000);
    expect(source.template.meta.title).toBe('거래명세서');
  });

  it('조립 결과는 유효한 전표 파일이다', () => {
    const voucher = buildVoucher(template(), { tradeDate: '2026-08-24', total: 3000 });
    expect(() => parseSlipFile(serializeSlipFile(voucher))).not.toThrow();
  });
});

describe('메시지 언어 (로케일 설정)', () => {
  it('기본은 영어 메시지다', () => {
    expect(() => parseSlipFile('broken')).toThrow('Not valid JSON');
  });

  it("locale이 'ko-KR'이면 한국어 메시지를 표시한다", () => {
    expect(() => parseSlipFile('broken', { locale: 'ko-KR' })).toThrow('유효한 JSON이 아닙니다');
    const file = makeTemplate();
    getElement(file, 2, 'grid').repeat!.bands = [
      { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
    ];
    expect(() => parseSlipFile(serializeSlipFile(file), { locale: 'ko-KR' })).toThrow(/행 구간/);
  });

  it("locale이 'ja'이면 일본어 메시지를 표시한다", () => {
    expect(() => parseSlipFile('broken', { locale: 'ja' })).toThrow('有効な JSON ではありません');
  });

  it('Zod 내장 메시지도 로케일을 따른다', () => {
    expect(() => validateSlipFile({}, { locale: 'ko-KR' })).toThrow(/\.slip 봉투 검증 실패/);
    expect(() => validateSlipFile({}, { locale: 'ja' })).toThrow(/\.slip エンベロープの検証に失敗しました/);
  });

  it('지원하지 않는 언어는 영어로 대체한다', () => {
    expect(() => parseSlipFile('broken', { locale: 'fr-FR' })).toThrow('Not valid JSON');
  });
});
