/**
 * .slip 파일 포맷 타입 골격.
 *
 * 근거 ADR: 007(JSON 자체 스키마) · 008(양식 스냅샷) · 009/019(해시·서명) ·
 * 011(용지 좌표계·복수 페이지) · 014(이미지 하이브리드) · 018(.slip) · 020(요소 6종).
 * 상세 명세는 SPEC.md에서 확정한다 — 이 파일은 스캐폴딩 단계의 초안이다.
 */

/** 파일 종류: 양식(템플릿) 또는 발행/작성된 전표 */
export type SlipFileKind = 'template' | 'voucher';

/** 길이 단위는 항상 mm (용지 좌표계, ADR-011) */
export type Millimeter = number;

export interface PaperSize {
  width: Millimeter;
  height: Millimeter;
  /** [top, right, bottom, left] */
  padding: [Millimeter, Millimeter, Millimeter, Millimeter];
}

/** 이미지 참조 3종 (ADR-007): 외부 URL / data: 내장 / asset:// 내부 리소스 */
export type AssetSrc = string;

export interface AssetEntry {
  id: string;
  mimeType: string;
  src: AssetSrc;
}

// ---------------------------------------------------------------------------
// 요소 (ADR-020: 6종)
// ---------------------------------------------------------------------------

export interface ElementBase {
  id: string;
  name: string;
  position: { x: Millimeter; y: Millimeter };
  width: Millimeter;
  height: Millimeter;
}

export interface ColorStyle {
  backgroundColor?: string;
  fontColor?: string;
  borderColor?: string;
  borderWidth?: Millimeter;
}

export interface TextElement extends ElementBase, ColorStyle {
  type: 'text';
  /** 고정 문구 또는 수식/플레이스홀더 포함 문자열 */
  content: string;
  fontName?: string;
  fontSize?: number;
  alignment?: 'left' | 'center' | 'right';
}

/** 행 수가 고정된 격자 틀 (공급자 정보란 등). 셀 병합 지원 — ADR-020 */
export interface FixedGridElement extends ElementBase, ColorStyle {
  type: 'fixedGrid';
  rows: number;
  columns: number;
  /** 열 너비 비율(%) 합 100 */
  columnWidthPercentages: number[];
  cells: FixedGridCell[];
}

export interface FixedGridCell extends ColorStyle {
  row: number;
  column: number;
  /** 병합 범위 (기본 1) */
  rowSpan?: number;
  colSpan?: number;
  content: string;
  fontSize?: number;
  alignment?: 'left' | 'center' | 'right';
}

/** 데이터 행 수에 따라 늘어나는 표. 자동 페이지 분할 대상 (ADR-011) */
export interface DynamicTableElement extends ElementBase, ColorStyle {
  type: 'dynamicTable';
  head: string[];
  headWidthPercentages: number[];
  repeatHead: boolean;
  /** 바인딩할 데이터 키 (전표 values의 배열 필드) */
  binding: string;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  src: AssetSrc;
}

export interface ShapeElement extends ElementBase, ColorStyle {
  type: 'shape';
  shape: 'line' | 'rect';
}

/** 전표 작성 시 값이 채워지는 입력 필드 */
export interface FieldElement extends ElementBase, ColorStyle {
  type: 'field';
  /** 전표 values의 키 */
  binding: string;
  /** 표시 전 가공용 수식 (ADR-010/017), 예: FORMAT_NUMBER(...) */
  formula?: string;
  fontName?: string;
  fontSize?: number;
  alignment?: 'left' | 'center' | 'right';
}

export type SlipElement =
  | TextElement
  | FixedGridElement
  | DynamicTableElement
  | ImageElement
  | ShapeElement
  | FieldElement;

// ---------------------------------------------------------------------------
// 문서
// ---------------------------------------------------------------------------

export interface SlipPage {
  elements: SlipElement[];
}

/** 양식(템플릿) 본문 */
export interface SlipTemplateBody {
  meta: { title: string; createdAt?: string; updatedAt?: string };
  paper: PaperSize;
  pages: SlipPage[];
  assets: AssetEntry[];
}

/** 무결성 정보 (ADR-019): SHA-256 해시 필수, JWS 서명 옵션 */
export interface Integrity {
  /** 정규화된 내용의 SHA-256 (hex) */
  contentHash: string;
  /** JWS(ES256) compact serialization — 호스트 키 제공 시 */
  signature?: string;
}

export interface SlipTemplateFile {
  schemaVersion: string;
  kind: 'template';
  template: SlipTemplateBody;
}

export interface SlipVoucherFile {
  schemaVersion: string;
  kind: 'voucher';
  /** 생성 시점 양식 전체 스냅샷 (ADR-008) */
  templateSnapshot: SlipTemplateBody;
  /** 필드 바인딩 키 → 값 */
  values: Record<string, unknown>;
  /** 발행(확정) 여부. 발행 시 이미지 내장(ADR-014)·무결성 기록(ADR-019) */
  issued: boolean;
  integrity?: Integrity;
}

export type SlipFile = SlipTemplateFile | SlipVoucherFile;
