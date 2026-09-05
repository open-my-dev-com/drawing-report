import '@omdc-slipkit/elements';
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactElement,
  type Ref,
  type RefCallback,
  type RefObject,
} from 'react';
import type {
  SlipViewer as SlipViewerElement,
  SlipDesigner as SlipDesignerElement,
  SlipForm as SlipFormElement,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';
import type {
  SlipKit,
  SlipTemplateFile,
  SlipVoucherFile,
  StorageAdapter,
} from '@omdc-slipkit/core';

type SlipPresets = SlipDesignerElement['presets'];

/**
 * 래퍼가 `slip-*` 요소에 그대로 넘기는 표준 HTML 속성과 DOM 이벤트 props.
 *
 * @remarks
 * `className`·`style`·`id`·`title`·`role`·`tabIndex`·`aria-*`·`data-*`와 `onClick`·`onKeyDown` 같은
 * React DOM 이벤트를 모두 받는다. 요소가 자체 shadow DOM을 그리므로 `children`과
 * `dangerouslySetInnerHTML`은 지원하지 않는다.
 */
type SlipHostAttributes = Omit<HTMLAttributes<HTMLElement>, 'children' | 'dangerouslySetInnerHTML'>;

/**
 * 사용자가 넘긴 `ref`에 요소를 넣거나 해제한다.
 *
 * @returns 콜백 ref가 정리 함수를 돌려주면 그 함수, 아니면 `undefined`
 */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null): (() => void) | undefined {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : undefined;
  }
  if (ref) ref.current = value;
  return undefined;
}

/**
 * 래퍼 내부 ref와 사용자가 넘긴 `ref`를 하나의 콜백 ref로 합친다.
 *
 * @remarks
 * 요소가 붙으면 두 ref에 모두 요소를 넣고, 떨어지면 둘 다 해제한다. 사용자 콜백 ref가
 * 정리 함수를 돌려주면 `null` 호출 대신 그 함수를 부른다. 사용자 ref가 바뀌면 콜백의
 * 동일성도 바뀌어 React가 옛 ref를 해제하고 새 ref에 요소를 다시 넣는다.
 */
function useMergedRef<T>(internal: RefObject<T | null>, external: Ref<T> | undefined): RefCallback<T> {
  return useCallback<RefCallback<T>>((node) => {
    internal.current = node;
    // 정리 함수를 돌려주므로 React 19는 요소가 떨어질 때 이 콜백을 `null`로 다시 부르지 않는다.
    const cleanup = assignRef(external, node);
    return () => {
      internal.current = null;
      if (cleanup) cleanup();
      else assignRef(external, null);
    };
  }, [internal, external]);
}

/**
 * 요소에 넘길 최종 props를 만든다. 전용 값(`ref`·`src`)을 나머지 props 뒤에 두어 항상 우선하게 한다.
 */
function hostProps<T extends HTMLElement>(rest: SlipHostAttributes, ref: RefCallback<T>, src: string) {
  const { className, ...attributes } = rest;
  // className은 `class` 속성으로 넘긴다. React는 커스텀 엘리먼트의 className을 프로퍼티로 쓰는데,
  // prop을 제거하면 undefined가 대입되어 브라우저에 class="undefined"가 남기 때문이다.
  return { ...attributes, class: className, ref, src };
}

/**
 * 선택적 설정을 웹 컴포넌트의 JavaScript 프로퍼티로 쓴다.
 *
 * @remarks
 * 값이 `undefined`인 설정은 요소에 쓰지 않고, 처음 마운트할 때 읽어 둔 요소의 기본값으로
 * 되돌린다. 그래서 `maxImageBytes`처럼 요소에 기본값이 있는 설정을 생략하거나 나중에
 * 제거해도 요소 기본값(2MB 등)이 유지된다. 프로퍼티는 자식이 그려지기 전(layout effect)에
 * 써서 첫 렌더부터 설정이 반영되게 한다.
 */
function useElementProps(ref: RefObject<HTMLElement | null>, props: Record<string, unknown>): void {
  const defaults = useRef<Record<string, unknown> | null>(null);
  const keys = Object.keys(props);
  useLayoutEffect(() => {
    const element = ref.current as unknown as Record<string, unknown> | null;
    if (!element) return;
    defaults.current ??= Object.fromEntries(keys.map((key) => [key, element[key]]));
    for (const key of keys) {
      const value = props[key];
      element[key] = value === undefined ? defaults.current[key] : value;
    }
    // 설정 항목 수는 컴포넌트마다 고정이므로 값 목록을 그대로 의존성으로 쓴다.
  }, keys.map((key) => props[key]));
}

