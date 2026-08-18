import '@slipkit/elements';
import { createElement } from 'react';

export interface SlipViewerProps {
  /** .slip JSON 문자열 */
  src: string;
}

/**
 * React 19는 커스텀 엘리먼트를 완전 지원하므로(ADR-015 근거) 래퍼는 태그를 그대로 노출한다.
 */
export function SlipViewer({ src }: SlipViewerProps) {
  return createElement('slip-viewer', { src });
}
