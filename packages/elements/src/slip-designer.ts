import { LitElement, html, nothing } from 'lit';
import { designerStyles } from './styles/slip-designer.styles.js';
import {
  parseSlipFile,
  serializeSlipFile,
  validateSlipFile,
  RESERVED_REF_NAMES,
  evaluateFormula,
  diagnoseFormula,
  planSourcePage,
  SlipLayoutError,
  type FormulaContext,
  type FormulaDiagnosis,
  type FormulaValue,
  type GridItem,
  type SourcePagePlan,
  type SlipFile,
  type SlipTemplateFile,
  type SlipElement,
  type SlipPage,
  type GridElement,
  type BarcodeKind,
  type ParameterValueType,
  type SlipKit,
  type StorageAdapter,
} from '@omdc-slipkit/core';
import { getStrings } from './strings.js';
import { renderSlip, resolveFonts, type SlipDesignerSettings, type PaperSize } from './settings.js';
import {
  FontRegistryController,
  bundledFontSourceKey,
} from './designer/controllers/font-registry.js';
import {
  NO_DESIGNER_FONTS,
  baseFontName,
  collectUsedFontNames,
  effectiveFontName,
  selectableFontNames,
  variantCandidates,
  variantFontNames,
  type DesignerFonts,
  type FontStyleInput,
} from './designer/font-variant.js';
import { getPresets, type SlipPreset } from './presets.js';
import { pickImageFile } from './image-file.js';
import {
  MIN_SIZE_MM,
  round1,
  lineBoxFromLengthAngle,
  boxOf,
  setElementBox,
  THUMB_WIDTH_PX,
} from './designer/geometry.js';
import { setOptional, clearValueSources } from './designer/patch.js';
import { gridFormulaContext } from './designer/formula-context.js';
import type { ReservedAvailability } from './designer/formula-context.js';
import { checkFormula, TARGET_CHANGED } from './designer/formula-check.js';
import type { FormulaCheck } from './designer/formula-check.js';
import {
  collectFormulaWarnings,
  NO_FORMULA_WARNINGS,
  type FormulaWarnings,
} from './designer/formula-warning.js';
import {
  isConditionTarget,
  resolveFormulaTarget,
  verifyFormulaTarget,
  type FormulaTarget,
  type ResolvedFormulaTarget,
} from './designer/formula-target.js';
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
} from './designer/controllers/popover.js';
import { ColorPickerController } from './designer/controllers/color-picker.js';
import {
  listSelect,
} from './designer/render/inputs.js';
import type { ElementActions } from './designer/render/element-props.js';
import { MY_FORMS_PAGE_SIZE } from './designer/pagination.js';
import { BARCODE_KINDS, BARCODE_DIGIT_RULES } from './designer/barcode.js';
import { GRID_COLORS } from './designer/grid-view.js';
import type { GridColorId, CreatableType } from './designer/grid-view.js';
import type { ParameterInfo, ParameterFieldInfo } from './designer/parameters.js';
import {
  collectParameterUses,
  ensureParameterDef as ensureParameterDefIn,
  parameterUsesOf,
  renameParameterFieldReferences,
  renameParameterReferences,
} from './designer/parameters.js';
import type { FormActions } from './designer/render/form-props.js';
import { sampleItemsOf } from './designer/formula-context.js';
import { canvas } from './designer/render/canvas.js';
import { GridCommandsController } from './designer/controllers/grid-commands.js';
import type { GridCommandsHost } from './designer/controllers/grid-commands.js';
import { CanvasPointerController } from './designer/controllers/canvas-pointer.js';
import type { PointerHost } from './designer/controllers/canvas-pointer.js';
import {
  imageModal,
  sampleModal,
  saveModal,
  myFormsModal,
  confirmDeleteModal,
} from './designer/render/dialogs.js';
import type { DialogContext } from './designer/render/dialogs.js';
import { formulaCheckText, formulaModal } from './designer/render/formula-modal.js';
import type { FormulaModalView } from './designer/render/formula-modal.js';
import { toolbar } from './designer/render/toolbar.js';
import type { ToolbarActions } from './designer/render/toolbar.js';
import type { CanvasContext } from './designer/render/canvas.js';
import { propertyPanel } from './designer/render/property-panel.js';
import type { PanelContext } from './designer/render/property-panel.js';
import { sidebar } from './designer/render/sidebar.js';
import type { SidebarActions, SideSelection } from './designer/render/sidebar.js';
import type { GridActions } from './designer/render/grid-props.js';
import type { PanelKit } from './designer/render/panel-kit.js';
import { imagePickErrorText, PLACEHOLDER_IMG } from './designer/image-pick.js';
import type { ImagePickFailure } from './designer/image-pick.js';
import {
  GRID_DEFAULT_ROW_MM,
  GRID_DEFAULT_COL_MM,
  ensureCell,
  isGrid,
  gridHeaderTitle,
  itemBandOf,
  inItemBand,
  bandAt,
} from './designer/grid-model.js';

/** 파라미터 키와 충돌하지 않는 "새 값 등록" 항목의 내부 값 */
const NEW_BINDING_OPTION = '\u0000new';

/** 반복 그리드가 아닐 때 예약 참조 판정에 쓰는 빈 자리 */
const EMPTY_SLOT = {
  item: undefined,
  reserved: undefined,
  outputPage: undefined,
  groupIndex: undefined,
} as const;

/** 반복 그리드가 아닌 대상에서 예약 참조에 붙일 안내 */
const NOT_REPEAT_RESERVED: ReservedAvailability[] = RESERVED_REF_NAMES.map((name) => ({
  name,
  usable: false,
  reason: 'not-repeat',
}));

/** 편집 대상이 지워졌을 때 수식 모달이 그릴 상태 — 대상을 모르므로 참조도 안내하지 않습니다 */
const LOST_FORMULA_VIEW: FormulaModalView = {
  target: null,
  check: TARGET_CHANGED,
  itemCount: 0,
  currentItem: null,
  reserved: [],
};

const MAX_UNDO = 50;

/**
 * 되돌리기 한 단계 — 양식 스냅샷과 그 시점의 저장 식별자.
 * 불러온 양식을 되돌린 뒤 저장해도 불러온 양식을 덮어쓰지 않도록 식별자를 함께 되살립니다.
 */
interface UndoEntry {
  file: string;
  savedId: string | null;
}
/**
 * 업로드할 수 있는 이미지 파일의 기본 최대 크기(바이트).
 * base64로 담기면 약 33% 커지므로 2MB 원본이 파일에는 ~2.7MB로 들어갑니다.
 */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 새 요소의 기본 위치를 순차 이동할 간격과 반복 주기(mm) */
const NEW_ELEMENT_CASCADE_STEP_MM = 5;
const NEW_ELEMENT_CASCADE_WRAP_MM = 50;

