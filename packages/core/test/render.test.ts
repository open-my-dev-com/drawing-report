import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { convertSlipFile } from '../src/render/convert.js';
import { SlipRenderError } from '../src/render/errors.js';
import {
  CURRENT_SCHEMA_VERSION,
  renderSlipToPdf,
  type SlipElement,
  type SlipTemplateBody,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '../src/index.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type PdfmeSchema = Record<string, unknown> & {
  name: string;
  type: string;
  position: { x: number; y: number };
  width: number;
  height: number;
};

/** 요소 6종을 모두 담은 양식 본문. 고정 격자는 (1,0)에 2행 병합 셀을 둔다 */
function makeBody(): SlipTemplateBody {
  return {
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
            id: 'grid',
            name: '공급자 정보',
            position: { x: 10, y: 10 },
            width: 100,
            height: 30,
            rows: 3,
            columns: 2,
            columnWidthPercentages: [50, 50],
            borderWidth: 0.2,
            cells: [
              { row: 0, column: 0, content: '상호', backgroundColor: '#EEEEEE' },
              { row: 0, column: 1, content: '테스트상사' },
              { row: 1, column: 0, rowSpan: 2, content: '주소' },
              { row: 1, column: 1, content: '주소 1행' },
              { row: 2, column: 1, content: '주소 2행' },
            ],
          },
          {
            type: 'dynamicTable',
            id: 'items',
            name: '품목',
            position: { x: 15, y: 60 },
            width: 180,
            height: 60,
            head: ['품명', '수량', '금액'],
            headWidthPercentages: [50, 20, 30],
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
            position: { x: 15, y: 45 },
            width: 180,
            height: 0,
            shape: 'line',
            borderColor: '#333333',
            borderWidth: 0.4,
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
  };
}

function makeTemplateFile(): SlipTemplateFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, kind: 'template', template: makeBody() };
}

function makeVoucher(rowCount = 2): SlipVoucherFile {
  const items = Array.from({ length: rowCount }, (_, index) => ({
    품명: `테스트 품목 ${index + 1}`,
    수량: index + 1,
    금액: (index + 1) * 1000,
  }));
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: makeBody(),
    values: { items, total: 0 },
    issued: false,
  };
}

function patchElement(body: SlipTemplateBody, id: string, patch: Partial<SlipElement>): void {
  const page = body.pages[0];
  if (!page) throw new Error('페이지가 없습니다');
  const index = page.elements.findIndex((element) => element.id === id);
  if (index < 0) throw new Error(`요소를 찾을 수 없습니다: ${id}`);
  page.elements[index] = { ...page.elements[index], ...patch } as SlipElement;
}

function pageSchemas(file: SlipTemplateFile | SlipVoucherFile, pageIndex = 0): PdfmeSchema[] {
  const { template } = convertSlipFile(file);
  return (template.schemas[pageIndex] ?? []) as unknown as PdfmeSchema[];
}

/** 앞부분 바이트를 ASCII 문자열로 (DOM·Node 전역에 기대지 않는다) */
function ascii(bytes: Uint8Array, length: number): string {
  return Array.from(bytes.slice(0, length), (byte) => String.fromCharCode(byte)).join('');
}

function findSchema(schemas: PdfmeSchema[], name: string): PdfmeSchema {
  const schema = schemas.find((item) => item.name === name);
  if (!schema) throw new Error(`스키마를 찾을 수 없습니다: ${name}`);
  return schema;
}

