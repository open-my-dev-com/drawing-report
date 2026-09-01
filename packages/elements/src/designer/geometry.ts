/**
 * 디자이너의 좌표와 크기 계산.
 *
 * @remarks
 * 용지 좌표는 mm, 화면 좌표는 px입니다.
 */

import { elementBounds, type SlipElement, type LineElement } from '@omdc-slipkit/core';

export const PX_PER_MM = 96 / 25.4;

/** 크기 조절 최소 폭·높이(mm) */
export const MIN_SIZE_MM = 2;

/** 요소와 안내선에 맞춤이 적용되는 최대 거리(mm) */
export const SNAP_MM = 1.5;

/**
 * 속성 패널에서 X와 Y 좌표의 기준으로 사용할 9개 지점.
 * 파일에는 기준점과 관계없이 왼쪽 위 좌표를 저장합니다.
 */
export const ANCHORS = [
  { key: 'anchorTL', ax: 0, ay: 0 },
  { key: 'anchorT', ax: 0.5, ay: 0 },
  { key: 'anchorTR', ax: 1, ay: 0 },
  { key: 'anchorL', ax: 0, ay: 0.5 },
  { key: 'anchorC', ax: 0.5, ay: 0.5 },
  { key: 'anchorR', ax: 1, ay: 0.5 },
  { key: 'anchorBL', ax: 0, ay: 1 },
  { key: 'anchorB', ax: 0.5, ay: 1 },
  { key: 'anchorBR', ax: 1, ay: 1 },
] as const;

/** 사이드바 페이지 미리보기의 너비(px) */
export const THUMB_WIDTH_PX = 132;

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/**
 * mm 좌표를 0.1mm 단위로 반올림
 *
 * @param v - 반올림할 값(mm)
 * @returns 0.1mm 단위로 반올림한 값
 */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 선 요소의 영역과 방향을 길이와 각도로 변환합니다.
 *
 * @remarks
 * 파일에는 선의 영역과 방향을 저장하고 속성 패널에서는 길이와 각도로 편집합니다.
 * 각도는 화면 좌표계에서 시계 방향을 양수로 사용하며 0도는 오른쪽, 90도는 아래쪽입니다.
 *
 * @param el - 선 요소
 * @returns 길이(mm)와 각도(도)
 */
export function lineLengthAngle(el: LineElement): { length: number; angle: number } {
  const w = el.width;
  const h = el.height;
  switch (el.lineDirection ?? 'horizontal') {
    case 'horizontal': return { length: w, angle: 0 };
    case 'vertical': return { length: h, angle: 90 };
    // 대각선은 요소 영역의 두 모서리를 잇습니다.
    case 'down': return { length: Math.hypot(w, h), angle: (Math.atan2(h, w) * 180) / Math.PI };
    default: return { length: Math.hypot(w, h), angle: -(Math.atan2(h, w) * 180) / Math.PI };
  }
}

/**
 * 길이와 각도를 파일에 저장할 요소 영역과 방향으로 변환합니다.
 *
 * @remarks
 * 0, 90, 180, 270도와의 차이가 0.5도 이내이면 수평선 또는 수직선으로 맞춥니다.
 *
 * @param length - 길이(mm)
 * @param angle - 각도(도, 시계 방향)
 * @returns 상자 크기와 방향
 */
export function lineBoxFromLengthAngle(
  length: number,
  angle: number,
): { width: number; height: number; lineDirection: 'horizontal' | 'vertical' | 'down' | 'up' } {
  const len = Math.max(0, length);
  // 반대 방향은 같은 선이므로 각도를 0 이상 180도 미만으로 정규화합니다.
  let a = ((angle % 360) + 360) % 360;
  if (a >= 180) a -= 180;
  const SNAP = 0.5;
  if (a <= SNAP || a >= 180 - SNAP) return { width: len, height: 0, lineDirection: 'horizontal' };
  if (Math.abs(a - 90) <= SNAP) return { width: 0, height: len, lineDirection: 'vertical' };
  const rad = (a * Math.PI) / 180;
  const width = Math.abs(len * Math.cos(rad));
  const height = Math.abs(len * Math.sin(rad));
  return { width, height, lineDirection: a < 90 ? 'down' : 'up' };
}

/**
 * PDF 변환과 같은 규칙으로 정다각형 꼭짓점 좌표를 계산합니다.
 *
 * @param sides - 변의 개수
 * @param width - 요소 너비(px)
 * @param height - 요소 높이(px)
 * @returns 꼭짓점의 px 좌표 목록
 */
export function polygonPointsPx(sides: number, width: number, height: number): [number, number][] {
  const raw: [number, number][] = Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return raw.map(([x, y]) => [((x - minX) / spanX) * width, ((y - minY) / spanY) * height]);
}

