import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_IMAGE_BYTES,
  SLIP_LIMITS,
  SlipParseError,
  decryptSlipFile,
  encryptSlipFile,
  parseSlipFile,
  serializeSlipFile,
  slipFileJsonSchema,
  validateSlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '../src/index.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function dataUrl(mime: string, head: number[], size = head.length + 16): string {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];

/** 모든 구조 계층(요소 9종·그리드 하위·조건부 서식·파라미터·에셋·페이지 설정)을 담은 양식 */
function makeTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '엄격 검사' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      parameters: [
        { key: 'total', label: '합계', valueType: 'number' },
        { key: 'items', valueType: 'list', fields: [{ key: 'name', label: '품명' }] },
      ],
      sampleValues: { total: 10, items: [{ name: 'a' }] },
      pages: [
        {
          key: 'p1',
          label: '첫 장',
          pageNumber: { position: 'bottom-center' },
          flowArea: { top: 10, bottom: 280 },
          elements: [
            { type: 'text', id: 't', name: '글', position: { x: 10, y: 10 }, width: 50, height: 10, content: '글',
              conditionalFormats: [{ condition: 'total > 0', bold: true }],
              pagePlacement: { mode: 'absolute', pages: 'all' } },
            { type: 'field', id: 'f', name: '값', position: { x: 10, y: 20 }, width: 50, height: 10, parameter: 'total' },
            { type: 'image', id: 'i', name: '그림', position: { x: 10, y: 30 }, width: 20, height: 10, src: 'asset://logo' },
            { type: 'barcode', id: 'b', name: '코드', kind: 'qrcode', position: { x: 10, y: 40 }, width: 20, height: 20, content: 'x' },
            { type: 'line', id: 'l', name: '선', position: { x: 10, y: 60 }, width: 50, height: 0 },
            { type: 'rect', id: 'r', name: '사각형', position: { x: 10, y: 70 }, width: 20, height: 10 },
            { type: 'ellipse', id: 'e', name: '타원', position: { x: 10, y: 80 }, width: 20, height: 10 },
            { type: 'polygon', id: 'p', name: '다각형', sides: 5, position: { x: 10, y: 90 }, width: 20, height: 10 },
            {
              type: 'grid', id: 'g', name: '표', position: { x: 10, y: 110 },
              columns: [{ width: 50 }, { width: 50 }], rows: [{ height: 8 }, { height: 8 }],
              repeat: {
                parameter: 'items',
                bands: [
                  { id: 'h', fromRow: 0, toRow: 0, placement: 'page-start', pages: 'all' },
                  { id: 'd', fromRow: 1, toRow: 1, placement: 'item' },
                ],
                pagination: { mode: 'auto', minItems: 0 },
              },
              cells: [
                { row: 0, column: 0, content: '품명' },
                { row: 1, column: 0, parameter: 'name', conditionalFormats: [{ condition: 'name = "a"', fontColor: '#FF0000' }] },
              ],
            },
          ],
        },
      ],
      assets: [{ id: 'logo', mimeType: 'image/png', src: PNG_1PX }],
    },
  };
}

function makeVoucher(values: Record<string, unknown>): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: makeTemplate().template,
    values: values as SlipVoucherFile['values'],
    issued: false,
  };
}

/** JSON으로 복제한 뒤 경로에 키를 심는다. */
function withKey(file: unknown, path: (string | number)[], key: string, value: unknown = 1): unknown {
  const clone = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
  let node: Record<string, unknown> = clone;
  for (const segment of path) node = node[segment as string] as Record<string, unknown>;
  node[key] = value;
  return clone;
}