describe('.slip → pdfme 변환 (요소 6종 매핑)', () => {
  it('용지·여백을 basePdf로 그대로 옮긴다 (둘 다 mm)', () => {
    const { template } = convertSlipFile(makeTemplateFile());
    expect(template.basePdf).toEqual({ width: 210, height: 297, padding: [20, 15, 20, 15] });
    expect(template.schemas).toHaveLength(1);
  });

  it('text는 text 스키마로, 고정 문구를 그대로 값으로 넘긴다', () => {
    const { template, inputs } = convertSlipFile(makeTemplateFile());
    const schemas = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    const title = findSchema(schemas, 'title');
    expect(title.type).toBe('text');
    expect(title.position).toEqual({ x: 15, y: 20 });
    expect(title.fontSize).toBe(18);
    expect(title.alignment).toBe('center');
    expect(inputs[0]?.title).toBe('거래명세서');
  });

  it('field는 수식을 평가한 결과를 값으로 넘긴다', () => {
    const { inputs } = convertSlipFile(makeVoucher(3));
    // 1000 + 2000 + 3000
    expect(inputs[0]?.total).toBe('6,000');
  });

  it('field는 수식이 없으면 binding 값을 문자열화한다 (CONCAT과 같은 규칙)', () => {
    const voucher = makeVoucher();
    patchElement(voucher.templateSnapshot, 'total', { formula: undefined });
    voucher.values.total = true;
    expect(convertSlipFile(voucher).inputs[0]?.total).toBe('TRUE');
    voucher.values.total = null;
    expect(convertSlipFile(voucher).inputs[0]?.total).toBe('');
    voucher.values.total = 1234;
    expect(convertSlipFile(voucher).inputs[0]?.total).toBe('1234');
  });

  it('field 값이 배열·객체면 한국어 오류로 거부한다', () => {
    const voucher = makeVoucher();
    patchElement(voucher.templateSnapshot, 'total', { formula: undefined });
    voucher.values.total = { a: 1 };
    expect(() => convertSlipFile(voucher)).toThrow(SlipRenderError);
    expect(() => convertSlipFile(voucher)).toThrow(/텍스트로 표시할 수 없습니다/);
  });

  it('shape line은 line 스키마로, 두께·색을 반영한다', () => {
    const divider = findSchema(pageSchemas(makeTemplateFile()), 'divider');
    expect(divider.type).toBe('line');
    expect(divider.color).toBe('#333333');
    expect(divider.width).toBe(180);
    expect(divider.height).toBe(0.4);
  });

  it('shape rect는 rectangle 스키마로 변환된다', () => {
    const file = makeTemplateFile();
    patchElement(file.template, 'divider', {
      shape: 'rect',
      height: 20,
      backgroundColor: '#FFEEEE',
    } as Partial<SlipElement>);
    const rect = findSchema(pageSchemas(file), 'divider');
    expect(rect.type).toBe('rectangle');
    expect(rect.color).toBe('#FFEEEE');
    expect(rect.borderColor).toBe('#333333');
    expect(rect.borderWidth).toBe(0.4);
  });

  it('image는 image 스키마로, asset:// 참조를 문서 assets의 data:로 해소한다', () => {
    const { inputs } = convertSlipFile(makeTemplateFile());
    const logo = findSchema(pageSchemas(makeTemplateFile()), 'logo');
    expect(logo.type).toBe('image');
    expect(inputs[0]?.logo).toBe(PNG_1PX);
  });

  it('image의 data: src는 그대로 쓴다', () => {
    const file = makeTemplateFile();
    patchElement(file.template, 'logo', { src: PNG_1PX } as Partial<SlipElement>);
    expect(convertSlipFile(file).inputs[0]?.logo).toBe(PNG_1PX);
  });

  it('image가 외부 URL이면 한국어 오류로 거부한다 (ADR-014)', () => {
    const file = makeTemplateFile();
    patchElement(file.template, 'logo', {
      src: 'https://cdn.example.com/logo.png',
    } as Partial<SlipElement>);
    expect(() => convertSlipFile(file)).toThrow(SlipRenderError);
    expect(() => convertSlipFile(file)).toThrow(/파일에 내장/);
  });
});

describe('고정 격자(fixedGrid) 분해', () => {
  const schemas = pageSchemas(makeTemplateFile());
  const gridSchemas = schemas.filter((schema) => schema.name.startsWith('grid__'));
  const horizontals = gridSchemas.filter((schema) => schema.type === 'line' && schema.width > schema.height);
  const verticals = gridSchemas.filter((schema) => schema.type === 'line' && schema.height > schema.width);

  it('선·사각형·텍스트로만 분해된다 (ADR-020)', () => {
    expect(gridSchemas.length).toBeGreaterThan(0);
    expect(new Set(gridSchemas.map((schema) => schema.type))).toEqual(
      new Set(['line', 'rectangle', 'text']),
    );
  });

  it('셀 배경색은 rectangle로 그린다', () => {
    const backgrounds = gridSchemas.filter((schema) => schema.type === 'rectangle');
    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0]?.color).toBe('#EEEEEE');
    expect(backgrounds[0]?.position).toEqual({ x: 10, y: 10 });
    expect(backgrounds[0]?.width).toBe(50);
    expect(backgrounds[0]?.height).toBe(10);
  });

  it('바깥 테두리는 격자 전체 폭·높이로 이어 그린다', () => {
    const top = horizontals.filter((schema) => Math.abs(schema.position.y - (10 - 0.1)) < 1e-6);
    expect(top).toHaveLength(1);
    expect(top[0]?.position.x).toBe(10);
    expect(top[0]?.width).toBe(100);
  });

  it('병합 셀 내부의 경계선은 그리지 않는다', () => {
    // 행 높이 균등(10mm) → y=30이 병합 셀(1행0열, 2행 병합)의 내부 경계
    const inner = horizontals.filter((schema) => Math.abs(schema.position.y - (30 - 0.1)) < 1e-6);
    expect(inner).toHaveLength(1);
    // 병합되지 않은 오른쪽 열(x 60~110)에만 선이 남는다
    expect(inner[0]?.position.x).toBe(60);
    expect(inner[0]?.width).toBe(50);
  });

  it('병합되지 않은 행 경계선은 격자 전체 폭으로 그린다', () => {
    const line = horizontals.filter((schema) => Math.abs(schema.position.y - (20 - 0.1)) < 1e-6);
    expect(line).toHaveLength(1);
    expect(line[0]?.width).toBe(100);
  });

  it('세로 경계선은 좌·중앙·우 3줄이다', () => {
    expect(verticals.map((schema) => schema.position.x).sort((a, b) => a - b)).toEqual([
      10 - 0.1,
      60 - 0.1,
      110 - 0.1,
    ]);
    expect(verticals.every((schema) => schema.height === 30)).toBe(true);
  });

  it('셀 문구는 병합 범위 크기의 텍스트 스키마가 된다', () => {
    const texts = gridSchemas.filter((schema) => schema.type === 'text');
    expect(texts).toHaveLength(5);
    const { inputs } = convertSlipFile(makeTemplateFile());
    const merged = texts.find((schema) => inputs[0]?.[schema.name] === '주소');
    expect(merged?.height).toBe(20);
    expect(merged?.verticalAlignment).toBe('middle');
  });
});

