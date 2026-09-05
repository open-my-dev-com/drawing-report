/**
 * 수식 편집 모달의 상태 — 편집 대상, 입력 중인 수식, 커서 위치, 미리 계산에 쓸 샘플 항목과
 * 함수 찾아보기.
 *
 * @remarks
 * 초안은 적용을 누를 때까지 파일에 반영하지 않습니다.
 */

import type { ReactiveController } from 'lit';
import { formatReferencePath } from '@omdc-slipkit/core';
import type { FormulaOrigin, FormulaTarget } from '../formula-target.js';

/** 참조 영역에서 보고 있는 탭 */
export type ReferenceTab = 'functions' | 'values';

export interface FormulaDraftHost {
  requestUpdate(): void;
  readonly updateComplete: Promise<boolean>;
}

/** 하위 필드 자동완성에 사용할 목록 파라미터 */
export interface SuggestParameter {
  key: string;
  fields: readonly { key: string; title: string }[];
}

/** 자동완성으로 넣을 하위 필드 하나 — `$(목록).` 뒤에 `$(필드)`로 넣습니다 */
export interface ColumnCompletion {
  /** 하위 필드 물리명 */
  key: string;
  /** 화면에 표시할 이름 */
  title: string;
  /** 커서 앞에서 지우고 바꿔 넣을 글자 수 — 이미 입력한 부분입니다 */
  replaceLength: number;
}

/** 커서 앞 입력에 맞는 하위 필드 제안 */
export interface ColumnSuggestion {
  columns: ColumnCompletion[];
  /** 이미 입력한 필드 글자 수 — 목록을 거르는 데 쓴 부분입니다 */
  typedLength: number;
}

/** `$(...)` 안 키 한 단계 — `\)`와 `\\`를 이스케이프한 형태 */
const KEY = String.raw`(?:[^)\\]|\\.)*`;
/** `$(목록).$(필드` 입력 — 필드 참조를 여는 중. 앞에 점이 있으면 목록이 아니라 경로의 중간 단계입니다 */
const OPEN_STEP = new RegExp(String.raw`(?<!\.)\$\((${KEY})\)\.\$\((${KEY})$`, 'u');
/** `$(목록).필드` 입력 — 점 뒤에 이름을 그대로 치는 중 */
const BARE_STEP = new RegExp(String.raw`(?<!\.)\$\((${KEY})\)\.([\p{L}\p{N}_]*)$`, 'u');

