// 순수 좌표·크기 계산 — 화면 없이 직접 확인한다.
import { describe, expect, it } from 'vitest';
import type { GridElement, LineElement, SlipElement } from '@omdc-slipkit/core';
import {
  PX_PER_MM,
  MIN_SIZE_MM,
  SNAP_MM,
  round1,
  lineLengthAngle,
  lineBoxFromLengthAngle,
  polygonPointsPx,
  lineEndpoints,
  boxOf,
  setElementBox,
  trackOffsets,
  snapCandidates,
  bestSnap,
} from '../../src/designer/geometry.js';

function line(patch: Partial<LineElement>): LineElement {
  return {
    type: 'line', id: 'ln', position: { x: 0, y: 0 }, width: 30, height: 40, ...patch,
  } as LineElement;
}

function grid(columns: number[], rows: number[]): GridElement {
  return {
    type: 'grid', id: 'g', position: { x: 0, y: 0 },
    columns: columns.map((width) => ({ width })),
    rows: rows.map((height) => ({ height })),
    cells: [],
  } as unknown as GridElement;
}

describe('round1', () => {
  it('0.1mm 단위로 반올림한다', () => {
    expect(round1(1.24)).toBe(1.2);
    expect(round1(1.25)).toBe(1.3);
    expect(round1(-1.25)).toBe(-1.2);
  });
});

describe('PX_PER_MM · MIN_SIZE_MM · SNAP_MM', () => {
  it('CSS 96dpi 기준의 mm당 픽셀 수다', () => {
    expect(PX_PER_MM).toBeCloseTo(3.7795, 4);
    expect(MIN_SIZE_MM).toBe(2);
    expect(SNAP_MM).toBe(1.5);
  });
});

describe('lineLengthAngle', () => {
  it('가로선은 너비가 길이이고 각도는 0이다', () => {
    expect(lineLengthAngle(line({ lineDirection: 'horizontal' }))).toEqual({ length: 30, angle: 0 });
  });

  it('방향을 적지 않으면 가로선으로 본다', () => {
    expect(lineLengthAngle(line({}))).toEqual({ length: 30, angle: 0 });
  });

  it('세로선은 높이가 길이이고 각도는 90이다', () => {
    expect(lineLengthAngle(line({ lineDirection: 'vertical' }))).toEqual({ length: 40, angle: 90 });
  });

  it('대각선은 상자의 두 모서리를 잇고 위로 향하면 각도가 음수다', () => {
    const down = lineLengthAngle(line({ lineDirection: 'down' }));
    expect(down.length).toBeCloseTo(50, 6);
    expect(down.angle).toBeCloseTo(53.1301, 3);

    const up = lineLengthAngle(line({ lineDirection: 'up' }));
    expect(up.angle).toBeCloseTo(-53.1301, 3);
  });
});

describe('lineBoxFromLengthAngle', () => {
  it('0·180도 근처는 가로선으로 맞춘다', () => {
    expect(lineBoxFromLengthAngle(50, 0.4)).toEqual({ width: 50, height: 0, lineDirection: 'horizontal' });
    expect(lineBoxFromLengthAngle(50, 179.7)).toEqual({ width: 50, height: 0, lineDirection: 'horizontal' });
  });

  it('90도 근처는 세로선으로 맞춘다', () => {
    expect(lineBoxFromLengthAngle(50, 90.3)).toEqual({ width: 0, height: 50, lineDirection: 'vertical' });
  });

  it('반대 방향 각도는 같은 선으로 본다', () => {
    expect(lineBoxFromLengthAngle(50, 210)).toEqual(lineBoxFromLengthAngle(50, 30));
    expect(lineBoxFromLengthAngle(50, -330)).toEqual(lineBoxFromLengthAngle(50, 30));
  });

  it('90도보다 크면 위로 향하는 대각선이 된다', () => {
    expect(lineBoxFromLengthAngle(50, 120).lineDirection).toBe('up');
    expect(lineBoxFromLengthAngle(50, 60).lineDirection).toBe('down');
  });

  it('음수 길이는 0으로 자른다', () => {
    expect(lineBoxFromLengthAngle(-10, 0).width).toBe(0);
  });
});

describe('lineEndpoints', () => {
  it('방향마다 상자의 어느 모서리를 잇는지 정한다', () => {
    const at = { position: { x: 10, y: 20 }, width: 30, height: 40 };
    // 가로선·세로선은 상자의 가운데를 지난다.
    expect(lineEndpoints({ ...at, lineDirection: 'horizontal' }))
      .toEqual([{ x: 10, y: 40 }, { x: 40, y: 40 }]);
    expect(lineEndpoints({ ...at, lineDirection: 'vertical' }))
      .toEqual([{ x: 25, y: 20 }, { x: 25, y: 60 }]);
    expect(lineEndpoints({ ...at, lineDirection: 'down' }))
      .toEqual([{ x: 10, y: 20 }, { x: 40, y: 60 }]);
    expect(lineEndpoints({ ...at, lineDirection: 'up' }))
      .toEqual([{ x: 10, y: 60 }, { x: 40, y: 20 }]);
  });
});

