import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 설치된 것처럼 `node_modules`에 이 패키지를 연결한 임시 CommonJS 프로젝트를 만든다.
 * `exports`의 CommonJS 조건을 검증하기 위해 dist 경로가 아닌 패키지 이름으로 불러온다.
 */
function makeCjsProject(): { require: ReturnType<typeof createRequire>; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'slipkit-cjs-'));
  mkdirSync(join(base, 'node_modules', '@omdc-slipkit'), { recursive: true });
  symlinkSync(packageRoot, join(base, 'node_modules', '@omdc-slipkit', 'core'), 'dir');
  const entry = join(base, 'main.cjs');
  writeFileSync(entry, '');
  return {
    require: createRequire(entry),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

describe('CommonJS 소비 (ADR-057)', () => {
  it('설치 상태에서 패키지 이름으로 require할 수 있다', () => {
    if (!existsSync(join(packageRoot, 'dist', 'index.js'))) {
      throw new Error('dist/index.js가 없습니다 — 먼저 @omdc-slipkit/core를 build한 뒤 실행해야 합니다');
    }
    const { require, cleanup } = makeCjsProject();
    try {
      // CommonJS 진입점은 ESM 전용 코드나 top-level await를 포함할 수 없다.
      const core = require('@omdc-slipkit/core') as typeof import('../src/index.js');
      expect(typeof core.parseSlipFile).toBe('function');
      expect(typeof core.createSlipKit).toBe('function');
      expect(typeof core.renderSlipToPdf).toBe('function');
      expect(typeof core.encryptSlipFile).toBe('function');
    } finally {
      cleanup();
    }
  });
});
