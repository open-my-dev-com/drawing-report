/**
 * 반복 그리드 수식에 샘플 항목과 예약 참조(`@item`·`@group`·`@page`·`@all`·`@carried`)를 제공합니다.
 *
 * @remarks
 * 캔버스, 조건식 인라인 검사와 수식 모달이 모두 이 모듈을 거쳐 같은 셀의 예약 참조 값을
 * 일관되게 계산합니다.
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
import { readOwn } from './own-map.js';

/** 예약 참조 값을 제공할 수 없는 이유입니다. */
export type ReservedBlockReason =
  /** 반복 설정이 없는 그리드입니다. */
  | 'not-repeat'
  /** 지금 계산하는 자리에 항목이 없습니다. */
  | 'no-item'
  /** 그리드에 그룹 설정이 없습니다. */
  | 'no-group'
  /** 출력 페이지 계획을 계산하지 못합니다. */
  | 'no-plan';

/** 예약 참조 하나의 사용 가능 여부를 나타냅니다. */
export interface ReservedAvailability {
  name: string;
  /** 현재 계산 문맥에서 값을 제공할 수 있는지를 나타냅니다. */
  usable: boolean;
  /** 제공할 수 없을 때의 이유입니다. */
  reason?: ReservedBlockReason;
}

/** 셀과 항목 한 쌍의 계산 문맥입니다. */
interface FormulaSlot {
  /** 항목 구간에서 필드 이름으로 참조할 현재 항목입니다. */
  item: GridItem | undefined;
  /** 수식 평가에 전달할 예약 참조입니다. 반복 설정이 없으면 `undefined`입니다. */
  reserved: Record<string, unknown> | undefined;
  /** 이 자리가 놓인 출력 페이지 (계획이 없으면 undefined)입니다. */
  outputPage: number | undefined;
  /** 이 자리가 속한 그룹 (그룹 설정이 없으면 undefined)입니다. */
  groupIndex: number | undefined;
}

/** 샘플 항목 선택 목록의 항목 하나입니다. */
export interface ItemChoice {
  /** `maxItems`를 적용한 실제 항목 인덱스이며 0부터 시작합니다. */
  index: number;
  /** 계획상 이 항목이 놓이는 출력 페이지입니다. 0부터 시작하며 계획이 없으면 `undefined`입니다. */
  outputPage: number | undefined;
  /** 이 항목이 속한 그룹 (그룹 설정이 없으면 undefined)입니다. */
  groupIndex: number | undefined;
}

/** 그리드 하나의 계산 문맥입니다. */
export interface GridFormulaContext {
  /** `maxItems`를 적용한 실제 항목입니다. */
  readonly realItems: readonly GridItem[];
  /** 해당 출력 페이지의 계획 조각을 찾습니다. */
  fragmentAt(outputPage: number): GridFragment | undefined;
  /** 계획된 행 구간 인스턴스 하나의 예약 참조를 만듭니다. */
  plannedReserved(fragment: GridFragment, planned: PlannedBand): Record<string, unknown>;
  /**
   * 원본 행 구조를 표시할 때 행 구간 하나가 쓸 계산 문맥을 만듭니다.
   * 샘플 항목을 고르지 않은 자리에서도 씁니다.
   */
  slotForBand(fragment: GridFragment | undefined, band: GridBand | undefined): FormulaSlot;
  /** 특정 샘플 항목을 골랐을 때의 계산 문맥을 만듭니다. */
  slotForItem(itemIndex: number, band: GridBand | undefined): FormulaSlot;
  /** 고를 수 있는 샘플 항목 수입니다. */
  readonly itemCount: number;
  /** 샘플 항목 하나가 놓이는 출력 페이지와 그룹을 찾습니다. */
  choiceAt(itemIndex: number): ItemChoice | undefined;
  /** 계산 문맥이 각 예약 참조 값을 제공하는지 판단합니다. */
  availability(slot: FormulaSlot): ReservedAvailability[];
}

/** 수식이 쓸 수 있는 예약 참조 이름 (표시 순서)입니다. */
const RESERVED_NAMES = ['@item', '@group', '@page', '@all', '@carried'] as const;

/**
 * 양식의 샘플 값에서 반복 그리드가 사용할 항목 배열을 가져옵니다.
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
  const sample = readOwn(sampleValues, el.repeat.parameter);
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
 * @returns 예약 참조와 샘플 항목을 포함한 계산 문맥
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
   * 예약 참조를 만듭니다. 계획에서 제공하지 않는 값은 넣지 않습니다. 없는 값을 임의로 채우면
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
      reserved['@carried'] = realItems.slice(0, fragment.carriedCount);
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

  /** 계산 문맥이 예약 참조 값을 제공하지 못하는 이유를 고릅니다. */
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
    slotForBand: (fragment, band) => slotOf(
      fragment,
      plannedOf(fragment, band),
      // 계획이 없을 때 항목 구간만 첫 항목으로 미리 보여 줍니다. 다른 구간까지 채우면
      // 캔버스에서는 계산되고 PDF에서는 계산되지 않는 수식이 생깁니다.
      band?.placement === 'item' ? items[0] : undefined,
    ),
    slotForItem: (itemIndex, band) => {
      const found = locate(gridPlan, itemIndex, band);
      // 계획이 없으면 페이지와 그룹 값을 만들지 않고 선택한 항목만 제공합니다.
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
 * @param band - 계산하는 자리의 행 구간입니다. 생략하면 항목 구간 인스턴스를 반환합니다.
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
    // 그룹 구간은 한 조각에 그룹마다 하나씩 있으므로 선택한 항목과 같은 그룹의 인스턴스를 찾습니다.
    // 그룹과 무관한 구간(헤더 등)은 그룹 번호가 없는 인스턴스를 씁니다.
    const planned =
      fragment.bands.find((candidate) => candidate.band.id === band.id && candidate.groupIndex === item.groupIndex)
      ?? fragment.bands.find((candidate) => candidate.band.id === band.id && candidate.groupIndex === undefined);
    return { fragment, planned };
  }
  return undefined;
}