/**
 * 선 요소의 방향에 따른 두 끝점 좌표(mm)를 계산합니다.
 *
 * @param el - 선 요소의 위치, 크기와 방향
 * @returns 시작점과 끝점의 mm 좌표
 */
export function lineEndpoints(el: {
  position: { x: number; y: number };
  width: number;
  height: number;
  lineDirection?: 'horizontal' | 'vertical' | 'down' | 'up' | undefined;
}): [{ x: number; y: number }, { x: number; y: number }] {
  const { x, y } = el.position;
  const w = el.width;
  const h = el.height;
  switch (el.lineDirection ?? 'horizontal') {
    case 'vertical':
      return [{ x: x + w / 2, y }, { x: x + w / 2, y: y + h }];
    case 'down':
      return [{ x, y }, { x: x + w, y: y + h }];
    case 'up':
      return [{ x, y: y + h }, { x: x + w, y }];
    default:
      return [{ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }];
  }
}

/**
 * 요소의 표시 크기(mm). 그리드는 열 너비와 행 높이의 합에서 계산합니다.
 *
 * @param el - 대상 요소
 * @returns 표시 너비와 높이(mm)
 */
export function boxOf(el: SlipElement): { width: number; height: number } {
  return elementBounds(el);
}

/**
 * 요소 크기를 설정합니다. 그리드는 크기를 따로 저장하지 않으므로
 * 기존 비율을 유지하며 열 너비와 행 높이를 목표 크기에 맞춥니다.
 *
 * @param el - 대상 요소
 * @param width - 목표 너비(mm). 생략하면 그대로 둡니다
 * @param height - 목표 높이(mm). 생략하면 그대로 둡니다
 */
export function setElementBox(el: SlipElement, width?: number, height?: number): void {
  if (el.type === 'grid') {
    const scaled = (sizes: number[], target: number): number[] => {
      const total = sizes.reduce((sum, size) => sum + size, 0);
      if (total <= 0) return sizes.map(() => Math.max(MIN_SIZE_MM, round1(target / sizes.length)));
      return sizes.map((size) => Math.max(MIN_SIZE_MM, round1((size / total) * target)));
    };
    if (width !== undefined) {
      el.columns = scaled(el.columns.map((column) => column.width), width).map((w) => ({ width: w }));
    }
    if (height !== undefined) {
      el.rows = scaled(el.rows.map((row) => row.height), height).map((h) => ({ height: h }));
    }
    return;
  }
  if (width !== undefined) el.width = width;
  if (height !== undefined) el.height = height;
}

/**
 * 트랙 크기 배열을 누적 오프셋 배열로 변환합니다.
 *
 * @param sizes - 트랙 크기 목록
 * @returns 트랙 개수보다 하나 많은 누적 오프셋 목록
 */
export function trackOffsets(sizes: readonly number[]): number[] {
  const offsets = [0];
  for (const size of sizes) offsets.push((offsets[offsets.length - 1] ?? 0) + size);
  return offsets;
}

/** 스냅 후보 선 — 용지 경계·여백과 다른 요소들의 시작·중앙·끝 */
export interface SnapCandidates {
  xs: number[];
  ys: number[];
}

/**
 * 스냅이 맞아떨어질 후보 선을 모읍니다.
 *
 * @param paper - 용지 크기와 여백(mm)
 * @param elements - 같은 페이지의 요소들
 * @param exclude - 함께 움직이는 요소의 id — 후보에서 뺍니다
 * @returns 세로선(xs)과 가로선(ys)의 mm 좌표
 */
export function snapCandidates(
  paper: { width: number; height: number; padding: readonly number[] },
  elements: readonly SlipElement[],
  exclude: ReadonlySet<string>,
): SnapCandidates {
  const [pt, pr, pb, pl] = paper.padding as [number, number, number, number];
  const xs = [0, pl, paper.width - pr, paper.width];
  const ys = [0, pt, paper.height - pb, paper.height];
  for (const el of elements) {
    if (exclude.has(el.id)) continue;
    const box = boxOf(el);
    xs.push(el.position.x, el.position.x + box.width / 2, el.position.x + box.width);
    ys.push(el.position.y, el.position.y + box.height / 2, el.position.y + box.height);
  }
  return { xs, ys };
}

/**
 * 후보 선까지의 거리가 스냅 범위 안인 가장 가까운 이동량을 찾습니다.
 *
 * @param edges - 맞출 대상의 모서리·중앙 좌표(mm)
 * @param candidates - 후보 선의 좌표(mm)
 * @returns 이동량과 맞은 선의 좌표. 범위 안에 없으면 null
 */
export function bestSnap(
  edges: readonly number[],
  candidates: readonly number[],
): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const edge of edges) {
    for (const line of candidates) {
      const delta = line - edge;
      if (Math.abs(delta) <= SNAP_MM && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, line };
      }
    }
  }
  return best;
}
