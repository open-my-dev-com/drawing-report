/**
 * 색 선택기의 색 변환과 사용자 지정 색 저장.
 *
 * @remarks
 * 화면 상태에 의존하지 않는다. 저장은 브라우저 `localStorage`를 쓴다.
 */


/** 색 선택기에 표시할 기본 색상 */
export const COLOR_PALETTE = [
  '#000000', '#ffffff', '#f2f2f2', '#d93025', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
] as const;

/** 사용자 지정 색상을 저장하는 localStorage 키 */
export const CUSTOM_COLORS_KEY = 'slipkit-designer-custom-colors';

/** 저장할 수 있는 사용자 지정 색상의 최대 개수 */
export const MAX_CUSTOM_COLORS = 30;

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

/**
 * HEX 색상을 색 선택기의 HSV 값으로 변환한다.
 *
 * @param hex - `#rrggbb` 형식의 색상
 * @returns 색상(0~360), 채도와 명도(0~1)
 */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * HSV 색상을 HEX 색상 문자열로 변환한다.
 *
 * @param h - 색상(0~360)
 * @param s - 채도(0~1)
 * @param v - 명도(0~1)
 * @returns `#rrggbb` 형식의 색상
 */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}
