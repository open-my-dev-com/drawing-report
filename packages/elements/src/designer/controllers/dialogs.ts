/**
 * 어느 모달이 열려 있는지 관리한다.
 *
 * @remarks
 * 모달마다 따로 열림 여부를 두면 "모두 닫기"가 여러 곳에 흩어져 한 곳을 빠뜨리기 쉽다.
 * 여기서 한꺼번에 다룬다. 모달별 초안 값은 각 모달의 컨트롤러가 따로 갖는다.
 */

import type { ReactiveController } from 'lit';

/** 디자이너가 여는 모달의 종류 */
export type DialogKind = 'formula' | 'image' | 'sample' | 'save' | 'myForms';

/** 모달 관리가 필요로 하는 호스트의 최소 범위 */
export interface DialogsHost {
  requestUpdate(): void;
}

export class DialogsController implements ReactiveController {
  private readonly opened = new Set<DialogKind>();

  constructor(private readonly host: DialogsHost) {}

  /**
   * 다시 연결되면 화면을 현재 상태에 맞춰 한 번 그린다.
   * 상태는 그대로 두므로 화면에서 뗐다 붙여도 편집 중이던 내용이 남는다.
   */
  hostConnected(): void {
    this.host.requestUpdate();
  }

  /**
   * 지정한 모달이 열려 있는지 확인한다.
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
   * 모달을 연다.
   *
   * @param kind - 열 모달
   */
  open(kind: DialogKind): void {
    this.opened.add(kind);
    this.host.requestUpdate();
  }

  /**
   * 모달을 닫는다.
   *
   * @param kind - 닫을 모달
   */
  close(kind: DialogKind): void {
    this.opened.delete(kind);
    this.host.requestUpdate();
  }

  /** 열려 있는 모달을 모두 닫는다. 화면 갱신은 호출부가 처리한다. */
  closeAllQuietly(): void {
    this.opened.clear();
  }

  /** 열려 있는 모달을 모두 닫는다. */
  closeAll(): void {
    this.closeAllQuietly();
    this.host.requestUpdate();
  }
}