/** `$(...)` 안에 적힌 키의 이스케이프를 풉니다. */
function unescapeKey(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

/**
 * 커서 앞의 `$(목록).` 입력에 맞는 하위 필드를 제안합니다.
 *
 * @remarks
 * `$(목록).`·`$(목록).$(필드`·`$(목록).필드` 뒤만 보고 `$(필드)`로 완성합니다. 목록 파라미터를
 * `$(...)` 없이 적은 입력은 참조가 아니므로 제안하지 않습니다.
 *
 * @param draft - 입력 중인 수식
 * @param caret - 커서 위치
 * @param parameters - 하위 필드를 가진 파라미터 목록
 * @returns 제안할 필드 목록과 이미 입력한 글자 수. 제안할 것이 없으면 null
 */
export function columnSuggestion(
  draft: string,
  caret: number,
  parameters: readonly SuggestParameter[],
): ColumnSuggestion | null {
  const at = Math.min(caret, draft.length);
  const before = draft.slice(0, at);
  const open = OPEN_STEP.exec(before);
  const match = open ?? BARE_STEP.exec(before);
  if (!match) return null;
  const listKey = unescapeKey(match[1] ?? '');
  const rawTyped = match[2] ?? '';
  const typed = open === null ? rawTyped : unescapeKey(rawTyped);

  const target = parameters.find((b) => b.key === listKey && b.fields.length > 0);
  if (!target) return null;
  // `$(목록).`은 이미 있으므로 친 이름(열어 둔 `$(` 포함)만 지우고 `$(필드)`를 넣습니다.
  const replaceLength = rawTyped.length + (open === null ? 0 : 2);
  const columns = target.fields
    .filter((field) => field.key.toLowerCase().startsWith(typed.toLowerCase()))
    .map((field): ColumnCompletion => ({ key: field.key, title: field.title, replaceLength }));
  return columns.length > 0 ? { columns, typedLength: typed.length } : null;
}

export class FormulaDraftController implements ReactiveController {
  private _draft = '';
  private _caret = 0;
  private _target: FormulaTarget | null = null;
  private _origin: FormulaOrigin | null = null;
  private _itemIndex: number | null = null;
  private _query = '';
  private _category: string | null = null;
  private _picked: string | null = null;
  private _tab: ReferenceTab = 'functions';

  /**
   * @param host - 화면 갱신을 요청할 호스트
   * @param getInput - 수식 입력 요소를 반환하는 함수. 텍스트 삽입 후 커서 위치를 복원할 때 사용합니다
   */
  constructor(
    private readonly host: FormulaDraftHost,
    private readonly getInput: () => HTMLTextAreaElement | null,
  ) {}

  hostConnected(): void {
    this.host.requestUpdate();
  }

  /** 입력 중인 수식 */
  get draft(): string {
    return this._draft;
  }

  /** 현재 커서 위치 */
  get caret(): number {
    return this._caret;
  }

  /** 편집 중인 대상. 모달을 연 적이 없으면 null */
  get target(): FormulaTarget | null {
    return this._target;
  }

  /** 모달을 열 때 기록한 대상 내용. 모달을 연 적이 없으면 null */
  get origin(): FormulaOrigin | null {
    return this._origin;
  }

  /** 계산에 사용할 샘플 항목. 반복 그리드가 아니거나 샘플이 없으면 null */
  get itemIndex(): number | null {
    return this._itemIndex;
  }

  /**
   * 편집을 시작합니다.
   *
   * @param target - 편집할 대상
   * @param origin - 열 때의 대상 내용. 모달이 열려 있는 동안 대상이 그대로인지 확인하는 데 씁니다
   * @param itemIndex - 계산에 사용할 샘플 항목. 반복 그리드가 아니면 null
   */
  start(target: FormulaTarget, origin: FormulaOrigin, itemIndex: number | null = null): void {
    this._target = target;
    this._origin = { formula: origin.formula, ...(origin.rule === undefined ? {} : { rule: { ...origin.rule } }) };
    this._draft = origin.formula ?? '';
    this._caret = this._draft.length;
    this._itemIndex = itemIndex;
    this._query = '';
    this._category = null;
    this._picked = null;
    this._tab = 'functions';
  }

  /** 참조 영역에서 보고 있는 탭 */
  get tab(): ReferenceTab {
    return this._tab;
  }

  /**
   * 참조 영역의 탭을 바꿉니다.
   *
   * @param tab - 보여 줄 탭
   */
  setTab(tab: ReferenceTab): void {
    if (tab === this._tab) return;
    this._tab = tab;
    this.host.requestUpdate();
  }

  /** 함수 검색어 */
  get query(): string {
    return this._query;
  }

  /** 고른 함수 분류. 전체를 보고 있으면 null */
  get category(): string | null {
    return this._category;
  }

  /** 상세를 보고 있는 함수 이름. 고른 것이 없으면 null */
  get picked(): string | null {
    return this._picked;
  }

  /**
   * 함수 검색어를 바꿉니다.
   *
   * @param value - 새 검색어
   */
  setQuery(value: string): void {
    if (value === this._query) return;
    this._query = value;
    this.host.requestUpdate();
  }

  /**
   * 함수 분류를 고릅니다.
   *
   * @param title - 고른 분류. 전체를 보려면 null
   */
  setCategory(title: string | null): void {
    if (title === this._category) return;
    this._category = title;
    this.host.requestUpdate();
  }

  /**
   * 상세를 볼 함수를 고릅니다.
   *
   * @param name - 고른 함수 이름. 상세를 닫으려면 null
   */
  pick(name: string | null): void {
    if (name === this._picked) return;
    this._picked = name;
    this.host.requestUpdate();
  }

  /**
   * 계산에 사용할 샘플 항목을 바꿉니다.
   *
   * @param index - 고른 샘플 항목. 선택을 지우려면 null
   */
  selectItem(index: number | null): void {
    if (index === this._itemIndex) return;
    this._itemIndex = index;
    this.host.requestUpdate();
  }

  /**
   * 입력란의 내용과 커서 위치를 반영합니다.
   *
   * @param value - 입력란의 현재 내용
   * @param caret - 커서 위치
   */
  setDraft(value: string, caret: number): void {
    this._draft = value;
    this._caret = caret;
    this.host.requestUpdate();
  }

  /**
   * 타자 없이 커서만 옮겼을 때 위치를 갱신합니다.
   *
   * @param caret - 새 커서 위치
   */
  syncCaret(caret: number): void {
    if (caret === this._caret) return;
    this._caret = caret;
    this.host.requestUpdate();
  }

  /**
   * 커서 위치에 글을 끼워 넣고 커서를 끼운 글 뒤로 옮깁니다.
   *
   * @param text - 커서 자리에 넣을 글
   * @param after - 커서 뒤에 함께 붙일 글 (함수 이름 뒤의 닫는 괄호 등)
   */
  insert(text: string, after = ''): void {
    const [start, end] = this._selection();
    this._splice(start, end, text, after);
  }

  /**
   * 값 참조를 `$(...)` 형식으로 커서 자리에 넣습니다.
   *
   * @param path - 넣을 참조 경로. 파라미터 키는 `@item`이라는 이름이어도 `$(@item)`으로 적습니다
   * @param options - 첫 단계가 그리드 예약 참조 이름이면 `reserved`를 지정해 그대로 적습니다
   */
  insertReference(path: readonly string[], options?: { reserved?: boolean }): void {
    const [start, end] = this._selection();
    this._splice(start, end, formatReferencePath(path, options));
  }

  /**
   * 자동완성 항목으로 커서 앞의 입력을 `$(필드)`로 완성합니다.
   *
   * @param column - 고른 하위 필드
   */
  complete(column: ColumnCompletion): void {
    const [, end] = this._selection();
    const start = Math.max(0, end - column.replaceLength);
    this._splice(start, end, formatReferencePath([column.key]));
  }

  /** 입력란의 선택 범위. 입력란이 없으면 초안 끝 */
  private _selection(): [number, number] {
    const input = this.getInput();
    return [input?.selectionStart ?? this._draft.length, input?.selectionEnd ?? this._draft.length];
  }

  /** `start`~`end`를 `text + after`로 바꾸고 커서를 `text` 뒤에 둡니다. */
  private _splice(start: number, end: number, text: string, after = ''): void {
    this._apply(this._draft.slice(0, start) + text + after + this._draft.slice(end), start + text.length);
  }

  /** 초안을 바꾸고 화면을 다시 그린 뒤 입력란의 커서를 옮깁니다. */
  private _apply(draft: string, caret: number): void {
    this._draft = draft;
    this._caret = caret;
    this.host.requestUpdate();
    void this.host.updateComplete.then(() => {
      const next = this.getInput();
      if (!next) return;
      next.focus();
      next.setSelectionRange(caret, caret);
      this._caret = caret;
    });
  }

  /**
   * 파일에 적용할 값을 만듭니다.
   *
   * @returns 앞뒤 공백을 지운 수식. 비어 있으면 null (수식을 지운다는 뜻)
   */
  commit(): string | null {
    return this._draft.trim() || null;
  }

  /**
   * 지금 커서 위치에 맞는 하위 필드 제안을 만듭니다.
   *
   * @param parameters - 하위 필드를 가진 파라미터 목록
   * @returns 제안할 필드 목록. 제안할 것이 없으면 null
   */
  suggestion(parameters: readonly SuggestParameter[]): ColumnSuggestion | null {
    return columnSuggestion(this._draft, this._caret, parameters);
  }
}
