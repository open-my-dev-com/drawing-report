/**
 * `.slip` 문서를 현재 schemaVersion으로 변환한다.
 *
 * 모든 파일은 `schemaVersion`을 내장하며, 구버전 파일을 열 때 현재 버전까지
 * 단계별 마이그레이션을 적용한다. 각 단계는 `from` 버전의 문서를 `to` 버전 문서로
 * 변환하는 순수 함수다.
 */
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { fmt } from './messages.js';

/** `from` 버전 문서를 `to` 버전 문서로 변환하는 마이그레이션 단계. */
export interface SlipMigrationStep {
  /** 이 단계가 입력으로 받는 schemaVersion */
  from: string;
  /** 이 단계를 거친 뒤의 schemaVersion */
  to: string;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/**
 * 내장 마이그레이션 목록. 스키마가 개정될 때마다 단계를 추가한다.
 *
 * @remarks
 * 이전 버전이 없으므로 현재 목록은 비어 있다.
 */
export const BUILT_IN_MIGRATIONS: readonly SlipMigrationStep[] = [];

/** 지원하지 않는 버전이거나 마이그레이션 경로를 구성할 수 없을 때 발생하는 오류. */
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
 * 문서를 현재 `schemaVersion`으로 마이그레이션한다.
 * - 현재 버전이면 입력 문서를 반환한다.
 * - 지원 버전보다 새롭거나 마이그레이션 경로가 없는 문서는 오류를 발생시킨다.
 *
 * @param document - schemaVersion을 가진 `.slip` 문서 (파싱된 JSON 객체)
 * @param steps - 적용할 마이그레이션 단계 목록 (기본: 내장 목록)
 * @returns 현재 schemaVersion으로 마이그레이션한 문서
 * @throws SlipMigrationError 버전 형식 오류·미래 버전·경로 없음·순환 시
 */
export function migrateSlipDocument(
  document: Record<string, unknown>,
  steps: readonly SlipMigrationStep[] = BUILT_IN_MIGRATIONS,
): Record<string, unknown> {
  const version = document['schemaVersion'];
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new SlipMigrationError(fmt().migrateSemver());
  }
  if (compareSemver(version, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SlipMigrationError(fmt().migrateNewer(version, CURRENT_SCHEMA_VERSION));
  }

  let current = document;
  let currentVersion = version;
  const visited = new Set<string>();
  while (currentVersion !== CURRENT_SCHEMA_VERSION) {
    if (visited.has(currentVersion)) {
      throw new SlipMigrationError(fmt().migrateCycle(currentVersion));
    }
    visited.add(currentVersion);
    const step = steps.find((s) => s.from === currentVersion);
    if (!step) {
      throw new SlipMigrationError(fmt().migrateNoPath(currentVersion, CURRENT_SCHEMA_VERSION));
    }
    current = { ...step.migrate(current), schemaVersion: step.to };
    currentVersion = step.to;
  }
  return current;
}
