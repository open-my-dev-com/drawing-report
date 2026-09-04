/**
 * 반복 그리드 하나를 출력 페이지 조각으로 나누는 페이지 계획.
 *
 * 계획은 순수 데이터 계산이며 렌더링 엔진에 의존하지 않는다. 같은 입력은 항상
 * 같은 결과를 반환한다. 항목 구간은 원자 단위로 취급해 페이지 사이에서 나누지 않는다.
 */
import { SLIP_LIMITS } from '../format/schema.js';
import type { GridBand, GridBandPlacement, GridElement, OutputPageFilter } from '../format/types.js';
import { SlipLayoutError } from './errors.js';
import { lm, type PlanSpace } from './messages.js';
import { readOwn } from '../own-property.js';

/** 반복 항목 하나의 값 객체 */
export type GridItem = Record<string, unknown>;

/** 출력 페이지 조각 안에 배치된 행 구간 인스턴스. */
export interface PlannedBand {
  /** 원본 행 구간 */
  band: GridBand;
  /** 조각 안에서 이 인스턴스가 시작하는 출력 행 인덱스 */
  rowStart: number;
  /**
   * 항목·그룹 구간이 참조하는 실제 항목 인덱스.
   * 항목 구간은 자신의 항목, 그룹 구간은 그룹의 첫(시작)·마지막(종료) 항목이다.
   * 빈 항목 인스턴스에는 없다.
   */
  itemIndex?: number;
  /** 값 없이 공간만 채우는 빈 항목 인스턴스 여부 */
  emptyItem?: boolean;
  /** 그룹 인덱스 (그룹 설정이 있는 항목·그룹 구간) */
  groupIndex?: number;
}

/** 한 출력 페이지에 배치되는 그리드 조각. */
export interface GridFragment {
  /** 원본 양식 페이지 안에서의 출력 페이지 번호 (0부터) */
  outputPage: number;
  /** 조각의 시작 Y 좌표 (용지 절대 mm) */
  y: number;
  /** 조각의 전체 높이(mm) */
  height: number;
  /** 조각의 출력 행 높이 목록 */
  rowHeights: number[];
  /** 배치된 행 구간 인스턴스 (세로 순서) */
  bands: PlannedBand[];
  /** 이 페이지에 배치된 실제 항목 인덱스 (`@page`) */
  pageItems: number[];
  /**
   * 이 페이지 이전까지 배치된 실제 항목 수 (`@carried`).
   * 항목은 인덱스 순서로 배치되므로 이월 항목은 실제 항목 배열의 앞 `carriedCount`개다.
   */
  carriedCount: number;
}

/** 그리드 하나의 페이지 계획 결과. */
export interface GridPlan {
  gridId: string;
  /** 출력 페이지별 조각 (outputPage 오름차순) */
  fragments: GridFragment[];
  /** `maxItems` 적용 후의 실제 항목 수 */
  itemCount: number;
  /** 실제 항목 인덱스 → 그룹 인덱스 (그룹 설정이 없으면 빈 배열) */
  groupOf: number[];
  /** 그룹별 실제 항목 인덱스 목록 */
  groups: number[][];
}

/** 그리드 흐름이 배치될 세로 공간. */
export interface GridFlow {
  /** 첫 조각이 시작하는 출력 페이지 번호 */
  firstPage: number;
  /** 첫 조각의 시작 Y (그리드의 `position.y` 또는 after 배치 결과) */
  firstTop: number;
  /** 이어지는 조각이 시작하는 Y (흐름 영역 상단) */
  top: number;
  /** 조각이 넘을 수 없는 Y (흐름 영역 하단) */
  bottom: number;
  /**
   * `after` 배치로 시작이 줄어든 흐름인지.
   * 참이면 실제 항목이 없어도 첫 페이지에 아무것도 들어가지 않을 때 빈 조각 없이 다음
   * 페이지에서 시작한다. 실제 항목이 하나 이상인 그리드는 이 값과 무관하게 같은 규칙으로
   * 시작을 옮긴다 ({@link planGrid} 참고).
   */
  allowStartShift?: boolean;
}

