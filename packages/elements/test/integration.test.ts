// @vitest-environment happy-dom
/**
 * 시스템 결합 테스트 (로드맵 10번) — 모킹 없이 실제 사용 흐름 그대로:
 * 디자이너로 양식 편집 → .slip 저장 → 전표 값·수식 평가 → PDF 렌더 →
 * 해시·서명 검증 → 저장소 어댑터 저장·조회까지 패키지 경계를 넘어 확인한다.
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computeIntegrity,
  generateSigningKeyPair,
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
  verifyIntegrity,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { SlipDesigner, presets, IndexedDbStorage } from '../src/index.js';
import { strings } from '../src/strings.js';

if (!customElements.get('slip-designer')) {
  customElements.define('slip-designer', SlipDesigner);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function toolbarButton(el: Element, label: string): HTMLButtonElement {
  const button = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? []).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label,
  );
  if (!button) throw new Error(`툴바 버튼을 찾지 못했습니다: ${label}`);
  return button as HTMLButtonElement;
}

// 시나리오 단계 간 공유 상태 — it 블록은 파일 안에서 순서대로 실행된다
let designed: SlipTemplateFile;
let issuedVoucher: SlipVoucherFile;

describe('결합 시나리오: 디자이너 → .slip → 전표 → PDF → 무결성 → 저장소', () => {
  let designer: SlipDesigner;

  beforeAll(async () => {
    designer = document.createElement('slip-designer') as SlipDesigner;
    document.body.appendChild(designer);
    designer.src = serializeSlipFile(presets[0]!.create()); // 거래명세서 프리셋
    await designer.updateComplete;
    await flush();
    await designer.updateComplete;
  });

  it('1) 디자이너로 양식을 편집한다 (요소 추가 + 페이지 추가)', async () => {
    const changes: SlipTemplateFile[] = [];
    designer.addEventListener('slip-change', (e: Event) =>
      changes.push((e as CustomEvent).detail.file as SlipTemplateFile));

    toolbarButton(designer, strings.designer.addText).click();
    await designer.updateComplete;
    toolbarButton(designer, strings.designer.addPage).click();
    await designer.updateComplete;

    designed = changes.at(-1)!;
    expect(designed.kind).toBe('template');
    expect(designed.template.pages.length).toBe(2);
    // 프리셋 요소 6개 + 추가한 텍스트 1개
    expect(designed.template.pages[0]!.elements.length).toBe(7);
  });

  it('2) 편집 결과는 core 스키마를 통과하는 유효한 .slip 파일이다', () => {
    const roundTripped = parseSlipFile(serializeSlipFile(designed));
    expect(roundTripped).toEqual(designed);
  });

  it('3) 양식 스냅샷 + 전표 값으로 수식이 평가된 PDF를 렌더한다', async () => {
    const voucher: SlipVoucherFile = {
      schemaVersion: designed.schemaVersion,
      kind: 'voucher',
      templateSnapshot: designed.template,
      values: {
        거래일자: '2026-08-19',
        items: [
          { 품명: '노트', 규격: 'A5', 수량: 2, 단가: 1500, 금액: 3000 },
          { 품명: '볼펜', 규격: '0.5mm', 수량: 10, 단가: 500, 금액: 5000 },
        ],
      },
      issued: false,
    };

    const pdf = await renderSlipToPdf(voucher);
    // %PDF- 매직 바이트
    expect(Array.from(pdf.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);

    issuedVoucher = { ...voucher, issued: true };
  });

  it('4) 발행 전표에 해시·서명을 기록하고 검증한다 (SPEC §8)', async () => {
    const keyPair = await generateSigningKeyPair();
    issuedVoucher.integrity = await computeIntegrity(issuedVoucher, keyPair.privateKey);

    // 발행 규칙까지 포함해 유효한 파일이어야 한다
    const reparsed = parseSlipFile(serializeSlipFile(issuedVoucher));
    expect(reparsed.kind).toBe('voucher');

    await expect(verifyIntegrity(issuedVoucher, keyPair.publicKey)).resolves.toBeUndefined();

    // 값을 위조하면 해시 검증이 실패해야 한다
    const tampered = JSON.parse(JSON.stringify(issuedVoucher)) as SlipVoucherFile;
    (tampered.values as Record<string, unknown>)['items'] = [];
    await expect(verifyIntegrity(tampered, keyPair.publicKey)).rejects.toThrow(/변조/);
  });

  it('5) 저장소 어댑터로 양식·전표를 저장·조회한다 (ADR-021)', async () => {
    const storage = new IndexedDbStorage({ dbName: 'integration-test' });
    await storage.save('template-1', designed);
    await storage.save('voucher-1', issuedVoucher);

    const vouchers = await storage.list({ kind: 'voucher' });
    expect(vouchers.items.map((item) => item.id)).toEqual(['voucher-1']);

    const loaded = await storage.load('voucher-1');
    expect(loaded).toEqual(issuedVoucher);
  });
});