/**
 * 웹 컴포넌트의 CustomEvent를 React 콜백에 연결한다. 콜백이 바뀌면 이전 콜백은 해제한다.
 */
function useSlipEvent<F>(
  ref: RefObject<HTMLElement | null>,
  name: string,
  handler: ((file: F) => void) | undefined,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !handler) return;
    const listener = (event: Event) => handler((event as CustomEvent<{ file: F }>).detail.file);
    element.addEventListener(name, listener);
    return () => element.removeEventListener(name, listener);
  }, [ref, name, handler]);
}

/**
 * SlipViewer 컴포넌트 props.
 *
 * @remarks
 * 아래 항목 외의 표준 HTML 속성(`className`·`style`·`id`·`title`·`role`·`tabIndex`·`aria-*`·`data-*`)과
 * DOM 이벤트(`onClick`·`onKeyDown` 등)는 `<slip-viewer>` 요소에 그대로 전달된다.
 * `children`과 `dangerouslySetInnerHTML`은 지원하지 않는다.
 */
export interface SlipViewerProps extends SlipHostAttributes {
  /** 실제 `<slip-viewer>` 요소를 받는 ref. 객체 ref와 콜백 ref를 모두 쓸 수 있다. */
  ref?: Ref<SlipViewerElement> | undefined;
  /** `.slip` JSON 문자열. */
  src: string;
  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string | undefined;
  /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
  slipkit?: SlipKit | undefined;
}

/**
 * `<slip-viewer>`를 React 컴포넌트로 노출한다.
 * 생략한 설정은 요소에 쓰지 않아 요소의 기본 동작을 유지한다.
 *
 * @remarks
 * `ref`로 실제 `<slip-viewer>` 요소를 받을 수 있고, 표준 HTML 속성과 DOM 이벤트 props는
 * 요소에 그대로 전달된다. `src`는 전달된 나머지 props보다 항상 우선한다.
 *
 * @param props - 컴포넌트 props
 * @returns `<slip-viewer>` React 요소
 */
export function SlipViewer({ ref: externalRef, src, locale, slipkit, ...rest }: SlipViewerProps): ReactElement {
  const ref = useRef<SlipViewerElement>(null);
  const mergedRef = useMergedRef(ref, externalRef);
  useElementProps(ref, { locale, slipkit });
  return createElement('slip-viewer', hostProps(rest, mergedRef, src));
}

/**
 * SlipDesigner 컴포넌트 props.
 *
 * @remarks
 * 아래 항목 외의 표준 HTML 속성(`className`·`style`·`id`·`title`·`role`·`tabIndex`·`aria-*`·`data-*`)과
 * DOM 이벤트(`onClick`·`onKeyDown` 등)는 `<slip-designer>` 요소에 그대로 전달된다.
 * `children`과 `dangerouslySetInnerHTML`은 지원하지 않는다.
 */
export interface SlipDesignerProps extends SlipHostAttributes {
  /** 실제 `<slip-designer>` 요소를 받는 ref. 객체 ref와 콜백 ref를 모두 쓸 수 있다. */
  ref?: Ref<SlipDesignerElement> | undefined;
  /** 양식 파일을 담은 `.slip` JSON 문자열. */
  src: string;
  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string | undefined;
  /** 폰트·로케일·암호화 키 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
  slipkit?: SlipKit | undefined;
  /** 바코드 종류와 용지 목록을 제공하는 호스트 설정. */
  settings?: SlipDesignerSettings | undefined;
  /** 툴바에 표시할 양식 프리셋. 지정하면 동봉 프리셋을 대체한다. */
  presets?: SlipPresets | undefined;
  /** "내 양식" 저장과 불러오기에 사용할 저장소 어댑터. */
  storage?: StorageAdapter | undefined;
  /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 생략하거나 제거하면 요소 기본값(2MB)을 쓴다. */
  maxImageBytes?: number | undefined;
  /** 양식이 변경될 때 변경된 양식 파일을 받는다. `SlipFile`을 받는 핸들러도 그대로 쓸 수 있다. */
  onSlipChange?: ((file: SlipTemplateFile) => void) | undefined;
}

