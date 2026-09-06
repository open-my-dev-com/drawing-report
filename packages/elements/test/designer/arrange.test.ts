// 요소 이동·정렬·간격 배치의 좌표 계산 — 화면 없이 직접 확인합니다.
import { describe, expect, it } from 'vitest';
import type { SlipElement } from '@omdc-slipkit/core';
import {
  NUDGE_STEP_MM,
  NUDGE_STEP_LARGE_MM,
  alignUnits,
  clampMoveDelta,
  distributeUnits,
  elementBox,
  exceedsPaper,
  movedPositions,
  nudgeDelta,
  selectionUnits,
  unionBox,
} from '../../src/designer/arrange.js';

const PAPER = { width: 210, height: 297 };

function rect(id: string, x: number, y: number, width: number, height: number, group?: string): SlipElement {
  return {
    type: 'rect', id, name: id, position: { x, y }, width, height,
    ...(group === undefined ? {} : { group }),
  } as SlipElement;
}

function grid(id: string, x: number, y: number): SlipElement {
  return {
    type: 'grid', id, name: id, position: { x, y },
    rows: [{ height: 10 }, { height: 15 }],
    columns: [{ width: 30 }, { width: 20 }, { width: 10 }],
    cells: [],
  } as unknown as SlipElement;
}

function positionsOf(moves: { id: string; x: number; y: number }[]): Record<string, [number, number]> {
  return Object.fromEntries(moves.map((m) => [m.id, [m.x, m.y]]));
}

describe('선택 전체 이동의 경계 보정', () => {
  it('요소 하나는 왼쪽·위쪽 0에서 멈추고 오른쪽·아래쪽으로는 자유롭게 나간다', () => {
    expect(movedPositions([{ id: 'a', x: 3, y: 4 }], -10, -10)).toEqual([{ id: 'a', x: 0, y: 0 }]);
    expect(movedPositions([{ id: 'a', x: 190, y: 280 }], 100, 100)).toEqual([{ id: 'a', x: 290, y: 380 }]);
  });

  it('여러 요소를 함께 옮길 때는 가장 왼쪽·위쪽 요소만 0에 닿고 나머지는 간격을 유지한다', () => {
    const members = [
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 40, y: 50 },
    ];
    const moved = positionsOf(movedPositions(members, -30, -35));
    // a가 0에 닿을 만큼(−10, −20)만 옮기고 b도 같은 양만큼만 옮깁니다.
    expect(moved.a).toEqual([0, 0]);
    expect(moved.b).toEqual([30, 30]);
    expect(clampMoveDelta(members, -30, -35)).toEqual({ dx: -10, dy: -20 });
  });

  it('보정이 필요 없는 이동은 그대로 두고 0.1mm 단위로 반올림한다', () => {
    expect(clampMoveDelta([{ x: 5, y: 5 }], 2.34, -1.26)).toEqual({ dx: 2.34, dy: -1.26 });
    expect(movedPositions([{ id: 'a', x: 5, y: 5 }], 2.34, -1.26)).toEqual([{ id: 'a', x: 7.3, y: 3.7 }]);
  });

  it('빈 선택에는 이동량을 바꾸지 않는다', () => {
    expect(clampMoveDelta([], -5, -5)).toEqual({ dx: -5, dy: -5 });
    expect(movedPositions([], -5, -5)).toEqual([]);
  });
});

describe('화살표 키 이동량', () => {
  it('화살표는 0.5mm, Shift+화살표는 5mm를 뜻한다', () => {
    expect(NUDGE_STEP_MM).toBe(0.5);
    expect(NUDGE_STEP_LARGE_MM).toBe(5);
    expect(nudgeDelta('ArrowLeft', false)).toEqual({ dx: -0.5, dy: 0 });
    expect(nudgeDelta('ArrowRight', false)).toEqual({ dx: 0.5, dy: 0 });
    expect(nudgeDelta('ArrowUp', true)).toEqual({ dx: 0, dy: -5 });
    expect(nudgeDelta('ArrowDown', true)).toEqual({ dx: 0, dy: 5 });
  });

  it('화살표가 아닌 키는 이동이 아니다', () => {
    expect(nudgeDelta('Enter', false)).toBeNull();
    expect(nudgeDelta('a', true)).toBeNull();
  });
});

