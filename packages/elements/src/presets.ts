/**
 * 디자이너에서 제공하는 거래명세서와 청구서 프리셋.
 *
 * 프리셋은 core 스키마를 따르는 `.slip` 양식 데이터이며 파싱과 검증은 core에서 담당한다.
 * 제목·라벨·맺음말은 로케일에 맞는 문구 사전으로 채운다.
 */
import { CURRENT_SCHEMA_VERSION, type SlipElement, type SlipTemplateFile } from '@omdc-slipkit/core';
import { getStrings, type SlipStrings } from './strings.js';

/** 디자이너에 동봉되는 양식 프리셋 */
export interface SlipPreset {
  id: string;
  name: string;
  /** 호출할 때마다 독립된 양식 객체를 반환한다. */
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
/** 헤더와 반복 항목을 포함한 품목 그리드의 높이(mm). */
const ITEMS_H = ROW_MM * (1 + ITEMS_PER_PAGE);
/** 품목 그리드 아래에 합계와 맺음말을 배치할 y 좌표(mm). */
const TOTAL_Y = ITEMS_Y + ITEMS_H + 10;
const FOOTER_Y = TOTAL_Y + 20;

/** 상호, 성명, 주소를 입력하는 3행 4열 정보 그리드를 생성한다. */
function infoGrid(id: string, name: string, y: number, t: SlipStrings['preset']): SlipElement {
  return {
    type: 'grid',
    id,
    name,
    position: { x: 15, y },
    rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
    columns: [{ width: 27 }, { width: 63 }, { width: 27 }, { width: 63 }],
    cells: [
      { row: 0, column: 0, content: t.registrationNo, backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 0, column: 1, colSpan: 3, content: '' },
      { row: 1, column: 0, content: t.company, backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 1, column: 1, content: '' },
      { row: 1, column: 2, content: t.personName, backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 1, column: 3, content: '' },
      { row: 2, column: 0, content: t.address, backgroundColor: LABEL_BG, alignment: 'center' },
      { row: 2, column: 1, colSpan: 3, content: '' },
    ],
  };
}

function createTradeStatement(s: SlipStrings): SlipTemplateFile {
  const t = s.preset;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: s.designer.presetTradeStatement },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      // 파라미터 키는 camelCase를 사용하고 화면에는 label을 표시한다.
      parameters: [
        { key: 'tradeDate', label: t.tradeDate, valueType: 'date' },
        {
          key: 'items',
          label: t.items,
          valueType: 'list',
          fields: [
            { key: 'itemName', label: t.itemName },
            { key: 'spec', label: t.spec },
            { key: 'quantity', label: t.quantity, valueType: 'number' },
            { key: 'unitPrice', label: t.unitPrice, valueType: 'number' },
            { key: 'amount', label: t.amount, valueType: 'number' },
          ],
        },
      ],
      pages: [
        {
          elements: [
            {
              type: 'text',
              id: 'title',
              name: t.titleElement,
              position: { x: 55, y: 20 },
              width: 100,
              height: 12,
              content: s.designer.presetTradeStatement,
              fontSize: 20,
              alignment: 'center',
            },
            {
              type: 'field',
              id: 'trade-date',
              name: t.tradeDate,
              position: { x: 135, y: 38 },
              width: 60,
              height: 8,
              parameter: 'tradeDate',
              alignment: 'right',
            },
            infoGrid('supplier', t.supplierInfo, 50, t),
            {
              type: 'grid',
              id: 'items',
              name: t.itemsTable,
              position: { x: 15, y: ITEMS_Y },
              columns: [
                { width: 54 },
                { width: 36 },
                { width: 27 },
                { width: 27 },
                { width: 36 },
              ],
              rows: [{ height: ROW_MM }, { height: ROW_MM }],
              repeat: {
                parameter: 'items',
                bands: [
                  { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
                  { id: 'items-item', fromRow: 1, toRow: 1, placement: 'item' },
                ],
                pagination: { mode: 'fixed', itemsPerPage: ITEMS_PER_PAGE },
              },
              cells: [
                { row: 0, column: 0, content: t.itemName, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 1, content: t.spec, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 2, content: t.quantity, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 3, content: t.unitPrice, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 4, content: t.amount, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 1, column: 0, name: t.itemName, parameter: 'itemName' },
                { row: 1, column: 1, name: t.spec, parameter: 'spec' },
                { row: 1, column: 2, name: t.quantity, parameter: 'quantity', alignment: 'right' },
                { row: 1, column: 3, name: t.unitPrice, parameter: 'unitPrice', alignment: 'right' },
                { row: 1, column: 4, name: t.amount, parameter: 'amount', alignment: 'right' },
              ],
            },
            {
              type: 'field',
              id: 'total',
              name: t.totalAmount,
              position: { x: 115, y: TOTAL_Y },
              width: 80,
              height: 10,
              formula: 'SUM(items.amount)',
              fontSize: 12,
              alignment: 'right',
            },
            {
              type: 'text',
              id: 'footer',
              name: t.footer,
              position: { x: 15, y: FOOTER_Y },
              width: 180,
              height: 8,
              content: t.tradeFooterText,
              alignment: 'center',
            },
          ],
        },
      ],
      assets: [],
    },
  };
}

