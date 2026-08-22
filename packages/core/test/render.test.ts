import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { convertSlipFile } from '../src/render/convert.js';
import { SlipRenderError } from '../src/render/errors.js';
import {
  CURRENT_SCHEMA_VERSION,
  renderSlipToPdf,
  type GridElement,
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

/** 여러 종류의 요소를 담은 양식 본문. 그리드는 (1,0)에 2행 병합 칸을 둔다 */
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
            type: 'grid',
            id: 'grid',
            name: '공급자 정보',
            position: { x: 10, y: 10 },
            width: 100,
            height: 30,
            rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
            columns: [{ width: 50 }, { width: 50 }],
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
            type: 'grid',
            id: 'items',
            name: '품목',
            position: { x: 15, y: 60 },
            width: 180,
            height: 8 * 7,
            columns: [{ width: 90 }, { width: 36 }, { width: 54 }],
            rows: [{ height: 8 }, { height: 8 }],
            repeat: { binding: 'items', fromRow: 1, toRow: 1, perPage: 6, repeatHeader: true },
            cells: [
              { row: 0, column: 0, content: '품명' },
              { row: 0, column: 1, content: '수량' },
              { row: 0, column: 2, content: '금액' },
              { row: 1, column: 0, binding: '품명' },
              { row: 1, column: 1, binding: '수량' },
              { row: 1, column: 2, binding: '금액' },
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
            position: { x: 15, y: 45 },
            width: 180,
            height: 0,
            lineDirection: 'horizontal',
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

  it('rect 요소는 rectangle 스키마로 변환된다', () => {
    const file = makeTemplateFile();
    patchElement(file.template, 'divider', {
      type: 'rect',
      lineDirection: undefined,
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

describe('그리드(grid) 분해', () => {
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

  it('바깥 테두리는 그리드 전체 폭·높이로 이어 그린다', () => {
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

  it('병합되지 않은 행 경계선은 그리드 전체 폭으로 그린다', () => {
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

describe('그리드 셀별 테두리 (ADR-033)', () => {
  // 2×2 그리드: 경계 x=10·60·110, y=10·20·30 (열 50/50, 행 균등 10mm)
  function makeGridFile(cells: GridElement['cells']): SlipTemplateFile {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: { title: '셀 테두리 시험' },
        paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        pages: [
          {
            elements: [
              {
                type: 'grid', id: 'grid', name: '그리드',
                position: { x: 10, y: 10 }, width: 100, height: 20,
                rows: [{ height: 10 }, { height: 10 }],
                columns: [{ width: 50 }, { width: 50 }], cells,
              },
            ],
          },
        ],
        assets: [],
      },
    };
  }
  const linesOf = (file: SlipTemplateFile) =>
    pageSchemas(file).filter((schema) => schema.type === 'line');
  const at = (lines: PdfmeSchema[], x: number, y: number) =>
    lines.filter(
      (line) => Math.abs(line.position.x - x) < 1e-6 && Math.abs(line.position.y - y) < 1e-6,
    );

  it('셀 테두리 굵기 0이면 그 셀 둘레 변을 그리지 않는다 (합계 박스)', () => {
    const lines = linesOf(makeGridFile([{ row: 1, column: 0, content: '', borderWidth: 0 }]));
    // 아래 변: 왼쪽 칸(굵기 0)은 사라지고 오른쪽 칸만 남는다
    const bottom = lines.filter((line) => Math.abs(line.position.y - (30 - 0.1)) < 1e-6);
    expect(bottom).toHaveLength(1);
    expect(bottom[0]?.position.x).toBe(60);
    expect(bottom[0]?.width).toBe(50);
    // 왼쪽 변: 위 행(기본 테두리)만 남는다
    const left = at(lines, 10 - 0.1, 10);
    expect(left).toHaveLength(1);
    expect(left[0]?.height).toBe(10);
    // 가운데 변: 오른쪽 이웃 셀이 기본 테두리라 굵은 쪽이 이겨 전체 높이로 남는다
    const middle = at(lines, 60 - 0.1, 10);
    expect(middle).toHaveLength(1);
    expect(middle[0]?.height).toBe(20);
  });

  it('셀 테두리가 요소 값보다 굵으면 공유 변도 그 셀 설정으로 그린다', () => {
    const lines = linesOf(
      makeGridFile([{ row: 0, column: 0, content: '', borderWidth: 0.6, borderColor: '#CC0000' }]),
    );
    // 위 변 왼쪽 칸: 0.6mm 빨강 (중심 정렬이라 y = 10 - 0.3)
    const top = at(lines, 10, 10 - 0.3);
    expect(top).toHaveLength(1);
    expect(top[0]?.width).toBe(50);
    expect(top[0]?.height).toBe(0.6);
    expect(top[0]?.color).toBe('#CC0000');
    // 행 경계(공유 변): 아래 셀은 기본 0.2지만 굵은 쪽(0.6 빨강)이 이긴다
    const shared = at(lines, 10, 20 - 0.3);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.color).toBe('#CC0000');
    // 위 변 오른쪽 칸은 기본 테두리 그대로 — 스타일이 달라 별도 선분으로 나뉜다
    const topRight = at(lines, 60, 10 - 0.1);
    expect(topRight).toHaveLength(1);
    expect(topRight[0]?.height).toBe(0.2);
  });

  it('굵기가 같은 공유 변은 아래·오른쪽 셀 설정을 따른다', () => {
    const lines = linesOf(
      makeGridFile([
        { row: 0, column: 0, content: '', borderWidth: 0.4, borderColor: '#FF0000' },
        { row: 1, column: 0, content: '', borderWidth: 0.4, borderColor: '#0000FF' },
      ]),
    );
    const shared = at(lines, 10, 20 - 0.2);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.color).toBe('#0000FF');
  });
});

describe('픽스처 그리드의 반복 구간 변환 (ADR-037)', () => {
  /** 그리드가 낸 텍스트 값 목록 (그린 순서대로) */
  function itemTexts(file: SlipTemplateFile | SlipVoucherFile): string[] {
    const { template, inputs } = convertSlipFile(file);
    const schemas = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    return schemas
      .filter((schema) => schema.type === 'text' && String(schema.name).includes('items__'))
      .map((schema) => inputs[0]?.[schema.name] ?? '');
  }

  it('반복 구간이 전표 값으로 채워지고 헤더는 고정 문구를 쓴다', () => {
    const texts = itemTexts(makeVoucher(2));
    expect(texts.slice(0, 3)).toEqual(['품명', '수량', '금액']);
    expect(texts).toContain('테스트 품목 1');
    expect(texts).toContain('2000');
  });

  it('양식(빈 값) 파일은 반복 칸이 비어 헤더만 남는다', () => {
    const texts = itemTexts(makeTemplateFile());
    expect(texts).toEqual(['품명', '수량', '금액']);
    // 값이 비었으므로 수식 없는 필드도 빈 문자열이 된다
    const file = makeTemplateFile();
    patchElement(file.template, 'total', { formula: undefined });
    expect(convertSlipFile(file).inputs[0]?.total).toBe('');
  });

  it('반복 값이 객체 배열이 아니면 한국어 오류로 거부한다', () => {
    const voucher = makeVoucher();
    voucher.values.items = '표가 아님';
    expect(() => convertSlipFile(voucher)).toThrow(/객체 배열이어야 합니다/);
    voucher.values.items = [1, 2];
    expect(() => convertSlipFile(voucher)).toThrow(/항목은 객체여야 합니다/);
  });
});

describe('도형·글자 스타일 변환 (0.2.0, ADR-032)', () => {
  function makeShapeFile(elements: SlipElement[]): SlipTemplateFile {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: { title: '도형 시험' },
        paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        pages: [{ elements }],
        assets: [],
      },
    };
  }
  const base = { id: 's1', name: '도형', position: { x: 20, y: 30 }, width: 60, height: 30 };

  it('대각선(down)은 상자 대각선 길이·기울기의 회전된 선으로 변환된다', () => {
    const [schemas] = convertSlipFile(
      makeShapeFile([{ type: 'line', lineDirection: 'down', ...base }]),
    ).template.schemas as PdfmeSchema[][];
    const line = schemas!.find((s) => s.name === 's1')!;
    expect(line.type).toBe('line');
    expect(line.width).toBeCloseTo(Math.hypot(60, 30), 5);
    expect(line.rotate).toBeCloseTo((Math.atan2(30, 60) * 180) / Math.PI, 5);
    // up 대각선은 반대 기울기
    const [up] = convertSlipFile(
      makeShapeFile([{ type: 'line', lineDirection: 'up', ...base }]),
    ).template.schemas as PdfmeSchema[][];
    expect((up!.find((s) => s.name === 's1')!.rotate as number)).toBeLessThan(0);
  });

  it('파선은 짧은 선분 여러 개로 분해된다 (하부 엔진 파선 미지원)', () => {
    const [schemas] = convertSlipFile(
      makeShapeFile([{
        type: 'line', lineDirection: 'horizontal', borderStyle: 'dashed', ...base,
      }]),
    ).template.schemas as PdfmeSchema[][];
    const segments = schemas!.filter((s) => s.type === 'line');
    expect(segments.length).toBeGreaterThan(5);
    // 선분 길이 = 파선 패턴(2.4mm) 이하
    for (const seg of segments) expect(seg.width).toBeLessThanOrEqual(2.4);
  });

  it('타원은 ellipse로, 다각형(오각형)은 svg 폴리곤으로 변환된다', () => {
    const { template, inputs } = convertSlipFile(
      makeShapeFile([
        { type: 'ellipse', ...base, id: 'e1', backgroundColor: '#ffee00' },
        { type: 'polygon', sides: 5, ...base, id: 't1', position: { x: 20, y: 80 } },
      ]),
    );
    const [schemas] = template.schemas as PdfmeSchema[][];
    expect(schemas!.find((s) => s.name === 'e1')!.type).toBe('ellipse');
    expect(schemas!.find((s) => s.name === 't1')!.type).toBe('svg');
    expect(inputs[0]?.t1).toContain('<polygon');
    // 오각형 = 꼭짓점 5개
    const pointsAttr = /points="([^"]+)"/.exec(inputs[0]?.t1 ?? '')?.[1] ?? '';
    expect(pointsAttr.split(' ').length).toBe(5);
  });

  it('사각형 모서리 반경이 radius로 전달된다', () => {
    const [schemas] = convertSlipFile(
      makeShapeFile([{ type: 'rect', radius: 3, ...base }]),
    ).template.schemas as PdfmeSchema[][];
    expect(schemas!.find((s) => s.name === 's1')!.radius).toBe(3);
  });

  it('굵게는 폰트 목록의 <이름>-Bold 폰트로 전환되고, 밑줄·취소선은 그대로 전달된다', () => {
    const file = makeShapeFile([{
      type: 'text', id: 'b1', name: '굵은 글', position: { x: 20, y: 30 },
      width: 60, height: 10, content: '합계', bold: true, underline: true, strikethrough: true,
    }]);
    const [schemas] = convertSlipFile(file, {
      fontNames: ['Pretendard', 'Pretendard-Bold'],
      fallbackFontName: 'Pretendard',
    }).template.schemas as PdfmeSchema[][];
    const text = schemas!.find((s) => s.name === 'b1')!;
    expect(text.fontName).toBe('Pretendard-Bold');
    expect(text.underline).toBe(true);
    expect(text.strikethrough).toBe(true);

    // 굵은 폰트가 없으면 굵게는 무시된다 (fontName 미지정 유지)
    const [noBold] = convertSlipFile(file, {
      fontNames: ['Pretendard'], fallbackFontName: 'Pretendard',
    }).template.schemas as PdfmeSchema[][];
    expect(noBold!.find((s) => s.name === 'b1')!.fontName).toBeUndefined();
  });

  it('새 도형·사선·파선을 담은 양식이 실제 PDF로 렌더된다', async () => {
    const pdf = await renderSlipToPdf(
      makeShapeFile([
        { type: 'line', lineDirection: 'down', borderStyle: 'dashed', ...base, id: 'l1' },
        { type: 'ellipse', ...base, id: 'e1', position: { x: 20, y: 80 } },
        { type: 'polygon', sides: 6, ...base, id: 't1', position: { x: 20, y: 130 } },
        { type: 'rect', radius: 4, ...base, id: 'r1', position: { x: 20, y: 180 }, borderWidth: 0.5 },
      ]),
    );
    expect(ascii(pdf, 4)).toBe('%PDF');
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

describe('렌더 로케일 (ADR-013)', () => {
  it('RenderOptions.locale이 수식 포맷 함수까지 전달된다', () => {
    const file = makeTemplateFile();
    const field = file.template.pages[0]!.elements.find(
      (el): el is Extract<SlipElement, { type: 'field' }> => el.type === 'field',
    )!;
    field.formula = 'FORMAT_NUMBER(1234567)';

    const { inputs } = convertSlipFile(file, { locale: 'de-DE' });
    expect(inputs[0]![field.id]).toBe('1.234.567');

    const { inputs: koInputs } = convertSlipFile(file);
    expect(koInputs[0]![field.id]).toBe('1,234,567');
  });
});

// ---------------------------------------------------------------------------
// grid — 고정 틀과 반복 목록을 하나로 다루는 그리드 (ADR-037)
// ---------------------------------------------------------------------------

/**
 * 헤더 1행 + 반복 1행 + 꼬리 1행짜리 그리드.
 * 열 너비 60+40mm, 행 높이 8mm → 반복 3개면 높이 8 + 3x8 + 8 = 40mm.
 */
function makeGridBody(options?: {
  perPage?: number;
  repeatHeader?: boolean;
  overflow?: 'clip' | 'shrink';
}): SlipTemplateBody {
  const perPage = options?.perPage ?? 3;
  return {
    meta: { title: '그리드 시험' },
    paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
    pages: [
      {
        elements: [
          {
            type: 'text',
            id: 'title',
            name: '제목',
            position: { x: 15, y: 10 },
            width: 100,
            height: 8,
            content: '거래명세서',
          },
          {
            type: 'grid',
            id: 'items',
            name: '품목',
            position: { x: 15, y: 30 },
            width: 100,
            height: 8 + perPage * 8 + 8,
            columns: [{ width: 60 }, { width: 40 }],
            rows: [{ height: 8 }, { height: 8 }, { height: 8 }],
            ...(options?.overflow === undefined ? {} : { overflow: options.overflow }),
            repeat: {
              binding: 'items',
              fromRow: 1,
              toRow: 1,
              perPage,
              repeatHeader: options?.repeatHeader ?? true,
            },
            cells: [
              { row: 0, column: 0, content: '품명', backgroundColor: '#EEEEEE' },
              { row: 0, column: 1, content: '금액' },
              { row: 1, column: 0, binding: '품명' },
              { row: 1, column: 1, binding: '금액' },
              { row: 2, column: 0, content: '합계' },
              { row: 2, column: 1, formula: 'FORMAT_NUMBER(SUM(items.금액))' },
            ],
          },
        ],
      },
    ],
    assets: [],
  };
}

function makeGridVoucher(itemCount: number, options?: Parameters<typeof makeGridBody>[0]): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: makeGridBody(options),
    values: {
      items: Array.from({ length: itemCount }, (_, index) => ({
        품명: `품목 ${index + 1}`,
        금액: (index + 1) * 1000,
      })),
    },
    issued: false,
  };
}

/** 그리드가 낸 텍스트 스키마의 값 목록 (그린 순서대로) */
function gridTexts(file: SlipVoucherFile | SlipTemplateFile, pageIndex = 0): string[] {
  const { template, inputs } = convertSlipFile(file);
  const schemas = (template.schemas[pageIndex] ?? []) as unknown as PdfmeSchema[];
  return schemas
    .filter((schema) => schema.type === 'text' && String(schema.name).includes('__cell-'))
    .map((schema) => inputs[0]?.[schema.name] ?? '');
}

describe('그리드(grid) 변환 — 반복 구간 (ADR-037)', () => {
  it('반복 구간이 항목 수만큼 복제되고 셀 값·수식이 채워진다', () => {
    const texts = gridTexts(makeGridVoucher(3));
    // 값 칸은 그대로, 수식 칸(합계)만 포맷된다
    expect(texts).toEqual(['품명', '금액', '품목 1', '1000', '품목 2', '2000', '품목 3', '3000', '합계', '6,000']);
  });

  it('항목이 적으면 남는 칸은 빈 줄로 남고 그리드 크기는 그대로다', () => {
    const { template } = convertSlipFile(makeGridVoucher(1));
    const schemas = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    // 빈 줄에는 글자가 없다 — 헤더 2 + 항목 2 + 꼬리 2
    expect(gridTexts(makeGridVoucher(1))).toEqual(['품명', '금액', '품목 1', '1000', '합계', '1,000']);
    // 괘선은 빈 줄까지 그린다 — 가로선이 행 경계 수(5개: 0~4)만큼 있다
    const horizontals = schemas.filter((s) => String(s.name).includes('__h-'));
    expect(horizontals.length).toBeGreaterThanOrEqual(5);
  });

  it('항목이 perPage를 넘으면 페이지가 늘고 나머지 요소도 함께 다시 그려진다', () => {
    const { template } = convertSlipFile(makeGridVoucher(7));
    // 7항목 / 페이지당 3 → 3페이지
    expect(template.schemas).toHaveLength(3);
    expect(gridTexts(makeGridVoucher(7), 0)).toContain('품목 3');
    expect(gridTexts(makeGridVoucher(7), 1)).toContain('품목 4');
    expect(gridTexts(makeGridVoucher(7), 2)).toContain('품목 7');
    // 그리드 밖 요소는 페이지마다 다시 그린다
    const page2 = (template.schemas[1] ?? []) as unknown as PdfmeSchema[];
    expect(page2.some((s) => String(s.name).startsWith('title'))).toBe(true);
  });

  it('헤더를 반복하지 않으면 이어지는 페이지에서 그 자리를 비운다', () => {
    const file = makeGridVoucher(5, { repeatHeader: false });
    expect(gridTexts(file, 0)).toContain('품명');
    expect(gridTexts(file, 1)).not.toContain('품명');
    // 그리드 높이는 그대로라 꼬리 행은 같은 자리에 남는다
    const { template } = convertSlipFile(file);
    const first = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    const second = (template.schemas[1] ?? []) as unknown as PdfmeSchema[];
    const tailOf = (schemas: PdfmeSchema[]): number =>
      schemas.filter((s) => s.type === 'text' && String(s.name).includes('__cell-')).slice(-1)[0]!.position.y;
    expect(tailOf(second)).toBe(tailOf(first));
  });

  it('반복 구간이 없으면 고정 틀로 그린다', () => {
    const body = makeGridBody();
    const grid = body.pages[0]!.elements[1] as Extract<SlipElement, { type: 'grid' }>;
    delete (grid as { repeat?: unknown }).repeat;
    grid.height = 24;
    grid.cells = [{ row: 0, column: 0, content: '상호' }, { row: 0, column: 1, content: '테스트상사' }];
    const file: SlipTemplateFile = { schemaVersion: CURRENT_SCHEMA_VERSION, kind: 'template', template: body };
    expect(gridTexts(file)).toEqual(['상호', '테스트상사']);
  });

  it('행이 아래로 쌓이고 꼬리 행은 반복 끝 바로 아래에 놓인다', () => {
    const { template } = convertSlipFile(makeGridVoucher(3));
    const schemas = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    const cells = schemas.filter((s) => s.type === 'text' && String(s.name).includes('__cell-'));
    // 그리드 origin y=30, 행 높이 8 — 헤더 30, 반복 38·46·54, 꼬리 62
    expect(cells.map((c) => c.position.y)).toEqual([30, 30, 38, 38, 46, 46, 54, 54, 62, 62]);
    // 열 너비 60·40 — 두 번째 열은 x=15+60
    expect(cells.map((c) => c.position.x)).toEqual([15, 75, 15, 75, 15, 75, 15, 75, 15, 75]);
  });

  it('반복 값이 배열이 아니면 한국어 오류로 거부한다', () => {
    const voucher = makeGridVoucher(2);
    voucher.values.items = { a: 1 };
    expect(() => convertSlipFile(voucher)).toThrow(SlipRenderError);
    expect(() => convertSlipFile(voucher)).toThrow(/객체 배열이어야 합니다/);
  });

  it('넘치는 글을 줄여 넣기로 두면 글자 크기를 줄이도록 표시한다', () => {
    const file = makeGridVoucher(1, { overflow: 'shrink' });
    const { template } = convertSlipFile(file);
    const schemas = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    const cell = schemas.find((s) => s.type === 'text' && String(s.name).includes('__cell-'))!;
    expect(cell.dynamicFontSize).toEqual({ min: 4, max: 10, fit: 'vertical' });
  });

  it('여러 쪽이 실제 PDF로도 그만큼 나온다', async () => {
    const pdf = await PDFDocument.load(await renderSlipToPdf(makeGridVoucher(7)));
    expect(pdf.getPageCount()).toBe(3);
  }, 30_000);
});

describe('그리드(grid) 칸을 넘치는 글 (ADR-037)', () => {
  /** 재기용 폰트 — 하부 엔진 기본 폰트를 그대로 쓴다 (테스트 전용) */
  async function defaultFonts(): Promise<{ name: string; data: Uint8Array; fallback: boolean }[]> {
    const { getDefaultFont } = await import('@pdfme/common');
    const font = getDefaultFont();
    const name = Object.keys(font)[0]!;
    return [{ name, data: font[name]!.data as Uint8Array, fallback: true }];
  }

  /** 두 줄이 들어가는 칸에 긴 글을 넣은 그리드 */
  function longTextFile(overflow: 'clip' | 'shrink'): SlipTemplateFile {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: { title: '넘침' },
        paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
        pages: [
          {
            elements: [
              {
                type: 'grid',
                id: 'g',
                name: '그리드',
                position: { x: 15, y: 30 },
                width: 40,
                height: 10,
                overflow,
                columns: [{ width: 40 }],
                rows: [{ height: 10 }],
                cells: [
                  {
                    row: 0,
                    column: 0,
                    content: 'The quick brown fox jumps over the lazy dog near the river bank at dawn',
                    fontSize: 10,
                  },
                ],
              },
            ],
          },
        ],
        assets: [],
      },
    };
  }

  it('잘라내기는 칸에 들어가는 줄까지만 남긴다', async () => {
    const fonts = await defaultFonts();
    const { inputs } = convertSlipFile(longTextFile('clip'), { fonts });
    const value = Object.values(inputs[0] ?? {}).find((v) => v.includes('quick'))!;
    const lines = value.split('\n');
    // 10mm - 여백 2mm = 8mm에 10pt 글자는 두 줄까지 들어간다
    expect(lines).toHaveLength(2);
    // 낱말 중간에서 끊기지 않는다
    for (const line of lines) expect(line).not.toMatch(/\w-$/);
    expect(lines[0]).toMatch(/^The quick/);
    expect(value.length).toBeLessThan(
      'The quick brown fox jumps over the lazy dog near the river bank at dawn'.length,
    );
  });

  it('폰트를 주지 않으면 자르지 않고 그대로 넘긴다', () => {
    const { inputs } = convertSlipFile(longTextFile('clip'));
    const value = Object.values(inputs[0] ?? {}).find((v) => v.includes('quick'))!;
    expect(value).toBe('The quick brown fox jumps over the lazy dog near the river bank at dawn');
  });

  it('줄여 넣기는 자르지 않고 글자 크기를 줄이도록 표시한다', async () => {
    const fonts = await defaultFonts();
    const { template, inputs } = convertSlipFile(longTextFile('shrink'), { fonts });
    const schemas = (template.schemas[0] ?? []) as unknown as PdfmeSchema[];
    const cell = schemas.find((s) => s.type === 'text' && String(s.name).includes('__cell-'))!;
    expect(cell.dynamicFontSize).toEqual({ min: 4, max: 10, fit: 'vertical' });
    expect(inputs[0]?.[cell.name]).toBe(
      'The quick brown fox jumps over the lazy dog near the river bank at dawn',
    );
  });
});
