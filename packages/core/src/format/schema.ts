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

/**
 * 구조 크기 상한 (SPEC §3.2) — 적대적 파일이 렌더러·검증기의 메모리를
 * 고갈시키지 못하도록 막는다. 상한을 넘는 파일은 파싱 단계에서 거부된다.
 */
export const SLIP_LIMITS = {
  /** 문서당 최대 페이지 수 */
  maxPages: 500,
  /** 페이지당 최대 요소 수 */
  maxElementsPerPage: 2000,
  /** 문서당 최대 에셋 수 */
  maxAssets: 1000,
  /** 고정 그리드 최대 행 수 */
  maxGridRows: 1000,
  /** 고정 그리드 최대 열 수 */
  maxGridColumns: 100,
  /** 고정 그리드 최대 셀 수 */
  maxGridCells: 100_000,
  /** 동적 표 최대 열 수 */
  maxTableColumns: 100,
  /** 바인딩 정의부 최대 항목 수 */
  maxBindings: 500,
  /** 그리드(grid) 최대 행 수 */
  maxGridRowTracks: 1000,
  /** 그리드(grid) 최대 열 수 */
  maxGridColumnTracks: 100,
  /** 그리드(grid) 반복 구간의 페이지당 최대 항목 수 */
  maxRepeatPerPage: 1000,
} as const;

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
  /** 그룹 식별자 — 같은 값을 가진 요소들을 한 묶음으로 다룬다 (ADR-032, 편집 UI는 v2 후반) */
  group: z.string().min(1).optional(),
};

const fontShape = {
  fontName: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  alignment: alignmentSchema.optional(),
  /**
   * 굵게 — 렌더 시 유효 폰트의 `<이름>-Bold` 폰트로 전환한다.
   * 굵은 폰트가 없으면 PDF에서는 무시된다 (ADR-032, SPEC §5)
   */
  bold: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
};

// ---------------------------------------------------------------------------
// 요소 6종 (ADR-020)
// ---------------------------------------------------------------------------

