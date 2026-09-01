/**
 * 저장된 수식·조건식 가운데 지금 값으로 계산되지 않는 것을 모읍니다.
 *
 * @remarks
 * 저장된 수식은 현재 값에서 계산에 실패할 수 있으므로 편집 화면에서 해당 위치를 알립니다.
 * 검사는 호스트의 공통 검사 함수를 사용하고, 이 모듈은 결과를 요소와 셀 단위로 집계합니다.
 */

import type { ConditionalFormatRule, GridElement, SlipPage } from '@omdc-slipkit/core';
import type { FormulaCheck } from './formula-check.js';
import type { FormulaTarget } from './formula-target.js';

/** 경고가 있는 요소와 그리드 셀 */
export interface FormulaWarnings {
  /** 경고가 있는 요소 id */
  readonly elements: ReadonlySet<string>;
  /** 그리드 id별로 경고가 있는 셀 자리 ({@link warningCellKey}) */
  readonly cells: ReadonlyMap<string, ReadonlySet<string>>;
}

/** 경고 집계에 필요한 것 */
export interface FormulaWarningInput {
  /** 검사할 양식 페이지 */
  page: SlipPage;
  /**
   * 저장된 수식 하나를 지금 값으로 검사합니다.
   *
   * @remarks
   * 반복 그리드 셀은 샘플 항목마다 결과가 다르므로 여러 결과를 돌려줄 수 있습니다.
   *
   * @param target - 검사할 자리
   * @param source - 저장된 수식·조건식
   * @param condition - 조건식인지
   * @returns 계산 문맥마다의 검사 결과
   */
  check(target: FormulaTarget, source: string, condition: boolean): readonly FormulaCheck[];
}

/** 경고가 있는 셀을 가리키는 키를 만듭니다. */
export function warningCellKey(row: number, column: number): string {
  return `${row},${column}`;
}

/** 경고 없음 */
export const NO_FORMULA_WARNINGS: FormulaWarnings = { elements: new Set(), cells: new Map() };

/**
 * 페이지에 저장된 수식·조건식을 모두 검사해 경고 대상을 모읍니다.
 *
 * @param input - 검사할 페이지와 검사 함수
 * @returns 경고가 있는 요소 id와 그리드별 셀 자리
 */
export function collectFormulaWarnings(input: FormulaWarningInput): FormulaWarnings {
  const elements = new Set<string>();
  const cells = new Map<string, Set<string>>();

  /** 한 자리를 검사해 계산되지 않으면 참을 돌려줍니다. */
  const fails = (target: FormulaTarget, source: string | undefined, condition: boolean): boolean => {
    if (source === undefined || source.trim() === '') return false;
    return input.check(target, source, condition)
      .some((check) => check.status === 'formula-error' || check.status === 'not-computable');
  };

  for (const element of input.page.elements) {
    const elementId = element.id;
    let warned = false;

    if (element.type === 'field' || element.type === 'barcode') {
      warned = fails({ kind: element.type, elementId }, element.formula, false);
    }
    rulesOf(element).forEach((rule, ruleIndex) => {
      const target: FormulaTarget = {
        kind: 'element-condition', elementId, elementType: element.type, ruleIndex,
      };
      warned = fails(target, rule.condition, true) || warned;
    });

    if (element.type === 'grid') {
      const marked = gridCellWarnings(element, fails);
      if (marked.size > 0) {
        cells.set(elementId, marked);
        // 셀 경고가 있으면 접어 둔 상태에서도 보이도록 부모 그리드에도 남깁니다.
        warned = true;
      }
    }

    if (warned) elements.add(elementId);
  }

  return { elements, cells };
}

/** 조건부 서식 규칙 목록. 규칙을 가지지 않는 종류면 빈 목록 */
function rulesOf(source: object): readonly ConditionalFormatRule[] {
  return 'conditionalFormats' in source
    ? ((source as { conditionalFormats?: ConditionalFormatRule[] }).conditionalFormats ?? [])
    : [];
}

/** 그리드 셀의 수식과 조건식을 검사해 경고가 있는 자리를 모읍니다. */
function gridCellWarnings(
  grid: GridElement,
  fails: (target: FormulaTarget, source: string | undefined, condition: boolean) => boolean,
): Set<string> {
  const marked = new Set<string>();
  for (const cell of grid.cells) {
    const { row, column } = cell;
    const elementId = grid.id;
    let warned = fails({ kind: 'cell', elementId, row, column }, cell.formula, false);
    rulesOf(cell).forEach((rule, ruleIndex) => {
      const target: FormulaTarget = { kind: 'cell-condition', elementId, row, column, ruleIndex };
      warned = fails(target, rule.condition, true) || warned;
    });
    if (warned) marked.add(warningCellKey(row, column));
  }
  return marked;
}

/** 요소에 경고가 있는지 확인합니다. */
export function hasElementWarning(warnings: FormulaWarnings, elementId: string): boolean {
  return warnings.elements.has(elementId);
}

/** 그리드 셀에 경고가 있는지 확인합니다. */
export function hasCellWarning(
  warnings: FormulaWarnings,
  elementId: string,
  row: number,
  column: number,
): boolean {
  return warnings.cells.get(elementId)?.has(warningCellKey(row, column)) === true;
}
