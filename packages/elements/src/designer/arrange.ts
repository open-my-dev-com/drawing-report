/**
 * 요소를 옮기고 줄 세우는 좌표 계산 — 선택 전체 이동의 경계 보정, 용지 밖 판정, 정렬과 간격 배치.
 *
 * @remarks
 * 파일 규칙은 `position.x`·`position.y`가 0 이상이라는 것뿐이고 오른쪽·아래로 넘치는 배치는
 * 허용합니다. 여기 함수들은 그 규칙만 지키며, 여러 요소를 함께 옮길 때는 요소 사이 간격이
 * 바뀌지 않도록 선택 전체에 같은 이동량을 적용합니다.
 */

import { elementBounds, type SlipElement } from '@omdc-slipkit/core';
import { round1 } from './geometry.js';

/** 용지 위의 사각 영역(mm) */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 요소 하나의 새 위치 */
export interface PositionMove {
  id: string;
  x: number;
  y: number;
}

/** 화살표 키 한 번의 이동량(mm) */
export const NUDGE_STEP_MM = 0.5;

/** Shift를 함께 누른 화살표 키 한 번의 이동량(mm) */
export const NUDGE_STEP_LARGE_MM = 5;

/** 정렬 기준이 되는 변 또는 중앙선 */
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** 간격을 고르게 나눌 방향 */
export type DistributeAxis = 'horizontal' | 'vertical';

/** 정렬·간격 배치의 대상 단위 — 그룹 하나 또는 그룹에 속하지 않은 요소 하나 */
export interface ArrangeUnit {
  /** 단위에 속한 요소들 (그룹이 아니면 하나) */
  members: SlipElement[];
  /** 단위 전체를 감싸는 상자 */
  box: Box;
}

/** 간격 배치 결과 — 실행할 수 없으면 그 이유를 돌려줍니다 */
export type DistributeResult =
  | { ok: true; moves: PositionMove[] }
  | { ok: false; reason: 'needsThree' | 'noRoom' };

/**
 * 요소의 위치와 표시 크기를 하나의 상자로 만듭니다.
 *
 * @param el - 대상 요소
 * @returns 왼쪽 위 좌표와 크기(mm)
 */
export function elementBox(el: SlipElement): Box {
  const size = elementBounds(el);
  return { x: el.position.x, y: el.position.y, width: size.width, height: size.height };
}

/**
 * 여러 상자를 모두 감싸는 상자를 만듭니다.
 *
 * @param boxes - 감쌀 상자들
 * @returns 감싸는 상자. 비어 있으면 null
 */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 함께 옮기는 요소들의 왼쪽·위쪽이 용지 밖(0 미만)으로 나가지 않도록 이동량을 보정합니다.
 *
 * @remarks
 * 요소마다 따로 자르지 않고 선택 전체를 같은 양만큼 되돌리므로 요소 사이 간격이 유지됩니다.
 * 오른쪽·아래쪽은 제한하지 않습니다.
 *
 * @param positions - 옮기기 전 각 요소의 왼쪽 위 좌표(mm)
 * @param dx - 가로 이동량(mm)
 * @param dy - 세로 이동량(mm)
 * @returns 보정한 이동량
 */
export function clampMoveDelta(
  positions: readonly { x: number; y: number }[],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  if (positions.length === 0) return { dx, dy };
  const minX = Math.min(...positions.map((p) => p.x + dx));
  const minY = Math.min(...positions.map((p) => p.y + dy));
  return {
    dx: minX < 0 ? dx - minX : dx,
    dy: minY < 0 ? dy - minY : dy,
  };
}

/**
 * 선택한 요소들을 같은 양만큼 옮긴 새 위치를 계산합니다.
 *
 * @param members - 옮길 요소의 id와 원래 왼쪽 위 좌표(mm)
 * @param dx - 가로 이동량(mm)
 * @param dy - 세로 이동량(mm)
 * @returns 경계 보정과 0.1mm 반올림을 거친 새 위치 목록 (입력 순서 유지)
 */
export function movedPositions(
  members: readonly { id: string; x: number; y: number }[],
  dx: number,
  dy: number,
): PositionMove[] {
  const delta = clampMoveDelta(members, dx, dy);
  return members.map((m) => ({
    id: m.id,
    x: Math.max(0, round1(m.x + delta.dx)),
    y: Math.max(0, round1(m.y + delta.dy)),
  }));
}

/**
 * 화살표 키가 뜻하는 이동량을 돌려줍니다.
 *
 * @param key - `KeyboardEvent.key`
 * @param large - Shift를 함께 눌러 큰 단위로 옮기는지
 * @returns 이동량(mm). 화살표 키가 아니면 null
 */
export function nudgeDelta(key: string, large: boolean): { dx: number; dy: number } | null {
  const step = large ? NUDGE_STEP_LARGE_MM : NUDGE_STEP_MM;
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -step };
    case 'ArrowDown': return { dx: 0, dy: step };
    default: return null;
  }
}

/**
 * 요소가 용지의 오른쪽 또는 아래쪽 가장자리를 넘는지 판정합니다.
 *
 * @param el - 대상 요소
 * @param paper - 용지 크기(mm)
 * @returns 오른쪽·아래쪽 중 하나라도 넘으면 true
 */
export function exceedsPaper(el: SlipElement, paper: { width: number; height: number }): boolean {
  const box = elementBox(el);
  return box.x + box.width > paper.width || box.y + box.height > paper.height;
}

