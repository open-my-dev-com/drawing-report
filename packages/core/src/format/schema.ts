/**
 * `.slip` 파일 형식을 검증하는 Zod 스키마.
 *
 * 형식 규범은 `docs/SPEC.md`를 따르며, TypeScript 타입과 JSON Schema는 이 스키마에서 생성한다.
 */
import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { migrateSlipDocument } from './migrate.js';
import { fmt, withFormatLocale, zodParseParams } from './messages.js';

export { CURRENT_SCHEMA_VERSION };

// ---------------------------------------------------------------------------
// 공통 원자 타입
// ---------------------------------------------------------------------------

/** 용지 좌표계에서 사용하는 mm 단위의 유한한 수. */
const millimeter = z.number().finite();
const nonNegativeMm = millimeter.nonnegative();
const positiveMm = millimeter.positive();

const idSchema = z.string().min(1);

/** 색상은 #RRGGBB 또는 #RRGGBBAA */
const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, { error: () => fmt().colorFormat() });

const alignmentSchema = z.enum(['left', 'center', 'right']);

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
  /** 그리드(grid) 반복 구간의 페이지당 최대 항목 수 */
  maxRepeatPerPage: 1000,
  /** 그리드(grid) 반복 구간이 그릴 수 있는 항목 수 상한 (`repeat.maxItems`의 상한) */
  maxRepeatItems: 100_000,
  /** 요소·셀당 최대 조건부 서식 규칙 수 */
  maxConditionalFormats: 20,
  /** 줄간격 배수 상한 */
  maxLineHeight: 10,
  /** 자간 절대값 상한(pt) */
  maxCharacterSpacing: 100,
} as const;

const HTTP_SRC = /^https?:\/\/\S+$/;
const DATA_SRC = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/;
const ASSET_SRC = /^asset:\/\/\S+$/;

/** 이미지 참조 문자열에 허용하는 URL, `data:` base64, `asset://` 형식. */
const srcSchema = z
  .string()
  .refine((s) => HTTP_SRC.test(s) || DATA_SRC.test(s) || ASSET_SRC.test(s), {
    error: () => fmt().srcFormat(),
  });

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
  .object({
    /** 논리값을 반환하는 조건식. 반복 구간 안에서는 현재 항목의 필드를 참조할 수 있다. */
    condition: z.string().min(1),
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

const elementBaseShape = {
  id: idSchema,
  name: z.string(),
  position: z.object({ x: nonNegativeMm, y: nonNegativeMm }),
  width: nonNegativeMm,
  height: nonNegativeMm,
  /** 같은 값을 가진 요소를 함께 선택하기 위한 그룹 식별자. */
  group: z.string().min(1).optional(),
};

/** 요소 상자 안에서 텍스트를 배치할 수직 위치. */
const verticalAlignmentSchema = z.enum(['top', 'middle', 'bottom']);

const fontShape = {
  fontName: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
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

const textElementSchema = z.object({
  type: z.literal('text'),
  ...elementBaseShape,
  ...colorStyleShape,
  /** 직접 입력한 텍스트. */
  content: z.string(),
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
const gridColumnSchema = z.object({
  width: positiveMm,
  /**
   * 자동 병합 여부. 반복 영역에서 이전 항목과 값이 같은 셀을 세로로 병합한다.
   * 반복 구간 밖은 영향받지 않는다. 켜려면 그 열의 반복 구간 셀이 구간 전체 높이를 차지해야 한다.
   */
  autoMerge: z.boolean().optional(),
});

/** 그리드 행. 높이는 mm 단위의 절대값이다. */
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
  /** 표시 값을 계산하는 수식. */
  formula: z.string().optional(),
  /** 그리드 기본 overflow 설정을 덮어쓸 셀별 처리 방식. */
  overflow: overflowSchema.optional(),
  ...fontShape,
  /** 값에 따라 색과 글자 강조를 바꾸는 조건부 서식 규칙. */
  conditionalFormats: conditionalFormatsSchema.optional(),
});

/** 항목 배열의 각 항목에 대해 지정한 행 범위를 반복하는 설정. */
const gridRepeatSchema = z.object({
  /** 전표 values에서 항목 배열(객체 배열)을 담는 키 */
  parameter: idSchema,
  /** 반복할 행 범위 (0-기반, 양끝 포함) */
  fromRow: z.number().int().nonnegative(),
  toRow: z.number().int().nonnegative(),
  /** 페이지당 항목 수 */
  perPage: z
    .number()
    .int()
    .min(1)
    .max(SLIP_LIMITS.maxRepeatPerPage, { error: () => fmt().perPageMax(SLIP_LIMITS.maxRepeatPerPage) }),
  /** 이어지는 페이지에 반복 구간 위쪽 행을 다시 그릴지 */
  repeatHeader: z.boolean(),
  /**
   * 렌더링할 최대 항목 수.
   * 이 값을 초과한 항목은 렌더링하지 않는다. 생략하면 모든 항목을 렌더링하며,
   * 지정할 때는 `perPage` 이상이어야 한다.
   */
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(SLIP_LIMITS.maxRepeatItems, { error: () => fmt().maxItemsMax(SLIP_LIMITS.maxRepeatItems) })
    .optional(),
})
  .superRefine((repeat, ctx) => {
    if (repeat.maxItems !== undefined && repeat.maxItems < repeat.perPage) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxItems'],
        message: fmt().maxItemsBelowPerPage(),
      });
    }
  });

