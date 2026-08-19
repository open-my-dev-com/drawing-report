import '@omdc-slipkit/elements';
import { defineComponent, h, type PropType } from 'vue';
import type { SlipViewer as SlipViewerElement } from '@omdc-slipkit/elements';
import type { SlipFile } from '@omdc-slipkit/core';

type SlipFonts = SlipViewerElement['fonts'];

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
    /** UI 언어 ('ko' | 'en', 기본 한국어) — ADR-028 */
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
    /** UI 언어 ('ko' | 'en', 기본 한국어) — ADR-028 */
    locale: { type: String, default: undefined },
    /** PDF 미리보기에 쓸 사용자 폰트 (ADR-012) */
    fonts: { type: Object as PropType<SlipFonts>, default: undefined },
  },
  emits: ['slip-change'],
  setup(props, { emit }) {
    return () =>
      h('slip-designer', {
        src: props.src,
        locale: props.locale,
        '.fonts': props.fonts,
        'onSlip-change': (event: CustomEvent<{ file: SlipFile }>) =>
          emit('slip-change', event.detail.file),
      });
  },
});
