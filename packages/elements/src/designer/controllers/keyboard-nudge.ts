/**
 * 화살표 키로 선택한 요소를 옮기는 조작.
 *
 * @remarks
 * 키를 누르고 있는 동안(keyup 전까지)의 연속 이동은 한 번의 되돌리기 단계와 한 번의
 * 변경 알림으로 묶습니다. 첫 keydown에서 스냅샷을 찍고, 화살표 키를 떼거나 초점을 잃을 때
 * 커밋합니다. 좌표 계산은 `arrange.ts`가 맡습니다.
 */

import type { ReactiveController } from 'lit';
import type { SlipElement, SlipTemplateFile } from '@omdc-slipkit/core';
import { movedPositions, nudgeDelta } from '../arrange.js';

/** 키보드 이동이 문서에 요청하는 것 */
export interface NudgeHost {
  /** 편집 중인 양식 */
  readonly file: SlipTemplateFile | null;
  /** 함께 선택된 요소 id 모음 */
  readonly selectedIds: ReadonlySet<string>;
  /** id로 요소를 찾습니다 */
  findElement(id: string): SlipElement | undefined;
  /** 조작 직전 상태를 되돌리기 기록에 넣습니다 */
  pushUndoSnapshot(snapshot: string): void;
  /** 바뀐 양식을 호스트에 알립니다 */
  emitChange(): void;
  /** 화면을 다시 그립니다 */
  refresh(): void;
}

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

export class KeyboardNudgeController implements ReactiveController {
  /** 진행 중인 연속 이동 — 첫 keydown의 스냅샷과 실제로 움직였는지 */
  private _run: { snapshot: string; moved: boolean } | null = null;

  constructor(private readonly host: NudgeHost) {}

  hostConnected(): void {}

  hostDisconnected(): void {
    this.commit();
  }

  /** 화살표 키를 누른 채 이동하는 중인지 */
  get active(): boolean {
    return this._run !== null;
  }

  /**
   * keydown을 처리합니다. 화살표 키가 아니면 진행 중인 이동을 커밋하고 넘깁니다.
   *
   * @remarks
   * Ctrl/Cmd·Alt를 함께 누른 화살표는 브라우저나 다른 단축키의 몫이라 가로채지 않습니다.
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
    this._run ??= { snapshot: JSON.stringify(this.host.file), moved: false };
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
    this.host.pushUndoSnapshot(run.snapshot);
    this.host.emitChange();
  }

  /** 진행 중인 이동을 기록하지 않고 버립니다 — 양식을 새로 불러올 때 사용합니다. */
  discard(): void {
    this._run = null;
  }
}
