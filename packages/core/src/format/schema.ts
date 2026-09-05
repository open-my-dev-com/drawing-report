/**
 * `.slip` 파일 형식을 검증하는 Zod 스키마.
 *
 * 형식 규범은 `docs/SPEC.md`를 따르며, TypeScript 타입과 JSON Schema는 이 스키마에서 생성한다.
 */
import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { migrateSlipDocument } from './migrate.js';
import { fmt, withFormatLocale, zodParseParams } from './messages.js';
import { MAX_IMAGE_BYTES, inspectImageDataUrl, type ImageInspection } from './image-source.js';
import { readOwn, writeOwn } from '../own-property.js';
import { assertFormulaArity } from '../formula/arity.js';
import { parseFormula } from '../formula/parser.js';

export { CURRENT_SCHEMA_VERSION };

// ---------------------------------------------------------------------------
// 공통 원자 타입
// ---------------------------------------------------------------------------

/**
 * 렌더러와 검증기의 메모리 사용량을 제한하는 구조 크기 상한 (SPEC §3.2).
 * 상한을 초과하면 파일 검증에 실패한다.
 */
export const SLIP_LIMITS = {
  /** 문서당 최대 페이지 수 */
  maxPages: 500,
  /** 페이지당 최대 요소 수 */
  maxElementsPerPage: 2000,
  /** 문서당 최대 에셋 수 */
  maxAssets: 1000,
  /** 그리드 최대 셀 수 */
  maxGridCells: 100_000,
  /** 파라미터 정의부 최대 항목 수 */
  maxParameters: 500,
  /** 그리드(grid) 최대 행 수 */
  maxGridRowTracks: 1000,
  /** 그리드(grid) 최대 열 수 */
  maxGridColumnTracks: 100,
  /** 고정 페이지 방식의 페이지당 최대 항목 수 (`itemsPerPage`의 상한) */
  maxRepeatPerPage: 1000,
  /** 반복 그리드가 그릴 수 있는 항목 수 상한 (`maxItems`·`minItems`의 상한) */
  maxRepeatItems: 100_000,
  /** 그리드당 최대 행 구간 수 */
  maxGridBands: 20,
  /** 한 양식 페이지에서 만들 수 있는 출력 페이지 수 상한 (페이지 계획에서 검사) */
  maxOutputPages: 2000,
  /** 요소·셀당 최대 조건부 서식 규칙 수 */
  maxConditionalFormats: 20,
  /** 줄간격 배수 상한 */
  maxLineHeight: 10,
  /** 자간 절대값 상한(pt) */
  maxCharacterSpacing: 100,
  /** 위치·크기·용지·트랙·테두리 두께·여백 등 mm 값의 상한 (그리드 트랙 합 포함) */
  maxMillimeters: 5000,
  /** 글자 크기 상한(pt) */
  maxFontSize: 500,
  /** 이름·직접 입력·수식·라벨 등 구조 문자열과 렌더할 표시 문자열의 최대 길이 */
  maxTextLength: 20_000,
  /** `values`·`sampleValues` 문자열의 최대 길이 — 2 MiB 이미지의 `data:` 표기가 들어가야 한다 */
  maxValueStringLength: 3_000_000,
  /** 이미지 한 장의 디코딩 크기 상한(바이트) */
  maxImageBytes: MAX_IMAGE_BYTES,
} as const;

/** 용지 좌표계에서 사용하는 mm 단위의 유한한 수. */
const millimeter = z
  .number()
  .finite()
  .max(SLIP_LIMITS.maxMillimeters, { error: () => fmt().millimetersMax(SLIP_LIMITS.maxMillimeters) });
const nonNegativeMm = millimeter.nonnegative();
const positiveMm = millimeter.positive();

/** 이름·직접 입력·수식 등 구조에 들어가는 문자열. */
const shortText = z
  .string()
  .max(SLIP_LIMITS.maxTextLength, { error: () => fmt().textMax(SLIP_LIMITS.maxTextLength) });

const idSchema = shortText.min(1);

/** 색상은 #RRGGBB 또는 #RRGGBBAA */
const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, { error: () => fmt().colorFormat() });

const alignmentSchema = z.enum(['left', 'center', 'right']);

/** 글자 크기(pt) */
const fontSizeSchema = z
  .number()
  .positive()
  .max(SLIP_LIMITS.maxFontSize, { error: () => fmt().fontSizeMax(SLIP_LIMITS.maxFontSize) });

const HTTP_SRC = /^https?:\/\/\S+$/;
/** PDF에 심을 수 있는 PNG·JPEG의 `data:` base64 표기 */
const DATA_SRC = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const ASSET_SRC = /^asset:\/\/\S+$/;
/** 세 형식을 하나로 합친 패턴 — JSON Schema에 `pattern`으로 그대로 나온다 */
const SRC_PATTERN = /^(?:https?:\/\/\S+|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*|asset:\/\/\S+)$/;

/** 이미지 참조 문자열에 허용하는 URL, `data:` base64(PNG·JPEG), `asset://` 형식. */
const srcSchema = z
  .string()
  .max(SLIP_LIMITS.maxValueStringLength, { error: () => fmt().valueStringMax(SLIP_LIMITS.maxValueStringLength) })
  .regex(SRC_PATTERN, { error: () => fmt().srcFormat() });

/** 검사 실패 사유를 사용자 문구로 바꾼다. */
function imageInspectionMessage(inspection: Exclude<ImageInspection, { ok: true }>): string {
  switch (inspection.reason) {
    case 'size':
      return fmt().imageTooLarge(SLIP_LIMITS.maxImageBytes);
    case 'content':
      return fmt().imageContentMismatch();
    default:
      return fmt().imageMimeUnsupported();
  }
}

/** `data:` 이미지의 선언 MIME·서명·크기를 검사해 문제가 있으면 이슈를 추가한다. */
function checkDataImage(src: string, ctx: z.RefinementCtx, path: (string | number)[]): ImageInspection | undefined {
  if (!src.startsWith('data:')) return undefined;
  const inspection = inspectImageDataUrl(src);
  if (!inspection.ok) ctx.addIssue({ code: 'custom', path, message: imageInspectionMessage(inspection) });
  return inspection;
}

const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, { error: () => fmt().semverFormat() });

/** 합계가 100이어야 하는 비율 배열. ±0.01의 오차를 허용한다 (SPEC §3). */
const percentagesSchema = z
  .array(z.number().positive())
  .min(1)
  .refine((arr) => Math.abs(arr.reduce((a, b) => a + b, 0) - 100) <= 0.01, {
    error: () => fmt().percentagesSum(),
  });

// ---------------------------------------------------------------------------
// 요소 공통 스타일
// ---------------------------------------------------------------------------

const colorStyleShape = {
  backgroundColor: colorSchema.optional(),
  fontColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  borderWidth: nonNegativeMm.optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
};

/**
 * 값에 따라 색과 글자 강조를 바꾸는 조건부 서식 규칙.
 * 조건식이 참이면 지정한 색과 강조로 기본 서식을 덮어쓴다 (SPEC §9.4).
 */
