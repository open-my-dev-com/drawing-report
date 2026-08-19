/**
 * .slip 파일 포맷 상세 스키마 (Zod-first — 여기서 정의한 스키마가 진실의 원천).
 *
 * 근거 ADR: 007(JSON 자체 스키마·마이그레이션) · 008(양식 스냅샷) · 011(용지 좌표계) ·
 * 014(이미지 하이브리드) · 019(해시·서명) · 020(요소 6종) · 022(JSON Schema 동봉).
 * 규범 명세는 docs/SPEC.md — 이 파일과 SPEC.md가 어긋나면 SPEC.md를 기준으로 고친다.
 */
import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { migrateSlipDocument } from './migrate.js';

export { CURRENT_SCHEMA_VERSION };

// ---------------------------------------------------------------------------
// 공통 원자 타입
// ---------------------------------------------------------------------------

/** 길이 단위는 항상 mm (용지 좌표계, ADR-011) */
const millimeter = z.number().finite();
const nonNegativeMm = millimeter.nonnegative();
const positiveMm = millimeter.positive();

const idSchema = z.string().min(1);

/** 색상은 #RRGGBB 또는 #RRGGBBAA */
const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, '색상은 #RRGGBB 또는 #RRGGBBAA 형식이어야 합니다');

const alignmentSchema = z.enum(['left', 'center', 'right']);

const HTTP_SRC = /^https?:\/\/\S+$/;
const DATA_SRC = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/;
const ASSET_SRC = /^asset:\/\/\S+$/;

/** 이미지 참조 3종 (ADR-007): 외부 URL / data: base64 내장 / asset:// 내부 리소스 */
const srcSchema = z
  .string()
  .refine((s) => HTTP_SRC.test(s) || DATA_SRC.test(s) || ASSET_SRC.test(s), {
    message: 'src는 http(s) URL, data:<mime>;base64 또는 asset:// 형식이어야 합니다',
  });

const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'schemaVersion은 semver 형식이어야 합니다');

/** 합이 100이어야 하는 비율 배열 (열 너비 등) — 허용 오차 ±0.01 (SPEC §3, 경계 포함) */
const percentagesSchema = z
  .array(z.number().positive())
  .min(1)
  .refine((arr) => Math.abs(arr.reduce((a, b) => a + b, 0) - 100) <= 0.01, {
    message: '비율의 합은 100이어야 합니다',
  });

// ---------------------------------------------------------------------------
// 스타일 · 요소 공통부 (ADR-020: 전 요소 색 스타일)
// ---------------------------------------------------------------------------

const colorStyleShape = {
  backgroundColor: colorSchema.optional(),
  fontColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  borderWidth: nonNegativeMm.optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
};

const elementBaseShape = {
  id: idSchema,
  name: z.string(),
  position: z.object({ x: nonNegativeMm, y: nonNegativeMm }),
  width: nonNegativeMm,
  height: nonNegativeMm,
};

const fontShape = {
  fontName: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  alignment: alignmentSchema.optional(),
};

// ---------------------------------------------------------------------------
// 요소 6종 (ADR-020)
// ---------------------------------------------------------------------------

