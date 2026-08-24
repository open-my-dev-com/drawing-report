/**
 * .slip 파일 포맷 상세 스키마 (Zod-first — 여기서 정의한 스키마가 진실의 원천).
 *
 * 근거 ADR: 007(JSON 자체 스키마·마이그레이션) · 008(양식 스냅샷) · 011(용지 좌표계) ·
 * 019(해시·서명) · 020(요소 종류) · 022(JSON Schema 동봉) · 036(이미지 base64) · 047(파라미터 정의부).
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
  /** 그리드 최대 셀 수 */
  maxGridCells: 100_000,
  /** 파라미터 정의부 최대 항목 수 */
  maxParameters: 500,
  /** 그리드(grid) 최대 행 수 */
  maxGridRowTracks: 1000,
  /** 그리드(grid) 최대 열 수 */
  maxGridColumnTracks: 100,
  /** 그리드(grid) 반복 구간의 페이지당 최대 항목 수 */
  maxRepeatPerPage: 1000,
  /** 그리드(grid) 반복 구간이 그릴 수 있는 항목 수 상한 (`repeat.maxItems`의 상한) */
  maxRepeatItems: 100_000,
  /** 줄간격 배수 상한 */
  maxLineHeight: 10,
  /** 자간 절대값 상한(pt) */
  maxCharacterSpacing: 100,
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

/** 수직 정렬 — 상자 안에서 글이 놓이는 세로 자리 */
const verticalAlignmentSchema = z.enum(['top', 'middle', 'bottom']);

const fontShape = {
  fontName: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  alignment: alignmentSchema.optional(),
  /** 수직 정렬 — 생략하면 상단 */
  verticalAlignment: verticalAlignmentSchema.optional(),
  /**
   * 굵게 — 렌더 시 유효 폰트의 `<이름>-Bold` 폰트로 전환한다.
   * 굵은 폰트가 없으면 PDF에서는 무시된다 (ADR-032, SPEC §5)
   */
  bold: z.boolean().optional(),
  /**
   * 기울임 — 굵게와 같은 방식으로 `<이름>-Italic` 폰트로 전환한다.
   * 자형 폰트가 없으면 PDF에서는 무시된다 — 기울이기 흉내는 내지 않는다 (ADR-032)
   */
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  /** 줄간격 배수 — 생략하면 1 */
  lineHeight: z.number().positive().max(SLIP_LIMITS.maxLineHeight).optional(),
  /** 자간(pt) — 생략하면 0. 음수는 글자를 좁힌다 */
  characterSpacing: z.number().min(-SLIP_LIMITS.maxCharacterSpacing).max(SLIP_LIMITS.maxCharacterSpacing).optional(),
  /**
   * 세로쓰기 — 글자를 한 자씩 세로로 쌓는다.
   * 하부 엔진에 세로쓰기 기능이 없어 변환 계층이 직접 쌓는다 (직접 확인).
   */
  vertical: z.boolean().optional(),
};

// ---------------------------------------------------------------------------
// 요소 6종 (ADR-020)
// ---------------------------------------------------------------------------

const textElementSchema = z.object({
  type: z.literal('text'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 직접 입력한 글 (수식·플레이스홀더 포함 가능) */
  content: z.string(),
  ...fontShape,
});

// ---------------------------------------------------------------------------
// grid — 고정 틀과 반복 목록을 하나로 다루는 그리드 (ADR-037)
// ---------------------------------------------------------------------------

/** 셀을 넘치는 글의 처리 — 잘라내거나 글자 크기를 줄여 넣는다 (ADR-037) */
const overflowSchema = z.enum(['clip', 'shrink']);

/** 그리드 열 — 너비는 mm 절대값이라 열을 더해도 다른 열이 변하지 않는다 (ADR-037) */
const gridColumnSchema = z.object({
  width: positiveMm,
  /**
   * 데이터 자동 병합 (ADR-038) — 반복 구간에서 앞 벌과 값이 같은 셀을 세로로 합친다.
   * 반복 구간 밖은 영향받지 않는다. 켜려면 그 열의 반복 구간 셀이 구간 전체 높이를 차지해야 한다.
   */
  autoMerge: z.boolean().optional(),
});

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
  /** 직접 입력한 글 */
  content: z.string().optional(),
  /** 값 키 — 반복 구간 안이면 그 항목의 필드, 밖이면 전표 values의 키 */
  parameter: idSchema.optional(),
  /** 표시 전 가공 수식 (ADR-010/017) */
  formula: z.string().optional(),
  /** 셀을 넘치는 글의 처리 — 요소 값을 덮어쓴다 */
  overflow: overflowSchema.optional(),
  ...fontShape,
});

