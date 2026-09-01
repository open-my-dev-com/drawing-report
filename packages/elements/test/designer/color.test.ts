// 색 변환과 사용자 지정 색 저장 — 화면 없이 직접 확인합니다.
import { describe, expect, it, beforeEach } from 'vitest';
import {
  COLOR_PALETTE,
  MAX_CUSTOM_COLORS,
  hexToHsv,
  hsvToHex,
} from '../../src/designer/color.js';
import {
  CUSTOM_COLORS_KEY,
  loadCustomColors,
  saveCustomColor,
} from '../../src/designer/controllers/color-picker.js';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
});

describe('hexToHsv · hsvToHex', () => {
  it('기본 색을 왕복 변환해도 같은 값을 반환한다', () => {
    for (const hex of COLOR_PALETTE) {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex.toLowerCase());
    }
  });

  it('무채색은 채도가 0이고 색조는 0이다', () => {
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 });
  });

  it('빨강·초록·파랑의 색조는 0·120·240이다', () => {
    expect(hexToHsv('#ff0000').h).toBeCloseTo(0, 6);
    expect(hexToHsv('#00ff00').h).toBeCloseTo(120, 6);
    expect(hexToHsv('#0000ff').h).toBeCloseTo(240, 6);
  });

  it('색조가 음수로 돌지 않게 360도 안으로 되돌린다', () => {
    // 마젠타는 빨강보다 색조가 큽니다 (음수로 계산되면 다시 더합니다)
    expect(hexToHsv('#ff00ff').h).toBeCloseTo(300, 6);
  });

  it('채도와 명도를 낮추면 그만큼 어두운 색이 된다', () => {
    expect(hsvToHex(120, 0.5, 0.75)).toBe('#60bf60');
  });
});

describe('loadCustomColors · saveCustomColor', () => {
  it('저장한 색이 저장 순서대로 뒤에 쌓인다', () => {
    saveCustomColor('#112233');
    saveCustomColor('#445566');
    expect(loadCustomColors()).toEqual(['#112233', '#445566']);
  });

  it('같은 색을 다시 저장하면 맨 뒤로 옮기고 중복을 만들지 않는다', () => {
    saveCustomColor('#112233');
    saveCustomColor('#445566');
    expect(saveCustomColor('#112233')).toEqual(['#445566', '#112233']);
  });

  it('상한을 넘으면 가장 오래된 것부터 밀려난다', () => {
    for (let i = 0; i < MAX_CUSTOM_COLORS + 5; i++) {
      saveCustomColor(`#0000${i.toString(16).padStart(2, '0')}`);
    }
    const saved = loadCustomColors();
    expect(saved.length).toBe(MAX_CUSTOM_COLORS);
    expect(saved).not.toContain('#000000');
  });

  it('저장된 값이 깨져 있으면 빈 목록으로 시작한다', () => {
    localStorage.setItem(CUSTOM_COLORS_KEY, '{ not json');
    expect(loadCustomColors()).toEqual([]);
  });

  it('글자가 아닌 항목은 걸러 낸다', () => {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(['#112233', 42, null, '#445566']));
    expect(loadCustomColors()).toEqual(['#112233', '#445566']);
  });

  it('저장된 항목이 상한을 넘으면 앞에서부터 상한만큼만 읽는다', () => {
    const many = Array.from({ length: MAX_CUSTOM_COLORS + 3 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(many));
    expect(loadCustomColors().length).toBe(MAX_CUSTOM_COLORS);
  });
});