describe('용지 밖 판정 (exceedsPaper)', () => {
  it('오른쪽 또는 아래쪽 가장자리를 넘는 요소만 참이다', () => {
    expect(exceedsPaper(rect('a', 0, 0, 210, 297), PAPER)).toBe(false);
    expect(exceedsPaper(rect('a', 200, 10, 20, 10), PAPER)).toBe(true);
    expect(exceedsPaper(rect('a', 10, 290, 20, 10), PAPER)).toBe(true);
    expect(exceedsPaper(rect('a', 10, 10, 20, 10), PAPER)).toBe(false);
  });

  it('그리드는 열 너비·행 높이의 합으로 판정한다', () => {
    // 60×25 그리드
    expect(exceedsPaper(grid('g', 150, 10), PAPER)).toBe(false);
    expect(exceedsPaper(grid('g', 151, 10), PAPER)).toBe(true);
    expect(exceedsPaper(grid('g', 10, 273), PAPER)).toBe(true);
    expect(elementBox(grid('g', 10, 273))).toEqual({ x: 10, y: 273, width: 60, height: 25 });
  });
});

describe('선택 단위와 감싸는 상자', () => {
  it('같은 그룹의 요소는 한 단위가 되고 상자는 구성원을 모두 감싼다', () => {
    const units = selectionUnits([
      rect('a', 10, 10, 20, 10, 'g1'),
      rect('b', 100, 100, 10, 10),
      rect('c', 40, 30, 10, 5, 'g1'),
    ]);
    expect(units.map((u) => u.members.map((m) => m.id))).toEqual([['a', 'c'], ['b']]);
    expect(units[0]!.box).toEqual({ x: 10, y: 10, width: 40, height: 25 });
  });

  it('unionBox는 빈 목록에 null을 돌려준다', () => {
    expect(unionBox([])).toBeNull();
  });
});

describe('정렬 (alignUnits)', () => {
  const els = [rect('a', 10, 10, 20, 10), rect('b', 50, 40, 40, 20), rect('c', 30, 100, 10, 30)];
  const units = () => selectionUnits(els);

  it('왼쪽·가로 가운데·오른쪽은 선택 전체 상자(10~90)를 기준으로 맞춘다', () => {
    const left = positionsOf(alignUnits(units(), 'left'));
    expect([left.a![0], left.b![0], left.c![0]]).toEqual([10, 10, 10]);
    const center = positionsOf(alignUnits(units(), 'hcenter'));
    // 중심 50 — a(폭 20)→40, b(폭 40)→30, c(폭 10)→45
    expect([center.a![0], center.b![0], center.c![0]]).toEqual([40, 30, 45]);
    const right = positionsOf(alignUnits(units(), 'right'));
    expect([right.a![0], right.b![0], right.c![0]]).toEqual([70, 50, 80]);
    // 가로 정렬은 세로 좌표를 건드리지 않습니다.
    expect([left.a![1], center.b![1], right.c![1]]).toEqual([10, 40, 100]);
  });

  it('위·세로 가운데·아래는 선택 전체 상자(10~130)를 기준으로 맞춘다', () => {
    const top = positionsOf(alignUnits(units(), 'top'));
    expect([top.a![1], top.b![1], top.c![1]]).toEqual([10, 10, 10]);
    const middle = positionsOf(alignUnits(units(), 'vcenter'));
    // 중심 70 — a(높이 10)→65, b(높이 20)→60, c(높이 30)→55
    expect([middle.a![1], middle.b![1], middle.c![1]]).toEqual([65, 60, 55]);
    const bottom = positionsOf(alignUnits(units(), 'bottom'));
    expect([bottom.a![1], bottom.b![1], bottom.c![1]]).toEqual([120, 110, 100]);
    expect([top.a![0], middle.b![0], bottom.c![0]]).toEqual([10, 50, 30]);
  });

  it('그룹은 한 덩어리로 옮겨 그룹 안 배치가 바뀌지 않는다', () => {
    const grouped = selectionUnits([
      rect('a', 30, 10, 10, 10, 'g'),
      rect('b', 50, 20, 10, 10, 'g'),
      rect('c', 100, 60, 20, 10),
    ]);
    const moved = positionsOf(alignUnits(grouped, 'right'));
    // 그룹 상자 30~60 → 오른쪽 120에 맞추려면 +60
    expect(moved.a).toEqual([90, 10]);
    expect(moved.b).toEqual([110, 20]);
    expect(moved.c).toEqual([100, 60]);
  });

  it('정렬 결과도 0 이상을 지킨다', () => {
    const moved = positionsOf(alignUnits(selectionUnits([rect('a', 0, 0, 10, 10), rect('b', 20, 5, 10, 10)]), 'left'));
    expect(moved.a).toEqual([0, 0]);
    expect(moved.b).toEqual([0, 5]);
  });
});

