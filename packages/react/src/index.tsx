import '@omdc-slipkit/elements';
import { createElement, useEffect, useRef } from 'react';
import type {
  SlipViewer as SlipViewerElement,
  SlipDesigner as SlipDesignerElement,
  SlipForm as SlipFormElement,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';
import type { SlipFile, SlipKit, StorageAdapter } from '@omdc-slipkit/core';

type SlipPresets = SlipDesignerElement['presets'];

/** SlipViewer 컴포넌트 props */
export interface SlipViewerProps {
  /** `.slip` JSON 문자열. */
  src: string;
  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string;
  /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
  slipkit?: SlipKit;
}

/**
 * `<slip-viewer>`를 React 컴포넌트로 노출한다.
 * React 19는 객체 값을 커스텀 엘리먼트의 JavaScript 프로퍼티로 전달한다.
 */
export function SlipViewer({ src, locale, slipkit }: SlipViewerProps) {
  return createElement('slip-viewer', { src, locale, slipkit });
}

/** SlipDesigner 컴포넌트 props */
export interface SlipDesignerProps {
  /** 양식 파일을 담은 `.slip` JSON 문자열. */
  src: string;
  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string;
  /** 폰트·로케일·암호화 키 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
  slipkit?: SlipKit;
  /** 바코드 종류와 용지 목록을 제공하는 호스트 설정. */
  settings?: SlipDesignerSettings;
  /** 툴바에 표시할 양식 프리셋. 지정하면 동봉 프리셋을 대체한다. */
  presets?: SlipPresets;
  /** "내 양식" 저장과 불러오기에 사용할 저장소 어댑터. */
  storage?: StorageAdapter;
  /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 기본값은 2MB이다. */
  maxImageBytes?: number;
  /** 양식이 변경될 때 변경된 `.slip` 파일을 받는다. */
  onSlipChange?: (file: SlipFile) => void;
}

/**
 * `<slip-designer>`를 노출하고 `slip-change` 이벤트를 `onSlipChange`에 연결한다.
 */
export function SlipDesigner({
  src,
  locale,
  slipkit,
  settings,
  presets,
  storage,
  maxImageBytes,
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

  return createElement('slip-designer', {
    ref, src, locale, slipkit, settings, presets, storage, maxImageBytes,
  });
}

/** SlipForm 컴포넌트 props */
export interface SlipFormProps {
  /** 양식 또는 작성 중인 전표를 담은 `.slip` JSON 문자열. */
  src: string;
  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string;
  /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
  slipkit?: SlipKit;
  /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 기본값은 2MB이다. */
  maxImageBytes?: number;
  /** 값이 변경될 때 작성 중인 전표 파일을 받는다. */
  onSlipChange?: (file: SlipFile) => void;
  /** 전표가 발행되면 확정된 전표 파일을 받는다. */
  onSlipIssue?: (file: SlipFile) => void;
}

/**
 * `<slip-form>`을 노출하고 변경 및 발행 이벤트를 React 콜백에 연결한다.
 */
export function SlipForm({
  src,
  locale,
  slipkit,
  maxImageBytes,
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

  return createElement('slip-form', { ref, src, locale, slipkit, maxImageBytes });
}
