/**
 * 모달의 초점 관리 — 열 때 안으로 옮기고, 닫을 때 열기 전 요소로 되돌린다.
 *
 * @remarks
 * 초점이 모달 밖으로 새면 배경 화면을 조작하게 되므로 Tab 이동을 모달 안에 가둔다.
 * 호출 시점은 컴포넌트가 정한다 — 인라인 편집 등 다른 초점 처리와 순서를 맞춰야 하므로
 * `hostUpdated`가 아니라 컴포넌트의 `updated`에서 `sync`를 부른다.
 */

import type { ReactiveController } from 'lit';

/** 모달 초점 관리가 필요로 하는 호스트의 최소 범위 */
export interface ModalFocusHost {
  readonly renderRoot: DocumentFragment | HTMLElement;
  readonly shadowRoot: ShadowRoot | null;
}

/**
 * 컨테이너 안에서 Tab으로 갈 수 있는 요소를 화면 순서대로 모은다.
 *
 * @param container - 찾을 범위
 * @returns 화면 순서대로 정렬한 초점 대상
 */
export function focusableIn(container: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

export class ModalFocusController implements ReactiveController {
  /**
   * 모달을 열기 직전에 초점이 있던 요소.
   * `undefined`는 모달이 열려 있지 않다는 뜻이고, `null`은 되돌릴 곳이 없다는 뜻이다.
   */
  private returnFocus: HTMLElement | null | undefined = undefined;

  constructor(private readonly host: ModalFocusHost) {}

  /** 요소가 화면에서 빠지면 되돌릴 초점 대상을 놓는다. 이미 사라진 요소다. */
  hostDisconnected(): void {
    this.returnFocus = undefined;
  }

  /**
   * 모달 안에서 Tab 이동을 가두고 Escape로 닫는다.
   *
   * @param event - 모달 요소에서 받은 키보드 이벤트
   * @param close - Escape를 눌렀을 때 실행할 닫기 처리
   */
  handleKeydown(event: KeyboardEvent, close: () => void): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(event.currentTarget as HTMLElement);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = this.host.shadowRoot?.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** 모달이 열리면 안으로 초점을 옮기고, 닫히면 열기 전 요소로 되돌린다. */
  sync(): void {
    const modal = this.host.renderRoot.querySelector('.modal') as HTMLElement | null;
    if (modal !== null && this.returnFocus === undefined) {
      const active = this.host.shadowRoot?.activeElement;
      this.returnFocus = active instanceof HTMLElement ? active : null;
      (focusableIn(modal)[0] ?? modal).focus();
      return;
    }
    if (modal === null && this.returnFocus !== undefined) {
      const previous = this.returnFocus;
      this.returnFocus = undefined;
      previous?.focus();
    }
  }
}
