/**
 * 속성 패널의 팝오버 상태 — 리스트형 선택 상자와 테두리·색 선택 메뉴.
 *
 * @remarks
 * 팝오버는 패널 안이 아니라 화면 고정 위치에 뜨므로, 여는 순간의 버튼 위치에서
 * 좌표를 계산해 둔다. 화면 밖으로 넘치지 않도록 남은 높이 안에서만 편다.
 */

import type { ReactiveController } from 'lit';

/** 화면 고정 위치에 뜨는 팝오버의 자리 */
export interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** 팝오버의 종류 — 종류마다 따로 열리고 닫힌다 */
export type PopoverSlot = 'list' | 'property';

/** 버튼 아래에 펼 때의 여백(px) */
const GAP = 4;
/** 화면 가장자리에 남길 여백(px) */
const MARGIN = 12;

/**
 * 버튼 바로 아래에 펼 자리를 계산한다.
 *
 * @param anchor - 기준이 될 버튼
 * @param min - 최소 높이(px)
 * @param max - 최대 높이(px)
 * @returns 화면 고정 좌표와 최대 높이
 */
export function placeBelow(anchor: HTMLElement, min: number, max: number): Placement {
  const rect = anchor.getBoundingClientRect();
  const maxHeight = Math.max(min, Math.min(max, window.innerHeight - rect.bottom - MARGIN));
  return { left: rect.left, top: rect.bottom + GAP, width: rect.width, maxHeight };
}

/**
 * 아래에 자리가 모자라고 위가 더 넓으면 버튼 위에 펼 자리를 계산한다.
 *
 * @param anchor - 기준이 될 버튼
 * @param min - 최소 높이(px)
 * @param max - 최대 높이(px)
 * @param threshold - 이보다 아래 자리가 좁으면 위를 살펴본다(px)
 * @returns 화면 고정 좌표와 최대 높이
 */
export function placeBelowOrAbove(
  anchor: HTMLElement,
  min: number,
  max: number,
  threshold: number,
): Placement {
  const rect = anchor.getBoundingClientRect();
  const roomBelow = window.innerHeight - rect.bottom - MARGIN;
  const roomAbove = rect.top - MARGIN;
  const openAbove = roomBelow < threshold && roomAbove > roomBelow;
  const room = openAbove ? roomAbove : roomBelow;
  const maxHeight = Math.max(min, Math.min(max, room));
  return {
    left: rect.left,
    top: openAbove ? rect.top - maxHeight - GAP : rect.bottom + GAP,
    width: rect.width,
    maxHeight,
  };
}

/** 팝오버 상태가 필요로 하는 호스트의 최소 범위 */
export interface PopoverHost {
  requestUpdate(): void;
}

const CLOSED: Placement = { left: 0, top: 0, width: 0, maxHeight: 0 };

export class PopoverController implements ReactiveController {
  private readonly keys = new Map<PopoverSlot, string>();
  private readonly places = new Map<PopoverSlot, Placement>();

  constructor(private readonly host: PopoverHost) {}

  /**
   * 다시 연결되면 화면을 현재 상태에 맞춰 한 번 그린다.
   * 상태는 그대로 두므로 화면에서 뗐다 붙여도 편집 중이던 내용이 남는다.
   */
  hostConnected(): void {
    this.host.requestUpdate();
  }

  /**
   * 지금 열려 있는 팝오버의 키를 확인한다.
   *
   * @param slot - 팝오버 종류
   * @returns 열려 있는 팝오버의 키. 닫혀 있으면 null
   */
  openKey(slot: PopoverSlot): string | null {
    return this.keys.get(slot) ?? null;
  }

  /**
   * 지정한 팝오버가 열려 있는지 확인한다.
   *
   * @param slot - 팝오버 종류
   * @param key - 확인할 키
   * @returns 그 키로 열려 있으면 true
   */
  isOpen(slot: PopoverSlot, key: string): boolean {
    return this.keys.get(slot) === key;
  }

  /**
   * 열려 있는 팝오버의 자리를 확인한다.
   *
   * @param slot - 팝오버 종류
   * @returns 화면 고정 좌표. 닫혀 있으면 0
   */
  placement(slot: PopoverSlot): Placement {
    return this.places.get(slot) ?? CLOSED;
  }

  /**
   * 같은 키면 닫고, 다른 키면 그 자리에서 연다.
   *
   * @param slot - 팝오버 종류
   * @param key - 열거나 닫을 팝오버의 키
   * @param place - 열 때 계산할 자리. 스타일로 자리를 잡는 팝오버는 생략한다
   */
  toggle(slot: PopoverSlot, key: string, place?: () => Placement): void {
    if (this.keys.get(slot) === key) {
      this.keys.delete(slot);
    } else {
      if (place) this.places.set(slot, place());
      this.keys.set(slot, key);
    }
    this.host.requestUpdate();
  }

  /**
   * 팝오버를 닫는다.
   *
   * @param slot - 닫을 팝오버 종류
   */
  close(slot: PopoverSlot): void {
    this.keys.delete(slot);
    this.host.requestUpdate();
  }
}

/**
 * 리스트형 선택 상자 목록의 인라인 스타일을 만든다.
 *
 * @param place - 열려 있는 자리
 * @returns `style` 속성에 넣을 CSS
 */
export function listSelectStyle(place: Placement): string {
  return `left:${place.left}px;top:${place.top}px;min-width:${place.width}px;max-height:${place.maxHeight}px`;
}

/**
 * 테두리·색 선택 메뉴의 인라인 스타일을 만든다.
 *
 * @param place - 열려 있는 자리
 * @returns `style` 속성에 넣을 CSS
 */
export function propertyMenuStyle(place: Placement): string {
  return `left:${place.left}px;top:${place.top}px;width:${place.width}px;max-height:${place.maxHeight}px`;
}
