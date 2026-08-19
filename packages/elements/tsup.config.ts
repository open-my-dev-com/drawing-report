import { defineConfig } from 'tsup';

// 동봉 폰트는 별도 진입점 — 호스트가 `@omdc-slipkit/elements/fonts/pretendard`로
// 직접 쓸 수 있고, splitting으로 본체의 동적 import와 청크를 공유한다 (ADR-031).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'fonts/pretendard': 'src/fonts/pretendard.ts',
  },
  format: 'esm',
  dts: true,
  splitting: true,
  clean: true,
});
