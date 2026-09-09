/**
 * 배포 코드에서 참조하지 않는 export를 찾는 순수 함수 모음입니다.
 *
 * knip의 기본 실행은 시험 파일도 프로젝트에 넣으므로 시험이 가져오기만 하면 "쓰는 export"가 됩니다.
 * `--production`으로 다시 실행하면 패키지 진입점과 `bin`에서 참조하는 항목만 남아, 시험 전용 export와 어디에서도
 * 사용하지 않는 export도 함께 드러납니다. 여기서는 그 목록을 아래 허용 목록과 대조합니다.
 *
 * export뿐 아니라 **어디에서도 참조하지 않는 파일**도 함께 확인합니다. 시험에서만 가져오는 `src` 파일은 기본 실행에서
 * 쓰이는 것으로 나오므로 `--production` 실행에서 파일 검사 결과를 제외하면 발견할 수 없습니다.
 *
 * 허용 목록은 항목마다 이름·이유·그 이름을 실제로 쓰는 파일을 적습니다. 디렉터리 전체나 종류 전체를
 * 적용하는 포괄 예외는 두지 않습니다. 목록에 없는 문제는 미사용 코드로 보고 실패하고, 문제가 사라진 항목은
 * 더는 필요하지 않은 예외로 보고 함께 실패합니다.
 */

/** 배포 코드에서 참조하지 않아도 되는 export입니다. 각 항목에 사용 파일과 이유를 적습니다. */
export const PRODUCTION_EXPORT_ALLOWLIST = [
  {
    file: 'packages/core/src/formula/parser.ts',
    name: 'MAX_FORMULA_DEPTH',
    usedBy: 'packages/core/test/formula-arity.test.ts',
    reason: '시험에서 수식 중첩 한도를 직접 읽어 경계값을 만듭니다.',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'NUDGE_STEP_MM',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '시험에서 방향키 이동 단위를 직접 읽어 이동 결과를 계산합니다.',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'NUDGE_STEP_LARGE_MM',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '시험에서 Shift 이동 단위를 직접 읽어 이동 결과를 계산합니다.',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'elementBox',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '요소 경계 상자 계산을 화면 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'unionBox',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '여러 요소를 선택했을 때의 전체 경계 계산을 화면 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/arrange.ts',
    name: 'clampMoveDelta',
    usedBy: 'packages/elements/test/designer/arrange.test.ts',
    reason: '용지 경계를 넘지 않도록 이동량을 제한하는 계산을 화면 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/color-picker.ts',
    name: 'CUSTOM_COLORS_KEY',
    usedBy: 'packages/elements/test/designer/color.test.ts',
    reason: '시험에서 브라우저 저장소 키를 직접 만들어 저장 형식을 확인합니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/color-picker.ts',
    name: 'loadCustomColors',
    usedBy: 'packages/elements/test/designer/color.test.ts',
    reason: '컨트롤러 없이 색 목록 읽기를 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/color-picker.ts',
    name: 'saveCustomColor',
    usedBy: 'packages/elements/test/designer/color.test.ts',
    reason: '컨트롤러 없이 색 목록 저장과 중복 제거를 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/history.ts',
    name: 'MAX_SNAPSHOT_CHARS',
    usedBy: 'packages/elements/test/designer/history-budget.test.ts',
    reason: '시험에서 되돌리기 스냅샷 길이 상한을 직접 읽어 상한을 넘는 문서를 만듭니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/font-registry.ts',
    name: 'browserFontFaceAdapter',
    usedBy: 'packages/elements/test/designer/font-registry.test.ts',
    reason: '브라우저 FontFace 어댑터를 대체 구현으로 바꿔 등록 절차를 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/formula-draft.ts',
    name: 'columnSuggestion',
    usedBy: 'packages/elements/test/designer/formula-references.test.ts',
    reason: '수식 편집의 열 참조 제안 문자열을 모달 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/controllers/sample-draft.ts',
    name: 'parseSampleValues',
    usedBy: 'packages/elements/test/designer/dialogs-controller.test.ts',
    reason: '샘플 값 입력 해석을 모달 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/font-variant.ts',
    name: 'resolveVariantFontName',
    usedBy: 'packages/elements/test/designer/font-variant.test.ts',
    reason: '굵게·기울임 변형 폰트 선택을 캔버스 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/formula-check.ts',
    name: 'FormulaCheckStatus',
    usedBy: 'packages/elements/test/designer/formula-warning.test.ts',
    reason: '시험에서 검사 결과 상태 타입을 사용해 목록을 만듭니다.',
  },
  {
    file: 'packages/elements/src/designer/formula-warning.ts',
    name: 'warningCellKey',
    usedBy: 'packages/elements/test/designer/formula-warning.test.ts',
    reason: '경고와 셀을 연결하는 키 규칙을 화면 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/geometry.ts',
    name: 'SNAP_MM',
    usedBy: 'packages/elements/test/designer/geometry.test.ts',
    reason: '시험에서 맞춤 간격을 직접 읽어 간격에 맞는 위치를 만듭니다.',
  },
  {
    file: 'packages/elements/src/designer/grid-border.ts',
    name: 'hasLegacyGridBorder',
    usedBy: 'packages/elements/test/designer/grid-border.test.ts',
    reason: '이전 테두리 설정을 판별하는 동작을 화면 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/grid-model.ts',
    name: 'clampGridSpans',
    usedBy: 'packages/elements/test/designer/grid-model.test.ts',
    reason: '병합 범위를 그리드 크기에 맞게 제한하는 계산을 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/grid-model.ts',
    name: 'BAND_PLACEMENT_ORDER',
    usedBy: 'packages/elements/test/designer/grid-model.test.ts',
    reason: '시험에서 행 구간 역할의 정렬 순서를 직접 읽어 결과와 비교합니다.',
  },
  {
    file: 'packages/elements/src/designer/own-map.ts',
    name: 'entriesOwn',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '`__proto__` 같은 키를 객체 자체의 속성으로 다루는지 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/parameters.ts',
    name: 'renameSampleFieldKey',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '하위 필드 키를 바꿀 때 샘플 값도 함께 바뀌는지 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/render/canvas.ts',
    name: 'gridCellPreviewText',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '셀 미리보기 문자열을 캔버스 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/designer/render/canvas.ts',
    name: 'gridCellMergeText',
    usedBy: 'packages/elements/test/designer/sample-keys.test.ts',
    reason: '자동 병합 표시 문자열을 캔버스 없이 시험합니다.',
  },
  {
    file: 'packages/elements/src/strings.ts',
    name: 'STRINGS',
    usedBy: 'packages/elements/test/strings-i18n.test.ts',
    reason: '시험에서 사전 전체를 읽어 세 언어 사전의 키가 같은지 확인합니다.',
  },
  {
    file: 'packages/mcp/src/cli-command.ts',
    name: 'HELP_TEXT',
    usedBy: 'packages/mcp/test/cli.test.ts',
    reason: '`--help` 출력이 도움말 본문과 같은지 시험합니다.',
  },
  {
    file: 'packages/mcp/src/cli-command.ts',
    name: 'parseCliArgs',
    usedBy: 'packages/mcp/test/cli.test.ts',
    reason: '서버를 시작하지 않고 인자 해석만 시험합니다.',
  },
  {
    file: 'packages/mcp/src/http.ts',
    name: 'createPdfLinkToken',
    usedBy: 'packages/mcp/test/http.test.ts',
    reason: '시험에서 서버가 발급하지 않은 토큰을 만들어 요청이 거부되는지 확인합니다.',
  },
  {
    file: 'packages/mcp/src/http.ts',
    name: 'startPdfLinkServer',
    usedBy: 'packages/mcp/test/http.test.ts',
    reason: '설정 파일과 CLI 없이 링크 서버 동작을 직접 시험합니다.',
  },
  {
    file: 'packages/mcp/src/list-cache.ts',
    name: 'MAX_LSTAT_CONCURRENCY',
    usedBy: 'packages/mcp/test/list-cache.test.ts',
    reason: '시험에서 동시 조회 상한을 직접 읽어 실제 동시 실행 수와 맞춥니다.',
  },
];

