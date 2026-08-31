/**
 * 색 선택기의 상태 — 색조·채도·명도와 사용자 지정 색 목록.
 *
 * @remarks
 * 색은 파일 스키마와 같은 `#RRGGBB`로 다루고, HSV는 화면에서 고르기 위한 표현이다.
 * 무채색에는 색조가 없으므로 색조는 마지막 값을 유지한다.
 */

import { hexToHsv, hsvToHex, loadCustomColors, saveCustomColor } from '../color.js';

/** 색 선택기 상태가 필요로 하는 호스트의 최소 범위 */
export interface ColorPickerHost {
  requestUpdate(): void;
}

export class ColorPickerController {
  private _hue = 0;
  private _saturation = 1;
  private _value = 1;
  private _dragKey: string | null = null;
  private _customColors: string[] | null = null;

  constructor(private readonly host: ColorPickerHost) {}

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

  /** 지금 고른 색 */
  get hex(): string {
    return hsvToHex(this._hue, this._saturation, this._value);
  }

  /**
   * 채도·명도 영역을 끄는 중인지 확인한다.
   *
   * @param key - 색상 속성 키
   * @returns 그 속성의 영역을 끄는 중이면 true
   */
  isDragging(key: string): boolean {
    return this._dragKey === key;
  }

  /**
   * 지정한 색에 맞춰 선택기를 맞춘다.
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
   * 채도·명도 영역을 끌기 시작한다.
   *
   * @param key - 색상 속성 키
   */
  startDrag(key: string): void {
    this._dragKey = key;
  }

  /** 끌기를 끝낸다. */
  endDrag(): void {
    this._dragKey = null;
  }

  /**
   * 포인터 위치를 채도와 명도로 바꾼다.
   *
   * @param event - 채도·명도 영역에서 받은 포인터 사건
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
