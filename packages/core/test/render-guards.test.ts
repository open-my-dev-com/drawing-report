import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertSlipFile } from '../src/render/convert.js';
import { TextMeasurer } from '../src/render/measure.js';
import { isValidBarcodeValue } from '../src/render/barcode.js';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_IMAGE_BYTES,
  SLIP_LIMITS,
  SlipRenderError,
  renderSlipToPdf,
  type BarcodeKind,
  type SlipElement,
  type SlipFont,
  type SlipVoucherFile,
} from '../src/index.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 앞부분 바이트를 지정한 크기의 data: 문자열로 만든다 (서명·크기 검사용). */
function dataUrl(mime: string, head: number[], size = head.length + 16): string {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function voucher(elements: SlipElement[], values: Record<string, unknown> = {}): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: {
      meta: { title: '검사' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{ elements }],
      assets: [],
    },
    values: values as SlipVoucherFile['values'],
    issued: false,
  };
}

const image = (extra: Partial<Extract<SlipElement, { type: 'image' }>>): SlipElement =>
  ({ type: 'image', id: 'img', name: '서명', position: { x: 10, y: 10 }, width: 20, height: 10, ...extra }) as SlipElement;
const barcode = (kind: BarcodeKind, extra: Record<string, unknown>): SlipElement =>
  ({ type: 'barcode', id: 'bc', name: '코드', kind, position: { x: 10, y: 30 }, width: 40, height: 20, ...extra }) as SlipElement;
const text = (content: string, extra: Record<string, unknown> = {}): SlipElement =>
  ({ type: 'text', id: 'tx', name: '글', position: { x: 10, y: 60 }, width: 100, height: 20, content, ...extra }) as SlipElement;

function schemaNames(file: SlipVoucherFile): string[] {
  const [page] = convertSlipFile(file).template.schemas as { name: string }[][];
  return (page ?? []).map((s) => s.name);
}

/** 렌더링 엔진의 기본 폰트(Roboto)를 등록 폰트로 쓴다 — 라틴 문자만 있어 글리프 검사에 알맞다. */
async function defaultFonts(): Promise<SlipFont[]> {
  const { getDefaultFont } = await import('@pdfme/common');
  const font = getDefaultFont();
  const name = Object.keys(font)[0]!;
  return [{ name, data: font[name]!.data as Uint8Array, fallback: true }];
}

describe('빈 이미지 값은 요소를 그리지 않고 렌더를 계속한다 (SPEC §12.2)', () => {
  it.each([
    ['undefined', {}],
    ['null', { sign: null }],
    ["''", { sign: '' }],
  ])('값이 %s이면 이미지 스키마를 만들지 않는다', async (_label, values) => {
    const file = voucher([image({ parameter: 'sign' }), text('옆 요소')], values);
    expect(schemaNames(file)).toEqual(['tx']);
    const pdf = await renderSlipToPdf(file);
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
  });

  it('값이 있으면 그린다', () => {
    expect(schemaNames(voucher([image({ parameter: 'sign' })], { sign: PNG_1PX }))).toEqual(['img']);
  });
});

