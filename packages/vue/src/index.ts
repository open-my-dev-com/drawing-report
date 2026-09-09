import '@omdc-slipkit/elements';
import { defineComponent, h, ref, watchPostEffect, type PropType, type Ref } from 'vue';
import type {
  SlipDesigner as SlipDesignerElement,
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
 * 선택적 설정을 웹 컴포넌트의 JavaScript 프로퍼티에 반영합니다.
 *
 * @remarks
 * 값이 `undefined`인 설정은 요소에 쓰지 않고, 처음 마운트할 때 읽어 둔 요소의 기본값으로
 * 되돌립니다. `.prop` 바인딩은 `undefined`를 숫자 프로퍼티에 `0`으로 쓰기 때문에
 * `maxImageBytes` 같은 설정을 생략하면 이미지를 전혀 받지 못하게 됩니다. 이를 방지하기 위해 요소
 * 기본값(2MB 등)이 유지되게 합니다.
 *
 * @param el - 웹 컴포넌트 참조
 * @param read - 현재 설정을 읽는 함수. 반응형 props를 읽으면 변경 때마다 다시 씁니다. */
function useElementProps(el: Ref<HTMLElement | null>, read: () => Record<string, unknown>): void {
  let defaults: Record<string, unknown> | null = null;
  watchPostEffect(() => {
    const next = read();
    const element = el.value as unknown as Record<string, unknown> | null;
    if (!element) return;
    defaults ??= Object.fromEntries(Object.keys(next).map((key) => [key, element[key]]));
    for (const key of Object.keys(next)) {
      const value = next[key];
      element[key] = value === undefined ? defaults[key] : value;
    }
  });
}

/**
 * SlipKit 웹 컴포넌트를 Vue 컴포넌트로 노출합니다.
 * 생략한 설정은 요소에 쓰지 않아 요소의 기본 동작을 유지합니다.
 */
export const SlipViewer = defineComponent({
  name: 'SlipViewer',
  props: {
    /** `.slip` JSON 문자열입니다. */
    src: { type: String, required: true },
    /**
     * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따릅니다.
     *
     * @defaultValue 영어
     */
    locale: { type: String as PropType<string | undefined>, required: false },
    /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용합니다. */
    slipkit: { type: Object as PropType<SlipKit | undefined>, required: false },
  },
  setup(props) {
    const el = ref<HTMLElement | null>(null);
    useElementProps(el, () => ({ locale: props.locale, slipkit: props.slipkit }));
    return () => h('slip-viewer', { ref: el, src: props.src });
  },
});

/**
 * `<slip-designer>`를 노출하고 변경된 양식 파일을 `slip-change` 이벤트로 전달합니다.
 * 생략한 설정은 요소에 쓰지 않아 요소의 기본 동작을 유지합니다.
 */
export const SlipDesigner = defineComponent({
  name: 'SlipDesigner',
  props: {
    /** 양식 파일을 담은 `.slip` JSON 문자열입니다. */
    src: { type: String, required: true },
    /**
     * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따릅니다.
     *
     * @defaultValue 영어
     */
    locale: { type: String as PropType<string | undefined>, required: false },
    /** 폰트·로케일·암호화 키 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용합니다. */
    slipkit: { type: Object as PropType<SlipKit | undefined>, required: false },
    /** 바코드 종류와 용지 목록을 제공하는 호스트 설정입니다. */
    settings: { type: Object as PropType<SlipDesignerSettings | undefined>, required: false },
    /** 툴바에 표시할 양식 프리셋. 지정하면 동봉 프리셋을 대체합니다. */
    presets: { type: Array as PropType<SlipPresets | undefined>, required: false },
    /** "내 양식" 저장과 불러오기에 사용할 저장소 어댑터입니다. */
    storage: { type: Object as PropType<StorageAdapter | undefined>, required: false },
    /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 생략하거나 제거하면 요소 기본값(2MB)을 씁니다. */
    maxImageBytes: { type: Number as PropType<number | undefined>, required: false },
  },
  emits: {
    /** 양식이 변경될 때 변경된 양식 파일을 전달합니다. `SlipFile`을 받는 핸들러도 그대로 쓸 수 있습니다. */
    'slip-change': (file: SlipTemplateFile) => file.kind === 'template',
  },
  setup(props, { emit }) {
    const el = ref<HTMLElement | null>(null);
    useElementProps(el, () => ({
      locale: props.locale,
      slipkit: props.slipkit,
      settings: props.settings,
      presets: props.presets,
      storage: props.storage,
      maxImageBytes: props.maxImageBytes,
    }));
    return () =>
      h('slip-designer', {
        ref: el,
        src: props.src,
        'onSlip-change': (event: CustomEvent<{ file: SlipTemplateFile }>) =>
          emit('slip-change', event.detail.file),
      });
  },
});

/**
 * `<slip-form>`을 노출하고 변경 및 발행 결과를 Vue 이벤트로 전달합니다.
 * 생략한 설정은 요소에 쓰지 않아 요소의 기본 동작을 유지합니다.
 *
 * @remarks
 * 발행 뒤 같은 양식으로 새 전표를 시작하려면 `:key`를 바꿔 다시 마운트합니다.
 * 같은 `src` 문자열을 다시 넘기는 것만으로는 발행 상태가 해제되지 않습니다.
 */
export const SlipForm = defineComponent({
  name: 'SlipForm',
  props: {
    /** 양식 또는 작성 중인 전표를 담은 `.slip` JSON 문자열입니다. */
    src: { type: String, required: true },
    /**
     * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따릅니다.
     *
     * @defaultValue 영어
     */
    locale: { type: String as PropType<string | undefined>, required: false },
    /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용합니다. */
    slipkit: { type: Object as PropType<SlipKit | undefined>, required: false },
    /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 생략하거나 제거하면 요소 기본값(2MB)을 씁니다. */
    maxImageBytes: { type: Number as PropType<number | undefined>, required: false },
  },
  emits: {
    /** 값이 변경될 때 작성 중인 전표 파일을 전달합니다. `SlipFile`을 받는 핸들러도 그대로 쓸 수 있습니다. */
    'slip-change': (file: SlipVoucherFile) => file.kind === 'voucher',
    /** 전표가 발행되면 확정된 전표 파일을 전달합니다. `SlipFile`을 받는 핸들러도 그대로 쓸 수 있습니다. */
    'slip-issue': (file: SlipVoucherFile) => file.kind === 'voucher',
  },
  setup(props, { emit }) {
    const el = ref<HTMLElement | null>(null);
    useElementProps(el, () => ({
      locale: props.locale,
      slipkit: props.slipkit,
      maxImageBytes: props.maxImageBytes,
    }));
    return () =>
      h('slip-form', {
        ref: el,
        src: props.src,
        'onSlip-change': (event: CustomEvent<{ file: SlipVoucherFile }>) =>
          emit('slip-change', event.detail.file),
        'onSlip-issue': (event: CustomEvent<{ file: SlipVoucherFile }>) =>
          emit('slip-issue', event.detail.file),
      });
  },
});
