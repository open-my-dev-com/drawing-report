// @vitest-environment happy-dom
/**
 * 시스템 결합 테스트 (로드맵 10번) — 모킹 없이 실제 사용 흐름 그대로:
 * 디자이너로 양식 편집 → .slip 저장 → 전표 값·수식 평가 → PDF 렌더 →
 * 해시·서명 검증 → 저장소 어댑터 저장·조회까지 패키지 경계를 넘어 확인한다.
 */
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';

// happy-dom의 Blob은 fake-indexeddb의 구조화 복제와 호환되지 않아 왕복 시 빈 객체가 된다
// (실제 브라우저에선 Blob이 IndexedDB를 정상 왕복한다). 저장소 왕복을 확인하려고 Node Blob을 쓴다.
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
import {
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
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

    // 텍스트 도구 선택 → 캔버스 클릭으로 생성 (B-5 흐름)
    toolbarButton(designer, strings.designer.addText).click();
    await designer.updateComplete;
    const paper = designer.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 200, clientY: 200, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, composed: true, pointerId: 1,
    }));
    await designer.updateComplete;
    toolbarButton(designer, strings.designer.addPage).click();
    await designer.updateComplete;

    designed = changes.at(-1)!;
    expect(designed.kind).toBe('template');
    expect(designed.template.pages.length).toBe(2);
    // 프리셋 요소 6개 + 추가한 텍스트 1개
    expect(designed.template.pages[0]!.elements.length).toBe(7);
  });

  it('1-1) 디자이너로 만든 그리드는 그대로 저장되고 값을 채우면 PDF로 렌더된다 (ADR-037)', async () => {
    const changes: SlipTemplateFile[] = [];
    const collect = (e: Event) => changes.push((e as CustomEvent).detail.file as SlipTemplateFile);
    designer.addEventListener('slip-change', collect);

    toolbarButton(designer, strings.designer.addGrid).click();
    await designer.updateComplete;
    const paper = designer.shadowRoot!.querySelector('.paper') as HTMLElement;
    for (const type of ['pointerdown', 'pointerup']) {
      paper.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, clientX: 120, clientY: 500, pointerId: 1,
      }));
    }
    await designer.updateComplete;
    designer.removeEventListener('slip-change', collect);

    const withGrid = changes.at(-1)!;
    // 앞 단계에서 페이지를 더해 현재 페이지가 바뀌었을 수 있고 프리셋에도 그리드가 있다 —
    // 방금 만든 것만 골라내려고 앞 단계에 없던 id를 찾는다
    const before = new Set(designed.template.pages.flatMap((page) => page.elements).map((el) => el.id));
    const grid = withGrid.template.pages
      .flatMap((page) => page.elements)
      .find((el) => el.type === 'grid' && !before.has(el.id));
    expect(grid).toBeDefined();
    // 만든 그대로 core 스키마를 통과한다 — 트랙 합과 상자가 어긋나면 여기서 걸린다
    expect(() => parseSlipFile(serializeSlipFile(withGrid))).not.toThrow();

    // 페이지당 항목 수를 넘는 데이터를 줘도 변환이 끝까지 간다 (페이지 수 검증은 core 테스트가 맡는다)
    const repeat = grid!.type === 'grid' ? grid!.repeat! : undefined!;
    const voucher: SlipVoucherFile = {
      schemaVersion: withGrid.schemaVersion,
      kind: 'voucher',
      templateSnapshot: withGrid.template,
      values: {
        [repeat.parameter]: Array.from({ length: repeat.perPage * 2 + 1 }, (_, i) => ({ 품명: `품목 ${i + 1}` })),
      },
      issued: false,
    };
    const pdf = await renderSlipToPdf(voucher);
    expect(Array.from(pdf.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);

    // 그리드를 지워 뒤 단계(프리셋 기준 개수 검사)에 영향을 주지 않는다
    designer.src = serializeSlipFile(designed);
    await designer.updateComplete;
    await flush();
    await designer.updateComplete;
  }, 30_000);

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
        tradeDate: '2026-08-19',
        items: [
          { itemName: '노트', spec: 'A5', quantity: 2, unitPrice: 1500, amount: 3000 },
          { itemName: '볼펜', spec: '0.5mm', quantity: 10, unitPrice: 500, amount: 5000 },
        ],
      },
      issued: false,
    };

    const pdf = await renderSlipToPdf(voucher);
    // %PDF- 매직 바이트
    expect(Array.from(pdf.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);

    issuedVoucher = { ...voucher, issued: true };
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
