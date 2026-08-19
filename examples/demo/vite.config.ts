import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 라이브러리 소스를 직접 참조해 빌드 없이 수정 사항이 바로 반영되게 한다
export default defineConfig({
  resolve: {
    alias: {
      '@slipkit/core': r('../../packages/core/src/index.ts'),
      '@slipkit/elements': r('../../packages/elements/src/index.ts'),
    },
  },
  server: { port: 5173 },
});
