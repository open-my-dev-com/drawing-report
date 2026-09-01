/**
 * 수식 편집 모달의 상태 — 편집 대상, 입력 중인 수식, 커서 위치, 미리 계산에 쓸 샘플 항목과
 * 함수 찾아보기.
 *
 * @remarks
 * 초안은 적용을 누를 때까지 파일에 반영하지 않습니다.
 */

import type { ReactiveController } from 'lit';
import type { FormulaOrigin, FormulaTarget } from '../formula-target.js';

export interface FormulaDraftHost {
  requestUpdate(): void;
  readonly updateComplete: Promise<boolean>;
}

/** 하위 필드 자동완성에 사용할 목록 파라미터 */
export interface SuggestParameter {
  key: string;
  fields: readonly { key: string; title: string }[];
}

/** 커서 앞 입력에 맞는 하위 필드 제안 */
export interface ColumnSuggestion {
  columns: { key: string; title: string }[];
  /** 이미 입력한 글자 수 — 이어 붙일 때 이만큼 건너뜁니다 */
  typedLength: number;
}

/** 목록 파라미터와 하위 필드를 잇는 `파라미터.필드` 입력 */
const FIELD_REFERENCE = /([A-Za-z0-9_가-힣]+)\.([A-Za-z0-9_가-힣]*)$/;

/**
 * 커서 앞의 `목록파라미터.필드` 입력에 맞는 하위 필드를 제안합니다.
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
  const match = FIELD_REFERENCE.exec(draft.slice(0, at));
  if (!match) return null;

  const target = parameters.find((b) => b.key === match[1] && b.fields.length > 0);
  if (!target) return null;
  const typed = match[2] ?? '';
  const columns = target.fields
    .filter((field) => field.key.toLowerCase().startsWith(typed.toLowerCase()))
    .map((field) => ({ key: field.key, title: field.title }));
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
   * @param origin - 열 때의 대상 내용. 적용 직전에 대상이 그대로인지 확인하는 데 씁니다
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
    const input = this.getInput();
    const start = input?.selectionStart ?? this._draft.length;
    const end = input?.selectionEnd ?? this._draft.length;
    this._draft = this._draft.slice(0, start) + text + after + this._draft.slice(end);
    this.host.requestUpdate();
    void this.host.updateComplete.then(() => {
      const next = this.getInput();
      if (!next) return;
      next.focus();
      const caret = start + text.length;
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