/** 구간의 템플릿 행 높이 합. */
function bandHeight(grid: GridElement, band: GridBand): number {
  let sum = 0;
  for (let r = band.fromRow; r <= band.toRow; r++) sum += grid.rows[r]!.height;
  return sum;
}

/** 구간의 템플릿 행 높이 목록. */
function bandRowHeights(grid: GridElement, band: GridBand): number[] {
  const heights: number[] = [];
  for (let r = band.fromRow; r <= band.toRow; r++) heights.push(grid.rows[r]!.height);
  return heights;
}

/** 표시 페이지 필터가 해당 페이지에 적용되는지 (최종 페이지 여부를 알 때). */
function filterMatches(filter: OutputPageFilter | undefined, isFirst: boolean, isFinal: boolean): boolean {
  switch (filter ?? 'all') {
    case 'all':
      return true;
    case 'first':
      return isFirst;
    case 'continuation':
      return !isFirst;
    case 'non-final':
      return !isFinal;
    case 'last':
      return isFinal;
  }
}

/** 두 항목이 groupBy 기준으로 같은 그룹인지 비교한다. */
function sameGroup(a: GridItem, b: GridItem, groupBy: readonly string[]): boolean {
  return groupBy.every((field) => {
    const va = readOwn(a, field) ?? null;
    const vb = readOwn(b, field) ?? null;
    if (va === null || vb === null) return va === vb;
    if (typeof va === 'object' || typeof vb === 'object') return JSON.stringify(va) === JSON.stringify(vb);
    return va === vb;
  });
}

/** 계획 단계에서 페이지에 붙일 배치 블록 (원자 단위). */
interface PlanBlock {
  bands: PlannedBand[];
  height: number;
  /** 블록에 포함된 실제 항목 인덱스 (빈 항목은 제외) */
  itemIndex?: number;
}

/** placement 종류별 구간 목록을 만든다. */
function bandsOf(grid: GridElement, placement: GridBandPlacement): GridBand[] {
  return grid.repeat!.bands.filter((band) => band.placement === placement);
}

/**
 * 반복 그리드 하나의 페이지 계획을 만든다.
 *
 * 첫 조각의 시작 위치가 흐름 영역 상단보다 낮아 항목 인스턴스(실제 항목·빈 항목)를 하나도
 * 배치하지 못하면, 첫 페이지에 조각을 남기지 않고 다음 출력 페이지의 흐름 영역 상단에서
 * 다시 시작한다(시작 이동). 시작 이동은 첫 조각에서 한 번만 일어나며, 실제 항목이 하나 이상인
 * 그리드와 `after` 배치 흐름({@link GridFlow.allowStartShift})에 적용된다. 실제 항목이 없는
 * 절대 배치 그리드는 빈 항목을 `position.y`부터 그대로 배치한다. 옮긴 뒤에도 빈 페이지의
 * 흐름 영역 전체에 머리·꼬리 구간, 항목 블록 또는 고정 페이지 묶음이 들어가지 않으면
 * 빈 조각을 만들지 않고 바로 오류를 반환한다.
 *
 * @param grid - 반복 설정이 있는 그리드 요소
 * @param items - `maxItems`를 적용하기 전의 실제 항목 배열
 * @param flow - 흐름 공간 (첫 페이지·시작 Y·흐름 영역 상단과 하단)
 * @param locale - 오류 메시지에 사용할 로케일
 * @returns 그리드의 페이지 계획
 * @throws SlipLayoutError 항목·그룹·고정 페이지 구성이 흐름 영역에 들어가지 않을 때
 */
