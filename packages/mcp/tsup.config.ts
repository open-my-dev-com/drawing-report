import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/** `--version`이 출력할 값 — package.json의 버전을 빌드 시 상수로 넣어 소스에 중복 기재하지 않는다. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  define: { __SLIPKIT_MCP_VERSION__: JSON.stringify(version) },
});
