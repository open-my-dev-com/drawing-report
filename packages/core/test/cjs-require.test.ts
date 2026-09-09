import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 설치된 것처럼 `node_modules`에 이 패키지를 연결한 임시 CommonJS 프로젝트를 만듭니다.
 * `exports`의 CommonJS 조건을 검증하기 위해 dist 경로가 아닌 패키지 이름으로 불러옵니다.
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

/**
 * 심볼릭 링크 시험을 건너뛸지 판정합니다. Windows에서 링크 생성이 권한 오류(`EPERM`)로 실패할 때만
 * 건너뛰고, 그 밖의 환경에서는 항상 실행합니다.
 */
function symlinksUnavailable(): boolean {
  if (process.platform !== 'win32') return false;
  const probe = mkdtempSync(join(tmpdir(), 'slipkit-cjs-symlink-'));
  try {
    mkdirSync(join(probe, 'target'));
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'dir');
    return false;
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === 'EPERM';
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

describe('CommonJS 소비 (ADR-057)', () => {
  // Windows에서 링크 생성 권한이 없을 때만 건너뜁니다.
  it.skipIf(symlinksUnavailable())('설치 상태에서 패키지 이름으로 require할 수 있다', () => {
    if (!existsSync(join(packageRoot, 'dist', 'index.js'))) {
      throw new Error('dist/index.js가 없습니다. 먼저 @omdc-slipkit/core를 빌드한 뒤 실행해야 합니다.');
    }
    const { require, cleanup } = makeCjsProject();
    try {
      // CommonJS 진입점은 ESM 전용 코드나 top-level await를 포함할 수 없습니다.
      const core = require('@omdc-slipkit/core') as typeof import('../src/index.js');
      expect(typeof core.parseSlipFile).toBe('function');
      expect(typeof core.createSlipKit).toBe('function');
      expect(typeof core.renderSlipToPdf).toBe('function');
      expect(typeof core.encryptSlipFile).toBe('function');
    } finally {
      cleanup();
    }
    // 패키지 의존 그래프 전체를 동기 로드하는 무거운 테스트라 전체 실행 부하에서 기본 5초를 넘길 수 있습니다.
  }, 30_000);
});
