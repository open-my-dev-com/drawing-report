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
  BarcodeElement,
  EllipseElement,
  FieldElement,
  GridCell,
  GridElement,
  ImageElement,
  LineElement,
  RectElement,
  SlipElement,
  SlipFile,
  SlipPage,
  SlipTemplateBody,
  PolygonElement,
  TextElement,
} from '../format/schema.js';
import { normalizeNumericBindings } from '../format/normalize.js';
import { SlipRenderError } from './errors.js';
import { TextMeasurer } from './measure.js';
import { stackVertically } from './text-layout.js';
import type { SlipFont } from './types.js';

// ---------------------------------------------------------------------------
// 기본값 (SPEC에 없는 표현 세부는 여기서 한 곳에 모아 정한다)
// ---------------------------------------------------------------------------

const DEFAULT_FONT_SIZE = 10;
/** 페이지 번호 기본 글자 크기(pt) */
const PAGE_NUMBER_FONT_SIZE = 9;
/** pt → mm */
const PT_TO_MM = 25.4 / 72;
/** 페이지 번호 상자 높이 = 글자 높이 × 이 배수 — 세로 중앙 정렬이 잘리지 않게 여유를 둔다 */
const PAGE_NUMBER_BOX_LINE_HEIGHT = 1.6;
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

