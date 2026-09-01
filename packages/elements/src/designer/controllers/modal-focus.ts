/**
 * 모달을 열 때 내부 요소로 초점을 이동하고, 닫을 때 이전 요소로 복원합니다.
 *
 * @remarks
 * 모달이 열린 동안 Tab 키 이동을 모달 내부로 제한합니다.
 * 호스트 갱신을 요청하지 않으므로 `ReactiveController`로 등록하지 않습니다.
 * 호출 시점은 컴포넌트가 정합니다 — 인라인 편집 등 다른 초점 처리와 순서를 맞춰야 하므로
 * `hostUpdated`가 아니라 컴포넌트의 `updated`에서 `sync`를 부릅니다.
 */

export interface ModalFocusHost {
  readonly renderRoot: DocumentFragment | HTMLElement;
  readonly shadowRoot: ShadowRoot | null;
}

/**
 * 컨테이너 안에서 Tab 키로 이동할 수 있는 요소를 화면 순서대로 반환합니다.
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

export class ModalFocusController {
  /**
   * 모달을 열기 직전에 초점이 있던 요소.
   * `undefined`는 모달이 열려 있지 않다는 뜻이고, `null`은 되돌릴 곳이 없다는 뜻입니다.
   */
  private returnFocus: HTMLElement | null | undefined = undefined;

  constructor(private readonly host: ModalFocusHost) {}

  /**
   * 모달 안에서 Tab 이동을 가두고 Escape로 닫습니다.
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

  /** 모달이 열리면 안으로 초점을 옮기고, 닫히면 열기 전 요소로 되돌립니다. */
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
