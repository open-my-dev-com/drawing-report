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
              type: 'grid',
              id: 'supplier',
              name: '공급자 정보',
              position: { x: 15, y: 35 },
              width: 90,
              height: 30,
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
              width: 180,
              height: 8 * 11,
              columns: [{ width: 72 }, { width: 27 }, { width: 36 }, { width: 45 }],
              rows: [{ height: 8 }, { height: 8 }],
              repeat: { binding: 'items', fromRow: 1, toRow: 1, perPage: 10, repeatHeader: true },
              cells: [
                { row: 0, column: 0, content: '품명' },
                { row: 1, column: 0, binding: '품명' },
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

  it('열 너비의 합이 width와 다르면 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').columns = [{ width: 27 }, { width: 50 }];
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/열 너비의 합/);
  });

  it('그리드 범위를 벗어난 병합 셀은 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').cells.push({ row: 2, column: 0, rowSpan: 2, content: 'x' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/벗어납니다/);
  });

  it('겹치는 셀은 거부한다', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').cells.push({ row: 0, column: 1, content: '중복' });
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
    getElement(file, 1, 'grid').id = 'title';
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/요소 id가 중복/);
  });

  it('페이지 물리명(key)이 중복되면 거부한다 (0.5.0, SPEC §4)', () => {
    const file = makeTemplate();
    file.template.pages[0]!.key = 'cover';
    file.template.pages.push({ elements: [], key: 'cover' });
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/페이지 key가 중복/);
  });
});