const conditionalFormatRuleSchema = z
  .strictObject({
    /** 논리값을 반환하는 조건식. 항목 구간 안에서는 현재 항목의 필드를 참조할 수 있다. */
    condition: idSchema,
    fontColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    borderColor: colorSchema.optional(),
    /** true면 굵게를 적용하고 false면 기본 서식의 굵게를 끈다. 생략하면 기본 서식을 유지한다. */
    bold: z.boolean().optional(),
    /** true면 기울임을 적용하고 false면 기본 서식의 기울임을 끈다. */
    italic: z.boolean().optional(),
    /** true면 밑줄을 적용하고 false면 기본 서식의 밑줄을 끈다. */
    underline: z.boolean().optional(),
    /** true면 취소선을 적용하고 false면 기본 서식의 취소선을 끈다. */
    strikethrough: z.boolean().optional(),
  })
  .superRefine((rule, ctx) => {
    const hasEffect =
      rule.fontColor !== undefined || rule.backgroundColor !== undefined || rule.borderColor !== undefined ||
      rule.bold !== undefined || rule.italic !== undefined ||
      rule.underline !== undefined || rule.strikethrough !== undefined;
    if (!hasEffect) {
      ctx.addIssue({ code: 'custom', path: ['condition'], message: fmt().conditionalFormatEffectRequired() });
    }
  });

/**
 * 조건부 서식 규칙 목록. 조건이 참인 규칙을 선언된 순서대로 합성하며,
 * 같은 속성은 뒤에 선언된 규칙의 값을 사용한다.
 */
const conditionalFormatsSchema = z
  .array(conditionalFormatRuleSchema)
  .max(SLIP_LIMITS.maxConditionalFormats, {
    error: () => fmt().conditionalFormatsMax(SLIP_LIMITS.maxConditionalFormats),
  });

/** 요소·행 구간의 표시 페이지 선택 값. */
const outputPageFilterSchema = z.enum(['all', 'first', 'continuation', 'non-final', 'last']);

/**
 * 출력 페이지에서 요소를 어떻게 배치할지에 대한 설정.
 * `absolute`는 원본 위치 그대로 표시할 페이지만 고르고, `after`는 대상 요소의
 * 마지막 출력 조각 뒤에 이어서 배치한다.
 */
const pagePlacementSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('absolute'),
    /** 표시할 출력 페이지 (기본 all) */
    pages: outputPageFilterSchema.optional(),
  }),
  z.strictObject({
    mode: z.literal('after'),
    /** 같은 양식 페이지에 있는 대상 요소의 id */
    target: idSchema,
    /** 대상 요소와의 세로 간격(mm, 기본 0) */
    gap: nonNegativeMm.optional(),
  }),
]);

const elementBaseShape = {
  id: idSchema,
  name: shortText,
  position: z.strictObject({ x: nonNegativeMm, y: nonNegativeMm }),
  width: nonNegativeMm,
  height: nonNegativeMm,
  /** 같은 값을 가진 요소를 함께 선택하기 위한 그룹 식별자. */
  group: idSchema.optional(),
  /** 출력 페이지 배치 설정. 생략하면 모든 출력 페이지에 같은 위치로 표시한다. */
  pagePlacement: pagePlacementSchema.optional(),
};

/**
 * 그리드 전용 기본 필드. 그리드의 크기는 행·열 정의의 합으로 계산하므로
 * `width`·`height`를 저장하지 않는다.
 */
const gridBaseShape = {
  id: elementBaseShape.id,
  name: elementBaseShape.name,
  position: elementBaseShape.position,
  group: elementBaseShape.group,
  pagePlacement: elementBaseShape.pagePlacement,
};

/** 요소 상자 안에서 텍스트를 배치할 수직 위치. */
const verticalAlignmentSchema = z.enum(['top', 'middle', 'bottom']);

const fontShape = {
  fontName: idSchema.optional(),
  fontSize: fontSizeSchema.optional(),
  alignment: alignmentSchema.optional(),
  /** 수직 정렬 — 생략하면 상단 */
  verticalAlignment: verticalAlignmentSchema.optional(),
  /**
   * 굵은 글꼴 사용 여부. 렌더링할 때 `<이름>-Bold` 폰트를 선택한다.
   * 굵은 폰트가 없으면 PDF에서는 무시된다 (SPEC §5)
   */
  bold: z.boolean().optional(),
  /**
   * 기울임 글꼴 사용 여부. `<이름>-Italic` 폰트가 없으면 적용하지 않는다.
   */
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  /** 줄간격 배수 — 생략하면 1 */
  lineHeight: z.number().positive().max(SLIP_LIMITS.maxLineHeight).optional(),
  /** 자간(pt) — 생략하면 0. 음수는 글자를 좁힌다 */
  characterSpacing: z.number().min(-SLIP_LIMITS.maxCharacterSpacing).max(SLIP_LIMITS.maxCharacterSpacing).optional(),
  /**
   * 세로쓰기 여부. 글자를 한 자씩 세로로 배치한다.
   * 렌더링 엔진이 세로쓰기를 지원하지 않아 변환 계층에서 글자를 한 줄씩 배치한다.
   */
  vertical: z.boolean().optional(),
};

// ---------------------------------------------------------------------------
// 요소 스키마
// ---------------------------------------------------------------------------

const textElementSchema = z.strictObject({
  type: z.literal('text'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 직접 입력한 텍스트. */
  content: shortText,
  ...fontShape,
  /** 값에 따라 색과 글자 강조를 바꾸는 조건부 서식 규칙. */
  conditionalFormats: conditionalFormatsSchema.optional(),
});

// ---------------------------------------------------------------------------
// 고정 영역과 반복 영역을 함께 표현하는 그리드
// ---------------------------------------------------------------------------

/** 셀을 넘치는 텍스트를 자르거나 글자 크기를 줄이는 방식. */
const overflowSchema = z.enum(['clip', 'shrink']);

/** 그리드 열. 너비는 mm 단위의 절대값이다. */
const gridColumnSchema = z.strictObject({
  width: positiveMm,
  /**
   * 자동 병합 여부. 항목 구간에서 이전 항목과 값이 같은 셀을 세로로 병합한다.
   * 항목 구간 밖은 영향받지 않는다. 켜려면 그 열의 항목 구간 셀이 구간 전체 높이를 차지해야 한다.
   */
  autoMerge: z.boolean().optional(),
});

/** 그리드 행. 높이는 mm 단위의 절대값이다. */
const gridRowSchema = z.strictObject({ height: positiveMm });

const gridCellSchema = z.strictObject({
  ...colorStyleShape,
  /** 0-기반 행/열 좌표 */
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  /**
   * 편집기에서 셀을 식별하는 이름. PDF에 출력하지 않으며 값 소스와도 무관하다.
   * 식별 키가 아니므로 중복을 허용한다. 없으면 편집기는 좌표를 표시한다.
   */
  name: shortText.optional(),
  /** 병합 범위 (기본 1) */
  rowSpan: z.number().int().min(1).optional(),
  colSpan: z.number().int().min(1).optional(),
  /** 직접 입력한 글 */
  content: shortText.optional(),
  /** 값 키 — 항목 구간 안이면 그 항목의 필드, 밖이면 전표 values의 키 */
  parameter: idSchema.optional(),
  /** 표시 값을 계산하는 수식. */
  formula: shortText.optional(),
  /** 그리드 기본 overflow 설정을 덮어쓸 셀별 처리 방식. */
  overflow: overflowSchema.optional(),
  ...fontShape,
  /** 값에 따라 색과 글자 강조를 바꾸는 조건부 서식 규칙. */
  conditionalFormats: conditionalFormatsSchema.optional(),
});

/** 행 구간의 출력 시점. 템플릿의 세로 순서도 이 순서를 따라야 한다. */
const bandPlacementSchema = z.enum([
  'before-data',
  'page-start',
  'group-start',
  'item',
  'group-end',
  'after-data',
  'page-end',
]);

/**
 * 같은 출력 시점을 갖는 연속된 템플릿 행 범위.
 * 반복 그리드의 모든 템플릿 행은 정확히 하나의 행 구간에 속한다.
 */
const gridBandSchema = z.strictObject({
  id: idSchema,
  /** 편집기에서 표시할 구간 이름. */
  name: shortText.optional(),
  /** 구간이 차지하는 템플릿 행 범위 (0-기반, 양끝 포함) */
  fromRow: z.number().int().nonnegative(),
  toRow: z.number().int().nonnegative(),
  placement: bandPlacementSchema,
  /**
   * `page-start`·`page-end` 구간의 표시 페이지 선택 (기본 all).
   * 표시 대상이 아닌 페이지에는 구간의 공간도 만들지 않는다.
   */
  pages: outputPageFilterSchema.optional(),
  /** 그룹이 다음 페이지로 이어질 때 `group-start` 구간을 다시 표시할지 (기본 false) */
  repeatOnPageBreak: z.boolean().optional(),
});

/**
 * 페이지 분할 방식. `auto`(자동 확장)와 `fixed`(고정 페이지)는 배타적이며,
 * 각 방식에 속하지 않는 설정이 섞인 파일은 검증에서 거부한다.
 */
const gridPaginationSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('auto'),
    /**
     * 최소 표시 항목 수. 실제 항목이 부족하면 빈 항목으로 채운다.
     * 문서 전체의 최소 항목 수이며 페이지마다 다시 적용하지 않는다.
     */
    minItems: z
      .number()
      .int()
      .min(0)
      .max(SLIP_LIMITS.maxRepeatItems, { error: () => fmt().minItemsMax(SLIP_LIMITS.maxRepeatItems) }),
  }),
  z.strictObject({
    mode: z.literal('fixed'),
    /** 페이지당 항목 수. 각 출력 페이지가 정확히 이 수의 항목 영역을 가진다. */
    itemsPerPage: z
      .number()
      .int()
      .min(1)
      .max(SLIP_LIMITS.maxRepeatPerPage, { error: () => fmt().itemsPerPageMax(SLIP_LIMITS.maxRepeatPerPage) }),
  }),
]);

