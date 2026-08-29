/**
 * `.slip` 문서를 pdfme 템플릿과 입력값으로 변환한다.
 *
 * - `.slip`과 pdfme 모두 좌표와 길이에 mm 단위를 사용한다.
 * - pdfme 스키마의 레이아웃 속성은 기본값에 의존하지 않고 모두 지정한다.
 * - 렌더 값은 전부 `inputs`로 전달한다(`readOnly`를 쓰지 않는다). readOnly 스키마는
 *   pdfme가 `content`의 `{...}`를 자체 표현식으로 평가하기 때문이다. 수식은
 *   `.slip` 수식 파서에서만 평가한다.
 *
 * 이 모듈은 패키지 내부에서만 사용한다.
 */
import type { Schema, Template } from '@pdfme/common';
import { evaluateFormula } from '../formula/evaluator.js';
import type {
  BarcodeElement,
  ConditionalFormatRule,
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
import { normalizeNumericParameters } from '../format/normalize.js';
import { elementBounds } from '../format/schema.js';
import {
  filterVisibleOnPage,
  planSourcePage,
  type GridFragment,
  type GridItem,
  type GridPlan,
  type PlannedBand,
  type SourcePagePlan,
} from '../layout/index.js';
import { resolveConditionalFormats, type ConditionalFormatOverrides } from './conditional.js';
import { SlipRenderError } from './errors.js';
import { rm } from './messages.js';
import { TextMeasurer } from './measure.js';
import { stackVertically } from './text-layout.js';
import type { SlipFont } from './types.js';

// ---------------------------------------------------------------------------
// 렌더링 기본값
// ---------------------------------------------------------------------------

const DEFAULT_FONT_SIZE = 10;
/** 페이지 번호 기본 글자 크기(pt) */
const PAGE_NUMBER_FONT_SIZE = 9;
/** pt → mm */
const PT_TO_MM = 25.4 / 72;
/** 페이지 번호 상자 높이에 적용할 글자 높이 배수 */
const PAGE_NUMBER_BOX_LINE_HEIGHT = 1.6;
const DEFAULT_FONT_COLOR = '#000000';
const DEFAULT_BORDER_COLOR = '#000000';
/** 선·테두리 두께 기본값(mm) */
const DEFAULT_BORDER_WIDTH = 0.2;
/** pdfme에서 색 없음을 나타내는 값 */
const NO_COLOR = '';
/** 그리드 셀 안쪽 여백(mm) */
const GRID_CELL_PADDING = 1;
/** 셀에 맞춰 글자 크기를 줄일 때 적용할 최솟값(pt). */
const MIN_SHRINK_FONT_SIZE = 4;
/**
 * 파선과 점선을 구성하는 선분 및 간격 길이(mm).
 * 렌더링 엔진이 파선을 지원하지 않아 여러 직선으로 나누어 그린다.
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

/** pdfme `generate`에 전달할 변환 결과 */
export interface PdfmeRenderInput {
  template: Template;
  inputs: Record<string, string>[];
}

// ---------------------------------------------------------------------------
// 값 문자열화 (수식 엔진 CONCAT의 문자열화 규칙과 같다)
// ---------------------------------------------------------------------------

/**
 * 값을 수식 엔진의 `CONCAT`과 같은 규칙으로 표시용 문자열로 변환한다.
 *
 * @param value - 문자열화할 값 (문자열·수·논리·빈 값)
 * @param what - 오류 메시지에 쓸 대상 이름
 * @param locale - 오류 메시지에 사용할 BCP 47 로케일 (생략하면 영어)
 * @returns 표시용 문자열 (빈 값은 빈 문자열)
 * @throws SlipRenderError 배열·객체이거나 유한하지 않은 수면
 */
function toDisplayText(value: unknown, what: string, locale?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SlipRenderError(rm(locale).notFinite(what));
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  throw new SlipRenderError(rm(locale).notText(what));
}

// ---------------------------------------------------------------------------
// 변환기
// ---------------------------------------------------------------------------

class SlipToPdfmeConverter {
  private readonly usedNames = new Set<string>();
  private readonly inputs: Record<string, string> = {};
  /** 반복 그리드 id별 실제 항목 배열 (`maxItems` 적용 전) — 셀 값과 예약 참조에 쓴다. */
  private readonly gridItems = new Map<string, readonly GridItem[]>();

  constructor(
    private readonly body: SlipTemplateBody,
    private readonly values: Record<string, unknown>,
    private readonly locale?: string,
    private readonly fontNames: readonly string[] = [],
    private readonly fallbackFontName?: string,
    private readonly measurer: TextMeasurer = new TextMeasurer(),
  ) {}

  /**
   * 기본 폰트의 Bold 변형 이름을 찾는다.
   * 등록된 변형이 없으면 `undefined`를 반환한다.
   */
  private resolveBoldFont(fontName: string | undefined): string | undefined {
    return this.resolveVariantFontName(fontName, 'Bold');
  }

  /**
   * 기본 폰트에서 요청한 굵기와 기울임 변형의 이름을 찾는다.
   * 등록된 변형이 없으면 `undefined`를 반환한다.
   */
  private resolveVariantFontName(fontName: string | undefined, variant: string): string | undefined {
    const base = fontName ?? this.fallbackFontName;
    if (!base) return undefined;
    const candidate = `${base}-${variant}`;
    return this.fontNames.includes(candidate) ? candidate : undefined;
  }

  /**
   * 굵기와 기울임을 반영할 폰트 이름을 결정한다.
   * 두 스타일이 모두 필요하면 `<이름>-BoldItalic`을 먼저 찾고, 등록된 변형이 없으면
   * 기본 폰트를 사용한다.
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
    // 반복 그리드의 항목이 페이지를 넘으면 하나의 문서 페이지를 여러 출력 페이지로 나눈다.
    // 출력 페이지 수와 요소 배치는 페이지 계획 계층의 결과를 그대로 사용한다.
    const schemas: Schema[][] = [];
    // 페이지 번호를 추가할 때 사용하도록 각 출력 페이지의 원본 페이지를 기록한다.
    const outputPages: SlipPage[] = [];
    for (const page of this.body.pages) {
      const itemsByGrid = new Map<string, readonly GridItem[]>();
      for (const element of page.elements) {
        if (element.type === 'grid' && element.repeat !== undefined) {
          const items = this.repeatItems(element, element.repeat.parameter);
          itemsByGrid.set(element.id, items);
          this.gridItems.set(element.id, items);
        }
      }
      const plan = planSourcePage(this.body.paper, page, itemsByGrid, this.locale);
      for (let renderPage = 0; renderPage < plan.outputPageCount; renderPage++) {
        const pageSchemas: Schema[] = [];
        for (const element of page.elements) {
          this.appendElement(pageSchemas, element, renderPage, plan);
        }
        schemas.push(pageSchemas);
        outputPages.push(page);
      }
    }
    // 페이지 번호는 전체 페이지 수가 정해진 뒤 추가한다.
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
   * 양식에 지정된 위치와 형식으로 페이지 번호를 추가한다.
   *
   * 반복 그리드로 출력 페이지 수가 달라질 수 있으므로 모든 페이지를 변환한 뒤 호출한다.
   *
   * @param schemas - 페이지 번호 스키마를 추가할 페이지별 스키마 목록
   * @param outputPages - 각 출력 페이지에 대응하는 원본 페이지
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

  /** 용지 여백 안쪽에 페이지 번호 상자를 추가한다. */
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

  /** pdfme가 값을 이름으로 찾을 수 있도록 문서 전체에서 고유한 이름을 만든다. */
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

  private appendElement(schemas: Schema[], element: SlipElement, renderPage: number, plan: SourcePagePlan): void {
    // 반복 그리드는 계획된 조각이 있는 페이지에만 그린다.
    if (element.type === 'grid' && element.repeat !== undefined) {
      const fragment = plan.gridPlans
        .get(element.id)
        ?.fragments.find((candidate) => candidate.outputPage === renderPage);
      if (fragment !== undefined) {
        this.appendGrid(schemas, element, renderPage, plan.gridPlans.get(element.id)!, fragment);
      }
      return;
    }

    // 그 밖의 요소는 배치 설정에 따라 표시 페이지와 위치를 정한다.
    const placement = element.pagePlacement;
    let target = element;
    if (placement?.mode === 'after') {
      const planned = plan.afterPlacements.get(element.id);
      if (planned === undefined || planned.outputPage !== renderPage) return;
      if (planned.y !== element.position.y) {
        target = { ...element, position: { x: element.position.x, y: planned.y } } as SlipElement;
      }
    } else if (!filterVisibleOnPage(placement?.pages, renderPage, plan.outputPageCount)) {
      return;
    }

    switch (target.type) {
      case 'text':
        this.appendText(schemas, target);
        return;
      case 'field':
        this.appendField(schemas, target);
        return;
      case 'grid':
        this.appendStaticGrid(schemas, target);
        return;
      case 'image':
        this.appendImage(schemas, target);
        return;
      case 'barcode':
        this.appendBarcode(schemas, target);
        return;
      case 'line':
        this.appendLine(schemas, target);
        return;
      case 'rect':
        this.appendRect(schemas, target);
        return;
      case 'ellipse':
        this.appendEllipse(schemas, target);
        return;
      case 'polygon':
        this.appendPolygon(schemas, target);
        return;
    }
  }

  // -------------------------------------------------------------------------
// 텍스트와 필드
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
    // 등록된 폰트 변형으로 굵기와 기울임을 적용한다.
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
      // 테두리 두께를 지정한 요소에만 테두리를 그린다.
      borderWidth: box(style.borderWidth ?? 0),
      padding: box(style.padding),
      opacity: 1,
      strikethrough: style.strikethrough === true,
      underline: style.underline === true,
    };
    // fontName이 undefined이면 pdfme가 대체 폰트를 사용한다.
    if (fontName !== undefined) schema.fontName = fontName;
    return schema;
  }

  /**
   * 텍스트와 필드 요소의 공통 속성으로 pdfme 글자 스타일을 만든다.
   *
   * @param element - 텍스트 또는 필드 요소
   * @returns pdfme text 스키마에 전달할 스타일 객체
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
    const conditional = this.conditionalColors(
      element.conditionalFormats,
      this.values,
      rm(this.locale).subjectText(element.name, element.id),
    );
    const schema = this.textSchema(
      element.id,
      element.position,
      element.width,
      element.height,
      { ...this.textStyleFromElement(element), ...conditional },
    );
    // 직접 입력한 텍스트도 pdfme 표현식 평가를 거치지 않도록 inputs로 전달한다.
    this.push(schemas, schema, stackVertically(element.content, element.vertical));
  }

  private appendField(schemas: Schema[], element: FieldElement): void {
    const conditional = this.conditionalColors(
      element.conditionalFormats,
      this.values,
      rm(this.locale).subjectField(element.name, element.id),
    );
    const schema = this.textSchema(
      element.id,
      element.position,
      element.width,
      element.height,
      { ...this.textStyleFromElement(element), ...conditional },
    );
    this.push(schemas, schema, stackVertically(this.fieldValue(element), element.vertical));
  }

  /**
   * 요소·셀의 조건부 서식을 평가한다.
   *
   * @param rules - 조건부 서식 규칙 목록
   * @param scope - 조건식이 참조할 값 범위
   * @param subject - 오류 메시지에 쓸 대상 이름
   * @returns 덮어쓸 색·강조 목록
   */
  private conditionalColors(
    rules: readonly ConditionalFormatRule[] | undefined,
    scope: Record<string, unknown>,
    subject: string,
    reserved?: Readonly<Record<string, unknown>>,
  ): ConditionalFormatOverrides {
    return resolveConditionalFormats(rules, scope, {
      subject,
      ...(this.locale === undefined ? {} : { locale: this.locale }),
      ...(reserved === undefined ? {} : { reserved }),
    });
  }

  /**
   * 로케일을 적용해 요소 수식을 평가하고 오류를 렌더링 오류로 변환한다.
   *
   * @param formula - 평가할 수식 문자열
   * @param scope - 수식이 참조할 값 범위(전표 값, 반복 항목 등)
   * @param what - 오류 메시지에 쓸 대상 이름
   * @returns 평가 결과 값
   * @throws SlipRenderError 수식 계산에 실패하면
   */
  private evaluate(
    formula: string,
    scope: Record<string, unknown>,
    what: string,
    reserved?: Readonly<Record<string, unknown>>,
  ): unknown {
    try {
      return evaluateFormula(formula, {
        values: scope,
        ...(this.locale === undefined ? {} : { locale: this.locale }),
        ...(reserved === undefined ? {} : { reserved }),
      });
    } catch (error) {
      throw new SlipRenderError(
        rm(this.locale).formulaFailed(what, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * 필드의 파라미터 값 또는 수식 결과를 표시용 문자열로 변환한다.
   *
   * @param element - 필드 요소
   * @returns 표시용 문자열
   */
  private fieldValue(element: FieldElement): string {
    const what = rm(this.locale).subjectField(element.name, element.id);
    if (element.formula !== undefined) {
      // 편집 중인 빈 수식은 빈 문자열로 표시한다.
      if (element.formula.trim() === '') return '';
      return toDisplayText(this.evaluate(element.formula, this.values, what), what, this.locale);
    }
    return element.parameter === undefined
      ? ''
      : toDisplayText(this.values[element.parameter], what, this.locale);
  }

  // -------------------------------------------------------------------------
  // grid
  // -------------------------------------------------------------------------
  /** 정적 그리드(반복 없음)를 표시 위치에 그린다. */
  private appendStaticGrid(schemas: Schema[], element: GridElement): void {
    const rowHeights = element.rows.map((row) => row.height);
    const cells = element.cells.map((cell) =>
      this.toDrawCell(element, cell, 0, { scope: this.values, hasValue: true }),
    );
    this.drawGridFragment(schemas, element, `${element.id}__p0`, element.position.y, rowHeights, cells);
  }

  /** 계획된 그리드 조각 하나를 출력 페이지에 그린다. */
  private appendGrid(
    schemas: Schema[],
    element: GridElement,
    renderPage: number,
    plan: GridPlan,
    fragment: GridFragment,
  ): void {
    const cells = this.fragmentCells(element, plan, fragment);
    this.drawGridFragment(
      schemas,
      element,
      `${element.id}__p${renderPage}`,
      fragment.y,
      fragment.rowHeights,
      cells,
    );
  }

  /** 조각 하나를 pdfme 스키마로 그린다. 그리드 크기는 행·열 정의의 합이다. */
  private drawGridFragment(
    schemas: Schema[],
    element: GridElement,
    idPrefix: string,
    y: number,
    rowHeights: readonly number[],
    cells: DrawGridCell[],
  ): void {
    this.drawGrid(schemas, {
      idPrefix,
      origin: { x: element.position.x, y },
      columnOffsets: cumulative(element.columns.map((column) => column.width)),
      rowOffsets: cumulative([...rowHeights]),
      rows: rowHeights.length,
      columns: element.columns.length,
      cells,
      backgroundColor: element.backgroundColor,
      borderColor: element.borderColor,
      borderWidth: element.borderWidth,
      borderStyle: element.borderStyle,
      padding: GRID_CELL_PADDING,
      blankRows: new Set<number>(),
      overflow: element.overflow ?? 'clip',
    });
  }

  /**
   * 조각의 행 구간 인스턴스들을 그리기용 셀 목록으로 펼친다.
   *
   * `autoMerge` 열에서는 같은 조각 안에서 연속된 항목 인스턴스의 값이 같으면 세로로
   * 병합한다. 병합은 그룹 경계와 페이지 경계에서 종료하며 빈 값과 빈 항목은 병합하지
   * 않는다 (SPEC §15.7).
   */
  private fragmentCells(element: GridElement, plan: GridPlan, fragment: GridFragment): DrawGridCell[] {
    const repeat = element.repeat!;
    const real = (this.gridItems.get(element.id) ?? []).slice(0, plan.itemCount);
    const toValues = (indexes: readonly number[]): GridItem[] => indexes.map((i) => real[i]!);
    const baseReserved: Record<string, unknown> = {
      '@all': real,
      '@page': toValues(fragment.pageItems),
      '@carried': toValues(fragment.carriedItems),
    };

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

    const itemBand = repeat.bands.find((band) => band.placement === 'item')!;
    const itemBandRows = itemBand.toRow - itemBand.fromRow + 1;

    const cells: DrawGridCell[] = [];
    let anchors = new Map<string, { cell: DrawGridCell; text: string }>();
    let lastGroup: number | undefined;

    for (const planned of fragment.bands) {
      const band = planned.band;
      const isItem = band.placement === 'item';
      // 항목 인스턴스가 아닌 구간이 끼어들거나 그룹이 바뀌면 병합 범위를 종료한다.
      if (!isItem || planned.groupIndex !== lastGroup) anchors = new Map();
      lastGroup = isItem ? planned.groupIndex : undefined;

      const item = planned.itemIndex === undefined ? undefined : real[planned.itemIndex];
      const hasValue = planned.emptyItem !== true;
      // 항목·그룹 구간에서는 전표 값보다 현재 항목의 필드를 우선한다.
      const scope = item === undefined ? this.values : { ...this.values, ...item };
      const reserved: Record<string, unknown> = { ...baseReserved };
      if (item !== undefined) reserved['@item'] = item;
      if (planned.groupIndex !== undefined) {
        reserved['@group'] = toValues(plan.groups[planned.groupIndex] ?? []);
      }

      for (const cell of element.cells) {
        if (cell.row < band.fromRow || cell.row > band.toRow) continue;
        const rowShift = planned.rowStart - band.fromRow;
        const draw = this.toDrawCell(element, cell, rowShift, { scope, hasValue, reserved });
        if (!isItem || !cellMerges(cell)) {
          cells.push(draw);
          continue;
        }
        const key = `${cell.row},${cell.column}`;
        // 빈 값과 빈 항목은 병합 범위를 종료한다.
        if (!hasValue || draw.text === '') {
          anchors.delete(key);
          cells.push(draw);
          continue;
        }
        const anchor = anchors.get(key);
        if (anchor && anchor.text === draw.text) {
          anchor.cell.rowSpan += itemBandRows;
          continue; // 앞 셀에 흡수 — 이 셀은 그리지 않는다
        }
        anchors.set(key, { cell: draw, text: draw.text });
        cells.push(draw);
      }
    }
    return cells;
  }

  /**
   * 원본 셀에 그리드 기본 스타일과 값 컨텍스트를 적용해 렌더링용 셀을 만든다.
   *
   * @param element - 셀이 속한 그리드 (기본 스타일·값 계산에 쓴다)
   * @param cell - 원본 셀
   * @param rowShift - 행 구간 배치로 이동한 행 수
   * @param context - 값 범위, 값 계산 여부와 예약 참조
   * @returns 렌더링용 셀
   */
  private toDrawCell(
    element: GridElement,
    cell: GridCell,
    rowShift: number,
    context: { scope: Record<string, unknown>; hasValue: boolean; reserved?: Record<string, unknown> },
  ): DrawGridCell {
    // 빈 항목 인스턴스에는 값이 없으므로 수식과 조건부 서식을 평가하지 않는다.
    const conditional = context.hasValue
      ? this.conditionalColors(
          cell.conditionalFormats,
          context.scope,
          rm(this.locale).subjectGridCell(element.name, element.id, cell.row, cell.column),
          context.reserved,
        )
      : {};
    return {
      row: cell.row + rowShift,
      column: cell.column,
      rowSpan: cell.rowSpan ?? 1,
      colSpan: cell.colSpan ?? 1,
      text: context.hasValue ? this.gridCellText(element, cell, context) : '',
      fontName: cell.fontName ?? element.fontName,
      fontSize: cell.fontSize ?? element.fontSize,
      alignment: cell.alignment ?? element.alignment,
      bold: conditional.bold ?? cell.bold ?? element.bold,
      italic: conditional.italic ?? cell.italic ?? element.italic,
      underline: conditional.underline ?? cell.underline ?? element.underline,
      strikethrough: conditional.strikethrough ?? cell.strikethrough ?? element.strikethrough,
      verticalAlignment: cell.verticalAlignment ?? element.verticalAlignment,
      lineHeight: cell.lineHeight ?? element.lineHeight,
      characterSpacing: cell.characterSpacing ?? element.characterSpacing,
      vertical: cell.vertical ?? element.vertical,
      fontColor: conditional.fontColor ?? cell.fontColor ?? element.fontColor,
      backgroundColor: conditional.backgroundColor ?? cell.backgroundColor,
      borderColor: conditional.borderColor ?? cell.borderColor,
      borderWidth: cell.borderWidth,
      borderStyle: cell.borderStyle,
      overflow: cell.overflow,
    };
  }

  /** 반복에 사용할 항목 배열을 읽는다. */
  private repeatItems(element: GridElement, parameter: string): Record<string, unknown>[] {
    const raw = this.values[parameter];
    const what = rm(this.locale).subjectGrid(element.name, element.id);
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new SlipRenderError(rm(this.locale).repeatNotArray(what, parameter));
    }
    return raw.map((row, index) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new SlipRenderError(rm(this.locale).repeatItemNotObject(what, index + 1));
      }
      return row as Record<string, unknown>;
    });
  }

  /** 직접 입력, 파라미터 또는 수식으로 셀의 표시 값을 만든다 (SPEC §5.7). */
  private gridCellText(
    element: GridElement,
    cell: GridCell,
    context: { scope: Record<string, unknown>; reserved?: Record<string, unknown> },
  ): string {
    const what = rm(this.locale).subjectGridCell(element.name, element.id, cell.row, cell.column);
    if (cell.formula !== undefined) {
      return toDisplayText(
        this.evaluate(cell.formula, context.scope, what, context.reserved),
        what,
        this.locale,
      );
    }
    if (cell.parameter !== undefined) return toDisplayText(context.scope[cell.parameter], what, this.locale);
    return cell.content ?? '';
  }

  // -------------------------------------------------------------------------
  // 그리드 렌더링
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

    // 셀에 지정한 테두리 속성이 그리드 기본값보다 우선한다 (SPEC §5.2).
    const cellBorderOf = (index: number): GridEdgeBorder => {
      const cell = index >= 0 ? cells[index] : undefined;
      return {
        width: cell?.borderWidth ?? lineWidth,
        color: cell?.borderColor ?? lineColor,
        style: cell?.borderStyle ?? lineStyle,
      };
    };
    // 두 셀이 공유하는 경계에는 더 굵은 테두리를 적용한다. 굵기가 같으면 아래쪽 또는
    // 오른쪽 셀의 설정을 사용한다.
    const edgeBorderOf = (front: number | null, back: number | null): GridEdgeBorder => {
      if (front === null) return cellBorderOf(back ?? -1);
      if (back === null) return cellBorderOf(front);
      const a = cellBorderOf(front);
      const b = cellBorderOf(back);
      return b.width >= a.width ? b : a;
    };

    // 각 좌표를 차지하는 셀의 인덱스를 기록한다. 빈 셀은 -1이다.
    const owner: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(-1));
    cells.forEach((cell, index) => {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        for (let c = cell.column; c < cell.column + cell.colSpan; c++) {
          const line = owner[r];
          if (line) line[c] = index;
        }
      }
    });

    // 1. 그리드 배경
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

    // 2. 셀 배경. 병합된 셀은 전체 병합 범위에 적용한다.
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

    // 3. 그리드선. 병합 범위 안쪽의 경계는 생략하고 같은 스타일의 연속 구간을 한 선으로
    //    그린다. 가로선과 세로선의 축별 동작은 GridLineAxis에서 정의한다.
    this.drawGridLines({
      lines: rows,
      cells: columns,
      idPrefix: `${grid.idPrefix}__h`,
      // 헤더를 생략한 빈 행 내부의 가로선은 그리지 않는다 (SPEC §5.7).
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
      // 헤더를 생략한 빈 행에서는 세로선 구간을 나눈다.
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

    // 4. 셀 텍스트
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
        // 셀 높이에 맞을 때까지 글자 크기를 줄인다.
        schema.dynamicFontSize = { min: MIN_SHRINK_FONT_SIZE, max: fontSize, fit: 'vertical' };
      } else if (overflow === 'clip') {
        value = this.clipToBox(value, rect.width - padding * 2, rect.height - padding * 2, {
          fontName: schema.fontName as string | undefined,
          fontSize,
          // 실제 렌더링과 같은 자간과 줄 간격으로 표시 가능한 줄 수를 계산한다.
          characterSpacing: cell.characterSpacing,
          lineHeight: cell.lineHeight,
        });
      }
      this.push(schemas, schema, value);
    });
  }

  /**
   * 한 축의 그리드선을 그린다. 병합 내부의 경계를 생략하고 같은 스타일의 연속 구간을
   * 하나의 선으로 만든다.
   *
   * @param axis - 축별 경계 수, 빈 행 처리 및 선분 생성 함수
   * @param edgeBorderOf - 맞닿은 두 셀 중 적용할 테두리를 선택하는 함수
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

  /** 셀 높이를 초과하는 줄을 제거한다. 높이를 측정할 수 없으면 원문을 반환한다. */
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
// 이미지와 도형
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
   * 이미지 소스를 해석한다. `data:` URL은 그대로 사용하고 `asset://` 참조는 문서의
   * 에셋에서 찾는다. 외부 URL은 렌더링하지 않으며 변동 이미지는 전표 값의 base64 데이터를
   * 사용한다 (SPEC §3.1).
   */
  private resolveImageSrc(element: ImageElement): string {
    const what = rm(this.locale).subjectImage(element.name, element.id);
    const src = element.parameter !== undefined
      ? this.boundImageSrc(element, element.parameter, what)
      : element.src;
    if (src === undefined) {
      throw new SlipRenderError(rm(this.locale).noImageSource(what));
    }
    if (src.startsWith('data:')) return src;
    if (src.startsWith('asset://')) {
      const assetId = src.slice('asset://'.length);
      const asset = this.body.assets.find((entry) => entry.id === assetId);
      if (!asset) {
        throw new SlipRenderError(rm(this.locale).missingAsset(what, assetId));
      }
      if (!asset.src.startsWith('data:')) {
        throw new SlipRenderError(rm(this.locale).assetNotEmbedded(what, assetId));
      }
      return asset.src;
    }
    throw new SlipRenderError(rm(this.locale).externalUrl(what, src));
  }

  /**
   * 바코드 요소를 pdfme 바코드 스키마로 변환한다.
   * 바코드 종류별 값 형식은 pdfme가 검증한다.
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

  /** 직접 입력, 전표 값 또는 수식으로 바코드 값을 만든다. */
  private barcodeValue(element: BarcodeElement): string {
    const what = rm(this.locale).subjectBarcode(element.name, element.id);
    if (element.content !== undefined) return element.content;
    if (element.formula !== undefined) {
      return toDisplayText(this.evaluate(element.formula, this.values, what), what, this.locale);
    }
    if (element.parameter !== undefined) {
      return toDisplayText(this.values[element.parameter], what, this.locale);
    }
    return '';
  }

  /**
   * 전표 값에서 변동 이미지의 base64 데이터를 읽는다.
   *
   * @param element - 이미지 요소
   * @param parameter - 값 키
   * @param what - 오류 문구에 쓸 요소 이름
   * @returns `data:` base64 문자열. 값이 없으면 `undefined`
   * @throws SlipRenderError 값이 문자열이 아니거나 base64가 아닐 때
   */
  private boundImageSrc(
    element: ImageElement,
    parameter: string,
    what: string,
  ): string | undefined {
    const value = this.values[parameter];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
      throw new SlipRenderError(rm(this.locale).imageValueNotString(what, parameter));
    }
    if (!value.startsWith('data:')) {
      // core는 외부 URL을 읽지 않으므로 호스트가 이미지를 base64로 변환해야 한다.
      throw new SlipRenderError(rm(this.locale).imageValueNotData(what, parameter));
    }
    return value;
  }

  /** 사각형 요소를 렌더링한다. 파선과 점선 테두리는 여러 선분으로 나눈다. */
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

  /** 실선 테두리를 사용하는 타원 요소를 렌더링한다. */
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

  /** `lineDirection`에 따라 수평선, 수직선 또는 대각선을 렌더링한다. */
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
    // 대각선은 요소 영역의 두 모서리를 잇는다.
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
    // 파선과 점선은 진행 방향을 따라 여러 선분으로 나눈다.
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

  /** 중심점, 길이, 각도로 회전한 선분을 추가한다. */
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

  /** 요소 영역에 내접하고 첫 꼭짓점이 위를 향하는 SVG 정다각형을 만든다. */
  private appendPolygon(schemas: Schema[], element: PolygonElement): void {
    const borderWidth = element.borderWidth ?? DEFAULT_BORDER_WIDTH;
    const borderColor = element.borderColor ?? DEFAULT_BORDER_COLOR;
    const w = element.width;
    const h = element.height;
    const fill = element.backgroundColor ?? 'none';
    const points = polygonPoints(element.sides, w, h)
      .map(([x, y]) => `${round3(x)},${round3(y)}`)
      .join(' ');
    // viewBox 크기를 mm와 일치시켜 stroke-width에도 같은 단위를 적용한다.
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
  // 도형 스키마 생성 함수
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
    // 파선과 점선은 긴 변의 방향을 따라 여러 선분으로 나눈다.
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


/** SVG 좌표를 소수점 셋째 자리로 반올림한다. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 첫 꼭짓점이 위를 향하는 정다각형 좌표를 계산한다.
 * 단위원의 점을 지정한 너비와 높이에 맞게 정규화한다.
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
// 그리드 계산 함수
// ---------------------------------------------------------------------------

/** 값과 상속된 스타일을 적용한 렌더링용 그리드 셀. */
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
  /** 수직 정렬. 기본값은 가운데다. */
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
  /** 누적 오프셋(mm). 길이는 트랙 수보다 하나 많다. */
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
  /** 내용을 렌더링하지 않을 행 (SPEC §5.7) */
  blankRows?: Set<number>;
  /** 셀을 넘치는 글의 기본 처리 */
  overflow?: 'clip' | 'shrink' | undefined;
}

