/**
 * 툴바·패널 아이콘 — Lucide 아이콘 세트에서 필요한 것만 내장 (ADR-031).
 *
 * 아이콘 저작권: Lucide Contributors, ISC 라이선스 — https://lucide.dev
 * (lucide-static v1.33.0에서 추출. 색은 currentColor로 버튼 글자색을 따라간다)
 */
import { svg, type TemplateResult } from 'lit';

function icon(body: TemplateResult): TemplateResult {
  return svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** 아이콘 목록 — 키 = 용도 */
export const icons = {
  /** lucide: type */
  text: icon(svg`<path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" />`),
  /** lucide: grid-3x3 */
  fixedGrid: icon(svg`<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" />`),
  /** lucide: table */
  dynamicTable: icon(svg`<path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />`),
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
  /** lucide: chevron-left */
  pagePrev: icon(svg`<path d="m15 18-6-6 6-6" />`),
  /** lucide: chevron-right */
  pageNext: icon(svg`<path d="m9 18 6-6-6-6" />`),
  /** lucide: plus */
  pageAdd: icon(svg`<path d="M5 12h14" /><path d="M12 5v14" />`),
  /** lucide: minus */
  pageRemove: icon(svg`<path d="M5 12h14" />`),
  /** lucide: layout-template */
  preset: icon(svg`<rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" />`),
  /** lucide: bold */
  bold: icon(svg`<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />`),
  /** lucide: underline */
  underline: icon(svg`<path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="4" x2="20" y1="20" y2="20" />`),
  /** lucide: strikethrough */
  strikethrough: icon(svg`<path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" x2="20" y1="12" y2="12" />`),
  /** lucide: align-left */
  alignLeft: icon(svg`<path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" />`),
  /** lucide: align-center */
  alignCenter: icon(svg`<path d="M21 5H3" /><path d="M17 12H7" /><path d="M19 19H5" />`),
  /** lucide: align-right */
  alignRight: icon(svg`<path d="M21 5H3" /><path d="M21 12H9" /><path d="M21 19H7" />`),
};