describe('구조 객체는 정의되지 않은 프로퍼티를 거부한다', () => {
  const T = ['template'];
  const P = [...T, 'pages', 0];
  const E = (index: number) => [...P, 'elements', index];
  const G = E(8);
  it.each<[string, (string | number)[]]>([
    ['최상위 파일', []],
    ['template', T],
    ['meta', [...T, 'meta']],
    ['paper', [...T, 'paper']],
    ['page', P],
    ['pageNumber', [...P, 'pageNumber']],
    ['flowArea', [...P, 'flowArea']],
    ['text 요소', E(0)],
    ['field 요소', E(1)],
    ['image 요소', E(2)],
    ['barcode 요소', E(3)],
    ['line 요소', E(4)],
    ['rect 요소', E(5)],
    ['ellipse 요소', E(6)],
    ['polygon 요소', E(7)],
    ['grid 요소', G],
    ['position', [...E(0), 'position']],
    ['pagePlacement', [...E(0), 'pagePlacement']],
    ['조건부 서식 규칙', [...E(0), 'conditionalFormats', 0]],
    ['grid.repeat', [...G, 'repeat']],
    ['grid 행 구간', [...G, 'repeat', 'bands', 0]],
    ['grid pagination', [...G, 'repeat', 'pagination']],
    ['grid 열', [...G, 'columns', 0]],
    ['grid 행', [...G, 'rows', 0]],
    ['grid 셀', [...G, 'cells', 0]],
    ['셀 조건부 서식 규칙', [...G, 'cells', 1, 'conditionalFormats', 0]],
    ['asset', [...T, 'assets', 0]],
    ['파라미터 정의', [...T, 'parameters', 0]],
    ['목록 하위 필드', [...T, 'parameters', 1, 'fields', 0]],
  ])('%s에 미정의 키가 있으면 경로와 키 이름을 담은 SlipParseError', (_label, path) => {
    const raw = withKey(makeTemplate(), path, 'unknownKey');
    expect(() => validateSlipFile(raw)).toThrow(SlipParseError);
    const pathText = path.length === 0 ? '' : path.join('.');
    expect(() => validateSlipFile(raw)).toThrow(new RegExp(`${pathText.replace(/\./g, '\\.')}.*unknownKey`));
  });

  it('전표 파일과 templateSnapshot도 엄격하다', () => {
    expect(() => validateSlipFile(withKey(makeVoucher({}), [], 'extra'))).toThrow(/extra/);
    expect(() => validateSlipFile(withKey(makeVoucher({}), ['templateSnapshot'], 'extra'))).toThrow(/templateSnapshot.*extra/);
  });

  it('미정의 키 메시지도 로케일을 따른다', () => {
    const raw = withKey(makeTemplate(), ['template', 'meta'], 'unknownKey');
    expect(() => validateSlipFile(raw, { locale: 'ko-KR' })).toThrow(/unknownKey/);
    expect(() => validateSlipFile(raw, { locale: 'ja' })).toThrow(/unknownKey/);
  });
});

describe('values·sampleValues는 열린 맵으로 그대로 보존한다', () => {
  const values = {
    total: 10,
    items: [{ name: 'a', extraField: 'kept', nested: { deep: [1, 2, { x: null }] } }, { unrelated: true }],
    undefinedInParameters: 'kept too',
    nestedObject: { a: { b: { c: 'd' } }, list: [[1], [2, [3]]] },
    empty: {},
    emptyList: [],
  };

  it('parse → serialize → parse 왕복이 깊은 동등이다', () => {
    const voucher = makeVoucher(values);
    const once = parseSlipFile(serializeSlipFile(voucher));
    const twice = parseSlipFile(serializeSlipFile(once));
    expect(once).toEqual(voucher);
    expect(twice).toEqual(voucher);
    if (twice.kind === 'voucher') expect(twice.values).toEqual(values);
  });

  it('sampleValues의 미정의 키도 보존한다', () => {
    const template = makeTemplate();
    template.template.sampleValues = values as SlipTemplateFile['template']['sampleValues'];
    expect(parseSlipFile(serializeSlipFile(template))).toEqual(template);
  });

  it('암호화 왕복에서도 값이 그대로다', async () => {
    const voucher = makeVoucher(values);
    const locked = await encryptSlipFile(voucher, 'pw');
    expect(await decryptSlipFile(locked, 'pw')).toEqual(voucher);
  });
});

