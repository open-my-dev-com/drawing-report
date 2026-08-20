import '@omdc-slipkit/elements';
import { createElement, useEffect, useRef } from 'react';
import type {
  SlipViewer as SlipViewerElement,
  SlipDesigner as SlipDesignerElement,
  SlipForm as SlipFormElement,
} from '@omdc-slipkit/elements';
import type { IntegrityJwk, SlipFile, StorageAdapter } from '@omdc-slipkit/core';

type SlipFonts = SlipViewerElement['fonts'];
type SlipPresets = SlipDesignerElement['presets'];

/** SlipViewer 컴포넌트 props */
export interface SlipViewerProps {
  /** .slip JSON 문자열 */
  src: string;
  /**
   * UI 언어 ('ko' | 'en') — ADR-028.
   *
   * @defaultValue 한국어
   */
  locale?: string;
  /** PDF 렌더링에 쓸 사용자 폰트 (ADR-012) */
  fonts?: SlipFonts;
}

/**
 * React 19는 커스텀 엘리먼트를 완전 지원하므로(ADR-015 근거) 래퍼는 태그를 그대로 노출한다.
 * fonts 같은 객체 값은 React 19가 엘리먼트의 JS 프로퍼티로 전달한다.
 */
export function SlipViewer({ src, locale, fonts }: SlipViewerProps) {
  return createElement('slip-viewer', { src, locale, fonts });
}

/** SlipDesigner 컴포넌트 props */
export interface SlipDesignerProps {
  /** .slip JSON 문자열 (template 파일만) */
  src: string;
  /**
   * UI 언어 ('ko' | 'en') — ADR-028.
   *
   * @defaultValue 한국어
   */
  locale?: string;
  /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
  fonts?: SlipFonts;
  /** 툴바 프리셋 메뉴에 쓸 양식 목록 — 주면 동봉 프리셋 대신 쓴다 */
  presets?: SlipPresets;
  /** "내 양식" 저장·불러오기에 쓸 저장소 어댑터 (ADR-021) */
  storage?: StorageAdapter;
  /** 편집으로 양식이 바뀔 때마다 변경된 .slip 파일을 받는다 */
  onSlipChange?: (file: SlipFile) => void;
}

/**
 * `<slip-designer>` 래퍼. 커스텀 이벤트(slip-change)는 React가 선언적으로
 * 연결해 주지 않으므로 ref로 리스너를 붙였다 떼는 것까지만 담당한다 (ADR-003).
 */
export function SlipDesigner({
  src,
  locale,
  fonts,
  presets,
  storage,
  onSlipChange,
}: SlipDesignerProps) {
  const ref = useRef<SlipDesignerElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !onSlipChange) return;
    const handler = (event: Event) =>
      onSlipChange((event as CustomEvent<{ file: SlipFile }>).detail.file);
    element.addEventListener('slip-change', handler);
    return () => element.removeEventListener('slip-change', handler);
  }, [onSlipChange]);

  return createElement('slip-designer', { ref, src, locale, fonts, presets, storage });
}

/** SlipForm 컴포넌트 props */
export interface SlipFormProps {
  /** .slip JSON 문자열 (양식 또는 작성 중 전표) */
  src: string;
  /**
   * UI 언어 ('ko' | 'en') — ADR-028.
   *
   * @defaultValue 한국어
   */
  locale?: string;
  /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
  fonts?: SlipFonts;
  /** 발행 서명에 쓸 개인키 (JWK) — 없으면 해시만 기록한다 (SPEC §8.3) */
  signingKey?: IntegrityJwk;
  /** 값을 채울 때마다 작성 중 전표 파일을 받는다 */
  onSlipChange?: (file: SlipFile) => void;
  /** 발행이 끝나면 무결성 기록이 담긴 전표 파일을 받는다 */
  onSlipIssue?: (file: SlipFile) => void;
}

/**
 * `<slip-form>` 래퍼. 커스텀 이벤트(slip-change·slip-issue)를 ref로 연결했다
 * 떼는 것까지만 담당한다 (ADR-003 — 얇은 래퍼).
 */
export function SlipForm({
  src,
  locale,
  fonts,
  signingKey,
  onSlipChange,
  onSlipIssue,
}: SlipFormProps) {
  const ref = useRef<SlipFormElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handlers: [string, (event: Event) => void][] = [];
    if (onSlipChange) {
      handlers.push([
        'slip-change',
        (event) => onSlipChange((event as CustomEvent<{ file: SlipFile }>).detail.file),
      ]);
    }
    if (onSlipIssue) {
      handlers.push([
        'slip-issue',
        (event) => onSlipIssue((event as CustomEvent<{ file: SlipFile }>).detail.file),
      ]);
    }
    for (const [name, handler] of handlers) element.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of handlers) element.removeEventListener(name, handler);
    };
  }, [onSlipChange, onSlipIssue]);

  return createElement('slip-form', { ref, src, locale, fonts, signingKey });
}