function createInvoice(s: SlipStrings): SlipTemplateFile {
  const t = s.preset;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: s.designer.presetInvoice },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      parameters: [
        { key: 'invoiceDate', label: t.invoiceDate, valueType: 'date' },
        {
          key: 'items',
          label: t.invoiceItems,
          valueType: 'list',
          fields: [
            { key: 'itemName', label: t.item },
            { key: 'quantity', label: t.quantity, valueType: 'number' },
            { key: 'unitPrice', label: t.unitPrice, valueType: 'number' },
            { key: 'amount', label: t.amount, valueType: 'number' },
          ],
        },
      ],
      pages: [
        {
          elements: [
            {
              type: 'text',
              id: 'title',
              name: t.titleElement,
              position: { x: 55, y: 20 },
              width: 100,
              height: 12,
              content: s.designer.presetInvoice,
              fontSize: 20,
              alignment: 'center',
            },
            {
              type: 'field',
              id: 'invoice-date',
              name: t.invoiceDate,
              position: { x: 135, y: 38 },
              width: 60,
              height: 8,
              parameter: 'invoiceDate',
              alignment: 'right',
            },
            infoGrid('biller', t.billerInfo, 50, t),
            {
              type: 'grid',
              id: 'items',
              name: t.invoiceItemsTable,
              position: { x: 15, y: ITEMS_Y },
              columns: [
                { width: 72 },
                { width: 27 },
                { width: 36 },
                { width: 45 },
              ],
              rows: [{ height: ROW_MM }, { height: ROW_MM }],
              repeat: {
                parameter: 'items',
                bands: [
                  { id: 'items-header', fromRow: 0, toRow: 0, placement: 'page-start' },
                  { id: 'items-item', fromRow: 1, toRow: 1, placement: 'item' },
                ],
                pagination: { mode: 'fixed', itemsPerPage: ITEMS_PER_PAGE },
              },
              cells: [
                { row: 0, column: 0, content: t.item, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 1, content: t.quantity, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 2, content: t.unitPrice, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 0, column: 3, content: t.amount, backgroundColor: HEAD_BG, alignment: 'center' },
                { row: 1, column: 0, name: t.item, parameter: 'itemName' },
                { row: 1, column: 1, name: t.quantity, parameter: 'quantity', alignment: 'right' },
                { row: 1, column: 2, name: t.unitPrice, parameter: 'unitPrice', alignment: 'right' },
                { row: 1, column: 3, name: t.amount, parameter: 'amount', alignment: 'right' },
              ],
            },
            {
              type: 'field',
              id: 'total',
              name: t.amountDue,
              position: { x: 115, y: TOTAL_Y },
              width: 80,
              height: 10,
              formula: 'SUM(items.amount)',
              fontSize: 12,
              alignment: 'right',
            },
            {
              type: 'text',
              id: 'footer',
              name: t.footer,
              position: { x: 15, y: FOOTER_Y },
              width: 180,
              height: 8,
              content: t.invoiceFooterText,
              alignment: 'center',
            },
          ],
        },
      ],
      assets: [],
    },
  };
}

/**
 * 로케일에 맞는 동봉 프리셋 목록(거래명세서·청구서)을 만든다.
 * 제목·라벨·맺음말은 해당 언어로 채워진다.
 *
 * @param locale - UI 언어 (생략하거나 지원하지 않는 언어면 영어)
 * @returns 프리셋 목록
 */
export function getPresets(locale?: string): SlipPreset[] {
  const s = getStrings(locale);
  return [
    {
      id: 'trade-statement',
      name: s.designer.presetTradeStatement,
      create: () => createTradeStatement(s),
    },
    {
      id: 'invoice',
      name: s.designer.presetInvoice,
      create: () => createInvoice(s),
    },
  ];
}
