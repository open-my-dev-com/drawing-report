/**
 * 양식 페이지 하나를 출력 페이지 목록으로 배치하는 페이지 계획.
 *
 * 반복 그리드의 흐름을 {@link planGrid}로 계산하고, 일반 요소의 표시 페이지와
 * `after` 배치를 함께 결정한다. 렌더러와 디자이너는 같은 계획 결과를 사용한다.
 */
import { SLIP_LIMITS, elementBounds } from '../format/schema.js';
import type { OutputPageFilter, SlipElement, SlipPage } from '../format/types.js';
import { SlipLayoutError } from './errors.js';
import { planGrid, type GridItem, type GridPlan } from './grid-plan.js';
import { lm } from './messages.js';

/** 요소 하나의 출력 페이지 배치 결과. */
export interface ElementPlacement {
  outputPage: number;
  /** 배치된 시작 Y (용지 절대 mm) */
  y: number;
}

/** 페이지 계획에 필요한 용지 정보. */
export interface PlanPaper {
  width: number;
  height: number;
  /** [top, right, bottom, left] 여백(mm) */
  padding: readonly [number, number, number, number];
}

/** 양식 페이지 하나의 계획 결과. */
export interface SourcePagePlan {
  /** 이 양식 페이지에서 생성되는 출력 페이지 수 (최소 1) */
  outputPageCount: number;
  /** 흐름 영역의 세로 범위 */
  flowArea: { top: number; bottom: number };
  /** 반복 그리드의 계획 (요소 id 기준) */
  gridPlans: ReadonlyMap<string, GridPlan>;
  /** `after` 배치 요소의 결과 위치 (요소 id 기준) */
  afterPlacements: ReadonlyMap<string, ElementPlacement>;
}

/** 출력 페이지 수가 안정될 때까지 계획을 반복하는 최대 횟수. */
const MAX_PLAN_PASSES = 8;

/**
 * 절대 배치 요소가 표시되는 출력 페이지 범위를 계산한다.
 * 렌더러의 표시 판정({@link filterVisibleOnPage})과 계획기의 `after` 기준 페이지가
 * 같은 규칙을 쓰도록 이 함수 하나로 정의한다.
 *
 * @param filter - 표시 페이지 선택 (생략하면 all)
 * @param outputPageCount - 전체 출력 페이지 수
 * @returns 표시 범위. 표시되는 페이지가 없으면(한 페이지 문서의 continuation 등) undefined
 */
export function visiblePageRange(
  filter: OutputPageFilter | undefined,
  outputPageCount: number,
): { first: number; last: number } | undefined {
  switch (filter ?? 'all') {
    case 'all':
      return { first: 0, last: outputPageCount - 1 };
    case 'first':
      return { first: 0, last: 0 };
    case 'continuation':
      return outputPageCount > 1 ? { first: 1, last: outputPageCount - 1 } : undefined;
    case 'non-final':
      return outputPageCount > 1 ? { first: 0, last: outputPageCount - 2 } : undefined;
    case 'last':
      return { first: outputPageCount - 1, last: outputPageCount - 1 };
  }
}

/**
 * 절대 배치 요소가 해당 출력 페이지에 표시되는지 판정한다.
 *
 * @param filter - 표시 페이지 선택 (생략하면 all)
 * @param outputPage - 출력 페이지 번호 (0부터)
 * @param outputPageCount - 전체 출력 페이지 수
 * @returns 표시 여부
 */
export function filterVisibleOnPage(
  filter: OutputPageFilter | undefined,
  outputPage: number,
  outputPageCount: number,
): boolean {
  const range = visiblePageRange(filter, outputPageCount);
  return range !== undefined && outputPage >= range.first && outputPage <= range.last;
}

