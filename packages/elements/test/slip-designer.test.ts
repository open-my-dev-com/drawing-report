// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@slipkit/core', () => ({
  parseSlipFile: vi.fn(),
  renderSlipToPdf: vi.fn(),
  CURRENT_SCHEMA_VERSION: '0.1.0',
}));

import { parseSlipFile, renderSlipToPdf } from '@slipkit/core';
import type { SlipFile, SlipTemplateFile } from '@slipkit/core';
import { strings } from '../src/strings.js';

const parseSlipFileMock = vi.mocked(parseSlipFile);
const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);

function makeTemplateFile(): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '테스트' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
      pages: [{
        elements: [
          {
            type: 'text' as const,
            id: 'txt-1',
            name: 'test-text',
            position: { x: 30, y: 40 },
            width: 60,
            height: 10,
            content: '테스트 텍스트',
          },
          {
            type: 'shape' as const,
            id: 'shp-1',
            name: 'test-shape',
            position: { x: 100, y: 80 },
            width: 50,
            height: 30,
            shape: 'rect' as const,
          },
        ],
      }],
      assets: [],
    },
  };
}

const DUMMY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

let blobUrls: string[];
let revokedUrls: string[];
let uuidCounter: number;

beforeEach(() => {
  blobUrls = [];
  revokedUrls = [];
  uuidCounter = 0;

  let urlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:test-${++urlCounter}`;
    blobUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revokedUrls.push(url);
  });

  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    return `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
  });

  parseSlipFileMock.mockReturnValue(makeTemplateFile() as unknown as SlipFile);
  renderSlipToPdfMock.mockResolvedValue(DUMMY_PDF);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createElement(): Promise<import('../src/slip-designer.js').SlipDesigner> {
  const { SlipDesigner } = await import('../src/slip-designer.js');
  if (!customElements.get('slip-designer')) {
    customElements.define('slip-designer', SlipDesigner);
  }
  const el = document.createElement('slip-designer') as import('../src/slip-designer.js').SlipDesigner;
  document.body.appendChild(el);
  return el;
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function shadowText(el: Element): string {
  return el.shadowRoot?.textContent?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// 빈 상태
// ---------------------------------------------------------------------------

describe('<slip-designer> 빈 상태', () => {
  it('src가 없으면 안내 메시지를 표시한다', async () => {
    const el = await createElement();
    await el.updateComplete;
    expect(shadowText(el)).toBe(strings.designer.noTemplate);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 파싱 오류
// ---------------------------------------------------------------------------

describe('<slip-designer> 파싱 오류', () => {
  it('잘못된 src는 파싱 오류를 표시한다', async () => {
    parseSlipFileMock.mockImplementation(() => {
      throw new Error('parse error');
    });
    const el = await createElement();
    el.src = '{ invalid }';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(shadowText(el)).toContain(strings.designer.parseError);
    el.remove();
  });

  it('voucher 파일은 양식 전용 오류를 표시한다', async () => {
    parseSlipFileMock.mockReturnValue({
      schemaVersion: '0.1.0',
      kind: 'voucher',
    } as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"kind":"voucher"}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(shadowText(el)).toContain(strings.designer.onlyTemplate);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 양식 로드
// ---------------------------------------------------------------------------

describe('<slip-designer> 양식 로드', () => {
  it('유효한 src로 캔버스에 요소를 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(2);
    expect(elements?.[0]?.getAttribute('data-id')).toBe('txt-1');
    expect(elements?.[1]?.getAttribute('data-id')).toBe('shp-1');
    el.remove();
  });

  it('용지(paper) 크기만큼 캔버스를 렌더한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const paper = el.shadowRoot?.querySelector('.paper') as HTMLElement;
    expect(paper).not.toBeNull();
    const pxPerMm = 96 / 25.4;
    expect(parseFloat(paper.style.width)).toBeCloseTo(210 * pxPerMm, 0);
    expect(parseFloat(paper.style.height)).toBeCloseTo(297 * pxPerMm, 0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 요소 선택
// ---------------------------------------------------------------------------

describe('<slip-designer> 요소 선택', () => {
  it('요소 클릭 시 selected 클래스를 적용한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    expect(elementDiv).not.toBeNull();

    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const selectedEl = el.shadowRoot?.querySelector('.element.selected');
    expect(selectedEl?.getAttribute('data-id')).toBe('txt-1');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 요소 추가
// ---------------------------------------------------------------------------

describe('<slip-designer> 요소 추가', () => {
  it('텍스트 요소를 추가하고 slip-change 이벤트를 발행한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);

    const addBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.addText) as HTMLElement;
    expect(addBtn).not.toBeUndefined();
    addBtn.click();
    await el.updateComplete;

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(3);
    expect(changes.length).toBe(1);
    expect(changes[0]!.detail.file.kind).toBe('template');
    el.remove();
  });

  it('6종 요소를 모두 추가할 수 있다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const buttons = el.shadowRoot?.querySelectorAll('.toolbar button');
    const typeLabels = [
      strings.designer.addText,
      strings.designer.addFixedGrid,
      strings.designer.addDynamicTable,
      strings.designer.addImage,
      strings.designer.addShape,
      strings.designer.addField,
    ];

    for (const label of typeLabels) {
      const btn = Array.from(buttons ?? []).find((b) => b.textContent?.trim() === label) as HTMLElement;
      expect(btn, `${label} 버튼이 있어야 한다`).not.toBeUndefined();
      btn.click();
      await el.updateComplete;
    }

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(2 + 6);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 요소 삭제
// ---------------------------------------------------------------------------

describe('<slip-designer> 요소 삭제', () => {
  it('선택된 요소를 삭제하고 slip-change 이벤트를 발행한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 요소 선택
    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);

    // 삭제 버튼 클릭
    const deleteBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.delete) as HTMLElement;
    deleteBtn.click();
    await el.updateComplete;

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(1);
    expect(changes.length).toBe(1);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 되돌리기 / 다시 실행
// ---------------------------------------------------------------------------

describe('<slip-designer> 되돌리기·다시 실행', () => {
  it('요소 추가 후 되돌리면 원래 상태로 복구된다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 요소 추가
    const addBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.addText) as HTMLElement;
    addBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    // 되돌리기
    const undoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.undo) as HTMLElement;
    undoBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

    // 다시 실행
    const redoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.redo) as HTMLElement;
    redoBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 속성 패널
// ---------------------------------------------------------------------------

describe('<slip-designer> 속성 패널', () => {
  it('요소 미선택 시 안내 메시지를 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const panelText = el.shadowRoot?.querySelector('.panel-empty')?.textContent?.trim();
    expect(panelText).toBe(strings.designer.noSelection);
    el.remove();
  });

  it('요소 선택 시 유형 이름을 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const typeName = el.shadowRoot?.querySelector('.type-name')?.textContent?.trim();
    expect(typeName).toBe(strings.designer.typeText);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 크기 조절 핸들
// ---------------------------------------------------------------------------

const PX_PER_MM = 96 / 25.4;

async function loadDesigner() {
  const el = await createElement();
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

function selectElement(el: Element, id: string): HTMLElement {
  const div = el.shadowRoot?.querySelector(`[data-id="${id}"]`) as HTMLElement;
  div.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
  }));
  div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
  return div;
}

describe('<slip-designer> 크기 조절 핸들', () => {
  it('요소를 선택하면 8방향 핸들이 나타난다', async () => {
    const el = await loadDesigner();

    expect(el.shadowRoot?.querySelectorAll('.handle').length).toBe(0);

    selectElement(el, 'txt-1');
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.handle').length).toBe(8);
    el.remove();
  });

  it('남동(se) 핸들을 끌면 요소 크기가 커지고 slip-change를 발행한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);

    // txt-1: (30,40) 60×10 → se 핸들을 +10mm/+10mm 끌면 70×20
    const handle = el.shadowRoot?.querySelector('.handle-se') as HTMLElement;
    expect(handle).not.toBeNull();
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true,
      clientX: 10 * PX_PER_MM, clientY: 10 * PX_PER_MM, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(changes.length).toBe(1);
    const changed = changes[0]!.detail.file.template.pages[0].elements[0];
    expect(changed.width).toBe(70);
    expect(changed.height).toBe(20);
    expect(changed.position).toEqual({ x: 30, y: 40 });
    el.remove();
  });

  it('최소 크기(2mm) 밑으로는 줄어들지 않는다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    // txt-1 너비 60mm → -100mm 끌어도 2mm에서 멈춘다
    const handle = el.shadowRoot?.querySelector('.handle-e') as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: -100 * PX_PER_MM, clientY: 0, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const widthInput = Array.from(el.shadowRoot?.querySelectorAll('.prop-row') ?? [])
      .find((row) => row.querySelector('label')?.textContent === strings.designer.width)
      ?.querySelector('input') as HTMLInputElement;
    expect(Number(widthInput.value)).toBe(2);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 스냅·정렬 안내선
// ---------------------------------------------------------------------------

describe('<slip-designer> 스냅·정렬 안내선', () => {
  it('다른 요소 가장자리 근처로 끌면 스냅되고 안내선이 나타난다', async () => {
    const el = await loadDesigner();
    const div = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;

    // txt-1 왼쪽 변(x=30)을 shp-1 왼쪽 변(x=100) 근처(99mm)로 끌면 100으로 스냅
    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 69 * PX_PER_MM, clientY: 0, pointerId: 1,
    }));
    await el.updateComplete;

    const guide = el.shadowRoot?.querySelector('.snap-guide.vertical') as HTMLElement;
    expect(guide).not.toBeNull();
    expect(parseFloat(guide.style.left)).toBeCloseTo(100 * PX_PER_MM, 0);

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);
    div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    // 놓으면 안내선은 사라지고 위치는 스냅된 값
    expect(el.shadowRoot?.querySelector('.snap-guide')).toBeNull();
    expect(changes[0]!.detail.file.template.pages[0].elements[0].position.x).toBe(100);
    el.remove();
  });

  it('Alt를 누르면 스냅 없이 자유 이동한다', async () => {
    const el = await loadDesigner();
    const div = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;

    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 69 * PX_PER_MM, clientY: 0,
      pointerId: 1, altKey: true,
    }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.snap-guide')).toBeNull();

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);
    div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(changes[0]!.detail.file.template.pages[0].elements[0].position.x).toBe(99);
    el.remove();
  });

  it('크기 조절 중에도 움직이는 변이 후보 선에 스냅된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    // txt-1 오른쪽 변(x=90)을 shp-1 왼쪽 변(x=100) 근처(99mm)로 늘리면 100으로 스냅 → 너비 70
    const handle = el.shadowRoot?.querySelector('.handle-e') as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 9 * PX_PER_MM, clientY: 0, pointerId: 1,
    }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.snap-guide.vertical')).not.toBeNull();

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(changes[0]!.detail.file.template.pages[0].elements[0].width).toBe(70);
    el.remove();
  });

  it('되돌리기로 크기 조절 전 상태로 복구된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const handle = el.shadowRoot?.querySelector('.handle-se') as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true,
      clientX: 10 * PX_PER_MM, clientY: 10 * PX_PER_MM, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', ((e: CustomEvent) => changes.push(e)) as EventListener);
    const undoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.undo) as HTMLElement;
    undoBtn.click();
    await el.updateComplete;

    const restored = changes[0]!.detail.file.template.pages[0].elements[0];
    expect(restored.width).toBe(60);
    expect(restored.height).toBe(10);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 미리보기
// ---------------------------------------------------------------------------

describe('<slip-designer> 미리보기', () => {
  it('미리보기 전환 시 PDF를 생성하고 iframe을 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const previewBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.preview) as HTMLElement;
    previewBtn.click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(renderSlipToPdfMock).toHaveBeenCalled();
    const iframe = el.shadowRoot?.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toMatch(/^blob:/);
    el.remove();
  });

  it('편집 버튼으로 캔버스 모드로 복귀한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 미리보기 진입
    const previewBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.preview) as HTMLElement;
    previewBtn.click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 편집으로 복귀
    const editBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => b.textContent?.trim() === strings.designer.edit) as HTMLElement;
    editBtn.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.canvas-area')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('iframe')).toBeNull();
    expect(revokedUrls.length).toBeGreaterThan(0);
    el.remove();
  });
});
