// @vitest-environment happy-dom
// 캔버스 — 요소 렌더링, 선택, 포인터 조작
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용합니다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  PX_PER_MM,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  loadDesigner,
  flush,
  toolbarButton,
  addByCanvasClick,
  clickCanvasAt,
  pickShapeTool,
  selectElement,
} from './helpers.js';
import type { Designer } from './helpers.js';
import { canvasStyles } from '../../src/styles/designer/canvas.styles.js';

installDesignerTestEnv();

// ---------------------------------------------------------------------------
// 선 요소의 캔버스 표시
// ---------------------------------------------------------------------------

describe('<slip-designer> 선 요소 캔버스 표시 (lineDirection, ADR-032)', () => {
  function makeLineFile(
    direction?: 'horizontal' | 'vertical' | 'down' | 'up',
    borderWidth?: number,
  ): SlipFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'line' as const,
      id: 'line-1',
      name: 'test-line',
      position: { x: 10, y: 10 },
      width: 50,
      height: 20,
      ...(direction ? { lineDirection: direction } : {}),
      ...(borderWidth !== undefined ? { borderWidth } : {}),
    } as never];
    return file as unknown as SlipFile;
  }

  async function mountLine(
    direction?: 'horizontal' | 'vertical' | 'down' | 'up',
    borderWidth?: number,
  ) {
    parseSlipFileMock.mockReturnValue(makeLineFile(direction, borderWidth));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el.shadowRoot?.querySelector('.element svg line');
  }

  it('기본(미지정)·horizontal은 가로 직선으로 그린다', async () => {
    const line = await mountLine();
    expect(line?.getAttribute('y1')).toBe(line?.getAttribute('y2'));
    expect(line?.getAttribute('x1')).not.toBe(line?.getAttribute('x2'));
  });

  it('vertical은 세로 직선으로 그린다', async () => {
    const line = await mountLine('vertical');
    expect(line?.getAttribute('x1')).toBe(line?.getAttribute('x2'));
    expect(line?.getAttribute('y1')).not.toBe(line?.getAttribute('y2'));
  });

  it('down은 좌상→우하, up은 좌하→우상 대각선으로 그린다', async () => {
    const down = await mountLine('down');
    expect(Number(down?.getAttribute('x1'))).toBe(0);
    expect(Number(down?.getAttribute('y1'))).toBe(0);
    expect(Number(down?.getAttribute('x2'))).toBeGreaterThan(0);
    expect(Number(down?.getAttribute('y2'))).toBeGreaterThan(0);

    const up = await mountLine('up');
    expect(Number(up?.getAttribute('y1'))).toBeGreaterThan(0);
    expect(Number(up?.getAttribute('y2'))).toBe(0);
  });

  it('사선에도 선 굵기 입력을 표시한다 (방향을 바꿔도 굵기를 수정할 수 있게)', async () => {
    parseSlipFileMock.mockReturnValue(makeLineFile('down'));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    (el.shadowRoot!.querySelector('[data-id="line-1"]') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 1 }),
    );
    await el.updateComplete;
    const labels = Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    expect(labels).toContain(strings.designer.lineWidth);
    el.remove();
  });

  it('선 조각은 SVG 네임스페이스로 생성된다 (실브라우저에서 보이기 위한 조건)', async () => {
    const line = await mountLine('down');
    expect(line?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('선 굵기는 상자 높이가 아니라 borderWidth에서 온다 (G-32)', async () => {
    const thin = await mountLine('horizontal', 0.5);
    const thick = await mountLine('horizontal', 4);
    // 요소 영역은 유지하고 SVG 선 굵기만 8배로 적용합니다.
    const thinWidth = Number(thin?.getAttribute('stroke-width'));
    const thickWidth = Number(thick?.getAttribute('stroke-width'));
    expect(thinWidth).toBeGreaterThan(0);
    expect(thickWidth / thinWidth).toBeCloseTo(8, 5);
  });

  it('가로선 패널은 길이·선 굵기만 두고 높이 칸은 없앤다 (G-32)', async () => {
    parseSlipFileMock.mockReturnValue(makeLineFile('horizontal'));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    selectElement(el, 'line-1');
    await el.updateComplete;

    const labels = Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    expect(labels).toContain(strings.designer.length);
    expect(labels).toContain(strings.designer.lineAngle);
    expect(labels).toContain(strings.designer.lineWidth);
    // 가로선은 높이 대신 길이와 선 굵기를 편집합니다.
    expect(labels).not.toContain(strings.designer.height);
    expect(labels).toContain(strings.designer.lineColor);
    expect(labels).not.toContain(strings.designer.borderColor);
    expect(labels).not.toContain(strings.designer.borderWidth);
    el.remove();
  });

  it('길이·각도를 수정하면 상자와 방향으로 되돌아 저장된다 (ADR-050)', async () => {
    parseSlipFileMock.mockReturnValue(makeLineFile('horizontal'));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    selectElement(el, 'line-1');
    await el.updateComplete;

    const rowInput = (label: string) => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label)!
      .querySelector('input') as HTMLInputElement;
    const line = () => (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as unknown as
      { width: number; height: number; lineDirection?: string };

    // 45도 선은 너비와 높이가 같습니다.
    const angle = rowInput(strings.designer.lineAngle);
    angle.value = '45';
    angle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(line().lineDirection).toBe('down');
    expect(line().width).toBeCloseTo(line().height, 1);

    // 90도는 수직선 방향으로 저장합니다.
    const angle2 = rowInput(strings.designer.lineAngle);
    angle2.value = '90';
    angle2.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(line().lineDirection).toBe('vertical');
    expect(line().width).toBe(0);
    el.remove();
  });

  it('선은 방향과 무관하게 길이·각도·선 굵기만 둔다 (ADR-050)', async () => {
    parseSlipFileMock.mockReturnValue(makeLineFile('down'));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    selectElement(el, 'line-1');
    await el.updateComplete;

    const labels = Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    // 선 방향과 관계없이 길이, 각도, 굵기 입력 구성을 유지합니다.
    expect(labels).toContain(strings.designer.length);
    expect(labels).toContain(strings.designer.lineAngle);
    expect(labels).toContain(strings.designer.lineWidth);
    expect(labels).not.toContain(strings.designer.width);
    expect(labels).not.toContain(strings.designer.height);
    el.remove();
  });

  it('선 svg는 자르지 않는다 — 상자보다 굵은 선도 PDF처럼 그대로 보여야 한다 (G-32)', async () => {
    // happy-dom은 CSS를 계산하지 않으므로 규칙 자체가 살아 있는지로 확인합니다.
    // PDF(convert.ts appendLine)는 상자 밖까지 그리므로 캔버스도 자르면 안 됩니다.
    const { SlipDesigner } = await import('../../src/slip-designer.js');
    const css = [SlipDesigner.styles].flat(Infinity).map(String).join('\n');
    expect(css).toMatch(/\.element\.type-line svg\s*\{[^}]*overflow:\s*visible/);
  });
});

// ---------------------------------------------------------------------------
// 캔버스 스타일 반영
// ---------------------------------------------------------------------------

describe('<slip-designer> 캔버스 스타일 반영', () => {
  async function mountWith(elements: unknown[]): Promise<Designer> {
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

  it('계산되지 않는 수식이 있는 요소에 경고 배지를 표시한다', async () => {
    const el = await mountWith([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 / 0',
    }]);
    const badge = el.shadowRoot!.querySelector('[data-id="f1"] .formula-warning-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    // 요소를 고르고 옮기는 데 방해가 되지 않도록 배지는 포인터를 받지 않습니다.
    expect(canvasStyles.cssText.slice(canvasStyles.cssText.indexOf('.formula-warning-badge')))
      .toContain('pointer-events: none;');
    expect(badge.getAttribute('title')).toBe(strings.designer.formulaWarningItem);
    expect(badge.getAttribute('aria-label')).toBe(strings.designer.formulaWarningItem);
    el.remove();
  });

  it('그리드는 셀에만 배지를 두고 요소에는 중복 표시하지 않는다', async () => {
    const el = await mountWith([{
      type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 10 }],
      columns: [{ width: 40 }, { width: 40 }],
      cells: [
        { row: 0, column: 0, formula: '1 / 0' },
        { row: 0, column: 1, content: '값' },
      ],
    }]);
    const cells = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > .grid-cell'));
    expect(cells[0]!.querySelector('.formula-warning-badge')).not.toBeNull();
    expect(cells[1]!.querySelector('.formula-warning-badge')).toBeNull();
    // 배지는 셀 컨테이너의 마지막 자식으로 들어갑니다.
    expect(cells[0]!.lastElementChild?.className).toBe('formula-warning-badge');
    // 셀에 배지가 있으므로 그리드 상자에는 다시 두지 않습니다.
    const box = el.shadowRoot!.querySelector('[data-id="g1"]')!;
    expect(box.querySelectorAll('.formula-warning-badge')).toHaveLength(1);
    el.remove();
  });

  it('계산되는 수식으로 고치면 배지가 사라진다', async () => {
    const el = await mountWith([{
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '1 / 0',
    }]);
    expect(el.shadowRoot!.querySelector('.formula-warning-badge')).not.toBeNull();

    const file = (el as unknown as { _file: { template: { pages: { elements: Record<string, unknown>[] }[] } } })._file;
    file.template.pages[0]!.elements[0]!.formula = '1 + 1';
    el.requestUpdate();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.formula-warning-badge')).toBeNull();
    el.remove();
  });

  it('텍스트의 글자 크기·정렬이 캔버스에 반영된다 (pt → 4/3px)', async () => {
    const el = await mountWith([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목', fontSize: 15, alignment: 'center',
    }]);
    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    expect(parseFloat(content.style.fontSize)).toBeCloseTo(20, 5); // 15pt × 4/3
    expect(content.style.textAlign).toBe('center');
    el.remove();
  });

  it('그리드의 셀 문구·병합·셀 배경이 캔버스에 그려진다', async () => {
    const el = await mountWith([{
      type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 15 }, { height: 15 }],
      columns: [{ width: 45 }, { width: 22.5 }, { width: 22.5 }],
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

  it('필드 미리보기는 파라미터면 {키}, 수식이면 수식을 표시한다 (수식 필드에 {undefined} 금지, ADR-049)', async () => {
    const paramField = await mountWith([{
      type: 'field', id: 'f1', name: 'f', position: { x: 10, y: 10 },
      width: 40, height: 10, parameter: 'tradeDate',
    }]);
    expect((paramField.shadowRoot?.querySelector('.el-content') as HTMLElement).textContent).toBe('{tradeDate}');
    paramField.remove();

    const formulaField = await mountWith([{
      type: 'field', id: 'f2', name: 'f', position: { x: 10, y: 10 },
      width: 40, height: 10, formula: 'SUM(items.amount)',
    }]);
    const content = (formulaField.shadowRoot?.querySelector('.el-content') as HTMLElement).textContent;
    expect(content).toBe('SUM(items.amount)');
    expect(content).not.toContain('undefined');
    formulaField.remove();
  });

  it('세로쓰기 텍스트는 캔버스에서 글자를 한 자씩 쌓는다 (PDF stackVertically와 동일, ADR-012)', async () => {
    const el = await mountWith([{
      type: 'text', id: 'v1', name: 'v', position: { x: 10, y: 10 },
      width: 10, height: 40, content: '가나\n다', vertical: true,
    }]);
    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    // 원래 줄바꿈은 없애고 글자마다 줄바꿈을 넣어 한 열로 쌓습니다 (writing-mode 근사가 아님)
    expect(content.textContent).toBe('가\n나\n다');
    expect(content.style.writingMode).toBe('');
    el.remove();
  });

  it('자동 병합 열은 앞 벌과 값이 같으면 캔버스에서 세로로 합친다 (ADR-038·012)', async () => {
    const file = makeTemplateFile();
    file.template.sampleValues = { items: [{ g: 'A' }, { g: 'A' }, { g: 'B' }] } as never;
    file.template.pages[0]!.elements = [{
      type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 8 }],
      columns: [{ width: 40, autoMerge: true }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-item', fromRow: 0, toRow: 0, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 3 },
      },
      cells: [{ row: 0, column: 0, parameter: 'g' }],
    }] as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const boxes = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > div')) as HTMLElement[];
    const aCell = boxes.find((c) => c.textContent === 'A');
    const bCell = boxes.find((c) => c.textContent === 'B');
    // A·A는 하나로 합쳐 세로 2칸, B는 따로 1칸 — 값 칸은 둘뿐입니다
    expect(aCell?.style.gridArea.replaceAll(' ', '')).toContain('span2');
    expect(bCell).toBeTruthy();
    expect(boxes.filter((c) => c.textContent === 'A' || c.textContent === 'B').length).toBe(2);
    el.remove();
  });

  it('자동 병합은 빈 값(null)에서는 합치지 않는다 — placeholder가 아니라 실제 값 기준 (ADR-038·012)', async () => {
    const file = makeTemplateFile();
    file.template.sampleValues = { items: [{ g: null }, { g: null }, { g: 'B' }] } as never;
    file.template.pages[0]!.elements = [{
      type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 8 }],
      columns: [{ width: 40, autoMerge: true }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-item', fromRow: 0, toRow: 0, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 3 },
      },
      cells: [{ row: 0, column: 0, parameter: 'g' }],
    }] as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 빈 값 칸({g} placeholder)은 병합되지 않아 span 2가 없습니다 (PDF는 빈 값에서 끊습니다)
    const boxes = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > div')) as HTMLElement[];
    const merged = boxes.filter((c) => c.style.gridArea.replaceAll(' ', '').includes('span2'));
    expect(merged.length).toBe(0);
    el.remove();
  });

  it('그리드 헤더 칸의 배경색이 캔버스에 그려진다', async () => {
    const el = await mountWith([{
      type: 'grid', id: 'd1', name: 'd', position: { x: 10, y: 50 },
      rows: [{ height: 8 }, { height: 8 }],
      columns: [{ width: 54 }, { width: 36 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 3 },
      },
      cells: [
        { row: 0, column: 0, content: '품명', backgroundColor: '#ffee00' },
        { row: 1, column: 0, parameter: 'itemName' },
      ],
    }]);
    const headCell = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > div'))
      .find((d) => d.textContent?.trim() === '품명') as HTMLElement;
    expect(headCell.style.backgroundColor).toBeTruthy();
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

    // 도구 선택만으로는 요소를 생성하지 않습니다.
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('true');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(changes.length).toBe(0);

    // 캔버스 클릭 위치에 기본 크기의 요소를 만들고 도구 선택을 해제합니다.
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
    if (added.type !== 'text') throw new Error('text여야 한다');
    expect(added.position.x).toBeCloseTo(50, 0);
    expect(added.position.y).toBeCloseTo(40, 0);
    expect(added.width).toBe(60); // 텍스트 기본 크기
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('false');
    el.remove();
  });

  it('드래그하면 그린 사각형의 위치·크기로 생성되고 점선 미리보기가 표시된다', async () => {
    const el = await loadDesigner();
    await pickShapeTool(el, strings.designer.shapeRect);

    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10 * PX, clientY: 20 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 40 * PX, clientY: 35 * PX, pointerId: 1,
    }));
    await el.updateComplete;

    // 드래그 중에는 생성 영역의 미리보기를 표시합니다.
    expect(el.shadowRoot?.querySelector('.draw-ghost')).not.toBeNull();

    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.draw-ghost')).toBeNull();
    const added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements.at(-1)!;
    if (added.type !== 'rect') throw new Error('rect여야 한다');
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

    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 100, clientY: 100, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('8종 요소를 모두 추가할 수 있다', async () => {
    const el = await loadDesigner();
    for (const label of [
      strings.designer.addText,
      strings.designer.addGrid,
      strings.designer.addImage,
      strings.designer.addField,
    ]) {
      await addByCanvasClick(el, label);
    }
    for (const label of [
      strings.designer.shapeRect,
      strings.designer.shapeEllipse,
      strings.designer.shapeTriangle,
    ]) {
      await pickShapeTool(el, label);
      await clickCanvasAt(el);
    }
    // 선은 시작점과 끝점을 차례로 클릭해 만듭니다.
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 100, 100);
    await clickCanvasAt(el, 300, 100);

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(2 + 8);
    el.remove();
  });

  it('선 도구는 드래그 방향대로 사선(↘·↗) 선을 만든다', async () => {
    const el = await loadDesigner();
    const PX = 96 / 25.4;
    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;

    // 왼쪽 위에서 오른쪽 아래로 그린 선은 `down` 방향입니다.
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10 * PX, clientY: 10 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 50 * PX, clientY: 30 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;
    let added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements.at(-1)! as never as { type: string; lineDirection?: string };
    expect(added.type).toBe('line');
    expect(added.lineDirection).toBe('down');

    // 왼쪽 아래에서 오른쪽 위로 그린 선은 `up` 방향입니다.
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    paper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10 * PX, clientY: 90 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 50 * PX, clientY: 60 * PX, pointerId: 1,
    }));
    paper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;
    added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements.at(-1)! as never as { type: string; lineDirection?: string };
    expect(added.lineDirection).toBe('up');
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

    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    // 선택한 요소는 Delete 키로 삭제합니다.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await el.updateComplete;

    const elements = el.shadowRoot?.querySelectorAll('.element');
    expect(elements?.length).toBe(1);
    expect(changes.length).toBe(1);
    el.remove();
  });
});

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

    // txt-1 너비 60mm → -100mm 드래그해도 2mm에서 멈춥니다
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

