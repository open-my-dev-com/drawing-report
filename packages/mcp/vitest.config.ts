import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// 시험은 소스를 직접 실행하므로 빌드와 같은 방식으로 패키지 버전 상수를 넣는다.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: { __SLIPKIT_MCP_VERSION__: JSON.stringify(version) },
  test: {
    // 자식 프로세스 실행과 PDF 렌더·래스터화는 커버리지 병렬 실행에서 기본 5초를 넘길 수 있다.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