const textElementSchema = z.object({
  type: z.literal('text'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 고정 문구 또는 수식/플레이스홀더 포함 문자열 */
  content: z.string(),
  ...fontShape,
});

const fixedGridCellSchema = z.object({
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
const fixedGridElementSchema = z
  .object({
    type: z.literal('fixedGrid'),
    ...elementBaseShape,
    ...colorStyleShape,
    rows: z.number().int().min(1).max(SLIP_LIMITS.maxGridRows, `rows는 최대 ${SLIP_LIMITS.maxGridRows}입니다`),
    columns: z.number().int().min(1).max(SLIP_LIMITS.maxGridColumns, `columns는 최대 ${SLIP_LIMITS.maxGridColumns}입니다`),
    /** 열 너비 비율(%) — 길이 = columns, 합 100 */
    columnWidthPercentages: percentagesSchema,
    /** 행 높이 비율(%) — 생략 시 균등. 지정 시 길이 = rows, 합 100 */
    rowHeightPercentages: percentagesSchema.optional(),
    cells: z.array(fixedGridCellSchema).max(SLIP_LIMITS.maxGridCells, `셀 수는 최대 ${SLIP_LIMITS.maxGridCells}개입니다`),
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

/** 동적 표의 열 — 물리 데이터 키·표시 제목·너비를 분리한다 (ADR-032) */
const tableColumnSchema = z.object({
  /** 행 객체에서 값을 읽는 물리 키 — 제목을 바꿔도 데이터·수식이 깨지지 않는다 */
  key: idSchema,
  /** 헤더에 표시하는 제목 */
  title: z.string(),
  /** 열 너비 비율(%) — 전체 합 100 */
  widthPercentage: z.number().positive(),
});

/** 데이터 행 수에 따라 늘어나는 표. 자동 페이지 분할 대상 (ADR-011) */
const dynamicTableElementSchema = z
  .object({
    type: z.literal('dynamicTable'),
    ...elementBaseShape,
    ...colorStyleShape,
    /** 열 정의 (키·제목·너비, ADR-032) */
    columns: z
      .array(tableColumnSchema)
      .min(1)
      .max(SLIP_LIMITS.maxTableColumns, `열 수는 최대 ${SLIP_LIMITS.maxTableColumns}개입니다`),
    /** 페이지 분할 시 헤더 반복 (ADR-011) */
    repeatHead: z.boolean(),
    /** 바인딩할 데이터 키 (전표 values의 배열 필드) */
    binding: idSchema,
  })
  .superRefine((table, ctx) => {
    const sum = table.columns.reduce((acc, col) => acc + col.widthPercentage, 0);
    if (Math.abs(sum - 100) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns'],
        message: '열 너비 비율의 합은 100이어야 합니다',
      });
    }
    const keys = new Set<string>();
    table.columns.forEach((col, index) => {
      if (keys.has(col.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['columns', index, 'key'],
          message: `열 키가 중복됩니다: ${col.key}`,
        });
      }
      keys.add(col.key);
    });
  });

// ---------------------------------------------------------------------------
// grid — 고정 틀과 반복 목록을 하나로 다루는 그리드 (0.3.0, ADR-037)
// ---------------------------------------------------------------------------

/** 칸을 넘치는 글의 처리 — 잘라내거나 글자 크기를 줄여 넣는다 (ADR-037) */
const overflowSchema = z.enum(['clip', 'shrink']);

/** 그리드 열 — 너비는 mm 절대값이라 열을 더해도 다른 열이 변하지 않는다 (ADR-037) */
const gridColumnSchema = z.object({ width: positiveMm });

/** 그리드 행 — 높이는 mm 절대값 */
const gridRowSchema = z.object({ height: positiveMm });

const gridCellSchema = z.object({
  ...colorStyleShape,
  /** 0-기반 행/열 좌표 */
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  /** 병합 범위 (기본 1) */
  rowSpan: z.number().int().min(1).optional(),
  colSpan: z.number().int().min(1).optional(),
  /** 고정 문구 */
  content: z.string().optional(),
  /** 값 키 — 반복 구간 안이면 그 항목의 필드, 밖이면 전표 values의 키 */
  binding: idSchema.optional(),
  /** 표시 전 가공 수식 (ADR-010/017) */
  formula: z.string().optional(),
  /** 칸을 넘치는 글의 처리 — 요소 값을 덮어쓴다 */
  overflow: overflowSchema.optional(),
  ...fontShape,
});

/** 반복 구간 — 지정한 행 범위가 항목 배열만큼 복제된다 (ADR-037) */
const gridRepeatSchema = z.object({
  /** 전표 values에서 항목 배열(객체 배열)을 담는 키 */
  binding: idSchema,
  /** 반복할 행 범위 (0-기반, 양끝 포함) */
  fromRow: z.number().int().nonnegative(),
  toRow: z.number().int().nonnegative(),
  /** 한 페이지에 담는 항목 수 (행 수가 아니다) */
  perPage: z
    .number()
    .int()
    .min(1)
    .max(SLIP_LIMITS.maxRepeatPerPage, `perPage는 최대 ${SLIP_LIMITS.maxRepeatPerPage}입니다`),
  /** 이어지는 페이지에 반복 구간 위쪽 행을 다시 그릴지 */
  repeatHeader: z.boolean(),
});

/** 고정 틀과 반복 목록을 하나로 다루는 그리드 (0.3.0, ADR-037) */
const gridElementSchema = z
  .object({
    type: z.literal('grid'),
    ...elementBaseShape,
    ...colorStyleShape,
    ...fontShape,
    /** 열 정의 — 너비(mm) */
    columns: z
      .array(gridColumnSchema)
      .min(1)
      .max(SLIP_LIMITS.maxGridColumnTracks, `열 수는 최대 ${SLIP_LIMITS.maxGridColumnTracks}개입니다`),
    /** 행 정의 — 높이(mm) */
    rows: z
      .array(gridRowSchema)
      .min(1)
      .max(SLIP_LIMITS.maxGridRowTracks, `행 수는 최대 ${SLIP_LIMITS.maxGridRowTracks}개입니다`),
    cells: z.array(gridCellSchema).max(SLIP_LIMITS.maxGridCells, `셀 수는 최대 ${SLIP_LIMITS.maxGridCells}개입니다`),
    /** 반복 구간 — 없으면 고정 틀 */
    repeat: gridRepeatSchema.optional(),
    /** 칸을 넘치는 글의 처리 (기본 clip) */
    overflow: overflowSchema.optional(),
  })
  .superRefine((grid, ctx) => {
    const rows = grid.rows.length;
    const columns = grid.columns.length;
    // 요소 상자는 행 높이·열 너비의 합이다 — 비율이 아니므로 어긋나면 그리는 자리가 달라진다
    const totalWidth = grid.columns.reduce((sum, col) => sum + col.width, 0);
    // 반복 구간은 페이지마다 perPage번 복제되므로 요소 높이도 그만큼이다 (SPEC §5.7)
    const templateHeight = grid.rows.reduce((sum, row) => sum + row.height, 0);
    const bandHeight = grid.repeat
      ? grid.rows
          .slice(grid.repeat.fromRow, grid.repeat.toRow + 1)
          .reduce((sum, row) => sum + row.height, 0)
      : 0;
    const totalHeight = templateHeight + (grid.repeat ? (grid.repeat.perPage - 1) * bandHeight : 0);
    if (Math.abs(totalWidth - grid.width) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns'],
        message: `열 너비의 합(${totalWidth})은 width(${grid.width})와 같아야 합니다`,
      });
    }
    if (Math.abs(totalHeight - grid.height) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['rows'],
        message:
          `행 높이의 합(${totalHeight})은 height(${grid.height})와 같아야 합니다`
          + (grid.repeat ? ' — 반복 구간은 perPage번 복제된 높이로 셉니다' : ''),
      });
    }
    if (grid.repeat) {
      const { fromRow, toRow } = grid.repeat;
      if (fromRow > toRow) {
        ctx.addIssue({ code: 'custom', path: ['repeat', 'fromRow'], message: 'fromRow는 toRow보다 클 수 없습니다' });
      } else if (toRow >= rows) {
        ctx.addIssue({
          code: 'custom',
          path: ['repeat', 'toRow'],
          message: `반복 구간(${fromRow}~${toRow})이 행 수(${rows})를 벗어납니다`,
        });
      }
    }
    // 셀 범위·겹침 검사 (병합 포함)
    const occupied = new Set<string>();
    grid.cells.forEach((cell, index) => {
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      const sources = [cell.content, cell.binding, cell.formula].filter((v) => v !== undefined);
      if (sources.length > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: `셀(${cell.row},${cell.column})은 content·binding·formula 중 하나만 가질 수 있습니다`,
        });
      }
      if (cell.row + rowSpan > rows || cell.column + colSpan > columns) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', index],
          message: `셀(${cell.row},${cell.column})의 병합 범위가 그리드(${rows}×${columns})를 벗어납니다`,
        });
        return;
      }
      // 병합이 반복 구간 경계를 넘으면 복제할 때 모양이 무너진다
      if (grid.repeat && rowSpan > 1) {
        const { fromRow, toRow } = grid.repeat;
        const last = cell.row + rowSpan - 1;
        const startsInside = cell.row >= fromRow && cell.row <= toRow;
        const endsInside = last >= fromRow && last <= toRow;
        if (startsInside !== endsInside || (startsInside && endsInside && (cell.row < fromRow || last > toRow))) {
          ctx.addIssue({
            code: 'custom',
            path: ['cells', index],
            message: `셀(${cell.row},${cell.column})의 병합이 반복 구간(${fromRow}~${toRow}) 경계를 넘습니다`,
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
              message: `셀(${r},${c})이 다른 셀과 겹칩니다`,
            });
            return;
          }
          occupied.add(key);
        }
      }
    });
  });

