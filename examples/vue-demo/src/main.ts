/**
 * SlipKit Vue 데모의 진입점입니다.
 * 바닐라 데모와 같은 기능을 Vue로 연결한 예시이며 연결 방법만 다릅니다.
 */
import { createApp } from 'vue';
import 'slipkit-demo-shared/demo.css';
import App from './App.vue';

createApp(App).mount('#app');
