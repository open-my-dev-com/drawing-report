/**
 * 저장 모달과 내 양식 목록 모달의 상태.
 *
 * @remarks
 * 저장소는 호스트가 넘겨준 어댑터로만 다룬다 — 컨트롤러가 컴포넌트를 들여다보지 않는다.
 * 파일 자체를 고치는 일(제목 반영, 불러온 양식 반영)은 호출부가 한다.
 */

import type { ReactiveController } from 'lit';
import type { SlipListItem, StorageAdapter } from '@omdc-slipkit/core';

/** 저장·목록 상태가 필요로 하는 호스트의 최소 범위 */
export interface FormsHost {
  requestUpdate(): void;
}

export class FormsController implements ReactiveController {
  private _title = '';
  private _asNew = false;
  private _savedId: string | null = null;
  private _savedNotice = false;
  private _items: SlipListItem[] = [];
  private _page = 0;
  private _query = '';
  private _error: string | null = null;

  constructor(private readonly host: FormsHost) {}

  /**
   * 다시 연결되면 화면을 현재 상태에 맞춰 한 번 그린다.
   * 상태는 그대로 두므로 화면에서 뗐다 붙여도 편집 중이던 내용이 남는다.
   */
  hostConnected(): void {
    this.host.requestUpdate();
  }

  /** 저장 모달에 입력한 제목 */
  get title(): string {
    return this._title;
  }

  /** 새 양식으로 저장할지 */
  get asNew(): boolean {
    return this._asNew;
  }

  /** 현재 양식이 저장된 식별자. 저장한 적이 없으면 null */
  get savedId(): string | null {
    return this._savedId;
  }

  /** 저장 완료 안내를 표시할지 */
  get savedNotice(): boolean {
    return this._savedNotice;
  }

  /** 목록 모달의 검색어 */
  get query(): string {
    return this._query;
  }

  /** 목록 모달에서 보고 있는 페이지 */
  get page(): number {
    return this._page;
  }

  /** 저장·불러오기 실패 문구 */
  get error(): string | null {
    return this._error;
  }

  /**
   * 저장 모달을 열 준비를 한다.
   *
   * @param currentTitle - 현재 양식의 제목
   */
  startSave(currentTitle: string): void {
    this._title = currentTitle;
    this._asNew = false;
    this._error = null;
  }

  /**
   * 제목 입력을 반영한다.
   *
   * @param value - 입력한 제목
   */
  setTitle(value: string): void {
    this._title = value;
  }

  /**
   * 새 양식으로 저장할지 바꾼다.
   *
   * @param asNew - 새 양식으로 저장하면 true
   */
  setAsNew(asNew: boolean): void {
    this._asNew = asNew;
    this.host.requestUpdate();
  }

  /**
   * 이번에 저장할 식별자를 정한다.
   *
   * @returns 새 양식이거나 저장한 적이 없으면 새로 만든 식별자, 아니면 기존 식별자
   */
  nextId(): string {
    return this._asNew || !this._savedId ? crypto.randomUUID() : this._savedId;
  }

  /**
   * 저장에 성공했음을 기록한다.
   *
   * @param id - 저장한 식별자
   */
  markSaved(id: string): void {
    this._savedId = id;
    this._savedNotice = true;
    this._error = null;
    this.host.requestUpdate();
  }

  /**
   * 불러온 양식의 식별자를 현재 양식의 저장 식별자로 삼는다.
   *
   * @param id - 불러온 양식의 식별자
   */
  markLoaded(id: string): void {
    this._savedId = id;
    this._savedNotice = false;
  }

  /** 저장 완료 안내를 지운다. */
  clearNotice(): void {
    this._savedNotice = false;
  }

  /** 저장 식별자와 안내를 모두 지운다 — 새 양식을 열 때 쓴다. */
  reset(): void {
    this._savedId = null;
    this._savedNotice = false;
    this._error = null;
  }

  /**
   * 저장·불러오기 실패를 기록한다.
   *
   * @param error - 발생한 오류 또는 문구
   */
  fail(error: unknown): void {
    this._error = error instanceof Error ? error.message : String(error);
    this.host.requestUpdate();
  }

  /** 실패 문구를 지운다. */
  clearError(): void {
    this._error = null;
  }

  /**
   * 목록 모달의 검색어를 바꾼다. 검색하면 첫 페이지로 돌아간다.
   *
   * @param query - 입력한 검색어
   */
  setQuery(query: string): void {
    this._query = query;
    this._page = 0;
    this.host.requestUpdate();
  }

  /**
   * 목록 모달의 페이지를 옮긴다.
   *
   * @param page - 옮길 페이지 번호 (0부터)
   */
  setPage(page: number): void {
    this._page = page;
    this.host.requestUpdate();
  }

  /** 목록 모달을 열기 전 검색어와 페이지를 되돌린다. */
  startList(): void {
    this._query = '';
    this._page = 0;
  }

  /**
   * 저장된 양식의 메타데이터를 모두 불러온다.
   * 검색과 페이지 이동은 이 목록을 사용하며 양식 본문은 불러오지 않는다.
   *
   * @param adapter - 목록을 읽을 저장소
   */
  async loadList(adapter: StorageAdapter): Promise<void> {
    this._error = null;
    try {
      const items: SlipListItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await adapter.list({ kind: 'template' }, cursor);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      this._items = items;
    } catch (error) {
      this._items = [];
      this._error = error instanceof Error ? error.message : String(error);
    }
    this._page = 0;
    this.host.requestUpdate();
  }

  /**
   * 목록에서 한 항목을 지운다. 저장소 삭제는 호출부가 한다.
   *
   * @param id - 지운 양식의 식별자
   * @param pageSize - 한 페이지에 보이는 항목 수 — 목록이 줄어 빈 페이지가 되면 되돌린다
   */
  forget(id: string, pageSize: number): void {
    this._items = this._items.filter((item) => item.id !== id);
    if (this._savedId === id) this._savedId = null;
    const lastPage = Math.max(0, Math.ceil(this.filtered().length / pageSize) - 1);
    if (this._page > lastPage) this._page = lastPage;
    this.host.requestUpdate();
  }

  /**
   * 제목에 검색어가 들어 있는 양식만 고른다.
   *
   * @returns 검색어에 맞는 양식 목록. 검색어가 없으면 전체
   */
  filtered(): SlipListItem[] {
    const query = this._query.trim().toLowerCase();
    if (!query) return this._items;
    return this._items.filter((item) => item.title.toLowerCase().includes(query));
  }
}
