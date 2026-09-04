/**
 * 상단 툴바 — 요소 생성, 편집 명령, 격자·프리셋 메뉴와 저장.
 */

import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { icons } from '../../icons.js';
import { GRID_GAPS, GRID_COLORS, type GridColorId } from '../grid-view.js';
import type { CreatableType } from '../grid-view.js';
import type { SlipPreset } from '../../presets.js';
import type { DesignerStrings } from '../../strings.js';

/** 툴바가 컴포넌트에 요청하는 조작과 상태 */
export interface ToolbarActions {
  readonly s: DesignerStrings;
  /** 선택한 생성 도구 */
  readonly pendingTool: CreatableType | null;
  /** 미리보기 모드인지 */
  readonly previewMode: boolean;
  /** 주 선택 요소 */
  readonly selectedId: string | null;
  /** 붙여넣을 것이 있는지 */
  readonly hasClipboard: boolean;
  /** 되돌릴 수 있는 단계 수 */
  readonly undoDepth: number;
  /** 다시 실행할 수 있는 단계 수 */
  readonly redoDepth: number;
  /** 보고 있는 양식 페이지 (0부터) */
  readonly pageIndex: number;
  /** 요소 종류 배지를 표시할지 */
  readonly showBadges: boolean;
  /** 요소 종류 배지 표시를 바꿉니다 */
  setShowBadges(on: boolean): void;
  /** 격자선 색을 바꾸고 메뉴를 닫습니다 */
  setGridColor(color: GridColorId): void;
  /**
   * 열려 있는 툴바 메뉴를 모두 닫습니다.
   *
   * @param restoreFocus - 메뉴를 연 버튼으로 초점을 되돌리면 true (키보드로 닫을 때)
   */
  closeMenus(restoreFocus?: boolean): void;
  /** 격자 간격(mm). null이면 격자 없음 */
  readonly gridGap: number | null;
  /** 격자선 색 */
  readonly gridColor: GridColorId;
  readonly gridMenuOpen: boolean;
  readonly gridMenuPos: { left: number; top: number };
  readonly presetMenuOpen: boolean;
  readonly presetMenuPos: { left: number; top: number };
  readonly shapeMenuOpen: boolean;
  readonly shapeMenuPos: { left: number; top: number };
  /** 저장 완료 안내를 표시할지 */
  readonly savedNotice: boolean;
  /** 저장소가 붙어 있는지 */
  readonly hasStorage: boolean;
  pageCount(): number;
  presets(): SlipPreset[];
  selectTool(type: CreatableType): void;
  selectShapeTool(type: 'rect' | 'ellipse' | 'polygon', sides?: number): void;
  toggleShapeMenu(event: Event): void;
  togglePresetMenu(event: Event): void;
  toggleGridMenu(event: Event): void;
  setGridGap(gap: number | null): void;
  applyPreset(index: number): void;
  copySelected(): void;
  paste(): void;
  undo(): void;
  redo(): void;
  addPage(): void;
  deletePage(): void;
  togglePreview(): void;
  openSaveModal(): void;
  openMyForms(): void;
  /** 화면을 다시 그립니다 */
  refresh(): void;
}

/**
 * 요소 추가, 편집 명령, 화면 배율과 저장·미리보기를 제공하는 위쪽 툴바를 렌더링합니다.
 *
 * @param bar - 툴바 동작과 표시 상태
 * @returns 툴바 조각
 */
