/**
 * 저장소 어댑터 인터페이스 (ADR-021).
 * save/load/delete/list 필수, 버전 이력은 선택 인터페이스.
 */
import type { SlipFile, SlipFileKind } from '../format/types.js';

/** 저장소 작업 실패. code로 원인을 구분한다 */
export class SlipStorageError extends Error {
  readonly code: 'not-found' | 'unsupported' | 'io';

  constructor(code: 'not-found' | 'unsupported' | 'io', message: string) {
    super(message);
    this.name = 'SlipStorageError';
    this.code = code;
  }
}

/** list() 필터 조건 */
export interface SlipListFilter {
  kind?: SlipFileKind;
  /** 제목 부분 일치 등 자유 검색어 */
  query?: string;
}

/** list() 결과 한 페이지 */
export interface SlipListPage {
  items: SlipListItem[];
  /** 다음 페이지 커서. 없으면 마지막 페이지 */
  nextCursor?: string;
}

/** 목록 항목 요약 — 본문 없이 메타만 */
export interface SlipListItem {
  id: string;
  kind: SlipFileKind;
  title: string;
  updatedAt?: string;
}

/** 저장소 어댑터 — 호스트가 자체 저장 매체(S3·DB 등)로 구현할 수 있다 (ADR-021) */
export interface StorageAdapter {
  save(id: string, file: SlipFile): Promise<void>;
  load(id: string): Promise<SlipFile>;
  delete(id: string): Promise<void>;
  list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage>;
}

/** 버전 이력 — 구현한 어댑터에서만 이력 UI가 노출된다 (선택) */
export interface VersionedStorageAdapter extends StorageAdapter {
  listVersions(id: string): Promise<{ version: string; savedAt: string }[]>;
  loadVersion(id: string, version: string): Promise<SlipFile>;
}

/** 어댑터가 버전 이력을 지원하는지 판별한다 (타입 좁히기) */
export function supportsVersions(adapter: StorageAdapter): adapter is VersionedStorageAdapter {
  return 'listVersions' in adapter && 'loadVersion' in adapter;
}
