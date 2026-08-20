// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', () => ({
  parseSlipFile: vi.fn(),
  renderSlipToPdf: vi.fn(),
  CURRENT_SCHEMA_VERSION: '0.1.0',
}));

vi.mock('../src/default-fonts.js', () => ({
  // 실제 폰트 데이터(4MB) 대신 즉시 해소되는 모의 — 배선만 검증한다.
  // 실데이터 검증은 default-fonts.test.ts 담당.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import { parseSlipFile, renderSlipToPdf } from '@omdc-slipkit/core';
import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
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

let revokedUrls: string[];
let uuidCounter: number;

beforeEach(() => {
  revokedUrls = [];
  uuidCounter = 0;

  let urlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++urlCounter}`);
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

/**
 * 생성 도구를 누른 뒤 캔버스를 클릭해 요소를 만든다 (B-5 흐름).
 * happy-dom은 getBoundingClientRect가 0이라 mm 좌표 = clientX / PX_PER_MM.
 */
async function addByCanvasClick(
  el: import('../src/slip-designer.js').SlipDesigner,
  label: string,
  clientX = 200,
  clientY = 200,
): Promise<void> {
  toolbarButton(el, label).click();
  await el.updateComplete;
  const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
  paper.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, clientX, clientY, pointerId: 1,
  }));
  paper.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, composed: true, clientX, clientY, pointerId: 1,
  }));
  await el.updateComplete;
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
// 선 요소 캔버스 표시 — PDF 변환 규칙(긴 쪽 방향 직선)과 같아야 한다
// ---------------------------------------------------------------------------

describe('<slip-designer> 선 요소 캔버스 표시', () => {
  function makeLineFile(width: number, height: number): SlipFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'shape' as const,
      id: 'line-1',
      name: 'test-line',
      position: { x: 10, y: 10 },
      width,
      height,
      shape: 'line' as const,
    }];
    return file as unknown as SlipFile;
  }

  async function mountLine(width: number, height: number) {
    parseSlipFileMock.mockReturnValue(makeLineFile(width, height));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  it('가로가 긴 선은 가로 직선으로 그린다', async () => {
    const el = await mountLine(50, 5);
    const line = el.shadowRoot?.querySelector('.element svg line');
    expect(line?.getAttribute('y1')).toBe(line?.getAttribute('y2'));
    expect(line?.getAttribute('x1')).not.toBe(line?.getAttribute('x2'));
    el.remove();
  });

  it('세로가 긴 선은 세로 직선으로 그린다', async () => {
    const el = await mountLine(5, 50);
    const line = el.shadowRoot?.querySelector('.element svg line');
    expect(line?.getAttribute('x1')).toBe(line?.getAttribute('x2'));
    expect(line?.getAttribute('y1')).not.toBe(line?.getAttribute('y2'));
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 캔버스 스타일 즉시 반영 (v2 A-3) — 글자 크기·정렬·색이 편집 화면에 보인다
// ---------------------------------------------------------------------------

describe('<slip-designer> 캔버스 스타일 반영', () => {
  async function mountWith(elements: unknown[]): Promise<import('../src/slip-designer.js').SlipDesigner> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = elements as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  it('텍스트의 글자 크기·정렬이 캔버스에 반영된다 (pt → 4/3px)', async () => {
    const el = await mountWith([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목', fontSize: 15, alignment: 'center',
    }]);
    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    expect(parseFloat(content.style.fontSize)).toBeCloseTo(20, 5); // 15pt × 4/3
    expect(content.style.justifyContent).toBe('center');
    el.remove();
  });

  it('고정 그리드의 셀 문구·병합·셀 배경이 캔버스에 그려진다', async () => {
    const el = await mountWith([{
      type: 'fixedGrid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
      width: 90, height: 30, rows: 2, columns: 3, columnWidthPercentages: [50, 25, 25],
      cells: [
        { row: 0, column: 0, rowSpan: 2, content: '병합 라벨', backgroundColor: '#F2F2F2' },
        { row: 0, column: 1, content: '값' },
      ],
    }]);
    const cells = el.shadowRoot?.querySelectorAll('.grid-preview > div');
    // 전체 6칸 중 병합(2칸 차지) 원점 1 + 일반 셀 1 + 빈 칸 3 = 5개
    expect(cells?.length).toBe(5);
    const merged = Array.from(cells!).find((c) => c.textContent === '병합 라벨') as HTMLElement;
    expect(merged.style.gridArea.replaceAll(' ', '')).toContain('span2');
    expect(merged.style.backgroundColor).toBeTruthy();
    el.remove();
  });

  it('동적 표 머리행은 배경색(기본 #eeeeee)이 칠해지고 상자 전체는 칠하지 않는다', async () => {
    const el = await mountWith([{
      type: 'dynamicTable', id: 'd1', name: 'd', position: { x: 10, y: 50 },
      width: 90, height: 20, head: ['품명', '금액'], headWidthPercentages: [60, 40],
      repeatHead: true, binding: 'items', backgroundColor: '#ffee00',
    }]);
    const box = el.shadowRoot?.querySelector('.element.type-dynamicTable') as HTMLElement;
    expect(box.style.backgroundColor).toBe('');
    const headCell = el.shadowRoot?.querySelector('.table-preview > div') as HTMLElement;
    expect(headCell.style.backgroundColor).toBeTruthy();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// UI 정리 (v2 A-4) — 아이콘 툴바·정렬 토글·색 피커
// ---------------------------------------------------------------------------

describe('<slip-designer> UI 정리 (A-4)', () => {
  async function mountAndSelectText(): Promise<import('../src/slip-designer.js').SlipDesigner> {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    (el.shadowRoot?.querySelector('.element[data-id="txt-1"]') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true }),
    );
    await el.updateComplete;
    return el;
  }

  function byAriaLabel(el: Element, label: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;
  }

  it('툴바 버튼은 아이콘(svg) + 이름(title·aria-label)으로 표시된다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const buttons = el.shadowRoot?.querySelectorAll('.toolbar button');
    expect(buttons!.length).toBeGreaterThan(10);
    for (const b of Array.from(buttons!)) {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
    }
    el.remove();
  });

  it('정렬은 아이콘 토글로 바꾼다 — 가운데 클릭 시 alignment가 저장되고 눌림 상태가 바뀐다', async () => {
    const el = await mountAndSelectText();
    const label = `${strings.designer.alignment}: ${strings.designer.alignCenter}`;
    const centerBtn = byAriaLabel(el, label);
    expect(centerBtn.getAttribute('aria-pressed')).toBe('false');

    centerBtn.click();
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect((text as Record<string, unknown>).alignment).toBe('center');
    expect(byAriaLabel(el, label).getAttribute('aria-pressed')).toBe('true');
    el.remove();
  });

  it('색 피커 — 색 버튼을 펼쳐 팔레트 견본으로 색을 지정하고, 없음으로 지운다', async () => {
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click(); // 색 버튼 펼침
    await el.updateComplete;
    const swatch = byAriaLabel(el, `${strings.designer.backgroundColor} #d93025`);
    swatch.click();
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    const text = file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#d93025');

    byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.colorNone}`).click();
    await el.updateComplete;
    expect(text.backgroundColor ?? undefined).toBeUndefined();
    el.remove();
  });

  it('툴바 버튼은 아이콘 아래에 작은 이름 라벨을 함께 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    for (const b of Array.from(el.shadowRoot!.querySelectorAll('.toolbar button'))) {
      expect(b.querySelector('.btn-label')?.textContent).toBe(b.getAttribute('aria-label'));
    }
    el.remove();
  });

  it('색 미지정이면 색 버튼 칩이 없음 표시로 보이고, 색을 고르면 색으로 바뀐다', async () => {
    const el = await mountAndSelectText();
    const btn = byAriaLabel(el, strings.designer.backgroundColor);
    expect(btn.querySelector('.color-chip')?.classList.contains('none')).toBe(true);
    expect(btn.textContent).toContain(strings.designer.colorNone);

    btn.click(); // 펼침
    await el.updateComplete;
    byAriaLabel(el, `${strings.designer.backgroundColor} #1a73e8`).click();
    await el.updateComplete;
    const after = byAriaLabel(el, strings.designer.backgroundColor);
    expect(after.querySelector('.color-chip')?.classList.contains('none')).toBe(false);
    expect(after.textContent).toContain('#1a73e8');
    el.remove();
  });

  it('색 피커 — 투명도를 내리면 #RRGGBBAA 8자리로 저장된다', async () => {
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click(); // 색 버튼 펼침
    await el.updateComplete;
    byAriaLabel(el, `${strings.designer.backgroundColor} #1a73e8`).click();
    await el.updateComplete;

    const alpha = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.backgroundColor} ${strings.designer.opacity}`)!;
    alpha.value = '50';
    alpha.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#1a73e880');
    el.remove();
  });

  it('색 피커 — 버튼 한 번에 견본·색상판·색조가 함께 펼쳐지고, 색조 변경이 바로 저장된다', async () => {
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click();
    await el.updateComplete;

    // 한 번의 클릭으로 팔레트 견본과 색상판·색조 슬라이더가 전부 보인다 (별도 창 없음)
    expect(el.shadowRoot?.querySelector('.sv-area')).not.toBeNull();
    expect(el.shadowRoot?.querySelectorAll('.swatch').length).toBeGreaterThan(2);

    const hue = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.backgroundColor} ${strings.designer.hue}`)!;
    hue.value = '120';
    hue.dispatchEvent(new Event('input', { bubbles: true }));
    hue.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#00ff00');
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

describe('<slip-designer> 요소 추가 (도구 선택 → 캔버스 클릭·드래그, B-5)', () => {
  const PX = 96 / 25.4;

  it('도구 버튼은 누르면 눌림 상태가 되고, 캔버스를 클릭해야 그 위치에 요소가 생긴다', async () => {
    const el = await loadDesigner();

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    const addBtn = toolbarButton(el, strings.designer.addText);
    addBtn.click();
    await el.updateComplete;

    // 도구만 선택한 상태 — 아직 요소가 생기지 않는다
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('true');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(changes.length).toBe(0);

    // 캔버스 클릭 → 그 위치에 기본 크기로 생성, 도구는 해제
    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 50 * PX, clientY: 40 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);
    expect(changes.length).toBe(1);
    expect(changes[0]!.detail.file.kind).toBe('template');
    const added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements.at(-1)!;
    expect(added.position.x).toBeCloseTo(50, 0);
    expect(added.position.y).toBeCloseTo(40, 0);
    expect(added.width).toBe(60); // 텍스트 기본 크기
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('false');
    el.remove();
  });

  it('드래그하면 끌어낸 사각형의 위치·크기로 생성되고 점선 미리보기가 표시된다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addShape).click();
    await el.updateComplete;

    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10 * PX, clientY: 20 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 40 * PX, clientY: 35 * PX, pointerId: 1,
    }));
    await el.updateComplete;

    // 드래그 중에는 점선 미리보기가 보인다
    expect(el.shadowRoot?.querySelector('.draw-ghost')).not.toBeNull();

    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.draw-ghost')).toBeNull();
    const added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements.at(-1)!;
    expect(added.type).toBe('shape');
    expect(added.position.x).toBeCloseTo(10, 0);
    expect(added.position.y).toBeCloseTo(20, 0);
    expect(added.width).toBeCloseTo(30, 0);
    expect(added.height).toBeCloseTo(15, 0);
    el.remove();
  });

  it('Escape나 같은 도구 재클릭으로 도구 선택이 취소된다', async () => {
    const el = await loadDesigner();

    toolbarButton(el, strings.designer.addText).click();
    await el.updateComplete;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('false');

    toolbarButton(el, strings.designer.addText).click();
    await el.updateComplete;
    toolbarButton(el, strings.designer.addText).click();
    await el.updateComplete;
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('false');

    // 해제된 뒤 캔버스 클릭은 요소를 만들지 않는다
    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 100, clientY: 100, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('6종 요소를 모두 추가할 수 있다', async () => {
    const el = await loadDesigner();
    const typeLabels = [
      strings.designer.addText,
      strings.designer.addFixedGrid,
      strings.designer.addDynamicTable,
      strings.designer.addImage,
      strings.designer.addShape,
      strings.designer.addField,
    ];

    for (const label of typeLabels) {
      await addByCanvasClick(el, label);
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
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    // 삭제 버튼 클릭
    const deleteBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.delete) as HTMLElement;
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

    // 요소 추가 (도구 선택 → 캔버스 클릭)
    await addByCanvasClick(el, strings.designer.addText);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    // 되돌리기
    const undoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.undo) as HTMLElement;
    undoBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

    // 다시 실행
    const redoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.redo) as HTMLElement;
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
  it('요소 미선택 시 양식 설정 패널을 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const typeName = el.shadowRoot?.querySelector('.type-name')?.textContent?.trim();
    expect(typeName).toBe(strings.designer.formSettings);
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
// 왼쪽 사이드바 (B-7) — 페이지 썸네일·요소 목록·바인딩 목록
// ---------------------------------------------------------------------------

describe('<slip-designer> 사이드바', () => {
  function sideSection(el: Element, title: string): Element {
    const section = Array.from(el.shadowRoot!.querySelectorAll('.side-section'))
      .find((sec) => sec.querySelector('.side-title')?.textContent?.trim() === title);
    if (!section) throw new Error(`사이드바 섹션을 찾지 못했습니다: ${title}`);
    return section;
  }

  it('페이지 썸네일이 페이지 수만큼 보이고, 클릭하면 그 페이지로 이동한다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const thumbs = sideSection(el, strings.designer.sidebarPages).querySelectorAll('.thumb');
    expect(thumbs.length).toBe(2);
    // 페이지 추가 직후엔 2페이지가 현재 — 1페이지 썸네일 클릭으로 되돌아간다
    expect(thumbs[1]?.classList.contains('current')).toBe(true);
    (thumbs[0] as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('1 / 2');
    // 1페이지 요소(2개)가 캔버스에 보인다
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('썸네일 안에 그 페이지 요소들이 축소 상자로 그려진다', async () => {
    const el = await loadDesigner();
    const firstThumb = sideSection(el, strings.designer.sidebarPages).querySelector('.thumb');
    expect(firstThumb?.querySelectorAll('.thumb-el').length).toBe(2);
    el.remove();
  });

  it('요소 목록에 현재 페이지 요소가 나열되고, 클릭하면 그 요소가 선택된다', async () => {
    const el = await loadDesigner();
    const rows = sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row');
    expect(Array.from(rows).map((r) => r.textContent?.trim())).toEqual(['test-text', 'test-shape']);

    (rows[1] as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id')).toBe('shp-1');
    const after = sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row');
    expect(after[1]?.classList.contains('selected')).toBe(true);
    el.remove();
  });

  it('바인딩 목록은 양식 전체의 field·동적 표 바인딩을 모으고, 클릭하면 페이지를 옮겨 선택한다', async () => {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'field' as const, id: 'fld-1', name: 'f1', position: { x: 10, y: 10 },
          width: 60, height: 10, binding: '합계금액',
        } as never,
        {
          type: 'dynamicTable' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          width: 180, height: 20, head: ['a'], headWidthPercentages: [100],
          repeatHead: true, binding: 'items',
        } as never,
      ],
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const rows = sideSection(el, strings.designer.sidebarBindings).querySelectorAll('.side-row');
    expect(Array.from(rows).map((r) => r.textContent?.trim())).toEqual(['합계금액', 'items']);

    (rows[0] as HTMLElement).click();
    await el.updateComplete;

    // 2페이지로 이동해 해당 field가 선택된다
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('2 / 2');
    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id')).toBe('fld-1');
    el.remove();
  });

  it('미리보기 모드에서는 사이드바가 표시되지 않는다', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot?.querySelector('.sidebar')).not.toBeNull();

    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.sidebar')).toBeNull();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 좌표 기준점 (B-8) — X·Y 표시·입력의 기준 9점, 파일은 늘 좌상단 좌표
// ---------------------------------------------------------------------------

describe('<slip-designer> 좌표 기준점', () => {
  function anchorDot(el: Element, name: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.anchor-dot'))
      .find((b) => b.getAttribute('aria-label') === `${strings.designer.anchor}: ${name}`) as HTMLButtonElement;
  }

  function xyInputs(el: Element): [HTMLInputElement, HTMLInputElement] {
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'));
    const x = rows.find((r) => r.querySelector('label')?.textContent?.trim() === 'X')!
      .querySelector('input') as HTMLInputElement;
    const y = rows.find((r) => r.querySelector('label')?.textContent?.trim() === 'Y')!
      .querySelector('input') as HTMLInputElement;
    return [x, y];
  }

  // 픽스처 텍스트 요소: position (30, 40), 크기 60×10

  it('기본 기준점은 좌상 — X·Y 표시가 저장 좌표와 같다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    expect(anchorDot(el, strings.designer.anchorTL).getAttribute('aria-pressed')).toBe('true');
    const [x, y] = xyInputs(el);
    expect(x.value).toBe('30');
    expect(y.value).toBe('40');
    el.remove();
  });

  it('중앙 기준을 고르면 X·Y가 중앙 좌표로 표시되고 파일 좌표는 그대로다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    anchorDot(el, strings.designer.anchorC).click();
    await el.updateComplete;

    const [x, y] = xyInputs(el);
    expect(x.value).toBe('60'); // 30 + 60/2
    expect(y.value).toBe('45'); // 40 + 10/2
    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect(text.position).toEqual({ x: 30, y: 40 });
    // 기준점 변경만으로는 파일이 바뀌지 않는다
    expect(changes.length).toBe(0);
    el.remove();
  });

  it('중앙 기준으로 X를 입력하면 좌상단 좌표로 환산해 저장한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    anchorDot(el, strings.designer.anchorC).click();
    await el.updateComplete;

    const [x] = xyInputs(el);
    x.value = '100';
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect(text.position.x).toBe(70); // 100 - 60/2
    expect(text.position.y).toBe(40);
    // 표시도 입력한 기준점 좌표를 유지한다
    expect(xyInputs(el)[0].value).toBe('100');
    el.remove();
  });

  it('우하 기준은 X·Y를 오른쪽 아래 모서리 좌표로 표시한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    anchorDot(el, strings.designer.anchorBR).click();
    await el.updateComplete;

    const [x, y] = xyInputs(el);
    expect(x.value).toBe('90'); // 30 + 60
    expect(y.value).toBe('50'); // 40 + 10
    el.remove();
  });

  it('환산 결과가 음수가 되는 입력은 0으로 눌러 붙인다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    anchorDot(el, strings.designer.anchorBR).click();
    await el.updateComplete;

    const [x] = xyInputs(el);
    x.value = '10'; // 10 - 60 = -50 → 0
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect(text.position.x).toBe(0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 양식 설정 패널 (B-6) — 제목·용지 크기·방향·여백
// ---------------------------------------------------------------------------

describe('<slip-designer> 양식 설정 패널', () => {
  /** 라벨 문구로 속성 패널의 입력(input/select)을 찾는다 */
  function panelField(el: Element, label: string): HTMLInputElement | HTMLSelectElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 입력을 찾지 못했습니다: ${label}`);
    return row.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
  }

  function currentFile(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  function setField(field: HTMLInputElement | HTMLSelectElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('제목을 바꾸면 meta.title이 갱신되고 slip-change를 발행한다 (빈 값은 무시)', async () => {
    const el = await loadDesigner();
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    setField(panelField(el, strings.designer.formTitle), '새 양식 제목');
    await el.updateComplete;
    expect(currentFile(el).template.meta.title).toBe('새 양식 제목');
    expect(changes.length).toBe(1);

    setField(panelField(el, strings.designer.formTitle), '   ');
    await el.updateComplete;
    expect(currentFile(el).template.meta.title).toBe('새 양식 제목');
    expect(changes.length).toBe(1);
    el.remove();
  });

  it('용지 프리셋을 고르면 크기가 바뀌고 캔버스 용지도 함께 바뀐다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.paperSize), '1'); // A5 148×210
    await el.updateComplete;

    const { paper } = currentFile(el).template;
    expect(paper.width).toBe(148);
    expect(paper.height).toBe(210);
    const paperDiv = el.shadowRoot?.querySelector('.paper') as HTMLElement;
    expect(parseFloat(paperDiv.style.width)).toBeCloseTo(148 * PX_PER_MM, 0);
    el.remove();
  });

  it('방향을 가로로 바꾸면 너비·높이가 서로 바뀐다', async () => {
    const el = await loadDesigner();
    const landscapeBtn = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') ===
        `${strings.designer.orientation}: ${strings.designer.landscape}`) as HTMLButtonElement;
    expect(landscapeBtn.getAttribute('aria-pressed')).toBe('false');

    landscapeBtn.click();
    await el.updateComplete;

    const { paper } = currentFile(el).template;
    expect(paper.width).toBe(297);
    expect(paper.height).toBe(210);
    el.remove();
  });

  it('여백을 바꾸면 padding에 반영되고, 용지를 넘는 값은 무시한다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.marginTop), '25');
    await el.updateComplete;
    expect(currentFile(el).template.paper.padding).toEqual([25, 15, 20, 15]);

    // 왼쪽+오른쪽 여백 합이 용지 너비를 넘는 값은 되돌린다
    setField(panelField(el, strings.designer.marginLeft), '300');
    await el.updateComplete;
    expect(currentFile(el).template.paper.padding).toEqual([25, 15, 20, 15]);
    el.remove();
  });

  it('너비를 여백 합 이하로 줄이는 값은 무시한다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.width), '20'); // 좌우 여백 합 30 이하
    await el.updateComplete;
    expect(currentFile(el).template.paper.width).toBe(210);
    el.remove();
  });

  it('용지 변경은 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.paperSize), '1'); // A5
    await el.updateComplete;
    expect(currentFile(el).template.paper.width).toBe(148);

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(currentFile(el).template.paper.width).toBe(210);
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
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

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
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
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
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
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
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
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
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    const undoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.undo) as HTMLElement;
    undoBtn.click();
    await el.updateComplete;

    const restored = changes[0]!.detail.file.template.pages[0].elements[0];
    expect(restored.width).toBe(60);
    expect(restored.height).toBe(10);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 복사·붙여넣기
// ---------------------------------------------------------------------------

function toolbarButton(el: Element, label: string): HTMLButtonElement {
  return Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label) as HTMLButtonElement;
}

describe('<slip-designer> 복사·붙여넣기', () => {
  it('클립보드가 비어 있으면 붙여넣기 버튼이 비활성화된다', async () => {
    const el = await loadDesigner();
    expect(toolbarButton(el, strings.designer.paste).disabled).toBe(true);

    selectElement(el, 'txt-1');
    await el.updateComplete;
    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;

    expect(toolbarButton(el, strings.designer.paste).disabled).toBe(false);
    el.remove();
  });

  it('복사한 요소를 붙여넣으면 새 id로 5mm 어긋난 위치에 추가되고 slip-change를 발행한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    toolbarButton(el, strings.designer.paste).click();
    await el.updateComplete;

    expect(changes.length).toBe(1);
    const elements = changes[0]!.detail.file.template.pages[0].elements;
    expect(elements.length).toBe(3);
    const pasted = elements[2];
    expect(pasted.id).not.toBe('txt-1');
    expect(pasted.content).toBe('테스트 텍스트');
    expect(pasted.position).toEqual({ x: 35, y: 45 });
    // 붙여넣은 요소가 선택된다
    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id'))
      .toBe(pasted.id);
    el.remove();
  });

  it('연속 붙여넣기는 계단식으로 5mm씩 더 어긋난다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    toolbarButton(el, strings.designer.paste).click();
    await el.updateComplete;
    toolbarButton(el, strings.designer.paste).click();
    await el.updateComplete;

    const elements = changes[1]!.detail.file.template.pages[0].elements;
    expect(elements.length).toBe(4);
    expect(elements[2].position).toEqual({ x: 35, y: 45 });
    expect(elements[3].position).toEqual({ x: 40, y: 50 });
    el.remove();
  });

  it('Ctrl+C / Ctrl+V 단축키로 복사·붙여넣기한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);
    el.remove();
  });

  it('붙여넣기는 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;
    toolbarButton(el, strings.designer.paste).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 프리셋
// ---------------------------------------------------------------------------

describe('<slip-designer> 프리셋', () => {
  /** 프리셋 버튼을 눌러 메뉴를 펼치고 항목 버튼들을 돌려준다 */
  async function openPresetMenu(
    el: import('../src/slip-designer.js').SlipDesigner,
  ): Promise<HTMLButtonElement[]> {
    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    return Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button')) as HTMLButtonElement[];
  }

  it('프리셋 버튼을 누르면 메뉴에 2종이 나열되고, 다시 누르면 닫힌다', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();

    const items = await openPresetMenu(el);
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      strings.designer.presetTradeStatement,
      strings.designer.presetInvoice,
    ]);

    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();
    el.remove();
  });

  it('메뉴에서 프리셋을 고르면 양식이 교체되고 slip-change를 발행하며 메뉴가 닫힌다', async () => {
    const el = await loadDesigner();

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    const items = await openPresetMenu(el);
    items[0]!.click();
    await el.updateComplete;

    expect(changes.length).toBe(1);
    const file = changes[0]!.detail.file;
    expect(file.template.meta.title).toBe(strings.designer.presetTradeStatement);
    // 캔버스가 프리셋 요소로 교체된다 (기존 2개 → 프리셋 6개)
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(6);
    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();
    el.remove();
  });

  it('메뉴 바깥(배경)을 클릭하면 적용 없이 닫힌다', async () => {
    const el = await loadDesigner();
    await openPresetMenu(el);

    (el.shadowRoot!.querySelector('.menu-backdrop') as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.preset-menu')).toBeNull();
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('프리셋 적용은 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();

    const items = await openPresetMenu(el);
    items[1]!.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(6);

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 페이지 (ADR-026)
// ---------------------------------------------------------------------------

function pageIndicator(el: Element): string {
  return el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('<slip-designer> 페이지', () => {
  it('페이지 표시기가 현재/전체 페이지를 보여주고, 한 페이지면 삭제가 비활성화된다', async () => {
    const el = await loadDesigner();
    expect(pageIndicator(el)).toBe('1 / 1');
    expect(toolbarButton(el, strings.designer.deletePage).disabled).toBe(true);
    expect(toolbarButton(el, strings.designer.prevPage).disabled).toBe(true);
    expect(toolbarButton(el, strings.designer.nextPage).disabled).toBe(true);
    el.remove();
  });

  it('페이지를 추가하면 빈 새 페이지로 이동하고 slip-change를 발행한다', async () => {
    const el = await loadDesigner();
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    expect(pageIndicator(el)).toBe('2 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(0);
    expect(changes.length).toBe(1);
    expect(changes[0]!.detail.file.template.pages.length).toBe(2);
    expect(changes[0]!.detail.file.template.pages[1].elements).toEqual([]);
    el.remove();
  });

  it('이전/다음 버튼으로 페이지를 전환하면 해당 페이지 요소가 보인다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    toolbarButton(el, strings.designer.prevPage).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('1 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

    toolbarButton(el, strings.designer.nextPage).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('2 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(0);
    el.remove();
  });

  it('현재 페이지를 삭제하면 남은 페이지로 이동한다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    toolbarButton(el, strings.designer.deletePage).click();
    await el.updateComplete;

    expect(pageIndicator(el)).toBe('1 / 1');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(changes[0]!.detail.file.template.pages.length).toBe(1);
    el.remove();
  });

  it('페이지 추가는 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('2 / 2');

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('1 / 1');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 입력 필드 단축키 가드 (Shadow DOM 리타게팅)
// ---------------------------------------------------------------------------

/**
 * 실제 브라우저에서는 섀도 내부 입력란의 키 이벤트가 호스트에 도달할 때
 * target이 호스트로 재지정된다. 그 상황을 composedPath가 입력란을
 * 돌려주는 이벤트로 재현한다.
 */
function retargetedKey(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const input = el.shadowRoot?.querySelector('.prop-panel input') as HTMLInputElement;
  expect(input).not.toBeNull();
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  Object.defineProperty(event, 'composedPath', { value: () => [input] });
  return event;
}

describe('<slip-designer> 입력 필드 단축키 가드', () => {
  it('속성 패널 입력란에서 Backspace를 눌러도 요소가 삭제되지 않는다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(retargetedKey(el, 'Backspace'));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(el.shadowRoot?.querySelector('.element.selected')).not.toBeNull();
    el.remove();
  });

  it('입력란에서 Ctrl+V는 요소 붙여넣기를 실행하지 않는다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;

    el.dispatchEvent(retargetedKey(el, 'v', { ctrlKey: true }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('입력란에서 Ctrl+Z는 전체 양식 undo를 실행하지 않는다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addText);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(retargetedKey(el, 'z', { ctrlKey: true }));
    await el.updateComplete;

    // 입력란 텍스트 undo가 아니라면 양식은 그대로여야 한다
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);
    el.remove();
  });

  it('입력란 밖(캔버스)에서는 단축키가 그대로 동작한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(1);
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
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.preview) as HTMLElement;
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
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.preview) as HTMLElement;
    previewBtn.click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 편집으로 복귀
    const editBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.edit) as HTMLElement;
    editBtn.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.canvas-area')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('iframe')).toBeNull();
    expect(revokedUrls.length).toBeGreaterThan(0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// pointercancel · 미리보기 오류 표시
// ---------------------------------------------------------------------------

describe('<slip-designer> pointercancel', () => {
  it('드래그 중 취소되면 위치가 되돌아가고 이후 hover로 끌려다니지 않는다', async () => {
    const el = await loadDesigner();
    const div = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 20 * PX_PER_MM, clientY: 0, pointerId: 1,
    }));
    await el.updateComplete;

    div.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, composed: true }));
    await el.updateComplete;

    // 위치 복원 + 변경 이벤트 없음
    const moved = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    expect(parseFloat(moved.style.left)).toBeCloseTo(30 * PX_PER_MM, 0);
    expect(changes.length).toBe(0);

    // 취소 후 hover 이동만으로는 움직이지 않아야 한다
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 40 * PX_PER_MM, clientY: 0, pointerId: 1,
    }));
    await el.updateComplete;
    const after = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    expect(parseFloat(after.style.left)).toBeCloseTo(30 * PX_PER_MM, 0);
    el.remove();
  });
});

describe('<slip-designer> 미리보기 오류 표시', () => {
  it('PDF 생성이 실패하면 미리보기 화면에 오류를 표시한다', async () => {
    renderSlipToPdfMock.mockRejectedValueOnce(new Error('폰트 없음'));
    const el = await loadDesigner();

    const previewBtn = toolbarButton(el, strings.designer.preview);
    previewBtn.click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const status = el.shadowRoot?.querySelector('.preview-area .status.error');
    expect(status?.textContent?.trim()).toBe(strings.designer.previewError);
    // 편집 버튼으로 복귀 가능해야 한다
    expect(toolbarButton(el, strings.designer.edit)).toBeTruthy();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// UI 언어 (ADR-028)
// ---------------------------------------------------------------------------

describe('<slip-designer> UI 언어', () => {
  it('locale="en"이면 툴바가 영어로 표시된다', async () => {
    const el = await createElement();
    el.locale = 'en';
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(toolbarButton(el, 'Text')).toBeTruthy();
    expect(toolbarButton(el, 'Undo')).toBeTruthy();
    el.remove();
  });

  it('locale을 바꾸면 화면 문구가 그 언어로 갱신된다', async () => {
    const el = await loadDesigner(); // 기본 한국어
    expect(toolbarButton(el, strings.designer.addText)).toBeTruthy();

    el.locale = 'en';
    await el.updateComplete;
    expect(toolbarButton(el, 'Text')).toBeTruthy();
    el.remove();
  });
});
