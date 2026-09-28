import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPE_DIRECTORIES = new Map([
  ['SYS', '00-common'],
  ['SCR', '10-screen'],
  ['FNC', '20-function'],
  ['DAT', '30-data'],
  ['IF', '40-interface'],
  ['ERR', '50-error'],
]);

const REQUIRED_DIRECTORIES = [
  '_templates',
  'assets',
  ...TYPE_DIRECTORIES.values(),
  '90-management',
];

const REQUIRED_TEMPLATES = [
  'common.md',
  'screen.md',
  'function.md',
  'data.md',
  'interface.md',
  'error.md',
  'management.md',
];

const DESIGN_ID = /^(SYS|SCR|FNC|DAT|IF|ERR)-\d{3}$/;
const REGISTER_ROW = /^\|\s*((?:SYS|SCR|FNC|DAT|IF|ERR)-\d{3})\s*\|/;
const ALLOWED_STATUSES = new Set(['예정', '작성 중', '작성 완료', '검토 완료']);
const MERMAID_DECLARATION = /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram)\b/;

function markdownFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
  }
  return files.sort();
}

function relative(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function parseRegister(source) {
  const entries = [];
  for (const line of source.split('\n')) {
    if (!REGISTER_ROW.test(line)) continue;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    entries.push({
      id: cells[0],
      title: cells[1],
      file: cells[2].replaceAll('`', ''),
      status: cells[3],
      evidence: cells[4],
    });
  }
  return entries;
}

function validateSectionOrder(file, source, errors) {
  const headings = [...source.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
  if (headings[0] !== '개요' || headings[1] !== '변경 이력') {
    errors.push(`${file}: 제목 뒤 첫 두 절은 '개요', '변경 이력' 순서여야 합니다.`);
  }
  const titles = [...source.matchAll(/^#\s+(.+?)\s*$/gm)];
  if (titles.length !== 1) errors.push(`${file}: 최상위 제목은 하나여야 합니다.`);
}

function validateHistory(file, source, errors) {
  const updated = source.match(/^최종 갱신:\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
  if (updated === undefined) {
    errors.push(`${file}: '최종 갱신: YYYY-MM-DD'가 필요합니다.`);
    return;
  }
  const dates = [...source.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|/gm)].map((match) => match[1]);
  if (!dates.includes(updated)) errors.push(`${file}: 최종 갱신 날짜 ${updated}의 변경 이력이 없습니다.`);
  const duplicates = dates.filter((date, index) => dates.indexOf(date) !== index);
  if (duplicates.length > 0) {
    errors.push(`${file}: 같은 날짜의 변경 이력이 중복됩니다: ${[...new Set(duplicates)].join(', ')}`);
  }
}

function validateLinks(file, source, errors) {
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    if (target === '' || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const withoutFragment = target.split('#', 1)[0].split('?', 1)[0];
    if (withoutFragment === '') continue;
    let decoded;
    try {
      decoded = decodeURIComponent(withoutFragment);
    } catch {
      errors.push(`${file}: 링크 경로를 해석할 수 없습니다: ${target}`);
      continue;
    }
    const resolved = decoded.startsWith('/')
      ? path.resolve(decoded.slice(1))
      : path.resolve(path.dirname(file), decoded);
    if (!existsSync(resolved)) errors.push(`${file}: 링크 대상이 없습니다: ${target}`);
  }
}

function validateMermaid(file, source, errors) {
  const openings = [...source.matchAll(/^```mermaid\s*$/gm)].length;
  const blocks = [...source.matchAll(/^```mermaid\s*\n([\s\S]*?)^```\s*$/gm)];
  if (openings !== blocks.length) errors.push(`${file}: 닫히지 않은 Mermaid 코드 블록이 있습니다.`);
  for (const block of blocks) {
    const declaration = block[1].split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    if (!MERMAID_DECLARATION.test(declaration)) {
      errors.push(`${file}: 지원하지 않는 Mermaid 다이어그램 선언입니다: ${declaration || '(비어 있음)'}`);
    }
  }
}

/**
 * 기본설계 디렉터리의 구조, 등록부와 Markdown 연결을 검사합니다.
 *
 * @param {string} repoRoot - 저장소 루트 경로
 * @returns {string[]} 발견한 오류 목록
 */
export function verifyDesignDocs(repoRoot = process.cwd()) {
  const errors = [];
  const designRoot = path.join(repoRoot, 'docs', 'design');
  for (const directory of REQUIRED_DIRECTORIES) {
    const target = path.join(designRoot, directory);
    if (!existsSync(target)) errors.push(`docs/design/${directory}: 필수 디렉터리가 없습니다.`);
  }
  for (const template of REQUIRED_TEMPLATES) {
    const target = path.join(designRoot, '_templates', template);
    if (!existsSync(target)) errors.push(`docs/design/_templates/${template}: 필수 템플릿이 없습니다.`);
  }

  const registerPath = path.join(designRoot, '90-management', 'design-register.md');
  if (!existsSync(registerPath)) {
    errors.push('docs/design/90-management/design-register.md: 설계 대상 등록부가 없습니다.');
    return errors;
  }
  const entries = parseRegister(readFileSync(registerPath, 'utf8'));
  if (entries.length < 50 || entries.length > 80) {
    errors.push(`설계 대상은 50~80개여야 합니다. 현재 ${entries.length}개입니다.`);
  }

  const seenIds = new Set();
  const seenFiles = new Set();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) errors.push(`설계 대상 등록부: 식별자 ${entry.id}가 중복됩니다.`);
    if (seenFiles.has(entry.file)) errors.push(`설계 대상 등록부: 파일 ${entry.file}이 중복됩니다.`);
    seenIds.add(entry.id);
    seenFiles.add(entry.file);

    const prefix = entry.id.split('-', 1)[0];
    const directory = TYPE_DIRECTORIES.get(prefix);
    const expectedStart = `docs/design/${directory}/${entry.id}-`;
    if (!DESIGN_ID.test(entry.id) || !entry.file.startsWith(expectedStart) || !entry.file.endsWith('.md')) {
      errors.push(`설계 대상 등록부: ${entry.id}의 파일 경로가 문서 유형과 맞지 않습니다: ${entry.file}`);
    }
    if (!ALLOWED_STATUSES.has(entry.status)) {
      errors.push(`설계 대상 등록부: ${entry.id}의 상태가 올바르지 않습니다: ${entry.status}`);
    }
    if (entry.title === '' || entry.evidence === '') {
      errors.push(`설계 대상 등록부: ${entry.id}의 대상 이름과 근거가 필요합니다.`);
    }
    const exists = existsSync(path.join(repoRoot, entry.file));
    if (entry.status === '예정' && exists) {
      errors.push(`설계 대상 등록부: ${entry.id} 파일이 있으므로 상태를 '예정'에서 변경해야 합니다.`);
    } else if (entry.status !== '예정' && !exists) {
      errors.push(`설계 대상 등록부: ${entry.id}의 파일이 없습니다: ${entry.file}`);
    }
  }

  const templateRoot = path.join(designRoot, '_templates');
  for (const file of markdownFiles(templateRoot)) {
    validateSectionOrder(relative(repoRoot, file), readFileSync(file, 'utf8'), errors);
  }

  for (const file of markdownFiles(designRoot).filter((target) => !target.startsWith(`${templateRoot}${path.sep}`))) {
    const source = readFileSync(file, 'utf8');
    const label = relative(repoRoot, file);
    validateSectionOrder(label, source, errors);
    validateHistory(label, source, errors);
    validateLinks(file, source, errors);
    validateMermaid(label, source, errors);
  }

  for (const [prefix, directory] of TYPE_DIRECTORIES) {
    const categoryRoot = path.join(designRoot, directory);
    for (const file of markdownFiles(categoryRoot)) {
      const basename = path.basename(file);
      const id = basename.match(/^((?:SYS|SCR|FNC|DAT|IF|ERR)-\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/)?.[1];
      const label = relative(repoRoot, file);
      if (id === undefined) {
        errors.push(`${label}: 파일명이 식별자-영문-이름.md 형식이 아닙니다.`);
        continue;
      }
      if (!id.startsWith(`${prefix}-`)) errors.push(`${label}: 식별자와 디렉터리 유형이 다릅니다.`);
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry === undefined) {
        errors.push(`${label}: 설계 대상 등록부에 ${id}가 없습니다.`);
        continue;
      }
      if (entry.file !== label) errors.push(`${label}: 등록부의 파일 경로 ${entry.file}과 다릅니다.`);
      const titleId = readFileSync(file, 'utf8').match(/^#\s+((?:SYS|SCR|FNC|DAT|IF|ERR)-\d{3})\b/m)?.[1];
      if (titleId !== id) errors.push(`${label}: 제목의 식별자 ${titleId ?? '(없음)'}가 파일명과 다릅니다.`);
    }
  }

  return errors;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = verifyDesignDocs();
  if (errors.length > 0) {
    console.error(`기본설계 문서 검증에 실패했습니다 (${errors.length}건).`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('기본설계 문서 검증을 통과했습니다.');
  }
}