const imageElementSchema = z.object({
  type: z.literal('image'),
  ...elementBaseShape,
  src: srcSchema,
});

// 도형은 종류마다 의미 있는 스타일이 달라 독립 요소 타입으로 나눈다 (ADR-032):
// 선 = 색·굵기·형태·방향, 사각형 = 배경·테두리·반경, 타원·삼각형 = 배경·테두리(실선 고정)

/** 선 요소 — 상자의 두 모서리(또는 중앙선)를 잇는 선분 (ADR-032) */
const lineElementSchema = z.object({
  type: z.literal('line'),
  ...elementBaseShape,
  /** 선 색 (기본 #000000) */
  borderColor: colorSchema.optional(),
  /** 선 굵기(mm, 기본 0.2) */
  borderWidth: nonNegativeMm.optional(),
  /** 선 형태 — 파선·점선은 짧은 선분으로 분해해 그린다 (ADR-032) */
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  /**
   * 선 방향 (기본 horizontal). down = 좌상→우하, up = 좌하→우상 —
   * 상자의 두 모서리를 잇는 대각선으로 임의 선분을 표현한다
   */
  lineDirection: z.enum(['horizontal', 'vertical', 'down', 'up']).optional(),
});

/** 사각형 요소 */
const rectElementSchema = z
  .object({
    type: z.literal('rect'),
    ...elementBaseShape,
    backgroundColor: colorSchema.optional(),
    borderColor: colorSchema.optional(),
    borderWidth: nonNegativeMm.optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    /** 모서리 반경(mm) — 파선·점선과 동시 지정 금지 (곡선 구간은 분해 렌더 불가, ADR-032) */
    radius: nonNegativeMm.optional(),
  })
  .superRefine((rect, ctx) => {
    if (rect.radius !== undefined && rect.radius > 0 && rect.borderStyle !== undefined && rect.borderStyle !== 'solid') {
      ctx.addIssue({
        code: 'custom',
        path: ['radius'],
        message: 'radius와 파선·점선 테두리는 함께 지정할 수 없습니다',
      });
    }
  });