describe('바코드 값 검사', () => {
  it('빈 값이면 그리지 않는다', () => {
    expect(schemaNames(voucher([barcode('ean13', { parameter: 'code' })], {}))).toEqual([]);
    expect(schemaNames(voucher([barcode('ean13', { parameter: 'code' })], { code: '' }))).toEqual([]);
    expect(schemaNames(voucher([barcode('qrcode', { formula: '""' })]))).toEqual([]);
  });

  it('EAN-13 — 검사 숫자가 맞는 값은 그리고 틀린 값은 요소 이름을 담은 오류를 낸다', () => {
    expect(schemaNames(voucher([barcode('ean13', { content: '4006381333931' })]))).toEqual(['bc']);
    expect(schemaNames(voucher([barcode('ean13', { content: '400638133393' })]))).toEqual(['bc']);
    const bad = voucher([barcode('ean13', { content: '4006381333932' })]);
    expect(() => convertSlipFile(bad)).toThrow(SlipRenderError);
    expect(() => convertSlipFile(bad)).toThrow(/barcode '코드' \(bc\).*ean13/);
    expect(() => convertSlipFile(voucher([barcode('ean13', { content: 'ABC' })]))).toThrow(SlipRenderError);
  });

  it('QR 용량(499자)을 넘으면 오류다', () => {
    expect(schemaNames(voucher([barcode('qrcode', { content: 'x'.repeat(499) })]))).toEqual(['bc']);
    expect(() => convertSlipFile(voucher([barcode('qrcode', { content: 'x'.repeat(500) })]))).toThrow(SlipRenderError);
  });

  it('오류 메시지는 로케일을 따른다', () => {
    const bad = voucher([barcode('code39', { content: 'abc' })]);
    expect(() => convertSlipFile(bad, { locale: 'ko-KR' })).toThrow("바코드 '코드' (bc)의 값은 code39 바코드로 표현할 수 없습니다");
    expect(() => convertSlipFile(bad, { locale: 'ja' })).toThrow('code39 バーコードとして表現できません');
  });

  it.each<[BarcodeKind, string[], string[]]>([
    ['ean8', ['9638507', '96385074'], ['96385075', '1234']],
    ['upca', ['03600029145', '036000291452'], ['036000291453']],
    ['upce', ['0123456', '01234565'], ['01234566', '1234567']],
    ['itf14', ['1540014128876', '15400141288763'], ['15400141288764']],
    ['code39', ['ABC-123', 'A B.C$/+%'], ['abc', 'A_B']],
    ['code128', ['ABC-123 abc', 'Ⅰ'], ['ａｂｃ', 'あいう', '漢字']],
    ['nw7', ['A1234B', 'c12.5:d'], ['1234', 'A12E']],
    ['japanpost', ['12345678', '1234567-1A'], ['1234567', '123456']],
    ['gs1datamatrix', ['(01)04012345123456', '(01)04012345123456(10)ABC'], ['(01)04012345123457', '04012345123456']],
    ['pdf417', ['hello', 'x'.repeat(1000)], ['x'.repeat(1001)]],
  ])('%s 형식 규칙', (kind, valid, invalid) => {
    for (const value of valid) expect(isValidBarcodeValue(kind, value), `${kind} ${value}`).toBe(true);
    for (const value of invalid) expect(isValidBarcodeValue(kind, value), `${kind} ${value}`).toBe(false);
    expect(isValidBarcodeValue(kind, '')).toBe(false);
  });
});

describe('렌더 단계의 이미지 데이터 검사', () => {
  it('PNG와 JPEG는 통과한다', () => {
    expect(schemaNames(voucher([image({ src: PNG_1PX })]))).toEqual(['img']);
    expect(schemaNames(voucher([image({ src: dataUrl('image/jpeg', JPEG_HEAD) })]))).toEqual(['img']);
  });

  it('선언은 PNG인데 내용이 JPEG면 요소 이름을 담은 SlipRenderError', () => {
    const file = voucher([image({ src: dataUrl('image/png', JPEG_HEAD) })]);
    expect(() => convertSlipFile(file)).toThrow(SlipRenderError);
    expect(() => convertSlipFile(file)).toThrow(/image '서명' \(img\)/);
  });

  it('손상된 PNG는 요소 이름을 담은 SlipRenderError', () => {
    const corrupted = dataUrl('image/png', [0x89, 0x50, 0x00, 0x00]);
    const file = voucher([image({ parameter: 'sign' })], { sign: corrupted });
    expect(() => convertSlipFile(file)).toThrow(/image '서명' \(img\).*damaged/);
    expect(() => convertSlipFile(file, { locale: 'ko-KR' })).toThrow("이미지 '서명' (img)의 이미지가 선언한 PNG·JPEG가 아닙니다");
    expect(() => convertSlipFile(file, { locale: 'ja' })).toThrow("画像 '서명'(img)の画像が宣言された PNG・JPEG ではありません");
  });

  it('GIF·WebP·SVG는 거부한다', () => {
    for (const src of [
      dataUrl('image/gif', GIF_HEAD),
      dataUrl('image/webp', [0x52, 0x49, 0x46, 0x46]),
      'data:image/svg+xml;base64,PHN2Zy8+',
    ]) {
      expect(() => convertSlipFile(voucher([image({ parameter: 'sign' })], { sign: src }))).toThrow(SlipRenderError);
    }
  });

  it('2 MiB를 넘는 이미지는 거부한다', () => {
    const tooBig = dataUrl('image/png', PNG_HEAD, MAX_IMAGE_BYTES + 1);
    const justFits = dataUrl('image/png', PNG_HEAD, MAX_IMAGE_BYTES);
    expect(() => convertSlipFile(voucher([image({ parameter: 'sign' })], { sign: tooBig }))).toThrow(/size limit/);
    expect(schemaNames(voucher([image({ parameter: 'sign' })], { sign: justFits }))).toEqual(['img']);
  });

  it('에셋에 심은 이미지도 같은 검사를 거친다', () => {
    const file = voucher([image({ src: 'asset://logo' })]);
    file.templateSnapshot.assets = [{ id: 'logo', mimeType: 'image/png', src: dataUrl('image/png', GIF_HEAD) }];
    expect(() => convertSlipFile(file)).toThrow(/image '서명' \(img\)/);
  });
});

