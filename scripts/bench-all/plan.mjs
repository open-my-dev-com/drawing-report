/**
 * `bench:all`에서 실행할 측정 항목과 순서를 정합니다.
 *
 * 자식 프로세스 실행과 파일 쓰기는 `scripts/bench-all.mjs`가 담당하며, 이 모듈에는 상태를 두지 않습니다.
 * 옵션 해석, 하위 실행 선택, 먼저 빌드할 패키지 계산, 기준선이 갖춰졌는지 확인만 합니다.
 *
 * 하위 명령에 넘기는 기본값은 `scripts/bench-shared/defaults.mjs`에서 읽습니다. 하위 명령도 같은
 * 상수를 쓰므로 공통 실행과 따로 실행이 어긋나지 않습니다.
 */
import { hasFlag, readArg, readPositiveInt } from '../bench-shared/args.mjs';
import { FONTS_DEFAULT_RUNS, MCP_LIST_DEFAULT_RUNS, MCP_LIST_DEFAULT_SIZES } from '../bench-shared/defaults.mjs';
import { TOOLS } from '../bench-shared/result.mjs';

/** 빌드 순서입니다. 앞의 항목이 뒤의 항목에 필요하므로 이 순서대로 전달합니다. */
const PACKAGE_ORDER = Object.freeze(['@omdc-slipkit/core', '@omdc-slipkit/elements', '@omdc-slipkit/mcp']);

/**
 * 하위 실행을 정의합니다. 아래에 적힌 순서대로 실행합니다.
 *
 * `packages`는 각 성능 측정에 필요한 빌드 대상이고, `needs`는 빌드 뒤에 있어야 하는 산출물입니다.
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
    // 되돌리기 스냅샷의 heapUsed 차이를 측정하려면 gc()가 필요합니다. 없으면 스스로 다시 실행합니다.
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
    // MCP 패키지가 Core·Elements에 기대므로 셋을 함께 빌드합니다.
    packages: ['@omdc-slipkit/core', '@omdc-slipkit/elements', '@omdc-slipkit/mcp'],
    needs: ['packages/core/dist/index.js', 'packages/mcp/dist/index.js'],
    args: (options) => ['--sizes', options.mcpSizes, '--runs', String(options.mcpRuns)],
  },
]);

/**
 * 쉼표로 구분한 성능 측정 이름 목록을 읽습니다.
 *
 * @param {string[]} argv - 인자 배열
 * @param {string} name - 인자 이름 (`--` 포함)
 * @returns {string[]} 성능 측정 이름 목록. 인자가 없으면 빈 배열
 * @throws Error 알 수 없는 이름이 있을 때
 */
function parseToolList(argv, name) {
  const raw = readArg(argv, name);
  if (raw === undefined) return [];
  const names = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  const unknown = names.filter((value) => !TOOLS.includes(value));
  if (unknown.length > 0) throw new Error(`${name}에 알 수 없는 성능 측정 이름이 있습니다: ${unknown.join(', ')}`);
  return names;
}

/**
 * 공통 실행의 옵션을 읽습니다. 하위 명령에 넘길 값은 하위 명령의 기본값을 그대로 씁니다.
 *
 * @param {string[]} argv - 인자 배열 (`process.argv.slice(2)`)
 * @returns {{ out: string | undefined, baselines: string | undefined, useBaseline: boolean,
 *   designerChromium: boolean, fontsRuns: number, fontsSkipChromium: boolean, mcpSizes: string,
 *   mcpRuns: number, only: string[], skip: string[] }} 옵션
 * @throws Error 값이 형식에 맞지 않거나 알 수 없는 성능 측정 이름일 때
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
 * 옵션대로 돌릴 하위 실행을 고르고 넘길 인자까지 만듭니다.
 *
 * @param {ReturnType<typeof parseOptions>} options - 공통 실행 옵션
 * @returns {Array<{ tool: string, script: string, execArgv: string[], packages: string[],
 *   needs: string[], args: string[] }>} 하위 실행 목록
 * @throws Error 선택한 성능 측정이 하나도 없을 때
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
  if (runs.length === 0) throw new Error('실행할 성능 측정이 없습니다. --only와 --skip을 확인하세요.');
  return runs;
}

/**
 * 고른 하위 실행이 쓰는 빌드 대상을 모읍니다. 의존 순서대로 겹치지 않게 반환합니다.
 *
 * @param {Array<{ packages: string[] }>} runs - `selectRuns` 결과
 * @returns {string[]} pnpm 필터에 넣을 패키지 이름
 */
export function buildTargets(runs) {
  const wanted = new Set(runs.flatMap((run) => run.packages));
  return PACKAGE_ORDER.filter((name) => wanted.has(name));
}

/**
 * 빌드 한 번으로 끝내는 pnpm 인자를 만듭니다.
 *
 * @param {string[]} packages - `buildTargets` 결과
 * @returns {string[]} pnpm에 넘길 인자
 * @throws Error 빌드 대상이 비었을 때
 */
export function buildCommandArgs(packages) {
  if (packages.length === 0) throw new Error('빌드할 패키지가 없습니다.');
  return [...packages.flatMap((name) => ['--filter', name]), 'run', 'build'];
}

/**
 * 선택한 하위 실행 중 기준선이 없는 성능 측정을 찾습니다.
 *
 * @param {Array<{ tool: string }>} runs - `selectRuns` 결과
 * @param {Map<string, unknown>} baselines - `loadBaselines` 결과
 * @returns {string[]} 기준선이 없는 성능 측정 이름
 */
export function missingBaselineTools(runs, baselines) {
  return runs.map((run) => run.tool).filter((tool) => !baselines.has(tool));
}
