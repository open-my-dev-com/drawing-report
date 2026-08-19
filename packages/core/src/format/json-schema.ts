/**
 * .slip 파일의 JSON Schema 산출 (ADR-022).
 *
 * Zod 스키마에서 draft 2020-12 JSON Schema를 뽑아 패키지에 동봉한다
 * (packages/core/schemas/ — scripts/generate-json-schema.mjs로 재생성).
 * refine/superRefine의 교차 필드 검증은 JSON Schema로 표현되지 않으므로,
 * 완전한 검증은 이 라이브러리(parseSlipFile)가 기준이다 — docs/SPEC.md §10.
 */
import { z } from 'zod';
import { slipFileSchema } from './schema.js';
import { CURRENT_SCHEMA_VERSION } from './version.js';

/** 현재 스키마 버전의 .slip JSON Schema(draft 2020-12)를 산출한다 */
export function slipFileJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(slipFileSchema, { target: 'draft-2020-12' });
  return {
    $id: `urn:slipkit:schema:slip:${CURRENT_SCHEMA_VERSION}`,
    title: `SlipKit .slip file (schemaVersion ${CURRENT_SCHEMA_VERSION})`,
    ...jsonSchema,
  };
}
