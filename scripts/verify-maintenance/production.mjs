/**
 * 제품 코드에서 닿지 않는 export를 가려내는 순수 함수 모음.
 *
 * knip의 기본 실행은 시험 파일도 프로젝트에 넣으므로 시험이 가져오기만 하면 "쓰는 export"가 된다.
 * `--production`으로 다시 돌리면 패키지 진입점·`bin`에서 닿는 것만 남아, 시험 전용 export와 아무도
 * 쓰지 않는 export가 함께 드러난다. 여기서는 그 목록을 아래 허용 목록과 맞춰 본다.
 *
 * 허용 목록은 항목마다 이름·까닭·그 이름을 실제로 쓰는 파일을 적는다. 디렉터리 전체나 종류 전체를
 * 여는 포괄 예외는 두지 않는다. 목록에 없는 지적은 죽은 코드로 보고 실패하고, 지적이 사라진 항목은
 * 낡은 예외로 보고 함께 실패한다.
 */

/** 제품 코드에서 닿지 않아도 되는 export — 항목마다 그 이름을 쓰는 파일과 까닭을 적는다. */
export const PRODUCTION_EXPORT_ALLOWLIST = [
  {
    file: 'packages/core/src/formula/parser.ts',
    name: 'MAX_FORMULA_DEPTH',
    usedBy: 'packages/core/test/formula-arity.test.ts',
    reason: '수식 중첩 한도를 시험이 그대로 읽어 경계값을 만든다',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'NUDGE_STEP_MM',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '방향키 이동 단위를 시험이 그대로 읽어 이동 결과를 계산한다',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'NUDGE_STEP_LARGE_MM',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: 'Shift 이동 단위를 시험이 그대로 읽어 이동 결과를 계산한다',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'elementBox',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '요소 경계 상자 계산을 화면 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'unionBox',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '복수 선택의 합친 경계 계산을 화면 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'clampMoveDelta',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '용지 경계에서 이동량을 자르는 계산을 화면 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/controllers/color-picker.ts',
    name: 'CUSTOM_COLORS_KEY',
    usedBy: 'packages/elements/test/designer/color.test.ts',
    reason: '시험이 브라우저 저장소 키를 직접 만들어 저장 형식을 확인한다',
  },
  {
    file: 'packages/elements/src/designer/controllers/color-picker.ts',
    name: 'loadCustomColors',
    usedBy: 'packages/elements/test/designer/color.test.ts',
    reason: '컨트롤러 없이 색 목록 읽기를 시험한다',
  },
  {
    file: 'packages/elements/src/designer/controllers/color-picker.ts',
    name: 'saveCustomColor',
    usedBy: 'packages/elements/test/designer/color.test.ts',
    reason: '컨트롤러 없이 색 목록 저장·중복 정리를 시험한다',
  },
  {
    file: 'packages/elements/src/designer/controllers/history.ts',
    name: 'MAX_SNAPSHOT_BYTES',
    usedBy: 'packages/elements/test/designer/history-budget.test.ts',
    reason: '되돌리기 기록의 바이트 상한을 시험이 그대로 읽어 상한을 넘기는 문서를 만든다',
  },
  {
    file: 'packages/elements/src/designer/controllers/font-registry.ts',
    name: 'browserFontFaceAdapter',
    usedBy: 'packages/elements/test/designer/font-registry.test.ts',
    reason: '브라우저 FontFace 어댑터를 가짜 구현으로 바꿔 등록 절차를 시험한다',
  },
  {
    file: 'packages/elements/src/designer/controllers/formula-draft.ts',
    name: 'columnSuggestion',
    usedBy: 'packages/elements/test/designer/formula-references.test.ts',
    reason: '수식 편집의 열 참조 제안 문자열을 모달 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/controllers/sample-draft.ts',
    name: 'parseSampleValues',
    usedBy: 'packages/elements/test/designer/dialogs-controller.test.ts',
    reason: '샘플 값 입력 해석을 모달 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/font-variant.ts',
    name: 'resolveVariantFontName',
    usedBy: 'packages/elements/test/designer/font-variant.test.ts',
    reason: '굵게·기울임 변형 폰트 선택을 캔버스 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/formula-check.ts',
    name: 'FormulaCheckStatus',
    usedBy: 'packages/elements/test/designer/formula-warning.test.ts',
    reason: '시험이 검사 결과 상태를 타입으로 받아 목록을 만든다',
  },
  {
    file: 'packages/elements/src/designer/formula-warning.ts',
    name: 'warningCellKey',
    usedBy: 'packages/elements/test/designer/formula-warning.test.ts',
    reason: '경고를 셀에 잇는 키 규칙을 화면 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/geometry.ts',
    name: 'SNAP_MM',
    usedBy: 'packages/elements/test/designer/geometry.test.ts',
    reason: '스냅 간격을 시험이 그대로 읽어 맞아떨어지는 위치를 만든다',
  },
  {
    file: 'packages/elements/src/designer/grid-border.ts',
    name: 'hasLegacyGridBorder',
    usedBy: 'packages/elements/test/designer/grid-border.test.ts',
    reason: '옛 테두리 설정 판정을 화면 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/grid-model.ts',
    name: 'clampGridSpans',
    usedBy: 'packages/elements/test/designer/grid-model.test.ts',
    reason: '병합 범위를 그리드 크기에 맞춰 자르는 계산을 시험한다',
  },
  {
    file: 'packages/elements/src/designer/grid-model.ts',
    name: 'BAND_PLACEMENT_ORDER',
    usedBy: 'packages/elements/test/designer/grid-model.test.ts',
    reason: '행 구간 역할의 정렬 순서를 시험이 그대로 읽어 결과와 맞춘다',
  },
  {
    file: 'packages/elements/src/designer/own-map.ts',
    name: 'entriesOwn',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '`__proto__` 같은 키를 자신의 속성으로 다루는지 시험한다',
  },
  {
    file: 'packages/elements/src/designer/parameters.ts',
    name: 'renameSampleFieldKey',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '하위 필드 키를 바꿀 때 샘플 값이 따라가는지 시험한다',
  },
  {
    file: 'packages/elements/src/designer/render/canvas.ts',
    name: 'gridCellPreviewText',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '셀 미리보기 문자열을 캔버스 없이 시험한다',
  },
  {
    file: 'packages/elements/src/designer/render/canvas.ts',
    name: 'gridCellMergeText',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '자동 병합 표시 문자열을 캔버스 없이 시험한다',
  },
  {
    file: 'packages/elements/src/strings.ts',
    name: 'STRINGS',
    usedBy: 'packages/elements/test/strings-i18n.test.ts',
    reason: '세 언어 사전의 키가 서로 같은지 시험이 사전 전체를 읽어 확인한다',
  },
  {
    file: 'packages/mcp/src/cli-command.ts',
    name: 'HELP_TEXT',
    usedBy: 'packages/mcp/test/cli.test.ts',
    reason: '`--help` 출력이 도움말 본문과 같은지 시험한다',
  },
  {
    file: 'packages/mcp/src/cli-command.ts',
    name: 'parseCliArgs',
    usedBy: 'packages/mcp/test/cli.test.ts',
    reason: '서버를 띄우지 않고 인자 해석만 시험한다',
  },
  {
    file: 'packages/mcp/src/http.ts',
    name: 'createPdfLinkToken',
    usedBy: 'packages/mcp/test/http.test.ts',
    reason: '시험이 서버가 발급하지 않은 토큰을 만들어 거부되는지 확인한다',
  },
  {
    file: 'packages/mcp/src/http.ts',
    name: 'startPdfLinkServer',
    usedBy: 'packages/mcp/test/http.test.ts',
    reason: '설정 파일과 CLI 없이 링크 서버 동작을 직접 시험한다',
  },
  {
    file: 'packages/mcp/src/list-cache.ts',
    name: 'MAX_LSTAT_CONCURRENCY',
    usedBy: 'packages/mcp/test/list-cache.test.ts',
    reason: '동시 조회 상한을 시험이 그대로 읽어 실제 동시 실행 수와 맞춘다',
  },
];