export const textElementSchema = z.object({
  type: z.literal('text'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 고정 문구 또는 수식/플레이스홀더 포함 문자열 */
  content: z.string(),
  ...fontShape,
});

export const fixedGridCellSchema = z.object({
  ...colorStyleShape,
  /** 0-기반 행/열 좌표 */
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  /** 병합 범위 (기본 1) — ADR-020: 고정 그리드 표만 병합 지원 */
  rowSpan: z.number().int().min(1).optional(),
  colSpan: z.number().int().min(1).optional(),
  content: z.string(),
  ...fontShape,
});

/** 행 수가 고정된 그리드 틀 (공급자 정보란 등). 셀 병합 지원 — ADR-020 */
export const fixedGridElementSchema = z
  .object({
    type: z.literal('fixedGrid'),
    ...elementBaseShape,
    ...colorStyleShape,
    rows: z.number().int().min(1),
    columns: z.number().int().min(1),
    /** 열 너비 비율(%) — 길이 = columns, 합 100 */
    columnWidthPercentages: percentagesSchema,
    /** 행 높이 비율(%) — 생략 시 균등. 지정 시 길이 = rows, 합 100 */
    rowHeightPercentages: percentagesSchema.optional(),
    cells: z.array(fixedGridCellSchema),
  })
  .superRefine((grid, ctx) => {
    if (grid.columnWidthPercentages.length !== grid.columns) {
      ctx.addIssue({
        code: 'custom',
        path: ['columnWidthPercentages'],
        message: `columnWidthPercentages 길이(${grid.columnWidthPercentages.length})는 columns(${grid.columns})와 같아야 합니다`,
      });
    }
    if (grid.rowHeightPercentages && grid.rowHeightPercentages.length !== grid.rows) {
      ctx.addIssue({
        code: 'custom',
        path: ['rowHeightPercentages'],
        message: `rowHeightPercentages 길이(${grid.rowHeightPercentages.length})는 rows(${grid.rows})와 같아야 합니다`,
      });
    }
    // 셀 범위·겹침 검사 (병합 포함)
    const occupied = new Set<string>();
    grid.cells.forEach((cell, index) => {
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      if (cell.row + rowSpan > grid.rows || cell.column + colSpan > grid.columns) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: `셀(${cell.row},${cell.column})의 병합 범위가 그리드(${grid.rows}×${grid.columns})를 벗어납니다`,
        });
        return;
      }
      for (let r = cell.row; r < cell.row + rowSpan; r++) {
        for (let c = cell.column; c < cell.column + colSpan; c++) {
          const key = `${r},${c}`;
          if (occupied.has(key)) {
            ctx.addIssue({
              code: 'custom',
              path: ['cells', index],
              message: `셀(${r},${c})이 다른 셀과 겹칩니다`,
            });
            return;
          }
          occupied.add(key);
        }
      }
    });
  });

/** 데이터 행 수에 따라 늘어나는 표. 자동 페이지 분할 대상 (ADR-011) */
export const dynamicTableElementSchema = z
  .object({
    type: z.literal('dynamicTable'),
    ...elementBaseShape,
    ...colorStyleShape,
    head: z.array(z.string()).min(1),
    headWidthPercentages: percentagesSchema,
    /** 페이지 분할 시 머리행 반복 (ADR-011) */
    repeatHead: z.boolean(),
    /** 바인딩할 데이터 키 (전표 values의 배열 필드) */
    binding: idSchema,
  })
  .superRefine((table, ctx) => {
    if (table.headWidthPercentages.length !== table.head.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['headWidthPercentages'],
        message: `headWidthPercentages 길이(${table.headWidthPercentages.length})는 head 길이(${table.head.length})와 같아야 합니다`,
      });
    }
  });

export const imageElementSchema = z.object({
  type: z.literal('image'),
  ...elementBaseShape,
  src: srcSchema,
});

export const shapeElementSchema = z.object({
  type: z.literal('shape'),
  ...elementBaseShape,
  ...colorStyleShape,
  shape: z.enum(['line', 'rect']),
});

/** 전표 작성 시 값이 채워지는 입력 필드 */
export const fieldElementSchema = z.object({
  type: z.literal('field'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 전표 values의 키 */
  binding: idSchema,
  /** 표시 전 가공용 수식 (ADR-010/017), 예: FORMAT_NUMBER(...) */
  formula: z.string().optional(),
  ...fontShape,
});

export const slipElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  fixedGridElementSchema,
  dynamicTableElementSchema,
  imageElementSchema,
  shapeElementSchema,
  fieldElementSchema,
]);

// ---------------------------------------------------------------------------
// 용지 · 페이지 · 에셋
// ---------------------------------------------------------------------------

export const paperSchema = z
  .object({
    width: positiveMm,
    height: positiveMm,
    /** [top, right, bottom, left] */
    padding: z.tuple([nonNegativeMm, nonNegativeMm, nonNegativeMm, nonNegativeMm]),
  })
  .superRefine((paper, ctx) => {
    const [top, right, bottom, left] = paper.padding;
    if (left + right >= paper.width || top + bottom >= paper.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['padding'],
        message: '여백의 합이 용지 크기보다 작아야 합니다',
      });
    }
  });

