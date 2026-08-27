/**
 * 저장소 어댑터 인터페이스.
 * 저장, 조회, 삭제, 목록 조회를 정의하며 버전 이력은 선택적으로 지원한다.
 */
import type { SlipFile, SlipFileKind } from '../format/types.js';

/** 저장소 오류의 원인 구분 */
export type SlipStorageErrorCode = 'not-found' | 'unsupported' | 'io' | 'cancelled';

/** 저장소 작업 오류. `code`로 원인을 구분한다. */
export class SlipStorageError extends Error {
  readonly code: SlipStorageErrorCode;

  constructor(code: SlipStorageErrorCode, message: string) {
    super(message);
    this.name = 'SlipStorageError';
    this.code = code;
  }
}

/** list 필터 조건 */
export interface SlipListFilter {
  kind?: SlipFileKind;
  /** 제목 등 저장소 구현이 지원하는 필드를 검색할 문자열 */
  query?: string;
}

/** list 결과 한 페이지 */
export interface SlipListPage {
  items: SlipListItem[];
  /** 다음 페이지 커서. 없으면 마지막 페이지 */
  nextCursor?: string;
}

/** 파일 본문을 제외한 목록 항목 정보 */
export interface SlipListItem {
  id: string;
  kind: SlipFileKind;
  title: string;
  updatedAt?: string;
}

/** 호스트 저장소를 연결하는 인터페이스  */
export interface StorageAdapter {
  /**
   * 파일을 저장한다. 같은 id가 이미 있으면 덮어쓴다.
   *
   * @param id - 저장 키
   * @param file - 저장할 `.slip` 파일
   * @throws SlipStorageError 저장 실패(io)·미지원(unsupported) 시
   */
  save(id: string, file: SlipFile): Promise<void>;
  /**
   * id의 파일을 불러온다.
   *
   * @param id - 저장 키
   * @returns 불러온 `.slip` 파일
   * @throws SlipStorageError 없음(not-found)·읽기 실패(io)·사용자 취소(cancelled) 시
   */
  load(id: string): Promise<SlipFile>;
  /**
   * id의 파일을 삭제한다.
   *
   * @param id - 저장 키
   * @throws SlipStorageError 삭제 실패(io)·미지원(unsupported) 시
   */
  delete(id: string): Promise<void>;
  /**
   * 저장된 파일 목록을 페이지 단위로 반환한다.
   *
   * @param filter - 종류·검색어 필터 (생략하면 전체)
   * @param cursor - 이전 페이지가 돌려준 nextCursor (생략하면 첫 페이지)
   * @returns 목록 한 페이지
   * @throws SlipStorageError 조회 실패(io)·미지원(unsupported) 시
   */
  list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage>;
}

/** 버전 이력을 지원하는 저장소 인터페이스 */
export interface VersionedStorageAdapter extends StorageAdapter {
  /**
   * ID에 해당하는 파일의 저장 이력을 반환한다.
   *
   * @param id - 저장 키
   * @returns 버전 식별자·저장 시각 목록
   */
  listVersions(id: string): Promise<{ version: string; savedAt: string }[]>;
  /**
   * 특정 버전의 파일을 불러온다.
   *
   * @param id - 저장 키
   * @param version - listVersions가 돌려준 버전 식별자
   * @returns 해당 버전의 `.slip` 파일
   */
  loadVersion(id: string, version: string): Promise<SlipFile>;
}

/**
 * 어댑터의 버전 이력 지원 여부를 판별한다.
 *
 * @param adapter - 검사할 어댑터
 * @returns 버전 이력 메서드를 구현했으면 true
 */
export function supportsVersions(adapter: StorageAdapter): adapter is VersionedStorageAdapter {
  return 'listVersions' in adapter && 'loadVersion' in adapter;
}
