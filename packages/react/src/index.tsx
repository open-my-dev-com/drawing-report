import '@slipkit/elements';
import { createElement, useEffect, useRef } from 'react';
import type { SlipViewer as SlipViewerElement, SlipDesigner as SlipDesignerElement } from '@slipkit/elements';
import type { SlipFile } from '@slipkit/core';

type SlipFonts = SlipViewerElement['fonts'];

export interface SlipViewerProps {
  /** .slip JSON 문자열 */
  src: string;
  /** PDF 렌더링에 쓸 사용자 폰트 (ADR-012) */
  fonts?: SlipFonts;
}

/**
 * React 19는 커스텀 엘리먼트를 완전 지원하므로(ADR-015 근거) 래퍼는 태그를 그대로 노출한다.
 * fonts 같은 객체 값은 React 19가 엘리먼트의 JS 프로퍼티로 전달한다.
 */
export function SlipViewer({ src, fonts }: SlipViewerProps) {
  return createElement('slip-viewer', { src, fonts });
}

export interface SlipDesignerProps {
  /** .slip JSON 문자열 (template 파일만) */
  src: string;
  /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
  fonts?: SlipFonts;
  /** 편집으로 양식이 바뀔 때마다 변경된 .slip 파일을 받는다 */
  onSlipChange?: (file: SlipFile) => void;
}

/**
 * `<slip-designer>` 래퍼. 커스텀 이벤트(slip-change)는 React가 선언적으로
 * 연결해 주지 않으므로 ref로 리스너를 붙였다 떼는 것까지만 담당한다 (ADR-003).
 */
export function SlipDesigner({ src, fonts, onSlipChange }: SlipDesignerProps) {
  const ref = useRef<SlipDesignerElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !onSlipChange) return;
    const handler = (event: Event) =>
      onSlipChange((event as CustomEvent<{ file: SlipFile }>).detail.file);
    element.addEventListener('slip-change', handler);
    return () => element.removeEventListener('slip-change', handler);
  }, [onSlipChange]);

  return createElement('slip-designer', { ref, src, fonts });
}
