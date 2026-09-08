/**
 * `bench:all`이 무엇을 어떤 순서로 돌릴지 정하는 부분.
 *
 * 자식 프로세스 실행과 파일 쓰기는 `scripts/bench-all.mjs`가 하고, 여기에는 상태를 두지 않는다 —
 * 옵션 해석, 하위 실행 선택, 먼저 빌드할 패키지 계산, 기준선이 갖춰졌는지 확인만 한다.
 *
 * 하위 명령에 넘기는 기본값은 `scripts/bench-shared/defaults.mjs`에서 읽는다. 하위 명령도 같은
 * 상수를 쓰므로 공통 실행과 따로 실행이 어긋나지 않는다.
 */
import { hasFlag, readArg, readPositiveInt } from '../bench-shared/args.mjs';
import { FONTS_DEFAULT_RUNS, MCP_LIST_DEFAULT_RUNS, MCP_LIST_DEFAULT_SIZES } from '../bench-shared/defaults.mjs';
import { TOOLS } from '../bench-shared/result.mjs';

/** 빌드 순서 — 앞의 것이 뒤의 것의 의존이라 이 차례로 넘긴다 */
const PACKAGE_ORDER = Object.freeze(['@omdc-slipkit/core', '@omdc-slipkit/elements', '@omdc-slipkit/mcp']);

/**
 * 하위 실행 정의 — 이 순서로 돈다.
 *
 * `packages`는 그 benchmark가 쓰는 빌드 대상이고, `needs`는 빌드가 끝난 뒤 있어야 하는 산출물이다.
 */
const RUN_DEFS = Object.freeze([
  {
    tool: 'core',
    script: 'benchmark.mjs',
    execArgv: [],
    packages: ['@omdc-slipkit/core'],
    needs: ['packages/core/dist/index.js'],
    args: () => [],
  },
  {
    tool: 'designer',
    script: 'bench-designer.mjs',
    // 되돌리기 스냅샷의 heapUsed 차이를 재려면 gc()가 필요하다 (없으면 스스로 다시 실행한다).
    execArgv: ['--expose-gc'],
    packages: ['@omdc-slipkit/core', '@omdc-slipkit/elements'],
    needs: ['packages/core/dist/index.js', 'packages/elements/dist/index.js'],
    args: (options) => (options.designerChromium ? ['--chromium'] : []),
  },
  {
    tool: 'fonts',
    script: 'bench-fonts.mjs',
    execArgv: [],
    packages: ['@omdc-slipkit/core', '@omdc-slipkit/elements'],
    needs: ['packages/core/dist/index.js', 'packages/elements/dist/index.js'],
    args: (options) => ['--runs', String(options.fontsRuns), ...(options.fontsSkipChromium ? ['--skip-chromium'] : [])],
  },
  {
    tool: 'mcp-list',
    script: 'bench-mcp-list.mjs',
    execArgv: ['--expose-gc'],
    // MCP 패키지가 Core·Elements에 기대므로 셋을 함께 빌드한다.
    packages: ['@omdc-slipkit/core', '@omdc-slipkit/elements', '@omdc-slipkit/mcp'],
    needs: ['packages/core/dist/index.js', 'packages/mcp/dist/index.js'],
    args: (options) => ['--sizes', options.mcpSizes, '--runs', String(options.mcpRuns)],
  },
]);

/**
 * 쉼표로 구분한 benchmark 이름 목록을 읽는다.
 *
 * @param {string[]} argv - 인자 배열
 * @param {string} name - 인자 이름 (`--` 포함)
 * @returns {string[]} benchmark 이름 목록. 인자가 없으면 빈 배열
 * @throws Error 알 수 없는 이름이 있을 때
 */
function parseToolList(argv, name) {
  const raw = readArg(argv, name);
  if (raw === undefined) return [];
  const names = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  const unknown = names.filter((value) => !TOOLS.includes(value));
  if (unknown.length > 0) throw new Error(`${name} 에 알 수 없는 benchmark가 있다: ${unknown.join(', ')}`);
  return names;
}

