import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
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
  type BindingValueType,
  type SlipPage,
  type RenderOptions,
  type SlipListItem,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { getFormulaHelp } from './formula-help.js';
import { resolveFonts, type SlipDesignerSettings, type PaperSize } from './settings.js';
import { presets, type SlipPreset } from './presets.js';
import { icons } from './icons.js';
import { pickImageFile, formatBytes } from './image-file.js';

/** 색 피커의 팔레트 견본 — 전표에서 자주 쓰는 색 위주 */
const COLOR_PALETTE = [
  '#000000', '#ffffff', '#f2f2f2', '#d93025', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
] as const;

/** 사용자가 저장한 자주 쓰는 색의 localStorage 키 */
const CUSTOM_COLORS_KEY = 'slipkit-designer-custom-colors';
/** 파라미터 선택 상자의 "새 값 등록" 항목 값 — 물리명으로 쓸 수 없는 문자라 겹치지 않는다 */
const NEW_BINDING_OPTION = '\u0000new';

/** 저장 가능한 커스텀 색 최대 개수 — 넘치면 가장 오래된 것부터 밀어낸다 */
const MAX_CUSTOM_COLORS = 30;

/** 저장된 커스텀 색 목록을 읽는다 (저장소를 못 쓰는 환경이면 빈 목록) */
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
 * 색을 커스텀 목록에 저장하고 갱신된 목록을 돌려준다.
 * 이미 있으면 맨 뒤로 옮기고(최근 사용), 30개가 넘으면 가장 오래된 것을 밀어낸다.
 */
function saveCustomColor(color: string): string[] {
  const list = loadCustomColors().filter((c) => c !== color);
  list.push(color);
  while (list.length > MAX_CUSTOM_COLORS) list.shift();
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(list));
  } catch {
    // 저장 실패(용량·프라이빗 모드 등)해도 편집 자체는 계속되게 조용히 넘어간다
  }
  return list;
}

/** 용지 크기 프리셋 (mm, 세로 기준) — 선택하면 현재 방향을 유지한 채 적용된다 */
const PAPER_PRESETS = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'B5', width: 176, height: 250 },
  { name: 'Letter', width: 215.9, height: 279.4 },
] as const;

/**
 * 좌표 기준점 9점 (좌상~우하) — 속성 패널 X·Y의 표시·입력 기준.
 * 화면 차원 개념이라 파일에는 늘 좌상단 좌표로 저장된다 (포맷 불변).
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
 * 파라미터 값 종류 선택지 (ADR-047) — 빈 값은 "지정 없음"(글자로 다룬다)이다.
 * 종류를 지정하면 작성폼 입력 방식과 수식에서 받아들이는 타입이 정해진다 (ADR-044).
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

/** 하위 필드의 값 종류 선택지 — 항목은 평평한 객체라 목록은 고를 수 없다 (ADR-038/047) */
const BINDING_FIELD_VALUE_TYPES = BINDING_VALUE_TYPES.filter((t) => t.value !== 'list');

/** 테두리 굵기 선택지(mm) — 없음(0)과 이 단계들만 select로 제공한다 (C-11) */
const BORDER_WIDTH_STEPS = [0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2] as const;
/** 샘플 데이터 모달의 한 페이지에 보여줄 파라미터 수 (D-13) */
const SAMPLE_PAGE_SIZE = 10;
/** 스냅이 붙는 거리(mm) — 이 안으로 들어오면 후보 선에 끌어붙인다 */
const SNAP_MM = 1.5;

/** 눈금자 두께(px) — 캔버스 위·왼쪽에 붙는다 (F-20) */
const RULER_PX = 18;

/** 격자 간격 선택지(mm) — 없음은 별도 (F-20) */
const GRID_GAPS = [1, 5, 10] as const;

/**
 * 바코드 종류 표시 순서·이름 (G-33) — 전표에 흔한 QR·CODE128·EAN-13을 앞에 둔다.
 * 이름은 국제 표준의 고유명사라 로케일과 무관하게 같다(strings.ts로 옮기지 않는다).
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

/** 2차원 바코드 종류 — 캔버스 견본을 정사각 격자로 그린다 (G-33). 나머지는 막대 줄로 그린다 */
const BARCODE_2D: ReadonlySet<BarcodeKind> = new Set(['qrcode', 'gs1datamatrix']);

/**
 * 고정 값이 종류의 값 규칙에 어긋나는지 검사한다 (G-33, 편집 중 경고용).
 * 자리 수가 정해진 종류와 CODE39만 확실히 검사하고, 자유로운 종류(QR·CODE128 등)는 검사하지 않는다.
 * 파라미터·수식 값은 전표를 채울 때 정해지므로 이 함수로 검사하지 않는다.
 */
const BARCODE_DIGIT_RULES: Partial<Record<BarcodeKind, number>> = {
  ean13: 13, ean8: 8, upca: 12, itf14: 14,
};

/**
 * 격자 색 선택지 (F-20) — 양식에 회색 표가 많으면 회색 격자가 묻히므로 색으로 구분한다.
 * swatch는 메뉴 견본에 보이는 진한 색, line은 실제 격자선 색(옅게).
 */
const GRID_COLORS = [
  { id: 'gray', nameKey: 'colorGray', swatch: '#80868b', line: 'rgba(0, 0, 0, 0.08)' },
  { id: 'blue', nameKey: 'colorBlue', swatch: '#1a73e8', line: 'rgba(26, 115, 232, 0.2)' },
  { id: 'red', nameKey: 'colorRed', swatch: '#d93025', line: 'rgba(217, 48, 37, 0.16)' },
  { id: 'green', nameKey: 'colorGreen', swatch: '#188038', line: 'rgba(24, 128, 56, 0.16)' },
] as const;

/** 격자 색 선택지의 id */
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
 * 지정하지 않았을 때 PDF 변환 계층이 실제로 쓰는 값 (core `convert.ts`와 같은 값).
 * 속성 패널이 "지금 적용 중인 값"을 흐리게 보여줄 때 쓴다 (ADR-034).
 */
const DEFAULT_FONT_SIZE = 10;
const DEFAULT_FONT_COLOR = '#000000';
const DEFAULT_BORDER_COLOR = '#000000';
/** 선 굵기 기본값(mm) — PDF 변환 계층(convert.ts DEFAULT_BORDER_WIDTH)과 같아야 한다 */
const DEFAULT_LINE_WIDTH = 0.2;
/**
 * 넣을 수 있는 이미지 파일의 기본 최대 크기(바이트, 2MB) — 호스트가 `maxImageBytes`로 바꾼다 (G-36).
 * base64로 담기면 약 33% 커지므로 2MB 원본이 파일에는 ~2.7MB로 들어간다.
 */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** 사이드바 페이지 줄에 올렸을 때 뜨는 썸네일의 폭(px) (G-35) */
const THUMB_WIDTH_PX = 132;

/** 글자 크기(pt)를 화면 px로 — PDF와 같은 크기감 (1pt = 4/3px, 기본 10pt) */
function fontPx(size: number | undefined): string {
  return `${(((size ?? DEFAULT_FONT_SIZE) * 4) / 3).toFixed(2)}px`;
}

/** 정렬 값을 flex 정렬로 (기본 left — PDF 변환 기본값과 동일) */
function justifyOf(alignment: 'left' | 'center' | 'right' | undefined): string {
  return alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start';
}

/** 수직 정렬(top/middle/bottom)을 flexbox 정렬값으로 — 기본은 상단(flex-start) */
function verticalFlexAlign(v: 'top' | 'middle' | 'bottom' | undefined): string {
  return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
}

/**
 * 글자 스타일(굵게·밑줄·취소선·조판)을 CSS 조각으로 — 앞에 ;가 붙은 형태 (ADR-032).
 *
 * @param style - 요소·셀의 글자 스타일
 * @param opts - `omitVerticalAlign`이 true면 justify-content를 넣지 않는다. flex column인
 *   `.el-content`는 justify-content가 세로축이라 그대로 두지만, flex row인 그리드 칸은
 *   호출부가 세로 정렬을 align-items로 따로 넣으므로 여기서 justify-content를 빼야
 *   가로 정렬을 덮지 않는다 (ADR-012).
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
  // 수직 정렬은 flex column의 세로 배치로 (기본 상단), 글자 조판은 인라인 CSS로 그려 PDF와 맞춘다 (ADR-012)
  const verticalAlign = opts?.omitVerticalAlign
    ? ''
    : `;justify-content:${verticalFlexAlign(style.verticalAlignment)}`;
  // 기울임(italic)은 캔버스에 그리지 않는다 — PDF는 Italic 변형 폰트가 없으면 곧게 나오는데,
  // 브라우저는 없는 자형을 흉내 내 기울여 캔버스만 어긋난다(ADR-012). 화면·PDF 일치를 위해 넣지 않는다
  return (
    (style.bold === true ? ';font-weight:700' : '') +
    (decorations ? `;text-decoration:${decorations}` : '') +
    verticalAlign +
    (style.lineHeight !== undefined ? `;line-height:${style.lineHeight}` : '') +
    (style.characterSpacing !== undefined ? `;letter-spacing:${(style.characterSpacing * 4) / 3}px` : '')
    // 세로쓰기는 CSS writing-mode가 아니라 글자를 한 자씩 쌓아 그린다(stackVertically) — PDF와
    // 같은 문자열을 그려 긴 글의 열 넘김·줄바꿈 처리가 어긋나지 않는다 (ADR-012).
  );
}

/**
 * 요소·셀의 선택 필드를 설정하거나(값이 있으면) 지운다(null·undefined면).
 *
 * @remarks
 * 판별 유니온인 요소에 선택 스타일 필드를 쓰려면 캐스트로 타입을 벗겨야 하는데, 그 캐스트를
 * 이 한곳에 가둬 호출부는 타입 안전한 값 계산만 하게 한다 (스타일 편집 핸들러 공용).
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

/** 캔버스 도형의 파선·점선 근사 표시용 stroke-dasharray (px) — PDF 분해 렌더 패턴과 동일 비율 */
function dashArrayOf(style: 'solid' | 'dashed' | 'dotted' | undefined): string | undefined {
  if (style === 'dashed') return `${2.4 * PX_PER_MM} ${1.2 * PX_PER_MM}`;
  if (style === 'dotted') return `${0.4 * PX_PER_MM} ${0.8 * PX_PER_MM}`;
  return undefined;
}

/** 정다각형 꼭짓점(px) — PDF 변환(convert.ts polygonPoints)과 같은 상자 내접 규칙 */
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

/** 선 요소의 양 끝점(mm) — 선 방향에 따라 상자의 어느 모서리·중앙을 잇는지 정해진다 */
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

/** 열·행이 가질 수 있는 가장 작은 너비·높이 비율(%) — 이보다 좁아지지 않는다 */
const MIN_COLUMN_PERCENTAGE = 1;

/** 백분율을 소수점 둘째 자리로 반올림 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 마지막 항목을 절반씩 나눠 새 항목을 만든다 — 나머지 항목은 건드리지 않는다 (ADR-034).
 * 잔여 오차는 새 항목이 흡수해 합이 정확히 유지된다.
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
 * 항목 하나를 지우고 그 몫을 이웃이 돌려받는다 — 앞 항목이 있으면 앞, 없으면 뒤 (ADR-034).
 * 나머지 항목은 건드리지 않아 추가↔삭제가 정확히 원래대로 돌아온다.
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
 * 항목 수를 바꾼다 — 늘릴 때는 마지막을 절반씩 나누고, 줄일 때는 뒤에서부터 지워
 * 그 몫을 앞 항목이 돌려받는다. 손대지 않은 항목은 그대로라 되돌리면 원래 비율로 온다.
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
/** 디자이너에서 다룰 수 있는 그리드 행·열 수 상한 — 스키마 한도(SLIP_LIMITS)보다 낮은 편집 편의용 상한 */
const GRID_MAX_TRACKS_UI = 100;
/** 반복 구간 페이지당 항목 수 상한 (편집 입력 방어) */
const GRID_MAX_ITEMS_UI = 100_000;
const GRID_MAX_PER_PAGE_UI = 1000;
/** 요소를 새로 만들 때 겹치지 않게 계단식으로 미는 간격·되돌아오는 주기(mm) */
const NEW_ELEMENT_CASCADE_STEP_MM = 5;
const NEW_ELEMENT_CASCADE_WRAP_MM = 50;
/** "내 양식" 목록 모달의 한 페이지 항목 수 (번호 페이징) */
const MY_FORMS_PAGE_SIZE = 10;

/**
 * 열 너비·행 높이의 합으로 요소 상자를 다시 계산한다 — 스키마가 둘의 일치를 요구한다
 * (SPEC §5.7). 반복 구간은 화면·PDF에서 `perPage`번 복제되므로 높이에 그만큼 더한다.
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
 * 끌어서 만들거나 크기를 바꿨을 때 트랙을 새 상자에 맞춘다 — 트랙끼리의 비율은 지킨다.
 * 맞춘 뒤 상자를 트랙 합으로 되돌려 스키마 규칙을 정확히 지킨다.
 */
