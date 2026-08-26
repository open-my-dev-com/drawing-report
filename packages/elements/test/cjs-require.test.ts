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
  symlinkSync(packageRoot, join(base, 'node_modules', '@omdc-slipkit', 'elements'), 'dir');
  const entry = join(base, 'main.cjs');
  writeFileSync(entry, '');
  return {
    require: createRequire(entry),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

describe('동봉 폰트의 CommonJS 소비 (ADR-057)', () => {
  it('서버에서 폰트 하위 경로를 패키지 이름으로 require할 수 있다', () => {
    if (!existsSync(join(packageRoot, 'dist', 'fonts', 'pretendard.js'))) {
      throw new Error('dist/fonts가 없습니다 — 먼저 @omdc-slipkit/elements를 build한 뒤 실행해야 합니다');
    }
    const { require, cleanup } = makeCjsProject();
    try {
      // 폰트 하위 경로는 DOM 없이 동작하는 순수 데이터 모듈이라 서버 지원 대상이다 (ADR-057).
      // Web Component가 들어 있는 루트 진입점은 대상이 아니므로 검사하지 않는다.
      const pretendard = require('@omdc-slipkit/elements/fonts/pretendard') as
        typeof import('../src/fonts/pretendard.js');
      expect(Array.isArray(pretendard.PRETENDARD_FONTS)).toBe(true);
      expect(pretendard.PRETENDARD_FONTS.length).toBeGreaterThan(0);

      const notoSansJp = require('@omdc-slipkit/elements/fonts/noto-sans-jp') as
        typeof import('../src/fonts/noto-sans-jp.js');
      expect(Array.isArray(notoSansJp.NOTO_SANS_JP_FONTS)).toBe(true);
      expect(notoSansJp.NOTO_SANS_JP_FONTS.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});
