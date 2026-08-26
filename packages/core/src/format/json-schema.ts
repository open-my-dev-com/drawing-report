/**
 * `.slip` 파일의 JSON Schema를 생성한다.
 *
 * Zod 스키마에서 draft 2020-12 JSON Schema를 생성해 패키지에 포함한다.
 * `scripts/generate-json-schema.mjs`로 `packages/core/schemas/`를 갱신한다.
 * `refine`과 `superRefine`의 교차 필드 검증은 JSON Schema로 표현되지 않으므로
 * 전체 검증에는 `parseSlipFile`을 사용한다 (`docs/SPEC.md` §10).
 */
import { z } from 'zod';
import { slipFileSchema } from './schema.js';
import { CURRENT_SCHEMA_VERSION } from './version.js';

/**
 * 현재 `.slip` 스키마 버전의 JSON Schema를 생성한다.
 *
 * @returns draft 2020-12 JSON Schema 객체 (`$id`: `urn:slipkit:schema:slip:<버전>`)
 */
export function slipFileJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(slipFileSchema, { target: 'draft-2020-12' });
  return {
    $id: `urn:slipkit:schema:slip:${CURRENT_SCHEMA_VERSION}`,
    title: `SlipKit .slip file (schemaVersion ${CURRENT_SCHEMA_VERSION})`,
    ...jsonSchema,
  };
}
