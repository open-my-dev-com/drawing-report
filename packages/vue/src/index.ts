import '@slipkit/elements';
import { defineComponent, h } from 'vue';

/**
 * Vue는 커스텀 엘리먼트를 네이티브로 지원한다.
 * (호스트 앱 빌드 설정에서 `slip-` 접두사를 custom element로 표시하면 이 래퍼 없이도 사용 가능)
 */
export const SlipViewer = defineComponent({
  name: 'SlipViewer',
  props: {
    /** .slip JSON 문자열 */
    src: { type: String, required: true },
  },
  setup(props) {
    return () => h('slip-viewer', { src: props.src });
  },
});
