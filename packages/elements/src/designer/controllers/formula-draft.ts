/**
 * 수식 편집 모달의 상태 — 편집 대상, 입력 중인 수식, 커서 위치, 미리 계산에 쓸 샘플 항목과
 * 함수 찾아보기.
 *
 * @remarks
 * 초안은 적용을 누를 때까지 파일에 반영하지 않습니다.
 */

import type { ReactiveController } from 'lit';
import {
  collectFormulaReferences,
  formatReferencePath,
  isBareIdentifier,
  toExplicitReferences,
  type FormulaReference,
} from '@omdc-slipkit/core';
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

/** 자동완성으로 넣을 하위 필드 하나 */
export interface ColumnCompletion {
  /** 하위 필드 물리명 */
  key: string;
  /** 화면에 표시할 이름 */
  title: string;
  /** 커서 앞에서 지우고 바꿔 넣을 글자 수 — 이미 입력한 부분입니다 */
  replaceLength: number;
  /** 그대로 넣을 글. `$(...)` 참조로 넣어야 하면 null */
  text: string | null;
  /** `$(...)` 참조로 넣을 때의 경로 — `$(목록).` 뒤를 잇는 중이면 필드 한 단계, 아니면 `목록.필드` */
  path: string[];
}

/** 커서 앞 입력에 맞는 하위 필드 제안 */
export interface ColumnSuggestion {
  columns: ColumnCompletion[];
  /** 이미 입력한 필드 글자 수 — 목록을 거르는 데 쓴 부분입니다 */
  typedLength: number;
}

/** `$(...)` 안 키 한 단계 — `\)`와 `\\`를 이스케이프한 형태 */
const KEY = String.raw`(?:[^)\\]|\\.)*`;
/** `$(목록).$(필드` 입력 — 필드 참조를 여는 중 */
const EXPLICIT_OPEN = new RegExp(String.raw`\$\((${KEY})\)\.\$\((${KEY})$`, 'u');
/** `$(목록).필드` 입력 — 점 뒤에 이름을 그대로 치는 중 */
const EXPLICIT_BARE = new RegExp(String.raw`\$\((${KEY})\)\.([\p{L}\p{N}_]*)$`, 'u');
/** `목록.필드` 입력 — 식별자 규칙은 파서와 같고 예약 참조(`@item.`)나 앞 단계(`a.b.`)는 제외합니다 */
const LEGACY = /(?<![\p{L}\p{N}_@.$])([\p{L}_][\p{L}\p{N}_]*)\.([\p{L}\p{N}_]*)$/u;

/** `$(...)` 안에 적힌 키의 이스케이프를 풉니다. */
function unescapeKey(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

/**
 * 커서 앞의 `목록파라미터.필드` 입력에 맞는 하위 필드를 제안합니다.
 *
 * @remarks
 * 초안에 `$(`가 있으면 `$(목록).`·`$(목록).$(` 뒤만 보고 `$(필드)`로 완성합니다. 없으면 일반
 * 참조 `목록.` 뒤를 보고 이름을 그대로 완성하되, 식별자 규칙에 맞지 않는 필드는 `$(...)`
 * 참조로 완성합니다.
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
  const explicit = draft.includes('$(');
  const open = explicit ? EXPLICIT_OPEN.exec(before) : null;
  const match = open ?? (explicit ? EXPLICIT_BARE.exec(before) : LEGACY.exec(before));
  if (!match) return null;
  const listKey = explicit ? unescapeKey(match[1] ?? '') : (match[1] ?? '');
  const typed = open === null ? (match[2] ?? '') : unescapeKey(match[2] ?? '');

  const target = parameters.find((b) => b.key === listKey && b.fields.length > 0);
  if (!target) return null;
  const rawTyped = match[2] ?? '';
  const columns = target.fields
    .filter((field) => field.key.toLowerCase().startsWith(typed.toLowerCase()))
    .map((field): ColumnCompletion => {
      if (explicit) {
        // `$(목록).`은 이미 있으므로 열어 둔 `$(`까지 지우고 필드 한 단계만 넣습니다.
        const replaceLength = rawTyped.length + (open === null ? 0 : 2);
        return { key: field.key, title: field.title, replaceLength, text: null, path: [field.key] };
      }
      const path = [listKey, field.key];
      if (isBareIdentifier(field.key)) {
        return { key: field.key, title: field.title, replaceLength: rawTyped.length, text: field.key, path };
      }
      // 그대로 적을 수 없는 이름은 `목록.`까지 지우고 `$(목록).$(필드)`로 넣습니다.
      const replaceLength = listKey.length + 1 + rawTyped.length;
      return { key: field.key, title: field.title, replaceLength, text: null, path };
    });
  return columns.length > 0 ? { columns, typedLength: typed.length } : null;
}

/**
 * 참조가 들어갈 자리에 대신 세워 두는 일반 식별자 — 아직 완성되지 않은 식(`a + `)도 참조가 들어간
 * 모양으로 파싱해 나머지 참조를 찾기 위한 것입니다.
 */
const PLACEHOLDER = '__slipkit_reference__';

/** 참조 범위를 뒤에서부터 바꿔 앞쪽 범위가 어긋나지 않게 합니다. */
function rewriteReferences(
  source: string,
  refs: readonly FormulaReference[],
  replacement: (ref: FormulaReference) => string,
): string {
  let out = source;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!;
    out = out.slice(0, ref.span.start) + replacement(ref) + out.slice(ref.span.end);
  }
  return out;
}

