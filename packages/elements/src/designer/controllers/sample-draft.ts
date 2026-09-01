/**
 * 샘플 데이터 모달의 초안 상태 — 페이지, JSON 편집과 이미지 선택 오류.
 *
 * @remarks
 * 항목별 편집은 값을 바로 파일에 반영하고, JSON 편집만 초안을 따로 둡니다.
 */

import type { ReactiveController } from 'lit';

export interface SampleDraftHost {
  requestUpdate(): void;
}

/**
 * JSON 초안을 sampleValues에 저장할 객체로 변환합니다.
 *
 * @param draft - 입력한 JSON 문자열
 * @returns 넣을 객체. 빈 글이면 빈 객체, 형식이 잘못됐으면 null
 */
export function parseSampleValues(draft: string): Record<string, unknown> | null {
  const trimmed = draft.trim();
  if (trimmed === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  // 최상위가 객체가 아니면 파라미터 키를 만들 수 없습니다.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export class SampleDraftController implements ReactiveController {
  private _page = 0;
  private _jsonMode = false;
  private _jsonDraft = '';
  private _imageError: string | null = null;

  constructor(private readonly host: SampleDraftHost) {}

  hostConnected(): void {
    this.host.requestUpdate();
  }

  /** 항목별 편집에서 보고 있는 페이지 */
  get page(): number {
    return this._page;
  }

  /** JSON 편집 탭을 보고 있는지 */
  get jsonMode(): boolean {
    return this._jsonMode;
  }

  /** JSON 편집 탭의 입력 내용 */
  get jsonDraft(): string {
    return this._jsonDraft;
  }

  /** 이미지 선택 실패 문구 */
  get imageError(): string | null {
    return this._imageError;
  }

  /** 모달을 처음 열 때의 상태로 되돌립니다. 화면 갱신은 호출부가 처리합니다. */
  reset(): void {
    this._page = 0;
    this._jsonMode = false;
    this._imageError = null;
  }

  /**
   * 항목별 편집의 페이지를 옮깁니다.
   *
   * @param page - 옮길 페이지 번호 (0부터)
   */
  setPage(page: number): void {
    this._page = page;
    this.host.requestUpdate();
  }

  /**
   * 편집 방식을 바꿉니다.
   *
   * @param jsonMode - JSON 편집으로 바꾸면 true
   * @param skeleton - JSON 편집으로 처음 들어갈 때 채울 초안
   */
  setJsonMode(jsonMode: boolean, skeleton: () => string): void {
    if (this._jsonMode === jsonMode) return;
    this._jsonMode = jsonMode;
    // JSON 편집으로 들어갈 때만 현재 값에서 초안을 만듭니다.
    if (jsonMode) this._jsonDraft = skeleton();
    this.host.requestUpdate();
  }

  /**
   * JSON 입력 내용을 반영합니다.
   *
   * @param value - 입력란의 현재 내용
   */
  setJsonDraft(value: string): void {
    this._jsonDraft = value;
    this.host.requestUpdate();
  }

  /**
   * 이미지 선택 실패 문구를 설정하거나 지웁니다.
   *
   * @param message - 표시할 문구. null이면 지웁니다
   */
  setImageError(message: string | null): void {
    this._imageError = message;
    this.host.requestUpdate();
  }

  /**
   * JSON 초안을 파일에 넣을 객체로 바꿉니다.
   *
   * @returns 넣을 객체. 형식이 잘못됐으면 null
   */
  parsedValues(): Record<string, unknown> | null {
    return parseSampleValues(this._jsonDraft);
  }
}