/**
 * `<slip-designer>`를 노출하고 `slip-change` 이벤트를 `onSlipChange`에 연결한다.
 * 생략한 설정은 요소에 쓰지 않아 요소의 기본 동작을 유지한다.
 *
 * @remarks
 * `ref`로 실제 `<slip-designer>` 요소를 받을 수 있고, 표준 HTML 속성과 DOM 이벤트 props는
 * 요소에 그대로 전달된다. `src`는 전달된 나머지 props보다 항상 우선한다.
 *
 * @param props - 컴포넌트 props
 * @returns `<slip-designer>` React 요소
 */
export function SlipDesigner({
  ref: externalRef,
  src,
  locale,
  slipkit,
  settings,
  presets,
  storage,
  maxImageBytes,
  onSlipChange,
  ...rest
}: SlipDesignerProps): ReactElement {
  const ref = useRef<SlipDesignerElement>(null);
  const mergedRef = useMergedRef(ref, externalRef);
  useElementProps(ref, { locale, slipkit, settings, presets, storage, maxImageBytes });
  useSlipEvent(ref, 'slip-change', onSlipChange);
  return createElement('slip-designer', hostProps(rest, mergedRef, src));
}

/**
 * SlipForm 컴포넌트 props.
 *
 * @remarks
 * 아래 항목 외의 표준 HTML 속성(`className`·`style`·`id`·`title`·`role`·`tabIndex`·`aria-*`·`data-*`)과
 * DOM 이벤트(`onClick`·`onKeyDown` 등)는 `<slip-form>` 요소에 그대로 전달된다.
 * `children`과 `dangerouslySetInnerHTML`은 지원하지 않는다.
 */
export interface SlipFormProps extends SlipHostAttributes {
  /** 실제 `<slip-form>` 요소를 받는 ref. 객체 ref와 콜백 ref를 모두 쓸 수 있다. */
  ref?: Ref<SlipFormElement> | undefined;
  /** 양식 또는 작성 중인 전표를 담은 `.slip` JSON 문자열. */
  src: string;
  /**
   * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
   *
   * @defaultValue 영어
   */
  locale?: string | undefined;
  /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
  slipkit?: SlipKit | undefined;
  /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 생략하거나 제거하면 요소 기본값(2MB)을 쓴다. */
  maxImageBytes?: number | undefined;
  /** 값이 변경될 때 작성 중인 전표 파일을 받는다. `SlipFile`을 받는 핸들러도 그대로 쓸 수 있다. */
  onSlipChange?: ((file: SlipVoucherFile) => void) | undefined;
  /** 전표가 발행되면 확정된 전표 파일을 받는다. `SlipFile`을 받는 핸들러도 그대로 쓸 수 있다. */
  onSlipIssue?: ((file: SlipVoucherFile) => void) | undefined;
}

/**
 * `<slip-form>`을 노출하고 변경 및 발행 이벤트를 React 콜백에 연결한다.
 * 생략한 설정은 요소에 쓰지 않아 요소의 기본 동작을 유지한다.
 *
 * @remarks
 * `ref`로 실제 `<slip-form>` 요소를 받을 수 있고, 표준 HTML 속성과 DOM 이벤트 props는
 * 요소에 그대로 전달된다. `src`는 전달된 나머지 props보다 항상 우선한다.
 *
 * 발행 뒤 같은 양식으로 새 전표를 시작하려면 `key`를 바꿔 다시 마운트한다.
 * 같은 `src` 문자열을 다시 넘기는 것만으로는 발행 상태가 풀리지 않는다.
 *
 * @param props - 컴포넌트 props
 * @returns `<slip-form>` React 요소
 */
export function SlipForm({
  ref: externalRef,
  src,
  locale,
  slipkit,
  maxImageBytes,
  onSlipChange,
  onSlipIssue,
  ...rest
}: SlipFormProps): ReactElement {
  const ref = useRef<SlipFormElement>(null);
  const mergedRef = useMergedRef(ref, externalRef);
  useElementProps(ref, { locale, slipkit, maxImageBytes });
  useSlipEvent(ref, 'slip-change', onSlipChange);
  useSlipEvent(ref, 'slip-issue', onSlipIssue);
  return createElement('slip-form', hostProps(rest, mergedRef, src));
}
