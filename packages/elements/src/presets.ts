/**
 * 디자이너 기본 프리셋 2종: 거래명세서 · 청구서 (ADR-020).
 *
 * 프리셋은 core 스키마를 그대로 따르는 `.slip` 양식 데이터다 — 여기에 파싱·검증
 * 로직을 두지 않는다(ADR-003, UI는 core의 소비자). 유효성은 테스트에서
 * `parseSlipFile`로 확인한다.
 */
import { CURRENT_SCHEMA_VERSION, type SlipElement, type SlipTemplateFile } from '@omdc-slipkit/core';
import { strings } from './strings.js';

/** 디자이너에 동봉되는 양식 프리셋 */
export interface SlipPreset {
  id: string;
  name: string;
  /** 호출할 때마다 새 객체를 반환한다 (프리셋 간 상태 공유 방지) */
  create: () => SlipTemplateFile;
}

const LABEL_BG = '#F2F2F2';
/** 품목 그리드의 헤더 배경 */
const HEAD_BG = '#EEEEEE';
/** 품목 그리드의 행 높이(mm) */
const ROW_MM = 8;
/** 품목 그리드가 한 페이지에 담는 항목 수 */
const ITEMS_PER_PAGE = 8;
/** 품목 그리드의 윗변 y(mm) */
const ITEMS_Y = 90;
/** 품목 그리드가 차지하는 높이(mm) — 헤더 1행 + 항목 수만큼의 반복 구간 */
const ITEMS_H = ROW_MM * (1 + ITEMS_PER_PAGE);
/** 합계·맺음말은 품목 그리드 아래에 놓는다 — 항목 수를 바꿔도 겹치지 않는다 */
const TOTAL_Y = ITEMS_Y + ITEMS_H + 10;
const FOOTER_Y = TOTAL_Y + 20;

/** 상호·성명·주소를 적는 3행 4열 정보 그리드 (라벨 칸은 회색 배경) */
function infoGrid(id: string, name: string, y: number): SlipElement {
  return {
    type: 'grid',
    id,
    name,
    position: { x: 15, y },
    width: 180,
    height: 30,
    rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
    columns: [{ width: 27 }, { width: 63 }, { width: 27 }, { width: 63 }],
    cells: [
      { row: 0, column: 0, content: '등록번호', backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 0, column: 1, colSpan: 3, content: '' },
      { row: 1, column: 0, content: '상호', backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 1, column: 1, content: '' },
      { row: 1, column: 2, content: '성명', backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 1, column: 3, content: '' },
      { row: 2, column: 0, content: '주소', backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 2, column: 1, colSpan: 3, content: '' },
    ],
  };
}

function createTradeStatement(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: strings.designer.presetTradeStatement },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      // 파라미터 정의부 (ADR-032): 물리명은 camelCase, 화면에는 논리명 표시
      bindings: [
        { key: 'tradeDate', label: '거래일자' },
        { key: 'items', label: '품목' },
        { key: 'totalAmount', label: '합계금액' },
      ],
      pages: [
        {
          elements: [
            {
              type: 'text',
              id: 'title',
              name: '제목',
              position: { x: 55, y: 20 },
              width: 100,
              height: 12,
              content: '거래명세서',
              fontSize: 20,
              alignment: 'center',
            },
            {
              type: 'field',
              id: 'trade-date',
              name: '거래일자',
              position: { x: 135, y: 38 },
              width: 60,
              height: 8,
              binding: 'tradeDate',
              alignment: 'right',
            },
            infoGrid('supplier', '공급자 정보', 50),
            {
              type: 'grid',
              id: 'items',
              name: '품목 표',
              position: { x: 15, y: ITEMS_Y },
              width: 180,
              height: ITEMS_H,
              columns: [
                { width: 54 },
                { width: 36 },
                { width: 27 },
                { width: 27 },
                { width: 36 },
              ],
              rows: [{ height: ROW_MM }, { height: ROW_MM }],
              repeat: {
                binding: 'items',
                fromRow: 1,
                toRow: 1,
                perPage: ITEMS_PER_PAGE,
                repeatHeader: true,
              },
              cells: [
                { row: 0, column: 0, content: '품명', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 1, content: '규격', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 2, content: '수량', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 3, content: '단가', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 4, content: '금액', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 1, column: 0, binding: 'itemName' },
                { row: 1, column: 1, binding: 'spec' },
                { row: 1, column: 2, binding: 'quantity', alignment: 'right' },
                { row: 1, column: 3, binding: 'unitPrice', alignment: 'right' },
                { row: 1, column: 4, binding: 'amount', alignment: 'right' },
              ],
            },
            {
              type: 'field',
              id: 'total',
              name: '합계금액',
              position: { x: 115, y: TOTAL_Y },
              width: 80,
              height: 10,
              binding: 'totalAmount',
              formula: 'SUM(items.amount)',
              fontSize: 12,
              alignment: 'right',
            },
            {
              type: 'text',
              id: 'footer',
              name: '맺음말',
              position: { x: 15, y: FOOTER_Y },
              width: 180,
              height: 8,
              content: '위와 같이 거래합니다.',
              alignment: 'center',
            },
          ],
        },
      ],
      assets: [],
    },
  };
}

