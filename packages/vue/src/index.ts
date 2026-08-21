import '@omdc-slipkit/elements';
import { defineComponent, h, type PropType } from 'vue';
import type {
  SlipViewer as SlipViewerElement,
  SlipDesigner as SlipDesignerElement,
} from '@omdc-slipkit/elements';
import type { IntegrityJwk, SlipFile, StorageAdapter } from '@omdc-slipkit/core';

type SlipFonts = SlipViewerElement['fonts'];
type SlipPresets = SlipDesignerElement['presets'];

/**
 * Vue는 커스텀 엘리먼트를 네이티브로 지원한다.
 * (호스트 앱 빌드 설정에서 `slip-` 접두사를 custom element로 표시하면 이 래퍼 없이도 사용 가능)
 * fonts 같은 객체 값은 `.` 접두사로 JS 프로퍼티에 바인딩한다.
 */
export const SlipViewer = defineComponent({
  name: 'SlipViewer',
  props: {
    /** .slip JSON 문자열 */
    src: { type: String, required: true },
    /**
     * UI 언어 ('ko' | 'en') — ADR-028.
     *
     * @defaultValue 한국어
     */
    locale: { type: String, default: undefined },
    /** PDF 렌더링에 쓸 사용자 폰트 (ADR-012) */
    fonts: { type: Object as PropType<SlipFonts>, default: undefined },
  },
  setup(props) {
    return () => h('slip-viewer', { src: props.src, locale: props.locale, '.fonts': props.fonts });
  },
});

/**
 * `<slip-designer>` 래퍼. 편집으로 양식이 바뀌면 변경된 .slip 파일을
 * `slip-change` 이벤트로 그대로 다시 내보낸다 (ADR-003 — 얇은 래퍼).
 */
export const SlipDesigner = defineComponent({
  name: 'SlipDesigner',
  props: {
    /** .slip JSON 문자열 (template 파일만) */
    src: { type: String, required: true },
    /**
     * UI 언어 ('ko' | 'en') — ADR-028.
     *
     * @defaultValue 한국어
     */
    locale: { type: String, default: undefined },
    /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
    fonts: { type: Object as PropType<SlipFonts>, default: undefined },
    /** 툴바 프리셋 메뉴에 쓸 양식 목록 — 주면 동봉 프리셋 대신 쓴다 */
    presets: { type: Array as PropType<SlipPresets>, default: undefined },
    /** "내 양식" 저장·불러오기에 쓸 저장소 어댑터 (ADR-021) */
    storage: { type: Object as PropType<StorageAdapter>, default: undefined },
    /** 넣을 수 있는 이미지 파일의 최대 크기(바이트) — 기본 2MB (G-36) */
    maxImageBytes: { type: Number, default: undefined },
  },
  emits: ['slip-change'],
  setup(props, { emit }) {
    return () =>
      h('slip-designer', {
        src: props.src,
        locale: props.locale,
        '.fonts': props.fonts,
        '.presets': props.presets,
        '.storage': props.storage,
        '.maxImageBytes': props.maxImageBytes,
        'onSlip-change': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-change', event.detail.file),
      });
  },
});

/**
 * `<slip-form>` 래퍼. 값 입력·발행 결과를 `slip-change`·`slip-issue` 이벤트로
 * 그대로 다시 내보낸다 (ADR-003 — 얇은 래퍼).
 */
export const SlipForm = defineComponent({
  name: 'SlipForm',
  props: {
    /** .slip JSON 문자열 (양식 또는 작성 중 전표) */
    src: { type: String, required: true },
    /**
     * UI 언어 ('ko' | 'en') — ADR-028.
     *
     * @defaultValue 한국어
     */
    locale: { type: String, default: undefined },
    /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
    fonts: { type: Object as PropType<SlipFonts>, default: undefined },
    /** 발행 서명에 쓸 개인키 (JWK) — 없으면 해시만 기록한다 (SPEC §8.3) */
    signingKey: { type: Object as PropType<IntegrityJwk>, default: undefined },
  },
  emits: ['slip-change', 'slip-issue'],
  setup(props, { emit }) {
    return () =>
      h('slip-form', {
        src: props.src,
        locale: props.locale,
        '.fonts': props.fonts,
        '.signingKey': props.signingKey,
        'onSlip-change': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-change', event.detail.file),
        'onSlip-issue': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-issue', event.detail.file),
      });
  },
});