export const assetEntrySchema = z.object({
  id: idSchema,
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'mimeType 형식이 아닙니다'),
  src: srcSchema,
});

export const slipPageSchema = z.object({
  elements: z.array(slipElementSchema),
});

// ---------------------------------------------------------------------------
// 양식(템플릿) 본문
// ---------------------------------------------------------------------------

export const templateMetaSchema = z.object({
  title: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});

export const slipTemplateBodySchema = z
  .object({
    meta: templateMetaSchema,
    paper: paperSchema,
    pages: z.array(slipPageSchema).min(1),
    assets: z.array(assetEntrySchema),
  })
  .superRefine((body, ctx) => {
    // 에셋 id 유일성
    const assetIds = new Set<string>();
    body.assets.forEach((asset, index) => {
      if (assetIds.has(asset.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets', index, 'id'],
          message: `에셋 id가 중복됩니다: ${asset.id}`,
        });
      }
      assetIds.add(asset.id);
    });
    // asset:// 참조 해소는 에셋 항목 자신의 src에도 적용된다 (SPEC §3.1)
    body.assets.forEach((asset, index) => {
      if (asset.src.startsWith('asset://')) {
        const referencedId = asset.src.slice('asset://'.length);
        if (!assetIds.has(referencedId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'src'],
            message: `참조하는 에셋이 없습니다: ${referencedId}`,
          });
        }
      }
    });
    // 요소 id 유일성(문서 전체) + asset:// 참조 해소 가능성
    const elementIds = new Set<string>();
    body.pages.forEach((page, pageIndex) => {
      page.elements.forEach((element, elementIndex) => {
        if (elementIds.has(element.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['pages', pageIndex, 'elements', elementIndex, 'id'],
            message: `요소 id가 중복됩니다: ${element.id}`,
          });
        }
        elementIds.add(element.id);
        if (element.type === 'image' && element.src.startsWith('asset://')) {
          const assetId = element.src.slice('asset://'.length);
          if (!assetIds.has(assetId)) {
            ctx.addIssue({
              code: 'custom',
              path: ['pages', pageIndex, 'elements', elementIndex, 'src'],
              message: `참조하는 에셋이 없습니다: ${assetId}`,
            });
          }
        }
      });
    });
  });

// ---------------------------------------------------------------------------
// 무결성 (ADR-019)
// ---------------------------------------------------------------------------

export const integritySchema = z.object({
  /** RFC 8785 정규화 바이트의 SHA-256 (소문자 hex 64자) — docs/SPEC.md §8 */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'contentHash는 SHA-256 소문자 hex여야 합니다'),
  /** JWS(ES256) compact serialization — 호스트 키 제공 시 */
  signature: z
    .string()
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/, 'signature는 JWS compact 형식이어야 합니다')
    .optional(),
});

// ---------------------------------------------------------------------------
// 파일 (봉투 + kind별 본문)
// ---------------------------------------------------------------------------

export const slipEnvelopeSchema = z.object({
  schemaVersion: semverSchema,
  kind: z.enum(['template', 'voucher']),
});

/** JSON으로 표현 가능한 값 (전표 values) */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const slipTemplateFileSchema = z.object({
  schemaVersion: semverSchema,
  kind: z.literal('template'),
  template: slipTemplateBodySchema,
});

/** 스냅샷 안에서 외부 URL 참조를 찾는다 (발행 파일 완결성 검사용, ADR-014) */
function findExternalUrlPath(body: z.infer<typeof slipTemplateBodySchema>): (string | number)[] | null {
  for (const [a, asset] of body.assets.entries()) {
    if (HTTP_SRC.test(asset.src)) return ['assets', a, 'src'];
  }
  for (const [p, page] of body.pages.entries()) {
    for (const [e, element] of page.elements.entries()) {
      if (element.type === 'image' && HTTP_SRC.test(element.src)) {
        return ['pages', p, 'elements', e, 'src'];
      }
    }
  }
  return null;
}

