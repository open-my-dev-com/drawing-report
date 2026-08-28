import { defineConfig } from 'tsup';

// 동봉 폰트는 직접 가져오기와 동적 로딩이 같은 청크를 사용하도록 별도 진입점으로 빌드한다.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'fonts/pretendard': 'src/fonts/pretendard.ts',
    'fonts/noto-sans-jp': 'src/fonts/noto-sans-jp.ts',
    'default-fonts': 'src/default-fonts.ts',
  },
  format: 'esm',
  dts: true,
  splitting: true,
  clean: true,
});
