import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// 시험은 소스를 직접 실행하므로 빌드와 같은 방식으로 패키지 버전 상수를 넣는다.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: { __SLIPKIT_MCP_VERSION__: JSON.stringify(version) },
});
