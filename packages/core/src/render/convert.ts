/**
 * 우리 포맷(.slip) → pdfme 템플릿 변환 계층 (내부 전용, ADR-016).
 *
 * - 좌표·길이는 양쪽 다 mm라 단위 변환이 없다 (ADR-011).
 * - pdfme 스키마 속성은 **전부 채워서** 넘긴다 — 일부만 채우면 조용히 레이아웃이
 *   깨진다 (Q08 직접 확인, docs/Q08-PDFME-EVAL.md).
 * - 렌더 값은 전부 `inputs`로 전달한다(`readOnly`를 쓰지 않는다). readOnly 스키마는
 *   pdfme가 `content`의 `{...}`를 자체 표현식으로 평가하는데, 수식은 우리 파서만
 *   쓴다는 ADR-010에 어긋나기 때문이다.
 *
 * 이 모듈은 공개 API가 아니다 (index.ts에서 수출하지 않는다).
 */
import type { Schema, Template } from '@pdfme/common';
import { evaluateFormula } from '../formula/evaluator.js';
import type {
  EllipseElement,
  FieldElement,
  GridCell,
  GridElement,
  ImageElement,
  LineElement,
  RectElement,
  SlipElement,
  SlipFile,
  SlipTemplateBody,
  PolygonElement,
  TextElement,
} from '../format/schema.js';
import { SlipRenderError } from './errors.js';
import { TextMeasurer } from './measure.js';
import type { SlipFont } from './types.js';

// ---------------------------------------------------------------------------
// 기본값 (SPEC에 없는 표현 세부는 여기서 한 곳에 모아 정한다)
// ---------------------------------------------------------------------------

const DEFAULT_FONT_SIZE = 10;
const DEFAULT_FONT_COLOR = '#000000';
const DEFAULT_BORDER_COLOR = '#000000';
/** 선·테두리 두께 기본값(mm) */
const DEFAULT_BORDER_WIDTH = 0.2;
/** pdfme에서 '색 없음'은 빈 문자열이다 */
const NO_COLOR = '';
/** 그리드 칸 안쪽 여백(mm) */
const GRID_CELL_PADDING = 1;
/** 글자를 줄여 넣을 때의 최소 크기(pt) — 이보다 작으면 읽을 수 없다 (ADR-037) */
const MIN_SHRINK_FONT_SIZE = 4;
/**
 * 파선·점선의 선분·간격 길이(mm) — 하부 엔진이 파선을 직접 지원하지 않아
 * 짧은 선분 여러 개로 분해해 그린다 (직선만 가능, ADR-032)
 */
const DASH_PATTERNS = {
  dashed: { on: 2.4, off: 1.2 },
  dotted: { on: 0.4, off: 0.8 },
} as const;

type BorderStyle = 'solid' | 'dashed' | 'dotted';

type Alignment = 'left' | 'center' | 'right';
type VerticalAlignment = 'top' | 'middle' | 'bottom';

interface BoxDimension {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function box(value: number): BoxDimension {
  return { top: value, right: value, bottom: value, left: value };
}

/** 변환 결과 — pdfme generate()에 그대로 넘길 수 있는 형태 */
export interface PdfmeRenderInput {
  template: Template;
  inputs: Record<string, string>[];
}

// ---------------------------------------------------------------------------
// 값 문자열화 (수식 엔진 CONCAT의 문자열화 규칙과 같다)
// ---------------------------------------------------------------------------

function toDisplayText(value: unknown, what: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SlipRenderError(`${what}의 값이 유한한 수가 아닙니다`);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  throw new SlipRenderError(`${what}의 값은 배열·객체라서 텍스트로 표시할 수 없습니다`);
}

// ---------------------------------------------------------------------------
// 변환기
// ---------------------------------------------------------------------------

class SlipToPdfmeConverter {
  private readonly usedNames = new Set<string>();
  private readonly inputs: Record<string, string> = {};

  constructor(
    private readonly body: SlipTemplateBody,
    private readonly values: Record<string, unknown>,
    private readonly locale?: string,
    private readonly fontNames: readonly string[] = [],
    private readonly fallbackFontName?: string,
    private readonly measurer: TextMeasurer = new TextMeasurer(),
  ) {}

  /**
   * 굵게에 쓸 폰트 이름 — 유효 폰트(명시 fontName, 없으면 대체 폰트)의 `<이름>-Bold`가
   * 렌더 옵션 폰트 목록에 있으면 그 이름을, 없으면 undefined(굵게 무시, ADR-032)
   */
  private resolveBoldFont(fontName: string | undefined): string | undefined {
    const base = fontName ?? this.fallbackFontName;
    if (!base) return undefined;
    const candidate = `${base}-Bold`;
    return this.fontNames.includes(candidate) ? candidate : undefined;
  }