/** 항목 배열을 행 구간 구성에 따라 반복 출력하는 설정. */
const gridRepeatSchema = z.strictObject({
  /** 전표 values에서 항목 배열(객체 배열)을 담는 키 */
  parameter: idSchema,
  /** 행 구간 목록. 모든 템플릿 행을 겹침·빈틈 없이 포함해야 한다. */
  bands: z
    .array(gridBandSchema)
    .min(1)
    .max(SLIP_LIMITS.maxGridBands, { error: () => fmt().bandsMax(SLIP_LIMITS.maxGridBands) }),
  /** 페이지 분할 방식 */
  pagination: gridPaginationSchema,
  /**
   * 그룹 기준이 되는 항목 하위 필드 이름 목록.
   * 지정한 모든 필드 값이 연속해서 같은 항목을 하나의 그룹으로 본다. 입력 순서는 바꾸지 않는다.
   */
  groupBy: z.array(idSchema).min(1).optional(),
  /**
   * 렌더링할 최대 항목 수. 실제 데이터에 먼저 적용하며, 제한을 적용한 항목만
   * 페이지 계획과 집계에 사용한다. 생략하면 모든 항목을 렌더링한다.
   */
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(SLIP_LIMITS.maxRepeatItems, { error: () => fmt().maxItemsMax(SLIP_LIMITS.maxRepeatItems) })
    .optional(),
});

/** 고정 행과 반복 행 구간으로 구성된 그리드. 크기는 행·열 정의의 합으로 계산한다. */
const gridElementObject = z.strictObject({
  type: z.literal('grid'),
  ...gridBaseShape,
  /**
   * `borderColor`·`borderWidth`·`borderStyle`는 이전 파일 표기다. 셀 기본 테두리의
   * 대체값으로만 읽고, 새로 저장할 때는 `cellBorder*`를 쓴다. 그리드 테두리로 해석하지 않는다.
   */
  ...colorStyleShape,
  ...fontShape,
  /** 셀에 테두리 설정이 없을 때 적용할 기본 테두리색 */
  cellBorderColor: colorSchema.optional(),
  /** 셀에 테두리 설정이 없을 때 적용할 기본 테두리 두께(mm). 0이면 그리지 않는다 */
  cellBorderWidth: nonNegativeMm.optional(),
  /** 셀에 테두리 설정이 없을 때 적용할 기본 테두리 형태 */
  cellBorderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  /** 그리드 전체를 감싸는 테두리색. 셀 테두리와 무관하다 */
  outlineColor: colorSchema.optional(),
  /** 그리드 테두리 두께(mm). 생략하거나 0이면 그리지 않는다 */
  outlineWidth: nonNegativeMm.optional(),
  /** 그리드 테두리 형태 */
  outlineStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  /** 열 너비(mm) */
  columns: z
    .array(gridColumnSchema)
    .min(1)
    .max(SLIP_LIMITS.maxGridColumnTracks, { error: () => fmt().columnsMax(SLIP_LIMITS.maxGridColumnTracks) }),
  /** 행 높이(mm) */
  rows: z
    .array(gridRowSchema)
    .min(1)
    .max(SLIP_LIMITS.maxGridRowTracks, { error: () => fmt().rowsMax(SLIP_LIMITS.maxGridRowTracks) }),
  cells: z.array(gridCellSchema).max(SLIP_LIMITS.maxGridCells, { error: () => fmt().cellsMax(SLIP_LIMITS.maxGridCells) }),
  /** 반복 설정. 생략하면 모든 행을 한 번씩 렌더링하는 정적 그리드다. */
  repeat: gridRepeatSchema.optional(),
  /** 셀을 넘치는 글의 처리 (기본 clip) */
  overflow: overflowSchema.optional(),
});

// 여러 필드를 함께 확인해야 하는 그리드 제약을 항목별로 검증한다.
type GridInput = z.infer<typeof gridElementObject>;

/** placement별 템플릿 세로 순서 (설계상 이 순서로만 배치할 수 있다). */
const BAND_PLACEMENT_ORDER: Record<GridBandInput['placement'], number> = {
  'before-data': 0,
  'page-start': 1,
  'group-start': 2,
  item: 3,
  'group-end': 4,
  'after-data': 5,
  'page-end': 6,
};

type GridBandInput = z.infer<typeof gridBandSchema>;

/**
 * 행 구간의 범위·순서·구성 규칙을 검사한다 (SPEC §5.7).
 * - 모든 템플릿 행을 겹침·빈틈 없이 포함
 * - `item` 구간 정확히 하나
 * - placement의 세로 순서 준수
 * - `pages`·`repeatOnPageBreak`·그룹 구간의 사용 조건
 */