describe('동적 행 표(dynamicTable) 변환', () => {
  it('table 스키마의 스타일 기본값이 빠짐없이 채워진다 (Q08 직접 확인)', () => {
    const table = findSchema(pageSchemas(makeTemplateFile()), 'items');
    expect(table.type).toBe('table');
    expect(table.showHead).toBe(true);
    expect(table.repeatHead).toBe(true);
    expect(table.head).toEqual(['품명', '수량', '금액']);
    expect(table.headWidthPercentages).toEqual([50, 20, 30]);
    expect(table.tableStyles).toEqual({ borderColor: '#000000', borderWidth: 0.2 });

    const cellStyleKeys = [
      'alignment',
      'verticalAlignment',
      'fontSize',
      'lineHeight',
      'characterSpacing',
      'fontColor',
      'backgroundColor',
      'borderColor',
      'borderWidth',
      'padding',
    ];
    const headStyles = table.headStyles as Record<string, unknown>;
    const bodyStyles = table.bodyStyles as Record<string, unknown>;
    for (const key of cellStyleKeys) {
      expect(headStyles).toHaveProperty(key);
      expect(bodyStyles).toHaveProperty(key);
    }
    expect(bodyStyles).toHaveProperty('alternateBackgroundColor');
    expect(headStyles.borderWidth).toEqual({ top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 });
    expect(headStyles.padding).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(table.columnStyles).toEqual({});
  });

  it('행 데이터는 head의 각 제목을 키로 읽어 문자열화한다', () => {
    const { inputs } = convertSlipFile(makeVoucher(2));
    expect(JSON.parse(inputs[0]?.items ?? '[]')).toEqual([
      ['테스트 품목 1', '1', '1000'],
      ['테스트 품목 2', '2', '2000'],
    ]);
  });

  it('양식(template) 파일은 빈 행으로 변환된다', () => {
    const { inputs } = convertSlipFile(makeTemplateFile());
    expect(inputs[0]?.items).toBe('[]');
    // 값이 비었으므로 수식 없는 필드는 빈 문자열이 된다
    const file = makeTemplateFile();
    patchElement(file.template, 'total', { formula: undefined });
    expect(convertSlipFile(file).inputs[0]?.total).toBe('');
  });

  it('바인딩 값이 객체 배열이 아니면 한국어 오류로 거부한다', () => {
    const voucher = makeVoucher();
    voucher.values.items = '표가 아님';
    expect(() => convertSlipFile(voucher)).toThrow(/객체 배열이어야 합니다/);
    voucher.values.items = [1, 2];
    expect(() => convertSlipFile(voucher)).toThrow(/행은 객체여야 합니다/);
  });
});

describe('PDF 렌더링 (종단)', () => {
  it('전표를 PDF 바이트로 생성한다', async () => {
    const pdf = await renderSlipToPdf(makeVoucher(3));
    expect(pdf.length).toBeGreaterThan(0);
    expect(ascii(pdf, 4)).toBe('%PDF');
  });

  it('양식(빈 값) 파일도 PDF로 렌더된다', async () => {
    const pdf = await renderSlipToPdf(makeTemplateFile());
    expect(ascii(pdf, 4)).toBe('%PDF');
  });

  it('행이 많으면 자동으로 여러 페이지로 나뉜다 (ADR-011, Q08)', async () => {
    const onePage = await PDFDocument.load(await renderSlipToPdf(makeVoucher(3)));
    expect(onePage.getPageCount()).toBe(1);
    const manyPages = await PDFDocument.load(await renderSlipToPdf(makeVoucher(80)));
    expect(manyPages.getPageCount()).toBeGreaterThan(1);
  }, 30_000);
});
