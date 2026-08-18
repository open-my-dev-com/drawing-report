/**
 * .slip 파일 포맷 타입.
 *
 * 타입은 전부 schema.ts의 Zod 스키마에서 추론(z.infer)한다 — 검증과 타입이
 * 어긋날 수 없는 단일 원천. 규범 명세는 docs/SPEC.md.
 */
export type {
  AssetEntry,
  DynamicTableElement,
  FieldElement,
  FixedGridCell,
  FixedGridElement,
  ImageElement,
  Integrity,
  JsonValue,
  PaperSize,
  ShapeElement,
  SlipElement,
  SlipFile,
  SlipFileKind,
  SlipPage,
  SlipTemplateBody,
  SlipTemplateFile,
  SlipVoucherFile,
  TextElement,
} from './schema.js';

/** 길이 단위는 항상 mm (용지 좌표계, ADR-011) */
export type Millimeter = number;

/** 이미지 참조 3종 (ADR-007): 외부 URL / data: 내장 / asset:// 내부 리소스 */
export type AssetSrc = string;