describe('간격 배치 (distributeUnits)', () => {
  it('세 단위 미만이면 실행할 수 없다', () => {
    expect(distributeUnits(selectionUnits([rect('a', 0, 0, 10, 10), rect('b', 50, 0, 10, 10)]), 'horizontal'))
      .toEqual({ ok: false, reason: 'needsThree' });
    // 그룹 하나 + 요소 하나도 두 단위입니다.
    expect(distributeUnits(selectionUnits([
      rect('a', 0, 0, 10, 10, 'g'), rect('b', 20, 0, 10, 10, 'g'), rect('c', 80, 0, 10, 10),
    ]), 'horizontal')).toEqual({ ok: false, reason: 'needsThree' });
  });

  it('양 끝은 두고 가운데 상자를 같은 간격으로 놓는다 (가로)', () => {
    // a 0~10, b 15~35, c 90~100 → 빈 공간 60을 둘로 나눠 간격 30
    const result = distributeUnits(selectionUnits([
      rect('a', 0, 0, 10, 10), rect('b', 15, 30, 20, 10), rect('c', 90, 5, 10, 10),
    ]), 'horizontal');
    expect(result.ok).toBe(true);
    const moved = positionsOf(result.ok ? result.moves : []);
    expect(moved.a).toEqual([0, 0]);
    expect(moved.b).toEqual([40, 30]);
    expect(moved.c).toEqual([90, 5]);
  });

  it('중심 순서로 정렬하므로 입력 순서와 무관하다 (세로)', () => {
    // a 100~110, b 0~10, c 30~50 → 세로 빈 공간 70을 둘로 나눠 간격 35 → c는 45
    const result = distributeUnits(selectionUnits([
      rect('a', 0, 100, 10, 10), rect('b', 20, 0, 10, 10), rect('c', 40, 30, 10, 20),
    ]), 'vertical');
    const moved = positionsOf(result.ok ? result.moves : []);
    expect(moved.a).toEqual([0, 100]);
    expect(moved.b).toEqual([20, 0]);
    expect(moved.c).toEqual([40, 45]);
  });

  it('상자가 양 끝 사이에 들어가지 않으면(간격 음수) 실행할 수 없다', () => {
    expect(distributeUnits(selectionUnits([
      rect('a', 0, 0, 10, 10), rect('b', 5, 0, 30, 10), rect('c', 20, 0, 10, 10),
    ]), 'horizontal')).toEqual({ ok: false, reason: 'noRoom' });
  });

  it('그룹은 한 단위로 세고 구성원을 함께 옮긴다', () => {
    const result = distributeUnits(selectionUnits([
      rect('a', 0, 0, 10, 10),
      rect('b1', 20, 0, 5, 10, 'g'), rect('b2', 30, 0, 5, 10, 'g'),
      rect('c', 100, 0, 10, 10),
    ]), 'horizontal');
    // 그룹 상자 20~35(폭 15) → 빈 공간 75를 둘로 나눠 간격 37.5 → 시작 47.5
    const moved = positionsOf(result.ok ? result.moves : []);
    expect(moved.b1).toEqual([47.5, 0]);
    expect(moved.b2).toEqual([57.5, 0]);
    expect(moved.a).toEqual([0, 0]);
    expect(moved.c).toEqual([100, 0]);
  });
});