/** 허용 목록으로 다루는 지적 종류 — 파일·의존성 지적은 기본 실행이 이미 잡는다. */
const EXPORT_KINDS = ['exports', 'types'];

/**
 * production 실행 결과에서 export 지적만 남긴다.
 *
 * @param findings - `collectFindings`가 편 지적 목록
 * @returns 미사용 export·타입 export 지적만 남긴 목록
 */
export function exportFindings(findings) {
  return findings.filter((finding) => EXPORT_KINDS.includes(finding.kind));
}

/**
 * production 지적과 허용 목록을 맞춰 본다.
 *
 * @param findings - {@link exportFindings}의 결과
 * @param allowlist - 허용 목록 (기본값은 이 모듈의 목록)
 * @param hasName - `(file, name) => boolean` — 파일이 그 이름을 실제로 담고 있는지 확인하는 함수
 * @returns `unexpected`(허용 목록에 없는 지적), `stale`(더 필요 없거나 근거가 사라진 항목)
 */
export function checkProductionExports(findings, allowlist = PRODUCTION_EXPORT_ALLOWLIST, hasName = () => true) {
  const key = (file, name) => `${file}::${name}`;
  const found = new Map(findings.map((finding) => [key(finding.file, finding.name), finding]));
  const unexpected = [];
  const stale = [];
  const seen = new Set();

  for (const entry of allowlist) {
    const id = key(entry.file, entry.name);
    if (seen.has(id)) {
      stale.push(`${entry.name} — ${entry.file}: 허용 목록에 두 번 적혀 있다`);
      continue;
    }
    seen.add(id);
    if (!found.has(id)) {
      stale.push(`${entry.name} — ${entry.file}: 더 이상 지적되지 않는다 (허용 목록에서 지운다)`);
      continue;
    }
    if (!hasName(entry.usedBy, entry.name)) {
      stale.push(`${entry.name} — ${entry.file}: 근거로 적은 ${entry.usedBy}가 이 이름을 쓰지 않는다`);
    }
  }

  for (const finding of findings) {
    if (!seen.has(key(finding.file, finding.name))) unexpected.push(finding);
  }
  return { unexpected, stale };
}