function createInvoice(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: strings.designer.presetInvoice },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      bindings: [
        { key: 'invoiceDate', label: '청구일자' },
        { key: 'items', label: '청구 항목' },
        { key: 'totalAmount', label: '청구금액' },
      ],
      pages: [
        {
          elements: [
            {
              type: 'text',
              id: 'title',
              name: '제목',
              position: { x: 55, y: 20 },
              width: 100,
              height: 12,
              content: '청구서',
              fontSize: 20,
              alignment: 'center',
            },
            {
              type: 'field',
              id: 'invoice-date',
              name: '청구일자',
              position: { x: 135, y: 38 },
              width: 60,
              height: 8,
              binding: 'invoiceDate',
              alignment: 'right',
            },
            infoGrid('biller', '청구인 정보', 50),
            {
              type: 'grid',
              id: 'items',
              name: '청구 항목 표',
              position: { x: 15, y: ITEMS_Y },
              width: 180,
              height: ITEMS_H,
              columns: [
                { width: 72 },
                { width: 27 },
                { width: 36 },
                { width: 45 },
              ],
              rows: [{ height: ROW_MM }, { height: ROW_MM }],
              repeat: {
                binding: 'items',
                fromRow: 1,
                toRow: 1,
                perPage: ITEMS_PER_PAGE,
                repeatHeader: true,
              },
              cells: [
                { row: 0, column: 0, content: '항목', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 1, content: '수량', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 2, content: '단가', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 3, content: '금액', backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 1, column: 0, binding: 'itemName' },
                { row: 1, column: 1, binding: 'quantity', alignment: 'right' },
                { row: 1, column: 2, binding: 'unitPrice', alignment: 'right' },
                { row: 1, column: 3, binding: 'amount', alignment: 'right' },
              ],
            },
            {
              type: 'field',
              id: 'total',
              name: '청구금액',
              position: { x: 115, y: TOTAL_Y },
              width: 80,
              height: 10,
              binding: 'totalAmount',
              formula: 'SUM(items.amount)',
              fontSize: 12,
              alignment: 'right',
            },
            {
              type: 'text',
              id: 'footer',
              name: '맺음말',
              position: { x: 15, y: FOOTER_Y },
              width: 180,
              height: 8,
              content: '위 금액을 청구합니다.',
              alignment: 'center',
            },
          ],
        },
      ],
      assets: [],
    },
  };
}

/** 동봉 프리셋 목록 — 거래명세서 · 청구서 */
export const presets: SlipPreset[] = [
  {
    id: 'trade-statement',
    name: strings.designer.presetTradeStatement,
    create: createTradeStatement,
  },
  {
    id: 'invoice',
    name: strings.designer.presetInvoice,
    create: createInvoice,
  },
];