describe('<slip-designer> 눈금자·격자 (F-20)', () => {
  /** 격자 간격 메뉴에서 항목을 선택합니다 (없음·1mm·5mm·10mm) */
  async function pickGrid(
    el: Designer,
    label: string,
  ): Promise<void> {
    toolbarButton(el, strings.designer.grid).click();
    await el.updateComplete;
    const option = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    option.click();
    await el.updateComplete;
  }

  it('용지 위·왼쪽에 mm 눈금자를 표시하고 10mm마다 숫자를 표시한다', async () => {
    const el = await loadDesigner();

    expect(el.shadowRoot!.querySelectorAll('.ruler').length).toBe(2);
    expect(el.shadowRoot!.querySelector('.ruler-corner')).not.toBeNull();

    const numbers = Array.from(el.shadowRoot!.querySelectorAll('.ruler-h text'))
      .map((t) => t.textContent);
    expect(numbers.slice(0, 3)).toEqual(['10', '20', '30']);
    el.remove();
  });

  it('격자 간격을 선택하면 선택한 간격으로 격자를 표시하고, 없음을 선택하면 끈다', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot!.querySelector('.grid-overlay')).toBeNull();

    await pickGrid(el, '5mm');
    const overlay = el.shadowRoot!.querySelector('.grid-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.backgroundSize).toBe('5mm 5mm');
    expect(toolbarButton(el, strings.designer.grid).getAttribute('aria-pressed')).toBe('true');

    await pickGrid(el, strings.designer.gridNone);
    expect(el.shadowRoot!.querySelector('.grid-overlay')).toBeNull();
    expect(toolbarButton(el, strings.designer.grid).getAttribute('aria-pressed')).toBe('false');
    el.remove();
  });

  it('격자를 켜야 색 견본이 나오고, 선택한 색으로 격자선이 그려진다', async () => {
    const el = await loadDesigner();

    // 격자가 꺼져 있으면 색을 선택할 일이 없으므로 견본을 두지 않습니다
    toolbarButton(el, strings.designer.grid).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.grid-colors button').length).toBe(0);

    const gap = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .find((b) => b.textContent?.trim() === '5mm') as HTMLButtonElement;
    gap.click();
    await el.updateComplete;

    // 기본값으로 회색이 선택되어 있습니다
    toolbarButton(el, strings.designer.grid).click();
    await el.updateComplete;
    const swatch = (name: string) => Array.from(el.shadowRoot!.querySelectorAll('.grid-colors button'))
      .find((b) => b.getAttribute('aria-label')
        === `${strings.designer.gridColor}: ${name}`) as HTMLButtonElement;
    expect(swatch(strings.designer.colorGray).getAttribute('aria-pressed')).toBe('true');

    // 파랑을 선택하면 격자선 색이 바뀌고 메뉴는 닫힙니다
    swatch(strings.designer.colorBlue).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.preset-menu')).toBeNull();
    const overlay = el.shadowRoot!.querySelector('.grid-overlay') as HTMLElement;
    expect(overlay.style.backgroundImage).toContain('26, 115, 232');
    el.remove();
  });

  it('격자를 켜면 요소를 끌 때 격자에 맞아떨어진다 (Alt로 해제)', async () => {
    const el = await loadDesigner();
    await pickGrid(el, '10mm');

    // txt-1(x=30, y=40)을 어중간한 위치로 끌면 10mm 격자로 맞춰집니다
    const div = el.shadowRoot!.querySelector('[data-id="txt-1"]') as HTMLElement;
    const drag = async (dxMm: number, dyMm: number, altKey = false) => {
      div.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1, altKey,
      }));
      div.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, composed: true,
        clientX: dxMm * PX_PER_MM, clientY: dyMm * PX_PER_MM, pointerId: 1, altKey,
      }));
      div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
      await el.updateComplete;
    };

    await drag(23.4, 16.7);
    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[0]! as never as { position: { x: number; y: number } };
    expect(text.position.x % 10).toBe(0);
    expect(text.position.y % 10).toBe(0);

    // Alt를 누르면 격자를 무시하고 자유롭게 놓입니다
    const before = { ...text.position };
    await drag(3.3, 2.2, true);
    expect(text.position.x).not.toBe(before.x);
    expect(text.position.x % 10).not.toBe(0);
    el.remove();
  });

  it('커서가 용지 위에 있으면 좌표(mm)를 보여주고, 벗어나면 감춘다', async () => {
    const el = await loadDesigner();
    const wrap = el.shadowRoot!.querySelector('.paper-wrap') as HTMLElement;

    wrap.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 20 * PX_PER_MM, clientY: 30 * PX_PER_MM, pointerId: 1,
    }));
    await el.updateComplete;
    const coords = el.shadowRoot!.querySelector('.coords');
    expect(coords?.textContent).toContain('mm');

    wrap.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.coords')).toBeNull();
    el.remove();
  });
});

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

  it('복사한 요소를 붙여넣으면 새 ID로 원본에서 5mm 이동한 위치에 추가되고 slip-change를 발행한다', async () => {
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
    // 붙여넣은 요소가 선택됩니다
    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id'))
      .toBe(pasted.id);
    el.remove();
  });

  it('연속으로 붙여넣으면 이전 위치에서 5mm씩 추가로 이동한다', async () => {
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
// 미리보기 편집 잠금
// ---------------------------------------------------------------------------

describe('<slip-designer> 미리보기 편집 잠금', () => {
  it('미리보기 중에는 Delete·되돌리기 단축키가 문서를 바꾸지 않는다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const before = el.shadowRoot!.querySelectorAll('.element').length;

    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await el.updateComplete;

    // 편집으로 되돌리면 요소 수가 그대로여야 합니다 (미리보기 중 편집이 무시됨)
    toolbarButton(el, strings.designer.edit).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.element').length).toBe(before);
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

    // 취소 후 hover 이동만으로는 움직이지 않아야 합니다
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 40 * PX_PER_MM, clientY: 0, pointerId: 1,
    }));
    await el.updateComplete;
    const after = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    expect(parseFloat(after.style.left)).toBeCloseTo(30 * PX_PER_MM, 0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 도형 선택 메뉴 · 선 전용 편집 · 글자 스타일 · 테두리 편집
// ---------------------------------------------------------------------------

describe('<slip-designer> 도형 선택 메뉴', () => {
  it('도형 버튼을 누르면 사각형·타원·삼각형·오각형·육각형 선택지가 열린다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shape).click();
    await el.updateComplete;

    const labels = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      strings.designer.shapeRect,
      strings.designer.shapeEllipse,
      strings.designer.shapeTriangle,
      strings.designer.shapePentagon,
      strings.designer.shapeHexagon,
    ]);
    el.remove();
  });

  it('오각형을 선택하고 캔버스를 클릭하면 변 5개 다각형이 생긴다', async () => {
    const el = await loadDesigner();
    await pickShapeTool(el, strings.designer.shapePentagon);
    expect(toolbarButton(el, strings.designer.shape).getAttribute('aria-pressed')).toBe('true');
    await clickCanvasAt(el);

    const added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { type: string; sides?: number };
    expect(added.type).toBe('polygon');
    expect(added.sides).toBe(5);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 그리드 크기 조절 — 그리드는 크기를 저장하지 않고 트랙 합으로 표현합니다
// ---------------------------------------------------------------------------

describe('<slip-designer> 그리드 크기 조절', () => {
  type Grid = { columns: { width: number }[]; rows: { height: number }[] };

  /** 30mm 열 둘, 10mm 행 셋 — 상자는 60×30mm */
  function makeGridFile(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const,
      id: 'g-1',
      name: 'size-grid',
      position: { x: 10, y: 10 },
      columns: [{ width: 30 }, { width: 30 }],
      rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
      cells: [],
    }] as never;
    return file;
  }

  function gridOf(el: Element): Grid {
    return (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as unknown as Grid;
  }

  async function mount(): Promise<Designer> {
    parseSlipFileMock.mockReturnValue(makeGridFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;
    return el;
  }

  function dragHandle(el: Element, handle: string, dxMm: number, dyMm: number): void {
    const target = el.shadowRoot!.querySelector(`.handle-${handle}`) as HTMLElement;
    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true,
      clientX: dxMm * PX_PER_MM, clientY: dyMm * PX_PER_MM, pointerId: 1,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
  }

  it('그리드는 너비·높이를 저장하지 않고 열 너비와 행 높이의 합으로 크기를 나타낸다', async () => {
    const el = await mount();
    const grid = gridOf(el) as unknown as Record<string, unknown>;
    expect('width' in grid).toBe(false);
    expect('height' in grid).toBe(false);

    const width = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === strings.designer.width)!;
    expect(width.value).toBe('60');
    el.remove();
  });

  it('남동 핸들로 늘리면 열과 행이 기존 비율대로 함께 커진다', async () => {
    const el = await mount();

    // 60×30 → 90×45
    dragHandle(el, 'se', 30, 15);
    await el.updateComplete;

    expect(gridOf(el).columns.map((c) => c.width)).toEqual([45, 45]);
    expect(gridOf(el).rows.map((r) => r.height)).toEqual([15, 15, 15]);
    el.remove();
  });

  it('열 너비가 서로 다르면 늘려도 비율이 유지된다', async () => {
    const el = await mount();
    (gridOf(el).columns as { width: number }[])[0]!.width = 20;
    (gridOf(el).columns as { width: number }[])[1]!.width = 40;

    // 합 60 → 120이면 각각 두 배
    dragHandle(el, 'se', 60, 0);
    await el.updateComplete;

    expect(gridOf(el).columns.map((c) => c.width)).toEqual([40, 80]);
    el.remove();
  });

  it('트랙 하나가 최소 크기(2mm) 밑으로 내려가지 않는다', async () => {
    const el = await mount();

    // 60 → 2mm로 줄여도 열마다 최소 2mm를 지킵니다
    dragHandle(el, 'se', -58, 0);
    await el.updateComplete;

    for (const column of gridOf(el).columns) expect(column.width).toBeGreaterThanOrEqual(2);
    el.remove();
  });
});
