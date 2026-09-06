/**
 * 디자이너 벤치마크에 쓰는 양식 두 벌을 결정적으로 만든다.
 *
 * - `small`: 1페이지, 텍스트·사각형 20개.
 * - `large`: 10페이지, 페이지마다 100개(총 1,000개). 첫 페이지에는 샘플 항목 500건을 가진
 *   반복 그리드가 들어 있어 포인터를 옮길 때마다 페이지 계획이 다시 계산된다.
 *
 * 값은 모두 색인에서 만들므로 실행마다 같은 파일이 나온다. 내용은 ASCII만 쓰므로
 * `JSON.stringify` 결과의 문자 수가 그대로 바이트 수다.
 */

/** 벤치마크 양식의 용지 (A4 세로) */
const PAPER = { width: 210, height: 297, padding: [20, 15, 20, 15] };

/** 샘플 항목 하나의 열 정의 — 반복 그리드의 하위 필드와 셀 파라미터가 같은 키를 쓴다. */
const ITEM_FIELDS = [
  { key: 'itemName', label: 'Item' },
  { key: 'spec', label: 'Spec' },
  { key: 'quantity', label: 'Qty', valueType: 'number' },
  { key: 'unitPrice', label: 'Unit price', valueType: 'number' },
  { key: 'amount', label: 'Amount', valueType: 'number' },
];

/**
 * 텍스트와 사각형을 번갈아 만든다. 요소는 10열 격자에 놓이며 용지 안에 들어간다.
 *
 * @param pageIndex - 요소 id에 넣을 페이지 번호
 * @param count - 만들 요소 수 (최대 100)
 * @param startRow - 요소를 놓기 시작할 격자 행 (그리드 아래에 놓을 때 사용)
 * @returns 요소 배열
 */
function fillerElements(pageIndex, count, startRow = 0) {
  const elements = [];
  for (let i = 0; i < count; i++) {
    const col = i % 10;
    const row = startRow + Math.floor(i / 10);
    const x = 12 + col * 19;
    const y = 18 + row * 24;
    const id = `p${pageIndex}-e${i}`;
    if (i % 2 === 0) {
      elements.push({
        type: 'text',
        id,
        name: `text ${pageIndex}-${i}`,
        position: { x, y },
        width: 16,
        height: 8,
        content: `T${pageIndex}-${i}`,
        fontSize: 9,
      });
    } else {
      elements.push({
        type: 'rect',
        id,
        name: `rect ${pageIndex}-${i}`,
        position: { x, y },
        width: 16,
        height: 8,
        borderColor: '#333333',
      });
    }
  }
  return elements;
}

/** 헤더 한 행과 항목 한 행을 가진 자동 확장 반복 그리드. */
function repeatGrid() {
  const cells = ITEM_FIELDS.map((field, column) => ({
    row: 0, column, content: field.label, backgroundColor: '#EEEEEE', alignment: 'center',
  }));
  for (const [column, field] of ITEM_FIELDS.entries()) {
    cells.push({
      row: 1,
      column,
      name: field.label,
      parameter: field.key,
      ...(field.valueType === 'number' ? { alignment: 'right' } : {}),
    });
  }
  return {
    type: 'grid',
    id: 'items-grid',
    name: 'items',
    position: { x: 15, y: 210 },
    columns: [{ width: 60 }, { width: 40 }, { width: 25 }, { width: 25 }, { width: 30 }],
    rows: [{ height: 8 }, { height: 8 }],
    cells,
    repeat: {
      parameter: 'items',
      bands: [
        { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
        { id: 'items-item', fromRow: 1, toRow: 1, placement: 'item' },
      ],
      pagination: { mode: 'auto', minItems: 1 },
    },
  };
}

/**
 * 샘플 항목 n건. 값은 색인에서 만든다.
 *
 * @param n - 항목 수
 * @returns 항목 배열
 */
function sampleItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    itemName: `Item ${i}`,
    spec: `SPEC-${i % 13}`,
    quantity: (i % 7) + 1,
    unitPrice: 1000 + i,
    amount: ((i % 7) + 1) * (1000 + i),
  }));
}

/**
 * 양식 파일 뼈대를 만든다.
 *
 * @param title - 양식 제목
 * @param pages - 페이지 배열
 * @param extra - `parameters`·`sampleValues` 등 추가 필드
 * @returns `.slip` 양식 객체
 */
function templateFile(title, pages, extra = {}) {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      assets: [],
      paper: PAPER,
      pages,
      ...extra,
    },
  };
}

/**
 * 벤치마크 양식 정의.
 *
 * @returns `{ name, file, dragId }` 목록 — `dragId`는 드래그할 첫 페이지 텍스트 요소의 id
 */
export function benchTemplates() {
  const small = templateFile('small', [{ elements: fillerElements(0, 20) }]);

  const pages = [];
  for (let p = 0; p < 10; p++) {
    if (p === 0) {
      // 첫 페이지: 그리드 위쪽 8행에 요소 80개 + 그리드 아래로 20개(용지 밖 허용 범위 안).
      const filler = [...fillerElements(0, 80), ...fillerElements(0, 20, 8).map((el, i) => ({
        ...el, id: `p0-e${80 + i}`, position: { x: el.position.x, y: 230 + Math.floor(i / 10) * 24 },
      }))];
      pages.push({ elements: [...filler.slice(0, 99), repeatGrid()] });
    } else {
      pages.push({ elements: fillerElements(p, 100) });
    }
  }
  const large = templateFile('large', pages, {
    parameters: [{ key: 'items', label: 'Items', valueType: 'list', fields: ITEM_FIELDS }],
    sampleValues: { items: sampleItems(500) },
  });

  return [
    { name: 'small', description: '1 page, 20 elements', file: small, dragId: 'p0-e0' },
    { name: 'large', description: '10 pages, 1,000 elements, repeat grid 500 rows', file: large, dragId: 'p0-e0' },
  ];
}
