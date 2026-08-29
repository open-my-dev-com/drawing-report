import '@omdc-slipkit/elements';
import { defineComponent, h, type PropType } from 'vue';
import type {
  SlipDesigner as SlipDesignerElement,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';
import type { SlipFile, SlipKit, StorageAdapter } from '@omdc-slipkit/core';

type SlipPresets = SlipDesignerElement['presets'];

/**
 * SlipKit 웹 컴포넌트를 Vue 컴포넌트로 노출한다.
 * 객체 값은 `.` 접두사를 사용해 웹 컴포넌트의 JavaScript 프로퍼티로 전달한다.
 */
export const SlipViewer = defineComponent({
  name: 'SlipViewer',
  props: {
    /** `.slip` JSON 문자열. */
    src: { type: String, required: true },
    /**
     * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
     *
     * @defaultValue 영어
     */
    locale: { type: String, default: undefined },
    /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
    slipkit: { type: Object as PropType<SlipKit>, default: undefined },
  },
  setup(props) {
    return () => h('slip-viewer', {
      src: props.src,
      locale: props.locale,
      '.slipkit': props.slipkit,
    });
  },
});

/**
 * `<slip-designer>`를 노출하고 변경된 `.slip` 파일을 `slip-change` 이벤트로 전달한다.
 */
export const SlipDesigner = defineComponent({
  name: 'SlipDesigner',
  props: {
    /** 양식 파일을 담은 `.slip` JSON 문자열. */
    src: { type: String, required: true },
    /**
     * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
     *
     * @defaultValue 영어
     */
    locale: { type: String, default: undefined },
    /** 폰트·로케일·암호화 키 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
    slipkit: { type: Object as PropType<SlipKit>, default: undefined },
    /** 바코드 종류와 용지 목록을 제공하는 호스트 설정. */
    settings: { type: Object as PropType<SlipDesignerSettings>, default: undefined },
    /** 툴바에 표시할 양식 프리셋. 지정하면 동봉 프리셋을 대체한다. */
    presets: { type: Array as PropType<SlipPresets>, default: undefined },
    /** "내 양식" 저장과 불러오기에 사용할 저장소 어댑터. */
    storage: { type: Object as PropType<StorageAdapter>, default: undefined },
    /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 기본값은 2MB이다. */
    maxImageBytes: { type: Number, default: undefined },
  },
  emits: ['slip-change'],
  setup(props, { emit }) {
    return () =>
      h('slip-designer', {
        src: props.src,
        locale: props.locale,
        '.slipkit': props.slipkit,
        '.settings': props.settings,
        '.presets': props.presets,
        '.storage': props.storage,
        '.maxImageBytes': props.maxImageBytes,
        'onSlip-change': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-change', event.detail.file),
      });
  },
});

/**
 * `<slip-form>`을 노출하고 변경 및 발행 결과를 Vue 이벤트로 전달한다.
 */
export const SlipForm = defineComponent({
  name: 'SlipForm',
  props: {
    /** 양식 또는 작성 중인 전표를 담은 `.slip` JSON 문자열. */
    src: { type: String, required: true },
    /**
     * UI 언어 (`ko`, `en`, `ja`). 생략하면 `slipkit`에 설정된 로케일을 따른다.
     *
     * @defaultValue 영어
     */
    locale: { type: String, default: undefined },
    /** 폰트·로케일 공통 설정 인스턴스. `getFonts`가 없으면 동봉 기본 폰트를 사용한다. */
    slipkit: { type: Object as PropType<SlipKit>, default: undefined },
    /** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 기본값은 2MB이다. */
    maxImageBytes: { type: Number, default: undefined },
  },
  emits: ['slip-change', 'slip-issue'],
  setup(props, { emit }) {
    return () =>
      h('slip-form', {
        src: props.src,
        locale: props.locale,
        '.slipkit': props.slipkit,
        '.maxImageBytes': props.maxImageBytes,
        'onSlip-change': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-change', event.detail.file),
        'onSlip-issue': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-issue', event.detail.file),
      });
  },
});
