/**
 * `.slip` 파일 형식의 TypeScript 타입.
 *
 * 타입은 `schema.ts`의 Zod 스키마에서 추론하며, 형식 규범은 `docs/SPEC.md`를 따른다.
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