/** 트랙 크기 배열을 누적 오프셋 배열로 변환한다. */
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

/** 셀 설정과 그리드 기본값을 반영한 테두리 설정. */
interface GridEdgeBorder {
  width: number;
  color: string;
  style: BorderStyle;
}

/**
 * `drawGridLines`에서 사용하는 가로축 또는 세로축의 동작 정의.
 */
interface GridLineAxis {
  /** 그릴 경계선 수 */
  lines: number;
  /** 경계선 하나에 포함되는 셀 수 */
  cells: number;
  /** 선 ID 접두사 */
  idPrefix: string;
  /** 경계선 전체를 생략할지 결정하는 함수 */
  skipLine?: (line: number) => boolean;
  /** 현재 셀 위치에서 선분을 나눌지 결정하는 함수 */
  breakAt?: (cell: number) => boolean;
  /** 경계에서 맞닿는 두 셀의 소유자 인덱스를 반환하는 함수 */
  neighbors: (line: number, cell: number) => [number | null, number | null];
  /** 지정한 범위를 하나의 선분으로 그리는 함수 */
  emit: (
    schemas: Schema[],
    id: string,
    line: number,
    start: number,
    endExclusive: number,
    border: GridEdgeBorder,
  ) => void;
}

/** 두 테두리 설정이 같은지 비교한다. */
function sameGridBorder(a: GridEdgeBorder, b: GridEdgeBorder): boolean {
  return a.width === b.width && a.color === b.color && a.style === b.style;
}

// ---------------------------------------------------------------------------
// 공개 변환 함수
// ---------------------------------------------------------------------------

/**
 * `.slip` 파일을 pdfme 템플릿과 입력값으로 변환한다.
 * 양식은 빈 입력값을 사용하고 전표는 양식 스냅샷과 `values`를 사용한다.
 *
 * @param file - 변환할 `.slip` 파일
 * @param options - 로케일, 사용 가능한 폰트 이름, 대체 폰트 및 글자 측정용 폰트 데이터
 * @returns pdfme `generate`에 넘길 템플릿과 입력값
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
  // 전표의 빈 number 파라미터만 0으로 정규화한다. 값이 없는 양식에는 적용하지 않는다.
  const values: Record<string, unknown> =
    file.kind === 'voucher' ? normalizeNumericParameters(file.values, body.parameters) : {};
  return new SlipToPdfmeConverter(
    body,
    values,
    options?.locale,
    options?.fontNames ?? [],
    options?.fallbackFontName,
    new TextMeasurer(options?.fonts ?? []),
  ).convert();
}
