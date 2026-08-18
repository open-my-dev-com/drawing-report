/**
 * .slip 파일 봉투(envelope) 검증.
 *
 * 스캐폴딩 단계에서는 봉투(schemaVersion·kind)만 엄격 검증하고 본문은 통과시킨다.
 * 본문 상세 스키마는 SPEC.md 확정과 함께 채워 넣는다 (Zod → JSON Schema 산출, ADR-022).
 */
import { z } from 'zod';
import type { SlipFile } from './types.js';

/** 현재 스키마 버전. 포맷이 확정되면 1.0.0으로 올린다. */
export const CURRENT_SCHEMA_VERSION = '0.1.0';

export const slipEnvelopeSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'schemaVersion은 semver 형식이어야 합니다'),
  kind: z.enum(['template', 'voucher']),
});

export class SlipParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipParseError';
  }
}

/**
 * JSON 문자열을 .slip 파일로 파싱한다.
 * 봉투 검증 실패 시 SlipParseError를 던진다.
 */
export function parseSlipFile(json: string): SlipFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SlipParseError('유효한 JSON이 아닙니다');
  }
  const envelope = slipEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new SlipParseError(`.slip 봉투 검증 실패: ${envelope.error.issues.map((i) => i.message).join(', ')}`);
  }
  // TODO(SPEC.md): kind별 본문 스키마 검증 + schemaVersion 마이그레이션(ADR-007)
  return raw as SlipFile;
}

export function serializeSlipFile(file: SlipFile): string {
  return JSON.stringify(file, null, 2);
}
