import { LitElement, html, nothing, svg, type TemplateResult } from 'lit';
import { designerStyles, RULER_PX } from './styles/slip-designer.styles.js';
import { live } from 'lit/directives/live.js';
import {
  parseSlipFile,
  parseFormula,
  evaluateFormula,
  resolveConditionalFormats,
  stackVertically,
  elementBounds,
  planSourcePage,
  filterVisibleOnPage,
  SlipLayoutError,
  SLIP_LIMITS,
  type ConditionalFormatOverrides,
  type ConditionalFormatRule,
  type FormulaContext,
  type FormulaValue,
  type GridFragment,
  type GridItem,
  type SourcePagePlan,
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
  type GridBand,
  type GridBandPlacement,
  type OutputPageFilter,
  type PageNumberPosition,
  type BarcodeKind,
  type ParameterValueType,
  type SlipPage,
  type SlipKit,
  type SlipListItem,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { getFormulaHelp } from './formula-help.js';
import { renderSlip, resolveFonts, type SlipDesignerSettings, type PaperSize } from './settings.js';
import { getPresets, type SlipPreset } from './presets.js';
import { icons } from './icons.js';
import { pickImageFile, formatBytes } from './image-file.js';
import {
  COLOR_PALETTE,
  loadCustomColors,
  saveCustomColor,
  hexToHsv,
  hsvToHex,
} from './designer/color.js';
import {
  PX_PER_MM,
  MIN_SIZE_MM,
  ANCHORS,
  RESIZE_HANDLES,
  round1,
  lineLengthAngle,
  lineBoxFromLengthAngle,
  polygonPointsPx,
  lineEndpoints,
  boxOf,
  setElementBox,
  trackOffsets,
  THUMB_WIDTH_PX,
  snapCandidates,
  bestSnap,
} from './designer/geometry.js';
import type { ResizeHandle, SnapCandidates } from './designer/geometry.js';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_COLOR,
  DEFAULT_BORDER_COLOR,
  DEFAULT_LINE_WIDTH,
  fontPx,
  justifyOf,
  verticalFlexAlign,
  dashArrayOf,
  textStyleCss,
} from './designer/style-css.js';
import { setOptional, clearValueSources } from './designer/patch.js';
import { ModalFocusController } from './designer/controllers/modal-focus.js';
import { DialogsController } from './designer/controllers/dialogs.js';
import { FormulaDraftController } from './designer/controllers/formula-draft.js';
import { SampleDraftController } from './designer/controllers/sample-draft.js';
import { FormsController } from './designer/controllers/forms-storage.js';
import { GridEditController } from './designer/controllers/grid-edit.js';
import {
  PopoverController,
  placeBelow,
  placeBelowOrAbove,
  listSelectStyle,
  propertyMenuStyle,
} from './designer/controllers/popover.js';
import { ColorPickerController } from './designer/controllers/color-picker.js';
import {
  numberRow,
  twisty,
  textStyleToggles,
  borderWidthSelect,
  borderShapeRow,
  colorControl,
  conditionalEmphasisRow,
} from './designer/render/inputs.js';
import {
  textProps,
  textFieldKindRow,
  fontNameRow,
  fontProps,
  imageProps,
  lineProps,
  polygonProps,
  gridOverflowRow,
  anchorRow,
  sizeRows,
  fieldProps,
  barcodeProps,
  pagePlacementSection,
  styleGroups,
  groupPanel,
} from './designer/render/element-props.js';
import type { ElementActions } from './designer/render/element-props.js';
import { PAPER_PRESETS } from './designer/paper.js';
import { BARCODE_KINDS, BARCODE_2D, BARCODE_DIGIT_RULES } from './designer/barcode.js';
import { GRID_GAPS, GRID_COLORS } from './designer/grid-view.js';
import type { GridColorId, CreatableType } from './designer/grid-view.js';
import { BINDING_VALUE_TYPES, BINDING_FIELD_VALUE_TYPES } from './designer/parameters.js';
import type { ParameterUse, ParameterInfo, ParameterFieldInfo } from './designer/parameters.js';
import { valueTypeBadge, TYPE_BADGE } from './designer/render/badges.js';
import {
  pageSettings,
  formSettings,
  parameterPanel,
  parameterFieldPanel,
} from './designer/render/form-props.js';
import type { FormActions } from './designer/render/form-props.js';
import { canvas, repeatSampleItems } from './designer/render/canvas.js';
import { CanvasPointerController } from './designer/controllers/canvas-pointer.js';
import type { PointerHost } from './designer/controllers/canvas-pointer.js';
import { toolbar } from './designer/render/toolbar.js';
import type { ToolbarActions } from './designer/render/toolbar.js';
import type { CanvasContext } from './designer/render/canvas.js';
import { propertyPanel } from './designer/render/property-panel.js';
import type { PanelContext } from './designer/render/property-panel.js';
import { sidebar } from './designer/render/sidebar.js';
import type { SidebarActions, SideSelection } from './designer/render/sidebar.js';
import { conditionalFormatsSection } from './designer/render/conditional-formats.js';
import { gridProps } from './designer/render/grid-props.js';
import type { GridActions } from './designer/render/grid-props.js';
import type { ConditionalFormatDeps } from './designer/render/conditional-formats.js';
import type { PanelKit } from './designer/render/panel-kit.js';
import { imagePickErrorText, usedImages, imageParameterKeys, PLACEHOLDER_IMG } from './designer/image-pick.js';
import type { ImagePickFailure } from './designer/image-pick.js';
import {
  GRID_DEFAULT_ROW_MM,
  GRID_DEFAULT_COL_MM,
  GRID_MAX_TRACKS_UI,
  GRID_MAX_ITEMS_UI,
  GRID_MAX_PER_PAGE_UI,
  isGrid,
  gridDims,
  columnWidths,
  ensureCell,
  clampGridSpans,
  gridHeaderTitle,
  BAND_PLACEMENT_ORDER,
  BAND_PLACEMENTS,
  itemBandOf,
  inItemBand,
  bandAt,
  assignBandRole,
  resizeBandRange,
  spanCrossesBand,
  canRemoveLastRow,
  changeRowCount,
  changeColumnCount,
  insertPositionFor,
  insertGridRow,
} from './designer/grid-model.js';
import type { GridRowCommand } from './designer/grid-model.js';


/** 파라미터 키와 충돌하지 않는 "새 값 등록" 항목의 내부 값 */
const NEW_BINDING_OPTION = '\u0000new';






const MAX_UNDO = 50;
/**
 * 파라미터 값 종류 선택지.
 * 종류를 지정하지 않은 값은 텍스트로 처리한다.
 */




/** 샘플 데이터 모달의 페이지당 파라미터 수 */
const SAMPLE_PAGE_SIZE = 10;










/**
 * 업로드할 수 있는 이미지 파일의 기본 최대 크기(바이트).
 * base64로 담기면 약 33% 커지므로 2MB 원본이 파일에는 ~2.7MB로 들어간다.
 */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
















/** 새 요소의 기본 위치를 순차 이동할 간격과 반복 주기(mm) */
const NEW_ELEMENT_CASCADE_STEP_MM = 5;
const NEW_ELEMENT_CASCADE_WRAP_MM = 50;
/** "내 양식" 목록의 페이지당 항목 수 */
const MY_FORMS_PAGE_SIZE = 10;































/** 사이드바에서 선택한 페이지와 파라미터를 나타낸다. */

/**
 * `.slip` 양식을 편집하는 `<slip-designer>` 컴포넌트.
 *
 * 캔버스 편집, 속성 패널, 요소 추가와 삭제,
 * 복사·붙여넣기, 되돌리기·다시 실행, 다중 페이지, 프리셋 불러오기, PDF 미리보기를
 * 제공한다. 편집으로 양식이 바뀔 때마다 `slip-change` 이벤트로 파일을 내보낸다.
 */
export class SlipDesigner extends LitElement {
  static styles = designerStyles;

  static properties = {
    src: { type: String },
    locale: { type: String },
    slipkit: { attribute: false },
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
    _presetMenuOpen: { state: true },
    _shapeMenuOpen: { state: true },
    _thumbPage: { state: true },
    _thumbPos: { state: true },
    _imageError: { state: true },
    maxImageBytes: { type: Number, attribute: 'max-image-bytes' },
    _sideSelection: { state: true },
    _expandedParameters: { state: true },
    _expandedElements: { state: true },
    _parameterKeyError: { state: true },
    _pageKeyError: { state: true },
    presets: { attribute: false },
    storage: { attribute: false },
    _outputPage: { state: true },
    _gridPlanPreview: { state: true },
  };

  src = '';

  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string;

  /**
   * 폰트·로케일·암호화 키 공통 설정 인스턴스.
   * PDF 미리보기와 수식 평가는 이 인스턴스의 설정을 사용한다.
   * `getFonts`가 없으면 동봉 기본 폰트로 렌더링한다.
   */
  slipkit?: SlipKit;

  /**
   * 바코드 종류와 용지 정보를 제공하는 호스트 설정.
   * 생략하면 기본 용지만 표시한다.
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
  /** 현재 양식 페이지에서 보고 있는 출력 페이지 (0부터) */
  private _outputPage = 0;
  /** 선택한 반복 그리드를 원본 행 구조 대신 현재 출력 결과로 표시할지 여부 */
  private _gridPlanPreview = false;
  /** 현재 양식 페이지의 계획 캐시 — 페이지·샘플 값이 바뀌면 다시 계산한다 */
  private _planCache: { key: string; plan: SourcePagePlan | null; error: SlipLayoutError | null } | null = null;
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
  private _clipboard: SlipElement[] | null = null;
  private _previewGeneration = 0;
  private _presetMenuOpen = false;
  private _presetMenuPos = { left: 0, top: 0 };
  /** 도형 선택 메뉴의 열림 상태 */
  private _shapeMenuOpen = false;
  private _shapeMenuPos = { left: 0, top: 0 };
  /** 수식 모달의 편집 중 값 */
  /**
   * 사이드바에서 미리보기를 표시 중인 페이지 번호.
   */
  private _thumbPage: number | null = null;
  /** 페이지 미리보기의 화면 기준 좌표 */
  private _thumbPos: { top: number; left: number } | null = null;
  /** 이미지 선택 실패 사유 */
  private _imageError: string | null = null;
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
  /**
   * 모달을 열 때 조회한 양식 메타데이터 목록.
   * 검색과 페이지 이동은 이 목록을 기준으로 처리한다.
   */
    /**
   * 요소 ID별 좌표 기준점의 ANCHORS 인덱스.
   * 파일에는 저장하지 않으며 기본값은 왼쪽 위다.
   */
  private _anchorByElement = new Map<string, number>();
  /**
   * 그리드 셀에서 편집 중인 값 소스 종류.
   */

