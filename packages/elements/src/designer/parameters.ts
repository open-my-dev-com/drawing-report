/**
 * 파라미터 목록과 사용처를 나타내는 공통 타입과 값 종류 선택지.
 *
 * @remarks
 * 사이드바, 속성 패널과 수식 모달이 같은 요약을 사용합니다.
 */

import {
  RESERVED_REF_NAMES,
  renameFormulaReferences,
  type ParameterValueType,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';
import { inItemBand, itemBandOf } from './grid-model.js';
import { hasOwn, readOwn, renameOwn } from './own-map.js';

/** 파라미터를 사용하는 요소의 위치 */
export interface ParameterUse {
  pageIndex: number;
  id: string;
  name: string;
  type: 'field' | 'grid' | 'image' | 'barcode';
}

/** 파라미터 정의와 사용 위치를 합친 사이드바 항목 */
export interface ParameterInfo {
  /** 전표 값에서 사용하는 키 */
  key: string;
  /** 화면에 표시할 이름 */
  label: string;
  /** 파라미터 정의에 지정된 레이블 */
  rawLabel: string | undefined;
  /** 파라미터 정의에 지정된 값 종류 */
  valueType: ParameterValueType | undefined;
  /** 파라미터 정의에 등록되어 있는지 여부 */
  defined: boolean;
  /** 이 값을 사용하는 요소들 */
  uses: ParameterUse[];
  /** 파라미터 정의에 등록된 목록 하위 필드  */
  fields: ParameterFieldInfo[];
}

/**
 * 목록 파라미터의 하위 필드와 해당 필드를 사용하는 그리드 셀 위치.
 */
export interface ParameterFieldInfo {
  /** 항목 필드 물리명 — 수식에서 `목록파라미터.필드`로 사용합니다 */
  key: string;
  /** 화면에 표시할 이름 — 논리명이 없으면 물리명 */
  title: string;
  /** 정의부에 적힌 논리명 (없으면 undefined) */
  rawLabel: string | undefined;
  /** 값 종류 */
  valueType: ParameterValueType | undefined;
  /** 이 필드를 읽는 그리드 셀의 자리 (없으면 undefined) */
  at: { pageIndex: number; gridId: string; row: number; column: number } | undefined;
}

export const BINDING_VALUE_TYPES: readonly { value: string; stringKey: 'valueTypeUnset' | 'valueTypeText' | 'valueTypeNumber' | 'valueTypeDate' | 'valueTypeBoolean' | 'valueTypeImage' | 'valueTypeList' }[] = [
  { value: '', stringKey: 'valueTypeUnset' },
  { value: 'text', stringKey: 'valueTypeText' },
  { value: 'number', stringKey: 'valueTypeNumber' },
  { value: 'date', stringKey: 'valueTypeDate' },
  { value: 'boolean', stringKey: 'valueTypeBoolean' },
  { value: 'image', stringKey: 'valueTypeImage' },
  { value: 'list', stringKey: 'valueTypeList' },
];

/** 목록 중첩을 제외한 하위 필드의 값 종류 선택지  */
export const BINDING_FIELD_VALUE_TYPES = BINDING_VALUE_TYPES.filter((t) => t.value !== 'list');

/** 목록 하위 필드를 읽는 그리드 셀의 자리 */
export type ParameterFieldAt = NonNullable<ParameterFieldInfo['at']>;

/** 양식 전체에서 모은 파라미터 사용 위치 */
export interface ParameterUsage {
  /** 최상위 파라미터 키별 사용 요소 (페이지·요소 순) */
  uses: Map<string, ParameterUse[]>;
  /** 목록 파라미터 키 → 하위 필드 키 → 그 필드를 처음 읽는 셀 자리 */
  fieldAt: Map<string, Map<string, ParameterFieldAt>>;
}

/**
 * 필드·그리드·이미지·바코드 요소가 참조하는 최상위 파라미터를 모읍니다.
 *
 * @remarks
 * 항목 구간 안의 셀 파라미터는 목록 항목의 하위 필드이므로 최상위 키에 넣지 않고
 * `fieldAt`에 셀 자리로 기록합니다. 사이드바 목록, 키 변경과 정의 삭제가 같은 결과를 씁니다.
 *
 * @param file - 양식 파일
 * @returns 키별 사용 요소와 하위 필드의 셀 자리
 */
export function collectParameterUses(file: SlipTemplateFile): ParameterUsage {
  const uses = new Map<string, ParameterUse[]>();
  const fieldAt = new Map<string, Map<string, ParameterFieldAt>>();
  const addUse = (key: string, use: ParameterUse): void => {
    const list = uses.get(key) ?? [];
    list.push(use);
    uses.set(key, list);
  };

  file.template.pages.forEach((page, pageIndex) => {
    for (const el of page.elements) {
      const use: ParameterUse = { pageIndex, id: el.id, name: el.name, type: el.type as ParameterUse['type'] };
      if (el.type === 'grid') {
        const itemBand = el.repeat === undefined ? undefined : itemBandOf(el);
        if (el.repeat && itemBand) {
          const listKey = el.repeat.parameter;
          const at = fieldAt.get(listKey) ?? new Map<string, ParameterFieldAt>();
          const band = el.cells
            .filter((c) => c.row >= itemBand.fromRow && c.row <= itemBand.toRow && c.parameter !== undefined)
            .sort((a, b) => a.column - b.column || a.row - b.row);
          for (const cell of band) {
            const key = cell.parameter as string;
            if (!at.has(key)) at.set(key, { pageIndex, gridId: el.id, row: cell.row, column: cell.column });
          }
          fieldAt.set(listKey, at);
        }
        const keys = new Set<string>();
        if (el.repeat) keys.add(el.repeat.parameter);
        for (const cell of el.cells) {
          if (cell.parameter !== undefined && !inItemBand(el, cell.row)) keys.add(cell.parameter);
        }
        for (const key of keys) addUse(key, use);
        continue;
      }
      if ((el.type === 'field' || el.type === 'image' || el.type === 'barcode') && el.parameter !== undefined) {
        addUse(el.parameter, use);
      }
    }
  });
  return { uses, fieldAt };
}

/**
 * 한 파라미터를 사용하는 요소를 찾습니다.
 *
 * @param file - 양식 파일
 * @param key - 파라미터 물리명
 * @returns 사용 요소 목록. 없으면 빈 배열
 */
export function parameterUsesOf(file: SlipTemplateFile, key: string): ParameterUse[] {
  return collectParameterUses(file).uses.get(key) ?? [];
}

/** 수식·조건식 문자열을 고쳐 쓰는 함수. 바꿀 것이 없으면 입력을 그대로 돌려줍니다 */
type FormulaRewrite = (source: string) => string;

/** 조건부 서식 규칙 목록을 가진 것 */
interface HasConditions {
  conditionalFormats?: { condition: string }[] | undefined;
}

/** 조건부 서식 규칙의 조건식을 모두 고쳐 씁니다. */
function rewriteConditions(owner: HasConditions, rewrite: FormulaRewrite): void {
  for (const rule of owner.conditionalFormats ?? []) rule.condition = rewrite(rule.condition);
}

/**
 * 파싱할 수 없는 수식은 건드리지 않는 고쳐 쓰기 함수를 만듭니다.
 *
 * @param from - 바꿀 참조 경로의 앞부분
 * @param to - 새 경로
 * @param options - `from`·`to`의 첫 단계가 그리드 예약 참조 이름이면 `reservedRoot`를 지정합니다
 * @returns 참조 이름을 바꾸되 문법 오류가 있는 수식은 그대로 돌려주는 함수
 */
function renamer(
  from: readonly string[],
  to: readonly string[],
  options?: { reservedRoot?: boolean },
): FormulaRewrite {
  return (source) => {
    try {
      return renameFormulaReferences(source, from, to, options);
    } catch {
      // 문법이 깨진 수식은 참조를 찾을 수 없으므로 그대로 둡니다.
      return source;
    }
  };
}

/**
 * 요소 하나가 가진 수식·조건식을 모두 고쳐 씁니다.
 *
 * @param el - 요소
 * @param rewrite - 요소의 수식·조건식에 적용할 함수
 * @param cellRewrite - 그리드 셀에 적용할 함수. 셀마다 다르게 고칠 때 넘기며, 없으면 `rewrite`
 */
function rewriteElementFormulas(
  el: SlipTemplateFile['template']['pages'][number]['elements'][number],
  rewrite: FormulaRewrite,
  cellRewrite?: (cell: { row: number; column: number }) => FormulaRewrite,
): void {
  if (el.type === 'field' || el.type === 'barcode') {
    if (el.formula !== undefined) el.formula = rewrite(el.formula);
  }
  if (el.type === 'text' || el.type === 'field') rewriteConditions(el, rewrite);
  if (el.type === 'grid') {
    for (const cell of el.cells) {
      const forCell = cellRewrite === undefined ? rewrite : cellRewrite(cell);
      if (cell.formula !== undefined) cell.formula = forCell(cell.formula);
      rewriteConditions(cell, forCell);
    }
  }
}

/**
 * 최상위 파라미터 키를 바꾸고, 그 키를 참조하는 모든 요소·수식과 샘플 값을 함께 바꿉니다.
 *
 * @remarks
 * 정의부, 필드·이미지·바코드의 `parameter`, 그리드의 반복 파라미터와 항목 구간 밖 셀,
 * 모든 수식·조건식의 참조, `sampleValues`의 키를 한 번에 바꿉니다. 항목 구간 안의 셀
 * 파라미터는 하위 필드라 건드리지 않습니다. 정의가 없던 키는 새 키로 정의를 만듭니다.
 * 문법 오류가 있어 파싱할 수 없는 수식은 그대로 둡니다.
 *
 * @param file - 수정할 양식 파일
 * @param key - 현재 물리명
 * @param next - 새 물리명
 */
export function renameParameterReferences(file: SlipTemplateFile, key: string, next: string): void {
  const defs = file.template.parameters ?? [];
  const def = defs.find((b) => b.key === key);
  if (def) def.key = next;
  else defs.push({ key: next });
  file.template.parameters = defs;
  const rewrite = renamer([key], [next]);
  for (const page of file.template.pages) {
    for (const el of page.elements) {
      if ((el.type === 'field' || el.type === 'image' || el.type === 'barcode') && el.parameter === key) {
        el.parameter = next;
      }
      if (el.type === 'grid') {
        if (el.repeat?.parameter === key) el.repeat.parameter = next;
        for (const cell of el.cells) {
          if (!inItemBand(el, cell.row) && cell.parameter === key) cell.parameter = next;
        }
      }
      rewriteElementFormulas(el, rewrite);
    }
  }
  const samples = file.template.sampleValues;
  if (samples && hasOwn(samples, key)) {
    file.template.sampleValues = renameOwn(samples, key, next) as never;
  }
}

/**
 * 목록 파라미터의 하위 필드 키를 바꾸고, 그 필드를 참조하는 셀·수식·그룹 설정과 샘플 항목을
 * 함께 바꿉니다.
 *
 * @remarks
 * 정의부의 필드 키, 그 목록을 반복하는 그리드의 항목 구간 셀 `parameter`와 `groupBy`,
 * 양식 전체 수식의 `목록.필드` 참조, 그 그리드 안 수식의 `@item.필드` 같은 예약 참조 뒤
 * 필드와 항목 구간 셀의 필드 이름 참조, `sampleValues` 목록 항목의 키를 한 번에 바꿉니다.
 * 샘플 항목의 다른 키와 순서는 그대로 둡니다. 문법 오류가 있어 파싱할 수 없는 수식은
 * 그대로 둡니다.
 *
 * @param file - 수정할 양식 파일
 * @param listKey - 목록 파라미터 물리명
 * @param key - 현재 필드 키
 * @param next - 새 필드 키
 */
export function renameParameterFieldReferences(
  file: SlipTemplateFile,
  listKey: string,
  key: string,
  next: string,
): void {
  const def = (file.template.parameters ?? []).find((b) => b.key === listKey);
  const field = def?.fields?.find((x) => x.key === key);
  if (field) field.key = next;

  const byListPath = renamer([listKey, key], [listKey, next]);
  // 그 목록을 반복하는 그리드 안에서는 예약 참조 뒤의 필드도 같은 하위 필드입니다.
  const byReserved = RESERVED_REF_NAMES.map((name) =>
    renamer([name, key], [name, next], { reservedRoot: true }));
  const byBareField = renamer([key], [next]);
  const inRepeatGrid: FormulaRewrite = (source) =>
    byReserved.reduce((text, rename) => rename(text), byListPath(source));

  for (const page of file.template.pages) {
    for (const el of page.elements) {
      if (el.type !== 'grid' || el.repeat?.parameter !== listKey) {
        rewriteElementFormulas(el, byListPath);
        continue;
      }
      for (const cell of el.cells) {
        if (inItemBand(el, cell.row) && cell.parameter === key) cell.parameter = next;
      }
      if (el.repeat.groupBy !== undefined) {
        el.repeat.groupBy = el.repeat.groupBy.map((name) => (name === key ? next : name));
      }
      // 항목 구간 셀은 필드 이름만 적어도 현재 항목의 값을 읽으므로 그 참조도 바꿉니다.
      rewriteElementFormulas(el, inRepeatGrid, (cell) =>
        inItemBand(el, cell.row) ? (source) => byBareField(inRepeatGrid(source)) : inRepeatGrid);
    }
  }

  renameSampleFieldKey(file, listKey, key, next);
}

/**
 * 목록 파라미터의 하위 필드 키를 바꿀 때 샘플 행의 같은 키를 함께 옮깁니다.
 *
 * @remarks
 * 행마다 키 순서를 유지한 채 옮기고, 그 키가 없는 행과 객체가 아닌 항목은 그대로 둡니다.
 *
 * @param file - 수정할 양식 파일
 * @param listKey - 목록 파라미터 물리명
 * @param key - 현재 하위 필드 키
 * @param next - 새 하위 필드 키
 */
export function renameSampleFieldKey(
  file: SlipTemplateFile,
  listKey: string,
  key: string,
  next: string,
): void {
  const rows = readOwn(file.template.sampleValues, listKey);
  if (!Array.isArray(rows)) return;
  rows.forEach((row: unknown, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return;
    if (!hasOwn(row as Record<string, unknown>, key)) return;
    rows[index] = renameOwn(row as Record<string, unknown>, key, next);
  });
}

/**
 * 파라미터 정의가 없으면 만들고, 있으면 비어 있는 값 종류만 채웁니다.
 *
 * @param file - 수정할 양식 파일
 * @param key - 파라미터 물리명
 * @param valueType - 등록할 값 종류. 기존 정의에 종류가 없을 때만 적용합니다
 * @param label - 새로 만들 때 붙일 논리명. 기존 정의의 논리명은 바꾸지 않습니다
 */
export function ensureParameterDef(
  file: SlipTemplateFile,
  key: string,
  valueType?: ParameterValueType,
  label?: string,
): void {
  if (!key) return;
  const defs = file.template.parameters ?? [];
  const found = defs.find((b) => b.key === key);
  if (found) {
    if (valueType !== undefined && found.valueType === undefined) found.valueType = valueType;
    return;
  }
  defs.push({
    key,
    ...(label === undefined ? {} : { label }),
    ...(valueType === undefined ? {} : { valueType }),
  });
  file.template.parameters = defs;
}
