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
const SCREEN_SECTIONS = [
  '설계 범위',
  '진입·종료 조건',
  '화면 이미지',
  '화면 구성',
  '이벤트와 호출 기능',
  '상태별 표시',
  '입력 검증과 오류 표시',
  '화면 전이',
  '관련 데이터·인터페이스·오류',
  '근거',
];

const SCREEN_TABLE_HEADERS = [
  '| 번호 | 화면 항목 | 위치와 표시 내용 | 동작과 조건 | 상세 설계 |',
  '| 번호·화면 항목 | 사용자 동작 | 동작과 결과 | 관련 기능 |',
  '| 상태 | 시작 조건 | 화면 표시 | 가능한 다음 동작 |',
  '| 발생 위치 | 발생 조건 | 표시 방법 | 처리와 복구 |',
  '| 사용자 동작 | 화면 변화 | 유지하는 내용 | 초기화하는 내용 |',
];

const SCREEN_IMPLEMENTATION_TERMS = [
  /\`src\`/,
  /\`storage\`/,
  /\`iframe\`/,
  /\`kind(?:\s*:[^\`]+)?\`/,
  /\`role(?:=[^\`]+)?\`/,
  /\`slip-change\`/,
  /\`slip-issue\`/,
  /\`reset\(\)\`/,
  /\`(?:save|list|delete|removeItem)\`/,
  /\`(?:StorageAdapter|renderSlip)\`/,
  /\`alertdialog\`/,
];

const FUNCTION_SECTIONS = [
  '호출 조건',
  '입력·출력',
  '사전·사후 조건',
  '정상 처리 흐름',
  '분기와 예외 흐름',
  '데이터 조회·변경',
  '하위 기능과 시퀀스',
  '오류·복구',
  '동시 실행·반복 호출',
  '검증 기준',
  '관련 설계와 근거',
];

const DATA_SECTIONS = [
  '소유 계층',
  '구조와 주요 항목',
  '데이터 관계',
  '불변 조건',
  '생명주기',
  '버전·검증·정규화·마이그레이션',
  '관련 설계와 근거',
];

const INTERFACE_SECTIONS = [
  '제공자와 소비자',
  '호출 방향과 사용 조건',
  '동기·비동기 처리',
  '생명주기',
  '반복 호출·동시 호출',
  '오류 처리',
  '호환성·보안·확장 경계',
  '관련 설계와 근거',
];

const FUNCTION_FLOW_HEADER = '| 순서 | 처리 | 읽는 값 | 만드는 값·변경하는 값 | 다음 단계 |';
const DATA_STRUCTURE_HEADER = '| 경로 | 자료형 | 필수 여부 | 기본값 | 허용 범위·형식 | 의미 |';
const DATA_RELATION_HEADER = '| 기준 데이터 | 대상 데이터 | 관계·개수 | 연결 키 | 삭제·변경 시 처리 |';

const ERROR_TABLE_HEADERS = [
  '| 오류 식별자·종류 | 판정 조건 | 검출 위치 | 포함 정보 |',
  '| 검출 계층 | 전달 대상 | 전달 방식 | 변환·숨김 규칙 |',
  '| 오류 종류 | 보존하는 값 | 되돌리는 값 | 사용자의 복구 절차 | 자동 재시도·기록 |',
];

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

function markdownTableRows(section) {
  return section
    .split('\n')
    .filter((line) => /^\|.+\|\s*$/.test(line))
    .filter((line) => !/^\|\s*-/.test(line));
}

function sectionBody(source, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const section = new RegExp(`^## ${escaped}\\s*$`, 'm').exec(source);
  if (section === null) return '';
  const start = section.index + section[0].length;
  const next = /^##\s+/m.exec(source.slice(start));
  const end = next === null ? source.length : start + next.index;
  return source.slice(start, end);
}

function tableCells(row) {
  return row.slice(1, row.endsWith('|') ? -1 : undefined).split('|').map((cell) => cell.trim());
}

function annotatedImageNumbers(file, imageBody) {
  const numbers = new Set();
  for (const match of imageBody.matchAll(/!\[[^\]]*\]\(([^)]+-annotated\.png)\)/g)) {
    const target = decodeURIComponent(match[1].trim());
    const absolute = path.resolve(path.dirname(file), target);
    if (!existsSync(absolute)) continue;
    const svgSource = absolute.replace(/\.png$/, '.svg');
    if (!existsSync(svgSource)) continue;
    const svg = readFileSync(svgSource, 'utf8');
    for (const number of svg.matchAll(/<text\b[^>]*>\s*(\d+)\s*<\/text>/g)) {
      numbers.add(Number(number[1]));
    }
  }
  return numbers;
}

