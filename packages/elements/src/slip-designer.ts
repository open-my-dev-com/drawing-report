import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import {
  parseSlipFile,
  renderSlipToPdf,
  parseFormula,
  evaluateFormula,
  type SlipFile,
  type SlipTemplateFile,
  type SlipElement,
  type RenderOptions,
  type SlipListItem,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { getFormulaHelp } from './formula-help.js';
import { loadDefaultFonts } from './default-fonts.js';
import { presets, type SlipPreset } from './presets.js';
import { icons } from './icons.js';

/** 색 피커의 팔레트 견본 — 전표에서 자주 쓰는 색 위주 */
const COLOR_PALETTE = [
  '#000000', '#ffffff', '#f2f2f2', '#d93025', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
] as const;

/** 사용자가 저장한 자주 쓰는 색의 localStorage 키 */
const CUSTOM_COLORS_KEY = 'slipkit-designer-custom-colors';
/** 바인딩 선택 상자의 "새 값 등록" 항목 값 — 물리명으로 쓸 수 없는 문자라 겹치지 않는다 */
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
/** 테두리 굵기 선택지(mm) — 없음(0)과 이 단계들만 select로 제공한다 (C-11) */
const BORDER_WIDTH_STEPS = [0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2] as const;
/** 샘플 데이터 모달의 한 페이지에 보여줄 바인딩 수 (D-13) */
const SAMPLE_PAGE_SIZE = 10;
/** 스냅이 붙는 거리(mm) — 이 안으로 들어오면 후보 선에 끌어붙인다 */
const SNAP_MM = 1.5;
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

/** 글자 크기(pt)를 화면 px로 — PDF와 같은 크기감 (1pt = 4/3px, 기본 10pt) */
function fontPx(size: number | undefined): string {
  return `${(((size ?? DEFAULT_FONT_SIZE) * 4) / 3).toFixed(2)}px`;
}

/** 정렬 값을 flex 정렬로 (기본 left — PDF 변환 기본값과 동일) */
function justifyOf(alignment: 'left' | 'center' | 'right' | undefined): string {
  return alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start';
}

/** 글자 스타일(굵게·밑줄·취소선)을 CSS 조각으로 — 앞에 ;가 붙은 형태 (0.2.0, ADR-032) */
function textStyleCss(style: {
  bold?: boolean | undefined;
  underline?: boolean | undefined;
  strikethrough?: boolean | undefined;
}): string {
  const decorations = [
    style.underline === true ? 'underline' : '',
    style.strikethrough === true ? 'line-through' : '',
  ].filter(Boolean).join(' ');
  return (
    (style.bold === true ? ';font-weight:700' : '') +
    (decorations ? `;text-decoration:${decorations}` : '')
  );
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

/**
 * 비율 배열의 길이를 바꾼다 — 늘어나면 기존을 비례 축소하고 새 항목이 균등 몫을,
 * 줄어들면 남은 항목을 비례 확대해 합 100을 유지한다
 */
function resizePercentages(list: number[], count: number): number[] {
  if (count === list.length) return list;
  let next: number[];
  if (count > list.length) {
    const added = count - list.length;
    next = list.map((value) => (value * list.length) / count);
    for (let i = 0; i < added; i++) next.push(100 / count);
  } else {
    next = list.slice(0, count);
  }
  const sum = next.reduce((acc, value) => acc + value, 0) || 1;
  next = next.map((value) => Math.round(((value * 100) / sum) * 100) / 100);
  // 반올림 잔차는 마지막 항목으로 흡수해 합을 정확히 100으로 맞춘다
  const rest = next.slice(0, -1).reduce((acc, value) => acc + value, 0);
  next[next.length - 1] = Math.round((100 - rest) * 100) / 100;
  return next;
}

/** 열 너비 합을 100으로 정규화 — keepIndex는 값을 유지하고 잔차는 다른 항목이 흡수 */
function normalizeWidths<T extends { widthPercentage: number }>(columns: T[], keepIndex = -1): T[] {
  const rounded = columns.map((col) => ({
    ...col,
    widthPercentage: Math.round(col.widthPercentage * 100) / 100,
  }));
  const sum = rounded.reduce((acc, col) => acc + col.widthPercentage, 0);
  const diff = Math.round((100 - sum) * 100) / 100;
  if (diff !== 0) {
    // 잔차 흡수 대상: keepIndex가 아닌 마지막 열
    for (let i = rounded.length - 1; i >= 0; i--) {
      if (i !== keepIndex) {
        rounded[i]!.widthPercentage = Math.round((rounded[i]!.widthPercentage + diff) * 100) / 100;
        break;
      }
    }
  }
  return rounded;
}

/** 비율(생략 시 균등)로 나눈 누적 경계 위치(mm) — 길이 = count + 1 */
function cumulativeOffsets(total: number, count: number, percentages?: number[]): number[] {
  const offsets = [0];
  for (let i = 0; i < count; i++) {
    const size = percentages ? (total * (percentages[i] ?? 0)) / 100 : total / count;
    offsets.push((offsets[i] ?? 0) + size);
  }
  return offsets;
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

const PLACEHOLDER_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 캔버스 요소의 종류 배지 아이콘 — 툴바의 요소 추가 아이콘과 동일 */
const TYPE_BADGE: Record<SlipElement['type'], TemplateResult> = {
  text: icons.text,
  fixedGrid: icons.fixedGrid,
  dynamicTable: icons.dynamicTable,
  image: icons.image,
  line: icons.line,
  rect: icons.shape,
  ellipse: icons.ellipse,
  polygon: icons.polygon,
  field: icons.field,
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
 * 바인딩은 요소와 별개의 1급 항목이고, 표 열은 그 표 바인딩의 하위 항목이다.
 * 둘 다 오른쪽 패널에서 편집한다.
 */
/** 동적 표 요소 — 사이드바에서 하위 열까지 보여줄 때 쓴다 */
type DynamicTableElement = Extract<SlipElement, { type: 'dynamicTable' }>;

/** 바인딩을 쓰는 요소 한 곳 (ADR-034의 "쓰는 곳") */
interface BindingUse {
  pageIndex: number;
  id: string;
  name: string;
  type: 'field' | 'dynamicTable';
}

/** 사이드바·패널이 함께 쓰는 바인딩 한 항목 — 정의부와 사용처를 합친 것 */
interface BindingInfo {
  /** 물리명 — 전표 값의 키 */
  key: string;
  /** 화면에 보이는 이름 — 논리명이 없으면 물리명 */
  label: string;
  /** 정의부에 적힌 논리명 (없으면 undefined) */
  rawLabel: string | undefined;
  /** 정의부에 등록된 항목인지 (요소만 쓰는 키는 false) */
  defined: boolean;
  /** 이 값을 쓰는 요소들 */
  uses: BindingUse[];
  /** 동적 표가 쓰는 바인딩이면 그 표 (하위 열 표시용) */
  table: { pageIndex: number; element: DynamicTableElement } | undefined;
}

type SideSelection =
  | { kind: 'binding'; key: string }
  | { kind: 'column'; elementId: string; index: number }
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
    /* 사이드바 바인딩 관리 (D-13) — 제목 줄의 작은 버튼과 인라인 입력줄 */
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
      width: 20px;
      height: 20px;
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
    /* 동적 표 바인딩의 하위 열 — 한 단 들여 쓴다 (ADR-034) */
    .side-col-row {
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
    .side-col-row span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .side-col-row:hover {
      background: var(--sk-accent-soft);
    }
    .side-col-row.selected {
      background: var(--sk-accent-soft);
      border-color: var(--sk-accent);
      color: var(--sk-accent);
    }
    /* 바인딩 패널의 "쓰는 곳" 한 줄 (ADR-034) */
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
    .paper {
      position: relative;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }
    .padding-guide {
      position: absolute;
      border: 1px dashed rgba(0, 0, 0, 0.1);
      pointer-events: none;
    }

    .element {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid rgba(0, 0, 0, 0.15);
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
    .element .badge {
      position: absolute;
      top: 1px;
      left: 1px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 2px;
      color: var(--sk-text-muted);
    }
    .element .badge svg {
      width: 11px;
      height: 11px;
    }
    /* 텍스트·필드 표시 — PDF(pdfme)와 같게: 위쪽 정렬, 줄바꿈 유지, 넘치면 자동 줄바꿈 */
    .element .el-content {
      display: block;
      width: 100%;
      height: 100%;
      padding: 2px 4px 2px 22px;
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
    .element .grid-preview {
      position: absolute;
      inset: 0;
      display: grid;
    }
    .element .grid-preview > div {
      display: flex;
      align-items: center;
      padding: 0 2px;
      overflow: hidden;
      white-space: nowrap;
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
      gap: 6px;
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
      height: 24px;
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

    .cell-editor {
      position: absolute;
      z-index: 30;
      padding: 1px 3px;
      border: 2px solid var(--sk-accent);
      border-radius: 2px;
      background: var(--sk-surface);
      font-family: inherit;
      font-size: 12px;
      color: inherit;
    }
    .grid-preview .cell-selected {
      outline: 2px solid var(--sk-accent);
      outline-offset: -2px;
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
    fonts: { attribute: false },
    _file: { state: true },
    _pageIndex: { state: true },
    _selectedId: { state: true },
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
    _anchorIndex: { state: true },
    _selectedCell: { state: true },
    _cellEditing: { state: true },
    _lineDraft: { state: true },
    _lineGhost: { state: true },
    _formulaModalOpen: { state: true },
    _columnsModalOpen: { state: true },
    _sampleModalOpen: { state: true },
    _sideSelection: { state: true },
    _bindingKeyError: { state: true },
    presets: { attribute: false },
    storage: { attribute: false },
    _saveModalOpen: { state: true },
    _myFormsOpen: { state: true },
    _myFormItems: { state: true },
    _myFormsError: { state: true },
    _savedNotice: { state: true },
  };

  src = '';

  /**
   * UI 언어 ('ko' | 'en') — ADR-028.
   *
   * @defaultValue 한국어
   */
  locale?: string;

  fonts?: RenderOptions['fonts'];

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

  private _file: SlipTemplateFile | null = null;
  private _pageIndex = 0;
  private _selectedId: string | null = null;
  private _undoStack: string[] = [];
  private _redoStack: string[] = [];
  private _previewMode = false;
  private _previewUrl: string | null = null;
  private _previewError: string | null = null;
  private _error: string | null = null;
  private _drag: DragState | null = null;
  private _resize: ResizeState | null = null;
  private _clipboard: SlipElement | null = null;
  private _guideX: number | null = null;
  private _guideY: number | null = null;
  private _previewGeneration = 0;
  /** 선택된 생성 도구 — 캔버스를 클릭·드래그하면 이 종류의 요소를 만든다 (한 번 만들면 해제) */
  private _pendingTool: SlipElement['type'] | null = null;
  /** 드래그 생성 중 임시 사각형(mm) — 캔버스에 점선 미리보기로 표시 */
  private _drawRect: { x: number; y: number; w: number; h: number } | null = null;
  private _draw: {
    type: SlipElement['type'];
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
  /** 동적 표 열 편집 모달 열림 여부 — 선택된 동적 표의 columns를 편집한다 (D-12) */
  private _columnsModalOpen = false;
  /** 샘플 데이터 편집 모달 열림 여부 — 양식의 sampleValues를 편집한다 (D-13) */
  private _sampleModalOpen = false;
  /** 샘플 데이터 모달의 현재 페이지 — 바인딩이 많으면 10개 단위로 나눠 보여준다 */
  private _samplePage = 0;
  /** 샘플 데이터 모달의 JSON 직접 입력 모드 여부 (입력폼 ↔ JSON 탭) */
  private _sampleJsonMode = false;
  /** JSON 모드의 편집 중 초안 — 적용을 눌러야 sampleValues에 반영된다 */
  private _sampleJsonDraft = '';
  /**
   * 사이드바에서 요소가 아닌 것을 골랐을 때의 선택 대상 (ADR-034) — 바인딩 또는 표 열.
   * 요소를 고르면 `null`로 돌아가고, 오른쪽 패널이 이 값에 따라 편집 화면을 바꾼다.
   */
  private _sideSelection: SideSelection = null;
  /** 바인딩 패널에서 이미 쓰는 물리명으로 바꾸려 했는지 — 안내를 보여준다 */
  private _bindingKeyError = false;
  /** "내 양식으로 저장" 모달 열림 여부 (D-15) */
  private _saveModalOpen = false;
  /** 저장 모달의 제목 초안 — 확인하면 양식 제목으로도 반영된다 */
  private _saveTitle = '';
  /** "내 양식 목록" 모달 열림 여부 (D-15) */
  private _myFormsOpen = false;
  /** 목록 모달에 표시 중인 항목들 */
  private _myFormItems: SlipListItem[] = [];
  /** 목록 다음 페이지 커서 — 있으면 "더 보기"가 나온다 */
  private _myFormsCursor: string | undefined;
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
  /** 속성 패널 X·Y가 기준으로 삼는 기준점 (ANCHORS 인덱스, 기본 좌상단) */
  private _anchorIndex = 0;
  /** 선택된 고정 그리드 셀 좌표 — 병합 편집·인라인 편집 대상 (C-10) */
  private _selectedCell: { row: number; column: number } | null = null;
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
    this._selectedId = null;
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
    this._columnsModalOpen = false;
    this._sampleModalOpen = false;
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

  private _goToPage(index: number): void {
    if (!this._file) return;
    const clamped = Math.max(0, Math.min(index, this._pageCount() - 1));
    if (clamped === this._pageIndex) return;
    this._pageIndex = clamped;
    this._selectedId = null;
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
    this._selectedId = null;
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
    this._selectedId = null;
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

  private _validateSelection(): void {
    if (this._selectedId && !this._findElement(this._selectedId)) {
      this._selectedId = null;
    }
    // 셀 선택은 고정 그리드 범위 안에서만 유효하다 (undo 복원 뒤에도 보정)
    if (this._selectedCell) {
      const el = this._findSelectedElement();
      if (
        !el || el.type !== 'fixedGrid' ||
        this._selectedCell.row >= el.rows || this._selectedCell.column >= el.columns
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
    type: SlipElement['type'],
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
    const offset = (elements.length * 5) % 50;
    const position = place?.position ?? { x: padLeft + offset, y: padTop + offset };
    const name = `${type}-${id.slice(0, 4)}`;

    let element: SlipElement;
    switch (type) {
      case 'text':
        element = { type: 'text', id, name, position, width: 60, height: 10, content: '' };
        break;
      case 'fixedGrid':
        element = {
          type: 'fixedGrid', id, name, position, width: 180, height: 40,
          rows: 3, columns: 3, columnWidthPercentages: [34, 33, 33], cells: [],
        };
        break;
      case 'dynamicTable':
        element = {
          type: 'dynamicTable', id, name, position, width: 180, height: 20,
          // 새 표는 빈 제목 3열로 시작 — 제목·키·너비는 속성 패널에서 편집 (ADR-031)
          columns: [
            { key: 'col1', title: '', widthPercentage: 34 },
            { key: 'col2', title: '', widthPercentage: 33 },
            { key: 'col3', title: '', widthPercentage: 33 },
          ],
          repeatHead: true, binding: 'items',
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
    }

    if (place?.width !== undefined) element.width = Math.max(MIN_SIZE_MM, round1(place.width));
    if (place?.height !== undefined) element.height = Math.max(MIN_SIZE_MM, round1(place.height));
    // 용지 밖으로 나가지 않게 위치 보정 (가장자리를 클릭해 만들 때)
    element.position = {
      x: round1(Math.max(0, Math.min(element.position.x, paper.width - element.width))),
      y: round1(Math.max(0, Math.min(element.position.y, paper.height - element.height))),
    };

    elements.push(element);
    this._selectedId = id;
    this._sideSelection = null;
    // 값을 쓰는 요소는 그 바인딩을 정의부에 함께 등록한다 — 목록이 값의 단일 원천 (ADR-034)
    if (element.type === 'field' || element.type === 'dynamicTable') {
      this._ensureBindingDef(element.binding);
    }
    this._emitChange();
    this.requestUpdate();
  }

  private _copySelected(): void {
    const el = this._findSelectedElement();
    if (!el) return;
    this._clipboard = JSON.parse(JSON.stringify(el)) as SlipElement;
    this.requestUpdate();
  }

  private _paste(): void {
    const elements = this._currentElements();
    if (!elements || !this._clipboard) return;

    this._pushUndo();

    const copy = JSON.parse(JSON.stringify(this._clipboard)) as SlipElement;
    copy.id = crypto.randomUUID();
    copy.position = {
      x: round1(copy.position.x + 5),
      y: round1(copy.position.y + 5),
    };
    // 연속으로 붙여넣으면 계단식으로 내려가도록 클립보드 위치를 갱신
    this._clipboard.position = { ...copy.position };

    elements.push(copy);
    this._selectedId = copy.id;
    this._sideSelection = null;
    if (copy.type === 'field' || copy.type === 'dynamicTable') {
      this._ensureBindingDef(copy.binding);
    }
    this._emitChange();
    this.requestUpdate();
  }

  private _deleteSelected(): void {
    const elements = this._currentElements();
    if (!elements || !this._selectedId) return;
    const idx = elements.findIndex((el) => el.id === this._selectedId);
    if (idx < 0) return;

    this._pushUndo();
    elements.splice(idx, 1);
    this._selectedId = null;
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
  private _selectTool(type: SlipElement['type']): void {
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
      this._selectedId = id;
      this._sideSelection = null;
      if (!wasSelected) {
        this._selectedCell = null;
        this._cellEditing = false;
      }

      const el = this._findElement(id);
      if (!el) return;

      this._drag = {
        id,
        startPxX: e.clientX,
        startPxY: e.clientY,
        origMmX: el.position.x,
        origMmY: el.position.y,
        snapshot: null,
        wasSelected,
      };
      target.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      this._selectedId = null;
      this._sideSelection = null;
      this._selectedCell = null;
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
      const { xs, ys } = this._snapCandidates(el.id);
      const sx = this._bestSnap([nx, nx + el.width / 2, nx + el.width], xs);
      const sy = this._bestSnap([ny, ny + el.height / 2, ny + el.height], ys);
      if (sx) {
        nx += sx.delta;
        guideX = sx.line;
      }
      if (sy) {
        ny += sy.delta;
        guideY = sy.line;
      }
    }

    el.position.x = Math.max(0, round1(nx));
    el.position.y = Math.max(0, round1(ny));
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
      if (h.includes('w')) {
        const s = this._bestSnap([left], xs);
        if (s) { left += s.delta; guideX = s.line; }
      }
      if (h.includes('e')) {
        const s = this._bestSnap([right], xs);
        if (s) { right += s.delta; guideX = s.line; }
      }
      if (h.includes('n')) {
        const s = this._bestSnap([top], ys);
        if (s) { top += s.delta; guideY = s.line; }
      }
      if (h.includes('s')) {
        const s = this._bestSnap([bottom], ys);
        if (s) { bottom += s.delta; guideY = s.line; }
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
      if (
        el && el.type === 'line' && state.snapshot &&
        (el.position.x !== state.orig.x || el.position.y !== state.orig.y ||
          el.width !== state.orig.w || el.height !== state.orig.h ||
          el.lineDirection !== state.orig.direction)
      ) {
        this._pushUndoSnapshot(state.snapshot);
        this._emitChange();
      }
      this.requestUpdate();
      return;
    }

    if (this._resize) {
      const r = this._resize;
      const el = this._findElement(r.id);
      if (
        el && r.snapshot &&
        (el.position.x !== r.origX || el.position.y !== r.origY ||
          el.width !== r.origW || el.height !== r.origH)
      ) {
        this._pushUndoSnapshot(r.snapshot);
        this._emitChange();
      }
      this._resize = null;
      this.requestUpdate();
      return;
    }

    if (!this._drag) return;
    const drag = this._drag;
    this._drag = null;
    const el = this._findElement(drag.id);
    if (
      el && drag.snapshot &&
      (el.position.x !== drag.origMmX || el.position.y !== drag.origMmY)
    ) {
      this._pushUndoSnapshot(drag.snapshot);
      this._emitChange();
      return;
    }
    // 움직이지 않은 재클릭: 고정 그리드면 그 자리의 셀을 선택하고 인라인 편집을 연다 (C-10)
    if (el && el.type === 'fixedGrid' && drag.wasSelected && drag.snapshot === null) {
      const cell = this._cellAtPoint(el, e);
      if (cell) {
        this._selectedCell = cell;
        this._cellEditing = true;
        this.requestUpdate();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 고정 그리드 셀 편집 (C-10)
  // ---------------------------------------------------------------------------

  /** 포인터 위치가 가리키는 셀 좌표 — 병합 범위면 병합 원점 좌표를 돌려준다 */
  private _cellAtPoint(
    el: SlipElement & { type: 'fixedGrid' },
    e: PointerEvent,
  ): { row: number; column: number } | null {
    const point = this._paperPoint(e);
    const relX = point.x - el.position.x;
    const relY = point.y - el.position.y;
    if (relX < 0 || relY < 0 || relX > el.width || relY > el.height) return null;

    const colOffsets = cumulativeOffsets(el.width, el.columns, el.columnWidthPercentages);
    const rowOffsets = cumulativeOffsets(el.height, el.rows, el.rowHeightPercentages);
    // 경계 오른쪽/아래를 눌러도 마지막 칸으로 보정한다
    const indexOf = (value: number, offsets: number[], count: number): number => {
      const found = offsets.findIndex((offset) => value < offset) - 1;
      return found < 0 ? count - 1 : Math.min(count - 1, found);
    };
    const column = indexOf(relX, colOffsets, el.columns);
    const row = indexOf(relY, rowOffsets, el.rows);

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
    el: SlipElement & { type: 'fixedGrid' },
    row: number,
    column: number,
  ): { left: number; top: number; width: number; height: number } {
    const colOffsets = cumulativeOffsets(el.width, el.columns, el.columnWidthPercentages);
    const rowOffsets = cumulativeOffsets(el.height, el.rows, el.rowHeightPercentages);
    const cell = el.cells.find((c) => c.row === row && c.column === column);
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
    if (!el || el.type !== 'fixedGrid') return;
    const existing = el.cells.find((c) => c.row === target.row && c.column === target.column);
    if (!existing && value === '') {
      this.requestUpdate();
      return;
    }
    if (existing && existing.content === value) {
      this.requestUpdate();
      return;
    }
    this._updateElement((element) => {
      if (element.type !== 'fixedGrid') return;
      const cell = element.cells.find((c) => c.row === target.row && c.column === target.column);
      if (cell) cell.content = value;
      else element.cells.push({ row: target.row, column: target.column, content: value });
    });
  }

  /** 행·열 수 변경 — 비율은 비례 재배분, 범위 밖 셀은 제거하고 넘치는 병합은 줄인다 */
  private _setGridSize(rows: number, columns: number): void {
    this._updateElement((el) => {
      if (el.type !== 'fixedGrid') return;
      el.columnWidthPercentages = resizePercentages(el.columnWidthPercentages, columns);
      if (el.rowHeightPercentages) {
        el.rowHeightPercentages = resizePercentages(el.rowHeightPercentages, rows);
      }
      el.rows = rows;
      el.columns = columns;
      el.cells = el.cells.filter((cell) => cell.row < rows && cell.column < columns);
      for (const cell of el.cells) {
        if (cell.rowSpan !== undefined && cell.row + cell.rowSpan > rows) {
          const clamped = rows - cell.row;
          if (clamped <= 1) delete cell.rowSpan;
          else cell.rowSpan = clamped;
        }
        if (cell.colSpan !== undefined && cell.column + cell.colSpan > columns) {
          const clamped = columns - cell.column;
          if (clamped <= 1) delete cell.colSpan;
          else cell.colSpan = clamped;
        }
      }
    });
  }

  /** 선택 셀의 병합 범위 변경 — 그리드를 벗어나거나 다른 셀과 겹치면 무시한다 */
  private _setCellSpan(kind: 'rowSpan' | 'colSpan', value: number): void {
    const target = this._selectedCell;
    const el = this._findSelectedElement();
    if (!target || !el || el.type !== 'fixedGrid') return;
    if (!Number.isInteger(value) || value < 1) {
      this.requestUpdate();
      return;
    }
    const current = el.cells.find((c) => c.row === target.row && c.column === target.column);
    const rowSpan = kind === 'rowSpan' ? value : (current?.rowSpan ?? 1);
    const colSpan = kind === 'colSpan' ? value : (current?.colSpan ?? 1);
    // 그리드 범위 검사
    if (target.row + rowSpan > el.rows || target.column + colSpan > el.columns) {
      this.requestUpdate();
      return;
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
      this.requestUpdate();
      return;
    }
    this._updateElement((element) => {
      if (element.type !== 'fixedGrid') return;
      let cell = element.cells.find((c) => c.row === target.row && c.column === target.column);
      if (!cell) {
        cell = { row: target.row, column: target.column, content: '' };
        element.cells.push(cell);
      }
      const record = cell as Record<string, unknown>;
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
      if (element.type !== 'fixedGrid') return;
      let cell = element.cells.find((c) => c.row === target.row && c.column === target.column);
      if (!cell) {
        cell = { row: target.row, column: target.column, content: '' };
        element.cells.push(cell);
      }
      const record = cell as Record<string, unknown>;
      if (value === null || value === undefined || value === '') delete record[key];
      else record[key] = value;
    });
  }

  // ---------------------------------------------------------------------------
  // 동적 표 열 편집 (C-10)
  // ---------------------------------------------------------------------------

  /** 열 추가 — 기존 열을 비례 축소하고 새 열(빈 제목)이 균등 몫을 갖는다 */
  private _addTableColumn(): void {
    this._updateElement((el) => {
      if (el.type !== 'dynamicTable') return;
      const count = el.columns.length + 1;
      const used = new Set(el.columns.map((col) => col.key));
      let index = count;
      while (used.has(`col${index}`)) index++;
      const scaled = el.columns.map((col) => ({
        ...col,
        widthPercentage: (col.widthPercentage * el.columns.length) / count,
      }));
      scaled.push({ key: `col${index}`, title: '', widthPercentage: 100 / count });
      el.columns = normalizeWidths(scaled);
    });
  }

  /** 열 삭제 (최소 1열 유지) — 남은 열을 비례 확대해 합 100을 유지한다 */
  private _removeTableColumn(index: number): void {
    this._updateElement((el) => {
      if (el.type !== 'dynamicTable' || el.columns.length <= 1) return;
      el.columns = normalizeWidths(el.columns.filter((_, i) => i !== index));
    });
  }

  /** 열 너비 변경 — 나머지 열이 비례로 남은 몫을 나눠 갖는다 (합 100 유지) */
  private _setTableColumnWidth(index: number, value: number): void {
    const el = this._findSelectedElement();
    if (!el || el.type !== 'dynamicTable') return;
    if (!Number.isFinite(value) || value <= 0 || value >= 100) {
      this.requestUpdate();
      return;
    }
    this._updateElement((element) => {
      if (element.type !== 'dynamicTable') return;
      const othersTotal = element.columns.reduce(
        (acc, col, i) => (i === index ? acc : acc + col.widthPercentage), 0);
      const factor = (100 - value) / (othersTotal || 1);
      element.columns = normalizeWidths(element.columns.map((col, i) =>
        i === index
          ? { ...col, widthPercentage: value }
          : { ...col, widthPercentage: col.widthPercentage * factor }), index);
    });
  }

  /** 열 제목 변경 — 패널 빠른 수정과 열 편집 모달 공용 */
  private _setTableColumnTitle(index: number, value: string): void {
    this._updateElement((element) => {
      if (element.type === 'dynamicTable') element.columns[index]!.title = value;
    });
  }

  /** 열 데이터 키 변경 — 비어 있거나 다른 열과 겹치면 무시한다 (스키마 규칙) */
  private _setTableColumnKey(index: number, value: string): void {
    const el = this._findSelectedElement();
    if (!el || el.type !== 'dynamicTable') return;
    const v = value.trim();
    if (!v || el.columns.some((c, i) => i !== index && c.key === v)) {
      this.requestUpdate();
      return;
    }
    this._updateElement((element) => {
      if (element.type === 'dynamicTable') element.columns[index]!.key = v;
    });
  }

  /** 열 순서 이동 — delta -1은 앞으로, +1은 뒤로 (범위 밖은 무시) */
  private _moveTableColumn(index: number, delta: number): void {
    this._updateElement((el) => {
      if (el.type !== 'dynamicTable') return;
      const target = index + delta;
      if (target < 0 || target >= el.columns.length) return;
      const columns = [...el.columns];
      const [moved] = columns.splice(index, 1);
      columns.splice(target, 0, moved!);
      el.columns = columns;
    });
  }

  // ---------------------------------------------------------------------------
  // Snap helpers
  // ---------------------------------------------------------------------------

  /** 스냅 후보 선: 용지 가장자리·여백선 + 다른 요소들의 가장자리·중앙선 (mm) */
  private _snapCandidates(excludeId: string): { xs: number[]; ys: number[] } {
    const { paper } = this._file!.template;
    const [pt, pr, pb, pl] = paper.padding;
    const xs = [0, pl, paper.width - pr, paper.width];
    const ys = [0, pt, paper.height - pb, paper.height];
    for (const el of this._currentElements() ?? []) {
      if (el.id === excludeId) continue;
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
      (this._formulaModalOpen || this._columnsModalOpen || this._sampleModalOpen ||
        this._saveModalOpen || this._myFormsOpen)
    ) {
      this._formulaModalOpen = false;
      this._columnsModalOpen = false;
      this._sampleModalOpen = false;
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
      // 폰트 미지정 시 동봉 Pretendard 자동 사용 (ADR-012) — 한글 깨짐 방지
      const opts: RenderOptions = {
        fonts: this.fonts?.length ? this.fonts : await loadDefaultFonts(),
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
            <div class="canvas-area ${this._pendingTool ? 'drawing' : ''}"
                 @pointerdown=${this._onPointerDown}
                 @pointermove=${this._onPointerMove}
                 @pointerup=${this._onPointerUp}
                 @pointercancel=${this._onPointerCancel}>
              ${this._renderCanvas()}
            </div>
            <div class="prop-panel">${this._renderPropertyPanel()}</div>
            ${this._renderFormulaModal()}
            ${this._renderColumnsModal()}
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
          ['fixedGrid', s.addFixedGrid, icons.fixedGrid],
          ['dynamicTable', s.addDynamicTable, icons.dynamicTable],
          ['image', s.addImage, icons.image],
          ['line', s.shapeLine, icons.line],
        ] as const).map(([type, label, glyph]) =>
          this._iconButton(label, glyph, () => this._selectTool(type), {
            pressed: this._pendingTool === type,
          }),
        )}
        ${this._iconButton(s.shape, icons.shape, (e) => this._toggleShapeMenu(e), {
          pressed:
            this._shapeMenuOpen ||
            this._pendingTool === 'rect' ||
            this._pendingTool === 'ellipse' ||
            this._pendingTool === 'polygon',
        })}
        ${this._iconButton(s.addField, icons.field, () => this._selectTool('field'), {
          pressed: this._pendingTool === 'field',
        })}
      </div>
      <div class="tool-group">
        ${this._iconButton(s.delete, icons.remove, () => this._deleteSelected(), { disabled: !this._selectedId })}
        ${this._iconButton(s.copy, icons.copy, () => this._copySelected(), { disabled: !this._selectedId })}
        ${this._iconButton(s.paste, icons.paste, () => this._paste(), { disabled: !this._clipboard })}
        ${this._iconButton(s.undo, icons.undo, () => this._undo(), { disabled: this._undoStack.length === 0 })}
        ${this._iconButton(s.redo, icons.redo, () => this._redo(), { disabled: this._redoStack.length === 0 })}
      </div>
      <div class="tool-group">
        ${this._iconButton(s.prevPage, icons.pagePrev, () => this._goToPage(this._pageIndex - 1), { disabled: this._pageIndex === 0 })}
        <span class="page-indicator">${this._pageIndex + 1} / ${this._pageCount()}</span>
        ${this._iconButton(s.nextPage, icons.pageNext, () => this._goToPage(this._pageIndex + 1), { disabled: this._pageIndex >= this._pageCount() - 1 })}
        ${this._iconButton(s.pageMoveForward, icons.up, () => this._movePage(-1), {
          disabled: this._pageIndex === 0,
        })}
        ${this._iconButton(s.pageMoveBackward, icons.down, () => this._movePage(1), {
          disabled: this._pageIndex >= this._pageCount() - 1,
        })}
        ${this._iconButton(s.addPage, icons.pageAdd, () => this._addPage())}
        ${this._iconButton(s.deletePage, icons.pageRemove, () => this._deletePage(), { disabled: this._pageCount() <= 1 })}
      </div>
      <div class="tool-group">
        ${this._iconButton(
          this._previewMode ? s.edit : s.preview,
          this._previewMode ? icons.edit : icons.preview,
          () => this._togglePreview(),
          { pressed: this._previewMode },
        )}
      </div>
      <div class="tool-group">
        ${this._iconButton(s.preset, icons.preset, (e) => this._togglePresetMenu(e), {
          pressed: this._presetMenuOpen,
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
    `;
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
    this._selectedId = null;
    this._sideSelection = null;
    this._pageIndex = 0;
    this._previewMode = false;
    this._emitChange();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // Render: sidebar (B-7, 요소·바인딩 분리 ADR-034)
  // ---------------------------------------------------------------------------

  /** 사이드바에서 요소를 골랐을 때 — 필요하면 페이지를 옮기고 그 요소를 선택한다 */
  private _selectFromSidebar(pageIndex: number, id: string): void {
    this._goToPage(pageIndex);
    this._selectedId = id;
    this._sideSelection = null;
    this.requestUpdate();
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

  /** 사이드바에서 바인딩을 골랐을 때 — 오른쪽 패널이 그 바인딩 편집으로 바뀐다 (ADR-034) */
  private _selectBinding(key: string): void {
    this._bindingKeyError = false;
    this._selectedId = null;
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = { kind: 'binding', key };
    this.requestUpdate();
  }

  /** 사이드바에서 표 열을 골랐을 때 — 그 표가 있는 페이지로 옮기고 열 편집을 연다 (ADR-034) */
  private _selectColumn(pageIndex: number, elementId: string, index: number): void {
    this._goToPage(pageIndex);
    this._selectedId = elementId;
    this._selectedCell = null;
    this._cellEditing = false;
    this._sideSelection = { kind: 'column', elementId, index };
    this.requestUpdate();
  }

  /**
   * 양식 전체의 바인딩 목록 — 정의부(ADR-032)와 요소 사용처를 합친다.
   * 정의부에 논리명이 있으면 그 이름으로 표시하고(물리명은 title로 확인),
   * 동적 표 바인딩이면 그 표를 함께 담아 하위 열까지 보여 준다.
   */
  private _bindingList(): BindingInfo[] {
    const file = this._file;
    if (!file) return [];
    const defs = file.template.bindings ?? [];
    const labelOf = new Map(
      defs.filter((b) => b.label !== undefined).map((b) => [b.key, b.label!] as const),
    );
    const definedKeys = new Set(defs.map((b) => b.key));

    const uses = new Map<string, BindingUse[]>();
    const tableOf = new Map<string, { pageIndex: number; element: DynamicTableElement }>();
    file.template.pages.forEach((page, pageIndex) => {
      for (const el of page.elements) {
        if (el.type !== 'field' && el.type !== 'dynamicTable') continue;
        const list = uses.get(el.binding) ?? [];
        list.push({ pageIndex, id: el.id, name: el.name, type: el.type });
        uses.set(el.binding, list);
        if (el.type === 'dynamicTable' && !tableOf.has(el.binding)) {
          tableOf.set(el.binding, { pageIndex, element: el });
        }
      }
    });

    const list: BindingInfo[] = [];
    const seen = new Set<string>();
    for (const key of [...defs.map((d) => d.key), ...uses.keys()]) {
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        key,
        label: labelOf.get(key) ?? key,
        rawLabel: labelOf.get(key),
        defined: definedKeys.has(key),
        uses: uses.get(key) ?? [],
        table: tableOf.get(key),
      });
    }
    return list;
  }

  /**
   * 왼쪽 사이드바 — 목록·선택·추가·삭제만 한다 (ADR-034). 값 편집은 오른쪽 패널이 맡는다.
   * 페이지 썸네일(클릭 이동), 페이지별 요소 목록(클릭 선택·삭제),
   * 양식 전체의 바인딩 목록(클릭 선택, 동적 표는 하위 열까지).
   */
  private _renderSidebar() {
    const file = this._file!;
    const s = this._strings.designer;
    const { paper } = file.template;
    // 썸네일 폭(px)에 맞춘 축소 비율 — 높이는 용지 비율대로
    const thumbW = 132;
    const scale = thumbW / paper.width;
    const pages = file.template.pages;
    const bindings = this._bindingList();

    return html`
      <div class="side-section">
        <div class="side-title">${s.sidebarPages}</div>
        ${pages.map((page, i) => html`
          <button class="thumb ${i === this._pageIndex ? 'current' : ''}"
            aria-label="${s.sidebarPages} ${i + 1}"
            aria-pressed=${String(i === this._pageIndex)}
            @click=${() => this._goToPage(i)}>
            <span class="thumb-paper"
              style="width:${thumbW}px;height:${(paper.height * scale).toFixed(1)}px">
              ${page.elements.map((el) => html`<span class="thumb-el" style="
                left:${(el.position.x * scale).toFixed(1)}px;
                top:${(el.position.y * scale).toFixed(1)}px;
                width:${Math.max(2, el.width * scale).toFixed(1)}px;
                height:${Math.max(2, el.height * scale).toFixed(1)}px;
              "></span>`)}
            </span>
            <span class="thumb-label">${i + 1} / ${this._pageCount()}</span>
          </button>`)}
      </div>

      <div class="side-section">
        <div class="side-title">${s.sidebarElements}</div>
        ${pages.map((page, i) => html`
          ${pages.length > 1
            ? html`<button class="side-page-head ${i === this._pageIndex ? 'current' : ''}"
                aria-label="${s.sidebarElements} ${s.sidebarPages} ${i + 1}"
                aria-expanded=${String(i === this._pageIndex)}
                @click=${() => this._goToPage(i)}>
                <span>${s.sidebarPages} ${i + 1}</span><span>${page.elements.length}</span>
              </button>`
            : nothing}
          ${i !== this._pageIndex
            ? nothing
            : page.elements.length === 0
              ? html`<div class="side-empty">—</div>`
              : page.elements.map((el) => html`
                  <div class="side-row-wrap">
                    <button class="side-row ${el.id === this._selectedId && !this._sideSelection ? 'selected' : ''}"
                      title=${el.name}
                      @click=${() => this._selectFromSidebar(i, el.id)}>
                      ${TYPE_BADGE[el.type]}<span>${el.name}</span>
                    </button>
                    <button class="side-mini" title=${s.delete} aria-label="${el.name} ${s.delete}"
                      @click=${() => this._deleteElementById(i, el.id)}>${icons.remove}</button>
                  </div>`)}`)}
      </div>

      <div class="side-section">
        <div class="side-title-row">
          <span class="side-title">${s.sidebarBindings}</span>
          <button class="side-mini" title=${s.sampleData} aria-label=${s.sampleData}
            @click=${() => {
              this._sampleModalOpen = true;
              this._samplePage = 0;
              this._sampleJsonMode = false;
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

  /** 바인딩 한 줄 — 클릭하면 오른쪽 패널에서 편집, 동적 표 바인딩은 하위 열까지 (ADR-034) */
  private _renderBindingRow(b: BindingInfo) {
    const s = this._strings.designer;
    const sel = this._sideSelection;
    const selected = sel?.kind === 'binding' && sel.key === b.key;
    return html`
      <div class="side-row-wrap">
        <button class="side-row ${selected ? 'selected' : ''}" title=${b.key}
          @click=${() => this._selectBinding(b.key)}>
          ${b.table ? TYPE_BADGE.dynamicTable : TYPE_BADGE.field}<span>${b.label}</span>
        </button>
        <button class="side-mini" title=${s.delete} aria-label="${b.key} ${s.delete}"
          ?disabled=${!b.defined}
          @click=${() => this._removeBindingDef(b.key)}>${icons.remove}</button>
      </div>
      ${(b.table?.element.columns ?? []).map((col, index) => html`
        <button class="side-col-row ${
          sel?.kind === 'column' && sel.elementId === b.table!.element.id && sel.index === index
            ? 'selected'
            : ''
        }" title=${col.key}
          aria-label="${b.key} ${s.columns} ${index + 1}"
          @click=${() => this._selectColumn(b.table!.pageIndex, b.table!.element.id, index)}>
          <span>${col.title || col.key}</span>
        </button>`)}
    `;
  }

  // ---------------------------------------------------------------------------
  // 요소·바인딩 정의부 편집 (D-13, ADR-032 · 개편 ADR-034)
  // ---------------------------------------------------------------------------

  /** 사이드바에서 요소를 지운다 — 그 페이지에서만 찾아 제거한다 */
  private _deleteElementById(pageIndex: number, id: string): void {
    const elements = this._file?.template.pages[pageIndex]?.elements;
    if (!elements) return;
    const idx = elements.findIndex((el) => el.id === id);
    if (idx < 0) return;

    this._pushUndo();
    elements.splice(idx, 1);
    if (this._selectedId === id) {
      this._selectedId = null;
      this._selectedCell = null;
      this._cellEditing = false;
    }
    this._emitChange();
    this.requestUpdate();
  }

  /** 바인딩을 기본 이름으로 즉시 만들고 고른다 — 이름은 오른쪽 패널에서 고친다 (ADR-034) */
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

  /** 요소가 쓰는 바인딩을 정의부에 등록해 둔다 — 이미 있으면 그대로 둔다 (ADR-034) */
  private _ensureBindingDef(key: string): void {
    const file = this._file;
    if (!file || !key) return;
    const defs = file.template.bindings ?? [];
    if (defs.some((b) => b.key === key)) return;
    defs.push({ key });
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
          if ((el.type === 'field' || el.type === 'dynamicTable') && el.binding === key) {
            el.binding = trimmed;
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

  /** 정의부에서 바인딩을 제거한다 — 요소가 쓰는 키면 목록에는 사용처 기준으로 남는다 */
  private _removeBindingDef(key: string): void {
    this._updateFile((f) => {
      const defs = (f.template.bindings ?? []).filter((b) => b.key !== key);
      if (defs.length > 0) f.template.bindings = defs;
      else delete (f.template as { bindings?: unknown }).bindings;
    });
    // 목록에서 사라진 바인딩을 고른 채로 두지 않는다
    const sel = this._sideSelection;
    if (sel?.kind === 'binding' && sel.key === key && !this._bindingList().some((b) => b.key === key)) {
      this._sideSelection = null;
      this.requestUpdate();
    }
  }

  // ---------------------------------------------------------------------------
  // Render: canvas
  // ---------------------------------------------------------------------------

  private _renderCanvas() {
    if (!this._file) return nothing;
    const { paper } = this._file.template;
    const page = this._file.template.pages[this._pageIndex];
    if (!page) return nothing;

    const pw = paper.width * PX_PER_MM;
    const ph = paper.height * PX_PER_MM;
    const [pt, pr, pb, pl] = paper.padding;

    return html`
      <div class="paper" style="width:${pw}px;height:${ph}px">
        <div class="padding-guide" style="
          left:${pl * PX_PER_MM}px;
          top:${pt * PX_PER_MM}px;
          width:${(paper.width - pl - pr) * PX_PER_MM}px;
          height:${(paper.height - pt - pb) * PX_PER_MM}px;
        "></div>
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
    `;
  }

  /** 인라인 셀 편집 입력 상자 — 선택 셀 위에 겹쳐 그린다 (C-10) */
  private _renderCellEditor() {
    if (!this._cellEditing || !this._selectedCell) return nothing;
    const el = this._findSelectedElement();
    if (!el || el.type !== 'fixedGrid') return nothing;
    const { row, column } = this._selectedCell;
    const rect = this._cellRectPx(el, row, column);
    const cell = el.cells.find((c) => c.row === row && c.column === column);
    return html`<input class="cell-editor"
      style="left:${rect.left}px;top:${rect.top}px;width:${Math.max(24, rect.width)}px;height:${Math.max(16, rect.height)}px"
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
    const selected = el.id === this._selectedId;

    let style = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

    // 선·타원·삼각형은 svg로 그린다 — 상자(div)에 배경·테두리를 칠하면 PDF와 어긋난다
    const drawnAsSvg = el.type === 'line' || el.type === 'ellipse' || el.type === 'polygon';
    if (el.type !== 'image' && !drawnAsSvg) {
      const r = el as Record<string, unknown>;
      // 동적 표의 배경색은 머리행 배경으로만 쓴다 (PDF 변환과 동일) — 상자 전체를 칠하지 않는다
      if (r.backgroundColor && el.type !== 'dynamicTable') style += `;background-color:${r.backgroundColor}`;
      if (r.fontColor) style += `;color:${r.fontColor}`;
      if (r.borderColor) style += `;border-color:${r.borderColor}`;
      // 테두리 굵기를 명시했을 때만 반영 (미지정 시 편집용 실선 유지)
      if (typeof r.borderWidth === 'number' && r.borderWidth > 0) {
        style += `;border-width:${(r.borderWidth * PX_PER_MM).toFixed(2)}px`;
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
          >${el.content}</span>`;

      case 'fixedGrid':
        return this._renderGridPreview(el);

      case 'dynamicTable':
        // PDF 변환과 동일하게: 요소 배경색 = 머리행 배경(기본 #eeeeee), 머리행은 가운데 정렬
        return html`<div class="table-preview">
          ${el.columns.map((col) =>
            html`<div style="flex:${col.widthPercentage};background-color:${el.backgroundColor ?? '#eeeeee'}">${col.title}</div>`,
          )}
        </div>`;

      case 'image':
        return el.src.startsWith('data:')
          ? html`<img src=${el.src} alt="">`
          : html`<span class="el-content">${this._strings.designer.typeImage}</span>`;

      case 'line':
      case 'ellipse':
      case 'polygon':
        return this._renderShapePreview(el);

      case 'rect':
        return nothing;

      case 'field':
        return html`<span class="el-content"
          style="font-size:${fontPx(el.fontSize)};text-align:${el.alignment ?? 'left'}${textStyleCss(el)}"
          >{${el.binding}}</span>`;
    }
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
    const strokeWidth = Math.max(1, (el.borderWidth ?? 0.2) * PX_PER_MM);

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
   * 고정 그리드 캔버스 표시 — PDF 변환(convert.ts appendFixedGrid)과 같은 규칙으로
   * 열/행 비율·셀 병합·셀 문구·셀 스타일을 그린다.
   */
  private _renderGridPreview(el: SlipElement & { type: 'fixedGrid' }) {
    const { rows, columns } = el;
    const selected = el.id === this._selectedId;
    const colTracks = (el.columnWidthPercentages ?? Array.from({ length: columns }, () => 100 / columns))
      .map((p) => `${p}fr`).join(' ');
    const rowTracks = (el.rowHeightPercentages ?? Array.from({ length: rows }, () => 100 / rows))
      .map((p) => `${p}fr`).join(' ');
    const lineColor = el.borderColor ?? '#000000';
    const lineWidth = el.borderWidth ?? 0.2;
    // 셀별 테두리 — 셀 값이 요소 값보다 우선한다 (ADR-033). 공유 변은 이웃 셀이
    // 각자 자기 테두리를 그리는 근사 표시라 PDF의 굵은 쪽 우선 규칙과 거의 같다
    const borderCssOf = (cell?: {
      borderWidth?: number | undefined;
      borderColor?: string | undefined;
      borderStyle?: string | undefined;
    }): string => {
      const width = cell?.borderWidth ?? lineWidth;
      if (width <= 0) return 'none';
      const px = Math.max(1, Math.round(width * PX_PER_MM));
      return `${px}px ${cell?.borderStyle ?? el.borderStyle ?? 'solid'} ${cell?.borderColor ?? lineColor}`;
    };

    // 셀 소유 그리드 (병합 반영) — 병합 범위의 비원점 칸은 그리지 않는다
    const owner: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(-1));
    el.cells.forEach((cell, index) => {
      for (let r = cell.row; r < cell.row + (cell.rowSpan ?? 1); r++) {
        for (let c = cell.column; c < cell.column + (cell.colSpan ?? 1); c++) {
          const line = owner[r];
          if (line) line[c] = index;
        }
      }
    });

    const boxes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const idx = owner[r]?.[c] ?? -1;
        if (idx === -1) {
          const emptySelected = selected && this._selectedCell?.row === r && this._selectedCell?.column === c;
          boxes.push(html`<div class=${emptySelected ? 'cell-selected' : ''}
            style="grid-area:${r + 1}/${c + 1};border:${borderCssOf()}"></div>`);
          continue;
        }
        const cell = el.cells[idx]!;
        if (cell.row !== r || cell.column !== c) continue; // 병합 범위 내부
        const cellSelected = selected && this._selectedCell?.row === r && this._selectedCell?.column === c;
        const style = [
          `grid-area:${r + 1}/${c + 1}/span ${cell.rowSpan ?? 1}/span ${cell.colSpan ?? 1}`,
          `border:${borderCssOf(cell)}`,
          `font-size:${fontPx(cell.fontSize)}`,
          `justify-content:${justifyOf(cell.alignment)}`,
          cell.backgroundColor ? `background-color:${cell.backgroundColor}` : '',
          cell.fontColor ? `color:${cell.fontColor}` : '',
        ].filter(Boolean).join(';') + textStyleCss(cell);
        boxes.push(html`<div class=${cellSelected ? 'cell-selected' : ''} style=${style}>${cell.content}</div>`);
      }
    }
    return html`<div class="grid-preview"
      style="grid-template-columns:${colTracks};grid-template-rows:${rowTracks}">${boxes}</div>`;
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
   * 양식 설정 패널 — 요소를 선택하지 않았을 때 표시한다.
   * 제목·용지 크기(프리셋/직접 입력)·방향·여백을 편집한다. 방향과 프리셋은
   * 파일에 없는 화면 차원 개념이라 너비·높이로만 반영된다 (포맷 불변).
   */
  private _renderFormSettings() {
    const file = this._file!;
    const s = this._strings.designer;
    const { paper } = file.template;
    const [pt, pr, pb, pl] = paper.padding;
    const landscape = paper.width > paper.height;
    // 현재 크기와 일치하는 프리셋 (방향 무관 비교)
    const presetIndex = PAPER_PRESETS.findIndex(
      (p) =>
        (p.width === paper.width && p.height === paper.height) ||
        (p.width === paper.height && p.height === paper.width),
    );

    // 여백 합이 용지보다 작아야 한다는 스키마 규칙을 어기는 값은 되돌린다
    const setSize = (width: number, height: number): void => {
      if (width <= pl + pr || height <= pt + pb) {
        this.requestUpdate();
        return;
      }
      this._updateFile((f) => {
        f.template.paper.width = round1(width);
        f.template.paper.height = round1(height);
      });
    };
    const setPadding = (index: 0 | 1 | 2 | 3, value: number): void => {
      if (Number.isNaN(value) || value < 0) {
        this.requestUpdate();
        return;
      }
      const next = [...paper.padding] as [number, number, number, number];
      next[index] = round1(value);
      if (next[3] + next[1] >= paper.width || next[0] + next[2] >= paper.height) {
        this.requestUpdate();
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
                     this.requestUpdate();
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
                    const p = PAPER_PRESETS[Number(v)]!;
                    // 프리셋은 세로 기준 — 현재 방향을 유지해 적용
                    setSize(landscape ? p.height : p.width, landscape ? p.width : p.height);
                  }}>
            ${PAPER_PRESETS.map((p, i) => html`
              <option value=${String(i)} ?selected=${i === presetIndex}>
                ${p.name} (${p.width}×${p.height})
              </option>`)}
            <option value="custom" ?selected=${presetIndex < 0}>${s.paperCustom}</option>
          </select>
        </div>
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
  private _renderAnchorRow() {
    const s = this._strings.designer;
    return html`
      <div class="prop-row">
        <label>${s.anchor}</label>
        <div class="anchor-grid" role="group" aria-label=${s.anchor}>
          ${ANCHORS.map((a, i) => html`
            <button class="anchor-dot" title=${s[a.key]} aria-label="${s.anchor}: ${s[a.key]}"
              aria-pressed=${String(i === this._anchorIndex)}
              @click=${() => {
                this._anchorIndex = i;
                this.requestUpdate();
              }}></button>`)}
        </div>
      </div>
    `;
  }

  private _renderPropertyPanel() {
    // 선택 대상은 요소 · 바인딩 · 표 열 셋 — 아무것도 고르지 않았으면 양식 설정 (ADR-034)
    const sel = this._sideSelection;
    if (sel?.kind === 'column') {
      const table = this._findElement(sel.elementId);
      if (table?.type === 'dynamicTable' && table.columns[sel.index]) {
        return this._renderColumnPanel(table, sel.index);
      }
    }
    if (sel?.kind === 'binding') return this._renderBindingPanel(sel.key);

    const el = this._findSelectedElement();
    if (!el) {
      return this._renderFormSettings();
    }

    const s = this._strings.designer;
    const numOf = (e: Event) => Number((e.target as HTMLInputElement).value);
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    const anchor = ANCHORS[this._anchorIndex] ?? ANCHORS[0];

    return html`
      <div class="type-name">${this._typeName(el.type)}</div>

      <div class="prop-section">
        <div class="prop-row">
          <label>${s.name}</label>
          <input .value=${el.name}
                 @change=${(e: Event) => this._updateElement((el) => { el.name = valOf(e); })}>
        </div>
        ${this._renderAnchorRow()}
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
        <div class="prop-pair">
          <div class="prop-row">
            <label>${s.width}</label>
            <input type="number" step="0.5" min="1" .value=${String(el.width)}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) this._updateElement((el) => { el.width = Math.max(0, v); });
                   }}>
          </div>
          <div class="prop-row">
            <label>${s.height}</label>
            <input type="number" step="0.5" min="1" .value=${String(el.height)}
                   @change=${(e: Event) => {
                     const v = numOf(e);
                     if (!Number.isNaN(v)) this._updateElement((el) => { el.height = Math.max(0, v); });
                   }}>
          </div>
        </div>
      </div>

      ${this._renderTypeProps(el)}
      ${this._renderStyleGroups(el)}
    `;
  }

  /**
   * 바인딩 패널 — 사이드바에서 바인딩을 골랐을 때 (ADR-034).
   * 물리명·논리명을 고치고, 이 값을 쓰는 요소 목록에서 눌러 그 요소로 이동한다.
   */
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
      </div>

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

  /** 표 열 패널 — 사이드바에서 동적 표의 열을 골랐을 때 (ADR-034) */
  private _renderColumnPanel(el: DynamicTableElement, index: number) {
    const s = this._strings.designer;
    const col = el.columns[index]!;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    return html`
      <div class="type-name">${s.columnPanelTitle}</div>

      <div class="prop-section">
        <div class="prop-row">
          <label>${s.formTitle}</label>
          <input class="col-panel-title" .value=${col.title}
            @change=${(e: Event) => this._setTableColumnTitle(index, valOf(e))}>
        </div>
        <div class="prop-row">
          <label>${s.columnKey}</label>
          <input class="col-panel-key" .value=${col.key}
            @change=${(e: Event) => this._setTableColumnKey(index, valOf(e))}>
        </div>
        <div class="prop-row">
          <label>${s.columnWidthPct}</label>
          <input class="col-panel-width" type="number" min="1" max="99" step="1"
            .value=${String(Math.round(col.widthPercentage * 100) / 100)}
            @change=${(e: Event) => this._setTableColumnWidth(index, Number(valOf(e)))}>
        </div>
      </div>

      <div class="prop-section">
        <button class="col-modal-open" aria-label=${s.columnsModalTitle}
          @click=${() => {
            this._columnsModalOpen = true;
            this.requestUpdate();
          }}>${icons.edit}<span>${s.columnsModalTitle}</span></button>
      </div>
    `;
  }

  /**
   * 요소가 쓸 값을 등록된 목록에서 고르는 선택 상자 (ADR-034) —
   * "새 값 등록"을 고르면 기본 이름으로 값을 만들어 바로 이 요소에 붙인다.
   */
  private _renderBindingSelect(current: string) {
    const s = this._strings.designer;
    const list = this._bindingList();

    return html`
      <div class="prop-row">
        <label>${s.binding}</label>
        <select class="binding-select" aria-label=${s.binding}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            if (value === NEW_BINDING_OPTION) this._assignNewBinding();
            else {
              this._updateElement((el) => {
                if (el.type === 'field' || el.type === 'dynamicTable') el.binding = value;
              });
            }
          }}>
          ${list.map((b) => html`
            <option value=${b.key} ?selected=${b.key === current}>${b.label}</option>`)}
          <option value=${NEW_BINDING_OPTION}>${s.bindingNew}</option>
        </select>
      </div>
    `;
  }

  /** 새 값을 만들어 지금 고른 요소에 붙인다 — 등록과 연결을 한 번에 (ADR-034) */
  private _assignNewBinding(): void {
    const el = this._findSelectedElement();
    if (!el || (el.type !== 'field' && el.type !== 'dynamicTable')) {
      this.requestUpdate();
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
          if (target.id === id && (target.type === 'field' || target.type === 'dynamicTable')) {
            target.binding = key;
          }
        }
      }
    });
  }

  /** 아직 쓰지 않는 기본 바인딩 이름 한 쌍(물리명·논리명)을 만든다 */
  private _nextBinding(): { key: string; label: string } {
    const used = new Set(this._bindingList().map((b) => b.key));
    let n = 1;
    while (used.has(`value${n}`)) n += 1;
    return { key: `value${n}`, label: `${this._strings.designer.newBindingName} ${n}` };
  }

  private _typeName(type: SlipElement['type']): string {
    const s = this._strings.designer;
    const map: Record<SlipElement['type'], string> = {
      text: s.typeText,
      fixedGrid: s.typeFixedGrid,
      dynamicTable: s.typeDynamicTable,
      image: s.typeImage,
      line: s.shapeLine,
      rect: s.shapeRect,
      ellipse: s.shapeEllipse,
      polygon: s.shapePolygon,
      field: s.typeField,
    };
    return map[type];
  }

  // ---------------------------------------------------------------------------
  // Render: type-specific props
  // ---------------------------------------------------------------------------

  private _renderTypeProps(el: SlipElement) {
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;

    switch (el.type) {
      case 'text':
        return html`
          <div class="prop-section">
            <div class="prop-section-title">${s.content}</div>
            <div class="prop-row">
              <textarea rows="3" .value=${el.content}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type === 'text') el.content = (e.target as HTMLTextAreaElement).value;
                })}></textarea>
            </div>
          </div>
        `;

      case 'field':
        return html`
          <div class="prop-section">
            ${this._renderBindingSelect(el.binding)}
            <div class="prop-row">
              <label>${s.formula}</label>
              <input .value=${el.formula ?? ''}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type !== 'field') return;
                  const v = valOf(e);
                  const r = el as Record<string, unknown>;
                  if (v) r.formula = v;
                  else delete r.formula;
                })}>
              <button class="row-btn" title=${s.formulaModalTitle} aria-label=${s.formulaModalTitle}
                @click=${() => this._openFormulaModal()}>${icons.formula}</button>
            </div>
          </div>
        `;

      case 'line':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.lineDirection}</label>
              <select .value=${el.lineDirection ?? 'horizontal'}
                @change=${(e: Event) => this._updateElement((el) => {
                  if (el.type === 'line') {
                    el.lineDirection = valOf(e) as 'horizontal' | 'vertical' | 'down' | 'up';
                  }
                })}>
                ${([
                  ['horizontal', s.lineHorizontal],
                  ['vertical', s.lineVertical],
                  ['down', s.lineDown],
                  ['up', s.lineUp],
                ] as const).map(([value, label]) => html`
                  <option value=${value} ?selected=${(el.lineDirection ?? 'horizontal') === value}>
                    ${label}
                  </option>`)}
              </select>
            </div>
          </div>
        `;

      case 'polygon':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.sides}</label>
              <input type="number" min="3" max="12" step="1" .value=${String(el.sides)}
                @change=${(e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  // 스키마 범위(3~12) 밖 값은 되돌린다
                  if (!Number.isInteger(v) || v < 3 || v > 12) {
                    this.requestUpdate();
                    return;
                  }
                  this._updateElement((el) => {
                    if (el.type === 'polygon') el.sides = v;
                  });
                }}>
            </div>
          </div>
        `;

      case 'fixedGrid': {
        const cellTarget = this._selectedCell;
        const selectedCellDef = cellTarget
          ? el.cells.find((c) => c.row === cellTarget.row && c.column === cellTarget.column)
          : undefined;
        // 행·열 수는 정수 1~100만 받는다 (밖의 값은 되돌림)
        const sizeOf = (e: Event): number | null => {
          const v = Number((e.target as HTMLInputElement).value);
          if (!Number.isInteger(v) || v < 1 || v > 100) {
            this.requestUpdate();
            return null;
          }
          return v;
        };
        return html`
          <div class="prop-section">
            <div class="prop-pair">
              <div class="prop-row">
                <label>${s.rows}</label>
                <input type="number" min="1" max="100" .value=${String(el.rows)}
                  @change=${(e: Event) => {
                    const v = sizeOf(e);
                    if (v !== null) this._setGridSize(v, el.columns);
                  }}>
              </div>
              <div class="prop-row">
                <label>${s.columns}</label>
                <input type="number" min="1" max="100" .value=${String(el.columns)}
                  @change=${(e: Event) => {
                    const v = sizeOf(e);
                    if (v !== null) this._setGridSize(el.rows, v);
                  }}>
              </div>
            </div>
          </div>
          ${cellTarget
            ? html`
              <div class="prop-section">
                <div class="prop-section-title">
                  ${s.cell} (${cellTarget.row + 1}, ${cellTarget.column + 1})
                </div>
                <div class="prop-row">
                  <label>${s.content}</label>
                  <input .value=${selectedCellDef?.content ?? ''}
                    @change=${(e: Event) => {
                      this._selectedCell = cellTarget;
                      this._commitCellContent(valOf(e));
                    }}>
                </div>
                <div class="prop-row">
                  <label>${s.merge}</label>
                  <div class="merge-inputs">
                    <span>${s.rows}</span>
                    <input type="number" min="1" .value=${String(selectedCellDef?.rowSpan ?? 1)}
                      aria-label="${s.merge} ${s.rows}"
                      @change=${(e: Event) => this._setCellSpan('rowSpan', Number(valOf(e)))}>
                    <span>${s.columns}</span>
                    <input type="number" min="1" .value=${String(selectedCellDef?.colSpan ?? 1)}
                      aria-label="${s.merge} ${s.columns}"
                      @change=${(e: Event) => this._setCellSpan('colSpan', Number(valOf(e)))}>
                  </div>
                </div>
                <div class="prop-row">
                  <label>${s.fontSize}</label>
                  <input type="number" step="0.5"
                    class=${selectedCellDef?.fontSize === undefined ? 'dim' : ''}
                    .value=${String(selectedCellDef?.fontSize ?? '')}
                    placeholder=${String(DEFAULT_FONT_SIZE)}
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
                        aria-pressed=${String((selectedCellDef?.alignment ?? 'left') === value)}
                        @click=${() => this._updateCellStyle('alignment', value === 'left' ? null : value)}>${glyph}</button>`)}
                  </div>
                </div>
                ${this._renderTextStyleToggles(
                  selectedCellDef ?? {},
                  (key, value) => this._updateCellStyle(key, value ? true : null),
                  `${s.cell} `,
                )}
                ${this._renderColorControl(
                  s.backgroundColor, selectedCellDef?.backgroundColor, 'cellBackgroundColor',
                  (v) => this._updateCellStyle('backgroundColor', v),
                  undefined,
                  `${s.cell} ${s.backgroundColor}`,
                )}
                ${this._renderColorControl(
                  s.fontColor, selectedCellDef?.fontColor, 'cellFontColor',
                  (v) => this._updateCellStyle('fontColor', v),
                  el.fontColor ?? DEFAULT_FONT_COLOR,
                  `${s.cell} ${s.fontColor}`,
                )}
                ${this._renderColorControl(
                  s.borderColor, selectedCellDef?.borderColor, 'cellBorderColor',
                  (v) => this._updateCellStyle('borderColor', v),
                  el.borderColor ?? DEFAULT_BORDER_COLOR,
                  `${s.cell} ${s.borderColor}`,
                )}
                ${this._renderBorderWidthSelect(
                  selectedCellDef?.borderWidth,
                  el.borderWidth ?? 0.2,
                  true,
                  'cellBorderWidth',
                  (v) => this._updateCellStyle('borderWidth', v),
                )}
                ${this._renderBorderShapeRow(
                  selectedCellDef?.borderStyle,
                  `${s.cell} ${s.borderShape}`,
                  'cellBorderStyle',
                  (v) => this._updateCellStyle('borderStyle', v),
                )}
              </div>`
            : html`<div class="prop-section"><div class="cell-hint">${s.cellHint}</div></div>`}
        `;
      }

      case 'dynamicTable':
        // 패널에는 제목·너비 빠른 수정만 — 키·추가·삭제·순서는 열 편집 모달에서 (D-12)
        return html`
          <div class="prop-section">
            ${this._renderBindingSelect(el.binding)}
          </div>
          <div class="prop-section">
            <div class="prop-section-title">${s.columns}</div>
            <div class="col-edit-head">
              <span>${s.formTitle}</span><span>${s.columnWidthPct}</span>
            </div>
            ${el.columns.map((col, index) => html`
              <div class="col-edit">
                <input class="col-title" .value=${col.title}
                  aria-label="${s.columns} ${index + 1} ${s.formTitle}"
                  @change=${(e: Event) => this._setTableColumnTitle(index, valOf(e))}>
                <input class="col-width" type="number" min="1" max="99" step="1"
                  .value=${String(Math.round(col.widthPercentage * 100) / 100)}
                  aria-label="${s.columns} ${index + 1} ${s.columnWidthPct}"
                  @change=${(e: Event) => this._setTableColumnWidth(index, Number(valOf(e)))}>
              </div>`)}
            <button class="col-modal-open" aria-label=${s.columnsModalTitle}
              @click=${() => {
                this._columnsModalOpen = true;
                this.requestUpdate();
              }}>${icons.edit}<span>${s.columnsModalTitle}</span></button>
          </div>
        `;

      case 'image':
        return html`
          <div class="prop-section">
            <div class="prop-row">
              <label>${s.src}</label>
              <input .value=${el.src.length > 40 ? el.src.slice(0, 40) + '…' : el.src} disabled>
            </div>
          </div>
        `;

      default:
        return nothing;
    }
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
            this._updateElement((el) => {
              const r = el as Record<string, unknown>;
              if (v > 0) r.fontSize = v;
              else delete r.fontSize;
            });
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
              @click=${() => this._updateElement((target) => {
                const r = target as Record<string, unknown>;
                if (value !== 'left') r.alignment = value;
                else delete r.alignment;
              })}>${glyph}</button>`)}
        </div>
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
    this._updateElement((el) => {
      const r = el as Record<string, unknown>;
      if (value) r[key] = value;
      else delete r[key];
    });
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
        if (value) {
          const hsv = hexToHsv(value);
          if (hsv.s > 0) this._pickerH = hsv.h;
          this._pickerS = hsv.s;
          this._pickerV = hsv.v;
        }
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
                const hsv = hexToHsv(current);
                if (hsv.s > 0) this._pickerH = hsv.h;
                this._pickerS = hsv.s;
                this._pickerV = hsv.v;
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
                  this.requestUpdate();
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
  ) {
    const s = this._strings.designer;
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
        <label>${s.borderWidth}</label>
        <button class="width-btn" aria-label=${s.borderWidth} aria-expanded=${String(open)}
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
        <div class="width-pop" role="menu" aria-label=${s.borderWidth}>
          ${allowNone ? html`
            <button role="menuitem" aria-label="${s.borderWidth}: ${s.colorNone}"
              aria-pressed=${String(effective <= 0)}
              @click=${() => pick(0)}>
              <span class="width-value">${s.colorNone}</span>
            </button>` : nothing}
          ${steps.map((w) => html`
            <button role="menuitem" aria-label="${s.borderWidth}: ${w}mm"
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
    const hasFontColor =
      el.type === 'text' || el.type === 'field' || el.type === 'fixedGrid' || el.type === 'dynamicTable';
    const hasTextDecor = el.type === 'text' || el.type === 'field';
    const hasBackground = el.type !== 'line';
    // 테두리 형태(파선·점선)는 직선 분해 렌더가 가능한 종류만 (ADR-032)
    const hasBorderShape = el.type === 'line' || el.type === 'rect' || el.type === 'fixedGrid';
    // 텍스트·필드는 기본 테두리 없음, 나머지는 기본 0.2mm (PDF 변환 계층과 동일)
    const defaultWidth = el.type === 'text' || el.type === 'field' ? 0 : 0.2;

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
                (key, value) => this._updateElement((target) => {
                  const t = target as Record<string, unknown>;
                  if (value) t[key] = true;
                  else delete t[key];
                }),
              )
            : nothing}
        </div>` : nothing}
      ${hasBackground ? html`
        <div class="prop-section">
          <div class="prop-section-title">${s.styleBackground}</div>
          ${this._renderColorControl(s.backgroundColor, r.backgroundColor as string | undefined, 'backgroundColor')}
        </div>` : nothing}
      <div class="prop-section">
        <div class="prop-section-title">${s.styleBorder}</div>
        ${this._renderColorControl(
          s.borderColor, r.borderColor as string | undefined, 'borderColor', undefined, DEFAULT_BORDER_COLOR,
        )}
        ${this._renderBorderWidthSelect(
          r.borderWidth as number | undefined,
          defaultWidth,
          el.type !== 'line',
          'borderWidth',
          (v) => this._updateElement((target) => {
            const t = target as Record<string, unknown>;
            // 텍스트·필드의 없음(0)은 기본값과 같아 파일에 남기지 않는다
            if (v === 0 && defaultWidth === 0) delete t.borderWidth;
            else t.borderWidth = v;
          }),
        )}
        ${hasBorderShape
          ? this._renderBorderShapeRow(
              r.borderStyle as 'solid' | 'dashed' | 'dotted' | undefined,
              `${s.styleBorder} ${s.borderShape}`,
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
                  this.requestUpdate();
                  return;
                }
                this._updateElement((target) => {
                  if (target.type !== 'rect') return;
                  const t = target as Record<string, unknown>;
                  if (v > 0) t.radius = v;
                  else delete t.radius;
                });
              }}>
          </div>` : nothing}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: modals (D-12 — 편집 UI 배치 원칙: 항목이 많은 편집은 모달로)
  // ---------------------------------------------------------------------------

  /** 양식 전체의 바인딩 목록 (정의부 + 요소 사용처, 중복 없이) — 수식 모달의 클릭 삽입용 */
  private _collectBindings(): { key: string; label: string }[] {
    const file = this._file;
    if (!file) return [];
    const list: { key: string; label: string }[] = [];
    const seen = new Set<string>();
    const labelOf = new Map<string, string>(
      (file.template.bindings ?? [])
        .filter((b) => b.label !== undefined)
        .map((b) => [b.key, b.label!]),
    );
    const push = (key: string): void => {
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key, label: labelOf.get(key) ?? key });
    };
    for (const def of file.template.bindings ?? []) push(def.key);
    for (const page of file.template.pages) {
      for (const el of page.elements) {
        if (el.type === 'field' || el.type === 'dynamicTable') push(el.binding);
      }
    }
    return list;
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
      const r = el as Record<string, unknown>;
      if (draft) r.formula = draft;
      else delete r.formula;
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
      }
    });
  }

  /**
   * 수식 편집 모달 — 초안 편집, 실시간 문법 검사(자체 파서, ADR-010), 샘플 값
   * (`sampleValues`) 기준 결과 미리 계산, 바인딩·함수 29종 클릭 삽입 (ADR-017).
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
    const bindings = this._collectBindings();

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
              this._formulaDraft = (e.target as HTMLTextAreaElement).value;
              this.requestUpdate();
            }}></textarea>
          <div class="formula-status ${syntaxError ? 'error' : ''}">
            ${syntaxError
              ? `${s.syntaxError}: ${syntaxError}`
              : draft.trim() === ''
                ? ''
                : previewError
                  ? `${s.previewUnavailable}: ${previewError}`
                  : `${s.previewResult}: ${preview}`}
          </div>
          ${bindings.length > 0
            ? html`
                <div class="modal-section-title">${s.formulaBindings}</div>
                <div class="binding-chips">
                  ${bindings.map((b) => html`
                    <button class="binding-chip" title=${b.key}
                      @click=${() => this._insertFormulaText(b.key)}>${b.label}</button>`)}
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
   * 동적 표 열 편집 모달 — 열 전체 관리(제목·데이터 키·너비·추가·삭제·순서 이동).
   * 편집은 즉시 반영되고 각 변경이 되돌리기 단위가 된다.
   */
  private _renderColumnsModal() {
    if (!this._columnsModalOpen) return nothing;
    const el = this._findSelectedElement();
    if (!el || el.type !== 'dynamicTable') return nothing;
    const s = this._strings.designer;
    const valOf = (e: Event) => (e.target as HTMLInputElement).value;
    const close = (): void => {
      this._columnsModalOpen = false;
      this.requestUpdate();
    };

    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-label=${s.columnsModalTitle}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}>
        <div class="modal-head">
          <span>${s.columnsModalTitle}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="col-modal-head">
            <span></span>
            <span>${s.formTitle}</span>
            <span>${s.columnKey}</span>
            <span>${s.columnWidthPct}</span>
            <span></span>
          </div>
          ${el.columns.map((col, index) => html`
            <div class="col-modal-row">
              <span class="col-order">
                <button title=${s.orderForward}
                  aria-label="${s.columns} ${index + 1} ${s.orderForward}"
                  ?disabled=${index === 0}
                  @click=${() => this._moveTableColumn(index, -1)}>${icons.up}</button>
                <button title=${s.orderBackward}
                  aria-label="${s.columns} ${index + 1} ${s.orderBackward}"
                  ?disabled=${index === el.columns.length - 1}
                  @click=${() => this._moveTableColumn(index, 1)}>${icons.down}</button>
              </span>
              <input .value=${col.title}
                aria-label="${s.columnsModalTitle} ${index + 1} ${s.formTitle}"
                @change=${(e: Event) => this._setTableColumnTitle(index, valOf(e))}>
              <input .value=${col.key}
                aria-label="${s.columnsModalTitle} ${index + 1} ${s.columnKey}"
                @change=${(e: Event) => this._setTableColumnKey(index, valOf(e))}>
              <input type="number" min="1" max="99" step="1"
                .value=${String(Math.round(col.widthPercentage * 100) / 100)}
                aria-label="${s.columnsModalTitle} ${index + 1} ${s.columnWidthPct}"
                @change=${(e: Event) => this._setTableColumnWidth(index, Number(valOf(e)))}>
              <button class="col-remove" title=${s.delete}
                aria-label="${s.columnsModalTitle} ${index + 1} ${s.delete}"
                ?disabled=${el.columns.length <= 1}
                @click=${() => this._removeTableColumn(index)}>${icons.pageRemove}</button>
            </div>`)}
          <button class="col-add" aria-label=${s.addColumn}
            @click=${() => this._addTableColumn()}>${icons.pageAdd}<span>${s.addColumn}</span></button>
        </div>
        <div class="modal-foot">
          <button class="btn primary" @click=${close}>${s.close}</button>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // 샘플 데이터 편집 (D-13)
  // ---------------------------------------------------------------------------

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
   * 샘플 데이터 편집 모달 (D-13) — 바인딩마다 시험 값을 채운다. 동적 표 바인딩은
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

    // 동적 표 바인딩 → 열 구조 (같은 바인딩을 쓰는 첫 표 기준)
    const tableOf = new Map<string, { key: string; title: string }[]>();
    for (const page of template.pages) {
      for (const el of page.elements) {
        if (el.type === 'dynamicTable' && !tableOf.has(el.binding)) {
          tableOf.set(el.binding, el.columns.map((c) => ({ key: c.key, title: c.title })));
        }
      }
    }
    const bindings = this._collectBindings();
    // 바인딩이 많으면 10개 단위 페이지로 나눠 스크롤을 짧게 유지한다
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
                    // JSON 탭에 들어올 때 현재 샘플 값을 초안으로 담는다
                    const current = this._file?.template.sampleValues;
                    this._sampleJsonDraft =
                      current && Object.keys(current).length > 0
                        ? JSON.stringify(current, null, 2)
                        : '';
                  }
                  this.requestUpdate();
                }}>${label}</button>`)}
          </div>
          ${this._sampleJsonMode
            ? html`
                <div class="cell-hint">${s.jsonHint}</div>
                <textarea class="sample-json" rows="14" spellcheck="false"
                  aria-label="${s.sampleData} JSON"
                  placeholder=${'{\n  "tradeDate": "2026-08-20",\n  "items": [{ "amount": 1000 }]\n}'}
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
                ${visible.map((b) => {
                  const columns = tableOf.get(b.key);
                  if (columns) return this._renderSampleTable(b, columns, samples[b.key]);
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

  /** 동적 표 바인딩의 샘플 행 편집 — 열 구조대로 셀 입력, 행 추가·삭제 */
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
      this.requestUpdate();
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

  /** 목록 모달 열기 — 첫 페이지를 읽어 온다 */
  private async _openMyForms(): Promise<void> {
    this._myFormsOpen = true;
    this._myFormsQuery = '';
    this.requestUpdate();
    await this._loadMyForms();
  }

  /**
   * 저장된 양식 목록을 읽는다. cursor를 주면 다음 페이지를 이어 붙이고,
   * 없으면 처음부터 다시 읽는다 (검색어 변경 등).
   */
  private async _loadMyForms(cursor?: string): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    this._myFormsError = null;
    const filter = this._myFormsQuery.trim()
      ? { kind: 'template' as const, query: this._myFormsQuery.trim() }
      : { kind: 'template' as const };
    try {
      const page = await adapter.list(filter, cursor);
      this._myFormItems = cursor ? [...this._myFormItems, ...page.items] : page.items;
      this._myFormsCursor = page.nextCursor;
    } catch (error) {
      this._myFormItems = [];
      this._myFormsCursor = undefined;
      this._myFormsError = error instanceof Error ? error.message : String(error);
    }
    this.requestUpdate();
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
    this._selectedId = null;
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
              @change=${(e: Event) => {
                this._myFormsQuery = (e.target as HTMLInputElement).value;
                void this._loadMyForms();
              }}>
          </div>
          ${this._myFormsError
            ? html`<div class="formula-status error">${this._myFormsError}</div>`
            : nothing}
          ${this._myFormItems.length === 0 && !this._myFormsError
            ? html`<div class="side-empty">${s.noSavedForms}</div>`
            : nothing}
          ${this._myFormItems.map((item) => html`
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
          ${this._myFormsCursor
            ? html`<button class="col-add" aria-label=${s.loadMore}
                @click=${() => void this._loadMyForms(this._myFormsCursor)}>
                ${icons.down}<span>${s.loadMore}</span>
              </button>`
            : nothing}
        </div>
        <div class="modal-foot">
          <button class="btn primary" @click=${close}>${s.close}</button>
        </div>
      </div>
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