function checkGridBands(grid: GridInput, ctx: z.RefinementCtx): void {
  const repeat = grid.repeat;
  if (!repeat) return;
  const rows = grid.rows.length;
  const bandIds = new Set<string>();
  let itemCount = 0;
  let lastRank = -1;
  let nextRow = 0;
  let coverBroken = false;

  repeat.bands.forEach((band, index) => {
    const path = ['repeat', 'bands', index];
    if (bandIds.has(band.id)) {
      ctx.addIssue({ code: 'custom', path, message: fmt().duplicateBandId(band.id) });
    }
    bandIds.add(band.id);
    if (band.fromRow > band.toRow) {
      ctx.addIssue({ code: 'custom', path, message: fmt().bandFromAboveTo(band.id) });
      coverBroken = true;
      return;
    }
    if (band.toRow >= rows) {
      ctx.addIssue({ code: 'custom', path, message: fmt().bandOutOfRange(band.id, rows) });
      coverBroken = true;
      return;
    }
    // 구간은 fromRow 순서로 이어지며 모든 행을 정확히 한 번씩 덮어야 한다.
    if (band.fromRow !== nextRow) coverBroken = true;
    nextRow = band.toRow + 1;

    const rank = BAND_PLACEMENT_ORDER[band.placement];
    if (rank < lastRank) {
      ctx.addIssue({ code: 'custom', path, message: fmt().bandOrderInvalid(band.id) });
    }
    lastRank = Math.max(lastRank, rank);
    if (band.placement === 'item') itemCount++;

    if (band.pages !== undefined && band.placement !== 'page-start' && band.placement !== 'page-end') {
      ctx.addIssue({ code: 'custom', path, message: fmt().bandPagesOnlyPageBands(band.id) });
    }
    if (band.repeatOnPageBreak !== undefined && band.placement !== 'group-start') {
      ctx.addIssue({ code: 'custom', path, message: fmt().bandRepeatOnlyGroupStart(band.id) });
    }
    if ((band.placement === 'group-start' || band.placement === 'group-end') && repeat.groupBy === undefined) {
      ctx.addIssue({ code: 'custom', path, message: fmt().bandNeedsGroupBy(band.id) });
    }
  });

  if (coverBroken || nextRow !== rows) {
    ctx.addIssue({ code: 'custom', path: ['repeat', 'bands'], message: fmt().bandsMustCoverRows() });
  }
  if (itemCount !== 1) {
    ctx.addIssue({ code: 'custom', path: ['repeat', 'bands'], message: fmt().bandItemExactlyOne() });
  }
  repeat.groupBy?.forEach((field, index) => {
    if (repeat.groupBy!.indexOf(field) !== index) {
      ctx.addIssue({ code: 'custom', path: ['repeat', 'groupBy', index], message: fmt().groupByDuplicate(field) });
    }
  });
}

/**
 * 셀의 소스 배타·범위·병합 경계·겹침을 검사한다.
 *
 * @returns 각 좌표를 해당 좌표를 차지하는 셀의 시작 좌표에 연결한 맵
 */
function checkGridCells(grid: GridInput, ctx: z.RefinementCtx): Map<string, string> {
  const rows = grid.rows.length;
  const columns = grid.columns.length;
  const occupied = new Set<string>();
  const cellOriginAt = new Map<string, string>();
  grid.cells.forEach((cell, index) => {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    const sources = [cell.content, cell.parameter, cell.formula].filter((v) => v !== undefined);
    if (sources.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['cells', index],
        message: fmt().cellSourceExclusive(cell.row, cell.column),
      });
    }
    if (cell.row + rowSpan > rows || cell.column + colSpan > columns) {
      ctx.addIssue({
        code: 'custom',
        path: ['cells', index],
        message: fmt().cellSpanOutOfRange(cell.row, cell.column, rows, columns),
      });
      return;
    }
    // 병합 셀은 하나의 행 구간 안에 완전히 포함되어야 한다.
    if (grid.repeat && rowSpan > 1) {
      const last = cell.row + rowSpan - 1;
      const band = grid.repeat.bands.find((b) => cell.row >= b.fromRow && cell.row <= b.toRow);
      if (band !== undefined && last > band.toRow) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: fmt().cellSpanCrossesBand(cell.row, cell.column),
        });
        return;
      }
    }
    for (let r = cell.row; r < cell.row + rowSpan; r++) {
      for (let c = cell.column; c < cell.column + colSpan; c++) {
        const key = `${r},${c}`;
        if (occupied.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['cells', index],
            message: fmt().cellOverlaps(r, c),
          });
          return;
        }
        occupied.add(key);
        cellOriginAt.set(key, `${cell.row},${cell.column}`);
      }
    }
  });
  return cellOriginAt;
}

/**
 * 자동 병합 열의 항목 구간이 하나의 셀로 구성되었는지 검사한다.
 * 항목 구간이 여러 셀로 나뉜 열에는 자동 병합을 적용할 수 없다.
 *
 * @param cellOriginAt - {@link checkGridCells}가 만든 좌표별 셀 시작점 맵
 */
function checkGridAutoMerge(grid: GridInput, ctx: z.RefinementCtx, cellOriginAt: Map<string, string>): void {
  const itemBand = grid.repeat?.bands.find((band) => band.placement === 'item');
  grid.columns.forEach((column, c) => {
    if (column.autoMerge !== true) return;
    if (!grid.repeat || itemBand === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns', c, 'autoMerge'],
        message: fmt().autoMergeNeedsRepeat(c),
      });
      return;
    }
    const { fromRow, toRow } = itemBand;
    const topOrigin = cellOriginAt.get(`${fromRow},${c}`);
    const notCovered = fmt().autoMergeNotCovered(c);
    // 빈 열은 모든 좌표가 undefined이므로 별도로 오류를 추가한다.
    if (topOrigin === undefined) {
      ctx.addIssue({ code: 'custom', path: ['columns', c, 'autoMerge'], message: notCovered });
      return;
    }
    for (let r = fromRow; r <= toRow; r++) {
      if (cellOriginAt.get(`${r},${c}`) !== topOrigin) {
        ctx.addIssue({ code: 'custom', path: ['columns', c, 'autoMerge'], message: notCovered });
        return;
      }
    }
  });
}

/** 열 너비 합과 행 높이 합이 mm 상한 안에 있는지 검사한다. */
function checkGridSize(grid: GridInput, ctx: z.RefinementCtx): void {
  const width = grid.columns.reduce((sum, column) => sum + column.width, 0);
  const height = grid.rows.reduce((sum, row) => sum + row.height, 0);
  if (width > SLIP_LIMITS.maxMillimeters) {
    ctx.addIssue({ code: 'custom', path: ['columns'], message: fmt().gridSizeMax(SLIP_LIMITS.maxMillimeters) });
  }
  if (height > SLIP_LIMITS.maxMillimeters) {
    ctx.addIssue({ code: 'custom', path: ['rows'], message: fmt().gridSizeMax(SLIP_LIMITS.maxMillimeters) });
  }
}

const gridElementSchema = gridElementObject.superRefine((grid, ctx) => {
  checkGridSize(grid, ctx);
  checkGridBands(grid, ctx);
  const cellOriginAt = checkGridCells(grid, ctx);
  checkGridAutoMerge(grid, ctx, cellOriginAt);
});

const imageElementSchema = z
  .strictObject({
    type: z.literal('image'),
    ...elementBaseShape,
    /** 고정 이미지 소스. `parameter`를 사용하면 생략할 수 있다. */
    src: srcSchema.optional(),
    /**
     * 전표마다 다른 이미지를 지정할 때 사용하는 값의 키.
     * 값은 `data:` base64 형식만 허용한다.
     */
    parameter: idSchema.optional(),
  })
  .superRefine((image, ctx) => {
    // 고정 소스와 파라미터 소스 중 하나만 지정할 수 있다.
    if (image.src === undefined && image.parameter === undefined) {
      ctx.addIssue({ code: 'custom', path: ['src'], message: fmt().imageSourceRequired() });
    }
    if (image.src !== undefined && image.parameter !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['parameter'], message: fmt().imageSourceExclusive() });
    }
    if (image.src !== undefined) checkDataImage(image.src, ctx, ['src']);
  });

/** 렌더링 엔진이 지원하는 바코드 종류 */
const barcodeKindSchema = z.enum([
  'qrcode', 'code128', 'ean13',
  'code39', 'ean8', 'upca', 'upce', 'itf14', 'nw7',
  'japanpost', 'gs1datamatrix', 'pdf417',
]);

/** 직접 입력, 전표 값 또는 수식 결과를 표시하는 바코드 요소 */
const barcodeElementSchema = z
  .strictObject({
    type: z.literal('barcode'),
    ...elementBaseShape,
    /** 바코드 종류 */
    kind: barcodeKindSchema,
    /** 직접 입력한 글 */
    content: shortText.optional(),
    /** 전표 values의 키 */
    parameter: idSchema.optional(),
    /** 표시 값을 계산하는 수식. */
    formula: shortText.optional(),
    /** 막대·점 색 (생략하면 검정) */
    fontColor: colorSchema.optional(),
    /** 바탕색 (생략하면 없음) */
    backgroundColor: colorSchema.optional(),
  })
  .superRefine((barcode, ctx) => {
    const sources = [barcode.content, barcode.parameter, barcode.formula].filter((v) => v !== undefined);
    if (sources.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: fmt().barcodeSourceExclusive(),
      });
    }
  });