describe('구조 크기 상한 (SPEC §3.2)', () => {
  it('행 수가 상한을 넘는 그리드는 거부한다 (렌더 OOM 방지)', () => {
    const file = makeTemplate();
    getElement(file, 1, 'grid').rows = Array.from({ length: 1001 }, () => ({ height: 1 }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/최대/);
  });

  it('페이지 수가 상한을 넘으면 거부한다', () => {
    const file = makeTemplate();
    file.template.pages = Array.from({ length: 501 }, () => ({ elements: [] }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/최대/);
  });

  it('열 수가 상한을 넘는 그리드는 거부한다', () => {
    const file = makeTemplate();
    const grid = getElement(file, 2, 'grid');
    grid.columns = Array.from({ length: 101 }, () => ({ width: 1 }));
    expect(() => parseSlipFile(serializeSlipFile(file))).toThrow(/최대/);
  });
});

describe('schemaVersion 마이그레이션 (구버전 → 0.5.0)', () => {
  it('구버전(0.1.0) 파일은 현재 버전으로 끌어올려 파싱된다', () => {
    const file = makeTemplate();
    (file as { schemaVersion: string }).schemaVersion = '0.1.0';
    const parsed = parseSlipFile(serializeSlipFile(file));
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe('0.5.0');
  });

  it('이미지는 src와 binding 중 하나만 가진다 (0.5.0)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const pages = (base['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const image = { type: 'image', id: 'img-x', name: '서명', position: { x: 10, y: 10 }, width: 20, height: 10 };

    pages[0]!.elements.push({ ...image });
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/src 또는 binding/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...image, src: 'data:image/png;base64,AA==', binding: 'sign' };
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/함께 가질 수 없습니다/);

    // 하나만 있으면 통과한다
    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...image, binding: 'sign' };
    expect(() => parseSlipFile(JSON.stringify(base))).not.toThrow();
  });

  it('바코드는 content·binding·formula 중 하나만 가진다 (0.5.0)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const pages = (base['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const barcode = {
      type: 'barcode', id: 'bc-1', name: '전표번호', kind: 'qrcode',
      position: { x: 10, y: 10 }, width: 20, height: 20,
    };

    pages[0]!.elements.push({ ...barcode });
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/하나만 가져야/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...barcode, content: 'A', binding: 'code' };
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/하나만 가져야/);

    pages[0]!.elements[pages[0]!.elements.length - 1] = { ...barcode, binding: 'code' };
    const parsed = parseSlipFile(JSON.stringify(base));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const saved = parsed.template.pages[0]!.elements.at(-1)!;
    expect(saved.type).toBe('barcode');
  });

  it('반복 구간 칸이 구간 전체를 덮지 않는 열은 자동 병합을 켤 수 없다 (ADR-038)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'items')!;
    // 반복 구간을 2행으로 넓히고 그 열이 줄마다 따로 칸을 갖게 만든다
    grid['rows'] = [{ height: 8 }, { height: 8 }, { height: 8 }];
    grid['height'] = 8 + 10 * (8 + 8);
    (grid['repeat'] as Record<string, unknown>)['toRow'] = 2;
    grid['cells'] = [
      { row: 0, column: 0, content: '품명' },
      { row: 1, column: 0, binding: '품명' },
      { row: 2, column: 0, binding: '규격' },
    ];
    (grid['columns'] as Record<string, unknown>[])[0]!['autoMerge'] = true;
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/구간 전체 높이/);
  });

  it('반복 구간이 없는 그리드의 열은 자동 병합을 켤 수 없다 (ADR-038)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as { pages: { elements: Record<string, unknown>[] }[] };
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'supplier')!;
    (grid['columns'] as Record<string, unknown>[])[0]!['autoMerge'] = true;
    expect(() => parseSlipFile(JSON.stringify(base))).toThrow(/반복 구간이 있어야/);
  });

  it('그리드 열의 자동 병합과 페이지 이름·번호를 담을 수 있다 (0.5.0)', () => {
    const base = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    const template = base['template'] as {
      pages: { elements: Record<string, unknown>[]; key?: string; label?: string; pageNumber?: unknown }[];
      bindings?: { key: string; label?: string; valueType?: string }[];
    };
    // 반복 구간이 있는 그리드('items')여야 자동 병합을 켤 수 있다 — 한 줄 구간이라 저절로 성립한다
    const grid = template.pages[0]!.elements.find((el) => el['id'] === 'items')!;
    (grid['columns'] as Record<string, unknown>[])[0]!['autoMerge'] = true;
    template.pages[0]!.key = 'first';
    template.pages[0]!.label = '첫 장';
    template.pages[0]!.pageNumber = { position: 'bottom-center' };
    template.bindings = [{ key: 'items', label: '품목', valueType: 'list' }];

    const parsed = parseSlipFile(JSON.stringify(base));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const page = parsed.template.pages[0]!;
    expect(page.label).toBe('첫 장');
    expect(page.pageNumber?.position).toBe('bottom-center');
    expect(parsed.template.bindings?.[0]?.valueType).toBe('list');
    const saved = page.elements.find((el) => el.id === 'items')!;
    if (saved.type !== 'grid') throw new Error('grid여야 한다');
    expect(saved.columns[0]?.autoMerge).toBe(true);
  });

  it('0.4.0 파일은 그대로 0.5.0이 된다 — 0.5.0이 더한 것은 전부 선택 필드다', () => {
    const file = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    file['schemaVersion'] = '0.4.0';
    const before = structuredClone(file['template']);

    const parsed = parseSlipFile(JSON.stringify(file));
    expect(parsed.schemaVersion).toBe('0.5.0');
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    expect(parsed.template).toEqual(before);
  });

  it('0.3.0의 고정 그리드는 mm 트랙을 가진 그리드로 옮겨진다 (ADR-037 3단계)', () => {
    const file = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    file['schemaVersion'] = '0.3.0';
    const pages = (file['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const grid = pages[0]!.elements.find((el) => el['id'] === 'supplier')!;
    // 옛 형식으로 되돌린다 — 비율 트랙 + 행·열 수
    grid['type'] = 'fixedGrid';
    grid['rows'] = 3;
    grid['columns'] = 2;
    grid['columnWidthPercentages'] = [30, 70];
    grid['rowHeightPercentages'] = undefined;
    delete grid['repeat'];

    const parsed = parseSlipFile(JSON.stringify(file));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const migrated = parsed.template.pages[0]!.elements.find((el) => el.id === 'supplier')!;
    if (migrated.type !== 'grid') throw new Error('grid여야 한다');
    // 너비 90mm를 30:70으로 나눈 mm 트랙
    expect(migrated.columns).toEqual([{ width: 27 }, { width: 63 }]);
    expect(migrated.rows).toEqual([{ height: 10 }, { height: 10 }, { height: 10 }]);
    expect(migrated.repeat).toBeUndefined();
    // 셀은 그대로 옮겨진다
    expect(migrated.cells.some((c) => c.content === '상호')).toBe(true);
  });

  it('0.3.0의 동적 표는 헤더 1행 + 반복 1행짜리 그리드가 된다 (ADR-037 3단계)', () => {
    const file = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    file['schemaVersion'] = '0.3.0';
    const pages = (file['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    const table = pages[0]!.elements.find((el) => el['id'] === 'items')!;
    table['type'] = 'dynamicTable';
    table['columns'] = [
      { key: '품명', title: '품명', widthPercentage: 60 },
      { key: '금액', title: '금액', widthPercentage: 40 },
    ];
    table['height'] = 48; // 헤더 8 + 본문 40 → 항목 5개
    table['repeatHead'] = true;
    table['binding'] = 'items';
    delete table['rows'];
    delete table['repeat'];
    delete table['cells'];

    const parsed = parseSlipFile(JSON.stringify(file));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const migrated = parsed.template.pages[0]!.elements.find((el) => el.id === 'items')!;
    if (migrated.type !== 'grid') throw new Error('grid여야 한다');
    expect(migrated.columns).toEqual([{ width: 108 }, { width: 72 }]);
    expect(migrated.repeat).toEqual({
      binding: 'items', fromRow: 1, toRow: 1, perPage: 5, repeatHeader: true,
    });
    // 열 제목은 헤더 칸의 고정 문구, 물리 키는 반복 칸의 값이 된다
    expect(migrated.cells.find((c) => c.row === 0 && c.column === 0)?.content).toBe('품명');
    expect(migrated.cells.find((c) => c.row === 1 && c.column === 1)?.binding).toBe('금액');
    // 헤더 1행 + 반복 5벌
    expect(migrated.height).toBe(48);
  });

  it('0.1.1 동적 표(head 방식)는 단계를 거쳐 그리드가 된다 — 전표 값 호환', () => {
    const file = JSON.parse(serializeSlipFile(makeTemplate())) as Record<string, unknown>;
    file['schemaVersion'] = '0.1.1';
    const pages = (file['template'] as { pages: { elements: Record<string, unknown>[] }[] }).pages;
    // 픽스처의 그리드를 0.1.1 시절의 동적 표(head 방식)로 되돌린다
    const table = pages[0]!.elements.find((el) => el['id'] === 'items')!;
    table['type'] = 'dynamicTable';
    table['height'] = 48;
    table['repeatHead'] = true;
    table['binding'] = 'items';
    delete table['columns'];
    delete table['rows'];
    delete table['repeat'];
    delete table['cells'];
    table['head'] = ['품명', '금액'];
    table['headWidthPercentages'] = [60, 40];

    const parsed = parseSlipFile(JSON.stringify(file));
    if (parsed.kind !== 'template') throw new Error('template이어야 한다');
    const migrated = parsed.template.pages[0]!.elements.find((el) => el.id === 'items')!;
    if (migrated.type !== 'grid') throw new Error('grid여야 한다');
    // 옛 제목이 키가 되고(전표 값 호환), 반복 칸이 그 키를 읽는다
    expect(migrated.cells.find((c) => c.row === 1 && c.column === 0)?.binding).toBe('품명');
    expect(migrated.cells.find((c) => c.row === 0 && c.column === 1)?.content).toBe('금액');
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
    // 8(헤더) + 2x8(반복) + 8(꼬리) = 32
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
        serializeSlipFile(makeGridFile({ cells: [{ row: 0, column: 0, rowSpan: 2, content: '헤더' }] })),
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