/** after 사슬을 위상 순서로 정렬한다 (대상이 먼저 오도록). */
function topoOrder(elements: readonly SlipElement[]): SlipElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const ordered: SlipElement[] = [];
  const visited = new Set<string>();
  const visit = (element: SlipElement): void => {
    if (visited.has(element.id)) return;
    visited.add(element.id);
    const placement = element.pagePlacement;
    if (placement?.mode === 'after') {
      const target = byId.get(placement.target);
      // 순환·누락은 파일 검증에서 거부되므로 여기서는 존재하는 대상만 따라간다.
      if (target !== undefined) visit(target);
    }
    ordered.push(element);
  };
  for (const element of elements) visit(element);
  return ordered;
}

/** 계획 1회의 결과와 겹침 검사에 필요한 내부 정보. */
interface PlanPass {
  outputPageCount: number;
  gridPlans: Map<string, GridPlan>;
  afterPlacements: Map<string, ElementPlacement>;
  /** 겹침 검사용 — 요소 id → after 사슬의 뿌리 id. */
  flowRoot: Map<string, string>;
}

/**
 * 양식 페이지 하나의 출력 페이지 계획을 만든다.
 *
 * 마지막 페이지 전용 요소를 따르는 `after` 배치는 전체 출력 페이지 수에 의존하므로,
 * 가정한 페이지 수로 계획을 만들고 결과가 가정과 일치할 때까지 반복한다.
 *
 * @param paper - 용지 크기와 여백
 * @param page - 계획할 양식 페이지
 * @param itemsByGrid - 반복 그리드 id별 실제 항목 배열 (`maxItems` 적용 전)
 * @param locale - 오류 메시지에 사용할 로케일
 * @returns 출력 페이지 수, 그리드 조각과 요소 배치
 * @throws SlipLayoutError 흐름 영역 초과, 출력 영역 겹침, 출력 페이지 상한 초과 또는
 *   출력 페이지 수가 확정되지 않을 때
 */