  convert(): PdfmeRenderInput {
    // 반복 그리드가 넘치면 그 슬립 페이지를 여러 출력 페이지로 낸다 (ADR-037).
    // 나머지 요소는 페이지마다 그대로 다시 그린다 — 그리드 크기가 고정이라 자리가 흔들리지 않는다.
    const schemas: Schema[][] = [];
    for (const page of this.body.pages) {
      const pageCount = this.renderPageCount(page.elements);
      for (let renderPage = 0; renderPage < pageCount; renderPage++) {
        const pageSchemas: Schema[] = [];
        for (const element of page.elements) {
          this.appendElement(pageSchemas, element, renderPage);
        }
        schemas.push(pageSchemas);
      }
    }
    const template: Template = {
      basePdf: {
        width: this.body.paper.width,
        height: this.body.paper.height,
        padding: this.body.paper.padding,
      },
      schemas,
    };
    return { template, inputs: [this.inputs] };
  }

  /** 한 슬립 페이지가 차지하는 출력 페이지 수 — 반복 그리드 중 가장 많은 페이지를 따른다 (SPEC §5.7) */
  private renderPageCount(elements: readonly SlipElement[]): number {
    let count = 1;
    for (const element of elements) {
      if (element.type !== 'grid' || !element.repeat) continue;
      const items = this.repeatItems(element, element.repeat.binding);
      count = Math.max(count, Math.ceil(items.length / element.repeat.perPage) || 1);
    }
    return count;
  }

  /** pdfme는 이름으로 값을 찾으므로 문서 전체에서 이름이 유일해야 한다 */
  private uniqueName(base: string): string {
    if (!this.usedNames.has(base)) {
      this.usedNames.add(base);
      return base;
    }
    let suffix = 2;
    while (this.usedNames.has(`${base}#${suffix}`)) suffix++;
    const name = `${base}#${suffix}`;
    this.usedNames.add(name);
    return name;
  }

  private push(schemas: Schema[], schema: Record<string, unknown>, value: string): void {
    const name = this.uniqueName(String(schema.name));
    this.inputs[name] = value;
    schemas.push({ ...schema, name } as Schema);
  }

  private appendElement(schemas: Schema[], element: SlipElement, renderPage = 0): void {
    switch (element.type) {
      case 'text':
        this.appendText(schemas, element);
        return;
      case 'field':
        this.appendField(schemas, element);
        return;
      case 'grid':
        this.appendGrid(schemas, element, renderPage);
        return;
      case 'image':
        this.appendImage(schemas, element);
        return;
      case 'line':
        this.appendLine(schemas, element);
        return;
      case 'rect':
        this.appendRect(schemas, element);
        return;
      case 'ellipse':
        this.appendEllipse(schemas, element);
        return;
      case 'polygon':
        this.appendPolygon(schemas, element);
        return;
    }
  }

  // -------------------------------------------------------------------------
  // text · field
  // -------------------------------------------------------------------------

  private textSchema(
    name: string,
    position: { x: number; y: number },
    width: number,
    height: number,
    style: {
      fontName?: string | undefined;
      fontSize?: number | undefined;
      alignment?: Alignment | undefined;
      verticalAlignment: VerticalAlignment;
      fontColor?: string | undefined;
      backgroundColor?: string | undefined;
      borderColor?: string | undefined;
      borderWidth?: number | undefined;
      padding: number;
      bold?: boolean | undefined;
      underline?: boolean | undefined;
      strikethrough?: boolean | undefined;
    },
  ): Record<string, unknown> {
    // 굵게 = 굵은 폰트로 전환 (없으면 무시, ADR-032)
    const fontName = style.bold === true
      ? (this.resolveBoldFont(style.fontName) ?? style.fontName)
      : style.fontName;
    const schema: Record<string, unknown> = {
      name,
      type: 'text',
      position,
      width,
      height,
      content: '',
      alignment: style.alignment ?? 'left',
      verticalAlignment: style.verticalAlignment,
      fontSize: style.fontSize ?? DEFAULT_FONT_SIZE,
      lineHeight: 1,
      characterSpacing: 0,
      fontColor: style.fontColor ?? DEFAULT_FONT_COLOR,
      backgroundColor: style.backgroundColor ?? NO_COLOR,
      borderColor: style.borderColor ?? DEFAULT_BORDER_COLOR,
      // 테두리는 명시했을 때만 그린다 (기본 0)
      borderWidth: box(style.borderWidth ?? 0),
      padding: box(style.padding),
      opacity: 1,
      strikethrough: style.strikethrough === true,
      underline: style.underline === true,
    };
    // fontName을 undefined로 두면 pdfme가 대체(fallback) 폰트를 쓴다
    if (fontName !== undefined) schema.fontName = fontName;
    return schema;
  }

  private appendText(schemas: Schema[], element: TextElement): void {
    const schema = this.textSchema(
      element.id,
      element.position,
      element.width,
      element.height,
      {
        fontName: element.fontName,
        fontSize: element.fontSize,
        alignment: element.alignment,
        verticalAlignment: 'top',
        fontColor: element.fontColor,
        backgroundColor: element.backgroundColor,
        borderColor: element.borderColor,
        borderWidth: element.borderWidth,
        padding: 0,
        bold: element.bold,
        underline: element.underline,
        strikethrough: element.strikethrough,
      },
    );
    // 고정 문구는 가공 없이 그대로 (pdfme 표현식 평가를 타지 않도록 inputs로 전달)
    this.push(schemas, schema, element.content);
  }

