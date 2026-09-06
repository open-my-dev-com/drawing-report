/**
 * 되돌리기·다시 실행 기록.
 *
 * @remarks
 * 사용자 명령 하나가 끝날 때마다 그 직전의 양식을 JSON 문자열 스냅샷으로 한 벌 보관합니다.
 * 스냅샷은 만들어진 뒤 바뀌지 않으며 최대 50개까지만 남기고 가장 오래된 것부터 버립니다.
 * 새 명령이 기록되면 다시 실행 기록은 비웁니다. 각 항목은 그 시점의 저장 식별자도 함께 담아,
 * 불러온 양식을 되돌린 뒤 저장해도 불러온 양식을 덮어쓰지 않게 합니다.
 *
 * 드래그처럼 여러 단계에 걸치는 편집은 `begin`으로 시작 시점을 한 번만 찍고, 끝날 때 `commit`
 * 또는 `cancel`로 마무리합니다. 조작 컨트롤러는 스냅샷의 표현 방식을 알지 못하고 검사점만 주고받습니다.
 */

import type { ReactiveController } from 'lit';
import type { SlipTemplateFile } from '@omdc-slipkit/core';

/** 기록으로 남길 수 있는 최대 단계 수 */
const MAX_ENTRIES = 50;

declare const checkpointBrand: unique symbol;

/**
 * 편집 시작 시점의 문서 상태를 가리키는 검사점.
 *
 * @remarks
 * 내용은 `HistoryController`만 읽습니다. 조작 컨트롤러는 받은 검사점을 그대로 돌려주기만 합니다.
 */
export interface EditCheckpoint {
  readonly [checkpointBrand]: true;
}

/** 검사점 뒤에 보관하는 실제 상태 */
interface CheckpointRecord {
  /** 검사점을 찍은 시점의 양식 스냅샷. 양식이 없었으면 null */
  file: string | null;
  /** 검사점을 찍은 시점의 저장 식별자 */
  savedId: string | null;
  /** 이미 기록으로 남겼는지 — 같은 검사점을 두 번 넣지 않습니다 */
  committed: boolean;
}

/** 되돌리기 한 단계 — 양식 스냅샷과 그 시점의 저장 식별자 */
interface HistoryEntry {
  file: string;
  savedId: string | null;
}

/** 기록이 문서에 요청하는 것 */
export interface HistoryHost {
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 양식을 통째로 바꿉니다. 호스트는 이 호출로 문서 개정 번호를 올립니다 */
  setFile(file: SlipTemplateFile): void;
  /** 현재 저장 대상 식별자 */
  readonly savedId: string | null;
  /** 저장 대상 식별자를 되살립니다 */
  restoreSavedId(id: string | null): void;
}

export class HistoryController implements ReactiveController {
  private _undo: HistoryEntry[] = [];
  private _redo: HistoryEntry[] = [];
  /** 검사점마다 보관하는 상태. 검사점이 버려지면 함께 사라집니다 */
  private readonly _records = new WeakMap<EditCheckpoint, CheckpointRecord>();

  constructor(private readonly host: HistoryHost) {}

  hostConnected(): void {}

  /** 되돌릴 수 있는 단계 수 */
  get undoDepth(): number {
    return this._undo.length;
  }

  /** 다시 실행할 수 있는 단계 수 */
  get redoDepth(): number {
    return this._redo.length;
  }

  /** 되돌리기 기록만의 스냅샷 문자열 길이 합 — 한 명령이 남긴 스냅샷 크기를 재는 데 씁니다 */
  get undoSnapshotBytes(): number {
    let total = 0;
    for (const entry of this._undo) total += entry.file.length;
    return total;
  }

  /** 보관 중인 스냅샷 문자열 길이의 합 — 기록이 차지하는 크기를 가늠하는 데 씁니다 */
  get snapshotBytes(): number {
    let total = 0;
    for (const entry of this._undo) total += entry.file.length;
    for (const entry of this._redo) total += entry.file.length;
    return total;
  }

  /**
   * 편집 시작 시점의 양식을 한 번 담아 검사점을 만듭니다.
   *
   * @returns 나중에 `commit` 또는 `cancel`에 넘길 검사점
   */
  begin(): EditCheckpoint {
    const checkpoint = Object.freeze({}) as EditCheckpoint;
    this._records.set(checkpoint, {
      file: this.host.file === null ? null : JSON.stringify(this.host.file),
      savedId: this.host.savedId,
      committed: false,
    });
    return checkpoint;
  }

  /**
   * 검사점을 되돌리기 기록에 넣고 다시 실행 기록을 비웁니다. 같은 검사점을 다시 넣어도 한 번만 기록합니다.
   *
   * @param checkpoint - `begin`으로 만든 검사점
   */
  commit(checkpoint: EditCheckpoint): void {
    const record = this._records.get(checkpoint);
    if (record === undefined || record.committed || record.file === null) return;
    record.committed = true;
    this._undo.push({ file: record.file, savedId: record.savedId });
    this._redo = [];
    if (this._undo.length > MAX_ENTRIES) this._undo.shift();
  }

  /**
   * 검사점을 찍은 시점의 양식으로 되돌립니다. 기록은 건드리지 않습니다.
   *
   * @param checkpoint - `begin`으로 만든 검사점
   */
  cancel(checkpoint: EditCheckpoint): void {
    const record = this._records.get(checkpoint);
    if (record === undefined || record.file === null) return;
    this.host.setFile(JSON.parse(record.file) as SlipTemplateFile);
  }

  /** 지금 상태를 되돌리기 한 단계로 바로 기록합니다 — 한 번에 끝나는 편집에 씁니다. */
  record(): void {
    if (this.host.file === null) return;
    this.commit(this.begin());
  }

  /**
   * 한 단계 되돌립니다. 지금 상태는 다시 실행 기록으로 옮깁니다.
   *
   * @returns 되돌린 것이 있으면 true
   */
  undo(): boolean {
    return this._restore(this._undo, this._redo);
  }

  /**
   * 되돌린 한 단계를 다시 실행합니다. 지금 상태는 되돌리기 기록으로 옮깁니다.
   *
   * @returns 다시 실행한 것이 있으면 true
   */
  redo(): boolean {
    return this._restore(this._redo, this._undo);
  }

  /** 되돌리기·다시 실행 기록을 모두 비웁니다 — 양식을 새로 불러올 때 씁니다. */
  reset(): void {
    this._undo = [];
    this._redo = [];
  }

  /** `from`의 마지막 단계를 되살리고 지금 상태를 `to`에 넣습니다. */
  private _restore(from: HistoryEntry[], to: HistoryEntry[]): boolean {
    const current = this.host.file;
    if (from.length === 0 || current === null) return false;
    to.push({ file: JSON.stringify(current), savedId: this.host.savedId });
    const entry = from.pop()!;
    this.host.setFile(JSON.parse(entry.file) as SlipTemplateFile);
    this.host.restoreSavedId(entry.savedId);
    return true;
  }
}