/** 타원 요소 — 상자에 내접. 곡선 테두리라 형태는 실선 고정 (ADR-032) */
const ellipseElementSchema = z.object({
  type: z.literal('ellipse'),
  ...elementBaseShape,
  backgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  borderWidth: nonNegativeMm.optional(),
});

/**
 * 정다각형 요소 — 변 수(3=삼각형, 5=오각형, 6=육각형…)로 모양을 정하고 상자에
 * 내접한다 (첫 꼭짓점 위쪽, ADR-032). 테두리는 실선 고정
 */
const polygonElementSchema = z.object({
  type: z.literal('polygon'),
  ...elementBaseShape,
  /** 변 수 (3~12) */
  sides: z.number().int().min(3, '변 수는 3 이상이어야 합니다').max(12, '변 수는 최대 12입니다'),
  backgroundColor: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  borderWidth: nonNegativeMm.optional(),
});

/** 전표 작성 시 값이 채워지는 입력 필드 */
const fieldElementSchema = z.object({
  type: z.literal('field'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 전표 values의 키 */
  binding: idSchema,
  /** 표시 전 가공용 수식 (ADR-010/017), 예: FORMAT_NUMBER(...) */
  formula: z.string().optional(),
  ...fontShape,
});

/** 요소 10종 판별 유니온 (type 필드 기준, ADR-020/032/037) */
export const slipElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  fixedGridElementSchema,
  dynamicTableElementSchema,
  gridElementSchema,
  imageElementSchema,
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

const assetEntrySchema = z.object({
  id: idSchema,
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'mimeType 형식이 아닙니다'),
  src: srcSchema,
});