export function planGrid(
  grid: GridElement,
  items: readonly GridItem[],
  flow: GridFlow,
  locale?: string,
): GridPlan {
  const repeat = grid.repeat;
  if (!repeat) {
    // 정적 그리드는 첫 페이지에 조각 하나로 배치한다.
    const rowHeights = grid.rows.map((row) => row.height);
    return {
      gridId: grid.id,
      fragments: [{
        outputPage: flow.firstPage,
        y: flow.firstTop,
        height: rowHeights.reduce((a, b) => a + b, 0),
        rowHeights,
        bands: [],
        pageItems: [],
        carriedCount: 0,
      }],
      itemCount: 0,
      groupOf: [],
      groups: [],
    };
  }

  const what = lm(locale).subjectGrid(grid.name, grid.id);
  const itemBand = repeat.bands.find((band) => band.placement === 'item')!;
  const itemHeight = bandHeight(grid, itemBand);

  // maxItems를 실제 데이터에 먼저 적용한다.
  const real = repeat.maxItems === undefined ? items.slice() : items.slice(0, repeat.maxItems);

  // 연속된 groupBy 값으로 그룹을 만든다. 빈 항목은 그룹에 포함하지 않는다.
  const groupOf: number[] = [];
  const groups: number[][] = [];
  if (repeat.groupBy !== undefined) {
    real.forEach((item, i) => {
      if (i > 0 && sameGroup(real[i - 1]!, item, repeat.groupBy!)) {
        groupOf.push(groups.length - 1);
        groups[groups.length - 1]!.push(i);
      } else {
        groupOf.push(groups.length);
        groups.push([i]);
      }
    });
  }

  // 항목 인스턴스 수: 자동 확장은 minItems까지, 고정 페이지는 페이지 단위로 빈 항목을 채운다.
  const pagination = repeat.pagination;
  let instanceCount: number;
  if (pagination.mode === 'auto') {
    instanceCount = Math.max(real.length, pagination.minItems);
  } else {
    const pages = Math.max(1, Math.ceil(real.length / pagination.itemsPerPage));
    instanceCount = pages * pagination.itemsPerPage;
  }

  const groupStartBands = bandsOf(grid, 'group-start');
  const groupEndBands = bandsOf(grid, 'group-end');
  const beforeBands = bandsOf(grid, 'before-data');
  const pageStartBands = bandsOf(grid, 'page-start');
  const afterBands = bandsOf(grid, 'after-data');
  const pageEndBands = bandsOf(grid, 'page-end');

  const sumHeights = (bands: readonly GridBand[]): number =>
    bands.reduce((sum, band) => sum + bandHeight(grid, band), 0);

  /** 항목 인스턴스 하나를 배치 블록으로 만든다 (그룹 시작·종료 동반 규칙 포함). */
  const blockOf = (index: number): PlanBlock => {
    const isReal = index < real.length;
    const bands: PlannedBand[] = [];
    let height = 0;
    if (isReal && repeat.groupBy !== undefined) {
      const group = groupOf[index]!;
      const first = groups[group]![0] === index;
      const last = groups[group]![groups[group]!.length - 1] === index;
      if (first) {
        for (const band of groupStartBands) {
          bands.push({ band, rowStart: 0, itemIndex: index, groupIndex: group });
          height += bandHeight(grid, band);
        }
      }
      bands.push({ band: itemBand, rowStart: 0, itemIndex: index, groupIndex: group });
      height += itemHeight;
      if (last) {
        for (const band of groupEndBands) {
          bands.push({
            band,
            rowStart: 0,
            itemIndex: groups[group]![groups[group]!.length - 1]!,
            groupIndex: group,
          });
          height += bandHeight(grid, band);
        }
      }
      return { bands, height, itemIndex: index };
    }
    bands.push(
      isReal
        ? { band: itemBand, rowStart: 0, itemIndex: index }
        : { band: itemBand, rowStart: 0, emptyItem: true },
    );
    return { bands, height: itemHeight, ...(isReal ? { itemIndex: index } : {}) };
  };

  // ---------------------------------------------------------------------------
  // 페이지 채우기
  // ---------------------------------------------------------------------------

  const fragments: GridFragment[] = [];
  let carriedCount = 0;
  let index = 0;
  let fragmentNo = 0;
  /** 페이지를 넘긴 그룹의 시작 구간을 다음 페이지 머리에 다시 표시하기 위한 목록. */
  let pendingGroupRepeat: PlannedBand[] = [];

  /** 페이지 시작 구간(첫 페이지의 before-data 포함)의 인스턴스를 만든다. */
  const headBands = (isFirst: boolean, isFinal: boolean): PlannedBand[] => {
    const head: PlannedBand[] = [];
    if (isFirst) for (const band of beforeBands) head.push({ band, rowStart: 0 });
    for (const band of pageStartBands) {
      if (filterMatches(band.pages, isFirst, isFinal)) head.push({ band, rowStart: 0 });
    }
    return head;
  };

  /** 페이지 종료 구간의 인스턴스를 만든다. */
  const tailBands = (isFirst: boolean, isFinal: boolean, withAfterData: boolean): PlannedBand[] => {
    const tail: PlannedBand[] = [];
    if (withAfterData) for (const band of afterBands) tail.push({ band, rowStart: 0 });
    for (const band of pageEndBands) {
      if (filterMatches(band.pages, isFirst, isFinal)) tail.push({ band, rowStart: 0 });
    }
    return tail;
  };

  const heightOf = (bands: readonly PlannedBand[]): number =>
    bands.reduce((sum, planned) => sum + bandHeight(grid, planned.band), 0);

  /** 조각을 마무리해 rowStart·rowHeights를 계산하고 목록에 추가한다. */
  const commitFragment = (outputPage: number, y: number, bands: PlannedBand[]): void => {
    let rowStart = 0;
    const rowHeights: number[] = [];
    const pageItems: number[] = [];
    for (const planned of bands) {
      planned.rowStart = rowStart;
      const heights = bandRowHeights(grid, planned.band);
      rowHeights.push(...heights);
      rowStart += heights.length;
      if (planned.band.placement === 'item' && planned.itemIndex !== undefined) {
        pageItems.push(planned.itemIndex);
      }
    }
    fragments.push({
      outputPage,
      y,
      height: rowHeights.reduce((a, b) => a + b, 0),
      rowHeights,
      bands,
      pageItems,
      carriedCount,
    });
    carriedCount += pageItems.length;
  };

  /**
   * 남은 인스턴스 전체가 이 페이지에 들어가는지 검사한다.
   * 들어가면 이 페이지가 마지막 출력 페이지다.
   */
  const remainderFits = (available: number, isFirst: boolean): boolean => {
    let height = heightOf(headBands(isFirst, true));
    // 구간 높이는 모두 양수라 한 번 넘치면 남은 항목을 더 세지 않아도 결과가 같다.
    // 항목이 많은 문서에서 페이지마다 남은 항목 전체를 훑지 않도록 여기서 멈춘다.
    for (let i = index; i < instanceCount; i++) {
      if (height > available + 0.001) return false;
      height += blockOf(i).height;
    }
    height += heightOf(tailBands(isFirst, true, true));
    return height <= available + 0.001;
  };

  /** 페이지를 넘긴 그룹의 시작 구간을 다음 페이지 머리에 다시 표시하도록 예약한다. */
  const queueGroupRepeat = (): void => {
    if (repeat.groupBy === undefined || index >= real.length) return;
    const group = groupOf[index]!;
    // 다음 항목이 그룹의 첫 항목이면 이월이 아니다.
    if (groups[group]![0]! >= index) return;
    for (const band of groupStartBands) {
      if (band.repeatOnPageBreak === true) {
        pendingGroupRepeat.push({ band, rowStart: 0, itemIndex: groups[group]![0]!, groupIndex: group });
      }
    }
  };

  let startPage = flow.firstPage;
  let firstTop = flow.firstTop;
  // 실제 항목이 있는 그리드는 배치 방식과 무관하게, after 배치 흐름은 항목이 없어도 옮긴다.
  const canShiftStart = flow.allowStartShift === true || real.length > 0;

  /**
   * 항목 인스턴스를 하나도 배치하지 못한 첫 페이지를 빈 조각 없이 건너뛰고 다음 출력
   * 페이지의 흐름 영역 상단에서 시작한다.
   * 첫 조각을 만들기 전이고 시작 위치가 흐름 영역 상단보다 낮을 때만 옮길 수 있다 —
   * 호출하는 쪽은 아직 아무 인스턴스도 배치하지 않았을 때만 부른다.
   */
  const shiftStart = (): boolean => {
    if (!canShiftStart) return false;
    if (fragmentNo !== 0 || firstTop <= flow.top + 0.001) return false;
    startPage += 1;
    firstTop = flow.top;
    return true;
  };

  for (;;) {
    if (fragmentNo >= SLIP_LIMITS.maxOutputPages) {
      throw new SlipLayoutError(lm(locale).outputPagesExceeded(SLIP_LIMITS.maxOutputPages), {
        elementId: grid.id,
      });
    }
    const isFirst = fragmentNo === 0;
    const outputPage = startPage + fragmentNo;
    const y = isFirst ? firstTop : flow.top;
    const available = flow.bottom - y;
    // 흐름 영역 상단에서 시작하는 페이지는 빈 페이지 전체를 쓴다. 여기서 넘치면 다음
    // 페이지도 같은 구성이므로 시작을 옮기거나 페이지를 넘겨도 해결되지 않는다.
    const atFlowTop = y <= flow.top + 0.001;
    const space: PlanSpace = atFlowTop ? 'empty-page' : 'first-page';
    // 고정 페이지는 마지막 묶음 여부가 항목 수로 정해지고, 자동 확장은 남은 전체가
    // 이 페이지에 들어가는지로 마지막 페이지를 판정한다.
    const isFinal = pagination.mode === 'fixed'
      ? index + pagination.itemsPerPage >= instanceCount
      : remainderFits(available - heightOf(pendingGroupRepeat), isFirst);

    const bands: PlannedBand[] = headBands(isFirst, isFinal);
    // 이월된 그룹 시작 구간은 페이지 머리 구간 바로 뒤에 다시 표시한다.
    const carriedGroupHead = pendingGroupRepeat.length > 0;
    bands.push(...pendingGroupRepeat);
    pendingGroupRepeat = [];
    let used = heightOf(bands);
    const tailReserve = heightOf(tailBands(isFirst, isFinal, false));

    if (pagination.mode === 'fixed') {
      // 고정 페이지: 정확히 itemsPerPage개의 항목 영역을 배치한다.
      const pageEnd = Math.min(index + pagination.itemsPerPage, instanceCount);
      const chunk: PlannedBand[] = [];
      let chunkHeight = 0;
      for (let i = index; i < pageEnd; i++) {
        const block = blockOf(i);
        chunkHeight += block.height;
        chunk.push(...block.bands);
      }
      const withAfter = pageEnd >= instanceCount;
      const tail = tailBands(isFirst, isFinal, withAfter);
      if (used + chunkHeight + heightOf(tail) > available + 0.001) {
        if (shiftStart()) continue;
        throw new SlipLayoutError(lm(locale).fixedPageTooTall(what, pagination.itemsPerPage, space), {
          elementId: grid.id, bandId: itemBand.id,
        });
      }
      index = pageEnd;
      bands.push(...chunk, ...tail);
      commitFragment(outputPage, y, bands);
      fragmentNo++;
      if (index >= instanceCount) break;
      queueGroupRepeat();
      continue;
    }

    // 페이지 머리 구간만으로 흐름 영역이 넘치면 항목을 배치할 자리가 없다.
    if (used + tailReserve > available + 0.001) {
      if (shiftStart()) continue;
      throw new SlipLayoutError(lm(locale).bandsTooTall(what, space), { elementId: grid.id });
    }

    // 자동 확장: 남은 공간까지 블록을 채우고, 다음 블록이 들어가지 않으면 페이지를 넘긴다.
    let placedAny = false;
    let pageBroken = false;
    while (index < instanceCount) {
      const block = blockOf(index);
      if (used + block.height + tailReserve > available + 0.001) {
        // 빈 페이지에서 블록을 배치하지 못하면 다음 페이지도 같은 구성이므로
        // (이월된 그룹 머리 포함) 더 진행할 수 없다 — 빈 조각 없이 즉시 오류를 반환한다.
        if (!placedAny && atFlowTop) {
          const groupBlock = block.bands.length > 1 || carriedGroupHead;
          throw new SlipLayoutError(
            groupBlock ? lm(locale).groupTooTall(what) : lm(locale).itemTooTall(what),
            { elementId: grid.id, bandId: itemBand.id },
          );
        }
        pageBroken = true;
        break;
      }
      used += block.height;
      bands.push(...block.bands);
      placedAny = true;
      index++;
    }

    // 첫 페이지에 항목 인스턴스가 하나도 들어가지 않으면 빈 조각 없이 다음 페이지에서 시작한다.
    if (pageBroken && !placedAny && shiftStart()) continue;

    const finishedItems = index >= instanceCount;
    if (finishedItems && !pageBroken) {
      // 마지막 페이지로 판정된 경우에만 최종 구간을 이 페이지에 붙일 수 있다.
      if (isFinal) {
        const tail = tailBands(isFirst, true, true);
        if (used + heightOf(tail) <= available + 0.001) {
          bands.push(...tail);
          commitFragment(outputPage, y, bands);
          fragmentNo++;
          break;
        }
      }
      // 배치할 항목 인스턴스가 없는 after 배치 흐름은 최종 구간이 들어가지 않으면
      // 시작을 옮겨 다시 시도한다.
      if (!placedAny && shiftStart()) continue;
      // 최종 전용 구간이나 합계가 이 페이지에 들어가지 않는다 —
      // 비최종 구간으로 마감하고 새 출력 페이지에 최종 구간을 배치한다 (§6.2).
      bands.push(...tailBands(isFirst, false, false));
      commitFragment(outputPage, y, bands);
      fragmentNo++;
      const lastBands: PlannedBand[] = headBands(false, true);
      lastBands.push(...tailBands(false, true, true));
      // 최종 페이지 전용 구간이 없으면 추가 페이지를 만들지 않는다.
      if (lastBands.length === 0) break;
      if (fragmentNo >= SLIP_LIMITS.maxOutputPages) {
        throw new SlipLayoutError(lm(locale).outputPagesExceeded(SLIP_LIMITS.maxOutputPages), {
          elementId: grid.id,
        });
      }
      if (heightOf(lastBands) > flow.bottom - flow.top + 0.001) {
        throw new SlipLayoutError(lm(locale).bandsTooTall(what, 'empty-page'), { elementId: grid.id });
      }
      commitFragment(startPage + fragmentNo, flow.top, lastBands);
      fragmentNo++;
      break;
    }

    // 페이지가 넘어갔다 — 이 페이지를 마감하고 다음 페이지로 계속한다.
    bands.push(...tailBands(isFirst, false, false));
    commitFragment(outputPage, y, bands);
    fragmentNo++;

    // 페이지를 넘긴 그룹의 시작 구간을 다음 페이지에 다시 표시한다.
    queueGroupRepeat();
  }

  return { gridId: grid.id, fragments, itemCount: real.length, groupOf, groups };
}