/**
 * 값을 표시용 문자열로 바꾼다 — 수식 엔진 CONCAT의 문자열화 규칙과 같다.
 *
 * @param value - 문자열화할 값 (문자열·수·논리·빈 값)
 * @param what - 오류 메시지에 쓸 대상 이름
 * @returns 표시용 문자열 (빈 값은 빈 문자열)
 * @throws SlipRenderError 배열·객체이거나 유한하지 않은 수면
 */
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
    return this.resolveVariantFontName(fontName, 'Bold');
  }

  /**
   * 굵게·기울임에 쓸 폰트 이름 — 유효 폰트의 `<이름>-<변형>`이 렌더 옵션에 있으면 그 이름을,
   * 없으면 `undefined`(그 변형은 PDF에서 무시된다, ADR-032)
   */
  private resolveVariantFontName(fontName: string | undefined, variant: string): string | undefined {
    const base = fontName ?? this.fallbackFontName;
    if (!base) return undefined;
    const candidate = `${base}-${variant}`;
    return this.fontNames.includes(candidate) ? candidate : undefined;
  }

  /**
   * 굵게·기울임을 함께 고려한 폰트 이름 — 둘 다면 `<이름>-BoldItalic`을 먼저 찾는다.
   * 맞는 변형이 없으면 원래 폰트를 그대로 쓴다 — 기울이기 흉내는 내지 않는다 (ADR-032).
   */
  private resolveVariantFont(
    fontName: string | undefined,
    bold: boolean | undefined,
    italic: boolean | undefined,
  ): string | undefined {
    if (bold === true && italic === true) {
      return this.resolveVariantFontName(fontName, 'BoldItalic')
        ?? this.resolveVariantFontName(fontName, 'Bold')
        ?? this.resolveVariantFontName(fontName, 'Italic')
        ?? fontName;
    }
    if (bold === true) return this.resolveVariantFontName(fontName, 'Bold') ?? fontName;
    if (italic === true) return this.resolveVariantFontName(fontName, 'Italic') ?? fontName;
    return fontName;
  }

  convert(): PdfmeRenderInput {
    // 반복 그리드가 넘치면 그 슬립 페이지를 여러 출력 페이지로 낸다 (ADR-037).
    // 나머지 요소는 페이지마다 그대로 다시 그린다 — 그리드 크기가 고정이라 자리가 흔들리지 않는다.
    const schemas: Schema[][] = [];
    // 출력 페이지마다 그것을 만든 원본 슬립 페이지를 기록해 둔다 — 페이지 번호를 얹을 때
    // 같은 페이지 워크를 다시 돌지 않도록(두 워크가 어긋날 위험 제거).
    const outputPages: SlipPage[] = [];
    for (const page of this.body.pages) {
      const pageCount = this.renderPageCount(page.elements);
      for (let renderPage = 0; renderPage < pageCount; renderPage++) {
        const pageSchemas: Schema[] = [];
        for (const element of page.elements) {
          this.appendElement(pageSchemas, element, renderPage);
        }
        schemas.push(pageSchemas);
        outputPages.push(page);
      }
    }
    // 페이지 번호는 전체 쪽 수가 정해진 뒤에야 찍을 수 있다 — 페이지를 다 만든 뒤 얹는다
    this.appendPageNumbers(schemas, outputPages);
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

  /**
   * 페이지 번호 찍기 — 양식 페이지가 정한 자리에 `{n} / {total}`을 넣는다.
   *
   * 실제 번호는 출력 페이지가 다 만들어진 뒤에야 알 수 있다(반복 그리드가 넘치면 한 양식 페이지가
   * 여러 출력 페이지가 된다). 그래서 페이지를 다 만든 뒤 마지막에 얹는다.
   *
   * @param schemas - 페이지별 스키마 목록 (여기에 번호 상자를 더한다)
   * @param outputPages - 출력 페이지마다의 원본 슬립 페이지 (convert에서 만든 매핑)
   */
  private appendPageNumbers(schemas: Schema[][], outputPages: readonly SlipPage[]): void {
    const total = schemas.length;
    for (let output = 0; output < total; output++) {
      const setting = outputPages[output]?.pageNumber;
      const target = schemas[output];
      if (!setting || !target) continue;
      const text = (setting.format ?? '{n} / {total}')
        .replace(/\{n\}/g, String(output + 1))
        .replace(/\{total\}/g, String(total));
      target.push(this.pageNumberSchema(setting, output, text));
    }
  }

  /** 페이지 번호 상자 하나 — 자리는 용지 여백 안쪽 가장자리에 맞춘다 */
  private pageNumberSchema(
    setting: NonNullable<SlipPage['pageNumber']>,
    output: number,
    text: string,
  ): Schema {
    const { width, height, padding } = this.body.paper;
    const [top, right, bottom, left] = padding;
    const boxWidth = width - left - right;
    const fontSize = setting.fontSize ?? PAGE_NUMBER_FONT_SIZE;
    const boxHeight = fontSize * PT_TO_MM * PAGE_NUMBER_BOX_LINE_HEIGHT;
    const isTop = setting.position.startsWith('top-');
    const y = isTop ? Math.max(0, top - boxHeight) : height - bottom;
    const alignment: Alignment = setting.position.endsWith('-left')
      ? 'left'
      : setting.position.endsWith('-right') ? 'right' : 'center';
    const schema = this.textSchema(
      `__page-number-${output}`,
      { x: left, y },
      boxWidth,
      boxHeight,
      { alignment, verticalAlignment: 'middle', fontSize, padding: 0 },
    );
    this.inputs[`__page-number-${output}`] = text;
    return schema as unknown as Schema;
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
      case 'barcode':
        this.appendBarcode(schemas, element);
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
      italic?: boolean | undefined;
      underline?: boolean | undefined;
      strikethrough?: boolean | undefined;
      lineHeight?: number | undefined;
      characterSpacing?: number | undefined;
    },
  ): Record<string, unknown> {
    // 굵게·기울임 = 변형 폰트로 전환 (없으면 무시, ADR-032)
    const fontName = this.resolveVariantFont(style.fontName, style.bold, style.italic);
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
      lineHeight: style.lineHeight ?? 1,
      characterSpacing: style.characterSpacing ?? 0,
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

  /**
   * 텍스트·필드 요소에서 textSchema에 넘길 글자 스타일 객체를 뽑는다 — 두 요소가
   * 같은 글자 스타일 필드를 갖기 때문에 한곳에서 만든다(새 스타일 추가 시 한 군데만 고친다).
   *
   * @param element - 텍스트 또는 필드 요소
   * @returns textSchema의 style 인자 형태의 스타일 객체
   */
  private textStyleFromElement(element: TextElement | FieldElement) {
    return {
      fontName: element.fontName,
      fontSize: element.fontSize,
      alignment: element.alignment,
      verticalAlignment: element.verticalAlignment ?? 'top',
      fontColor: element.fontColor,
      backgroundColor: element.backgroundColor,
      borderColor: element.borderColor,
      borderWidth: element.borderWidth,
      padding: 0,
      bold: element.bold,
      italic: element.italic,
      underline: element.underline,
      strikethrough: element.strikethrough,
      lineHeight: element.lineHeight,
      characterSpacing: element.characterSpacing,
    } as const;
  }

  private appendText(schemas: Schema[], element: TextElement): void {
    const schema = this.textSchema(
      element.id,
      element.position,
      element.width,
      element.height,
      this.textStyleFromElement(element),
    );
    // 직접 입력한 글은 가공 없이 그대로 (pdfme 표현식 평가를 타지 않도록 inputs로 전달)
    this.push(schemas, schema, stackVertically(element.content, element.vertical));
  }

  private appendField(schemas: Schema[], element: FieldElement): void {
    const schema = this.textSchema(
      element.id,
      element.position,
      element.width,
      element.height,
      this.textStyleFromElement(element),
    );
    this.push(schemas, schema, stackVertically(this.fieldValue(element), element.vertical));
  }

  /**
   * 요소 수식을 평가한다 — locale 컨텍스트 구성과 오류 재포장을 한곳에 모은다
   * (필드·그리드 칸·바코드가 공유한다).
   *
   * @param formula - 평가할 수식 문자열
   * @param scope - 수식이 참조할 값 범위(전표 값, 반복 항목 등)
   * @param what - 오류 메시지에 쓸 대상 이름
   * @returns 평가 결과 값
   * @throws SlipRenderError 수식 계산에 실패하면
   */
  private evaluate(formula: string, scope: Record<string, unknown>, what: string): unknown {
    try {
      return evaluateFormula(
        formula,
        this.locale === undefined ? { values: scope } : { values: scope, locale: this.locale },
      );
    } catch (error) {
      throw new SlipRenderError(
        `${what}의 수식을 계산하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private fieldValue(element: FieldElement): string {
    const what = `필드 '${element.name}'(${element.id})`;
    if (element.formula !== undefined) {
      return toDisplayText(this.evaluate(element.formula, this.values, what), what);
    }
    return toDisplayText(this.values[element.binding], what);
  }

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
  /**
   * 그리드 칸 하나를 그리기용 셀로 바꾼다 — 셀에 지정이 없으면 요소 기본값을 물려받는다.
   *
   * @param element - 셀이 속한 그리드 (기본 스타일·값 계산에 쓴다)
   * @param cell - 원본 칸
   * @param rowShift - 반복 복제로 아래로 민 행 수
   * @param item - 이 벌의 항목 값 (반복 구간 밖이면 undefined)
   * @param hasItem - 값을 계산해 넣을지 (헤더·꼬리·빈 벌은 false)
   * @returns 그리기용 셀
   */
  private toDrawCell(
    element: GridElement,
    cell: GridCell,
    rowShift: number,
    item: Record<string, unknown> | undefined,
    hasItem: boolean,
  ): DrawGridCell {
    return {
      row: cell.row + rowShift,
      column: cell.column,
      rowSpan: cell.rowSpan ?? 1,
      colSpan: cell.colSpan ?? 1,
      text: hasItem ? this.gridCellText(element, cell, item) : '',
      fontName: cell.fontName ?? element.fontName,
      fontSize: cell.fontSize ?? element.fontSize,
      alignment: cell.alignment ?? element.alignment,
      bold: cell.bold ?? element.bold,
      italic: cell.italic ?? element.italic,
      underline: cell.underline ?? element.underline,
      strikethrough: cell.strikethrough ?? element.strikethrough,
      verticalAlignment: cell.verticalAlignment ?? element.verticalAlignment,
      lineHeight: cell.lineHeight ?? element.lineHeight,
      characterSpacing: cell.characterSpacing ?? element.characterSpacing,
      vertical: cell.vertical ?? element.vertical,
      fontColor: cell.fontColor ?? element.fontColor,
      backgroundColor: cell.backgroundColor,
      borderColor: cell.borderColor,
      borderWidth: cell.borderWidth,
      borderStyle: cell.borderStyle,
      overflow: cell.overflow,
    };
  }

  /**
   * 반복 구간 행을 이 페이지 몫만큼 펼쳐 그리기용 셀로 만든다 (ADR-037/038).
   *
   * 켠 열(autoMerge)은 앞 벌과 값이 같은 칸을 세로로 합친다 — 페이지 단위로만 보므로
   * (chunk가 이 페이지 몫) 페이지가 바뀌면 저절로 끊기고 값이 다시 그려진다. 빈 값·항목 없음은
   * 합치지 않고 그대로 그린다.
   *
   * @param element - 그리드 요소
   * @param repeat - 반복 구간 설정
   * @param renderPage - 몇 번째 출력 페이지인지 (0부터)
   * @returns 반복 구간에서 나온 그리기용 셀 목록
   */
  private expandRepeatBand(
    element: GridElement,
    repeat: NonNullable<GridElement['repeat']>,
    renderPage: number,
  ): DrawGridCell[] {
    const { fromRow, toRow, perPage } = repeat;
    const bandRows = toRow - fromRow + 1;
    const items = this.repeatItems(element, repeat.binding);
    const chunk = items.slice(renderPage * perPage, (renderPage + 1) * perPage);

    const autoMergeColumns = new Set<number>();
    element.columns.forEach((column, c) => {
      if (column.autoMerge === true) autoMergeColumns.add(c);
    });
    const cellMerges = (cell: GridCell): boolean => {
      const colSpan = cell.colSpan ?? 1;
      for (let c = cell.column; c < cell.column + colSpan; c++) {
        if (autoMergeColumns.has(c)) return true;
      }
      return false;
    };
    // 반복 구간 칸(틀 좌표)별 병합 기준 칸 — 앞 벌과 값이 같으면 이 칸의 높이를 늘린다
    const anchors = new Map<string, { cell: DrawGridCell; text: string }>();
    const cells: DrawGridCell[] = [];

    for (let i = 0; i < perPage; i++) {
      const item = chunk[i];
      const hasItem = item !== undefined;
      for (const cell of element.cells) {
        if (cell.row < fromRow || cell.row > toRow) continue;
        const draw = this.toDrawCell(element, cell, i * bandRows, item, hasItem);
        if (!cellMerges(cell)) {
          cells.push(draw);
          continue;
        }
        const key = `${cell.row},${cell.column}`;
        // 빈 값·항목 없음은 합치지 않는다 — 병합을 끊고 그대로 그린다 (ADR-038)
        if (!hasItem || draw.text === '') {
          anchors.delete(key);
          cells.push(draw);
          continue;
        }
        const anchor = anchors.get(key);
        if (anchor && anchor.text === draw.text) {
          anchor.cell.rowSpan += bandRows;
          continue; // 앞 칸에 흡수 — 이 칸은 그리지 않는다
        }
        anchors.set(key, { cell: draw, text: draw.text });
        cells.push(draw);
      }
    }
    return cells;
  }

  private gridLayout(
    element: GridElement,
    renderPage: number,
  ): { rowHeights: number[]; cells: DrawGridCell[]; blankRows: Set<number> } {
    const templateHeights = element.rows.map((row) => row.height);
    const repeat = element.repeat;
    if (!repeat) {
      return {
        rowHeights: templateHeights,
        cells: element.cells.map((cell) => this.toDrawCell(element, cell, 0, undefined, true)),
        blankRows: new Set<number>(),
      };
    }

    const { fromRow, toRow, perPage, repeatHeader } = repeat;
    const bandRows = toRow - fromRow + 1;

    // 행 높이: 반복 구간(band)을 perPage번 되풀이해 앞·뒤 고정 행 사이에 끼운다.
    // 결과 높이가 gridElementSchema가 검증한 요소 높이(templateHeight + (perPage-1)*bandHeight)와
    // 정확히 같아 자리가 어긋나지 않는다 (checkGridTrackSums 참조).
    const band = templateHeights.slice(fromRow, toRow + 1);
    const rowHeights: number[] = [
      ...templateHeights.slice(0, fromRow),
      ...Array.from({ length: perPage }, () => band).flat(),
      ...templateHeights.slice(toRow + 1),
    ];

    // 이어지는 페이지에서 헤더를 반복하지 않으면 그 자리를 비운다 — 그리드 크기는 그대로라
    // 아래 요소의 자리가 흔들리지 않는다 (SPEC §5.7)
    const hideHeader = renderPage > 0 && !repeatHeader;
    const blankRows = new Set<number>();
    if (hideHeader) for (let r = 0; r < fromRow; r++) blankRows.add(r);

    // 위에서 아래 순서로 담는다 — 헤더 → 반복 구간 → 꼬리
    const cells: DrawGridCell[] = [];
    if (!hideHeader) {
      for (const cell of element.cells) {
        if (cell.row < fromRow) cells.push(this.toDrawCell(element, cell, 0, undefined, true));
      }
    }
    cells.push(...this.expandRepeatBand(element, repeat, renderPage));
    for (const cell of element.cells) {
      if (cell.row > toRow) cells.push(this.toDrawCell(element, cell, (perPage - 1) * bandRows, undefined, true));
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

  /** 셀에 표시할 글 — 직접 입력 · 파라미터 · 수식 중 하나 (SPEC §5.7) */
  private gridCellText(
    element: GridElement,
    cell: GridCell,
    item: Record<string, unknown> | undefined,
  ): string {
    const what = `그리드 '${element.name}'(${element.id})의 셀(${cell.row},${cell.column})`;
    // 반복 구간 안에서는 그 항목의 필드가 이름 그대로 보인다 (같은 이름이면 항목이 우선)
    const scope = item === undefined ? this.values : { ...this.values, ...item };
    if (cell.formula !== undefined) {
      return toDisplayText(this.evaluate(cell.formula, scope, what), what);
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
    //    테두리 설정(굵은 쪽 우선)을 적용해 같은 스타일 구간끼리 이어 그린다 (ADR-033).
    //    가로선(행 경계)과 세로선(열 경계)은 축만 뒤바뀔 뿐 루프 구조가 같아 한 헬퍼로 그린다.
    //    두 축의 차이는 `GridLineAxis` 콜백에 드러나 있다 — 특히 빈 행 처리가 다르다:
    //    가로선은 빈 행에 둘러싸인 줄 전체를 지우고(skipLine), 세로선은 빈 행에서 구간을 끊는다(breakAt).
    this.drawGridLines({
      lines: rows,
      cells: columns,
      idPrefix: `${grid.idPrefix}__h`,
      // 비운 행에 둘러싸인 가로선은 그리지 않는다 (헤더 미반복, SPEC §5.7)
      skipLine: (r) =>
        (blankRows.has(r - 1) && blankRows.has(r)) ||
        (r === 0 && blankRows.has(0)) ||
        (r === rows && blankRows.has(rows - 1)),
      neighbors: (r, c) => [
        r > 0 ? (owner[r - 1]?.[c] ?? -1) : null,
        r < rows ? (owner[r]?.[c] ?? -1) : null,
      ],
      emit: (schemas2, id, r, start, endExclusive, border) => {
        const x = originX + (columnOffsets[start] ?? 0);
        const end = originX + (columnOffsets[endExclusive] ?? 0);
        this.pushLine(
          schemas2,
          id,
          { x, y: Math.max(0, originY + (rowOffsets[r] ?? 0) - border.width / 2) },
          end - x,
          border.width,
          border.color,
          border.style,
        );
      },
    }, edgeBorderOf, schemas);
    this.drawGridLines({
      lines: columns,
      cells: rows,
      idPrefix: `${grid.idPrefix}__v`,
      // 비운 행에서 세로선 구간을 끊는다 (해당 칸에는 세로선을 긋지 않는다)
      breakAt: (r) => blankRows.has(r),
      neighbors: (c, r) => [
        c > 0 ? (owner[r]?.[c - 1] ?? -1) : null,
        c < columns ? (owner[r]?.[c] ?? -1) : null,
      ],
      emit: (schemas2, id, c, start, endExclusive, border) => {
        const y = originY + (rowOffsets[start] ?? 0);
        const end = originY + (rowOffsets[endExclusive] ?? 0);
        this.pushLine(
          schemas2,
          id,
          { x: Math.max(0, originX + (columnOffsets[c] ?? 0) - border.width / 2), y },
          border.width,
          end - y,
          border.color,
          border.style,
        );
      },
    }, edgeBorderOf, schemas);

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
          verticalAlignment: cell.verticalAlignment ?? 'middle',
          fontColor: cell.fontColor,
          backgroundColor: NO_COLOR,
          padding,
          bold: cell.bold,
          italic: cell.italic,
          underline: cell.underline,
          strikethrough: cell.strikethrough,
          lineHeight: cell.lineHeight,
          characterSpacing: cell.characterSpacing,
        },
      );
      let value = stackVertically(cell.text, cell.vertical);
      if (overflow === 'shrink') {
        // 칸에 들어갈 때까지 글자 크기를 줄인다 — 하부 엔진이 세로 기준으로 맞춘다
        schema.dynamicFontSize = { min: MIN_SHRINK_FONT_SIZE, max: fontSize, fit: 'vertical' };
      } else if (overflow === 'clip') {
        value = this.clipToBox(value, rect.width - padding * 2, rect.height - padding * 2, {
          fontName: schema.fontName as string | undefined,
          fontSize,
          // 실제 렌더에 쓰는 자간·줄간격으로 재야 잘라낼 줄 수가 맞는다 (그러지 않으면
          // 넘칠 부분이 남거나 과하게 잘린다)
          characterSpacing: cell.characterSpacing,
          lineHeight: cell.lineHeight,
        });
      }
      this.push(schemas, schema, value);
    });
  }

  /**
   * 한 축(가로/세로)의 그리드선을 그린다 — 병합 내부 경계는 건너뛰고, 같은 스타일 구간을
   * 한 선으로 이어 그린다 (ADR-033). 가로·세로 패스가 축만 다르고 구조가 같아 공통화했다.
   *
   * @param axis - 축 서술 (경계선 수·셀 수·빈 행 처리·이웃·선분 그리기)
   * @param edgeBorderOf - 맞닿는 두 칸의 유효 테두리 (굵은 쪽 우선)
   * @param schemas - 선 스키마를 담을 배열
   */
  private drawGridLines(
    axis: GridLineAxis,
    edgeBorderOf: (front: number | null, back: number | null) => GridEdgeBorder,
    schemas: Schema[],
  ): void {
    for (let line = 0; line <= axis.lines; line++) {
      if (axis.skipLine?.(line)) continue;
      let run: { start: number; border: GridEdgeBorder } | null = null;
      const flush = (endExclusive: number): void => {
        if (!run) return;
        axis.emit(schemas, `${axis.idPrefix}-${line}-${run.start}`, line, run.start, endExclusive, run.border);
        run = null;
      };
      for (let cell = 0; cell < axis.cells; cell++) {
        if (axis.breakAt?.(cell)) {
          flush(cell);
          continue;
        }
        const [front, back] = axis.neighbors(line, cell);
        const mergedInterior = front !== null && back !== null && front !== -1 && front === back;
        const border = mergedInterior ? null : edgeBorderOf(front, back);
        if (border === null || border.width <= 0) {
          flush(cell);
          continue;
        }
        if (run && sameGridBorder(run.border, border)) continue;
        flush(cell);
        run = { start: cell, border };
      }
      flush(axis.cells);
    }
  }

  /** 칸 높이를 넘는 줄을 잘라낸다. 잴 수 없으면 그대로 둔다 (ADR-037) */
  private clipToBox(
    text: string,
    widthMm: number,
    heightMm: number,
    style: {
      fontName?: string | undefined;
      fontSize: number;
      characterSpacing?: number | undefined;
      lineHeight?: number | undefined;
    },
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

  /**
   * src 해소 (§3.1): data:는 그대로, asset://은 문서 assets에서, 외부 URL은 거부 (ADR-036).
   * `binding`을 쓰는 변동 이미지는 전표 값에서 base64를 읽는다 (ADR-036).
   */
  private resolveImageSrc(element: ImageElement): string {
    const what = `이미지 '${element.name}'(${element.id})`;
    const src = element.binding !== undefined
      ? this.boundImageSrc(element, element.binding, what)
      : element.src;
    if (src === undefined) {
      throw new SlipRenderError(`${what}에 그릴 이미지가 없습니다 (src 또는 binding 필요)`);
    }
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

  /**
   * 바코드 요소 — 하부 엔진의 바코드 스키마로 넘긴다.
   * 값 규칙(EAN-13은 숫자 13자리 등)은 엔진이 검사하며, 어긋나면 렌더가 실패한다.
   */
  private appendBarcode(schemas: Schema[], element: BarcodeElement): void {
    const schema: Schema = {
      name: element.id,
      type: element.kind,
      position: element.position,
      width: element.width,
      height: element.height,
      content: '',
      barColor: element.fontColor ?? DEFAULT_FONT_COLOR,
      backgroundColor: element.backgroundColor ?? NO_COLOR,
    } as unknown as Schema;
    this.push(schemas, schema, this.barcodeValue(element));
  }

  /** 바코드에 넣을 값 — 직접 입력·전표 값·수식 중 하나 */
  private barcodeValue(element: BarcodeElement): string {
    const what = `바코드 '${element.name}'(${element.id})`;
    if (element.content !== undefined) return element.content;
    if (element.formula !== undefined) {
      return toDisplayText(this.evaluate(element.formula, this.values, what), what);
    }
    if (element.binding !== undefined) return toDisplayText(this.values[element.binding], what);
    return '';
  }

  /**
   * 변동 이미지의 값 읽기 — 전표 값에서 base64를 꺼낸다.
   *
   * @param element - 이미지 요소
   * @param binding - 값 키
   * @param what - 오류 문구에 쓸 요소 이름
   * @returns `data:` base64 문자열. 값이 없으면 `undefined`(빈 자리로 둔다)
   * @throws SlipRenderError 값이 문자열이 아니거나 base64가 아닐 때
   */
  private boundImageSrc(
    element: ImageElement,
    binding: string,
    what: string,
  ): string | undefined {
    const value = this.values[binding];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
      throw new SlipRenderError(`${what}의 값 '${binding}'은 이미지 문자열이어야 합니다`);
    }
    if (!value.startsWith('data:')) {
      // core는 네트워크를 쓰지 않는다 (ADR-002) — 주소는 호스트가 base64로 바꿔 보낸다 (ADR-036)
      throw new SlipRenderError(
        `${what}의 값 '${binding}'은 data: base64여야 합니다 (주소는 호스트가 내장해 보내야 합니다)`,
      );
    }
    return value;
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
  italic?: boolean | undefined;
  underline?: boolean | undefined;
  strikethrough?: boolean | undefined;
  /** 수직 정렬 — 지정하지 않으면 칸 가운데 */
  verticalAlignment?: VerticalAlignment | undefined;
  lineHeight?: number | undefined;
  characterSpacing?: number | undefined;
  /** 세로쓰기 */
  vertical?: boolean | undefined;
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

/**
 * 그리드선 한 축(가로 또는 세로)의 서술 — `drawGridLines`가 공통 루프에 끼워 쓴다.
 * 가로선은 `lines`=행 경계, `cells`=열이고 세로선은 그 반대다. 두 축의 차이는 이 콜백에 드러난다.
 */
interface GridLineAxis {
  /** 그릴 경계선 수 (0..lines) — 가로선이면 rows, 세로선이면 columns */
  lines: number;
  /** 한 경계선을 훑을 셀 수 — 가로선이면 columns, 세로선이면 rows */
  cells: number;
  /** 선 id 접두사 (`..._h` / `..._v`) */
  idPrefix: string;
  /** 이 경계선(line) 전체를 건너뛸지 — 가로선의 빈 행 가장자리 처리 (없으면 안 건너뜀) */
  skipLine?: (line: number) => boolean;
  /** 이 셀 위치(cell)에서 구간을 끊을지 — 세로선의 빈 행 처리 (없으면 안 끊음) */
  breakAt?: (cell: number) => boolean;
  /** 경계선(line)의 셀(cell) 위치에서 맞닿는 두 칸의 소유자 인덱스 `[앞, 뒤]` (범위 밖은 null) */
  neighbors: (line: number, cell: number) => [number | null, number | null];
  /** 경계선(line)의 [start, endExclusive) 구간을 border로 한 선분으로 그린다 */
  emit: (
    schemas: Schema[],
    id: string,
    line: number,
    start: number,
    endExclusive: number,
    border: GridEdgeBorder,
  ) => void;
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
  // number 파라미터의 빈 값을 0으로 정규화한다 (ADR-044) — 값이 있는 전표에만 적용한다.
  // 양식(값 없음)은 그대로 비워 둔다 — 빈 양식의 number 필드를 0으로 채우지 않는다.
  const values: Record<string, unknown> =
    file.kind === 'voucher' ? normalizeNumericBindings(file.values, body.bindings) : {};
  return new SlipToPdfmeConverter(
    body,
    values,
    options?.locale,
    options?.fontNames ?? [],
    options?.fallbackFontName,
    new TextMeasurer(options?.fonts ?? []),
  ).convert();
}
