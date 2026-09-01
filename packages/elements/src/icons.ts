/**
 * 툴바와 패널에서 사용하는 아이콘 모음.
 *
 * 아이콘 저작권: Lucide Contributors, ISC 라이선스 — https://lucide.dev
 * lucide-static v1.33.0에서 추출했으며 색상은 `currentColor`를 사용합니다.
 */
import { svg, type TemplateResult } from 'lit';

function icon(body: TemplateResult): TemplateResult {
  return svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** 용도별 아이콘 목록 */
export const icons = {
  /** lucide: type */
  text: icon(svg`<path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" />`),
  /**
   * 항목 구간을 강조한 그리드 요소 아이콘.
   */
  gridElement: icon(svg`<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M12 3v18" /><rect x="3" y="9" width="18" height="6" fill="currentColor" opacity="0.25" stroke="none" />`),
  /** lucide: image */
  image: icon(svg`<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />`),
  /** lucide: square */
  shape: icon(svg`<rect width="18" height="18" x="3" y="3" rx="2" />`),
  /** lucide: slash */
  line: icon(svg`<path d="M22 2 2 22" />`),
  /** lucide: circle */
  ellipse: icon(svg`<circle cx="12" cy="12" r="10" />`),
  /** lucide: pentagon */
  polygon: icon(svg`<path d="M10.83 2.38a2 2 0 0 1 2.34 0l8 5.74a2 2 0 0 1 .73 2.25l-3.04 9.26a2 2 0 0 1-1.9 1.37H7.04a2 2 0 0 1-1.9-1.37L2.1 10.37a2 2 0 0 1 .73-2.25z" />`),
  /** lucide: text-cursor-input */
  field: icon(svg`<path d="M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6" /><path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" /><path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" /><path d="M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1" /><path d="M9 6v12" />`),
  /** lucide: undo-2 */
  undo: icon(svg`<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />`),
  /** lucide: redo-2 */
  redo: icon(svg`<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />`),
  /** lucide: copy */
  copy: icon(svg`<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`),
  /** lucide: clipboard-paste */
  paste: icon(svg`<path d="M11 14h10" /><path d="M16 4h2a2 2 0 0 1 2 2v1.344" /><path d="m17 18 4-4-4-4" /><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" /><rect x="8" y="2" width="8" height="4" rx="1" />`),
  /** lucide: trash-2 */
  remove: icon(svg`<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />`),
  /** lucide: eye */
  preview: icon(svg`<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />`),
  /** lucide: pencil */
  edit: icon(svg`<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />`),
  /** lucide: file */
  page: icon(svg`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />`),
  /** lucide: chevron-left */
  pagePrev: icon(svg`<path d="m15 18-6-6 6-6" />`),
  /** lucide: chevron-right */
  pageNext: icon(svg`<path d="m9 18 6-6-6-6" />`),
  /** 파라미터 타입: 글자 — 대문자 T와 밑줄 */
  typeText: icon(svg`<path d="M5 6V5h14v1" /><path d="M12 5v14" /><path d="M9 19h6" />`),
  /** 숫자 파라미터를 나타내는 # 기호. */
  typeNumber: icon(svg`<path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="M16 3l-2 18" />`),
  /** 파라미터 타입: 날짜 — 달력 */
  typeDate: icon(svg`<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" />`),
  /** 파라미터 타입: 참/거짓 — 체크 상자 */
  typeBoolean: icon(svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l3 3 5-6" />`),
  /** 파라미터 타입: 이미지 — 산과 해 */
  typeImage: icon(svg`<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m21 16-5-5L5 20" />`),
  /** 파라미터 타입: 목록 — 글머리 목록 */
  typeList: icon(svg`<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />`),
  /** 항목 더하기 — 목록·패널 공용 더하기 표시 */
  add: icon(svg`<path d="M5 12h14" /><path d="M12 5v14" />`),
  /** lucide: plus */
  pageAdd: icon(svg`<path d="M5 12h14" /><path d="M12 5v14" />`),
  /** lucide: minus */
  pageRemove: icon(svg`<path d="M5 12h14" />`),
  /** lucide: layout-template */
  preset: icon(svg`<rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" />`),
  /** lucide: save */
  save: icon(svg`<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" />`),
  /** lucide: folder-open */
  folderOpen: icon(svg`<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />`),
  /** lucide: database */
  database: icon(svg`<ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />`),
  /** lucide: sigma */
  formula: icon(svg`<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2" />`),
  /** lucide: x */
  close: icon(svg`<path d="M18 6 6 18" /><path d="m6 6 12 12" />`),
  /** lucide: chevron-up */
  up: icon(svg`<path d="m18 15-6-6-6 6" />`),
  /** lucide: chevron-down */
  down: icon(svg`<path d="m6 9 6 6 6-6" />`),
  /** lucide: bold */
  bold: icon(svg`<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />`),
  /** lucide: underline */
  italic: icon(svg`<line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" />`),
  underline: icon(svg`<path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="4" x2="20" y1="20" y2="20" />`),
  /** lucide: strikethrough */
  strikethrough: icon(svg`<path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" x2="20" y1="12" y2="12" />`),
  /** lucide: align-left */
  alignLeft: icon(svg`<path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" />`),
  /** lucide: align-center */
  alignCenter: icon(svg`<path d="M21 5H3" /><path d="M17 12H7" /><path d="M19 19H5" />`),
  /** lucide: align-right */
  alignRight: icon(svg`<path d="M21 5H3" /><path d="M21 12H9" /><path d="M21 19H7" />`),
  /** 캔버스 격자 */
  grid: icon(svg`<rect width="18" height="18" x="3" y="3" rx="1" /><path d="M9 3v18" /><path d="M15 3v18" /><path d="M3 9h18" /><path d="M3 15h18" />`),
  /** 모든 열을 같은 너비로 맞추기 */
  evenWidths: icon(svg`<rect width="18" height="14" x="3" y="5" rx="1" /><path d="M9 5v14" /><path d="M15 5v14" />`),
  /** 요소 종류 표시 전환 */
  badges: icon(svg`<path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h4.7a2 2 0 0 1 1.42.59l7.79 7.8a2 2 0 0 1 0 2.82l-4.7 4.7a2 2 0 0 1-2.83 0l-7.79-7.8a2 2 0 0 1-.59-1.41z" /><circle cx="7.5" cy="7.5" r="1.2" />`),
  /** 세로 정렬 위 — 위 변에 붙은 막대 */
  alignTop: icon(svg`<rect x="7" y="9" width="10" height="11" rx="1" /><path d="M4 4h16" />`),
  /** 세로 정렬 가운데 */
  alignMiddle: icon(svg`<rect x="7" y="7" width="10" height="10" rx="1" /><path d="M4 12h16" />`),
  /** 세로 정렬 아래 */
  alignBottom: icon(svg`<rect x="7" y="4" width="10" height="11" rx="1" /><path d="M4 20h16" />`),
  /** 바코드 요소 — 굵기가 다른 막대 줄 */
  barcode: icon(svg`<path d="M4 5v14" /><path d="M8 5v14" /><path d="M12 5v14" /><path d="M17 5v14" /><path d="M21 5v14" />`),
  /** 접힌 목록을 나타내는 오른쪽 꺾쇠. */
  treeClosed: icon(svg`<path d="m9 18 6-6-6-6" />`),
  /** 펼친 목록을 나타내는 아래쪽 꺾쇠. */
  treeOpen: icon(svg`<path d="m6 9 6 6 6-6" />`),
};
