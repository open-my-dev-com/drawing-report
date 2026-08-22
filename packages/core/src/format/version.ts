/**
 * 현재 .slip 스키마 버전.
 * 스키마가 바뀔 때마다 올리고, migrate.ts에 이전 버전으로부터의 단계를 추가한다.
 * 제품 v1 안정 릴리스 시점에 1.0.0으로 확정한다 (docs/SPEC.md §2).
 */
export const CURRENT_SCHEMA_VERSION = '0.5.0';