export const slipVoucherFileSchema = z
  .object({
    schemaVersion: semverSchema,
    kind: z.literal('voucher'),
    /** 생성 시점 양식 전체 스냅샷 (ADR-008) */
    templateSnapshot: slipTemplateBodySchema,
    /** 필드 바인딩 키 → 값 */
    values: z.record(z.string(), jsonValueSchema),
    /** 발행(확정) 여부. 발행 시 이미지 내장(ADR-014)·무결성 기록(ADR-019) */
    issued: z.boolean(),
    integrity: integritySchema.optional(),
  })
  .superRefine((voucher, ctx) => {
    if (!voucher.issued) return;
    // ADR-019: 발행 파일은 SHA-256 해시 필수
    if (!voucher.integrity) {
      ctx.addIssue({
        code: 'custom',
        path: ['integrity'],
        message: '발행(issued)된 전표는 integrity.contentHash가 필수입니다',
      });
    }
    // ADR-014: 발행 파일은 외부 URL 의존 없이 단독 완결이어야 한다
    const externalPath = findExternalUrlPath(voucher.templateSnapshot);
    if (externalPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['templateSnapshot', ...externalPath],
        message: '발행(issued)된 전표는 외부 URL 이미지를 포함할 수 없습니다 (base64 내장 필요)',
      });
    }
  });

export const slipFileSchema = z.discriminatedUnion('kind', [
  slipTemplateFileSchema,
  slipVoucherFileSchema,
]);

// ---------------------------------------------------------------------------
// 파싱 · 직렬화
// ---------------------------------------------------------------------------

export class SlipParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipParseError';
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join(', ');
}

/**
 * 이미 파싱된 JSON 값을 .slip 파일로 검증한다.
 * 구버전 문서는 현재 버전으로 마이그레이션한 뒤 검증한다 (ADR-007).
 */
export function validateSlipFile(raw: unknown): SlipFile {
  const envelope = slipEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new SlipParseError(`.slip 봉투 검증 실패: ${formatIssues(envelope.error)}`);
  }
  let migrated: Record<string, unknown>;
  try {
    migrated = migrateSlipDocument(raw as Record<string, unknown>);
  } catch (error) {
    throw new SlipParseError(error instanceof Error ? error.message : String(error));
  }
  const result = slipFileSchema.safeParse(migrated);
  if (!result.success) {
    throw new SlipParseError(`.slip 본문 검증 실패: ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * JSON 문자열을 .slip 파일로 파싱한다.
 * 봉투/본문 검증 실패 시 SlipParseError를 던진다.
 */
export function parseSlipFile(json: string): SlipFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SlipParseError('유효한 JSON이 아닙니다');
  }
  return validateSlipFile(raw);
}

export function serializeSlipFile(file: SlipFile): string {
  return JSON.stringify(file, null, 2);
}

// ---------------------------------------------------------------------------
// 추론 타입 (Zod 스키마에서 산출 — 타입과 검증이 어긋날 수 없다)
// ---------------------------------------------------------------------------

export type PaperSize = z.infer<typeof paperSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type FixedGridCell = z.infer<typeof fixedGridCellSchema>;
export type FixedGridElement = z.infer<typeof fixedGridElementSchema>;
export type DynamicTableElement = z.infer<typeof dynamicTableElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type FieldElement = z.infer<typeof fieldElementSchema>;
export type SlipElement = z.infer<typeof slipElementSchema>;
export type SlipPage = z.infer<typeof slipPageSchema>;
export type SlipTemplateBody = z.infer<typeof slipTemplateBodySchema>;
export type Integrity = z.infer<typeof integritySchema>;
export type SlipTemplateFile = z.infer<typeof slipTemplateFileSchema>;
export type SlipVoucherFile = z.infer<typeof slipVoucherFileSchema>;
export type SlipFile = z.infer<typeof slipFileSchema>;
export type SlipFileKind = SlipFile['kind'];