/**
 * 공통 실행의 옵션을 읽는다. 하위 명령에 넘길 값은 하위 명령의 기본값을 그대로 쓴다.
 *
 * @param {string[]} argv - 인자 배열 (`process.argv.slice(2)`)
 * @returns {{ out: string | undefined, baselines: string | undefined, useBaseline: boolean,
 *   designerChromium: boolean, fontsRuns: number, fontsSkipChromium: boolean, mcpSizes: string,
 *   mcpRuns: number, only: string[], skip: string[] }} 옵션
 * @throws Error 값이 형식에 맞지 않거나 알 수 없는 benchmark 이름일 때
 */
export function parseOptions(argv) {
  return {
    out: readArg(argv, '--out'),
    baselines: readArg(argv, '--baselines'),
    useBaseline: !hasFlag(argv, '--no-baseline'),
    designerChromium: hasFlag(argv, '--designer-chromium'),
    fontsRuns: readPositiveInt(argv, '--fonts-runs', FONTS_DEFAULT_RUNS),
    fontsSkipChromium: hasFlag(argv, '--fonts-skip-chromium'),
    mcpSizes: readArg(argv, '--mcp-sizes') ?? MCP_LIST_DEFAULT_SIZES.join(','),
    mcpRuns: readPositiveInt(argv, '--mcp-runs', MCP_LIST_DEFAULT_RUNS),
    only: parseToolList(argv, '--only'),
    skip: parseToolList(argv, '--skip'),
  };
}

/**
 * 옵션대로 돌릴 하위 실행을 고르고 넘길 인자까지 만든다.
 *
 * @param {ReturnType<typeof parseOptions>} options - 공통 실행 옵션
 * @returns {Array<{ tool: string, script: string, execArgv: string[], packages: string[],
 *   needs: string[], args: string[] }>} 하위 실행 목록
 * @throws Error 고른 benchmark가 하나도 없을 때
 */
export function selectRuns(options) {
  const runs = RUN_DEFS
    .filter((def) => (options.only.length === 0 || options.only.includes(def.tool)) && !options.skip.includes(def.tool))
    .map((def) => ({
      tool: def.tool,
      script: def.script,
      execArgv: [...def.execArgv],
      packages: [...def.packages],
      needs: [...def.needs],
      args: def.args(options),
    }));
  if (runs.length === 0) throw new Error('돌릴 benchmark가 없다 — --only 와 --skip 을 확인한다');
  return runs;
}

/**
 * 고른 하위 실행이 쓰는 빌드 대상을 모은다. 의존 순서대로 겹치지 않게 돌려준다.
 *
 * @param {Array<{ packages: string[] }>} runs - `selectRuns` 결과
 * @returns {string[]} pnpm 필터에 넣을 패키지 이름
 */
export function buildTargets(runs) {
  const wanted = new Set(runs.flatMap((run) => run.packages));
  return PACKAGE_ORDER.filter((name) => wanted.has(name));
}

/**
 * 빌드 한 번으로 끝내는 pnpm 인자를 만든다.
 *
 * @param {string[]} packages - `buildTargets` 결과
 * @returns {string[]} pnpm에 넘길 인자
 * @throws Error 빌드 대상이 비었을 때
 */
export function buildCommandArgs(packages) {
  if (packages.length === 0) throw new Error('빌드할 패키지가 없다');
  return [...packages.flatMap((name) => ['--filter', name]), 'run', 'build'];
}

/**
 * 고른 하위 실행 중 기준선이 없는 benchmark를 찾는다.
 *
 * @param {Array<{ tool: string }>} runs - `selectRuns` 결과
 * @param {Map<string, unknown>} baselines - `loadBaselines` 결과
 * @returns {string[]} 기준선이 없는 benchmark 이름
 */
export function missingBaselineTools(runs, baselines) {
  return runs.map((run) => run.tool).filter((tool) => !baselines.has(tool));
}