/**
 * production 검사 결과를 사람이 읽는 요약으로 만든다.
 *
 * @param result - {@link checkProductionExports}의 결과
 * @param formatFinding - 지적 하나를 한 줄로 적는 함수
 * @returns stdout에 적을 문자열 (끝에 줄바꿈 없음)
 */
export function renderProductionReport({ unexpected, stale }, formatFinding) {
  const lines = ['# 제품 코드 도달 검사 (knip --production)', ''];
  if (unexpected.length === 0 && stale.length === 0) {
    lines.push(`지적 0건 — 제품 코드에서 닿지 않는 export는 허용 목록 ${PRODUCTION_EXPORT_ALLOWLIST.length}건뿐이다.`);
    return lines.join('\n');
  }
  if (unexpected.length > 0) {
    lines.push(`## 허용 목록에 없는 export (${unexpected.length}건)`, '');
    for (const finding of unexpected) lines.push(`- ${formatFinding(finding)}`);
    lines.push('', '제품 코드에서 닿지 않는 export다. 지우거나, 시험 전용이면 까닭과 쓰는 파일을 적어');
    lines.push('scripts/verify-maintenance/production.mjs의 허용 목록에 넣는다.', '');
  }
  if (stale.length > 0) {
    lines.push(`## 낡은 허용 목록 항목 (${stale.length}건)`, '');
    for (const message of stale) lines.push(`- ${message}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
