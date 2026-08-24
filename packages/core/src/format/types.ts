/**
 * .slip 파일 포맷 타입.
 *
 * 타입은 전부 schema.ts의 Zod 스키마에서 추론(z.infer)한다 — 검증과 타입이
 * 어긋날 수 없는 단일 원천. 규범 명세는 docs/SPEC.md.
 */
export type {
  AssetEntry,
  BarcodeElement,
  BarcodeKind,
  ParameterDef,
  ParameterField,
  ParameterValueType,
  EllipseElement,
  FieldElement,
  GridCell,
  GridElement,
  GridRepeat,
  ImageElement,
  JsonValue,
  LineElement,
  PageNumber,
  PageNumberPosition,
  PaperSize,
  PolygonElement,
  RectElement,
  SlipElement,
  SlipFile,
  SlipFileKind,
  SlipPage,
  SlipTemplateBody,
  SlipTemplateFile,
  SlipVoucherFile,
  TextElement,
} from './schema.js';
