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
   * 열려 있는 모달과 각 모달을 열기 직전에 초점이 있던 요소.
   * 확인 모달처럼 모달 위에 모달이 열리면 뒤에 쌓입니다.
   */
  private readonly stack: { modal: HTMLElement; returnTo: HTMLElement | null }[] = [];

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

  /**
   * 모달이 열리면 안으로 초점을 옮기고, 닫히면 열기 전 요소로 되돌립니다.
   * 맨 위 모달만 초점을 받으며, 위 모달이 닫히면 아래 모달의 열었던 요소로 돌아갑니다.
   */
  sync(): void {
    const modals = Array.from(this.host.renderRoot.querySelectorAll<HTMLElement>('.modal'));
    // 닫힌 모달을 위에서부터 걷어 내고 그 모달을 열기 전 요소로 초점을 되돌립니다.
    while (this.stack.length > 0 && !modals.includes(this.stack[this.stack.length - 1]!.modal)) {
      const { returnTo } = this.stack.pop()!;
      if (returnTo?.isConnected) returnTo.focus();
    }
    const top = modals[modals.length - 1];
    if (top === undefined || this.stack[this.stack.length - 1]?.modal === top) return;
    const active = this.host.shadowRoot?.activeElement;
    this.stack.push({ modal: top, returnTo: active instanceof HTMLElement ? active : null });
    (focusableIn(top)[0] ?? top).focus();
  }
}