function validateScreenDesign(file, label, source, errors) {
  const headings = [...source.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
  let previous = 1;
  for (const section of SCREEN_SECTIONS) {
    const index = headings.indexOf(section);
    if (index < 0) {
      errors.push(`${label}: 화면 설계 필수 절 '${section}'이 없습니다.`);
      continue;
    }
    if (index <= previous) errors.push(`${label}: 화면 설계 절 '${section}'의 순서가 올바르지 않습니다.`);
    previous = index;
  }

  const id = source.match(/^#\s+(SCR-\d{3})\b/m)?.[1];
  const imageBody = sectionBody(source, '화면 이미지');
  if (id !== undefined && !new RegExp(`!\\[[^\\]]*\\]\\([^)]*${id}[^)]*-annotated\\.png\\)`).test(imageBody)) {
    errors.push(`${label}: 화면 번호와 설명을 연결한 ${id} 주석 PNG가 필요합니다.`);
  }

  for (const header of SCREEN_TABLE_HEADERS) {
    if (!source.includes(header)) errors.push(`${label}: 화면 설계 표 머리말이 없습니다: ${header}`);
  }

  for (const section of SCREEN_SECTIONS.slice(3, 8)) {
    const rows = markdownTableRows(sectionBody(source, section));
    if (rows.length < 2) errors.push(`${label}: '${section}' 표에는 내용 행이 하나 이상 필요합니다.`);
  }

  const configurationRows = markdownTableRows(sectionBody(source, '화면 구성')).slice(1);
  const configurationNumbers = configurationRows.map((row) => Number(tableCells(row)[0]));
  const expectedNumbers = configurationNumbers.map((_, index) => index + 1);
  if (configurationNumbers.some((number) => !Number.isInteger(number)) ||
      configurationNumbers.some((number, index) => number !== expectedNumbers[index])) {
    errors.push(`${label}: 화면 구성 번호는 1부터 빠짐없이 순서대로 적습니다.`);
  }
  const imageNumbers = annotatedImageNumbers(file, imageBody);
  for (const number of expectedNumbers) {
    if (!imageNumbers.has(number)) {
      errors.push(`${label}: 화면 구성 ${number}번을 표시한 주석 이미지 번호가 없습니다.`);
    }
  }

  const eventRows = markdownTableRows(sectionBody(source, '이벤트와 호출 기능')).slice(1);
  for (const row of eventRows) {
    const cells = tableCells(row);
    const eventNumber = Number((cells[0] ?? '').match(/^(\d+)\b/)?.[1]);
    if (!Number.isInteger(eventNumber) || !configurationNumbers.includes(eventNumber)) {
      errors.push(`${label}: 이벤트의 화면 항목은 화면 구성 번호로 시작해야 합니다: ${cells[0]}`);
    }
    if (/[·]|거나|이전 또는 다음/.test(cells[1] ?? '')) {
      errors.push(`${label}: 사용자 동작은 한 행에 하나만 적습니다: ${cells[1]}`);
    }
  }

  const behavioralSource = source.split(/^## 근거\s*$/m, 1)[0];
  if (behavioralSource.includes('실행할 수 없습니다')) {
    errors.push(`${label}: 실행 조건은 별도 금지 문장 대신 동작과 결과에 함께 적습니다.`);
  }
  for (const term of SCREEN_IMPLEMENTATION_TERMS) {
    const match = behavioralSource.match(term);
    if (match !== null) {
      errors.push(`${label}: 화면 동작 설명에는 구현 식별자를 직접 쓰지 않습니다: ${match[0]}`);
    }
  }
}

function validateRequiredSections(label, source, sections, errors) {
  const headings = new Set([...source.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]));
  for (const section of sections) {
    if (!headings.has(section)) errors.push(`${label}: 필수 절을 찾을 수 없습니다: '${section}'.`);
  }
}

function validateFunctionDesign(label, source, errors) {
  validateRequiredSections(label, source, FUNCTION_SECTIONS, errors);
  const inputBody = sectionBody(source, '입력·출력');
  const expected = '| 구분 | 항목 | 자료형·단위 | 필수 여부·기본값 | 제약과 보장 |';
  if (!inputBody.includes(expected)) errors.push(`${label}: 기능 입력·출력 표 머리말이 없습니다: ${expected}`);
  const flowRows = markdownTableRows(sectionBody(source, '정상 처리 흐름'));
  if (flowRows.length < 2 || flowRows[0] !== FUNCTION_FLOW_HEADER) {
    errors.push(`${label}: 정상 처리 흐름에는 단계별 입력·변경값·다음 단계를 설명한 표가 필요합니다.`);
  }
}

function validateDataDesign(label, source, errors) {
  validateRequiredSections(label, source, DATA_SECTIONS, errors);
  const rows = markdownTableRows(sectionBody(source, '구조와 주요 항목'));
  if (rows.length < 2 || rows[0] !== DATA_STRUCTURE_HEADER) {
    errors.push(`${label}: 데이터 구조 표에는 자료형·필수 여부·기본값·범위·의미와 내용 행이 필요합니다.`);
  }
  const relationRows = markdownTableRows(sectionBody(source, '데이터 관계'));
  if (relationRows.length < 2 || relationRows[0] !== DATA_RELATION_HEADER) {
    errors.push(`${label}: 데이터 관계 표에는 연결 기준과 변경·삭제 처리 및 내용 행이 필요합니다.`);
  }
}

function validateInterfaceDesign(label, source, errors) {
  validateRequiredSections(label, source, INTERFACE_SECTIONS, errors);
  const contractSource = source.slice(source.indexOf('## 제공자와 소비자'));
  const contractRows = markdownTableRows(contractSource);
  if (contractRows.length < 2 || tableCells(contractRows[0]).length < 3) {
    errors.push(`${label}: 공개 호출·프로퍼티·이벤트의 입력과 결과를 설명한 계약 표가 필요합니다.`);
  }
}

function validateErrorDesign(label, source, errors) {
  for (const header of ERROR_TABLE_HEADERS) {
    if (!source.includes(header)) errors.push(`${label}: 오류 설계 표 머리말이 없습니다: ${header}`);
  }
  for (const section of ['오류 분류와 식별 기준', '계층 간 전달', '복구·재시도·기록']) {
    if (markdownTableRows(sectionBody(source, section)).length < 2) {
      errors.push(`${label}: '${section}' 표에는 내용 행이 하나 이상 필요합니다.`);
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
      const source = readFileSync(file, 'utf8');
      if (prefix === 'SCR') validateScreenDesign(file, label, source, errors);
      if (prefix === 'FNC') validateFunctionDesign(label, source, errors);
      if (prefix === 'DAT') validateDataDesign(label, source, errors);
      if (prefix === 'IF') validateInterfaceDesign(label, source, errors);
      if (prefix === 'ERR') validateErrorDesign(label, source, errors);
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
