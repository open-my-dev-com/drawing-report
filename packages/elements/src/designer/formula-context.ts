/**
 * 반복 그리드 수식의 계산 문맥 — 샘플 항목과 예약 참조(`@item`·`@group`·`@page`·`@all`·`@carried`).
 *
 * @remarks
 * 캔버스, 조건식 인라인 검사와 수식 모달이 모두 이 모듈을 거칩니다. 같은 셀을 어디서
 * 계산하든 예약 참조 값이 달라지지 않게 하기 위해서입니다.
 */

import type {
  GridBand,
  GridElement,
  GridFragment,
  GridItem,
  GridPlan,
  PlannedBand,
  SourcePagePlan,
} from '@omdc-slipkit/core';

/** 예약 참조 값을 제공할 수 없는 이유 */
export type ReservedBlockReason =
  /** 반복 설정이 없는 그리드 */
  | 'not-repeat'
  /** 지금 계산하는 자리에 항목이 없음 */
  | 'no-item'
  /** 그리드에 그룹 설정이 없음 */
  | 'no-group'
  /** 출력 페이지 계획을 계산하지 못함 */
  | 'no-plan';

/** 예약 참조 하나의 사용 가능 여부 */
export interface ReservedAvailability {
  name: string;
  /** 현재 계산 문맥에서 값을 제공할 수 있는지 */
  usable: boolean;
  /** 제공할 수 없을 때의 이유 */
  reason?: ReservedBlockReason;
}

/** 한 자리(셀 + 항목)의 계산 문맥 */
export interface FormulaSlot {
  /** 항목 구간에서 필드 이름으로 참조할 현재 항목 */
  item: GridItem | undefined;
  /** 수식 평가에 넘길 예약 참조. 반복 설정이 없으면 undefined */
  reserved: Record<string, unknown> | undefined;
  /** 이 자리가 놓인 출력 페이지 (계획이 없으면 undefined) */
  outputPage: number | undefined;
  /** 이 자리가 속한 그룹 (그룹 설정이 없으면 undefined) */
  groupIndex: number | undefined;
}

/** 샘플 항목 선택 목록의 항목 하나 */
export interface ItemChoice {
  /** `maxItems`를 적용한 실제 항목 인덱스 (0부터) */
  index: number;
  /** 계획상 이 항목이 놓이는 출력 페이지 (0부터). 계획이 없으면 undefined */
  outputPage: number | undefined;
  /** 이 항목이 속한 그룹 (그룹 설정이 없으면 undefined) */
  groupIndex: number | undefined;
}

/** 그리드 하나의 계산 문맥 */
export interface GridFormulaContext {
  /** `maxItems`를 적용한 실제 항목 */
  readonly realItems: readonly GridItem[];
  /** 해당 출력 페이지의 계획 조각을 찾습니다 */
  fragmentAt(outputPage: number): GridFragment | undefined;
  /** 계획된 행 구간 인스턴스 하나의 예약 참조를 만듭니다 */
  plannedReserved(fragment: GridFragment, planned: PlannedBand): Record<string, unknown>;
  /** 원본 행 구조를 표시할 때 행 구간 하나가 쓸 계산 문맥을 만듭니다 */
  slotForBand(fragment: GridFragment | undefined, band: GridBand | undefined): FormulaSlot;
  /** 특정 샘플 항목을 골랐을 때의 계산 문맥을 만듭니다 */
  slotForItem(itemIndex: number, band: GridBand | undefined): FormulaSlot;
  /** 고를 수 있는 샘플 항목 수 */
  readonly itemCount: number;
  /** 샘플 항목 하나가 놓이는 출력 페이지와 그룹을 찾습니다 */
  choiceAt(itemIndex: number): ItemChoice | undefined;
  /** 계산 문맥이 각 예약 참조 값을 제공하는지 판단합니다 */
  availability(slot: FormulaSlot): ReservedAvailability[];
}

/** 수식이 쓸 수 있는 예약 참조 이름 (표시 순서) */
const RESERVED_NAMES = ['@item', '@group', '@page', '@all', '@carried'] as const;

/**
 * 양식의 샘플 값에서 반복 그리드가 쓸 항목 배열을 꺼냅니다.
 *
 * @param el - 반복 설정이 있는 그리드
 * @param sampleValues - 양식의 샘플 값
 * @returns 객체인 행만 남긴 항목 목록. 샘플이 없으면 빈 목록
 */
export function sampleItemsOf(
  el: GridElement,
  sampleValues: Readonly<Record<string, unknown>> | undefined,
): GridItem[] {
  if (!el.repeat) return [];
  const sample = sampleValues?.[el.repeat.parameter];
  if (!Array.isArray(sample)) return [];
  return sample
    .filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
    .map((row) => row as GridItem);
}

/**
 * 그리드 하나의 계산 문맥을 만듭니다.
 *
 * @param el - 계산 문맥을 만들 그리드
 * @param sampleValues - 양식의 샘플 값
 * @param plan - 현재 양식 페이지의 계획. 계획에 실패했으면 null
 * @returns 예약 참조와 샘플 항목을 공급하는 계산 문맥
 */