/** 반복 구간 — 지정한 행 범위가 항목 배열만큼 복제된다 (ADR-037) */
const gridRepeatSchema = z.object({
  /** 전표 values에서 항목 배열(객체 배열)을 담는 키 */
  parameter: idSchema,
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
  /**
   * 그릴 항목 수 상한 (선택, ADR-048) — 넘는 항목은 그리지 않는다.
   * 정하지 않으면 항목 수만큼 페이지가 늘어난다. `perPage` 이상이어야 한다.
   */
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(SLIP_LIMITS.maxRepeatItems, `maxItems는 최대 ${SLIP_LIMITS.maxRepeatItems}입니다`)
    .optional(),
})
  .superRefine((repeat, ctx) => {
    if (repeat.maxItems !== undefined && repeat.maxItems < repeat.perPage) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxItems'],
        message: 'maxItems는 perPage보다 작을 수 없습니다',
      });
    }
  });

/** 고정 틀과 반복 목록을 하나로 다루는 그리드 (ADR-037) */
const gridElementObject = z.object({
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
  /** 셀을 넘치는 글의 처리 (기본 clip) */
  overflow: overflowSchema.optional(),
});

// 그리드 교차 필드 검증 — 관심사별 헬퍼로 나눠 각각 따로 읽힌다 (ADR-037).
type GridInput = z.infer<typeof gridElementObject>;

/** 요소 상자 = 행 높이·열 너비의 합인지 검사 (비율이 아니라 mm 절대값, SPEC §5.7) */
function checkGridTrackSums(grid: GridInput, ctx: z.RefinementCtx): void {
  const totalWidth = grid.columns.reduce((sum, col) => sum + col.width, 0);
  const templateHeight = grid.rows.reduce((sum, row) => sum + row.height, 0);
  // 반복 구간은 페이지마다 perPage번 복제되므로 요소 높이도 그만큼이다
  const bandHeight = grid.repeat
    ? grid.rows.slice(grid.repeat.fromRow, grid.repeat.toRow + 1).reduce((sum, row) => sum + row.height, 0)
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
}

/** 반복 구간 범위가 유효한지 검사 (fromRow ≤ toRow, 행 수 안) */
function checkGridRepeatRange(grid: GridInput, ctx: z.RefinementCtx): void {
  if (!grid.repeat) return;
  const { fromRow, toRow } = grid.repeat;
  if (fromRow > toRow) {
    ctx.addIssue({ code: 'custom', path: ['repeat', 'fromRow'], message: 'fromRow는 toRow보다 클 수 없습니다' });
  } else if (toRow >= grid.rows.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['repeat', 'toRow'],
      message: `반복 구간(${fromRow}~${toRow})이 행 수(${grid.rows.length})를 벗어납니다`,
    });
  }
}

/**
 * 셀의 소스 배타·범위·병합 경계·겹침을 검사한다.
 *
 * @returns (행,열) → 그 셀을 차지하는 셀의 원점 좌표 맵 — 자동 병합 검사에서 소비한다
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
        message: `셀(${cell.row},${cell.column})은 content·parameter·formula 중 하나만 가질 수 있습니다`,
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
    // 병합이 반복 구간 경계를 넘으면 복제할 때 모양이 무너진다.
    // 합법인 경우는 셋뿐이다: 구간보다 완전히 위 · 완전히 아래 · 구간 안에 완전히 포함.
    // 경계를 걸치거나 구간을 통째로 감싸는 병합은 거부한다.
    if (grid.repeat && rowSpan > 1) {
      const { fromRow, toRow } = grid.repeat;
      const last = cell.row + rowSpan - 1;
      const entirelyAbove = last < fromRow;
      const entirelyBelow = cell.row > toRow;
      const entirelyInside = cell.row >= fromRow && last <= toRow;
      if (!(entirelyAbove || entirelyBelow || entirelyInside)) {
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
        cellOriginAt.set(key, `${cell.row},${cell.column}`);
      }
    }
  });
  return cellOriginAt;
}

/**
 * 데이터 자동 병합 열 검사 (ADR-038) — 켠 열은 그 열의 반복 구간 셀이 구간 전체를 한 셀으로
 * 덮어야 한다. 한 줄 구간이면 저절로 성립하고, 여러 줄인데 셀이 줄마다 갈라지면 거부한다.
 *
 * @param cellOriginAt - {@link checkGridCells}가 만든 (행,열)→원점 맵
 */