export function toolbar(bar: ToolbarActions) {
  const s = bar.s;
  return html`
    <div class="tool-group">
      ${([
        ['text', s.addText, icons.text],
        ['grid', s.addGrid, icons.gridElement],
        ['image', s.addImage, icons.image],
        ['line', s.shapeLine, icons.line],
      ] as const).map(([type, label, glyph]) =>
        iconButton(label, glyph, () => bar.selectTool(type), {
          pressed: bar.pendingTool === type,
          disabled: bar.previewMode,
        }),
      )}
      ${iconButton(s.shape, icons.shape, (e) => bar.toggleShapeMenu(e), {
        pressed:
          bar.shapeMenuOpen ||
          bar.pendingTool === 'rect' ||
          bar.pendingTool === 'ellipse' ||
          bar.pendingTool === 'polygon',
        disabled: bar.previewMode,
      })}
      ${iconButton(s.addField, icons.field, () => bar.selectTool('field'), {
        pressed: bar.pendingTool === 'field',
        disabled: bar.previewMode,
      })}
      ${iconButton(s.addBarcode, icons.barcode, () => bar.selectTool('barcode'), {
        pressed: bar.pendingTool === 'barcode',
        disabled: bar.previewMode,
      })}
    </div>
    <div class="tool-group">
      ${iconButton(s.copy, icons.copy, () => bar.copySelected(), { disabled: !bar.selectedId || bar.previewMode })}
      ${iconButton(s.paste, icons.paste, () => bar.paste(), { disabled: !bar.hasClipboard || bar.previewMode })}
      ${iconButton(s.undo, icons.undo, () => bar.undo(), { disabled: bar.undoDepth === 0 || bar.previewMode })}
      ${iconButton(s.redo, icons.redo, () => bar.redo(), { disabled: bar.redoDepth === 0 || bar.previewMode })}
    </div>
    <div class="tool-group">
      <span class="page-indicator">${bar.pageIndex + 1} / ${bar.pageCount()}</span>
      ${iconButton(s.addPage, icons.pageAdd, () => bar.addPage(), { disabled: bar.previewMode })}
      ${iconButton(s.deletePage, icons.pageRemove, () => bar.deletePage(), { disabled: bar.pageCount() <= 1 || bar.previewMode })}
    </div>
    <div class="tool-group">
      ${iconButton(
        bar.previewMode ? s.edit : s.preview,
        bar.previewMode ? icons.edit : icons.preview,
        () => bar.togglePreview(),
        { pressed: bar.previewMode },
      )}
      ${iconButton(s.showBadges, icons.badges, () => bar.setShowBadges(!bar.showBadges),
        { pressed: bar.showBadges, disabled: bar.previewMode })}
      ${iconButton(s.grid, icons.grid, (e) => bar.toggleGridMenu(e), {
        pressed: bar.gridMenuOpen || bar.gridGap !== null,
        disabled: bar.previewMode,
      })}
    </div>
    <div class="tool-group">
      ${iconButton(s.preset, icons.preset, (e) => bar.togglePresetMenu(e), {
        pressed: bar.presetMenuOpen,
        disabled: bar.previewMode,
      })}
    </div>
    ${bar.hasStorage
      ? html`
          <div class="tool-group">
            ${iconButton(s.saveAsMyForm, icons.save, () => bar.openSaveModal())}
            ${iconButton(s.myFormsList, icons.folderOpen, () => void bar.openMyForms())}
          </div>
          ${bar.savedNotice
            ? html`<span class="saved-notice">${s.savedNotice}</span>`
            : nothing}`
      : nothing}
    ${bar.presetMenuOpen
      ? html`
          <div class="menu-backdrop" @click=${() => bar.closeMenus()}></div>
          <div class="preset-menu" role="menu" aria-label=${s.preset}
               style="left:${bar.presetMenuPos.left}px;top:${bar.presetMenuPos.top}px"
               @keydown=${(e: KeyboardEvent) => menuKeydown(e, () => bar.closeMenus(true))}>
            ${bar.presets().map((p, index) => html`
              <button role="menuitem" @click=${() => bar.applyPreset(index)}>${p.name}</button>`)}
          </div>`
      : nothing}
    ${bar.shapeMenuOpen
      ? html`
          <div class="menu-backdrop" @click=${() => bar.closeMenus()}></div>
          <div class="preset-menu" role="menu" aria-label=${s.shape}
               style="left:${bar.shapeMenuPos.left}px;top:${bar.shapeMenuPos.top}px"
               @keydown=${(e: KeyboardEvent) => menuKeydown(e, () => bar.closeMenus(true))}>
            ${([
              [s.shapeRect, 'rect', 3],
              [s.shapeEllipse, 'ellipse', 3],
              [s.shapeTriangle, 'polygon', 3],
              [s.shapePentagon, 'polygon', 5],
              [s.shapeHexagon, 'polygon', 6],
            ] as const).map(([label, type, sides]) => html`
              <button role="menuitem" @click=${() => bar.selectShapeTool(type, sides)}>
                ${label}
              </button>`)}
          </div>`
      : nothing}
    ${bar.gridMenuOpen
      ? html`
          <div class="menu-backdrop" @click=${() => bar.closeMenus()}></div>
          <div class="preset-menu" role="menu" aria-label=${s.gridGap}
               style="left:${bar.gridMenuPos.left}px;top:${bar.gridMenuPos.top}px"
               @keydown=${(e: KeyboardEvent) => menuKeydown(e, () => bar.closeMenus(true))}>
            <button role="menuitem" aria-pressed=${String(bar.gridGap === null)}
              @click=${() => bar.setGridGap(null)}>${s.gridNone}</button>
            ${GRID_GAPS.map((gap) => html`
              <button role="menuitem" aria-pressed=${String(bar.gridGap === gap)}
                @click=${() => bar.setGridGap(gap)}>${gap}mm</button>`)}
            ${bar.gridGap !== null
              ? html`<div class="grid-colors" role="group" aria-label=${s.gridColor}>
                  ${GRID_COLORS.map((color) => html`
                    <button style="background:${color.swatch}"
                      title=${s[color.nameKey]}
                      aria-label="${s.gridColor}: ${s[color.nameKey]}"
                      aria-pressed=${String(bar.gridColor === color.id)}
                      @click=${() => {
                        bar.setGridColor(color.id);
                        bar.refresh();
                      }}></button>`)}
                </div>`
              : nothing}
          </div>`
      : nothing}
  `;
}

/**
 * 툴바 메뉴 안의 키보드 조작 — 방향키·Home·End로 항목을 옮기고 Escape로 닫습니다.
 *
 * @remarks
 * 처리한 키는 문서 단축키로 올라가지 않도록 전파를 멈춥니다.
 *
 * @param event - 메뉴 요소에서 받은 키보드 이벤트
 * @param close - Escape를 눌렀을 때 실행할 닫기 처리
 */
export function menuKeydown(event: KeyboardEvent, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  const menu = event.currentTarget as HTMLElement;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  if (items.length === 0) return;
  const root = menu.getRootNode() as Document | ShadowRoot;
  const current = items.indexOf(root.activeElement as HTMLButtonElement);
  let next = -1;
  if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  if (next < 0) return;
  event.preventDefault();
  event.stopPropagation();
  items[next]?.focus();
}

/**
 * 아이콘, 표시 이름, 접근성 레이블로 툴바 버튼을 만듭니다.
 *
 * @param label - 표시 이름이자 접근성 레이블
 * @param glyph - 버튼에 넣을 아이콘
 * @param onClick - 누를 때 실행할 함수
 * @param opts - 비활성 여부와 눌림 상태
 * @returns 툴바 버튼
 */
export function iconButton(
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