  private appendField(schemas: Schema[], element: FieldElement): void {
    const schema = this.textSchema(
      element.id,
      element.position,
      element.width,
      element.height,
      {
        fontName: element.fontName,
        fontSize: element.fontSize,
        alignment: element.alignment,
        verticalAlignment: 'top',
        fontColor: element.fontColor,
        backgroundColor: element.backgroundColor,
        borderColor: element.borderColor,
        borderWidth: element.borderWidth,
        padding: 0,
        bold: element.bold,
        underline: element.underline,
        strikethrough: element.strikethrough,
      },
    );
    this.push(schemas, schema, this.fieldValue(element));
  }

  private fieldValue(element: FieldElement): string {
    const what = `필드 '${element.name}'(${element.id})`;
    if (element.formula !== undefined) {
      let evaluated: unknown;
      try {
        evaluated = evaluateFormula(
          element.formula,
          this.locale === undefined ? { values: this.values } : { values: this.values, locale: this.locale },
        );
      } catch (error) {
        throw new SlipRenderError(
          `${what}의 수식을 계산하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return toDisplayText(evaluated, what);
    }
    return toDisplayText(this.values[element.binding], what);
  }

  // -------------------------------------------------------------------------
  // fixedGrid — 선·사각형·텍스트로 분해 (ADR-020)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // grid — 고정 틀과 반복 목록을 하나로 다루는 그리드 (ADR-037)
  // -------------------------------------------------------------------------

  /**
   * 반복 구간을 펼쳐 그린다. `renderPage`는 이 슬립 페이지의 몇 번째 출력 페이지인지다 —
   * 반복 항목을 페이지마다 나눠 담고, 이어지는 페이지에는 `repeatHeader`에 따라 위쪽 행을 비운다.
   */
  private appendGrid(schemas: Schema[], element: GridElement, renderPage: number): void {
    const layout = this.gridLayout(element, renderPage);
    this.drawGrid(schemas, {
      idPrefix: `${element.id}__p${renderPage}`,
      origin: { x: element.position.x, y: element.position.y },
      columnOffsets: cumulative(element.columns.map((column) => column.width)),
      rowOffsets: cumulative(layout.rowHeights),
      rows: layout.rowHeights.length,
      columns: element.columns.length,
      cells: layout.cells,
      backgroundColor: element.backgroundColor,
      borderColor: element.borderColor,
      borderWidth: element.borderWidth,
      borderStyle: element.borderStyle,
      padding: GRID_CELL_PADDING,
      blankRows: layout.blankRows,
      overflow: element.overflow ?? 'clip',
    });
  }

  /** 그리드 한 페이지의 실제 행 높이·셀 목록을 만든다 (반복 구간 펼치기, ADR-037) */
  private gridLayout(
    element: GridElement,
    renderPage: number,
  ): { rowHeights: number[]; cells: DrawGridCell[]; blankRows: Set<number> } {
    const templateHeights = element.rows.map((row) => row.height);
    const toDrawCell = (cell: GridCell, rowShift: number, item: Record<string, unknown> | undefined, hasItem: boolean): DrawGridCell => ({
      row: cell.row + rowShift,
      column: cell.column,
      rowSpan: cell.rowSpan ?? 1,
      colSpan: cell.colSpan ?? 1,
      text: hasItem ? this.gridCellText(element, cell, item) : '',
      fontName: cell.fontName ?? element.fontName,
      fontSize: cell.fontSize ?? element.fontSize,
      alignment: cell.alignment ?? element.alignment,
      bold: cell.bold ?? element.bold,
      underline: cell.underline ?? element.underline,
      strikethrough: cell.strikethrough ?? element.strikethrough,
      fontColor: cell.fontColor ?? element.fontColor,
      backgroundColor: cell.backgroundColor,
      borderColor: cell.borderColor,
      borderWidth: cell.borderWidth,
      borderStyle: cell.borderStyle,
      overflow: cell.overflow,
    });

    const repeat = element.repeat;
    if (!repeat) {
      return {
        rowHeights: templateHeights,
        cells: element.cells.map((cell) => toDrawCell(cell, 0, undefined, true)),
        blankRows: new Set<number>(),
      };
    }

    const { fromRow, toRow, perPage, repeatHeader } = repeat;
    const bandRows = toRow - fromRow + 1;
    const items = this.repeatItems(element, repeat.binding);
    const chunk = items.slice(renderPage * perPage, (renderPage + 1) * perPage);

    const rowHeights: number[] = [
      ...templateHeights.slice(0, fromRow),
      ...Array.from({ length: perPage }, () => templateHeights.slice(fromRow, toRow + 1)).flat(),
      ...templateHeights.slice(toRow + 1),
    ];

    const blankRows = new Set<number>();
    // 이어지는 페이지에서 헤더를 반복하지 않으면 그 자리를 비운다 — 그리드 크기는 그대로라
    // 아래 요소의 자리가 흔들리지 않는다 (SPEC §5.7)
    const hideHeader = renderPage > 0 && !repeatHeader;
    if (hideHeader) for (let r = 0; r < fromRow; r++) blankRows.add(r);

    // 위에서 아래 순서로 담는다 — 그리는 순서가 그리드 모양과 같아야 읽기 쉽다
    const cells: DrawGridCell[] = [];
    if (!hideHeader) {
      for (const cell of element.cells) {
        if (cell.row < fromRow) cells.push(toDrawCell(cell, 0, undefined, true));
      }
    }
    for (let i = 0; i < perPage; i++) {
      const item = chunk[i];
      for (const cell of element.cells) {
        if (cell.row >= fromRow && cell.row <= toRow) {
          cells.push(toDrawCell(cell, i * bandRows, item, item !== undefined));
        }
      }
    }
    for (const cell of element.cells) {
      if (cell.row > toRow) cells.push(toDrawCell(cell, (perPage - 1) * bandRows, undefined, true));
    }
    return { rowHeights, cells, blankRows };
  }

  /** 반복 구간이 읽는 항목 배열 */
  private repeatItems(element: GridElement, binding: string): Record<string, unknown>[] {
    const raw = this.values[binding];
    const what = `그리드 '${element.name}'(${element.id})`;
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new SlipRenderError(`${what}의 반복 값 '${binding}'은(는) 객체 배열이어야 합니다`);
    }
    return raw.map((row, index) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new SlipRenderError(`${what}의 ${index + 1}번째 항목은 객체여야 합니다`);
      }
      return row as Record<string, unknown>;
    });
  }

  /** 셀에 표시할 글 — 고정 문구 · 값 · 수식 중 하나 (SPEC §5.7) */
  private gridCellText(
    element: GridElement,
    cell: GridCell,
    item: Record<string, unknown> | undefined,
  ): string {
    const what = `그리드 '${element.name}'(${element.id})의 셀(${cell.row},${cell.column})`;
    // 반복 구간 안에서는 그 항목의 필드가 이름 그대로 보인다 (같은 이름이면 항목이 우선)
    const scope = item === undefined ? this.values : { ...this.values, ...item };
    if (cell.formula !== undefined) {
      try {
        const evaluated = evaluateFormula(
          cell.formula,
          this.locale === undefined ? { values: scope } : { values: scope, locale: this.locale },
        );
        return toDisplayText(evaluated, what);
      } catch (error) {
        throw new SlipRenderError(
          `${what}의 수식을 계산하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (cell.binding !== undefined) return toDisplayText(scope[cell.binding], what);
    return cell.content ?? '';
  }

  // -------------------------------------------------------------------------
  // 그리드 공통 그리기 — 배경·괘선·글자로 분해 (ADR-020/033/037)
  // -------------------------------------------------------------------------

  private drawGrid(schemas: Schema[], grid: DrawGridOptions): void {
    const { rows, columns, columnOffsets, rowOffsets, cells, padding } = grid;
    const originX = grid.origin.x;
    const originY = grid.origin.y;
    const width = columnOffsets[columns] ?? 0;
    const height = rowOffsets[rows] ?? 0;
    const lineWidth = grid.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const lineColor = grid.borderColor ?? DEFAULT_BORDER_COLOR;
    const lineStyle: BorderStyle = grid.borderStyle ?? 'solid';
    const blankRows = grid.blankRows ?? new Set<number>();

    // 셀 유효 테두리 — 셀에 지정한 값이 요소 값보다 우선한다 (ADR-033, SPEC §5.2)
    const cellBorderOf = (index: number): GridEdgeBorder => {
      const cell = index >= 0 ? cells[index] : undefined;
      return {
        width: cell?.borderWidth ?? lineWidth,
        color: cell?.borderColor ?? lineColor,
        style: cell?.borderStyle ?? lineStyle,
      };
    };
    // 두 셀이 공유하는 변은 굵은 쪽 설정을 따른다 — 같으면 아래·오른쪽 셀
    // (CSS border-collapse의 충돌 규칙과 같은 방향, ADR-033)
    const edgeBorderOf = (front: number | null, back: number | null): GridEdgeBorder => {
      if (front === null) return cellBorderOf(back ?? -1);
      if (back === null) return cellBorderOf(front);
      const a = cellBorderOf(front);
      const b = cellBorderOf(back);
      return b.width >= a.width ? b : a;
    };

    // 셀 소유 그리드 (병합 반영). 값은 cells 배열의 인덱스, 빈 칸은 -1
    const owner: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(-1));
    cells.forEach((cell, index) => {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        for (let c = cell.column; c < cell.column + cell.colSpan; c++) {
          const line = owner[r];
          if (line) line[c] = index;
        }
      }
    });

    // 1) 요소 배경 → 사각형
    if (grid.backgroundColor !== undefined) {
      this.pushRectangle(
        schemas,
        `${grid.idPrefix}__bg`,
        { x: originX, y: originY },
        width,
        height,
        grid.backgroundColor,
      );
    }

    // 2) 셀 배경 → 사각형 (병합 범위 전체)
    cells.forEach((cell, index) => {
      if (cell.backgroundColor === undefined) return;
      const rect = drawCellRect(cell, columnOffsets, rowOffsets, originX, originY);
      this.pushRectangle(
        schemas,
        `${grid.idPrefix}__cellbg-${index}`,
        { x: rect.x, y: rect.y },
        rect.width,
        rect.height,
        cell.backgroundColor,
      );
    });

    // 3) 그리드선 → 선. 병합 범위의 내부 경계선은 그리지 않고, 변마다 이웃 셀의
    //    테두리 설정(굵은 쪽 우선)을 적용해 같은 스타일 구간끼리 이어 그린다 (ADR-033)
    for (let r = 0; r <= rows; r++) {
      // 비운 행에 둘러싸인 가로선은 그리지 않는다 (헤더 미반복, SPEC §5.7)
      if (blankRows.has(r - 1) && blankRows.has(r)) continue;
      if ((r === 0 && blankRows.has(0)) || (r === rows && blankRows.has(rows - 1))) continue;
      let run: { start: number; border: GridEdgeBorder } | null = null;
      const flush = (endExclusive: number): void => {
        if (!run) return;
        const x = originX + (columnOffsets[run.start] ?? 0);
        const end = originX + (columnOffsets[endExclusive] ?? 0);
        this.pushLine(
          schemas,
          `${grid.idPrefix}__h-${r}-${run.start}`,
          { x, y: Math.max(0, originY + (rowOffsets[r] ?? 0) - run.border.width / 2) },
          end - x,
          run.border.width,
          run.border.color,
          run.border.style,
        );
        run = null;
      };
      for (let c = 0; c < columns; c++) {
        const above = r > 0 ? (owner[r - 1]?.[c] ?? -1) : null;
        const below = r < rows ? (owner[r]?.[c] ?? -1) : null;
        const mergedInterior = above !== null && below !== null && above !== -1 && above === below;
        const border = mergedInterior ? null : edgeBorderOf(above, below);
        if (border === null || border.width <= 0) {
          flush(c);
          continue;
        }
        if (run && sameGridBorder(run.border, border)) continue;
        flush(c);
        run = { start: c, border };
      }
      flush(columns);
    }
    for (let c = 0; c <= columns; c++) {
      let run: { start: number; border: GridEdgeBorder } | null = null;
      const flush = (endExclusive: number): void => {
        if (!run) return;
        const y = originY + (rowOffsets[run.start] ?? 0);
        const end = originY + (rowOffsets[endExclusive] ?? 0);
        this.pushLine(
          schemas,
          `${grid.idPrefix}__v-${c}-${run.start}`,
          { x: Math.max(0, originX + (columnOffsets[c] ?? 0) - run.border.width / 2), y },
          run.border.width,
          end - y,
          run.border.color,
          run.border.style,
        );
        run = null;
      };
      for (let r = 0; r < rows; r++) {
        if (blankRows.has(r)) {
          flush(r);
          continue;
        }
        const left = c > 0 ? (owner[r]?.[c - 1] ?? -1) : null;
        const right = c < columns ? (owner[r]?.[c] ?? -1) : null;
        const mergedInterior = left !== null && right !== null && left !== -1 && left === right;
        const border = mergedInterior ? null : edgeBorderOf(left, right);
        if (border === null || border.width <= 0) {
          flush(r);
          continue;
        }
        if (run && sameGridBorder(run.border, border)) continue;
        flush(r);
        run = { start: r, border };
      }
      flush(rows);
    }

    // 4) 셀 문구 → 텍스트
    cells.forEach((cell, index) => {
      if (cell.text === '') return;
      const rect = drawCellRect(cell, columnOffsets, rowOffsets, originX, originY);
      const fontSize = cell.fontSize ?? DEFAULT_FONT_SIZE;
      const overflow = cell.overflow ?? grid.overflow;
      const schema = this.textSchema(
        `${grid.idPrefix}__cell-${index}`,
        { x: rect.x, y: rect.y },
        rect.width,
        rect.height,
        {
          fontName: cell.fontName,
          fontSize: cell.fontSize,
          alignment: cell.alignment,
          verticalAlignment: 'middle',
          fontColor: cell.fontColor,
          backgroundColor: NO_COLOR,
          padding,
          bold: cell.bold,
          underline: cell.underline,
          strikethrough: cell.strikethrough,
        },
      );
      let value = cell.text;
      if (overflow === 'shrink') {
        // 칸에 들어갈 때까지 글자 크기를 줄인다 — 하부 엔진이 세로 기준으로 맞춘다
        schema.dynamicFontSize = { min: MIN_SHRINK_FONT_SIZE, max: fontSize, fit: 'vertical' };
      } else if (overflow === 'clip') {
        value = this.clipToBox(value, rect.width - padding * 2, rect.height - padding * 2, {
          fontName: schema.fontName as string | undefined,
          fontSize,
        });
      }
      this.push(schemas, schema, value);
    });
  }

  /** 칸 높이를 넘는 줄을 잘라낸다. 잴 수 없으면 그대로 둔다 (ADR-037) */
  private clipToBox(
    text: string,
    widthMm: number,
    heightMm: number,
    style: { fontName?: string | undefined; fontSize: number },
  ): string {
    if (widthMm <= 0 || heightMm <= 0) return text;
    const lines = this.measurer.splitLines(text, widthMm, style);
    const fitting = this.measurer.fittingLineCount(heightMm, style);
    if (lines === undefined || fitting === undefined) return text;
    return lines.slice(0, fitting).join('\n');
  }

  // -------------------------------------------------------------------------
  // image · shape
  // -------------------------------------------------------------------------

  private appendImage(schemas: Schema[], element: ImageElement): void {
    const schema: Record<string, unknown> = {
      name: element.id,
      type: 'image',
      position: element.position,
      width: element.width,
      height: element.height,
      content: '',
      opacity: 1,
    };
    this.push(schemas, schema, this.resolveImageSrc(element));
  }

  /** src 해소 (§3.1): data:는 그대로, asset://은 문서 assets에서, 외부 URL은 거부 (ADR-014) */
  private resolveImageSrc(element: ImageElement): string {
    const what = `이미지 '${element.name}'(${element.id})`;
    const src = element.src;
    if (src.startsWith('data:')) return src;
    if (src.startsWith('asset://')) {
      const assetId = src.slice('asset://'.length);
      const asset = this.body.assets.find((entry) => entry.id === assetId);
      if (!asset) {
        throw new SlipRenderError(`${what}가 참조하는 에셋을 찾을 수 없습니다: ${assetId}`);
      }
      if (!asset.src.startsWith('data:')) {
        throw new SlipRenderError(
          `${what}가 참조하는 에셋 '${assetId}'이(가) 파일에 내장되어 있지 않습니다 (data: base64 필요)`,
        );
      }
      return asset.src;
    }
    throw new SlipRenderError(
      `${what}는 외부 URL(${src})을 참조합니다. PDF로 출력하려면 이미지를 파일에 내장(data: base64 또는 asset://)해야 합니다`,
    );
  }

  /** 사각형 요소 — 파선·점선이면 배경 사각형 + 네 변을 분해한 선으로 (ADR-032) */
  private appendRect(schemas: Schema[], element: RectElement): void {
    const borderWidth = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const borderColor = element.borderColor ?? DEFAULT_BORDER_COLOR;
    const style: BorderStyle = element.borderStyle ?? 'solid';
    if (style !== 'solid' && borderWidth > 0) {
      if (element.backgroundColor !== undefined) {
        this.pushRectangle(
          schemas, `${element.id}__bg`, element.position,
          element.width, element.height, element.backgroundColor,
        );
      }
      const { x, y } = element.position;
      const w = element.width;
      const h = element.height;
      this.pushLine(schemas, `${element.id}__t`, { x, y: Math.max(0, y - borderWidth / 2) }, w, borderWidth, borderColor, style);
      this.pushLine(schemas, `${element.id}__b`, { x, y: Math.max(0, y + h - borderWidth / 2) }, w, borderWidth, borderColor, style);
      this.pushLine(schemas, `${element.id}__l`, { x: Math.max(0, x - borderWidth / 2), y }, borderWidth, h, borderColor, style);
      this.pushLine(schemas, `${element.id}__r`, { x: Math.max(0, x + w - borderWidth / 2), y }, borderWidth, h, borderColor, style);
      return;
    }
    this.pushRectangle(
      schemas,
      element.id,
      element.position,
      element.width,
      element.height,
      element.backgroundColor ?? NO_COLOR,
      borderWidth,
      borderColor,
      element.radius ?? 0,
    );
  }

  /** 타원 요소 — 곡선 테두리는 파선 분해가 불가능해 실선 고정 (ADR-032) */
  private appendEllipse(schemas: Schema[], element: EllipseElement): void {
    this.push(
      schemas,
      {
        name: element.id,
        type: 'ellipse',
        position: element.position,
        width: element.width,
        height: element.height,
        color: element.backgroundColor ?? NO_COLOR,
        borderWidth: element.borderWidth ?? DEFAULT_BORDER_WIDTH,
        borderColor: element.borderColor ?? DEFAULT_BORDER_COLOR,
        opacity: 1,
        rotate: 0,
      },
      '',
    );
  }

  /** 선 요소 — lineDirection대로 수평·수직·대각선을 그린다 (ADR-032) */
  private appendLine(schemas: Schema[], element: LineElement): void {
    const thickness = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const color = element.borderColor ?? DEFAULT_BORDER_COLOR;
    const style: BorderStyle = element.borderStyle ?? 'solid';
    const direction = element.lineDirection ?? 'horizontal';
    if (direction === 'horizontal') {
      this.pushLine(
        schemas,
        element.id,
        { x: element.position.x, y: Math.max(0, element.position.y + element.height / 2 - thickness / 2) },
        element.width,
        thickness,
        color,
        style,
      );
      return;
    }
    if (direction === 'vertical') {
      this.pushLine(
        schemas,
        element.id,
        { x: Math.max(0, element.position.x + element.width / 2 - thickness / 2), y: element.position.y },
        thickness,
        element.height,
        color,
        style,
      );
      return;
    }
    // 대각선 — 상자의 두 모서리를 잇는다. down = 좌상→우하, up = 좌하→우상
    const w = element.width;
    const h = element.height;
    const length = Math.hypot(w, h);
    if (length <= 0) return;
    const angle = (Math.atan2(h, w) * 180) / Math.PI;
    const rotate = direction === 'down' ? angle : -angle;
    if (style === 'solid') {
      this.pushRotatedSegment(
        schemas,
        element.id,
        element.position.x + w / 2,
        element.position.y + h / 2,
        length,
        thickness,
        rotate,
        color,
      );
      return;
    }
    // 파선·점선 — 대각선 방향 단위벡터를 따라 짧은 선분으로 분해
    const pattern = DASH_PATTERNS[style];
    const ux = w / length;
    const uy = (direction === 'down' ? h : -h) / length;
    const startX = element.position.x;
    const startY = direction === 'down' ? element.position.y : element.position.y + h;
    let offset = 0;
    let index = 0;
    while (offset < length) {
      const segment = Math.min(pattern.on, length - offset);
      const midOffset = offset + segment / 2;
      this.pushRotatedSegment(
        schemas,
        `${element.id}__d${index++}`,
        startX + ux * midOffset,
        startY + uy * midOffset,
        segment,
        thickness,
        rotate,
        color,
      );
      offset += pattern.on + pattern.off;
    }
  }

  /** 중심(cx,cy)·길이·기울기(도)로 회전된 선분 하나를 추가한다 (회전 기준 = 상자 중심) */
  private pushRotatedSegment(
    schemas: Schema[],
    name: string,
    cx: number,
    cy: number,
    length: number,
    thickness: number,
    rotate: number,
    color: string,
  ): void {
    this.push(
      schemas,
      {
        name,
        type: 'line',
        position: { x: cx - length / 2, y: cy - thickness / 2 },
        width: length,
        height: thickness,
        color,
        opacity: 1,
        rotate,
      },
      '',
    );
  }

  /** 정다각형 — svg 폴리곤으로 그린다 (첫 꼭짓점 위쪽, 상자에 내접, ADR-032) */
  private appendPolygon(schemas: Schema[], element: PolygonElement): void {
    const borderWidth = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const borderColor = element.borderColor ?? DEFAULT_BORDER_COLOR;
    const w = element.width;
    const h = element.height;
    const fill = element.backgroundColor ?? 'none';
    const points = polygonPoints(element.sides, w, h)
      .map(([x, y]) => `${round3(x)},${round3(y)}`)
      .join(' ');
    // viewBox를 mm 크기 그대로 두어 stroke-width가 mm 단위로 일치한다
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      `<polygon points="${points}" fill="${fill}" ` +
      `stroke="${borderWidth > 0 ? borderColor : 'none'}" stroke-width="${borderWidth}"/></svg>`;
    this.push(
      schemas,
      {
        name: element.id,
        type: 'svg',
        position: element.position,
        width: w,
        height: h,
        content: '',
        opacity: 1,
        rotate: 0,
      },
      svg,
    );
  }

  // -------------------------------------------------------------------------
  // 도형 스키마 생성 헬퍼
  // -------------------------------------------------------------------------

  private pushLine(
    schemas: Schema[],
    name: string,
    position: { x: number; y: number },
    width: number,
    height: number,
    color: string,
    style: BorderStyle = 'solid',
  ): void {
    if (style === 'solid') {
      this.push(
        schemas,
        { name, type: 'line', position, width, height, color, opacity: 1, rotate: 0 },
        '',
      );
      return;
    }
    // 파선·점선 — 진행 방향(긴 쪽)을 따라 짧은 선분으로 분해한다 (ADR-032)
    const pattern = DASH_PATTERNS[style];
    const horizontal = width >= height;
    const length = horizontal ? width : height;
    let offset = 0;
    let index = 0;
    while (offset < length) {
      const segment = Math.min(pattern.on, length - offset);
      this.push(
        schemas,
        {
          name: `${name}~${index++}`,
          type: 'line',
          position: horizontal
            ? { x: position.x + offset, y: position.y }
            : { x: position.x, y: position.y + offset },
          width: horizontal ? segment : width,
          height: horizontal ? height : segment,
          color,
          opacity: 1,
          rotate: 0,
        },
        '',
      );
      offset += pattern.on + pattern.off;
    }
  }

  private pushRectangle(
    schemas: Schema[],
    name: string,
    position: { x: number; y: number },
    width: number,
    height: number,
    color: string,
    borderWidth = 0,
    borderColor = DEFAULT_BORDER_COLOR,
    radius = 0,
  ): void {
    this.push(
      schemas,
      {
        name,
        type: 'rectangle',
        position,
        width,
        height,
        color,
        borderWidth,
        borderColor,
        radius,
        opacity: 1,
        rotate: 0,
      },
      '',
    );
  }
}


/** 좌표를 0.001 단위로 반올림 — svg 문자열이 불필요하게 길어지지 않게 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 정다각형 꼭짓점 좌표(첫 꼭짓점 위쪽) — 단위원 위의 점을 상자(width×height)에
 * 꽉 차게 정규화한다. 삼각형(sides 3)이면 (w/2,0)·(w,h)·(0,h)가 된다.
 */
function polygonPoints(sides: number, width: number, height: number): [number, number][] {
  const raw: [number, number][] = Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return raw.map(([x, y]) => [((x - minX) / spanX) * width, ((y - minY) / spanY) * height]);
}

// ---------------------------------------------------------------------------
// 그리드 계산 헬퍼
// ---------------------------------------------------------------------------

/** 그리드 그리기에 넘기는 셀 하나 — 값·스타일이 이미 풀린 상태다 (ADR-037) */
interface DrawGridCell {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  fontName?: string | undefined;
  fontSize?: number | undefined;
  alignment?: Alignment | undefined;
  bold?: boolean | undefined;
  underline?: boolean | undefined;
  strikethrough?: boolean | undefined;
  fontColor?: string | undefined;
  backgroundColor?: string | undefined;
  borderColor?: string | undefined;
  borderWidth?: number | undefined;
  borderStyle?: BorderStyle | undefined;
  overflow?: 'clip' | 'shrink' | undefined;
}

/** 그리드 그리기 입력 */
interface DrawGridOptions {
  idPrefix: string;
  origin: { x: number; y: number };
  /** 누적 오프셋(mm) — 길이는 트랙 수 + 1 */
  columnOffsets: number[];
  rowOffsets: number[];
  rows: number;
  columns: number;
  cells: DrawGridCell[];
  backgroundColor?: string | undefined;
  borderColor?: string | undefined;
  borderWidth?: number | undefined;
  borderStyle?: BorderStyle | undefined;
  /** 셀 안쪽 여백(mm) */
  padding: number;
  /** 그리지 않고 비우는 행 (헤더 미반복, SPEC §5.7) */
  blankRows?: Set<number>;
  /** 칸을 넘치는 글의 기본 처리 */
  overflow?: 'clip' | 'shrink' | undefined;
}

/** 트랙 크기 배열 → 누적 오프셋 (길이 = 트랙 수 + 1) */
function cumulative(sizes: readonly number[]): number[] {
  const offsets = [0];
  for (const size of sizes) offsets.push((offsets[offsets.length - 1] ?? 0) + size);
  return offsets;
}

function drawCellRect(
  cell: DrawGridCell,
  columnOffsets: number[],
  rowOffsets: number[],
  originX: number,
  originY: number,
): { x: number; y: number; width: number; height: number } {
  const left = columnOffsets[cell.column] ?? 0;
  const right = columnOffsets[cell.column + cell.colSpan] ?? left;
  const top = rowOffsets[cell.row] ?? 0;
  const bottom = rowOffsets[cell.row + cell.rowSpan] ?? top;
  return { x: originX + left, y: originY + top, width: right - left, height: bottom - top };
}

/** 그리드 한 변에 적용되는 유효 테두리 (셀 값 ?? 요소 값, ADR-033) */
interface GridEdgeBorder {
  width: number;
  color: string;
  style: BorderStyle;
}

/** 두 변 테두리가 같은 스타일인지 — 같은 구간끼리 한 선으로 이어 그리기 위함 */
function sameGridBorder(a: GridEdgeBorder, b: GridEdgeBorder): boolean {
  return a.width === b.width && a.color === b.color && a.style === b.style;
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * `.slip` 파일을 pdfme 템플릿 + 입력값으로 변환한다.
 * 양식 파일은 값이 빈 상태로, 전표 파일은 스냅샷 + values로 변환된다 (ADR-008).
 *
 * @param file - 변환할 .slip 파일
 * @param options - `locale`: 수식 포맷 함수 로케일 · `fontNames`: 렌더 옵션의 폰트 이름
 *   목록(굵게 폰트 탐색용) · `fallbackFontName`: 대체 폰트 이름 · `fonts`: 폰트 데이터
 *   (칸을 넘치는 글을 잘라낼 때 글자를 재는 데 쓴다, ADR-037)
 * @returns pdfme `generate()`에 넘길 템플릿과 입력값
 */
export function convertSlipFile(
  file: SlipFile,
  options?: {
    locale?: string;
    fontNames?: readonly string[];
    fallbackFontName?: string;
    fonts?: readonly SlipFont[];
  },
): PdfmeRenderInput {
  const body = file.kind === 'template' ? file.template : file.templateSnapshot;
  const values: Record<string, unknown> = file.kind === 'voucher' ? file.values : {};
  return new SlipToPdfmeConverter(
    body,
    values,
    options?.locale,
    options?.fontNames ?? [],
    options?.fallbackFontName,
    new TextMeasurer(options?.fonts ?? []),
  ).convert();
}
