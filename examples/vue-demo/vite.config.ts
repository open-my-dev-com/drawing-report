import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 라이브러리 소스를 직접 참조해 빌드 없이 수정 사항이 바로 반영되게 한다 (바닐라 데모와 동일)
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@omdc-slipkit/core': r('../../packages/core/src/index.ts'),
      '@omdc-slipkit/elements/fonts/pretendard': r('../../packages/elements/src/fonts/pretendard.ts'),
      '@omdc-slipkit/elements/fonts/noto-sans-jp': r('../../packages/elements/src/fonts/noto-sans-jp.ts'),
      '@omdc-slipkit/elements': r('../../packages/elements/src/index.ts'),
      '@omdc-slipkit/vue': r('../../packages/vue/src/index.ts'),
      'slipkit-demo-shared/demo.css': r('../shared/demo.css'),
      'slipkit-demo-shared': r('../shared/src/index.ts'),
    },
  },
  server: { port: 5175 },
});
