import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as imageSource from '../src/format/image-source.js';
import { convertSlipFile } from '../src/render/convert.js';
import { CURRENT_SCHEMA_VERSION, SlipRenderError, type SlipElement, type SlipVoucherFile } from '../src/index.js';

// 구조 검사(전체 디코딩) 호출 횟수를 세기 위해 원본 구현을 감싼다.
vi.mock('../src/format/image-source.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/format/image-source.js')>();
  return {
    ...actual,
    inspectImageDataUrl: vi.fn(actual.inspectImageDataUrl),
    isEmbeddableImageData: vi.fn(actual.isEmbeddableImageData),
  };
});

const inspectSpy = vi.mocked(imageSource.inspectImageDataUrl);
const embeddableSpy = vi.mocked(imageSource.isEmbeddableImageData);

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** SOI·APP0·SOF0·EOI만 담은 1x1 JPEG */
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/wAALCAABAAEBAREA/9k=';

/** 앞부분 바이트만 채운 `data:` 문자열 (서명은 맞지만 구조가 없는 손상 이미지) */
function dataUrl(mime: string, head: number[], size = head.length + 16): string {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** 항목 하나마다 출력 페이지를 하나씩 만드는 반복 그리드 */
const repeatGrid: SlipElement = {
  type: 'grid',
  id: 'items',
  name: '품목',
  position: { x: 10, y: 40 },
  columns: [{ width: 100 }],
  rows: [{ height: 8 }],
  repeat: {
    parameter: 'items',
    bands: [{ id: 'row', fromRow: 0, toRow: 0, placement: 'item' }],
    pagination: { mode: 'fixed', itemsPerPage: 1 },
  },
  cells: [{ row: 0, column: 0, parameter: 'name' }],
} as SlipElement;

function image(id: string, extra: Partial<Extract<SlipElement, { type: 'image' }>>): SlipElement {
  return { type: 'image', id, name: `이미지 ${id}`, position: { x: 10, y: 10 }, width: 20, height: 10, ...extra } as SlipElement;
}

function voucher(elements: SlipElement[], values: Record<string, unknown>, assets: { id: string; mimeType: string; src: string }[] = []): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: {
      meta: { title: '이미지 검사 캐시' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{ elements: [repeatGrid, ...elements] }],
      assets: assets as SlipVoucherFile['templateSnapshot']['assets'],
    },
    values: values as SlipVoucherFile['values'],
    issued: false,
  };
}

const threeItems = { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };

beforeEach(() => {
  inspectSpy.mockClear();
  embeddableSpy.mockClear();
});

describe('한 PDF 변환 안에서 같은 이미지는 한 번만 검사한다', () => {
  it('세 출력 페이지에 놓이는 고정 이미지의 구조 검사는 한 번이다', () => {
    const { template } = convertSlipFile(voucher([image('logo', { src: PNG_1PX })], threeItems));
    expect(template.schemas).toHaveLength(3);
    // 페이지마다 이미지가 그려진다 (이름은 문서 전체에서 고유하게 `logo`, `logo#2`, …로 붙는다).
    expect(template.schemas.map((page) => page.filter((schema) => schema.name.startsWith('logo')).length)).toEqual([1, 1, 1]);
    expect(inspectSpy).toHaveBeenCalledTimes(1);
    expect(embeddableSpy).toHaveBeenCalledTimes(1);
  });

  it('에셋·변동 이미지·직접 src가 같은 데이터면 입력별 한 번씩만 검사한다', () => {
    const file = voucher(
      [
        image('logo', { src: 'asset://logo' }),
        image('sign', { parameter: 'sign' }),
        image('stamp', { src: JPEG_1PX }),
        image('logo2', { src: PNG_1PX }),
      ],
      { ...threeItems, sign: JPEG_1PX },
      [{ id: 'logo', mimeType: 'image/png', src: PNG_1PX }],
    );
    const { template } = convertSlipFile(file);
    expect(template.schemas).toHaveLength(3);
    // 서로 다른 데이터는 PNG·JPEG 두 벌이므로 검사도 두 번이다.
    expect(embeddableSpy).toHaveBeenCalledTimes(2);
    expect(embeddableSpy.mock.calls.map(([src]) => src).sort()).toEqual([JPEG_1PX, PNG_1PX].sort());
  });

  it('변환기마다 캐시가 따로여서 다음 변환은 다시 검사한다', () => {
    convertSlipFile(voucher([image('logo', { src: PNG_1PX })], threeItems));
    convertSlipFile(voucher([image('logo', { src: PNG_1PX })], threeItems));
    expect(embeddableSpy).toHaveBeenCalledTimes(2);
  });
});

describe('검사 결과를 재사용해도 오류 문구는 그대로다', () => {
  it('손상된 PNG는 요소 이름을 담은 damaged 오류를 낸다', () => {
    const corrupted = dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = voucher([image('sign', { parameter: 'sign' })], { ...threeItems, sign: corrupted });
    expect(() => convertSlipFile(file)).toThrow(SlipRenderError);
    expect(() => convertSlipFile(file)).toThrow(/image '이미지 sign' \(sign\).*damaged/);
    expect(() => convertSlipFile(file, { locale: 'ko-KR' })).toThrow(
      "이미지 '이미지 sign' (sign)의 이미지가 손상되어 PDF에 넣을 수 없습니다",
    );
  });

  it('서명이 어긋난 JPEG는 content 오류, 다른 형식은 mime 오류를 낸다', () => {
    const disguised = dataUrl('image/jpeg', [0x89, 0x50, 0x4e, 0x47]);
    expect(() => convertSlipFile(voucher([image('a', { src: disguised })], threeItems))).toThrow(
      "The image of image '이미지 a' (a) is not the declared PNG or JPEG",
    );
    const gif = dataUrl('image/gif', [0x47, 0x49, 0x46, 0x38]);
    expect(() => convertSlipFile(voucher([image('b', { src: gif })], threeItems))).toThrow(
      "The image of image '이미지 b' (b) is not PNG or JPEG",
    );
  });

  it('같은 손상 이미지를 두 요소가 쓰면 각자의 이름으로 오류가 나고 검사는 한 번이다', () => {
    const corrupted = dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const first = voucher([image('first', { src: corrupted }), image('second', { src: corrupted })], threeItems);
    expect(() => convertSlipFile(first)).toThrow(/\(first\)/);
    expect(embeddableSpy).toHaveBeenCalledTimes(1);
    const second = voucher([image('second', { src: corrupted }), image('first', { src: corrupted })], threeItems);
    expect(() => convertSlipFile(second)).toThrow(/\(second\)/);
  });
});