describe('JSON Schema 산출물은 같은 정책을 표현한다', () => {
  type Node = Record<string, unknown>;
  const schema = slipFileJsonSchema();

  /** `properties`를 가진 모든 객체 스키마를 경로와 함께 모은다. */
  function objectNodes(node: unknown, path: string, out: { path: string; node: Node }[] = []): { path: string; node: Node }[] {
    if (Array.isArray(node)) {
      node.forEach((item, index) => objectNodes(item, `${path}[${index}]`, out));
      return out;
    }
    if (typeof node !== 'object' || node === null) return out;
    const record = node as Node;
    if (record['properties'] !== undefined) out.push({ path, node: record });
    for (const [key, value] of Object.entries(record)) objectNodes(value, `${path}.${key}`, out);
    return out;
  }

  it('구조 객체는 모두 additionalProperties: false다', () => {
    const nodes = objectNodes(schema, '$');
    expect(nodes.length).toBeGreaterThan(20);
    for (const { path, node } of nodes) {
      expect(node['additionalProperties'], path).toBe(false);
    }
  });

  it('values·sampleValues와 그 안의 객체는 열린 맵이다', () => {
    const text = JSON.stringify(schema);
    const voucherBranch = (schema['oneOf'] as Node[] | undefined) ?? (schema['anyOf'] as Node[]);
    const voucher = voucherBranch.find((branch) => (branch['properties'] as Node)['values'] !== undefined)!;
    const values = (voucher['properties'] as Node)['values'] as Node;
    expect(values['additionalProperties']).not.toBe(false);
    expect(values['properties']).toBeUndefined();
    // 재귀 JSON 값 정의 안의 객체도 열려 있다.
    expect(text).toContain('"additionalProperties":{"$ref"');
  });

  it('요소에 미정의 키가 있는 문서는 런타임과 JSON Schema가 같은 판정을 낸다', () => {
    const raw = withKey(makeTemplate(), ['template', 'pages', 0, 'elements', 0], 'foo') as Node;
    expect(() => validateSlipFile(raw)).toThrow(/foo/);
    // 생성 스키마의 요소 정의를 구조적으로 확인한다: text 요소 노드는 닫혀 있고 foo를 허용하지 않는다.
    const elementNodes = objectNodes(schema, '$').filter(({ node }) => {
      const type = (node['properties'] as Node)['type'] as Node | undefined;
      return type?.['const'] === 'text';
    });
    expect(elementNodes.length).toBeGreaterThan(0);
    for (const { node } of elementNodes) {
      expect(node['additionalProperties']).toBe(false);
      expect((node['properties'] as Node)['foo']).toBeUndefined();
    }
  });

  it('이미지 src 패턴이 JSON Schema에 나타나고 PNG·JPEG만 허용한다', () => {
    const text = JSON.stringify(schema);
    expect(text).toContain('data:image');
    expect(text).toContain('png|jpeg');
  });
});