/** 고정 행과 반복 행으로 구성된 그리드. */
const gridElementObject = z.object({
  type: z.literal('grid'),
  ...elementBaseShape,
  ...colorStyleShape,
  ...fontShape,
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
  /** 반복 행 설정. 생략하면 모든 행을 한 번씩 렌더링한다. */
  repeat: gridRepeatSchema.optional(),
  /** 셀을 넘치는 글의 처리 (기본 clip) */
  overflow: overflowSchema.optional(),
});

// 여러 필드를 함께 확인해야 하는 그리드 제약을 항목별로 검증한다.
type GridInput = z.infer<typeof gridElementObject>;

/** 요소 크기가 행 높이와 열 너비의 합과 일치하는지 검사한다 (SPEC §5.7). */
function checkGridTrackSums(grid: GridInput, ctx: z.RefinementCtx): void {
  const totalWidth = grid.columns.reduce((sum, col) => sum + col.width, 0);
  const templateHeight = grid.rows.reduce((sum, row) => sum + row.height, 0);
  // 반복 구간은 페이지마다 perPage번 배치된다.
  const bandHeight = grid.repeat
    ? grid.rows.slice(grid.repeat.fromRow, grid.repeat.toRow + 1).reduce((sum, row) => sum + row.height, 0)
    : 0;
  const totalHeight = templateHeight + (grid.repeat ? (grid.repeat.perPage - 1) * bandHeight : 0);
  if (Math.abs(totalWidth - grid.width) > 0.01) {
    ctx.addIssue({
      code: 'custom',
      path: ['columns'],
      message: fmt().columnWidthSum(totalWidth, grid.width),
    });
  }
  if (Math.abs(totalHeight - grid.height) > 0.01) {
    ctx.addIssue({
      code: 'custom',
      path: ['rows'],
      message: fmt().rowHeightSum(totalHeight, grid.height, grid.repeat !== undefined),
    });
  }
}

/** 반복 구간이 올바른 순서이며 행 범위 안에 있는지 검사한다. */
function checkGridRepeatRange(grid: GridInput, ctx: z.RefinementCtx): void {
  if (!grid.repeat) return;
  const { fromRow, toRow } = grid.repeat;
  if (fromRow > toRow) {
    ctx.addIssue({ code: 'custom', path: ['repeat', 'fromRow'], message: fmt().fromRowAboveToRow() });
  } else if (toRow >= grid.rows.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['repeat', 'toRow'],
      message: fmt().repeatOutOfRange(fromRow, toRow, grid.rows.length),
    });
  }
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
    // 병합 셀은 반복 구간의 안이나 밖에 완전히 포함되어야 한다.
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
          message: fmt().cellSpanCrossesRepeat(cell.row, cell.column, fromRow, toRow),
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
 * 자동 병합 열의 반복 구간이 하나의 셀로 구성되었는지 검사한다.
 * 반복 구간이 여러 셀로 나뉜 열에는 자동 병합을 적용할 수 없다.
 *
 * @param cellOriginAt - {@link checkGridCells}가 만든 좌표별 셀 시작점 맵
 */
function checkGridAutoMerge(grid: GridInput, ctx: z.RefinementCtx, cellOriginAt: Map<string, string>): void {
  grid.columns.forEach((column, c) => {
    if (column.autoMerge !== true) return;
    if (!grid.repeat) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns', c, 'autoMerge'],
        message: fmt().autoMergeNeedsRepeat(c),
      });
      return;
    }
    const { fromRow, toRow } = grid.repeat;
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
  });

/** 렌더링 엔진이 지원하는 바코드 종류 */
const barcodeKindSchema = z.enum([
  'qrcode', 'code128', 'ean13',
  'code39', 'ean8', 'upca', 'upce', 'itf14', 'nw7',
  'japanpost', 'gs1datamatrix', 'pdf417',
]);

/** 직접 입력, 전표 값 또는 수식 결과를 표시하는 바코드 요소 */
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
    /** 표시 값을 계산하는 수식. */
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
        message: fmt().barcodeSourceExclusive(),
      });
    }
  });