describe('polygonPointsPx', () => {
  it('꼭짓점이 상자를 가득 채우도록 정규화한다', () => {
    const points = polygonPointsPx(4, 100, 60);
    expect(points.length).toBe(4);
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(0, 6);
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(100, 6);
    expect(Math.min(...points.map(([, y]) => y))).toBeCloseTo(0, 6);
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(60, 6);
  });

  it('첫 꼭짓점은 위쪽 가운데다', () => {
    const [first] = polygonPointsPx(3, 90, 60);
    expect(first![0]).toBeCloseTo(45, 6);
    expect(first![1]).toBeCloseTo(0, 6);
  });
});

describe('trackOffsets', () => {
  it('크기 목록을 누적 경계로 바꾼다 — 길이는 하나 더 많다', () => {
    expect(trackOffsets([10, 20, 5])).toEqual([0, 10, 30, 35]);
    expect(trackOffsets([])).toEqual([0]);
  });
});

describe('boxOf · setElementBox', () => {
  it('그리드 크기는 트랙 합이고 저장하지 않는다', () => {
    const el = grid([30, 30], [10, 10, 10]);
    expect(boxOf(el)).toEqual({ width: 60, height: 30 });
    expect('width' in (el as unknown as Record<string, unknown>)).toBe(false);
  });

  it('그리드를 늘리면 트랙이 기존 비율대로 커진다', () => {
    const el = grid([20, 40], [10, 10]);
    setElementBox(el, 120, 40);
    expect(el.columns.map((c) => c.width)).toEqual([40, 80]);
    expect(el.rows.map((r) => r.height)).toEqual([20, 20]);
  });

  it('트랙 하나가 최소 크기 밑으로 내려가지 않는다', () => {
    const el = grid([30, 30], [10]);
    setElementBox(el, 2);
    expect(el.columns.map((c) => c.width)).toEqual([MIN_SIZE_MM, MIN_SIZE_MM]);
  });

  it('트랙 합이 0이면 목표 크기를 고르게 나눈다', () => {
    const el = grid([0, 0], [10]);
    setElementBox(el, 60);
    expect(el.columns.map((c) => c.width)).toEqual([30, 30]);
  });

  it('한쪽만 주면 다른 쪽은 그대로 둔다', () => {
    const el = grid([30, 30], [10, 10]);
    setElementBox(el, 90);
    expect(el.rows.map((r) => r.height)).toEqual([10, 10]);
  });

  it('그리드가 아닌 요소는 너비·높이를 그대로 저장한다', () => {
    const el = { type: 'text', id: 't', position: { x: 0, y: 0 }, width: 10, height: 5, content: '' } as unknown as SlipElement;
    setElementBox(el, 40, 20);
    expect(boxOf(el)).toEqual({ width: 40, height: 20 });
  });
});

describe('snapCandidates · bestSnap', () => {
  const paper = { width: 210, height: 297, padding: [20, 15, 20, 15] };

  function box(id: string, x: number, y: number): SlipElement {
    return { type: 'rect', id, position: { x, y }, width: 40, height: 20 } as unknown as SlipElement;
  }

  it('용지 경계와 여백을 항상 후보로 넣는다', () => {
    const { xs, ys } = snapCandidates(paper, [], new Set());
    expect(xs).toEqual([0, 15, 195, 210]);
    expect(ys).toEqual([0, 20, 277, 297]);
  });

  it('다른 요소의 시작·중앙·끝을 후보로 넣는다', () => {
    const { xs, ys } = snapCandidates(paper, [box('a', 50, 100)], new Set());
    expect(xs).toContain(50);
    expect(xs).toContain(70);
    expect(xs).toContain(90);
    expect(ys).toContain(100);
    expect(ys).toContain(110);
    expect(ys).toContain(120);
  });

  it('함께 움직이는 요소는 후보에서 뺀다', () => {
    const elements = [box('a', 50, 100), box('b', 80, 100)];
    const { xs } = snapCandidates(paper, elements, new Set(['a', 'b']));
    expect(xs).toEqual([0, 15, 195, 210]);
  });

  it('스냅 범위 안에서 가장 가까운 이동량을 고른다', () => {
    const near = bestSnap([49.4], [50, 55])!;
    expect(near.line).toBe(50);
    expect(near.delta).toBeCloseTo(0.6, 6);
    expect(bestSnap([51.2, 60], [50, 61])).toEqual({ delta: 1, line: 61 });
  });

  it('범위를 벗어나면 맞추지 않는다', () => {
    expect(bestSnap([48], [50])).toBeNull();
  });
});
