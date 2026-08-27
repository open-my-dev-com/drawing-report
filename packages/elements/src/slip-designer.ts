import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import {
  parseSlipFile,
  renderSlipToPdf,
  parseFormula,
  evaluateFormula,
  stackVertically,
  type SlipFile,
  type SlipTemplateFile,
  type SlipElement,
  type TextElement,
  type FieldElement,
  type BarcodeElement,
  type LineElement,
  type PolygonElement,
  type ImageElement,
  type GridElement,
  type GridCell,
  type GridRepeat,
  type PageNumberPosition,
  type BarcodeKind,
  type ParameterValueType,
  type SlipPage,
  type RenderOptions,
  type SlipListItem,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { getFormulaHelp } from './formula-help.js';
import { resolveFonts, type SlipDesignerSettings, type PaperSize } from './settings.js';
import { getPresets, type SlipPreset } from './presets.js';
import { icons } from './icons.js';
import { pickImageFile, formatBytes } from './image-file.js';

/** 색 선택기에 표시할 기본 색상 */
const COLOR_PALETTE = [
  '#000000', '#ffffff', '#f2f2f2', '#d93025', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
] as const;

/** 사용자 지정 색상을 저장하는 localStorage 키 */
const CUSTOM_COLORS_KEY = 'slipkit-designer-custom-colors';
/** 파라미터 키와 충돌하지 않는 "새 값 등록" 항목의 내부 값 */
const NEW_BINDING_OPTION = '\u0000new';

/** 저장할 수 있는 사용자 지정 색상의 최대 개수 */
const MAX_CUSTOM_COLORS = 30;

/** 저장된 사용자 지정 색상을 읽는다. 읽을 수 없으면 빈 목록을 반환한다. */
function loadCustomColors(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_CUSTOM_COLORS);
  } catch {
    return [];
  }
}

/**
 * 색상을 사용자 지정 목록에 저장하고 갱신된 목록을 반환한다.
 * 기존 색상은 목록의 끝으로 이동하고 최대 개수를 넘으면 가장 오래된 색상을 제거한다.
 */
function saveCustomColor(color: string): string[] {
  const list = loadCustomColors().filter((c) => c !== color);
  list.push(color);
  while (list.length > MAX_CUSTOM_COLORS) list.shift();
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(list));
  } catch {
    // localStorage를 사용할 수 없어도 문서 편집은 계속한다.
  }
  return list;
}

/** 세로 방향을 기준으로 정의한 기본 용지 크기(mm) */
const PAPER_PRESETS = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'B5', width: 176, height: 250 },
  { name: 'Letter', width: 215.9, height: 279.4 },
] as const;

/**
 * 속성 패널에서 X와 Y 좌표의 기준으로 사용할 9개 지점.
 * 파일에는 기준점과 관계없이 왼쪽 위 좌표를 저장한다.
 */
const ANCHORS = [
  { key: 'anchorTL', ax: 0, ay: 0 },
  { key: 'anchorT', ax: 0.5, ay: 0 },
  { key: 'anchorTR', ax: 1, ay: 0 },
  { key: 'anchorL', ax: 0, ay: 0.5 },
  { key: 'anchorC', ax: 0.5, ay: 0.5 },
  { key: 'anchorR', ax: 1, ay: 0.5 },
  { key: 'anchorBL', ax: 0, ay: 1 },
  { key: 'anchorB', ax: 0.5, ay: 1 },
  { key: 'anchorBR', ax: 1, ay: 1 },
] as const;

const PX_PER_MM = 96 / 25.4;
const MAX_UNDO = 50;
/**
 * 파라미터 값 종류 선택지.
 * 종류를 지정하지 않은 값은 텍스트로 처리한다.
 */
const BINDING_VALUE_TYPES: readonly { value: string; stringKey: 'valueTypeUnset' | 'valueTypeText' | 'valueTypeNumber' | 'valueTypeDate' | 'valueTypeBoolean' | 'valueTypeImage' | 'valueTypeList' }[] = [
  { value: '', stringKey: 'valueTypeUnset' },
  { value: 'text', stringKey: 'valueTypeText' },
  { value: 'number', stringKey: 'valueTypeNumber' },
  { value: 'date', stringKey: 'valueTypeDate' },
  { value: 'boolean', stringKey: 'valueTypeBoolean' },
  { value: 'image', stringKey: 'valueTypeImage' },
  { value: 'list', stringKey: 'valueTypeList' },
];

/**
 * 파라미터 값 종류별 아이콘.
 * 종류를 지정하지 않은 파라미터에는 텍스트 아이콘을 사용한다 (SPEC §4).
 */
const VALUE_TYPE_BADGE: Record<string, TemplateResult> = {
  text: icons.typeText,
  number: icons.typeNumber,
  date: icons.typeDate,
  boolean: icons.typeBoolean,
  image: icons.typeImage,
  list: icons.typeList,
};

/**
 * 파라미터·하위 필드 줄에 붙일 아이콘.
 *
 * @param valueType - 값 종류 (없으면 글자)
 * @returns 그 종류의 아이콘
 */
function valueTypeBadge(valueType: string | undefined): TemplateResult {
  return VALUE_TYPE_BADGE[valueType ?? 'text'] ?? icons.typeText;
}

/** 목록 중첩을 제외한 하위 필드의 값 종류 선택지  */
const BINDING_FIELD_VALUE_TYPES = BINDING_VALUE_TYPES.filter((t) => t.value !== 'list');

/** 테두리 굵기 선택지(mm) */
const BORDER_WIDTH_STEPS = [0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2] as const;
/** 샘플 데이터 모달의 페이지당 파라미터 수 */
const SAMPLE_PAGE_SIZE = 10;
/** 요소와 안내선에 맞춤이 적용되는 최대 거리(mm) */
const SNAP_MM = 1.5;

/** 캔버스 눈금자의 두께(px) */
const RULER_PX = 18;

/** 캔버스 격자 간격 선택지(mm) */
const GRID_GAPS = [1, 5, 10] as const;

/**
 * 바코드 종류의 표시 순서와 이름.
 * 국제 표준 이름을 사용하므로 로케일별 문구로 관리하지 않는다.
 */
const BARCODE_KINDS: readonly { value: BarcodeKind; label: string }[] = [
  { value: 'qrcode', label: 'QR Code' },
  { value: 'code128', label: 'CODE128' },
  { value: 'ean13', label: 'EAN-13' },
  { value: 'code39', label: 'CODE39' },
  { value: 'ean8', label: 'EAN-8' },
  { value: 'upca', label: 'UPC-A' },
  { value: 'upce', label: 'UPC-E' },
  { value: 'itf14', label: 'ITF-14' },
  { value: 'nw7', label: 'NW-7 (CODABAR)' },
  { value: 'japanpost', label: 'Japan Post' },
  { value: 'gs1datamatrix', label: 'GS1 DataMatrix' },
  { value: 'pdf417', label: 'PDF417' },
];

/** 캔버스에서 정사각형 격자로 표시할 2차원 바코드 종류 */
const BARCODE_2D: ReadonlySet<BarcodeKind> = new Set(['qrcode', 'gs1datamatrix']);

/**
 * 편집 중인 고정 바코드 값의 형식을 검사한다.
 * 길이가 정해진 종류와 CODE39만 검사하며 파라미터와 수식 값은 검사하지 않는다.
 */
const BARCODE_DIGIT_RULES: Partial<Record<BarcodeKind, number>> = {
  ean13: 13, ean8: 8, upca: 12, itf14: 14,
};

/**
 * 캔버스 격자 색상 선택지.
 * `swatch`는 메뉴에 표시할 색이고 `line`은 캔버스에 그릴 색이다.
 */
const GRID_COLORS = [
  { id: 'gray', nameKey: 'colorGray', swatch: '#80868b', line: 'rgba(0, 0, 0, 0.08)' },
  { id: 'blue', nameKey: 'colorBlue', swatch: '#1a73e8', line: 'rgba(26, 115, 232, 0.2)' },
  { id: 'red', nameKey: 'colorRed', swatch: '#d93025', line: 'rgba(217, 48, 37, 0.16)' },
  { id: 'green', nameKey: 'colorGreen', swatch: '#188038', line: 'rgba(24, 128, 56, 0.16)' },
] as const;

/** 격자 색상 ID */
type GridColorId = (typeof GRID_COLORS)[number]['id'];
/** 크기 조절 최소 폭·높이(mm) */
const MIN_SIZE_MM = 2;

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** mm 좌표를 0.1mm 단위로 반올림 */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 속성 패널에서 지정하지 않은 스타일에 적용할 기본값.
 * core의 PDF 변환 기본값과 같아야 한다.
 */
const DEFAULT_FONT_SIZE = 10;
const DEFAULT_FONT_COLOR = '#000000';
const DEFAULT_BORDER_COLOR = '#000000';
/** 선 굵기 기본값(mm). core의 `DEFAULT_BORDER_WIDTH`와 같아야 한다. */
const DEFAULT_LINE_WIDTH = 0.2;
/**
 * 업로드할 수 있는 이미지 파일의 기본 최대 크기(바이트).
 * base64로 담기면 약 33% 커지므로 2MB 원본이 파일에는 ~2.7MB로 들어간다.
 */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** 사이드바 페이지 미리보기의 너비(px) */
const THUMB_WIDTH_PX = 132;

/**
 * 선 요소의 영역과 방향을 길이와 각도로 변환한다.
 *
 * @remarks
 * 파일에는 선의 영역과 방향을 저장하고 속성 패널에서는 길이와 각도로 편집한다.
 * 각도는 화면 좌표계에서 시계 방향을 양수로 사용하며 0도는 오른쪽, 90도는 아래쪽이다.
 *
 * @param el - 선 요소
 * @returns 길이(mm)와 각도(도)
 */
function lineLengthAngle(el: LineElement): { length: number; angle: number } {
  const w = el.width;
  const h = el.height;
  switch (el.lineDirection ?? 'horizontal') {
    case 'horizontal': return { length: w, angle: 0 };
    case 'vertical': return { length: h, angle: 90 };
    // 대각선은 요소 영역의 두 모서리를 잇는다.
    case 'down': return { length: Math.hypot(w, h), angle: (Math.atan2(h, w) * 180) / Math.PI };
    default: return { length: Math.hypot(w, h), angle: -(Math.atan2(h, w) * 180) / Math.PI };
  }
}

/**
 * 길이와 각도를 파일에 저장할 요소 영역과 방향으로 변환한다.
 *
 * @remarks
 * 0, 90, 180, 270도와의 차이가 0.5도 이내이면 수평선 또는 수직선으로 맞춘다.
 *
 * @param length - 길이(mm)
 * @param angle - 각도(도, 시계 방향)
 * @returns 상자 크기와 방향
 */
function lineBoxFromLengthAngle(
  length: number,
  angle: number,
): { width: number; height: number; lineDirection: 'horizontal' | 'vertical' | 'down' | 'up' } {
  const len = Math.max(0, length);
  // 반대 방향은 같은 선이므로 각도를 0 이상 180도 미만으로 정규화한다.
  let a = ((angle % 360) + 360) % 360;
  if (a >= 180) a -= 180;
  const SNAP = 0.5;
  if (a <= SNAP || a >= 180 - SNAP) return { width: len, height: 0, lineDirection: 'horizontal' };
  if (Math.abs(a - 90) <= SNAP) return { width: 0, height: len, lineDirection: 'vertical' };
  const rad = (a * Math.PI) / 180;
  const width = Math.abs(len * Math.cos(rad));
  const height = Math.abs(len * Math.sin(rad));
  return { width, height, lineDirection: a < 90 ? 'down' : 'up' };
}

/** 글자 크기를 pt에서 CSS px로 변환한다. */
function fontPx(size: number | undefined): string {
  return `${(((size ?? DEFAULT_FONT_SIZE) * 4) / 3).toFixed(2)}px`;
}

/** 가로 정렬 값을 flexbox 정렬 값으로 변환한다. */
function justifyOf(alignment: 'left' | 'center' | 'right' | undefined): string {
  return alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start';
}

/** 수직 정렬 값을 flexbox 정렬 값으로 변환한다. */
function verticalFlexAlign(v: 'top' | 'middle' | 'bottom' | undefined): string {
  return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
}

/**
 * 글자 스타일을 세미콜론으로 시작하는 인라인 CSS 문자열로 변환한다.
 *
 * @param style - 요소·셀의 글자 스타일
 * @param opts - `omitVerticalAlign`이 true이면 `justify-content`를 생략한다.
 */
function textStyleCss(
  style: {
    bold?: boolean | undefined;
    underline?: boolean | undefined;
    strikethrough?: boolean | undefined;
    verticalAlignment?: 'top' | 'middle' | 'bottom' | undefined;
    lineHeight?: number | undefined;
    characterSpacing?: number | undefined;
    vertical?: boolean | undefined;
  },
  opts?: { omitVerticalAlign?: boolean },
): string {
  const decorations = [
    style.underline === true ? 'underline' : '',
    style.strikethrough === true ? 'line-through' : '',
  ].filter(Boolean).join(' ');
  // 그리드 셀은 호출부에서 수직 정렬을 적용하므로 여기서는 선택적으로 생략한다.
  const verticalAlign = opts?.omitVerticalAlign
    ? ''
    : `;justify-content:${verticalFlexAlign(style.verticalAlignment)}`;
  // 브라우저의 합성 italic과 PDF의 폰트 변형 처리 방식이 달라 캔버스에는 italic을 적용하지 않는다.
  return (
    (style.bold === true ? ';font-weight:700' : '') +
    (decorations ? `;text-decoration:${decorations}` : '') +
    verticalAlign +
    // CSS의 half-leading만큼 위쪽 여백을 보정해 PDF와 첫 줄 위치를 맞춘다.
    (style.lineHeight !== undefined && style.lineHeight !== 1
      ? `;line-height:${style.lineHeight};margin-top:${(-(style.lineHeight - 1) / 2).toFixed(4)}em`
      : '') +
    (style.characterSpacing !== undefined ? `;letter-spacing:${(style.characterSpacing * 4) / 3}px` : '')
    // 세로쓰기는 PDF와 같은 stackVertically 결과를 사용한다.
  );
}

/**
 * 요소 또는 셀의 선택 속성을 설정하거나 제거한다.
 *
 * @remarks
 * 판별 유니온에 동적으로 속성을 적용하는 타입 변환을 이 함수 안으로 제한한다.
 *
 * @param target - 필드를 고칠 요소·셀 객체
 * @param key - 고칠 선택 필드 이름
 * @param value - 넣을 값 (null·undefined면 필드를 지운다)
 */
function setOptional(target: object, key: string, value: unknown): void {
  const record = target as Record<string, unknown>;
  if (value === null || value === undefined) delete record[key];
  else record[key] = value;
}

/** PDF 렌더링 비율과 맞춘 캔버스용 `stroke-dasharray` 값(px) */
function dashArrayOf(style: 'solid' | 'dashed' | 'dotted' | undefined): string | undefined {
  if (style === 'dashed') return `${2.4 * PX_PER_MM} ${1.2 * PX_PER_MM}`;
  if (style === 'dotted') return `${0.4 * PX_PER_MM} ${0.8 * PX_PER_MM}`;
  return undefined;
}

/** PDF 변환과 같은 규칙으로 정다각형 꼭짓점 좌표를 계산한다. */
function polygonPointsPx(sides: number, width: number, height: number): [number, number][] {
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

/** 선 요소의 방향에 따른 두 끝점 좌표(mm)를 계산한다. */
function lineEndpoints(el: {
  position: { x: number; y: number };
  width: number;
  height: number;
  lineDirection?: 'horizontal' | 'vertical' | 'down' | 'up' | undefined;
}): [{ x: number; y: number }, { x: number; y: number }] {
  const { x, y } = el.position;
  const w = el.width;
  const h = el.height;
  switch (el.lineDirection ?? 'horizontal') {
    case 'vertical':
      return [{ x: x + w / 2, y }, { x: x + w / 2, y: y + h }];
    case 'down':
      return [{ x, y }, { x: x + w, y: y + h }];
    case 'up':
      return [{ x, y: y + h }, { x: x + w, y }];
    default:
      return [{ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }];
  }
}

/** 열과 행에 허용할 최소 크기 비율(%) */
const MIN_COLUMN_PERCENTAGE = 1;

/** 백분율을 소수점 둘째 자리로 반올림 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 마지막 비율을 둘로 나누어 항목을 하나 추가한다.
 * 반올림 오차는 새 항목에 반영해 합계를 유지한다.
 *
 * @param list - 백분율 목록 (합 100)
 * @returns 항목이 하나 늘어난 새 목록
 */
function splitLastPercentage(list: number[]): number[] {
  const last = list[list.length - 1];
  if (last === undefined) return [100];
  const kept = round2(last / 2);
  return [...list.slice(0, -1), kept, round2(last - kept)];
}

/**
 * 항목을 제거하고 해당 비율을 인접 항목에 더한다.
 * 앞 항목이 있으면 앞에 더하고 첫 항목을 제거할 때는 다음 항목에 더한다.
 *
 * @param list - 백분율 목록 (합 100)
 * @param index - 지울 항목 위치
 * @returns 항목이 하나 줄어든 새 목록 (한 항목만 남으면 100)
 */
function removePercentageToNeighbor(list: number[], index: number): number[] {
  if (list.length <= 1) return [100];
  const removed = list[index] ?? 0;
  const next = list.filter((_, i) => i !== index);
  const neighbor = index > 0 ? index - 1 : 0;
  next[neighbor] = round2((next[neighbor] ?? 0) + removed);
  return next;
}

/**
 * 비율 목록의 항목 수를 변경한다.
 * 늘릴 때는 마지막 항목을 나누고 줄일 때는 뒤에서부터 제거한 비율을 앞 항목에 더한다.
 *
 * @param list - 백분율 목록 (합 100)
 * @param count - 바뀐 항목 수
 * @returns 길이가 count인 새 목록
 */
function resizePercentages(list: number[], count: number): number[] {
  let next = [...list];
  while (next.length < count) next = splitLastPercentage(next);
  while (next.length > count) next = removePercentageToNeighbor(next, next.length - 1);
  return next;
}

/** 비율(생략 시 균등)로 나눈 누적 경계 위치(mm) — 길이 = count + 1 */
/** 새 그리드의 기본 행 높이(mm) */
const GRID_DEFAULT_ROW_MM = 8;
/** 새 그리드의 기본 열 너비(mm) */
const GRID_DEFAULT_COL_MM = 30;
/** 새 그리드가 한 페이지에 담는 기본 항목 수 */
const GRID_DEFAULT_PER_PAGE = 5;
/** 디자이너에서 편집할 수 있는 그리드의 최대 행 및 열 수 */
const GRID_MAX_TRACKS_UI = 100;
/** 반복 구간의 최대 항목 수와 페이지당 최대 항목 수 */
const GRID_MAX_ITEMS_UI = 100_000;
const GRID_MAX_PER_PAGE_UI = 1000;
/** 새 요소의 기본 위치를 순차 이동할 간격과 반복 주기(mm) */
const NEW_ELEMENT_CASCADE_STEP_MM = 5;
const NEW_ELEMENT_CASCADE_WRAP_MM = 50;
/** "내 양식" 목록의 페이지당 항목 수 */
const MY_FORMS_PAGE_SIZE = 10;

/**
 * 열 너비와 행 높이의 합으로 그리드 요소의 크기를 다시 계산한다 (SPEC §5.7).
 * 높이에는 `perPage`만큼 배치되는 반복 구간을 반영한다.
 */
function recomputeGridBox(el: GridElement): void {
  el.width = round1(el.columns.reduce((sum, column) => sum + column.width, 0));
  const templateHeight = el.rows.reduce((sum, row) => sum + row.height, 0);
  const bandHeight = el.repeat
    ? el.rows.slice(el.repeat.fromRow, el.repeat.toRow + 1).reduce((sum, row) => sum + row.height, 0)
    : 0;
  el.height = round1(templateHeight + (el.repeat ? (el.repeat.perPage - 1) * bandHeight : 0));
}

/**
 * 그리드 크기가 바뀌었을 때 기존 비율을 유지하며 행과 열의 크기를 조정한다.
 */
function syncGridTracks(el: GridElement): void {
  const scaled = (sizes: number[], target: number): number[] => {
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return sizes.map(() => Math.max(MIN_SIZE_MM, round1(target / sizes.length)));
    return sizes.map((size) => Math.max(MIN_SIZE_MM, round1((size / total) * target)));
  };
  el.columns = scaled(el.columns.map((column) => column.width), el.width).map((width) => ({ width }));

  // 화면에 펼친 반복 행을 포함한 전체 높이를 기준으로 행 높이를 조정한다.
  const perPage = el.repeat ? el.repeat.perPage : 1;
  const heights = el.rows.map((row) => row.height);
  const bandHeight = el.repeat
    ? heights.slice(el.repeat.fromRow, el.repeat.toRow + 1).reduce((sum, h) => sum + h, 0)
    : 0;
  const expanded = heights.reduce((sum, h) => sum + h, 0) + (perPage - 1) * bandHeight;
  const ratio = expanded > 0 ? el.height / expanded : 1;
  el.rows = heights.map((height) => ({ height: Math.max(MIN_SIZE_MM, round1(height * ratio)) }));
  recomputeGridBox(el);
}

/** 행·열이 줄어든 뒤 격자를 벗어나는 병합 범위를 줄인다 */
function clampGridSpans(el: GridElement): void {
  for (const cell of el.cells) {
    const record = cell as Record<string, unknown>;
    if (cell.rowSpan !== undefined && cell.row + cell.rowSpan > el.rows.length) {
      const clamped = el.rows.length - cell.row;
      if (clamped <= 1) delete record.rowSpan;
      else cell.rowSpan = clamped;
    }
    if (cell.colSpan !== undefined && cell.column + cell.colSpan > el.columns.length) {
      const clamped = el.columns.length - cell.column;
      if (clamped <= 1) delete record.colSpan;
      else cell.colSpan = clamped;
    }
  }
}

/** 트랙 크기 배열을 누적 오프셋 배열로 변환한다. */
function trackOffsets(sizes: readonly number[]): number[] {
  const offsets = [0];
  for (const size of sizes) offsets.push((offsets[offsets.length - 1] ?? 0) + size);
  return offsets;
}

function cumulativeOffsets(total: number, count: number, percentages?: number[]): number[] {
  const offsets = [0];
  for (let i = 0; i < count; i++) {
    const size = percentages ? (total * (percentages[i] ?? 0)) / 100 : total / count;
    offsets.push((offsets[i] ?? 0) + size);
  }
  return offsets;
}

function isGrid(el: SlipElement | undefined): el is GridElement {
  return el?.type === 'grid';
}

/**
 * 반복 구간 위쪽에서 같은 열의 헤더 텍스트를 찾는다.
 */
function gridHeaderTitle(grid: GridElement, column: number, fromRow: number): string | undefined {
  for (let row = fromRow - 1; row >= 0; row -= 1) {
    const cell = grid.cells.find((c) => c.row === row && c.column === column);
    if (cell?.content !== undefined && cell.content !== '') return cell.content;
  }
  return undefined;
}

/** 원본 행이 반복 구간에 포함되는지 확인한다. */
function inRepeatBand(el: GridElement, row: number): boolean {
  return el.repeat !== undefined && row >= el.repeat.fromRow && row <= el.repeat.toRow;
}

/** 행·열 수 */
function gridDims(el: GridElement): { rows: number; columns: number } {
  return { rows: el.rows.length, columns: el.columns.length };
}

/**
 * 캔버스에 표시할 행 높이 목록을 만든다.
 * 반복 구간은 `perPage`만큼 복제한다 (SPEC §5.7).
 */
function expandedRowHeights(el: GridElement): number[] {
  const heights = el.rows.map((row) => row.height);
  if (!el.repeat) return heights;
  const { fromRow, toRow, perPage } = el.repeat;
  const band = heights.slice(fromRow, toRow + 1);
  return [
    ...heights.slice(0, fromRow),
    ...Array.from({ length: perPage }, () => band).flat(),
    ...heights.slice(toRow + 1),
  ];
}

/** 캔버스에 그릴 열 너비(mm) 목록 */
function columnWidths(el: GridElement): number[] {
  return el.columns.map((column) => column.width);
}

/**
 * 화면에 펼친 행 번호를 파일에 저장된 원본 행 번호로 변환한다.
 */
function templateRowOf(el: GridElement, expandedRow: number): number {
  if (!el.repeat) return expandedRow;
  const { fromRow, toRow, perPage } = el.repeat;
  const bandRows = toRow - fromRow + 1;
  if (expandedRow < fromRow) return expandedRow;
  const afterBand = fromRow + perPage * bandRows;
  if (expandedRow >= afterBand) return expandedRow - (perPage - 1) * bandRows;
  return fromRow + ((expandedRow - fromRow) % bandRows);
}

/** 원본 행이 화면에서 처음 나타나는 행 번호를 반환한다. */
function firstExpandedRowOf(el: GridElement, templateRow: number): number {
  if (!el.repeat) return templateRow;
  const { fromRow, toRow, perPage } = el.repeat;
  const bandRows = toRow - fromRow + 1;
  return templateRow > toRow ? templateRow + (perPage - 1) * bandRows : templateRow;
}

/** 지정한 셀을 반환하고 없으면 빈 셀을 생성한다. */
function ensureCell(el: GridElement, row: number, column: number): Record<string, unknown> {
  const found = el.cells.find((c) => c.row === row && c.column === column);
  if (found) return found as unknown as Record<string, unknown>;
  const created: GridCell = { row, column, content: '' };
  el.cells.push(created);
  return created as unknown as Record<string, unknown>;
}

/**
 * 셀 또는 바코드의 값 소스를 바꾸기 전에 `content`, `parameter`, `formula`를 제거한다.
 * 호출부는 제거 후 사용할 소스 하나만 설정한다 (SPEC §5.6/§5.7).
 *
 * @param record - content·parameter·formula를 가질 수 있는 셀 또는 요소
 */
function clearValueSources(record: { content?: unknown; parameter?: unknown; formula?: unknown }): void {
  delete record.content;
  delete record.parameter;
  delete record.formula;
}

/** HEX 색상을 색 선택기의 HSV 값으로 변환한다. */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** HSV 색상을 HEX 색상 문자열로 변환한다. */
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** 디자이너가 만들 수 있는 요소 종류 */
type CreatableType = SlipElement['type'];

const PLACEHOLDER_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 캔버스 요소 종류별 배지 아이콘 */
const TYPE_BADGE: Record<SlipElement['type'], TemplateResult> = {
  text: icons.text,
  grid: icons.gridElement,
  image: icons.image,
  line: icons.line,
  rect: icons.shape,
  ellipse: icons.ellipse,
  polygon: icons.polygon,
  field: icons.field,
  barcode: icons.barcode,
};

interface DragState {
  id: string;
  startPxX: number;
  startPxY: number;
  origMmX: number;
  origMmY: number;
  /** 실제 이동이 시작될 때 생성하는 되돌리기용 스냅샷 */
  snapshot: string | null;
  /** pointerdown 전에 선택된 요소였는지 여부 */
  wasSelected: boolean;
  /** 함께 이동할 선택 요소의 원래 위치 */
  members: { id: string; origX: number; origY: number }[];
}

interface ResizeState {
  id: string;
  handle: ResizeHandle;
  startPxX: number;
  startPxY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  /** 첫 크기 변경 시 생성하는 되돌리기용 스냅샷 */
  snapshot: string | null;
}

/**
 * 사이드바에서 선택한 페이지와 파라미터를 나타낸다.
 */
/** 파라미터를 사용하는 요소의 위치 */
interface ParameterUse {
  pageIndex: number;
  id: string;
  name: string;
  type: 'field' | 'grid' | 'image';
}

/** 파라미터 정의와 사용 위치를 합친 사이드바 항목 */
interface ParameterInfo {
  /** 전표 값에서 사용하는 키 */
  key: string;
  /** 화면에 표시할 이름 */
  label: string;
  /** 파라미터 정의에 지정된 레이블 */
  rawLabel: string | undefined;
  /** 파라미터 정의에 지정된 값 종류 */
  valueType: ParameterValueType | undefined;
  /** 파라미터 정의에 등록되어 있는지 여부 */
  defined: boolean;
  /** 이 값을 쓰는 요소들 */
  uses: ParameterUse[];
  /** 파라미터 정의에 등록된 목록 하위 필드  */
  fields: ParameterFieldInfo[];
}

/**
 * 목록 파라미터의 하위 필드와 해당 필드를 사용하는 그리드 셀 위치.
 */
interface ParameterFieldInfo {
  /** 항목 필드 물리명 — 수식에서 `목록파라미터.필드`로 쓴다 */
  key: string;
  /** 화면에 보일 이름 — 논리명이 없으면 물리명 */
  title: string;
  /** 정의부에 적힌 논리명 (없으면 undefined) */
  rawLabel: string | undefined;
  /** 값 종류 */
  valueType: ParameterValueType | undefined;
  /** 이 필드를 읽는 그리드 셀의 자리 (없으면 undefined) */
  at: { pageIndex: number; gridId: string; row: number; column: number } | undefined;
}

type SideSelection =
  | { kind: 'parameter'; key: string }
  | { kind: 'parameterField'; key: string; field: string }
  | { kind: 'page' }
  | null;

/**
 * `.slip` 양식을 편집하는 `<slip-designer>` 컴포넌트.
 *
 * 캔버스 편집, 속성 패널, 요소 추가와 삭제,
 * 복사·붙여넣기, 되돌리기·다시 실행, 다중 페이지, 프리셋 불러오기, PDF 미리보기를
 * 제공한다. 편집으로 양식이 바뀔 때마다 `slip-change` 이벤트로 파일을 내보낸다.
 */
export class SlipDesigner extends LitElement {
  static styles = css`
    :host {
      /* 컴포넌트 디자인 토큰  */
      --sk-bg: #f6f7f8;
      --sk-surface: #ffffff;
      --sk-canvas-bg: #e2e4e7;
      --sk-border: #d8dadf;
      --sk-border-strong: #c4c7cd;
      --sk-text: #2e3238;
      --sk-text-muted: #798088;
      --sk-accent: #1a73e8;
      --sk-accent-soft: #e7f0fd;
      --sk-guide: #e91e63;
      /* 테두리가 없는 요소의 영역을 표시하는 캔버스 안내선 */
      --sk-guide-faint: rgba(0, 0, 0, 0.15);
      --sk-danger: #c62828;
      --sk-radius: 4px;

      display: grid;
      grid-template-rows: auto 1fr;
      grid-template-columns: 176px 1fr 300px;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif;
      font-size: 13px;
      color: var(--sk-text);
      overflow: hidden;
    }

    /* :host의 display보다 hidden 속성을 우선한다. */
    :host([hidden]) {
      display: none;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .toolbar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-bottom: 1px solid var(--sk-border);
      background: var(--sk-bg);
      overflow-x: auto;
    }
    .tool-group {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
    }
    .toolbar button {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 44px;
      height: 44px;
      padding: 4px 5px 3px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      color: var(--sk-text);
      font-family: inherit;
    }
    .toolbar button svg {
      width: 16px;
      height: 16px;
    }
    .toolbar .btn-label {
      font-size: 10px;
      line-height: 1;
      white-space: nowrap;
      color: var(--sk-text-muted);
    }
    .toolbar button:hover:not(:disabled) .btn-label,
    .toolbar button[aria-pressed='true'] .btn-label {
      color: inherit;
    }
    .toolbar button:hover:not(:disabled) {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .toolbar button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .toolbar button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .toolbar button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .toolbar .page-indicator {
      min-width: 40px;
      text-align: center;
      font-size: 12px;
      color: var(--sk-text-muted);
    }

    .sidebar {
      grid-row: 2;
      grid-column: 1;
      border-right: 1px solid var(--sk-border);
      background: var(--sk-bg);
      overflow-y: auto;
      overflow-x: hidden;
      padding: 10px;
    }
    .side-section {
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--sk-border);
    }
    .side-section:last-child {
      border-bottom: none;
    }
    .side-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--sk-text-muted);
      margin-bottom: 6px;
    }
    /* 페이지 목록은 한 줄로 표시하고 썸네일은 hover 또는 focus 상태에서만 표시한다. */
    .page-row-wrap {
      position: relative;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .page-row-wrap .side-row {
      flex: 1;
      min-width: 0;
    }
    .page-thumb-pop {
      /* 사이드바가 overflow를 자르므로 화면 기준(fixed)으로 띄운다 */
      position: fixed;
      z-index: 30;
      padding: 4px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
      box-shadow: var(--sk-shadow, 0 2px 8px rgba(0, 0, 0, 0.15));
      pointer-events: none;
    }
    .thumb {
      display: block;
      width: 100%;
      padding: 0;
      margin: 0 0 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      text-align: center;
    }
    .thumb:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .thumb.current {
      border-color: var(--sk-accent);
      box-shadow: 0 0 0 1px var(--sk-accent);
    }
    .thumb-paper {
      /* span이 인라인으로 남으면 width·height가 무시돼 축소 상자가 밖으로 흘러나온다 */
      display: block;
      position: relative;
      margin: 4px auto 0;
      background: #fff;
      border: 1px solid var(--sk-border);
      overflow: hidden;
    }
    .thumb-el {
      position: absolute;
      background: var(--sk-accent-soft);
      border: 1px solid var(--sk-border-strong);
    }
    .thumb-label {
      display: block;
      font-size: 11px;
      color: var(--sk-text-muted);
      padding: 2px 0 3px;
    }
    .thumb.current .thumb-label {
      color: var(--sk-accent);
    }
    .side-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 4px 6px;
      margin: 1px 0;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text);
      text-align: left;
    }
    .side-row svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      color: var(--sk-text-muted);
    }
    .side-row span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .side-row:hover {
      background: var(--sk-accent-soft);
    }
    .side-row.selected {
      background: var(--sk-accent-soft);
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .side-row.selected svg {
      color: var(--sk-accent);
    }
    .side-row:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .side-empty {
      font-size: 11px;
      color: var(--sk-text-muted);
      padding: 2px 6px;
    }
    /* 사이드바 파라미터 관리  — 제목 줄의 작은 버튼과 인라인 입력줄 */
    .side-title-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 6px;
    }
    .side-title-row .side-title {
      flex: 1;
      margin-bottom: 0;
    }
    .side-mini {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .side-mini:hover:not(:disabled) {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .side-mini:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .side-mini[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .side-mini svg {
      width: 12px;
      height: 12px;
    }
    .side-mini:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .side-row-wrap {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .side-row-wrap .side-row {
      flex: 1;
      min-width: 0;
    }
    /* 요소 목록의 페이지 묶음 머리 — 현재 페이지만 펼친다  */
    .side-page-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      margin: 4px 0 2px;
      padding: 3px 6px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .side-page-head:hover {
      background: var(--sk-accent-soft);
    }
    .side-page-head.current {
      color: var(--sk-accent);
      font-weight: 600;
    }
    /* 현재 페이지가 선택 대상이 아니어도 이름은 강조한다. */
    .page-row.current {
      font-weight: 600;
    }
    /* 하위 항목이 없는 줄에도 같은 폭을 확보해 목록 이름의 시작 위치를 맞춘다. */
    .side-twisty {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 14px;
      width: 14px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      color: var(--sk-text-muted);
    }
    .side-twisty svg {
      width: 11px;
      height: 11px;
    }
    .side-twisty:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-text);
    }
    /* 펼침 표시가 없는 줄의 빈 자리 — 세 목록의 이름이 같은 자리에서 시작한다 */
    .side-twisty-gap {
      flex: 0 0 14px;
    }
    /* 그리드 값의 반복 구간 필드 — 펼침 표시 아래로 한 단 들여 쓴다  */
    /* 값 목록의 반복 구간 필드 하위 줄(.side-col-row)과 요소 목록의 그리드 셀 하위 줄
       (.side-cell-row, G-44)은 생김새가 같다 */
    .side-col-row,
    .side-cell-row {
      display: flex;
      align-items: center;
      width: calc(100% - 16px);
      margin: 1px 0 1px 16px;
      padding: 3px 6px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      text-align: left;
    }
    .side-col-row svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      margin-right: 4px;
    }
    .side-col-row span,
    .side-cell-row span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .side-col-row:hover,
    .side-cell-row:hover {
      background: var(--sk-accent-soft);
    }
    .side-col-row.selected,
    .side-cell-row.selected {
      background: var(--sk-accent-soft);
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    /* 셀 편집 중 그리드 전체 설정으로 돌아가는 탐색 버튼 */
    .grid-back {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 36px;
      margin: 8px 0 0;
      padding: 6px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      color: var(--sk-text);
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      text-align: left;
    }
    .grid-back:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .grid-back:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .grid-back svg {
      flex: 0 0 14px;
      width: 14px;
      height: 14px;
    }
    .grid-back-label {
      flex: none;
      font-weight: 600;
    }
    .grid-back-name {
      min-width: 0;
      margin-left: auto;
      overflow: hidden;
      color: var(--sk-text-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* 거부된 입력의 원인을 해당 필드 가까이에 표시한다. */
    .input-error {
      margin: 0 0 6px;
      padding: 5px 8px;
      border: 1px solid var(--sk-danger);
      border-radius: var(--sk-radius);
      background: color-mix(in srgb, var(--sk-danger) 8%, transparent);
      font-size: 12px;
      color: var(--sk-danger);
    }
    .input-error.field-error {
      margin: -2px 0 8px 80px;
      padding: 0;
      border: 0;
      background: transparent;
      font-size: 11px;
      line-height: 16px;
    }
    .prop-pair + .input-error.field-error {
      margin-left: 0;
    }
    .prop-pair > .input-error.field-error {
      grid-column: 1 / -1;
      margin: 0;
    }
    .color-pop .input-error.field-error {
      margin: 4px 0 0;
    }
    .prop-row input[aria-invalid='true'],
    .prop-row textarea[aria-invalid='true'],
    .prop-row .list-select[aria-invalid='true'] {
      border-color: var(--sk-danger);
      outline: 1px solid color-mix(in srgb, var(--sk-danger) 22%, transparent);
      outline-offset: -1px;
    }
    .prop-add-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      margin-top: 4px;
      padding: 5px 6px;
      border: 1px dashed var(--sk-border);
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-muted);
    }
    .prop-add-row:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .prop-add-row svg {
      width: 12px;
      height: 12px;
    }
    /* 하위 필드를 더하는 줄 — 하위 줄과 같은 자리에 놓되 목록 항목은 아니다 */
    .side-add-field {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      padding: 3px 6px 3px 18px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      text-align: left;
      color: var(--sk-text-muted);
    }
    .side-add-field:hover {
      color: var(--sk-accent);
    }
    .side-add-field svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      margin-right: 4px;
    }
    .usage-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      height: 32px;
      margin: 0;
      padding: 5px 8px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text);
      text-align: left;
    }
    .usage-row + .usage-row {
      margin-top: 6px;
    }
    .prop-row > .usage-row {
      flex: 1;
      min-width: 0;
      width: 0;
    }
    .usage-row:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .usage-row svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
    }
    .usage-row > span:first-of-type {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .usage-page {
      flex: none;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    /* 샘플 데이터 모달의 행 편집 그리드  — 열이 많으면 가로 스크롤 */
    .modal.modal-wide {
      width: min(760px, calc(100vw - 32px));
    }
    .sample-tabs {
      display: inline-flex;
      gap: 2px;
      margin-bottom: 8px;
      padding: 2px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
    }
    .sample-tabs button {
      padding: 4px 12px;
      border: 1px solid transparent;
      border-radius: var(--sk-radius);
      background: transparent;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .sample-tabs button[aria-selected='true'] {
      background: var(--sk-surface);
      border-color: var(--sk-border-strong);
      color: var(--sk-text);
    }
    .sample-tabs button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .sample-json {
      width: 100%;
      resize: vertical;
      padding: 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: inherit;
    }
    .sample-json:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .sample-pager {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 4px;
      margin: 6px 0;
    }
    .page-btn {
      min-width: 22px;
      height: 22px;
      padding: 0 5px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .page-btn:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .page-btn[aria-pressed='true'] {
      background: var(--sk-accent);
      border-color: var(--sk-accent);
      color: #fff;
    }
    .page-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .sample-scroll {
      overflow-x: auto;
      margin-bottom: 4px;
    }
    .sample-grid {
      display: grid;
      gap: 4px;
      align-items: center;
      margin-bottom: 4px;
      /* 열이 많으면 그리드 상자를 내용 크기로 키워 스크롤 컨테이너가 끝까지 스크롤되게 한다 */
      width: max-content;
      min-width: 100%;
    }
    .sample-col {
      font-size: 10px;
      color: var(--sk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sample-grid input {
      min-width: 0;
      width: 100%;
      padding: 4px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }

    .canvas-area {
      grid-row: 2;
      grid-column: 2;
      overflow: auto;
      background: var(--sk-canvas-bg);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 24px;
    }
    /* 생성 도구 선택 중 — 캔버스 어디를 눌러도 그리기이므로 십자 커서로 알린다 */
    .canvas-area.drawing,
    .canvas-area.drawing .element {
      cursor: crosshair;
    }
    .draw-ghost {
      position: absolute;
      border: 1px dashed var(--sk-accent);
      background: var(--sk-accent-soft);
      opacity: 0.6;
      pointer-events: none;
      z-index: 25;
    }
    /* 눈금자 + 용지 묶음 — 자와 용지가 함께 스크롤돼 눈금이 어긋나지 않는다  */
    .paper-wrap {
      display: grid;
      grid-template-columns: ${RULER_PX}px auto;
      grid-template-rows: ${RULER_PX}px auto;
      flex-shrink: 0;
    }
    .ruler-corner {
      grid-row: 1;
      grid-column: 1;
      background: var(--sk-surface);
      border-right: 1px solid var(--sk-border);
      border-bottom: 1px solid var(--sk-border);
    }
    .ruler {
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      overflow: hidden;
    }
    .ruler-h {
      grid-row: 1;
      grid-column: 2;
      height: ${RULER_PX}px;
      border-bottom: 1px solid var(--sk-border);
    }
    .ruler-v {
      grid-row: 2;
      grid-column: 1;
      width: ${RULER_PX}px;
      border-right: 1px solid var(--sk-border);
    }
    .paper {
      grid-row: 2;
      grid-column: 2;
      position: relative;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }
    /* 격자 — 요소보다 뒤에 깔린다. 선 색·간격은 인라인 스타일로  */
    .grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    /* 격자 색 견본 줄 — 격자가 켜져 있을 때만 메뉴에 보인다  */
    .grid-colors {
      display: flex;
      gap: 6px;
      padding: 6px 10px;
      border-top: 1px solid var(--sk-border);
      margin-top: 4px;
    }
    .preset-menu .grid-colors button {
      display: inline-block;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 3px;
    }
    .preset-menu .grid-colors button[aria-pressed='true'] {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    /* 커서 좌표 — 캔버스 오른쪽 아래에 붙어 스크롤해도 자리를 지킨다  */
    .coords {
      grid-row: 2;
      grid-column: 2;
      align-self: end;
      justify-self: end;
      margin: 8px;
      padding: 2px 8px;
      border-radius: var(--sk-radius);
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    .padding-guide {
      position: absolute;
      border: 1px dashed rgba(0, 0, 0, 0.1);
      pointer-events: none;
    }
    /* 페이지 번호 자리표시  — 실제 번호는 PDF 후처리, 캔버스는 X / X만 */
    .page-number-mark {
      position: absolute;
      display: flex;
      align-items: center;
      font-size: 9px;
      color: var(--sk-text-muted);
      pointer-events: none;
    }

    .element {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid var(--sk-guide-faint);
      cursor: move;
      overflow: hidden;
      touch-action: none;
      user-select: none;
      font-size: 11px;
      line-height: 1.3;
    }
    .element > * {
      pointer-events: none;
    }
    .element.selected {
      box-shadow: 0 0 0 2px var(--sk-accent);
      z-index: 10;
    }
    /*
     * 요소 종류 배지는 마우스를 올리거나 요소를 선택했을 때 표시한다.
     * 캔버스와 PDF의 글 위치를 맞추기 위해 요소 상자에 안쪽 여백을 두지 않는다.
     * 툴바의 "요소 확인"을 켜면 전부 보인다.
     */
    .element .badge {
      position: absolute;
      top: 1px;
      left: 1px;
      /* 표·그리드 미리보기가 나중에 그려져 배지를 덮지 않도록 */
      z-index: 1;
      display: none;
      align-items: center;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 2px;
      color: var(--sk-text-muted);
    }
    .element:hover .badge,
    .element.selected .badge,
    .canvas-area.show-badges .badge {
      display: inline-flex;
    }
    .element .badge svg {
      width: 11px;
      height: 11px;
    }
    /* 텍스트·필드 표시 — PDF(pdfme)와 같게: 위쪽 정렬, 줄바꿈 유지, 넘치면 자동 줄바꿈 */
    .element .el-content {
      /* flex column으로 수직 정렬(justify-content)을 준다 — 기본은 상단 */
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      width: 100%;
      height: 100%;
      overflow: hidden;
      white-space: pre-wrap;
      /* 줄바꿈 위치도 PDF와 맞춘다 — 낱말 단위로 끊고, 한 낱말이 상자보다 길 때만 낱말 안에서 끊는다 */
      word-break: keep-all;
      overflow-wrap: break-word;
      line-height: 1;
    }
    .element.type-image {
      background: #f5f5f5;
    }
    .element.type-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      position: absolute;
      inset: 0;
    }
    /* 바코드 견본  — 격자·막대 그림 위에 종류·값을 겹쳐 보여준다 */
    .element .barcode-preview {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .element .barcode-svg {
      flex: 1;
      width: 100%;
      min-height: 0;
    }
    .element .barcode-caption {
      flex: 0 0 auto;
      padding: 0 1px;
      font-size: 8px;
      line-height: 1.1;
      color: var(--sk-text-muted);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .element .grid-preview {
      position: absolute;
      inset: 0;
      display: grid;
    }
    .element .grid-preview > div {
      display: flex;
      align-items: center;
      /* PDF 변환 계층의 셀 안쪽 여백과 같은 값 (GRID_CELL_PADDING = 1mm, 사방) */
      padding: 1mm;
      overflow: hidden;
      /* PDF는 셀을 넘치는 글을 낱말 단위로 줄바꿈한다 — 캔버스도 같게 접어 화면·PDF를 맞춘다.
         줄바꿈 문자는 pre-line으로 그대로 보인다 */
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .element .table-preview {
      position: absolute;
      inset: 0;
      display: flex;
    }
    .element .table-preview > div {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(0, 0, 0, 0.2);
      font-size: 10px;
      overflow: hidden;
    }
    .element.type-line svg,
    .element.type-ellipse svg,
    .element.type-polygon svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    /* 선·타원·삼각형은 도형 자체만 보이게 — 편집용 상자 테두리를 지운다 (선택 시 강조는 유지) */
    .element.type-line,
    .element.type-ellipse,
    .element.type-polygon {
      border-color: transparent;
    }
    /* 선 요소는 배지가 선과 겹치므로 표시하지 않는다. */
    .element.type-line .badge {
      display: none;
    }
    .element.type-line {
      overflow: visible;
    }
    /* PDF와 같이 요소 영역 밖으로 이어지는 선의 두께를 자르지 않는다. */
    .element.type-line svg {
      overflow: visible;
    }
    /* 선택한 선은 선 강조와 끝점 핸들로 표시한다. */
    .element.type-line.selected {
      box-shadow: none;
    }

    .selection-overlay {
      position: absolute;
      pointer-events: none;
      z-index: 15;
    }
    .selection-overlay .handle {
      pointer-events: auto;
      touch-action: none;
      position: absolute;
      width: 8px;
      height: 8px;
      background: #fff;
      border: 1px solid var(--sk-accent);
      border-radius: 1px;
      box-sizing: border-box;
    }
    .handle-nw { left: -4px; top: -4px; cursor: nwse-resize; }
    .handle-n { left: calc(50% - 4px); top: -4px; cursor: ns-resize; }
    .handle-ne { right: -4px; top: -4px; cursor: nesw-resize; }
    .handle-e { right: -4px; top: calc(50% - 4px); cursor: ew-resize; }
    .handle-se { right: -4px; bottom: -4px; cursor: nwse-resize; }
    .handle-s { left: calc(50% - 4px); bottom: -4px; cursor: ns-resize; }
    .handle-sw { left: -4px; bottom: -4px; cursor: nesw-resize; }
    .handle-w { left: -4px; top: calc(50% - 4px); cursor: ew-resize; }

    /* 선 선택 하이라이트·그리기 미리보기 — 상자 대신 선 자체를 강조한다  */
    .selection-overlay .line-highlight {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .selection-overlay .endpoint {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      cursor: move;
    }
    .line-ghost {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0.5;
      pointer-events: none;
      z-index: 25;
    }

    .snap-guide {
      position: absolute;
      pointer-events: none;
      background: var(--sk-guide);
      z-index: 20;
    }
    .snap-guide.vertical {
      top: 0;
      bottom: 0;
      width: 1px;
    }
    .snap-guide.horizontal {
      left: 0;
      right: 0;
      height: 1px;
    }

    .prop-panel {
      grid-row: 2;
      grid-column: 3;
      border-left: 1px solid var(--sk-border);
      padding: 0 14px 20px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
      background: #fafbfc;
    }
    .prop-section {
      margin: 0;
      padding: 14px 0;
      border-bottom: 1px solid var(--sk-border);
    }
    .prop-section:last-child {
      border-bottom: none;
    }
    .prop-section-title {
      margin: 0 0 10px;
      font-size: 12px;
      font-weight: 600;
      line-height: 18px;
      color: var(--sk-text);
    }
    .type-name {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      margin: 0 -14px;
      padding: 12px 14px 11px;
      border-bottom: 1px solid var(--sk-border);
      background: rgba(250, 251, 252, 0.96);
      font-size: 13px;
      font-weight: 700;
      line-height: 20px;
      color: var(--sk-text);
      backdrop-filter: blur(4px);
    }
    .group-actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
      gap: 8px;
      margin: 0;
    }
    .group-actions .btn {
      min-height: 32px;
      padding-inline: 10px;
    }
    .prop-row {
      display: flex;
      align-items: center;
      min-height: 32px;
      margin: 0 0 8px;
      gap: 8px;
    }
    .prop-row:last-child {
      margin-bottom: 0;
    }
    .prop-row label {
      width: 72px;
      flex: none;
      font-size: 12px;
      line-height: 16px;
      word-break: keep-all;
      overflow-wrap: anywhere;
      color: var(--sk-text-muted);
    }
    .prop-row.stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
    .prop-row.stacked label {
      width: auto;
    }
    .prop-row.stacked input:not([type='checkbox']),
    .prop-row.stacked textarea,
    .prop-row.stacked .list-select {
      flex: none;
      width: 100%;
    }
    /* 네이티브 select를 대신하는 리스트형 선택 상자 */
    .list-select {
      flex: 1;
      min-width: 0;
      width: 0;
      min-height: 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .list-select:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .list-select .list-select-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .list-select .list-select-caret {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 14px;
      height: 14px;
      color: var(--sk-text-muted);
    }
    .list-select .list-select-caret svg {
      width: 14px;
      height: 14px;
    }
    .prop-row.stacked .list-select {
      width: 100%;
    }
    .list-select-menu {
      overflow-y: auto;
    }
    .list-select-menu button[aria-selected='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      font-weight: 600;
    }
    .prop-row input,
    .prop-row textarea {
      flex: 1;
      min-width: 0;
      width: 0;
      min-height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .prop-row input[type='checkbox'] {
      appearance: none;
      -webkit-appearance: none;
      flex: none;
      width: 32px;
      min-height: 0;
      height: 18px;
      margin: 0 0 0 auto;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 9px;
      background:
        radial-gradient(circle at 8px 50%, #fff 0 5px, transparent 5.5px),
        #aeb4bc;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .prop-row input[type='checkbox']:checked {
      border-color: var(--sk-accent);
      background:
        radial-gradient(circle at 23px 50%, #fff 0 5px, transparent 5.5px),
        var(--sk-accent);
    }
    .prop-row input:focus-visible,
    .prop-row textarea:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .prop-row textarea {
      min-height: 76px;
      resize: vertical;
    }
    .prop-pair {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 0 0 10px;
    }
    .prop-pair:last-child {
      margin-bottom: 0;
    }
    .prop-pair .prop-row {
      flex-direction: column;
      align-items: stretch;
      min-width: 0;
      margin: 0;
      gap: 5px;
    }
    .prop-pair .prop-row label {
      width: auto;
      min-height: 16px;
    }
    .prop-pair .prop-row input,
    .prop-pair .prop-row .list-select {
      flex: none;
      width: 100%;
    }

    .toggle-group {
      display: inline-flex;
      min-width: 0;
      gap: 0;
    }
    .toggle-group button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 0;
      background: var(--sk-surface);
      color: var(--sk-text);
      cursor: pointer;
    }
    .toggle-group button + button {
      margin-left: -1px;
    }
    .toggle-group button:first-child {
      border-radius: var(--sk-radius) 0 0 var(--sk-radius);
    }
    .toggle-group button:last-child {
      border-radius: 0 var(--sk-radius) var(--sk-radius) 0;
    }
    .toggle-group button:only-child {
      border-radius: var(--sk-radius);
    }
    .toggle-group button svg {
      width: 14px;
      height: 14px;
    }
    .toggle-group.text button {
      width: auto;
      min-width: 54px;
      height: 32px;
      padding: 0 12px;
      font-family: inherit;
      font-size: 12px;
      white-space: nowrap;
    }
    .prop-row > .toggle-group.text {
      flex: 1;
    }
    .prop-row > .toggle-group.text button {
      flex: 1;
    }
    .toggle-group button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .anchor-grid {
      display: grid;
      grid-template-columns: repeat(3, 16px);
      gap: 4px;
    }
    .anchor-dot {
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 3px;
      background: var(--sk-surface);
      cursor: pointer;
    }
    .anchor-dot[aria-pressed='true'] {
      background: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .anchor-dot:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }

    .toggle-group button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }

    .color-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .color-btn[aria-expanded='true'] {
      border-color: var(--sk-accent);
    }
    .color-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .color-chip {
      flex: 0 0 16px;
      width: 16px;
      height: 16px;
      border: 1px solid var(--sk-border);
      border-radius: 3px;
    }
    /* 색 미지정 상태 — 검정으로 오해하지 않게 '없음'(사선)으로 표시 */
    .color-chip.none {
      background:
        linear-gradient(to top left, transparent 44%, var(--sk-guide) 45%, var(--sk-guide) 55%, transparent 56%),
        var(--sk-surface);
    }
    .color-value {
      font-size: 11px;
      color: var(--sk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .color-pop {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: -2px 0 12px;
      padding: 10px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    .color-pop-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 52px auto;
      align-items: center;
      gap: 6px;
    }
    .color-pop-row input:not(.alpha-input) {
      min-width: 0;
      width: 100%;
      min-height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .sv-area {
      position: relative;
      height: 104px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      cursor: crosshair;
      touch-action: none;
    }
    .sv-thumb {
      position: absolute;
      width: 10px;
      height: 10px;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .hue-slider {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      height: 14px;
      margin: 0;
      border: 1px solid var(--sk-border);
      border-radius: 7px;
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      cursor: pointer;
    }
    .hue-slider::-webkit-slider-thumb {
      appearance: none;
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .hue-slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .color-extras {
      display: grid;
      grid-template-columns: repeat(auto-fill, 18px);
      align-items: center;
      gap: 6px;
    }
    .swatch {
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 4px;
      cursor: pointer;
    }
    .swatch[aria-pressed='true'] {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .swatch:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .swatch.none {
      background:
        linear-gradient(to top left, transparent 44%, var(--sk-guide) 45%, var(--sk-guide) 55%, transparent 56%),
        var(--sk-surface);
    }
    .swatch-save {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px dashed var(--sk-border-strong);
      border-radius: 4px;
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .swatch-save svg {
      width: 11px;
      height: 11px;
    }
    .swatch-save:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .swatch-save:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .swatch-save:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .alpha-input {
      width: 52px;
      min-height: 32px;
      padding: 5px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
    }
    .alpha-suffix {
      font-size: 11px;
      color: var(--sk-text-muted);
    }

    /* 테두리 굵기 선택 버튼과 미리보기 */
    .width-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 5px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .width-btn:hover {
      border-color: var(--sk-accent);
    }
    .width-btn[aria-expanded='true'] {
      border-color: var(--sk-accent);
    }
    .width-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .width-line {
      flex: 1;
      min-width: 24px;
      border-top: 1px solid currentColor;
    }
    /* 테두리 형태 미리보기 */
    .shape-line {
      flex: 1;
      min-width: 24px;
      border-top: 2px solid currentColor;
    }
    .shape-line.shape-dashed {
      border-top-style: dashed;
    }
    .shape-line.shape-dotted {
      border-top-style: dotted;
    }
    /* 지정하지 않아 기본값·상속값이 적용 중인 항목  */
    .dim {
      opacity: 0.55;
    }
    .width-value {
      font-size: 11px;
      color: var(--sk-text-muted);
      white-space: nowrap;
    }
    .preset-menu.width-pop {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      overflow-y: auto;
    }
    .preset-menu.width-pop button {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .preset-menu.width-pop button:hover {
      background: var(--sk-accent-soft);
    }
    .preset-menu.width-pop button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .preset-menu.width-pop button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }

    /* 인라인 편집기는 선택한 셀의 배경과 텍스트 스타일을 상속한다. */
    .cell-editor {
      position: absolute;
      z-index: 30;
      padding: 1px 3px;
      border: 2px solid var(--sk-accent);
      border-radius: 2px;
      font-family: inherit;
      font-size: 12px;
      color: inherit;
    }
    .grid-preview .cell-selected {
      outline: 2px solid var(--sk-accent);
      outline-offset: -2px;
    }
    .step-inputs {
      flex: 1;
      min-width: 0;
      display: grid;
      grid-template-columns: 32px 40px 32px;
      align-items: center;
      justify-content: flex-start;
      gap: 4px;
    }
    .step-inputs span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    /* 반복 구간 안의 셀임을 알리는 표시 */
    .cell-band {
      margin-left: 6px;
      padding: 0 5px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 500;
      color: var(--sk-accent);
      background: var(--sk-accent-soft);
    }
    .merge-inputs {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .merge-inputs span {
      font-size: 11px;
      color: var(--sk-text-muted);
      flex-shrink: 0;
    }
    .merge-inputs input {
      flex: 1;
      min-width: 0;
      width: 0;
      padding: 3px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }

    .cell-hint {
      font-size: 11px;
      color: var(--sk-text-muted);
      line-height: 1.5;
    }
    .cell-hint.error {
      color: var(--sk-danger);
    }
    .col-edit-head {
      display: grid;
      grid-template-columns: 1fr 52px;
      gap: 4px;
      font-size: 10px;
      color: var(--sk-text-muted);
      margin-bottom: 2px;
    }
    .col-edit {
      display: grid;
      grid-template-columns: 1fr 52px;
      gap: 4px;
      margin: 2px 0;
      align-items: center;
    }
    .col-edit input {
      min-width: 0;
      width: 100%;
      padding: 3px 4px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 11px;
      font-family: inherit;
      color: inherit;
    }
    .col-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .col-remove svg {
      width: 12px;
      height: 12px;
    }
    .col-remove:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .col-modal-actions {
      display: flex;
      gap: 6px;
    }
    .col-add,
    .col-modal-open {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      padding: 4px 8px;
      border: 1px dashed var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .prop-panel .col-modal-open {
      justify-content: center;
      width: 100%;
      min-height: 32px;
      margin-top: 0;
      border-style: solid;
      font-size: 12px;
    }
    .col-add:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .col-add svg,
    .col-modal-open svg {
      width: 12px;
      height: 12px;
    }
    .col-add:hover,
    .col-modal-open:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }

    .menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
    }
    .preset-menu {
      position: fixed;
      z-index: 41;
      display: flex;
      flex-direction: column;
      min-width: 140px;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .preset-menu button {
      /* 툴바 안에 렌더되므로.toolbar button의 아이콘 버튼 크기 규칙을 되돌린다 */
      display: block;
      min-width: 0;
      height: auto;
      padding: 6px 10px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      text-align: left;
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      cursor: pointer;
    }
    .preset-menu button:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .preset-menu button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }

    /* 모달 — 편집 항목이 많은 기능은 패널 대신 모달로 (편집 UI 배치 원칙) */
    .modal-backdrop {
      background: rgba(0, 0, 0, 0.35);
      z-index: 50;
    }
    .modal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, calc(100vw - 32px));
      max-height: min(680px, calc(100vh - 48px));
      display: flex;
      flex-direction: column;
      z-index: 51;
      background: var(--sk-surface);
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--sk-border);
      font-size: 13px;
      font-weight: 600;
    }
    .modal-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .modal-close:hover {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .modal-close svg {
      width: 14px;
      height: 14px;
    }
    .modal-body {
      padding: 12px 14px;
      overflow-y: auto;
    }
    .modal-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--sk-border);
    }
    .btn {
      padding: 6px 14px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .btn.primary {
      background: var(--sk-accent);
      border-color: var(--sk-accent);
      color: #fff;
    }
    .btn.primary:hover:not(:disabled) {
      color: #fff;
      opacity: 0.9;
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .formula-input {
      width: 100%;
      resize: vertical;
      padding: 6px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: inherit;
    }
    .formula-input:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .formula-status {
      min-height: 18px;
      margin: 4px 0 6px;
      font-size: 11px;
      color: var(--sk-text-muted);
      overflow-wrap: break-word;
    }
    .formula-status.error {
      color: var(--sk-danger);
    }
    .modal-section-title {
      margin: 10px 0 4px;
      font-size: 11px;
      font-weight: 600;
      color: var(--sk-text-muted);
    }
    /* 이미지 선택  — 경로는 base64라 못 읽으니 이미지 자체를 보여준다 */
    .image-hint {
      margin: 6px 0;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .image-error {
      margin: 6px 0;
      font-size: 11px;
      color: var(--sk-danger, #c0392b);
    }
    .image-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 6px;
    }
    .image-choice {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 72px;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-bg);
      cursor: pointer;
    }
    .image-choice.selected {
      border-color: var(--sk-accent);
      box-shadow: 0 0 0 1px var(--sk-accent);
    }
    .image-choice img,
    .image-current img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .image-current {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 104px;
      margin-bottom: 8px;
      padding: 6px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
    }
    /* 샘플 데이터 모달의 변동 이미지 입력  */
    .sample-image {
      align-items: flex-start;
    }
    .sample-image-body {
      flex: 1;
      min-width: 0;
    }
    .sample-image-btns {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .parameter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    /* 파라미터 칩의 값 종류 — 무엇을 넣는지 고르기 전에 보이게 한다  */
    .chip-type {
      margin-left: 4px;
      opacity: 0.6;
      font-size: 10px;
    }
    .parameter-chip {
      padding: 3px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 10px;
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: inherit;
      cursor: pointer;
    }
    .parameter-chip:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    /* 표 파라미터의 하위 열 칩 — 상위 값과 구분되게 옅게  */
    .parameter-chip.column {
      border-style: dashed;
      color: var(--sk-text-muted);
    }
    /* 수식 규칙 안내 한 줄  */
    .formula-hint {
      margin-top: 6px;
      font-size: 11px;
      color: var(--sk-text-muted);
      line-height: 1.5;
    }
    /* 표 파라미터 뒤에 점을 찍었을 때 뜨는 열 제안 줄  */
    .formula-suggest {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding: 6px 8px;
      border: 1px solid var(--sk-accent);
      border-radius: var(--sk-radius);
      background: var(--sk-accent-soft);
    }
    .formula-suggest-label {
      font-size: 11px;
      color: var(--sk-accent);
    }
    .formula-suggest .parameter-chip {
      border-style: solid;
      color: inherit;
    }
    .fn-category {
      margin: 8px 0 2px;
      font-size: 11px;
      font-weight: 600;
    }
    .fn-row {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      width: 100%;
      padding: 4px 8px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      font-family: inherit;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .fn-row:hover {
      background: var(--sk-accent-soft);
    }
    .fn-row:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .fn-signature {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11.5px;
    }
    .fn-desc {
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .row-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .row-btn:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .row-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .row-btn:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .row-btn svg {
      width: 14px;
      height: 14px;
    }
    .col-modal-head {
      display: grid;
      grid-template-columns: 46px 1fr 1fr 56px 24px;
      gap: 4px;
      font-size: 10px;
      color: var(--sk-text-muted);
      margin-bottom: 2px;
    }
    .col-modal-row {
      display: grid;
      grid-template-columns: 46px 1fr 1fr 56px 24px;
      gap: 4px;
      align-items: center;
      margin: 2px 0;
    }
    .col-modal-row input {
      min-width: 0;
      width: 100%;
      padding: 4px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .col-order {
      display: inline-flex;
      gap: 2px;
    }
    .col-order button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .col-order button:hover:not(:disabled) {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .col-order button:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .col-order button svg {
      width: 12px;
      height: 12px;
    }

    /* 내 양식 목록 행  */
    .form-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 2px 0;
    }
    .form-open {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .form-open:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    .form-open:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: 1px;
    }
    .form-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .form-date {
      flex: none;
      font-size: 11px;
      color: var(--sk-text-muted);
    }
    .save-as-new {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 8px 0 0 74px;
      font-size: 12px;
      color: var(--sk-text-muted);
      cursor: pointer;
    }

    .saved-notice {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      font-size: 11px;
      white-space: nowrap;
    }

    .preview-area {
      grid-column: 1 / -1;
    }
    .preview-area iframe {
      width: 100%;
      height: 100%;
      border: none;
    }

    .empty-state {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      font-size: 14px;
    }
    .empty-state.error {
      color: #c00;
    }
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
    }
  `;

  static properties = {
    src: { type: String },
    locale: { type: String },
    settings: { attribute: false },
    _file: { state: true },
    _pageIndex: { state: true },
    _selectedId: { state: true },
    _selectedIds: { state: true },
    _hostPaperSizes: { state: true },
    _hostBarcodeKinds: { state: true },
    _fontNames: { state: true },
    _inputError: { state: true },
    _inputErrorField: { state: true },
    _paperSaveName: { state: true },
    _previewMode: { state: true },
    _previewUrl: { state: true },
    _previewError: { state: true },
    _error: { state: true },
    _guideX: { state: true },
    _guideY: { state: true },
    _pendingTool: { state: true },
    _drawRect: { state: true },
    _presetMenuOpen: { state: true },
    _shapeMenuOpen: { state: true },
    _selectedCell: { state: true },
    _cellSourceKind: { state: true },
    _cellEditing: { state: true },
    _lineDraft: { state: true },
    _lineGhost: { state: true },
    _formulaModalOpen: { state: true },
    _sampleModalOpen: { state: true },
    _imageModalOpen: { state: true },
    _thumbPage: { state: true },
    _thumbPos: { state: true },
    _imageError: { state: true },
    _sampleImageError: { state: true },
    maxImageBytes: { type: Number, attribute: 'max-image-bytes' },
    _sideSelection: { state: true },
    _expandedParameters: { state: true },
    _expandedElements: { state: true },
    _parameterKeyError: { state: true },
    _pageKeyError: { state: true },
    presets: { attribute: false },
    storage: { attribute: false },
    _saveModalOpen: { state: true },
    _myFormsOpen: { state: true },
    _myFormItems: { state: true },
    _myFormsPage: { state: true },
    _myFormsQuery: { state: true },
    _myFormsError: { state: true },
    _savedNotice: { state: true },
  };

  src = '';

  /**
   * UI 언어 (`ko`, `en`, `ja`).
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /**
   * 폰트와 용지 정보를 제공하는 호스트 설정.
   * 생략하면 기본 폰트와 용지를 사용한다.
   */
  settings?: SlipDesignerSettings;

  /**
   * 툴바에 표시할 양식 프리셋 목록.
   * 지정하면 기본 프리셋을 대체한다.
   */
  presets?: SlipPreset[];

  /**
   * "내 양식" 저장과 불러오기에 사용할 저장소 어댑터.
   * 지정한 경우에만 관련 도구를 표시한다.
   */
  storage?: StorageAdapter;

  /**
   * 업로드할 수 있는 이미지 파일의 최대 크기(바이트).
   *
   * @remarks
   * base64 인코딩 결과는 원본보다 약 33% 크므로 호스트의 저장 및 전송 제한에 맞게
   * 크기를 지정할 수 있다.
   * HTML 속성으로도 줄 수 있다: `<slip-designer max-image-bytes="1048576">`.
   */
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES;

  private _file: SlipTemplateFile | null = null;
  private _pageIndex = 0;
  /** 속성 패널과 크기 조절 핸들이 대상으로 삼는 주 선택 요소 */
  private _selectedId: string | null = null;
  /**
   * 선택된 요소 ID 모음. 주 선택 요소를 포함하며 이동, 삭제, 그룹화에 사용한다.
   */
  private _selectedIds = new Set<string>();
  /** 호스트가 `settings.getPaperSizes`로 제공한 추가 용지 목록 */
  private _hostPaperSizes: PaperSize[] = [];
  /** 호스트가 `settings.getBarcodeKinds`로 제한한 바코드 종류  */
  private _hostBarcodeKinds: BarcodeKind[] = [];
  /** 호스트 제공 폰트와 기본 폰트에서 수집한 폰트 이름  */
  private _fontNames: string[] = [];
  /** 사용자 지정 용지 이름의 편집 중 값 */
  private _paperSaveName = '';
  private _undoStack: string[] = [];
  private _redoStack: string[] = [];
  private _previewMode = false;
  private _previewUrl: string | null = null;
  private _previewError: string | null = null;
  private _error: string | null = null;
  private _drag: DragState | null = null;
  private _resize: ResizeState | null = null;
  private _clipboard: SlipElement[] | null = null;
  private _guideX: number | null = null;
  private _guideY: number | null = null;
  private _previewGeneration = 0;
  /** 캔버스에서 다음에 생성할 요소 종류 */
  private _pendingTool: CreatableType | null = null;
  /** 드래그 생성 중 표시할 임시 영역(mm) */
  private _drawRect: { x: number; y: number; w: number; h: number } | null = null;
  private _draw: {
    type: CreatableType;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    moved: boolean;
  } | null = null;
  private _presetMenuOpen = false;
  private _presetMenuPos = { left: 0, top: 0 };
  /** 도형 선택 메뉴의 열림 상태 */
  private _shapeMenuOpen = false;
  private _shapeMenuPos = { left: 0, top: 0 };
  /** 다음에 생성할 다각형의 변 수 */
  private _pendingSides = 3;
  /** 두 번 클릭해 선을 생성할 때의 시작점(mm) */
  private _lineDraft: { x: number; y: number } | null = null;
  /** 두 번 클릭해 선을 생성하는 동안의 현재 끝점(mm) */
  private _lineGhost: { x: number; y: number } | null = null;
  /** 수식 편집 모달의 열림 상태 */
  private _formulaModalOpen = false;
  /** 수식 모달의 편집 중 값 */
  private _formulaDraft = '';
  /** 샘플 데이터 편집 모달의 열림 상태 */
  private _sampleModalOpen = false;
  /** 이미지 선택 모달의 열림 상태 */
  private _imageModalOpen = false;
  /**
   * 사이드바에서 미리보기를 표시 중인 페이지 번호.
   */
  private _thumbPage: number | null = null;
  /** 페이지 미리보기의 화면 기준 좌표 */
  private _thumbPos: { top: number; left: number } | null = null;
  /** 이미지 선택 실패 사유 */
  private _imageError: string | null = null;
  /** 샘플 데이터 이미지 업로드의 실패 사유 */
  private _sampleImageError: string | null = null;
  /** 샘플 데이터 모달의 현재 페이지 */
  private _samplePage = 0;
  /** 샘플 데이터를 JSON으로 직접 편집하는 모드 여부 */
  private _sampleJsonMode = false;
  /** JSON 모드의 편집 중 값 */
  private _sampleJsonDraft = '';
  /**
   * 사이드바에서 선택한 페이지 또는 파라미터.
   * 요소를 선택하면 `null`이 된다.
   */
  private _sideSelection: SideSelection = null;
  /**
   * 값 목록에서 하위 필드를 펼친 파라미터 키.
   */
  private _expandedParameters = new Set<string>();
  /**
   * 요소 목록에서 셀 항목을 펼친 그리드 ID 모음.
   */
  private _expandedElements = new Set<string>();
  /** 파라미터 키 중복 오류 여부 */
  private _parameterKeyError = false;
  /** 마지막으로 거부한 입력의 오류 메시지 */
  private _inputError: string | null = null;
  /** 오류가 발생한 속성 입력의 식별자. 없으면 패널 전체 오류다. */
  private _inputErrorField: string | null = null;
  /** 페이지 키 중복 오류 여부 */
  private _pageKeyError = false;
  /** "내 양식으로 저장" 모달의 열림 상태 */
  private _saveModalOpen = false;
  /** 저장 모달의 편집 중 제목 */
  private _saveTitle = '';
  /** "내 양식 목록" 모달의 열림 상태 */
  private _myFormsOpen = false;
  /**
   * 모달을 열 때 조회한 양식 메타데이터 목록.
   * 검색과 페이지 이동은 이 목록을 기준으로 처리한다.
   */
  private _myFormItems: SlipListItem[] = [];
  /** 목록 모달의 현재 페이지(0부터 시작) */
  private _myFormsPage = 0;
  /** 목록 검색어 */
  private _myFormsQuery = '';
  /** 저장소 작업 오류 메시지 */
  private _myFormsError: string | null = null;
  /** 저장 완료 메시지 표시 여부 */
  private _savedNotice = false;
  /** 현재 양식이 저장된 저장소 키 */
  private _savedId: string | null = null;
  /** 새 저장소 항목으로 저장할지 여부 */
  private _saveAsNew = false;
  /** 선 끝점 핸들 드래그 상태 */
  private _lineEnd: {
    id: string;
    fixed: { x: number; y: number };
    snapshot: string | null;
    orig: { x: number; y: number; w: number; h: number; direction: string | undefined };
  } | null = null;
  /**
   * 요소 ID별 좌표 기준점의 ANCHORS 인덱스.
   * 파일에는 저장하지 않으며 기본값은 왼쪽 위다.
   */
  private _anchorByElement = new Map<string, number>();
  /** 병합 및 인라인 편집의 대상인 그리드 셀 좌표 */
  private _selectedCell: { row: number; column: number } | null = null;
  /**
   * 그리드 셀에서 편집 중인 값 소스 종류.
   */
  private _cellSourceKind: 'content' | 'parameter' | 'formula' | null = null;
  /** 그리드 셀의 인라인 편집 여부 */
  private _cellEditing = false;

  /** 현재 locale의 문구 사전 */
  private get _strings() {
    return getStrings(this.locale);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this._onKeyDown);
    if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '0');
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._onKeyDown);
    this._revokePreviewUrl();
  }

  // 파싱 결과가 같은 렌더링에 반영되도록 렌더링 전에 처리한다.
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
    }
    // 설정 기반 목록은 업데이트가 끝난 뒤 추가 렌더를 예약하지 않도록 미리 불러온다.
    if (changed.has('settings')) {
      void this._loadPaperSizes();
      void this._loadBarcodeKinds();
      void this._loadFontNames();
    }
  }

  override updated(): void {
    // 인라인 셀 편집을 열면 바로 입력할 수 있게 포커스를 준다
    if (this._cellEditing) {
      const editor = this.renderRoot.querySelector('.cell-editor') as HTMLInputElement | null;
      if (editor && this.shadowRoot?.activeElement !== editor) {
        editor.focus();
        editor.select?.();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Source parsing
  // ---------------------------------------------------------------------------

  private _parseSource(): void {
    this._revokePreviewUrl();
    this._error = null;
    this._resetPanelErrors();
    this._clearSelection();
    this._undoStack = [];
    this._redoStack = [];
    this._previewMode = false;
    this._previewError = null;
    this._pageIndex = 0;
    this._drag = null;
    this._resize = null;
    this._guideX = null;
    this._guideY = null;
    this._clipboard = null;
    this._pendingTool = null;
    this._drawRect = null;
    this._draw = null;
    this._presetMenuOpen = false;
    this._shapeMenuOpen = false;
    this._selectedCell = null;
    this._cellEditing = false;
    this._lineDraft = null;
    this._lineGhost = null;
    this._lineEnd = null;
    this._formulaModalOpen = false;
    this._sampleModalOpen = false;
    this._imageModalOpen = false;
    this._imageError = null;
    this._sideSelection = null;
    this._parameterKeyError = false;
    this._saveModalOpen = false;
    this._myFormsOpen = false;
    this._myFormsError = null;
    this._savedNotice = false;
    this._savedId = null;

    if (!this.src) {
      this._file = null;
      return;
    }

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src, this.locale === undefined ? undefined : { locale: this.locale });
    } catch (error) {
      console.error('[slip-designer] .slip parse failed:', error);
      this._file = null;
      this._error = this._strings.designer.parseError;
      return;
    }

    if (file.kind !== 'template') {
      this._file = null;
      this._error = this._strings.designer.onlyTemplate;
      return;
    }

    this._file = file;
    this._declareRepeatParameters();
  }

  /**
   * 반복 그리드에서 사용하는 목록 파라미터와 하위 필드를 정의에 추가한다.
   *
   * @remarks
   * 정의되지 않은 반복 파라미터는 목록으로 추가하고 반복 구간의 셀 파라미터는 하위 필드로
   * 추가한다. 이미 지정된 값 종류와 레이블은 변경하지 않는다. 목록이 아닌 파라미터에는
   * 하위 필드를 추가하지 않는다.
   */
  private _declareRepeatParameters(): void {
    const file = this._file;
    if (!file) return;
    const defs = file.template.parameters ?? [];
    let changed = false;
    for (const page of file.template.pages) {
      for (const el of page.elements) {
        if (el.type !== 'grid' || !el.repeat) continue;
        const { fromRow, toRow, parameter: listKey } = el.repeat;
        let def = defs.find((b) => b.key === listKey);
        if (!def) {
          def = { key: listKey, valueType: 'list' };
          defs.push(def);
          changed = true;
        } else if (def.valueType === undefined) {
          // 값 종류가 없는 파라미터만 목록으로 설정한다.
          def.valueType = 'list';
          changed = true;
        }
        if (def.valueType !== 'list') continue;
        const fields = def.fields ?? [];
        for (const cell of el.cells) {
          if (cell.parameter === undefined || cell.row < fromRow || cell.row > toRow) continue;
          if (fields.some((f) => f.key === cell.parameter)) continue;
          // 같은 열의 헤더 텍스트를 하위 필드의 레이블로 사용한다.
          const title = gridHeaderTitle(el, cell.column, fromRow);
          fields.push(title === undefined ? { key: cell.parameter } : { key: cell.parameter, label: title });
          changed = true;
        }
        if (fields.length > 0) def.fields = fields;
      }
    }
    if (changed) file.template.parameters = defs;
  }

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------

  private _pushUndo(): void {
    if (!this._file) return;
    this._pushUndoSnapshot(JSON.stringify(this._file));
  }

  private _pushUndoSnapshot(snapshot: string): void {
    this._undoStack.push(snapshot);
    this._redoStack = [];
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
  }

  /**
   * 잘못된 입력을 모델에 반영하지 않고 오류 메시지를 표시한다.
   *
   * @param message - 보일 문구 (생략하면 기본 안내)
   * @param field - 오류가 발생한 속성 입력 식별자
   */
  private _rejectInput(message?: string, field?: string): void {
    this._inputError = message ?? this._strings.designer.invalidInput;
    this._inputErrorField = field ?? null;
    this.requestUpdate();
  }

  /** 현재 속성 패널의 입력 오류 상태를 초기화한다. */
  private _resetPanelErrors(): void {
    this._inputError = null;
    this._inputErrorField = null;
    this._parameterKeyError = false;
    this._pageKeyError = false;
  }

  /** 마지막 입력 오류 메시지를 지운다. */
  private _clearInputError(): void {
    if (this._inputError === null) return;
    this._inputError = null;
    this._inputErrorField = null;
    this.requestUpdate();
  }

  /** 지정한 입력에 연결된 오류를 렌더링한다. */
  private _renderInputError(field: string) {
    if (this._inputError === null || this._inputErrorField !== field) return nothing;
    return html`<div id="error-${field}" class="input-error field-error" role="alert">${this._inputError}</div>`;
  }

  /** 지정한 입력에 현재 오류가 있는지 확인한다. */
  private _hasInputError(field: string): boolean {
    return this._inputError !== null && this._inputErrorField === field;
  }

  private _undo(): void {
    if (this._undoStack.length === 0 || !this._file) return;
    this._redoStack.push(JSON.stringify(this._file));
    this._file = JSON.parse(this._undoStack.pop()!) as SlipTemplateFile;
    this._clampPageIndex();
    this._validateSelection();
    this._emitChange();
  }

  private _redo(): void {
    if (this._redoStack.length === 0 || !this._file) return;
    this._undoStack.push(JSON.stringify(this._file));
    this._file = JSON.parse(this._redoStack.pop()!) as SlipTemplateFile;
    this._clampPageIndex();
    this._validateSelection();
    this._emitChange();
  }

  /** 현재 페이지 인덱스를 문서의 페이지 범위로 제한한다. */
  private _clampPageIndex(): void {
    this._pageIndex = Math.max(0, Math.min(this._pageIndex, this._pageCount() - 1));
  }

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------

  private _pageCount(): number {
    return this._file?.template.pages.length ?? 0;
  }

  /**
   * 페이지 레이블이 있으면 반환하고 없으면 페이지 번호로 이름을 만든다.
   *
   * @param page - 페이지
   * @param index - 페이지 번호(0-기반)
   * @returns 화면에 보일 이름
   */
  private _pageDisplayName(page: { label?: string | undefined }, index: number): string {
    const label = page.label?.trim();
    return label !== undefined && label !== ''
      ? label
      : this._strings.designer.pageLabel.replace('{n}', String(index + 1));
  }

  /**
   * 페이지 행 옆에 화면 경계를 벗어나지 않도록 미리보기를 표시한다.
   */
  private _showPageThumb(index: number, event: Event): void {
    const row = event.currentTarget as HTMLElement | null;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const height = this._thumbHeightPx();
    const margin = 8;
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - height - margin));
    this._thumbPage = index;
    this._thumbPos = { top, left: rect.right + 6 };
  }

  /** 현재 행의 페이지 미리보기를 숨긴다. */
  private _hidePageThumb(index: number): void {
    if (this._thumbPage !== index) return;
    this._thumbPage = null;
    this._thumbPos = null;
  }

  /** 용지 비율에 맞춘 페이지 미리보기 높이(px)를 계산한다. */
  private _thumbHeightPx(): number {
    const paper = this._file?.template.paper;
    if (!paper) return 0;
    return (THUMB_WIDTH_PX / paper.width) * paper.height + 10;
  }

  private _goToPage(index: number): void {
    if (!this._file) return;
    const clamped = Math.max(0, Math.min(index, this._pageCount() - 1));
    if (clamped === this._pageIndex) return;
    this._pageIndex = clamped;
    this._clearSelection();
    this._sideSelection = null;
    this._selectedCell = null;
    this._cellEditing = false;
  }

  /** 현재 페이지 뒤에 빈 페이지를 추가하고 그 페이지로 이동한다 */
  private _addPage(): void {
    if (!this._file) return;
    this._pushUndo();
    this._file.template.pages.splice(this._pageIndex + 1, 0, { elements: [] });
    this._pageIndex += 1;
    this._clearSelection();
    this._sideSelection = null;
    this._emitChange();
    this.requestUpdate();
  }

  /** 현재 페이지를 삭제한다 (마지막 한 페이지는 삭제 불가) */
  private _deletePage(): void {
    if (!this._file || this._pageCount() <= 1) return;
    this._pushUndo();
    this._file.template.pages.splice(this._pageIndex, 1);
    this._clampPageIndex();
    this._clearSelection();
    this._sideSelection = null;
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Element helpers
  // ---------------------------------------------------------------------------

  private _currentElements(): SlipElement[] | undefined {
    return this._file?.template.pages[this._pageIndex]?.elements;
  }

  private _findElement(id: string): SlipElement | undefined {
    return this._currentElements()?.find((el) => el.id === id);
  }

  private _findSelectedElement(): SlipElement | undefined {
    return this._selectedId ? this._findElement(this._selectedId) : undefined;
  }

  /** 현재 페이지에서 같은 그룹 ID를 가진 요소를 반환한다. */
  private _pageGroupMembers(group: string): SlipElement[] {
    return (this._currentElements() ?? []).filter((el) => el.group === group);
  }

  /** 주 선택 요소와 선택된 요소 목록을 초기화한다. */
  private _clearSelection(): void {
    this._resetPanelErrors();
    this._selectedId = null;
    this._selectedIds = new Set();
  }

  /**
   * 요소를 선택한다. 그룹에 속한 요소이면 같은 그룹을 함께 선택한다.
   *
   * @param id - 고를 요소 id
   */
  private _selectElement(id: string): void {
    this._resetPanelErrors();
    this._selectedId = id;
    const group = this._findElement(id)?.group;
    this._selectedIds = group
      ? new Set(this._pageGroupMembers(group).map((el) => el.id))
      : new Set([id]);
  }

  /**
   * 요소를 다중 선택 목록에 추가하거나 제거한다.
   * 추가한 요소는 주 선택이 되며 주 선택을 제거하면 남은 요소 중 하나를 주 선택으로 지정한다.
   *
   * @param id - 토글할 요소 id
   */
  private _toggleInSelection(id: string): void {
    this._resetPanelErrors();
    const next = new Set(this._selectedIds);
    if (next.has(id)) {
      next.delete(id);
      if (this._selectedId === id) this._selectedId = next.values().next().value ?? null;
    } else {
      next.add(id);
      this._selectedId = id;
    }
    this._selectedIds = next;
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = null;
    this.requestUpdate();
  }

  private _validateSelection(): void {
    if (this._selectedId && !this._findElement(this._selectedId)) {
      this._selectedId = null;
    }
    // 복원 또는 삭제로 사라진 요소를 선택 목록에서 제거한다.
    if (this._selectedIds.size > 0) {
      const alive = new Set([...this._selectedIds].filter((id) => this._findElement(id)));
      if (alive.size !== this._selectedIds.size) this._selectedIds = alive;
      if (this._selectedId === null) this._selectedId = alive.values().next().value ?? null;
    }
    // 선택된 셀이 현재 그리드 범위 안에 있는지 확인한다.
    if (this._selectedCell) {
      const el = this._findSelectedElement();
      if (
        !isGrid(el) ||
        this._selectedCell.row >= el.rows.length || this._selectedCell.column >= el.columns.length
      ) {
        this._selectedCell = null;
        this._cellEditing = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Element CRUD
  // ---------------------------------------------------------------------------

  /**
   * 요소를 추가한다. 위치를 지정하지 않으면 용지 여백에서 순차적으로 이동한 위치를 사용한다.
   */
  private _addElement(
    type: CreatableType,
    place?: {
      position: { x: number; y: number };
      width?: number;
      height?: number;
      /** 드래그 방향에서 계산한 선 방향 */
      lineDirection?: 'horizontal' | 'vertical' | 'down' | 'up';
    },
  ): void {
    const elements = this._currentElements();
    if (!elements || !this._file) return;

    this._pushUndo();

    const id = crypto.randomUUID();
    const { paper } = this._file.template;
    const [padTop, , , padLeft] = paper.padding;
    const offset = (elements.length * NEW_ELEMENT_CASCADE_STEP_MM) % NEW_ELEMENT_CASCADE_WRAP_MM;
    const position = place?.position ?? { x: padLeft + offset, y: padTop + offset };
    const name = `${type}-${id.slice(0, 4)}`;

    let element: SlipElement;
    switch (type) {
      case 'text':
        element = { type: 'text', id, name, position, width: 60, height: 10, content: '' };
        break;
      case 'grid':
        // 새 그리드는 헤더, 반복 구간, 꼬리 행으로 시작한다.
        element = {
          type: 'grid', id, name, position,
          width: 90, height: GRID_DEFAULT_ROW_MM * (2 + GRID_DEFAULT_PER_PAGE),
          columns: [{ width: GRID_DEFAULT_COL_MM }, { width: GRID_DEFAULT_COL_MM }, { width: GRID_DEFAULT_COL_MM }],
          rows: [
            { height: GRID_DEFAULT_ROW_MM },
            { height: GRID_DEFAULT_ROW_MM },
            { height: GRID_DEFAULT_ROW_MM },
          ],
          repeat: {
            parameter: `items_${id.slice(0, 4)}`,
            fromRow: 1,
            toRow: 1,
            perPage: GRID_DEFAULT_PER_PAGE,
            repeatHeader: true,
          },
          cells: [],
        };
        break;
      case 'image':
        element = {
          type: 'image', id, name, position, width: 40, height: 40, src: PLACEHOLDER_IMG,
        };
        break;
      case 'line':
        element = {
          type: 'line', id, name, position, width: 60, height: 2,
          lineDirection: place?.lineDirection ?? 'horizontal',
        };
        break;
      case 'rect':
        element = { type: 'rect', id, name, position, width: 60, height: 30 };
        break;
      case 'ellipse':
        element = { type: 'ellipse', id, name, position, width: 60, height: 30 };
        break;
      case 'polygon':
        // 다각형의 변 수는 도형 메뉴에서 선택한 값을 사용한다.
        element = {
          type: 'polygon', id, name, position, width: 40, height: 30, sides: this._pendingSides,
        };
        break;
      case 'field':
        element = {
          type: 'field', id, name, position, width: 60, height: 10,
          parameter: `field_${id.slice(0, 4)}`,
        };
        break;
      case 'barcode':
        // 새 바코드는 QR Code를 기본 종류로 사용한다.
        element = {
          type: 'barcode', id, name, position, width: 25, height: 25,
          kind: 'qrcode', parameter: `barcode_${id.slice(0, 4)}`,
        };
        break;
    }

    if (place?.width !== undefined) element.width = Math.max(MIN_SIZE_MM, round1(place.width));
    if (place?.height !== undefined) element.height = Math.max(MIN_SIZE_MM, round1(place.height));
    // 그리드의 행과 열 크기를 드래그로 지정한 요소 크기에 맞춘다 (SPEC §5.7).
    if (element.type === 'grid') syncGridTracks(element);
    // 새 요소의 위치를 용지 범위로 제한한다.
    element.position = {
      x: round1(Math.max(0, Math.min(element.position.x, paper.width - element.width))),
      y: round1(Math.max(0, Math.min(element.position.y, paper.height - element.height))),
    };

    elements.push(element);
    this._selectElement(id);
    this._sideSelection = null;
    // 새 요소가 사용하는 파라미터를 정의 목록에 등록한다.
    if (element.type === 'field' && element.parameter !== undefined) {
      this._ensureParameterDef(element.parameter);
    }
    if (element.type === 'grid' && element.repeat) {
      this._ensureParameterDef(element.repeat.parameter, 'list');
    }
    this._emitChange();
    this.requestUpdate();
  }

  private _copySelected(): void {
    const elements = this._currentElements();
    if (!elements || this._selectedIds.size === 0) return;
    // 선택된 요소와 그룹을 함께 복사한다.
    const selected = elements.filter((el) => this._selectedIds.has(el.id));
    if (selected.length === 0) return;
    this._clipboard = JSON.parse(JSON.stringify(selected)) as SlipElement[];
    this.requestUpdate();
  }

  private _paste(): void {
    const elements = this._currentElements();
    if (!elements || !this._clipboard || this._clipboard.length === 0) return;

    this._pushUndo();

    // 복사한 그룹에는 원본과 다른 그룹 ID를 부여한다.
    const groupRemap = new Map<string, string>();
    const pasted: SlipElement[] = [];
    for (const src of this._clipboard) {
      const copy = JSON.parse(JSON.stringify(src)) as SlipElement;
      copy.id = crypto.randomUUID();
      copy.position = { x: round1(copy.position.x + 5), y: round1(copy.position.y + 5) };
      if (copy.group !== undefined) {
        const mapped = groupRemap.get(copy.group) ?? crypto.randomUUID();
        groupRemap.set(copy.group, mapped);
        copy.group = mapped;
      }
      if (copy.type === 'field' && copy.parameter !== undefined) this._ensureParameterDef(copy.parameter);
      if (copy.type === 'grid' && copy.repeat) this._ensureParameterDef(copy.repeat.parameter, 'list');
      elements.push(copy);
      pasted.push(copy);
    }
    // 다음 붙여넣기 위치가 이동하도록 클립보드 좌표를 갱신한다.
    for (const src of this._clipboard) {
      src.position = { x: round1(src.position.x + 5), y: round1(src.position.y + 5) };
    }

    // 붙여넣은 요소를 모두 선택한다.
    this._selectedId = pasted[0]!.id;
    this._selectedIds = new Set(pasted.map((el) => el.id));
    this._sideSelection = null;
    this._emitChange();
    this.requestUpdate();
  }

  /** 선택된 요소를 모두 삭제한다. */
  private _deleteSelected(): void {
    const elements = this._currentElements();
    if (!elements || this._selectedIds.size === 0) return;
    const ids = this._selectedIds;
    if (!elements.some((el) => ids.has(el.id))) return;

    this._pushUndo();
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      if (ids.has(elements[i]!.id)) elements.splice(i, 1);
    }
    this._clearSelection();
    this._sideSelection = null;
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Change emission
  // ---------------------------------------------------------------------------

  private _emitChange(): void {
    if (!this._file) return;
    // 문서가 변경되면 저장 완료 상태를 해제한다.
    this._savedNotice = false;
    const file = structuredClone(this._file) as SlipFile;
    this.dispatchEvent(
      new CustomEvent('slip-change', { detail: { file }, bubbles: true, composed: true }),
    );
  }

  /**
   * 선택된 요소를 수정한다. 선택이 유효하지 않으면 입력 오류를 표시한다.
   *
   * @param fn - 요소를 고치는 함수
   */
  private _updateElement(fn: (el: SlipElement) => void): void {
    const el = this._findSelectedElement();
    if (!el) {
      this._rejectInput();
      return;
    }
    this._resetPanelErrors();
    this._pushUndo();
    fn(el);
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Pointer events (canvas drag)
  // ---------------------------------------------------------------------------

  /** 생성 도구를 선택하거나 같은 도구를 다시 선택해 해제한다. */
  private _selectTool(type: CreatableType): void {
    this._pendingTool = this._pendingTool === type ? null : type;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this.requestUpdate();
  }

  /**
   * 드래그 또는 두 번의 클릭으로 선을 생성한다.
   * 첫 클릭은 시작점을 저장하고 두 번째 클릭은 끝점을 지정한다.
   */
  private _finishLineDraw(d: { startX: number; startY: number; endX: number; endY: number; moved: boolean }): void {
    if (!d.moved && !this._lineDraft) {
      this._lineDraft = { x: d.startX, y: d.startY };
      this._lineGhost = { x: d.endX, y: d.endY };
      this.requestUpdate();
      return;
    }
    const from = this._lineDraft ?? { x: d.startX, y: d.startY };
    this._lineDraft = null;
    this._lineGhost = null;
    this._pendingTool = null;
    this._createLineBetween(from, { x: d.endX, y: d.endY });
  }

  /** 두 점을 잇는 선 요소를 만든다. */
  private _createLineBetween(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    this._addElement('line', {
      position: { x: round1(Math.min(from.x, to.x)), y: round1(Math.min(from.y, to.y)) },
      width: Math.abs(dx),
      height: Math.abs(dy),
      lineDirection:
        Math.abs(dy) <= 1 ? 'horizontal'
        : Math.abs(dx) <= 1 ? 'vertical'
        : dx * dy > 0 ? 'down' : 'up',
    });
  }

  /** 도형 종류와 다각형의 변 수를 선택한다. */
  private _selectShapeTool(type: 'rect' | 'ellipse' | 'polygon', sides = 3): void {
    this._shapeMenuOpen = false;
    this._pendingSides = sides;
    this._pendingTool = type;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this.requestUpdate();
  }

  /**
   * 명시된 값이 없으면 기본값을 표시하는 숫자 입력 행을 만든다.
   * 기본값과 같은 값은 파일에 저장하지 않으며 잘못된 입력은 이전 값으로 되돌린다.
   *
   * @param label - 항목 이름
   * @param current - 현재 저장된 값
   * @param fallback - 지정하지 않았을 때 실제로 적용되는 값
   * @param apply - 저장 콜백. 기본값과 같으면 `null`이 와서 필드를 지운다
   * @param opts - `step`·`min` 등 입력 상자 설정
   * @returns 수 입력 한 줄
   */
  private _renderDefaultedNumberRow(
    label: string,
    current: number | undefined,
    fallback: number,
    apply: (value: number | null) => void,
    opts: { step?: string; min?: string; ariaLabel?: string; errorKey?: string } = {},
  ) {
    const errorKey = opts.errorKey ?? 'number-input';
    const commit = (e: Event): void => {
      const input = e.target as HTMLInputElement;
      // 브라우저가 잘못된 숫자 입력을 빈 문자열로 반환하므로 이전 값으로 복원한다.
      if (input.validity.badInput) {
        input.value = String(current ?? fallback);
        this._rejectInput(this._strings.designer.numberInput, errorKey);
        return;
      }
      const raw = input.value.trim();
      if (raw === '') {
        apply(null);
        return;
      }
      const v = Number(raw);
      if (!Number.isFinite(v) || (opts.min !== undefined && v < Number(opts.min))) {
        input.value = String(current ?? fallback);
        const message = !Number.isFinite(v)
          ? this._strings.designer.numberInput
          : this._strings.designer.minimumInput.replace('{min}', opts.min!);
        this._rejectInput(message, errorKey);
        return;
      }
      apply(v === fallback ? null : v);
    };
    return html`
      <div class="prop-row">
        <label>${label}</label>
        <input type="number" step=${opts.step ?? '0.5'} min=${opts.min ?? nothing}
          aria-label=${opts.ariaLabel ?? label}
          aria-invalid=${String(this._hasInputError(errorKey))}
          aria-describedby=${this._hasInputError(errorKey) ? `error-${errorKey}` : nothing}
          class=${current === undefined ? 'dim' : ''}
          .value=${String(current ?? fallback)}
          @change=${commit}>
      </div>
      ${this._renderInputError(errorKey)}`;
  }

  /**
   * 선의 길이와 각도를 요소 영역 및 방향 값으로 변환해 저장한다.
   *
   * @param length - 길이(mm)
   * @param angle - 각도(도)
   */
  private _applyLineLengthAngle(length: number, angle: number): void {
    if (!Number.isFinite(length) || !Number.isFinite(angle) || length < 0) {
      this._rejectInput();
      return;
    }
    const box = lineBoxFromLengthAngle(length, angle);
    this._updateElement((target) => {
      if (target.type !== 'line') return;
      target.width = round1(box.width);
      target.height = round1(box.height);
      target.lineDirection = box.lineDirection;
    });
  }

  /** 키보드 단축키가 듣도록 호스트에 포커스를 준다 — 이미 안쪽에 있으면 건드리지 않는다 */
  private _focusHost(): void {
    if (this.contains(document.activeElement) || this.renderRoot.contains(this.shadowRoot?.activeElement ?? null)) {
      return;
    }
    this.focus({ preventScroll: true });
  }

  /** 포인터 좌표를 용지 기준 mm 좌표로 (용지 밖은 가장자리로 보정) */
  private _paperPoint(e: PointerEvent): { x: number; y: number } {
    const rect = (this.renderRoot.querySelector('.paper') as HTMLElement | null)
      ?.getBoundingClientRect();
    const { paper } = this._file!.template;
    return {
      x: Math.max(0, Math.min((e.clientX - (rect?.left ?? 0)) / PX_PER_MM, paper.width)),
      y: Math.max(0, Math.min((e.clientY - (rect?.top ?? 0)) / PX_PER_MM, paper.height)),
    };
  }

  private _onPointerDown = (e: PointerEvent): void => {
    if (!this._file) return;
    // preventDefault로 기본 포커스 이동이 막히므로 호스트에 포커스를 설정해 단축키를 유지한다.
    this._focusHost();

    // 생성 도구가 선택돼 있으면 클릭·드래그는 요소 생성이다 (선택·이동보다 우선)
    if (this._pendingTool) {
      const p = this._paperPoint(e);
      this._draw = { type: this._pendingTool, startX: p.x, startY: p.y, endX: p.x, endY: p.y, moved: false };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    // 반대쪽 끝점을 고정하고 선택한 끝점만 이동한다.
    const endpointEl = (e.target as HTMLElement).closest?.('.endpoint') as HTMLElement | null;
    if (endpointEl && this._selectedId) {
      const el = this._findSelectedElement();
      if (!el || el.type !== 'line') return;
      const which = endpointEl.dataset.endpoint === '1' ? 1 : 0;
      const points = lineEndpoints(el);
      this._lineEnd = {
        id: el.id,
        fixed: points[which === 0 ? 1 : 0]!,
        snapshot: null,
        orig: {
          x: el.position.x, y: el.position.y, w: el.width, h: el.height,
          direction: el.lineDirection,
        },
      };
      endpointEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const handleEl = (e.target as HTMLElement).closest?.('.handle') as HTMLElement | null;
    if (handleEl && this._selectedId) {
      const el = this._findSelectedElement();
      const handle = handleEl.dataset.handle as ResizeHandle | undefined;
      if (!el || !handle) return;
      this._resize = {
        id: el.id,
        handle,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origX: el.position.x,
        origY: el.position.y,
        origW: el.width,
        origH: el.height,
        snapshot: null,
      };
      handleEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 인라인 셀 입력 상자 안 클릭은 편집기에 맡긴다 (여기서 가로채면 입력이 불가능)
    if ((e.target as HTMLElement).closest?.('.cell-editor')) return;

    const target = (e.target as HTMLElement).closest?.('.element') as HTMLElement | null;

    if (target) {
      const id = target.dataset.id;
      if (!id) return;
      const wasSelected = this._selectedId === id;
      // 그룹에 속하면 그룹 전체가 함께 선택된다
      this._selectElement(id);
      this._sideSelection = null;
      this._expandParameterOfElement(id);
      if (!wasSelected) {
        this._selectedCell = null;
        this._cellEditing = false;
      }

      const el = this._findElement(id);
      if (!el) return;

      // 선택된 요소(그룹·다중)를 함께 옮기려 각 원래 위치를 기억한다
      const members = [...this._selectedIds]
        .map((mid) => this._findElement(mid))
        .filter((m): m is SlipElement => m !== undefined)
        .map((m) => ({ id: m.id, origX: m.position.x, origY: m.position.y }));
      this._drag = {
        id,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origMmX: el.position.x,
        origMmY: el.position.y,
        snapshot: null,
        wasSelected,
        members,
      };
      target.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      this._clearSelection();
      this._sideSelection = null;
      this._selectedCell = null;
      this._cellSourceKind = null;
      this._cellEditing = false;
    }
    this.requestUpdate();
  };

  private _onPointerMove = (e: PointerEvent): void => {
    if (this._draw) {
      const p = this._paperPoint(e);
      this._draw.endX = p.x;
      this._draw.endY = p.y;
      const w = Math.abs(p.x - this._draw.startX);
      const h = Math.abs(p.y - this._draw.startY);
      // 1mm 넘게 움직였을 때만 드래그로 본다 (클릭 손떨림은 기본 크기 생성)
      if (w > 1 || h > 1) this._draw.moved = true;
      if (this._draw.type === 'line') {
        // 선은 상자 대신 시작점→커서 미리보기 선으로 보여준다
        this.requestUpdate();
        return;
      }
      this._drawRect = {
        x: round1(Math.min(this._draw.startX, p.x)),
        y: round1(Math.min(this._draw.startY, p.y)),
        w: round1(w),
        h: round1(h),
      };
      this.requestUpdate();
      return;
    }
    // 두 번째 끝점을 선택할 때까지 커서 위치에 미리보기 선을 표시한다.
    if (this._lineDraft && this._pendingTool === 'line') {
      this._lineGhost = this._paperPoint(e);
      this.requestUpdate();
      return;
    }
    if (this._lineEnd) {
      this._onLineEndMove(e);
      return;
    }
    if (this._resize) {
      this._onResizeMove(e);
      return;
    }
    if (!this._drag) return;

    const el = this._findElement(this._drag.id);
    if (!el) return;
    this._drag.snapshot ??= JSON.stringify(this._file);

    const dx = (e.clientX - this._drag.startPxX) / PX_PER_MM;
    const dy = (e.clientY - this._drag.startPxY) / PX_PER_MM;
    let nx = this._drag.origMmX + dx;
    let ny = this._drag.origMmY + dy;

    // Alt를 누르면 스냅 없이 자유 이동
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!e.altKey) {
      // 함께 움직이는 선택 요소는 스냅 후보에서 뺀다
      const { xs, ys } = this._snapCandidates(new Set(this._drag.members.map((m) => m.id)));
      const sx = this._bestSnap([nx, nx + el.width / 2, nx + el.width], xs);
      const sy = this._bestSnap([ny, ny + el.height / 2, ny + el.height], ys);
      if (sx) {
        nx += sx.delta;
        guideX = sx.line;
      } else {
        // 붙을 요소·여백선이 없으면 격자에 맞춘다
        const g = this._gridDelta(nx);
        if (g !== null) nx += g;
      }
      if (sy) {
        ny += sy.delta;
        guideY = sy.line;
      } else {
        const g = this._gridDelta(ny);
        if (g !== null) ny += g;
      }
    }

    // 주 요소를 옮긴 만큼(스냅 반영) 선택된 요소를 모두 같은 양으로 옮긴다
    const deltaX = nx - this._drag.origMmX;
    const deltaY = ny - this._drag.origMmY;
    for (const m of this._drag.members) {
      const me = this._findElement(m.id);
      if (!me) continue;
      me.position.x = Math.max(0, round1(m.origX + deltaX));
      me.position.y = Math.max(0, round1(m.origY + deltaY));
    }
    this._guideX = guideX;
    this._guideY = guideY;
    this.requestUpdate();
  };

  private _onResizeMove(e: PointerEvent): void {
    const r = this._resize!;
    const el = this._findElement(r.id);
    if (!el) return;
    r.snapshot ??= JSON.stringify(this._file);

    const dx = (e.clientX - r.startPxX) / PX_PER_MM;
    const dy = (e.clientY - r.startPxY) / PX_PER_MM;
    const h = r.handle;

    let left = r.origX;
    let top = r.origY;
    let right = r.origX + r.origW;
    let bottom = r.origY + r.origH;
    if (h.includes('w')) left += dx;
    if (h.includes('e')) right += dx;
    if (h.includes('n')) top += dy;
    if (h.includes('s')) bottom += dy;

    // 움직이는 변만 후보 선에 스냅한다 (Alt로 해제)
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!e.altKey) {
      const { xs, ys } = this._snapCandidates(r.id);
      // 붙을 요소·여백선이 없는 변은 격자에 맞춘다
      const toGrid = (value: number): number => value + (this._gridDelta(value) ?? 0);
      if (h.includes('w')) {
        const s = this._bestSnap([left], xs);
        if (s) { left += s.delta; guideX = s.line; }
        else left = toGrid(left);
      }
      if (h.includes('e')) {
        const s = this._bestSnap([right], xs);
        if (s) { right += s.delta; guideX = s.line; }
        else right = toGrid(right);
      }
      if (h.includes('n')) {
        const s = this._bestSnap([top], ys);
        if (s) { top += s.delta; guideY = s.line; }
        else top = toGrid(top);
      }
      if (h.includes('s')) {
        const s = this._bestSnap([bottom], ys);
        if (s) { bottom += s.delta; guideY = s.line; }
        else bottom = toGrid(bottom);
      }
    }

    if (h.includes('w')) left = Math.min(Math.max(0, left), right - MIN_SIZE_MM);
    if (h.includes('e')) right = Math.max(right, left + MIN_SIZE_MM);
    if (h.includes('n')) top = Math.min(Math.max(0, top), bottom - MIN_SIZE_MM);
    if (h.includes('s')) bottom = Math.max(bottom, top + MIN_SIZE_MM);

    el.position.x = round1(left);
    el.position.y = round1(top);
    el.width = round1(right - left);
    el.height = round1(bottom - top);
    if (el.type === 'grid') syncGridTracks(el);
    this._guideX = guideX;
    this._guideY = guideY;
    this.requestUpdate();
  }

  /** 선 끝점 드래그 — 고정 끝점→커서 벡터로 상자와 선 방향을 다시 계산한다  */
  private _onLineEndMove(e: PointerEvent): void {
    const state = this._lineEnd!;
    const el = this._findElement(state.id);
    if (!el || el.type !== 'line') return;
    state.snapshot ??= JSON.stringify(this._file);

    const p = this._paperPoint(e);
    const dx = p.x - state.fixed.x;
    const dy = p.y - state.fixed.y;
    // 드래그 생성과 같은 규칙: 1mm 이내는 수평·수직, 그 밖은 기울기 부호로 사선 방향
    el.lineDirection =
      Math.abs(dy) <= 1 ? 'horizontal'
      : Math.abs(dx) <= 1 ? 'vertical'
      : dx * dy > 0 ? 'down' : 'up';
    el.position.x = round1(Math.min(p.x, state.fixed.x));
    el.position.y = round1(Math.min(p.y, state.fixed.y));
    el.width = round1(Math.abs(dx));
    el.height = round1(Math.abs(dy));
    this.requestUpdate();
  }

  private _onPointerCancel = (): void => {
    // 포인터 동작이 취소되면 편집 전 스냅샷을 복원하고 드래그 상태를 초기화한다.
    const snapshot = this._drag?.snapshot ?? this._resize?.snapshot ?? this._lineEnd?.snapshot;
    if (snapshot) {
      this._file = JSON.parse(snapshot) as SlipTemplateFile;
    }
    this._drag = null;
    this._resize = null;
    this._lineEnd = null;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this._guideX = null;
    this._guideY = null;
    this.requestUpdate();
  };

  /**
   * 드래그·크기 조절·끝점 이동이 실제로 값을 바꿨으면 스냅샷을 되돌리기에 쌓고 변경을 알린다.
   *
   * @param snapshot - 조작 시작 시 찍어 둔 되돌리기 스냅샷 (없으면 커밋하지 않음)
   * @param changed - 위치·크기가 실제로 바뀌었는지
   * @returns 커밋했으면 true
   */
  private _commitIfMoved(snapshot: string | null, changed: boolean): boolean {
    if (snapshot !== null && changed) {
      this._pushUndoSnapshot(snapshot);
      this._emitChange();
      return true;
    }
    return false;
  }

  private _onPointerUp = (e: PointerEvent): void => {
    if (this._draw) {
      const d = this._draw;
      const rect = this._drawRect;
      this._draw = null;
      this._drawRect = null;
      if (d.type === 'line') {
        this._finishLineDraw(d);
        return;
      }
      this._pendingTool = null;
      if (d.moved && rect) {
        // 드래그: 끌어낸 사각형의 위치·크기로 생성 (최소 크기는 _addElement가 보정)
        this._addElement(d.type, {
          position: { x: rect.x, y: rect.y }, width: rect.w, height: rect.h,
        });
      } else {
        // 클릭: 그 위치에 종류별 기본 크기로 생성
        this._addElement(d.type, { position: { x: round1(d.startX), y: round1(d.startY) } });
      }
      return;
    }

    this._guideX = null;
    this._guideY = null;

    if (this._lineEnd) {
      const state = this._lineEnd;
      this._lineEnd = null;
      const el = this._findElement(state.id);
      const changed = !!el && el.type === 'line' &&
        (el.position.x !== state.orig.x || el.position.y !== state.orig.y ||
          el.width !== state.orig.w || el.height !== state.orig.h ||
          el.lineDirection !== state.orig.direction);
      this._commitIfMoved(state.snapshot, changed);
      this.requestUpdate();
      return;
    }

    if (this._resize) {
      const r = this._resize;
      const el = this._findElement(r.id);
      const changed = !!el &&
        (el.position.x !== r.origX || el.position.y !== r.origY ||
          el.width !== r.origW || el.height !== r.origH);
      this._commitIfMoved(r.snapshot, changed);
      this._resize = null;
      this.requestUpdate();
      return;
    }

    if (!this._drag) return;
    const drag = this._drag;
    this._drag = null;
    const el = this._findElement(drag.id);
    const dragChanged = !!el &&
      (el.position.x !== drag.origMmX || el.position.y !== drag.origMmY);
    if (this._commitIfMoved(drag.snapshot, dragChanged)) return;
    // 선택된 그리드를 다시 클릭하면 해당 셀의 인라인 편집을 시작한다.
    if (isGrid(el) && drag.wasSelected && drag.snapshot === null) {
      const cell = this._cellAtPoint(el, e);
      if (cell) {
        if (this._selectedCell?.row !== cell.row || this._selectedCell?.column !== cell.column) {
          this._cellSourceKind = null;
        }
        this._selectedCell = cell;
        const definition = el.cells.find((item) => item.row === cell.row && item.column === cell.column);
        // 파라미터와 수식 셀은 속성 패널에서 편집하며 캔버스 입력기는 열지 않는다.
        this._cellEditing = definition === undefined
          || (definition.parameter === undefined && definition.formula === undefined);
        this.requestUpdate();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 그리드 셀 편집
  // ---------------------------------------------------------------------------

  /** 포인터가 가리키는 셀의 시작 좌표를 반환한다. */
  private _cellAtPoint(
    el: GridElement,
    e: PointerEvent,
  ): { row: number; column: number } | null {
    const point = this._paperPoint(e);
    const relX = point.x - el.position.x;
    const relY = point.y - el.position.y;
    if (relX < 0 || relY < 0 || relX > el.width || relY > el.height) return null;

    const colOffsets = trackOffsets(columnWidths(el));
    const rowOffsets = trackOffsets(expandedRowHeights(el));
    const dims = gridDims(el);
    // 오른쪽과 아래쪽 경계는 마지막 셀에 포함한다.
    const indexOf = (value: number, offsets: number[], count: number): number => {
      const found = offsets.findIndex((offset) => value < offset) - 1;
      return found < 0 ? count - 1 : Math.min(count - 1, found);
    };
    const column = indexOf(relX, colOffsets, dims.columns);
    // 펼쳐진 반복 행을 파일에 저장된 원본 행으로 변환한다.
    const row = templateRowOf(el, indexOf(relY, rowOffsets, rowOffsets.length - 1));

    // 병합된 셀 안의 좌표는 병합 시작 셀로 변환한다.
    for (const cell of el.cells) {
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      if (row >= cell.row && row < cell.row + rowSpan && column >= cell.column && column < cell.column + colSpan) {
        return { row: cell.row, column: cell.column };
      }
    }
    return { row, column };
  }

  /** 인라인 편집에 사용할 셀의 캔버스 영역(px)을 계산한다. */
  private _cellRectPx(
    el: GridElement,
    row: number,
    column: number,
  ): { left: number; top: number; width: number; height: number } {
    const colOffsets = trackOffsets(columnWidths(el));
    const rowOffsets = trackOffsets(expandedRowHeights(el));
    // 반복 셀의 편집기는 첫 번째로 펼쳐진 행에 표시한다.
    row = firstExpandedRowOf(el, row);
    const cell = el.cells.find((c) => c.row === templateRowOf(el, row) && c.column === column);
    const rowSpan = cell?.rowSpan ?? 1;
    const colSpan = cell?.colSpan ?? 1;
    const left = (el.position.x + (colOffsets[column] ?? 0)) * PX_PER_MM;
    const top = (el.position.y + (rowOffsets[row] ?? 0)) * PX_PER_MM;
    const width = ((colOffsets[column + colSpan] ?? 0) - (colOffsets[column] ?? 0)) * PX_PER_MM;
    const height = ((rowOffsets[row + rowSpan] ?? 0) - (rowOffsets[row] ?? 0)) * PX_PER_MM;
    return { left, top, width, height };
  }

  /** 인라인 편집 값을 기존 셀에 적용하거나 새 셀을 만든다. */
  private _commitCellContent(value: string): void {
    const target = this._selectedCell;
    if (!target) return;
    this._cellEditing = false;
    const el = this._findSelectedElement();
    if (!isGrid(el)) return;
    const existing = el.cells.find((c) => c.row === target.row && c.column === target.column);
    // 셀은 직접 입력, 파라미터, 수식 중 하나만 사용할 수 있다 (SPEC §5.7).
    if (existing && ('parameter' in existing || 'formula' in existing)) {
      this._rejectInput();
      return;
    }
    if (!existing && value === '') {
      this._clearInputError();
      return;
    }
    if (existing && existing.content === value) {
      this._clearInputError();
      return;
    }
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      ensureCell(element, target.row, target.column).content = value;
    });
  }

  /** 선택 셀의 병합 범위를 변경한다. 유효하지 않은 범위는 거부한다. */
  private _setCellSpan(kind: 'rowSpan' | 'colSpan', value: number): void {
    const target = this._selectedCell;
    const el = this._findSelectedElement();
    if (!target || !isGrid(el)) return;
    const errorKey = kind === 'rowSpan' ? 'cell-row-span' : 'cell-column-span';
    if (!Number.isInteger(value) || value < 1) {
      this._rejectInput(this._strings.designer.minimumInput.replace('{min}', '1'), errorKey);
      return;
    }
    const dims = gridDims(el);
    const current = el.cells.find((c) => c.row === target.row && c.column === target.column);
    const rowSpan = kind === 'rowSpan' ? value : (current?.rowSpan ?? 1);
    const colSpan = kind === 'colSpan' ? value : (current?.colSpan ?? 1);
    // 그리드 범위 검사
    if (target.row + rowSpan > dims.rows || target.column + colSpan > dims.columns) {
      this._rejectInput(this._strings.designer.mergeOutOfGrid, errorKey);
      return;
    }
    // 병합 범위는 반복 구간의 안이나 밖에 완전히 포함되어야 한다 (SPEC §5.7).
    if (el.type === 'grid' && el.repeat && rowSpan > 1) {
      const { fromRow, toRow } = el.repeat;
      const last = target.row + rowSpan - 1;
      const startsInside = target.row >= fromRow && target.row <= toRow;
      const endsInside = last >= fromRow && last <= toRow;
      if (startsInside !== endsInside) {
        this._rejectInput(this._strings.designer.mergeCrossRepeat, errorKey);
        return;
      }
    }
    // 다른 셀의 범위와 겹치는지 검사한다.
    const overlaps = el.cells.some((cell) => {
      if (cell === current) return false;
      const cellRowSpan = cell.rowSpan ?? 1;
      const cellColSpan = cell.colSpan ?? 1;
      return (
        target.row < cell.row + cellRowSpan &&
        cell.row < target.row + rowSpan &&
        target.column < cell.column + cellColSpan &&
        cell.column < target.column + colSpan
      );
    });
    if (overlaps) {
      this._rejectInput(this._strings.designer.mergeOverlap, errorKey);
      return;
    }
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (rowSpan > 1) record.rowSpan = rowSpan;
      else delete record.rowSpan;
      if (colSpan > 1) record.colSpan = colSpan;
      else delete record.colSpan;
    });
  }

  /** 선택 셀의 스타일 속성을 설정하거나 제거한다. */
  private _updateCellStyle(key: string, value: unknown): void {
    const target = this._selectedCell;
    if (!target) return;
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (value === null || value === undefined || value === '') delete record[key];
      else record[key] = value;
    });
  }

  // ---------------------------------------------------------------------------
  // 그리드 편집 2단계
  // ---------------------------------------------------------------------------

  /** 그리드를 수정하고 요소 크기를 행과 열의 합에 맞춘다. */
  private _updateGrid(fn: (el: GridElement) => void): void {
    this._updateElement((el) => {
      if (el.type !== 'grid') return;
      fn(el);
      recomputeGridBox(el);
    });
  }

  /**
   * 그리드의 마지막 행을 추가하거나 제거한다.
   */
  private _changeGridRows(delta: number): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    const next = el.rows.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    // 반복 구간에 포함된 행은 제거하지 않는다.
    if (delta < 0 && el.repeat && next <= el.repeat.toRow) return;
    this._updateGrid((grid) => {
      if (delta > 0) {
        grid.rows.push({ height: grid.rows[grid.rows.length - 1]?.height ?? GRID_DEFAULT_ROW_MM });
      } else {
        grid.rows.pop();
        grid.cells = grid.cells.filter((cell) => cell.row < grid.rows.length);
        clampGridSpans(grid);
      }
    });
  }

  /** 그리드의 마지막 열을 추가하거나 제거한다. */
  private _changeGridColumns(delta: number): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    const next = el.columns.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    this._updateGrid((grid) => {
      if (delta > 0) {
        grid.columns.push({ width: grid.columns[grid.columns.length - 1]?.width ?? GRID_DEFAULT_COL_MM });
      } else {
        grid.columns.pop();
        grid.cells = grid.cells.filter((cell) => cell.column < grid.columns.length);
        clampGridSpans(grid);
      }
    });
  }

  /** 지정한 행의 높이 또는 열의 너비(mm)를 변경한다. */
  private _setGridTrack(kind: 'row' | 'column', index: number, mm: number): void {
    const errorKey = kind === 'row' ? 'cell-row-height' : 'cell-column-width';
    if (!Number.isFinite(mm) || mm < MIN_SIZE_MM) {
      const message = !Number.isFinite(mm)
        ? this._strings.designer.numberInput
        : this._strings.designer.minimumInput.replace('{min}', String(MIN_SIZE_MM));
      this._rejectInput(message, errorKey);
      return;
    }
    this._updateGrid((grid) => {
      if (kind === 'row') {
        const row = grid.rows[index];
        if (row) row.height = round1(mm);
      } else {
        const column = grid.columns[index];
        if (column) column.width = round1(mm);
      }
    });
  }

  /** 반복 구간을 설정하거나 제거한다. */
  private _toggleGridRepeat(on: boolean): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    if (!on) {
      this._updateGrid((grid) => {
        delete (grid as { repeat?: unknown }).repeat;
      });
      return;
    }
    const row = Math.min(this._selectedCell?.row ?? Math.min(1, el.rows.length - 1), el.rows.length - 1);
    const key = `items_${el.id.slice(0, 4)}`;
    this._ensureParameterDef(key, 'list');
    this._updateGrid((grid) => {
      grid.repeat = {
        parameter: key,
        fromRow: row,
        toRow: row,
        perPage: GRID_DEFAULT_PER_PAGE,
        repeatHeader: true,
      };
    });
  }

  /** 반복 구간 설정을 변경한다. 유효하지 않은 설정은 거부한다. */
  private _updateGridRepeat(
    patch: Omit<Partial<GridRepeat>, 'maxItems'> & { maxItems?: number | null },
  ): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const next = { ...el.repeat, ...patch } as GridRepeat & { maxItems?: number | null };
    const errorKey = patch.fromRow !== undefined ? 'repeat-from'
      : patch.toRow !== undefined ? 'repeat-to'
      : patch.perPage !== undefined ? 'repeat-per-page'
      : patch.maxItems !== undefined ? 'repeat-max-items'
      : 'repeat-range';
    // null은 항목 수 제한을 사용하지 않는 상태로 변환한다.
    if (patch.maxItems === null) delete (next as { maxItems?: unknown }).maxItems;
    else if (patch.maxItems !== undefined) {
      const v = patch.maxItems;
      if (!Number.isInteger(v) || v > GRID_MAX_ITEMS_UI) {
        this._rejectInput(
          this._strings.designer.rangeInput
            .replace('{min}', String(next.perPage))
            .replace('{max}', String(GRID_MAX_ITEMS_UI)),
          errorKey,
        );
        return;
      }
    }
    if (next.fromRow > next.toRow || next.toRow >= el.rows.length || next.fromRow < 0) {
      this._rejectInput(this._strings.designer.repeatRangeError, errorKey);
      return;
    }
    if (!Number.isInteger(next.perPage) || next.perPage < 1 || next.perPage > GRID_MAX_PER_PAGE_UI) {
      this._rejectInput(
        this._strings.designer.rangeInput
          .replace('{min}', '1')
          .replace('{max}', String(GRID_MAX_PER_PAGE_UI)),
        errorKey,
      );
      return;
    }
    // 최대 항목 수는 페이지당 항목 수 이상이어야 한다 (SPEC §5.7).
    if (next.maxItems !== undefined && next.maxItems !== null && next.maxItems < next.perPage) {
      this._rejectInput(this._strings.designer.repeatLimitError, errorKey);
      return;
    }
    // 변경된 반복 구간의 경계를 넘는 병합이 있는지 검사한다 (SPEC §5.7).
    const crosses = el.cells.some((cell) => {
      const last = cell.row + (cell.rowSpan ?? 1) - 1;
      const startsInside = cell.row >= next.fromRow && cell.row <= next.toRow;
      const endsInside = last >= next.fromRow && last <= next.toRow;
      return startsInside !== endsInside;
    });
    if (crosses) {
      this._rejectInput(this._strings.designer.repeatMergeError, errorKey);
      return;
    }
    if (patch.parameter !== undefined) this._ensureParameterDef(patch.parameter, 'list');
    this._updateGrid((grid) => {
      grid.repeat = next;
    });
  }

  /**
   * 셀의 값 소스 종류를 선택한다.
   * 파라미터와 수식은 빈 값으로 저장할 수 없어 입력 전에는 화면 상태로만 유지한다.
   */
  private _chooseGridCellSource(kind: 'content' | 'parameter' | 'formula'): void {
    this._cellSourceKind = kind;
    const target = this._selectedCell;
    if (!target) return;
    this._updateElement((element) => {
      if (element.type !== 'grid') return;
      const cell = ensureCell(element, target.row, target.column);
      clearValueSources(cell);
      if (kind === 'content') cell.content = '';
    });
  }

  /**
   * 셀의 값 소스를 설정하고 다른 종류의 값 소스를 제거한다 (SPEC §5.7).
   */
  private _setGridCellSource(kind: 'content' | 'parameter' | 'formula', value: string): void {
    const target = this._selectedCell;
    // 선택된 셀이 없으면 입력을 적용하지 않고 오류를 표시한다.
    if (!target) {
      this._rejectInput();
      return;
    }
    this._updateElement((element) => {
      if (element.type !== 'grid') return;
      const cell = ensureCell(element, target.row, target.column);
      clearValueSources(cell);
      if (value !== '') cell[kind] = value;
      else if (kind === 'content') cell.content = '';
    });
  }

  // ---------------------------------------------------------------------------
  // Snap helpers
  // ---------------------------------------------------------------------------

  /** 스냅 후보 선: 용지 가장자리·여백선 + 다른 요소들의 가장자리·중앙선 (mm) */
  private _snapCandidates(exclude: string | ReadonlySet<string>): { xs: number[]; ys: number[] } {
    // 그룹·다중 이동 때는 함께 움직이는 요소들을 후보에서 모두 뺀다
    const excluded = typeof exclude === 'string' ? new Set([exclude]) : exclude;
    const { paper } = this._file!.template;
    const [pt, pr, pb, pl] = paper.padding;
    const xs = [0, pl, paper.width - pr, paper.width];
    const ys = [0, pt, paper.height - pb, paper.height];
    for (const el of this._currentElements() ?? []) {
      if (excluded.has(el.id)) continue;
      xs.push(el.position.x, el.position.x + el.width / 2, el.position.x + el.width);
      ys.push(el.position.y, el.position.y + el.height / 2, el.position.y + el.height);
    }
    return { xs, ys };
  }

  /** edges 중 후보 선까지의 거리가 SNAP_MM 이내인 가장 가까운 이동량을 찾는다 */
  private _bestSnap(
    edges: number[],
    candidates: number[],
  ): { delta: number; line: number } | null {
    let best: { delta: number; line: number } | null = null;
    for (const edge of edges) {
      for (const line of candidates) {
        const delta = line - edge;
        if (Math.abs(delta) <= SNAP_MM && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, line };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private _onKeyDown = (e: KeyboardEvent): void => {
    // 입력 필드 안에서는 편집기 단축키를 가로채지 않는다.
    // Shadow DOM 안에서 올라온 이벤트는 호스트에서 target이 호스트 요소로
    // 재지정(retargeting)되므로, 실제 입력 대상은 composedPath의 첫 항목으로 판정한다.
    const target = e.composedPath()[0] ?? e.target;
    const inFormField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (inFormField) return;

    // 모달이 열려 있으면 Esc는 모달 닫기 (모달 안 입력란의 Esc는 모달 자체가 처리)
    if (
      e.key === 'Escape' &&
      (this._formulaModalOpen || this._sampleModalOpen ||
        this._imageModalOpen || this._saveModalOpen || this._myFormsOpen)
    ) {
      this._formulaModalOpen = false;
      this._sampleModalOpen = false;
      this._imageModalOpen = false;
      this._imageError = null;
      this._saveModalOpen = false;
      this._myFormsOpen = false;
      this.requestUpdate();
      return;
    }

    if (e.key === 'Escape' && (this._pendingTool || this._draw || this._lineDraft)) {
      this._pendingTool = null;
      this._draw = null;
      this._drawRect = null;
      this._lineDraft = null;
      this._lineGhost = null;
      this.requestUpdate();
    }
    // PDF 미리보기 상태에서는 문서를 변경하는 단축키를 처리하지 않는다.
    if (this._previewMode) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedId) {
      e.preventDefault();
      this._deleteSelected();
    }
    if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      this._copySelected();
    }
    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._paste();
    }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) this._redo();
      else this._undo();
    }
    if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._redo();
    }
    if ((e.key === 'b' || e.key === 'B') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._showBadges = !this._showBadges;
      this.requestUpdate();
    }
  };

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  private _revokePreviewUrl(): void {
    // 모드나 소스가 바뀌기 전에 시작한 렌더 결과는 적용하지 않는다.
    this._previewGeneration++;
    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }
  }

  private async _togglePreview(): Promise<void> {
    if (this._previewMode) {
      this._previewMode = false;
      this._previewError = null;
      this._revokePreviewUrl();
      return;
    }
    if (!this._file) return;

    this._previewMode = true;
    this._previewError = null;
    this._revokePreviewUrl();

    const gen = ++this._previewGeneration;
    try {
      // 호스트가 폰트를 제공하지 않으면 UI 언어에 맞는 동봉 폰트를 사용한다.
      const opts: RenderOptions = {
        getFonts: () => resolveFonts(this.settings, this.locale),
        ...(this.locale === undefined ? {} : { locale: this.locale }),
      };
      // 샘플 값이 있으면 해당 값을 적용한 전표를 미리보기로 렌더링한다.
      // 파일 자체는 양식 그대로 두고 렌더 입력만 전표 형태로 만든다.
      const sample = this._file.template.sampleValues;
      const target: SlipFile =
        sample && Object.keys(sample).length > 0
          ? {
              schemaVersion: this._file.schemaVersion,
              kind: 'voucher',
              templateSnapshot: this._file.template,
              values: sample,
              issued: false,
            }
          : this._file;
      const pdfBytes = await renderSlipToPdf(target, opts);
      if (gen !== this._previewGeneration) return;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-designer] PDF preview failed:', error);
      if (gen !== this._previewGeneration) return;
      // 미리보기 화면에 오류를 표시하고 편집 버튼은 유지한다.
      this._previewError = this._strings.designer.previewError;
    }
  }

  // ---------------------------------------------------------------------------
  // Render: top-level
  // ---------------------------------------------------------------------------

  override render() {
    if (!this._file) {
      return html`<div class="empty-state ${this._error ? 'error' : ''}">
        ${this._error ?? this._strings.designer.noTemplate}
      </div>`;
    }

    return html`
      <div class="toolbar">${this._renderToolbar()}</div>
      ${this._previewMode
        ? html`<div class="preview-area">
            ${this._previewUrl
              ? html`<iframe src=${this._previewUrl} title=${this._strings.designer.pdfTitle}></iframe>`
              : this._previewError
                ? html`<div class="status error">${this._previewError}</div>`
                : html`<div class="status">${this._strings.designer.previewLoading}</div>`}
          </div>`
        : html`
            <aside class="sidebar">${this._renderSidebar()}</aside>
            <div class="canvas-area ${this._pendingTool ? 'drawing' : ''} ${
              this._showBadges ? 'show-badges' : ''
            }"
                 @pointerdown=${this._onPointerDown}
                 @pointermove=${this._onPointerMove}
                 @pointerup=${this._onPointerUp}
                 @pointercancel=${this._onPointerCancel}>
              ${this._renderCanvas()}
            </div>
            ${this._cursorMm
              ? html`<div class="coords">${this._cursorMm.x} · ${this._cursorMm.y} mm</div>`
              : nothing}
            <div class="prop-panel">
              ${this._inputError && this._inputErrorField === null
                ? html`<div class="input-error" role="alert">${this._inputError}</div>`
                : nothing}
              ${this._renderPropertyPanel()}
            </div>
            ${this._renderFormulaModal()}
            ${this._renderImageModal()}
            ${this._renderSampleModal()}
            ${this._renderSaveModal()}
            ${this._renderMyFormsModal()}
          `}
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: toolbar
  // ---------------------------------------------------------------------------

  /** 아이콘, 표시 이름, 접근성 레이블로 툴바 버튼을 만든다. */
  private _iconButton(
    label: string,
    glyph: TemplateResult,
    onClick: (e: Event) => void,
    opts: { disabled?: boolean; pressed?: boolean } = {},
  ) {
    return html`<button title=${label} aria-label=${label}
      aria-pressed=${opts.pressed === undefined ? nothing : String(opts.pressed)}
      ?disabled=${opts.disabled === true}
      @click=${onClick}>${glyph}<span class="btn-label">${label}</span></button>`;
  }

  private _renderToolbar() {
    const s = this._strings.designer;
    return html`
      <div class="tool-group">
        ${([
          ['text', s.addText, icons.text],
          ['grid', s.addGrid, icons.gridElement],
          ['image', s.addImage, icons.image],
          ['line', s.shapeLine, icons.line],
        ] as const).map(([type, label, glyph]) =>
          this._iconButton(label, glyph, () => this._selectTool(type), {
            pressed: this._pendingTool === type,
            disabled: this._previewMode,
          }),
        )}
        ${this._iconButton(s.shape, icons.shape, (e) => this._toggleShapeMenu(e), {
          pressed:
            this._shapeMenuOpen ||
            this._pendingTool === 'rect' ||
            this._pendingTool === 'ellipse' ||
            this._pendingTool === 'polygon',
          disabled: this._previewMode,
        })}
        ${this._iconButton(s.addField, icons.field, () => this._selectTool('field'), {
          pressed: this._pendingTool === 'field',
          disabled: this._previewMode,
        })}
        ${this._iconButton(s.addBarcode, icons.barcode, () => this._selectTool('barcode'), {
          pressed: this._pendingTool === 'barcode',
          disabled: this._previewMode,
        })}
      </div>
      <div class="tool-group">
        ${this._iconButton(s.copy, icons.copy, () => this._copySelected(), { disabled: !this._selectedId || this._previewMode })}
        ${this._iconButton(s.paste, icons.paste, () => this._paste(), { disabled: !this._clipboard || this._previewMode })}
        ${this._iconButton(s.undo, icons.undo, () => this._undo(), { disabled: this._undoStack.length === 0 || this._previewMode })}
        ${this._iconButton(s.redo, icons.redo, () => this._redo(), { disabled: this._redoStack.length === 0 || this._previewMode })}
      </div>
      <div class="tool-group">
        <span class="page-indicator">${this._pageIndex + 1} / ${this._pageCount()}</span>
        ${this._iconButton(s.addPage, icons.pageAdd, () => this._addPage(), { disabled: this._previewMode })}
        ${this._iconButton(s.deletePage, icons.pageRemove, () => this._deletePage(), { disabled: this._pageCount() <= 1 || this._previewMode })}
      </div>
      <div class="tool-group">
        ${this._iconButton(
          this._previewMode ? s.edit : s.preview,
          this._previewMode ? icons.edit : icons.preview,
          () => this._togglePreview(),
          { pressed: this._previewMode },
        )}
        ${this._iconButton(s.showBadges, icons.badges, () => {
          this._showBadges = !this._showBadges;
          this.requestUpdate();
        }, { pressed: this._showBadges, disabled: this._previewMode })}
        ${this._iconButton(s.grid, icons.grid, (e) => this._toggleGridMenu(e), {
          pressed: this._gridMenuOpen || this._gridGap !== null,
          disabled: this._previewMode,
        })}
      </div>
      <div class="tool-group">
        ${this._iconButton(s.preset, icons.preset, (e) => this._togglePresetMenu(e), {
          pressed: this._presetMenuOpen,
          disabled: this._previewMode,
        })}
      </div>
      ${this.storage
        ? html`
            <div class="tool-group">
              ${this._iconButton(s.saveAsMyForm, icons.save, () => this._openSaveModal())}
              ${this._iconButton(s.myFormsList, icons.folderOpen, () => void this._openMyForms())}
            </div>
            ${this._savedNotice
              ? html`<span class="saved-notice">${s.savedNotice}</span>`
              : nothing}`
        : nothing}
      ${this._presetMenuOpen
        ? html`
            <div class="menu-backdrop" @click=${() => {
              this._presetMenuOpen = false;
              this.requestUpdate();
            }}></div>
            <div class="preset-menu" role="menu" aria-label=${s.preset}
                 style="left:${this._presetMenuPos.left}px;top:${this._presetMenuPos.top}px">
              ${this._presetList().map((p, index) => html`
                <button role="menuitem" @click=${() => this._applyPreset(index)}>${p.name}</button>`)}
            </div>`
        : nothing}
      ${this._shapeMenuOpen
        ? html`
            <div class="menu-backdrop" @click=${() => {
              this._shapeMenuOpen = false;
              this.requestUpdate();
            }}></div>
            <div class="preset-menu" role="menu" aria-label=${s.shape}
                 style="left:${this._shapeMenuPos.left}px;top:${this._shapeMenuPos.top}px">
              ${([
                [s.shapeRect, 'rect', 3],
                [s.shapeEllipse, 'ellipse', 3],
                [s.shapeTriangle, 'polygon', 3],
                [s.shapePentagon, 'polygon', 5],
                [s.shapeHexagon, 'polygon', 6],
              ] as const).map(([label, type, sides]) => html`
                <button role="menuitem" @click=${() => this._selectShapeTool(type, sides)}>
                  ${label}
                </button>`)}
            </div>`
        : nothing}
      ${this._gridMenuOpen
        ? html`
            <div class="menu-backdrop" @click=${() => {
              this._gridMenuOpen = false;
              this.requestUpdate();
            }}></div>
            <div class="preset-menu" role="menu" aria-label=${s.gridGap}
                 style="left:${this._gridMenuPos.left}px;top:${this._gridMenuPos.top}px">
              <button role="menuitem" aria-pressed=${String(this._gridGap === null)}
                @click=${() => this._setGridGap(null)}>${s.gridNone}</button>
              ${GRID_GAPS.map((gap) => html`
                <button role="menuitem" aria-pressed=${String(this._gridGap === gap)}
                  @click=${() => this._setGridGap(gap)}>${gap}mm</button>`)}
              ${this._gridGap !== null
                ? html`<div class="grid-colors" role="group" aria-label=${s.gridColor}>
                    ${GRID_COLORS.map((color) => html`
                      <button style="background:${color.swatch}"
                        title=${s[color.nameKey]}
                        aria-label="${s.gridColor}: ${s[color.nameKey]}"
                        aria-pressed=${String(this._gridColor === color.id)}
                        @click=${() => {
                          this._gridColor = color.id;
                          this._gridMenuOpen = false;
                          this.requestUpdate();
                        }}></button>`)}
                  </div>`
                : nothing}
            </div>`
        : nothing}
    `;
  }

  /** 현재 선택된 캔버스 격자선 색을 반환한다. */
  private _gridLine(): string {
    return GRID_COLORS.find((color) => color.id === this._gridColor)!.line;
  }

  /** 격자 설정 메뉴를 열거나 닫는다. */
  private _toggleGridMenu(e: Event): void {
    if (this._gridMenuOpen) {
      this._gridMenuOpen = false;
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._gridMenuPos = { left: rect.left, top: rect.bottom + 4 };
      this._gridMenuOpen = true;
    }
    this.requestUpdate();
  }

  /** 격자 간격을 설정한다. `null`이면 격자를 끈다. */
  private _setGridGap(gap: number | null): void {
    this._gridGap = gap;
    this._gridMenuOpen = false;
    this.requestUpdate();
  }

  /**
   * 현재 좌표를 가장 가까운 격자선에 맞추는 이동량을 계산한다.
   *
   * 격자가 꺼져 있으면 `null`을 반환한다.
   *
   * @param value - 현재 위치(mm)
   * @returns 더해야 할 이동량(mm) 또는 null
   */
  private _gridDelta(value: number): number | null {
    const gap = this._gridGap;
    if (gap === null) return null;
    return Math.round(value / gap) * gap - value;
  }

  /** 도형 메뉴를 버튼 아래에서 열거나 닫는다. */
  private _toggleShapeMenu(e: Event): void {
    if (this._shapeMenuOpen) {
      this._shapeMenuOpen = false;
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._shapeMenuPos = { left: rect.left, top: rect.bottom + 4 };
      this._shapeMenuOpen = true;
    }
    this.requestUpdate();
  }

  /** 호스트가 지정한 프리셋 또는 현재 locale의 기본 프리셋을 반환한다. */
  private _presetList(): SlipPreset[] {
    return this.presets?.length ? this.presets : getPresets(this.locale);
  }

  /** 프리셋 메뉴를 버튼 아래의 화면 고정 위치에서 열거나 닫는다. */
  /** 열려 있는 리스트형 선택 상자의 식별자. null이면 모두 닫혀 있다 */
  private _listSelectId: string | null = null;
  /** 리스트형 선택 상자 목록의 화면 고정 위치와 최대 높이(px) */
  private _listSelectPos = { left: 0, top: 0, width: 0, maxHeight: 280 };

  private _toggleListSelect(id: string, e: Event): void {
    if (this._listSelectId === id) {
      this._listSelectId = null;
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // 목록이 화면 아래로 넘치지 않게 남은 높이 안에서만 편다.
      const maxHeight = Math.max(120, Math.min(280, window.innerHeight - rect.bottom - 12));
      this._listSelectPos = { left: rect.left, top: rect.bottom + 4, width: rect.width, maxHeight };
      this._listSelectId = id;
    }
    this.requestUpdate();
  }

  private _closeListSelect(): void {
    this._listSelectId = null;
    this.requestUpdate();
  }

  /**
   * 네이티브 select 대신 쓰는 리스트형 선택 상자를 렌더링한다.
   * 트리거 버튼을 누르면 버튼 아래 화면 고정 위치에 항목 목록이 열린다.
   */
  private _listSelect(config: {
    id: string;
    ariaLabel: string;
    value: string;
    options: { value: string; label: string }[];
    onPick: (value: string) => void;
    className?: string;
  }) {
    const open = this._listSelectId === config.id;
    const current = config.options.find((o) => o.value === config.value);
    return html`
      <button type="button" class="list-select ${config.className ?? ''}"
        aria-haspopup="listbox" aria-expanded=${String(open)} aria-label=${config.ariaLabel}
        data-value=${config.value}
        @click=${(e: Event) => this._toggleListSelect(config.id, e)}>
        <span class="list-select-value">${current?.label ?? config.value}</span>
        <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
      </button>
      ${open
        ? html`
          <div class="menu-backdrop" @click=${() => this._closeListSelect()}></div>
          <div class="preset-menu list-select-menu" role="listbox" aria-label=${config.ariaLabel}
            style="left:${this._listSelectPos.left}px;top:${this._listSelectPos.top}px;min-width:${this._listSelectPos.width}px;max-height:${this._listSelectPos.maxHeight}px">
            ${config.options.map((o) => html`
              <button type="button" role="option" data-value=${o.value}
                aria-selected=${String(o.value === config.value)}
                @click=${() => {
                  this._closeListSelect();
                  config.onPick(o.value);
                }}>${o.label}</button>`)}
          </div>`
        : nothing}
    `;
  }

  private _togglePresetMenu(e: Event): void {
    if (this._presetMenuOpen) {
      this._presetMenuOpen = false;
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._presetMenuPos = { left: rect.left, top: rect.bottom + 4 };
      this._presetMenuOpen = true;
    }
    this.requestUpdate();
  }

  /** 현재 양식을 선택한 프리셋으로 교체하고 되돌리기 이력을 남긴다. */
  private _applyPreset(index: number): void {
    this._presetMenuOpen = false;
    this.requestUpdate();
    if (!this._file) return;
    const preset = this._presetList()[index];
    if (!preset) return;

    this._pushUndo();
    this._file = preset.create();
    this._clearSelection();
    this._sideSelection = null;
    this._pageIndex = 0;
    this._previewMode = false;
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 사이드바 렌더링
  // ---------------------------------------------------------------------------

  /** 요소가 있는 페이지로 이동하고 해당 요소를 선택한다. */
  private _selectFromSidebar(pageIndex: number, id: string, additive = false): void {
    this._goToPage(pageIndex);
    // Ctrl/Cmd+클릭은 다중 선택 상태를 전환한다.
    if (additive) {
      this._toggleInSelection(id);
      return;
    }
    this._selectElement(id);
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = null;
    this._expandParameterOfElement(id);
    this.requestUpdate();
  }

  /** 목록 파라미터의 하위 필드를 선택하고 사용 중인 첫 번째 그리드 셀로 이동한다. */
  private _selectParameterField(listKey: string, field: ParameterFieldInfo): void {
    this._resetPanelErrors();
    if (field.at) {
      this._goToPage(field.at.pageIndex);
      this._expandedElements.add(field.at.gridId);
    }
    this._sideSelection = { kind: 'parameterField', key: listKey, field: field.key };
    this._selectedId = null;
    this._selectedIds = new Set();
    this._selectedCell = null;
    this._cellEditing = false;
    this.requestUpdate();
  }

  /**
   * 선택한 그리드의 목록 파라미터와 값이 있는 셀 항목을 사이드바에서 펼친다.
   *
   * @param id - 고른 요소 id
   */
  private _expandParameterOfElement(id: string): void {
    const el = this._findElement(id);
    if (!isGrid(el)) return;
    if (el.repeat) this._expandedParameters.add(el.repeat.parameter);
    // 값이 지정된 셀이 있으면 그리드의 하위 항목을 펼친다.
    if (this._gridValueCells(el).length > 0) this._expandedElements.add(id);
  }

  /** 현재 페이지를 지정한 상대 위치로 이동한다. */
  private _movePage(delta: number): void {
    const pages = this._file?.template.pages;
    if (!pages) return;
    const target = this._pageIndex + delta;
    if (target < 0 || target >= pages.length) return;

    this._pushUndo();
    const [moved] = pages.splice(this._pageIndex, 1);
    pages.splice(target, 0, moved!);
    this._pageIndex = target;
    this._emitChange();
    this.requestUpdate();
  }

  /**
   * 선택한 페이지로 이동하고 페이지 설정 패널을 표시한다.
   *
   * @param index - 고른 페이지 번호(0-기반)
   */
  private _selectPage(index: number): void {
    this._goToPage(index);
    this._clearSelection();
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = { kind: 'page' };
    this.requestUpdate();
  }

  /** 파라미터를 선택하고 오른쪽에 편집 패널을 표시한다. */
  private _selectParameter(key: string): void {
    this._parameterKeyError = false;
    this._clearSelection();
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = { kind: 'parameter', key };
    // 선택한 목록 파라미터의 하위 필드를 펼친다.
    this._expandedParameters.add(key);
    this.requestUpdate();
  }

  /**
   * 파라미터 정의와 요소별 사용 위치를 합쳐 사이드바 항목을 만든다.
   */
  private _parameterList(): ParameterInfo[] {
    const file = this._file;
    if (!file) return [];
    const defs = file.template.parameters ?? [];
    const defOf = new Map(defs.map((b) => [b.key, b] as const));

    const uses = new Map<string, ParameterUse[]>();
    // 목록 하위 필드별로 해당 필드를 사용하는 그리드 셀 위치를 기록한다.
    const fieldAt = new Map<string, Map<string, NonNullable<ParameterFieldInfo['at']>>>();

    file.template.pages.forEach((page, pageIndex) => {
      for (const el of page.elements) {
        // 그리드의 반복 파라미터와 고정 행의 셀 파라미터를 수집한다.
        if (el.type === 'grid') {
          if (el.repeat) {
            const { fromRow, toRow, parameter: listKey } = el.repeat;
            const at = fieldAt.get(listKey) ?? new Map();
            const band = el.cells
              .filter((c) => c.row >= fromRow && c.row <= toRow && c.parameter !== undefined)
              .sort((a, b) => a.column - b.column || a.row - b.row);
            for (const cell of band) {
              const key = cell.parameter as string;
              if (!at.has(key)) {
                at.set(key, { pageIndex, gridId: el.id, row: cell.row, column: cell.column });
              }
            }
            fieldAt.set(listKey, at);
          }
          const keys = new Set<string>();
          if (el.repeat) keys.add(el.repeat.parameter);
          // 반복 구간의 셀 파라미터는 목록 항목의 하위 필드이므로 최상위 값에서 제외한다.
          for (const cell of el.cells) {
            if (cell.parameter !== undefined && !inRepeatBand(el, cell.row)) keys.add(cell.parameter);
          }
          for (const key of keys) {
            const list = uses.get(key) ?? [];
            list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
            uses.set(key, list);
          }
          continue;
        }
        // 변동 이미지가 참조하는 파라미터를 사용 위치에 추가한다.
        if (el.type === 'image' && el.parameter !== undefined) {
          const list = uses.get(el.parameter) ?? [];
          list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
          uses.set(el.parameter, list);
          continue;
        }
        // 수식만 쓰는 필드는 파라미터를 갖지 않는다
        if (el.type !== 'field' || el.parameter === undefined) continue;
        const list = uses.get(el.parameter) ?? [];
        list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
        uses.set(el.parameter, list);
      }
    });

    const list: ParameterInfo[] = [];
    const seen = new Set<string>();
    for (const key of [...defs.map((d) => d.key), ...uses.keys()]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const def = defOf.get(key);
      const at = fieldAt.get(key);
      // 목록 하위 필드는 파라미터 정의에 등록된 항목만 표시한다.
      const fields: ParameterFieldInfo[] = (def?.fields ?? []).map((f) => ({
        key: f.key,
        title: f.label ?? f.key,
        rawLabel: f.label,
        valueType: f.valueType,
        at: at?.get(f.key),
      }));
      list.push({
        key,
        label: def?.label ?? key,
        rawLabel: def?.label,
        valueType: def?.valueType,
        defined: def !== undefined,
        uses: uses.get(key) ?? [],
        fields,
      });
    }
    return list;
  }

  /**
   * 페이지, 요소, 파라미터를 탐색하고 선택하는 왼쪽 사이드바를 렌더링한다.
   */
  private _renderSidebar() {
    const file = this._file!;
    const s = this._strings.designer;
    const { paper } = file.template;
    // 용지 비율을 유지하며 페이지 미리보기 크기를 계산한다.
    const thumbW = THUMB_WIDTH_PX;
    const scale = thumbW / paper.width;
    const pages = file.template.pages;
    const parameters = this._parameterList();

    return html`
      <div class="side-section">
        <div class="side-title">${s.sidebarPages}</div>
        ${pages.map((page, i) => html`
          <div class="page-row-wrap">
            <span class="side-twisty-gap"></span>
            <button class="side-row page-row ${
              this._sideSelection?.kind === 'page' && i === this._pageIndex
                ? 'selected'
                : i === this._pageIndex ? 'current' : ''
            }"
              aria-label="${s.sidebarPages} ${i + 1}"
              aria-pressed=${String(i === this._pageIndex)}
              @click=${() => this._selectPage(i)}
              @pointerenter=${(e: Event) => this._showPageThumb(i, e)}
              @pointerleave=${() => this._hidePageThumb(i)}
              @focus=${(e: Event) => this._showPageThumb(i, e)}
              @blur=${() => this._hidePageThumb(i)}>
              ${icons.page}<span>${this._pageDisplayName(page, i)}</span>
            </button>
            ${this._thumbPage === i && this._thumbPos
              ? html`<div class="page-thumb-pop" role="presentation"
                  style="top:${this._thumbPos.top}px;left:${this._thumbPos.left}px">
                  <span class="thumb-paper"
                    style="width:${thumbW}px;height:${(paper.height * scale).toFixed(1)}px">
                    ${page.elements.map((el) => html`<span class="thumb-el" style="
                      left:${(el.position.x * scale).toFixed(1)}px;
                      top:${(el.position.y * scale).toFixed(1)}px;
                      width:${Math.max(2, el.width * scale).toFixed(1)}px;
                      height:${Math.max(2, el.height * scale).toFixed(1)}px;
                    "></span>`)}
                  </span>
                </div>`
              : nothing}
          </div>`)}
      </div>

      <div class="side-section">
        <div class="side-title">${s.sidebarElements}</div>
        ${pages.map((page, i) => html`
          ${pages.length > 1
            ? html`<button class="side-page-head ${i === this._pageIndex ? 'current' : ''}"
                aria-label="${s.sidebarElements} ${s.sidebarPages} ${i + 1}"
                aria-expanded=${String(i === this._pageIndex)}
                @click=${() => this._goToPage(i)}>
                <span>${this._pageDisplayName(page, i)}</span><span>${page.elements.length}</span>
              </button>`
            : nothing}
          ${i !== this._pageIndex
            ? nothing
            : page.elements.length === 0
              ? html`<div class="side-empty">—</div>`
              : page.elements.map((el) => this._renderElementRow(i, el))}`)}
      </div>

      <div class="side-section">
        <div class="side-title-row">
          <span class="side-title">${s.sidebarParameters}</span>
          <button class="side-mini" title=${s.sampleData} aria-label=${s.sampleData}
            @click=${() => {
              this._sampleModalOpen = true;
              this._samplePage = 0;
              this._sampleJsonMode = false;
              this._sampleImageError = null;
              this.requestUpdate();
            }}>${icons.database}</button>
          <button class="side-mini" title=${s.addParameter} aria-label=${s.addParameter}
            @click=${() => this._addParameter()}>${icons.pageAdd}</button>
        </div>
        ${parameters.length === 0
          ? html`<div class="side-empty">—</div>`
          : parameters.map((b) => this._renderParameterRow(b))}
      </div>
    `;
  }

  /**
   * 하위 항목이 있는 사이드바 행에 펼침 버튼을 표시한다.
   * 하위 항목이 없으면 같은 너비의 빈 공간을 표시한다.
   *
   * @param hasChildren - 하위 줄이 있는지
   * @param expanded - 현재 펼침 상태
   * @param name - 무엇을 펼치고 접는지 (읽어 주는 이름에 쓴다)
   * @param toggle - 눌렀을 때 펼침을 뒤집는 처리
   * @returns 펼침 표시 또는 빈 자리
   */
  private _renderTwisty(
    hasChildren: boolean,
    expanded: boolean,
    name: string,
    toggle: () => void,
  ) {
    if (!hasChildren) return html`<span class="side-twisty-gap"></span>`;
    const s = this._strings.designer;
    const label = expanded ? s.collapseRow : s.expandRow;
    return html`
      <button class="side-twisty" aria-label="${name} ${label}" title=${label}
        aria-expanded=${String(expanded)}
        @click=${toggle}>${expanded ? icons.treeOpen : icons.treeClosed}</button>`;
  }

  /**
   * 파라미터와 목록 하위 필드를 사이드바 행으로 표시한다.
   */
  private _renderParameterRow(b: ParameterInfo) {
    const s = this._strings.designer;
    const sel = this._sideSelection;
    const selected = sel?.kind === 'parameter' && sel.key === b.key;
    const hasFields = b.fields.length > 0;
    const expanded = hasFields && this._expandedParameters.has(b.key);
    return html`
      <div class="side-row-wrap">
        ${this._renderTwisty(hasFields, expanded, b.label, () => this._toggleParameterRow(b.key))}
        <button class="side-row ${selected ? 'selected' : ''}" title=${b.key}
          @click=${() => this._selectParameter(b.key)}>
          ${valueTypeBadge(b.valueType)}<span>${b.label}</span>
        </button>
        <button class="side-mini" title=${s.delete} aria-label="${b.key} ${s.delete}"
          ?disabled=${!b.defined}
          @click=${() => this._removeParameterDef(b.key)}>${icons.remove}</button>
      </div>
      ${expanded
        ? b.fields.map((f) => {
            const fieldSelected = sel?.kind === 'parameterField' && sel.key === b.key && sel.field === f.key;
            return html`
              <div class="side-row-wrap">
                <span class="side-twisty-gap"></span>
                <button class="side-col-row ${fieldSelected ? 'selected' : ''}" title="${b.key}.${f.key}"
                  @click=${() => this._selectParameterField(b.key, f)}
                  >${valueTypeBadge(f.valueType)}<span>${f.title}</span></button>
                <button class="side-mini" title=${s.delete} aria-label="${f.key} ${s.delete}"
                  @click=${() => this._removeParameterField(b.key, f.key)}>${icons.remove}</button>
              </div>`;
          })
        : nothing}
      ${b.valueType === 'list'
        ? html`
          <div class="side-row-wrap">
            <span class="side-twisty-gap"></span>
            <button class="side-add-field" @click=${() => this._addParameterField(b.key)}>
              ${icons.add}<span>${s.addParameterField}</span>
            </button>
          </div>`
        : nothing}
    `;
  }

  /** 파라미터의 하위 필드 목록을 열거나 닫는다. */
  private _toggleParameterRow(key: string): void {
    if (this._expandedParameters.has(key)) this._expandedParameters.delete(key);
    else this._expandedParameters.add(key);
    this.requestUpdate();
  }

  /**
   * 요소와 값이 있는 그리드 셀을 사이드바 행으로 표시한다.
   *
   * @param pageIndex - 이 요소가 있는 페이지 번호
   * @param el - 그릴 요소
   * @returns 요소 줄과 (그리드면) 펼쳐진 셀 하위 줄
   */
  private _renderElementRow(pageIndex: number, el: SlipElement) {
    const s = this._strings.designer;
    const cells = isGrid(el) ? this._gridValueCells(el) : [];
    const hasCells = cells.length > 0;
    const expanded = hasCells && this._expandedElements.has(el.id);
    // 그리드 셀이 선택된 경우에는 요소 행 대신 해당 셀 행을 강조한다.
    const rowSelected = this._selectedIds.has(el.id) && !this._sideSelection && this._selectedCell === null;
    return html`
      <div class="side-row-wrap">
        ${this._renderTwisty(hasCells, expanded, el.name, () => this._toggleElementRow(el.id))}
        <button class="side-row ${rowSelected ? 'selected' : ''}" title=${el.name}
          @click=${(e: MouseEvent) => this._selectFromSidebar(pageIndex, el.id, e.ctrlKey || e.metaKey)}>
          ${TYPE_BADGE[el.type]}<span>${el.name}</span>
        </button>
        <button class="side-mini" title=${s.delete} aria-label="${el.name} ${s.delete}"
          @click=${() => this._deleteElementById(pageIndex, el.id)}>${icons.remove}</button>
      </div>
      ${expanded
        ? cells.map((c) => {
            const cellSelected = this._selectedId === el.id
              && this._selectedCell?.row === c.row && this._selectedCell?.column === c.column;
            return html`
              <button class="side-cell-row ${cellSelected ? 'selected' : ''}" title=${c.at}
                @click=${() => this._selectGridCell(pageIndex, el.id, c.row, c.column)}>
                <span>${c.label}</span></button>`;
          })
        : nothing}
    `;
  }

  /**
   * 파라미터 또는 수식이 지정된 그리드 셀을 행과 열 순서로 반환한다.
   *
   * @param grid - 그리드 요소
   * @returns 셀의 위치와 표시 이름(값은 논리명, 수식은 식)
   */
  private _gridValueCells(grid: GridElement): { row: number; column: number; label: string; at: string }[] {
    const s = this._strings.designer;
    return grid.cells
      .filter((c) => c.parameter !== undefined || c.formula !== undefined)
      .slice()
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((c) => {
        // 셀 이름은 같은 열의 헤더를 사용하고 헤더가 없으면 행과 열 좌표를 사용한다.
        const header = gridHeaderTitle(grid, c.column, grid.repeat?.fromRow ?? grid.rows.length);
        const at = s.gridCellAt
          .replace('{r}', String(c.row + 1))
          .replace('{c}', String(c.column + 1));
        return { row: c.row, column: c.column, label: header ?? at, at };
      });
  }

  /** 그리드의 셀 하위 목록을 열거나 닫는다. */
  private _toggleElementRow(id: string): void {
    if (this._expandedElements.has(id)) this._expandedElements.delete(id);
    else this._expandedElements.add(id);
    this.requestUpdate();
  }

  /**
   * 그리드 셀의 페이지로 이동해 해당 셀을 선택한다.
   *
   * @param pageIndex - 그리드가 있는 페이지 번호
   * @param gridId - 그리드 요소 id
   * @param row - 셀의 행
   * @param column - 셀의 열
   */
  private _selectGridCell(pageIndex: number, gridId: string, row: number, column: number): void {
    this._resetPanelErrors();
    this._goToPage(pageIndex);
    // 셀을 선택할 때는 그리드 그룹의 다른 요소를 선택하지 않는다.
    this._selectedId = gridId;
    this._selectedIds = new Set([gridId]);
    this._selectedCell = { row, column };
    this._cellEditing = false;
    this._sideSelection = null;
    this._expandedElements.add(gridId);
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 요소와 파라미터 정의 편집
  // ---------------------------------------------------------------------------

  /** 지정한 페이지에서 요소를 삭제한다. */
  private _deleteElementById(pageIndex: number, id: string): void {
    const elements = this._file?.template.pages[pageIndex]?.elements;
    if (!elements) return;
    const idx = elements.findIndex((el) => el.id === id);
    if (idx < 0) return;

    this._pushUndo();
    elements.splice(idx, 1);
    if (this._selectedIds.has(id)) {
      const next = new Set(this._selectedIds);
      next.delete(id);
      this._selectedIds = next;
      if (this._selectedId === id) this._selectedId = next.values().next().value ?? null;
      this._selectedCell = null;
      this._cellEditing = false;
    }
    this._emitChange();
    this.requestUpdate();
  }

  /** 기본 키로 파라미터를 만들고 선택한다. */
  private _addParameter(): void {
    if (!this._file) return;
    const { key, label } = this._nextParameter();
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      defs.push({ key, label });
      f.template.parameters = defs;
    });
    this._selectParameter(key);
  }

  /**
   * 요소가 사용하는 파라미터를 정의 목록에 등록한다.
   *
   * @param key - 파라미터 물리명
   * @param valueType - 등록할 값 종류. 이미 있는 항목이면 종류가 비어 있을 때만 채운다
   */
  private _ensureParameterDef(key: string, valueType?: ParameterValueType): void {
    const file = this._file;
    if (!file || !key) return;
    const defs = file.template.parameters ?? [];
    const found = defs.find((b) => b.key === key);
    if (found) {
      // 기존 정의에 값 종류가 없을 때만 요청한 종류를 적용한다.
      if (valueType !== undefined && found.valueType === undefined) found.valueType = valueType;
      return;
    }
    defs.push(valueType === undefined ? { key } : { key, valueType });
    file.template.parameters = defs;
  }

  /**
   * 파라미터 키와 해당 키를 참조하는 요소 및 샘플 값을 함께 변경한다.
   * 빈 키와 중복 키는 적용하지 않는다.
   */
  private _renameParameterKey(key: string, next: string, input?: HTMLInputElement): void {
    const trimmed = next.trim();
    if (!trimmed) {
      if (input) input.value = key;
      this._parameterKeyError = false;
      this._rejectInput(this._strings.designer.requiredInput, 'parameter-key');
      return;
    }
    if (trimmed === key) {
      this._parameterKeyError = false;
      this._clearInputError();
      return;
    }
    if (this._parameterList().some((b) => b.key === trimmed)) {
      // 잘못된 입력을 현재 키로 복원한다.
      if (input) input.value = key;
      this._parameterKeyError = true;
      this.requestUpdate();
      return;
    }
    this._parameterKeyError = false;
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      const def = defs.find((b) => b.key === key);
      if (def) def.key = trimmed;
      else defs.push({ key: trimmed });
      f.template.parameters = defs;
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type === 'field' && el.parameter === key) el.parameter = trimmed;
          if (el.type === 'grid') {
            if (el.repeat?.parameter === key) el.repeat.parameter = trimmed;
            for (const cell of el.cells) {
              // 반복 구간 안의 셀 파라미터는 목록 하위 필드이므로 최상위 키 변경에서 제외한다.
              const inBand =
                el.repeat !== undefined && cell.row >= el.repeat.fromRow && cell.row <= el.repeat.toRow;
              if (!inBand && cell.parameter === key) cell.parameter = trimmed;
            }
          }
        }
      }
      const samples = f.template.sampleValues;
      if (samples && key in samples) {
        samples[trimmed] = samples[key]!;
        delete samples[key];
      }
    });
    this._sideSelection = { kind: 'parameter', key: trimmed };
    this.requestUpdate();
  }

  /** 파라미터 레이블을 변경한다. 빈 값이면 레이블을 제거한다. */
  private _commitParameterLabel(key: string, label: string): void {
    const trimmed = label.trim();
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      const def = defs.find((b) => b.key === key);
      if (def) {
        if (trimmed) def.label = trimmed;
        else delete (def as { label?: string }).label;
      } else {
        defs.push(trimmed ? { key, label: trimmed } : { key });
      }
      f.template.parameters = defs;
    });
  }

  /**
   * 파라미터의 값 종류를 변경한다. 목록이 아니면 하위 필드를 제거한다.
   *
   * @param key - 파라미터 물리명
   * @param valueType - 새 값 종류 (빈 문자열이면 지정 없음 = 글자)
   */
  private _setParameterValueType(key: string, valueType: string): void {
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      const def = defs.find((b) => b.key === key) ?? { key };
      if (!defs.includes(def)) defs.push(def);
      if (valueType) def.valueType = valueType as ParameterValueType;
      else delete (def as { valueType?: unknown }).valueType;
      // 하위 필드는 목록 파라미터에만 허용된다.
      if (valueType !== 'list') delete (def as { fields?: unknown }).fields;
      f.template.parameters = defs;
    });
  }

  /** 목록 파라미터에 기본 키로 하위 필드를 추가하고 선택한다. */
  private _addParameterField(listKey: string): void {
    const existing = this._parameterList().find((b) => b.key === listKey)?.fields ?? [];
    const used = new Set(existing.map((f) => f.key));
    let n = existing.length + 1;
    while (used.has(`field${n}`)) n += 1;
    const key = `field${n}`;
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      const def = defs.find((b) => b.key === listKey);
      if (!def) return;
      const fields = def.fields ?? [];
      fields.push({ key });
      def.fields = fields;
      f.template.parameters = defs;
    });
    this._expandedParameters.add(listKey);
    this._sideSelection = { kind: 'parameterField', key: listKey, field: key };
    this.requestUpdate();
  }

  /**
   * 하위 필드 키와 해당 필드를 참조하는 반복 구간 셀을 함께 변경한다.
   *
   * @param listKey - 목록 파라미터 물리명
   * @param key - 현재 필드 키
   * @param next - 새 물리명
   * @param input - 되돌릴 입력칸 (중복·빈 이름일 때)
   */
  private _renameParameterField(listKey: string, key: string, next: string, input?: HTMLInputElement): void {
    const trimmed = next.trim();
    const siblings = this._parameterList().find((b) => b.key === listKey)?.fields ?? [];
    if (!trimmed) {
      if (input) input.value = key;
      this._parameterKeyError = false;
      this._rejectInput(this._strings.designer.requiredInput, 'parameter-key');
      return;
    }
    if (trimmed === key) {
      this._parameterKeyError = false;
      this._clearInputError();
      return;
    }
    if (siblings.some((f) => f.key === trimmed)) {
      if (input) input.value = key;
      this._parameterKeyError = true;
      this.requestUpdate();
      return;
    }
    this._parameterKeyError = false;
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      const def = defs.find((b) => b.key === listKey);
      const field = def?.fields?.find((x) => x.key === key);
      if (field) field.key = trimmed;
      // 해당 목록 파라미터의 반복 구간에서 참조하는 셀만 변경한다.
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type !== 'grid' || el.repeat?.parameter !== listKey) continue;
          const { fromRow, toRow } = el.repeat;
          for (const cell of el.cells) {
            if (cell.row >= fromRow && cell.row <= toRow && cell.parameter === key) cell.parameter = trimmed;
          }
        }
      }
    });
    this._sideSelection = { kind: 'parameterField', key: listKey, field: trimmed };
    this.requestUpdate();
  }

  /**
   * 하위 필드의 레이블과 값 종류를 변경한다.
   *
   * @param listKey - 목록 파라미터 물리명
   * @param key - 필드 물리명
   * @param patch - 바꿀 값 (빈 문자열이면 그 항목을 지운다)
   */
  private _updateParameterField(
    listKey: string,
    key: string,
    patch: { label?: string; valueType?: string },
  ): void {
    this._updateFile((f) => {
      const def = (f.template.parameters ?? []).find((b) => b.key === listKey);
      const field = def?.fields?.find((x) => x.key === key);
      if (!field) return;
      if (patch.label !== undefined) {
        const trimmed = patch.label.trim();
        if (trimmed) field.label = trimmed;
        else delete (field as { label?: string }).label;
      }
      if (patch.valueType !== undefined) {
        if (patch.valueType) field.valueType = patch.valueType as ParameterValueType;
        else delete (field as { valueType?: unknown }).valueType;
      }
    });
  }

  /** 목록 하위 필드와 해당 필드를 참조하는 셀의 파라미터를 제거한다. */
  private _removeParameterField(listKey: string, key: string): void {
    this._updateFile((f) => {
      const def = (f.template.parameters ?? []).find((b) => b.key === listKey);
      if (!def?.fields) return;
      const rest = def.fields.filter((x) => x.key !== key);
      if (rest.length > 0) def.fields = rest;
      else delete (def as { fields?: unknown }).fields;
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type !== 'grid' || el.repeat?.parameter !== listKey) continue;
          const { fromRow, toRow } = el.repeat;
          for (const cell of el.cells) {
            if (cell.row >= fromRow && cell.row <= toRow && cell.parameter === key) {
              delete (cell as { parameter?: string }).parameter;
            }
          }
        }
      }
    });
    const sel = this._sideSelection;
    if (sel?.kind === 'parameterField' && sel.key === listKey && sel.field === key) {
      this._sideSelection = { kind: 'parameter', key: listKey };
    }
    this.requestUpdate();
  }

  /** 정의부에서 파라미터를 제거한다 — 요소가 쓰는 키면 목록에는 사용처 기준으로 남는다 */
  private _removeParameterDef(key: string): void {
    this._updateFile((f) => {
      const defs = (f.template.parameters ?? []).filter((b) => b.key !== key);
      if (defs.length > 0) f.template.parameters = defs;
      else delete (f.template as { parameters?: unknown }).parameters;
    });
    // 목록에서 사라진 파라미터를 고른 채로 두지 않는다
    const sel = this._sideSelection;
    if (sel?.kind === 'parameter' && sel.key === key && !this._parameterList().some((b) => b.key === key)) {
      this._sideSelection = null;
      this.requestUpdate();
    }
  }

  // ---------------------------------------------------------------------------
  // Render: canvas
  // ---------------------------------------------------------------------------

  /**
   * 캔버스에 페이지 번호 자리표시를 렌더링한다.
   * 실제 페이지 번호는 PDF 후처리에서 결정되므로 캔버스에는 `X / X`를 표시한다.
   *
   * @param page - 현재 페이지
   * @param paper - 용지 크기
   * @param padding - 여백 `[상, 우, 하, 좌]`(mm)
   * @returns 번호 자리표시 조각. 번호 표시가 꺼져 있으면 빈 것
   */
  private _renderPageNumberPlaceholder(
    page: SlipPage,
    paper: { width: number; height: number },
    padding: [number, number, number, number],
  ) {
    const setting = page.pageNumber;
    if (!setting) return nothing;
    const [pt, pr, pb, pl] = padding;
    const isTop = setting.position.startsWith('top-');
    const align = setting.position.endsWith('-left')
      ? 'flex-start'
      : setting.position.endsWith('-right') ? 'flex-end' : 'center';
    const boxH = 6;
    const left = pl * PX_PER_MM;
    const width = (paper.width - pl - pr) * PX_PER_MM;
    const top = (isTop ? Math.max(0, pt - boxH) : paper.height - pb) * PX_PER_MM;
    return html`<div class="page-number-mark" style="
      left:${left}px; top:${top}px; width:${width}px; height:${boxH * PX_PER_MM}px;
      justify-content:${align};
    ">X / X</div>`;
  }

  private _renderCanvas() {
    if (!this._file) return nothing;
    const { paper } = this._file.template;
    const page = this._file.template.pages[this._pageIndex];
    if (!page) return nothing;

    const pw = paper.width * PX_PER_MM;
    const ph = paper.height * PX_PER_MM;
    const [pt, pr, pb, pl] = paper.padding;

    return html`
      <div class="paper-wrap" style="--paper-w:${pw}px;--paper-h:${ph}px"
        @pointermove=${(e: PointerEvent) => this._trackCursor(e)}
        @pointerleave=${() => {
          if (this._cursorMm === null) return;
          this._cursorMm = null;
          this.requestUpdate();
        }}>
        <div class="ruler-corner"></div>
        ${this._renderRuler('h', paper.width, pw)}
        ${this._renderRuler('v', paper.height, ph)}
      <div class="paper" style="width:${pw}px;height:${ph}px">
        ${this._gridGap !== null
          ? html`<div class="grid-overlay" style="
              background-size:${this._gridGap}mm ${this._gridGap}mm;
              background-image:
                linear-gradient(to right, ${this._gridLine()} 1px, transparent 1px),
                linear-gradient(to bottom, ${this._gridLine()} 1px, transparent 1px);
            "></div>`
          : nothing}
        <div class="padding-guide" style="
          left:${pl * PX_PER_MM}px;
          top:${pt * PX_PER_MM}px;
          width:${(paper.width - pl - pr) * PX_PER_MM}px;
          height:${(paper.height - pt - pb) * PX_PER_MM}px;
        "></div>
        ${this._renderPageNumberPlaceholder(page, paper, [pt, pr, pb, pl])}
        ${page.elements.map((el) => this._renderElement(el))}
        ${this._renderSelectionOverlay()}
        ${this._guideX !== null
          ? html`<div class="snap-guide vertical" style="left:${this._guideX * PX_PER_MM}px"></div>`
          : nothing}
        ${this._guideY !== null
          ? html`<div class="snap-guide horizontal" style="top:${this._guideY * PX_PER_MM}px"></div>`
          : nothing}
        ${this._drawRect
          ? html`<div class="draw-ghost" style="
              left:${this._drawRect.x * PX_PER_MM}px;
              top:${this._drawRect.y * PX_PER_MM}px;
              width:${this._drawRect.w * PX_PER_MM}px;
              height:${this._drawRect.h * PX_PER_MM}px;
            "></div>`
          : nothing}
        ${this._renderLineGhost(pw, ph)}
        ${this._renderCellEditor()}
      </div>
      </div>
    `;
  }

  /**
   * 용지 위의 커서 위치를 mm 좌표로 기록하고 용지 밖에서는 지운다.
   */
  private _trackCursor(e: PointerEvent): void {
    const paper = this.renderRoot.querySelector('.paper');
    if (!paper) return;
    const rect = paper.getBoundingClientRect();
    const x = (e.clientX - rect.left) / PX_PER_MM;
    const y = (e.clientY - rect.top) / PX_PER_MM;
    const { paper: size } = this._file!.template;
    const inside = x >= 0 && y >= 0 && x <= size.width && y <= size.height;
    const next = inside ? { x: round1(x), y: round1(y) } : null;
    if (next?.x === this._cursorMm?.x && next?.y === this._cursorMm?.y) return;
    this._cursorMm = next;
    this.requestUpdate();
  }

  /**
   * 5mm 간격의 눈금과 10mm 간격의 숫자를 표시하는 눈금자를 렌더링한다.
   * 커서가 용지 위에 있으면 현재 위치도 표시한다.
   *
   * @param axis - 'h'는 위쪽 가로 자, 'v'는 왼쪽 세로 자
   * @param lengthMm - 용지 길이(mm)
   * @param lengthPx - 용지 길이(px)
   * @returns 눈금자 조각
   */
  private _renderRuler(axis: 'h' | 'v', lengthMm: number, lengthPx: number) {
    const horizontal = axis === 'h';
    const marks: TemplateResult[] = [];
    for (let mm = 0; mm <= Math.floor(lengthMm); mm += 5) {
      const long = mm % 10 === 0;
      const pos = mm * PX_PER_MM;
      marks.push(svg`<line
        x1=${horizontal ? pos : RULER_PX - (long ? 7 : 4)}
        y1=${horizontal ? RULER_PX - (long ? 7 : 4) : pos}
        x2=${horizontal ? pos : RULER_PX}
        y2=${horizontal ? RULER_PX : pos}
        stroke="currentColor" stroke-width="1" />`);
      if (long && mm > 0) {
        marks.push(svg`<text
          x=${horizontal ? pos + 2 : RULER_PX - 3}
          y=${horizontal ? 8 : pos - 2}
          font-size="8" fill="currentColor"
          text-anchor=${horizontal ? 'start' : 'end'}>${mm}</text>`);
      }
    }
    const cursor = this._cursorMm;
    const cursorPos = cursor ? (horizontal ? cursor.x : cursor.y) * PX_PER_MM : null;

    return html`
      <div class="ruler ruler-${axis}"
        style=${horizontal ? `width:${lengthPx}px` : `height:${lengthPx}px`}>
        <svg width=${horizontal ? lengthPx : RULER_PX} height=${horizontal ? RULER_PX : lengthPx}>
          ${marks}
          ${cursorPos === null
            ? nothing
            : svg`<line
                x1=${horizontal ? cursorPos : 0}
                y1=${horizontal ? 0 : cursorPos}
                x2=${horizontal ? cursorPos : RULER_PX}
                y2=${horizontal ? RULER_PX : cursorPos}
                stroke="var(--sk-accent)" stroke-width="1" />`}
        </svg>
      </div>
    `;
  }

  /**
   * 수식 미리보기에 사용할 값을 만든다.
   * 샘플 값이 없는 파라미터에는 선언된 종류의 기본값을 사용한다.
   *
   * @returns 파라미터 물리명 → 값
   */
  private _formulaProbeValues(): Record<string, unknown> {
    const samples = this._file?.template.sampleValues ?? {};
    const probeFor = (type: ParameterValueType | undefined): unknown => {
      switch (type) {
        case 'number': return 1;
        case 'boolean': return true;
        case 'date': return '2026-01-01';
        case 'image': return '';
        default: return '가';
      }
    };
    const out: Record<string, unknown> = { ...samples };
    for (const b of this._parameterList()) {
      if (out[b.key] !== undefined) continue;
      if (b.valueType === 'list') {
        const item: Record<string, unknown> = {};
        for (const f of b.fields) item[f.key] = probeFor(f.valueType);
        out[b.key] = [item];
        continue;
      }
      out[b.key] = probeFor(b.valueType);
    }
    return out;
  }

  /**
   * 선언된 모든 파라미터에 현재 샘플 값을 적용한 JSON 객체를 만든다.
   *
   * @returns 파라미터 물리명 → 값 (없으면 종류에 맞는 빈 값)
   */
  private _sampleSkeleton(): Record<string, unknown> {
    const samples = this._file?.template.sampleValues ?? {};
    const emptyFor = (type: ParameterValueType | undefined): unknown => {
      switch (type) {
        case 'number': return 0;
        case 'boolean': return false;
        case 'list': return [];
        default: return '';
      }
    };
    /** 목록 항목에 선언된 모든 하위 필드의 키를 추가한다. */
    const withFields = (
      row: Record<string, unknown>,
      fields: readonly ParameterFieldInfo[],
    ): Record<string, unknown> => {
      const item: Record<string, unknown> = {};
      for (const f of fields) item[f.key] = row[f.key] ?? emptyFor(f.valueType);
      // 정의에 없는 기존 값도 유지한다.
      for (const [k, v] of Object.entries(row)) if (!(k in item)) item[k] = v;
      return item;
    };

    const out: Record<string, unknown> = {};
    for (const b of this._parameterList()) {
      const current = samples[b.key];
      // 각 목록 항목에 선언된 하위 필드를 모두 추가한다.
      if (b.valueType === 'list') {
        const rows = Array.isArray(current) ? current : [];
        out[b.key] = rows.length > 0
          ? rows.map((row) =>
              typeof row === 'object' && row !== null && !Array.isArray(row)
                ? withFields(row as Record<string, unknown>, b.fields)
                : row)
          : b.fields.length > 0 ? [withFields({}, b.fields)] : [];
        continue;
      }
      out[b.key] = current !== undefined ? current : emptyFor(b.valueType);
    }
    return out;
  }

  /** 선택된 셀 위에 인라인 편집 입력을 표시한다. */
  private _renderCellEditor() {
    if (!this._cellEditing || !this._selectedCell) return nothing;
    const el = this._findSelectedElement();
    if (!isGrid(el)) return nothing;
    const { row, column } = this._selectedCell;
    const rect = this._cellRectPx(el, row, column);
    const cell = el.cells.find((c) => c.row === row && c.column === column);
    // 편집 중에도 셀 모양을 유지하도록 셀의 표시 스타일을 입력에 적용한다.
    const bg = cell?.backgroundColor ?? el.backgroundColor;
    const fg = cell?.fontColor ?? el.fontColor;
    const size = cell?.fontSize ?? el.fontSize;
    const align = cell?.alignment ?? el.alignment;
    const inherited = [
      bg ? `background:${bg}` : 'background:transparent',
      fg ? `color:${fg}` : '',
      size ? `font-size:${fontPx(size)}` : '',
      align ? `text-align:${align}` : '',
    ].filter(Boolean).join(';');
    return html`<input class="cell-editor"
      style="left:${rect.left}px;top:${rect.top}px;width:${Math.max(24, rect.width)}px;height:${Math.max(16, rect.height)}px;${inherited}"
      .value=${cell?.content ?? ''}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this._commitCellContent((e.target as HTMLInputElement).value);
        } else if (e.key === 'Escape') {
          this._cellEditing = false;
          this.requestUpdate();
        }
      }}
      @blur=${(e: Event) => {
        if (this._cellEditing) this._commitCellContent((e.target as HTMLInputElement).value);
      }}>`;
  }

  /** 선을 생성하는 동안 반투명 미리보기 선을 표시한다. */
  private _renderLineGhost(paperW: number, paperH: number) {
    const from = this._draw?.type === 'line' && this._draw.moved
      ? { x: this._draw.startX, y: this._draw.startY }
      : this._lineDraft;
    const to = this._draw?.type === 'line' && this._draw.moved
      ? { x: this._draw.endX, y: this._draw.endY }
      : this._lineGhost;
    if (!from || !to) return nothing;
    return html`<svg class="line-ghost" viewBox="0 0 ${paperW} ${paperH}"
      preserveAspectRatio="none">
      ${svg`<line x1=${from.x * PX_PER_MM} y1=${from.y * PX_PER_MM}
        x2=${to.x * PX_PER_MM} y2=${to.y * PX_PER_MM}
        stroke="var(--sk-accent)" stroke-width="2" stroke-linecap="round" />`}
    </svg>`;
  }

  private _renderSelectionOverlay() {
    // 크기 조절 핸들은 요소 하나만 선택한 경우에 표시한다.
    if (this._selectedIds.size > 1) return nothing;
    const el = this._findSelectedElement();
    if (!el) return nothing;
    const x = el.position.x * PX_PER_MM;
    const y = el.position.y * PX_PER_MM;
    const w = el.width * PX_PER_MM;
    const h = el.height * PX_PER_MM;
    // 선 요소에는 영역 핸들 대신 두 끝점 핸들을 표시한다.
    if (el.type === 'line') {
      const [p0, p1] = lineEndpoints(el);
      const rel = (p: { x: number; y: number }) => ({
        x: (p.x - el.position.x) * PX_PER_MM,
        y: (p.y - el.position.y) * PX_PER_MM,
      });
      const r0 = rel(p0);
      const r1 = rel(p1);
      return html`
        <div class="selection-overlay" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
          <svg class="line-highlight" viewBox="0 0 ${Math.max(1, w)} ${Math.max(1, h)}"
            preserveAspectRatio="none">
            ${svg`<line x1=${r0.x} y1=${r0.y} x2=${r1.x} y2=${r1.y}
              stroke="var(--sk-accent)" stroke-width="6" stroke-linecap="round"
              opacity="0.35" />`}
          </svg>
          ${([r0, r1] as const).map((p, index) => html`
            <span class="handle endpoint" data-endpoint=${String(index)}
              style="left:${p.x}px;top:${p.y}px"></span>`)}
        </div>
      `;
    }
    return html`
      <div class="selection-overlay" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
        ${RESIZE_HANDLES.map(
          (handle) => html`<span class="handle handle-${handle}" data-handle=${handle}></span>`,
        )}
      </div>
    `;
  }

  private _renderElement(el: SlipElement) {
    const x = el.position.x * PX_PER_MM;
    const y = el.position.y * PX_PER_MM;
    const w = el.width * PX_PER_MM;
    const h = el.height * PX_PER_MM;
    // 다중 선택된 요소의 영역을 모두 강조한다.
    const selected = this._selectedIds.has(el.id);

    let style = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

    // 선과 곡선 도형은 PDF 변환 방식에 맞춰 SVG로 그린다.
    const drawnAsSvg = el.type === 'line' || el.type === 'ellipse' || el.type === 'polygon';
    if (el.type !== 'image' && !drawnAsSvg) {
      const r = el as Record<string, unknown>;
      if (r.backgroundColor) style += `;background-color:${r.backgroundColor}`;
      if (r.fontColor) style += `;color:${r.fontColor}`;
      /*
       * 캔버스에는 PDF 변환과 같은 테두리 기본값을 적용한다.
       * 테두리 굵기가 0이면 요소 영역을 확인할 수 있도록 편집 안내선만 표시한다.
       */
      const effectiveWidth = typeof r.borderWidth === 'number'
        ? r.borderWidth
        : (el.type === 'text' || el.type === 'field' ? 0 : DEFAULT_LINE_WIDTH);
      if (effectiveWidth > 0) {
        const color = (r.borderColor as string | undefined) ?? DEFAULT_BORDER_COLOR;
        style += `;border-color:${color}`;
        style += `;border-width:${(effectiveWidth * PX_PER_MM).toFixed(2)}px`;
      } else {
        // 테두리 굵기가 0이면 캔버스 안내선만 표시한다.
        style += ';border-color:var(--sk-guide-faint)';
      }
      if (el.type === 'rect') {
        // 모서리 반경과 테두리 형태는 사각형 요소에만 적용한다.
        if (el.radius !== undefined && el.radius > 0) {
          style += `;border-radius:${(el.radius * PX_PER_MM).toFixed(2)}px`;
        }
        if (el.borderStyle === 'dashed' || el.borderStyle === 'dotted') {
          style += `;border-style:${el.borderStyle}`;
        }
      }
    }

    return html`
      <div class="element ${selected ? 'selected' : ''} type-${el.type}"
           data-id=${el.id}
           style=${style}>
        <span class="badge">${TYPE_BADGE[el.type]}</span>
        ${this._renderElementContent(el)}
      </div>
    `;
  }

  private _renderElementContent(el: SlipElement) {
    switch (el.type) {
      case 'text':
        return html`<span class="el-content"
          style="font-size:${fontPx(el.fontSize)};text-align:${el.alignment ?? 'left'}${textStyleCss(el)}"
          >${stackVertically(el.content, el.vertical)}</span>`;

      case 'grid':
        return this._renderGridElementPreview(el);

      case 'image': {
        // 변동 이미지는 샘플 이미지가 있으면 표시하고 없으면 파라미터 키를 표시한다.
        if (el.parameter !== undefined) {
          const sample = this._file?.template.sampleValues?.[el.parameter];
          return typeof sample === 'string' && sample.startsWith('data:')
            ? html`<img src=${sample} alt="">`
            : html`<span class="el-content">{${el.parameter}}</span>`;
        }
        // 기본 투명 이미지는 이미지가 선택되지 않았음을 나타내는 문구로 표시한다.
        return el.src !== undefined && el.src !== PLACEHOLDER_IMG && el.src.startsWith('data:')
          ? html`<img src=${el.src} alt="">`
          : html`<span class="el-content">${this._strings.designer.typeImage}</span>`;
      }

      case 'line':
      case 'ellipse':
      case 'polygon':
        return this._renderShapePreview(el);

      case 'rect':
        return nothing;

      case 'field': {
        // 필드에는 파라미터 키 또는 수식을 표시한다.
        const label = el.parameter !== undefined ? `{${el.parameter}}` : (el.formula ?? '');
        return html`<span class="el-content"
          style="font-size:${fontPx(el.fontSize)};text-align:${el.alignment ?? 'left'}${textStyleCss(el)}"
          >${stackVertically(label, el.vertical)}</span>`;
      }

      case 'barcode':
        return this._renderBarcodePreview(el);
    }
  }

  /**
   * 편집용 바코드 견본을 캔버스에 표시한다.
   * 실제 바코드는 PDF 미리보기에서 렌더링한다.
   */
  private _renderBarcodePreview(el: SlipElement & { type: 'barcode' }) {
    const label = el.content ?? (el.parameter !== undefined ? `{${el.parameter}}` : el.formula ?? '');
    const color = el.fontColor ?? '#000000';
    const kindLabel = BARCODE_KINDS.find((k) => k.value === el.kind)?.label ?? el.kind;
    // 바코드 종류와 현재 값 소스를 함께 표시한다.
    const caption = html`<span class="barcode-caption">${kindLabel}${label ? ` · ${label}` : ''}</span>`;
    if (BARCODE_2D.has(el.kind)) {
      // 2차원 바코드는 위치 탐지 무늬가 있는 격자 형태로 표시한다.
      const n = 11;
      const cells = Array.from({ length: n }, (_, r) =>
        Array.from({ length: n }, (_, c) => {
          const finder = (r < 3 && c < 3) || (r < 3 && c >= n - 3) || (r >= n - 3 && c < 3);
          const on = finder || (r + c) % 2 === 0;
          return on ? svg`<rect x=${c} y=${r} width="1" height="1" fill=${color} />` : nothing;
        }),
      );
      return html`
        <div class="barcode-preview">
          <svg viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" class="barcode-svg">${cells}</svg>
          ${caption}
        </div>`;
    }
    // 1차원 바코드는 굵기가 다른 세로 막대로 표시한다.
    const pattern = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 2];
    const total = pattern.reduce((sum, w) => sum + w, 0);
    let x = 0;
    const bars = pattern.map((w, i) => {
      const bar = i % 2 === 0 ? svg`<rect x=${x} y="0" width=${w} height="1" fill=${color} />` : nothing;
      x += w;
      return bar;
    });
    return html`
      <div class="barcode-preview">
        <svg viewBox="0 0 ${total} 1" preserveAspectRatio="none" class="barcode-svg">${bars}</svg>
        ${caption}
      </div>`;
  }

  /**
   * PDF 변환과 같은 규칙으로 도형의 SVG를 만든다.
   * SVG 내부 요소는 Lit의 `svg` 템플릿으로 생성한다.
   */
  private _renderShapePreview(el: SlipElement & { type: 'line' | 'ellipse' | 'polygon' }) {
    const w = Math.max(1, el.width * PX_PER_MM);
    const h = Math.max(1, el.height * PX_PER_MM);
    const stroke = el.borderColor ?? '#000000';
    const strokeWidth = Math.max(1, (el.borderWidth ?? DEFAULT_LINE_WIDTH) * PX_PER_MM);

    if (el.type === 'line') {
      const dash = dashArrayOf(el.borderStyle);
      const direction = el.lineDirection ?? 'horizontal';
      const [x1, y1, x2, y2] =
        direction === 'horizontal' ? [0, h / 2, w, h / 2]
        : direction === 'vertical' ? [w / 2, 0, w / 2, h]
        : direction === 'down' ? [0, 0, w, h]
        : [0, h, w, 0];
      return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        ${svg`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke=${stroke}
          stroke-width=${strokeWidth} stroke-dasharray=${dash ?? nothing} />`}
      </svg>`;
    }
    const fill = el.backgroundColor ?? 'none';
    if (el.type === 'ellipse') {
      // 곡선 테두리는 실선만 지원한다.
      return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        ${svg`<ellipse cx=${w / 2} cy=${h / 2} rx=${Math.max(0, (w - strokeWidth) / 2)}
          ry=${Math.max(0, (h - strokeWidth) / 2)} fill=${fill} stroke=${stroke}
          stroke-width=${strokeWidth} />`}
      </svg>`;
    }
    // 정다각형은 요소 영역에 내접하도록 좌표를 계산한다.
    const points = polygonPointsPx(el.sides, w, h)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      ${svg`<polygon points=${points} fill=${fill} stroke=${stroke}
        stroke-width=${strokeWidth} />`}
    </svg>`;
  }

  /**
   * 반복 구간과 샘플 값을 반영해 그리드의 캔버스 표시를 만든다.
   */
  private _renderGridElementPreview(el: GridElement) {
    const selected = el.id === this._selectedId;
    const widths = columnWidths(el);
    const heights = expandedRowHeights(el);
    const colTracks = widths.map((w) => `${w}fr`).join(' ');
    const rowTracks = heights.map((h) => `${h}fr`).join(' ');
    const lineColor = el.borderColor ?? '#000000';
    const lineWidth = el.borderWidth ?? DEFAULT_LINE_WIDTH;
    const borderCssOf = (cell?: GridCell): string => {
      const width = cell?.borderWidth ?? lineWidth;
      if (width <= 0) return 'none';
      const px = Math.max(1, Math.round(width * PX_PER_MM));
      return `${px}px ${cell?.borderStyle ?? el.borderStyle ?? 'solid'} ${cell?.borderColor ?? lineColor}`;
    };

    const repeat = el.repeat;
    const bandRows = repeat ? repeat.toRow - repeat.fromRow + 1 : 0;
    const items = this._repeatSampleItems(el);

    // 자동 병합 열에서는 연속된 반복 항목의 값이 같은 셀을 세로로 병합한다.
    const autoMergeColumns = new Set<number>();
    el.columns.forEach((column, c) => {
      if (column.autoMerge === true) autoMergeColumns.add(c);
    });
    const cellMerges = (cell: GridCell): boolean => {
      for (let c = cell.column; c < cell.column + (cell.colSpan ?? 1); c++) {
        if (autoMergeColumns.has(c)) return true;
      }
      return false;
    };

    // 원본 셀을 펼친 행 좌표로 옮기고 PDF 변환과 같은 규칙으로 자동 병합한다.
    type Placed = { cell: GridCell; row: number; rowSpan: number; item: Record<string, unknown> | undefined };
    const placed: Placed[] = [];
    for (const cell of el.cells) {
      const baseSpan = cell.rowSpan ?? 1;
      if (!repeat || cell.row < repeat.fromRow) {
        placed.push({ cell, row: cell.row, rowSpan: baseSpan, item: undefined });
      } else if (cell.row > repeat.toRow) {
        placed.push({ cell, row: cell.row + (repeat.perPage - 1) * bandRows, rowSpan: baseSpan, item: undefined });
      } else if (!cellMerges(cell)) {
        for (let i = 0; i < repeat.perPage; i++) {
          placed.push({ cell, row: cell.row + i * bandRows, rowSpan: baseSpan, item: items[i] });
        }
      } else {
        let anchor: { entry: Placed; text: string } | null = null;
        for (let i = 0; i < repeat.perPage; i++) {
          const item = items[i];
          // 자동 병합은 표시용 파라미터 이름이 아닌 실제 샘플 값을 기준으로 판단한다.
          const text = this._gridCellMergeText(cell, item);
          // 빈 값과 비어 있는 항목은 병합 범위를 종료한다.
          if (item === undefined || text === '') {
            placed.push({ cell, row: cell.row + i * bandRows, rowSpan: baseSpan, item });
            anchor = null;
            continue;
          }
          if (anchor && anchor.text === text) {
            anchor.entry.rowSpan += bandRows; // 앞 셀에 흡수 — 이 셀은 그리지 않는다
            continue;
          }
          const entry: Placed = { cell, row: cell.row + i * bandRows, rowSpan: baseSpan, item };
          placed.push(entry);
          anchor = { entry, text };
        }
      }
    }

    const boxes = placed.map(({ cell, row, rowSpan, item }) => {
      const isSelectedCell =
        selected && this._selectedCell?.row === cell.row && this._selectedCell?.column === cell.column;
      // 그리드 셀은 수직 정렬을 별도로 적용하므로 textStyleCss에서는 생략한다.
      const merged = { ...el, ...cell };
      const style = [
        `grid-area:${row + 1}/${cell.column + 1}/span ${rowSpan}/span ${cell.colSpan ?? 1}`,
        `border:${borderCssOf(cell)}`,
        `font-size:${fontPx(cell.fontSize ?? el.fontSize)}`,
        `justify-content:${justifyOf(cell.alignment ?? el.alignment)}`,
        `align-items:${verticalFlexAlign(merged.verticalAlignment)}`,
        // 세로쓰기에서 추가한 줄바꿈을 유지한다.
        cell.vertical === true ? 'white-space:pre-wrap' : '',
        cell.backgroundColor ? `background-color:${cell.backgroundColor}` : '',
        (cell.fontColor ?? el.fontColor) ? `color:${cell.fontColor ?? el.fontColor}` : '',
      ].filter(Boolean).join(';') + textStyleCss(merged, { omitVerticalAlign: true });
      return html`<div class=${isSelectedCell ? 'cell-selected' : ''} style=${style}
        >${stackVertically(this._gridCellPreviewText(cell, item), cell.vertical)}</div>`;
    });

    // 값이 없는 좌표에도 그리드선을 표시한다 (SPEC §5.7).
    const taken = new Set<string>();
    for (const { cell, row, rowSpan } of placed) {
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = cell.column; c < cell.column + (cell.colSpan ?? 1); c++) taken.add(`${r},${c}`);
      }
    }
    const blanks = [];
    for (let r = 0; r < heights.length; r++) {
      for (let c = 0; c < widths.length; c++) {
        if (taken.has(`${r},${c}`)) continue;
        const templateRow = templateRowOf(el, r);
        const blankSelected =
          selected && this._selectedCell?.row === templateRow && this._selectedCell?.column === c;
        blanks.push(html`<div class=${blankSelected ? 'cell-selected' : ''}
          style="grid-area:${r + 1}/${c + 1};border:${borderCssOf()}"></div>`);
      }
    }

    return html`<div class="grid-preview"
      style="grid-template-columns:${colTracks};grid-template-rows:${rowTracks}">${blanks}${boxes}</div>`;
  }

  /** 반복 구간에 사용할 샘플 항목 배열을 반환한다. */
  private _repeatSampleItems(el: GridElement): Record<string, unknown>[] {
    if (!el.repeat) return [];
    const sample = this._file?.template.sampleValues?.[el.repeat.parameter];
    if (!Array.isArray(sample)) return [];
    return sample
      .filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map((row) => row as unknown as Record<string, unknown>);
  }

  /** 직접 입력, 파라미터 또는 수식으로 셀의 표시 텍스트를 만든다. */
  private _gridCellPreviewText(cell: GridCell, item: Record<string, unknown> | undefined): string {
    const values = { ...(this._file?.template.sampleValues ?? {}), ...(item ?? {}) };
    if (cell.parameter !== undefined) {
      const value = values[cell.parameter];
      return value === undefined || value === null ? `{${cell.parameter}}` : String(value);
    }
    if (cell.formula !== undefined) {
      try {
        const result = evaluateFormula(cell.formula, {
          values,
          ...(this.locale === undefined ? {} : { locale: this.locale }),
        });
        return result === null ? '' : String(result);
      } catch {
        return `= ${cell.formula}`;
      }
    }
    return cell.content ?? '';
  }

  /**
   * 자동 병합 비교에 사용할 실제 셀 값을 반환한다.
   * 빈 값은 빈 문자열로 변환해 병합하지 않는다.
   */
  private _gridCellMergeText(cell: GridCell, item: Record<string, unknown> | undefined): string {
    const values = { ...(this._file?.template.sampleValues ?? {}), ...(item ?? {}) };
    if (cell.parameter !== undefined) {
      const value = values[cell.parameter];
      return value === null || value === undefined ? '' : String(value);
    }
    if (cell.formula !== undefined) {
      try {
        const result = evaluateFormula(cell.formula, {
          values,
          ...(this.locale === undefined ? {} : { locale: this.locale }),
        });
        return result === null ? '' : String(result);
      } catch {
        return '';
      }
    }
    return cell.content ?? '';
  }

  // ---------------------------------------------------------------------------
  // Render: property panel
  // ---------------------------------------------------------------------------

  /** 양식 속성을 변경하고 되돌리기 이력을 남긴다. */
  private _updateFile(fn: (file: SlipTemplateFile) => void): void {
    // 유효한 편집이 적용되면 이전 입력 오류를 지운다.
    this._resetPanelErrors();
    if (!this._file) return;
    this._pushUndo();
    fn(this._file);
    this._emitChange();
    this.requestUpdate();
  }

  /**
   * 현재 페이지의 이름, 페이지 번호, 순서를 편집하는 패널을 렌더링한다.
   *
   * @returns 페이지 설정 패널 조각
   */
  private _renderPageSettings() {
    const file = this._file!;
    const s = this._strings.designer;
    const index = this._pageIndex;
    const page = file.template.pages[index];
    if (!page) return this._renderFormSettings();
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    // 페이지 번호는 위쪽 또는 아래쪽의 왼쪽, 가운데, 오른쪽에 배치할 수 있다 (SPEC §4).
    const positions: { value: PageNumberPosition; label: string }[] = [
      { value: 'bottom-left', label: s.pagePosBottomLeft },
      { value: 'bottom-center', label: s.pagePosBottomCenter },
      { value: 'bottom-right', label: s.pagePosBottomRight },
      { value: 'top-left', label: s.pagePosTopLeft },
      { value: 'top-center', label: s.pagePosTopCenter },
      { value: 'top-right', label: s.pagePosTopRight },
    ];
    const pageNumber = page.pageNumber;

    return html`
      <div class="type-name">${s.pageSettings}</div>

      <div class="prop-section">
        <div class="prop-section-title">${s.panelBasic}</div>
        <div class="prop-row">
          <label>${s.pageName}</label>
          <input .value=${page.label ?? ''}
            placeholder=${s.pageLabel.replace('{n}', String(index + 1))}
            @change=${(e: Event) => {
              const v = valOf(e).trim();
              this._updateFile((f) => {
                const target = f.template.pages[index]!;
                if (v === '') delete target.label;
                else target.label = v;
              });
            }}>
        </div>
        <div class="prop-row">
          <label>${s.pageKey}</label>
          <input class=${this._pageKeyError ? 'error' : ''} .value=${page.key ?? ''}
            aria-invalid=${String(this._pageKeyError)}
            aria-describedby=${this._pageKeyError ? 'error-page-key' : nothing}
            @change=${(e: Event) => this._commitPageKey(index, valOf(e))}>
        </div>
        ${this._pageKeyError
          ? html`<div id="error-page-key" class="input-error field-error" role="alert">${s.keyInUse}</div>`
          : nothing}
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.panelPageNumber}</div>
        <div class="prop-row">
          <label>${s.pageNumberShow}</label>
          <input type="checkbox" aria-label=${s.pageNumberShow} .checked=${pageNumber !== undefined}
            @change=${(e: Event) => this._togglePageNumber(index, (e.target as HTMLInputElement).checked)}>
        </div>
        ${pageNumber
          ? html`
            <div class="prop-row">
              <label>${s.pageNumberPosition}</label>
              ${this._listSelect({
                id: 'page-number-position',
                ariaLabel: s.pageNumberPosition,
                value: pageNumber.position,
                options: positions,
                onPick: (value) =>
                  this._updateFile((f) => {
                    f.template.pages[index]!.pageNumber = {
                      ...f.template.pages[index]!.pageNumber!,
                      position: value as PageNumberPosition,
                    };
                  }),
              })}
            </div>`
          : nothing}
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.pageOrder}</div>
        <div class="prop-row">
          <div class="step-inputs">
            <button class="row-btn" aria-label=${s.pageMoveForward}
              ?disabled=${index === 0} @click=${() => this._movePage(-1)}>${icons.up}</button>
            <span>${index + 1} / ${this._pageCount()}</span>
            <button class="row-btn" aria-label=${s.pageMoveBackward}
              ?disabled=${index >= this._pageCount() - 1} @click=${() => this._movePage(1)}>${icons.down}</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 페이지 키를 변경한다. 빈 값은 키를 제거하고 중복 값은 적용하지 않는다(SPEC §4).
   *
   * @param index - 페이지 번호(0-기반)
   * @param raw - 입력한 물리명
   */
  private _commitPageKey(index: number, raw: string): void {
    const key = raw.trim();
    const pages = this._file?.template.pages;
    if (!pages) return;
    this._pageKeyError = false;
    if (key !== '' && pages.some((p, i) => i !== index && p.key === key)) {
      this._pageKeyError = true;
      this.requestUpdate();
      return;
    }
    this._updateFile((f) => {
      const target = f.template.pages[index]!;
      if (key === '') delete target.key;
      else target.key = key;
    });
  }

  /**
   * 페이지 번호 표시를 설정하거나 제거한다.
   *
   * @param index - 페이지 번호(0-기반)
   * @param on - 켤지 여부
   */
  private _togglePageNumber(index: number, on: boolean): void {
    this._updateFile((f) => {
      const target = f.template.pages[index]!;
      if (on) target.pageNumber = { position: 'bottom-center' };
      else delete target.pageNumber;
    });
  }

  /**
   * 폰트 선택기에 표시할 기본 폰트 이름을 수집한다.
   * Bold, Italic, BoldItalic 변형은 선택 목록에서 제외한다.
   */
  private async _loadFontNames(): Promise<void> {
    const fonts = await resolveFonts(this.settings, this.locale);
    const names = fonts
      .map((f) => f.name)
      .filter((n) => !/-(Bold|Italic|BoldItalic)$/.test(n));
    this._fontNames = [...new Set(names)];
    this.requestUpdate();
  }

  /** 호스트가 지정한 바코드 종류를 불러온다. */
  private async _loadBarcodeKinds(): Promise<void> {
    const kinds = this.settings?.getBarcodeKinds ? await this.settings.getBarcodeKinds() : [];
    this._hostBarcodeKinds = kinds ?? [];
    this.requestUpdate();
  }

  /** 바코드 선택기에 표시할 종류를 반환한다. */
  private _barcodeKinds(): readonly { value: BarcodeKind; label: string }[] {
    if (this._hostBarcodeKinds.length === 0) return BARCODE_KINDS;
    const allowed = new Set(this._hostBarcodeKinds);
    return BARCODE_KINDS.filter((k) => allowed.has(k.value));
  }

  /** 호스트가 제공하는 용지 목록을 불러온다. */
  private async _loadPaperSizes(): Promise<void> {
    const sizes = this.settings?.getPaperSizes ? await this.settings.getPaperSizes() : [];
    this._hostPaperSizes = sizes ?? [];
    this.requestUpdate();
  }

  /**
   * 현재 용지 크기를 호스트 설정에 저장하고 선택 목록을 갱신한다.
   *
   * @param name - 고르개에 보일 용지 이름
   */
  private async _savePaperSize(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || !this.settings?.savePaperSize || !this._file) return;
    const { paper } = this._file.template;
    await this.settings.savePaperSize({ name: trimmed, width: paper.width, height: paper.height });
    this._paperSaveName = '';
    // 저장된 용지가 선택 목록에 포함되도록 다시 불러온다.
    await this._loadPaperSizes();
  }

  /**
   * 양식 제목, 용지 크기, 방향, 여백을 편집하는 패널을 렌더링한다.
   * 방향과 프리셋은 파일에 별도로 저장하지 않고 용지 너비와 높이에 반영한다.
   *
   * @returns 양식 설정 패널 조각
   */
  private _renderFormSettings() {
    const file = this._file!;
    const s = this._strings.designer;
    const { paper } = file.template;
    const [pt, pr, pb, pl] = paper.padding;
    const landscape = paper.width > paper.height;
    // 기본 용지 뒤에 호스트가 제공한 용지를 추가한다.
    const allSizes: PaperSize[] = [...PAPER_PRESETS, ...this._hostPaperSizes];
    // 현재 크기와 방향을 제외하고 일치하는 용지를 찾는다.
    const presetIndex = allSizes.findIndex(
      (p) =>
        (p.width === paper.width && p.height === paper.height) ||
        (p.width === paper.height && p.height === paper.width),
    );
    // 목록에 없는 크기이며 저장 함수가 있으면 사용자 지정 용지 저장 기능을 표시한다.
    const canSaveSize = presetIndex < 0 && this.settings?.savePaperSize !== undefined;

    // 본문 영역이 남지 않는 용지 크기는 적용하지 않는다.
    const setSize = (width: number, height: number, errorKey = 'paper-size'): void => {
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        this._rejectInput(s.numberInput, errorKey);
        return;
      }
      if (width <= pl + pr || height <= pt + pb) {
        this._rejectInput(s.paperAreaError, errorKey);
        return;
      }
      this._updateFile((f) => {
        f.template.paper.width = round1(width);
        f.template.paper.height = round1(height);
      });
    };
    const setPadding = (index: 0 | 1 | 2 | 3, value: number): void => {
      const errorKey = `paper-margin-${index}`;
      if (Number.isNaN(value) || value < 0) {
        this._rejectInput(Number.isNaN(value) ? s.numberInput : s.nonNegativeInput, errorKey);
        return;
      }
      const next = [...paper.padding] as [number, number, number, number];
      next[index] = round1(value);
      if (next[3] + next[1] >= paper.width || next[0] + next[2] >= paper.height) {
        this._rejectInput(s.marginAreaError, errorKey);
        return;
      }
      this._updateFile((f) => {
        f.template.paper.padding = next;
      });
    };
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);

    return html`
      <div class="type-name">${s.formSettings}</div>

      <div class="prop-section">
        <div class="prop-section-title">${s.panelBasic}</div>
        <div class="prop-row">
          <label>${s.formTitle}</label>
          <input .value=${file.template.meta.title}
                 aria-invalid=${String(this._hasInputError('form-title'))}
                 aria-describedby=${this._hasInputError('form-title') ? 'error-form-title' : nothing}
                 @change=${(e: Event) => {
                   const v = (e.target as HTMLInputElement).value.trim();
                   // 빈 제목은 스키마에서 허용하지 않는다.
                   if (!v) {
                     this._rejectInput(s.requiredInput, 'form-title');
                     return;
                   }
                   this._updateFile((f) => { f.template.meta.title = v; });
                 }}>
        </div>
        ${this._renderInputError('form-title')}
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.panelPaper}</div>
        <div class="prop-row">
          <label>${s.paperSize}</label>
          ${this._listSelect({
            id: 'paper-size',
            ariaLabel: s.paperSize,
            value: presetIndex >= 0 ? String(presetIndex) : 'custom',
            options: [
              ...allSizes.map((p, i) => ({ value: String(i), label: `${p.name} (${p.width}×${p.height})` })),
              { value: 'custom', label: s.paperCustom },
            ],
            onPick: (v) => {
              if (v === 'custom') return;
              const p = allSizes[Number(v)]!;
              // 세로 기준 프리셋을 현재 용지 방향에 맞춰 적용한다.
              setSize(landscape ? p.height : p.width, landscape ? p.width : p.height);
            },
          })}
        </div>
        ${canSaveSize
          ? html`
            <div class="prop-row">
              <label>${s.paperSaveThis}</label>
              <input class="paper-save-name" .value=${this._paperSaveName}
                     placeholder=${s.paperSizeName}
                     aria-label=${s.paperSizeName}
                     @input=${(e: Event) => { this._paperSaveName = (e.target as HTMLInputElement).value; }}>
              <button class="row-btn" title=${s.paperSaveThis} aria-label=${s.paperSaveThis}
                ?disabled=${this._paperSaveName.trim() === ''}
                @click=${() => void this._savePaperSize(this._paperSaveName)}>${icons.save}</button>
            </div>`
          : nothing}
        <div class="prop-pair">
          <div class="prop-row">
            <label>${s.width}</label>
            <input type="number" step="0.5" min="1" .value=${String(paper.width)}
                   aria-invalid=${String(this._hasInputError('paper-width'))}
                   aria-describedby=${this._hasInputError('paper-width') ? 'error-paper-width' : nothing}
                   @change=${(e: Event) => setSize(numOf(e), paper.height, 'paper-width')}>
          </div>
          <div class="prop-row">
            <label>${s.height}</label>
            <input type="number" step="0.5" min="1" .value=${String(paper.height)}
                   aria-invalid=${String(this._hasInputError('paper-height'))}
                   aria-describedby=${this._hasInputError('paper-height') ? 'error-paper-height' : nothing}
                   @change=${(e: Event) => setSize(paper.width, numOf(e), 'paper-height')}>
          </div>
        </div>
        ${this._renderInputError('paper-width')}
        ${this._renderInputError('paper-height')}
        ${this._renderInputError('paper-size')}
        <div class="prop-row">
          <label>${s.orientation}</label>
          <div class="toggle-group text" role="group" aria-label=${s.orientation}>
            ${([
              [false, s.portrait],
              [true, s.landscape],
            ] as const).map(([toLandscape, label]) => html`
              <button title=${label} aria-label="${s.orientation}: ${label}"
                aria-pressed=${String(landscape === toLandscape)}
                @click=${() => {
                  if (landscape === toLandscape) return;
                  setSize(paper.height, paper.width);
                }}>${label}</button>`)}
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.margin}</div>
        <div class="prop-pair">
          <div class="prop-row">
            <label>${s.marginTop}</label>
            <input type="number" step="1" min="0" .value=${String(pt)}
                   aria-invalid=${String(this._hasInputError('paper-margin-0'))}
                   aria-describedby=${this._hasInputError('paper-margin-0') ? 'error-paper-margin-0' : nothing}
                   @change=${(e: Event) => setPadding(0, numOf(e))}>
          </div>
          <div class="prop-row">
            <label>${s.marginRight}</label>
            <input type="number" step="1" min="0" .value=${String(pr)}
                   aria-invalid=${String(this._hasInputError('paper-margin-1'))}
                   aria-describedby=${this._hasInputError('paper-margin-1') ? 'error-paper-margin-1' : nothing}
                   @change=${(e: Event) => setPadding(1, numOf(e))}>
          </div>
        </div>
        ${this._renderInputError('paper-margin-0')}
        ${this._renderInputError('paper-margin-1')}
        <div class="prop-pair">
          <div class="prop-row">
            <label>${s.marginBottom}</label>
            <input type="number" step="1" min="0" .value=${String(pb)}
                   aria-invalid=${String(this._hasInputError('paper-margin-2'))}
                   aria-describedby=${this._hasInputError('paper-margin-2') ? 'error-paper-margin-2' : nothing}
                   @change=${(e: Event) => setPadding(2, numOf(e))}>
          </div>
          <div class="prop-row">
            <label>${s.marginLeft}</label>
            <input type="number" step="1" min="0" .value=${String(pl)}
                   aria-invalid=${String(this._hasInputError('paper-margin-3'))}
                   aria-describedby=${this._hasInputError('paper-margin-3') ? 'error-paper-margin-3' : nothing}
                   @change=${(e: Event) => setPadding(3, numOf(e))}>
          </div>
        </div>
        ${this._renderInputError('paper-margin-2')}
        ${this._renderInputError('paper-margin-3')}
      </div>
    `;
  }

  /** 요소의 기본 좌표 기준점을 반환한다. 선은 왼쪽 가운데를 사용한다. */
  private _defaultAnchorIndex(el: SlipElement): number {
    return el.type === 'line' ? 3 : 0;
  }

  private _renderAnchorRow(el: SlipElement) {
    const s = this._strings.designer;
    const current = this._anchorByElement.get(el.id) ?? this._defaultAnchorIndex(el);
    const elementId = el.id;
    return html`
      <div class="prop-row">
        <label>${s.anchor}</label>
        <div class="anchor-grid" role="group" aria-label=${s.anchor}>
          ${ANCHORS.map((a, i) => html`
            <button class="anchor-dot" title=${s[a.key]} aria-label="${s.anchor}: ${s[a.key]}"
              aria-pressed=${String(i === current)}
              @click=${() => {
                this._anchorByElement.set(elementId, i);
                this.requestUpdate();
              }}></button>`)}
        </div>
      </div>
    `;
  }

  /**
   * 다중 선택한 요소를 그룹화하거나 그룹에서 해제하는 패널을 렌더링한다.
   */
  private _renderGroupPanel() {
    const s = this._strings.designer;
    const els = [...this._selectedIds]
      .map((id) => this._findElement(id))
      .filter((el): el is SlipElement => el !== undefined);
    const groups = new Set(els.map((el) => el.group));
    const allSameGroup = els.length > 0 && groups.size === 1 && !groups.has(undefined);
    const anyGrouped = els.some((el) => el.group !== undefined);
    return html`
      <div class="type-name">${s.groupSelection}</div>
      <div class="prop-section">
        <div class="prop-section-title">${s.panelBasic}</div>
        <div class="prop-row">
          <label>${s.selectedCount}</label>
          <span>${els.length}</span>
        </div>
        <div class="group-actions">
          ${allSameGroup
            ? nothing
            : html`<button class="btn primary" @click=${() => this._groupSelected()}>
                ${s.groupElements}</button>`}
          ${anyGrouped
            ? html`<button class="btn" @click=${() => this._ungroupSelected()}>
                ${s.ungroupElements}</button>`
            : nothing}
        </div>
      </div>
    `;
  }

  /** 선택한 요소에 같은 그룹 ID를 지정한다. */
  private _groupSelected(): void {
    if (this._selectedIds.size < 2) return;
    const ids = new Set(this._selectedIds);
    const gid = `grp-${crypto.randomUUID().slice(0, 8)}`;
    this._updateFile((f) => {
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (ids.has(el.id)) el.group = gid;
        }
      }
    });
  }

  /** 선택한 요소가 속한 그룹을 해제한다. */
  private _ungroupSelected(): void {
    const groups = new Set<string>();
    for (const id of this._selectedIds) {
      const g = this._findElement(id)?.group;
      if (g !== undefined) groups.add(g);
    }
    if (groups.size === 0) return;
    this._updateFile((f) => {
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.group !== undefined && groups.has(el.group)) delete el.group;
        }
      }
    });
  }

  private _renderPropertyPanel() {
    // 선택 대상에 따라 페이지, 파라미터, 그룹 또는 요소 패널을 표시한다.
    const sel = this._sideSelection;
    if (sel?.kind === 'parameter') return this._renderParameterPanel(sel.key);
    if (sel?.kind === 'parameterField') return this._renderParameterFieldPanel(sel.key, sel.field);
    if (sel?.kind === 'page') return this._renderPageSettings();

    // 여러 요소가 선택되면 그룹 패널을 표시한다.
    if (this._selectedIds.size > 1) return this._renderGroupPanel();

    const el = this._findSelectedElement();
    if (!el) {
      return this._renderFormSettings();
    }

    const s = this._strings.designer;
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    const anchor =
      ANCHORS[this._anchorByElement.get(el.id) ?? this._defaultAnchorIndex(el)] ?? ANCHORS[0];
    const selectedCell = el.type === 'grid' ? this._selectedCell : null;
    const cellInRepeat = selectedCell !== null && el.type === 'grid' && el.repeat !== undefined
      && selectedCell.row >= el.repeat.fromRow && selectedCell.row <= el.repeat.toRow;

    return html`
      <div class="type-name">
        ${selectedCell === null
          ? this._typeName(el.type)
          : `${s.cell} (${selectedCell.row + 1}, ${selectedCell.column + 1})`}
        ${cellInRepeat ? html`<span class="cell-band">${s.repeatCellHint}</span>` : nothing}
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.panelLayout}</div>
        <div class="prop-row">
          <label>${s.name}</label>
          <input .value=${el.name}
                 @change=${(e: Event) => this._updateElement((el) => { el.name = valOf(e); })}>
        </div>
        ${this._renderAnchorRow(el)}
        <div class="prop-pair">
          <div class="prop-row">
            <label>X</label>
            <input type="number" step="0.5" .value=${String(round1(el.position.x + anchor.ax * el.width))}
                   aria-invalid=${String(this._hasInputError('element-x'))}
                   aria-describedby=${this._hasInputError('element-x') ? 'error-element-x' : nothing}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isFinite(v)) {
                       this._rejectInput(s.numberInput, 'element-x');
                       return;
                     }
                     // 입력한 기준점 좌표를 파일의 왼쪽 위 좌표로 변환한다.
                     this._updateElement((el) => {
                       el.position.x = Math.max(0, round1(v - anchor.ax * el.width));
                     });
                   }}>
          </div>
          <div class="prop-row">
            <label>Y</label>
            <input type="number" step="0.5" .value=${String(round1(el.position.y + anchor.ay * el.height))}
                   aria-invalid=${String(this._hasInputError('element-y'))}
                   aria-describedby=${this._hasInputError('element-y') ? 'error-element-y' : nothing}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isFinite(v)) {
                       this._rejectInput(s.numberInput, 'element-y');
                       return;
                     }
                     this._updateElement((el) => {
                       el.position.y = Math.max(0, round1(v - anchor.ay * el.height));
                     });
                   }}>
          </div>
        </div>
        ${this._renderInputError('element-x')}
        ${this._renderInputError('element-y')}
        ${this._renderSizeRows(el)}
      </div>

      ${this._renderTypeProps(el)}
      ${el.type === 'grid' && this._selectedCell !== null ? nothing : this._renderStyleGroups(el)}
    `;
  }

  /**
   * 요소 크기 입력을 렌더링한다.
   * 선은 너비와 높이 대신 길이, 각도, 선 굵기로 편집한다.
   */
  private _renderSizeRows(el: SlipElement) {
    const s = this._strings.designer;
    const setSize = (key: 'width' | 'height') => (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      const errorKey = `element-${key}`;
      if (!Number.isFinite(v) || v < 1) {
        const message = !Number.isFinite(v)
          ? s.numberInput
          : s.minimumInput.replace('{min}', '1');
        this._rejectInput(message, errorKey);
        return;
      }
      this._updateElement((target) => { target[key] = v; });
    };
    const sizeRow = (label: string, key: 'width' | 'height') => {
      const errorKey = `element-${key}`;
      return html`
        <div class="prop-row">
          <label>${label}</label>
          <input type="number" step="0.5" min="1" .value=${String(el[key])}
                 aria-label=${label}
                 aria-invalid=${String(this._hasInputError(errorKey))}
                 aria-describedby=${this._hasInputError(errorKey) ? `error-${errorKey}` : nothing}
                 @change=${setSize(key)}>
        </div>
        ${this._renderInputError(errorKey)}`;
    };

    // 모든 선 방향에 같은 길이, 각도, 굵기 입력을 사용한다.
    if (el.type === 'line') {
      const { length, angle } = lineLengthAngle(el);
      return html`
        <div class="prop-pair">
          ${this._renderDefaultedNumberRow(
            s.length, Number(length.toFixed(1)), length,
            (v) => this._applyLineLengthAngle(v ?? length, angle),
            { step: '0.5', min: '0', errorKey: 'line-length' },
          )}
          ${this._renderDefaultedNumberRow(
            s.lineAngle, Number(angle.toFixed(1)), angle,
            (v) => this._applyLineLengthAngle(length, v ?? angle),
            { step: '1', errorKey: 'line-angle' },
          )}
        </div>
        ${this._renderBorderWidthSelect(
          el.borderWidth,
          DEFAULT_LINE_WIDTH,
          false,
          'borderWidth',
          (v) => this._updateElement((target) => {
            (target as Record<string, unknown>).borderWidth = v;
          }),
          s.lineWidth,
        )}`;
    }
    return html`
      <div class="prop-pair">
        ${sizeRow(s.width, 'width')}
        ${sizeRow(s.height, 'height')}
      </div>`;
  }

  /**
   * 목록 하위 필드의 키, 레이블, 값 종류와 사용 위치를 표시하는 패널을 렌더링한다.
   *
   * @param listKey - 목록 파라미터 물리명
   * @param fieldKey - 하위 필드 물리명
   * @returns 하위 필드 편집 조각
   */
  private _renderParameterFieldPanel(listKey: string, fieldKey: string) {
    const s = this._strings.designer;
    const parent = this._parameterList().find((b) => b.key === listKey);
    const info = parent?.fields.find((f) => f.key === fieldKey);
    if (!parent || !info) return this._renderFormSettings();
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="type-name">${s.parameterField}</div>
      <div class="prop-section">
        <div class="prop-section-title">${s.panelBasic}</div>
        <div class="prop-row">
          <label>${s.parameterParent}</label>
          <button class="usage-row parent-row" @click=${() => this._selectParameter(listKey)}>
            ${valueTypeBadge(parent.valueType)}<span>${parent.label}</span>
          </button>
        </div>
        <div class="prop-row">
          <label>${s.parameterKey}</label>
          <input class="parameter-key-input" .value=${info.key}
            aria-invalid=${String(this._parameterKeyError || this._hasInputError('parameter-key'))}
            aria-describedby=${this._parameterKeyError || this._hasInputError('parameter-key')
              ? 'error-parameter-key' : nothing}
            @change=${(e: Event) =>
              this._renameParameterField(listKey, info.key, valOf(e), e.target as HTMLInputElement)}>
        </div>
        ${this._parameterKeyError
          ? html`<div id="error-parameter-key" class="input-error field-error" role="alert">${s.keyInUse}</div>`
          : this._renderInputError('parameter-key')}
        <div class="prop-row">
          <label>${s.parameterLabel}</label>
          <input .value=${info.rawLabel ?? ''} placeholder=${info.key}
            @change=${(e: Event) => this._updateParameterField(listKey, info.key, { label: valOf(e) })}>
        </div>
        <div class="prop-row">
          <label>${s.parameterValueType}</label>
          ${this._listSelect({
            id: 'field-value-type',
            ariaLabel: s.parameterValueType,
            value: info.valueType ?? '',
            options: BINDING_FIELD_VALUE_TYPES.map((t) => ({ value: t.value, label: s[t.stringKey] })),
            onPick: (value) => this._updateParameterField(listKey, info.key, { valueType: value }),
          })}
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.parameterUsage}</div>
        ${info.at === undefined
          ? html`<div class="side-empty">${s.parameterUnused}</div>`
          : html`
            <button class="usage-row"
              @click=${() => this._selectGridCellAt(info.at!)}>
              ${TYPE_BADGE.grid}<span>${s.cell} (${info.at.row + 1}, ${info.at.column + 1})</span>
              <span class="usage-page">${s.sidebarPages} ${info.at.pageIndex + 1}</span>
            </button>`}
      </div>
    `;
  }

  /** 하위 필드를 사용하는 그리드 셀로 이동한다. */
  private _selectGridCellAt(at: { pageIndex: number; gridId: string; row: number; column: number }): void {
    this._resetPanelErrors();
    this._goToPage(at.pageIndex);
    this._selectedId = at.gridId;
    this._selectedIds = new Set([at.gridId]);
    this._selectedCell = { row: at.row, column: at.column };
    this._cellEditing = false;
    this._sideSelection = null;
    this._expandedElements.add(at.gridId);
    this.requestUpdate();
  }

  private _renderParameterPanel(key: string) {
    const s = this._strings.designer;
    const info = this._parameterList().find((b) => b.key === key);
    if (!info) return this._renderFormSettings();
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="type-name">${s.sidebarParameters}</div>

      <div class="prop-section">
        <div class="prop-section-title">${s.panelBasic}</div>
        <div class="prop-row">
          <label>${s.parameterKey}</label>
          <input class="parameter-key-input" .value=${info.key}
            aria-invalid=${String(this._parameterKeyError || this._hasInputError('parameter-key'))}
            aria-describedby=${this._parameterKeyError || this._hasInputError('parameter-key')
              ? 'error-parameter-key' : nothing}
            @change=${(e: Event) =>
              this._renameParameterKey(info.key, valOf(e), e.target as HTMLInputElement)}>
        </div>
        ${this._parameterKeyError
          ? html`<div id="error-parameter-key" class="input-error field-error" role="alert">${s.keyInUse}</div>`
          : this._renderInputError('parameter-key')}
        <div class="prop-row">
          <label>${s.parameterLabel}</label>
          <input class="parameter-label-input" .value=${info.rawLabel ?? ''} placeholder=${info.key}
            @change=${(e: Event) => this._commitParameterLabel(info.key, valOf(e))}>
        </div>
        <div class="prop-row">
          <label>${s.parameterValueType}</label>
          ${this._listSelect({
            id: 'parameter-value-type',
            ariaLabel: s.parameterValueType,
            value: info.valueType ?? '',
            options: BINDING_VALUE_TYPES.map((t) => ({ value: t.value, label: s[t.stringKey] })),
            onPick: (value) => this._setParameterValueType(info.key, value),
          })}
        </div>
      </div>

      ${info.valueType === 'list'
        ? html`
          <div class="prop-section">
            <div class="prop-section-title">${s.parameterFields}</div>
            ${info.fields.length === 0
              ? html`<div class="side-empty">${s.parameterFieldsEmpty}</div>`
              : info.fields.map((f) => html`
                  <button class="usage-row field-row" title="${info.key}.${f.key}"
                    @click=${() => this._selectParameterField(info.key, f)}>
                    ${valueTypeBadge(f.valueType)}<span>${f.title}</span>
                  </button>`)}
            <button class="prop-add-row" @click=${() => this._addParameterField(info.key)}>
              ${icons.add}<span>${s.addParameterField}</span>
            </button>
          </div>`
        : nothing}

      <div class="prop-section">
        <div class="prop-section-title">${s.parameterUsage}</div>
        ${info.uses.length === 0
          ? html`<div class="side-empty">${s.parameterUnused}</div>`
          : info.uses.map((u) => html`
              <button class="usage-row" title=${u.name}
                @click=${() => this._selectFromSidebar(u.pageIndex, u.id)}>
                ${TYPE_BADGE[u.type]}<span>${u.name}</span>
                <span class="usage-page">${s.sidebarPages} ${u.pageIndex + 1}</span>
              </button>`)}
      </div>
    `;
  }

  /**
   * 그리드 셀의 파라미터 선택기를 렌더링한다.
   * 반복 구간 안에서는 목록 하위 필드를, 밖에서는 목록이 아닌 최상위 파라미터를 표시한다.
   *
   * @param el - 대상 그리드
   * @param current - 현재 셀에 설정된 값 키
   * @param inBand - 이 셀이 반복 구간 안인지
   * @returns 값 선택 조각
   */
  private _gridCellParameterSelect(el: GridElement, current: string, inBand: boolean) {
    const s = this._strings.designer;
    const all = this._parameterList();
    const listKey = el.repeat?.parameter;
    const options = inBand
      ? (all.find((b) => b.key === listKey)?.fields ?? []).map((f) => ({ key: f.key, label: f.title }))
      : all.filter((b) => b.valueType !== 'list').map((b) => ({ key: b.key, label: b.label }));
    // 정의에 없는 기존 키도 현재 선택값으로 표시한다.
    if (current && !options.some((o) => o.key === current)) {
      options.unshift({ key: current, label: current });
    }
    const canAdd = !inBand || listKey !== undefined;
    return this._listSelect({
      id: 'grid-cell-parameter',
      ariaLabel: s.parameter,
      value: current,
      options: [
        { value: '', label: s.parameterUnpicked },
        ...options.map((o) => ({ value: o.key, label: o.label })),
        ...(canAdd
          ? [{ value: NEW_BINDING_OPTION, label: inBand ? s.addParameterField : s.parameterNew }]
          : []),
      ],
      onPick: (v) => {
        if (v === NEW_BINDING_OPTION) {
          if (inBand) { if (listKey) this._addParameterFieldForCell(listKey); }
          else this._newParameterForCell();
          return;
        }
        this._setGridCellSource('parameter', v);
      },
    });
  }

  /** 목록 하위 필드를 추가하고 현재 반복 셀에 연결한다. */
  private _addParameterFieldForCell(listKey: string): void {
    const before = new Set((this._parameterList().find((b) => b.key === listKey)?.fields ?? []).map((f) => f.key));
    const cell = this._selectedCell;
    this._addParameterField(listKey);
    const created = (this._parameterList().find((b) => b.key === listKey)?.fields ?? [])
      .find((f) => !before.has(f.key));
    // 하위 필드 편집 후 원래 셀 선택을 복원한다.
    this._sideSelection = null;
    this._selectedCell = cell;
    if (created) this._setGridCellSource('parameter', created.key);
  }

  /** 새 최상위 파라미터를 만들고 현재 셀에 연결한다. */
  private _newParameterForCell(): void {
    const cell = this._selectedCell;
    const { key, label } = this._nextParameter();
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      defs.push({ key, label });
      f.template.parameters = defs;
    });
    this._selectedCell = cell;
    this._setGridCellSource('parameter', key);
  }

  /** 기존 파라미터 선택과 새 파라미터 추가를 제공하는 공통 선택기를 렌더링한다. */
  private _parameterSelect(current: string, onNew: () => void, onPick: (value: string) => void) {
    const s = this._strings.designer;
    const list = this._parameterList();
    return html`
      <div class="prop-row">
        <label>${s.parameter}</label>
        ${this._listSelect({
          id: 'parameter-select',
          ariaLabel: s.parameter,
          value: current,
          className: 'parameter-select',
          options: [
            ...list.map((b) => ({ value: b.key, label: b.label })),
            { value: NEW_BINDING_OPTION, label: s.parameterNew },
          ],
          onPick: (value) => {
            if (value === NEW_BINDING_OPTION) onNew();
            else onPick(value);
          },
        })}
      </div>
    `;
  }

  private _renderParameterSelect(current: string) {
    return this._parameterSelect(
      current,
      () => this._assignNewParameter(),
      (value) => this._updateElement((el) => {
        if (el.type === 'field') el.parameter = value;
      }),
    );
  }

  /** 새 파라미터를 만들고 선택한 필드 요소에 연결한다. */
  private _assignNewParameter(): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'field') {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextParameter();
    const id = el.id;
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      defs.push({ key, label });
      f.template.parameters = defs;
      for (const page of f.template.pages) {
        for (const target of page.elements) {
          if (target.id === id && target.type === 'field') {
            // 필드는 파라미터와 수식 중 하나만 사용한다.
            delete (target as Record<string, unknown>).formula;
            target.parameter = key;
          }
        }
      }
    });
  }

  /** 사용하지 않은 기본 파라미터 키와 레이블을 만든다. */
  private _nextParameter(): { key: string; label: string } {
    const used = new Set(this._parameterList().map((b) => b.key));
    let n = 1;
    while (used.has(`value${n}`)) n += 1;
    return { key: `value${n}`, label: `${this._strings.designer.newParameterName} ${n}` };
  }

  /**
   * 이미지 요소를 고정 이미지와 파라미터 이미지 사이에서 전환한다.
   * 전환할 때 반대쪽 소스를 제거하고 파라미터 이미지에는 새 이미지 파라미터를 연결한다.
   *
   * @param variable - true면 변동(parameter), false면 고정(src)
   */
  private _setImageVariable(variable: boolean): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'image') {
      this._rejectInput();
      return;
    }
    const id = el.id;
    if (variable) {
      if (el.parameter !== undefined) return;
      const { key, label } = this._nextParameter();
      this._updateFile((f) => {
        const defs = f.template.parameters ?? [];
        // 이미지 파라미터로 등록해 작성 폼과 샘플 편집기에 파일 입력을 표시한다.
        defs.push({ key, label, valueType: 'image' });
        f.template.parameters = defs;
        for (const page of f.template.pages) {
          for (const target of page.elements) {
            if (target.id === id && target.type === 'image') {
              target.parameter = key;
              delete target.src;
            }
          }
        }
      });
    } else {
      this._updateFile((f) => {
        for (const page of f.template.pages) {
          for (const target of page.elements) {
            if (target.id === id && target.type === 'image') {
              delete target.parameter;
              target.src = PLACEHOLDER_IMG;
            }
          }
        }
      });
    }
  }

  /** 변동 이미지에 연결할 파라미터 선택기를 렌더링한다. */
  private _renderImageParameterSelect(current: string) {
    return this._parameterSelect(
      current,
      () => this._assignNewImageParameter(),
      (value) => {
        this._updateFile((f) => {
          for (const page of f.template.pages) {
            for (const target of page.elements) {
              if (target.id === this._selectedId && target.type === 'image') {
                target.parameter = value;
                delete target.src;
              }
            }
          }
        });
        this._ensureParameterDef(value, 'image');
      },
    );
  }

  /** 새 이미지 파라미터를 만들고 선택한 이미지 요소에 연결한다. */
  private _assignNewImageParameter(): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'image') {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextParameter();
    const id = el.id;
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      defs.push({ key, label, valueType: 'image' });
      f.template.parameters = defs;
      for (const page of f.template.pages) {
        for (const target of page.elements) {
          if (target.id === id && target.type === 'image') {
            target.parameter = key;
            delete target.src;
          }
        }
      }
    });
  }

  /**
   * 바코드의 값 소스를 선택하고 다른 값 소스를 제거한다 (SPEC §5.6).
   * 파라미터 소스를 선택하면 새 파라미터를 만들어 연결한다.
   *
   * @param kind - 고를 값 종류
   */
  private _chooseBarcodeSource(kind: 'content' | 'parameter' | 'formula'): void {
    if (kind === 'parameter') {
      this._assignNewBarcodeParameter();
      return;
    }
    this._updateElement((element) => {
      if (element.type !== 'barcode') return;
      const r = element as Record<string, unknown>;
      clearValueSources(r);
      r[kind] = '';
    });
  }

  /**
   * 바코드의 직접 입력 또는 수식을 설정하고 다른 값 소스를 제거한다.
   *
   * @param kind - `content` 또는 `formula`
   * @param value - 넣을 문자열 (빈 값이어도 그 소스는 유지한다)
   */
  private _setBarcodeSource(kind: 'content' | 'formula', value: string): void {
    this._updateElement((element) => {
      if (element.type !== 'barcode') return;
      const r = element as Record<string, unknown>;
      clearValueSources(r);
      r[kind] = value;
    });
  }

  /** 바코드에 연결할 파라미터 선택기를 렌더링한다. */
  private _renderBarcodeParameterSelect(current: string) {
    return this._parameterSelect(
      current,
      () => this._assignNewBarcodeParameter(),
      (value) => {
        this._updateElement((element) => {
          if (element.type !== 'barcode') return;
          const r = element as Record<string, unknown>;
          delete r.content;
          delete r.formula;
          r.parameter = value;
        });
        this._ensureParameterDef(value);
      },
    );
  }

  /** 새 파라미터를 만들고 선택한 바코드 요소에 연결한다. */
  private _assignNewBarcodeParameter(): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'barcode') {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextParameter();
    const id = el.id;
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      defs.push({ key, label });
      f.template.parameters = defs;
      for (const page of f.template.pages) {
        for (const target of page.elements) {
          if (target.id === id && target.type === 'barcode') {
            const r = target as Record<string, unknown>;
            delete r.content;
            delete r.formula;
            r.parameter = key;
          }
        }
      }
    });
  }

  /**
   * 고정 바코드 값이 종류별 형식에 맞는지 검사한다.
   * 길이가 정해진 종류와 CODE39만 검사한다.
   *
   * @param kind - 바코드 종류
   * @param content - 검사할 고정 값
   * @returns 경고 문구 또는 null
   */
  private _barcodeContentWarning(kind: BarcodeKind, content: string): string | null {
    const s = this._strings.designer;
    if (content === '') return null;
    const digits = BARCODE_DIGIT_RULES[kind];
    if (digits !== undefined && !new RegExp(`^\\d{${digits}}$`).test(content)) {
      const name = BARCODE_KINDS.find((k) => k.value === kind)?.label ?? kind;
      return s.barcodeWarnDigits.replace('{name}', name).replace('{n}', String(digits));
    }
    if (kind === 'code39' && !/^[A-Z0-9\-.$/+% ]+$/.test(content)) {
      return s.barcodeWarnCode39;
    }
    return null;
  }

  private _typeName(type: SlipElement['type']): string {
    const s = this._strings.designer;
    const map: Record<SlipElement['type'], string> = {
      text: s.typeText,
      grid: s.typeGrid,
      image: s.typeImage,
      line: s.shapeLine,
      rect: s.shapeRect,
      ellipse: s.shapeEllipse,
      polygon: s.shapePolygon,
      field: s.typeField,
      barcode: s.typeBarcode,
    };
    return map[type];
  }

  // ---------------------------------------------------------------------------
  // Render: type-specific props
  // ---------------------------------------------------------------------------

  private _renderTypeProps(el: SlipElement) {
    switch (el.type) {
      case 'text':
        return this._renderTextProps(el);
      case 'field':
        return this._renderFieldProps(el);
      case 'barcode':
        return this._renderBarcodeProps(el);
      case 'line':
        return this._renderLineProps(el);
      case 'polygon':
        return this._renderPolygonProps(el);
      case 'grid':
        return this._renderGridProps(el);
      case 'image':
        return this._renderImageProps(el);
      default:
        return nothing;
    }
  }

  /** 텍스트 요소의 내용을 편집하는 패널을 렌더링한다. */
  private _renderTextProps(el: TextElement) {
    const s = this._strings.designer;
    return html`
      <div class="prop-section">
        <div class="prop-section-title">${s.panelValue}</div>
        ${this._renderTextFieldKindRow('text')}
        <div class="prop-row stacked">
          <label>${s.content}</label>
          <textarea rows="3" .value=${el.content}
            @change=${(e: Event) => this._updateElement((el) => {
              if (el.type === 'text') el.content = (e.target as HTMLTextAreaElement).value;
            })}></textarea>
        </div>
      </div>
    `;
  }

  /**
   * 텍스트와 필드 요소 사이를 전환하는 입력을 렌더링한다.
   *
   * @param current - 현재 요소 종류
   * @returns 종류 전환 조각
   */
  private _renderTextFieldKindRow(current: 'text' | 'field') {
    const s = this._strings.designer;
    return html`
      <div class="prop-row">
        <label>${s.elementKind}</label>
        <div class="toggle-group text" role="group" aria-label=${s.elementKind}>
          ${([['text', s.typeText], ['field', s.typeField]] as const).map(([kind, label]) => html`
            <button aria-pressed=${String(current === kind)}
              @click=${() => this._convertTextField(kind)}>${label}</button>`)}
        </div>
      </div>`;
  }

  /**
   * 위치, 크기, 글자 스타일을 유지하며 텍스트와 필드 요소를 전환한다.
   * 필드로 전환할 때는 새 파라미터를 연결하고 텍스트로 전환할 때는 빈 내용을 사용한다.
   *
   * @param to - 바꿀 종류
   */
  private _convertTextField(to: 'text' | 'field'): void {
    const el = this._findSelectedElement();
    if (!el || (el.type !== 'text' && el.type !== 'field') || el.type === to) return;
    if (to === 'field') {
      // 필드에 필요한 새 파라미터를 만들어 연결한다.
      const { key, label } = this._nextParameter();
      const id = el.id;
      this._updateFile((f) => {
        const defs = f.template.parameters ?? [];
        defs.push({ key, label });
        f.template.parameters = defs;
        for (const page of f.template.pages) {
          for (const target of page.elements) {
            if (target.id !== id || target.type !== 'text') continue;
            const r = target as Record<string, unknown>;
            delete r.content;
            delete r.formula;
            r.type = 'field';
            r.parameter = key;
          }
        }
      });
      return;
    }
    this._updateElement((target) => {
      const r = target as Record<string, unknown>;
      delete r.parameter;
      delete r.formula;
      r.type = 'text';
      r.content = '';
    });
  }

  /** 필드 요소의 값 소스를 편집하는 패널을 렌더링한다. */
  private _renderFieldProps(el: FieldElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    // 필드는 파라미터와 수식 중 하나만 값 소스로 사용한다.
    const source: 'parameter' | 'formula' = el.formula !== undefined ? 'formula' : 'parameter';
    return html`
      <div class="prop-section">
        <div class="prop-section-title">${s.panelValue}</div>
        ${this._renderTextFieldKindRow('field')}
        <div class="prop-row">
          <label>${s.cellSource}</label>
          ${this._listSelect({
            id: 'field-source',
            ariaLabel: s.cellSource,
            value: source,
            options: [
              { value: 'parameter', label: s.cellSourceParameter },
              { value: 'formula', label: s.cellSourceFormula },
            ],
            onPick: (value) => this._setFieldSource(value as 'parameter' | 'formula'),
          })}
        </div>
        ${source === 'parameter'
          ? this._renderParameterSelect(el.parameter ?? '')
          : html`
            <div class="prop-row">
              <label>${s.formula}</label>
              <input .value=${live(el.formula ?? '')}
                @change=${(e: Event) => this._updateElement((target) => {
                  if (target.type !== 'field') return;
                  setOptional(target, 'formula', valOf(e) || null);
                })}>
              <button class="row-btn" title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
                @click=${() => this._openFormulaModal()}>${icons.formula}</button>
            </div>`}
      </div>
    `;
  }

  /**
   * 필드의 값 소스를 파라미터 또는 수식으로 전환한다.
   * 파라미터로 전환할 때는 새 파라미터를 만들어 연결한다.
   *
   * @param kind - 바꿀 소스
   */
  private _setFieldSource(kind: 'parameter' | 'formula'): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'field') {
      this._rejectInput();
      return;
    }
    if (kind === 'parameter') {
      if (el.parameter !== undefined) return;
      this._assignNewParameter();
      return;
    }
    if (el.formula !== undefined) return;
    this._updateElement((target) => {
      if (target.type !== 'field') return;
      const r = target as Record<string, unknown>;
      delete r.parameter;
      r.formula = '';
    });
  }

  /** 바코드 종류와 값 소스를 편집하는 패널을 렌더링한다. */
  private _renderBarcodeProps(el: BarcodeElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    // 설정된 속성으로 현재 값 소스 종류를 결정한다 (SPEC §5.6).
        const source: 'content' | 'parameter' | 'formula' =
          el.parameter !== undefined ? 'parameter' : el.formula !== undefined ? 'formula' : 'content';
        // 직접 입력한 값만 편집 중에 바코드 형식을 검사한다.
        const warning = source === 'content' ? this._barcodeContentWarning(el.kind, el.content ?? '') : null;
        return html`
          <div class="prop-section">
            <div class="prop-section-title">${s.panelValue}</div>
            <div class="prop-row">
              <label>${s.barcodeKind}</label>
              ${this._listSelect({
                id: 'barcode-kind',
                ariaLabel: s.barcodeKind,
                value: el.kind,
                options: [
                  ...(this._barcodeKinds().some((k) => k.value === el.kind)
                    ? []
                    : [{ value: el.kind, label: el.kind }]),
                  ...this._barcodeKinds().map((k) => ({ value: k.value, label: k.label })),
                ],
                onPick: (value) => this._updateElement((target) => {
                  if (target.type === 'barcode') target.kind = value as BarcodeKind;
                }),
              })}
            </div>
            <div class="prop-row">
              <label>${s.barcodeValue}</label>
              ${this._listSelect({
                id: 'barcode-source',
                ariaLabel: s.barcodeValue,
                value: source,
                options: [
                  { value: 'content', label: s.cellSourceText },
                  { value: 'parameter', label: s.cellSourceParameter },
                  { value: 'formula', label: s.cellSourceFormula },
                ],
                onPick: (value) =>
                  this._chooseBarcodeSource(value as 'content' | 'parameter' | 'formula'),
              })}
            </div>
            ${source === 'content'
              ? html`
                <div class="prop-row">
                  <label>${s.content}</label>
                  <input .value=${el.content ?? ''}
                    @change=${(e: Event) => this._setBarcodeSource('content', valOf(e))}>
                </div>
                ${warning ? html`<p class="image-error" role="alert">${warning}</p>` : nothing}`
              : source === 'parameter'
                ? this._renderBarcodeParameterSelect(el.parameter ?? '')
                : html`
                  <div class="prop-row">
                    <label>${s.formula}</label>
                    <input .value=${el.formula ?? ''}
                      @change=${(e: Event) => this._setBarcodeSource('formula', valOf(e))}>
                  </div>`}
          </div>
        `;
  }

  /**
   * 선 요소에는 별도의 종류별 속성 패널을 표시하지 않는다.
   * 방향은 캔버스의 끝점 핸들로 변경한다.
   */
  private _renderLineProps(_el: LineElement) {
    return nothing;
  }

  /** 정다각형의 변 수를 편집하는 패널을 렌더링한다. */
  private _renderPolygonProps(el: PolygonElement) {
    const s = this._strings.designer;
    return html`
          <div class="prop-section">
            <div class="prop-section-title">${s.panelStructure}</div>
            <div class="prop-row">
              <label>${s.sides}</label>
              <input type="number" min="3" max="12" step="1" .value=${String(el.sides)}
                aria-invalid=${String(this._hasInputError('polygon-sides'))}
                aria-describedby=${this._hasInputError('polygon-sides') ? 'error-polygon-sides' : nothing}
                @change=${(e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  // 스키마가 허용하는 3~12 범위만 적용한다.
                  if (!Number.isInteger(v) || v < 3 || v > 12) {
                    this._rejectInput(
                      s.rangeInput.replace('{min}', '3').replace('{max}', '12'),
                      'polygon-sides',
                    );
                    return;
                  }
                  this._updateElement((el) => {
                    if (el.type === 'polygon') el.sides = v;
                  });
                }}>
            </div>
            ${this._renderInputError('polygon-sides')}
          </div>
        `;
  }

  /** 그리드 또는 선택 셀의 텍스트 표시 방식을 편집하는 선택기를 렌더링한다. */
  private _renderGridOverflowRow(config: {
    id: string;
    value: 'inherit' | 'clip' | 'shrink';
    inherit?: boolean;
    ariaLabel?: string;
    onPick: (value: 'inherit' | 'clip' | 'shrink') => void;
  }) {
    const s = this._strings.designer;
    return html`
      <div class="prop-row">
        <label>${s.overflow}</label>
        ${this._listSelect({
          id: config.id,
          ariaLabel: config.ariaLabel ?? s.overflow,
          value: config.value,
          options: [
            ...(config.inherit ? [{ value: 'inherit', label: s.overflowInherit }] : []),
            { value: 'clip', label: s.overflowClip },
            { value: 'shrink', label: s.overflowShrink },
          ],
          onPick: (value) => config.onPick(value as 'inherit' | 'clip' | 'shrink'),
        })}
      </div>
    `;
  }

  /** 그리드의 행, 열, 반복 구간, 셀을 편집하는 패널을 렌더링한다. */
  private _renderGridProps(el: GridElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    const cellTarget = this._selectedCell;
        const cellDef = cellTarget
          ? el.cells.find((c) => c.row === cellTarget.row && c.column === cellTarget.column)
          : undefined;
        const repeat = el.repeat;
        const source: 'content' | 'parameter' | 'formula' =
          this._cellSourceKind
          ?? (cellDef?.parameter !== undefined ? 'parameter' : cellDef?.formula !== undefined ? 'formula' : 'content');
        const inBand =
          cellTarget !== null && repeat !== undefined
          && cellTarget.row >= repeat.fromRow && cellTarget.row <= repeat.toRow;
        const numberOf = (e: Event): number => Number((e.target as HTMLInputElement).value);
        // 셀이 선택된 동안에는 그리드 전체 설정을 숨긴다.
        const gridOwnProps = html`
          <div class="prop-section">
            <div class="prop-section-title">${s.panelStructure}</div>
            <div class="prop-row">
                <label>${s.rows}</label>
                <div class="step-inputs">
                  <button class="row-btn" aria-label="${s.rows} -" @click=${() => this._changeGridRows(-1)}>-</button>
                  <span>${el.rows.length}</span>
                  <button class="row-btn" aria-label="${s.rows} +" @click=${() => this._changeGridRows(1)}>+</button>
                </div>
              </div>
              <div class="prop-row">
                <label>${s.columns}</label>
                <div class="step-inputs">
                  <button class="row-btn" aria-label="${s.columns} -" @click=${() => this._changeGridColumns(-1)}>-</button>
                  <span>${el.columns.length}</span>
                  <button class="row-btn" aria-label="${s.columns} +" @click=${() => this._changeGridColumns(1)}>+</button>
                </div>
              </div>
          </div>

          <div class="prop-section">
            <div class="prop-section-title">${s.repeatSection}</div>
            <div class="prop-row">
              <label>${s.repeatOn}</label>
              <input type="checkbox" aria-label=${s.repeatOn} .checked=${repeat !== undefined}
                @change=${(e: Event) => this._toggleGridRepeat((e.target as HTMLInputElement).checked)}>
            </div>
            ${repeat
              ? html`
                <div class="prop-row">
                  <label>${s.parameter}</label>
                  ${this._listSelect({
                    id: 'repeat-parameter',
                    ariaLabel: `${s.repeatSection} ${s.parameter}`,
                    value: repeat.parameter,
                    className: 'parameter-select',
                    options: [
                      ...this._parameterList()
                        .filter((b) => b.valueType === 'list' || b.key === repeat.parameter)
                        .map((b) => ({ value: b.key, label: b.label })),
                      ...(this._parameterList().some((b) => b.key === repeat.parameter)
                        ? []
                        : [{ value: repeat.parameter, label: repeat.parameter }]),
                    ],
                    onPick: (value) => this._updateGridRepeat({ parameter: value }),
                  })}
                </div>
                <div class="prop-pair">
                  <div class="prop-row">
                    <label>${s.repeatFrom}</label>
                    <input type="number" min="1" max=${String(el.rows.length)} .value=${String(repeat.fromRow + 1)}
                      aria-invalid=${String(this._hasInputError('repeat-from'))}
                      aria-describedby=${this._hasInputError('repeat-from') ? 'error-repeat-from' : nothing}
                      @change=${(e: Event) => this._updateGridRepeat({ fromRow: numberOf(e) - 1 })}>
                  </div>
                  <div class="prop-row">
                    <label>${s.repeatTo}</label>
                    <input type="number" min="1" max=${String(el.rows.length)} .value=${String(repeat.toRow + 1)}
                      aria-invalid=${String(this._hasInputError('repeat-to'))}
                      aria-describedby=${this._hasInputError('repeat-to') ? 'error-repeat-to' : nothing}
                      @change=${(e: Event) => this._updateGridRepeat({ toRow: numberOf(e) - 1 })}>
                  </div>
                </div>
                ${this._renderInputError('repeat-from')}
                ${this._renderInputError('repeat-to')}
                <div class="prop-row">
                  <label>${s.repeatPerPage}</label>
                  <input type="number" min="1" max="1000" .value=${String(repeat.perPage)}
                    aria-invalid=${String(this._hasInputError('repeat-per-page'))}
                    aria-describedby=${this._hasInputError('repeat-per-page') ? 'error-repeat-per-page' : nothing}
                    @change=${(e: Event) => this._updateGridRepeat({ perPage: numberOf(e) })}>
                </div>
                ${this._renderInputError('repeat-per-page')}
                <div class="prop-row">
                  <label>${s.repeatMaxItems}</label>
                  <input type="number" min=${String(repeat.perPage)} max="100000"
                    class=${repeat.maxItems === undefined ? 'dim' : ''}
                    placeholder=${s.repeatMaxItemsNone}
                    .value=${repeat.maxItems === undefined ? '' : String(repeat.maxItems)}
                    aria-invalid=${String(this._hasInputError('repeat-max-items'))}
                    aria-describedby=${this._hasInputError('repeat-max-items') ? 'error-repeat-max-items' : nothing}
                    @change=${(e: Event) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      this._updateGridRepeat({ maxItems: raw === '' ? null : Number(raw) });
                    }}>
                </div>
                ${this._renderInputError('repeat-max-items')}
                <div class="prop-row">
                  <label>${s.repeatHeader}</label>
                  <input type="checkbox" aria-label=${s.repeatHeader} .checked=${repeat.repeatHeader}
                    @change=${(e: Event) =>
                      this._updateGridRepeat({ repeatHeader: (e.target as HTMLInputElement).checked })}>
                </div>`
              : nothing}
          </div>`;
        return html`
          ${cellTarget === null
            ? gridOwnProps
            : html`
              <button class="grid-back" title=${el.name}
                aria-label="${s.gridBack}: ${el.name}"
                @click=${() => this._clearCellSelection()}>
                ${icons.pagePrev}
                <span class="grid-back-label">${s.gridBack}</span>
                <span class="grid-back-name">${el.name}</span>
              </button>`}
          ${this._renderGridCellProps(el, cellTarget, cellDef, source, inBand)}
        `;
  }

  /** 셀 선택을 해제하고 그리드 전체 편집으로 돌아간다. */
  private _clearCellSelection(): void {
    this._resetPanelErrors();
    this._selectedCell = null;
    this._cellEditing = false;
    this._cellSourceKind = null;
    this.requestUpdate();
  }

  /** 선택한 그리드 셀의 값, 병합, 글자, 색상, 테두리를 편집하는 패널을 렌더링한다. */
  private _renderGridCellProps(
    el: GridElement,
    cellTarget: { row: number; column: number } | null,
    cellDef: GridCell | undefined,
    source: 'content' | 'parameter' | 'formula',
    inBand: boolean,
  ) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    return cellTarget
      ? html`
          <div class="prop-section">
            <div class="prop-section-title">${s.panelValue}</div>
            <div class="prop-row">
              <label>${s.cellSource}</label>
              ${this._listSelect({
                id: 'grid-cell-source',
                ariaLabel: s.cellSource,
                value: source,
                options: [
                  { value: 'content', label: s.cellSourceText },
                  { value: 'parameter', label: s.cellSourceParameter },
                  { value: 'formula', label: s.cellSourceFormula },
                ],
                onPick: (value) =>
                  this._chooseGridCellSource(value as 'content' | 'parameter' | 'formula'),
              })}
            </div>
            ${source === 'content'
              ? html`
                <div class="prop-row">
                  <label>${s.content}</label>
                  <input .value=${cellDef?.content ?? ''}
                    @change=${(e: Event) => {
                      this._selectedCell = cellTarget;
                      this._commitCellContent(valOf(e));
                    }}>
                </div>`
              : source === 'parameter'
                ? html`
                  <div class="prop-row">
                    <label>${s.parameter}</label>
                    ${this._gridCellParameterSelect(el, cellDef?.parameter ?? '', inBand)}
                  </div>`
                : html`
                  <div class="prop-row">
                    <label>${s.formula}</label>
                    <input .value=${cellDef?.formula ?? ''}
                      @change=${(e: Event) => this._setGridCellSource('formula', valOf(e))}>
                  </div>`}
          </div>

          <div class="prop-section">
            <div class="prop-section-title">${s.panelStructure}</div>
            <div class="prop-pair">
              <div class="prop-row">
                <label>${s.rowHeight}</label>
                <input type="number" min="2" step="0.5"
                  .value=${String(el.rows[cellTarget.row]?.height ?? '')}
                  aria-invalid=${String(this._hasInputError('cell-row-height'))}
                  aria-describedby=${this._hasInputError('cell-row-height') ? 'error-cell-row-height' : nothing}
                  @change=${(e: Event) =>
                    this._setGridTrack('row', cellTarget.row, Number((e.target as HTMLInputElement).value))}>
              </div>
              <div class="prop-row">
                <label>${s.columnWidth}</label>
                <input type="number" min="2" step="0.5"
                  .value=${String(el.columns[cellTarget.column]?.width ?? '')}
                  aria-invalid=${String(this._hasInputError('cell-column-width'))}
                  aria-describedby=${this._hasInputError('cell-column-width') ? 'error-cell-column-width' : nothing}
                  @change=${(e: Event) =>
                    this._setGridTrack('column', cellTarget.column, Number((e.target as HTMLInputElement).value))}>
              </div>
            </div>
            ${this._renderInputError('cell-row-height')}
            ${this._renderInputError('cell-column-width')}
            <div class="prop-row">
              <label>${s.merge}</label>
              <div class="merge-inputs">
                <span>${s.rows}</span>
                <input type="number" min="1" .value=${String(cellDef?.rowSpan ?? 1)}
                  aria-label="${s.merge} ${s.rows}"
                  aria-invalid=${String(this._hasInputError('cell-row-span'))}
                  aria-describedby=${this._hasInputError('cell-row-span') ? 'error-cell-row-span' : nothing}
                  @change=${(e: Event) => this._setCellSpan('rowSpan', Number(valOf(e)))}>
                <span>${s.columns}</span>
                <input type="number" min="1" .value=${String(cellDef?.colSpan ?? 1)}
                  aria-label="${s.merge} ${s.columns}"
                  aria-invalid=${String(this._hasInputError('cell-column-span'))}
                  aria-describedby=${this._hasInputError('cell-column-span') ? 'error-cell-column-span' : nothing}
                  @change=${(e: Event) => this._setCellSpan('colSpan', Number(valOf(e)))}>
              </div>
            </div>
            ${this._renderInputError('cell-row-span')}
            ${this._renderInputError('cell-column-span')}
          </div>

          <div class="prop-section">
            <div class="prop-section-title">${s.styleText}</div>
            ${this._renderFontNameRow(
              cellDef?.fontName,
              (v) => this._updateCellStyle('fontName', v),
              `${s.cell} ${s.fontName}`,
            )}
            ${this._renderDefaultedNumberRow(
              s.fontSize, cellDef?.fontSize, el.fontSize ?? DEFAULT_FONT_SIZE,
              (v) => this._updateCellStyle('fontSize', v),
              { step: '0.5', min: '0.5', ariaLabel: `${s.cell} ${s.fontSize}`, errorKey: 'cell-font-size' },
            )}
            ${this._renderGridOverflowRow({
              id: 'grid-cell-overflow',
              value: cellDef?.overflow ?? 'inherit',
              inherit: true,
              ariaLabel: `${s.cell} ${s.overflow}`,
              onPick: (value) =>
                this._updateCellStyle('overflow', value === 'inherit' ? null : value),
            })}
            <div class="prop-row">
              <label>${s.alignment}</label>
              <div class="toggle-group" role="group" aria-label="${s.cell} ${s.alignment}">
                ${([
                  ['left', s.alignLeft, icons.alignLeft],
                  ['center', s.alignCenter, icons.alignCenter],
                  ['right', s.alignRight, icons.alignRight],
                ] as const).map(([value, label, glyph]) => html`
                  <button title=${label} aria-label="${s.cell} ${s.alignment}: ${label}"
                    aria-pressed=${String((cellDef?.alignment ?? el.alignment ?? 'left') === value)}
                    @click=${() => this._updateCellStyle('alignment', value === 'left' ? null : value)}>${glyph}</button>`)}
              </div>
            </div>
            <div class="prop-row">
              <label>${s.verticalAlignment}</label>
              <div class="toggle-group" role="group" aria-label="${s.cell} ${s.verticalAlignment}">
                ${([
                  ['top', s.alignTop, icons.alignTop],
                  ['middle', s.alignMiddle, icons.alignMiddle],
                  ['bottom', s.alignBottom, icons.alignBottom],
                ] as const).map(([value, label, glyph]) => html`
                  <button title=${label} aria-label="${s.cell} ${s.verticalAlignment}: ${label}"
                    aria-pressed=${String((cellDef?.verticalAlignment ?? el.verticalAlignment ?? 'top') === value)}
                    @click=${() => this._updateCellStyle('verticalAlignment', value === 'top' ? null : value)}
                    >${glyph}</button>`)}
              </div>
            </div>
            ${this._renderDefaultedNumberRow(
              s.lineHeight, cellDef?.lineHeight, el.lineHeight ?? 1,
              (v) => this._updateCellStyle('lineHeight', v),
              { step: '0.1', min: '0.1', ariaLabel: `${s.cell} ${s.lineHeight}`, errorKey: 'cell-line-height' },
            )}
            ${this._renderDefaultedNumberRow(
              s.characterSpacing, cellDef?.characterSpacing, el.characterSpacing ?? 0,
              (v) => this._updateCellStyle('characterSpacing', v),
              { step: '0.1', ariaLabel: `${s.cell} ${s.characterSpacing}`, errorKey: 'cell-character-spacing' },
            )}
            ${this._renderTextStyleToggles(
              cellDef ?? {},
              (key, value) => this._updateCellStyle(key, value ? true : null),
              `${s.cell} `,
            )}
            ${this._renderColorControl(
              s.fontColor, cellDef?.fontColor, 'cellFontColor',
              (v) => this._updateCellStyle('fontColor', v),
              el.fontColor ?? DEFAULT_FONT_COLOR,
              `${s.cell} ${s.fontColor}`,
            )}
          </div>

          <div class="prop-section">
            <div class="prop-section-title">${s.styleBackground}</div>
            ${this._renderColorControl(
              s.backgroundColor, cellDef?.backgroundColor, 'cellBackgroundColor',
              (v) => this._updateCellStyle('backgroundColor', v),
              undefined,
              `${s.cell} ${s.backgroundColor}`,
            )}
          </div>

          <div class="prop-section">
            <div class="prop-section-title">${s.styleBorder}</div>
            ${this._renderColorControl(
              s.borderColor, cellDef?.borderColor, 'cellBorderColor',
              (v) => this._updateCellStyle('borderColor', v),
              el.borderColor ?? DEFAULT_BORDER_COLOR,
              `${s.cell} ${s.borderColor}`,
            )}
            ${this._renderBorderWidthSelect(
              cellDef?.borderWidth,
              el.borderWidth ?? DEFAULT_LINE_WIDTH,
              true,
              'cellBorderWidth',
              (v) => this._updateCellStyle('borderWidth', v),
            )}
            ${this._renderBorderShapeRow(
              cellDef?.borderStyle,
              `${s.cell} ${s.borderShape}`,
              'cellBorderStyle',
              (v) => this._updateCellStyle('borderStyle', v),
            )}
          </div>`
      : nothing;
  }

  /** 이미지 요소의 고정 이미지와 파라미터 이미지를 편집하는 패널을 렌더링한다. */
  private _renderImageProps(el: ImageElement) {
    const s = this._strings.designer;
    // 이미지 요소는 고정 소스와 파라미터 중 하나만 사용한다.
    const variable = el.parameter !== undefined;
    // base64 문자열 대신 현재 이미지를 표시한다.
    const chosen = el.src !== undefined && el.src !== PLACEHOLDER_IMG && el.src.startsWith('data:');
    return html`
      <div class="prop-section">
        <div class="prop-section-title">${s.panelValue}</div>
        <div class="prop-row">
          <label>${s.imageMode}</label>
          <div class="toggle-group text" role="group" aria-label=${s.imageMode}>
            <button aria-pressed=${String(!variable)}
              @click=${() => this._setImageVariable(false)}>${s.imageFixed}</button>
            <button aria-pressed=${String(variable)}
              @click=${() => this._setImageVariable(true)}>${s.imageVariable}</button>
          </div>
        </div>
        ${variable
          ? this._renderImageParameterSelect(el.parameter ?? '')
          : html`
            ${chosen
              ? html`<div class="image-current"><img src=${el.src} alt=""></div>`
              : html`<p class="image-hint">${s.imageNone}</p>`}
            <button class="col-modal-open" @click=${() => this._openImageModal()}>
              ${icons.image}<span>${chosen ? s.imageChange : s.imagePick}</span>
            </button>`}
      </div>
    `;
  }

  /**
   * 호스트가 제공한 폰트를 선택하는 입력을 렌더링한다.
   *
   * @param current - 현재 지정된 폰트 이름
   * @param apply - 저장 콜백 (빈 값이면 지정 해제)
   * @param ariaLabel - 보조기기용 이름
   * @returns 폰트 선택 UI. 선택할 폰트가 없으면 빈 템플릿
   */
  private _renderFontNameRow(
    current: string | undefined,
    apply: (value: string | null) => void,
    ariaLabel?: string,
  ) {
    const s = this._strings.designer;
    // 선택할 폰트가 없으면 입력을 표시하지 않는다.
    if (this._fontNames.length <= 1 && current === undefined) return nothing;
    const options = current !== undefined && !this._fontNames.includes(current)
      ? [current, ...this._fontNames]
      : this._fontNames;
    return html`
      <div class="prop-row">
        <label>${s.fontName}</label>
        ${this._listSelect({
          id: 'font-name',
          ariaLabel: ariaLabel ?? s.fontName,
          value: current ?? '',
          className: current === undefined ? 'dim' : '',
          options: [
            { value: '', label: s.fontDefault },
            ...options.map((name) => ({ value: name, label: name })),
          ],
          onPick: (value) => apply(value || null),
        })}
      </div>`;
  }

  private _renderFontProps(el: SlipElement) {
    if (el.type !== 'text' && el.type !== 'field') return nothing;
    const s = this._strings.designer;
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);

    return html`
      ${this._renderFontNameRow(
        (el as { fontName?: string }).fontName,
        (v) => this._updateElement((target) => setOptional(target, 'fontName', v)),
      )}
      ${this._renderDefaultedNumberRow(
        s.fontSize, el.fontSize, DEFAULT_FONT_SIZE,
        (v) => this._updateElement((target) => setOptional(target, 'fontSize', v)),
        { step: '0.5', min: '0.5', errorKey: 'element-font-size' },
      )}
      <div class="prop-row">
        <label>${s.alignment}</label>
        <div class="toggle-group" role="group" aria-label=${s.alignment}>
          ${([
            ['left', s.alignLeft, icons.alignLeft],
            ['center', s.alignCenter, icons.alignCenter],
            ['right', s.alignRight, icons.alignRight],
          ] as const).map(([value, label, glyph]) => html`
            <button title=${label} aria-label="${s.alignment}: ${label}"
              aria-pressed=${String((el.alignment ?? 'left') === value)}
              @click=${() => this._updateElement((target) =>
                setOptional(target, 'alignment', value !== 'left' ? value : null))}>${glyph}</button>`)}
        </div>
      </div>
      <div class="prop-row">
        <label>${s.verticalAlignment}</label>
        <div class="toggle-group" role="group" aria-label=${s.verticalAlignment}>
          ${([
            ['top', s.alignTop, icons.alignTop],
            ['middle', s.alignMiddle, icons.alignMiddle],
            ['bottom', s.alignBottom, icons.alignBottom],
          ] as const).map(([value, label, glyph]) => html`
            <button title=${label} aria-label="${s.verticalAlignment}: ${label}"
              aria-pressed=${String((el.verticalAlignment ?? 'top') === value)}
              @click=${() => this._updateElement((target) =>
                setOptional(target, 'verticalAlignment', value !== 'top' ? value : null))}>${glyph}</button>`)}
        </div>
      </div>
      ${this._renderDefaultedNumberRow(
        s.lineHeight, el.lineHeight, 1,
        (v) => this._updateElement((target) => setOptional(target, 'lineHeight', v)),
        { step: '0.1', min: '0.1', errorKey: 'element-line-height' },
      )}
      ${this._renderDefaultedNumberRow(
        s.characterSpacing, el.characterSpacing, 0,
        (v) => this._updateElement((target) => setOptional(target, 'characterSpacing', v)),
        { step: '0.1', errorKey: 'element-character-spacing' },
      )}
      <div class="prop-row">
        <label>${s.verticalWriting}</label>
        <input type="checkbox" aria-label=${s.verticalWriting} .checked=${el.vertical === true}
          @change=${(e: Event) => this._updateElement((target) =>
            setOptional(target, 'vertical', (e.target as HTMLInputElement).checked ? true : null))}>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: color props
  // ---------------------------------------------------------------------------

  /**
   * 속성 패널에서 펼친 팝오버의 키. 한 번에 하나의 팝오버만 열 수 있다.
   */
  private _openPopKey: string | null = null;

  /** 테두리 굵기·형태 메뉴의 화면 고정 위치 */
  private _propertyMenuPos = { left: 0, top: 0, width: 0, maxHeight: 220 };

  /** 테두리 선택 메뉴를 버튼 아래에 열거나 닫는다. */
  private _togglePropertyMenu(key: string, event: Event): void {
    if (this._openPopKey === key) {
      this._openPopKey = null;
    } else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const roomBelow = window.innerHeight - rect.bottom - 12;
      const roomAbove = rect.top - 12;
      const openAbove = roomBelow < 180 && roomAbove > roomBelow;
      const room = openAbove ? roomAbove : roomBelow;
      const maxHeight = Math.max(80, Math.min(220, room));
      this._propertyMenuPos = {
        left: rect.left,
        top: openAbove ? rect.top - maxHeight - 4 : rect.bottom + 4,
        width: rect.width,
        maxHeight,
      };
      this._openPopKey = key;
    }
    this.requestUpdate();
  }

  /** 열린 테두리 선택 메뉴를 닫는다. */
  private _closePropertyMenu(): void {
    this._openPopKey = null;
    this.requestUpdate();
  }

  /**
   * 모든 요소의 종류 배지를 표시할지 여부.
   * 파일에 저장하지 않는 화면 상태다.
   */
  private _showBadges = false;

  /**
   * 캔버스 격자 간격(mm). `null`이면 격자를 표시하지 않는다.
   */
  private _gridGap: number | null = null;

  /** 격자 간격 메뉴 열림 여부 */
  private _gridMenuOpen = false;

  /** 캔버스 격자선 색 */
  private _gridColor: GridColorId = 'gray';

  /** 격자 설정 메뉴의 화면 좌표 */
  private _gridMenuPos = { left: 0, top: 0 };

  /** 용지 위에 있는 커서의 위치(mm) */
  private _cursorMm: { x: number; y: number } | null = null;

  /** localStorage에서 읽은 사용자 지정 색상 캐시 */
  private _customColorsCache: string[] | null = null;

  private _getCustomColors(): string[] {
    this._customColorsCache ??= loadCustomColors();
    return this._customColorsCache;
  }

  /** 색 선택기의 현재 HSV 값 */
  private _pickerH = 0;
  private _pickerS = 1;
  private _pickerV = 1;
  /** 채도와 명도 영역을 드래그 중인 색상 속성 키 */
  private _svDragKey: string | null = null;

  /** 요소의 색상 속성을 설정하거나 제거하고 색 선택기 상태를 갱신한다. */
  private _applyColor(key: string, value: string | null): void {
    if (value) {
      const { h, s, v } = hexToHsv(value);
      // 무채색에는 색조가 없으므로 기존 색조를 유지한다.
      if (s > 0) this._pickerH = h;
      this._pickerS = s;
      this._pickerV = v;
    }
    this._updateElement((el) => setOptional(el, key, value || null));
  }

  /** 포인터 위치를 색 선택기의 채도와 명도로 변환한다. */
  private _svPointTo(e: PointerEvent): void {
    const area = e.currentTarget as HTMLElement;
    const rect = area.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    this._pickerS = Math.max(0, Math.min((e.clientX - rect.left) / w, 1));
    this._pickerV = 1 - Math.max(0, Math.min((e.clientY - rect.top) / h, 1));
    this.requestUpdate();
  }

  /** HEX 색상에 맞춰 색 선택기의 HSV 값을 설정한다. */
  private _seedPicker(hex: string): void {
    const hsv = hexToHsv(hex);
    if (hsv.s > 0) this._pickerH = hsv.h;
    this._pickerS = hsv.s;
    this._pickerV = hsv.v;
  }

  /**
   * 색상 견본, HSV 선택기, 직접 입력, 투명도를 포함한 색상 입력을 렌더링한다.
   * 색상은 파일 스키마와 같은 `#RRGGBB` 또는 `#RRGGBBAA` 형식으로 저장한다.
   *
   * @param label - 화면에 보이는 항목 이름
   * @param current - 지정된 색 (없으면 undefined)
   * @param key - 펼침 상태를 구분할 키
   * @param apply - 색을 저장하는 콜백 (없으면 선택 요소의 스타일 필드에 저장)
   * @param fallback - 명시된 값이 없을 때 적용할 색
   * @param ariaLabel - 접근성 레이블
   */
  private _renderColorControl(
    label: string,
    current: string | undefined,
    key: string,
    apply?: (value: string | null) => void,
    fallback?: string | undefined,
    ariaLabel?: string,
  ) {
    // apply가 없으면 선택된 요소의 색상 속성을 변경한다.
    const commit = (value: string | null): void => {
      if (apply) {
        if (value) this._seedPicker(value);
        apply(value);
      } else {
        this._applyColor(key, value);
      }
    };
    const s = this._strings.designer;
    const base = current?.slice(0, 7) ?? '#000000';
    const alphaPct = current && current.length === 9
      ? Math.round((parseInt(current.slice(7, 9), 16) / 255) * 100)
      : 100;
    const compose = (hex: string, pct: number): string => {
      const clamped = Math.max(0, Math.min(100, pct));
      if (clamped >= 100) return hex;
      return hex + Math.round((clamped / 100) * 255).toString(16).padStart(2, '0');
    };
    const open = this._openPopKey === key;
    // 명시된 값이 없으면 상속값 또는 기본값을 표시한다.
    const shown = current ?? fallback;
    // 요소와 셀의 같은 속성을 구분할 접근성 레이블을 사용한다.
    const name = ariaLabel ?? label;

    return html`
      <div class="prop-row">
        <label>${label}</label>
        <button class="color-btn" aria-label=${name} aria-expanded=${String(open)}
          @click=${() => {
            if (open) {
              this._openPopKey = null;
            } else {
              this._openPopKey = key;
              // 현재 색 또는 기본 빨강으로 색 선택기를 초기화한다.
              if (current) {
                this._seedPicker(current);
              } else {
                this._pickerH = 0;
                this._pickerS = 1;
                this._pickerV = 1;
              }
            }
            this.requestUpdate();
          }}>
          <span class="color-chip ${shown ? '' : 'none'}"
            style=${shown ? `background:${shown.slice(0, 7)}` : nothing}></span>
          <span class="color-value ${current === undefined ? 'dim' : ''}"
            >${shown ?? s.colorNone}</span>
        </button>
      </div>
      ${open ? html`
        <div class="color-pop">
          <div class="color-extras">
            <button class="swatch none" title=${s.colorNone} aria-label="${name}: ${s.colorNone}"
              aria-pressed=${String(current === undefined)}
              @click=${() => commit(null)}></button>
            ${COLOR_PALETTE.map((c) => html`<button class="swatch" style="background:${c}"
              title=${c} aria-label="${name} ${c}"
              aria-pressed=${String(current?.slice(0, 7).toLowerCase() === c)}
              @click=${() => commit(compose(c, alphaPct))}></button>`)}
            ${this._getCustomColors().map((c) => html`<button class="swatch custom" style="background:${c}"
              title=${c} aria-label="${name} ${c}"
              aria-pressed=${String(current?.toLowerCase() === c.toLowerCase())}
              @click=${() => commit(c)}></button>`)}
            <button class="swatch-save" title=${s.saveColor} aria-label="${name}: ${s.saveColor}"
              ?disabled=${!current}
              @click=${() => {
                // 기본 팔레트에 있는 색상은 사용자 지정 목록에 저장하지 않는다.
                if (!current || (COLOR_PALETTE as readonly string[]).includes(current)) return;
                this._customColorsCache = saveCustomColor(current);
                this.requestUpdate();
              }}>${icons.pageAdd}</button>
          </div>
          <div class="sv-area" aria-label="${name} ${s.style}"
            style="background:linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${this._pickerH}, 100%, 50%))"
            @pointerdown=${(e: PointerEvent) => {
              this._svDragKey = key;
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              e.preventDefault();
              e.stopPropagation();
              this._svPointTo(e);
            }}
            @pointermove=${(e: PointerEvent) => {
              if (this._svDragKey === key) this._svPointTo(e);
            }}
            @pointerup=${(e: PointerEvent) => {
              if (this._svDragKey !== key) return;
              this._svDragKey = null;
              this._svPointTo(e);
              commit(compose(hsvToHex(this._pickerH, this._pickerS, this._pickerV), alphaPct));
            }}
            @pointercancel=${() => { this._svDragKey = null; }}>
            <span class="sv-thumb"
              style="left:${(this._pickerS * 100).toFixed(1)}%;top:${((1 - this._pickerV) * 100).toFixed(1)}%"></span>
          </div>
          <input type="range" class="hue-slider" min="0" max="360" step="1"
            .value=${String(Math.round(this._pickerH))}
            title="${name} ${s.hue}" aria-label="${name} ${s.hue}"
            @input=${(e: Event) => {
              this._pickerH = Number((e.target as HTMLInputElement).value);
              this.requestUpdate();
            }}
            @change=${() =>
              commit(compose(hsvToHex(this._pickerH, this._pickerS, this._pickerV), alphaPct))}>
          <div class="color-pop-row">
            <input .value=${current ?? ''} placeholder="#RRGGBB"
              aria-invalid=${String(this._hasInputError(`color-${key}`))}
              aria-describedby=${this._hasInputError(`color-${key}`) ? `error-color-${key}` : nothing}
              @change=${(e: Event) => {
                // 파일 스키마가 허용하는 HEX 색상만 적용한다.
                const v = (e.target as HTMLInputElement).value;
                if (v && !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
                  this._rejectInput(s.colorFormatError, `color-${key}`);
                  return;
                }
                commit(v || null);
              }}>
            <input type="number" class="alpha-input" min="0" max="100" .value=${String(alphaPct)}
              title=${s.opacity} aria-label="${label} ${s.opacity}"
              aria-invalid=${String(this._hasInputError(`opacity-${key}`))}
              aria-describedby=${this._hasInputError(`opacity-${key}`) ? `error-opacity-${key}` : nothing}
              @change=${(e: Event) => {
                if (!current) return;
                const value = Number((e.target as HTMLInputElement).value);
                if (!Number.isFinite(value) || value < 0 || value > 100) {
                  this._rejectInput(
                    s.rangeInput.replace('{min}', '0').replace('{max}', '100'),
                    `opacity-${key}`,
                  );
                  return;
                }
                commit(compose(base, value));
              }}>
            <span class="alpha-suffix">%</span>
          </div>
          ${this._renderInputError(`color-${key}`)}
          ${this._renderInputError(`opacity-${key}`)}
        </div>` : nothing}
    `;
  }

  /** 굵게, 밑줄, 취소선 토글을 렌더링한다. */
  private _renderTextStyleToggles(
    current: {
      bold?: boolean | undefined;
      underline?: boolean | undefined;
      strikethrough?: boolean | undefined;
    },
    apply: (key: 'bold' | 'underline' | 'strikethrough', value: boolean) => void,
    ariaPrefix = '',
  ) {
    const s = this._strings.designer;
    return html`
      <div class="prop-row">
        <label>${s.style}</label>
        <div class="toggle-group" role="group" aria-label="${ariaPrefix}${s.style}">
          ${([
            ['bold', s.bold, icons.bold],
            ['underline', s.underline, icons.underline],
            ['strikethrough', s.strikethrough, icons.strikethrough],
          ] as const).map(([key, label, glyph]) => html`
            <button title=${label} aria-label="${ariaPrefix}${label}"
              aria-pressed=${String(current[key] === true)}
              @click=${() => apply(key, current[key] !== true)}>${glyph}</button>`)}
        </div>
      </div>
    `;
  }

  /**
   * 테두리 굵기 선택기를 선 미리보기와 함께 렌더링한다.
   *
   * @param current - 명시된 굵기 (미지정이면 fallback이 유효값)
   * @param fallback - 미지정일 때의 유효 굵기 (요소 기본값 또는 셀이 상속하는 요소 값)
   * @param allowNone - 0 굵기 선택지를 표시할지 여부
   */
  private _renderBorderWidthSelect(
    current: number | undefined,
    fallback: number,
    allowNone: boolean,
    key: string,
    apply: (value: number) => void,
    /** 화면에 표시할 레이블 */
    labelText?: string,
  ) {
    const s = this._strings.designer;
    const label = labelText ?? s.borderWidth;
    const effective = current ?? fallback;
    const open = this._openPopKey === key;
    // 기본 선택지에 없는 현재 값도 목록에 포함한다.
    const steps = [...new Set<number>([...BORDER_WIDTH_STEPS, ...(effective > 0 ? [effective] : [])])]
      .sort((a, b) => a - b);
    const previewPx = (w: number): number => Math.min(6, Math.max(1, Math.round(w * PX_PER_MM)));
    const pick = (value: number): void => {
      this._openPopKey = null;
      apply(value);
    };
    return html`
      <div class="prop-row">
        <label>${label}</label>
        <button class="width-btn" aria-label=${label} aria-haspopup="menu"
          aria-expanded=${String(open)}
          @click=${(event: Event) => this._togglePropertyMenu(key, event)}>
          ${effective > 0
            ? html`<span class="width-line" style="border-top-width:${previewPx(effective)}px"></span>
                <span class="width-value ${current === undefined ? 'dim' : ''}">${effective}mm</span>`
            : html`<span class="width-value ${current === undefined ? 'dim' : ''}"
                >${s.colorNone}</span>`}
          <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
        </button>
      </div>
      ${open ? html`
        <div class="menu-backdrop" @click=${() => this._closePropertyMenu()}></div>
        <div class="preset-menu width-pop" role="menu" aria-label=${label}
          style="left:${this._propertyMenuPos.left}px;top:${this._propertyMenuPos.top}px;width:${this._propertyMenuPos.width}px;max-height:${this._propertyMenuPos.maxHeight}px">
          ${allowNone ? html`
            <button role="menuitem" aria-label="${label}: ${s.colorNone}"
              aria-pressed=${String(effective <= 0)}
              @click=${() => pick(0)}>
              <span class="width-value">${s.colorNone}</span>
            </button>` : nothing}
          ${steps.map((w) => html`
            <button role="menuitem" aria-label="${label}: ${w}mm"
              aria-pressed=${String(w === effective)}
              @click=${() => pick(w)}>
              <span class="width-line" style="border-top-width:${previewPx(w)}px"></span>
              <span class="width-value">${w}mm</span>
            </button>`)}
        </div>` : nothing}
    `;
  }

  /**
   * 실선, 파선, 점선 선택기를 선 미리보기와 함께 렌더링한다.
   * 실선은 기본값이므로 `null`로 적용한다.
   *
   * @param current - 명시된 형태 (미지정이면 실선)
   * @param ariaLabel - 보조기기용 이름 (요소·셀 구분)
   * @param key - 펼침 상태를 구분할 키
   * @param apply - 고른 값을 저장하는 콜백
   */
  private _renderBorderShapeRow(
    current: 'solid' | 'dashed' | 'dotted' | undefined,
    ariaLabel: string,
    key: string,
    apply: (value: 'dashed' | 'dotted' | null) => void,
  ) {
    const s = this._strings.designer;
    const effective = current ?? 'solid';
    const open = this._openPopKey === key;
    const shapes = [
      ['solid', s.borderSolid],
      ['dashed', s.borderDashed],
      ['dotted', s.borderDotted],
    ] as const;
    const labelOf = (shape: 'solid' | 'dashed' | 'dotted'): string =>
      shapes.find(([value]) => value === shape)![1];
    const pick = (shape: 'solid' | 'dashed' | 'dotted'): void => {
      this._openPopKey = null;
      apply(shape === 'solid' ? null : shape);
    };

    return html`
      <div class="prop-row">
        <label>${s.borderShape}</label>
        <button class="width-btn" aria-label=${ariaLabel} aria-haspopup="menu"
          aria-expanded=${String(open)}
          @click=${(event: Event) => this._togglePropertyMenu(key, event)}>
          <span class="shape-line shape-${effective}"></span>
          <span class="width-value ${current === undefined ? 'dim' : ''}">${labelOf(effective)}</span>
          <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
        </button>
      </div>
      ${open ? html`
        <div class="menu-backdrop" @click=${() => this._closePropertyMenu()}></div>
        <div class="preset-menu width-pop" role="menu" aria-label=${ariaLabel}
          style="left:${this._propertyMenuPos.left}px;top:${this._propertyMenuPos.top}px;width:${this._propertyMenuPos.width}px;max-height:${this._propertyMenuPos.maxHeight}px">
          ${shapes.map(([value, label]) => html`
            <button role="menuitem" aria-label="${ariaLabel}: ${label}"
              aria-pressed=${String(value === effective)}
              @click=${() => pick(value)}>
              <span class="shape-line shape-${value}"></span>
              <span class="width-value">${label}</span>
            </button>`)}
        </div>` : nothing}
    `;
  }

  /**
   * 요소 종류에 따라 사용할 수 있는 텍스트, 배경, 테두리 스타일을 렌더링한다.
   */
  private _renderStyleGroups(el: SlipElement) {
    if (el.type === 'image') return nothing;
    const s = this._strings.designer;
    const r = el as Record<string, unknown>;
    const hasFontColor = el.type === 'text' || el.type === 'field' || el.type === 'grid';
    const hasTextDecor = el.type === 'text' || el.type === 'field';
    const hasBackground = el.type !== 'line';
    // 선 요소에는 선 색상과 형태를 표시하고 굵기는 크기 입력에서 편집한다.
    const isLine = el.type === 'line';
    // 파선과 점선은 직선 테두리를 사용하는 요소에만 지원한다.
    const hasBorderShape = el.type === 'line' || el.type === 'rect' || el.type === 'grid';
    // 텍스트와 필드는 기본 테두리가 없고 나머지 요소는 기본 굵기를 사용한다.
    const defaultWidth = el.type === 'text' || el.type === 'field' ? 0 : DEFAULT_LINE_WIDTH;

    return html`
      ${hasFontColor ? html`
        <div class="prop-section">
          <div class="prop-section-title">${s.styleText}</div>
          ${this._renderColorControl(
            s.fontColor, r.fontColor as string | undefined, 'fontColor', undefined, DEFAULT_FONT_COLOR,
          )}
          ${el.type === 'grid'
            ? this._renderGridOverflowRow({
                id: 'grid-overflow',
                value: el.overflow ?? 'clip',
                onPick: (value) => this._updateElement((target) => {
                  if (target.type !== 'grid') return;
                  if (value === 'clip') delete target.overflow;
                  else if (value === 'shrink') target.overflow = value;
                }),
              })
            : nothing}
          ${hasTextDecor ? this._renderFontProps(el) : nothing}
          ${hasTextDecor
            ? this._renderTextStyleToggles(
                el as { bold?: boolean; underline?: boolean; strikethrough?: boolean },
                (key, value) => this._updateElement((target) =>
                  setOptional(target, key, value ? true : null)),
              )
            : nothing}
        </div>` : nothing}
      ${hasBackground ? html`
        <div class="prop-section">
          <div class="prop-section-title">${s.styleBackground}</div>
          ${this._renderColorControl(s.backgroundColor, r.backgroundColor as string | undefined, 'backgroundColor')}
        </div>` : nothing}
      <div class="prop-section">
        <div class="prop-section-title">${isLine ? s.styleLine : s.styleBorder}</div>
        ${this._renderColorControl(
          isLine ? s.lineColor : s.borderColor,
          r.borderColor as string | undefined, 'borderColor', undefined, DEFAULT_BORDER_COLOR,
        )}
        ${isLine ? nothing : this._renderBorderWidthSelect(
          r.borderWidth as number | undefined,
          defaultWidth,
          true,
          'borderWidth',
          // 텍스트와 필드의 0 굵기는 기본값이므로 파일에 저장하지 않는다.
          (v) => this._updateElement((target) =>
            setOptional(target, 'borderWidth', v === 0 && defaultWidth === 0 ? null : v)),
        )}
        ${hasBorderShape
          ? this._renderBorderShapeRow(
              r.borderStyle as 'solid' | 'dashed' | 'dotted' | undefined,
              isLine ? s.lineShape : `${s.styleBorder} ${s.borderShape}`,
              'borderStyle',
              (v) => this._updateElement((target) => {
                const t = target as Record<string, unknown>;
                if (v === null) delete t.borderStyle;
                else {
                  t.borderStyle = v;
                  // 모서리 반경은 파선 또는 점선과 함께 사용할 수 없다.
                  if (target.type === 'rect') delete t.radius;
                }
              }),
            )
          : nothing}
        ${el.type === 'rect' ? html`
          <div class="prop-row">
            <label>${s.cornerRadius}</label>
            <input type="number" step="0.5" min="0" class=${el.radius === undefined ? 'dim' : ''}
              .value=${String(el.radius ?? '')} placeholder="0"
              aria-label=${s.cornerRadius}
              aria-invalid=${String(this._hasInputError('corner-radius'))}
              aria-describedby=${this._hasInputError('corner-radius') ? 'error-corner-radius' : nothing}
              ?disabled=${el.borderStyle === 'dashed' || el.borderStyle === 'dotted'}
              @change=${(e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isNaN(v) || v < 0) {
                  this._rejectInput(
                    Number.isNaN(v) ? s.numberInput : s.nonNegativeInput,
                    'corner-radius',
                  );
                  return;
                }
                this._updateElement((target) => {
                  if (target.type !== 'rect') return;
                  setOptional(target, 'radius', v > 0 ? v : null);
                });
              }}>
          </div>
          ${this._renderInputError('corner-radius')}` : nothing}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // 모달 렌더링
  // ---------------------------------------------------------------------------

  /** 파라미터의 키와 표시 이름을 반환한다. */
  private _collectParameters(): { key: string; label: string }[] {
    return this._parameterList().map((b) => ({ key: b.key, label: b.label }));
  }

  /** 바이트 수를 오류 메시지에 표시할 단위로 변환한다. */
  private static _formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${bytes}B`;
  }

  /**
   * 모든 페이지에서 사용 중인 고정 이미지를 중복 없이 반환한다.
   * 기본 투명 이미지는 제외한다.
   */
  private _usedImages(): string[] {
    const file = this._file;
    if (!file) return [];
    const seen = new Set<string>();
    for (const page of file.template.pages) {
      for (const el of page.elements) {
        if (el.type !== 'image') continue;
        if (el.src === undefined || el.src === PLACEHOLDER_IMG || !el.src.startsWith('data:')) continue;
        seen.add(el.src);
      }
    }
    return [...seen];
  }

  /** 이미지 선택 모달을 연다. */
  private _openImageModal(): void {
    this._imageError = null;
    this._imageModalOpen = true;
  }

  private _closeImageModal(): void {
    this._imageModalOpen = false;
    this._imageError = null;
  }

  /** 선택한 이미지를 현재 이미지 요소에 적용하고 모달을 닫는다. */
  private _applyImageSrc(src: string): void {
    this._updateElement((target) => {
      if (target.type === 'image') target.src = src;
    });
    this._closeImageModal();
  }

  /**
   * 파일 선택 대화 상자에서 이미지를 선택하고 base64로 변환해 적용한다.
   * 외부 URL은 지원하지 않으며 호스트가 base64로 변환해 전달해야 한다.
   */
  private async _pickImageFile(): Promise<void> {
    const result = await pickImageFile(this.maxImageBytes);
    if (result.ok) {
      this._imageError = null;
      this._applyImageSrc(result.src);
      return;
    }
    this._imageError = this._imagePickErrorText(result);
    this.requestUpdate();
  }

  /** 이미지 선택 실패 사유를 디자이너 오류 메시지로 변환한다. */
  private _imagePickErrorText(
    result: { ok: false; reason: 'notImage' | 'tooLarge'; size: number } | { ok: false; reason: 'readFailed' },
  ): string {
    const s = this._strings.designer;
    if (result.reason === 'notImage') return s.imageNotImage;
    if (result.reason === 'readFailed') return s.imageReadFailed;
    return s.imageTooLarge
      .replace('{max}', formatBytes(this.maxImageBytes))
      .replace('{size}', formatBytes(result.size));
  }

  /**
   * 이미지 요소가 참조하거나 이미지 종류로 정의된 파라미터 키를 반환한다.
   */
  private _imageParameterKeys(): Set<string> {
    const file = this._file;
    const keys = new Set<string>();
    if (!file) return keys;
    for (const def of file.template.parameters ?? []) {
      if (def.valueType === 'image') keys.add(def.key);
    }
    for (const page of file.template.pages) {
      for (const el of page.elements) {
        if (el.type === 'image' && el.parameter !== undefined) keys.add(el.parameter);
      }
    }
    return keys;
  }

  /** 샘플 데이터의 이미지 값을 파일에서 선택해 저장한다. */
  private async _pickSampleImage(key: string): Promise<void> {
    const result = await pickImageFile(this.maxImageBytes);
    if (result.ok) {
      this._sampleImageError = null;
      this._setSampleValue(key, result.src);
      return;
    }
    this._sampleImageError = this._imagePickErrorText(result);
    this.requestUpdate();
  }

  /** 선택한 필드의 수식으로 수식 편집 모달을 연다. */
  private _openFormulaModal(): void {
    const el = this._findSelectedElement();
    if (!el || el.type !== 'field') return;
    this._formulaDraft = el.formula ?? '';
    this._formulaModalOpen = true;
    this.requestUpdate();
  }

  private _closeFormulaModal(): void {
    this._formulaModalOpen = false;
    this.requestUpdate();
  }

  /** 수식 편집 값을 선택한 필드에 적용한다. 빈 값이면 수식을 제거한다. */
  private _applyFormulaModal(): void {
    const draft = this._formulaDraft.trim();
    this._formulaModalOpen = false;
    this._updateElement((el) => {
      if (el.type !== 'field') return;
      setOptional(el, 'formula', draft || null);
    });
  }

  /** 수식 입력의 커서 위치에 앞뒤 텍스트를 삽입한다. */
  private _insertFormulaText(text: string, after = ''): void {
    const input = this.renderRoot.querySelector('.formula-input') as HTMLTextAreaElement | null;
    const draft = this._formulaDraft;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    this._formulaDraft = draft.slice(0, start) + text + after + draft.slice(end);
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const next = this.renderRoot.querySelector('.formula-input') as HTMLTextAreaElement | null;
      if (next) {
        next.focus();
        const caret = start + text.length;
        next.setSelectionRange(caret, caret);
        this._formulaCaret = caret;
      }
    });
  }

  /** 수식 입력의 현재 커서 위치 */
  private _formulaCaret = 0;

  /** 수식 입력의 커서 위치를 갱신한다. */
  private _syncFormulaCaret(e: Event): void {
    const caret = (e.target as HTMLTextAreaElement).selectionStart;
    if (caret === this._formulaCaret) return;
    this._formulaCaret = caret;
    this.requestUpdate();
  }

  /**
   * 커서 앞의 `목록파라미터.필드` 입력에 맞는 하위 필드를 제안한다.
   *
   * @returns 제안할 필드 목록과 이미 입력한 글자 수
   */
  private _columnSuggestion(): {
    columns: { key: string; title: string }[];
    typedLength: number;
  } | null {
    const caret = Math.min(this._formulaCaret, this._formulaDraft.length);
    const before = this._formulaDraft.slice(0, caret);
    const match = /([A-Za-z0-9_가-힣]+)\.([A-Za-z0-9_가-힣]*)$/.exec(before);
    if (!match) return null;

    const target = this._parameterList().find((b) => b.key === match[1] && b.fields.length > 0);
    if (!target) return null;
    const typed = match[2] ?? '';
    const columns = target.fields
      .filter((field) => field.key.toLowerCase().startsWith(typed.toLowerCase()))
      .map((field) => ({ key: field.key, title: field.title }));
    return columns.length > 0 ? { columns, typedLength: typed.length } : null;
  }

  /** 목록 파라미터의 하위 필드 자동완성 항목을 렌더링한다. */
  private _renderColumnSuggestions() {
    const suggestion = this._columnSuggestion();
    if (!suggestion) return nothing;
    const s = this._strings.designer;

    return html`
      <div class="formula-suggest" role="group" aria-label=${s.formulaColumnSuggest}>
        <span class="formula-suggest-label">${s.formulaColumnSuggest}</span>
        ${suggestion.columns.map((col) => html`
          <button class="parameter-chip column" title=${col.key}
            @click=${() => this._insertFormulaText(col.key.slice(suggestion.typedLength))}
            >${col.title ? `${col.title} · ${col.key}` : col.key}</button>`)}
      </div>
    `;
  }

  /** 문법 검사, 샘플 계산, 파라미터 및 함수 삽입을 제공하는 수식 모달을 렌더링한다. */
  private _renderFormulaModal() {
    if (!this._formulaModalOpen) return nothing;
    const el = this._findSelectedElement();
    if (!el || el.type !== 'field') return nothing;
    const s = this._strings.designer;
    const draft = this._formulaDraft;

    let syntaxError: string | null = null;
    let preview: string | null = null;
    let previewError: string | null = null;
    if (draft.trim() !== '') {
      try {
        parseFormula(draft, this.locale === undefined ? undefined : { locale: this.locale });
        try {
          // 샘플 값이 없으면 파라미터 종류별 기본값으로 수식을 검사한다.
          preview = formulaPreviewText(
            evaluateFormula(draft, {
              values: this._formulaProbeValues(),
              ...(this.locale === undefined ? {} : { locale: this.locale }),
            }),
          );
        } catch (error) {
          // 계산 오류는 표시하되 문법이 유효한 수식은 적용할 수 있다.
          previewError = error instanceof Error ? error.message : String(error);
        }
      } catch (error) {
        syntaxError = error instanceof Error ? error.message : String(error);
      }
    }
    // 목록 파라미터의 하위 필드까지 표시하도록 사이드바와 같은 항목을 사용한다.
    const parameters = this._parameterList();

    return html`
      <div class="menu-backdrop modal-backdrop" @click=${() => this._closeFormulaModal()}></div>
      <div class="modal" role="dialog" aria-label=${s.formulaModalTitle}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            this._closeFormulaModal();
          }
        }}>
        <div class="modal-head">
          <span>${s.formulaModalTitle}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${() => this._closeFormulaModal()}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <textarea class="formula-input" rows="3" spellcheck="false"
            aria-label=${s.formula} .value=${draft}
            @input=${(e: Event) => {
              const input = e.target as HTMLTextAreaElement;
              this._formulaDraft = input.value;
              this._formulaCaret = input.selectionStart;
              this.requestUpdate();
            }}
            @keyup=${(e: Event) => this._syncFormulaCaret(e)}
            @click=${(e: Event) => this._syncFormulaCaret(e)}></textarea>
          <div class="formula-status ${syntaxError ? 'error' : ''}">
            ${syntaxError
              ? `${s.syntaxError}: ${syntaxError}`
              : draft.trim() === ''
                ? ''
                : previewError
                  ? `${s.previewUnavailable}: ${previewError}`
                  : `${s.previewResult}: ${preview}`}
          </div>
          ${this._renderColumnSuggestions()}
          <div class="formula-hint">${s.formulaQuoteHint}</div>
          ${parameters.length > 0
            ? html`
                <div class="modal-section-title">${s.formulaParameters}</div>
                <div class="parameter-chips">
                  ${parameters.map((b) => html`
                    <button class="parameter-chip" title="${b.key}${b.valueType ? ` (${b.valueType})` : ''}"
                      @click=${() => this._insertFormulaText(b.key)}>${b.label}${
                        b.valueType ? html`<span class="chip-type">${b.valueType}</span>` : nothing
                      }</button>
                    ${b.fields.map((field) => html`
                      <button class="parameter-chip column" title="${b.key}.${field.key}"
                        @click=${() => this._insertFormulaText(`${b.key}.${field.key}`)}
                        >${field.title}</button>`)}`)}
                </div>`
            : nothing}
          <div class="modal-section-title">${s.formulaFunctions}</div>
          ${getFormulaHelp(this.locale).map((category) => html`
            <div class="fn-category">${category.title}</div>
            ${category.functions.map((fn) => html`
              <button class="fn-row" aria-label=${fn.name}
                @click=${() => this._insertFormulaText(`${fn.name}(`, ')')}>
                <span class="fn-signature">${fn.signature}</span>
                <span class="fn-desc">${fn.description}</span>
              </button>`)}`)}
        </div>
        <div class="modal-foot">
          <button class="btn" @click=${() => this._closeFormulaModal()}>${s.cancel}</button>
          <button class="btn primary" ?disabled=${syntaxError !== null}
            @click=${() => this._applyFormulaModal()}>${s.apply}</button>
        </div>
      </div>
    `;
  }

  /**
   * 파일을 업로드하거나 양식에서 사용 중인 이미지를 선택하는 모달을 렌더링한다.
   * 이미지 값은 base64만 지원하므로 URL 입력은 제공하지 않는다.
   */
  private _renderImageModal() {
    if (!this._imageModalOpen) return nothing;
    const el = this._findSelectedElement();
    if (!el || el.type !== 'image') return nothing;
    const s = this._strings.designer;
    const close = (): void => this._closeImageModal();
    const used = this._usedImages();

    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-label=${s.imageModalTitle}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}>
        <div class="modal-head">
          <span>${s.imageModalTitle}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <button class="btn primary" @click=${() => this._pickImageFile()}>${s.imagePick}</button>
          <p class="image-hint">${s.imageSizeHint
            .replace('{max}', SlipDesigner._formatBytes(this.maxImageBytes))}</p>
          ${this._imageError
            ? html`<p class="image-error" role="alert">${this._imageError}</p>`
            : nothing}

          <div class="modal-section-title">${s.imageReuse}</div>
          ${used.length === 0
            ? html`<p class="image-hint">${s.imageEmptyReuse}</p>`
            : html`<div class="image-grid">
                ${used.map((src, i) => html`
                  <button class="image-choice ${src === el.src ? 'selected' : ''}"
                    aria-label="${s.imageReuse} ${i + 1}"
                    aria-pressed=${String(src === el.src)}
                    @click=${() => this._applyImageSrc(src)}>
                    <img src=${src} alt="">
                  </button>`)}
              </div>`}
        </div>
        <div class="modal-foot">
          <button class="btn" @click=${close}>${s.close}</button>
        </div>
      </div>
    `;
  }

  /** 샘플 값을 설정하고, 남은 값이 없으면 sampleValues를 제거한다. */
  private _setSampleValue(key: string, value: unknown): void {
    this._updateFile((f) => {
      const template = f.template;
      if (value === undefined || value === '') {
        if (template.sampleValues) {
          delete template.sampleValues[key];
          if (Object.keys(template.sampleValues).length === 0) {
            delete (template as { sampleValues?: unknown }).sampleValues;
          }
        }
      } else {
        (template.sampleValues ??= {})[key] = value as never;
      }
    });
  }

  /**
   * 파라미터별 샘플 데이터를 편집하는 모달을 렌더링한다.
   * 반복 파라미터는 그리드 열에 맞춰 행 단위로 편집한다.
   */
  private _renderSampleModal() {
    if (!this._sampleModalOpen || !this._file) return nothing;
    const s = this._strings.designer;
    const template = this._file.template;
    const samples: Record<string, unknown> = template.sampleValues ?? {};
    const close = (): void => {
      this._sampleModalOpen = false;
      this.requestUpdate();
    };

    // 반복 파라미터별 열 구조는 해당 파라미터를 처음 사용하는 그리드에서 가져온다.
    const tableOf = new Map<string, { key: string; title: string }[]>();
    for (const page of template.pages) {
      for (const el of page.elements) {
        if (el.type !== 'grid' || !el.repeat || tableOf.has(el.repeat.parameter)) continue;
        const { fromRow, toRow } = el.repeat;
        const fields: { key: string; title: string }[] = [];
        for (const cell of el.cells) {
          if (cell.row >= fromRow && cell.row <= toRow && cell.parameter !== undefined
            && !fields.some((f) => f.key === cell.parameter)) {
            fields.push({ key: cell.parameter, title: cell.parameter });
          }
        }
        if (fields.length > 0) tableOf.set(el.repeat.parameter, fields);
      }
    }
    const parameters = this._collectParameters();
    // 이미지 파라미터는 텍스트 입력 대신 파일 선택기를 사용한다.
    const imageKeys = this._imageParameterKeys();
    // 파라미터 입력을 일정한 개수로 나눠 표시한다.
    const pageCount = Math.max(1, Math.ceil(parameters.length / SAMPLE_PAGE_SIZE));
    const pageIndex = Math.min(this._samplePage, pageCount - 1);
    const visible = parameters.slice(
      pageIndex * SAMPLE_PAGE_SIZE,
      (pageIndex + 1) * SAMPLE_PAGE_SIZE,
    );

    // JSON 초안이 객체가 아니거나 구문이 잘못되면 적용 버튼을 비활성화한다.
    let jsonError: string | null = null;
    if (this._sampleJsonMode && this._sampleJsonDraft.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(this._sampleJsonDraft);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          jsonError = s.jsonNotObject;
        }
      } catch {
        jsonError = s.jsonInvalid;
      }
    }

    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal modal-wide" role="dialog" aria-label=${s.sampleModalTitle}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}>
        <div class="modal-head">
          <span>${s.sampleModalTitle}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="sample-tabs" role="tablist" aria-label=${s.sampleModalTitle}>
            ${([
              [false, s.formMode],
              [true, 'JSON'],
            ] as const).map(([jsonMode, label]) => html`
              <button role="tab" aria-selected=${String(this._sampleJsonMode === jsonMode)}
                aria-label="${s.sampleData}: ${label}"
                @click=${() => {
                  if (this._sampleJsonMode === jsonMode) return;
                  this._sampleJsonMode = jsonMode;
                  if (jsonMode) {
                    // 선언된 파라미터와 현재 샘플 값을 합쳐 JSON 초안을 만든다.
                    this._sampleJsonDraft = JSON.stringify(this._sampleSkeleton(), null, 2);
                  }
                  this.requestUpdate();
                }}>${label}</button>`)}
          </div>
          ${this._sampleJsonMode
            ? html`
                <div class="cell-hint">${s.jsonHint}</div>
                <textarea class="sample-json" rows="14" spellcheck="false"
                  aria-label="${s.sampleData} JSON"
                  .value=${this._sampleJsonDraft}
                  @input=${(e: Event) => {
                    this._sampleJsonDraft = (e.target as HTMLTextAreaElement).value;
                    this.requestUpdate();
                  }}></textarea>
                <div class="formula-status ${jsonError ? 'error' : ''}">
                  ${jsonError ? `${s.syntaxError}: ${jsonError}` : ''}
                </div>`
            : html`
                <div class="cell-hint">${s.sampleHint}</div>
                ${parameters.length === 0 ? html`<div class="side-empty">—</div>` : nothing}
                ${pageCount > 1
                  ? html`
                      <div class="sample-pager">
                        <button class="side-mini" title=${s.prevPage}
                          aria-label="${s.sampleData} ${s.prevPage}"
                          ?disabled=${pageIndex === 0}
                          @click=${() => {
                            this._samplePage = pageIndex - 1;
                            this.requestUpdate();
                          }}>${icons.pagePrev}</button>
                        ${Array.from({ length: pageCount }, (_, i) => html`
                          <button class="page-btn"
                            aria-label="${s.sampleData} ${s.sidebarPages} ${i + 1}"
                            aria-pressed=${String(i === pageIndex)}
                            @click=${() => {
                              this._samplePage = i;
                              this.requestUpdate();
                            }}>${i + 1}</button>`)}
                        <button class="side-mini" title=${s.nextPage}
                          aria-label="${s.sampleData} ${s.nextPage}"
                          ?disabled=${pageIndex >= pageCount - 1}
                          @click=${() => {
                            this._samplePage = pageIndex + 1;
                            this.requestUpdate();
                          }}>${icons.pageNext}</button>
                      </div>`
                  : nothing}
                ${this._sampleImageError
                  ? html`<p class="image-error" role="alert">${this._sampleImageError}</p>`
                  : nothing}
                ${visible.map((b) => {
                  const columns = tableOf.get(b.key);
                  if (columns) return this._renderSampleTable(b, columns, samples[b.key]);
                  if (imageKeys.has(b.key)) return this._renderSampleImage(b, samples[b.key]);
                  return html`
                    <div class="prop-row">
                      <label title=${b.key}>${b.label}</label>
                      <input .value=${sampleScalarText(samples[b.key])}
                        aria-label="${s.sampleData} ${b.key}"
                        @change=${(e: Event) =>
                          this._setSampleValue(b.key, parseSampleScalar((e.target as HTMLInputElement).value))}>
                    </div>`;
                })}`}
        </div>
        <div class="modal-foot">
          ${this._sampleJsonMode
            ? html`<button class="btn primary" ?disabled=${jsonError !== null}
                @click=${() => this._applySampleJson()}>${s.apply}</button>`
            : nothing}
          <button class="btn ${this._sampleJsonMode ? '' : 'primary'}" @click=${close}>
            ${s.close}
          </button>
        </div>
      </div>
    `;
  }

  /** JSON 초안을 sampleValues에 반영하고, 빈 객체이면 sampleValues를 제거한다. */
  private _applySampleJson(): void {
    let parsed: unknown = {};
    const draft = this._sampleJsonDraft.trim();
    if (draft !== '') {
      try {
        parsed = JSON.parse(draft);
      } catch {
        return;
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    const record = parsed as Record<string, unknown>;
    this._updateFile((f) => {
      if (Object.keys(record).length === 0) {
        delete (f.template as { sampleValues?: unknown }).sampleValues;
      } else {
        f.template.sampleValues = record as never;
      }
    });
  }

  /** 이미지 파라미터의 샘플 파일을 선택하고 미리보기를 표시한다. */
  private _renderSampleImage(b: { key: string; label: string }, raw: unknown) {
    const s = this._strings.designer;
    const chosen = typeof raw === 'string' && raw.startsWith('data:');
    return html`
      <div class="prop-row sample-image">
        <label title=${b.key}>${b.label}</label>
        <div class="sample-image-body">
          ${chosen
            ? html`<div class="image-current"><img src=${raw as string} alt=""></div>`
            : html`<p class="image-hint">${s.imageNone}</p>`}
          <div class="sample-image-btns">
            <button class="col-modal-open" aria-label="${b.label} ${s.imagePick}"
              @click=${() => this._pickSampleImage(b.key)}>
              ${icons.image}<span>${chosen ? s.imageChange : s.imagePick}</span>
            </button>
            ${chosen
              ? html`<button class="side-mini" title=${s.imageClear}
                  aria-label="${b.label} ${s.imageClear}"
                  @click=${() => this._setSampleValue(b.key, undefined)}>${icons.close}</button>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }

  /** 반복 파라미터의 샘플 행을 열 구조에 맞춰 편집한다. */
  private _renderSampleTable(
    b: { key: string; label: string },
    columns: { key: string; title: string }[],
    raw: unknown,
  ) {
    const s = this._strings.designer;
    const rows = Array.isArray(raw)
      ? raw.filter(
          (r): r is Record<string, unknown> =>
            typeof r === 'object' && r !== null && !Array.isArray(r),
        )
      : [];
    const commitRows = (next: Record<string, unknown>[]): void =>
      this._setSampleValue(b.key, next.length > 0 ? next : undefined);
    return html`
      <div class="modal-section-title" title=${b.key}>${b.label}</div>
      <div class="sample-scroll">
        <div class="sample-grid"
          style="grid-template-columns:repeat(${columns.length}, minmax(90px, 1fr)) 22px">
          ${columns.map((col) => html`<span class="sample-col">${col.title || col.key}</span>`)}
          <span></span>
          ${rows.map((row, rowIndex) => html`
            ${columns.map((col) => html`
              <input .value=${sampleScalarText(row[col.key])}
                aria-label="${b.key} ${rowIndex + 1} ${col.key}"
                @change=${(e: Event) => {
                  const next = rows.map((r) => ({ ...r }));
                  const text = (e.target as HTMLInputElement).value;
                  if (text === '') delete next[rowIndex]![col.key];
                  else next[rowIndex]![col.key] = parseSampleScalar(text);
                  commitRows(next);
                }}>`)}
            <button class="col-remove" title=${s.delete}
              aria-label="${b.key} ${rowIndex + 1} ${s.delete}"
              @click=${() => commitRows(rows.filter((_, i) => i !== rowIndex).map((r) => ({ ...r })))}>
              ${icons.pageRemove}
            </button>`)}
        </div>
      </div>
      <button class="col-add" aria-label="${b.key} ${s.addRow}"
        @click=${() => commitRows([...rows.map((r) => ({ ...r })), {}])}>
        ${icons.pageAdd}<span>${s.addRow}</span>
      </button>
    `;
  }

  // ---------------------------------------------------------------------------
  // 내 양식 저장 및 불러오기
  // ---------------------------------------------------------------------------

  /** 현재 양식 제목으로 저장 모달을 연다. */
  private _openSaveModal(): void {
    if (!this._file) return;
    this._saveTitle = this._file.template.meta.title;
    this._saveAsNew = false;
    this._myFormsError = null;
    this._saveModalOpen = true;
    this.requestUpdate();
  }

  /**
   * 입력한 제목을 양식에 반영하고 저장소에 저장한다.
   * 새 양식으로 저장하지 않는 한 기존 저장 ID를 재사용한다.
   */
  private async _confirmSave(): Promise<void> {
    const adapter = this.storage;
    if (!adapter || !this._file) return;
    const title = this._saveTitle.trim();
    // 빈 제목은 스키마 제약을 충족하지 않으므로 저장하지 않는다.
    if (!title) {
      this._rejectInput();
      return;
    }
    if (title !== this._file.template.meta.title) {
      this._updateFile((f) => {
        f.template.meta.title = title;
      });
    }
    const id = this._saveAsNew || !this._savedId ? crypto.randomUUID() : this._savedId;
    try {
      await adapter.save(id, structuredClone(this._file) as SlipFile);
    } catch (error) {
      this._myFormsError = error instanceof Error ? error.message : String(error);
      this.requestUpdate();
      return;
    }
    this._savedId = id;
    this._saveModalOpen = false;
    this._savedNotice = true;
    this.requestUpdate();
  }

  /** 저장된 양식의 메타데이터를 불러와 목록 모달을 연다. */
  private async _openMyForms(): Promise<void> {
    this._myFormsOpen = true;
    this._myFormsQuery = '';
    this._myFormsPage = 0;
    this.requestUpdate();
    await this._loadMyForms();
  }

  /**
   * 저장된 양식의 메타데이터를 모두 불러온다.
   * 검색과 페이지 이동은 이 목록을 사용하며 양식 본문은 불러오지 않는다.
   */
  private async _loadMyForms(): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    this._myFormsError = null;
    try {
      const items: SlipListItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await adapter.list({ kind: 'template' }, cursor);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      this._myFormItems = items;
    } catch (error) {
      this._myFormItems = [];
      this._myFormsError = error instanceof Error ? error.message : String(error);
    }
    this._myFormsPage = 0;
    this.requestUpdate();
  }

  /** 제목에 검색어가 포함된 양식 목록을 반환한다. */
  private _filteredMyForms(): SlipListItem[] {
    const query = this._myFormsQuery.trim().toLowerCase();
    if (!query) return this._myFormItems;
    return this._myFormItems.filter((item) => item.title.toLowerCase().includes(query));
  }

  /** 선택한 양식을 편집기에 불러오고 이전 상태를 실행 취소 기록에 추가한다. */
  private async _loadMyForm(id: string): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    let file: SlipFile;
    try {
      file = await adapter.load(id);
    } catch (error) {
      this._myFormsError = error instanceof Error ? error.message : String(error);
      this.requestUpdate();
      return;
    }
    if (file.kind !== 'template') {
      this._myFormsError = this._strings.designer.onlyTemplate;
      this.requestUpdate();
      return;
    }
    this._pushUndo();
    this._file = file;
    this._savedId = id;
    this._clearSelection();
    this._sideSelection = null;
    this._selectedCell = null;
    this._cellEditing = false;
    this._pageIndex = 0;
    this._previewMode = false;
    this._myFormsOpen = false;
    this._savedNotice = false;
    this._emitChange();
    this.requestUpdate();
  }

  /** 선택한 양식을 삭제하고 현재 양식의 저장 ID를 갱신한다. */
  private async _deleteMyForm(id: string): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    try {
      await adapter.delete(id);
    } catch (error) {
      this._myFormsError = error instanceof Error ? error.message : String(error);
      this.requestUpdate();
      return;
    }
    if (this._savedId === id) this._savedId = null;
    this._myFormItems = this._myFormItems.filter((item) => item.id !== id);
    // 현재 페이지가 목록 범위를 벗어나면 마지막 유효 페이지로 이동한다.
    const lastPage = Math.max(0, Math.ceil(this._filteredMyForms().length / MY_FORMS_PAGE_SIZE) - 1);
    if (this._myFormsPage > lastPage) this._myFormsPage = lastPage;
    this.requestUpdate();
  }

  /** 양식 제목과 새 저장 여부를 입력하는 저장 모달을 렌더링한다. */
  private _renderSaveModal() {
    if (!this._saveModalOpen || !this._file) return nothing;
    const s = this._strings.designer;
    const close = (): void => {
      this._saveModalOpen = false;
      this.requestUpdate();
    };
    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-label=${s.saveAsMyForm}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}>
        <div class="modal-head">
          <span>${s.saveAsMyForm}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="prop-row">
            <label>${s.formTitle}</label>
            <input class="save-title" .value=${this._saveTitle} aria-label=${s.formTitle}
              @input=${(e: Event) => {
                this._saveTitle = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') void this._confirmSave();
              }}>
          </div>
          ${this._savedId
            ? html`
                <label class="save-as-new">
                  <input type="checkbox" .checked=${this._saveAsNew} aria-label=${s.saveAsNew}
                    @change=${(e: Event) => {
                      this._saveAsNew = (e.target as HTMLInputElement).checked;
                      this.requestUpdate();
                    }}>
                  <span>${s.saveAsNew}</span>
                </label>`
            : nothing}
          ${this._myFormsError
            ? html`<div class="formula-status error">${this._myFormsError}</div>`
            : nothing}
        </div>
        <div class="modal-foot">
          <button class="btn" @click=${close}>${s.cancel}</button>
          <button class="btn primary" @click=${() => void this._confirmSave()}>${s.save}</button>
        </div>
      </div>
    `;
  }

  /** 저장된 양식을 검색하고 불러오거나 삭제하는 모달을 렌더링한다. */
  private _renderMyFormsModal() {
    if (!this._myFormsOpen) return nothing;
    const s = this._strings.designer;
    const close = (): void => {
      this._myFormsOpen = false;
      this.requestUpdate();
    };
    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-label=${s.myFormsList}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}>
        <div class="modal-head">
          <span>${s.myFormsList}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="prop-row">
            <label>${s.search}</label>
            <input class="forms-search" .value=${this._myFormsQuery} aria-label=${s.search}
              @input=${(e: Event) => {
                this._myFormsQuery = (e.target as HTMLInputElement).value;
                this._myFormsPage = 0;
                this.requestUpdate();
              }}>
          </div>
          ${this._myFormsError
            ? html`<div class="formula-status error">${this._myFormsError}</div>`
            : nothing}
          ${this._renderMyFormsPage()}
        </div>
        <div class="modal-foot">
          <button class="btn primary" @click=${close}>${s.close}</button>
        </div>
      </div>
    `;
  }

  /** 검색 결과를 페이지 단위로 나눠 목록 모달에 렌더링한다. */
  private _renderMyFormsPage() {
    const s = this._strings.designer;
    const filtered = this._filteredMyForms();
    if (filtered.length === 0) {
      return this._myFormsError ? nothing : html`<div class="side-empty">${s.noSavedForms}</div>`;
    }
    const pageCount = Math.ceil(filtered.length / MY_FORMS_PAGE_SIZE);
    const page = Math.min(this._myFormsPage, pageCount - 1);
    const items = filtered.slice(page * MY_FORMS_PAGE_SIZE, (page + 1) * MY_FORMS_PAGE_SIZE);
    return html`
      ${items.map((item) => html`
        <div class="form-row">
          <button class="form-open" aria-label="${item.title} ${s.edit}"
            @click=${() => void this._loadMyForm(item.id)}>
            <span class="form-title">${item.title}</span>
            ${item.updatedAt
              ? html`<span class="form-date">${item.updatedAt.slice(0, 10)}</span>`
              : nothing}
          </button>
          <button class="col-remove" title=${s.delete} aria-label="${item.title} ${s.delete}"
            @click=${() => void this._deleteMyForm(item.id)}>${icons.remove}</button>
        </div>`)}
      ${pageCount > 1
        ? html`
          <div class="sample-pager">
            <button class="side-mini" title=${s.prevPage} aria-label="${s.myFormsList} ${s.prevPage}"
              ?disabled=${page === 0}
              @click=${() => { this._myFormsPage = page - 1; this.requestUpdate(); }}>${icons.pagePrev}</button>
            ${Array.from({ length: pageCount }, (_, i) => html`
              <button class="page-btn" aria-label="${s.myFormsList} ${s.sidebarPages} ${i + 1}"
                aria-pressed=${String(i === page)}
                @click=${() => { this._myFormsPage = i; this.requestUpdate(); }}>${i + 1}</button>`)}
            <button class="side-mini" title=${s.nextPage} aria-label="${s.myFormsList} ${s.nextPage}"
              ?disabled=${page >= pageCount - 1}
              @click=${() => { this._myFormsPage = page + 1; this.requestUpdate(); }}>${icons.pageNext}</button>
          </div>`
        : nothing}
    `;
  }
}

/** 숫자 형식의 샘플 입력은 숫자로, 나머지는 문자열로 반환한다. */
function parseSampleScalar(text: string): string | number {
  const trimmed = text.trim();
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/** 스칼라 샘플 값을 입력 요소에 표시할 문자열로 변환한다. */
function sampleScalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** 수식 계산 결과를 미리보기용 문자열로 변환한다. */
function formulaPreviewText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

customElements.define('slip-designer', SlipDesigner);

declare global {
  interface HTMLElementTagNameMap {
    'slip-designer': SlipDesigner;
  }
}