export function planSourcePage(
  paper: PlanPaper,
  page: SlipPage,
  itemsByGrid: ReadonlyMap<string, readonly GridItem[]>,
  locale?: string,
): SourcePagePlan {
  const [padTop, , padBottom] = paper.padding;
  const flowArea = page.flowArea ?? { top: padTop, bottom: paper.height - padBottom };
  const ordered = topoOrder(page.elements);

  const planPass = (assumedCount: number): PlanPass => {
    const gridPlans = new Map<string, GridPlan>();
    const afterPlacements = new Map<string, ElementPlacement>();
    /** after 대상 계산에 쓰는 요소별 마지막 출력 위치. */
    const flowEnd = new Map<string, { outputPage: number; y: number }>();
    const flowRoot = new Map<string, string>();

    for (const element of ordered) {
      const placement = element.pagePlacement;
      const bounds = elementBounds(element);
      const isRepeatGrid = element.type === 'grid' && element.repeat !== undefined;

      // 시작 위치: 절대 배치는 원본 위치, after 배치는 대상의 마지막 출력 조각 뒤.
      let startPage = 0;
      let startY = element.position.y;
      if (placement?.mode === 'after') {
        const end = flowEnd.get(placement.target);
        // 대상이 표시되는 페이지가 없으면 대상의 출력이 없으므로 이 요소도 출력하지 않는다.
        if (end === undefined) continue;
        startPage = end.outputPage;
        startY = end.y + (placement.gap ?? 0);
        flowRoot.set(element.id, flowRoot.get(placement.target) ?? placement.target);
      } else {
        flowRoot.set(element.id, element.id);
      }

      if (isRepeatGrid) {
        const items = itemsByGrid.get(element.id) ?? [];
        const plan = planGrid(element, items, {
          firstPage: startPage,
          firstTop: startY,
          top: flowArea.top,
          bottom: flowArea.bottom,
          // after 배치로 시작이 줄어든 그리드는 첫 페이지에 들어가지 않으면 다음 페이지에서 시작한다.
          allowStartShift: placement?.mode === 'after',
        }, locale);
        gridPlans.set(element.id, plan);
        const last = plan.fragments[plan.fragments.length - 1]!;
        flowEnd.set(element.id, { outputPage: last.outputPage, y: last.y + last.height });
        continue;
      }

      if (placement?.mode === 'after') {
        // after 요소는 남은 흐름 영역에 들어가지 않으면 다음 출력 페이지로 이동한다.
        if (startY + bounds.height > flowArea.bottom + 0.001) {
          startPage += 1;
          startY = flowArea.top;
          if (startY + bounds.height > flowArea.bottom + 0.001) {
            throw new SlipLayoutError(
              lm(locale).elementTooTall(lm(locale).subjectElement(element.name, element.id)),
              { elementId: element.id },
            );
          }
        }
        afterPlacements.set(element.id, { outputPage: startPage, y: startY });
        flowEnd.set(element.id, { outputPage: startPage, y: startY + bounds.height });
        continue;
      }

      // 절대 배치 요소의 출력 끝은 마지막으로 표시되는 페이지의 원본 위치 기준이다.
      const filter = placement?.mode === 'absolute' ? placement.pages : undefined;
      const range = visiblePageRange(filter, assumedCount);
      if (range !== undefined) {
        flowEnd.set(element.id, { outputPage: range.last, y: element.position.y + bounds.height });
      }
    }

    // 전체 출력 페이지 수는 가장 긴 독립 흐름을 따른다.
    let outputPageCount = 1;
    for (const plan of gridPlans.values()) {
      const last = plan.fragments[plan.fragments.length - 1];
      if (last !== undefined) outputPageCount = Math.max(outputPageCount, last.outputPage + 1);
    }
    for (const placement of afterPlacements.values()) {
      outputPageCount = Math.max(outputPageCount, placement.outputPage + 1);
    }
    return { outputPageCount, gridPlans, afterPlacements, flowRoot };
  };

  let assumedCount = 1;
  let pass = planPass(assumedCount);
  for (let attempt = 0; pass.outputPageCount !== assumedCount; attempt++) {
    if (attempt >= MAX_PLAN_PASSES) {
      throw new SlipLayoutError(lm(locale).planNotConverged());
    }
    assumedCount = pass.outputPageCount;
    pass = planPass(assumedCount);
  }

  const { outputPageCount, gridPlans, afterPlacements, flowRoot } = pass;
  if (outputPageCount > SLIP_LIMITS.maxOutputPages) {
    throw new SlipLayoutError(lm(locale).outputPagesExceeded(SLIP_LIMITS.maxOutputPages));
  }

  // 독립 흐름의 출력 영역이 겹치면 오류를 반환한다 (§6.3).
  // 반복 그리드의 조각과 after로 배치된 요소가 흐름의 출력 영역을 이룬다.
  const rects: { id: string; label: string; root: string; page: number; x: number; y: number; w: number; h: number }[] = [];
  for (const element of page.elements) {
    if (element.type === 'grid' && element.repeat !== undefined) {
      const plan = gridPlans.get(element.id);
      if (plan === undefined) continue;
      const width = elementBounds(element).width;
      for (const fragment of plan.fragments) {
        rects.push({
          id: element.id,
          label: lm(locale).subjectGrid(element.name, element.id),
          root: flowRoot.get(element.id) ?? element.id,
          page: fragment.outputPage,
          x: element.position.x,
          y: fragment.y,
          w: width,
          h: fragment.height,
        });
      }
      continue;
    }
    const placed = afterPlacements.get(element.id);
    if (placed === undefined) continue;
    const bounds = elementBounds(element);
    rects.push({
      id: element.id,
      label: lm(locale).subjectElement(element.name, element.id),
      root: flowRoot.get(element.id) ?? element.id,
      page: placed.outputPage,
      x: element.position.x,
      y: placed.y,
      w: bounds.width,
      h: bounds.height,
    });
  }
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      const ra = rects[a]!;
      const rb = rects[b]!;
      if (ra.root === rb.root || ra.page !== rb.page) continue;
      const overlap = ra.x < rb.x + rb.w && rb.x < ra.x + ra.w && ra.y < rb.y + rb.h && rb.y < ra.y + ra.h;
      if (overlap) {
        throw new SlipLayoutError(lm(locale).flowOverlap(ra.label, rb.label), { elementId: rb.id });
      }
    }
  }

  return { outputPageCount, flowArea, gridPlans, afterPlacements };
}