/** 배포 진입점에서 참조하지 않아도 되는 파일입니다. 각 항목에 이유를 적습니다. */
export const PRODUCTION_FILE_ALLOWLIST = [
  {
    file: 'packages/core/scripts/generate-json-schema.mjs',
    reason: '`pnpm --filter @omdc-slipkit/core schema` 명령에서만 실행하는 JSON Schema 재생성 도구이므로 패키지 진입점에서 참조하지 않습니다.',
  },
];

/** 허용 목록으로 다루는 export 검사 결과의 종류입니다. */
const EXPORT_KINDS = ['exports', 'types'];

/** 허용 목록으로 다루는 파일 검사 결과의 종류입니다. */
const FILE_KINDS = ['files'];

/**
 * `--production` 실행 결과에서 export 검사 결과만 남깁니다.
 *
 * @param findings - `collectFindings`가 펼친 검사 결과 목록
 * @returns 미사용 export·타입 export 검사 결과만 남긴 목록
 */
export function exportFindings(findings) {
  return findings.filter((finding) => EXPORT_KINDS.includes(finding.kind));
}

/**
 * `--production` 실행 결과에서 파일 검사 결과만 남깁니다.
 *
 * @param findings - `collectFindings`가 펼친 검사 결과 목록
 * @returns 미사용 파일 검사 결과만 남긴 목록
 */
export function fileFindings(findings) {
  return findings.filter((finding) => FILE_KINDS.includes(finding.kind));
}

