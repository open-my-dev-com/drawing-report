/**
 * 속성 패널에서 공통으로 사용하는 입력 도구.
 *
 * @remarks
 * 패널 렌더 모듈은 컴포넌트 전체가 아니라 이 도구 모음에만 의존한다.
 * 문구, 오류 표시, 리스트형 선택 상자와 팝오버·색 선택기 상태를 이 인터페이스로 제공한다.
 */

import type { TemplateResult } from 'lit';
import type { ColorPickerController } from '../controllers/color-picker.js';
import type { PopoverController } from '../controllers/popover.js';

import type { DesignerStrings } from '../../strings.js';

export type { DesignerStrings };

/** 리스트형 선택 상자에 넘길 설정 */
export interface ListSelectConfig {
  id: string;
  ariaLabel: string;
  value: string;
  options: { value: string; label: string; description?: string }[];
  onPick: (value: string) => void;
  className?: string;
  placeholder?: string;
}

/** 패널 렌더 모듈이 컴포넌트에서 받는 것 */
export interface PanelKit {
  /** 로케일에 맞는 문구 */
  readonly s: DesignerStrings;
  /**
   * 입력값을 되돌리고 오류를 표시한다.
   *
   * @param message - 표시할 문구 (없으면 기본 문구)
   * @param field - 오류를 붙일 항목 키
   */
  reject(message?: string, field?: string): void;
  /**
   * 항목에 붙일 오류 줄을 만든다.
   *
   * @param field - 항목 키
   * @returns 오류가 있으면 오류 줄, 없으면 아무것도 그리지 않는다
   */
  error(field: string): unknown;
  /**
   * 항목에 오류가 있는지 확인한다.
   *
   * @param field - 항목 키
   * @returns 오류가 있으면 true
   */
  hasError(field: string): boolean;
  /**
   * 리스트형 선택 상자를 그린다.
   *
   * @param config - 선택 상자 설정
   * @returns 트리거 버튼과 (열려 있으면) 목록
   */
  listSelect(config: ListSelectConfig): TemplateResult;
  /** 테두리·색 팝오버의 열림 상태 */
  readonly popovers: PopoverController;
  /** 색 선택기의 색조·채도·명도 */
  readonly picker: ColorPickerController;
  /**
   * 테두리·색 선택 메뉴를 버튼 아래에 열거나 닫는다.
   *
   * @param key - 메뉴를 구분할 키
   * @param event - 기준이 될 버튼에서 받은 이벤트
   */
  togglePropertyMenu(key: string, event: Event): void;
  /**
   * 선택한 요소의 색상 속성을 설정하거나 제거한다.
   *
   * @param key - 색상 속성 이름
   * @param value - 넣을 색. null이면 지운다
   */
  applyElementColor(key: string, value: string | null): void;
}