function checkGridAutoMerge(grid: GridInput, ctx: z.RefinementCtx, cellOriginAt: Map<string, string>): void {
  grid.columns.forEach((column, c) => {
    if (column.autoMerge !== true) return;
    if (!grid.repeat) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns', c, 'autoMerge'],
        message: `${c}열의 자동 병합은 반복 구간이 있어야 켤 수 있습니다`,
      });
      return;
    }
    const { fromRow, toRow } = grid.repeat;
    const topOrigin = cellOriginAt.get(`${fromRow},${c}`);
    const notCovered = `${c}열의 자동 병합은 그 열의 반복 구간 셀이 구간 전체 높이를 차지할 때만 켤 수 있습니다`;
    // 그 열의 반복 구간에 셀이 아예 없으면(빈 열) 덮을 셀이 없으므로 켤 수 없다.
    // (그냥 두면 모든 조회가 undefined === undefined로 통과해 버린다.)
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

const gridElementSchema = gridElementObject.superRefine((grid, ctx) => {
  checkGridTrackSums(grid, ctx);
  checkGridRepeatRange(grid, ctx);
  const cellOriginAt = checkGridCells(grid, ctx);
  checkGridAutoMerge(grid, ctx, cellOriginAt);
});

const imageElementSchema = z
  .object({
    type: z.literal('image'),
    ...elementBaseShape,
    /** 고정 이미지의 자리 (§3.1의 3형식). `parameter`를 쓰면 생략할 수 있다 */
    src: srcSchema.optional(),
    /**
     * 전표 값에서 이미지를 읽어 오는 키 — 전표마다 다른 이미지를 넣는다.
     * 값은 `data:` base64만 받는다 (ADR-036) — `values`는 JSON이라 바이너리를 담지 못하고,
     * core는 네트워크를 쓰지 않아 URL을 받아올 수 없다 (ADR-002).
     */
    parameter: idSchema.optional(),
  })
  .superRefine((image, ctx) => {
    // 둘 다 없으면 그릴 것이 없고, 둘 다 있으면 어느 쪽을 그릴지 정해지지 않는다
    if (image.src === undefined && image.parameter === undefined) {
      ctx.addIssue({ code: 'custom', path: ['src'], message: '이미지는 src 또는 parameter 중 하나가 필요합니다' });
    }
    if (image.src !== undefined && image.parameter !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['parameter'], message: '이미지는 src와 parameter를 함께 가질 수 없습니다' });
    }
  });

/**
 * 바코드 종류 — 하부 엔진이 그릴 수 있는 12종을 그대로 연다.
 * 전표에 흔한 `qrcode`·`code128`·`ean13`을 앞에 둔다.
 */
const barcodeKindSchema = z.enum([
  'qrcode', 'code128', 'ean13',
  'code39', 'ean8', 'upca', 'upce', 'itf14', 'nw7',
  'japanpost', 'gs1datamatrix', 'pdf417',
]);

/** 바코드 요소 — 값은 직접 입력·전표 값·수식 중 하나 */
const barcodeElementSchema = z
  .object({
    type: z.literal('barcode'),
    ...elementBaseShape,
    /** 바코드 종류 */
    kind: barcodeKindSchema,
    /** 직접 입력한 글 */
    content: z.string().optional(),
    /** 전표 values의 키 */
    parameter: idSchema.optional(),
    /** 표시 전 가공 수식 (ADR-010/017) */
    formula: z.string().optional(),
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
        message: '바코드는 content·parameter·formula 중 하나만 가져야 합니다',
      });
    }
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

/**
 * 전표 작성 시 값이 채워지는 입력 필드.
 *
 * @remarks
 * 값 소스는 **파라미터와 수식 중 하나**다 (ADR-049) — 그리드 셀·바코드와 같은 규칙이다.
 * 둘을 함께 두면 수식이 이기고 파라미터는 아무 일도 하지 않아, 화면에서 무엇이 쓰이는지
 * 알 수 없었다.
 */
const fieldElementSchema = z
  .object({
    type: z.literal('field'),
    ...elementBaseShape,
    ...colorStyleShape,
    /** 전표 values의 키 — 수식을 쓰면 두지 않는다 */
    parameter: idSchema.optional(),
    /** 표시 값을 계산하는 수식 (ADR-010/017), 예: FORMAT_NUMBER(...) */
    formula: z.string().optional(),
    ...fontShape,
  })
  .superRefine((field, ctx) => {
    const sources = [field.parameter, field.formula].filter((v) => v !== undefined);
    if (sources.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['parameter'],
        message: `필드 '${field.name}'는 parameter·formula 중 하나만 가져야 합니다`,
      });
    }
  });

