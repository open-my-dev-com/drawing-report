import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 설치된 것처럼 `node_modules`에 이 패키지를 연결한 임시 CommonJS 프로젝트를 만든다.
 * dist 파일을 경로로 직접 부르면 `exports` 해석을 건너뛰므로, 반드시 패키지 이름으로 부른다.
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
      // exports의 require 조건이 ESM 산출물을 가리키고, 의존 그래프에 top-level await가
      // 없어야 통과한다 — 의존성 갱신으로 어느 쪽이 깨져도 여기서 잡는다 (ADR-057)
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
