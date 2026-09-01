/**
 * 색 선택기의 상태 — 색조·채도·명도와 사용자 지정 색 목록.
 *
 * @remarks
 * 색은 파일 스키마와 같은 `#RRGGBB`로 다루고, HSV는 화면에서 선택하기 위한 표현이다.
 * 무채색에는 색조가 없으므로 색조는 마지막 값을 유지한다.
 */

import type { ReactiveController } from 'lit';
import { MAX_CUSTOM_COLORS, hexToHsv, hsvToHex } from '../color.js';

/** 사용자 지정 색상을 저장하는 localStorage 키 */
export const CUSTOM_COLORS_KEY = 'slipkit-designer-custom-colors';

/**
 * 저장된 사용자 지정 색상을 읽는다. 읽을 수 없으면 빈 목록을 반환한다.
 *
 * @returns 저장된 색상 목록. 읽을 수 없으면 빈 목록
 */
export function loadCustomColors(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_CUSTOM_COLORS);
  } catch {
    return [];
  }
}

/**
 * 색상을 사용자 지정 목록에 저장하고 갱신된 목록을 반환한다.
 * 기존 색상은 목록의 끝으로 이동하고 최대 개수를 넘으면 가장 오래된 색상을 제거한다.
 *
 * @param color - 저장할 HEX 색상
 * @returns 저장 후의 사용자 지정 색상 목록
 */
export function saveCustomColor(color: string): string[] {
  const list = loadCustomColors().filter((c) => c !== color);
  list.push(color);
  while (list.length > MAX_CUSTOM_COLORS) list.shift();
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(list));
  } catch {
    // localStorage를 사용할 수 없어도 문서 편집은 계속한다.
  }
  return list;
}

export interface ColorPickerHost {
  requestUpdate(): void;
}

export class ColorPickerController implements ReactiveController {
  private _hue = 0;
  private _saturation = 1;
  private _value = 1;
  private _dragKey: string | null = null;
  private _customColors: string[] | null = null;

  constructor(private readonly host: ColorPickerHost) {}

  hostConnected(): void {
    this.host.requestUpdate();
  }

  /** 색조(0~360) */
  get hue(): number {
    return this._hue;
  }

  /** 채도(0~1) */
  get saturation(): number {
    return this._saturation;
  }

  /** 명도(0~1) */
  get value(): number {
    return this._value;
  }

  /** 지금 선택한 색 */
  get hex(): string {
    return hsvToHex(this._hue, this._saturation, this._value);
  }

  /**
   * 채도·명도 영역을 드래그하는 중인지 확인한다.
   *
   * @param key - 색상 속성 키
   * @returns 그 속성의 영역을 드래그하는 중이면 true
   */
  isDragging(key: string): boolean {
    return this._dragKey === key;
  }

  /**
   * 지정한 색에 맞춰 선택기의 HSV 값을 설정한다.
   *
   * @param hex - 맞출 색 (`#RRGGBB`)
   */
  seed(hex: string): void {
    const hsv = hexToHsv(hex);
    // 무채색에는 색조가 없으므로 기존 색조를 유지한다.
    if (hsv.s > 0) this._hue = hsv.h;
    this._saturation = hsv.s;
    this._value = hsv.v;
  }

  /**
   * 색조를 바꾼다.
   *
   * @param hue - 새 색조(0~360)
   */
  setHue(hue: number): void {
    this._hue = hue;
    this.host.requestUpdate();
  }

  /**
   * 채도·명도 영역의 드래그를 시작한다.
   *
   * @param key - 색상 속성 키
   */
  startDrag(key: string): void {
    this._dragKey = key;
  }

  /** 드래그를 끝낸다. */
  endDrag(): void {
    this._dragKey = null;
  }

  /**
   * 포인터 위치를 채도와 명도 값으로 변환한다.
   *
   * @param event - 채도·명도 영역에서 받은 포인터 이벤트
   */
  pointTo(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    this._saturation = Math.max(0, Math.min((event.clientX - rect.left) / width, 1));
    // 위쪽이 밝으므로 세로는 뒤집는다.
    this._value = 1 - Math.max(0, Math.min((event.clientY - rect.top) / height, 1));
    this.host.requestUpdate();
  }

  /** 저장해 둔 사용자 지정 색 목록 */
  customColors(): string[] {
    this._customColors ??= loadCustomColors();
    return this._customColors;
  }

  /**
   * 색을 사용자 지정 목록에 저장한다.
   *
   * @param color - 저장할 색 (`#RRGGBB`)
   */
  saveCustomColor(color: string): void {
    this._customColors = saveCustomColor(color);
    this.host.requestUpdate();
  }
}