/**
 * 요소 목록을 정렬·간격 배치의 단위로 묶습니다. 같은 그룹의 요소는 한 단위가 됩니다.
 *
 * @param elements - 선택한 요소들
 * @returns 선택 순서를 따르는 단위 목록
 */
export function selectionUnits(elements: readonly SlipElement[]): ArrangeUnit[] {
  const units: ArrangeUnit[] = [];
  const byGroup = new Map<string, SlipElement[]>();
  for (const el of elements) {
    if (el.group === undefined) {
      units.push({ members: [el], box: elementBox(el) });
      continue;
    }
    const members = byGroup.get(el.group);
    if (members) {
      members.push(el);
    } else {
      const created = [el];
      byGroup.set(el.group, created);
      units.push({ members: created, box: elementBox(el) });
    }
  }
  for (const unit of units) {
    if (unit.members.length > 1) unit.box = unionBox(unit.members.map(elementBox))!;
  }
  return units;
}

/**
 * 단위별 이동량을 요소의 새 위치로 펼치고 선택 전체의 경계를 보정합니다.
 *
 * @param units - 대상 단위들
 * @param deltaOf - 단위별 이동량(mm)
 * @returns 모든 단위 요소의 새 위치 (움직이지 않은 요소도 포함)
 */
function applyUnitDeltas(
  units: readonly ArrangeUnit[],
  deltaOf: (unit: ArrangeUnit, index: number) => { dx: number; dy: number },
): PositionMove[] {
  const moved = units.flatMap((unit, index) => {
    const delta = deltaOf(unit, index);
    return unit.members.map((el) => ({
      id: el.id,
      x: el.position.x + delta.dx,
      y: el.position.y + delta.dy,
    }));
  });
  return movedPositions(moved, 0, 0);
}

/**
 * 선택 전체를 감싸는 상자를 기준으로 각 단위의 변이나 중앙선을 맞춥니다.
 *
 * @remarks
 * 그룹은 한 덩어리로 옮기므로 그룹 안의 배치는 바뀌지 않습니다.
 *
 * @param units - 정렬할 단위들
 * @param edge - 맞출 변 또는 중앙선
 * @returns 모든 단위 요소의 새 위치
 */
export function alignUnits(units: readonly ArrangeUnit[], edge: AlignEdge): PositionMove[] {
  const reference = unionBox(units.map((u) => u.box));
  if (reference === null) return [];
  return applyUnitDeltas(units, (unit) => {
    const box = unit.box;
    switch (edge) {
      case 'left': return { dx: reference.x - box.x, dy: 0 };
      case 'hcenter':
        return { dx: reference.x + reference.width / 2 - (box.x + box.width / 2), dy: 0 };
      case 'right': return { dx: reference.x + reference.width - (box.x + box.width), dy: 0 };
      case 'top': return { dx: 0, dy: reference.y - box.y };
      case 'vcenter':
        return { dx: 0, dy: reference.y + reference.height / 2 - (box.y + box.height / 2) };
      default: return { dx: 0, dy: reference.y + reference.height - (box.y + box.height) };
    }
  });
}

/**
 * 첫 단위와 마지막 단위는 그대로 두고 그 사이 단위들을 같은 간격으로 늘어놓습니다.
 *
 * @remarks
 * 축 방향의 중심 좌표 순서로 정렬해 양 끝을 정하고, 양 끝 상자 사이의 빈 공간을 인접한 상자
 * 사이 간격으로 고르게 나눕니다. 단위가 셋 미만이거나 상자들이 양 끝 사이에 들어가지 않아
 * 간격이 음수가 되면 실행하지 않습니다.
 *
 * @param units - 배치할 단위들
 * @param axis - 간격을 나눌 방향
 * @returns 새 위치 또는 실행할 수 없는 이유
 */
export function distributeUnits(units: readonly ArrangeUnit[], axis: DistributeAxis): DistributeResult {
  if (units.length < 3) return { ok: false, reason: 'needsThree' };
  const horizontal = axis === 'horizontal';
  const start = (box: Box): number => (horizontal ? box.x : box.y);
  const size = (box: Box): number => (horizontal ? box.width : box.height);
  const ordered = [...units].sort((a, b) => (start(a.box) + size(a.box) / 2) - (start(b.box) + size(b.box) / 2));
  const first = ordered[0]!.box;
  const last = ordered[ordered.length - 1]!.box;
  const span = start(last) + size(last) - start(first);
  const total = ordered.reduce((sum, unit) => sum + size(unit.box), 0);
  const gap = (span - total) / (ordered.length - 1);
  // 부동소수 오차만큼의 음수는 꼭 맞게 들어간 것으로 봅니다.
  if (gap < -1e-9) return { ok: false, reason: 'noRoom' };

  const targets = new Map<ArrangeUnit, number>();
  let cursor = start(first) + size(first) + gap;
  for (let i = 1; i < ordered.length - 1; i += 1) {
    const unit = ordered[i]!;
    targets.set(unit, cursor);
    cursor += size(unit.box) + gap;
  }
  const moves = applyUnitDeltas(units, (unit) => {
    const target = targets.get(unit);
    if (target === undefined) return { dx: 0, dy: 0 };
    const shift = target - start(unit.box);
    return horizontal ? { dx: shift, dy: 0 } : { dx: 0, dy: shift };
  });
  return { ok: true, moves };
}