/**
 * `--production`의 파일 검사 결과와 허용 목록을 대조합니다.
 *
 * @param findings - {@link fileFindings}의 결과
 * @param allowlist - 허용 목록 (기본값은 이 모듈의 목록)
 * @returns `unexpected`(허용 목록에 없는 결과), `stale`(더 필요 없거나 두 번 적은 항목)
 */
export function checkProductionFiles(findings, allowlist = PRODUCTION_FILE_ALLOWLIST) {
  const found = new Set(findings.map((finding) => finding.file));
  const unexpected = [];
  const stale = [];
  const seen = new Set();

  for (const entry of allowlist) {
    if (seen.has(entry.file)) {
      stale.push(`${entry.file}: 허용 목록에 두 번 적혀 있습니다.`);
      continue;
    }
    seen.add(entry.file);
    if (!found.has(entry.file)) {
      stale.push(`${entry.file}: 검사에서 더 이상 발견되지 않습니다. 허용 목록에서 제거해야 합니다.`);
    }
  }

  for (const finding of findings) {
    if (!seen.has(finding.file)) unexpected.push(finding);
  }
  return { unexpected, stale };
}

/**
 * `--production`의 export 검사 결과와 허용 목록을 대조합니다.
 *
 * @param findings - {@link exportFindings}의 결과
 * @param allowlist - 허용 목록 (기본값은 이 모듈의 목록)
 * @param hasName - `(file, name) => boolean` — 파일이 그 이름을 실제로 담고 있는지 확인하는 함수
 * @returns `unexpected`(허용 목록에 없는 결과), `stale`(더 필요 없거나 근거가 사라진 항목)
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
      stale.push(`${entry.name} — ${entry.file}: 허용 목록에 두 번 적혀 있습니다.`);
      continue;
    }
    seen.add(id);
    if (!found.has(id)) {
      stale.push(`${entry.name} — ${entry.file}: 검사에서 더 이상 발견되지 않습니다. 허용 목록에서 제거해야 합니다.`);
      continue;
    }
    if (!hasName(entry.usedBy, entry.name)) {
      stale.push(`${entry.name} — ${entry.file}: 근거로 적은 ${entry.usedBy}에서 이 이름을 사용하지 않습니다.`);
    }
  }

  for (const finding of findings) {
    if (!seen.has(key(finding.file, finding.name))) unexpected.push(finding);
  }
  return { unexpected, stale };
}

/** 문제가 없는 결과입니다. */
const EMPTY_RESULT = { unexpected: [], stale: [] };

/**
 * `--production` 검사 결과를 사람이 읽을 수 있는 요약으로 만듭니다.
 *
 * @param result - 검사 결과 묶음
 * @param result.exports - {@link checkProductionExports}의 결과
 * @param result.files - {@link checkProductionFiles}의 결과
 * @param formatFinding - 검사 결과 하나를 한 줄로 적는 함수
 * @returns stdout에 적을 문자열 (끝에 줄바꿈 없음)
 */
export function renderProductionReport({ exports = EMPTY_RESULT, files = EMPTY_RESULT }, formatFinding) {
  const lines = ['# 배포 코드 사용 여부 검사 (knip --production)', ''];
  const total =
    exports.unexpected.length + exports.stale.length + files.unexpected.length + files.stale.length;
  if (total === 0) {
    lines.push(
      `문제가 없습니다. 배포 코드에서 참조하지 않는 항목은 export 허용 목록 ${PRODUCTION_EXPORT_ALLOWLIST.length}건과 파일 허용 목록 ${PRODUCTION_FILE_ALLOWLIST.length}건뿐입니다.`,
    );
    return lines.join('\n');
  }
  if (files.unexpected.length > 0) {
    lines.push(`## 허용 목록에 없는 파일 (${files.unexpected.length}건)`, '');
    for (const finding of files.unexpected) lines.push(`- ${formatFinding(finding)}`);
    lines.push('', '패키지 진입점과 bin에서 참조하지 않는 파일입니다. 삭제하거나, 시험이나 명령에서만 사용하는 도구라면');
    lines.push('이유를 적어 scripts/verify-maintenance/production.mjs의 파일 허용 목록에 추가합니다.', '');
  }
  if (exports.unexpected.length > 0) {
    lines.push(`## 허용 목록에 없는 export (${exports.unexpected.length}건)`, '');
    for (const finding of exports.unexpected) lines.push(`- ${formatFinding(finding)}`);
    lines.push('', '배포 코드에서 참조하지 않는 export입니다. 삭제하거나 시험 전용이라면 이유와 사용하는 파일을 적어');
    lines.push('scripts/verify-maintenance/production.mjs의 허용 목록에 추가합니다.', '');
  }
  const stale = [...files.stale, ...exports.stale];
  if (stale.length > 0) {
    lines.push(`## 더 이상 필요하지 않은 허용 목록 (${stale.length}건)`, '');
    for (const message of stale) lines.push(`- ${message}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
