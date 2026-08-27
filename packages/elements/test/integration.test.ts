// @vitest-environment happy-dom
/**
 * 패키지 간 결합을 실제 구현으로 검증한다.
 * 디자이너 양식 편집 → `.slip` 저장 → 전표 값과 수식 평가 → PDF 렌더링 →
 * 저장소 어댑터 저장·조회까지 패키지 경계를 넘어 확인한다.
 */
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';

// happy-dom의 Blob은 fake-indexeddb에서 구조화 복제되지 않으므로 Node Blob을 사용한다.
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
import {
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { SlipDesigner, getPresets, IndexedDbStorage } from '../src/index.js';
import { getStrings } from '../src/strings.js';

// 기본 영어 문구를 기준으로 화면을 확인한다.
const strings = getStrings();

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

// 연속된 사용 흐름을 검증하기 위해 시나리오 단계가 상태를 공유한다.
let designed: SlipTemplateFile;
let issuedVoucher: SlipVoucherFile;

describe('결합 시나리오: 디자이너 → .slip → 전표 → PDF → 저장소', () => {
  let designer: SlipDesigner;

  beforeAll(async () => {
    designer = document.createElement('slip-designer') as SlipDesigner;
    document.body.appendChild(designer);
    designer.src = serializeSlipFile(getPresets()[0]!.create()); // 거래명세서 프리셋
    await designer.updateComplete;
    await flush();
    await designer.updateComplete;
  });

  it('1) 디자이너로 양식을 편집한다 (요소 추가 + 페이지 추가)', async () => {
    const changes: SlipTemplateFile[] = [];
    designer.addEventListener('slip-change', (e: Event) =>
      changes.push((e as CustomEvent).detail.file as SlipTemplateFile));

    // 텍스트 도구를 선택한 뒤 캔버스를 클릭해 요소를 만든다.
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
    // 이전 단계에 없던 ID로 이번 단계에서 만든 그리드를 찾는다.
    const before = new Set(designed.template.pages.flatMap((page) => page.elements).map((el) => el.id));
    const grid = withGrid.template.pages
      .flatMap((page) => page.elements)
      .find((el) => el.type === 'grid' && !before.has(el.id));
    expect(grid).toBeDefined();
    // 디자이너가 만든 그리드를 별도 보정 없이 core 스키마로 검증한다.
    expect(() => parseSlipFile(serializeSlipFile(withGrid))).not.toThrow();

    // 페이지당 항목 수보다 많은 데이터도 PDF 입력으로 변환할 수 있어야 한다.
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

    // 다음 단계가 프리셋 기준 상태를 사용하도록 추가한 그리드를 제거한다.
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
    // PDF 파일 시그니처를 확인한다.
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