// 도형별로 지원하는 스타일이 달라 요소 타입을 구분한다.

/** 요소 영역의 두 모서리 또는 중앙을 잇는 선. */
const lineElementSchema = z.strictObject({
  type: z.literal('line'),
  ...elementBaseShape,
  /** 선 색 (기본 #000000) */
  borderColor: colorSchema.optional(),
  /** 선 굵기(mm, 기본 0.2) */
  borderWidth: nonNegativeMm.optional(),
  /** 선 형태. 파선과 점선은 여러 선분으로 나누어 렌더링한다. */
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  /**
   * 선 방향 (기본 `horizontal`). `down`은 왼쪽 위에서 오른쪽 아래로,
   * `up`은 왼쪽 아래에서 오른쪽 위로 잇는다.
   */
  lineDirection: z.enum(['horizontal', 'vertical', 'down', 'up']).optional(),
});

/** 사각형 요소 */
const rectElementSchema = z
  .strictObject({
    type: z.literal('rect'),
    ...elementBaseShape,
    backgroundColor: colorSchema.optional(),
    borderColor: colorSchema.optional(),
    borderWidth: nonNegativeMm.optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    /** 모서리 반경(mm). 파선 또는 점선 테두리와 함께 사용할 수 없다. */
    radius: nonNegativeMm.optional(),
  })
  .superRefine((rect, ctx) => {
    if (rect.radius !== undefined && rect.radius > 0 && rect.borderStyle !== undefined && rect.borderStyle !== 'solid') {
      ctx.addIssue({
        code: 'custom',
        path: ['radius'],
        message: fmt().radiusWithDashedBorder(),
      });
    }
  });

/** 요소 영역에 내접하는 타원. 테두리는 실선만 지원한다. */
const ellipseElementSchema = z.strictObject({
  type: z.literal('ellipse'),
  ...elementBaseShape,
  backgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  borderWidth: nonNegativeMm.optional(),
});

/**
 * 요소 영역에 내접하는 정다각형.
 * 첫 꼭짓점은 위쪽에 두며 테두리는 실선만 지원한다.
 */
const polygonElementSchema = z.strictObject({
  type: z.literal('polygon'),
  ...elementBaseShape,
  /** 변 수 (3~12) */
  sides: z
    .number()
    .int()
    .min(3, { error: () => fmt().polygonSidesMin() })
    .max(12, { error: () => fmt().polygonSidesMax() }),
  backgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  borderWidth: nonNegativeMm.optional(),
});

/**
 * 전표 작성 시 값이 채워지는 입력 필드.
 *
 * @remarks
 * 값 소스는 파라미터와 수식 중 하나만 지정한다.
 */
const fieldElementSchema = z
  .strictObject({
    type: z.literal('field'),
    ...elementBaseShape,
    ...colorStyleShape,
    /** 전표 `values`의 키. 수식을 사용할 때는 지정하지 않는다. */
    parameter: idSchema.optional(),
    /** 표시 값을 계산하는 수식. 예: `FORMAT_NUMBER(...)`. */
    formula: shortText.optional(),
    ...fontShape,
    /** 값에 따라 색과 글자 강조를 바꾸는 조건부 서식 규칙. */
    conditionalFormats: conditionalFormatsSchema.optional(),
  })
  .superRefine((field, ctx) => {
    const sources = [field.parameter, field.formula].filter((v) => v !== undefined);
    if (sources.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['parameter'],
        message: fmt().fieldSourceExclusive(field.name),
      });
    }
  });

/** `type` 필드로 구분하는 아홉 가지 요소의 판별 유니온. */
export const slipElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  gridElementSchema,
  imageElementSchema,
  barcodeElementSchema,
  lineElementSchema,
  rectElementSchema,
  ellipseElementSchema,
  polygonElementSchema,
  fieldElementSchema,
]);

// ---------------------------------------------------------------------------
// 용지 · 페이지 · 에셋
// ---------------------------------------------------------------------------

/** 용지 크기(mm)와 여백. 여백의 합은 용지 크기보다 작아야 한다 */
export const paperSchema = z
  .strictObject({
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
        message: fmt().paddingTooLarge(),
      });
    }
  });

const assetEntrySchema = z
  .strictObject({
    id: idSchema,
    mimeType: shortText.regex(/^[\w.+-]+\/[\w.+-]+$/, { error: () => fmt().mimeTypeFormat() }),
    src: srcSchema,
  })
  .superRefine((asset, ctx) => {
    // 파일에 심은 이미지는 선언한 MIME과 실제 내용이 맞아야 한다.
    const inspection = checkDataImage(asset.src, ctx, ['src']);
    if (inspection?.ok === true && inspection.mimeType !== asset.mimeType) {
      ctx.addIssue({ code: 'custom', path: ['mimeType'], message: fmt().assetMimeMismatch(asset.mimeType, inspection.mimeType) });
    }
  });

/** 페이지 번호를 표시할 위치 */
const pageNumberPositionSchema = z.enum([
  'bottom-left', 'bottom-center', 'bottom-right',
  'top-left', 'top-center', 'top-right',
]);

/** PDF 후처리 단계에서 추가하는 페이지 번호 설정 */
const pageNumberSchema = z.strictObject({
  position: pageNumberPositionSchema,
  /** `{n}`은 현재 페이지, `{total}`은 전체 페이지 수로 치환된다. */
  format: idSchema.optional(),
  fontSize: fontSizeSchema.optional(),
});

/**
 * 자동 배치 요소가 사용할 수 있는 페이지의 세로 범위 (용지 위쪽 기준 절대 mm).
 * 생략하면 용지의 위·아래 여백 경계를 사용한다.
 */
const flowAreaSchema = z
  .strictObject({ top: nonNegativeMm, bottom: positiveMm })
  .superRefine((area, ctx) => {
    if (area.top >= area.bottom) {
      ctx.addIssue({ code: 'custom', path: ['top'], message: fmt().flowAreaInvalid() });
    }
  });

const slipPageSchema = z.strictObject({
  elements: z
    .array(slipElementSchema)
    .max(SLIP_LIMITS.maxElementsPerPage, { error: () => fmt().elementsMax(SLIP_LIMITS.maxElementsPerPage) }),
  /** 호스트가 페이지를 식별할 때 사용하는 문서 내 고유 키 */
  key: idSchema.optional(),
  /** 썸네일과 목록에 표시할 페이지 이름 */
  label: idSchema.optional(),
  /** 페이지 번호 표시 설정 */
  pageNumber: pageNumberSchema.optional(),
  /** 자동 확장 요소가 흐를 수 있는 세로 범위 */
  flowArea: flowAreaSchema.optional(),
});

// ---------------------------------------------------------------------------
// 전표 값
// ---------------------------------------------------------------------------

/** 열린 맵을 검사하는 동안 `__proto__` 키를 잠시 바꿔 두는 이름. 외부 입력과 겹치지 않는 값이다. */
const PROTO_KEY_ALIAS = `\u0000__proto__\u0000${Math.random().toString(36).slice(2)}`;