describe('자원 한계 (SLIP_LIMITS)', () => {
  const mm = SLIP_LIMITS.maxMillimeters;
  const parse = (file: unknown) => validateSlipFile(file);

  it('mm 값은 상한까지 허용하고 넘으면 거부한다', () => {
    const ok = makeTemplate();
    ok.template.paper = { width: mm, height: mm, padding: [0, 0, 0, 0] };
    ok.template.pages[0]!.flowArea = { top: 0, bottom: mm };
    ok.template.pages[0]!.elements[0]!.position = { x: mm, y: mm };
    (ok.template.pages[0]!.elements[0] as { width: number }).width = mm;
    expect(() => parse(ok)).not.toThrow();
    for (const [path, key] of [
      [['template', 'paper'], 'width'],
      [['template', 'pages', 0, 'elements', 0], 'height'],
      [['template', 'pages', 0, 'elements', 0, 'position'], 'x'],
      [['template', 'pages', 0, 'elements', 4], 'borderWidth'],
      [['template', 'pages', 0, 'elements', 5], 'radius'],
      [['template', 'pages', 0, 'elements', 8, 'columns', 0], 'width'],
      [['template', 'pages', 0, 'elements', 8, 'rows', 0], 'height'],
      [['template', 'pages', 0, 'elements', 8], 'cellBorderWidth'],
      [['template', 'pages', 0, 'flowArea'], 'bottom'],
    ] as [(string | number)[], string][]) {
      const bad = withKey(makeTemplate(), path, key, mm + 0.5);
      expect(() => parse(bad), `${path.join('.')}.${key}`).toThrow(new RegExp(`at most ${mm}`));
    }
    expect(() => parse(withKey(makeTemplate(), ['template', 'paper'], 'padding', [mm + 1, 0, 0, 0]))).toThrow(SlipParseError);
  });

  it('그리드 트랙 합도 상한 안이어야 한다', () => {
    const file = makeTemplate();
    const grid = file.template.pages[0]!.elements[8] as { columns: { width: number }[]; rows: { height: number }[] };
    grid.columns = [{ width: mm / 2 }, { width: mm / 2 }];
    expect(() => parse(file)).not.toThrow();
    grid.columns = [{ width: mm / 2 }, { width: mm / 2 + 1 }];
    expect(() => parse(file)).toThrow(/total width and height of a grid/);
    grid.columns = [{ width: 10 }];
    grid.rows = Array.from({ length: 3 }, () => ({ height: mm / 2 }));
    expect(() => parse(file)).toThrow(/total width and height of a grid/);
  });

  it('글자 크기는 상한까지 허용한다', () => {
    const max = SLIP_LIMITS.maxFontSize;
    expect(() => parse(withKey(makeTemplate(), ['template', 'pages', 0, 'elements', 0], 'fontSize', max))).not.toThrow();
    expect(() => parse(withKey(makeTemplate(), ['template', 'pages', 0, 'elements', 0], 'fontSize', max + 1))).toThrow(/font size/);
    expect(() => parse(withKey(makeTemplate(), ['template', 'pages', 0, 'elements', 8, 'cells', 0], 'fontSize', max + 1))).toThrow(/font size/);
    expect(() => parse(withKey(makeTemplate(), ['template', 'pages', 0, 'pageNumber'], 'fontSize', max + 1))).toThrow(/font size/);
  });

  it('구조 문자열은 상한까지 허용한다', () => {
    const max = SLIP_LIMITS.maxTextLength;
    expect(() => parse(withKey(makeTemplate(), ['template', 'pages', 0, 'elements', 0], 'content', 'a'.repeat(max)))).not.toThrow();
    for (const [path, key] of [
      [['template', 'pages', 0, 'elements', 0], 'content'],
      [['template', 'pages', 0, 'elements', 0], 'name'],
      [['template', 'pages', 0, 'elements', 1], 'formula'],
      [['template', 'pages', 0, 'elements', 8, 'cells', 0], 'content'],
      [['template', 'meta'], 'title'],
      [['template', 'parameters', 0], 'label'],
      [['template', 'pages', 0], 'label'],
    ] as [(string | number)[], string][]) {
      expect(() => parse(withKey(makeTemplate(), path, key, 'a'.repeat(max + 1))), `${path.join('.')}.${key}`)
        .toThrow(/at most 20000 characters/);
    }
  });

  it('값 문자열은 2 MiB 이미지의 data: 표기를 담을 수 있고 그 상한을 넘으면 거부한다', () => {
    const max = SLIP_LIMITS.maxValueStringLength;
    const image = dataUrl('image/png', PNG_HEAD, MAX_IMAGE_BYTES);
    expect(image.length).toBeLessThanOrEqual(max);
    expect(() => parse(makeVoucher({ sign: image }))).not.toThrow();
    expect(() => parse(makeVoucher({ memo: 'a'.repeat(max) }))).not.toThrow();
    expect(() => parse(makeVoucher({ memo: 'a'.repeat(max + 1) }))).toThrow(/string value can be at most/);
    expect(() => parse(makeVoucher({ items: [{ memo: 'a'.repeat(max + 1) }] }))).toThrow(/string value can be at most/);
  });
});

