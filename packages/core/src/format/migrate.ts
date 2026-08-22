/**
 * .slip schemaVersion 마이그레이션 계층 (ADR-007).
 *
 * 모든 파일은 `schemaVersion`을 내장하며, 구버전 파일을 열 때 현재 버전까지
 * 단계별 마이그레이션을 적용한다. 각 단계는 `from` 버전의 문서를 받아
 * `to` 버전의 문서를 돌려주는 순수 함수다.
 */
import { CURRENT_SCHEMA_VERSION } from './version.js';

/** 마이그레이션 한 단계 — `from` 버전 문서를 받아 `to` 버전 문서를 돌려준다 */
export interface SlipMigrationStep {
  /** 이 단계가 입력으로 받는 schemaVersion */
  from: string;
  /** 이 단계를 거친 뒤의 schemaVersion */
  to: string;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/**
 * 내장 마이그레이션 목록. 스키마가 개정될 때마다 단계를 추가한다.
 */
export const BUILT_IN_MIGRATIONS: readonly SlipMigrationStep[] = [
  {
    // 0.1.1: 구조 크기 상한 추가 (SPEC §3.2) — 필드 구조 변화가 없어 문서를 그대로 통과시킨다.
    // 상한을 넘는 문서는 마이그레이션 뒤의 본문 검증에서 거부된다.
    from: '0.1.0',
    to: '0.1.1',
    migrate: (document) => document,
  },
  {
    // 0.2.0 (ADR-032): 동적 표 head/headWidthPercentages → columns(키=옛 제목이라 전표 값 호환),
    // shape 요소를 독립 타입(line/rect)으로 분해 — 선은 lineDirection 명시(옛 규칙 = 긴 쪽 방향).
    from: '0.1.1',
    to: '0.2.0',
    migrate: migrateTo020,
  },
  {
    // 0.3.0 (ADR-037): 그리드 요소(grid) 신설. 이 단계에서는 구조가 바뀌지 않는다 —
    // 기존 두 요소를 옮기는 것은 다음 단계(0.4.0)가 맡는다.
    from: '0.2.0',
    to: '0.3.0',
    migrate: (document) => document,
  },
  {
    // 0.4.0 (ADR-037 3단계): fixedGrid·dynamicTable을 grid로 옮기고 두 요소를 없앤다.
    from: '0.3.0',
    to: '0.4.0',
    migrate: migrateTo040,
  },
  {
    // 0.5.0: 더한 것이 전부 선택 필드라 구조가 바뀌지 않는다 —
    // 글자 조판(수직 정렬·기울임·줄간격·자간·세로쓰기), 페이지 이름·번호, 변동 이미지 binding,
    // 바인딩 값 종류, 그리드 열 autoMerge, 바코드 요소. 옛 파일은 그대로 유효하다.
    from: '0.4.0',
    to: '0.5.0',
    migrate: (document) => document,
  },
];

/** 기본 행 높이(mm) — 옛 동적 표에는 행 높이 개념이 없어 여기서 정한다 */
const LEGACY_ROW_HEIGHT_MM = 8;

/**
 * 0.3.0 → 0.4.0: 고정 그리드·동적 표를 그리드로 옮긴다 (ADR-037 3단계).
 *
 * - 고정 그리드: 비율 트랙을 상자 크기에 맞춘 mm 트랙으로 환산한다. 셀은 그대로 옮긴다.
 * - 동적 표: 헤더 1행 + 반복 1행짜리 그리드가 된다. 열 제목은 헤더 칸의 고정 문구로,
 *   열의 물리 키는 반복 칸의 값으로 간다. 페이지당 항목 수는 옛 상자 높이에서 셈한다.
 */
function migrateTo040(document: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  const body = (next['kind'] === 'template' ? next['template'] : next['templateSnapshot']) as
    | { pages?: { elements?: Record<string, unknown>[] }[] }
    | undefined;
  for (const page of body?.pages ?? []) {
    const elements = page.elements ?? [];
    elements.forEach((element, index) => {
      if (element['type'] === 'fixedGrid') elements[index] = fixedGridToGrid(element);
      else if (element['type'] === 'dynamicTable') elements[index] = dynamicTableToGrid(element);
    });
  }
  return next;
}

/** 비율(%) 배열 → mm 트랙 크기 배열. 비율이 없으면 균등하게 나눈다 */
function percentagesToMm(total: number, count: number, percentages?: unknown): number[] {
  const list = Array.isArray(percentages) ? (percentages as number[]) : undefined;
  return Array.from({ length: count }, (_, i) =>
    list ? (total * (list[i] ?? 0)) / 100 : total / count,
  );
}

function fixedGridToGrid(element: Record<string, unknown>): Record<string, unknown> {
  const width = Number(element['width'] ?? 0);
  const height = Number(element['height'] ?? 0);
  const rowCount = Number(element['rows'] ?? 1);
  const columnCount = Number(element['columns'] ?? 1);
  const next: Record<string, unknown> = { ...element, type: 'grid' };
  next['columns'] = percentagesToMm(width, columnCount, element['columnWidthPercentages'])
    .map((size) => ({ width: size }));
  next['rows'] = percentagesToMm(height, rowCount, element['rowHeightPercentages'])
    .map((size) => ({ height: size }));
  delete next['columnWidthPercentages'];
  delete next['rowHeightPercentages'];
  return next;
}

function dynamicTableToGrid(element: Record<string, unknown>): Record<string, unknown> {
  const width = Number(element['width'] ?? 0);
  const height = Number(element['height'] ?? 0);
  const columns = (Array.isArray(element['columns']) ? element['columns'] : []) as {
    key: string;
    title: string;
    widthPercentage: number;
  }[];
  // 옛 상자 높이에서 헤더 한 줄을 빼고 남는 만큼을 페이지당 항목 수로 본다
  const perPage = Math.max(1, Math.round((height - LEGACY_ROW_HEIGHT_MM) / LEGACY_ROW_HEIGHT_MM));
  const cells: Record<string, unknown>[] = [];
  columns.forEach((column, index) => {
    cells.push({ row: 0, column: index, content: column.title, alignment: 'center' });
    cells.push({ row: 1, column: index, binding: column.key });
  });
  const next: Record<string, unknown> = { ...element, type: 'grid' };
  next['columns'] = columns.map((column) => ({ width: (width * column.widthPercentage) / 100 }));
  next['rows'] = [{ height: LEGACY_ROW_HEIGHT_MM }, { height: LEGACY_ROW_HEIGHT_MM }];
  next['height'] = LEGACY_ROW_HEIGHT_MM * (1 + perPage);
  next['repeat'] = {
    binding: String(element['binding'] ?? 'items'),
    fromRow: 1,
    toRow: 1,
    perPage,
    repeatHeader: element['repeatHead'] === true,
  };
  next['cells'] = cells;
  delete next['repeatHead'];
  delete next['binding'];
  return next;
}

function migrateTo020(document: Record<string, unknown>): Record<string, unknown> {
  // 문서는 파싱된 JSON이므로 JSON 왕복 복사로 충분하다 (원본은 건드리지 않는다)
  const next = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  const body = (next['kind'] === 'template' ? next['template'] : next['templateSnapshot']) as
    | { pages?: { elements?: Record<string, unknown>[] }[] }
    | undefined;
  for (const page of body?.pages ?? []) {
    for (const element of page.elements ?? []) {
      // 옛 필드가 있을 때만 변환한다 — 이미 신형이면 그대로 통과 (구조가 어긋난 문서는
      // 마이그레이션 뒤의 본문 검증이 거부한다)
      if (element['type'] === 'dynamicTable' && Array.isArray(element['head'])) {
        const head = element['head'] as unknown[];
        const widths = Array.isArray(element['headWidthPercentages'])
          ? (element['headWidthPercentages'] as unknown[])
          : [];
        element['columns'] = head.map((title, index) => ({
          key: String(title),
          title: String(title),
          widthPercentage: widths[index] ?? 0,
        }));
        delete element['head'];
        delete element['headWidthPercentages'];
      }
      // 0.1.x의 shape 요소는 독립 타입으로 분해한다 (ADR-032: 종류마다 스타일이 달라 타입 분리)
      if (element['type'] === 'shape') {
        if (element['shape'] === 'line') {
          element['type'] = 'line';
          const width = typeof element['width'] === 'number' ? element['width'] : 0;
          const height = typeof element['height'] === 'number' ? element['height'] : 0;
          element['lineDirection'] = width >= height ? 'horizontal' : 'vertical';
          // 선에 의미 없는 스타일은 버린다 (0.1.x에서도 렌더에 쓰이지 않았다)
          delete element['backgroundColor'];
          delete element['fontColor'];
        } else {
          element['type'] = 'rect';
          delete element['fontColor'];
        }
        delete element['shape'];
      }
    }
  }
  return next;
}

/** 마이그레이션 불가 오류 (미래 버전·경로 없음·순환 등) */
export class SlipMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipMigrationError';
  }
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/**
 * 문서를 현재 schemaVersion까지 끌어올린다.
 * - 이미 현재 버전이면 그대로 반환
 * - 현재보다 새로운 버전이면 거부 (구현이 모르는 미래 포맷)
 * - 이어지는 마이그레이션 단계가 없는 구버전이면 거부
 *
 * @param document - schemaVersion을 가진 .slip 문서 (파싱된 JSON 객체)
 * @param steps - 적용할 마이그레이션 단계 목록 (기본: 내장 목록)
 * @returns 현재 schemaVersion까지 끌어올린 문서
 * @throws SlipMigrationError 버전 형식 오류·미래 버전·경로 없음·순환 시
 */