/**
 * 키 제약이 없는 열린 맵 스키마.
 *
 * `z.record`는 결과 객체에 키를 대입해 만들기 때문에 `__proto__`라는 키가 사라진다. 검사 전에 그
 * 키만 임시 이름으로 바꿔 넘기고, 검사가 끝난 결과에서 원래 키로 되돌려 객체가 직접 가진 속성으로
 * 남긴다. JSON Schema 생성에는 안쪽 `z.record`가 그대로 쓰인다.
 *
 * @param valueSchema - 맵 값 하나의 스키마
 * @returns 모든 키를 직접 가진 속성으로 보존하는 맵 스키마
 */
function openMapSchema<T>(valueSchema: z.ZodType<T>): z.ZodType<Record<string, T>> {
  const record = z.record(z.string(), valueSchema);
  return z
    .preprocess((input) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input) || !Object.hasOwn(input, '__proto__')) {
        return input;
      }
      const source = input as Record<string, unknown>;
      const aliased: Record<string, unknown> = {};
      for (const key of Object.keys(source)) {
        writeOwn(aliased, key === '__proto__' ? PROTO_KEY_ALIAS : key, readOwn(source, key));
      }
      return aliased;
    }, record)
    .superRefine((parsed) => {
      if (!Object.hasOwn(parsed, PROTO_KEY_ALIAS)) return;
      // 결과 객체는 검사기가 새로 만든 것이라 원래 키 순서를 유지하며 제자리에서 되돌린다.
      const entries = Object.keys(parsed).map((key) => [key, readOwn(parsed, key)] as const);
      for (const [key] of entries) delete parsed[key];
      for (const [key, value] of entries) writeOwn(parsed, key === PROTO_KEY_ALIAS ? '__proto__' : key, value);
    }) as unknown as z.ZodType<Record<string, T>>;
}

/** JSON으로 표현 가능한 값 (전표 values의 값 타입) */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * JSON으로 표현 가능한 값 (전표 values). 객체는 열린 맵이라 `parameters`에 정의되지 않은
 * 키도 그대로 보존한다. 문자열 길이만 상한을 둔다.
 */
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(SLIP_LIMITS.maxValueStringLength, { error: () => fmt().valueStringMax(SLIP_LIMITS.maxValueStringLength) }),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    openMapSchema(jsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// 양식(템플릿) 본문
// ---------------------------------------------------------------------------

/** 작성 폼의 입력 방식과 사용 가능한 함수를 결정하는 파라미터 값 종류 */
const parameterValueTypeSchema = z.enum(['text', 'number', 'date', 'boolean', 'image', 'list']);

/**
 * 목록 항목에 포함되는 하위 필드 정의.
 * 목록 항목은 한 단계의 객체이며 하위 필드를 중첩할 수 없다.
 */
const parameterFieldSchema = z.strictObject({
  key: idSchema,
  label: idSchema.optional(),
  valueType: parameterValueTypeSchema.optional(),
});

/**
 * 파라미터 정의.
 * `key`는 파일, 수식, 외부 연동에서 사용하고 `label`은 화면에 표시한다.
 * `valueType`이 `list`이면 목록 항목의 필드를 `fields`에 선언한다.
 */
const parameterDefSchema = z
  .strictObject({
    key: idSchema,
    label: idSchema.optional(),
    /** 값 종류. 생략하면 텍스트로 처리한다. */
    valueType: parameterValueTypeSchema.optional(),
    /** 목록 항목의 하위 필드. `valueType`이 `list`일 때만 사용한다. */
    fields: z.array(parameterFieldSchema).optional(),
  })
  .superRefine((def, ctx) => {
    if (def.fields === undefined) return;
    if (def.valueType !== 'list') {
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: fmt().subFieldsOnlyForList(),
      });
    }
    const seen = new Set<string>();
    def.fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'key'],
          message: fmt().duplicateSubField(field.key),
        });
      }
      seen.add(field.key);
    });
  });

const templateMetaSchema = z.strictObject({
  title: idSchema,
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});

/** 양식 본문. 식별자 중복과 `asset://` 참조의 유효성도 검증한다. */
export const slipTemplateBodySchema = z
  .strictObject({
    meta: templateMetaSchema,
    paper: paperSchema,
    pages: z
      .array(slipPageSchema)
      .min(1)
      .max(SLIP_LIMITS.maxPages, { error: () => fmt().pagesMax(SLIP_LIMITS.maxPages) }),
    assets: z
      .array(assetEntrySchema)
      .max(SLIP_LIMITS.maxAssets, { error: () => fmt().assetsMax(SLIP_LIMITS.maxAssets) }),
    /** 파라미터 정의. 요소는 여기에 등록되지 않은 키도 사용할 수 있다. */
    parameters: z
      .array(parameterDefSchema)
      .max(SLIP_LIMITS.maxParameters, { error: () => fmt().parametersMax(SLIP_LIMITS.maxParameters) })
      .optional(),
    /** 미리보기용 샘플 값. 생성된 전표에는 포함하지 않는다. */
    sampleValues: openMapSchema(jsonValueSchema).optional(),
  })
  .superRefine((body, ctx) => {
    // 파라미터 키는 정의 목록에서 고유해야 한다.
    const parameterKeys = new Set<string>();
    body.parameters?.forEach((parameter, index) => {
      if (parameterKeys.has(parameter.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parameters', index, 'key'],
          message: fmt().duplicateParameterKey(parameter.key),
        });
      }
      parameterKeys.add(parameter.key);
    });
    // 에셋 ID는 문서 안에서 고유해야 한다.
    const assetIds = new Set<string>();
    body.assets.forEach((asset, index) => {
      if (assetIds.has(asset.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets', index, 'id'],
          message: fmt().duplicateAssetId(asset.id),
        });
      }
      assetIds.add(asset.id);
    });
    // 에셋의 src에 포함된 asset:// 참조도 검증한다 (SPEC §3.1).
    body.assets.forEach((asset, index) => {
      if (asset.src.startsWith('asset://')) {
        const referencedId = asset.src.slice('asset://'.length);
        if (referencedId === asset.id) {
          // 자기 참조는 에셋을 해석할 때 무한 순환을 만든다.
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'src'],
            message: fmt().assetSelfReference(asset.id),
          });
        } else if (!assetIds.has(referencedId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'src'],
            message: fmt().missingAsset(referencedId),
          });
        }
      }
    });
    // 페이지 키는 호스트가 페이지를 식별하므로 문서 안에서 고유해야 한다 (SPEC §4).
    const pageKeys = new Set<string>();
    body.pages.forEach((page, pageIndex) => {
      if (page.key === undefined) return;
      if (pageKeys.has(page.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pages', pageIndex, 'key'],
          message: fmt().duplicatePageKey(page.key),
        });
      }
      pageKeys.add(page.key);
    });

    // 요소 ID의 고유성과 이미지의 asset:// 참조를 검증한다.
    const elementIds = new Set<string>();
    body.pages.forEach((page, pageIndex) => {
      page.elements.forEach((element, elementIndex) => {
        if (elementIds.has(element.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['pages', pageIndex, 'elements', elementIndex, 'id'],
            message: fmt().duplicateElementId(element.id),
          });
        }
        elementIds.add(element.id);
        if (element.type === 'image' && element.src?.startsWith('asset://') === true) {
          const assetId = element.src.slice('asset://'.length);
          if (!assetIds.has(assetId)) {
            ctx.addIssue({
              code: 'custom',
              path: ['pages', pageIndex, 'elements', elementIndex, 'src'],
              message: fmt().missingAsset(assetId),
            });
          }
        }
      });
    });

    // 흐름 영역은 용지 높이 안에 있어야 한다.
    body.pages.forEach((page, pageIndex) => {
      if (page.flowArea !== undefined && page.flowArea.bottom > body.paper.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['pages', pageIndex, 'flowArea', 'bottom'],
          message: fmt().flowAreaOutOfPaper(page.flowArea.bottom, body.paper.height),
        });
      }
    });

    // after 배치의 대상은 같은 페이지의 요소여야 하며 참조가 순환할 수 없다.
    body.pages.forEach((page, pageIndex) => {
      const pageElementIds = new Set(page.elements.map((element) => element.id));
      const afterTarget = new Map<string, string>();
      page.elements.forEach((element, elementIndex) => {
        const placement = element.pagePlacement;
        if (placement === undefined || placement.mode !== 'after') return;
        if (placement.target === element.id || !pageElementIds.has(placement.target)) {
          ctx.addIssue({
            code: 'custom',
            path: ['pages', pageIndex, 'elements', elementIndex, 'pagePlacement', 'target'],
            message: fmt().afterTargetMissing(placement.target),
          });
          return;
        }
        afterTarget.set(element.id, placement.target);
      });
      // target 사슬을 따라가며 순환을 검사한다.
      for (const [startId] of afterTarget) {
        const visited = new Set<string>([startId]);
        let current = afterTarget.get(startId);
        while (current !== undefined) {
          if (visited.has(current)) {
            const elementIndex = page.elements.findIndex((element) => element.id === startId);
            ctx.addIssue({
              code: 'custom',
              path: ['pages', pageIndex, 'elements', elementIndex, 'pagePlacement', 'target'],
              message: fmt().afterTargetCycle(),
            });
            break;
          }
          visited.add(current);
          current = afterTarget.get(current);
        }
      }
    });
  });