const slipPageSchema = z.object({
  elements: z.array(slipElementSchema).max(SLIP_LIMITS.maxElementsPerPage, `페이지당 요소는 최대 ${SLIP_LIMITS.maxElementsPerPage}개입니다`),
});

// ---------------------------------------------------------------------------
// 전표 값 (JSON 값 — 양식 sampleValues와 전표 values가 함께 쓴다)
// ---------------------------------------------------------------------------

/** JSON으로 표현 가능한 값 (전표 values의 값 타입) */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JSON으로 표현 가능한 값 (전표 values) */
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// 양식(템플릿) 본문
// ---------------------------------------------------------------------------

/** 바인딩 정의 — 물리명(key)은 파일·수식·연동에, 논리명(label)은 화면 표시에 (ADR-032) */
const bindingDefSchema = z.object({
  key: idSchema,
  label: z.string().min(1).optional(),
});

const templateMetaSchema = z.object({
  title: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});

/** 양식 본문 — 메타·용지·페이지·에셋. id 유일성과 asset:// 참조 해소를 함께 검증한다 */
export const slipTemplateBodySchema = z
  .object({
    meta: templateMetaSchema,
    paper: paperSchema,
    pages: z.array(slipPageSchema).min(1).max(SLIP_LIMITS.maxPages, `페이지는 최대 ${SLIP_LIMITS.maxPages}개입니다`),
    assets: z.array(assetEntrySchema).max(SLIP_LIMITS.maxAssets, `에셋은 최대 ${SLIP_LIMITS.maxAssets}개입니다`),
    /** 바인딩 정의부 (선택, ADR-032) — 요소가 미등록 키를 쓰는 것도 허용한다 */
    bindings: z
      .array(bindingDefSchema)
      .max(SLIP_LIMITS.maxBindings, `바인딩 정의는 최대 ${SLIP_LIMITS.maxBindings}개입니다`)
      .optional(),
    /** 미리보기용 샘플 값 (선택, ADR-032) — 발행·무결성과 무관, 전표 생성 시 미포함 */
    sampleValues: z.record(z.string(), jsonValueSchema).optional(),
  })
  .superRefine((body, ctx) => {
    // 바인딩 정의부 key 유일성 (ADR-032)
    const bindingKeys = new Set<string>();
    body.bindings?.forEach((binding, index) => {
      if (bindingKeys.has(binding.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['bindings', index, 'key'],
          message: `바인딩 key가 중복됩니다: ${binding.key}`,
        });
      }
      bindingKeys.add(binding.key);
    });
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

/** 위변조 감지 기록 — 해시 필수, 서명 선택 (ADR-019, SPEC §8) */
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

/** 봉투 — 본문 검증 전에 schemaVersion·kind만 먼저 확인한다 (ADR-007) */
export const slipEnvelopeSchema = z.object({
  schemaVersion: semverSchema,
  kind: z.enum(['template', 'voucher']),
});

/** 양식(template) 파일 전체 */
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

/** 전표(voucher) 파일 전체 — 발행 시 무결성 기록·단독 완결을 추가 검증한다 */
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

/** .slip 파일 — kind('template' | 'voucher') 판별 유니온 */
export const slipFileSchema = z.discriminatedUnion('kind', [
  slipTemplateFileSchema,
  slipVoucherFileSchema,
]);

// ---------------------------------------------------------------------------
// 파싱 · 직렬화
// ---------------------------------------------------------------------------

/** .slip 파싱·검증 실패 오류 — message는 사용자 대면 한국어 */
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
 *
 * @param raw - 이미 파싱된 JSON 값 (예: `JSON.parse` 결과)
 * @returns 검증·마이그레이션이 끝난 .slip 파일
 * @throws SlipParseError 봉투·본문 검증 또는 마이그레이션 실패 시
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
 *
 * @param json - .slip 파일 내용 (JSON 문자열)
 * @returns 검증·마이그레이션이 끝난 .slip 파일
 * @throws SlipParseError JSON이 아니거나 봉투·본문 검증 실패 시
 *
 * @example
 * ```ts
 * const file = parseSlipFile(jsonText);
 * if (file.kind === 'template') console.log(file.template.meta.title);
 * ```
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

/**
 * .slip 파일을 저장용 JSON 문자열로 직렬화한다.
 *
 * @param file - 직렬화할 .slip 파일
 * @returns 들여쓰기 2칸의 JSON 문자열
 */
export function serializeSlipFile(file: SlipFile): string {
  return JSON.stringify(file, null, 2);
}

// ---------------------------------------------------------------------------
// 추론 타입 (Zod 스키마에서 산출 — 타입과 검증이 어긋날 수 없다)
// ---------------------------------------------------------------------------

/** 용지 크기·여백 */
export type PaperSize = z.infer<typeof paperSchema>;
/** 에셋 항목 (id · mimeType · src) */
export type AssetEntry = z.infer<typeof assetEntrySchema>;
/** 텍스트 요소 */
export type TextElement = z.infer<typeof textElementSchema>;
/** 고정 그리드의 셀 (병합 범위 포함) */
export type FixedGridCell = z.infer<typeof fixedGridCellSchema>;
/** 고정 그리드 요소 */
export type FixedGridElement = z.infer<typeof fixedGridElementSchema>;
/** 동적 행 표 요소 */
export type DynamicTableElement = z.infer<typeof dynamicTableElementSchema>;

/** 그리드 셀 (0.3.0, ADR-037) */
export type GridCell = z.infer<typeof gridCellSchema>;

/** 그리드의 반복 구간 (0.3.0, ADR-037) */
export type GridRepeat = z.infer<typeof gridRepeatSchema>;

/** 그리드 요소 — 고정 틀과 반복 목록을 하나로 다룬다 (0.3.0, ADR-037) */
export type GridElement = z.infer<typeof gridElementSchema>;
/** 동적 표의 열 정의 (물리 키·표시 제목·너비, ADR-032) */
export type TableColumn = z.infer<typeof tableColumnSchema>;
/** 바인딩 정의 (물리명 key + 논리명 label, ADR-032) */
export type BindingDef = z.infer<typeof bindingDefSchema>;
/** 이미지 요소 */
export type ImageElement = z.infer<typeof imageElementSchema>;
/** 선 요소 (ADR-032) */
export type LineElement = z.infer<typeof lineElementSchema>;
/** 사각형 요소 (ADR-032) */
export type RectElement = z.infer<typeof rectElementSchema>;
/** 타원 요소 (ADR-032) */
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
/** 정다각형 요소 (ADR-032) — sides 3=삼각형, 5=오각형 … */
export type PolygonElement = z.infer<typeof polygonElementSchema>;
/** 필드 요소 (전표 값 바인딩) */
export type FieldElement = z.infer<typeof fieldElementSchema>;
/** 요소 9종 유니온 */
export type SlipElement = z.infer<typeof slipElementSchema>;
/** 페이지 (요소 배열) */
export type SlipPage = z.infer<typeof slipPageSchema>;
/** 양식 본문 */
export type SlipTemplateBody = z.infer<typeof slipTemplateBodySchema>;
/** 무결성 기록 (ADR-019) */
export type Integrity = z.infer<typeof integritySchema>;
/** 양식 파일 */
export type SlipTemplateFile = z.infer<typeof slipTemplateFileSchema>;
/** 전표 파일 */
export type SlipVoucherFile = z.infer<typeof slipVoucherFileSchema>;
/** .slip 파일 (양식 또는 전표) */
export type SlipFile = z.infer<typeof slipFileSchema>;
/** 파일 종류 판별자 */
export type SlipFileKind = SlipFile['kind'];