function syncGridTracks(el: GridElement): void {
  const scaled = (sizes: number[], target: number): number[] => {
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return sizes.map(() => Math.max(MIN_SIZE_MM, round1(target / sizes.length)));
    return sizes.map((size) => Math.max(MIN_SIZE_MM, round1((size / total) * target)));
  };
  el.columns = scaled(el.columns.map((column) => column.width), el.width).map((width) => ({ width }));

  // 행은 펼친 높이가 상자 높이가 되도록 줄인다 (반복 구간은 여러 벌로 보인다)
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

/** 트랙 크기(mm) 배열 → 누적 오프셋 (길이 = 트랙 수 + 1) */
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
 * 반복 구간 열의 이름 — 반복 구간 바로 위 행부터 거슬러 올라가며 같은 열에 직접 입력된 글을 찾는다.
 * 헤더에 적어 둔 이름을 그대로 쓰면 사이드바·수식 목록의 열 이름이 캔버스와 같아진다 (ADR-037).
 */
function gridHeaderTitle(grid: GridElement, column: number, fromRow: number): string | undefined {
  for (let row = fromRow - 1; row >= 0; row -= 1) {
    const cell = grid.cells.find((c) => c.row === row && c.column === column);
    if (cell?.content !== undefined && cell.content !== '') return cell.content;
  }
  return undefined;
}

/** 그 행이 반복 구간 안인지 (틀 좌표 기준) */
function inRepeatBand(el: GridElement, row: number): boolean {
  return el.repeat !== undefined && row >= el.repeat.fromRow && row <= el.repeat.toRow;
}

/** 행·열 수 */
function gridDims(el: GridElement): { rows: number; columns: number } {
  return { rows: el.rows.length, columns: el.columns.length };
}

/**
 * 캔버스에 그릴 행 높이(mm) 목록 — 반복 구간은 `perPage`번 펼친다.
 * 파일에는 틀 한 벌만 있고 화면·PDF에는 펼친 모습이 보인다 (SPEC §5.7).
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
 * 화면에 펼쳐진 행 번호 → 파일에 담긴 틀의 행 번호.
 * 반복 구간은 화면에 여러 벌 보이지만 파일에는 한 벌뿐이라, 어느 벌을 눌러도
 * 같은 틀 행을 가리켜야 한다 (ADR-037).
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

/** 틀의 행 번호 → 화면에서 그 행이 처음 나타나는 행 번호 */
function firstExpandedRowOf(el: GridElement, templateRow: number): number {
  if (!el.repeat) return templateRow;
  const { fromRow, toRow, perPage } = el.repeat;
  const bandRows = toRow - fromRow + 1;
  return templateRow > toRow ? templateRow + (perPage - 1) * bandRows : templateRow;
}

/** 그 자리의 셀을 찾고, 없으면 빈 셀을 만들어 돌려준다 */
function ensureCell(el: GridElement, row: number, column: number): Record<string, unknown> {
  const found = el.cells.find((c) => c.row === row && c.column === column);
  if (found) return found as unknown as Record<string, unknown>;
  const created: GridCell = { row, column, content: '' };
  el.cells.push(created);
  return created as unknown as Record<string, unknown>;
}

/**
 * 값 소스 배타 규칙 — content·binding·formula를 모두 지운다 (SPEC §5.6/§5.7).
 * 셀·바코드가 소스 종류를 바꿀 때 쓰며, 지운 뒤 호출부가 하나만 설정한다
 * (설정 방식은 대상마다 달라 여기서는 지우기만 한다).
 *
 * @param record - content·binding·formula를 가질 수 있는 셀 또는 요소
 */
function clearValueSources(record: { content?: unknown; binding?: unknown; formula?: unknown }): void {
  delete record.content;
  delete record.binding;
  delete record.formula;
}

/** #RRGGBB(AA) → HSV(h 0~360, s·v 0~1) — 색 피커 초기 위치 계산용 */
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

/** HSV(h 0~360, s·v 0~1) → #RRGGBB */
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

/** 캔버스 요소의 종류 배지 아이콘 — 툴바의 요소 추가 아이콘과 동일 */
const TYPE_BADGE: Record<SlipElement['type'], TemplateResult> = {
  text: icons.text,
  grid: icons.gridElement,
  image: icons.image,
  line: icons.line,
  rect: icons.shape,
  ellipse: icons.ellipse,
  polygon: icons.polygon,
  field: icons.field,
  // 바코드 요소 — 디자이너 도구는 G-33에서 붙인다. 배지는 밖에서 들어온 양식에도 필요하다
  barcode: icons.barcode,
};

interface DragState {
  id: string;
  startPxX: number;
  startPxY: number;
  origMmX: number;
  origMmY: number;
  /** 되돌리기용 스냅샷 — 첫 이동 때 만든다 (클릭만 한 경우 직렬화 비용을 내지 않도록) */
  snapshot: string | null;
  /** pointerdown 시점에 이미 선택돼 있던 요소인지 — 재클릭(셀 편집 진입) 판정용 */
  wasSelected: boolean;
  /** 함께 옮길 선택 요소들의 원래 위치 (그룹·다중 이동, G-27) */
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
  /** 되돌리기용 스냅샷 — 첫 크기 변경 때 만든다 */
  snapshot: string | null;
}

/**
 * 사이드바에서 요소가 아닌 것을 고른 상태 (ADR-034).
 *
 * 파라미터은 요소와 별개의 1급 항목이고, 표 열은 그 표 파라미터의 하위 항목이다.
 * 둘 다 오른쪽 패널에서 편집한다.
 */
/** 파라미터을 쓰는 요소 한 곳 (ADR-034의 "쓰는 곳") */
interface BindingUse {
  pageIndex: number;
  id: string;
  name: string;
  type: 'field' | 'grid' | 'image';
}

/** 사이드바·패널이 함께 쓰는 파라미터 한 항목 — 정의부와 사용처를 합친 것 */
interface BindingInfo {
  /** 물리명 — 전표 값의 키 */
  key: string;
  /** 화면에 보이는 이름 — 논리명이 없으면 물리명 */
  label: string;
  /** 정의부에 적힌 논리명 (없으면 undefined) */
  rawLabel: string | undefined;
  /** 값 종류 — 정의부에 없으면 undefined(글자로 다룬다) */
  valueType: BindingValueType | undefined;
  /** 정의부에 등록된 항목인지 (요소만 쓰는 키는 false) */
  defined: boolean;
  /** 이 값을 쓰는 요소들 */
  uses: BindingUse[];
  /** 목록 파라미터의 하위 필드 — 정의부가 단일 원천이다 (ADR-047) */
  fields: BindingFieldInfo[];
}

/**
 * 목록 파라미터의 하위 필드 한 개 (ADR-047) — 정의부에서 오며,
 * 그 필드를 읽는 그리드 칸이 있으면 그 자리도 함께 담아 사이드바에서 곧장 갈 수 있다.
 */
interface BindingFieldInfo {
  /** 항목 필드 물리명 — 수식에서 `목록파라미터.필드`로 쓴다 */
  key: string;
  /** 화면에 보일 이름 — 논리명이 없으면 물리명 */
  title: string;
  /** 정의부에 적힌 논리명 (없으면 undefined) */
  rawLabel: string | undefined;
  /** 값 종류 */
  valueType: BindingValueType | undefined;
  /** 정의부에 등록된 필드인지 — 그리드 칸만 쓰는 키는 false (옛 파일 호환) */
  defined: boolean;
  /** 이 필드를 읽는 그리드 칸의 자리 (없으면 undefined) */
  at: { pageIndex: number; gridId: string; row: number; column: number } | undefined;
}

type SideSelection =
  | { kind: 'binding'; key: string }
  | { kind: 'bindingField'; key: string; field: string }
  | { kind: 'page' }
  | null;

/**
 * <slip-designer> — 양식(.slip template) GUI 편집기 (ADR-020).
 *
 * 캔버스 편집(선택·드래그·크기 조절·스냅), 속성 패널, 요소 6종 추가·삭제,
 * 복사·붙여넣기, 되돌리기·다시 실행, 다중 페이지, 프리셋 불러오기, PDF 미리보기를
 * 제공한다. 편집으로 양식이 바뀔 때마다 `slip-change` 이벤트로 파일을 내보낸다.
 */
export class SlipDesigner extends LitElement {
  static styles = css`
    :host {
      /* 디자인 토큰 (ADR-031) — 색·모서리는 전부 여기서만 정의한다 */
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
      /* 테두리가 없는 요소의 자리를 알려 주는 편집 보조선 — 화면 전용(PDF에는 없다) */
      --sk-guide-faint: rgba(0, 0, 0, 0.15);
      --sk-danger: #c62828;
      --sk-radius: 4px;

      display: grid;
      grid-template-rows: auto 1fr;
      grid-template-columns: 176px 1fr 260px;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif;
      font-size: 13px;
      color: var(--sk-text);
      overflow: hidden;
    }

    /* 호스트가 hidden으로 감출 수 있게 한다 — :host의 display가 기본 규칙을 덮기 때문 */
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
    /*
     * 페이지 목록 (G-35) — 요소 목록과 같은 한 줄짜리 항목이다.
     * 썸네일을 그대로 세우면 한 장이 사이드바 폭만큼 높이를 먹어, 페이지가 늘면
     * 아래의 요소·값 목록이 화면 밖으로 밀린다. 줄에 올리거나 포커스가 갔을 때만 띄운다.
     */
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
    /* 사이드바 파라미터 관리 (D-13) — 제목 줄의 작은 버튼과 인라인 입력줄 */
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
    /* 요소 목록의 페이지 묶음 머리 — 현재 페이지만 펼친다 (ADR-034) */
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
    /* 현재 페이지지만 선택 대상은 아닐 때 — 이름만 강조 (G-46) */
    .page-row.current {
      font-weight: 600;
    }
    /*
     * 목록 줄 앞의 펼침 표시 (G-25) — 하위 줄이 있는 줄에만 나온다.
     * 하위가 없는 줄에는 같은 폭의 빈 자리(.side-twisty-gap)를 두어 이름이 나란히 시작한다.
     */
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
    /* 그리드 값의 반복 구간 필드 — 펼침 표시 아래로 한 단 들여 쓴다 (ADR-034/037, G-25) */
    /* 값 목록의 반복 구간 필드 하위 줄(.side-col-row)과 요소 목록의 그리드 칸 하위 줄
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
    /* 파라미터 패널의 "쓰는 곳" 한 줄 (ADR-034) */
    /* 칸 편집 중 그리드로 돌아가는 줄 — 지금 어느 그리드의 칸인지 보이게 한다 (ADR-034) */
    .grid-back {
      margin-bottom: 6px;
    }
    .grid-back svg:first-child {
      transform: rotate(180deg);
    }
    /* 패널에서 항목을 더하는 줄 — 사이드바 추가 버튼과 같은 결로 (ADR-047) */
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
    .side-add-field {
      color: var(--sk-muted);
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
      margin: 2px 0;
      padding: 4px 6px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      color: var(--sk-text);
      text-align: left;
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
    /* 샘플 데이터 모달의 행 편집 그리드 (D-13) — 열이 많으면 가로 스크롤 */
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
    /* 눈금자 + 용지 묶음 — 자와 용지가 함께 스크롤돼 눈금이 어긋나지 않는다 (F-20) */
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
    /* 격자 — 요소보다 뒤에 깔린다. 선 색·간격은 인라인 스타일로 (F-20) */
    .grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    /* 격자 색 견본 줄 — 격자가 켜져 있을 때만 메뉴에 보인다 (F-20) */
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
    /* 커서 좌표 — 캔버스 오른쪽 아래에 붙어 스크롤해도 자리를 지킨다 (F-20) */
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
    /* 페이지 번호 자리표시 (G-46) — 실제 번호는 PDF 후처리, 캔버스는 X / X만 */
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
     * 요소 종류 배지 — 평소에는 숨기고 마우스를 올리거나 고른 요소에만 보여준다.
     * 캔버스 글 위치를 PDF와 맞추려면 상자 안쪽 여백을 둘 수 없기 때문 (F-18).
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
    /* 바코드 견본 (G-33) — 격자·막대 그림 위에 종류·값을 겹쳐 보여준다 */
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
      /* PDF는 칸을 넘치는 글을 낱말 단위로 줄바꿈한다 — 캔버스도 같게 접어 화면·PDF를 맞춘다 (ADR-012).
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
    /* 선은 배지도 겹쳐 보여 지운다 — 선 자체가 곧 표식이다 */
    .element.type-line .badge {
      display: none;
    }
    .element.type-line {
      overflow: visible;
    }
    /*
     * 선은 상자보다 굵을 수 있다 — PDF는 상자 밖까지 그리므로(convert.ts appendLine이
     * 상자 가운데를 기준으로 굵기만큼 그린다) svg도 자르지 않아야 화면과 PDF가 맞는다.
     * 타원·정다각형은 PDF도 상자 안에서만 그리므로 자르는 채로 둔다.
     */
    .element.type-line svg {
      overflow: visible;
    }
    /* 선 선택 표시는 상자 대신 선 하이라이트 + 끝점 핸들이 담당한다 (C-11) */
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

    /* 선 선택 하이라이트·그리기 미리보기 — 상자 대신 선 자체를 강조한다 (C-11) */
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
      padding: 12px;
      overflow-y: auto;
      overflow-x: hidden;
      background: var(--sk-bg);
    }
    .prop-section {
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--sk-border);
    }
    .prop-section:last-child {
      border-bottom: none;
    }
    .prop-section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--sk-text-muted);
      margin-bottom: 6px;
    }
    .type-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--sk-text);
      margin-bottom: 10px;
    }
    /* 그룹 패널의 묶기·해제 버튼 줄 (G-27) */
    .group-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin: 6px 0;
    }
    .prop-row {
      display: flex;
      align-items: center;
      margin: 3px 0;
      gap: 6px;
    }
    /* 라벨 폭을 고정해 모든 입력 박스의 시작 위치를 맞춘다 (긴 라벨은 줄바꿈) */
    .prop-row label {
      width: 68px;
      flex: none;
      font-size: 12px;
      line-height: 1.25;
      overflow-wrap: break-word;
      color: var(--sk-text-muted);
    }
    /* 긴 라벨은 68px 칸에서 여러 줄로 접혀 읽기 나쁘다 — 라벨을 위, 입력을 아래로 둔다 */
    .prop-row.stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 3px;
    }
    .prop-row.stacked label {
      width: auto;
    }
    .prop-row.stacked input,
    .prop-row.stacked select {
      width: 100%;
    }
    /* 체크박스는 폭을 늘리지 않는다 — 글상자와 달리 늘려도 누를 자리만 넓어지지 않는다 */
    .prop-row.stacked input.stacked-check {
      width: auto;
      align-self: flex-start;
    }
    .prop-row input,
    .prop-row select,
    .prop-row textarea {
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
    /*
     * 체크박스는 글상자와 달리 늘려도 쓸모가 없다 — 늘어난 칸 안에서 혼자 가운데로 보여
     * 다른 줄과 어긋났다. 크기를 고정하고 왼쪽에 세워 다른 입력칸과 시작 위치를 맞춘다.
     */
    .prop-row input[type='checkbox'] {
      flex: none;
      width: 16px;
      height: 16px;
      margin: 0;
      padding: 0;
      accent-color: var(--sk-accent);
      cursor: pointer;
    }
    .prop-row input:focus-visible,
    .prop-row select:focus-visible,
    .prop-row textarea:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }
    .prop-pair .prop-row label {
      width: 34px;
    }
    .prop-row textarea {
      resize: vertical;
    }
    .prop-pair {
      display: flex;
      /* 앞 칸의 마지막 버튼과 뒤 칸의 라벨이 맞닿아 보이지 않게 벌린다 */
      gap: 14px;
    }
    .prop-pair .prop-row {
      flex: 1;
      min-width: 0;
    }

    .toggle-group {
      display: inline-flex;
      gap: 2px;
    }
    .toggle-group button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 26px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      color: var(--sk-text);
      cursor: pointer;
    }
    .toggle-group button svg {
      width: 14px;
      height: 14px;
    }
    /*
     * 글자를 담는 토글 — 아이콘 전용 28px 상자에 글자를 넣으면 넘쳐 깨진다.
     * 내용에 맞춰 늘리고 아이콘 버튼과 같은 높이를 유지한다.
     */
    .toggle-group.text button {
      width: auto;
      min-width: 0;
      height: 26px;
      padding: 0 10px;
      font-family: inherit;
      font-size: 12px;
      white-space: nowrap;
    }
    .toggle-group button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
      border-color: var(--sk-accent);
    }
    .anchor-grid {
      display: grid;
      grid-template-columns: repeat(3, 14px);
      gap: 3px;
    }
    .anchor-dot {
      width: 14px;
      height: 14px;
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

    /* 글자 라벨 토글 (방향 등) — 아이콘 토글의 고정 폭을 글자에 맞게 되돌린다 */
    .toggle-group .orient-btn {
      width: auto;
      padding: 0 10px;
      font-size: 12px;
      font-family: inherit;
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
      padding: 3px 6px;
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
      gap: 6px;
      margin: 2px 0 8px 74px;
      padding: 6px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
    }
    .color-pop-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .color-pop-row input:not(.alpha-input) {
      flex: 1;
      min-width: 0;
      width: 0;
      padding: 3px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      font-size: 12px;
      font-family: inherit;
      color: inherit;
    }
    .sv-area {
      position: relative;
      height: 90px;
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
      height: 12px;
      margin: 0;
      border: 1px solid var(--sk-border);
      border-radius: 6px;
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      cursor: pointer;
    }
    .hue-slider::-webkit-slider-thumb {
      appearance: none;
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .hue-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .color-extras {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 3px;
    }
    .swatch {
      width: 14px;
      height: 14px;
      padding: 0;
      border: 1px solid var(--sk-border-strong);
      border-radius: 50%;
      cursor: pointer;
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
      width: 14px;
      height: 14px;
      padding: 0;
      border: 1px dashed var(--sk-border-strong);
      border-radius: 50%;
      background: var(--sk-surface);
      color: var(--sk-text-muted);
      cursor: pointer;
    }
    .swatch-save svg {
      width: 10px;
      height: 10px;
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
      flex: 0 0 44px;
      width: 44px;
      padding: 2px 4px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      font-size: 11px;
      font-family: inherit;
    }
    .alpha-suffix {
      font-size: 11px;
      color: var(--sk-text-muted);
    }

    /* 테두리 굵기 선택 — 버튼과 펼침 목록에 굵기 미리보기 선을 함께 그린다 (C-11) */
    .width-btn {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      border: 1px solid var(--sk-border-strong);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
      cursor: pointer;
      font-family: inherit;
      color: inherit;
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
    /* 테두리 형태 미리보기 — 실선·파선·점선을 그대로 보여준다 (ADR-034) */
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
    /* 지정하지 않아 기본값·상속값이 적용 중인 항목 (ADR-034) */
    .dim {
      opacity: 0.55;
    }
    .width-value {
      font-size: 11px;
      color: var(--sk-text-muted);
      white-space: nowrap;
    }
    .width-pop {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 2px 0 8px 74px;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
      background: var(--sk-surface);
    }
    .width-pop button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border: none;
      border-radius: var(--sk-radius);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      color: inherit;
    }
    .width-pop button:hover {
      background: var(--sk-accent-soft);
    }
    .width-pop button[aria-pressed='true'] {
      background: var(--sk-accent-soft);
      color: var(--sk-accent);
    }
    .width-pop button:focus-visible {
      outline: 2px solid var(--sk-accent);
      outline-offset: -1px;
    }

    /*
     * 인라인 칸 편집 상자 — 배경·글자색·크기·정렬은 칸에서 물려받아 인라인으로 준다.
     * 여기서 배경을 칠하면 칸에 준 배경색이 편집 중에만 사라져 색을 보며 고칠 수 없다.
     */
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
    /* 행·열 수 조절 — 값을 가운데 두고 좌우로 빼고 더한다 (ADR-037) */
    .step-inputs {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
    }
    .step-inputs span {
      min-width: 24px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    /* 반복 구간 안의 칸임을 알리는 표시 */
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
      /* 툴바 안에 렌더되므로 .toolbar button의 아이콘 버튼 크기 규칙을 되돌린다 */
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

    /* 모달 — 편집 항목이 많은 기능은 패널 대신 모달로 (D-12, 편집 UI 배치 원칙) */
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
    /* 이미지 선택 (G-36) — 경로는 base64라 못 읽으니 이미지 자체를 보여준다 */
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
      height: 80px;
      margin-bottom: 6px;
      padding: 4px;
      border: 1px solid var(--sk-border);
      border-radius: var(--sk-radius);
    }
    /* 샘플 데이터 모달의 변동 이미지 입력 (G-47) */
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
    .binding-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .binding-chip {
      padding: 3px 8px;
      border: 1px solid var(--sk-border-strong);
      border-radius: 10px;
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 11px;
      color: inherit;
      cursor: pointer;
    }
    .binding-chip:hover {
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    /* 표 파라미터의 하위 열 칩 — 상위 값과 구분되게 옅게 (F-21) */
    .binding-chip.column {
      border-style: dashed;
      color: var(--sk-text-muted);
    }
    /* 수식 규칙 안내 한 줄 (F-21) */
    .formula-hint {
      margin-top: 6px;
      font-size: 11px;
      color: var(--sk-text-muted);
      line-height: 1.5;
    }
    /* 표 파라미터 뒤에 점을 찍었을 때 뜨는 열 제안 줄 (F-21) */
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
    .formula-suggest .binding-chip {
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
      width: 26px;
      height: 26px;
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

    /* 내 양식 목록 행 (D-15) */
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
    _expandedBindings: { state: true },
    _expandedElements: { state: true },
    _bindingKeyError: { state: true },
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
   * UI 언어 ('ko' | 'en' | 'ja') — ADR-028/042.
   *
   * @defaultValue 한국어
   */
  locale?: string;

  /**
   * 호스트 설정 인터페이스 (ADR-040, JS 프로퍼티 전용) — 렌더 폰트 공급과 용지 목록 공급·저장.
   * 없으면 동봉 기본 폰트·용지만 쓴다.
   */
  settings?: SlipDesignerSettings;

  /**
   * 툴바 프리셋 메뉴에 쓸 양식 프리셋 목록 — 호스트가 자기 양식을 넣을 수 있다 (D-15).
   * 지정하면 동봉 프리셋 대신 이 목록을 쓴다. 동봉 프리셋을 함께 두려면
   * `presets` 수출값을 펼쳐 넣는다.
   */
  presets?: SlipPreset[];

  /**
   * "내 양식" 저장·불러오기에 쓸 저장소 어댑터 (ADR-021) — 지정하면 툴바에
   * 저장·목록 버튼이 나타난다. 없으면 그 기능이 감춰진다.
   */
  storage?: StorageAdapter;

  /**
   * 넣을 수 있는 이미지 파일의 최대 크기(바이트) — 기본 2MB (G-36).
   *
   * @remarks
   * 이미지는 base64로 양식 파일 안에 담기므로 원본보다 **약 33% 커진다**.
   * 큰 사진을 그대로 넣으면 전표 파일이 무거워져 저장·전송에 부담이 되므로,
   * 호스트가 자기 시스템에 맞는 값으로 조일 수 있게 열어 둔다.
   * HTML 속성으로도 줄 수 있다: `<slip-designer max-image-bytes="1048576">`.
   */
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES;

  private _file: SlipTemplateFile | null = null;
  private _pageIndex = 0;
  /** 주 선택 요소 — 속성 패널·크기 조절 핸들은 이 하나를 대상으로 한다 */
  private _selectedId: string | null = null;
  /**
   * 선택된 요소 id 모음 (G-27) — 단일 선택이면 원소 하나, 그룹·다중 선택이면 여럿.
   * 늘 `_selectedId`를 포함한다(비었으면 `_selectedId`도 null). 캔버스·사이드바 강조,
   * 그룹 단위 이동·삭제·그룹화의 대상이 된다.
   */
  private _selectedIds = new Set<string>();
  /** 호스트가 `settings.getPaperSizes`로 공급한 용지 목록 (동봉 4종 뒤에 붙는다, G-31) */
  private _hostPaperSizes: PaperSize[] = [];
  /** 호스트가 `settings.getBarcodeKinds`로 좁힌 바코드 종류 (빈 배열이면 12종 전부, ADR-048) */
  private _hostBarcodeKinds: BarcodeKind[] = [];
  /** "이 크기 저장"에 쓸 이름 입력 초안 (G-31) */
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
  /** 선택된 생성 도구 — 캔버스를 클릭·드래그하면 이 종류의 요소를 만든다 (한 번 만들면 해제) */
  private _pendingTool: CreatableType | null = null;
  /** 드래그 생성 중 임시 사각형(mm) — 캔버스에 점선 미리보기로 표시 */
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
  /** 도형 선택 메뉴 상태 — 도형 버튼을 누르면 종류(사각형·타원·다각형)를 골라 그린다 */
  private _shapeMenuOpen = false;
  private _shapeMenuPos = { left: 0, top: 0 };
  /** 다각형 도구로 만들 변 수 — 도형 메뉴에서 삼각형(3)·오각형(5)·육각형(6)을 고르면 바뀐다 */
  private _pendingSides = 3;
  /** 선 두 번 클릭 생성의 시작점(mm) — 첫 클릭 후 설정되고 둘째 클릭에 선이 만들어진다 */
  private _lineDraft: { x: number; y: number } | null = null;
  /** 선 두 번 클릭 생성 중 커서 위치(mm) — 시작점에서 여기까지 반투명 미리보기 선을 그린다 */
  private _lineGhost: { x: number; y: number } | null = null;
  /** 수식 편집 모달 열림 여부 — 선택된 필드 요소의 formula를 편집한다 (D-12) */
  private _formulaModalOpen = false;
  /** 수식 모달의 편집 중 초안 — 적용을 눌러야 요소에 반영된다 */
  private _formulaDraft = '';
  /** 샘플 데이터 편집 모달 열림 여부 — 양식의 sampleValues를 편집한다 (D-13) */
  private _sampleModalOpen = false;
  /** 이미지 선택 모달 열림 여부 — 선택된 이미지 요소의 src를 정한다 (G-36) */
  private _imageModalOpen = false;
  /**
   * 썸네일을 띄워 둔 페이지 번호 — 없으면 null (G-35).
   * 페이지 목록은 요소 목록처럼 한 줄씩이고, 줄에 마우스를 올리거나 포커스가 가면
   * 그 줄 옆에 썸네일이 뜬다.
   */
  private _thumbPage: number | null = null;
  /** 띄운 썸네일의 화면 기준 좌표 — 사이드바가 잘라내지 못하게 fixed로 놓는다 (G-35) */
  private _thumbPos: { top: number; left: number } | null = null;
  /** 이미지 선택에서 막힌 이유 (너무 큼·이미지 아님·읽기 실패) — 없으면 null */
  private _imageError: string | null = null;
  /** 샘플 데이터 모달의 변동 이미지 업로드에서 막힌 이유 — 없으면 null (G-47) */
  private _sampleImageError: string | null = null;
  /** 샘플 데이터 모달의 현재 페이지 — 파라미터이 많으면 10개 단위로 나눠 보여준다 */
  private _samplePage = 0;
  /** 샘플 데이터 모달의 JSON 직접 입력 모드 여부 (입력폼 ↔ JSON 탭) */
  private _sampleJsonMode = false;
  /** JSON 모드의 편집 중 초안 — 적용을 눌러야 sampleValues에 반영된다 */
  private _sampleJsonDraft = '';
  /**
   * 사이드바에서 요소가 아닌 것을 골랐을 때의 선택 대상 (ADR-034) — 지금은 파라미터뿐이다.
   * 요소를 고르면 `null`로 돌아가고, 오른쪽 패널이 이 값에 따라 편집 화면을 바꾼다.
   */
  private _sideSelection: SideSelection = null;
  /**
   * 값 목록에서 하위 줄을 펼쳐 둔 파라미터 물리명 (G-25) — 화면 상태다.
   * 기본은 접힘이고, 그 값이나 하위 항목을 고르면 저절로 열린다.
   */
  private _expandedBindings = new Set<string>();
  /**
   * 요소 목록에서 펼쳐 둔 그리드 id 모음 (G-44) — 값·수식이 붙은 칸을 하위 줄로 본다.
   * 기본은 접힘이고, 그 그리드나 그 안의 칸을 고르면 저절로 열린다.
   */
  private _expandedElements = new Set<string>();
  /** 파라미터 패널에서 이미 쓰는 물리명으로 바꾸려 했는지 — 안내를 보여준다 */
  private _bindingKeyError = false;
  /** 페이지 물리명이 다른 페이지와 겹쳐 되돌렸는지 — 안내를 보여준다 (G-46) */
  private _pageKeyError = false;
  /** "내 양식으로 저장" 모달 열림 여부 (D-15) */
  private _saveModalOpen = false;
  /** 저장 모달의 제목 초안 — 확인하면 양식 제목으로도 반영된다 */
  private _saveTitle = '';
  /** "내 양식 목록" 모달 열림 여부 (D-15) */
  private _myFormsOpen = false;
  /**
   * 모달을 열 때 한 번 받아 쥐는 전체 양식 메타 목록(스냅샷) — 검색·페이지 이동은 이 위에서
   * 메모리로 한다. 페이지 사이에 저장·삭제가 일어나도 목록이 흔들리지 않는다 (ADR-045).
   */
  private _myFormItems: SlipListItem[] = [];
  /** 목록 모달의 현재 페이지 (0부터). 검색·삭제로 항목이 줄면 범위 안으로 되돌린다 */
  private _myFormsPage = 0;
  /** 목록 검색어 */
  private _myFormsQuery = '';
  /** 저장소 작업 오류 메시지 (어댑터가 한국어 메시지를 준다) */
  private _myFormsError: string | null = null;
  /** 저장 완료 안내 — 다음 편집에서 지워진다 */
  private _savedNotice = false;
  /** 지금 편집 중인 양식이 저장돼 있던 키 — 다시 저장하면 덮어쓴다 */
  private _savedId: string | null = null;
  /** 저장 모달에서 "새 양식으로 저장"을 골랐는지 — 고르면 덮어쓰지 않고 새 항목이 된다 */
  private _saveAsNew = false;
  /** 선 끝점 핸들 드래그 상태 — 반대쪽 끝점을 고정하고 잡은 끝점만 옮긴다 */
  private _lineEnd: {
    id: string;
    fixed: { x: number; y: number };
    snapshot: string | null;
    orig: { x: number; y: number; w: number; h: number; direction: string | undefined };
  } | null = null;
  /**
   * 속성 패널 X·Y가 기준으로 삼는 기준점을 **요소별로** 기억한다
   * (요소 id → ANCHORS 인덱스, 없으면 좌상단). 제목은 가운데, 상자는 좌상단처럼
   * 요소마다 기준을 달리 잡을 수 있어야 한다 (B-8 의도, G-32에서 이행).
   * 화면 전용 값이라 파일에 저장하지 않는다 — 새로 열면 다시 좌상단으로 시작한다.
   */
  private _anchorByElement = new Map<string, number>();
  /** 선택된 그리드 칸 좌표 — 병합 편집·인라인 편집 대상 (C-10) */
  private _selectedCell: { row: number; column: number } | null = null;
  /**
   * 그리드 칸에 담을 것(문구·값·수식) 중 지금 고른 종류 — 화면 상태다.
   * 아직 아무것도 입력하지 않으면 파일에 남지 않으므로 여기서 기억한다 (ADR-037).
   */
  private _cellSourceKind: 'content' | 'binding' | 'formula' | null = null;
  /** 인라인 셀 편집 중인지 — true면 캔버스에 입력 상자를 띄운다 */
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

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
    }
    // 호스트가 준 용지 목록을 불러 온다 (G-31) — settings가 바뀌면 다시 불러온다
    if (changed.has('settings')) {
      void this._loadPaperSizes();
      void this._loadBarcodeKinds();
    }
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
    this._bindingKeyError = false;
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
      file = parseSlipFile(this.src);
    } catch (error) {
      console.error('[slip-designer] .slip 파싱 실패:', error);
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
   * 잘못된 입력·할 수 없는 편집을 물리친다 — 모델은 그대로 두고 다시 그려 입력칸이 모델
   * 값으로 되돌아오게 한다. 스키마 범위 밖 값, 규칙에 어긋나는 병합, 대상이 아닌 요소 등에서
   * 쓴다. `requestUpdate()`와 동작은 같지만 "값을 바꾸지 않고 되돌린다"는 의도를 이름으로 드러낸다.
   */
  private _rejectInput(): void {
    this.requestUpdate();
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

  /** 페이지 수가 줄어드는 복원 뒤에도 현재 페이지가 범위 안에 있도록 보정 */
  private _clampPageIndex(): void {
    this._pageIndex = Math.max(0, Math.min(this._pageIndex, this._pageCount() - 1));
  }

  // ---------------------------------------------------------------------------
  // Pages (ADR-026)
  // ---------------------------------------------------------------------------

  private _pageCount(): number {
    return this._file?.template.pages.length ?? 0;
  }

  /**
   * 썸네일·목록에 보일 페이지 이름 — 논리명(label)이 있으면 그것, 없으면 `{n}페이지` (G-46).
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
   * 페이지 줄에 마우스를 올리거나 포커스가 갔을 때 그 줄 옆에 썸네일을 띄운다 (G-35).
   * 사이드바가 넘치는 부분을 잘라내므로 화면 기준 좌표를 재서 fixed로 놓고,
   * 아래쪽이 화면 밖으로 나가면 위로 끌어올린다.
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

  /** 올린 줄에서 벗어나면 썸네일을 감춘다 — 이미 다른 줄로 옮겨 갔으면 그대로 둔다 */
  private _hidePageThumb(index: number): void {
    if (this._thumbPage !== index) return;
    this._thumbPage = null;
    this._thumbPos = null;
  }

  /** 띄울 썸네일의 높이(px) — 용지 비율에 테두리·여백을 더한 값 */
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

  /** 현재 페이지에서 같은 그룹 id를 가진 요소들 (G-27) */
  private _pageGroupMembers(group: string): SlipElement[] {
    return (this._currentElements() ?? []).filter((el) => el.group === group);
  }

  /** 선택을 모두 비운다 (G-27) — 주 선택과 선택 모음을 함께 지운다 */
  private _clearSelection(): void {
    this._selectedId = null;
    this._selectedIds = new Set();
  }

  /**
   * 요소 하나를 단독 선택한다 (G-27) — 그룹에 속하면 그룹 전체를 함께 고른다.
   * 그룹을 묶으면 한 개만 눌러도 그룹 전체가 선택·이동된다.
   *
   * @param id - 고를 요소 id
   */
  private _selectElement(id: string): void {
    this._selectedId = id;
    const group = this._findElement(id)?.group;
    this._selectedIds = group
      ? new Set(this._pageGroupMembers(group).map((el) => el.id))
      : new Set([id]);
  }

  /**
   * 사이드바 Ctrl/Cmd+클릭으로 선택 모음에 넣거나 뺀다 (G-27, 그룹화 대상 고르기).
   * 넣으면 그 요소가 주 선택이 되고, 주 선택을 빼면 남은 것 중 하나가 주 선택이 된다.
   *
   * @param id - 토글할 요소 id
   */
  private _toggleInSelection(id: string): void {
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
    // 선택 모음에서 사라진 요소를 걸러낸다 (undo 복원·삭제 뒤 보정, G-27)
    if (this._selectedIds.size > 0) {
      const alive = new Set([...this._selectedIds].filter((id) => this._findElement(id)));
      if (alive.size !== this._selectedIds.size) this._selectedIds = alive;
      if (this._selectedId === null) this._selectedId = alive.values().next().value ?? null;
    }
    // 칸 선택은 그리드 범위 안에서만 유효하다 (undo 복원 뒤에도 보정)
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
   * 요소를 추가한다. place를 주면 그 위치(드래그 생성이면 크기까지)로 만들고,
   * 없으면 여백 원점에서 계단식으로 어긋난 기본 위치에 만든다.
   */
  private _addElement(
    type: CreatableType,
    place?: {
      position: { x: number; y: number };
      width?: number;
      height?: number;
      /** 선 전용 — 드래그 방향에서 추론한 선 방향 */
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
        // 헤더 1행 + 반복 1행 + 꼬리 1행으로 시작한다 — 목록형 표가 가장 흔한 쓰임이고,
        // 반복을 끄면 그대로 고정 틀이 된다 (ADR-037)
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
            binding: `items_${id.slice(0, 4)}`,
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
        // 변 수는 도형 메뉴에서 고른 값(삼각형 3·오각형 5·육각형 6), 이후 속성 패널에서 3~12로 조절
        element = {
          type: 'polygon', id, name, position, width: 40, height: 30, sides: this._pendingSides,
        };
        break;
      case 'field':
        element = {
          type: 'field', id, name, position, width: 60, height: 10,
          binding: `field_${id.slice(0, 4)}`,
        };
        break;
      case 'barcode':
        // 전표에 가장 흔한 QR로 시작한다 — 종류·값 편집은 G-33에서 붙인다
        element = {
          type: 'barcode', id, name, position, width: 25, height: 25,
          kind: 'qrcode', binding: `barcode_${id.slice(0, 4)}`,
        };
        break;
    }

    if (place?.width !== undefined) element.width = Math.max(MIN_SIZE_MM, round1(place.width));
    if (place?.height !== undefined) element.height = Math.max(MIN_SIZE_MM, round1(place.height));
    // 그리드는 열 너비·행 높이의 합이 곧 상자다 — 끌어낸 크기에 트랙을 맞춘다 (SPEC §5.7)
    if (element.type === 'grid') syncGridTracks(element);
    // 용지 밖으로 나가지 않게 위치 보정 (가장자리를 클릭해 만들 때)
    element.position = {
      x: round1(Math.max(0, Math.min(element.position.x, paper.width - element.width))),
      y: round1(Math.max(0, Math.min(element.position.y, paper.height - element.height))),
    };

    elements.push(element);
    this._selectElement(id);
    this._sideSelection = null;
    // 값을 쓰는 요소는 그 파라미터을 정의부에 함께 등록한다 — 목록이 값의 단일 원천 (ADR-034)
    if (element.type === 'field') {
      this._ensureBindingDef(element.binding);
    }
    if (element.type === 'grid' && element.repeat) {
      this._ensureBindingDef(element.repeat.binding, 'list');
    }
    this._emitChange();
    this.requestUpdate();
  }

  private _copySelected(): void {
    const elements = this._currentElements();
    if (!elements || this._selectedIds.size === 0) return;
    // 선택된 요소를 모두 복사한다 — 그룹·다중 선택이면 삭제·이동과 같은 대상으로 다룬다.
    const selected = elements.filter((el) => this._selectedIds.has(el.id));
    if (selected.length === 0) return;
    this._clipboard = JSON.parse(JSON.stringify(selected)) as SlipElement[];
    this.requestUpdate();
  }

  private _paste(): void {
    const elements = this._currentElements();
    if (!elements || !this._clipboard || this._clipboard.length === 0) return;

    this._pushUndo();

    // 복사한 요소들이 같은 그룹이면 사본도 함께 묶되, 원본 그룹과는 다른 새 그룹으로 둔다.
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
      if (copy.type === 'field') this._ensureBindingDef(copy.binding);
      if (copy.type === 'grid' && copy.repeat) this._ensureBindingDef(copy.repeat.binding, 'list');
      elements.push(copy);
      pasted.push(copy);
    }
    // 연속으로 붙여넣으면 계단식으로 내려가도록 클립보드 위치를 갱신
    for (const src of this._clipboard) {
      src.position = { x: round1(src.position.x + 5), y: round1(src.position.y + 5) };
    }

    // 붙여넣은 사본들을 고른다
    this._selectedId = pasted[0]!.id;
    this._selectedIds = new Set(pasted.map((el) => el.id));
    this._sideSelection = null;
    this._emitChange();
    this.requestUpdate();
  }

  /** 선택된 요소를 모두 지운다 (G-27) — 그룹·다중 선택이면 함께 지운다 */
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
    // 편집이 생기면 "저장했습니다" 안내는 더 이상 맞지 않는다
    this._savedNotice = false;
    const file = structuredClone(this._file) as SlipFile;
    this.dispatchEvent(
      new CustomEvent('slip-change', { detail: { file }, bubbles: true, composed: true }),
    );
  }

  private _updateElement(fn: (el: SlipElement) => void): void {
    const el = this._findSelectedElement();
    if (!el) return;
    this._pushUndo();
    fn(el);
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Pointer events (canvas drag)
  // ---------------------------------------------------------------------------

  /** 생성 도구 선택·해제 — 같은 도구를 다시 누르면 해제된다 */
  private _selectTool(type: CreatableType): void {
    this._pendingTool = this._pendingTool === type ? null : type;
    this._draw = null;
    this._drawRect = null;
    this._lineDraft = null;
    this._lineGhost = null;
    this.requestUpdate();
  }

  /**
   * 선 도구 놓기 — 드래그면 시작점→끝점 선을 바로 만들고, 클릭이면 두 번 클릭
   * 생성으로 넘어간다: 첫 클릭은 시작점 기록(도구 유지), 둘째 클릭이 끝점 (C-11)
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

  /** 두 점을 잇는 선을 만든다 — 상자는 두 점의 외접 사각형, 방향은 기울기 부호로 (ADR-032) */
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

  /** 도형 메뉴에서 종류를 골라 그리기 도구로 삼는다 — 다각형은 변 수까지 정한다 */
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
    // 아래 갈래들이 끌기를 위해 preventDefault를 부르는데, 그러면 브라우저 기본 포커스 이동이
    // 함께 막힌다. 도구 버튼으로 요소를 만들면 그 버튼이 다시 그려지며 포커스가 컴포넌트 밖으로
    // 빠져, 갓 만든 요소를 Delete·Backspace로 지울 수 없었다. 캔버스를 누른 순간 호스트가
    // 포커스를 갖게 해 단축키가 곧바로 듣게 한다.
    this._focusHost();

    // 생성 도구가 선택돼 있으면 클릭·드래그는 요소 생성이다 (선택·이동보다 우선)
    if (this._pendingTool) {
      const p = this._paperPoint(e);
      this._draw = { type: this._pendingTool, startX: p.x, startY: p.y, endX: p.x, endY: p.y, moved: false };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    // 선 끝점 핸들 — 반대쪽 끝점을 고정하고 잡은 끝점만 옮긴다 (C-11)
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
      // 그룹에 속하면 그룹 전체가 함께 선택된다 (G-27)
      this._selectElement(id);
      this._sideSelection = null;
      this._expandBindingOfElement(id);
      if (!wasSelected) {
        this._selectedCell = null;
        this._cellEditing = false;
      }

      const el = this._findElement(id);
      if (!el) return;

      // 선택된 요소(그룹·다중)를 함께 옮기려 각 원래 위치를 기억한다 (G-27)
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
        // 선은 상자 대신 시작점→커서 미리보기 선으로 보여준다 (C-11)
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
    // 선 두 번 클릭 생성 중 — 커서를 따라 반투명 미리보기 선을 움직인다
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
      // 함께 움직이는 선택 요소는 스냅 후보에서 뺀다 (G-27)
      const { xs, ys } = this._snapCandidates(new Set(this._drag.members.map((m) => m.id)));
      const sx = this._bestSnap([nx, nx + el.width / 2, nx + el.width], xs);
      const sy = this._bestSnap([ny, ny + el.height / 2, ny + el.height], ys);
      if (sx) {
        nx += sx.delta;
        guideX = sx.line;
      } else {
        // 붙을 요소·여백선이 없으면 격자에 맞춘다 (F-20)
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

    // 주 요소를 옮긴 만큼(스냅 반영) 선택된 요소를 모두 같은 양으로 옮긴다 (G-27)
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
      // 붙을 요소·여백선이 없는 변은 격자에 맞춘다 (F-20)
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

  /** 선 끝점 드래그 — 고정 끝점→커서 벡터로 상자와 선 방향을 다시 계산한다 (C-11) */
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
    // 브라우저가 제스처를 가져가 취소된 경우 — 변경을 스냅샷으로 되돌린다.
    // 상태를 정리하지 않으면 버튼을 떼지 않은 것으로 남아 hover 이동만으로
    // 요소가 계속 끌려다닌다.
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
    // 움직이지 않은 재클릭: 셀 격자면 그 자리의 셀을 선택하고 인라인 편집을 연다 (C-10, ADR-037)
    if (isGrid(el) && drag.wasSelected && drag.snapshot === null) {
      const cell = this._cellAtPoint(el, e);
      if (cell) {
        if (this._selectedCell?.row !== cell.row || this._selectedCell?.column !== cell.column) {
          this._cellSourceKind = null;
        }
        this._selectedCell = cell;
        this._cellEditing = true;
        this.requestUpdate();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 그리드 칸 편집 (C-10, ADR-037)
  // ---------------------------------------------------------------------------

  /** 포인터 위치가 가리키는 셀 좌표 — 병합 범위면 병합 원점 좌표를 돌려준다 */
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
    // 경계 오른쪽/아래를 눌러도 마지막 칸으로 보정한다
    const indexOf = (value: number, offsets: number[], count: number): number => {
      const found = offsets.findIndex((offset) => value < offset) - 1;
      return found < 0 ? count - 1 : Math.min(count - 1, found);
    };
    const column = indexOf(relX, colOffsets, dims.columns);
    // 반복 구간은 화면에 여러 벌 보이므로 눌린 자리를 틀의 행으로 되돌린다
    const row = templateRowOf(el, indexOf(relY, rowOffsets, rowOffsets.length - 1));

    // 병합 범위 안이면 원점 셀로 보정
    for (const cell of el.cells) {
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      if (row >= cell.row && row < cell.row + rowSpan && column >= cell.column && column < cell.column + colSpan) {
        return { row: cell.row, column: cell.column };
      }
    }
    return { row, column };
  }

  /** 셀(병합 범위 포함)의 캔버스 px 사각형 — 인라인 편집 상자 위치용 */
  private _cellRectPx(
    el: GridElement,
    row: number,
    column: number,
  ): { left: number; top: number; width: number; height: number } {
    const colOffsets = trackOffsets(columnWidths(el));
    const rowOffsets = trackOffsets(expandedRowHeights(el));
    // 반복 구간 셀은 화면의 첫 번째 벌 자리에 편집 상자를 띄운다
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

  /** 인라인 편집 확정 — 셀이 있으면 내용을 바꾸고, 없으면 새 셀을 만든다 */
  private _commitCellContent(value: string): void {
    const target = this._selectedCell;
    if (!target) return;
    this._cellEditing = false;
    const el = this._findSelectedElement();
    if (!isGrid(el)) return;
    const existing = el.cells.find((c) => c.row === target.row && c.column === target.column);
    // 값·수식을 붙인 칸은 문구를 직접 못 쓴다 — 셋 중 하나만 가질 수 있다 (SPEC §5.7)
    if (existing && ('binding' in existing || 'formula' in existing)) {
      this._rejectInput();
      return;
    }
    if (!existing && value === '') {
      this._rejectInput();
      return;
    }
    if (existing && existing.content === value) {
      this._rejectInput();
      return;
    }
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      ensureCell(element, target.row, target.column).content = value;
    });
  }

  /** 선택 셀의 병합 범위 변경 — 그리드를 벗어나거나 다른 셀과 겹치면 무시한다 */
  private _setCellSpan(kind: 'rowSpan' | 'colSpan', value: number): void {
    const target = this._selectedCell;
    const el = this._findSelectedElement();
    if (!target || !isGrid(el)) return;
    if (!Number.isInteger(value) || value < 1) {
      this._rejectInput();
      return;
    }
    const dims = gridDims(el);
    const current = el.cells.find((c) => c.row === target.row && c.column === target.column);
    const rowSpan = kind === 'rowSpan' ? value : (current?.rowSpan ?? 1);
    const colSpan = kind === 'colSpan' ? value : (current?.colSpan ?? 1);
    // 그리드 범위 검사
    if (target.row + rowSpan > dims.rows || target.column + colSpan > dims.columns) {
      this._rejectInput();
      return;
    }
    // 병합이 반복 구간 경계를 넘으면 복제할 때 모양이 무너진다 (SPEC §5.7)
    if (el.type === 'grid' && el.repeat && rowSpan > 1) {
      const { fromRow, toRow } = el.repeat;
      const last = target.row + rowSpan - 1;
      const startsInside = target.row >= fromRow && target.row <= toRow;
      const endsInside = last >= fromRow && last <= toRow;
      if (startsInside !== endsInside) {
        this._rejectInput();
        return;
      }
    }
    // 다른 셀과 겹침 검사 (파일 스키마 규칙과 동일 — 저장 시점 오류를 미리 막는다)
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
      this._rejectInput();
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

  /** 선택 셀의 스타일 필드를 넣거나(null이면 지운다) — 셀이 없으면 빈 내용으로 만든다 */
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
  // 그리드 편집 (ADR-037 2단계)
  // ---------------------------------------------------------------------------

  /** 그리드 요소를 고치고 상자를 트랙 합으로 되맞춘다 */
  private _updateGrid(fn: (el: GridElement) => void): void {
    this._updateElement((el) => {
      if (el.type !== 'grid') return;
      fn(el);
      recomputeGridBox(el);
    });
  }

  /**
   * 행을 더하거나 뺀다 — 맨 아래에 붙이고 맨 아래에서 뺀다.
   * mm 트랙이라 다른 행 높이는 그대로고 상자만 늘거나 준다 (ADR-037).
   */
  private _changeGridRows(delta: number): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    const next = el.rows.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    // 반복 구간이 남을 자리가 없어지면 줄이지 않는다
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

  /** 열을 더하거나 뺀다 — 맨 오른쪽에 붙이고 맨 오른쪽에서 뺀다 */
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

  /** 행 높이·열 너비(mm)를 직접 정한다 — 그 트랙만 바뀌고 나머지는 그대로다 */
  private _setGridTrack(kind: 'row' | 'column', index: number, mm: number): void {
    if (!Number.isFinite(mm) || mm < MIN_SIZE_MM) {
      this._rejectInput();
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

  /** 반복 구간을 켜고 끈다 — 켤 때는 지금 선택한 행(없으면 둘째 행)을 구간으로 잡는다 */
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
    this._ensureBindingDef(key, 'list');
    this._updateGrid((grid) => {
      grid.repeat = {
        binding: key,
        fromRow: row,
        toRow: row,
        perPage: GRID_DEFAULT_PER_PAGE,
        repeatHeader: true,
      };
    });
  }

  /** 반복 구간의 설정을 바꾼다 — 행 범위가 어긋나거나 병합이 경계를 넘으면 무시한다 */
  private _updateGridRepeat(
    patch: Omit<Partial<GridRepeat>, 'maxItems'> & { maxItems?: number | null },
  ): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const next = { ...el.repeat, ...patch } as GridRepeat & { maxItems?: number | null };
    // 상한 없음(null)은 필드를 지운다 — 스키마에 없는 값을 남기지 않는다 (ADR-048)
    if (patch.maxItems === null) delete (next as { maxItems?: unknown }).maxItems;
    else if (patch.maxItems !== undefined) {
      const v = patch.maxItems;
      if (!Number.isInteger(v) || v < next.perPage || v > GRID_MAX_ITEMS_UI) {
        this._rejectInput();
        return;
      }
    }
    if (next.fromRow > next.toRow || next.toRow >= el.rows.length || next.fromRow < 0) {
      this._rejectInput();
      return;
    }
    if (!Number.isInteger(next.perPage) || next.perPage < 1 || next.perPage > GRID_MAX_PER_PAGE_UI) {
      this._rejectInput();
      return;
    }
    // 반복 구간 경계를 넘는 병합이 생기면 받아들이지 않는다 (SPEC §5.7)
    const crosses = el.cells.some((cell) => {
      const last = cell.row + (cell.rowSpan ?? 1) - 1;
      const startsInside = cell.row >= next.fromRow && cell.row <= next.toRow;
      const endsInside = last >= next.fromRow && last <= next.toRow;
      return startsInside !== endsInside;
    });
    if (crosses) {
      this._rejectInput();
      return;
    }
    if (patch.binding !== undefined) this._ensureBindingDef(patch.binding, 'list');
    this._updateGrid((grid) => {
      grid.repeat = next;
    });
  }

  /**
   * 칸에 담을 것의 종류를 고른다 — 값·수식은 빈 채로 둘 수 없어(값 이름은 한 글자 이상)
   * 아직 입력이 없는 동안은 화면 상태로만 기억한다 (ADR-037).
   */
  private _chooseGridCellSource(kind: 'content' | 'binding' | 'formula'): void {
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
   * 셀에 무엇을 담을지 고른다 — 직접 입력·파라미터·수식 중 하나만 가질 수 있다 (SPEC §5.7).
   * 종류를 바꾸면 나머지 둘은 지운다.
   */
  private _setGridCellSource(kind: 'content' | 'binding' | 'formula', value: string): void {
    const target = this._selectedCell;
    if (!target) return;
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
    // 그룹·다중 이동 때는 함께 움직이는 요소들을 후보에서 모두 뺀다 (G-27)
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
    // 재지정(retargeting)되므로, 실제 입력 대상은 composedPath()의 첫 항목으로 판정한다.
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
    // 미리보기 중에는 편집 단축키를 막는다 — PDF iframe은 토글할 때만 다시 그리므로,
    // 미리보기 상태에서 요소를 지우거나 되돌리면 표시된 PDF가 실제 문서와 어긋난다 (ADR-012).
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
    // 진행 중인 렌더도 무효화한다 — 분리·모드 전환·소스 교체 후 완료되는
    // 렌더가 회수할 수 없는 blob URL을 만드는 것을 막는다
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
      // 폰트 미공급 시 동봉 Pretendard 자동 사용 (ADR-012/040) — 한글 깨짐 방지
      const opts: RenderOptions = {
        fonts: await resolveFonts(this.settings, this.locale),
      };
      // 샘플 값이 있으면 그 값으로 채운 전표 상태로 미리보기 (D-13).
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
      console.error('[slip-designer] PDF 미리보기 생성 실패:', error);
      if (gen !== this._previewGeneration) return;
      // 미리보기 화면 안에 실패를 표시한다 (편집 버튼으로 복귀 가능)
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
            <div class="prop-panel">${this._renderPropertyPanel()}</div>
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

  /** 툴바 버튼 — 아이콘 + 아래 작은 이름. 이름은 접근성 라벨(aria-label)로도 제공한다 */
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

  /** 지금 고른 격자선 색 (F-20) */
  private _gridLine(): string {
    return GRID_COLORS.find((color) => color.id === this._gridColor)!.line;
  }

  /** 격자 간격 메뉴 열기·닫기 — 도형·프리셋 메뉴와 같은 방식 (F-20) */
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

  /** 격자 간격을 고른다 — null이면 격자를 끈다 (F-20) */
  private _setGridGap(gap: number | null): void {
    this._gridGap = gap;
    this._gridMenuOpen = false;
    this.requestUpdate();
  }

  /**
   * 격자에 맞아떨어지게 하는 이동량 — 격자를 껐으면 null (F-20).
   *
   * 격자를 켜면 거리와 무관하게 가장 가까운 격자선으로 맞춘다. 다른 요소·여백선에
   * 붙는 쪽이 우선이고, Alt를 누르면 둘 다 건너뛴다.
   *
   * @param value - 지금 위치(mm)
   * @returns 더해야 할 이동량(mm) 또는 null
   */
  private _gridDelta(value: number): number | null {
    const gap = this._gridGap;
    if (gap === null) return null;
    return Math.round(value / gap) * gap - value;
  }

  /** 도형 메뉴 열기·닫기 — 프리셋 메뉴와 같은 방식으로 버튼 아래에 띄운다 (C-11) */
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

  /** 프리셋 메뉴에 보여줄 목록 — 호스트가 주입했으면 그것을, 아니면 동봉 프리셋을 쓴다 */
  private _presetList(): SlipPreset[] {
    return this.presets?.length ? this.presets : presets;
  }

  /** 프리셋 메뉴 열기·닫기 — 버튼 바로 아래에 고정 위치로 띄운다 (툴바 스크롤에 잘리지 않게) */
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

  /** 선택한 프리셋으로 양식 전체를 교체한다 (되돌리기 지원) */
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
  // Render: sidebar (B-7, 요소·파라미터 분리 ADR-034)
  // ---------------------------------------------------------------------------

  /** 사이드바에서 요소를 골랐을 때 — 필요하면 페이지를 옮기고 그 요소를 선택한다 */
  private _selectFromSidebar(pageIndex: number, id: string, additive = false): void {
    this._goToPage(pageIndex);
    // Ctrl/Cmd+클릭이면 선택 모음에 넣거나 뺀다 (그룹화 대상 고르기, G-27)
    if (additive) {
      this._toggleInSelection(id);
      return;
    }
    this._selectElement(id);
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = null;
    this._expandBindingOfElement(id);
    this.requestUpdate();
  }

  /**
   * 사이드바에서 목록 파라미터의 하위 필드를 골랐을 때 (ADR-047).
   *
   * @remarks
   * 하위 필드는 정의부의 항목이므로 **오른쪽 패널에서 그 필드를 편집**한다. 그 필드를 읽는
   * 그리드 칸이 있으면 그 칸도 함께 비춰 어디에 쓰이는지 보이게 한다 — 요소로 자동 연결되지
   * 않으며, 칸이 없어도 필드는 그대로 편집된다 (ADR-034의 요소·파라미터 분리).
   */
  private _selectBindingField(listKey: string, field: BindingFieldInfo): void {
    if (field.at) {
      this._goToPage(field.at.pageIndex);
      this._expandedElements.add(field.at.gridId);
    }
    this._sideSelection = { kind: 'bindingField', key: listKey, field: field.key };
    this._selectedId = null;
    this._selectedIds = new Set();
    this._selectedCell = null;
    this._cellEditing = false;
    this.requestUpdate();
  }

  /**
   * 고른 것이 반복 구간을 가진 그리드면 그 구간이 쓰는 값의 하위 줄을 펼쳐 둔다 (G-25) —
   * 그리드를 고르면 값 목록에서도 그 항목 필드가 보인다.
   *
   * @param id - 고른 요소 id
   */
  private _expandBindingOfElement(id: string): void {
    const el = this._findElement(id);
    if (!isGrid(el)) return;
    if (el.repeat) this._expandedBindings.add(el.repeat.binding);
    // 값·수식 칸이 있으면 요소 목록에서도 그 그리드를 펼쳐 둔다 (G-44)
    if (this._gridValueCells(el).length > 0) this._expandedElements.add(id);
  }

  /** 페이지 순서를 옮긴다 — delta -1은 앞으로, +1은 뒤로 (요소는 그대로 따라간다) */
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
   * 사이드바 페이지 줄을 골랐을 때 — 그 페이지로 옮기고 오른쪽 패널을 페이지 설정으로 바꾼다 (G-46).
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

  /** 사이드바에서 파라미터을 골랐을 때 — 오른쪽 패널이 그 파라미터 편집으로 바뀐다 (ADR-034) */
  private _selectBinding(key: string): void {
    this._bindingKeyError = false;
    this._clearSelection();
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = { kind: 'binding', key };
    // 고른 값의 하위 줄은 저절로 열린다 — 접어 두었어도 무엇이 딸렸는지 바로 보인다 (G-25)
    this._expandedBindings.add(key);
    this.requestUpdate();
  }

  /**
   * 양식 전체의 파라미터 목록 — 정의부(ADR-032)와 요소 사용처를 합친다.
   * 정의부에 논리명이 있으면 그 이름으로 표시하고(물리명은 title로 확인),
   * 반복 구간이 쓰는 값이면 그 구간 칸이 읽는 항목 필드까지 함께 담는다 (ADR-037).
   */
  private _bindingList(): BindingInfo[] {
    const file = this._file;
    if (!file) return [];
    const defs = file.template.bindings ?? [];
    const defOf = new Map(defs.map((b) => [b.key, b] as const));

    const uses = new Map<string, BindingUse[]>();
    // 그리드 반복 구간 칸이 어느 항목 필드를 어디서 읽는지 — 정의부 필드에 자리를 붙이는 데 쓴다
    const fieldAt = new Map<string, Map<string, NonNullable<BindingFieldInfo['at']>>>();
    // 정의부에 없는데 칸이 쓰고 있는 필드 (옛 파일 호환 — 목록에서 감추지 않는다)
    const strayFields = new Map<string, Map<string, string>>();

    file.template.pages.forEach((page, pageIndex) => {
      for (const el of page.elements) {
        // 그리드는 반복 구간의 값과 셀에 붙인 값을 함께 쓴다 (ADR-037)
        if (el.type === 'grid') {
          if (el.repeat) {
            const { fromRow, toRow, binding: listKey } = el.repeat;
            const declared = new Set((defOf.get(listKey)?.fields ?? []).map((f) => f.key));
            const at = fieldAt.get(listKey) ?? new Map();
            const stray = strayFields.get(listKey) ?? new Map();
            const band = el.cells
              .filter((c) => c.row >= fromRow && c.row <= toRow && c.binding !== undefined)
              .sort((a, b) => a.column - b.column || a.row - b.row);
            for (const cell of band) {
              const key = cell.binding as string;
              if (!at.has(key)) {
                at.set(key, { pageIndex, gridId: el.id, row: cell.row, column: cell.column });
              }
              if (!declared.has(key) && !stray.has(key)) {
                stray.set(key, gridHeaderTitle(el, cell.column, fromRow) ?? key);
              }
            }
            fieldAt.set(listKey, at);
            strayFields.set(listKey, stray);
          }
          const keys = new Set<string>();
          if (el.repeat) keys.add(el.repeat.binding);
          // 반복 구간 안의 칸이 읽는 것은 항목의 필드다 — 전표 values의 키가 아니므로 목록에 올리지 않는다
          for (const cell of el.cells) {
            if (cell.binding !== undefined && !inRepeatBand(el, cell.row)) keys.add(cell.binding);
          }
          for (const key of keys) {
            const list = uses.get(key) ?? [];
            list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
            uses.set(key, list);
          }
          continue;
        }
        // 변동 이미지도 값을 쓴다 — 사이드바 값 목록에 "쓰는 곳"으로 올린다 (G-47)
        if (el.type === 'image' && el.binding !== undefined) {
          const list = uses.get(el.binding) ?? [];
          list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
          uses.set(el.binding, list);
          continue;
        }
        if (el.type !== 'field') continue;
        const list = uses.get(el.binding) ?? [];
        list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
        uses.set(el.binding, list);
      }
    });

    const list: BindingInfo[] = [];
    const seen = new Set<string>();
    for (const key of [...defs.map((d) => d.key), ...uses.keys()]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const def = defOf.get(key);
      const at = fieldAt.get(key);
      // 정의부의 필드가 단일 원천 — 뒤에 옛 파일의 미등록 필드를 덧붙인다 (ADR-047)
      const fields: BindingFieldInfo[] = (def?.fields ?? []).map((f) => ({
        key: f.key,
        title: f.label ?? f.key,
        rawLabel: f.label,
        valueType: f.valueType,
        defined: true,
        at: at?.get(f.key),
      }));
      for (const [strayKey, title] of strayFields.get(key) ?? []) {
        fields.push({
          key: strayKey,
          title,
          rawLabel: undefined,
          valueType: undefined,
          defined: false,
          at: at?.get(strayKey),
        });
      }
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
   * 왼쪽 사이드바 — 목록·선택·추가·삭제만 한다 (ADR-034). 값 편집은 오른쪽 패널이 맡는다.
   * 페이지 썸네일(클릭 이동), 페이지별 요소 목록(클릭 선택·삭제),
   * 양식 전체의 파라미터 목록(클릭 선택, 반복 구간이 쓰는 값은 항목 필드까지).
   */
  private _renderSidebar() {
    const file = this._file!;
    const s = this._strings.designer;
    const { paper } = file.template;
    // 썸네일 폭(px)에 맞춘 축소 비율 — 높이는 용지 비율대로
    const thumbW = THUMB_WIDTH_PX;
    const scale = thumbW / paper.width;
    const pages = file.template.pages;
    const bindings = this._bindingList();

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
          <span class="side-title">${s.sidebarBindings}</span>
          <button class="side-mini" title=${s.sampleData} aria-label=${s.sampleData}
            @click=${() => {
              this._sampleModalOpen = true;
              this._samplePage = 0;
              this._sampleJsonMode = false;
              this._sampleImageError = null;
              this.requestUpdate();
            }}>${icons.database}</button>
          <button class="side-mini" title=${s.addBinding} aria-label=${s.addBinding}
            @click=${() => this._addBinding()}>${icons.pageAdd}</button>
        </div>
        ${bindings.length === 0
          ? html`<div class="side-empty">—</div>`
          : bindings.map((b) => this._renderBindingRow(b))}
      </div>
    `;
  }

  /**
   * 목록 줄 앞의 펼침 표시 (G-25) — 하위 줄이 있는 줄에만 붙는다.
   *
   * 하위가 없는 줄에는 같은 폭의 빈 자리를 두어 이름 시작 위치가 어긋나지 않게 한다.
   * 요소 목록에도 하위 줄이 생기면 같은 표시를 쓴다.
   *
   * @param hasChildren - 하위 줄이 있는지
   * @param expanded - 지금 펼쳐져 있는지
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
   * 파라미터 한 줄 — 클릭하면 오른쪽 패널에서 편집 (ADR-034).
   * 반복 구간이 쓰는 값이면 그 구간 칸이 읽는 항목 필드가 하위 줄로 붙는다 (ADR-037).
   * 하위 줄은 앞의 펼침 표시로 열고 닫는다 — 기본은 접힘이다 (G-25).
   */
  private _renderBindingRow(b: BindingInfo) {
    const s = this._strings.designer;
    const sel = this._sideSelection;
    const selected = sel?.kind === 'binding' && sel.key === b.key;
    const hasFields = b.fields.length > 0;
    const expanded = hasFields && this._expandedBindings.has(b.key);
    return html`
      <div class="side-row-wrap">
        ${this._renderTwisty(hasFields, expanded, b.label, () => this._toggleBindingRow(b.key))}
        <button class="side-row ${selected ? 'selected' : ''}" title=${b.key}
          @click=${() => this._selectBinding(b.key)}>
          ${TYPE_BADGE.field}<span>${b.label}</span>
        </button>
        <button class="side-mini" title=${s.delete} aria-label="${b.key} ${s.delete}"
          ?disabled=${!b.defined}
          @click=${() => this._removeBindingDef(b.key)}>${icons.remove}</button>
      </div>
      ${expanded
        ? b.fields.map((f) => {
            const fieldSelected = sel?.kind === 'bindingField' && sel.key === b.key && sel.field === f.key;
            return html`
              <div class="side-row-wrap">
                <span class="side-twisty-gap"></span>
                <button class="side-col-row ${fieldSelected ? 'selected' : ''}" title="${b.key}.${f.key}"
                  @click=${() => this._selectBindingField(b.key, f)}><span>${f.title}</span></button>
                <button class="side-mini" title=${s.delete} aria-label="${f.key} ${s.delete}"
                  ?disabled=${!f.defined}
                  @click=${() => this._removeBindingField(b.key, f.key)}>${icons.remove}</button>
              </div>`;
          })
        : nothing}
      ${b.valueType === 'list'
        ? html`
          <div class="side-row-wrap">
            <span class="side-twisty-gap"></span>
            <button class="side-col-row side-add-field" @click=${() => this._addBindingField(b.key)}>
              ${icons.add}<span>${s.addBindingField}</span>
            </button>
          </div>`
        : nothing}
    `;
  }

  /** 값 목록의 하위 줄을 열고 닫는다 (G-25) — 고르는 것과는 별개다 */
  private _toggleBindingRow(key: string): void {
    if (this._expandedBindings.has(key)) this._expandedBindings.delete(key);
    else this._expandedBindings.add(key);
    this.requestUpdate();
  }

  /**
   * 요소 목록 한 줄 (G-44) — 그리드는 값·수식이 붙은 칸을 하위 줄로 펼쳐 볼 수 있다.
   * 하위 줄을 누르면 그 칸이 곧장 선택된다(오른쪽 패널이 칸 편집으로 바뀐다).
   *
   * @param pageIndex - 이 요소가 있는 페이지 번호
   * @param el - 그릴 요소
   * @returns 요소 줄과 (그리드면) 펼쳐진 칸 하위 줄
   */
  private _renderElementRow(pageIndex: number, el: SlipElement) {
    const s = this._strings.designer;
    const cells = isGrid(el) ? this._gridValueCells(el) : [];
    const hasCells = cells.length > 0;
    const expanded = hasCells && this._expandedElements.has(el.id);
    // 그룹·다중 선택이면 선택 모음에 든 줄을 모두 강조한다. 칸이 선택돼 있으면 그리드 줄
    // 자체는 강조하지 않는다 — 하위 칸 줄이 대신 표시된다 (G-27 · G-44)
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
   * 그리드에서 값·수식이 붙은 칸의 목록 (G-44) — 행·열 순으로 정렬한다.
   * 직접 입력한 글만 든 칸은 넣지 않는다(목록을 보면 아는 값은 따로 표시하지 않는다는 원칙).
   *
   * @param grid - 그리드 요소
   * @returns 칸의 위치와 표시 이름(값은 논리명, 수식은 식)
   */
  private _gridValueCells(grid: GridElement): { row: number; column: number; label: string; at: string }[] {
    const s = this._strings.designer;
    const defs = this._file?.template.bindings ?? [];
    const labelOf = new Map(
      defs.filter((b) => b.label !== undefined).map((b) => [b.key, b.label!] as const),
    );
    // 반복 구간 안의 칸은 항목 필드를 읽는다 — 그 목록 파라미터의 하위 필드에서 이름을 찾는다 (ADR-047)
    const fieldLabelOf = new Map(
      (defs.find((b) => b.key === grid.repeat?.binding)?.fields ?? [])
        .filter((f) => f.label !== undefined)
        .map((f) => [f.key, f.label!] as const),
    );
    return grid.cells
      .filter((c) => c.binding !== undefined || c.formula !== undefined)
      .slice()
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((c) => {
        const inBand = inRepeatBand(grid, c.row);
        const name = c.binding !== undefined
          ? (inBand ? fieldLabelOf.get(c.binding) : labelOf.get(c.binding)) ?? c.binding
          : c.formula ?? '';
        return {
          row: c.row,
          column: c.column,
          // 줄에는 칸 이름만 보인다 — 자리(행·열)는 툴팁으로 돌린다 (목록을 보면 아는 값은
          // 따로 표시하지 않는다는 원칙, ADR-034)
          label: name,
          at: s.gridCellLabel
            .replace('{r}', String(c.row + 1))
            .replace('{c}', String(c.column + 1))
            .replace('{name}', name),
        };
      });
  }

  /** 요소 목록에서 그리드의 하위 줄을 열고 닫는다 (G-44) — 고르는 것과는 별개다 */
  private _toggleElementRow(id: string): void {
    if (this._expandedElements.has(id)) this._expandedElements.delete(id);
    else this._expandedElements.add(id);
    this.requestUpdate();
  }

  /**
   * 요소 목록의 칸 하위 줄을 골랐을 때 — 그 칸으로 곧장 간다 (G-44).
   * 칸을 고르면 오른쪽 패널이 칸 편집으로 바뀌므로 선택은 한 갈래로 유지된다.
   *
   * @param pageIndex - 그리드가 있는 페이지 번호
   * @param gridId - 그리드 요소 id
   * @param row - 칸의 행
   * @param column - 칸의 열
   */
  private _selectGridCell(pageIndex: number, gridId: string, row: number, column: number): void {
    this._goToPage(pageIndex);
    // 칸을 고를 땐 그 그리드 하나만 선택한다(그룹 확장하지 않음)
    this._selectedId = gridId;
    this._selectedIds = new Set([gridId]);
    this._selectedCell = { row, column };
    this._cellEditing = false;
    this._sideSelection = null;
    this._expandedElements.add(gridId);
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // 요소·파라미터 정의부 편집 (D-13, ADR-032 · 개편 ADR-034)
  // ---------------------------------------------------------------------------

  /** 사이드바에서 요소를 지운다 — 그 페이지에서만 찾아 제거한다 */
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

  /** 파라미터을 기본 이름으로 즉시 만들고 고른다 — 이름은 오른쪽 패널에서 고친다 (ADR-034) */
  private _addBinding(): void {
    if (!this._file) return;
    const { key, label } = this._nextBinding();
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      defs.push({ key, label });
      f.template.bindings = defs;
    });
    this._selectBinding(key);
  }

  /**
   * 요소가 쓰는 파라미터를 정의부에 등록해 둔다 — 목록이 값의 단일 원천이 되게 한다 (ADR-034).
   *
   * @param key - 파라미터 물리명
   * @param valueType - 등록할 값 종류. 이미 있는 항목이면 종류가 비어 있을 때만 채운다
   */
  private _ensureBindingDef(key: string, valueType?: BindingValueType): void {
    const file = this._file;
    if (!file || !key) return;
    const defs = file.template.bindings ?? [];
    const found = defs.find((b) => b.key === key);
    if (found) {
      // 반복 구간이 쓰는 값은 목록이어야 하위 필드를 선언할 수 있다 (ADR-047)
      if (valueType !== undefined && found.valueType === undefined) found.valueType = valueType;
      return;
    }
    defs.push(valueType === undefined ? { key } : { key, valueType });
    file.template.bindings = defs;
  }

  /**
   * 물리명을 바꾼다 — 정의부와 이 이름을 쓰는 요소·샘플 값을 함께 고친다.
   * 빈 이름이나 이미 쓰는 이름은 무시한다.
   */
  private _renameBindingKey(key: string, next: string, input?: HTMLInputElement): void {
    const trimmed = next.trim();
    if (!trimmed || trimmed === key || this._bindingList().some((b) => b.key === trimmed)) {
      // 되돌린 값이 화면에 남지 않게 입력칸을 지금 이름으로 되돌린다
      if (input) input.value = key;
      this._bindingKeyError = trimmed !== key && trimmed !== '';
      this.requestUpdate();
      return;
    }
    this._bindingKeyError = false;
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      const def = defs.find((b) => b.key === key);
      if (def) def.key = trimmed;
      else defs.push({ key: trimmed });
      f.template.bindings = defs;
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type === 'field' && el.binding === key) el.binding = trimmed;
          if (el.type === 'grid') {
            if (el.repeat?.binding === key) el.repeat.binding = trimmed;
            for (const cell of el.cells) {
              // 반복 구간 안 칸의 파라미터은 항목 필드(별도 네임스페이스)라 전표 값 키 이름
              // 변경 대상이 아니다 — 같은 이름이 우연히 겹쳐도 건드리지 않는다
              const inBand =
                el.repeat !== undefined && cell.row >= el.repeat.fromRow && cell.row <= el.repeat.toRow;
              if (!inBand && cell.binding === key) cell.binding = trimmed;
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
    this._sideSelection = { kind: 'binding', key: trimmed };
    this.requestUpdate();
  }

  /** 논리명을 바꾼다 — 정의부에 없던 키면 항목을 만들어 기록한다 (빈 값은 논리명 제거) */
  private _commitBindingLabel(key: string, label: string): void {
    const trimmed = label.trim();
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      const def = defs.find((b) => b.key === key);
      if (def) {
        if (trimmed) def.label = trimmed;
        else delete (def as { label?: string }).label;
      } else {
        defs.push(trimmed ? { key, label: trimmed } : { key });
      }
      f.template.bindings = defs;
    });
  }

  /**
   * 파라미터의 값 종류를 바꾼다 (ADR-047) — 목록이 아니게 되면 하위 필드도 함께 지운다.
   *
   * @param key - 파라미터 물리명
   * @param valueType - 새 값 종류 (빈 문자열이면 지정 없음 = 글자)
   */
  private _setBindingValueType(key: string, valueType: string): void {
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      const def = defs.find((b) => b.key === key) ?? { key };
      if (!defs.includes(def)) defs.push(def);
      if (valueType) def.valueType = valueType as BindingValueType;
      else delete (def as { valueType?: unknown }).valueType;
      // 목록이 아니면 하위 필드는 스키마가 거부한다 — 종류를 바꿀 때 함께 정리한다
      if (valueType !== 'list') delete (def as { fields?: unknown }).fields;
      f.template.bindings = defs;
    });
  }

  /** 목록 파라미터에 하위 필드를 기본 이름으로 더하고 고른다 (ADR-047) */
  private _addBindingField(listKey: string): void {
    const existing = this._bindingList().find((b) => b.key === listKey)?.fields ?? [];
    const used = new Set(existing.map((f) => f.key));
    let n = existing.length + 1;
    while (used.has(`field${n}`)) n += 1;
    const key = `field${n}`;
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      const def = defs.find((b) => b.key === listKey);
      if (!def) return;
      const fields = def.fields ?? [];
      fields.push({ key });
      def.fields = fields;
      f.template.bindings = defs;
    });
    this._expandedBindings.add(listKey);
    this._sideSelection = { kind: 'bindingField', key: listKey, field: key };
    this.requestUpdate();
  }

  /**
   * 하위 필드의 물리명을 바꾼다 — 이 필드를 읽는 반복 구간 칸도 함께 따라간다 (ADR-047).
   *
   * @param listKey - 목록 파라미터 물리명
   * @param key - 지금 필드 물리명
   * @param next - 새 물리명
   * @param input - 되돌릴 입력칸 (중복·빈 이름일 때)
   */
  private _renameBindingField(listKey: string, key: string, next: string, input?: HTMLInputElement): void {
    const trimmed = next.trim();
    const siblings = this._bindingList().find((b) => b.key === listKey)?.fields ?? [];
    if (!trimmed || trimmed === key || siblings.some((f) => f.key === trimmed)) {
      if (input) input.value = key;
      this._bindingKeyError = trimmed !== key && trimmed !== '';
      this.requestUpdate();
      return;
    }
    this._bindingKeyError = false;
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      const def = defs.find((b) => b.key === listKey);
      const field = def?.fields?.find((x) => x.key === key);
      if (field) field.key = trimmed;
      // 이 목록을 반복 구간으로 쓰는 그리드의 칸만 따라간다 — 항목 필드는 별도 네임스페이스다
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type !== 'grid' || el.repeat?.binding !== listKey) continue;
          const { fromRow, toRow } = el.repeat;
          for (const cell of el.cells) {
            if (cell.row >= fromRow && cell.row <= toRow && cell.binding === key) cell.binding = trimmed;
          }
        }
      }
    });
    this._sideSelection = { kind: 'bindingField', key: listKey, field: trimmed };
    this.requestUpdate();
  }

  /**
   * 하위 필드의 논리명·값 종류를 바꾼다 (ADR-047).
   *
   * @param listKey - 목록 파라미터 물리명
   * @param key - 필드 물리명
   * @param patch - 바꿀 값 (빈 문자열이면 그 항목을 지운다)
   */
  private _updateBindingField(
    listKey: string,
    key: string,
    patch: { label?: string; valueType?: string },
  ): void {
    this._updateFile((f) => {
      const def = (f.template.bindings ?? []).find((b) => b.key === listKey);
      const field = def?.fields?.find((x) => x.key === key);
      if (!field) return;
      if (patch.label !== undefined) {
        const trimmed = patch.label.trim();
        if (trimmed) field.label = trimmed;
        else delete (field as { label?: string }).label;
      }
      if (patch.valueType !== undefined) {
        if (patch.valueType) field.valueType = patch.valueType as BindingValueType;
        else delete (field as { valueType?: unknown }).valueType;
      }
    });
  }

  /** 목록 파라미터에서 하위 필드를 지운다 — 그 필드를 읽던 칸의 값은 비운다 (ADR-047) */
  private _removeBindingField(listKey: string, key: string): void {
    this._updateFile((f) => {
      const def = (f.template.bindings ?? []).find((b) => b.key === listKey);
      if (!def?.fields) return;
      const rest = def.fields.filter((x) => x.key !== key);
      if (rest.length > 0) def.fields = rest;
      else delete (def as { fields?: unknown }).fields;
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type !== 'grid' || el.repeat?.binding !== listKey) continue;
          const { fromRow, toRow } = el.repeat;
          for (const cell of el.cells) {
            if (cell.row >= fromRow && cell.row <= toRow && cell.binding === key) {
              delete (cell as { binding?: string }).binding;
            }
          }
        }
      }
    });
    const sel = this._sideSelection;
    if (sel?.kind === 'bindingField' && sel.key === listKey && sel.field === key) {
      this._sideSelection = { kind: 'binding', key: listKey };
    }
    this.requestUpdate();
  }

  /** 정의부에서 파라미터을 제거한다 — 요소가 쓰는 키면 목록에는 사용처 기준으로 남는다 */
  private _removeBindingDef(key: string): void {
    this._updateFile((f) => {
      const defs = (f.template.bindings ?? []).filter((b) => b.key !== key);
      if (defs.length > 0) f.template.bindings = defs;
      else delete (f.template as { bindings?: unknown }).bindings;
    });
    // 목록에서 사라진 파라미터을 고른 채로 두지 않는다
    const sel = this._sideSelection;
    if (sel?.kind === 'binding' && sel.key === key && !this._bindingList().some((b) => b.key === key)) {
      this._sideSelection = null;
      this.requestUpdate();
    }
  }

  // ---------------------------------------------------------------------------
  // Render: canvas
  // ---------------------------------------------------------------------------

  /**
   * 캔버스에 페이지 번호 자리표시를 그린다 (G-46) — 실제 번호는 PDF 후처리로 들어가므로
   * 캔버스에는 `X / X`만 보인다 (ADR-012: 화면에 못 그리는 실제 값을 지어내지 않는다).
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
   * 커서 위치를 용지 좌표(mm)로 기록한다 — 눈금자 표시선과 좌표 표시에 쓴다 (F-20).
   * 용지 밖이면 지운다.
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
   * mm 눈금자 — 10mm마다 긴 눈금과 숫자, 5mm마다 짧은 눈금을 그린다 (F-20).
   * 커서가 용지 위에 있으면 그 위치에 표시선을 함께 그린다.
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
   * 샘플 값 JSON의 뼈대 — 선언된 파라미터를 모두 담고 지금 값을 얹는다 (ADR-047).
   *
   * @remarks
   * 입력폼 탭과 JSON 탭이 같은 것을 보여야 한다. 비워 둔 값도 키로 남겨야 무엇을 채우면
   * 되는지 알 수 있고, 두 탭을 오갈 때 내용이 달라지지 않는다.
   *
   * @returns 파라미터 물리명 → 값 (없으면 종류에 맞는 빈 값)
   */
  private _sampleSkeleton(): Record<string, unknown> {
    const samples = this._file?.template.sampleValues ?? {};
    const emptyFor = (type: BindingValueType | undefined): unknown => {
      switch (type) {
        case 'number': return 0;
        case 'boolean': return false;
        case 'list': return [];
        default: return '';
      }
    };
    const out: Record<string, unknown> = {};
    for (const b of this._bindingList()) {
      const current = samples[b.key];
      if (current !== undefined) {
        out[b.key] = current;
        continue;
      }
      // 목록은 항목 하나를 뼈대로 넣어 어떤 필드를 채우면 되는지 보인다
      if (b.valueType === 'list' && b.fields.length > 0) {
        const item: Record<string, unknown> = {};
        for (const f of b.fields) item[f.key] = emptyFor(f.valueType);
        out[b.key] = [item];
        continue;
      }
      out[b.key] = emptyFor(b.valueType);
    }
    return out;
  }

  /** 인라인 셀 편집 입력 상자 — 선택 셀 위에 겹쳐 그린다 (C-10) */
  private _renderCellEditor() {
    if (!this._cellEditing || !this._selectedCell) return nothing;
    const el = this._findSelectedElement();
    if (!isGrid(el)) return nothing;
    const { row, column } = this._selectedCell;
    const rect = this._cellRectPx(el, row, column);
    const cell = el.cells.find((c) => c.row === row && c.column === column);
    // 입력 상자가 자기 배경색으로 칠하면 칸에 준 배경색이 편집하는 동안만 사라져
    // 색을 확인하며 고칠 수 없다 — 칸의 실제 표시 스타일을 그대로 물려받는다
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

  /** 선 그리기 미리보기 — 드래그 중이거나 두 번 클릭 생성 중일 때 반투명 선 (C-11) */
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
    // 크기 조절 핸들·끝점은 요소 하나를 고른 때만 — 그룹·다중 선택이면 강조만 하고 이동만 된다 (G-27)
    if (this._selectedIds.size > 1) return nothing;
    const el = this._findSelectedElement();
    if (!el) return nothing;
    const x = el.position.x * PX_PER_MM;
    const y = el.position.y * PX_PER_MM;
    const w = el.width * PX_PER_MM;
    const h = el.height * PX_PER_MM;
    // 선은 상자·8방향 핸들 대신 선 하이라이트 + 양 끝점 핸들 2개로 표시한다 (C-11)
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
    // 그룹·다중 선택이면 선택된 요소를 모두 강조한다 (G-27)
    const selected = this._selectedIds.has(el.id);

    let style = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

    // 선·타원·삼각형은 svg로 그린다 — 상자(div)에 배경·테두리를 칠하면 PDF와 어긋난다
    const drawnAsSvg = el.type === 'line' || el.type === 'ellipse' || el.type === 'polygon';
    if (el.type !== 'image' && !drawnAsSvg) {
      const r = el as Record<string, unknown>;
      if (r.backgroundColor) style += `;background-color:${r.backgroundColor}`;
      if (r.fontColor) style += `;color:${r.fontColor}`;
      /*
       * 테두리는 **PDF가 실제로 그릴 것**을 그대로 그린다 (ADR-012).
       * 사각형·그리드는 굵기를 지정하지 않아도 변환 계층이 기본 굵기·검정으로 그리므로,
       * 캔버스만 흐린 편집 보조선을 두면 화면과 PDF가 어긋난다. 굵기가 0(없음)일 때만
       * 그릴 것이 없으므로 보조선을 남겨 요소 자리를 보이게 한다.
       */
      const effectiveWidth = typeof r.borderWidth === 'number'
        ? r.borderWidth
        : (el.type === 'text' || el.type === 'field' ? 0 : DEFAULT_LINE_WIDTH);
      if (effectiveWidth > 0) {
        const color = (r.borderColor as string | undefined) ?? DEFAULT_BORDER_COLOR;
        style += `;border-color:${color}`;
        style += `;border-width:${(effectiveWidth * PX_PER_MM).toFixed(2)}px`;
      } else {
        // 테두리 없음 — 편집 보조선만 남긴다(화면 전용, PDF에는 아무것도 안 그린다)
        style += ';border-color:var(--sk-guide-faint)';
      }
      if (el.type === 'rect') {
        // 모서리 반경·테두리 형태는 사각형 도형에서만 PDF와 함께 지원 (ADR-032)
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
        // 변동 이미지는 샘플 값이 있으면 그 이미지로, 없으면 값 이름으로 그린다 —
        // 미리보기(PDF)도 샘플 값으로 렌더하므로 화면과 어긋나지 않는다 (G-47, ADR-012)
        if (el.binding !== undefined) {
          const sample = this._file?.template.sampleValues?.[el.binding];
          return typeof sample === 'string' && sample.startsWith('data:')
            ? html`<img src=${sample} alt="">`
            : html`<span class="el-content">{${el.binding}}</span>`;
        }
        // 자리표시(1×1 투명 PNG)는 그리면 빈 상자로만 보인다 — 아직 안 골랐음을 글자로 알린다 (G-36)
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

      case 'field':
        return html`<span class="el-content"
          style="font-size:${fontPx(el.fontSize)};text-align:${el.alignment ?? 'left'}${textStyleCss(el)}"
          >${stackVertically(`{${el.binding}}`, el.vertical)}</span>`;

      case 'barcode':
        return this._renderBarcodePreview(el);
    }
  }

  /**
   * 바코드 캔버스 견본 (G-33) — 진짜 바코드는 PDF 미리보기가 그린다(ADR-012). 편집 중에는
   * 종류에 맞는 생김새 견본(2차원은 정사각 격자, 1차원은 막대 줄)과 값·종류를 보여
   * 자리와 크기를 가늠하게 한다. 실제 데이터로 그리지 않으므로 화면·PDF 불일치가 아니다.
   */
  private _renderBarcodePreview(el: SlipElement & { type: 'barcode' }) {
    const label = el.content ?? (el.binding !== undefined ? `{${el.binding}}` : el.formula ?? '');
    const color = el.fontColor ?? '#000000';
    const kindLabel = BARCODE_KINDS.find((k) => k.value === el.kind)?.label ?? el.kind;
    // 종류·값을 함께 보여 무엇을 담았는지 알게 한다 (빈 상자만 두면 알 수 없다)
    const caption = html`<span class="barcode-caption">${kindLabel}${label ? ` · ${label}` : ''}</span>`;
    if (BARCODE_2D.has(el.kind)) {
      // 2차원 견본 — 모서리 3곳의 위치 탐지 무늬 + 바둑판 채움 (실제 인코딩 아님)
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
    // 1차원 견본 — 굵기가 다른 세로 막대 줄 (실제 인코딩 아님)
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
   * 도형 캔버스 표시 — PDF 변환(convert.ts appendShape)과 같은 규칙으로
   * 선 방향·타원·삼각형·파선을 그린다 (사각형은 상자 div의 배경·테두리로 표시).
   * svg 안의 조각은 lit svg 템플릿으로 만들어야 SVG 네임스페이스로 생성된다.
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
      // 곡선 테두리는 실선 고정 (PDF 렌더 규칙과 동일, ADR-032)
      return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        ${svg`<ellipse cx=${w / 2} cy=${h / 2} rx=${Math.max(0, (w - strokeWidth) / 2)}
          ry=${Math.max(0, (h - strokeWidth) / 2)} fill=${fill} stroke=${stroke}
          stroke-width=${strokeWidth} />`}
      </svg>`;
    }
    // polygon — 정다각형을 상자에 내접 (convert.ts appendPolygon과 같은 규칙)
    const points = polygonPointsPx(el.sides, w, h)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      ${svg`<polygon points=${points} fill=${fill} stroke=${stroke}
        stroke-width=${strokeWidth} />`}
    </svg>`;
  }

  /**
   * 그리드 요소의 캔버스 표시 — 반복 구간을 `perPage`번 펼쳐 실제로 인쇄될 모습을 보여준다.
   * 값·수식 칸은 샘플 값이 있으면 그 값으로, 없으면 값 이름으로 채운다 (ADR-037).
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

    // 자동 병합 열 — 반복 구간에서 앞 벌과 값이 같은 칸을 세로로 합친다 (ADR-038)
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

    // 틀의 셀을 화면 행으로 옮긴다 — 반복 구간은 벌마다 한 번씩. 자동 병합 열은 앞 벌과 값이
    // 같으면 세로로 합쳐(rowSpan을 늘려) PDF(expandRepeatBand)와 같은 모습을 보인다 (ADR-012/038).
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
          // 병합 판단은 표시용 placeholder({binding})가 아니라 실제 값으로 한다 — 빈 값이면
          // 합치지 않는다(PDF expandRepeatBand과 동일, ADR-038/012). 표시 텍스트는 아래 boxes에서 따로 그린다.
          const text = this._gridCellMergeText(cell, item);
          // 빈 값·항목 없음은 합치지 않고 병합을 끊는다 (ADR-038)
          if (item === undefined || text === '') {
            placed.push({ cell, row: cell.row + i * bandRows, rowSpan: baseSpan, item });
            anchor = null;
            continue;
          }
          if (anchor && anchor.text === text) {
            anchor.entry.rowSpan += bandRows; // 앞 칸에 흡수 — 이 칸은 그리지 않는다
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
      // 그리드 칸은 flex row라 가로 정렬은 justify-content, 세로 정렬은 align-items다.
      // textStyleCss는 세로 정렬을 justify-content로 넣으므로(flex column용) 여기선 빼서
      // 가로 정렬을 덮지 않게 한다 (ADR-012 — 캔버스·PDF 정렬 일치).
      const merged = { ...el, ...cell };
      const style = [
        `grid-area:${row + 1}/${cell.column + 1}/span ${rowSpan}/span ${cell.colSpan ?? 1}`,
        `border:${borderCssOf(cell)}`,
        `font-size:${fontPx(cell.fontSize ?? el.fontSize)}`,
        `justify-content:${justifyOf(cell.alignment ?? el.alignment)}`,
        `align-items:${verticalFlexAlign(merged.verticalAlignment)}`,
        // 세로쓰기 칸은 쌓은 글자의 줄바꿈이 살아야 한 열로 보인다 (ADR-012)
        cell.vertical === true ? 'white-space:pre-wrap' : '',
        cell.backgroundColor ? `background-color:${cell.backgroundColor}` : '',
        (cell.fontColor ?? el.fontColor) ? `color:${cell.fontColor ?? el.fontColor}` : '',
      ].filter(Boolean).join(';') + textStyleCss(merged, { omitVerticalAlign: true });
      return html`<div class=${isSelectedCell ? 'cell-selected' : ''} style=${style}
        >${stackVertically(this._gridCellPreviewText(cell, item), cell.vertical)}</div>`;
    });

    // 셀이 없는 칸도 괘선은 그려야 빈 줄까지 보이는 실제 모습이 된다 (SPEC §5.7)
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

  /** 반복 구간이 미리보기에 쓸 샘플 항목 목록 — 없으면 빈 배열 */
  private _repeatSampleItems(el: GridElement): Record<string, unknown>[] {
    if (!el.repeat) return [];
    const sample = this._file?.template.sampleValues?.[el.repeat.binding];
    if (!Array.isArray(sample)) return [];
    return sample
      .filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map((row) => row as unknown as Record<string, unknown>);
  }

  /** 셀에 보일 글 — 직접 입력한 글은 그대로, 파라미터·수식은 샘플 값으로 채우고 없으면 이름을 보여준다 */
  private _gridCellPreviewText(cell: GridCell, item: Record<string, unknown> | undefined): string {
    const values = { ...(this._file?.template.sampleValues ?? {}), ...(item ?? {}) };
    if (cell.binding !== undefined) {
      const value = values[cell.binding];
      return value === undefined || value === null ? `{${cell.binding}}` : String(value);
    }
    if (cell.formula !== undefined) {
      try {
        const result = evaluateFormula(cell.formula, { values });
        return result === null ? '' : String(result);
      } catch {
        return `= ${cell.formula}`;
      }
    }
    return cell.content ?? '';
  }

  /**
   * 자동 병합 판단용 칸 값 — 표시용 placeholder가 아니라 실제 값을 돌려준다.
   * 빈 값(미입력·null·수식 null)은 빈 문자열이라 합치지 않는다 — PDF(convert.ts gridCellText·
   * toDisplayText)와 같은 규칙으로 화면·PDF가 어긋나지 않게 한다 (ADR-038·012).
   */
  private _gridCellMergeText(cell: GridCell, item: Record<string, unknown> | undefined): string {
    const values = { ...(this._file?.template.sampleValues ?? {}), ...(item ?? {}) };
    if (cell.binding !== undefined) {
      const value = values[cell.binding];
      return value === null || value === undefined ? '' : String(value);
    }
    if (cell.formula !== undefined) {
      try {
        const result = evaluateFormula(cell.formula, { values });
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

  /** 파일 차원 속성(제목·용지 등)을 되돌리기 스냅샷과 함께 고친다 */
  private _updateFile(fn: (file: SlipTemplateFile) => void): void {
    if (!this._file) return;
    this._pushUndo();
    fn(this._file);
    this._emitChange();
    this.requestUpdate();
  }

  /**
   * 페이지 설정 패널 (G-46) — 이름·번호 표시·순서를 그 페이지 화면에서 정한다.
   * 설정 대상은 늘 현재 페이지다 — 사이드바에서 다른 페이지를 고르면 그 페이지로 옮겨 이 패널이 갱신된다.
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

    // 번호 위치 6종 — 아래·위 가장자리의 좌·중앙·우 (SPEC §4)
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
        <div class="cell-hint">${s.pageNameHint}</div>
        <div class="prop-row">
          <label>${s.pageKey}</label>
          <input class=${this._pageKeyError ? 'error' : ''} .value=${page.key ?? ''}
            @change=${(e: Event) => this._commitPageKey(index, valOf(e))}>
        </div>
        ${this._pageKeyError ? html`<div class="cell-hint error">${s.keyInUse}</div>` : nothing}
      </div>

      <div class="prop-section">
        <div class="prop-row">
          <label>${s.pageNumberShow}</label>
          <input type="checkbox" aria-label=${s.pageNumberShow} .checked=${pageNumber !== undefined}
            @change=${(e: Event) => this._togglePageNumber(index, (e.target as HTMLInputElement).checked)}>
        </div>
        ${pageNumber
          ? html`
            <div class="prop-row">
              <label>${s.pageNumberPosition}</label>
              <select aria-label=${s.pageNumberPosition}
                @change=${(e: Event) =>
                  this._updateFile((f) => {
                    f.template.pages[index]!.pageNumber = {
                      ...f.template.pages[index]!.pageNumber!,
                      position: (e.target as HTMLSelectElement).value as PageNumberPosition,
                    };
                  })}>
                ${positions.map((p) => html`
                  <option value=${p.value} ?selected=${p.value === pageNumber.position}>${p.label}</option>`)}
              </select>
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
   * 페이지 물리명을 고친다 — 빈 값이면 지우고, 다른 페이지와 겹치면 되돌린다 (G-46, SPEC §4).
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
   * 페이지 번호 표시를 켜고 끈다 — 켜면 기본 위치(아래 가운데)로 시작한다 (G-46).
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

  /** 호스트가 좁힌 바코드 종류를 불러 온다 (ADR-048) — 없거나 비면 12종을 모두 보인다 */
  private async _loadBarcodeKinds(): Promise<void> {
    const kinds = this.settings?.getBarcodeKinds ? await this.settings.getBarcodeKinds() : [];
    this._hostBarcodeKinds = kinds ?? [];
    this.requestUpdate();
  }

  /** 바코드 고르개에 보일 종류 — 호스트가 좁혔으면 그 목록, 아니면 전부 (ADR-048) */
  private _barcodeKinds(): readonly { value: BarcodeKind; label: string }[] {
    if (this._hostBarcodeKinds.length === 0) return BARCODE_KINDS;
    const allowed = new Set(this._hostBarcodeKinds);
    return BARCODE_KINDS.filter((k) => allowed.has(k.value));
  }

  /** 호스트가 공급하는 용지 목록을 불러 온다 (G-31) — 없으면 빈 목록 */
  private async _loadPaperSizes(): Promise<void> {
    const sizes = this.settings?.getPaperSizes ? await this.settings.getPaperSizes() : [];
    this._hostPaperSizes = sizes ?? [];
    this.requestUpdate();
  }

  /**
   * 지금 용지 크기를 호스트에 보관한다 (G-31) — 다음에 `getPaperSizes`로 고르개에 돌아온다.
   * 이름이 비었거나 `savePaperSize`를 주지 않았으면 아무것도 하지 않는다.
   *
   * @param name - 고르개에 보일 용지 이름
   */
  private async _savePaperSize(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || !this.settings?.savePaperSize || !this._file) return;
    const { paper } = this._file.template;
    await this.settings.savePaperSize({ name: trimmed, width: paper.width, height: paper.height });
    this._paperSaveName = '';
    // 보관한 크기가 고르개에 나타나도록 목록을 다시 불러온다
    await this._loadPaperSizes();
  }

  /**
   * 양식 설정 패널 — 요소를 선택하지 않았을 때 표시한다.
   * 제목·용지 크기(프리셋/직접 입력)·방향·여백을 편집한다. 방향과 프리셋은
   * 파일에 없는 화면 차원 개념이라 너비·높이로만 반영된다 (포맷 불변).
   *
   * @returns 양식 설정 패널 조각
   */
  private _renderFormSettings() {
    const file = this._file!;
    const s = this._strings.designer;
    const { paper } = file.template;
    const [pt, pr, pb, pl] = paper.padding;
    const landscape = paper.width > paper.height;
    // 동봉 4종 + 호스트가 공급한 용지 (뒤에 붙는다, G-31)
    const allSizes: PaperSize[] = [...PAPER_PRESETS, ...this._hostPaperSizes];
    // 현재 크기와 일치하는 항목 (방향 무관 비교)
    const presetIndex = allSizes.findIndex(
      (p) =>
        (p.width === paper.width && p.height === paper.height) ||
        (p.width === paper.height && p.height === paper.width),
    );
    // 직접 입력한 크기(목록에 없음)이고 호스트가 보관을 받으면 "이 크기 저장"을 보인다
    const canSaveSize = presetIndex < 0 && this.settings?.savePaperSize !== undefined;

    // 여백 합이 용지보다 작아야 한다는 스키마 규칙을 어기는 값은 되돌린다
    const setSize = (width: number, height: number): void => {
      if (width <= pl + pr || height <= pt + pb) {
        this._rejectInput();
        return;
      }
      this._updateFile((f) => {
        f.template.paper.width = round1(width);
        f.template.paper.height = round1(height);
      });
    };
    const setPadding = (index: 0 | 1 | 2 | 3, value: number): void => {
      if (Number.isNaN(value) || value < 0) {
        this._rejectInput();
        return;
      }
      const next = [...paper.padding] as [number, number, number, number];
      next[index] = round1(value);
      if (next[3] + next[1] >= paper.width || next[0] + next[2] >= paper.height) {
        this._rejectInput();
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
        <div class="prop-row">
          <label>${s.formTitle}</label>
          <input .value=${file.template.meta.title}
                 @change=${(e: Event) => {
                   const v = (e.target as HTMLInputElement).value.trim();
                   // 스키마상 제목은 1자 이상 — 빈 값은 되돌린다
                   if (!v) {
                     this._rejectInput();
                     return;
                   }
                   this._updateFile((f) => { f.template.meta.title = v; });
                 }}>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-row">
          <label>${s.paperSize}</label>
          <select .value=${presetIndex >= 0 ? String(presetIndex) : 'custom'}
                  @change=${(e: Event) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (v === 'custom') return;
                    const p = allSizes[Number(v)]!;
                    // 프리셋은 세로 기준 — 현재 방향을 유지해 적용
                    setSize(landscape ? p.height : p.width, landscape ? p.width : p.height);
                  }}>
            ${allSizes.map((p, i) => html`
              <option value=${String(i)} ?selected=${i === presetIndex}>
                ${p.name} (${p.width}×${p.height})
              </option>`)}
            <option value="custom" ?selected=${presetIndex < 0}>${s.paperCustom}</option>
          </select>
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
                   @change=${(e: Event) => setSize(numOf(e), paper.height)}>
          </div>
          <div class="prop-row">
            <label>${s.height}</label>
            <input type="number" step="0.5" min="1" .value=${String(paper.height)}
                   @change=${(e: Event) => setSize(paper.width, numOf(e))}>
          </div>
        </div>
        <div class="prop-row">
          <label>${s.orientation}</label>
          <div class="toggle-group" role="group" aria-label=${s.orientation}>
            ${([
              [false, s.portrait],
              [true, s.landscape],
            ] as const).map(([toLandscape, label]) => html`
              <button class="orient-btn" title=${label} aria-label="${s.orientation}: ${label}"
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
                   @change=${(e: Event) => setPadding(0, numOf(e))}>
          </div>
          <div class="prop-row">
            <label>${s.marginRight}</label>
            <input type="number" step="1" min="0" .value=${String(pr)}
                   @change=${(e: Event) => setPadding(1, numOf(e))}>
          </div>
        </div>
        <div class="prop-pair">
          <div class="prop-row">
            <label>${s.marginBottom}</label>
            <input type="number" step="1" min="0" .value=${String(pb)}
                   @change=${(e: Event) => setPadding(2, numOf(e))}>
          </div>
          <div class="prop-row">
            <label>${s.marginLeft}</label>
            <input type="number" step="1" min="0" .value=${String(pl)}
                   @change=${(e: Event) => setPadding(3, numOf(e))}>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 좌표 기준점 선택 줄 — 3×3 점 격자. 기준점을 바꾸면 X·Y 표시만 그 기준으로
   * 다시 환산되고 요소의 실제 위치·파일 내용은 바뀌지 않는다.
   */
  /**
   * 요소의 기본 기준점 — 선은 **시작점 하나**로 고정한다.
   *
   * @remarks
   * 곧은 선은 상자 가운데에 그려지므로(convert.ts appendLine) 좌상단 기준이면 Y가 선의 자리가
   * 아니라 상자 위쪽을 가리켜 헷갈린다. 그래서 길이 방향이 아닌 축을 가운데로 잡아 왔는데,
   * 방향마다 기준점이 달라 방향을 바꾸면 값이 튀어 보였다. 지금은 방향을 패널에서 바꿀 수 없고
   * (끝점을 끌어 정한다) 선의 기준점은 **좌중앙 하나**로 둔다 — 가로선은 Y가, 세로선은 시작
   * 모서리가 곧 선의 자리다.
   */
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
   * 그룹 패널 (G-27) — 여러 요소를 골랐을 때 묶기·해제를 보인다.
   * 고른 것이 모두 같은 그룹이면 해제만, 아니면 묶기(+ 일부가 그룹이면 해제도) 보인다.
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
        <p class="image-hint">${s.groupHint}</p>
      </div>
    `;
  }

  /** 고른 요소들을 한 그룹으로 묶는다 (G-27) — 공통 그룹 id를 부여한다 */
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

  /** 고른 요소들이 속한 그룹을 모두 해제한다 (G-27) */
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
    // 선택 대상은 요소·파라미터·페이지 셋 — 아무것도 고르지 않았으면 양식 설정 (ADR-034, G-46)
    const sel = this._sideSelection;
    if (sel?.kind === 'binding') return this._renderBindingPanel(sel.key);
    if (sel?.kind === 'bindingField') return this._renderBindingFieldPanel(sel.key, sel.field);
    if (sel?.kind === 'page') return this._renderPageSettings();

    // 여러 요소를 골랐으면 그룹 패널(묶기/해제)을 보인다 (G-27)
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

    return html`
      <div class="type-name">${this._typeName(el.type)}</div>

      <div class="prop-section">
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
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) {
                       // 입력값은 기준점 좌표 — 저장은 늘 좌상단 좌표로 환산
                       this._updateElement((el) => {
                         el.position.x = Math.max(0, round1(v - anchor.ax * el.width));
                       });
                     }
                   }}>
          </div>
          <div class="prop-row">
            <label>Y</label>
            <input type="number" step="0.5" .value=${String(round1(el.position.y + anchor.ay * el.height))}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) {
                       this._updateElement((el) => {
                         el.position.y = Math.max(0, round1(v - anchor.ay * el.height));
                       });
                     }
                   }}>
          </div>
        </div>
        ${this._renderSizeRows(el)}
      </div>

      ${this._renderTypeProps(el)}
      ${this._renderStyleGroups(el)}
    `;
  }

  /**
   * 크기 칸 — 보통은 너비·높이 둘, **곧은 선은 길이 하나와 굵기**로 보여준다.
   *
   * @remarks
   * 가로선의 높이(세로선의 너비)는 길이도 굵기도 아니고 선을 반만큼 밀 뿐이라
   * 내놓으면 굵기 칸으로 오해된다. 대신 진짜 굵기를 크기 옆에 둔다 (G-32).
   * 사선은 너비·높이가 둘 다 끝점을 정하므로 그대로 보여준다.
   */
  private _renderSizeRows(el: SlipElement) {
    const s = this._strings.designer;
    const setSize = (key: 'width' | 'height') => (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (!Number.isNaN(v)) this._updateElement((target) => { target[key] = Math.max(0, v); });
    };
    const sizeRow = (label: string, key: 'width' | 'height') => html`
      <div class="prop-row">
        <label>${label}</label>
        <input type="number" step="0.5" min="1" .value=${String(el[key])}
               aria-label=${label} @change=${setSize(key)}>
      </div>`;

    const straight =
      el.type === 'line' &&
      ((el.lineDirection ?? 'horizontal') === 'horizontal' ||
        el.lineDirection === 'vertical');
    if (straight) {
      const lengthKey = (el.lineDirection ?? 'horizontal') === 'horizontal' ? 'width' : 'height';
      return html`
        <div class="prop-pair">
          ${sizeRow(s.length, lengthKey)}
          ${this._renderBorderWidthSelect(
            el.borderWidth,
            DEFAULT_LINE_WIDTH,
            false,
            'borderWidth',
            (v) => this._updateElement((target) => {
              (target as Record<string, unknown>).borderWidth = v;
            }),
            s.lineWidth,
          )}
        </div>`;
    }
    // 사선은 두 축이 모두 끝점을 정하므로 너비·높이를 그대로 두되, 선 굵기는 함께 보인다 —
    // 곧은 선에만 굵기를 두면 방향을 바꿀 때 굵기 칸이 사라져 고칠 수가 없었다
    if (el.type === 'line') {
      return html`
        <div class="prop-pair">
          ${sizeRow(s.width, 'width')}
          ${sizeRow(s.height, 'height')}
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
   * 파라미터 패널 — 사이드바에서 파라미터을 골랐을 때 (ADR-034).
   * 물리명·논리명을 고치고, 이 값을 쓰는 요소 목록에서 눌러 그 요소로 이동한다.
   */
  /**
   * 목록 파라미터의 하위 필드 편집 패널 (ADR-047) — 이름·논리명·값 종류를 여기서 고친다.
   * 그 필드를 읽는 그리드 칸이 있으면 어디에 쓰이는지 함께 보인다.
   *
   * @param listKey - 목록 파라미터 물리명
   * @param fieldKey - 하위 필드 물리명
   * @returns 하위 필드 편집 조각
   */
  private _renderBindingFieldPanel(listKey: string, fieldKey: string) {
    const s = this._strings.designer;
    const parent = this._bindingList().find((b) => b.key === listKey);
    const info = parent?.fields.find((f) => f.key === fieldKey);
    if (!parent || !info) return this._renderFormSettings();
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="type-name">${s.bindingField}</div>
      <div class="prop-section">
        <div class="prop-row">
          <label>${s.bindingParent}</label>
          <button class="usage-row" @click=${() => this._selectBinding(listKey)}>
            ${TYPE_BADGE.field}<span>${parent.label}</span>
          </button>
        </div>
        <div class="prop-row">
          <label>${s.bindingKey}</label>
          <input class="binding-key-input" .value=${info.key} ?disabled=${!info.defined}
            @change=${(e: Event) =>
              this._renameBindingField(listKey, info.key, valOf(e), e.target as HTMLInputElement)}>
        </div>
        ${this._bindingKeyError
          ? html`<div class="cell-hint error">${s.keyInUse}</div>`
          : nothing}
        <div class="prop-row">
          <label>${s.bindingLabel}</label>
          <input .value=${info.rawLabel ?? ''} placeholder=${info.key} ?disabled=${!info.defined}
            @change=${(e: Event) => this._updateBindingField(listKey, info.key, { label: valOf(e) })}>
        </div>
        <div class="prop-row">
          <label>${s.bindingValueType}</label>
          <select aria-label=${s.bindingValueType} .value=${info.valueType ?? ''} ?disabled=${!info.defined}
            @change=${(e: Event) => this._updateBindingField(listKey, info.key, { valueType: valOf(e) })}>
            ${BINDING_FIELD_VALUE_TYPES.map((t) => html`
              <option value=${t.value} ?selected=${(info.valueType ?? '') === t.value}>
                ${s[t.stringKey]}
              </option>`)}
          </select>
        </div>
        ${info.defined ? nothing : html`<div class="cell-hint">${s.bindingFieldUndeclared}</div>`}
      </div>

      <div class="prop-section">
        <div class="prop-section-title">${s.bindingUsage}</div>
        ${info.at === undefined
          ? html`<div class="side-empty">${s.bindingUnused}</div>`
          : html`
            <button class="usage-row"
              @click=${() => this._selectGridCellAt(info.at!)}>
              ${TYPE_BADGE.grid}<span>${s.cell} (${info.at.row + 1}, ${info.at.column + 1})</span>
              <span class="usage-page">${s.sidebarPages} ${info.at.pageIndex + 1}</span>
            </button>`}
      </div>
    `;
  }

  /** 하위 필드를 읽는 그리드 칸으로 간다 — 「쓰는 곳」에서만 쓴다 (자동 연결이 아니다) */
  private _selectGridCellAt(at: { pageIndex: number; gridId: string; row: number; column: number }): void {
    this._goToPage(at.pageIndex);
    this._selectedId = at.gridId;
    this._selectedIds = new Set([at.gridId]);
    this._selectedCell = { row: at.row, column: at.column };
    this._cellEditing = false;
    this._sideSelection = null;
    this._expandedElements.add(at.gridId);
    this.requestUpdate();
  }

  private _renderBindingPanel(key: string) {
    const s = this._strings.designer;
    const info = this._bindingList().find((b) => b.key === key);
    if (!info) return this._renderFormSettings();
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="type-name">${s.sidebarBindings}</div>

      <div class="prop-section">
        <div class="prop-row">
          <label>${s.bindingKey}</label>
          <input class="binding-key-input" .value=${info.key}
            @change=${(e: Event) =>
              this._renameBindingKey(info.key, valOf(e), e.target as HTMLInputElement)}>
        </div>
        ${this._bindingKeyError
          ? html`<div class="cell-hint error">${s.keyInUse}</div>`
          : nothing}
        <div class="prop-row">
          <label>${s.bindingLabel}</label>
          <input class="binding-label-input" .value=${info.rawLabel ?? ''} placeholder=${info.key}
            @change=${(e: Event) => this._commitBindingLabel(info.key, valOf(e))}>
        </div>
        <div class="prop-row">
          <label>${s.bindingValueType}</label>
          <select aria-label=${s.bindingValueType} .value=${info.valueType ?? ''}
            @change=${(e: Event) => this._setBindingValueType(info.key, valOf(e))}>
            ${BINDING_VALUE_TYPES.map((t) => html`
              <option value=${t.value} ?selected=${(info.valueType ?? '') === t.value}>
                ${s[t.stringKey]}
              </option>`)}
          </select>
        </div>
      </div>

      ${info.valueType === 'list'
        ? html`
          <div class="prop-section">
            <div class="prop-section-title">${s.bindingFields}</div>
            ${info.fields.length === 0
              ? html`<div class="side-empty">${s.bindingFieldsEmpty}</div>`
              : info.fields.map((f) => html`
                  <button class="usage-row" title="${info.key}.${f.key}"
                    @click=${() => this._selectBindingField(info.key, f)}>
                    ${TYPE_BADGE.field}<span>${f.title}</span>
                  </button>`)}
            <button class="prop-add-row" @click=${() => this._addBindingField(info.key)}>
              ${icons.add}<span>${s.addBindingField}</span>
            </button>
          </div>`
        : nothing}

      <div class="prop-section">
        <div class="prop-section-title">${s.bindingUsage}</div>
        ${info.uses.length === 0
          ? html`<div class="side-empty">${s.bindingUnused}</div>`
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
   * 요소가 쓸 값을 등록된 목록에서 고르는 선택 상자 (ADR-034) —
   * "새 값 등록"을 고르면 기본 이름으로 값을 만들어 바로 이 요소에 붙인다.
   */
  /**
   * 파라미터 선택 드롭다운의 공통 틀 — 라벨·목록·"새 값 등록" 항목은 같고, "새 값"과
   * 기존 값 선택 시 동작만 요소마다 다르므로 콜백으로 받는다.
   *
   * @param current - 현재 선택된 파라미터 키
   * @param onNew - "새 값 등록"을 골랐을 때
   * @param onPick - 기존 파라미터을 골랐을 때 (선택한 키)
   * @returns 파라미터 선택 조각
   */
  /**
   * 그리드 칸이 읽을 값을 고르는 선택 상자 (ADR-034/047) — 자유 입력을 없애 오타를 막는다.
   *
   * @remarks
   * 반복 구간 **안**의 칸은 항목의 필드를 읽으므로 그 반복 구간이 쓰는 목록 파라미터의
   * `fields`만 후보로 낸다. 구간 **밖**의 칸은 전표 값을 읽으므로 최상위 파라미터를 낸다.
   * 목록 파라미터는 칸 하나에 담을 수 없어 후보에서 뺀다.
   *
   * @param el - 대상 그리드
   * @param current - 지금 칸에 설정된 값 키
   * @param inBand - 이 칸이 반복 구간 안인지
   * @returns 값 선택 조각
   */
  private _gridCellBindingSelect(el: GridElement, current: string, inBand: boolean) {
    const s = this._strings.designer;
    const all = this._bindingList();
    const listKey = el.repeat?.binding;
    const options = inBand
      ? (all.find((b) => b.key === listKey)?.fields ?? []).map((f) => ({ key: f.key, label: f.title }))
      : all.filter((b) => b.valueType !== 'list').map((b) => ({ key: b.key, label: b.label }));
    // 정의부에 없는 값이 이미 들어 있으면 후보에 넣어 둔다 — 고르는 순간 사라지지 않게
    if (current && !options.some((o) => o.key === current)) {
      options.unshift({ key: current, label: current });
    }
    const canAdd = !inBand || listKey !== undefined;
    return html`
      <select aria-label=${s.binding} .value=${current}
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === NEW_BINDING_OPTION) {
            if (inBand) { if (listKey) this._addBindingFieldForCell(listKey); }
            else this._newBindingForCell();
            return;
          }
          this._setGridCellSource('binding', v);
        }}>
        <option value="" ?selected=${current === ''}>${s.bindingUnpicked}</option>
        ${options.map((o) => html`
          <option value=${o.key} ?selected=${o.key === current}>${o.label}</option>`)}
        ${canAdd
          ? html`<option value=${NEW_BINDING_OPTION}>${inBand ? s.addBindingField : s.bindingNew}</option>`
          : nothing}
      </select>`;
  }

  /** 반복 구간 칸에서 "하위 필드 추가"를 골랐을 때 — 만들고 그 칸에 바로 붙인다 */
  private _addBindingFieldForCell(listKey: string): void {
    const before = new Set((this._bindingList().find((b) => b.key === listKey)?.fields ?? []).map((f) => f.key));
    const cell = this._selectedCell;
    this._addBindingField(listKey);
    const created = (this._bindingList().find((b) => b.key === listKey)?.fields ?? [])
      .find((f) => !before.has(f.key));
    // 칸에서 시작한 흐름이므로 선택을 칸으로 되돌리고 그 값을 붙인다
    this._sideSelection = null;
    this._selectedCell = cell;
    if (created) this._setGridCellSource('binding', created.key);
  }

  /** 구간 밖 칸에서 "새 값 등록"을 골랐을 때 — 파라미터를 만들고 그 칸에 붙인다 */
  private _newBindingForCell(): void {
    const cell = this._selectedCell;
    const { key, label } = this._nextBinding();
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      defs.push({ key, label });
      f.template.bindings = defs;
    });
    this._selectedCell = cell;
    this._setGridCellSource('binding', key);
  }

  private _bindingSelect(current: string, onNew: () => void, onPick: (value: string) => void) {
    const s = this._strings.designer;
    const list = this._bindingList();
    return html`
      <div class="prop-row">
        <label>${s.binding}</label>
        <select class="binding-select" aria-label=${s.binding}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            if (value === NEW_BINDING_OPTION) onNew();
            else onPick(value);
          }}>
          ${list.map((b) => html`
            <option value=${b.key} ?selected=${b.key === current}>${b.label}</option>`)}
          <option value=${NEW_BINDING_OPTION}>${s.bindingNew}</option>
        </select>
      </div>
    `;
  }

  private _renderBindingSelect(current: string) {
    return this._bindingSelect(
      current,
      () => this._assignNewBinding(),
      (value) => this._updateElement((el) => {
        if (el.type === 'field') el.binding = value;
      }),
    );
  }

  /** 새 값을 만들어 지금 고른 요소에 붙인다 — 등록과 연결을 한 번에 (ADR-034) */
  private _assignNewBinding(): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'field') {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextBinding();
    const id = el.id;
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      defs.push({ key, label });
      f.template.bindings = defs;
      for (const page of f.template.pages) {
        for (const target of page.elements) {
          if (target.id === id && target.type === 'field') target.binding = key;
        }
      }
    });
  }

  /** 아직 쓰지 않는 기본 파라미터 이름 한 쌍(물리명·논리명)을 만든다 */
  private _nextBinding(): { key: string; label: string } {
    const used = new Set(this._bindingList().map((b) => b.key));
    let n = 1;
    while (used.has(`value${n}`)) n += 1;
    return { key: `value${n}`, label: `${this._strings.designer.newBindingName} ${n}` };
  }

  /**
   * 이미지 요소를 고정(src) ↔ 변동(binding)으로 바꾼다 (G-47). 스키마가 둘을 배타로
   * 검사하므로 한쪽을 켜면 다른 쪽을 지운다. 변동으로 바꾸면 새 값을 만들어 붙인다.
   *
   * @param variable - true면 변동(binding), false면 고정(src)
   */
  private _setImageVariable(variable: boolean): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'image') {
      this._rejectInput();
      return;
    }
    const id = el.id;
    if (variable) {
      if (el.binding !== undefined) return;
      const { key, label } = this._nextBinding();
      this._updateFile((f) => {
        const defs = f.template.bindings ?? [];
        // 변동 이미지 값은 이미지 종류로 등록해 작성폼·샘플 편집이 이미지 입력을 낸다 (valueType)
        defs.push({ key, label, valueType: 'image' });
        f.template.bindings = defs;
        for (const page of f.template.pages) {
          for (const target of page.elements) {
            if (target.id === id && target.type === 'image') {
              target.binding = key;
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
              delete target.binding;
              target.src = PLACEHOLDER_IMG;
            }
          }
        }
      });
    }
  }

  /** 변동 이미지의 값 키를 고르는 select — 등록된 값 목록 + 새 값 (G-47) */
  private _renderImageBindingSelect(current: string) {
    return this._bindingSelect(
      current,
      () => this._assignNewImageBinding(),
      (value) => {
        this._updateFile((f) => {
          for (const page of f.template.pages) {
            for (const target of page.elements) {
              if (target.id === this._selectedId && target.type === 'image') {
                target.binding = value;
                delete target.src;
              }
            }
          }
        });
        this._ensureBindingDef(value, 'image');
      },
    );
  }

  /** 새 값을 만들어 지금 고른 이미지 요소에 변동 값으로 붙인다 (G-47) */
  private _assignNewImageBinding(): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'image') {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextBinding();
    const id = el.id;
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      defs.push({ key, label, valueType: 'image' });
      f.template.bindings = defs;
      for (const page of f.template.pages) {
        for (const target of page.elements) {
          if (target.id === id && target.type === 'image') {
            target.binding = key;
            delete target.src;
          }
        }
      }
    });
  }

  /**
   * 바코드 값의 종류를 고른다 — 직접 입력·파라미터·수식 중 하나만 가진다 (SPEC §5.6). 종류를
   * 바꾸면 나머지 둘은 지운다. 값(파라미터)으로 바꾸면 유효한 키가 필요하므로 새 값을 만들어 붙인다.
   *
   * @param kind - 고를 값 종류
   */
  private _chooseBarcodeSource(kind: 'content' | 'binding' | 'formula'): void {
    if (kind === 'binding') {
      this._assignNewBarcodeBinding();
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
   * 바코드에 직접 입력한 글·수식을 넣는다 — 나머지 소스는 지운다 (G-33).
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

  /** 바코드 값(파라미터)의 키를 고르는 select — 등록된 값 목록 + 새 값 (G-33) */
  private _renderBarcodeBindingSelect(current: string) {
    return this._bindingSelect(
      current,
      () => this._assignNewBarcodeBinding(),
      (value) => {
        this._updateElement((element) => {
          if (element.type !== 'barcode') return;
          const r = element as Record<string, unknown>;
          delete r.content;
          delete r.formula;
          r.binding = value;
        });
        this._ensureBindingDef(value);
      },
    );
  }

  /** 새 값을 만들어 지금 고른 바코드 요소에 값(파라미터)으로 붙인다 (G-33) */
  private _assignNewBarcodeBinding(): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'barcode') {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextBinding();
    const id = el.id;
    this._updateFile((f) => {
      const defs = f.template.bindings ?? [];
      defs.push({ key, label });
      f.template.bindings = defs;
      for (const page of f.template.pages) {
        for (const target of page.elements) {
          if (target.id === id && target.type === 'barcode') {
            const r = target as Record<string, unknown>;
            delete r.content;
            delete r.formula;
            r.binding = key;
          }
        }
      }
    });
  }

  /**
   * 고정 바코드 값이 종류 규칙에 어긋나면 경고 문구를, 문제없으면 null을 돌려준다 (G-33).
   * 자리 수가 정해진 종류(EAN-13 등)와 CODE39만 검사한다 — 자유로운 종류는 검사하지 않는다.
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

  /** 텍스트 요소의 글 편집 */
  private _renderTextProps(el: TextElement) {
    const s = this._strings.designer;
    return html`
      <div class="prop-section">
        ${this._renderTextFieldKindRow('text')}
        <div class="prop-section-title">${s.content}</div>
        <div class="prop-row">
          <textarea rows="3" .value=${el.content}
            @change=${(e: Event) => this._updateElement((el) => {
              if (el.type === 'text') el.content = (e.target as HTMLTextAreaElement).value;
            })}></textarea>
        </div>
      </div>
    `;
  }

  /**
   * 텍스트 ↔ 필드 전환 줄 — 같은 자리에 놓을 것을 바꿔 끼운다.
   *
   * @remarks
   * 둘은 상자·글자 스타일이 같고 담는 것만 다르다(직접 쓴 글 / 파라미터·수식). 지우고 다시
   * 만들지 않아도 되게 종류를 바꿀 수 있게 한다 — 자리·크기·글자 스타일은 그대로 두고
   * 담는 것만 갈아 끼우며, 요소 종류가 바뀌므로 배지·아이콘도 따라 바뀐다.
   *
   * @param current - 지금 종류
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
   * 텍스트 ↔ 필드로 갈아 끼운다 — 자리·크기·글자 스타일은 그대로 둔다.
   *
   * @remarks
   * 텍스트의 글은 필드로 바꿀 때 버린다(필드는 파라미터·수식에서 값을 읽는다). 반대로
   * 필드를 텍스트로 바꾸면 파라미터·수식을 버리고 빈 글로 시작한다 — 두 방향 모두
   * 되돌리기로 복구된다.
   *
   * @param to - 바꿀 종류
   */
  private _convertTextField(to: 'text' | 'field'): void {
    const el = this._findSelectedElement();
    if (!el || (el.type !== 'text' && el.type !== 'field') || el.type === to) return;
    this._updateElement((target) => {
      const r = target as Record<string, unknown>;
      if (to === 'field') {
        delete r.content;
        r.type = 'field';
        r.binding = '';
      } else {
        delete r.binding;
        delete r.formula;
        r.type = 'text';
        r.content = '';
      }
    });
  }

  /** 필드 요소의 파라미터·수식 편집 */
  private _renderFieldProps(el: FieldElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    return html`
      <div class="prop-section">
        ${this._renderTextFieldKindRow('field')}
        ${this._renderBindingSelect(el.binding)}
        <div class="prop-row">
          <label>${s.formula}</label>
          <input .value=${el.formula ?? ''}
            @change=${(e: Event) => this._updateElement((el) => {
              if (el.type !== 'field') return;
              const v = valOf(e);
              setOptional(el, 'formula', v || null);
            })}>
          <button class="row-btn" title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
            @click=${() => this._openFormulaModal()}>${icons.formula}</button>
        </div>
      </div>
    `;
  }

  /** 바코드 요소의 종류·값(고정·파라미터·수식) 편집 */
  private _renderBarcodeProps(el: BarcodeElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    // 값은 직접 입력·파라미터·수식 중 하나 — 어느 것이 정해졌는지로 종류를 가른다 (SPEC §5.6)
        const source: 'content' | 'binding' | 'formula' =
          el.binding !== undefined ? 'binding' : el.formula !== undefined ? 'formula' : 'content';
        // 편집 중 경고 — 고정 값이 종류 규칙에 어긋날 때만 (파라미터·수식 값은 전표에서 정해진다, G-33)
        const warning = source === 'content' ? this._barcodeContentWarning(el.kind, el.content ?? '') : null;
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.barcodeKind}</label>
              <select aria-label=${s.barcodeKind} .value=${el.kind}
                @change=${(e: Event) => this._updateElement((target) => {
                  if (target.type === 'barcode') target.kind = (e.target as HTMLSelectElement).value as BarcodeKind;
                })}>
                ${this._barcodeKinds().some((k) => k.value === el.kind)
                  ? nothing
                  : html`<option value=${el.kind} selected>${el.kind}</option>`}
                ${this._barcodeKinds().map((k) => html`
                  <option value=${k.value} ?selected=${k.value === el.kind}>${k.label}</option>`)}
              </select>
            </div>
            <div class="prop-row">
              <label>${s.barcodeValue}</label>
              <select aria-label=${s.barcodeValue} .value=${source}
                @change=${(e: Event) =>
                  this._chooseBarcodeSource((e.target as HTMLSelectElement).value as 'content' | 'binding' | 'formula')}>
                <option value="content" ?selected=${source === 'content'}>${s.cellSourceText}</option>
                <option value="binding" ?selected=${source === 'binding'}>${s.cellSourceBinding}</option>
                <option value="formula" ?selected=${source === 'formula'}>${s.cellSourceFormula}</option>
              </select>
            </div>
            ${source === 'content'
              ? html`
                <div class="prop-row">
                  <label>${s.content}</label>
                  <input .value=${el.content ?? ''}
                    @change=${(e: Event) => this._setBarcodeSource('content', valOf(e))}>
                </div>
                ${warning ? html`<p class="image-error" role="alert">${warning}</p>` : nothing}`
              : source === 'binding'
                ? this._renderBarcodeBindingSelect(el.binding ?? '')
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
   * 선 요소 패널 — 방향은 두지 않는다.
   *
   * @remarks
   * 방향은 **끝점 핸들을 끌면 그때 정해진다**(`_onEndpointMove`) — 캔버스에서 이미 하는 일을
   * 패널에 겹쳐 두지 않는다는 원칙이다 (CLAUDE.md 「작업 원칙」). 방향을 패널에서 바꿀 수 있으면
   * 기준점 기본값도 함께 바뀌어 값이 튀어 보였다. 남는 것은 자리·길이·굵기·색·형태뿐이다.
   */
  private _renderLineProps(_el: LineElement) {
    return nothing;
  }

  /** 정다각형 요소의 변 수 편집 */
  private _renderPolygonProps(el: PolygonElement) {
    const s = this._strings.designer;
    return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.sides}</label>
              <input type="number" min="3" max="12" step="1" .value=${String(el.sides)}
                @change=${(e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  // 스키마 범위(3~12) 밖 값은 되돌린다
                  if (!Number.isInteger(v) || v < 3 || v > 12) {
                    this._rejectInput();
                    return;
                  }
                  this._updateElement((el) => {
                    if (el.type === 'polygon') el.sides = v;
                  });
                }}>
            </div>
          </div>
        `;
  }

  /** 그리드 요소의 행·열·반복 구간·칸 편집 */
  private _renderGridProps(el: GridElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    const cellTarget = this._selectedCell;
        const cellDef = cellTarget
          ? el.cells.find((c) => c.row === cellTarget.row && c.column === cellTarget.column)
          : undefined;
        const repeat = el.repeat;
        const source: 'content' | 'binding' | 'formula' =
          this._cellSourceKind
          ?? (cellDef?.binding !== undefined ? 'binding' : cellDef?.formula !== undefined ? 'formula' : 'content');
        const inBand =
          cellTarget !== null && repeat !== undefined
          && cellTarget.row >= repeat.fromRow && cellTarget.row <= repeat.toRow;
        const numberOf = (e: Event): number => Number((e.target as HTMLInputElement).value);
        // 그리드 자체 옵션 — 칸을 고르면 감춘다(무엇을 고치는 중인지 헷갈리지 않게, ADR-034)
        const gridOwnProps = html`
          <div class="prop-section">
            <div class="prop-pair">
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
            <div class="prop-row stacked">
              <label>${s.overflow}</label>
              <select aria-label=${s.overflow} .value=${el.overflow ?? 'clip'}
                @change=${(e: Event) => this._updateGrid((grid) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value === 'clip') delete (grid as { overflow?: unknown }).overflow;
                  else grid.overflow = 'shrink';
                })}>
                <option value="clip" ?selected=${(el.overflow ?? 'clip') === 'clip'}>${s.overflowClip}</option>
                <option value="shrink" ?selected=${el.overflow === 'shrink'}>${s.overflowShrink}</option>
              </select>
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
                  <label>${s.binding}</label>
                  <select class="binding-select" aria-label="${s.repeatSection} ${s.binding}"
                    @change=${(e: Event) => this._updateGridRepeat({ binding: (e.target as HTMLSelectElement).value })}>
                    ${this._bindingList().filter((b) => b.valueType === 'list' || b.key === repeat.binding).map((b) => html`
                      <option value=${b.key} ?selected=${b.key === repeat.binding}>${b.label}</option>`)}
                    ${this._bindingList().some((b) => b.key === repeat.binding)
                      ? nothing
                      : html`<option value=${repeat.binding} selected>${repeat.binding}</option>`}
                  </select>
                </div>
                <div class="prop-pair">
                  <div class="prop-row">
                    <label>${s.repeatFrom}</label>
                    <input type="number" min="1" max=${String(el.rows.length)} .value=${String(repeat.fromRow + 1)}
                      @change=${(e: Event) => this._updateGridRepeat({ fromRow: numberOf(e) - 1 })}>
                  </div>
                  <div class="prop-row">
                    <label>${s.repeatTo}</label>
                    <input type="number" min="1" max=${String(el.rows.length)} .value=${String(repeat.toRow + 1)}
                      @change=${(e: Event) => this._updateGridRepeat({ toRow: numberOf(e) - 1 })}>
                  </div>
                </div>
                <div class="prop-row stacked">
                  <label>${s.repeatPerPage}</label>
                  <input type="number" min="1" max="1000" .value=${String(repeat.perPage)}
                    @change=${(e: Event) => this._updateGridRepeat({ perPage: numberOf(e) })}>
                </div>
                <div class="prop-row stacked">
                  <label>${s.repeatMaxItems}</label>
                  <input type="number" min=${String(repeat.perPage)} max="100000"
                    class=${repeat.maxItems === undefined ? 'dim' : ''}
                    placeholder=${s.repeatMaxItemsNone}
                    .value=${repeat.maxItems === undefined ? '' : String(repeat.maxItems)}
                    @change=${(e: Event) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      this._updateGridRepeat({ maxItems: raw === '' ? null : Number(raw) });
                    }}>
                </div>
                <div class="prop-row stacked">
                  <label>${s.repeatHeader}</label>
                  <input type="checkbox" class="stacked-check" aria-label=${s.repeatHeader} .checked=${repeat.repeatHeader}
                    @change=${(e: Event) =>
                      this._updateGridRepeat({ repeatHeader: (e.target as HTMLInputElement).checked })}>
                </div>`
              : nothing}
          </div>`;
        return html`
          ${cellTarget === null
            ? gridOwnProps
            : html`
              <button class="usage-row grid-back" title=${el.name}
                @click=${() => this._clearCellSelection()}>
                ${icons.treeClosed}${TYPE_BADGE.grid}<span>${el.name}</span>
              </button>`}
          ${this._renderGridCellProps(el, cellTarget, cellDef, source, inBand)}
        `;
  }

  /** 칸 선택을 풀고 그리드 자체 편집으로 돌아간다 (ADR-034 — 고른 대상 하나만 편집한다) */
  private _clearCellSelection(): void {
    this._selectedCell = null;
    this._cellEditing = false;
    this._cellSourceKind = null;
    this.requestUpdate();
  }

  /** 그리드 칸(선택된 셀)의 값·병합·글자·색·테두리 편집. 선택된 칸이 없으면 안내를 보인다 */
  private _renderGridCellProps(
    el: GridElement,
    cellTarget: { row: number; column: number } | null,
    cellDef: GridCell | undefined,
    source: 'content' | 'binding' | 'formula',
    inBand: boolean,
  ) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    return cellTarget
      ? html`
              <div class="prop-section">
                <div class="prop-section-title">
                  ${s.cell} (${cellTarget.row + 1}, ${cellTarget.column + 1})
                  ${inBand ? html`<span class="cell-band">${s.repeatCellHint}</span>` : nothing}
                </div>
                <div class="prop-row">
                  <label>${s.cellSource}</label>
                  <select aria-label=${s.cellSource} .value=${source}
                    @change=${(e: Event) =>
                      this._chooseGridCellSource((e.target as HTMLSelectElement).value as 'content' | 'binding' | 'formula')}>
                    <option value="content" ?selected=${source === 'content'}>${s.cellSourceText}</option>
                    <option value="binding" ?selected=${source === 'binding'}>${s.cellSourceBinding}</option>
                    <option value="formula" ?selected=${source === 'formula'}>${s.cellSourceFormula}</option>
                  </select>
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
                  : source === 'binding'
                    ? html`
                      <div class="prop-row">
                        <label>${s.binding}</label>
                        ${this._gridCellBindingSelect(el, cellDef?.binding ?? '', inBand)}
                      </div>`
                    : html`
                      <div class="prop-row">
                        <label>${s.formula}</label>
                        <input .value=${cellDef?.formula ?? ''}
                          @change=${(e: Event) => this._setGridCellSource('formula', valOf(e))}>
                      </div>`}
                <div class="prop-pair">
                  <div class="prop-row">
                    <label>${s.rowHeight}</label>
                    <input type="number" min="2" step="0.5"
                      .value=${String(el.rows[cellTarget.row]?.height ?? '')}
                      @change=${(e: Event) =>
                        this._setGridTrack('row', cellTarget.row, Number((e.target as HTMLInputElement).value))}>
                  </div>
                  <div class="prop-row">
                    <label>${s.columnWidth}</label>
                    <input type="number" min="2" step="0.5"
                      .value=${String(el.columns[cellTarget.column]?.width ?? '')}
                      @change=${(e: Event) =>
                        this._setGridTrack('column', cellTarget.column, Number((e.target as HTMLInputElement).value))}>
                  </div>
                </div>
                <div class="prop-row">
                  <label>${s.merge}</label>
                  <div class="merge-inputs">
                    <span>${s.rows}</span>
                    <input type="number" min="1" .value=${String(cellDef?.rowSpan ?? 1)}
                      aria-label="${s.merge} ${s.rows}"
                      @change=${(e: Event) => this._setCellSpan('rowSpan', Number(valOf(e)))}>
                    <span>${s.columns}</span>
                    <input type="number" min="1" .value=${String(cellDef?.colSpan ?? 1)}
                      aria-label="${s.merge} ${s.columns}"
                      @change=${(e: Event) => this._setCellSpan('colSpan', Number(valOf(e)))}>
                  </div>
                </div>
                <div class="prop-row">
                  <label>${s.fontSize}</label>
                  <input type="number" step="0.5"
                    class=${cellDef?.fontSize === undefined ? 'dim' : ''}
                    .value=${String(cellDef?.fontSize ?? '')}
                    placeholder=${String(el.fontSize ?? DEFAULT_FONT_SIZE)}
                    @change=${(e: Event) => {
                      const v = Number(valOf(e));
                      this._updateCellStyle('fontSize', v > 0 ? v : null);
                    }}>
                </div>
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
                ${this._renderTextStyleToggles(
                  cellDef ?? {},
                  (key, value) => this._updateCellStyle(key, value ? true : null),
                  `${s.cell} `,
                )}
                ${this._renderColorControl(
                  s.backgroundColor, cellDef?.backgroundColor, 'cellBackgroundColor',
                  (v) => this._updateCellStyle('backgroundColor', v),
                  undefined,
                  `${s.cell} ${s.backgroundColor}`,
                )}
                ${this._renderColorControl(
                  s.fontColor, cellDef?.fontColor, 'cellFontColor',
                  (v) => this._updateCellStyle('fontColor', v),
                  el.fontColor ?? DEFAULT_FONT_COLOR,
                  `${s.cell} ${s.fontColor}`,
                )}
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
      : html`<div class="prop-section"><div class="cell-hint">${s.cellHint}</div></div>`;
  }

  /** 이미지 요소의 고정·변동(src·binding) 편집 */
  private _renderImageProps(el: ImageElement) {
    const s = this._strings.designer;
    // 이미지 요소는 고정(src)과 변동(binding) 중 하나다 — 전표마다 다른 이미지를
    // 넣으려면 변동으로 두고 값 키를 고른다 (G-47, 스키마는 둘을 배타로 검사한다)
    const variable = el.binding !== undefined;
        // 경로 문자열은 base64라 사람이 읽을 수 없다 — 지금 이미지를 그대로 보여준다 (G-36)
        const chosen = el.src !== undefined && el.src !== PLACEHOLDER_IMG && el.src.startsWith('data:');
        return html`
          <div class="prop-section">
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
              ? this._renderImageBindingSelect(el.binding ?? '')
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

  private _renderFontProps(el: SlipElement) {
    if (el.type !== 'text' && el.type !== 'field') return nothing;
    const s = this._strings.designer;
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);

    return html`
      <div class="prop-row">
        <label>${s.fontSize}</label>
        <input type="number" step="0.5" class=${el.fontSize === undefined ? 'dim' : ''}
          .value=${String(el.fontSize ?? '')} placeholder=${String(DEFAULT_FONT_SIZE)}
          @change=${(e: Event) => {
            const v = numOf(e);
            this._updateElement((el) => setOptional(el, 'fontSize', v > 0 ? v : null));
          }}>
      </div>
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
      <div class="prop-pair">
        <div class="prop-row">
          <label>${s.lineHeight}</label>
          <input type="number" step="0.1" min="0.1" class=${el.lineHeight === undefined ? 'dim' : ''}
            .value=${String(el.lineHeight ?? '')} placeholder="1"
            @change=${(e: Event) => {
              const v = numOf(e);
              this._updateElement((target) => setOptional(target, 'lineHeight', v > 0 ? v : null));
            }}>
        </div>
        <div class="prop-row">
          <label>${s.characterSpacing}</label>
          <input type="number" step="0.1" class=${el.characterSpacing === undefined ? 'dim' : ''}
            .value=${String(el.characterSpacing ?? '')} placeholder="0"
            @change=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value.trim();
              const v = numOf(e);
              this._updateElement((target) =>
                setOptional(target, 'characterSpacing', raw !== '' && v !== 0 ? v : null));
            }}>
        </div>
      </div>
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
   * 속성 패널에서 지금 펼쳐져 있는 항목의 키 (색 피커·테두리 굵기·테두리 형태 공용).
   * 하나만 담기 때문에 다른 것을 열면 먼저 열려 있던 것이 자동으로 닫힌다 (ADR-034).
   */
  private _openPopKey: string | null = null;

  /**
   * 모든 요소의 종류 배지를 한 번에 보여줄지 (F-18). 평소에는 마우스를 올리거나
   * 고른 요소에만 보이며, 툴바의 "요소 확인"(Ctrl/Cmd+B)로 전부 켤 수 있다.
   * 화면에서만 쓰는 값이라 파일에는 저장하지 않는다.
   */
  private _showBadges = false;

  /**
   * 캔버스 격자 간격(mm) — null이면 격자를 그리지 않는다 (F-20).
   * 격자를 켜면 요소를 옮기거나 크기를 바꿀 때 격자에 맞아떨어진다(Alt로 해제).
   * 화면에서만 쓰는 값이라 파일에는 저장하지 않는다.
   */
  private _gridGap: number | null = null;

  /** 격자 간격 메뉴 열림 여부 */
  private _gridMenuOpen = false;

  /** 격자선 색 — 격자 메뉴에서 고른다 (F-20, 기본 회색) */
  private _gridColor: GridColorId = 'gray';

  /** 격자 간격 메뉴 위치 (버튼 아래) */
  private _gridMenuPos = { left: 0, top: 0 };

  /** 커서가 용지 위에 있을 때의 위치(mm) — 눈금자 표시와 좌표 표시에 쓴다 (F-20) */
  private _cursorMm: { x: number; y: number } | null = null;

  /** 저장된 커스텀 색 캐시 — 첫 사용 때 localStorage에서 읽는다 */
  private _customColorsCache: string[] | null = null;

  private _getCustomColors(): string[] {
    this._customColorsCache ??= loadCustomColors();
    return this._customColorsCache;
  }

  /** 색상판 커서 위치 (HSV) — 피커를 열 때 현재 색으로 맞춘다 */
  private _pickerH = 0;
  private _pickerS = 1;
  private _pickerV = 1;
  /** 색상판(SV 영역) 드래그 중인 색 속성 키 */
  private _svDragKey: string | null = null;

  /** 스타일 속성 키에 색 값을 넣거나(v) 지운다(null). 피커 커서도 그 색으로 맞춘다 */
  private _applyColor(key: string, value: string | null): void {
    if (value) {
      const { h, s, v } = hexToHsv(value);
      // 무채색은 색조 정보가 없다 — 기존 색조를 유지해 색상판이 튀지 않게 한다
      if (s > 0) this._pickerH = h;
      this._pickerS = s;
      this._pickerV = v;
    }
    this._updateElement((el) => setOptional(el, key, value || null));
  }

  /** 색상판에서 포인터 위치를 채도·명도로 바꿔 커서를 옮긴다 (적용은 떼는 순간) */
  private _svPointTo(e: PointerEvent): void {
    const area = e.currentTarget as HTMLElement;
    const rect = area.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    this._pickerS = Math.max(0, Math.min((e.clientX - rect.left) / w, 1));
    this._pickerV = 1 - Math.max(0, Math.min((e.clientY - rect.top) / h, 1));
    this.requestUpdate();
  }

  /** HSV 피커 커서를 hex 색으로 맞춘다 — 채도 0(무채색)이면 색조는 그대로 둔다 */
  private _seedPicker(hex: string): void {
    const hsv = hexToHsv(hex);
    if (hsv.s > 0) this._pickerH = hsv.h;
    this._pickerS = hsv.s;
    this._pickerV = hsv.v;
  }

  /**
   * 색 입력 한 벌 — 현재 색을 보여주는 버튼 하나. 누르면 자주 쓰는 색 견본과
   * 색상판(채도·명도)·색조 슬라이더·직접 입력·투명도(%)·없음이 전부 한 피커 안에
   * 펼쳐져 바로 고를 수 있다. 저장 형식은 파일 스키마와 동일한
   * #RRGGBB(투명도 100%) / #RRGGBBAA.
   *
   * @param label - 화면에 보이는 항목 이름
   * @param current - 지정된 색 (없으면 undefined)
   * @param key - 펼침 상태를 구분할 키 — 다른 항목을 열면 이 색은 닫힌다
   * @param apply - 색을 저장하는 콜백 (없으면 선택 요소의 스타일 필드에 저장)
   * @param fallback - 지정하지 않았을 때 실제로 적용되는 색 — 흐리게 보여준다 (ADR-034)
   * @param ariaLabel - 보조기기용 이름 (요소·셀에 같은 항목이 함께 뜰 때 구분)
   */
  private _renderColorControl(
    label: string,
    current: string | undefined,
    key: string,
    apply?: (value: string | null) => void,
    fallback?: string | undefined,
    ariaLabel?: string,
  ) {
    // 색을 어디에 저장할지 — 기본은 선택 요소의 스타일 필드, 셀 편집 등은 콜백으로 대체
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
    // 지정하지 않았으면 실제로 적용 중인 색(상속값·기본값)을 흐리게 보여준다 (ADR-034).
    // 배경처럼 물려받는 값이 없는 항목은 그대로 "없음"이다.
    const shown = current ?? fallback;
    // 요소와 셀에 같은 이름의 항목이 함께 뜨므로 보조기기용 이름은 따로 받는다
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
              // 피커 커서를 현재 색으로 (미지정이면 선명한 빨강에서 시작)
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
              @click=${() => commit(null)}></button>
            ${COLOR_PALETTE.map((c) => html`<button class="swatch" style="background:${c}"
              title=${c} aria-label="${name} ${c}"
              @click=${() => commit(compose(c, alphaPct))}></button>`)}
            ${this._getCustomColors().map((c) => html`<button class="swatch custom" style="background:${c}"
              title=${c} aria-label="${name} ${c}"
              @click=${() => commit(c)}></button>`)}
            <button class="swatch-save" title=${s.saveColor} aria-label="${name}: ${s.saveColor}"
              ?disabled=${!current}
              @click=${() => {
                // 기본 팔레트에 이미 있는 색은 중복 저장하지 않는다
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
              @change=${(e: Event) => {
                // 파일 스키마와 같은 형식만 저장 — 어긋난 값은 저장 시점에야 거부되어 원인 찾기 어려움
                const v = (e.target as HTMLInputElement).value;
                if (v && !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
                  this._rejectInput();
                  return;
                }
                commit(v || null);
              }}>
            <input type="number" class="alpha-input" min="0" max="100" .value=${String(alphaPct)}
              title=${s.opacity} aria-label="${label} ${s.opacity}"
              @change=${(e: Event) => {
                if (!current) return;
                commit(compose(base, Number((e.target as HTMLInputElement).value)));
              }}>
            <span class="alpha-suffix">%</span>
          </div>
        </div>` : nothing}
    `;
  }

  /** 굵게·밑줄·취소선 토글 한 줄 — 요소·셀 공용 (적용 대상은 콜백으로 정한다, C-11) */
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
   * 테두리 굵기 선택 한 줄 — 버튼을 누르면 없음(0)과 정해진 단계가 굵기 미리보기
   * 선과 함께 펼쳐진다 (C-11). 저장은 콜백으로 (요소·셀 공용).
   *
   * @param current - 명시된 굵기 (미지정이면 fallback이 유효값)
   * @param fallback - 미지정일 때의 유효 굵기 (요소 기본값 또는 셀이 상속하는 요소 값)
   * @param allowNone - 없음(0) 선택지를 보여줄지 — 선 요소는 굵기 0이 의미 없어 뺀다
   */
  private _renderBorderWidthSelect(
    current: number | undefined,
    fallback: number,
    allowNone: boolean,
    key: string,
    apply: (value: number) => void,
    /** 라벨 — 선은 테두리가 아니라 선 자체의 굵기라 다르게 부른다 (G-32) */
    labelText?: string,
  ) {
    const s = this._strings.designer;
    const label = labelText ?? s.borderWidth;
    const effective = current ?? fallback;
    const open = this._openPopKey === key;
    // 단계 밖의 기존 값(이전 편집·외부 파일)도 고를 수 있게 목록에 끼워 넣는다
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
        <button class="width-btn" aria-label=${label} aria-expanded=${String(open)}
          @click=${() => {
            this._openPopKey = open ? null : key;
            this.requestUpdate();
          }}>
          ${effective > 0
            ? html`<span class="width-line" style="border-top-width:${previewPx(effective)}px"></span>
                <span class="width-value ${current === undefined ? 'dim' : ''}">${effective}mm</span>`
            : html`<span class="width-value ${current === undefined ? 'dim' : ''}"
                >${s.colorNone}</span>`}
        </button>
      </div>
      ${open ? html`
        <div class="width-pop" role="menu" aria-label=${label}>
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
   * 테두리 형태(실선·파선·점선) 선택 한 줄 — 굵기와 같은 방식으로 실제 선 모양을
   * 보여 주며 펼쳐진다 (ADR-034). 실선은 기본값이라 콜백에 null로 전달한다.
   *
   * @param current - 명시된 형태 (미지정이면 실선)
   * @param ariaLabel - 보조기기용 이름 (요소·셀 구분)
   * @param key - 펼침 상태를 구분할 키 — 다른 항목을 열면 이 줄은 닫힌다
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
        <button class="width-btn" aria-label=${ariaLabel} aria-expanded=${String(open)}
          @click=${() => {
            this._openPopKey = open ? null : key;
            this.requestUpdate();
          }}>
          <span class="shape-line shape-${effective}"></span>
          <span class="width-value ${current === undefined ? 'dim' : ''}">${labelOf(effective)}</span>
        </button>
      </div>
      ${open ? html`
        <div class="width-pop" role="menu" aria-label=${ariaLabel}>
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
   * 스타일 그룹 — 텍스트(글자색·크기·정렬·굵게 등) / 배경 / 테두리로 나눠 보여준다 (C-11).
   * 종류마다 의미 있는 항목만 노출한다 (ADR-032: 선은 배경·글자색 없음, 도형은 글자색 없음).
   */
  private _renderStyleGroups(el: SlipElement) {
    if (el.type === 'image') return nothing;
    const s = this._strings.designer;
    const r = el as Record<string, unknown>;
    const hasFontColor = el.type === 'text' || el.type === 'field' || el.type === 'grid';
    const hasTextDecor = el.type === 'text' || el.type === 'field';
    const hasBackground = el.type !== 'line';
    // 선은 테두리를 두르는 게 아니라 선 자체가 색·굵기·모양을 갖는다 (G-32).
    // 굵기는 크기 칸 옆으로 옮겼으므로(_renderSizeRows) 여기서는 빼고 색·모양만 남긴다.
    const isLine = el.type === 'line';
    // 테두리 형태(파선·점선)는 직선 분해 렌더가 가능한 종류만 (ADR-032)
    const hasBorderShape = el.type === 'line' || el.type === 'rect' || el.type === 'grid';
    // 텍스트·필드는 기본 테두리 없음, 나머지는 기본 굵기 (PDF 변환 계층과 동일)
    const defaultWidth = el.type === 'text' || el.type === 'field' ? 0 : DEFAULT_LINE_WIDTH;

    return html`
      ${hasFontColor ? html`
        <div class="prop-section">
          <div class="prop-section-title">${s.styleText}</div>
          ${this._renderColorControl(
            s.fontColor, r.fontColor as string | undefined, 'fontColor', undefined, DEFAULT_FONT_COLOR,
          )}
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
          // 텍스트·필드의 없음(0)은 기본값과 같아 파일에 남기지 않는다
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
                  // 모서리 반경은 파선·점선과 함께 쓸 수 없다 (스키마 규칙, ADR-032)
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
              ?disabled=${el.borderStyle === 'dashed' || el.borderStyle === 'dotted'}
              @change=${(e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isNaN(v) || v < 0) {
                  this._rejectInput();
                  return;
                }
                this._updateElement((target) => {
                  if (target.type !== 'rect') return;
                  setOptional(target, 'radius', v > 0 ? v : null);
                });
              }}>
          </div>` : nothing}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: modals (D-12 — 편집 UI 배치 원칙: 항목이 많은 편집은 모달로)
  // ---------------------------------------------------------------------------

  /** 양식 전체의 파라미터 목록 (정의부 + 요소 사용처, 중복 없이) — 수식 모달의 클릭 삽입용 */
  /**
   * 파라미터 키·논리명 목록 — {@link _bindingList}에서 뽑아 쓴다(순회 규칙을 두 곳에
   * 복제하지 않도록). 수식 모달 등 키·라벨만 필요한 곳에서 쓴다.
   *
   * @returns 파라미터 키와 논리명 목록
   */
  private _collectBindings(): { key: string; label: string }[] {
    return this._bindingList().map((b) => ({ key: b.key, label: b.label }));
  }

  /** 바이트 수를 사람이 읽는 크기로 (오류 문구용) */
  private static _formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${bytes}B`;
  }

  /**
   * 이 양식에 등록된 이미지 목록 — 모든 페이지의 이미지 요소에서 모아 중복을 없앤다.
   * 자리표시 이미지는 아직 고르지 않은 상태이므로 뺀다 (G-36).
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

  /** 이미지 선택 모달을 연다 */
  private _openImageModal(): void {
    this._imageError = null;
    this._imageModalOpen = true;
  }

  private _closeImageModal(): void {
    this._imageModalOpen = false;
    this._imageError = null;
  }

  /** 업로드한 이미지를 선택된 이미지 요소에 넣고 모달을 닫는다 */
  private _applyImageSrc(src: string): void {
    this._updateElement((target) => {
      if (target.type === 'image') target.src = src;
    });
    this._closeImageModal();
  }

  /**
   * 파일 선택 대화 상자를 열어 업로드한 이미지를 base64로 바꿔 넣는다 (G-36).
   *
   * @remarks
   * 주소(URL)는 받지 않는다 — PDF 변환이 `data:`·`asset://`만 풀 수 있어
   * 주소로 두면 미리보기부터 깨진다. 주소로 받아야 하는 이미지는 호스트 서버가
   * 중계해 base64로 바꿔 넘긴다.
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

  /** 이미지 선택 오류를 문구로 (G-47 공용 도우미 결과 → 디자이너 사전) */
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
   * 변동 이미지 값 키 목록 — 이미지 요소가 `binding`으로 쓰는 키와 값 종류가 이미지인
   * 정의부 키를 모은다 (G-47). 작성폼·샘플 편집이 이 키에는 이미지 입력을 낸다.
   */
  private _imageBindingKeys(): Set<string> {
    const file = this._file;
    const keys = new Set<string>();
    if (!file) return keys;
    for (const def of file.template.bindings ?? []) {
      if (def.valueType === 'image') keys.add(def.key);
    }
    for (const page of file.template.pages) {
      for (const el of page.elements) {
        if (el.type === 'image' && el.binding !== undefined) keys.add(el.binding);
      }
    }
    return keys;
  }

  /** 샘플 데이터 모달에서 변동 이미지 값 하나를 파일에서 골라 담는다 (G-47) */
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

  /** 수식 모달을 연다 — 선택된 필드의 현재 수식을 초안으로 담는다 */
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

  /** 수식 모달의 초안을 선택된 필드에 반영한다 (빈 초안은 수식 제거) */
  private _applyFormulaModal(): void {
    const draft = this._formulaDraft.trim();
    this._formulaModalOpen = false;
    this._updateElement((el) => {
      if (el.type !== 'field') return;
      setOptional(el, 'formula', draft || null);
    });
  }

  /** 수식 입력창의 커서 위치에 텍스트를 끼워 넣는다 — after는 커서 뒤에 붙는다 (닫는 괄호) */
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

  /** 수식 입력칸의 커서 위치 — 열 자동완성 판단에 쓴다 (F-21) */
  private _formulaCaret = 0;

  /** 커서 위치를 기록한다 — 키 이동·클릭으로 옮겼을 때도 자동완성이 따라오게 (F-21) */
  private _syncFormulaCaret(e: Event): void {
    const caret = (e.target as HTMLTextAreaElement).selectionStart;
    if (caret === this._formulaCaret) return;
    this._formulaCaret = caret;
    this.requestUpdate();
  }

  /**
   * 커서 앞에 `표파라미터.` 형태를 치고 있으면 그 표의 열 목록을 제안한다 (F-21).
   * 이미 몇 글자 쳤으면 그 글자로 시작하는 열만 남긴다.
   *
   * @returns 제안할 열 목록과 이어 붙일 위치 — 제안할 것이 없으면 null
   */
  private _columnSuggestion(): {
    columns: { key: string; title: string }[];
    typedLength: number;
  } | null {
    const caret = Math.min(this._formulaCaret, this._formulaDraft.length);
    const before = this._formulaDraft.slice(0, caret);
    const match = /([A-Za-z0-9_가-힣]+)\.([A-Za-z0-9_가-힣]*)$/.exec(before);
    if (!match) return null;

    const target = this._bindingList().find((b) => b.key === match[1] && b.fields.length > 0);
    if (!target) return null;
    const typed = match[2] ?? '';
    const columns = target.fields
      .filter((field) => field.key.toLowerCase().startsWith(typed.toLowerCase()))
      .map((field) => ({ key: field.key, title: field.title }));
    return columns.length > 0 ? { columns, typedLength: typed.length } : null;
  }

  /** 열 자동완성 줄 — `표파라미터.`까지 쳤을 때 그 표의 열을 눌러 이어 넣는다 (F-21) */
  private _renderColumnSuggestions() {
    const suggestion = this._columnSuggestion();
    if (!suggestion) return nothing;
    const s = this._strings.designer;

    return html`
      <div class="formula-suggest" role="group" aria-label=${s.formulaColumnSuggest}>
        <span class="formula-suggest-label">${s.formulaColumnSuggest}</span>
        ${suggestion.columns.map((col) => html`
          <button class="binding-chip column" title=${col.key}
            @click=${() => this._insertFormulaText(col.key.slice(suggestion.typedLength))}
            >${col.title ? `${col.title} · ${col.key}` : col.key}</button>`)}
      </div>
    `;
  }

  /**
   * 수식 편집 모달 — 초안 편집, 실시간 문법 검사(자체 파서, ADR-010), 샘플 값
   * (`sampleValues`) 기준 결과 미리 계산, 파라미터·함수 32종 클릭 삽입 (ADR-017·044).
   */
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
        parseFormula(draft);
        try {
          preview = formulaPreviewText(
            evaluateFormula(draft, { values: this._file?.template.sampleValues ?? {} }),
          );
        } catch (error) {
          // 문법은 맞지만 계산이 안 되는 경우 (샘플 값 없음 등) — 안내만 하고 적용은 허용
          previewError = error instanceof Error ? error.message : String(error);
        }
      } catch (error) {
        syntaxError = error instanceof Error ? error.message : String(error);
      }
    }
    // 표 파라미터은 하위 열까지 보여줘야 하므로 사이드바와 같은 목록을 쓴다 (F-21)
    const bindings = this._bindingList();

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
          ${bindings.length > 0
            ? html`
                <div class="modal-section-title">${s.formulaBindings}</div>
                <div class="binding-chips">
                  ${bindings.map((b) => html`
                    <button class="binding-chip" title=${b.key}
                      @click=${() => this._insertFormulaText(b.key)}>${b.label}</button>
                    ${b.fields.map((field) => html`
                      <button class="binding-chip column" title="${b.key}.${field.key}"
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
   * 이미지 선택 모달 — 파일에서 골라 넣거나, 이 양식에 등록된 이미지를 다시 쓴다 (G-36).
   * 주소(URL) 입력은 두지 않는다 — PDF로 나오지 않기 때문이다.
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

  /** 샘플 값 하나를 넣거나 지운다 — sampleValues가 비면 필드 자체를 지운다 */
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
   * 샘플 데이터 편집 모달 (D-13) — 파라미터마다 시험 값을 채운다. 반복 구간이 쓰는 값은
   * 그 표의 열 구조대로 행을 편집한다. 숫자 표기는 수로 저장해 수식 계산이 되게 한다.
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

    // 반복 값 → 항목 필드 구조 (같은 값을 쓰는 첫 그리드 기준, ADR-037)
    const tableOf = new Map<string, { key: string; title: string }[]>();
    for (const page of template.pages) {
      for (const el of page.elements) {
        if (el.type !== 'grid' || !el.repeat || tableOf.has(el.repeat.binding)) continue;
        const { fromRow, toRow } = el.repeat;
        const fields: { key: string; title: string }[] = [];
        for (const cell of el.cells) {
          if (cell.row >= fromRow && cell.row <= toRow && cell.binding !== undefined
            && !fields.some((f) => f.key === cell.binding)) {
            fields.push({ key: cell.binding, title: cell.binding });
          }
        }
        if (fields.length > 0) tableOf.set(el.repeat.binding, fields);
      }
    }
    const bindings = this._collectBindings();
    // 변동 이미지 값은 텍스트가 아니라 이미지 업로드로 받는다 (G-47)
    const imageKeys = this._imageBindingKeys();
    // 파라미터이 많으면 10개 단위 페이지로 나눠 스크롤을 짧게 유지한다
    const pageCount = Math.max(1, Math.ceil(bindings.length / SAMPLE_PAGE_SIZE));
    const pageIndex = Math.min(this._samplePage, pageCount - 1);
    const visible = bindings.slice(
      pageIndex * SAMPLE_PAGE_SIZE,
      (pageIndex + 1) * SAMPLE_PAGE_SIZE,
    );

    // JSON 모드 — 초안을 실시간 검사해 오류면 적용을 막는다
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
                    // 두 탭이 같은 것을 보여야 한다 — 선언된 파라미터를 모두 담은 뼈대에
                    // 지금 샘플 값을 얹는다. 입력폼에서 비워 둔 값도 키로 보여야 무엇을
                    // 채우면 되는지 알 수 있다 (빈 JSON을 내놓으면 두 탭이 어긋난다)
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
                ${bindings.length === 0 ? html`<div class="side-empty">—</div>` : nothing}
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

  /** JSON 초안을 sampleValues 전체에 반영한다 — 빈 입력·빈 객체는 샘플 제거 */
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

  /** 반복 구간 값의 샘플 행 편집 — 항목 필드대로 칸 입력, 행 추가·삭제 */
  /** 변동 이미지 값 하나의 샘플 입력 — 파일에서 골라 넣고, 넣은 이미지를 보여준다 (G-47) */
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
  // 내 양식 저장·불러오기 (D-15, ADR-021)
  // ---------------------------------------------------------------------------

  /** 저장 모달 열기 — 제목 초안은 지금 양식 제목에서 시작한다 */
  private _openSaveModal(): void {
    if (!this._file) return;
    this._saveTitle = this._file.template.meta.title;
    this._saveAsNew = false;
    this._myFormsError = null;
    this._saveModalOpen = true;
    this.requestUpdate();
  }

  /**
   * 저장 확인 — 제목이 바뀌었으면 양식 제목에도 반영하고 저장소에 넣는다.
   * 목록에서 불러온 양식이면 같은 키에 덮어쓴다.
   */
  private async _confirmSave(): Promise<void> {
    const adapter = this.storage;
    if (!adapter || !this._file) return;
    const title = this._saveTitle.trim();
    // 제목은 스키마상 1자 이상 — 빈 제목이면 저장하지 않는다
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

  /** 목록 모달 열기 — 전체 목록(메타)을 한 번 받아 쥔다 */
  private async _openMyForms(): Promise<void> {
    this._myFormsOpen = true;
    this._myFormsQuery = '';
    this._myFormsPage = 0;
    this.requestUpdate();
    await this._loadMyForms();
  }

  /**
   * 저장된 양식 목록(메타)을 전부 받아 스냅샷으로 쥔다 (ADR-045). 검색·페이지 이동은
   * 이 스냅샷 위에서 메모리로 하므로, 페이지 사이에 저장·삭제가 일어나도 목록이 흔들리지
   * 않는다. 메타만 읽어 본문(이미지)은 메모리에 올라오지 않는다.
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

  /** 검색어에 맞는 항목(스냅샷을 메모리로 거른 것) */
  private _filteredMyForms(): SlipListItem[] {
    const query = this._myFormsQuery.trim().toLowerCase();
    if (!query) return this._myFormItems;
    return this._myFormItems.filter((item) => item.title.toLowerCase().includes(query));
  }

  /** 목록에서 고른 양식을 캔버스로 불러온다 (되돌리기 지원) */
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

  /** 목록에서 양식을 지운다 (지운 항목이 지금 편집 중이던 것이면 저장 키만 푼다) */
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
    // 마지막 페이지의 유일한 항목을 지웠으면 앞 페이지로 당긴다
    const lastPage = Math.max(0, Math.ceil(this._filteredMyForms().length / MY_FORMS_PAGE_SIZE) - 1);
    if (this._myFormsPage > lastPage) this._myFormsPage = lastPage;
    this.requestUpdate();
  }

  /** "내 양식으로 저장" 모달 — 제목을 확인하고 저장한다 */
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

  /** "내 양식 목록" 모달 — 검색·불러오기·삭제·더 보기 */
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

  /** 목록 모달 본문 — 검색으로 거른 스냅샷을 번호 페이지로 나눠 그린다 (ADR-045) */
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

/** 샘플 입력값 해석 — 숫자 표기는 수로, 그 밖은 문자열로 (수식 계산이 자연스럽게 되도록) */
function parseSampleScalar(text: string): string | number {
  const trimmed = text.trim();
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : text;
}

/** 샘플 값을 입력창 표시용 문자열로 — 배열·객체는 표 편집이 담당하므로 빈 값 취급 */
function sampleScalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** 수식 미리 계산 결과를 표시용 문자열로 (수식 엔진의 문자열화 규칙과 같은 방향) */
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