export function gridFormulaContext(
  el: GridElement,
  sampleValues: Readonly<Record<string, unknown>> | undefined,
  plan: SourcePagePlan | null,
): GridFormulaContext {
  const items = sampleItemsOf(el, sampleValues);
  const max = el.repeat?.maxItems;
  const realItems = max === undefined ? items : items.slice(0, max);
  const gridPlan = el.repeat === undefined ? undefined : plan?.gridPlans.get(el.id);

  const itemsOf = (indexes: readonly number[] | undefined): GridItem[] =>
    indexes === undefined
      ? [...realItems]
      : indexes
          .map((index) => realItems[index])
          .filter((item): item is GridItem => item !== undefined);

  const fragmentAt = (outputPage: number): GridFragment | undefined =>
    gridPlan?.fragments.find((candidate) => candidate.outputPage === outputPage);

  /**
   * 예약 참조를 만듭니다. 계획이 공급하지 않는 값은 넣지 않습니다 — 없는 값을 대신 채우면
   * 화면에서는 쓸 수 없다고 안내하면서 계산은 되는 상태가 생깁니다.
   */
  const reservedOf = (
    fragment: GridFragment | undefined,
    planned: PlannedBand | undefined,
    previewItem: GridItem | undefined,
  ): Record<string, unknown> => {
    const reserved: Record<string, unknown> = { '@all': [...realItems] };
    if (fragment !== undefined) {
      reserved['@page'] = itemsOf(fragment.pageItems);
      reserved['@carried'] = itemsOf(fragment.carriedItems);
    }
    const item = planned?.itemIndex === undefined ? previewItem : realItems[planned.itemIndex];
    if (item !== undefined) reserved['@item'] = item;
    if (planned?.groupIndex !== undefined && gridPlan !== undefined) {
      reserved['@group'] = itemsOf(gridPlan.groups[planned.groupIndex] ?? []);
    }
    return reserved;
  };

  const plannedReserved = (fragment: GridFragment, planned: PlannedBand): Record<string, unknown> =>
    reservedOf(fragment, planned, undefined);

  const slotOf = (
    fragment: GridFragment | undefined,
    planned: PlannedBand | undefined,
    previewItem: GridItem | undefined,
  ): FormulaSlot => {
    if (el.repeat === undefined) {
      return { item: undefined, reserved: undefined, outputPage: undefined, groupIndex: undefined };
    }
    const reserved = reservedOf(fragment, planned, previewItem);
    return {
      item: reserved['@item'] as GridItem | undefined,
      reserved,
      outputPage: fragment?.outputPage,
      groupIndex: planned?.groupIndex,
    };
  };

  const plannedOf = (fragment: GridFragment | undefined, band: GridBand | undefined) =>
    fragment?.bands.find((candidate) => candidate.band.id === band?.id);

  /** 계산 문맥이 예약 참조 값을 내지 못하는 까닭을 고릅니다. */
  const missingReason = (name: string): ReservedBlockReason => {
    if (name === '@item') return 'no-item';
    if (name !== '@group') return 'no-plan';
    if (gridPlan === undefined) return 'no-plan';
    // 그룹 설정이 있는데도 값이 없으면 이 자리가 항목을 가리키지 않는다는 뜻입니다.
    return gridPlan.groups.length === 0 ? 'no-group' : 'no-item';
  };

  return {
    realItems,
    fragmentAt,
    plannedReserved,
    slotForBand: (fragment, band) => slotOf(fragment, plannedOf(fragment, band), items[0]),
    slotForItem: (itemIndex, band) => {
      const found = locate(gridPlan, itemIndex, band);
      // 계획이 없으면 페이지·그룹 의미를 만들지 않고 고른 항목만 공급합니다.
      if (found === undefined) return slotOf(undefined, undefined, realItems[itemIndex]);
      return slotOf(found.fragment, found.planned, undefined);
    },
    itemCount: realItems.length,
    choiceAt: (itemIndex) => {
      if (realItems[itemIndex] === undefined) return undefined;
      return {
        index: itemIndex,
        outputPage: locate(gridPlan, itemIndex, undefined)?.fragment.outputPage,
        groupIndex: gridPlan?.groupOf[itemIndex],
      };
    },
    availability: (slot) => {
      if (el.repeat === undefined) {
        return RESERVED_NAMES.map((name) => ({ name, usable: false, reason: 'not-repeat' as const }));
      }
      // 실제로 넘어가는 예약 참조에서 판단해, 안내와 계산 결과가 어긋나지 않게 합니다.
      return RESERVED_NAMES.map((name) => (slot.reserved?.[name] === undefined
        ? { name, usable: false, reason: missingReason(name) }
        : { name, usable: true }));
    },
  };
}

/**
 * 항목이 놓인 계획 조각과, 그 자리에서 계산에 쓸 행 구간 인스턴스를 찾습니다.
 *
 * @param gridPlan - 그리드의 페이지 계획
 * @param itemIndex - 찾을 실제 항목 인덱스
 * @param band - 계산하는 자리의 행 구간. 생략하면 항목 구간 인스턴스를 돌려줍니다
 * @returns 항목이 놓인 조각과 인스턴스. 그 조각에 해당 구간이 없으면 인스턴스는 undefined.
 *   계획에 없는 항목이면 undefined
 */
function locate(
  gridPlan: GridPlan | undefined,
  itemIndex: number,
  band: GridBand | undefined,
): { fragment: GridFragment; planned: PlannedBand | undefined } | undefined {
  if (gridPlan === undefined) return undefined;
  for (const fragment of gridPlan.fragments) {
    const item = fragment.bands.find(
      (planned) => planned.band.placement === 'item' && planned.itemIndex === itemIndex,
    );
    if (item === undefined) continue;
    if (band === undefined || band.id === item.band.id) return { fragment, planned: item };
    // 그룹 구간은 한 조각에 그룹마다 하나씩 오므로 고른 항목과 같은 그룹의 인스턴스를 찾습니다.
    // 그룹과 무관한 구간(헤더 등)은 그룹 번호가 없는 인스턴스를 씁니다.
    const planned =
      fragment.bands.find((candidate) => candidate.band.id === band.id && candidate.groupIndex === item.groupIndex)
      ?? fragment.bands.find((candidate) => candidate.band.id === band.id && candidate.groupIndex === undefined);
    return { fragment, planned };
  }
  return undefined;
}
