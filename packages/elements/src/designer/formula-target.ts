/**
 * 수식 모달이 편집하는 대상 — 식별 정보, 다시 찾기와 표시 중 확인.
 *
 * @remarks
 * 모달은 열려 있는 동안 선택 상태를 보지 않고 여기에 기록한 대상만 봅니다. 모달을 연 뒤에
 * 대상이 지워지거나 바뀌면 적용을 막기 위해 열 때의 내용을 함께 보관합니다.
 */

import type {
  ConditionalFormatRule,
  GridCell,
  GridElement,
  SlipElement,
  SlipPage,
} from '@omdc-slipkit/core';
import type { DesignerStrings } from '../strings.js';

/** 수식 모달이 편집하는 대상 */
export type FormulaTarget =
  /** 필드 요소의 값 수식 */
  | { kind: 'field'; elementId: string }
  /** 바코드 요소의 값 수식 */
  | { kind: 'barcode'; elementId: string }
  /** 그리드 셀의 값 수식 */
  | { kind: 'cell'; elementId: string; row: number; column: number }
  /** 요소 조건부 서식 규칙의 조건식 */
  | { kind: 'element-condition'; elementId: string; elementType: SlipElement['type']; ruleIndex: number }
  /** 그리드 셀 조건부 서식 규칙의 조건식 */
  | { kind: 'cell-condition'; elementId: string; row: number; column: number; ruleIndex: number };

/** 편집을 시작할 때의 대상 내용 — 모달이 열려 있는 동안 이것과 비교합니다 */
export interface FormulaOrigin {
  /** 열 때 저장되어 있던 수식·조건식 */
  formula: string | undefined;
  /** 조건부 서식 대상이면 열 때 복사한 규칙 전체 */
  rule?: ConditionalFormatRule;
}

/** 대상을 다시 찾은 결과 */
export interface ResolvedFormulaTarget {
  /** 대상 요소 */
  element: SlipElement;
  /** 그리드 셀 대상이면 그 셀이 속한 그리드 */
  grid?: GridElement;
  /** 그리드 셀 대상이면 그 셀 */
  cell?: GridCell;
  /** 조건부 서식 대상이면 그 규칙 */
  rule?: ConditionalFormatRule;
  /** 지금 저장되어 있는 수식·조건식 */
  formula: string | undefined;
}

/**
 * 대상이 조건부 서식 규칙의 조건식인지 판단합니다.
 *
 * @param target - 확인할 편집 대상
 * @returns 조건식이면 true
 */
export function isConditionTarget(target: FormulaTarget): boolean {
  return target.kind === 'element-condition' || target.kind === 'cell-condition';
}

/**
 * 편집 대상을 양식 페이지에서 다시 찾습니다.
 *
 * @param page - 대상이 있는 양식 페이지
 * @param target - 찾을 편집 대상
 * @returns 찾은 요소·셀·규칙과 지금 저장된 수식. 대상이 없거나 종류가 달라졌으면 null
 */
export function resolveFormulaTarget(
  page: SlipPage | undefined,
  target: FormulaTarget,
): ResolvedFormulaTarget | null {
  const element = page?.elements.find((candidate) => candidate.id === target.elementId);
  if (element === undefined) return null;

  if (target.kind === 'field' || target.kind === 'barcode') {
    if (element.type !== target.kind) return null;
    return { element, formula: element.formula };
  }

  if (target.kind === 'element-condition') {
    if (element.type !== target.elementType) return null;
    const rules = 'conditionalFormats' in element ? element.conditionalFormats : undefined;
    const rule = rules?.[target.ruleIndex];
    if (rule === undefined) return null;
    return { element, rule, formula: rule.condition };
  }

  if (element.type !== 'grid') return null;
  const cell = element.cells.find(
    (candidate) => candidate.row === target.row && candidate.column === target.column,
  );
  if (cell === undefined) return null;

  if (target.kind === 'cell') return { element, grid: element, cell, formula: cell.formula };

  const rule = cell.conditionalFormats?.[target.ruleIndex];
  if (rule === undefined) return null;
  return { element, grid: element, cell, rule, formula: rule.condition };
}

/**
 * 모달을 연 뒤에 편집 대상이 바뀌지 않았는지 확인합니다.
 *
 * @param page - 대상이 있는 양식 페이지
 * @param target - 확인할 편집 대상
 * @param origin - 모달을 열 때 기록한 대상 내용
 * @returns 대상이 그대로면 다시 찾은 결과, 지워졌거나 내용이 달라졌으면 null
 */
export function verifyFormulaTarget(
  page: SlipPage | undefined,
  target: FormulaTarget,
  origin: FormulaOrigin,
): ResolvedFormulaTarget | null {
  const found = resolveFormulaTarget(page, target);
  if (found === null) return null;
  if (found.formula !== origin.formula) return null;
  // 조건부 서식은 조건식만 같아도 다른 규칙일 수 있어 규칙 전체를 비교합니다.
  if (isConditionTarget(target) && !sameRule(found.rule, origin.rule)) return null;
  return found;
}

/** 조건부 서식 규칙 두 개가 모든 항목에서 같은지 비교합니다. */
function sameRule(a: ConditionalFormatRule | undefined, b: ConditionalFormatRule | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as keyof ConditionalFormatRule] !== b[key as keyof ConditionalFormatRule]) return false;
  }
  return true;
}

/**
 * 편집 대상의 자리를 한 줄로 설명합니다 — 요소 종류·이름, 셀 이름(없으면 행·열), 조건식이면 규칙 번호.
 *
 * @param s - 로케일에 맞는 문구
 * @param typeName - 요소 종류의 표시 이름을 돌려주는 함수
 * @param target - 설명할 편집 대상
 * @param found - 대상을 다시 찾은 결과
 * @returns 수식 모달과 캔버스 안내가 함께 쓰는 자리 설명
 */
export function describeFormulaTarget(
  s: DesignerStrings,
  typeName: (type: SlipElement['type']) => string,
  target: FormulaTarget,
  found: Pick<ResolvedFormulaTarget, 'element' | 'cell'>,
): string {
  const parts = [typeName(found.element.type), found.element.name];
  if (found.cell !== undefined) {
    parts.push(
      found.cell.name
        ?? s.formulaCellAt
          .replaceAll('{row}', String(found.cell.row + 1))
          .replaceAll('{column}', String(found.cell.column + 1)),
    );
  }
  if (target.kind === 'element-condition' || target.kind === 'cell-condition') {
    parts.push(s.formulaConditionAt.replaceAll('{index}', String(target.ruleIndex + 1)));
  } else {
    parts.push(s.formula);
  }
  return parts.join(' · ');
}
