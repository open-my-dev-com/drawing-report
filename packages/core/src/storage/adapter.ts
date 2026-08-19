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
  /**
   * 파일을 저장한다. 같은 id가 이미 있으면 덮어쓴다.
   *
   * @param id 저장 키
   * @param file 저장할 .slip 파일
   * @throws SlipStorageError 저장 실패(io)·미지원(unsupported) 시
   */
  save(id: string, file: SlipFile): Promise<void>;
  /**
   * id의 파일을 불러온다.
   *
   * @param id 저장 키
   * @returns 불러온 .slip 파일
   * @throws SlipStorageError 없음(not-found)·읽기 실패(io) 시
   */
  load(id: string): Promise<SlipFile>;
  /**
   * id의 파일을 삭제한다.
   *
   * @param id 저장 키
   * @throws SlipStorageError 삭제 실패(io)·미지원(unsupported) 시
   */
  delete(id: string): Promise<void>;
  /**
   * 저장된 파일 목록을 페이징해 돌려준다.
   *
   * @param filter 종류·검색어 필터 (생략하면 전체)
   * @param cursor 이전 페이지가 돌려준 nextCursor (생략하면 첫 페이지)
   * @returns 목록 한 페이지
   * @throws SlipStorageError 조회 실패(io)·미지원(unsupported) 시
   */
  list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage>;
}

/** 버전 이력 — 구현한 어댑터에서만 이력 UI가 노출된다 (선택) */
export interface VersionedStorageAdapter extends StorageAdapter {
  /**
   * id의 저장 버전 이력을 돌려준다.
   *
   * @param id 저장 키
   * @returns 버전 식별자·저장 시각 목록
   */
  listVersions(id: string): Promise<{ version: string; savedAt: string }[]>;
  /**
   * 특정 버전의 파일을 불러온다.
   *
   * @param id 저장 키
   * @param version listVersions가 돌려준 버전 식별자
   * @returns 해당 버전의 .slip 파일
   */
  loadVersion(id: string, version: string): Promise<SlipFile>;
}

/**
 * 어댑터가 버전 이력을 지원하는지 판별한다 (타입 좁히기).
 *
 * @param adapter 검사할 어댑터
 * @returns 버전 이력 메서드를 구현했으면 true
 */
export function supportsVersions(adapter: StorageAdapter): adapter is VersionedStorageAdapter {
  return 'listVersions' in adapter && 'loadVersion' in adapter;
}
