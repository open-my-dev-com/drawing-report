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
  DynamicTableElement,
  FieldElement,
  FixedGridCell,
  FixedGridElement,
  ImageElement,
  ShapeElement,
  SlipElement,
  SlipFile,
  SlipTemplateBody,
  TextElement,
} from '../format/schema.js';
import { SlipRenderError } from './errors.js';

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
/** 고정 격자 셀 안쪽 여백(mm) */
const GRID_CELL_PADDING = 1;
/** 동적 표 셀 안쪽 여백(mm) */
const TABLE_CELL_PADDING = 2;

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
  ) {}

  convert(): PdfmeRenderInput {
    const schemas = this.body.pages.map((page) => {
      const pageSchemas: Schema[] = [];
      for (const element of page.elements) {
        this.appendElement(pageSchemas, element);
      }
      return pageSchemas;
    });
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

  private appendElement(schemas: Schema[], element: SlipElement): void {
    switch (element.type) {
      case 'text':
        this.appendText(schemas, element);
        return;
      case 'field':
        this.appendField(schemas, element);
        return;
      case 'fixedGrid':
        this.appendFixedGrid(schemas, element);
        return;
      case 'dynamicTable':
        this.appendDynamicTable(schemas, element);
        return;
      case 'image':
        this.appendImage(schemas, element);
        return;
      case 'shape':
        this.appendShape(schemas, element);
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
    },
  ): Record<string, unknown> {
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
      strikethrough: false,
      underline: false,
    };
    // fontName을 undefined로 두면 pdfme가 대체(fallback) 폰트를 쓴다
    if (style.fontName !== undefined) schema.fontName = style.fontName;
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
      },
    );
    this.push(schemas, schema, this.fieldValue(element));
  }

  private fieldValue(element: FieldElement): string {
    const what = `필드 '${element.name}'(${element.id})`;
    if (element.formula !== undefined) {
      let evaluated: unknown;
      try {
        evaluated = evaluateFormula(element.formula, { values: this.values });
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

  private appendFixedGrid(schemas: Schema[], element: FixedGridElement): void {
    const { rows, columns } = element;
    const columnOffsets = trackOffsets(element.width, columns, element.columnWidthPercentages);
    const rowOffsets = trackOffsets(element.height, rows, element.rowHeightPercentages);
    const originX = element.position.x;
    const originY = element.position.y;
    const lineWidth = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const lineColor = element.borderColor ?? DEFAULT_BORDER_COLOR;

    // 셀 소유 격자 (병합 반영). 값은 cells 배열의 인덱스, 빈 칸은 -1
    const owner: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(-1));
    element.cells.forEach((cell, index) => {
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      for (let r = cell.row; r < cell.row + rowSpan; r++) {
        for (let c = cell.column; c < cell.column + colSpan; c++) {
          const line = owner[r];
          if (line) line[c] = index;
        }
      }
    });

    // 1) 요소 배경 → 사각형
    if (element.backgroundColor !== undefined) {
      this.pushRectangle(
        schemas,
        `${element.id}__bg`,
        { x: originX, y: originY },
        element.width,
        element.height,
        element.backgroundColor,
      );
    }

    // 2) 셀 배경 → 사각형 (병합 범위 전체)
    element.cells.forEach((cell, index) => {
      if (cell.backgroundColor === undefined) return;
      const rect = cellRect(cell, columnOffsets, rowOffsets, originX, originY);
      this.pushRectangle(
        schemas,
        `${element.id}__cellbg-${index}`,
        { x: rect.x, y: rect.y },
        rect.width,
        rect.height,
        cell.backgroundColor,
      );
    });

    // 3) 격자선 → 선. 병합 범위의 내부 경계선은 그리지 않는다
    if (lineWidth > 0) {
      for (let r = 0; r <= rows; r++) {
        const drawable = (c: number): boolean => {
          if (r === 0 || r === rows) return true;
          const above = owner[r - 1]?.[c] ?? -1;
          const below = owner[r]?.[c] ?? -1;
          return !(above !== -1 && above === below);
        };
        for (const run of contiguousRuns(columns, drawable)) {
          const x = originX + (columnOffsets[run.start] ?? 0);
          const end = originX + (columnOffsets[run.end + 1] ?? 0);
          this.pushLine(
            schemas,
            `${element.id}__h-${r}-${run.start}`,
            { x, y: Math.max(0, originY + (rowOffsets[r] ?? 0) - lineWidth / 2) },
            end - x,
            lineWidth,
            lineColor,
          );
        }
      }
      for (let c = 0; c <= columns; c++) {
        const drawable = (r: number): boolean => {
          if (c === 0 || c === columns) return true;
          const left = owner[r]?.[c - 1] ?? -1;
          const right = owner[r]?.[c] ?? -1;
          return !(left !== -1 && left === right);
        };
        for (const run of contiguousRuns(rows, drawable)) {
          const y = originY + (rowOffsets[run.start] ?? 0);
          const end = originY + (rowOffsets[run.end + 1] ?? 0);
          this.pushLine(
            schemas,
            `${element.id}__v-${c}-${run.start}`,
            { x: Math.max(0, originX + (columnOffsets[c] ?? 0) - lineWidth / 2), y },
            lineWidth,
            end - y,
            lineColor,
          );
        }
      }
    }

    // 4) 셀 문구 → 텍스트
    element.cells.forEach((cell, index) => {
      if (cell.content === '') return;
      const rect = cellRect(cell, columnOffsets, rowOffsets, originX, originY);
      const schema = this.textSchema(
        `${element.id}__cell-${index}`,
        { x: rect.x, y: rect.y },
        rect.width,
        rect.height,
        {
          fontName: cell.fontName,
          fontSize: cell.fontSize,
          alignment: cell.alignment,
          verticalAlignment: 'middle',
          fontColor: cell.fontColor ?? element.fontColor,
          backgroundColor: NO_COLOR,
          padding: GRID_CELL_PADDING,
        },
      );
      this.push(schemas, schema, cell.content);
    });
  }

  // -------------------------------------------------------------------------
  // dynamicTable — pdfme table (스타일 기본값 병합 필수, Q08 직접 확인)
  // -------------------------------------------------------------------------

  private appendDynamicTable(schemas: Schema[], element: DynamicTableElement): void {
    const borderColor = element.borderColor ?? DEFAULT_BORDER_COLOR;
    const borderWidth = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const fontColor = element.fontColor ?? DEFAULT_FONT_COLOR;
    const cellStyle = {
      alignment: 'left' as Alignment,
      verticalAlignment: 'middle' as VerticalAlignment,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: 1,
      characterSpacing: 0,
      fontColor,
      backgroundColor: NO_COLOR,
      borderColor,
      borderWidth: box(borderWidth),
      padding: box(TABLE_CELL_PADDING),
    };
    const schema: Record<string, unknown> = {
      name: element.id,
      type: 'table',
      position: element.position,
      width: element.width,
      height: element.height,
      content: '[]',
      showHead: true,
      // 페이지 분할 시 머리행 반복 (ADR-011)
      repeatHead: element.repeatHead,
      head: [...element.head],
      headWidthPercentages: [...element.headWidthPercentages],
      tableStyles: { borderColor, borderWidth },
      headStyles: {
        ...cellStyle,
        alignment: 'center' as Alignment,
        // 요소의 배경색은 머리행 배경으로 쓴다
        backgroundColor: element.backgroundColor ?? '#eeeeee',
      },
      bodyStyles: { ...cellStyle, alternateBackgroundColor: NO_COLOR },
      columnStyles: {},
      opacity: 1,
    };
    this.push(schemas, schema, JSON.stringify(this.tableRows(element)));
  }

  private tableRows(element: DynamicTableElement): string[][] {
    const raw = this.values[element.binding];
    const what = `동적 표 '${element.name}'(${element.id})`;
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new SlipRenderError(`${what}의 값 '${element.binding}'은(는) 객체 배열이어야 합니다`);
    }
    return raw.map((row, index) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new SlipRenderError(`${what}의 ${index + 1}번째 행은 객체여야 합니다`);
      }
      const record = row as Record<string, unknown>;
      // 행 데이터는 head의 각 제목을 키로 읽는다
      return element.head.map((title) => toDisplayText(record[title], `${what}의 '${title}' 칸`));
    });
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

  private appendShape(schemas: Schema[], element: ShapeElement): void {
    const borderWidth = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const borderColor = element.borderColor ?? DEFAULT_BORDER_COLOR;
    if (element.shape === 'line') {
      // 긴 쪽 방향의 직선으로 본다 (SPEC에 시작·끝점 개념이 없어 사선은 지원하지 않는다)
      if (element.width >= element.height) {
        this.pushLine(
          schemas,
          element.id,
          {
            x: element.position.x,
            y: Math.max(0, element.position.y + element.height / 2 - borderWidth / 2),
          },
          element.width,
          borderWidth,
          borderColor,
        );
      } else {
        this.pushLine(
          schemas,
          element.id,
          {
            x: Math.max(0, element.position.x + element.width / 2 - borderWidth / 2),
            y: element.position.y,
          },
          borderWidth,
          element.height,
          borderColor,
        );
      }
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
  ): void {
    this.push(
      schemas,
      { name, type: 'line', position, width, height, color, opacity: 1, rotate: 0 },
      '',
    );
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
        radius: 0,
        opacity: 1,
        rotate: 0,
      },
      '',
    );
  }
}