/** 요소 9종 판별 유니온 (type 필드 기준, ADR-020/032/037 + 바코드) */
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

/** 페이지 번호를 찍는 자리 — 아래·위 가장자리의 좌·중앙·우 */
const pageNumberPositionSchema = z.enum([
  'bottom-left', 'bottom-center', 'bottom-right',
  'top-left', 'top-center', 'top-right',
]);

/** 페이지 번호 표시 — 실제 번호는 PDF 후처리로 넣는다 */
const pageNumberSchema = z.object({
  position: pageNumberPositionSchema,
  /** `{n}`은 현재 쪽, `{total}`은 전체 쪽 수로 바뀐다 (생략하면 `{n} / {total}`) */
  format: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
});

const slipPageSchema = z.object({
  elements: z.array(slipElementSchema).max(SLIP_LIMITS.maxElementsPerPage, `페이지당 요소는 최대 ${SLIP_LIMITS.maxElementsPerPage}개입니다`),
  /** 페이지 물리명 — 문서 안에서 유일. 호스트가 페이지를 가리킬 때 쓴다 */
  key: idSchema.optional(),
  /** 페이지 논리명 — 썸네일·목록에 번호 대신 보인다 */
  label: z.string().min(1).optional(),
  /** 페이지 번호 표시 — 생략하면 찍지 않는다 */
  pageNumber: pageNumberSchema.optional(),
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

/** 파라미터 값의 종류 — 작성폼 입력 방식과 쓸 수 있는 함수를 가리는 데 쓴다 */
const parameterValueTypeSchema = z.enum(['text', 'number', 'date', 'boolean', 'image', 'list']);

/**
 * 목록 파라미터의 하위 필드 정의 — 항목 하나가 가진 값이다 (ADR-047).
 * 항목은 평평한 객체라 하위 필드는 다시 하위를 갖지 않는다 (ADR-038).
 */
const parameterFieldSchema = z.object({
  key: idSchema,
  label: z.string().min(1).optional(),
  valueType: parameterValueTypeSchema.optional(),
});

/**
 * 파라미터 정의 — 물리명(key)은 파일·수식·연동에, 논리명(label)은 화면 표시에 (ADR-032).
 * `valueType: 'list'`면 항목이 가진 값을 `fields`로 선언한다 (ADR-047).
 */
const parameterDefSchema = z
  .object({
    key: idSchema,
    label: z.string().min(1).optional(),
    /** 값 종류 — 생략하면 글자로 다룬다 */
    valueType: parameterValueTypeSchema.optional(),
    /** 목록 항목의 하위 필드 — `valueType: 'list'`에서만 쓴다 (ADR-047) */
    fields: z.array(parameterFieldSchema).optional(),
  })
  .superRefine((def, ctx) => {
    if (def.fields === undefined) return;
    if (def.valueType !== 'list') {
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: "하위 필드는 valueType이 'list'인 파라미터에만 둘 수 있습니다",
      });
    }
    const seen = new Set<string>();
    def.fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'key'],
          message: `하위 필드 이름이 중복됩니다: ${field.key}`,
        });
      }
      seen.add(field.key);
    });
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
    /** 파라미터 정의부 (선택, ADR-032) — 요소가 미등록 키를 쓰는 것도 허용한다 */
    parameters: z
      .array(parameterDefSchema)
      .max(SLIP_LIMITS.maxParameters, `파라미터 정의는 최대 ${SLIP_LIMITS.maxParameters}개입니다`)
      .optional(),
    /** 미리보기용 샘플 값 (선택, ADR-032) — 발행·무결성과 무관, 전표 생성 시 미포함 */
    sampleValues: z.record(z.string(), jsonValueSchema).optional(),
  })
  .superRefine((body, ctx) => {
    // 파라미터 정의부 key 유일성 (ADR-032)
    const parameterKeys = new Set<string>();
    body.parameters?.forEach((parameter, index) => {
      if (parameterKeys.has(parameter.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parameters', index, 'key'],
          message: `파라미터 key가 중복됩니다: ${parameter.key}`,
        });
      }
      parameterKeys.add(parameter.key);
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
        if (referencedId === asset.id) {
          // 자기 자신을 가리키면 해소가 무한 루프가 된다
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'src'],
            message: `에셋이 자기 자신을 참조합니다: ${asset.id}`,
          });
        } else if (!assetIds.has(referencedId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'src'],
            message: `참조하는 에셋이 없습니다: ${referencedId}`,
          });
        }
      }
    });
    // 페이지 물리명(key) 유일성 (SPEC §4) — 호스트가 페이지를 가리키는 이름이라 겹치면 안 된다
    const pageKeys = new Set<string>();
    body.pages.forEach((page, pageIndex) => {
      if (page.key === undefined) return;
      if (pageKeys.has(page.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pages', pageIndex, 'key'],
          message: `페이지 key가 중복됩니다: ${page.key}`,
        });
      }
      pageKeys.add(page.key);
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
        if (element.type === 'image' && element.src?.startsWith('asset://') === true) {
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

/** 스냅샷 안에서 외부 URL 참조를 찾는다 (발행 파일 완결성 검사용, ADR-036) */
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

/** 전표(voucher) 파일 전체 — 발행 시 무결성 기록·단독 완결을 추가 검증한다 */
export const slipVoucherFileSchema = z
  .object({
    schemaVersion: semverSchema,
    kind: z.literal('voucher'),
    /** 생성 시점 양식 전체 스냅샷 (ADR-008) */
    templateSnapshot: slipTemplateBodySchema,
    /** 필드 파라미터 키 → 값 */
    values: z.record(z.string(), jsonValueSchema),
    /** 발행(확정) 여부. 발행 시 이미지 내장(ADR-036)·무결성 기록(ADR-019) */
    issued: z.boolean(),
  })
  .superRefine((voucher, ctx) => {
    if (!voucher.issued) return;
    // ADR-036: 발행 파일은 외부 URL 의존 없이 단독 완결이어야 한다
    const externalPath = findExternalUrlPath(voucher.templateSnapshot);
    if (externalPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['templateSnapshot', ...externalPath],
        message: '발행(issued)된 전표는 외부 URL 이미지를 포함할 수 없습니다 (base64 내장 필요)',
      });
    }
    // 변동 이미지 값(values)도 훑는다 — 템플릿 src만 보던 검사의 사각지대(ADR-036).
    // 이미지 요소가 참조하는 파라미터 값이 채워져 있으면 고정 src와 같은 data: base64 형식이어야
    // 한다(외부 URL·깨진 data: 모두 거부). 비어 있으면 이미지 없음이라 허용한다.
    for (const page of voucher.templateSnapshot.pages) {
      for (const element of page.elements) {
        if (element.type !== 'image' || element.parameter === undefined) continue;
        const value = voucher.values[element.parameter];
        if (typeof value === 'string' && value !== '' && !DATA_SRC.test(value)) {
          ctx.addIssue({
            code: 'custom',
            path: ['values', element.parameter],
            message: HTTP_SRC.test(value)
              ? '발행(issued)된 전표는 외부 URL 이미지를 포함할 수 없습니다 (base64 내장 필요)'
              : '변동 이미지 값은 data:<mime>;base64 형식이어야 합니다',
          });
        }
      }
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
  let result: ReturnType<typeof slipFileSchema.safeParse>;
  try {
    result = slipFileSchema.safeParse(migrated);
  } catch (error) {
    // z.lazy 값 스키마의 재귀가 지나치게 깊은 값에서 스택을 넘기면 RangeError가
    // safeParse를 벗어난다 — @throws 계약대로 SlipParseError로 감싼다 (SPEC §3.2).
    if (error instanceof RangeError) {
      throw new SlipParseError('.slip 본문의 값 중첩이 너무 깊습니다');
    }
    throw error;
  }
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
 * @returns 들여쓰기 2셀의 JSON 문자열
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

/** 그리드 셀 (ADR-037) */
export type GridCell = z.infer<typeof gridCellSchema>;

/** 그리드의 반복 구간 (ADR-037) */
export type GridRepeat = z.infer<typeof gridRepeatSchema>;

/** 그리드 요소 — 고정 틀과 반복 목록을 하나로 다룬다 (ADR-037) */
export type GridElement = z.infer<typeof gridElementSchema>;
/** 파라미터 정의 (물리명 key + 논리명 label, ADR-032/047) */
export type ParameterDef = z.infer<typeof parameterDefSchema>;
/** 목록 파라미터의 하위 필드 정의 (ADR-047) */
export type ParameterField = z.infer<typeof parameterFieldSchema>;
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
/** .slip 파일 (양식 또는 전표) */
export type SlipFile = z.infer<typeof slipFileSchema>;
/** 파일 종류 판별자 */
export type SlipFileKind = SlipFile['kind'];
