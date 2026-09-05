// @vitest-environment node
// 저장된 수식 가운데 계산되지 않는 것을 요소와 셀로 모으는 집계
import { describe, expect, it } from 'vitest';
import type { SlipPage } from '@omdc-slipkit/core';
import {
  collectFormulaWarnings,
  hasCellWarning,
  hasElementWarning,
  warningCellKey,
} from '../../src/designer/formula-warning.js';
import type { FormulaCheck, FormulaCheckStatus } from '../../src/designer/formula-check.js';
import type { FormulaTarget } from '../../src/designer/formula-target.js';

/** 수식 문자열로 결과를 정하는 검사 함수 — 계산 자체는 core가 하므로 여기서는 흉내만 냅니다 */
function checkBy(bySource: Record<string, FormulaCheckStatus | FormulaCheckStatus[]>) {
  const calls: { target: FormulaTarget; source: string; condition: boolean }[] = [];
  const check = (target: FormulaTarget, source: string, condition: boolean): FormulaCheck[] => {
    calls.push({ target, source, condition });
    const found = bySource[source] ?? 'ok';
    const statuses = Array.isArray(found) ? found : [found];
    return statuses.map((status) => ({ status, applicable: true }));
  };
  return { check, calls };
}

function makePage(elements: unknown[]): SlipPage {
  return { elements } as unknown as SlipPage;
}

const FIELD = {
  type: 'field', id: 'f1', name: '합계', position: { x: 0, y: 0 }, width: 40, height: 8,
  formula: 'BAD',
};

const GRID = {
  type: 'grid', id: 'g1', name: '표', position: { x: 0, y: 0 },
  rows: [{ height: 8 }, { height: 8 }],
  columns: [{ width: 40 }, { width: 40 }],
  cells: [
    { row: 0, column: 0, content: '품명' },
    { row: 0, column: 1, formula: 'BAD' },
    { row: 1, column: 0, formula: 'OK' },
    { row: 1, column: 1, content: '값', conditionalFormats: [{ condition: 'BAD', fontColor: '#FF0000' }] },
  ],
};

describe('collectFormulaWarnings — 계산되지 않는 수식 모으기', () => {
  it('필드 수식이 계산되지 않으면 요소에 경고를 남긴다', () => {
    const { check } = checkBy({ BAD: 'formula-error' });
    const warnings = collectFormulaWarnings({ page: makePage([FIELD]), check });
    expect(hasElementWarning(warnings, 'f1')).toBe(true);
    expect(warnings.cells.size).toBe(0);
  });

  it('값이 없어 계산하지 못한 것도 경고 대상이다', () => {
    const { check } = checkBy({ BAD: 'not-computable' });
    expect(hasElementWarning(collectFormulaWarnings({ page: makePage([FIELD]), check }), 'f1'))
      .toBe(true);
  });

  it('파일에서 읽은 수식이 문법에 맞지 않으면 경고 대상이다 — 편집 중에는 저장이 막혀 생기지 않는 상태다', () => {
    const { check } = checkBy({ BAD: 'syntax-error' });
    expect(hasElementWarning(collectFormulaWarnings({ page: makePage([FIELD]), check }), 'f1'))
      .toBe(true);
  });

  it('정상 수식·빈 수식·논리값이 아닌 조건식·대상이 바뀐 상태는 경고 대상이 아니다', () => {
    for (const status of ['ok', 'not-boolean', 'target-changed'] as const) {
      const { check } = checkBy({ BAD: status });
      const warnings = collectFormulaWarnings({ page: makePage([FIELD]), check });
      expect(hasElementWarning(warnings, 'f1'), status).toBe(false);
    }
    // 빈 수식은 검사에 넣지 않습니다.
    const { check, calls } = checkBy({});
    collectFormulaWarnings({
      page: makePage([{ ...FIELD, formula: '   ' }]),
      check,
    });
    expect(calls).toHaveLength(0);
  });

  it('요소 조건부 서식의 조건식도 검사한다', () => {
    const { check, calls } = checkBy({ BAD: 'formula-error' });
    const element = {
      type: 'text', id: 't1', name: '제목', position: { x: 0, y: 0 }, width: 40, height: 8,
      content: '제목', conditionalFormats: [{ condition: 'BAD', fontColor: '#FF0000' }],
    };
    const warnings = collectFormulaWarnings({ page: makePage([element]), check });
    expect(hasElementWarning(warnings, 't1')).toBe(true);
    expect(calls[0]!.condition).toBe(true);
    expect(calls[0]!.target).toEqual({
      kind: 'element-condition', elementId: 't1', elementType: 'text', ruleIndex: 0,
    });
  });

  it('그리드 셀의 수식과 조건식을 각각 셀 자리로 모으고 부모 그리드에도 남긴다', () => {
    const { check } = checkBy({ BAD: 'formula-error' });
    const warnings = collectFormulaWarnings({ page: makePage([GRID]), check });

    expect(hasCellWarning(warnings, 'g1', 0, 1)).toBe(true);
    expect(hasCellWarning(warnings, 'g1', 1, 1)).toBe(true);
    expect(hasCellWarning(warnings, 'g1', 1, 0)).toBe(false);
    // 셀 경고가 있으면 접어 둔 상태에서도 보이도록 부모 그리드에 남깁니다.
    expect(hasElementWarning(warnings, 'g1')).toBe(true);
  });

  it('한 자리에 실패한 식이 여럿이어도 한 번만 넣는다', () => {
    const { check } = checkBy({ BAD: 'formula-error' });
    const cell = {
      row: 0, column: 0, formula: 'BAD',
      conditionalFormats: [{ condition: 'BAD', fontColor: '#FF0000' }, { condition: 'BAD', bold: true }],
    };
    const warnings = collectFormulaWarnings({
      page: makePage([{ ...GRID, cells: [cell] }]),
      check,
    });
    expect(warnings.cells.get('g1')).toEqual(new Set([warningCellKey(0, 0)]));
    expect(warnings.elements).toEqual(new Set(['g1']));
  });

  it('반복 그리드는 샘플 항목 중 하나만 실패해도 경고를 남긴다', () => {
    const { check } = checkBy({ BAD: ['ok', 'ok', 'not-computable'] });
    const warnings = collectFormulaWarnings({
      page: makePage([{ ...GRID, cells: [{ row: 0, column: 0, formula: 'BAD' }] }]),
      check,
    });
    expect(hasCellWarning(warnings, 'g1', 0, 0)).toBe(true);
  });

  it('모든 항목이 계산되면 경고가 없다', () => {
    const { check } = checkBy({ BAD: ['ok', 'ok'] });
    const warnings = collectFormulaWarnings({
      page: makePage([{ ...GRID, cells: [{ row: 0, column: 0, formula: 'BAD' }] }]),
      check,
    });
    expect(warnings.elements.size).toBe(0);
    expect(warnings.cells.size).toBe(0);
  });
});