// ---------------------------------------------------------------------------
// 격자 계산 헬퍼
// ---------------------------------------------------------------------------

/** 비율(생략 시 균등)로 나눈 누적 경계 위치. 길이 = count + 1 */
function trackOffsets(total: number, count: number, percentages?: number[]): number[] {
  const offsets = [0];
  for (let i = 0; i < count; i++) {
    const size = percentages ? (total * (percentages[i] ?? 0)) / 100 : total / count;
    offsets.push((offsets[i] ?? 0) + size);
  }
  return offsets;
}

function cellRect(
  cell: FixedGridCell,
  columnOffsets: number[],
  rowOffsets: number[],
  originX: number,
  originY: number,
): { x: number; y: number; width: number; height: number } {
  const left = columnOffsets[cell.column] ?? 0;
  const right = columnOffsets[cell.column + (cell.colSpan ?? 1)] ?? left;
  const top = rowOffsets[cell.row] ?? 0;
  const bottom = rowOffsets[cell.row + (cell.rowSpan ?? 1)] ?? top;
  return { x: originX + left, y: originY + top, width: right - left, height: bottom - top };
}

/** 조건을 만족하는 연속 구간(닫힌 구간)들을 모은다 — 격자선을 이어 그리기 위함 */
function contiguousRuns(count: number, predicate: (index: number) => boolean): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i < count; i++) {
    if (predicate(i)) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      runs.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start !== -1) runs.push({ start, end: count - 1 });
  return runs;
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * `.slip` 파일을 pdfme 템플릿 + 입력값으로 변환한다.
 * 양식 파일은 값이 빈 상태로, 전표 파일은 스냅샷 + values로 변환된다 (ADR-008).
 */
export function convertSlipFile(file: SlipFile): PdfmeRenderInput {
  const body = file.kind === 'template' ? file.template : file.templateSnapshot;
  const values: Record<string, unknown> = file.kind === 'voucher' ? file.values : {};
  return new SlipToPdfmeConverter(body, values).convert();
}