export function migrateSlipDocument(
  document: Record<string, unknown>,
  steps: readonly SlipMigrationStep[] = BUILT_IN_MIGRATIONS,
): Record<string, unknown> {
  const version = document['schemaVersion'];
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new SlipMigrationError('schemaVersion이 semver 형식이 아닙니다');
  }
  if (compareSemver(version, CURRENT_SCHEMA_VERSION) > 0) {
    throw new SlipMigrationError(
      `이 파일의 schemaVersion(${version})은 지원 버전(${CURRENT_SCHEMA_VERSION})보다 새롭습니다. 라이브러리를 업데이트하세요.`,
    );
  }

  let current = document;
  let currentVersion = version;
  const visited = new Set<string>();
  while (currentVersion !== CURRENT_SCHEMA_VERSION) {
    if (visited.has(currentVersion)) {
      throw new SlipMigrationError(`마이그레이션 경로에 순환이 있습니다: ${currentVersion}`);
    }
    visited.add(currentVersion);
    const step = steps.find((s) => s.from === currentVersion);
    if (!step) {
      throw new SlipMigrationError(
        `schemaVersion ${currentVersion}에서 ${CURRENT_SCHEMA_VERSION}(으)로 가는 마이그레이션 경로가 없습니다`,
      );
    }
    current = { ...step.migrate(current), schemaVersion: step.to };
    currentVersion = step.to;
  }
  return current;
}
