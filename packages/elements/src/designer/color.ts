/**
 * 색 선택기의 색 변환과 표시용 색 목록.
 *
 * @remarks
 * 바깥과 주고받는 색은 파일 스키마와 같은 `#RRGGBB`이고 HSV는 화면에서 선택하기 위한 표현입니다.
 * 사용자 지정 색의 저장은 `controllers/color-picker.ts`가 맡습니다.
 */

/** 색 선택기에 표시할 기본 색상 */
export const COLOR_PALETTE = [
  '#000000', '#ffffff', '#f2f2f2', '#d93025', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
] as const;

/** 저장할 수 있는 사용자 지정 색상의 최대 개수 */
export const MAX_CUSTOM_COLORS = 30;

/**
 * HEX 색상을 색 선택기의 HSV 값으로 변환합니다.
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
 * HSV 색상을 HEX 색상 문자열로 변환합니다.
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
