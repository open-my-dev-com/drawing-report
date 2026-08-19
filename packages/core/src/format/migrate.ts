/**
 * .slip schemaVersion 마이그레이션 계층 (ADR-007).
 *
 * 모든 파일은 `schemaVersion`을 내장하며, 구버전 파일을 열 때 현재 버전까지
 * 단계별 마이그레이션을 적용한다. 각 단계는 `from` 버전의 문서를 받아
 * `to` 버전의 문서를 돌려주는 순수 함수다.
 */
import { CURRENT_SCHEMA_VERSION } from './version.js';

export interface SlipMigrationStep {
  /** 이 단계가 입력으로 받는 schemaVersion */
  from: string;
  /** 이 단계를 거친 뒤의 schemaVersion */
  to: string;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/**
 * 내장 마이그레이션 목록. 스키마가 개정될 때마다 단계를 추가한다.
 */
export const BUILT_IN_MIGRATIONS: readonly SlipMigrationStep[] = [
  {
    // 0.1.1: 구조 크기 상한 추가 (SPEC §3.2) — 필드 구조 변화가 없어 문서를 그대로 통과시킨다.
    // 상한을 넘는 문서는 마이그레이션 뒤의 본문 검증에서 거부된다.
    from: '0.1.0',
    to: '0.1.1',
    migrate: (document) => document,
  },
];

export class SlipMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipMigrationError';
  }
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/**
 * 문서를 현재 schemaVersion까지 끌어올린다.
 * - 이미 현재 버전이면 그대로 반환
 * - 현재보다 새로운 버전이면 거부 (구현이 모르는 미래 포맷)
 * - 이어지는 마이그레이션 단계가 없는 구버전이면 거부
 */
export function migrateSlipDocument(
  document: Record<string, unknown>,
  steps: readonly SlipMigrationStep[] = BUILT_IN_MIGRATIONS,
): Record<string, unknown> {
  const version = document['schemaVersion'];
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new SlipMigrationError('schemaVersion이 semver 형식이 아닙니다');
  }
  if (compareSemver(version, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SlipMigrationError(
      `이 파일의 schemaVersion(${version})은 지원 버전(${CURRENT_SCHEMA_VERSION})보다 새롭습니다. 라이브러리를 업데이트하세요.`,
    );
  }

  let current = document;
  let currentVersion = version;
  const visited = new Set<string>();
  while (currentVersion !== CURRENT_SCHEMA_VERSION) {
    if (visited.has(currentVersion)) {
      throw new SlipMigrationError(`마이그레이션 경로에 순환이 있습니다: ${currentVersion}`);
    }
    visited.add(currentVersion);
    const step = steps.find((s) => s.from === currentVersion);
    if (!step) {
      throw new SlipMigrationError(
        `schemaVersion ${currentVersion}에서 ${CURRENT_SCHEMA_VERSION}(으)로 가는 마이그레이션 경로가 없습니다`,
      );
    }
    current = { ...step.migrate(current), schemaVersion: step.to };
    currentVersion = step.to;
  }
  return current;
}
