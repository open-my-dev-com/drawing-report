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

/** 예약 참조가 값을 낼 수 없는 이유 */
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
  /** 지금 이 자리에서 값을 낼 수 있는지 */
  usable: boolean;
  /** 쓸 수 없을 때의 이유 */
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
  /** 고를 수 있는 샘플 항목과 각 항목이 놓이는 출력 페이지·그룹 */
  itemChoices(): ItemChoice[];
  /** 이 자리에서 각 예약 참조를 쓸 수 있는지 판단합니다 */
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

  const baseReserved = (fragment: GridFragment): Record<string, unknown> => ({
    '@all': [...realItems],
    '@page': itemsOf(fragment.pageItems),
    '@carried': itemsOf(fragment.carriedItems),
  });

  const plannedReserved = (fragment: GridFragment, planned: PlannedBand): Record<string, unknown> => {
    const reserved = baseReserved(fragment);
    const item = planned.itemIndex === undefined ? undefined : realItems[planned.itemIndex];
    if (item !== undefined) reserved['@item'] = item;
    if (planned.groupIndex !== undefined && gridPlan !== undefined) {
      reserved['@group'] = itemsOf(gridPlan.groups[planned.groupIndex] ?? []);
    }
    return reserved;
  };

  // 계획 조각이 없는 자리에서는 전체 항목을 한 페이지·한 그룹으로 봅니다.
  const slotOf = (
    fragment: GridFragment | undefined,
    planned: PlannedBand | undefined,
    fallbackItem: GridItem | undefined,
  ): FormulaSlot => {
    if (el.repeat === undefined) {
      return { item: undefined, reserved: undefined, outputPage: undefined, groupIndex: undefined };
    }
    const reserved: Record<string, unknown> = {
      '@all': [...realItems],
      '@page': fragment === undefined ? [...realItems] : itemsOf(fragment.pageItems),
      '@carried': fragment === undefined ? [] : itemsOf(fragment.carriedItems),
      '@group':
        planned?.groupIndex === undefined
          ? [...realItems]
          : itemsOf(gridPlan?.groups[planned.groupIndex]),
    };
    const item = planned?.itemIndex === undefined ? fallbackItem : realItems[planned.itemIndex];
    if (item !== undefined) reserved['@item'] = item;
    return {
      item,
      reserved,
      outputPage: fragment?.outputPage,
      groupIndex: planned?.groupIndex,
    };
  };

  const plannedOf = (fragment: GridFragment | undefined, band: GridBand | undefined) =>
    fragment?.bands.find((candidate) => candidate.band.id === band?.id);

  return {
    realItems,
    fragmentAt,
    plannedReserved,
    slotForBand: (fragment, band) => slotOf(fragment, plannedOf(fragment, band), items[0]),
    slotForItem: (itemIndex, band) => {
      const found = locate(gridPlan, itemIndex, band);
      // 계획이 있으면 `@item`은 계획이 정합니다 — 항목이 없는 행 구간에는 생기지 않습니다.
      return slotOf(found?.fragment, found?.planned, found === undefined ? realItems[itemIndex] : undefined);
    },
    itemChoices: () => {
      // 항목마다 계획을 훑지 않도록 항목 → 출력 페이지를 한 번에 모읍니다.
      const pageOf = new Map<number, number>();
      for (const fragment of gridPlan?.fragments ?? []) {
        for (const planned of fragment.bands) {
          if (planned.band.placement === 'item' && planned.itemIndex !== undefined) {
            pageOf.set(planned.itemIndex, fragment.outputPage);
          }
        }
      }
      return realItems.map((_item, index) => ({
        index,
        outputPage: pageOf.get(index),
        groupIndex: gridPlan?.groupOf[index],
      }));
    },
    availability: (slot) => {
      if (el.repeat === undefined) {
        return RESERVED_NAMES.map((name) => ({ name, usable: false, reason: 'not-repeat' as const }));
      }
      return RESERVED_NAMES.map((name) => {
        if (name === '@item' && slot.item === undefined) {
          return { name, usable: false, reason: 'no-item' as const };
        }
        if (name === '@group' && (gridPlan === undefined || gridPlan.groups.length === 0)) {
          return {
            name,
            usable: false,
            reason: (gridPlan === undefined ? 'no-plan' : 'no-group') as ReservedBlockReason,
          };
        }
        if ((name === '@page' || name === '@carried') && gridPlan === undefined) {
          return { name, usable: false, reason: 'no-plan' as const };
        }
        return { name, usable: true };
      });
    },
  };
}

/**
 * 항목이 놓인 계획 조각과 행 구간 인스턴스를 찾습니다.
 *
 * @param gridPlan - 그리드의 페이지 계획
 * @param itemIndex - 찾을 실제 항목 인덱스
 * @param band - 계산하는 자리의 행 구간. 항목 구간이 아니면 그 구간의 인스턴스를 우선합니다
 * @returns 항목이 놓인 조각과 인스턴스. 계획에 없으면 undefined
 */
function locate(
  gridPlan: GridPlan | undefined,
  itemIndex: number,
  band: GridBand | undefined,
): { fragment: GridFragment; planned: PlannedBand } | undefined {
  if (gridPlan === undefined) return undefined;
  for (const fragment of gridPlan.fragments) {
    const item = fragment.bands.find(
      (planned) => planned.band.placement === 'item' && planned.itemIndex === itemIndex,
    );
    if (item === undefined) continue;
    if (band === undefined || band.id === item.band.id) return { fragment, planned: item };
    const own = fragment.bands.find((planned) => planned.band.id === band.id);
    if (own === undefined) return { fragment, planned: item };
    // 항목 구간이 아닌 자리는 그 구간의 인스턴스를 그대로 쓰고 그룹만 고른 항목을 따릅니다.
    // `@item`은 인스턴스가 실제로 항목을 가리킬 때만 생깁니다.
    const planned: PlannedBand = { ...own };
    if (item.groupIndex === undefined) delete planned.groupIndex;
    else planned.groupIndex = item.groupIndex;
    return { fragment, planned };
  }
  return undefined;
}
