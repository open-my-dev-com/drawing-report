/**
 * 어느 모달이 열려 있는지 관리합니다.
 *
 * @remarks
 * 모달 열림 상태는 하나의 집합으로 관리하고, 각 모달의 입력 초안은 해당 컨트롤러가 관리합니다.
 */

import type { ReactiveController } from 'lit';

/** 디자이너가 여는 모달의 종류 */
export type DialogKind = 'formula' | 'image' | 'sample' | 'save' | 'myForms' | 'confirmDelete';

export interface DialogsHost {
  requestUpdate(): void;
}

export class DialogsController implements ReactiveController {
  private readonly opened = new Set<DialogKind>();

  constructor(private readonly host: DialogsHost) {}

  hostConnected(): void {
    this.host.requestUpdate();
  }

  /**
   * 지정한 모달이 열려 있는지 확인합니다.
   *
   * @param kind - 확인할 모달
   * @returns 열려 있으면 true
   */
  isOpen(kind: DialogKind): boolean {
    return this.opened.has(kind);
  }

  /** 하나라도 열려 있는지 */
  get anyOpen(): boolean {
    return this.opened.size > 0;
  }

  /**
   * 모달을 엽니다.
   *
   * @param kind - 열 모달
   */
  open(kind: DialogKind): void {
    this.opened.add(kind);
    this.host.requestUpdate();
  }

  /**
   * 모달을 닫습니다.
   *
   * @param kind - 닫을 모달
   */
  close(kind: DialogKind): void {
    this.opened.delete(kind);
    this.host.requestUpdate();
  }

  /** 열려 있는 모달을 모두 닫습니다. 화면 갱신은 호출부가 처리합니다. */
  closeAllQuietly(): void {
    this.opened.clear();
  }

  /** 열려 있는 모달을 모두 닫습니다. */
  closeAll(): void {
    this.closeAllQuietly();
    this.host.requestUpdate();
  }
}
