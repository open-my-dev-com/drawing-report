/**
 * 디자이너 기본 프리셋 2종: 거래명세서 · 청구서 (ADR-020).
 *
 * 프리셋은 core 스키마를 그대로 따르는 `.slip` 양식 데이터다 — 여기에 파싱·검증
 * 로직을 두지 않는다(ADR-003, UI는 core의 소비자). 유효성은 테스트에서
 * `parseSlipFile`로 확인한다.
 */
import { CURRENT_SCHEMA_VERSION, type SlipElement, type SlipTemplateFile } from '@omdc-slipkit/core';
import { strings } from './strings.js';

export interface SlipPreset {
  id: string;
  name: string;
  /** 호출할 때마다 새 객체를 반환한다 (프리셋 간 상태 공유 방지) */
  create: () => SlipTemplateFile;
}

const LABEL_BG = '#F2F2F2';

/** 상호·성명·주소를 적는 3×4 정보 표 (라벨 칸은 회색 배경) */
function infoGrid(id: string, name: string, y: number): SlipElement {
  return {
    type: 'fixedGrid',
    id,
    name,
    position: { x: 15, y },
    width: 180,
    height: 30,
    rows: 3,
    columns: 4,
    columnWidthPercentages: [15, 35, 15, 35],
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
              binding: '거래일자',
              alignment: 'right',
            },
            infoGrid('supplier', '공급자 정보', 50),
            {
              type: 'dynamicTable',
              id: 'items',
              name: '품목 표',
              position: { x: 15, y: 90 },
              width: 180,
              height: 25,
              head: ['품명', '규격', '수량', '단가', '금액'],
              headWidthPercentages: [30, 20, 15, 15, 20],
              repeatHead: true,
              binding: 'items',
            },
            {
              type: 'field',
              id: 'total',
              name: '합계금액',
              position: { x: 115, y: 125 },
              width: 80,
              height: 10,
              binding: '합계금액',
              formula: 'SUM(items.금액)',
              fontSize: 12,
              alignment: 'right',
            },
            {
              type: 'text',
              id: 'footer',
              name: '맺음말',
              position: { x: 15, y: 145 },
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
              binding: '청구일자',
              alignment: 'right',
            },
            infoGrid('biller', '청구인 정보', 50),
            {
              type: 'dynamicTable',
              id: 'items',
              name: '청구 항목 표',
              position: { x: 15, y: 90 },
              width: 180,
              height: 25,
              head: ['항목', '수량', '단가', '금액'],
              headWidthPercentages: [40, 15, 20, 25],
              repeatHead: true,
              binding: 'items',
            },
            {
              type: 'field',
              id: 'total',
              name: '청구금액',
              position: { x: 115, y: 125 },
              width: 80,
              height: 10,
              binding: '청구금액',
              formula: 'SUM(items.금액)',
              fontSize: 12,
              alignment: 'right',
            },
            {
              type: 'text',
              id: 'footer',
              name: '맺음말',
              position: { x: 15, y: 145 },
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
