/**
 * 파라미터 목록과 사용처를 나타내는 공통 타입과 값 종류 선택지.
 *
 * @remarks
 * 사이드바, 속성 패널과 수식 모달이 같은 요약을 사용한다.
 */

import type { ParameterValueType } from '@omdc-slipkit/core';

/** 파라미터를 사용하는 요소의 위치 */
export interface ParameterUse {
  pageIndex: number;
  id: string;
  name: string;
  type: 'field' | 'grid' | 'image';
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
  /** 이 값을 쓰는 요소들 */
  uses: ParameterUse[];
  /** 파라미터 정의에 등록된 목록 하위 필드  */
  fields: ParameterFieldInfo[];
}

/**
 * 목록 파라미터의 하위 필드와 해당 필드를 사용하는 그리드 셀 위치.
 */
export interface ParameterFieldInfo {
  /** 항목 필드 물리명 — 수식에서 `목록파라미터.필드`로 사용한다 */
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