  /** 컴포넌트 속성이 우선하고, 없으면 slipkit 설정을 따르는 UI 언어 로케일 */
  private get _locale(): string | undefined {
    return this.locale ?? this.slipkit?.locale;
  }

  /** 수식·조건식 평가에 사용할 로케일 — slipkit이 있으면 인스턴스 설정을 따른다 */
  private get _evalLocale(): string | undefined {
    return this.slipkit ? this.slipkit.locale : this.locale;
  }

  /** 현재 locale의 문구 사전 */
  private get _strings() {
    return getStrings(this._locale);
  }

  /**
   * 수식을 평가한다. slipkit이 있으면 같은 인스턴스로 평가해 호스트의 렌더 결과와 맞춘다.
   * 수식 로케일은 인스턴스 설정을 따른다 — 컴포넌트 locale은 UI 언어 전용이다.
   */
  private _evaluate(source: string, context: FormulaContext): FormulaValue {
    if (this.slipkit) return this.slipkit.evaluate(source, context);
    const locale = this._evalLocale;
    return evaluateFormula(source, locale === undefined ? context : { ...context, locale });
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
    }
    // 폰트 목록은 slipkit의 공급 함수 또는 로케일별 동봉 기본 폰트에서 나온다.
    if (changed.has('slipkit') || changed.has('locale')) {
      void this._loadFontNames();
    }
  }

  /** 열려 있는 모달 */
  private readonly _dialogs = new DialogsController(this);


  /** 속성 패널 렌더 모듈에 넘길 공통 입력 도구 */
  private get _kit(): PanelKit {
    return {
      s: this._strings.designer,
      reject: (message, field) => this._rejectInput(message, field),
      error: (field) => this._renderInputError(field),
      hasError: (field) => this._hasInputError(field),
      listSelect: (config) => this._listSelect(config),
      popovers: this._popovers,
      picker: this._picker,
      togglePropertyMenu: (key, event) => this._togglePropertyMenu(key, event),
      applyElementColor: (key, value) => this._applyColor(key, value),
    };
  }


  /** 요소 속성 줄이 요청하는 조작 */
  private get _actions(): ElementActions {
    return {
      update: (fn) => this._updateElement(fn),
      convertTextField: (to) => this._convertTextField(to),
      openImageModal: () => this._openImageModal(),
      setImageVariable: (variable) => this._setImageVariable(variable),
      imageParameterSelect: (current) => this._renderImageParameterSelect(current),
      applyLineLengthAngle: (length, angle) => this._applyLineLengthAngle(length, angle),
      anchorIndex: (el) => this._anchorByElement.get(el.id) ?? (el.type === 'line' ? 3 : 0),
      setAnchorIndex: (elementId, index) => {
        this._anchorByElement.set(elementId, index);
        this.requestUpdate();
      },
      fontNames: this._fontNames,
      openFormulaModal: () => this._openFormulaModal(),
      setFieldSource: (kind) => this._setFieldSource(kind),
      parameterSelect: (current) => this._renderParameterSelect(current),
      barcodeParameterSelect: (current) => this._renderBarcodeParameterSelect(current),
      barcodeKinds: () => this._barcodeKinds(),
      barcodeContentWarning: (kind, content) => this._barcodeContentWarning(kind, content),
      chooseBarcodeSource: (kind) => this._chooseBarcodeSource(kind),
      setBarcodeSource: (kind, value) => this._setBarcodeSource(kind, value),
      pageElements: () => this._currentElements(),
      findElement: (id) => this._findElement(id),
      groupSelected: () => this._groupSelected(),
      ungroupSelected: () => this._ungroupSelected(),
      selectedIds: this._selectedIds,
    };
  }

  /** 조건부 서식 편집이 쓰는 평가와 갱신 */
  private get _conditionalDeps(): ConditionalFormatDeps {
    return {
      evaluate: (source, context) => this._evaluate(source, context),
      probeValues: () => this._formulaProbeValues(),
      refresh: () => this.requestUpdate(),
    };
  }








  /** 캔버스 포인터 조작 */
  private readonly _pointer = new CanvasPointerController(this._pointerHost());


  /** 포인터 조작이 문서에 요청하는 것 */
  private _pointerHost(): PointerHost {
    const owner = this;
    return {
    get file() { return owner._file; },
    get selectedId() { return owner._selectedId; },
    get selectedIds() { return owner._selectedIds; },
    get sideSelection() { return owner._sideSelection; },
    get gridEdit() { return owner._gridEdit; },
    get gridPlanPreview() { return owner._gridPlanPreview; },
    get shapeMenuOpen() { return owner._shapeMenuOpen; },
    get renderRoot() { return owner.renderRoot; },
    restoreSnapshot: (snapshot) => { owner._file = JSON.parse(snapshot) as SlipTemplateFile; },
    closeShapeMenu: () => { owner._shapeMenuOpen = false; },
    clearSideSelection: () => { owner._sideSelection = null; },
    pageElements: () => owner._currentElements(),
    findElement: (id) => owner._findElement(id),
    selectedElement: () => owner._findSelectedElement(),
    addElement: (type, place) => { owner._addElement(type, place); },
    selectElement: (id) => owner._selectElement(id),
    clearSelection: () => owner._clearSelection(),
    updateElement: (fn) => owner._updateElement(fn),
    pushUndoSnapshot: (snapshot) => owner._pushUndoSnapshot(snapshot),
    emitChange: () => owner._emitChange(),
    expandParameterOfElement: (id) => owner._expandParameterOfElement(id),
    gridDelta: (value) => owner._gridDelta(value),
    focusHost: () => owner._focusHost(),
    refresh: () => owner.requestUpdate(),
  };
  }

  /** 툴바가 쓰는 상태와 조작 */
  private get _toolbarActions(): ToolbarActions {
    return {
      s: this._strings.designer,
      pendingTool: this._pointer.pendingTool,
      previewMode: this._previewMode,
      selectedId: this._selectedId,
      hasClipboard: this._clipboard !== null,
      undoDepth: this._undoStack.length,
      redoDepth: this._redoStack.length,
      pageIndex: this._pageIndex,
      showBadges: this._showBadges,
      setShowBadges: (on) => { this._showBadges = on; this.requestUpdate(); },
      setGridColor: (color) => {
        this._gridColor = color;
        this._gridMenuOpen = false;
        this.requestUpdate();
      },
      closeMenus: () => {
        this._presetMenuOpen = false;
        this._shapeMenuOpen = false;
        this._gridMenuOpen = false;
        this.requestUpdate();
      },
      gridGap: this._gridGap,
      gridColor: this._gridColor,
      gridMenuOpen: this._gridMenuOpen,
      gridMenuPos: this._gridMenuPos,
      presetMenuOpen: this._presetMenuOpen,
      presetMenuPos: this._presetMenuPos,
      shapeMenuOpen: this._shapeMenuOpen,
      shapeMenuPos: this._shapeMenuPos,
      savedNotice: this._forms.savedNotice,
      hasStorage: this.storage !== undefined,
      pageCount: () => this._pageCount(),
      presets: () => this._presetList(),
      selectTool: (type) => this._pointer.selectTool(type),
      selectShapeTool: (type, sides) => this._pointer.selectShapeTool(type, sides),
      toggleShapeMenu: (event) => this._toggleShapeMenu(event),
      togglePresetMenu: (event) => this._togglePresetMenu(event),
      toggleGridMenu: (event) => this._toggleGridMenu(event),
      setGridGap: (gap) => this._setGridGap(gap),
      applyPreset: (index) => this._applyPreset(index),
      copySelected: () => this._copySelected(),
      paste: () => this._paste(),
      undo: () => this._undo(),
      redo: () => this._redo(),
      addPage: () => this._addPage(),
      deletePage: () => this._deletePage(),
      togglePreview: () => void this._togglePreview(),
      openSaveModal: () => this._openSaveModal(),
      openMyForms: () => void this._openMyForms(),
      refresh: () => this.requestUpdate(),
    };
  }

  /** 캔버스가 쓰는 상태와 조작 */
  private get _canvasContext(): CanvasContext {
    return {
      s: this._strings.designer,
      evalLocale: this._evalLocale,
      file: this._file,
      pageIndex: this._pageIndex,
      outputPage: this._outputPage,
      gridPlanPreview: this._gridPlanPreview,
      selectedId: this._selectedId,
      selectedIds: this._selectedIds,
      gridEdit: this._gridEdit,
      gridGap: this._gridGap,
      cursorMm: this._pointer.cursorMm,
      guideX: this._pointer.guideX,
      guideY: this._pointer.guideY,
      drawRect: this._pointer.drawRect,
      draw: this._pointer.draw,
      lineDraft: this._pointer.lineDraft,
      lineGhost: this._pointer.lineGhost,
      gridLine: () => this._gridLine(),
      pagePlan: () => this._pagePlan(),
      planError: () => this._planError(),
      focusPlanError: (error) => this._focusPlanError(error),
      setGridPlanPreview: (enabled) => this._setGridPlanPreview(enabled),
      trackCursor: (event) => this._pointer.trackCursor(event),
      clearCursor: () => this._pointer.clearCursor(),
      setOutputPage: (page) => {
        this._outputPage = page;
        this.requestUpdate();
      },
      selectedElement: () => this._findSelectedElement(),
      commitCellContent: (value) => this._commitCellContent(value),
      evaluate: (source, context) => this._evaluate(source, context),
      bandLabel: (placement) => this._bandPlacementLabel(placement),
      bandDescription: (placement) => this._bandPlacementDescription(placement),
      bandIcon: (placement) => this._bandPlacementIcon(placement),
      onBandRowClick: (row, extend) => this._onBandRowClick(row, extend),
      closeBandMenu: (clearSelection) => this._closeBandMenu(clearSelection),
      onBandMenuKeyDown: (event) => this._onBandMenuKeyDown(event),
      setRowBandRole: (fromRow, toRow, placement) => this._setRowBandRole(fromRow, toRow, placement),
      refresh: () => this.requestUpdate(),
    };
  }

  /** 속성 패널이 쓰는 조작 묶음 */
  private get _panelContext(): PanelContext {
    return {
      kit: this._kit,
      element: this._actions,
      form: this._formActions,
      grid: this._gridActions,
      conditional: this._conditionalDeps,
      selection: this._sideSelection,
      selectedIds: this._selectedIds,
      selectedElement: () => this._findSelectedElement(),
      typeName: (type) => this._typeName(type),
    };
  }

  /** 사이드바가 요청하는 조작 */
  private get _sidebarActions(): SidebarActions {
    return {
      file: this._file,
      pageIndex: this._pageIndex,
      selection: this._sideSelection,
      selectedId: this._selectedId,
      selectedIds: this._selectedIds,
      expandedElements: this._expandedElements,
      expandedParameters: this._expandedParameters,
      thumbPage: this._thumbPage,
      thumbPos: this._thumbPos,
      gridEdit: this._gridEdit,
      parameters: () => this._parameterList(),
      pageDisplayName: (page, index) => this._pageDisplayName(page, index),
      goToPage: (index) => this._goToPage(index),
      selectPage: (index) => this._selectPage(index),
      showPageThumb: (index, event) => this._showPageThumb(index, event),
      hidePageThumb: (index) => this._hidePageThumb(index),
      addParameter: () => this._addParameter(),
      addParameterField: (listKey) => this._addParameterField(listKey),
      removeParameterDef: (key) => this._removeParameterDef(key),
      removeParameterField: (listKey, key) => this._removeParameterField(listKey, key),
      selectParameter: (key) => this._selectParameter(key),
      selectParameterField: (listKey, field) => this._selectParameterField(listKey, field),
      toggleParameterRow: (key) => this._toggleParameterRow(key),
      toggleElementRow: (id) => this._toggleElementRow(id),
      deleteElementById: (pageIndex, id) => this._deleteElementById(pageIndex, id),
      selectFromSidebar: (pageIndex, id, additive) => this._selectFromSidebar(pageIndex, id, additive),
      selectGridCell: (pageIndex, gridId, row, column) =>
        this._selectGridCell(pageIndex, gridId, row, column),
      gridValueCells: (grid) => this._gridValueCells(grid as GridElement),
      openSampleModal: () => {
        this._sample.reset();
        this._dialogs.open('sample');
      },
    };
  }

  /** 양식·파라미터 패널이 요청하는 조작 */
  private get _formActions(): FormActions {
    return {
      file: this._file,
      pageIndex: this._pageIndex,
      pageKeyError: this._pageKeyError,
      parameterKeyError: this._parameterKeyError,
      hostPaperSizes: this._hostPaperSizes,
      paperSaveName: this._paperSaveName,
      setPaperSaveName: (value) => { this._paperSaveName = value; },
      canSavePaperSize: this.settings?.savePaperSize !== undefined,
      updateFile: (fn) => this._updateFile(fn),
      pageCount: () => this._pageCount(),
      movePage: (delta) => this._movePage(delta),
      commitPageKey: (index, raw) => this._commitPageKey(index, raw),
      togglePageNumber: (index, on) => this._togglePageNumber(index, on),
      savePaperSize: (name) => void this._savePaperSize(name),
      parameters: () => this._parameterList(),
      addParameterField: (listKey) => this._addParameterField(listKey),
      commitParameterLabel: (key, label) => this._commitParameterLabel(key, label),
      renameParameterKey: (key, next, input) => this._renameParameterKey(key, next, input),
      setParameterValueType: (key, valueType) => this._setParameterValueType(key, valueType),
      renameParameterField: (listKey, key, next, input) =>
        this._renameParameterField(listKey, key, next, input),
      updateParameterField: (listKey, key, patch) => this._updateParameterField(listKey, key, patch),
      selectFromSidebar: (pageIndex, id, additive) => this._selectFromSidebar(pageIndex, id, additive),
      selectParameter: (key) => this._selectParameter(key),
      selectParameterField: (listKey, field) => this._selectParameterField(listKey, field),
      selectGridCellAt: (at) => this._selectGridCellAt(at),
    };
  }

  /** 그리드 속성 패널이 요청하는 조작 */
  private get _gridActions(): GridActions {
    return {
      edit: this._gridEdit,
      conditional: this._conditionalDeps,
      refresh: () => this.requestUpdate(),
      toggleListSelect: (id, event) => this._toggleListSelect(id, event),
      parameters: () => this._parameterList(),
      planError: () => this._planError(),
      changeRows: (delta) => this._changeGridRows(delta),
      changeColumns: (delta) => this._changeGridColumns(delta),
      setTrack: (kind, index, mm) => this._setGridTrack(kind, index, mm),
      toggleRepeat: (on) => this._toggleGridRepeat(on),
      setRepeatParameter: (key) => this._setRepeatParameter(key),
      setRepeatMaxItems: (value) => this._setRepeatMaxItems(value),
      setPagination: (patch) => this._setGridPagination(patch),
      toggleGroupField: (key, on) => this._toggleGridGroupField(key, on),
      clearCellSelection: () => this._clearCellSelection(),
      setRowBandRole: (fromRow, toRow, placement) => this._setRowBandRole(fromRow, toRow, placement),
      setBandSelectionBoundary: (boundary, rowNumber, bandId) =>
        this._setBandSelectionBoundary(boundary, rowNumber, bandId),
      setBandPages: (bandId, pages) => this._setBandPages(bandId, pages),
      setBandRepeatOnPageBreak: (bandId, on) => this._setBandRepeatOnPageBreak(bandId, on),
      addRowWithRole: (placement, options) => this._addGridRowWithRole(placement, options),
      openRowCommand: (command) => this._openGridRowCommand(command),
      applyRowCommand: () => this._applyGridRowCommand(),
      bandLabel: (placement) => this._bandPlacementLabel(placement),
      bandDescription: (placement) => this._bandPlacementDescription(placement),
      bandIcon: (placement) => this._bandPlacementIcon(placement),
      chooseCellSource: (kind) => this._chooseGridCellSource(kind),
      setCellSource: (kind, value) => this._setGridCellSource(kind, value),
      commitCellContent: (value) => this._commitCellContent(value),
      setCellSpan: (kind, value) => this._setCellSpan(kind, value),
      updateCellStyle: (key, value) => this._updateCellStyle(key, value),
      updateCellConditionalFormats: (next) => this._updateCellConditionalFormats(next),
      cellParameterSelect: (el, current, inBand) => this._gridCellParameterSelect(el, current, inBand),
      repeatProbeItem: (el) => this._repeatProbeItem(el),
    };
  }

  /** 속성 패널의 팝오버 */
  private readonly _popovers = new PopoverController(this);

  /** 색 선택기 */
  private readonly _picker = new ColorPickerController(this);

  /** 그리드 셀·행 구간 선택 */
  private readonly _gridEdit = new GridEditController(this);

  /** 저장 모달과 내 양식 목록 */
  private readonly _forms = new FormsController(this);

  /** 샘플 데이터 모달의 초안 */
  private readonly _sample = new SampleDraftController(this);

  /** 수식 편집 모달의 초안 */
  private readonly _formula = new FormulaDraftController(
    this,
    () => this.renderRoot.querySelector('.formula-input') as HTMLTextAreaElement | null,
  );

  /** 모달의 초점 가두기와 되돌리기 */
  private readonly _modalFocus = new ModalFocusController(this);

  override updated(): void {
    // 인라인 셀 편집을 열면 바로 입력할 수 있게 포커스를 준다
    if (this._gridEdit.editing) {
      const editor = this.renderRoot.querySelector('.cell-editor') as HTMLInputElement | null;
      if (editor && this.shadowRoot?.activeElement !== editor) {
        editor.focus();
        editor.select?.();
      }
    }
    if (this._gridEdit.takeFocusBandMenu()) {
      (this.renderRoot.querySelector('.band-menu-item') as HTMLButtonElement | null)?.focus();
    }
    this._modalFocus.sync();
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
    this._outputPage = 0;
    this._gridPlanPreview = false;
    this._pointer.reset();
    this._clipboard = null;
    this._presetMenuOpen = false;
    this._shapeMenuOpen = false;
    this._gridEdit.clearCell();
    this._pointer.cancelLine();
    this._dialogs.closeAllQuietly();
    this._imageError = null;
    this._sideSelection = null;
    this._parameterKeyError = false;
    this._forms.clearError();
    this._forms.clearNotice();
    this._forms.reset();

    if (!this.src) {
      this._file = null;
      return;
    }

    let file: SlipFile;
    try {
      file = parseSlipFile(this.src, this._locale === undefined ? undefined : { locale: this._locale });
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
        const itemBand = itemBandOf(el);
        if (!itemBand) continue;
        const { fromRow, toRow } = itemBand;
        const listKey = el.repeat.parameter;
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
    this._outputPage = 0;
    this._gridPlanPreview = false;
    this._clearSelection();
    this._sideSelection = null;
    this._gridEdit.clearCell();
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
    this._gridPlanPreview = false;
    this._gridEdit.reset();
  }

  /**
   * 요소를 선택한다. 그룹에 속한 요소이면 같은 그룹을 함께 선택한다.
   *
   * @param id - 고를 요소 id
   */
  private _selectElement(id: string): void {
    this._resetPanelErrors();
    this._selectedId = id;
    this._gridPlanPreview = false;
    this._gridEdit.clearRowCommand();
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
    this._gridEdit.clearCell();
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
    if (this._gridEdit.cell) {
      const el = this._findSelectedElement();
      if (
        !isGrid(el) ||
        this._gridEdit.cell.row >= el.rows.length || this._gridEdit.cell.column >= el.columns.length
      ) {
        this._gridEdit.clearCell();
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
        // 새 그리드는 반복 설정이 없는 정적 그리드로 시작한다 (§7.1).
        element = {
          type: 'grid', id, name, position,
          columns: [{ width: GRID_DEFAULT_COL_MM }, { width: GRID_DEFAULT_COL_MM }, { width: GRID_DEFAULT_COL_MM }],
          rows: [
            { height: GRID_DEFAULT_ROW_MM },
            { height: GRID_DEFAULT_ROW_MM },
            { height: GRID_DEFAULT_ROW_MM },
          ],
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
          type: 'polygon', id, name, position, width: 40, height: 30, sides: this._pointer.pendingSides,
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

    // 드래그로 지정한 크기를 적용한다. 그리드는 행과 열 크기를 이 크기에 맞춘다 (SPEC §5.7).
    setElementBox(
      element,
      place?.width === undefined ? undefined : Math.max(MIN_SIZE_MM, round1(place.width)),
      place?.height === undefined ? undefined : Math.max(MIN_SIZE_MM, round1(place.height)),
    );
    // 새 요소의 위치를 용지 범위로 제한한다.
    const box = boxOf(element);
    element.position = {
      x: round1(Math.max(0, Math.min(element.position.x, paper.width - box.width))),
      y: round1(Math.max(0, Math.min(element.position.y, paper.height - box.height))),
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
    this._forms.clearNotice();
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







  private _commitCellContent(value: string): void {
    const target = this._gridEdit.cell;
    if (!target) return;
    this._gridEdit.setEditing(false);
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
    const target = this._gridEdit.cell;
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
    // 병합 범위는 하나의 행 구간 안에 완전히 포함되어야 한다 (SPEC §5.7).
    if (el.repeat && rowSpan > 1) {
      const probe: GridCell = { row: target.row, column: target.column, rowSpan };
      if (spanCrossesBand(el, el.repeat.bands, probe)) {
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
    const target = this._gridEdit.cell;
    if (!target) return;
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (value === null || value === undefined || value === '') delete record[key];
      else record[key] = value;
    });
  }

  // ---------------------------------------------------------------------------
  // 그리드 편집
  // ---------------------------------------------------------------------------

  /** 그리드를 수정한다. 크기는 행과 열의 합에서 계산하므로 따로 저장하지 않는다. */
  private _updateGrid(fn: (el: GridElement) => void): void {
    this._updateElement((el) => {
      if (el.type !== 'grid') return;
      fn(el);
    });
  }

  /** 그리드의 마지막 행을 추가하거나 제거한다. 반복 그리드의 추가는 역할 지정 명령을 사용한다. */
  private _changeGridRows(delta: number): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    if (delta > 0 && el.repeat) return;
    const next = el.rows.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    // 항목 구간이 한 행뿐이면 그 행은 제거할 수 없다.
    if (delta < 0 && !canRemoveLastRow(el)) return;
    this._updateGrid((grid) => changeRowCount(grid, delta));
  }

  /** 선택한 역할의 행을 알맞은 구간 위치에 추가한다. */
  private _addGridRowWithRole(
    placement: GridBandPlacement,
    options: {
      separateBand?: boolean;
      name?: string;
      pages?: OutputPageFilter;
      initialize?: (grid: GridElement, row: number) => void;
    } = {},
  ): number | null {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat || el.rows.length >= GRID_MAX_TRACKS_UI) return null;
    if ((placement === 'group-start' || placement === 'group-end')
      && (el.repeat.groupBy === undefined || el.repeat.groupBy.length === 0)) {
      this._rejectInput(this._strings.designer.bandNeedsGroupBy, 'band-role');
      return null;
    }

    const { insertAt, sameBandId } = insertPositionFor(el, placement);
    const sourceRow = el.rows[Math.max(0, Math.min(insertAt - 1, el.rows.length - 1))];
    const targetBandId = options.separateBand ? undefined : sameBandId;

    this._resetPanelErrors();
    this._updateGrid((grid) => {
      insertGridRow(
        grid,
        insertAt,
        placement,
        targetBandId,
        options,
        sourceRow?.height ?? GRID_DEFAULT_ROW_MM,
      );
      options.initialize?.(grid, insertAt);
    });
    this._gridEdit.selectBand({ from: insertAt, to: insertAt });
    this._gridEdit.closeBandMenu(false);
    this.requestUpdate();
    return insertAt;
  }

  /** 그리드의 마지막 열을 추가하거나 제거한다. */
  private _changeGridColumns(delta: number): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    const next = el.columns.length + delta;
    if (next < 1 || next > GRID_MAX_TRACKS_UI) return;
    this._updateGrid((grid) => changeColumnCount(grid, delta));
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

  /**
   * 반복 설정을 켜거나 끈다.
   * 켜면 선택한 행(없으면 마지막 행)을 항목 구간으로 하고, 위쪽 행은 데이터 앞,
   * 아래쪽 행은 데이터 뒤 구간으로 지정한다. 페이지 방식은 자동 확장으로 시작한다 (§7.1).
   */
  private _toggleGridRepeat(on: boolean): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid') return;
    if (!on) {
      this._updateGrid((grid) => {
        delete (grid as { repeat?: unknown }).repeat;
      });
      return;
    }
    const row = Math.min(this._gridEdit.cell?.row ?? el.rows.length - 1, el.rows.length - 1);
    // 항목 구간 경계를 넘는 병합이 있으면 반복을 켤 수 없다.
    const bands: GridBand[] = [
      ...(row > 0 ? [{ id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: 0, toRow: row - 1, placement: 'before-data' as const }] : []),
      { id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: row, toRow: row, placement: 'item' as const },
      ...(row < el.rows.length - 1
        ? [{ id: `band_${crypto.randomUUID().slice(0, 8)}`, fromRow: row + 1, toRow: el.rows.length - 1, placement: 'after-data' as const }]
        : []),
    ];
    if (el.cells.some((cell) => spanCrossesBand(el, bands, cell))) {
      this._rejectInput(this._strings.designer.repeatMergeError, 'repeat-on');
      return;
    }
    const key = `items_${el.id.slice(0, 4)}`;
    this._ensureParameterDef(key, 'list');
    this._updateGrid((grid) => {
      grid.repeat = {
        parameter: key,
        bands,
        pagination: { mode: 'auto', minItems: 0 },
      };
    });
  }

  /** 반복 설정의 목록 파라미터를 변경한다. */
  private _setRepeatParameter(key: string): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    this._ensureParameterDef(key, 'list');
    this._updateGrid((grid) => {
      grid.repeat!.parameter = key;
    });
  }

  /** 최대 항목 수를 변경한다. null은 제한 없음이다. */
  private _setRepeatMaxItems(value: number | null): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > GRID_MAX_ITEMS_UI)) {
      this._rejectInput(
        this._strings.designer.rangeInput.replace('{min}', '1').replace('{max}', String(GRID_MAX_ITEMS_UI)),
        'repeat-max-items',
      );
      return;
    }
    this._updateGrid((grid) => {
      if (value === null) delete (grid.repeat as { maxItems?: unknown }).maxItems;
      else grid.repeat!.maxItems = value;
    });
  }

  /**
   * 페이지 방식을 변경한다.
   *
   * @param patch - `mode`: 방식 전환, `minItems`: 자동 확장의 최소 표시 항목 수,
   *   `itemsPerPage`: 고정 페이지의 페이지당 항목 수
   */
  private _setGridPagination(patch: { mode?: 'auto' | 'fixed'; minItems?: number; itemsPerPage?: number }): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const current = el.repeat.pagination;
    if (patch.minItems !== undefined
      && (!Number.isInteger(patch.minItems) || patch.minItems < 0 || patch.minItems > GRID_MAX_ITEMS_UI)) {
      this._rejectInput(
        this._strings.designer.rangeInput.replace('{min}', '0').replace('{max}', String(GRID_MAX_ITEMS_UI)),
        'repeat-min-items',
      );
      return;
    }
    if (patch.itemsPerPage !== undefined
      && (!Number.isInteger(patch.itemsPerPage) || patch.itemsPerPage < 1 || patch.itemsPerPage > GRID_MAX_PER_PAGE_UI)) {
      this._rejectInput(
        this._strings.designer.rangeInput.replace('{min}', '1').replace('{max}', String(GRID_MAX_PER_PAGE_UI)),
        'repeat-per-page',
      );
      return;
    }
    this._updateGrid((grid) => {
      const mode = patch.mode ?? current.mode;
      if (mode === 'auto') {
        const minItems = patch.minItems ?? (current.mode === 'auto' ? current.minItems : 0);
        grid.repeat!.pagination = { mode: 'auto', minItems };
      } else {
        const itemsPerPage = patch.itemsPerPage ?? (current.mode === 'fixed' ? current.itemsPerPage : 1);
        grid.repeat!.pagination = { mode: 'fixed', itemsPerPage };
      }
    });
  }

  /**
   * 선택한 행 범위에 행 구간 역할을 지정한다.
   * 구간 규칙(항목 구간 하나·세로 순서·병합 경계)을 어기는 지정은 거부한다.
   */
  private _setRowBandRole(fromRow: number, toRow: number, placement: GridBandPlacement): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const s = this._strings.designer;
    // 그룹 구간은 그룹 기준이 있어야 한다.
    if ((placement === 'group-start' || placement === 'group-end')
      && (el.repeat.groupBy === undefined || el.repeat.groupBy.length === 0)) {
      this._rejectInput(s.bandNeedsGroupBy, 'band-role');
      return;
    }
    const result = assignBandRole(el, fromRow, toRow, placement);
    if (result === 'noItem') {
      this._rejectInput(s.bandNeedsItem, 'band-role');
      return;
    }
    if (result === 'outOfOrder') {
      this._rejectInput(s.bandOrderError, 'band-role');
      return;
    }
    if (el.cells.some((cell) => spanCrossesBand(el, result, cell))) {
      this._rejectInput(s.repeatMergeError, 'band-role');
      return;
    }
    this._resetPanelErrors();
    this._updateGrid((grid) => {
      grid.repeat!.bands = result;
    });
  }

  /** 속성 패널에서 선택한 행 구간의 시작 또는 종료 행을 변경한다. */
  private _setBandSelectionBoundary(boundary: 'from' | 'to', rowNumber: number, bandId?: string): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat || this._gridEdit.bandRange === null) return;
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > el.rows.length) {
      this._rejectInput(
        this._strings.designer.rangeInput.replace('{min}', '1').replace('{max}', String(el.rows.length)),
        'band-range',
      );
      return;
    }
    const index = rowNumber - 1;
    const from = Math.min(this._gridEdit.bandRange.from, this._gridEdit.bandRange.to);
    const to = Math.max(this._gridEdit.bandRange.from, this._gridEdit.bandRange.to);
    const nextFrom = boundary === 'from' ? index : from;
    const nextTo = boundary === 'to' ? index : to;
    if (nextFrom > nextTo) {
      this._rejectInput(this._strings.designer.bandRangeOrder, 'band-range');
      return;
    }

    if (bandId !== undefined) {
      const result = resizeBandRange(el, bandId, nextFrom, nextTo);
      if (result === 'noItem') {
        this._rejectInput(this._strings.designer.bandNeedsItem, 'band-range');
        return;
      }
      if (result === 'outOfOrder') {
        this._rejectInput(this._strings.designer.bandOrderError, 'band-range');
        return;
      }
      if (el.cells.some((cell) => spanCrossesBand(el, result, cell))) {
        this._rejectInput(this._strings.designer.repeatMergeError, 'band-range');
        return;
      }
      this._resetPanelErrors();
      this._updateGrid((grid) => {
        grid.repeat!.bands = result;
      });
      this._gridEdit.selectBand({ from: nextFrom, to: nextTo });
      this._gridEdit.closeBandMenu(false);
      this.requestUpdate();
      return;
    }

    this._resetPanelErrors();
    this._gridEdit.selectBand({ from: nextFrom, to: nextTo });
    this._gridEdit.closeBandMenu(false);
    this.requestUpdate();
  }

  /** page-start·page-end 구간의 표시 페이지 필터를 변경한다. */
  private _setBandPages(bandId: string, pages: OutputPageFilter | ''): void {
    this._updateGrid((grid) => {
      const band = grid.repeat?.bands.find((b) => b.id === bandId);
      if (!band) return;
      if (pages === '' || pages === 'all') delete (band as { pages?: unknown }).pages;
      else band.pages = pages;
    });
  }

  /** group-start 구간의 페이지 이월 시 반복 표시를 켜거나 끈다. */
  private _setBandRepeatOnPageBreak(bandId: string, on: boolean): void {
    this._updateGrid((grid) => {
      const band = grid.repeat?.bands.find((b) => b.id === bandId);
      if (!band) return;
      if (on) band.repeatOnPageBreak = true;
      else delete (band as { repeatOnPageBreak?: unknown }).repeatOnPageBreak;
    });
  }

  /** 그룹 기준 필드의 선택 상태를 변경한다. */
  private _toggleGridGroupField(key: string, on: boolean): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const fields = this._parameterList().find((parameter) => parameter.key === el.repeat!.parameter)?.fields ?? [];
    if (!fields.some((field) => field.key === key)) return;
    const selected = new Set(el.repeat.groupBy ?? []);
    if (on) selected.add(key);
    else selected.delete(key);
    const keys = fields.map((field) => field.key).filter((field) => selected.has(field));
    const hasGroupBands = el.repeat.bands.some(
      (band) => band.placement === 'group-start' || band.placement === 'group-end',
    );
    if (keys.length === 0 && hasGroupBands) {
      this._rejectInput(this._strings.designer.bandNeedsGroupBy, 'repeat-group-by');
      return;
    }
    this._resetPanelErrors();
    this._updateGrid((grid) => {
      if (keys.length === 0) delete (grid.repeat as { groupBy?: unknown }).groupBy;
      else grid.repeat!.groupBy = keys;
    });
  }

  /** 행 추가 명령을 고르고 집계 필드의 기본값을 설정한다. */
  private _openGridRowCommand(command: GridRowCommand): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'grid' || !el.repeat) return;
    const numericFields = this._parameterList()
      .find((parameter) => parameter.key === el.repeat!.parameter)
      ?.fields.filter((field) => field.valueType === 'number') ?? [];
    if (!numericFields.some((field) => field.key === this._gridEdit.rowCommandField)) {
      const itemBand = itemBandOf(el);
      const columnOf = (key: string): number => itemBand === undefined
        ? -1
        : Math.max(
            -1,
            ...el.cells
              .filter((cell) => cell.parameter === key
                && cell.row >= itemBand.fromRow && cell.row <= itemBand.toRow)
              .map((cell) => cell.column),
          );
      this._gridEdit.setRowCommandField(
        [...numericFields].sort((a, b) => columnOf(b.key) - columnOf(a.key))[0]?.key
          ?? numericFields.at(-1)?.key
          ?? '',
      );
    }
    this._gridEdit.startRowCommand(command, this._gridEdit.rowCommandField);
    this._resetPanelErrors();
  }

  /** 항목 행의 스타일을 바탕으로 행·소계·합계 명령을 한 번에 적용한다. */
  private _applyGridRowCommand(): void {
    const el = this._findSelectedElement();
    const command = this._gridEdit.rowCommand;
    if (el?.type !== 'grid' || !el.repeat || command === null) return;
    const s = this._strings.designer;
    const itemBand = itemBandOf(el);
    if (itemBand === undefined) {
      this._rejectInput(s.bandNeedsItem, 'grid-row-command');
      return;
    }
    if (command === 'group-subtotal'
      && (el.repeat.groupBy === undefined || el.repeat.groupBy.length === 0)) {
      this._rejectInput(s.gridCommandGroupRequired, 'grid-row-command');
      return;
    }

    const fields = this._parameterList()
      .find((parameter) => parameter.key === el.repeat!.parameter)?.fields ?? [];
    const numericField = fields.find(
      (field) => field.key === this._gridEdit.rowCommandField && field.valueType === 'number',
    );
    if (command !== 'header' && numericField === undefined) {
      this._rejectInput(s.gridCommandNumberRequired, 'grid-row-command');
      return;
    }

    const itemCells = el.cells.filter(
      (cell) => cell.row >= itemBand.fromRow && cell.row <= itemBand.toRow,
    );
    const firstItemRowCells = itemCells.filter((cell) => cell.row === itemBand.fromRow);
    const fieldTitles = new Map(fields.map((field) => [field.key, field.title]));
    const placement: GridBandPlacement = command === 'header'
      ? 'page-start'
      : command === 'group-subtotal'
        ? 'group-end'
        : command === 'page-subtotal'
          ? 'page-end'
          : 'after-data';
    const bandName = command === 'header'
      ? s.gridCommandHeaderName
      : command === 'group-subtotal'
        ? s.gridCommandGroupSubtotalName
        : command === 'page-subtotal'
          ? s.gridCommandPageSubtotalName
          : s.gridCommandFinalTotalName;

    const cloneCellStyle = (source: GridCell | undefined, row: number, column: number): GridCell => {
      const cell: GridCell = source === undefined
        ? { row, column, content: '' }
        : { ...structuredClone(source), row, column };
      delete (cell as { name?: unknown }).name;
      delete (cell as { rowSpan?: unknown }).rowSpan;
      delete (cell as { content?: unknown }).content;
      delete (cell as { parameter?: unknown }).parameter;
      delete (cell as { formula?: unknown }).formula;
      delete (cell as { conditionalFormats?: unknown }).conditionalFormats;
      return cell;
    };

    const added = this._addGridRowWithRole(placement, {
      separateBand: true,
      name: bandName,
      ...(command === 'page-subtotal' ? { pages: 'non-final' as const } : {}),
      initialize: (grid, row) => {
        if (command === 'header') {
          for (const source of firstItemRowCells) {
            const cell = cloneCellStyle(source, row, source.column);
            cell.content = source.parameter === undefined
              ? (source.content ?? '')
              : (fieldTitles.get(source.parameter) ?? source.parameter);
            grid.cells.push(cell);
          }
          return;
        }

        const fieldSource = itemCells.find((cell) => cell.parameter === numericField!.key);
        const targetColumn = fieldSource?.column
          ?? Math.max(0, ...firstItemRowCells.map((cell) => cell.column), grid.columns.length - 1);
        if (targetColumn > 0) {
          const labelSource = itemCells.find(
            (cell) => cell.column === 0 && cell.row === itemBand.fromRow,
          );
          const labelCell = cloneCellStyle(labelSource, row, 0);
          labelCell.content = bandName;
          if (targetColumn > 1) labelCell.colSpan = targetColumn;
          else delete (labelCell as { colSpan?: unknown }).colSpan;
          grid.cells.push(labelCell);
        }
        const valueCell = cloneCellStyle(fieldSource, row, targetColumn);
        const scope = command === 'group-subtotal' ? '@group'
          : command === 'page-subtotal' ? '@page' : '@all';
        valueCell.formula = `SUM(${scope}.${numericField!.key})`;
        grid.cells.push(valueCell);
      },
    });
    if (added === null) return;
    this._gridEdit.clearRowCommand();
  }

  /**
   * 셀의 값 소스 종류를 선택한다.
   * 파라미터와 수식은 빈 값으로 저장할 수 없어 입력 전에는 화면 상태로만 유지한다.
   */
  private _chooseGridCellSource(kind: 'content' | 'parameter' | 'formula'): void {
    this._gridEdit.setSourceKind(kind);
    const target = this._gridEdit.cell;
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
    const target = this._gridEdit.cell;
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
    if (e.key === 'Escape' && this._dialogs.anyOpen) {
      this._dialogs.closeAllQuietly();
      this._imageError = null;
      this.requestUpdate();
      return;
    }

    if (e.key === 'Escape' && (this._pointer.pendingTool || this._pointer.draw || this._pointer.lineDraft)) {
      this._pointer.cancelDrawing();
      this.requestUpdate();
    }
    // PDF 미리보기 상태에서는 문서를 변경하는 단축키를 처리하지 않는다.
    if (this._previewMode) return;
    // 출력 결과는 읽기 전용이다. Esc만 행 구조 편집으로 돌아가는 데 사용한다.
    if (this._gridPlanPreview) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._setGridPlanPreview(false);
      }
      return;
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
      const pdfBytes = await renderSlip(this.slipkit, target, this._locale);
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
      <div class="toolbar">${toolbar(this._toolbarActions)}</div>
      ${this._previewMode
        ? html`<div class="preview-area">
            ${this._previewUrl
              ? html`<iframe src=${this._previewUrl} title=${this._strings.designer.pdfTitle}></iframe>`
              : this._previewError
                ? html`<div class="status error">${this._previewError}</div>`
                : html`<div class="status">${this._strings.designer.previewLoading}</div>`}
          </div>`
        : html`
            <aside class="sidebar">${sidebar(this._kit, this._sidebarActions)}</aside>
            <div class="canvas-area ${this._pointer.pendingTool ? 'drawing' : ''} ${
              this._showBadges ? 'show-badges' : ''
            }"
                 @pointerdown=${this._pointer.onPointerDown}
                 @pointermove=${this._pointer.onPointerMove}
                 @pointerup=${this._pointer.onPointerUp}
                 @pointercancel=${this._pointer.onPointerCancel}>
              ${canvas(this._canvasContext)}
            </div>
            ${this._pointer.cursorMm
              ? html`<div class="coords">${this._pointer.cursorMm.x} · ${this._pointer.cursorMm.y} mm</div>`
              : nothing}
            <div class="prop-panel">
              ${this._inputError && this._inputErrorField === null
                ? html`<div class="input-error" role="alert">${this._inputError}</div>`
                : nothing}
              ${propertyPanel(this._panelContext)}
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
    return this.presets?.length ? this.presets : getPresets(this._locale);
  }

  private _toggleListSelect(id: string, e: Event): void {
    // 목록이 화면 아래로 넘치지 않게 남은 높이 안에서만 편다.
    this._popovers.toggle('list', id, () => placeBelow(e.currentTarget as HTMLElement, 120, 280));
  }

  /**
   * 네이티브 select 대신 쓰는 리스트형 선택 상자를 렌더링한다.
   * 트리거 버튼을 누르면 버튼 아래 화면 고정 위치에 항목 목록이 열린다.
   */
  private _listSelect(config: {
    id: string;
    ariaLabel: string;
    value: string;
    options: { value: string; label: string; description?: string }[];
    onPick: (value: string) => void;
    className?: string;
    placeholder?: string;
  }) {
    const open = this._popovers.isOpen('list', config.id);
    const current = config.options.find((o) => o.value === config.value);
    return html`
      <button type="button" class="list-select ${config.className ?? ''}"
        aria-haspopup="listbox" aria-expanded=${String(open)} aria-label=${config.ariaLabel}
        data-value=${config.value}
        @click=${(e: Event) => this._toggleListSelect(config.id, e)}>
        <span class="list-select-value">${current?.label ?? config.placeholder ?? config.value}</span>
        <span class="list-select-caret" aria-hidden="true">${icons.down}</span>
      </button>
      ${open
        ? html`
          <div class="menu-backdrop" @click=${() => this._popovers.close('list')}></div>
          <div class="preset-menu list-select-menu" role="listbox" aria-label=${config.ariaLabel}
            style=${listSelectStyle(this._popovers.placement('list'))}>
            ${config.options.map((o) => html`
              <button type="button" role="option" data-value=${o.value}
                class=${o.description === undefined ? '' : 'described'}
                aria-selected=${String(o.value === config.value)}
                @click=${() => {
                  this._popovers.close('list');
                  config.onPick(o.value);
                }}>
                <span class="list-select-option-label">${o.label}</span>
                ${o.description === undefined
                  ? nothing
                  : html`<span class="list-select-option-description">${o.description}</span>`}
              </button>`)}
          </div>`
        : nothing}
    `;
  }

  /** 프리셋 메뉴를 버튼 아래의 화면 고정 위치에서 열거나 닫는다. */
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
    this._gridEdit.clearCell();
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
    this._gridEdit.clearCell();
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
    this._gridEdit.clearCell();
    this._sideSelection = { kind: 'page' };
    this.requestUpdate();
  }

  /** 파라미터를 선택하고 오른쪽에 편집 패널을 표시한다. */
  private _selectParameter(key: string): void {
    this._parameterKeyError = false;
    this._clearSelection();
    this._gridEdit.clearCell();
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
          const itemBand = el.repeat === undefined ? undefined : itemBandOf(el);
          if (el.repeat && itemBand) {
            const listKey = el.repeat.parameter;
            const at = fieldAt.get(listKey) ?? new Map();
            const band = el.cells
              .filter((c) => c.row >= itemBand.fromRow && c.row <= itemBand.toRow && c.parameter !== undefined)
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
          // 항목 구간의 셀 파라미터는 목록 항목의 하위 필드이므로 최상위 값에서 제외한다.
          for (const cell of el.cells) {
            if (cell.parameter !== undefined && !inItemBand(el, cell.row)) keys.add(cell.parameter);
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


  private _toggleParameterRow(key: string): void {
    if (this._expandedParameters.has(key)) this._expandedParameters.delete(key);
    else this._expandedParameters.add(key);
    this.requestUpdate();
  }

  private _gridValueCells(grid: GridElement): { row: number; column: number; label: string; at: string }[] {
    const s = this._strings.designer;
    return grid.cells
      .filter((c) => c.name?.trim() || c.parameter !== undefined || c.formula !== undefined)
      .slice()
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((c) => {
        // 사용자가 지정한 셀 이름을 우선 사용하고, 이름이 없으면 좌표를 표시한다 (§7.4).
        const at = s.gridCellAt
          .replace('{r}', String(c.row + 1))
          .replace('{c}', String(c.column + 1));
        return { row: c.row, column: c.column, label: c.name === undefined || c.name === '' ? at : c.name, at };
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
    this._gridEdit.selectCell({ row, column });
    this._gridEdit.closeBandMenu(true);
    this._gridEdit.setEditing(false);
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
      this._gridEdit.clearCell();
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
              // 항목 구간 안의 셀 파라미터는 목록 하위 필드이므로 최상위 키 변경에서 제외한다.
              if (!inItemBand(el, cell.row) && cell.parameter === key) cell.parameter = trimmed;
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
      // 해당 목록 파라미터의 항목 구간에서 참조하는 셀만 변경한다.
      for (const page of f.template.pages) {
        for (const el of page.elements) {
          if (el.type !== 'grid' || el.repeat?.parameter !== listKey) continue;
          for (const cell of el.cells) {
            if (inItemBand(el, cell.row) && cell.parameter === key) cell.parameter = trimmed;
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
          for (const cell of el.cells) {
            if (inItemBand(el, cell.row) && cell.parameter === key) {
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

  private _pagePlan(): { plan: SourcePagePlan | null; error: SlipLayoutError | null } {
    const file = this._file;
    const page = file?.template.pages[this._pageIndex];
    if (!file || !page) return { plan: null, error: null };
    const itemsByGrid = new Map<string, readonly GridItem[]>();
    for (const el of page.elements) {
      if (el.type === 'grid' && el.repeat !== undefined) {
        itemsByGrid.set(el.id, repeatSampleItems(this._canvasContext, el) as GridItem[]);
      }
    }
    const key = JSON.stringify([this._pageIndex, file.template.paper, page, [...itemsByGrid.entries()]]);
    if (this._planCache?.key === key) return this._planCache;
    let plan: SourcePagePlan | null = null;
    let error: SlipLayoutError | null = null;
    try {
      plan = planSourcePage(file.template.paper, page, itemsByGrid, this._evalLocale);
    } catch (cause) {
      if (!(cause instanceof SlipLayoutError)) throw cause;
      error = cause;
    }
    this._planCache = { key, plan, error };
    return this._planCache;
  }

  /** 현재 양식 페이지의 계획 오류 메시지 (없으면 null) */
  private _planError(): SlipLayoutError | null {
    return this._pagePlan().error;
  }

  /** 계획 오류가 가리키는 요소와 행 구간을 선택하고 편집 위치로 이동한다. */
  private _focusPlanError(error: SlipLayoutError): void {
    if (error.elementId === undefined) return;
    const element = this._findElement(error.elementId);
    if (element === undefined) return;
    this._selectElement(element.id);
    this._gridEdit.clearCell();
    if (element.type === 'grid' && error.bandId !== undefined) {
      const band = element.repeat?.bands.find((candidate) => candidate.id === error.bandId);
      if (band !== undefined) this._gridEdit.selectBand({ from: band.fromRow, to: band.toRow });
    }
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const target = error.bandId === undefined
        ? this.renderRoot.querySelector(`[data-id="${element.id}"]`)
        : this.renderRoot.querySelector(`[data-band-id="${error.bandId}"] .band-item-main`);
      if (!(target instanceof HTMLElement)) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest' });
    });
  }

  /** 선택한 반복 그리드의 원본 행 구조와 출력 결과 표시를 전환한다. */
  private _setGridPlanPreview(enabled: boolean): void {
    this._gridPlanPreview = enabled;
    this._gridEdit.clearCell();
    this._gridEdit.closeBandMenu(true);
    this._pointer.cancelTool();
    this.requestUpdate();
  }



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



  private _onBandRowClick(row: number, extend: boolean): void {
    const previous = this._gridEdit.bandRange;
    this._gridEdit.selectBand(
      extend && previous !== null ? { from: previous.from, to: row } : { from: row, to: row },
    );
    this._gridEdit.openBandMenu(true);
  }

  /** 행 역할 메뉴를 닫고 조작을 시작한 행으로 포커스를 돌린다. */
  private _closeBandMenu(clearSelection: boolean): void {
    const range = this._gridEdit.bandRange;
    const row = range === null ? null : Math.min(range.from, range.to);
    this._gridEdit.closeBandMenu(clearSelection);
    if (row === null) return;
    void this.updateComplete.then(() => {
      (this.renderRoot.querySelector(`[data-band-row="${row}"]`) as HTMLButtonElement | null)?.focus();
    });
  }

  /** 행 역할 메뉴에서 방향키·Home·End·Escape 포커스 이동을 처리한다. */
  private _onBandMenuKeyDown = (event: KeyboardEvent): void => {
    const menu = event.currentTarget as HTMLElement;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.band-menu-item'));
    const current = items.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closeBandMenu(false);
      return;
    }
    let next = -1;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  /** 행 구간 역할의 표시 이름을 반환한다. */
  private _bandPlacementLabel(placement: GridBandPlacement): string {
    const s = this._strings.designer;
    switch (placement) {
      case 'before-data': return s.bandBeforeData;
      case 'page-start': return s.bandPageStart;
      case 'group-start': return s.bandGroupStart;
      case 'item': return s.bandItem;
      case 'group-end': return s.bandGroupEnd;
      case 'after-data': return s.bandAfterData;
      case 'page-end': return s.bandPageEnd;
    }
  }

  /** 행 구간이 출력되는 시점과 대표 용도를 설명한다. */
  private _bandPlacementDescription(placement: GridBandPlacement): string {
    const s = this._strings.designer;
    switch (placement) {
      case 'before-data': return s.bandBeforeDataHelp;
      case 'page-start': return s.bandPageStartHelp;
      case 'group-start': return s.bandGroupStartHelp;
      case 'item': return s.bandItemHelp;
      case 'group-end': return s.bandGroupEndHelp;
      case 'after-data': return s.bandAfterDataHelp;
      case 'page-end': return s.bandPageEndHelp;
    }
  }

  /** 행 구간 역할을 나타내는 아이콘을 반환한다. */
  private _bandPlacementIcon(placement: GridBandPlacement) {
    switch (placement) {
      case 'before-data': return icons.pagePrev;
      case 'page-start': return icons.up;
      case 'group-start': return icons.treeOpen;
      case 'item': return icons.gridElement;
      case 'group-end': return icons.treeClosed;
      case 'after-data': return icons.pageNext;
      case 'page-end': return icons.down;
    }
  }

  private _updateFile(fn: (file: SlipTemplateFile) => void): void {
    // 유효한 편집이 적용되면 이전 입력 오류를 지운다.
    this._resetPanelErrors();
    if (!this._file) return;
    this._pushUndo();
    fn(this._file);
    this._emitChange();
    this.requestUpdate();
  }

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
    const fonts = await resolveFonts(this.slipkit, this._locale);
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


  private _selectGridCellAt(at: { pageIndex: number; gridId: string; row: number; column: number }): void {
    this._resetPanelErrors();
    this._goToPage(at.pageIndex);
    this._selectedId = at.gridId;
    this._selectedIds = new Set([at.gridId]);
    this._gridEdit.selectCell({ row: at.row, column: at.column });
    this._gridEdit.setEditing(false);
    this._sideSelection = null;
    this._expandedElements.add(at.gridId);
    this.requestUpdate();
  }

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
    const cell = this._gridEdit.cell;
    this._addParameterField(listKey);
    const created = (this._parameterList().find((b) => b.key === listKey)?.fields ?? [])
      .find((f) => !before.has(f.key));
    // 하위 필드 편집 후 원래 셀 선택을 복원한다.
    this._sideSelection = null;
    if (cell) this._gridEdit.selectCell(cell);
    if (created) this._setGridCellSource('parameter', created.key);
  }

  /** 새 최상위 파라미터를 만들고 현재 셀에 연결한다. */
  private _newParameterForCell(): void {
    const cell = this._gridEdit.cell;
    const { key, label } = this._nextParameter();
    this._updateFile((f) => {
      const defs = f.template.parameters ?? [];
      defs.push({ key, label });
      f.template.parameters = defs;
    });
    if (cell) this._gridEdit.selectCell(cell);
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


  private _clearCellSelection(): void {
    this._resetPanelErrors();
    this._gridEdit.clearCellAndSource();
    this.requestUpdate();
  }



  private _togglePropertyMenu(key: string, event: Event): void {
    this._popovers.toggle(
      'property',
      key,
      () => placeBelowOrAbove(event.currentTarget as HTMLElement, 80, 220, 180),
    );
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



  /** 요소의 색상 속성을 설정하거나 제거하고 색 선택기 상태를 갱신한다. */
  private _applyColor(key: string, value: string | null): void {
    if (value) this._picker.seed(value);
    this._updateElement((el) => setOptional(el, key, value || null));
  }


  private _repeatProbeItem(el: GridElement): Record<string, unknown> | undefined {
    if (!el.repeat) return undefined;
    const list = this._formulaProbeValues()[el.repeat.parameter];
    const item = Array.isArray(list) ? list[0] : undefined;
    return typeof item === 'object' && item !== null && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : undefined;
  }

  /** 선택 셀의 조건부 서식 규칙 목록을 저장한다. 빈 목록이면 속성을 제거한다. */
  private _updateCellConditionalFormats(next: ConditionalFormatRule[]): void {
    const target = this._gridEdit.cell;
    if (!target) return;
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      const record = ensureCell(element, target.row, target.column);
      if (next.length === 0) delete record.conditionalFormats;
      else record.conditionalFormats = next;
    });
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

  /** 이미지 선택 모달을 연다. */
  private _openImageModal(): void {
    this._imageError = null;
    this._dialogs.open('image');
  }

  private _closeImageModal(): void {
    this._dialogs.close('image');
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
    this._imageError = this._pickErrorText(result);
    this.requestUpdate();
  }

  /** 이미지 선택 실패 사유를 로케일에 맞는 문구로 바꾼다. */
  private _pickErrorText(result: ImagePickFailure): string {
    const s = this._strings.designer;
    return imagePickErrorText(
      result,
      { notImage: s.imageNotImage, readFailed: s.imageReadFailed, tooLarge: s.imageTooLarge },
      this.maxImageBytes,
    );
  }

  /** 샘플 데이터의 이미지 값을 파일에서 선택해 저장한다. */
  private async _pickSampleImage(key: string): Promise<void> {
    const result = await pickImageFile(this.maxImageBytes);
    if (result.ok) {
      this._sample.setImageError(null);
      this._setSampleValue(key, result.src);
      return;
    }
    this._sample.setImageError(this._pickErrorText(result));
  }

  /** 선택한 필드의 수식으로 수식 편집 모달을 연다. */
  private _openFormulaModal(): void {
    const el = this._findSelectedElement();
    if (!el || el.type !== 'field') return;
    this._formula.start(el.formula);
    this._dialogs.open('formula');
  }

  private _closeFormulaModal(): void {
    this._dialogs.close('formula');
    this.requestUpdate();
  }

  /** 수식 편집 값을 선택한 필드에 적용한다. 빈 값이면 수식을 제거한다. */
  private _applyFormulaModal(): void {
    const formula = this._formula.commit();
    this._dialogs.close('formula');
    this._updateElement((el) => {
      if (el.type !== 'field') return;
      setOptional(el, 'formula', formula);
    });
  }

  /** 목록 파라미터의 하위 필드 자동완성 항목을 렌더링한다. */
  private _renderColumnSuggestions() {
    const suggestion = this._formula.suggestion(this._parameterList());
    if (!suggestion) return nothing;
    const s = this._strings.designer;

    return html`
      <div class="formula-suggest" role="group" aria-label=${s.formulaColumnSuggest}>
        <span class="formula-suggest-label">${s.formulaColumnSuggest}</span>
        ${suggestion.columns.map((col) => html`
          <button class="parameter-chip column" title=${col.key}
            @click=${() => this._formula.insert(col.key.slice(suggestion.typedLength))}
            >${col.title ? `${col.title} · ${col.key}` : col.key}</button>`)}
      </div>
    `;
  }

  /** 문법 검사, 샘플 계산, 파라미터 및 함수 삽입을 제공하는 수식 모달을 렌더링한다. */
  private _renderFormulaModal() {
    if (!this._dialogs.isOpen('formula')) return nothing;
    const el = this._findSelectedElement();
    if (!el || el.type !== 'field') return nothing;
    const s = this._strings.designer;
    const draft = this._formula.draft;

    let syntaxError: string | null = null;
    let preview: string | null = null;
    let previewError: string | null = null;
    if (draft.trim() !== '') {
      try {
        parseFormula(draft, this._locale === undefined ? undefined : { locale: this._locale });
        try {
          // 샘플 값이 없으면 파라미터 종류별 기본값으로 수식을 검사한다.
          preview = formulaPreviewText(
            this._evaluate(draft, {
              values: this._formulaProbeValues(),
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
      <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.formulaModalTitle}
        @keydown=${(e: KeyboardEvent) => this._modalFocus.handleKeydown(e, () => this._closeFormulaModal())}>
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
              this._formula.setDraft(input.value, input.selectionStart);
            }}
            @keyup=${(e: Event) => this._formula.syncCaret((e.target as HTMLTextAreaElement).selectionStart)}
            @click=${(e: Event) => this._formula.syncCaret((e.target as HTMLTextAreaElement).selectionStart)}></textarea>
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
                      @click=${() => this._formula.insert(b.key)}>${b.label}${
                        b.valueType ? html`<span class="chip-type">${b.valueType}</span>` : nothing
                      }</button>
                    ${b.fields.map((field) => html`
                      <button class="parameter-chip column" title="${b.key}.${field.key}"
                        @click=${() => this._formula.insert(`${b.key}.${field.key}`)}
                        >${field.title}</button>`)}`)}
                </div>`
            : nothing}
          <div class="modal-section-title">${s.formulaFunctions}</div>
          ${getFormulaHelp(this._locale).map((category) => html`
            <div class="fn-category">${category.title}</div>
            ${category.functions.map((fn) => html`
              <button class="fn-row" aria-label=${fn.name}
                @click=${() => this._formula.insert(`${fn.name}(`, ')')}>
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
    if (!this._dialogs.isOpen('image')) return nothing;
    const el = this._findSelectedElement();
    if (!el || el.type !== 'image') return nothing;
    const s = this._strings.designer;
    const close = (): void => this._closeImageModal();
    const used = usedImages(this._file, PLACEHOLDER_IMG);

    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.imageModalTitle}
        @keydown=${(e: KeyboardEvent) => this._modalFocus.handleKeydown(e, close)}>
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
    if (!this._dialogs.isOpen('sample') || !this._file) return nothing;
    const s = this._strings.designer;
    const template = this._file.template;
    const samples: Record<string, unknown> = template.sampleValues ?? {};
    const close = (): void => {
      this._dialogs.close('sample');
      this.requestUpdate();
    };

    // 반복 파라미터별 열 구조는 해당 파라미터를 처음 사용하는 그리드에서 가져온다.
    const tableOf = new Map<string, { key: string; title: string }[]>();
    for (const page of template.pages) {
      for (const el of page.elements) {
        if (el.type !== 'grid' || !el.repeat || tableOf.has(el.repeat.parameter)) continue;
        const fields: { key: string; title: string }[] = [];
        for (const cell of el.cells) {
          if (inItemBand(el, cell.row) && cell.parameter !== undefined
            && !fields.some((f) => f.key === cell.parameter)) {
            fields.push({ key: cell.parameter, title: cell.parameter });
          }
        }
        if (fields.length > 0) tableOf.set(el.repeat.parameter, fields);
      }
    }
    const parameters = this._collectParameters();
    // 이미지 파라미터는 텍스트 입력 대신 파일 선택기를 사용한다.
    const imageKeys = imageParameterKeys(this._file);
    // 파라미터 입력을 일정한 개수로 나눠 표시한다.
    const pageCount = Math.max(1, Math.ceil(parameters.length / SAMPLE_PAGE_SIZE));
    const pageIndex = Math.min(this._sample.page, pageCount - 1);
    const visible = parameters.slice(
      pageIndex * SAMPLE_PAGE_SIZE,
      (pageIndex + 1) * SAMPLE_PAGE_SIZE,
    );

    // JSON 초안이 객체가 아니거나 구문이 잘못되면 적용 버튼을 비활성화한다.
    let jsonError: string | null = null;
    if (this._sample.jsonMode && this._sample.jsonDraft.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(this._sample.jsonDraft);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          jsonError = s.jsonNotObject;
        }
      } catch {
        jsonError = s.jsonInvalid;
      }
    }

    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal modal-wide" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.sampleModalTitle}
        @keydown=${(e: KeyboardEvent) => this._modalFocus.handleKeydown(e, close)}>
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
              <button role="tab" aria-selected=${String(this._sample.jsonMode === jsonMode)}
                aria-label="${s.sampleData}: ${label}"
                @click=${() => this._sample.setJsonMode(
                  jsonMode,
                  // 선언된 파라미터와 현재 샘플 값을 합쳐 JSON 초안을 만든다.
                  () => JSON.stringify(this._sampleSkeleton(), null, 2),
                )}>${label}</button>`)}
          </div>
          ${this._sample.jsonMode
            ? html`
                <div class="cell-hint">${s.jsonHint}</div>
                <textarea class="sample-json" rows="14" spellcheck="false"
                  aria-label="${s.sampleData} JSON"
                  .value=${this._sample.jsonDraft}
                  @input=${(e: Event) =>
                    this._sample.setJsonDraft((e.target as HTMLTextAreaElement).value)}></textarea>
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
                            this._sample.setPage(pageIndex - 1);
                            this.requestUpdate();
                          }}>${icons.pagePrev}</button>
                        ${Array.from({ length: pageCount }, (_, i) => html`
                          <button class="page-btn"
                            aria-label="${s.sampleData} ${s.sidebarPages} ${i + 1}"
                            aria-pressed=${String(i === pageIndex)}
                            @click=${() => {
                              this._sample.setPage(i);
                              this.requestUpdate();
                            }}>${i + 1}</button>`)}
                        <button class="side-mini" title=${s.nextPage}
                          aria-label="${s.sampleData} ${s.nextPage}"
                          ?disabled=${pageIndex >= pageCount - 1}
                          @click=${() => {
                            this._sample.setPage(pageIndex + 1);
                            this.requestUpdate();
                          }}>${icons.pageNext}</button>
                      </div>`
                  : nothing}
                ${this._sample.imageError
                  ? html`<p class="image-error" role="alert">${this._sample.imageError}</p>`
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
          ${this._sample.jsonMode
            ? html`<button class="btn primary" ?disabled=${jsonError !== null}
                @click=${() => this._applySampleJson()}>${s.apply}</button>`
            : nothing}
          <button class="btn ${this._sample.jsonMode ? '' : 'primary'}" @click=${close}>
            ${s.close}
          </button>
        </div>
      </div>
    `;
  }

  /** JSON 초안을 sampleValues에 반영하고, 빈 객체이면 sampleValues를 제거한다. */
  private _applySampleJson(): void {
    const record = this._sample.parsedValues();
    if (record === null) return;
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
    this._forms.startSave(this._file.template.meta.title);
    this._dialogs.open('save');
  }

  /**
   * 입력한 제목을 양식에 반영하고 저장소에 저장한다.
   * 새 양식으로 저장하지 않는 한 기존 저장 ID를 재사용한다.
   */
  private async _confirmSave(): Promise<void> {
    const adapter = this.storage;
    if (!adapter || !this._file) return;
    const title = this._forms.title.trim();
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
    const id = this._forms.nextId();
    try {
      await adapter.save(id, structuredClone(this._file) as SlipFile);
    } catch (error) {
      this._forms.fail(error);
      return;
    }
    this._dialogs.close('save');
    this._forms.markSaved(id);
  }

  /** 저장된 양식의 메타데이터를 불러와 목록 모달을 연다. */
  private async _openMyForms(): Promise<void> {
    this._forms.startList();
    this._dialogs.open('myForms');
    await this._loadMyForms();
  }

  /**
   * 저장된 양식의 메타데이터를 모두 불러온다.
   * 검색과 페이지 이동은 이 목록을 사용하며 양식 본문은 불러오지 않는다.
   */
  private async _loadMyForms(): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    await this._forms.loadList(adapter);
  }

  /** 선택한 양식을 편집기에 불러오고 이전 상태를 실행 취소 기록에 추가한다. */
  private async _loadMyForm(id: string): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    let file: SlipFile;
    try {
      file = await adapter.load(id);
    } catch (error) {
      this._forms.fail(error);
      return;
    }
    if (file.kind !== 'template') {
      this._forms.fail(this._strings.designer.onlyTemplate);
      return;
    }
    this._pushUndo();
    this._file = file;
    this._forms.markLoaded(id);
    this._clearSelection();
    this._sideSelection = null;
    this._gridEdit.clearCell();
    this._pageIndex = 0;
    this._previewMode = false;
    this._dialogs.close('myForms');
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
      this._forms.fail(error);
      return;
    }
    this._forms.forget(id, MY_FORMS_PAGE_SIZE);
  }

  /** 양식 제목과 새 저장 여부를 입력하는 저장 모달을 렌더링한다. */
  private _renderSaveModal() {
    if (!this._dialogs.isOpen('save') || !this._file) return nothing;
    const s = this._strings.designer;
    const close = (): void => {
      this._dialogs.close('save');
      this.requestUpdate();
    };
    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.saveAsMyForm}
        @keydown=${(e: KeyboardEvent) => this._modalFocus.handleKeydown(e, close)}>
        <div class="modal-head">
          <span>${s.saveAsMyForm}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="prop-row">
            <label>${s.formTitle}</label>
            <input class="save-title" .value=${this._forms.title} aria-label=${s.formTitle}
              @input=${(e: Event) =>
                this._forms.setTitle((e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') void this._confirmSave();
              }}>
          </div>
          ${this._forms.savedId
            ? html`
                <label class="save-as-new">
                  <input type="checkbox" .checked=${this._forms.asNew} aria-label=${s.saveAsNew}
                    @change=${(e: Event) =>
                      this._forms.setAsNew((e.target as HTMLInputElement).checked)}>
                  <span>${s.saveAsNew}</span>
                </label>`
            : nothing}
          ${this._forms.error
            ? html`<div class="formula-status error">${this._forms.error}</div>`
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
    if (!this._dialogs.isOpen('myForms')) return nothing;
    const s = this._strings.designer;
    const close = (): void => {
      this._dialogs.close('myForms');
      this.requestUpdate();
    };
    return html`
      <div class="menu-backdrop modal-backdrop" @click=${close}></div>
      <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label=${s.myFormsList}
        @keydown=${(e: KeyboardEvent) => this._modalFocus.handleKeydown(e, close)}>
        <div class="modal-head">
          <span>${s.myFormsList}</span>
          <button class="modal-close" title=${s.close} aria-label=${s.close}
            @click=${close}>${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="prop-row">
            <label>${s.search}</label>
            <input class="forms-search" .value=${this._forms.query} aria-label=${s.search}
              @input=${(e: Event) =>
                this._forms.setQuery((e.target as HTMLInputElement).value)}>
          </div>
          ${this._forms.error
            ? html`<div class="formula-status error">${this._forms.error}</div>`
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
    const filtered = this._forms.filtered();
    if (filtered.length === 0) {
      return this._forms.error ? nothing : html`<div class="side-empty">${s.noSavedForms}</div>`;
    }
    const pageCount = Math.ceil(filtered.length / MY_FORMS_PAGE_SIZE);
    const page = Math.min(this._forms.page, pageCount - 1);
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
              @click=${() => this._forms.setPage(page - 1)}>${icons.pagePrev}</button>
            ${Array.from({ length: pageCount }, (_, i) => html`
              <button class="page-btn" aria-label="${s.myFormsList} ${s.sidebarPages} ${i + 1}"
                aria-pressed=${String(i === page)}
                @click=${() => this._forms.setPage(i)}>${i + 1}</button>`)}
            <button class="side-mini" title=${s.nextPage} aria-label="${s.myFormsList} ${s.nextPage}"
              ?disabled=${page >= pageCount - 1}
              @click=${() => this._forms.setPage(page + 1)}>${icons.pageNext}</button>
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
