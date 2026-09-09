/**
 * knip 보고서(JSON)를 사람이 읽을 수 있는 요약으로 바꾸는 순수 함수 모음입니다.
 *
 * knip은 파일 하나마다 종류별 배열을 담은 항목을 반환합니다. 여기서는 그 구조를 종류별 목록으로
 * 펴고, 항상 같은 순서로 정렬해 같은 입력이면 같은 문자열이 나오게 합니다.
 */

/** 검사 결과 종류의 한국어 이름입니다. 여기에 없는 종류는 knip의 이름을 그대로 사용합니다. */
const KIND_LABELS = {
  files: '미사용 파일',
  dependencies: '미사용 의존성',
  devDependencies: '미사용 개발 의존성',
  optionalPeerDependencies: '미사용 optional peer 의존성',
  unlisted: 'package.json에 없는 의존성',
  unresolved: '해석되지 않은 import',
  exports: '미사용 export',
  types: '미사용 타입 export',
  nsExports: '미사용 네임스페이스 export',
  nsTypes: '미사용 네임스페이스 타입',
  namespaceMembers: '미사용 네임스페이스 멤버',
  enumMembers: '미사용 enum 멤버',
  classMembers: '미사용 클래스 멤버',
  duplicates: '중복 export',
  binaries: '미사용 실행 파일',
  catalog: '미사용 catalog 항목',
  catalogReferences: '어긋난 catalog 참조',
};

/** 보고 순서입니다. 심각도가 높은 항목을 앞에 두고, 목록에 없는 종류는 뒤에 이름순으로 표시합니다. */
const KIND_ORDER = [
  'files',
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'unlisted',
  'unresolved',
  'exports',
  'types',
  'duplicates',
];

/**
 * 검사 결과 종류의 표시 이름을 반환합니다.
 *
 * @param {string} kind - knip이 쓰는 종류 이름
 * @returns {string} 한국어 이름. 등록되지 않은 종류이면 받은 이름 그대로
 */
export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * 종류를 보고 순서로 정렬할 때 쓸 값을 반환합니다.
 *
 * @param {string} kind - knip이 쓰는 종류 이름
 * @returns {number} 정렬 값 (작을수록 앞)
 */
function kindRank(kind) {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

/**
 * knip JSON 보고서를 검사 결과 목록으로 펼칩니다.
 *
 * @param {unknown} report - `knip --reporter json`의 출력을 파싱한 객체
 * @returns {Array<{ kind: string, file: string, name: string, line?: number, col?: number }>} 종류·파일·이름 순으로 정렬한 검사 결과 목록
 * @throws {Error} 보고서에 `issues` 배열이 없을 때
 */
export function collectFindings(report) {
  if (report === null || typeof report !== 'object' || !Array.isArray(report.issues)) {
    throw new Error('knip 보고서에 issues 배열이 없습니다.');
  }
  const findings = [];
  for (const entry of report.issues) {
    const file = typeof entry.file === 'string' ? entry.file : '';
    for (const [kind, value] of Object.entries(entry)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const name = typeof item === 'string' ? item : (item.name ?? item.symbol ?? '');
        const finding = { kind, file, name: String(name) };
        if (typeof item === 'object' && item !== null) {
          if (typeof item.line === 'number') finding.line = item.line;
          if (typeof item.col === 'number') finding.col = item.col;
        }
        findings.push(finding);
      }
    }
  }
  findings.sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      a.kind.localeCompare(b.kind) ||
      a.file.localeCompare(b.file) ||
      a.name.localeCompare(b.name),
  );
  return findings;
}

/**
 * 검사 결과를 종류별로 묶습니다.
 *
 * @param {Array<{ kind: string, file: string, name: string }>} findings - `collectFindings`의 결과
 * @returns {Array<{ kind: string, label: string, items: object[] }>} 보고 순서를 지킨 종류별 묶음
 */
export function groupByKind(findings) {
  const groups = [];
  for (const finding of findings) {
    let group = groups.find((candidate) => candidate.kind === finding.kind);
    if (group === undefined) {
      group = { kind: finding.kind, label: kindLabel(finding.kind), items: [] };
      groups.push(group);
    }
    group.items.push(finding);
  }
  return groups;
}

/**
 * 검사 결과 하나를 한 줄로 표시합니다.
 *
 * @param {{ kind: string, file: string, name: string, line?: number, col?: number }} finding - 검사 결과 하나
 * @returns {string} `이름 — 파일:줄:열` 형식입니다. 파일 자체가 문제이면 파일 경로만 반환합니다.
 */
export function formatFinding(finding) {
  const place = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}:${finding.col ?? 0}`;
  if (finding.kind === 'files' || finding.name === '' || finding.name === finding.file) return place;
  return `${finding.name} — ${place}`;
}

/**
 * 요약 보고서를 만듭니다.
 *
 * @param {Array<{ kind: string, file: string, name: string, line?: number, col?: number }>} findings - `collectFindings`의 결과
 * @returns {string} stdout에 적을 문자열 (끝에 줄바꿈 없음)
 */
export function renderReport(findings) {
  const lines = ['# 저장소 정적 검사 (knip)', ''];
  if (findings.length === 0) {
    lines.push('문제가 없습니다. 미사용 파일·export·의존성을 찾지 못했습니다.');
    return lines.join('\n');
  }

  const groups = groupByKind(findings);
  lines.push('| 종류 | 건수 |', '|---|---:|');
  for (const group of groups) lines.push(`| ${group.label} | ${group.items.length} |`);
  lines.push(`| **합계** | **${findings.length}** |`, '');

  for (const group of groups) {
    lines.push(`## ${group.label} (${group.items.length}건)`, '');
    for (const item of group.items) lines.push(`- ${formatFinding(item)}`);
    lines.push('');
  }
  lines.push('knip.jsonc에 진입점을 지정하거나 문제가 있는 항목을 삭제한 뒤 다시 실행하세요.');
  return lines.join('\n').trimEnd();
}
