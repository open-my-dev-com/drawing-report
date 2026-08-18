// Q-08 평가: pdfme가 우리 확정 요구(ADR)를 수용할 수 있는지 실측
import fs from 'node:fs';
import { generate } from '@pdfme/generator';
import { text, table, line } from '@pdfme/schemas';
import { checkTemplate } from '@pdfme/common';
import { PDFDocument } from 'pdf-lib';

const font = {
  NotoSansKR: { data: fs.readFileSync('./NotoSansKR-Regular.ttf'), fallback: true },
};

// [검증 1] A4 용지 기준 + 한글 텍스트 + 동적 테이블(자동 페이지 분할)
// [검증 2] 템플릿 루트에 우리 고유 필드(전표 메타/서명 자리)를 넣어도 동작하는가
const template = {
  basePdf: { width: 210, height: 297, padding: [20, 15, 20, 15] },
  schemas: [
    [
      {
        name: 'title',
        type: 'text',
        content: '거래명세서',
        position: { x: 15, y: 20 },
        width: 180, height: 12,
        fontSize: 20, alignment: 'center', fontName: 'NotoSansKR',
      },
      {
        name: 'issuer',
        type: 'text',
        content: '발행자: {issuerName} / 발행일: {issueDate}', // [검증 3] 플레이스홀더 치환
        readOnly: true,
        position: { x: 15, y: 35 },
        width: 180, height: 8,
        fontSize: 10, fontName: 'NotoSansKR',
      },
      {
        name: 'items',
        type: 'table',
        position: { x: 15, y: 50 },
        width: 180, height: 60,
        showHead: true,
        repeatHead: true, // [검증 4] 페이지 분할 시 헤더 반복 (ADR-011 요구)
        head: ['품목', '수량', '단가', '금액'],
        headWidthPercentages: [40, 20, 20, 20],
        content: '[]',
        tableStyles: { borderWidth: 0.2, borderColor: '#333333' },
        headStyles: {
          fontName: 'NotoSansKR', alignment: 'center', verticalAlignment: 'middle',
          fontSize: 10, lineHeight: 1, characterSpacing: 0,
          fontColor: '#000000', backgroundColor: '#eeeeee', borderColor: '#333333',
          borderWidth: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
          padding: { top: 2, right: 2, bottom: 2, left: 2 },
        },
        bodyStyles: {
          fontName: 'NotoSansKR', alignment: 'left', verticalAlignment: 'middle',
          fontSize: 9, lineHeight: 1, characterSpacing: 0,
          fontColor: '#000000', backgroundColor: '', borderColor: '#888888',
          borderWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
          padding: { top: 2, right: 2, bottom: 2, left: 2 },
          alternateBackgroundColor: '#f8f8f8',
        },
        columnStyles: { alignment: { 1: 'right', 2: 'right', 3: 'right' } },
      },
    ],
  ],
  // ---- 우리 고유 확장 필드 (pdfme 스펙 밖) ----
  voucherMeta: {
    schemaVersion: '0.0.1-proto',
    templateSnapshot: { note: 'ADR-008 스냅샷 자리' },
    signature: { alg: 'ES256', value: 'ADR-009 서명 자리' },
  },
};

// checkTemplate: pdfme의 템플릿 검증이 루트 확장 필드를 거부하는지
let checkResult = 'OK';
try { checkTemplate(template); } catch (e) { checkResult = 'REJECTED: ' + e.message.slice(0, 200); }

// 40행 품목 → 한 페이지에 안 들어감 → 자동 분할 검증
const rows = Array.from({ length: 40 }, (_, i) => [
  `테스트 품목 ${i + 1} (한글 렌더링 확인용 긴 품명입니다)`,
  String((i % 5) + 1),
  '12,000',
  '60,000',
]);

const inputs = [{
  title: '거래명세서',
  issuerName: '주식회사 테스트상사',
  issueDate: '2026-08-18',
  items: JSON.stringify(rows),
}];

const t0 = Date.now();
const pdf = await generate({ template, inputs, options: { font }, plugins: { text, table, line } });
const elapsed = Date.now() - t0;

fs.writeFileSync('output.pdf', pdf);

const doc = await PDFDocument.load(pdf);

console.log('=== pdfme v6.1.12 평가 결과 ===');
console.log('checkTemplate(확장 필드 포함):', checkResult);
console.log('생성 시간:', elapsed + 'ms');
console.log('출력 페이지 수:', doc.getPageCount(), '(1 초과면 자동 분할 동작)');
console.log('PDF 크기:', (pdf.length / 1024).toFixed(0) + 'KB', '(원본 폰트 10.4MB 대비 — 서브세팅 여부 판단)');