// ---------------------------------------------------------------------------
// 파일 (봉투 + kind별 본문)
// ---------------------------------------------------------------------------

/** 본문 검증 전에 `schemaVersion`과 `kind`를 확인하는 파일 봉투. */
export const slipEnvelopeSchema = z.object({
  schemaVersion: semverSchema,
  kind: z.enum(['template', 'voucher']),
});

/** 양식(template) 파일 전체 */
export const slipTemplateFileSchema = z.strictObject({
  schemaVersion: semverSchema,
  kind: z.literal('template'),
  template: slipTemplateBodySchema,
});

/** 발행된 전표의 양식 스냅샷에서 외부 이미지 URL을 찾는다. */
function findExternalUrlPath(body: z.infer<typeof slipTemplateBodySchema>): (string | number)[] | null {
  for (const [a, asset] of body.assets.entries()) {
    if (HTTP_SRC.test(asset.src)) return ['assets', a, 'src'];
  }
  for (const [p, page] of body.pages.entries()) {
    for (const [e, element] of page.elements.entries()) {
      if (element.type === 'image' && element.src !== undefined && HTTP_SRC.test(element.src)) {
        return ['pages', p, 'elements', e, 'src'];
      }
    }
  }
  return null;
}

/** 전표 파일. 발행된 전표에는 외부 이미지 URL을 허용하지 않는다. */
export const slipVoucherFileSchema = z
  .strictObject({
    schemaVersion: semverSchema,
    kind: z.literal('voucher'),
    /** 전표를 생성할 때 복사한 양식 본문. */
    templateSnapshot: slipTemplateBodySchema,
    /** 필드 파라미터 키별 값 */
    values: openMapSchema(jsonValueSchema),
    /** 발행 여부. 발행된 전표의 이미지는 base64로 포함한다. */
    issued: z.boolean(),
  })
  .superRefine((voucher, ctx) => {
    if (!voucher.issued) return;
    // 발행된 전표의 이미지는 외부 URL이 아닌 파일 내 데이터로 포함해야 한다.
    const externalPath = findExternalUrlPath(voucher.templateSnapshot);
    if (externalPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['templateSnapshot', ...externalPath],
        message: fmt().issuedExternalImage(),
      });
    }
    // 이미지 파라미터 값은 PNG·JPEG의 data: base64 형식이고 내용·크기가 맞는지 검증한다.
    // 빈 문자열은 이미지가 없는 값으로 허용한다.
    for (const page of voucher.templateSnapshot.pages) {
      for (const element of page.elements) {
        if (element.type !== 'image' || element.parameter === undefined) continue;
        const value = readOwn(voucher.values, element.parameter);
        if (typeof value !== 'string' || value === '') continue;
        const path = ['values', element.parameter];
        if (!DATA_SRC.test(value)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: HTTP_SRC.test(value) ? fmt().issuedExternalImage() : fmt().imageValueFormat(),
          });
          continue;
        }
        checkDataImage(value, ctx, path);
      }
    }
  });

/** `kind`로 양식과 전표를 구분하는 `.slip` 파일 스키마 */
/** 어떤 키든 보존하는 열린 업무 데이터의 뿌리 경로. 이 아래의 객체는 구조 객체가 아니다. */
const OPEN_DATA_ROOTS: readonly (readonly string[])[] = [
  ['values'],
  ['template', 'sampleValues'],
  ['templateSnapshot', 'sampleValues'],
];

function isOpenDataRoot(path: readonly (string | number)[]): boolean {
  return OPEN_DATA_ROOTS.some((root) => root.length === path.length && root.every((seg, i) => seg === path[i]));
}

/**
 * 구조 객체가 직접 가진 `__proto__` 키를 미정의 키로 보고한다.
 *
 * `z.strictObject`는 `__proto__`를 미정의 키로 열거하지 않고 결과에서 조용히 빼 버리므로,
 * 검사 전에 입력을 훑어 열린 업무 데이터 밖에 있는 `__proto__`를 다른 미정의 키와 같은
 * 오류로 남긴다. 입력은 바꾸지 않는다.
 */
function reportStructuralProtoKeys(input: unknown, ctx: z.RefinementCtx): unknown {
  const walk = (value: unknown, path: (string | number)[]): void => {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index]));
      return;
    }
    if (isOpenDataRoot(path)) return;
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, '__proto__')) {
      ctx.addIssue({ code: 'unrecognized_keys', keys: ['__proto__'], path, input: record });
    }
    for (const key of Object.keys(record)) {
      if (key !== '__proto__') walk(readOwn(record, key), [...path, key]);
    }
  };
  walk(input, []);
  return input;
}

export const slipFileSchema = z.preprocess(
  reportStructuralProtoKeys,
  z.discriminatedUnion('kind', [slipTemplateFileSchema, slipVoucherFileSchema]),
);

// ---------------------------------------------------------------------------
// 파싱 · 직렬화
// ---------------------------------------------------------------------------

/** `.slip` 파일의 파싱 또는 검증 실패를 나타내는 오류 */
export class SlipParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipParseError';
  }
}