/**
 * `.slip` 양식을 편집하는 `<slip-designer>` 컴포넌트.
 *
 * 캔버스 편집, 속성 패널, 요소 추가와 삭제,
 * 복사·붙여넣기, 되돌리기·다시 실행, 다중 페이지, 프리셋 불러오기, PDF 미리보기를
 * 제공합니다. 편집으로 양식이 바뀔 때마다 `slip-change` 이벤트로 파일을 내보냅니다.
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
    _paperSettingsError: { state: true },
    _barcodeKindsError: { state: true },
    _pendingDelete: { state: true },
  };

  src = '';

  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따릅니다.
   *
   * @defaultValue 영어
   */
  locale?: string;

  /**
   * 폰트·로케일·암호화 키 공통 설정 인스턴스.
   * PDF 미리보기와 수식 평가는 이 인스턴스의 설정을 사용합니다.
   * `getFonts`가 없으면 동봉 기본 폰트로 렌더링합니다.
   */
  slipkit?: SlipKit;

  /**
   * 바코드 종류와 용지 정보를 제공하는 호스트 설정.
   * 생략하면 기본 용지만 표시합니다.
   */
  settings?: SlipDesignerSettings;

  /**
   * 툴바에 표시할 양식 프리셋 목록.
   * 지정하면 기본 프리셋을 대체합니다.
   */
  presets?: SlipPreset[];

  /**
   * "내 양식" 저장과 불러오기에 사용할 저장소 어댑터.
   * 지정한 경우에만 관련 도구를 표시합니다.
   */
  storage?: StorageAdapter;

  /**
   * 업로드할 수 있는 이미지 파일의 최대 크기(바이트).
   *
   * @remarks
   * base64 인코딩 결과는 원본보다 약 33% 크므로 호스트의 저장 및 전송 제한에 맞게
   * 크기를 지정할 수 있습니다.
   * HTML 속성으로도 줄 수 있습니다: `<slip-designer max-image-bytes="1048576">`.
   */
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES;

  private _file: SlipTemplateFile | null = null;
  private _pageIndex = 0;
  /** 현재 양식 페이지에서 보고 있는 출력 페이지 (0부터) */
  private _outputPage = 0;
  /** 선택한 반복 그리드를 원본 행 구조 대신 현재 출력 결과로 표시할지 여부 */
  private _gridPlanPreview = false;
  /** 현재 양식 페이지의 계획 캐시 — 페이지·샘플 값이 바뀌면 다시 계산합니다 */
  private _planCache: { key: string; plan: SourcePagePlan | null; error: SlipLayoutError | null } | null = null;
  /** 속성 패널과 크기 조절 핸들이 대상으로 삼는 주 선택 요소 */
  private _selectedId: string | null = null;
  /**
   * 선택된 요소 ID 모음. 주 선택 요소를 포함하며 이동, 삭제, 그룹화에 사용합니다.
   */
  private _selectedIds = new Set<string>();
  /** 호스트가 `settings.getPaperSizes`로 제공한 추가 용지 목록 */
  private _hostPaperSizes: PaperSize[] = [];
  /** 호스트가 `settings.getBarcodeKinds`로 제한한 바코드 종류  */
  private _hostBarcodeKinds: BarcodeKind[] = [];
  /** 호스트 용지 목록을 읽거나 저장하지 못했을 때 패널에 표시할 안내 */
  private _paperSettingsError: string | null = null;
  /** 호스트 바코드 종류를 읽지 못했을 때 패널에 표시할 안내 */
  private _barcodeKindsError: string | null = null;
  /** `settings`가 바뀔 때마다 올려 늦게 온 호스트 응답을 버리는 세대 */
  private _settingsGeneration = 0;
  /** 내 양식 불러오기가 시작될 때마다 올려 늦게 온 응답을 버리는 세대 */
  private _loadGeneration = 0;
  /** 삭제 확인 모달이 가리키는 저장된 양식 */
  private _pendingDelete: { id: string; title: string } | null = null;
  /** 사용자 지정 용지 이름의 편집 중 값 */
  private _paperSaveName = '';
  private _undoStack: UndoEntry[] = [];
  private _redoStack: UndoEntry[] = [];
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
  /** 마지막으로 툴바 메뉴를 연 버튼 — 키보드로 닫을 때 초점을 되돌립니다 */
  private _menuOpener: HTMLElement | null = null;
  /** 다음 렌더 뒤 툴바 메뉴의 첫 항목으로 초점을 옮길지 (키보드로 열었을 때) */
  private _focusMenuItem = false;
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
   * 요소를 선택하면 `null`이 됩니다.
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
  /** 오류가 발생한 속성 입력의 식별자. 없으면 패널 전체 오류입니다. */
  private _inputErrorField: string | null = null;
  /** 페이지 키 중복 오류 여부 */
  private _pageKeyError = false;
  /**
   * 요소 ID별 좌표 기준점의 ANCHORS 인덱스.
   * 파일에는 저장하지 않으며 기본값은 왼쪽 위입니다.
   */
  private _anchorByElement = new Map<string, number>();
  /** 컴포넌트 속성이 우선하고, 없으면 slipkit 설정을 따르는 UI 언어 로케일 */
  private get _locale(): string | undefined {
    return this.locale ?? this.slipkit?.locale;
  }

  /** 동봉 기본 폰트와 PDF 렌더링에 사용할 로케일 — `renderSlip`과 같은 기준입니다 */
  private get _renderLocale(): string | undefined {
    return this.slipkit?.locale ?? this.locale;
  }

  /** 수식·조건식 평가에 사용할 로케일 — slipkit이 있으면 인스턴스 설정을 따릅니다 */
  private get _evalLocale(): string | undefined {
    return this.slipkit ? this.slipkit.locale : this.locale;
  }

  /** 현재 locale의 문구 사전 */
  private get _strings() {
    return getStrings(this._locale);
  }

  /**
   * 수식을 평가합니다. slipkit이 있으면 같은 인스턴스로 평가해 호스트의 렌더 결과와 맞춥니다.
   * 수식 로케일은 인스턴스 설정을 따릅니다 — 컴포넌트 locale은 UI 언어 전용입니다.
   */
  private _evaluate(source: string, context: FormulaContext): FormulaValue {
    if (this.slipkit) return this.slipkit.evaluate(source, context);
    const locale = this._evalLocale;
    return evaluateFormula(source, locale === undefined ? context : { ...context, locale });
  }

  /** 수식을 계산할 수 있는지 진단합니다. 평가와 같은 로케일로 오류 문구를 맞춥니다 */
  private _diagnose(source: string, context: FormulaContext): FormulaDiagnosis {
    const locale = this._evalLocale;
    return diagnoseFormula(source, locale === undefined ? context : { ...context, locale });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  constructor() {
    super();
    // 상태를 갖고 호스트에 갱신을 요청하는 컨트롤러만 등록합니다.
    // `_gridCommands`는 자체 상태가 없고 `_modalFocus`는 갱신을 요청하지 않습니다.
    for (const controller of [
      this._dialogs,
      this._fontRegistry,
      this._pointer,
      this._popovers,
      this._picker,
      this._gridEdit,
      this._forms,
      this._sample,
      this._formula,
    ]) {
      this.addController(controller);
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // 연결이 끊긴 동안 외부 폰트 조회가 성공했을 수 있으므로 실패 상태일 때만 다시 확인합니다.
    this._retryFontSource();
    this.addEventListener('keydown', this._onKeyDown);
    if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '0');
    }
    // 분리될 때 미리보기 결과를 버렸으므로, 미리보기가 열려 있었으면 현재 양식으로 다시 만듭니다.
    if (this._previewMode && this._file) void this._renderPreview();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._onKeyDown);
    this._revokePreviewUrl();
  }

  // 파싱 결과가 같은 렌더링에 반영되도록 렌더링 전에 처리합니다.
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src')) {
      this._parseSource();
    }
    // 설정 기반 목록은 업데이트가 끝난 뒤 추가 렌더를 예약하지 않도록 미리 불러옵니다.
    if (changed.has('settings')) {
      this._settingsGeneration += 1;
      void this._loadPaperSizes();
      void this._loadBarcodeKinds();
    }
    // PDF에 영향을 주는 로케일이나 인스턴스가 바뀌면 열려 있는 미리보기를 다시 만듭니다.
    if (this._previewMode && this._file && (changed.has('locale') || changed.has('slipkit'))) {
      const previousSlipkit = changed.has('slipkit') ? changed.get('slipkit') as SlipKit | undefined : this.slipkit;
      const previousLocale = changed.has('locale') ? changed.get('locale') as string | undefined : this.locale;
      const previousRenderLocale = previousSlipkit?.locale ?? previousLocale;
      if (previousSlipkit !== this.slipkit || previousRenderLocale !== this._renderLocale) {
        void this._renderPreview();
      }
    }
    // 폰트 목록은 slipkit의 공급 함수 또는 로케일별 동봉 기본 폰트에서 가져옵니다.
    // 같은 출처는 다시 가져오지 않으므로 첫 갱신을 포함해 매번 확인합니다.
    this._useFontSource();
  }

  /** 열려 있는 모달 */
  private readonly _dialogs = new DialogsController(this);

  /** 폰트 목록과 브라우저 등록 상태 */
  private readonly _fontRegistry = new FontRegistryController(this);

  /** 속성 패널 렌더 모듈에 넘길 공통 입력 도구 */
  private get _kit(): PanelKit {
    return {
      s: this._strings.designer,
      reject: (message, field) => this._rejectInput(message, field),
      error: (field) => this._renderInputError(field),
      hasError: (field) => this._hasInputError(field),
      acceptFormula: (target, value, field) => this._acceptFormula(target, value, field),
      openFormulaModal: (target) => this._openFormulaModal(target),
      listSelect: (config) => listSelect(this._popovers, (id, event) => this._toggleListSelect(id, event), config),
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
      fonts: this._fonts,
      setFieldSource: (kind) => this._setFieldSource(kind),
      parameterSelect: (current) => this._renderParameterSelect(current),
      barcodeParameterSelect: (current) => this._renderBarcodeParameterSelect(current),
      barcodeKinds: () => this._barcodeKinds(),
      barcodeKindsError: this._barcodeKindsError,
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

  /** 그리드 편집 작업 */
  private readonly _gridCommands = new GridCommandsController(this._gridCommandsHost());

  /** 그리드 조작이 컴포넌트에 요청하는 것 */
  private _gridCommandsHost(): GridCommandsHost {
    const owner = this;
    return {
      get s() { return owner._strings.designer; },
      get edit() { return owner._gridEdit; },
      selectedElement: () => this._findSelectedElement(),
      updateElement: (fn) => this._updateElement(fn),
      reject: (message, field) => this._rejectInput(message, field),
      resetPanelErrors: () => this._resetPanelErrors(),
      clearInputError: () => this._clearInputError(),
      ensureParameterDef: (key, valueType) =>
        this._ensureParameterDef(key, valueType as ParameterValueType | undefined),
      parameters: () => this._parameterList(),
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

  /** 모달 화면의 상태와 조작 */
  private get _dialogContext(): DialogContext {
    return {
      s: this._strings.designer,
      locale: this._locale,
      dialogs: this._dialogs,
      modalFocus: this._modalFocus,
      formula: this._formula,
      sample: this._sample,
      forms: this._forms,
      file: this._file,
      imageError: this._imageError,
      maxImageBytes: this.maxImageBytes,
      parameters: () => this._parameterList(),
      parameterKeys: () => this._collectParameters(),
      sampleSkeleton: () => this._sampleSkeleton(),
      selectedElement: () => this._findSelectedElement(),
      typeName: (type) => this._typeName(type),
      formulaView: () => this._formulaView(),
      applyFormula: () => this._applyFormulaModal(),
      closeFormula: () => this._closeFormulaModal(),
      applyImageSrc: (src) => this._applyImageSrc(src),
      closeImage: () => this._closeImageModal(),
      pickImageFile: () => void this._pickImageFile(),
      pickSampleImage: (key) => void this._pickSampleImage(key),
      setSampleValue: (key, value) => this._setSampleValue(key, value),
      applySampleJson: () => this._applySampleJson(),
      confirmSave: () => void this._confirmSave(),
      loadMyForm: (id) => void this._loadMyForm(id),
      deleteMyForm: (id) => this._askDeleteMyForm(id),
      pendingDelete: this._pendingDelete,
      confirmDeleteMyForm: () => void this._deleteMyForm(),
      cancelDeleteMyForm: () => this._cancelDeleteMyForm(),
      refresh: () => this.requestUpdate(),
    };
  }

  /** 툴바의 상태와 조작 */
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
      closeMenus: (restoreFocus) => this._closeToolbarMenus(restoreFocus === true),
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

  /** 이번 렌더에서 사이드바와 캔버스가 함께 쓰는 경고 집계 */
  private _warnings: FormulaWarnings = NO_FORMULA_WARNINGS;

  /** 이번 렌더에서 속성 패널과 캔버스가 함께 쓰는 폰트 상태 */
  private _fonts: DesignerFonts = NO_DESIGNER_FONTS;

  /** 폰트 출처를 마지막으로 정할 때의 설정. 같으면 다시 확인하지 않습니다 */
  private _fontSourceFor: { slipkit: SlipKit | undefined; locale: string | undefined } | null = null;

  /** 캔버스의 상태와 조작 */
  private get _canvasContext(): CanvasContext {
    return {
      s: this._strings.designer,
      formulaWarnings: this._warnings,
      fonts: this._fonts,
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
      focusFormulaWarning: (target) => this._focusFormulaTarget(target),
      typeName: (type) => this._typeName(type),
      setGridPlanPreview: (enabled) => this._setGridPlanPreview(enabled),
      trackCursor: (event) => this._pointer.trackCursor(event),
      clearCursor: () => this._pointer.clearCursor(),
      setOutputPage: (page) => {
        this._outputPage = page;
        this.requestUpdate();
      },
      selectedElement: () => this._findSelectedElement(),
      commitCellContent: (value) => this._gridCommands.commitCellContent(value),
      focusSelectedElement: () => this._focusSelectedElement(),
      evaluate: (source, context) => this._evaluate(source, context),
      onBandRowClick: (row, extend) => this._onBandRowClick(row, extend),
      closeBandMenu: (clearSelection) => this._closeBandMenu(clearSelection),
      onBandMenuKeyDown: (event) => this._onBandMenuKeyDown(event),
      setRowBandRole: (fromRow, toRow, placement) => this._gridCommands.setRowBandRole(fromRow, toRow, placement),
      refresh: () => this.requestUpdate(),
    };
  }

  /** 속성 패널의 조작 모음 */
  private get _panelContext(): PanelContext {
    return {
      kit: this._kit,
      element: this._actions,
      form: this._formActions,
      grid: this._gridActions,
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
      formulaWarnings: this._warnings,
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
      paperSettingsError: this._paperSettingsError,
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
      refresh: () => this.requestUpdate(),
      toggleListSelect: (id, event) => this._toggleListSelect(id, event),
      parameters: () => this._parameterList(),
      planError: () => this._planError(),
      changeRows: (delta) => this._gridCommands.changeRows(delta),
      changeColumns: (delta) => this._gridCommands.changeColumns(delta),
      setTrack: (kind, index, mm) => this._gridCommands.setTrack(kind, index, mm),
      toggleRepeat: (on) => this._gridCommands.toggleRepeat(on),
      setRepeatParameter: (key) => this._gridCommands.setRepeatParameter(key),
      setRepeatMaxItems: (value) => this._gridCommands.setRepeatMaxItems(value),
      setPagination: (patch) => this._gridCommands.setPagination(patch),
      toggleGroupField: (key, on) => this._gridCommands.toggleGroupField(key, on),
      clearCellSelection: () => this._gridCommands.clearCellSelection(),
      setRowBandRole: (fromRow, toRow, placement) => this._gridCommands.setRowBandRole(fromRow, toRow, placement),
      setBandSelectionBoundary: (boundary, rowNumber, bandId) =>
        this._gridCommands.setBandSelectionBoundary(boundary, rowNumber, bandId),
      setBandPages: (bandId, pages) => this._gridCommands.setBandPages(bandId, pages),
      setBandRepeatOnPageBreak: (bandId, on) => this._gridCommands.setBandRepeatOnPageBreak(bandId, on),
      addRowWithRole: (placement, options) => this._gridCommands.addRowWithRole(placement, options),
      openRowCommand: (command) => this._gridCommands.openRowCommand(command),
      applyRowCommand: () => this._gridCommands.applyRowCommand(),
      chooseCellSource: (kind) => this._gridCommands.chooseCellSource(kind),
      setCellSource: (kind, value) => this._gridCommands.setCellSource(kind, value),
      commitCellContent: (value) => this._gridCommands.commitCellContent(value),
      setCellSpan: (kind, value) => this._gridCommands.setCellSpan(kind, value),
      updateCellStyle: (key, value) => this._gridCommands.updateCellStyle(key, value),
      resetCellStyles: (keys) => this._gridCommands.resetCellStyles(keys),
      updateCellConditionalFormats: (next) => this._gridCommands.updateCellConditionalFormats(next),
      cellParameterSelect: (el, current, inBand) => this._gridCellParameterSelect(el, current, inBand),
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
    // 인라인 셀 편집을 열면 바로 입력할 수 있게 포커스를 줍니다
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
    // 키보드로 연 툴바 메뉴는 첫 항목부터 방향키로 고를 수 있게 초점을 옮깁니다.
    if (this._focusMenuItem) {
      this._focusMenuItem = false;
      (this.renderRoot.querySelector('.toolbar [role="menuitem"]') as HTMLElement | null)?.focus();
    }
    this._modalFocus.sync();
  }

  // ---------------------------------------------------------------------------
  // Source parsing
  // ---------------------------------------------------------------------------

  private _parseSource(): void {
    // 진행 중인 내 양식 불러오기는 새 소스가 우선이므로 그 결과를 버립니다.
    this._loadGeneration += 1;
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
    this._gridMenuOpen = false;
    this._gridEdit.clearCell();
    this._pointer.cancelLine();
    this._dialogs.closeAllQuietly();
    this._pendingDelete = null;
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
   * 반복 그리드에서 사용하는 목록 파라미터와 하위 필드를 정의에 추가합니다.
   *
   * @remarks
   * 정의되지 않은 반복 파라미터는 목록으로 추가하고 항목 구간의 셀 파라미터는 하위 필드로
   * 추가합니다. 이미 지정된 값 종류와 레이블은 변경하지 않습니다. 목록이 아닌 파라미터에는
   * 하위 필드를 추가하지 않습니다.
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
          // 값 종류가 없는 파라미터만 목록으로 설정합니다.
          def.valueType = 'list';
          changed = true;
        }
        if (def.valueType !== 'list') continue;
        const fields = def.fields ?? [];
        for (const cell of el.cells) {
          if (cell.parameter === undefined || cell.row < fromRow || cell.row > toRow) continue;
          if (fields.some((f) => f.key === cell.parameter)) continue;
          // 같은 열의 헤더 텍스트를 하위 필드의 레이블로 사용합니다.
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
    this._undoStack.push({ file: snapshot, savedId: this._forms.savedId });
    this._redoStack = [];
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
  }

  /**
   * 되돌리기 한 단계를 되살립니다 — 양식과 그 시점의 저장 식별자를 함께 돌려놓습니다.
   *
   * @param from - 꺼낼 쪽
   * @param to - 지금 상태를 넣을 쪽
   */
  private _restoreUndoEntry(from: UndoEntry[], to: UndoEntry[]): void {
    if (from.length === 0 || !this._file) return;
    to.push({ file: JSON.stringify(this._file), savedId: this._forms.savedId });
    const entry = from.pop()!;
    this._file = JSON.parse(entry.file) as SlipTemplateFile;
    this._forms.restoreSavedId(entry.savedId);
    this._clampPageIndex();
    this._validateSelection();
    this._emitChange();
  }

  /**
   * 잘못된 입력을 모델에 반영하지 않고 오류 메시지를 표시합니다.
   *
   * @param message - 표시할 문구 (생략하면 기본 안내)
   * @param field - 오류가 발생한 속성 입력 식별자
   */
  private _rejectInput(message?: string, field?: string): void {
    this._inputError = message ?? this._strings.designer.invalidInput;
    this._inputErrorField = field ?? null;
    this.requestUpdate();
  }

  /** 현재 속성 패널의 입력 오류 상태를 초기화합니다. */
  private _resetPanelErrors(): void {
    this._inputError = null;
    this._inputErrorField = null;
    this._parameterKeyError = false;
    this._pageKeyError = false;
  }

  /** 마지막 입력 오류 메시지를 지웁니다. */
  private _clearInputError(): void {
    if (this._inputError === null) return;
    this._inputError = null;
    this._inputErrorField = null;
    this.requestUpdate();
  }

  /** 지정한 입력에 연결된 오류를 렌더링합니다. */
  private _renderInputError(field: string) {
    if (this._inputError === null || this._inputErrorField !== field) return nothing;
    return html`<div id="error-${field}" class="input-error field-error" role="alert">${this._inputError}</div>`;
  }

  /** 지정한 입력에 현재 오류가 있는지 확인합니다. */
  private _hasInputError(field: string): boolean {
    return this._inputError !== null && this._inputErrorField === field;
  }

  private _undo(): void {
    this._restoreUndoEntry(this._undoStack, this._redoStack);
  }

  private _redo(): void {
    this._restoreUndoEntry(this._redoStack, this._undoStack);
  }

  /** 현재 페이지 인덱스를 문서의 페이지 범위로 제한합니다. */
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
   * 페이지 레이블이 있으면 반환하고 없으면 페이지 번호로 이름을 만듭니다.
   *
   * @param page - 페이지
   * @param index - 페이지 번호(0-기반)
   * @returns 화면에 표시할 이름
   */
  private _pageDisplayName(page: { label?: string | undefined }, index: number): string {
    const label = page.label?.trim();
    return label !== undefined && label !== ''
      ? label
      : this._strings.designer.pageLabel.replace('{n}', String(index + 1));
  }

  /**
   * 페이지 행 옆에 화면 경계를 벗어나지 않도록 미리보기를 표시합니다.
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

  /** 현재 행의 페이지 미리보기를 숨깁니다. */
  private _hidePageThumb(index: number): void {
    if (this._thumbPage !== index) return;
    this._thumbPage = null;
    this._thumbPos = null;
  }

  /** 용지 비율에 맞춘 페이지 미리보기 높이(px)를 계산합니다. */
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

  /** 현재 페이지 뒤에 빈 페이지를 추가하고 그 페이지로 이동합니다 */
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

  /** 현재 페이지를 삭제합니다 (마지막 한 페이지는 삭제 불가) */
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

  private _currentPage(): SlipPage | undefined {
    return this._file?.template.pages[this._pageIndex];
  }

  private _currentElements(): SlipElement[] | undefined {
    return this._currentPage()?.elements;
  }

  private _findElement(id: string): SlipElement | undefined {
    return this._currentElements()?.find((el) => el.id === id);
  }

  private _findSelectedElement(): SlipElement | undefined {
    return this._selectedId ? this._findElement(this._selectedId) : undefined;
  }

  /** 현재 페이지에서 같은 그룹 ID를 가진 요소를 반환합니다. */
  private _pageGroupMembers(group: string): SlipElement[] {
    return (this._currentElements() ?? []).filter((el) => el.group === group);
  }

  /** 주 선택 요소와 선택된 요소 목록을 초기화합니다. */
  private _clearSelection(): void {
    this._resetPanelErrors();
    this._selectedId = null;
    this._selectedIds = new Set();
    this._gridPlanPreview = false;
    this._gridEdit.reset();
  }

  /**
   * 요소를 선택합니다. 그룹에 속한 요소이면 같은 그룹을 함께 선택합니다.
   *
   * @param id - 선택할 요소 id
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
   * 요소를 다중 선택 목록에 추가하거나 제거합니다.
   * 추가한 요소는 주 선택이 되며 주 선택을 제거하면 남은 요소 중 하나를 주 선택으로 지정합니다.
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
    // 복원 또는 삭제로 사라진 요소를 선택 목록에서 제거합니다.
    if (this._selectedIds.size > 0) {
      const alive = new Set([...this._selectedIds].filter((id) => this._findElement(id)));
      if (alive.size !== this._selectedIds.size) this._selectedIds = alive;
      if (this._selectedId === null) this._selectedId = alive.values().next().value ?? null;
    }
    // 선택된 셀이 현재 그리드 범위 안에 있는지 확인하고 벗어난 셀은 선택에서 뺍니다.
    if (this._gridEdit.cell) {
      const el = this._findSelectedElement();
      if (!isGrid(el)) this._gridEdit.clearCell();
      else this._gridEdit.pruneCells(el.rows.length, el.columns.length);
    }
  }

  // ---------------------------------------------------------------------------
  // Element CRUD
  // ---------------------------------------------------------------------------

  /**
   * 요소를 추가합니다. 위치를 지정하지 않으면 용지 여백에서 순차적으로 이동한 위치를 사용합니다.
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
        // 새 그리드는 반복 설정이 없는 정적 그리드로 시작합니다 (§7.1).
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
        // 다각형의 변 수는 도형 메뉴에서 선택한 값을 사용합니다.
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
        // 새 바코드는 QR Code를 기본 종류로 사용합니다.
        element = {
          type: 'barcode', id, name, position, width: 25, height: 25,
          kind: 'qrcode', parameter: `barcode_${id.slice(0, 4)}`,
        };
        break;
    }

    // 드래그로 지정한 크기를 적용합니다. 그리드는 행과 열 크기를 이 크기에 맞춥니다 (SPEC §5.7).
    setElementBox(
      element,
      place?.width === undefined ? undefined : Math.max(MIN_SIZE_MM, round1(place.width)),
      place?.height === undefined ? undefined : Math.max(MIN_SIZE_MM, round1(place.height)),
    );
    // 새 요소의 위치를 용지 범위로 제한합니다.
    const box = boxOf(element);
    element.position = {
      x: round1(Math.max(0, Math.min(element.position.x, paper.width - box.width))),
      y: round1(Math.max(0, Math.min(element.position.y, paper.height - box.height))),
    };

    elements.push(element);
    this._selectElement(id);
    this._sideSelection = null;
    // 새 요소가 사용하는 파라미터를 정의 목록에 등록합니다 — 변경 이벤트로 내보내는 파일에 함께 담깁니다.
    this._ensureElementParameterDef(element);
    this._emitChange();
    this.requestUpdate();
  }

  private _copySelected(): void {
    const elements = this._currentElements();
    if (!elements || this._selectedIds.size === 0) return;
    // 선택된 요소와 그룹을 함께 복사합니다.
    const selected = elements.filter((el) => this._selectedIds.has(el.id));
    if (selected.length === 0) return;
    this._clipboard = JSON.parse(JSON.stringify(selected)) as SlipElement[];
    this.requestUpdate();
  }

  private _paste(): void {
    const elements = this._currentElements();
    if (!elements || !this._clipboard || this._clipboard.length === 0) return;

    this._pushUndo();

    // 복사한 그룹에는 원본과 다른 그룹 ID를 부여합니다.
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
      this._ensureElementParameterDef(copy);
      elements.push(copy);
      pasted.push(copy);
    }
    // 다음 붙여넣기 위치가 이동하도록 클립보드 좌표를 갱신합니다.
    for (const src of this._clipboard) {
      src.position = { x: round1(src.position.x + 5), y: round1(src.position.y + 5) };
    }

    // 붙여넣은 요소를 모두 선택합니다.
    this._selectedId = pasted[0]!.id;
    this._selectedIds = new Set(pasted.map((el) => el.id));
    this._sideSelection = null;
    this._emitChange();
    this.requestUpdate();
  }

  /**
   * 요소가 참조하는 파라미터를 정의 목록에 등록합니다 (필드·바코드·이미지, 반복 그리드의 목록).
   *
   * @param element - 새로 만들거나 붙여넣은 요소
   */
  private _ensureElementParameterDef(element: SlipElement): void {
    if ((element.type === 'field' || element.type === 'barcode') && element.parameter !== undefined) {
      this._ensureParameterDef(element.parameter);
    }
    if (element.type === 'image' && element.parameter !== undefined) {
      this._ensureParameterDef(element.parameter, 'image');
    }
    if (element.type === 'grid' && element.repeat) {
      this._ensureParameterDef(element.repeat.parameter, 'list');
    }
  }

  /** 선택된 요소를 모두 삭제합니다. */
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
    // 문서가 변경되면 저장 완료 상태를 해제합니다.
    this._forms.clearNotice();
    const file = structuredClone(this._file) as SlipFile;
    this.dispatchEvent(
      new CustomEvent('slip-change', { detail: { file }, bubbles: true, composed: true }),
    );
  }

  /**
   * 선택된 요소를 수정합니다. 선택이 유효하지 않으면 입력 오류를 표시합니다.
   *
   * @param fn - 요소 수정 함수
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

  /** 키보드 단축키가 듣도록 호스트에 포커스를 줍니다 — 이미 안쪽에 있으면 건드리지 않습니다 */
  private _focusHost(): void {
    if (this.contains(document.activeElement) || this.renderRoot.contains(this.shadowRoot?.activeElement ?? null)) {
      return;
    }
    this.focus({ preventScroll: true });
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    // 입력 필드 안에서는 편집기 단축키를 가로채지 않습니다.
    // Shadow DOM 안에서 올라온 이벤트는 호스트에서 target이 호스트 요소로
    // 재지정(retargeting)되므로, 실제 입력 대상은 composedPath의 첫 항목으로 판정합니다.
    const target = e.composedPath()[0] ?? e.target;
    const inFormField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (inFormField) return;

    // 모달이 열려 있으면 Esc는 모달 닫기 (모달 안 입력란의 Esc는 모달 자체가 처리)
    if (e.key === 'Escape' && this._dialogs.anyOpen) {
      this._dialogs.closeAllQuietly();
      this._pendingDelete = null;
      this._imageError = null;
      this.requestUpdate();
      return;
    }
    // 모달이 열려 있는 동안 문서 명령(삭제·되돌리기·복사 등)은 뒤의 양식에 닿지 않습니다.
    if (this._dialogs.anyOpen) return;

    if (e.key === 'Escape' && this._toolbarMenuOpen) {
      e.preventDefault();
      this._closeToolbarMenus(true);
      return;
    }
    if (e.key === 'Escape' && (this._pointer.pendingTool || this._pointer.draw || this._pointer.lineDraft)) {
      this._pointer.cancelDrawing();
      this.requestUpdate();
    }
    // PDF 미리보기 상태에서는 문서를 변경하는 단축키를 처리하지 않습니다.
    if (this._previewMode) return;
    // 출력 결과는 읽기 전용입니다. Esc만 행 구조 편집으로 돌아가는 데 사용합니다.
    if (this._gridPlanPreview) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._setGridPlanPreview(false);
      }
      return;
    }
    // 셀이 선택된 상태의 Esc는 셀 선택만 해제하고 그리드 요소 선택은 유지합니다.
    // 인라인 편집 중의 Esc는 캔버스 입력기가 편집 종료로 처리합니다.
    if (e.key === 'Escape' && this._gridEdit.cell !== null && !this._gridEdit.editing) {
      e.preventDefault();
      this._gridCommands.clearCellSelection();
      return;
    }
    // 셀을 고른 동안의 Delete·Backspace는 셀에 대한 조작이므로 그리드 요소를 지우지 않습니다.
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedId && this._gridEdit.cell === null) {
      e.preventDefault();
      this._deleteSelected();
    }
    // Shift를 함께 누르면 `e.key`가 대문자로 오므로 소문자로 맞춰 비교합니다.
    const key = e.key.toLowerCase();
    const command = e.ctrlKey || e.metaKey;
    if (key === 'c' && command) {
      this._copySelected();
    }
    if (key === 'v' && command) {
      e.preventDefault();
      this._paste();
    }
    if (key === 'z' && command) {
      e.preventDefault();
      if (e.shiftKey) this._redo();
      else this._undo();
    }
    if (key === 'y' && command) {
      e.preventDefault();
      this._redo();
    }
    if (key === 'b' && command) {
      e.preventDefault();
      this._showBadges = !this._showBadges;
      this.requestUpdate();
    }
  };

  /** 인라인 셀 편집을 마친 뒤 초점을 선택한 요소로, 없으면 컴포넌트로 되돌립니다. */
  private _focusSelectedElement(): void {
    void this.updateComplete.then(() => {
      const id = this._selectedId;
      const target = id === null
        ? null
        : this.renderRoot.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (target !== null) target.focus({ preventScroll: true });
      else this._focusHost();
    });
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  private _revokePreviewUrl(): void {
    // 모드나 소스가 바뀌기 전에 시작한 렌더 결과는 적용하지 않습니다.
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
    await this._renderPreview();
  }

  /**
   * 현재 양식으로 PDF 미리보기를 만듭니다.
   * 시작 뒤에 소스·로케일·인스턴스가 바뀌거나 분리되면 그 결과는 버립니다.
   */
  private async _renderPreview(): Promise<void> {
    if (!this._file) return;
    this._previewError = null;
    this._revokePreviewUrl();

    const gen = ++this._previewGeneration;
    try {
      // 샘플 값이 있으면 해당 값을 적용한 전표를 미리보기로 렌더링합니다.
      // 파일 자체는 양식 그대로 두고 렌더 입력만 전표 형태로 만듭니다.
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
      if (gen !== this._previewGeneration || !this.isConnected) return;
      // 렌더링이 성공했다면 후속 폰트 조회도 성공했을 수 있으므로 출처를 다시 확인합니다.
      this._retryFontSource();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      this._previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error('[slip-designer] PDF preview failed:', error);
      if (gen !== this._previewGeneration) return;
      // 미리보기 화면에 오류를 표시하고 편집 버튼은 유지합니다.
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
    // 사이드바와 캔버스가 동일한 경고 집계를 사용하도록 렌더링마다 한 번만 수집합니다.
    this._warnings = this._collectFormulaWarnings();
    this._fonts = this._collectFonts();

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
            ${formulaModal(this._dialogContext)}
            ${imageModal(this._dialogContext)}
            ${sampleModal(this._dialogContext)}
            ${saveModal(this._dialogContext)}
            ${myFormsModal(this._dialogContext)}
            ${confirmDeleteModal(this._dialogContext)}
          `}
    `;
  }

  // ---------------------------------------------------------------------------
  // Render: toolbar
  // ---------------------------------------------------------------------------

  private _gridLine(): string {
    return GRID_COLORS.find((color) => color.id === this._gridColor)!.line;
  }

  /** 툴바 메뉴(프리셋·도형·격자) 가운데 하나라도 열려 있는지 */
  private get _toolbarMenuOpen(): boolean {
    return this._presetMenuOpen || this._shapeMenuOpen || this._gridMenuOpen;
  }

  /**
   * 툴바 메뉴를 모두 닫습니다.
   *
   * @param restoreFocus - 메뉴를 연 버튼으로 초점을 되돌리면 true
   */
  private _closeToolbarMenus(restoreFocus: boolean): void {
    this._presetMenuOpen = false;
    this._shapeMenuOpen = false;
    this._gridMenuOpen = false;
    if (restoreFocus && this._menuOpener?.isConnected) this._menuOpener.focus();
    this.requestUpdate();
  }

  /**
   * 툴바 메뉴를 연 버튼을 기억하고 키보드로 열었으면 첫 항목으로 초점을 옮기도록 표시합니다.
   * 키보드로 누른 클릭은 `detail`이 0입니다.
   *
   * @param e - 메뉴 버튼의 클릭 이벤트
   * @returns 메뉴를 붙일 화면 좌표
   */
  private _openToolbarMenu(e: Event): { left: number; top: number } {
    const button = e.currentTarget as HTMLElement;
    this._menuOpener = button;
    this._focusMenuItem = (e as MouseEvent).detail === 0;
    const rect = button.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 4 };
  }

  /** 격자 설정 메뉴를 열거나 닫습니다. */
  private _toggleGridMenu(e: Event): void {
    if (this._gridMenuOpen) {
      this._gridMenuOpen = false;
    } else {
      this._gridMenuPos = this._openToolbarMenu(e);
      this._gridMenuOpen = true;
    }
    this.requestUpdate();
  }

  /** 격자 간격을 설정합니다. `null`이면 격자를 끕니다. */
  private _setGridGap(gap: number | null): void {
    this._gridGap = gap;
    this._gridMenuOpen = false;
    this.requestUpdate();
  }

  /**
   * 현재 좌표를 가장 가까운 격자선에 맞추는 이동량을 계산합니다.
   *
   * 격자가 꺼져 있으면 `null`을 반환합니다.
   *
   * @param value - 현재 위치(mm)
   * @returns 더해야 할 이동량(mm) 또는 null
   */
  private _gridDelta(value: number): number | null {
    const gap = this._gridGap;
    if (gap === null) return null;
    return Math.round(value / gap) * gap - value;
  }

  /** 도형 메뉴를 버튼 아래에서 열거나 닫습니다. */
  private _toggleShapeMenu(e: Event): void {
    if (this._shapeMenuOpen) {
      this._shapeMenuOpen = false;
    } else {
      this._shapeMenuPos = this._openToolbarMenu(e);
      this._shapeMenuOpen = true;
    }
    this.requestUpdate();
  }

  /** 호스트가 지정한 프리셋 또는 현재 locale의 기본 프리셋을 반환합니다. */
  private _presetList(): SlipPreset[] {
    return this.presets?.length ? this.presets : getPresets(this._locale);
  }

  private _toggleListSelect(id: string, e: Event): void {
    // 목록 높이를 화면의 사용 가능한 영역에 맞춥니다.
    this._popovers.toggle('list', id, () => placeBelow(e.currentTarget as HTMLElement, 120, 280));
  }

  /** 프리셋 메뉴를 버튼 아래의 화면 고정 위치에서 열거나 닫습니다. */
  private _togglePresetMenu(e: Event): void {
    if (this._presetMenuOpen) {
      this._presetMenuOpen = false;
    } else {
      this._presetMenuPos = this._openToolbarMenu(e);
      this._presetMenuOpen = true;
    }
    this.requestUpdate();
  }

  /** 현재 양식을 선택한 프리셋으로 교체하고 되돌리기 이력을 남깁니다. */
  private _applyPreset(index: number): void {
    this._presetMenuOpen = false;
    this.requestUpdate();
    if (!this._file) return;
    const preset = this._presetList()[index];
    if (!preset) return;

    this._pushUndo();
    this._file = preset.create();
    // 프리셋은 새 양식이므로 이전에 불러온 양식의 저장 대상을 잇지 않습니다.
    this._forms.reset();
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

  /** 요소가 있는 페이지로 이동하고 해당 요소를 선택합니다. */
  private _selectFromSidebar(pageIndex: number, id: string, additive = false): void {
    this._goToPage(pageIndex);
    // Ctrl/Cmd+클릭은 다중 선택 상태를 전환합니다.
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

  /** 목록 파라미터의 하위 필드를 선택하고 사용 중인 첫 번째 그리드 셀로 이동합니다. */
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
   * 선택한 그리드의 목록 파라미터와 값이 있는 셀 항목을 사이드바에서 펼칩니다.
   *
   * @param id - 선택한 요소 id
   */
  private _expandParameterOfElement(id: string): void {
    const el = this._findElement(id);
    if (!isGrid(el)) return;
    if (el.repeat) this._expandedParameters.add(el.repeat.parameter);
    // 값이 지정된 셀이 있으면 그리드의 하위 항목을 펼칩니다.
    if (this._gridValueCells(el).length > 0) this._expandedElements.add(id);
  }

  /** 현재 페이지를 지정한 상대 위치로 이동합니다. */
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
   * 선택한 페이지로 이동하고 페이지 설정 패널을 표시합니다.
   *
   * @param index - 선택한 페이지 번호(0-기반)
   */
  private _selectPage(index: number): void {
    this._goToPage(index);
    this._clearSelection();
    this._gridEdit.clearCell();
    this._sideSelection = { kind: 'page' };
    this.requestUpdate();
  }

  /** 파라미터를 선택하고 오른쪽에 편집 패널을 표시합니다. */
  private _selectParameter(key: string): void {
    this._parameterKeyError = false;
    this._clearSelection();
    this._gridEdit.clearCell();
    this._sideSelection = { kind: 'parameter', key };
    // 선택한 목록 파라미터의 하위 필드를 펼칩니다.
    this._expandedParameters.add(key);
    this.requestUpdate();
  }

  /**
   * 파라미터 정의와 요소별 사용 위치를 합쳐 사이드바 항목을 만듭니다.
   */
  private _parameterList(): ParameterInfo[] {
    const file = this._file;
    if (!file) return [];
    const defs = file.template.parameters ?? [];
    const defOf = new Map(defs.map((b) => [b.key, b] as const));
    const { uses, fieldAt } = collectParameterUses(file);

    const list: ParameterInfo[] = [];
    const seen = new Set<string>();
    for (const key of [...defs.map((d) => d.key), ...uses.keys()]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const def = defOf.get(key);
      const at = fieldAt.get(key);
      // 목록 하위 필드는 파라미터 정의에 등록된 항목만 표시합니다.
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
        // 사용자가 지정한 셀 이름을 우선 사용하고, 이름이 없으면 좌표를 표시합니다 (§7.4).
        const at = s.gridCellAt
          .replace('{r}', String(c.row + 1))
          .replace('{c}', String(c.column + 1));
        return { row: c.row, column: c.column, label: c.name === undefined || c.name === '' ? at : c.name, at };
      });
  }

  /** 그리드의 셀 하위 목록을 열거나 닫습니다. */
  private _toggleElementRow(id: string): void {
    if (this._expandedElements.has(id)) this._expandedElements.delete(id);
    else this._expandedElements.add(id);
    this.requestUpdate();
  }

  /**
   * 그리드 셀의 페이지로 이동해 해당 셀을 선택합니다.
   *
   * @param pageIndex - 그리드가 있는 페이지 번호
   * @param gridId - 그리드 요소 id
   * @param row - 셀의 행
   * @param column - 셀의 열
   */
  private _selectGridCell(pageIndex: number, gridId: string, row: number, column: number): void {
    this._resetPanelErrors();
    this._goToPage(pageIndex);
    // 셀을 선택할 때는 그리드 그룹의 다른 요소를 선택하지 않습니다.
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

  /** 지정한 페이지에서 요소를 삭제합니다. */
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

  /** 기본 키로 파라미터를 만들고 선택합니다. */
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
   * 요소가 사용하는 파라미터를 정의 목록에 등록합니다.
   *
   * @remarks
   * 되돌리기 스냅샷을 남긴 뒤, 변경 이벤트를 내보내기 전에 불러야 합니다 — 즉
   * `_updateFile`·`_updateElement`의 수정 함수 안에서 씁니다.
   *
   * @param key - 파라미터 물리명
   * @param valueType - 등록할 값 종류. 이미 있는 항목이면 종류가 비어 있을 때만 채웁니다
   * @param label - 새로 만들 때 붙일 논리명
   */
  private _ensureParameterDef(key: string, valueType?: ParameterValueType, label?: string): void {
    if (!this._file) return;
    ensureParameterDefIn(this._file, key, valueType, label);
  }

  /**
   * 파라미터 키와 해당 키를 참조하는 요소 및 샘플 값을 함께 변경합니다.
   * 빈 키와 중복 키는 적용하지 않습니다.
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
      // 잘못된 입력을 현재 키로 복원합니다.
      if (input) input.value = key;
      this._parameterKeyError = true;
      this.requestUpdate();
      return;
    }
    this._parameterKeyError = false;
    // 정의·모든 참조·샘플 값을 한 번의 수정으로 바꿔 되돌리기 한 단위로 남깁니다.
    this._updateFile((f) => renameParameterReferences(f, key, trimmed));
    this._sideSelection = { kind: 'parameter', key: trimmed };
    this.requestUpdate();
  }

  /** 파라미터 레이블을 변경합니다. 빈 값이면 레이블을 제거합니다. */
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
   * 파라미터의 값 종류를 변경합니다. 목록이 아니면 하위 필드를 제거합니다.
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
      // 하위 필드는 목록 파라미터에만 허용됩니다.
      if (valueType !== 'list') delete (def as { fields?: unknown }).fields;
      f.template.parameters = defs;
    });
  }

  /** 목록 파라미터에 기본 키로 하위 필드를 추가하고 선택합니다. */
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
   * 하위 필드 키와 해당 필드를 참조하는 셀·수식·그룹 설정·샘플 항목을 함께 변경합니다.
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
    // 정의·항목 구간 셀·수식·그룹 설정·샘플 항목을 한 번의 수정으로 바꿔 되돌리기 한 단위로 남깁니다.
    this._updateFile((f) => renameParameterFieldReferences(f, listKey, key, trimmed));
    this._sideSelection = { kind: 'parameterField', key: listKey, field: trimmed };
    this.requestUpdate();
  }

  /**
   * 하위 필드의 레이블과 값 종류를 변경합니다.
   *
   * @param listKey - 목록 파라미터 물리명
   * @param key - 필드 물리명
   * @param patch - 바꿀 값 (빈 문자열이면 그 항목을 지웁니다)
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

  /** 목록 하위 필드와 해당 필드를 참조하는 셀의 파라미터를 제거합니다. */
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

  /**
   * 정의부에서 파라미터를 제거합니다.
   * 요소가 아직 쓰는 키면 참조가 끊기므로 사용 위치를 안내하고 지우지 않습니다.
   */
  private _removeParameterDef(key: string): void {
    const file = this._file;
    if (!file) return;
    const uses = parameterUsesOf(file, key);
    if (uses.length > 0) {
      const s = this._strings.designer;
      const where = uses
        .map((use) => s.parameterUseAt
          .replace('{name}', use.name)
          .replace('{page}', this._pageDisplayName(file.template.pages[use.pageIndex] ?? {}, use.pageIndex)))
        .join(', ');
      this._rejectInput(s.parameterInUse.replace('{uses}', where));
      return;
    }
    this._updateFile((f) => {
      const defs = (f.template.parameters ?? []).filter((b) => b.key !== key);
      if (defs.length > 0) f.template.parameters = defs;
      else delete (f.template as { parameters?: unknown }).parameters;
    });
    // 목록에서 사라진 파라미터를 선택한 채로 두지 않습니다
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
        itemsByGrid.set(el.id, sampleItemsOf(el, file.template.sampleValues));
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

  /** 계획 오류가 가리키는 요소와 행 구간을 선택하고 편집 위치로 이동합니다. */
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

  /** 계산되지 않는 수식이 있는 요소와 셀을 선택하고 편집 위치로 이동합니다. */
  private _focusFormulaTarget(target: FormulaTarget): void {
    const element = this._findElement(target.elementId);
    if (element === undefined) return;
    this._selectElement(element.id);
    this._gridEdit.clearCell();
    if (element.type === 'grid' && (target.kind === 'cell' || target.kind === 'cell-condition')) {
      this._gridEdit.selectCell({ row: target.row, column: target.column });
    }
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const found = this.renderRoot.querySelector(`[data-id="${element.id}"]`);
      if (!(found instanceof HTMLElement)) return;
      found.focus({ preventScroll: true });
      found.scrollIntoView({ block: 'nearest' });
    });
  }

  /** 선택한 반복 그리드의 원본 행 구조와 출력 결과 표시를 전환합니다. */
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
   * 선언된 모든 파라미터에 현재 샘플 값을 적용한 JSON 객체를 만듭니다.
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
    /** 목록 항목에 선언된 모든 하위 필드의 키를 추가합니다. */
    const withFields = (
      row: Record<string, unknown>,
      fields: readonly ParameterFieldInfo[],
    ): Record<string, unknown> => {
      const item: Record<string, unknown> = {};
      for (const f of fields) item[f.key] = row[f.key] ?? emptyFor(f.valueType);
      // 정의에 없는 기존 값도 유지합니다.
      for (const [k, v] of Object.entries(row)) if (!(k in item)) item[k] = v;
      return item;
    };

    const out: Record<string, unknown> = {};
    for (const b of this._parameterList()) {
      const current = samples[b.key];
      // 각 목록 항목에 선언된 하위 필드를 모두 추가합니다.
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

  /** 행 역할 메뉴를 닫고 조작을 시작한 행으로 포커스를 돌립니다. */
  private _closeBandMenu(clearSelection: boolean): void {
    const range = this._gridEdit.bandRange;
    const row = range === null ? null : Math.min(range.from, range.to);
    this._gridEdit.closeBandMenu(clearSelection);
    if (row === null) return;
    void this.updateComplete.then(() => {
      (this.renderRoot.querySelector(`[data-band-row="${row}"]`) as HTMLButtonElement | null)?.focus();
    });
  }

  /** 행 역할 메뉴에서 방향키·Home·End·Escape 포커스 이동을 처리합니다. */
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

  private _updateFile(fn: (file: SlipTemplateFile) => void): void {
    // 유효한 편집이 적용되면 이전 입력 오류를 지웁니다.
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
   * 페이지 번호 표시를 설정하거나 제거합니다.
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
   * 폰트 출처를 폰트 등록기에 지정합니다.
   *
   * @remarks
   * 동봉 폰트는 로케일에 따라 대체 폰트가 달라지므로 PDF 렌더링과 같은 기준
   * (`slipkit.locale`을 먼저 보는 렌더 로케일)을 씁니다. UI 로케일을 쓰면 캔버스와 PDF의
   * 대체 폰트가 어긋납니다.
   *
   * 호스트가 실제로 폰트를 준 경우에만 인스턴스로 출처를 나눕니다. `getFonts`가 빈 목록을
   * 주면 캔버스도 PDF와 같이 동봉 폰트를 쓰므로 로케일별 출처를 씁니다.
   */
  private _useFontSource(): void {
    const slipkit = this.slipkit;
    const locale = this._renderLocale;
    // 같은 설정에서는 다시 확인하지 않습니다. 화면을 갱신할 때마다 호출하면 실패 시 재시도가 반복됩니다.
    const last = this._fontSourceFor;
    if (last !== null && last.slipkit === slipkit && last.locale === locale) return;
    this._fontSourceFor = { slipkit, locale };
    const registry = this._fontRegistry;
    const useBundled = (): void => {
      registry.use(bundledFontSourceKey(locale), () => resolveFonts(undefined, locale));
    };
    if (slipkit?.getFonts === undefined) {
      useBundled();
      return;
    }
    // 동기 예외도 Promise 거부로 처리하여 화면 갱신이 중단되지 않게 합니다.
    // 인스턴스가 결과를 재사용하므로 이 확인이 공급 함수를 다시 부르지는 않습니다.
    void Promise.resolve().then(() => slipkit.getFonts!()).then(
      (fonts) => {
        if (this.slipkit !== slipkit || this._renderLocale !== locale) return;
        if (fonts.length > 0) registry.use(slipkit, () => Promise.resolve(fonts));
        else useBundled();
      },
      (error: unknown) => {
        if (this.slipkit !== slipkit || this._renderLocale !== locale) return;
        // 공급 실패를 출처 상태로 기록하여 같은 인스턴스를 쓰는 화면에 함께 반영합니다.
        registry.use(slipkit, () => Promise.reject(error));
      },
    );
  }

  /**
   * 실패했던 폰트 조회를 다시 시도합니다.
   *
   * @remarks
   * 조회 실패는 화면 갱신을 요청하므로 매번 재시도하면 실패와 갱신이 반복됩니다. 설정이 바뀌거나
   * 미리보기 렌더링이 성공하는 등 성공 가능성이 생긴 시점에만 다시 확인합니다.
   */
  private _retryFontSource(): void {
    if (!this._fontRegistry.loadFailed) return;
    this._fontSourceFor = null;
    this._useFontSource();
  }

  /**
   * 이번 렌더에서 쓸 폰트 상태를 만들고 필요한 폰트를 브라우저에 등록합니다.
   *
   * @returns 속성 패널과 캔버스가 함께 쓰는 폰트 상태
   */
  private _collectFonts(): DesignerFonts {
    const registry = this._fontRegistry;
    const names = registry.fontNames;
    if (names.length === 0) return NO_DESIGNER_FONTS;
    const fallback = registry.fallbackName;
    // 굵게·기울임 조합마다 다른 변형이 필요하므로 지정된 폰트의 변형을 함께 등록합니다.
    const used = collectUsedFontNames(this._file?.template.pages ?? []);
    if (fallback !== undefined) used.push(fallback);
    const required = new Set<string>();
    for (const name of used) {
      for (const variant of variantFontNames(names, name)) required.add(variant);
    }
    registry.ensure(required);
    const resolved = (style: FontStyleInput): string | undefined =>
      effectiveFontName(names, style.fontName, fallback, style.bold, style.italic);
    // 등록된 폰트를 PDF와 같은 우선순위로 선택합니다. 지정한 폰트 계열을 쓸 수 없으면
    // 대체 폰트 계열에서 다시 찾고, 등록 상태가 바뀌면 화면을 다시 그립니다.
    const readyIn = (base: string | undefined, style: FontStyleInput): string | undefined =>
      variantCandidates(names, base, style.bold, style.italic).find((name) => registry.isReady(name));
    const applied = (style: FontStyleInput): string | undefined =>
      readyIn(baseFontName(names, style.fontName, fallback), style)
      ?? readyIn(fallback, style);
    return {
      names,
      selectable: selectableFontNames(names),
      fallback,
      resolvedName: resolved,
      appliedName: applied,
      cssFamily: (style) => registry.familyOf(applied(style)),
      isUnregistered: (fontName) => fontName !== undefined && !names.includes(fontName),
      hasFailed: (style) => registry.failed(resolved(style)),
    };
  }

  /**
   * 호스트가 지정한 바코드 종류를 불러옵니다.
   * 실패하면 기본 목록(모든 종류)을 유지하고 패널에 안내합니다. 늦게 온 응답은 버립니다.
   */
  private async _loadBarcodeKinds(): Promise<void> {
    const gen = this._settingsGeneration;
    const settings = this.settings;
    let kinds: BarcodeKind[] = [];
    let failed = false;
    try {
      kinds = (settings?.getBarcodeKinds ? await settings.getBarcodeKinds() : []) ?? [];
    } catch (error) {
      console.error('[slip-designer] getBarcodeKinds failed:', error);
      failed = true;
    }
    if (gen !== this._settingsGeneration) return;
    this._hostBarcodeKinds = failed ? [] : kinds;
    this._barcodeKindsError = failed ? this._strings.designer.barcodeKindsLoadError : null;
    this.requestUpdate();
  }

  /** 바코드 선택기에 표시할 종류를 반환합니다. */
  private _barcodeKinds(): readonly { value: BarcodeKind; label: string }[] {
    if (this._hostBarcodeKinds.length === 0) return BARCODE_KINDS;
    const allowed = new Set(this._hostBarcodeKinds);
    return BARCODE_KINDS.filter((k) => allowed.has(k.value));
  }

  /**
   * 호스트가 제공하는 용지 목록을 불러옵니다.
   * 실패하면 기본 용지만 남기고 패널에 안내합니다. 늦게 온 응답은 버립니다.
   */
  private async _loadPaperSizes(): Promise<void> {
    const gen = this._settingsGeneration;
    const settings = this.settings;
    let sizes: PaperSize[] = [];
    let failed = false;
    try {
      sizes = (settings?.getPaperSizes ? await settings.getPaperSizes() : []) ?? [];
    } catch (error) {
      console.error('[slip-designer] getPaperSizes failed:', error);
      failed = true;
    }
    if (gen !== this._settingsGeneration) return;
    this._hostPaperSizes = failed ? [] : sizes;
    this._paperSettingsError = failed ? this._strings.designer.paperSizesLoadError : null;
    this.requestUpdate();
  }

  /**
   * 현재 용지 크기를 호스트 설정에 저장하고 선택 목록을 갱신합니다.
   * 저장에 실패하면 입력한 이름을 유지하고 패널에 안내합니다.
   *
   * @param name - 선택 목록에 표시할 용지 이름
   */
  private async _savePaperSize(name: string): Promise<void> {
    const trimmed = name.trim();
    const settings = this.settings;
    if (!trimmed || !settings?.savePaperSize || !this._file) return;
    const gen = this._settingsGeneration;
    const { paper } = this._file.template;
    try {
      await settings.savePaperSize({ name: trimmed, width: paper.width, height: paper.height });
    } catch (error) {
      console.error('[slip-designer] savePaperSize failed:', error);
      if (gen !== this._settingsGeneration) return;
      this._paperSettingsError = this._strings.designer.paperSaveError;
      this.requestUpdate();
      return;
    }
    if (gen !== this._settingsGeneration) return;
    this._paperSaveName = '';
    // 저장된 용지가 선택 목록에 포함되도록 다시 불러옵니다.
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

  /** 선택한 요소가 속한 그룹을 해제합니다. */
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
    // 정의에 없는 기존 키도 현재 선택값으로 표시합니다.
    if (current && !options.some((o) => o.key === current)) {
      options.unshift({ key: current, label: current });
    }
    const canAdd = !inBand || listKey !== undefined;
    return listSelect(this._popovers, (id, event) => this._toggleListSelect(id, event), {
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
        this._gridCommands.setCellSource('parameter', v);
      },
    });
  }

  /** 목록 하위 필드를 추가하고 현재 반복 셀에 연결합니다. */
  private _addParameterFieldForCell(listKey: string): void {
    const before = new Set((this._parameterList().find((b) => b.key === listKey)?.fields ?? []).map((f) => f.key));
    const cell = this._gridEdit.cell;
    this._addParameterField(listKey);
    const created = (this._parameterList().find((b) => b.key === listKey)?.fields ?? [])
      .find((f) => !before.has(f.key));
    // 하위 필드 편집 후 원래 셀 선택을 복원합니다.
    this._sideSelection = null;
    if (cell) this._gridEdit.selectCell(cell);
    if (created) this._gridCommands.setCellSource('parameter', created.key);
  }

  /** 새 최상위 파라미터를 만들고 현재 셀에 연결합니다 — 정의와 연결이 되돌리기 한 단위입니다. */
  private _newParameterForCell(): void {
    const cell = this._gridEdit.cell;
    if (!cell) {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextParameter();
    this._updateElement((element) => {
      if (!isGrid(element)) return;
      this._ensureParameterDef(key, undefined, label);
      const target = ensureCell(element, cell.row, cell.column);
      clearValueSources(target);
      target.parameter = key;
    });
  }

  /**
   * 새 파라미터를 만들어 선택한 요소에 연결합니다. 정의 추가와 연결이 되돌리기 한 단위입니다.
   *
   * @param type - 선택되어 있어야 하는 요소 종류
   * @param valueType - 새 정의의 값 종류
   * @param link - 요소에 새 키를 연결하는 수정 함수
   */
  private _assignNewParameterTo(
    type: SlipElement['type'],
    valueType: ParameterValueType | undefined,
    link: (el: SlipElement, key: string) => void,
  ): void {
    const el = this._findSelectedElement();
    if (el?.type !== type) {
      this._rejectInput();
      return;
    }
    const { key, label } = this._nextParameter();
    this._updateElementById(el.id, (target) => {
      this._ensureParameterDef(key, valueType, label);
      link(target, key);
    });
  }

  /** 기존 파라미터 선택과 새 파라미터 추가를 제공하는 공통 선택기를 렌더링합니다. */
  private _parameterSelect(current: string, onNew: () => void, onPick: (value: string) => void) {
    const s = this._strings.designer;
    const list = this._parameterList();
    return html`
      <div class="prop-row">
        <label>${s.parameter}</label>
        ${listSelect(this._popovers, (id, event) => this._toggleListSelect(id, event), {
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

  /** 새 파라미터를 만들고 선택한 필드 요소에 연결합니다. */
  private _assignNewParameter(): void {
    this._assignNewParameterTo('field', undefined, (target, key) => {
      if (target.type !== 'field') return;
      // 필드는 파라미터와 수식 중 하나만 사용합니다.
      delete (target as Record<string, unknown>).formula;
      target.parameter = key;
    });
  }

  /** 사용하지 않은 기본 파라미터 키와 레이블을 만듭니다. */
  private _nextParameter(): { key: string; label: string } {
    const used = new Set(this._parameterList().map((b) => b.key));
    let n = 1;
    while (used.has(`value${n}`)) n += 1;
    return { key: `value${n}`, label: `${this._strings.designer.newParameterName} ${n}` };
  }

  /**
   * 이미지 요소를 고정 이미지와 파라미터 이미지 사이에서 전환합니다.
   * 전환할 때 반대쪽 소스를 제거하고 파라미터 이미지에는 새 이미지 파라미터를 연결합니다.
   *
   * @param variable - true면 변동(parameter), false면 고정(src)
   */
  private _setImageVariable(variable: boolean): void {
    const el = this._findSelectedElement();
    if (el?.type !== 'image') {
      this._rejectInput();
      return;
    }
    if (variable) {
      if (el.parameter !== undefined) return;
      // 이미지 파라미터로 등록해 작성 폼과 샘플 편집기에 파일 입력을 표시합니다.
      this._assignNewImageParameter();
    } else {
      this._updateElementById(el.id, (target) => {
        if (target.type !== 'image') return;
        delete target.parameter;
        target.src = PLACEHOLDER_IMG;
      });
    }
  }

  /** 변동 이미지에 연결할 파라미터 선택기를 렌더링합니다. */
  private _renderImageParameterSelect(current: string) {
    return this._parameterSelect(
      current,
      () => this._assignNewImageParameter(),
      (value) => this._updateElement((target) => {
        if (target.type !== 'image') return;
        this._ensureParameterDef(value, 'image');
        target.parameter = value;
        delete target.src;
      }),
    );
  }

  /** 새 이미지 파라미터를 만들고 선택한 이미지 요소에 연결합니다. */
  private _assignNewImageParameter(): void {
    this._assignNewParameterTo('image', 'image', (target, key) => {
      if (target.type !== 'image') return;
      target.parameter = key;
      delete target.src;
    });
  }

  /**
   * 바코드의 값 소스를 선택하고 다른 값 소스를 제거합니다 (SPEC §5.6).
   * 파라미터 소스를 선택하면 새 파라미터를 만들어 연결합니다.
   *
   * @param kind - 선택할 값 종류
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
   * 바코드의 직접 입력 또는 수식을 설정하고 다른 값 소스를 제거합니다.
   *
   * @param kind - `content` 또는 `formula`
   * @param value - 넣을 문자열 (빈 값이어도 그 소스는 유지합니다)
   */
  private _setBarcodeSource(kind: 'content' | 'formula', value: string): void {
    this._updateElement((element) => {
      if (element.type !== 'barcode') return;
      const r = element as Record<string, unknown>;
      clearValueSources(r);
      r[kind] = value;
    });
  }

  /** 바코드에 연결할 파라미터 선택기를 렌더링합니다. */
  private _renderBarcodeParameterSelect(current: string) {
    return this._parameterSelect(
      current,
      () => this._assignNewBarcodeParameter(),
      (value) => this._updateElement((element) => {
        if (element.type !== 'barcode') return;
        this._ensureParameterDef(value);
        clearValueSources(element);
        element.parameter = value;
      }),
    );
  }

  /** 새 파라미터를 만들고 선택한 바코드 요소에 연결합니다. */
  private _assignNewBarcodeParameter(): void {
    this._assignNewParameterTo('barcode', undefined, (target, key) => {
      if (target.type !== 'barcode') return;
      clearValueSources(target);
      target.parameter = key;
    });
  }

  /**
   * 고정 바코드 값이 종류별 형식에 맞는지 검사합니다.
   * 길이가 정해진 종류와 CODE39만 검사합니다.
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
      // 필드에 필요한 새 파라미터를 만들어 연결합니다.
      this._assignNewParameterTo('text', undefined, (target, key) => {
        const r = target as Record<string, unknown>;
        delete r.content;
        delete r.formula;
        r.type = 'field';
        r.parameter = key;
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

  private _togglePropertyMenu(key: string, event: Event): void {
    this._popovers.toggle(
      'property',
      key,
      () => placeBelowOrAbove(event.currentTarget as HTMLElement, 80, 220, 180),
    );
  }

  /**
   * 모든 요소의 종류 배지를 표시할지 여부.
   * 파일에 저장하지 않는 화면 상태입니다.
   */
  private _showBadges = false;

  /**
   * 캔버스 격자 간격(mm). `null`이면 격자를 표시하지 않습니다.
   */
  private _gridGap: number | null = null;

  /** 격자 간격 메뉴 열림 여부 */
  private _gridMenuOpen = false;

  /** 캔버스 격자선 색 */
  private _gridColor: GridColorId = 'gray';

  /** 격자 설정 메뉴의 화면 좌표 */
  private _gridMenuPos = { left: 0, top: 0 };

  /** 요소의 색상 속성을 설정하거나 제거하고 색 선택기 상태를 갱신합니다. */
  private _applyColor(key: string, value: string | null): void {
    if (value) this._picker.seed(value);
    this._updateElement((el) => setOptional(el, key, value || null));
  }

  private _collectParameters(): { key: string; label: string }[] {
    return this._parameterList().map((b) => ({ key: b.key, label: b.label }));
  }

  /** 이미지 선택 모달을 엽니다. */
  private _openImageModal(): void {
    this._imageError = null;
    this._dialogs.open('image');
  }

  private _closeImageModal(): void {
    this._dialogs.close('image');
    this._imageError = null;
  }

  /** 선택한 이미지를 현재 이미지 요소에 적용하고 모달을 닫습니다. */
  private _applyImageSrc(src: string): void {
    this._updateElement((target) => {
      if (target.type === 'image') target.src = src;
    });
    this._closeImageModal();
  }

  /**
   * 파일 선택 대화 상자에서 이미지를 선택하고 base64로 변환해 적용합니다.
   * 외부 URL은 지원하지 않으며 호스트가 base64로 변환해 전달해야 합니다.
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

  /** 이미지 선택 실패 사유를 로케일에 맞는 문구로 바꿉니다. */
  private _pickErrorText(result: ImagePickFailure): string {
    const s = this._strings.designer;
    return imagePickErrorText(
      result,
      { notImage: s.imageNotImage, readFailed: s.imageReadFailed, tooLarge: s.imageTooLarge },
      this.maxImageBytes,
    );
  }

  /** 샘플 데이터의 이미지 값을 파일에서 선택해 저장합니다. */
  private async _pickSampleImage(key: string): Promise<void> {
    const result = await pickImageFile(this.maxImageBytes);
    if (result.ok) {
      this._sample.setImageError(null);
      this._setSampleValue(key, result.src);
      return;
    }
    this._sample.setImageError(this._pickErrorText(result));
  }

  /**
   * 수식 편집 모달을 엽니다.
   * 대상은 여는 시점에 확정하며, 모달이 열려 있는 동안 선택이 바뀌어도 따라가지 않습니다.
   *
   * @param target - 편집할 대상
   */
  private _openFormulaModal(target: FormulaTarget): void {
    const found = resolveFormulaTarget(this._currentPage(), target);
    if (found === null) {
      this._rejectInput(this._strings.designer.formulaTargetChanged);
      return;
    }
    this._formula.start(
      target,
      { formula: found.formula, ...(found.rule === undefined ? {} : { rule: found.rule }) },
      this._defaultFormulaItem(found),
    );
    this._dialogs.open('formula');
  }

  /**
   * 모달을 열 때 미리 계산에 쓸 샘플 항목을 고릅니다.
   *
   * @param found - 다시 찾은 편집 대상
   * @returns 지금 보고 있는 출력 페이지에서 이 셀이 쓰는 항목, 없으면 첫 항목.
   *   반복 그리드가 아니거나 샘플이 없으면 null
   */
  private _defaultFormulaItem(found: ResolvedFormulaTarget): number | null {
    const grid = found.grid;
    const cell = found.cell;
    if (grid === undefined || cell === undefined || grid.repeat === undefined) return null;
    const formula = gridFormulaContext(grid, this._file?.template.sampleValues, this._pagePlan().plan);
    if (formula.realItems.length === 0) return null;
    // 지금 보고 있는 출력 페이지에서 이 셀이 쓰는 항목을 먼저 씁니다.
    const slot = formula.slotForBand(formula.fragmentAt(this._outputPage), bandAt(grid, cell.row));
    const used = slot.item === undefined ? -1 : formula.realItems.indexOf(slot.item);
    return used >= 0 ? used : 0;
  }

  private _closeFormulaModal(): void {
    this._dialogs.close('formula');
    this.requestUpdate();
  }

  /**
   * 수식 모달이 화면을 그리는 데 필요한 상태를 만듭니다.
   * 열 때의 대상 내용과 비교해, 모달 밖에서 대상이 바뀌었으면 그 자리에서 적용을 막습니다.
   */
  private _formulaView(): FormulaModalView {
    const target = this._formula.target;
    const origin = this._formula.origin;
    if (target === null || origin === null) return LOST_FORMULA_VIEW;
    if (verifyFormulaTarget(this._currentPage(), target, origin) === null) return LOST_FORMULA_VIEW;
    return this._formulaState(target, this._formula.draft, this._formula.itemIndex);
  }

  /**
   * 저장된 수식 가운데 지금 값으로 계산되지 않는 것을 모읍니다.
   *
   * @remarks
   * 페이지의 모든 수식을 반복 그리드의 샘플 항목마다 검사하므로, 한 번 그릴 때 한 번만
   * 계산해 사이드바와 캔버스가 같은 결과를 나눠 씁니다.
   *
   * @returns 경고가 있는 요소 id와 그리드별 셀 자리
   */
  private _collectFormulaWarnings(): FormulaWarnings {
    const page = this._currentPage();
    if (page === undefined) return NO_FORMULA_WARNINGS;
    return collectFormulaWarnings({
      page,
      check: (target, source, condition) => this._checkSaved(target, source, condition),
    });
  }

  /**
   * 저장된 수식 하나를 모달과 같은 계산 문맥으로 검사합니다.
   * 반복 그리드 셀은 샘플 항목마다 결과가 달라지므로 항목 수만큼 검사합니다.
   */
  private _checkSaved(
    target: FormulaTarget,
    source: string,
    condition: boolean,
  ): FormulaCheck[] {
    const found = resolveFormulaTarget(this._currentPage(), target);
    if (found === null) return [];
    const grid = found.grid?.repeat === undefined ? undefined : found.grid;
    const formula = grid === undefined
      ? null
      : gridFormulaContext(grid, this._file?.template.sampleValues, this._pagePlan().plan);
    const band = grid === undefined || found.cell === undefined ? undefined : bandAt(grid, found.cell.row);

    const slots = formula === null || formula.itemCount === 0
      ? [formula?.slotForBand(formula.fragmentAt(this._outputPage), band) ?? null]
      : Array.from({ length: formula.itemCount }, (_row, index) => formula.slotForItem(index, band));

    return slots.map((slot) => checkFormula({
      source,
      condition,
      emptyAllowed: target.kind === 'cell',
      locale: this._evalLocale,
      context: {
        values: { ...this._formulaProbeValues(), ...(slot?.item ?? {}) },
        ...(slot?.reserved === undefined ? {} : { reserved: slot.reserved }),
      },
      diagnose: (from, context) => this._diagnose(from, context),
    }));
  }

  /**
   * 대상과 수식으로 검사 결과와 참조 목록을 만듭니다. 모달과 인라인 입력이 함께 씁니다.
   *
   * @param target - 검사할 편집 대상
   * @param source - 검사할 수식·조건식
   * @param itemIndex - 미리 계산에 쓸 샘플 항목. 반복 그리드가 아니면 null
   * @returns 편집 대상, 검사 결과와 참조 목록
   */
  private _formulaState(
    target: FormulaTarget,
    source: string,
    itemIndex: number | null,
  ): FormulaModalView {
    const found = resolveFormulaTarget(this._currentPage(), target);
    if (found === null) return LOST_FORMULA_VIEW;

    const condition = isConditionTarget(target);
    const grid = found.grid?.repeat === undefined ? undefined : found.grid;
    const formula =
      grid === undefined
        ? null
        : gridFormulaContext(grid, this._file?.template.sampleValues, this._pagePlan().plan);
    const band = grid === undefined || found.cell === undefined ? undefined : bandAt(grid, found.cell.row);
    // 고른 항목이 없어도(샘플이 비었을 때 등) 계획이 주는 것은 그대로 씁니다.
    const slot = formula === null
      ? null
      : itemIndex === null
        ? formula.slotForBand(formula.fragmentAt(this._outputPage), band)
        : formula.slotForItem(itemIndex, band);

    return {
      target: {
        target,
        element: found.element,
        ...(found.cell === undefined ? {} : { cell: found.cell }),
        condition,
        outputPage: slot?.outputPage ?? null,
        groupIndex: slot?.groupIndex ?? null,
      },
      check: checkFormula({
        source,
        condition,
        emptyAllowed: target.kind === 'cell',
        locale: this._evalLocale,
        context: {
          values: { ...this._formulaProbeValues(), ...(slot?.item ?? {}) },
          ...(slot?.reserved === undefined ? {} : { reserved: slot.reserved }),
        },
        diagnose: (from, context) => this._diagnose(from, context),
      }),
      itemCount: formula?.itemCount ?? 0,
      currentItem: (itemIndex === null ? undefined : formula?.choiceAt(itemIndex)) ?? null,
      reserved: formula === null ? NOT_REPEAT_RESERVED : formula.availability(slot ?? EMPTY_SLOT),
    };
  }

  /**
   * 인라인으로 입력한 수식·조건식을 모달과 같은 기준으로 검사합니다.
   *
   * @param target - 검사할 편집 대상
   * @param value - 입력한 수식·조건식
   * @param field - 오류를 붙일 항목 키
   * @returns 저장해도 되면 true
   */
  private _acceptFormula(target: FormulaTarget, value: string, field: string): boolean {
    const found = resolveFormulaTarget(this._currentPage(), target);
    if (found === null) {
      this._rejectInput(this._strings.designer.formulaTargetChanged, field);
      return false;
    }
    const view = this._formulaState(target, value, this._defaultFormulaItem(found));
    if (view.check.applicable) {
      this._clearInputError();
      return true;
    }
    const message = formulaCheckText(this._strings.designer, view.check, target.kind === 'cell');
    this._rejectInput(message.text, field);
    return false;
  }

  /** 수식 편집 값을 대상에 적용합니다. 대상이 바뀌었으면 적용하지 않고 모달을 열어 둡니다. */
  private _applyFormulaModal(): void {
    const target = this._formula.target;
    if (target === null) return;
    if (!this._formulaView().check.applicable) {
      // 적용을 막을 때는 모달과 초안을 그대로 두고 안내로 초점을 옮깁니다.
      this.requestUpdate();
      void this.updateComplete.then(() => {
        this.renderRoot.querySelector<HTMLElement>('#formula-status')?.focus();
      });
      return;
    }
    this._writeFormula(target, this._formula.commit());
    this._dialogs.close('formula');
  }

  /** 검사를 마친 수식을 대상에 씁니다. */
  private _writeFormula(target: FormulaTarget, value: string | null): void {
    this._updateElementById(target.elementId, (el) => {
      if (target.kind === 'field' || target.kind === 'barcode') {
        if (el.type !== target.kind) return;
        setOptional(el, 'formula', value);
        return;
      }
      if (target.kind === 'element-condition') {
        if (!('conditionalFormats' in el)) return;
        const rule = el.conditionalFormats?.[target.ruleIndex];
        if (rule !== undefined && value !== null) rule.condition = value;
        return;
      }
      if (el.type !== 'grid') return;
      const cell = el.cells.find((c) => c.row === target.row && c.column === target.column);
      if (cell === undefined) return;
      if (target.kind === 'cell') {
        // 셀은 값 소스를 하나만 가지므로 수식을 넣으면 나머지를 지웁니다.
        if (value === null) delete cell.formula;
        else {
          delete cell.content;
          delete cell.parameter;
          cell.formula = value;
        }
        return;
      }
      const rule = cell.conditionalFormats?.[target.ruleIndex];
      if (rule !== undefined && value !== null) rule.condition = value;
    });
  }

  /**
   * 요소를 id로 찾아 수정합니다. 선택 상태와 무관하게 대상을 지목할 때 씁니다.
   *
   * @param id - 수정할 요소 id
   * @param fn - 요소 수정 함수
   */
  private _updateElementById(id: string, fn: (el: SlipElement) => void): void {
    const el = this._findElement(id);
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

  private _openSaveModal(): void {
    if (!this._file) return;
    this._forms.startSave(this._file.template.meta.title);
    this._dialogs.open('save');
  }

  /**
   * 입력한 제목을 양식에 반영하고 저장소에 저장합니다.
   * 새 양식으로 저장하지 않는 한 기존 저장 ID를 재사용합니다.
   */
  private async _confirmSave(): Promise<void> {
    const adapter = this.storage;
    if (!adapter || !this._file) return;
    const title = this._forms.title.trim();
    // 빈 제목은 스키마 제약을 충족하지 않으므로 저장하지 않습니다.
    if (!title) {
      this._rejectInput();
      return;
    }
    // 제목은 저장이 성공한 뒤에만 양식에 반영합니다 — 실패하면 양식과 되돌리기 이력이 그대로입니다.
    const file = structuredClone(this._file) as SlipTemplateFile;
    file.template.meta.title = title;
    // 저장될 그대로(JSON)를 파일 형식으로 검증해 형식에 맞지 않는 양식은 저장소에 남기지 않습니다.
    try {
      validateSlipFile(
        JSON.parse(serializeSlipFile(file as SlipFile)),
        this._locale === undefined ? undefined : { locale: this._locale },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this._forms.fail(this._strings.designer.saveInvalidFile.replace('{detail}', detail));
      return;
    }
    const id = this._forms.nextId();
    try {
      await adapter.save(id, file as SlipFile);
    } catch (error) {
      this._forms.fail(error);
      return;
    }
    if (this._file && title !== this._file.template.meta.title) {
      this._updateFile((f) => {
        f.template.meta.title = title;
      });
    }
    this._dialogs.close('save');
    this._forms.markSaved(id);
  }

  /** 저장된 양식의 메타데이터를 불러와 목록 모달을 엽니다. */
  private async _openMyForms(): Promise<void> {
    this._forms.startList();
    this._dialogs.open('myForms');
    await this._loadMyForms();
  }

  /**
   * 저장된 양식의 메타데이터를 모두 불러옵니다.
   * 검색과 페이지 이동은 이 목록을 사용하며 양식 본문은 불러오지 않습니다.
   */
  private async _loadMyForms(): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    await this._forms.loadList(adapter);
  }

  /** 선택한 양식을 편집기에 불러오고 이전 상태를 실행 취소 기록에 추가합니다. */
  private async _loadMyForm(id: string): Promise<void> {
    const adapter = this.storage;
    if (!adapter) return;
    // 빠르게 다른 양식을 고르거나 소스가 바뀌면 먼저 시작한 불러오기 결과는 버립니다.
    const gen = ++this._loadGeneration;
    let file: SlipFile;
    try {
      file = await adapter.load(id);
    } catch (error) {
      if (gen !== this._loadGeneration) return;
      this._forms.fail(error);
      return;
    }
    if (gen !== this._loadGeneration || this.storage !== adapter) return;
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

  /** 저장된 양식을 지우기 전에 확인 모달을 엽니다. */
  private _askDeleteMyForm(id: string): void {
    const item = this._forms.filtered().find((entry) => entry.id === id);
    if (!item) return;
    this._pendingDelete = { id, title: item.title };
    this._dialogs.open('confirmDelete');
  }

  /** 삭제 확인 모달을 닫고 아무것도 지우지 않습니다. */
  private _cancelDeleteMyForm(): void {
    this._pendingDelete = null;
    this._dialogs.close('confirmDelete');
  }

  /** 확인한 양식을 저장소에서 삭제하고 현재 양식의 저장 ID를 갱신합니다. */
  private async _deleteMyForm(): Promise<void> {
    const adapter = this.storage;
    const pending = this._pendingDelete;
    if (!adapter || pending === null) return;
    this._cancelDeleteMyForm();
    try {
      await adapter.delete(pending.id);
    } catch (error) {
      this._forms.fail(error);
      return;
    }
    this._forms.forget(pending.id, MY_FORMS_PAGE_SIZE);
  }

}

customElements.define('slip-designer', SlipDesigner);

declare global {
  interface HTMLElementTagNameMap {
    'slip-designer': SlipDesigner;
  }
}
