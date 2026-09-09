// bench:all 실행 계획 시험 — 옵션 없는 공통 실행이 하위 명령의 기본값을 그대로 넘기는지,
// 선택한 성능 측정에 필요한 패키지만 한 번에 빌드하는지, 기준선이 갖춰졌는지 확인합니다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readPositiveInt, readPositiveIntList } from '../bench-shared/args.mjs';
import { FONTS_DEFAULT_RUNS, MCP_LIST_DEFAULT_RUNS, MCP_LIST_DEFAULT_SIZES } from '../bench-shared/defaults.mjs';
import { TOOLS } from '../bench-shared/result.mjs';
import { buildCommandArgs, buildTargets, missingBaselineTools, parseOptions, selectRuns } from './plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 인자 목록으로 하위 실행을 선택합니다.
 *
 * @param {string[]} argv - 공통 실행 인자
 * @returns {ReturnType<typeof selectRuns>} 하위 실행 목록
 */
function runsFor(argv) {
  return selectRuns(parseOptions(argv));
}

/**
 * 하위 실행 하나를 이름으로 찾습니다.
 *
 * @param {string[]} argv - 공통 실행 인자
 * @param {string} tool - 성능 측정 이름
 * @returns {Record<string, any>} 하위 실행
 */
function runFor(argv, tool) {
  const run = runsFor(argv).find((item) => item.tool === tool);
  assert.ok(run !== undefined, `${tool} 실행이 없습니다.`);
  return run;
}

describe('공통 실행의 기본값', () => {
  it('네 종류를 정해진 순서로 모두 고른다', () => {
    assert.deepEqual(runsFor([]).map((run) => run.tool), ['core', 'designer', 'fonts', 'mcp-list']);
    assert.deepEqual([...TOOLS].sort(), runsFor([]).map((run) => run.tool).sort());
  });

  it('fonts에 하위 명령과 같은 반복 수를 넘긴다', () => {
    const args = runFor([], 'fonts').args;
    assert.equal(readPositiveInt(args, '--runs', 0), FONTS_DEFAULT_RUNS);
  });

  it('MCP list에 하위 명령과 같은 시험 자료 파일 수와 반복 수를 넘긴다', () => {
    const args = runFor([], 'mcp-list').args;
    assert.deepEqual(readPositiveIntList(args, '--sizes', []), [...MCP_LIST_DEFAULT_SIZES]);
    assert.equal(readPositiveInt(args, '--runs', 0), MCP_LIST_DEFAULT_RUNS);
  });

  it('하위 명령도 같은 기본값 상수를 읽는다', () => {
    const fonts = readFileSync(path.join(ROOT, 'scripts', 'bench-fonts.mjs'), 'utf8');
    const mcp = readFileSync(path.join(ROOT, 'scripts', 'bench-mcp-list.mjs'), 'utf8');
    assert.match(fonts, /readPositiveInt\(argv, '--runs', FONTS_DEFAULT_RUNS\)/);
    assert.match(mcp, /readPositiveInt\(argv, '--runs', MCP_LIST_DEFAULT_RUNS\)/);
    assert.match(mcp, /readPositiveIntList\(argv, '--sizes', \[\.\.\.MCP_LIST_DEFAULT_SIZES\]\)/);
  });

  it('축소는 명시적 옵션으로만 한다', () => {
    const argv = ['--fonts-runs', '3', '--mcp-runs', '2', '--mcp-sizes', '1000'];
    assert.deepEqual(runFor(argv, 'fonts').args, ['--runs', '3']);
    assert.deepEqual(runFor(argv, 'mcp-list').args, ['--sizes', '1000', '--runs', '2']);
  });

  it('Chromium 측정과 건너뛰기 옵션을 하위 명령에 넘긴다', () => {
    assert.deepEqual(runFor(['--designer-chromium'], 'designer').args, ['--chromium']);
    assert.deepEqual(runFor(['--fonts-skip-chromium'], 'fonts').args, ['--runs', String(FONTS_DEFAULT_RUNS), '--skip-chromium']);
  });

  it('반복 수가 1 이상의 정수가 아니면 거절한다', () => {
    assert.throws(() => parseOptions(['--fonts-runs', '0']), /1 이상의 정수/);
  });
});

describe('실행할 성능 측정 고르기', () => {
  it('--only 로 고른 것만 남긴다', () => {
    assert.deepEqual(runsFor(['--only', 'core']).map((run) => run.tool), ['core']);
  });

  it('--skip 으로 뺀 것을 빼고 순서를 지킨다', () => {
    assert.deepEqual(runsFor(['--skip', 'designer,fonts']).map((run) => run.tool), ['core', 'mcp-list']);
  });

  it('알 수 없는 이름은 거절한다', () => {
    assert.throws(() => parseOptions(['--only', 'core,pdf']), /알 수 없는 성능 측정/);
  });

  it('고른 것이 하나도 없으면 거절한다', () => {
    assert.throws(() => runsFor(['--only', 'core', '--skip', 'core']), /실행할 성능 측정이 없습니다/);
  });
});

describe('먼저 빌드할 패키지', () => {
  it('--only core 면 Core만 빌드한다', () => {
    assert.deepEqual(buildTargets(runsFor(['--only', 'core'])), ['@omdc-slipkit/core']);
  });

  it('Designer·fonts는 Core와 Elements를 빌드한다', () => {
    assert.deepEqual(buildTargets(runsFor(['--only', 'designer,fonts'])), ['@omdc-slipkit/core', '@omdc-slipkit/elements']);
  });

  it('네 종류를 다 실행하면 세 패키지를 의존 순서로 한 번에 빌드한다', () => {
    const packages = buildTargets(runsFor([]));
    assert.deepEqual(packages, ['@omdc-slipkit/core', '@omdc-slipkit/elements', '@omdc-slipkit/mcp']);
    assert.deepEqual(buildCommandArgs(packages), [
      '--filter', '@omdc-slipkit/core',
      '--filter', '@omdc-slipkit/elements',
      '--filter', '@omdc-slipkit/mcp',
      'run', 'build',
    ]);
  });

  it('빌드 대상이 겹쳐도 패키지마다 한 번만 넣는다', () => {
    const packages = buildTargets(runsFor(['--only', 'core,designer,fonts']));
    assert.deepEqual(packages, ['@omdc-slipkit/core', '@omdc-slipkit/elements']);
    assert.equal(buildCommandArgs(packages).filter((value) => value === '--filter').length, 2);
  });

  it('하위 실행이 요구하는 산출물은 빌드 대상 안에 있다', () => {
    for (const run of runsFor([])) {
      for (const need of run.needs) {
        const owner = `@omdc-slipkit/${need.split('/')[1]}`;
        assert.ok(run.packages.includes(owner), `${run.tool}: ${need}`);
      }
    }
  });
});

describe('기준선 확인', () => {
  it('선택한 성능 측정의 기준선이 없으면 이름을 알린다', () => {
    const baselines = new Map([['designer', {}], ['fonts', {}], ['mcp-list', {}]]);
    assert.deepEqual(missingBaselineTools(runsFor(['--only', 'core']), baselines), ['core']);
  });

  it('기준선이 모두 있으면 빈 목록이다', () => {
    const baselines = new Map(TOOLS.map((tool) => [tool, {}]));
    assert.deepEqual(missingBaselineTools(runsFor([]), baselines), []);
  });
});