/** 양식 본문의 모든 수식과 조건식을 저장 가능한 문법으로 검사한다. */
function validateTemplateFormulas(
  body: z.infer<typeof slipTemplateBodySchema>,
  root: 'template' | 'templateSnapshot',
  locale: string | undefined,
): void {
  const issues: string[] = [];
  const check = (source: string, path: (string | number)[]): void => {
    try {
      const options = locale === undefined ? undefined : { locale };
      assertFormulaArity(parseFormula(source, options), options);
    } catch (error) {
      issues.push(`${path.join('.')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const checkConditions = (
    rules: readonly { condition: string }[] | undefined,
    path: (string | number)[],
  ): void => {
    rules?.forEach((rule, index) => check(rule.condition, [...path, index, 'condition']));
  };

  body.pages.forEach((page, pageIndex) => {
    page.elements.forEach((element, elementIndex) => {
      const elementPath: (string | number)[] = [root, 'pages', pageIndex, 'elements', elementIndex];
      if ('formula' in element && element.formula !== undefined) {
        check(element.formula, [...elementPath, 'formula']);
      }
      if ('conditionalFormats' in element) {
        checkConditions(element.conditionalFormats, [...elementPath, 'conditionalFormats']);
      }
      if (element.type !== 'grid') return;
      element.cells.forEach((cell, cellIndex) => {
        const cellPath = [...elementPath, 'cells', cellIndex];
        if (cell.formula !== undefined) check(cell.formula, [...cellPath, 'formula']);
        checkConditions(cell.conditionalFormats, [...cellPath, 'conditionalFormats']);
      });
    });
  });

  if (issues.length > 0) throw new SlipParseError(fmt().bodyInvalid(issues.join(', ')));
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join(', ');
}

/**
 * 이미 파싱된 JSON 값을 `.slip` 파일로 검증한다.
 * 구버전 문서는 현재 버전으로 마이그레이션한 뒤 검증한다.
 *
 * @param raw - 이미 파싱된 JSON 값 (예: `JSON.parse` 결과)
 * @param options - `locale`: 오류 메시지에 사용할 BCP 47 로케일 (생략하면 영어)
 * @returns 검증·마이그레이션이 끝난 `.slip` 파일
 * @throws SlipParseError 봉투·본문 검증 또는 마이그레이션 실패 시
 */
export function validateSlipFile(raw: unknown, options?: { locale?: string }): SlipFile {
  return withFormatLocale(options?.locale, () => {
    const envelope = slipEnvelopeSchema.safeParse(raw, zodParseParams());
    if (!envelope.success) {
      throw new SlipParseError(fmt().envelopeInvalid(formatIssues(envelope.error)));
    }
    let migrated: Record<string, unknown>;
    try {
      migrated = migrateSlipDocument(raw as Record<string, unknown>);
    } catch (error) {
      throw new SlipParseError(error instanceof Error ? error.message : String(error));
    }
    let result: ReturnType<typeof slipFileSchema.safeParse>;
    try {
      result = slipFileSchema.safeParse(migrated, zodParseParams());
    } catch (error) {
      // 지나치게 깊은 값은 z.lazy 재귀 중 RangeError를 발생시킬 수 있다.
      // 공개 오류 형식을 유지하기 위해 SlipParseError로 변환한다 (SPEC §3.2).
      if (error instanceof RangeError) {
        throw new SlipParseError(fmt().valueTooDeep());
      }
      throw error;
    }
    if (!result.success) {
      throw new SlipParseError(fmt().bodyInvalid(formatIssues(result.error)));
    }
    if (result.data.kind === 'template') {
      validateTemplateFormulas(result.data.template, 'template', options?.locale);
    } else {
      validateTemplateFormulas(result.data.templateSnapshot, 'templateSnapshot', options?.locale);
    }
    return result.data;
  });
}

/**
 * JSON 문자열을 `.slip` 파일로 파싱한다.
 *
 * @param json - `.slip` 파일 내용 (JSON 문자열)
 * @param options - `locale`: 오류 메시지에 사용할 BCP 47 로케일 (생략하면 영어)
 * @returns 검증·마이그레이션이 끝난 `.slip` 파일
 * @throws SlipParseError JSON이 아니거나 봉투·본문 검증 실패 시
 *
 * @example
 * ```ts
 * const file = parseSlipFile(jsonText);
 * if (file.kind === 'template') console.log(file.template.meta.title);
 * ```
 */
export function parseSlipFile(json: string, options?: { locale?: string }): SlipFile {
  return withFormatLocale(options?.locale, () => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new SlipParseError(fmt().invalidJson());
    }
    return validateSlipFile(raw);
  });
}

/**
 * `.slip` 파일을 저장용 JSON 문자열로 직렬화한다.
 *
 * @param file - 직렬화할 `.slip` 파일
 * @returns 들여쓰기 2칸의 JSON 문자열
 */
export function serializeSlipFile(file: SlipFile): string {
  return JSON.stringify(file, null, 2);
}

// ---------------------------------------------------------------------------
// Zod 스키마에서 추론한 타입
// ---------------------------------------------------------------------------

/** 용지 크기·여백 */
export type PaperSize = z.infer<typeof paperSchema>;
/** 에셋 항목 */
export type AssetEntry = z.infer<typeof assetEntrySchema>;
/** 텍스트 요소 */
export type TextElement = z.infer<typeof textElementSchema>;

/** 그리드 셀. */
export type GridCell = z.infer<typeof gridCellSchema>;

/** 조건부 서식 규칙. */
export type ConditionalFormatRule = z.infer<typeof conditionalFormatRuleSchema>;

/** 그리드의 반복 설정. */
export type GridRepeat = z.infer<typeof gridRepeatSchema>;

export type GridBand = z.infer<typeof gridBandSchema>;

export type GridBandPlacement = z.infer<typeof bandPlacementSchema>;

export type GridPagination = z.infer<typeof gridPaginationSchema>;

export type OutputPageFilter = z.infer<typeof outputPageFilterSchema>;

export type PagePlacement = z.infer<typeof pagePlacementSchema>;

export type PageFlowArea = z.infer<typeof flowAreaSchema>;

/** 고정 행과 반복 행으로 구성된 그리드 요소. */
export type GridElement = z.infer<typeof gridElementSchema>;
/** 파라미터 정의. */
export type ParameterDef = z.infer<typeof parameterDefSchema>;
/** 목록 파라미터의 하위 필드 정의. */
export type ParameterField = z.infer<typeof parameterFieldSchema>;
/** 이미지 요소 */
export type ImageElement = z.infer<typeof imageElementSchema>;
/** 선 요소. */
export type LineElement = z.infer<typeof lineElementSchema>;
/** 사각형 요소. */
export type RectElement = z.infer<typeof rectElementSchema>;
/** 타원 요소. */
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
/** 정다각형 요소. */
export type PolygonElement = z.infer<typeof polygonElementSchema>;
/** 필드 요소 (전표 값 파라미터) */
export type FieldElement = z.infer<typeof fieldElementSchema>;
/** 바코드 요소 */
export type BarcodeElement = z.infer<typeof barcodeElementSchema>;
/** 바코드 종류 */
export type BarcodeKind = z.infer<typeof barcodeKindSchema>;
/** 파라미터 값 종류 */
export type ParameterValueType = z.infer<typeof parameterValueTypeSchema>;
/** 페이지 번호 표시 */
export type PageNumber = z.infer<typeof pageNumberSchema>;
/** 페이지 번호 위치 */
export type PageNumberPosition = z.infer<typeof pageNumberPositionSchema>;
/** 요소 9종 유니온 */
export type SlipElement = z.infer<typeof slipElementSchema>;
/** 페이지 (요소 배열) */
export type SlipPage = z.infer<typeof slipPageSchema>;
/** 양식 본문 */
export type SlipTemplateBody = z.infer<typeof slipTemplateBodySchema>;
/** 양식 파일 */
export type SlipTemplateFile = z.infer<typeof slipTemplateFileSchema>;
/** 전표 파일 */
export type SlipVoucherFile = z.infer<typeof slipVoucherFileSchema>;
/** `.slip` 양식 또는 전표 파일. */
export type SlipFile = z.infer<typeof slipFileSchema>;
/** 파일 종류 판별자 */
export type SlipFileKind = SlipFile['kind'];

/**
 * 요소가 캔버스에서 차지하는 크기를 반환한다.
 * 그리드는 크기를 저장하지 않으므로 행·열 정의의 합으로 계산한다 (항목 구간은 한 번만 센다).
 *
 * @param element - 크기를 계산할 요소
 * @returns 너비·높이(mm)
 */
export function elementBounds(element: SlipElement): { width: number; height: number } {
  if (element.type === 'grid') {
    return {
      width: element.columns.reduce((sum, column) => sum + column.width, 0),
      height: element.rows.reduce((sum, row) => sum + row.height, 0),
    };
  }
  return { width: element.width, height: element.height };
}