describe('스키마 단계의 이미지 데이터 검사', () => {
  const imageAt = (src: string): unknown =>
    withKey(makeTemplate(), ['template', 'pages', 0, 'elements', 2], 'src', src);
  const assetWith = (mimeType: string, src: string): SlipTemplateFile => {
    const file = makeTemplate();
    file.template.assets = [{ id: 'logo', mimeType, src }];
    return file;
  };

  it('PNG·JPEG data: 소스를 허용한다', () => {
    expect(() => validateSlipFile(imageAt(PNG_1PX))).not.toThrow();
    expect(() => validateSlipFile(imageAt(dataUrl('image/jpeg', JPEG_HEAD)))).not.toThrow();
    expect(() => validateSlipFile(assetWith('image/jpeg', dataUrl('image/jpeg', JPEG_HEAD)))).not.toThrow();
  });

  it('GIF·WebP·SVG는 src 형식 단계에서 거부한다', () => {
    for (const src of ['data:image/gif;base64,R0lGODlh', 'data:image/webp;base64,UklGRg==', 'data:image/svg+xml;base64,PHN2Zy8+']) {
      expect(() => validateSlipFile(imageAt(src))).toThrow(SlipParseError);
      expect(() => validateSlipFile(imageAt(src))).toThrow(/data:image\/png;base64/);
    }
  });

  it('선언 PNG·내용 JPEG는 내용 불일치로 거부한다', () => {
    expect(() => validateSlipFile(imageAt(dataUrl('image/png', JPEG_HEAD)))).toThrow(/not the declared PNG or JPEG/);
    expect(() => validateSlipFile(assetWith('image/png', dataUrl('image/png', JPEG_HEAD)))).toThrow(/not the declared PNG or JPEG/);
  });

  it('에셋의 mimeType은 데이터와 맞아야 한다', () => {
    expect(() => validateSlipFile(assetWith('image/jpeg', PNG_1PX))).toThrow(/mimeType \(image\/jpeg\) does not match/);
  });

  it('2 MiB를 넘는 이미지는 거부한다', () => {
    expect(() => validateSlipFile(imageAt(dataUrl('image/png', PNG_HEAD, MAX_IMAGE_BYTES)))).not.toThrow();
    expect(() => validateSlipFile(imageAt(dataUrl('image/png', PNG_HEAD, MAX_IMAGE_BYTES + 1)))).toThrow(/size limit \(2 MiB\)/);
  });

  it('발행 전표의 변동 이미지 값도 서명·크기를 검사한다', () => {
    const issued = (sign: string): SlipVoucherFile => {
      const voucher = makeVoucher({ sign });
      voucher.templateSnapshot.pages[0]!.elements[2] = {
        type: 'image', id: 'i', name: '그림', position: { x: 10, y: 30 }, width: 20, height: 10, parameter: 'sign',
      };
      voucher.issued = true;
      return voucher;
    };
    expect(() => validateSlipFile(issued(PNG_1PX))).not.toThrow();
    expect(() => validateSlipFile(issued(dataUrl('image/png', JPEG_HEAD)))).toThrow(/values\.sign.*not the declared/);
    expect(() => validateSlipFile(issued('data:image/gif;base64,R0lGODlh'))).toThrow(/PNG or JPEG/);
    expect(() => validateSlipFile(issued(dataUrl('image/png', PNG_HEAD, MAX_IMAGE_BYTES + 1)))).toThrow(/size limit/);
  });

  it('이미지 메시지는 로케일을 따른다', () => {
    const bad = imageAt(dataUrl('image/png', JPEG_HEAD));
    expect(() => validateSlipFile(bad, { locale: 'ko-KR' })).toThrow('선언한 PNG·JPEG가 아닙니다');
    expect(() => validateSlipFile(bad, { locale: 'ja' })).toThrow('宣言された PNG・JPEG ではありません');
  });
});