/**
 * 일반 참조 수식을 `$(...)` 참조로 바꿀 때 원래 위치가 옮겨 갈 자리를 계산합니다.
 *
 * @param refs - 원래 수식의 참조 목록 (원본 순서)
 * @param position - 원래 수식에서의 위치
 * @returns 바꾼 수식에서의 위치. 참조 한가운데였으면 그 참조 바로 뒤
 */
function mapConvertedPosition(refs: readonly FormulaReference[], position: number): number {
  let delta = 0;
  for (const ref of refs) {
    const length = formatReferencePath(ref.path, { reserved: ref.reserved }).length;
    if (ref.span.end <= position) {
      delta += length - (ref.span.end - ref.span.start);
      continue;
    }
    if (ref.span.start < position) return ref.span.start + delta + length;
    break;
  }
  return position + delta;
}

/**
 * 초안의 `start`~`end`를 지운 자리에 `$(...)` 참조를 넣은 결과를 만듭니다.
 *
 * @remarks
 * 남은 초안이 일반 참조만 쓰면 먼저 전체를 `$(...)` 참조로 바꿔 두 형식이 섞이지 않게 합니다.
 * 넣을 자리에 일반 식별자를 세워 파싱하므로 `a + ` 처럼 아직 끝나지 않은 식도 바꿀 수 있고,
 * 그래도 파싱되지 않으면 참조 자리를 뺀 나머지로 한 번 더 시도합니다. 둘 다 파싱되지 않으면
 * 바꾸지 않고 그대로 넣습니다 — 문법 검사가 이유를 알립니다.
 *
 * @param draft - 지금 초안
 * @param start - 지울 범위의 시작
 * @param end - 지울 범위의 끝
 * @param text - 넣을 `$(...)` 참조
 * @returns 새 초안과 넣은 참조 바로 뒤의 커서 위치
 */
function spliceReference(
  draft: string,
  start: number,
  end: number,
  text: string,
): { draft: string; caret: number } {
  const head = draft.slice(0, start);
  const tail = draft.slice(end);

  try {
    const probe = head + PLACEHOLDER + tail;
    const refs = collectFormulaReferences(probe);
    const placed = refs.find(
      (ref) => ref.span.start === head.length && ref.span.end === head.length + PLACEHOLDER.length,
    );
    if (placed !== undefined && placed.path.length === 1 && !refs.some((ref) => ref.explicit)) {
      const converted = rewriteReferences(probe, refs, (ref) =>
        ref === placed ? text : formatReferencePath(ref.path, { reserved: ref.reserved }));
      return { draft: converted, caret: mapConvertedPosition(refs, head.length) + text.length };
    }
  } catch {
    // 자리 표시자를 넣어도 파싱되지 않으면 아래에서 나머지만으로 다시 시도합니다.
  }

  const remainder = head + tail;
  if (remainder.trim() !== '') {
    try {
      const refs = collectFormulaReferences(remainder);
      if (!refs.some((ref) => ref.explicit)) {
        const converted = toExplicitReferences(remainder);
        const at = mapConvertedPosition(refs, head.length);
        return { draft: converted.slice(0, at) + text + converted.slice(at), caret: at + text.length };
      }
    } catch {
      // 파싱되지 않는 초안은 바꾸지 않고 그대로 넣습니다.
    }
  }
  return { draft: head + text + tail, caret: head.length + text.length };
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
   * @remarks
   * 초안이 일반 참조만 쓰는 수식이면 먼저 초안 전체를 `$(...)` 참조로 바꿔 두 형식이 섞이지
   * 않게 합니다. 초안을 파싱할 수 없으면 바꾸지 않고 그대로 넣으며, 문법 검사가 알립니다.
   *
   * @param path - 넣을 참조 경로. 파라미터 키는 `@item`이라는 이름이어도 `$(@item)`으로 적습니다
   * @param options - 첫 단계가 그리드 예약 참조 이름이면 `reserved`를 지정해 그대로 적습니다
   */
  insertReference(path: readonly string[], options?: { reserved?: boolean }): void {
    const [start, end] = this._selection();
    this._insertReferenceAt(start, end, path, options);
  }

  /**
   * 자동완성 항목으로 커서 앞의 입력을 완성합니다.
   *
   * @param column - 고른 하위 필드
   */
  complete(column: ColumnCompletion): void {
    const [, end] = this._selection();
    const start = Math.max(0, end - column.replaceLength);
    if (column.text !== null) {
      this._splice(start, end, column.text);
      return;
    }
    this._insertReferenceAt(start, end, column.path);
  }

  /** 입력란의 선택 범위. 입력란이 없으면 초안 끝 */
  private _selection(): [number, number] {
    const input = this.getInput();
    return [input?.selectionStart ?? this._draft.length, input?.selectionEnd ?? this._draft.length];
  }

  /** `start`~`end`를 지운 자리에 `$(...)` 참조를 넣습니다. 남은 초안이 일반 참조만 쓰면 먼저 바꿉니다. */
  private _insertReferenceAt(
    start: number,
    end: number,
    path: readonly string[],
    options?: { reserved?: boolean },
  ): void {
    const result = spliceReference(this._draft, start, end, formatReferencePath(path, options));
    this._apply(result.draft, result.caret);
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
