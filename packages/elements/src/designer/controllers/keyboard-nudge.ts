/**
 * 화살표 키로 선택한 요소를 옮기는 조작입니다.
 *
 * @remarks
 * 키를 누르고 있는 동안(keyup 전까지)의 연속 이동은 한 번의 되돌리기 단계와 한 번의
 * 변경 알림으로 묶습니다. 첫 keydown에서 시작 직전 상태를 기록하고, 화살표 키를 떼거나 초점을 잃을 때
 * 커밋합니다. 좌표 계산은 `arrange.ts`가 맡습니다.
 */

import type { ReactiveController } from 'lit';
import type { SlipElement, SlipTemplateFile } from '@omdc-slipkit/core';
import { movedPositions, nudgeDelta } from '../arrange.js';
import type { EditCheckpoint } from './history.js';

/** 키보드 이동에서 사용하는 문서 작업입니다. */
export interface NudgeHost {
  /** 편집 중인 양식입니다. */
  readonly file: SlipTemplateFile | null;
  /** 함께 선택된 요소 ID 모음입니다. */
  readonly selectedIds: ReadonlySet<string>;
  /** ID로 요소를 찾습니다. */
  findElement(id: string): SlipElement | undefined;
  /** 조작 직전 상태를 기록합니다. */
  beginEdit(): EditCheckpoint;
  /** 기록한 상태를 되돌리기 기록에 추가합니다. */
  commitEdit(checkpoint: EditCheckpoint): void;
  /** 바뀐 양식을 호스트에 알립니다. */
  emitChange(): void;
  /** 요소를 직접 바꾼 뒤 화면을 다시 그리기 전에 문서 변경을 알립니다. */
  touch(): void;
  /** 화면을 다시 그립니다. */
  refresh(): void;
}

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

export class KeyboardNudgeController implements ReactiveController {
  /** 연속 이동을 시작하기 직전의 상태와 실제 이동 여부입니다. */
  private _run: { snapshot: EditCheckpoint; moved: boolean } | null = null;

  constructor(private readonly host: NudgeHost) {}

  hostConnected(): void {}

  hostDisconnected(): void {
    this.commit();
  }

  /** 화살표 키를 누른 채 연속으로 이동 중인지 나타냅니다. */
  get active(): boolean {
    return this._run !== null;
  }

  /**
   * keydown을 처리합니다. 화살표 키가 아니면 진행 중인 이동을 커밋하고 넘깁니다.
   *
   * @remarks
   * Ctrl/Cmd나 Alt와 함께 누른 화살표 키는 브라우저 또는 다른 단축키에서 처리하도록 둡니다.
   * 호출부는 입력란 안, 모달이 열린 상태 등 이동해서는 안 되는 상황을 먼저 걸러야 합니다.
   *
   * @param e - 키 이벤트
   * @returns 이동으로 처리했으면 true
   */
  onKeyDown(e: KeyboardEvent): boolean {
    if (!ARROW_KEYS.has(e.key)) {
      // Shift만 바꿔 누르는 것은 같은 이동의 일부입니다. 그 밖의 키는 이동을 끝냅니다.
      if (!MODIFIER_KEYS.has(e.key)) this.commit();
      return false;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const delta = nudgeDelta(e.key, e.shiftKey);
    if (delta === null || this.host.file === null || this.host.selectedIds.size === 0) return false;

    const members = [...this.host.selectedIds]
      .map((id) => this.host.findElement(id))
      .filter((el): el is SlipElement => el !== undefined);
    if (members.length === 0) return false;

    e.preventDefault();
    this._run ??= { snapshot: this.host.beginEdit(), moved: false };
    const next = movedPositions(
      members.map((el) => ({ id: el.id, x: el.position.x, y: el.position.y })),
      delta.dx,
      delta.dy,
    );
    members.forEach((el, index) => {
      const move = next[index]!;
      if (el.position.x !== move.x || el.position.y !== move.y) this._run!.moved = true;
      el.position.x = move.x;
      el.position.y = move.y;
    });
    if (this._run.moved) this.host.touch();
    this.host.refresh();
    return true;
  }

  /**
   * keyup을 처리합니다. 화살표 키를 떼면 진행 중인 이동을 커밋합니다.
   *
   * @param e - 키 이벤트
   */
  onKeyUp(e: KeyboardEvent): void {
    if (ARROW_KEYS.has(e.key)) this.commit();
  }

  /** 진행 중인 이동을 한 번의 되돌리기 단계와 변경 알림으로 마무리합니다. 움직인 것이 없으면 기록하지 않습니다. */
  commit(): void {
    const run = this._run;
    if (run === null) return;
    this._run = null;
    if (!run.moved) return;
    this.host.commitEdit(run.snapshot);
    this.host.emitChange();
    // 기록이 한 단계 늘었으므로 되돌리기·다시 실행 버튼 상태를 바로 다시 그립니다.
    this.host.refresh();
  }

  /** 진행 중인 이동을 기록하지 않고 버립니다. 양식을 새로 불러올 때 사용합니다. */
  discard(): void {
    this._run = null;
  }
}