// 도형별로 지원하는 스타일이 달라 요소 타입을 구분한다.

/** 요소 영역의 두 모서리 또는 중앙을 잇는 선. */
const lineElementSchema = z.object({
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
  .object({
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
const ellipseElementSchema = z.object({
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
const polygonElementSchema = z.object({
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
  .object({
    type: z.literal('field'),
    ...elementBaseShape,
    ...colorStyleShape,
    /** 전표 `values`의 키. 수식을 사용할 때는 지정하지 않는다. */
    parameter: idSchema.optional(),
    /** 표시 값을 계산하는 수식. 예: `FORMAT_NUMBER(...)`. */
    formula: z.string().optional(),
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
        message: fmt().paddingTooLarge(),
      });
    }
  });

const assetEntrySchema = z.object({
  id: idSchema,
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, { error: () => fmt().mimeTypeFormat() }),
  src: srcSchema,
});

/** 페이지 번호를 표시할 위치 */
const pageNumberPositionSchema = z.enum([
  'bottom-left', 'bottom-center', 'bottom-right',
  'top-left', 'top-center', 'top-right',
]);

/** PDF 후처리 단계에서 추가하는 페이지 번호 설정 */
const pageNumberSchema = z.object({
  position: pageNumberPositionSchema,
  /** `{n}`은 현재 페이지, `{total}`은 전체 페이지 수로 치환된다. */
  format: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
});

const slipPageSchema = z.object({
  elements: z
    .array(slipElementSchema)
    .max(SLIP_LIMITS.maxElementsPerPage, { error: () => fmt().elementsMax(SLIP_LIMITS.maxElementsPerPage) }),
  /** 호스트가 페이지를 식별할 때 사용하는 문서 내 고유 키 */
  key: idSchema.optional(),
  /** 썸네일과 목록에 표시할 페이지 이름 */
  label: z.string().min(1).optional(),
  /** 페이지 번호 표시 설정 */
  pageNumber: pageNumberSchema.optional(),
});

// ---------------------------------------------------------------------------
// 전표 값
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

/** 작성 폼의 입력 방식과 사용 가능한 함수를 결정하는 파라미터 값 종류 */
const parameterValueTypeSchema = z.enum(['text', 'number', 'date', 'boolean', 'image', 'list']);

/**
 * 목록 항목에 포함되는 하위 필드 정의.
 * 목록 항목은 한 단계의 객체이며 하위 필드를 중첩할 수 없다.
 */
const parameterFieldSchema = z.object({
  key: idSchema,
  label: z.string().min(1).optional(),
  valueType: parameterValueTypeSchema.optional(),
});

/**
 * 파라미터 정의.
 * `key`는 파일, 수식, 외부 연동에서 사용하고 `label`은 화면에 표시한다.
 * `valueType`이 `list`이면 목록 항목의 필드를 `fields`에 선언한다.
 */
const parameterDefSchema = z
  .object({
    key: idSchema,
    label: z.string().min(1).optional(),
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

const templateMetaSchema = z.object({
  title: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});

/** 양식 본문. 식별자 중복과 `asset://` 참조의 유효성도 검증한다. */
export const slipTemplateBodySchema = z
  .object({
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
    sampleValues: z.record(z.string(), jsonValueSchema).optional(),
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
export const slipTemplateFileSchema = z.object({
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
  .object({
    schemaVersion: semverSchema,
    kind: z.literal('voucher'),
    /** 전표를 생성할 때 복사한 양식 본문. */
    templateSnapshot: slipTemplateBodySchema,
    /** 필드 파라미터 키별 값 */
    values: z.record(z.string(), jsonValueSchema),
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
    // 이미지 파라미터 값은 data: base64 형식인지 검증한다.
    // 빈 문자열은 이미지가 없는 값으로 허용한다.
    for (const page of voucher.templateSnapshot.pages) {
      for (const element of page.elements) {
        if (element.type !== 'image' || element.parameter === undefined) continue;
        const value = voucher.values[element.parameter];
        if (typeof value === 'string' && value !== '' && !DATA_SRC.test(value)) {
          ctx.addIssue({
            code: 'custom',
            path: ['values', element.parameter],
            message: HTTP_SRC.test(value) ? fmt().issuedExternalImage() : fmt().imageValueFormat(),
          });
        }
      }
    }
  });

/** `kind`로 양식과 전표를 구분하는 `.slip` 파일 스키마 */
export const slipFileSchema = z.discriminatedUnion('kind', [
  slipTemplateFileSchema,
  slipVoucherFileSchema,
]);

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

/** 그리드의 반복 구간. */
export type GridRepeat = z.infer<typeof gridRepeatSchema>;

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
