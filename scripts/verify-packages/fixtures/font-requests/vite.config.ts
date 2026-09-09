import { defineConfig } from 'vite';

// 요청을 파일 이름으로 분류할 수 있도록 청크 이름을 고정합니다. 동봉 폰트 두 모듈은 각각 자기 청크로,
// 그 밖의 정적 의존성(Elements 루트·core·lit·pdfme 등)은 `elements` 청크 하나로 묶습니다.
// 진입 모듈(main.ts)은 Elements를 동적 import하므로 `elements` 청크는 `import` 단계에서 읽힙니다.
const isFontModule = (id: string, name: string): boolean =>
  id.replace(/\\/g, '/').endsWith(`/@omdc-slipkit/elements/dist/fonts/${name}.js`);

export default defineConfig({
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 8_000,
    // 단계별 요청을 그대로 확인하기 위해 `<link rel="modulepreload">`와 의존 청크 미리 읽기를 끕니다.
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite가 동적 import에 끼워 넣는 preload 도우미는 진입 모듈과 `elements` 청크가 함께 씁니다. 따로 두지 않으면
          // `elements` 청크에 들어가 진입 모듈이 그 청크를 정적으로 import하게 되고, `import` 단계가 페이지 로드에 섞입니다.
          if (id.includes('vite/preload-helper')) return 'vite-preload';
          if (isFontModule(id, 'pretendard')) return 'font-pretendard';
          if (isFontModule(id, 'noto-sans-jp')) return 'font-noto-sans-jp';
          if (id.includes('node_modules')) return 'elements';
          return undefined;
        },
      },
    },
  },
});