describe('PDF 생성 실패는 SlipRenderError로 통일한다', () => {
  it('서명은 맞지만 본문이 깨진 PNG는 생성 단계에서 SlipRenderError가 된다', async () => {
    const file = voucher([image({ src: dataUrl('image/png', PNG_HEAD, 64) })]);
    await expect(renderSlipToPdf(file)).rejects.toBeInstanceOf(SlipRenderError);
    await expect(renderSlipToPdf(file)).rejects.toThrow(/PDF generation failed/);
    await expect(renderSlipToPdf(file, { locale: 'ko-KR' })).rejects.toThrow('PDF 생성에 실패했습니다');
    await expect(renderSlipToPdf(file, { locale: 'ja' })).rejects.toThrow('PDF の生成に失敗しました');
  });

  it('변환 단계의 SlipRenderError는 그대로 전달한다', async () => {
    const file = voucher([barcode('ean13', { content: 'oops' })]);
    await expect(renderSlipToPdf(file)).rejects.toThrow(/barcode '코드'/);
  });
});

describe('표시 문자열 길이 상한', () => {
  const max = SLIP_LIMITS.maxTextLength;

  it('상한까지는 렌더하고 넘으면 요소 이름을 담은 SlipRenderError', () => {
    expect(schemaNames(voucher([text('a'.repeat(max))]))).toEqual(['tx']);
    const field: SlipElement = { type: 'field', id: 'f', name: '값', position: { x: 10, y: 10 }, width: 50, height: 10, parameter: 'memo' };
    expect(() => convertSlipFile(voucher([field], { memo: 'a'.repeat(max + 1) }))).toThrow(/field '값' \(f\).*too long/);
    const formulaField: SlipElement = { ...field, parameter: undefined, formula: 'CONCAT($(memo), $(memo))' } as SlipElement;
    delete (formulaField as { parameter?: string }).parameter;
    expect(() => convertSlipFile(voucher([formulaField], { memo: 'a'.repeat(max) }))).toThrow(SlipRenderError);
    expect(() => convertSlipFile(voucher([barcode('qrcode', { parameter: 'code' })], { code: 'a'.repeat(max + 1) }))).toThrow(/too long/);
  });

  it('20,000자 텍스트 요소는 몇 초 안에 PDF가 된다', async () => {
    const started = performance.now();
    const pdf = await renderSlipToPdf(voucher([text('lorem ipsum '.repeat(max / 12), { width: 190, height: 270 })]));
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
    expect(performance.now() - started).toBeLessThan(10_000);
  }, 20_000);
});

describe('글리프 검사', () => {
  it('선택된 폰트에 없는 문자는 요소 이름·id·문제 문자를 담은 SlipRenderError', async () => {
    const fonts = await defaultFonts();
    const file = voucher([text('Amount 금액')]);
    await expect(renderSlipToPdf(file, { getFonts: () => fonts })).rejects.toBeInstanceOf(SlipRenderError);
    await expect(renderSlipToPdf(file, { getFonts: () => fonts })).rejects.toThrow(/text '글' \(tx\).*'금' \(U\+AE08\)/);
    await expect(renderSlipToPdf(file, { getFonts: () => fonts, locale: 'ko-KR' })).rejects.toThrow("'금'(U+AE08) 글리프가 없습니다");
    await expect(renderSlipToPdf(file, { getFonts: () => fonts, locale: 'ja' })).rejects.toThrow('グリフがありません');
  });

  it('그리드 셀·필드·페이지 번호도 검사한다', async () => {
    const fonts = await defaultFonts();
    const grid: SlipElement = {
      type: 'grid', id: 'g', name: '표', position: { x: 10, y: 10 },
      rows: [{ height: 10 }], columns: [{ width: 50 }], cells: [{ row: 0, column: 0, parameter: 'v' }],
    };
    await expect(renderSlipToPdf(voucher([grid], { v: '한글' }), { getFonts: () => fonts })).rejects.toThrow(/grid '표' \(g\)/);
    const numbered = voucher([text('ok')]);
    numbered.templateSnapshot.pages[0]!.pageNumber = { position: 'bottom-center', format: '{n} 페이지' };
    await expect(renderSlipToPdf(numbered, { getFonts: () => fonts })).rejects.toThrow(/page number of output page 1/);
  });

  it('개행·탭·제로폭 문자와 변형 선택자는 검사하지 않고, 등록 폰트가 없으면 검사를 건너뛴다', async () => {
    const fonts = await defaultFonts();
    // U+FE0F·U+E0100(변형 선택자)은 폰트에 글리프가 없어도 표시에 영향이 없으므로 오류가 아니다.
    const file = voucher([text('line 1\nline\t2​﻿⁠ A️ B\u{e0100}')]);
    const pdf = await renderSlipToPdf(file, { getFonts: () => fonts });
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
    // 등록 폰트가 없으면 엔진 기본 폰트를 쓰므로 검사할 수 없다 — 오류 없이 렌더한다.
    expect(schemaNames(voucher([text('금액')]))).toEqual(['tx']);
  });
});

describe('clip 줄 계산은 렌더링 엔진의 줄바꿈과 같다', () => {
  const style = (characterSpacing: number, fontName?: string) => ({ fontName, fontSize: 10, characterSpacing });

  /** 렌더링 엔진 내부의 줄바꿈 함수를 이름으로 찾는다 — 공개 API가 아니라 청크 파일에서 읽는다. */
  async function engineSplitter(): Promise<{
    splitTextToSize: (arg: { value: string; characterSpacing: number; fontSize: number; fontKitFont: unknown; boxWidthInPt: number }) => string[];
    getFontKitFont: (fontName: string | undefined, font: Record<string, { data: Uint8Array; fallback?: boolean }>, cache: Map<string, unknown>) => Promise<unknown>;
  }> {
    const require = createRequire(import.meta.url);
    const dist = dirname(require.resolve('@pdfme/schemas'));
    const chunk = readdirSync(dist).find((name) => /^splitRange-.*\.js$/.test(name));
    if (chunk === undefined) throw new Error('렌더링 엔진의 줄바꿈 청크를 찾지 못했다');
    const mod = (await import(pathToFileURL(join(dist, chunk)).href)) as Record<string, unknown>;
    const byName = (name: string) => Object.values(mod).find((v) => typeof v === 'function' && v.name === name);
    return { splitTextToSize: byName('splitTextToSize') as never, getFontKitFont: byName('getFontKitFont') as never };
  }

  const SAMPLES = [
    'The quick brown fox jumps over the lazy dog near the river bank at dawn',
    '한국어 문장은 띄어쓰기 단위로 나뉘고 긴단어는글자단위로나뉜다 English mixed 문장',
    '日本語の文章では、句読点や「かぎ括弧」の禁則処理が行われます。テスト（テスト）です。',
    '混合 mixed テキスト text 텍스트 with punctuation, brackets (like this) and 「日本語」!',
    'ひらがなだけのながいぶんしょうをいれてみてぎょうまつきんそくのてすとをおこないます「',
  ];

  it.each([0, 0.5, 1, 2])('자간 %spt에서 줄 수와 줄 내용이 같다', async (spacing) => {
    const fonts = await defaultFonts();
    const engine = await engineSplitter();
    const fontKitFont = await engine.getFontKitFont(undefined, { [fonts[0]!.name]: { data: fonts[0]!.data, fallback: true } }, new Map());
    const measurer = new TextMeasurer(fonts);
    for (const widthMm of [20, 40, 80]) {
      for (const sample of SAMPLES) {
        const expected = engine
          .splitTextToSize({ value: sample, characterSpacing: spacing, fontSize: 10, fontKitFont, boxWidthInPt: widthMm / (25.4 / 72) })
          .map((line) => line.replace(/\n$/, ''));
        const actual = measurer.splitLines(sample, widthMm, style(spacing));
        expect(actual, `${widthMm}mm / ${spacing}pt / ${sample.slice(0, 12)}`).toEqual(expected);
      }
    }
  });

  it('자간이 커지면 줄 수가 늘어난다', async () => {
    const measurer = new TextMeasurer(await defaultFonts());
    const lines0 = measurer.splitLines(SAMPLES[0]!, 40, style(0))!;
    const lines1 = measurer.splitLines(SAMPLES[0]!, 40, style(3))!;
    expect(lines1.length).toBeGreaterThan(lines0.length);
  });

  it('일본어 행두 금칙 문자는 앞 줄 끝으로 옮긴다', async () => {
    const measurer = new TextMeasurer(await defaultFonts());
    const lines = measurer.splitLines(SAMPLES[2]!, 40, style(0))!;
    for (const line of lines.slice(1)) expect(line).not.toMatch(/^[、。」）]/);
  });
});
