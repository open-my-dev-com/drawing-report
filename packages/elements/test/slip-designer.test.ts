// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용한다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의한다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import { parseSlipFile, renderSlipToPdf, evaluateFormula, validateSlipFile } from '@omdc-slipkit/core';
import type { SlipFile, SlipKit, SlipTemplateFile } from '@omdc-slipkit/core';
import { getStrings } from '../src/strings.js';

// 기본 영어 문구를 기준으로 화면을 확인한다.
const strings = getStrings();

type LitHost = HTMLElement & { updateComplete: Promise<unknown> };

/** 리스트형 선택 상자를 열고 data-value가 일치하는 항목을 고른다 */
async function pickListValue(host: LitHost, trigger: HTMLElement, value: string): Promise<void> {
  trigger.click();
  await host.updateComplete;
  const option = host.shadowRoot!.querySelector(
    `.list-select-menu button[data-value="${value}"]`,
  ) as HTMLButtonElement | null;
  if (!option) throw new Error(`목록 항목을 찾지 못했습니다: ${value}`);
  option.click();
  await host.updateComplete;
}

/** 리스트형 선택 상자를 열어 항목 문구를 읽고 다시 닫는다 */
async function listOptionLabels(host: LitHost, trigger: HTMLElement): Promise<string[]> {
  trigger.click();
  await host.updateComplete;
  const labels = Array.from(host.shadowRoot!.querySelectorAll('.list-select-menu button'))
    .map((b) => b.textContent?.trim() ?? '');
  (host.shadowRoot!.querySelector('.menu-backdrop') as HTMLElement).click();
  await host.updateComplete;
  return labels;
}

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
            type: 'rect' as const,
            id: 'shp-1',
            name: 'test-shape',
            position: { x: 100, y: 80 },
            width: 50,
            height: 30,
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

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

beforeEach(() => {
  revokedUrls = [];
  uuidCounter = 0;

  // Node.js 25의 불완전한 전역 localStorage 대신 격리된 브라우저형 저장소를 사용한다.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  });

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
 * 생성 도구를 선택하고 캔버스를 클릭해 요소를 만든다.
 * happy-dom의 `getBoundingClientRect`는 0을 반환하므로 좌표는 `clientX / PX_PER_MM`로 계산한다.
 */
async function addByCanvasClick(
  el: import('../src/slip-designer.js').SlipDesigner,
  label: string,
  clientX = 200,
  clientY = 200,
): Promise<void> {
  toolbarButton(el, label).click();
  await el.updateComplete;
  await clickCanvasAt(el, clientX, clientY);
}

/** 캔버스의 지정한 좌표를 클릭한다. */
async function clickCanvasAt(
  el: import('../src/slip-designer.js').SlipDesigner,
  clientX = 200,
  clientY = 200,
): Promise<void> {
  const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
  paper.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, clientX, clientY, pointerId: 1,
  }));
  paper.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, composed: true, clientX, clientY, pointerId: 1,
  }));
  await el.updateComplete;
}

/** 도형 메뉴를 열고 요소 종류를 선택한다. */
async function pickShapeTool(
  el: import('../src/slip-designer.js').SlipDesigner,
  label: string,
): Promise<void> {
  toolbarButton(el, strings.designer.shape).click();
  await el.updateComplete;
  const item = Array.from(el.shadowRoot?.querySelectorAll('.preset-menu button') ?? [])
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  item.click();
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

  it('사선에도 선 굵기 칸이 나온다 (방향을 바꿔도 굵기를 고칠 수 있게)', async () => {
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
    // 요소 영역은 유지하고 SVG 선 굵기만 8배로 적용한다.
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
    // 가로선은 높이 대신 길이와 선 굵기를 편집한다.
    expect(labels).not.toContain(strings.designer.height);
    expect(labels).toContain(strings.designer.lineColor);
    expect(labels).not.toContain(strings.designer.borderColor);
    expect(labels).not.toContain(strings.designer.borderWidth);
    el.remove();
  });

  it('길이·각도를 고치면 상자와 방향으로 되돌아 저장된다 (ADR-050)', async () => {
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

    // 45도 선은 너비와 높이가 같다.
    const angle = rowInput(strings.designer.lineAngle);
    angle.value = '45';
    angle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(line().lineDirection).toBe('down');
    expect(line().width).toBeCloseTo(line().height, 1);

    // 90도는 수직선 방향으로 저장한다.
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
    // 선 방향과 관계없이 길이, 각도, 굵기 입력 구성을 유지한다.
    expect(labels).toContain(strings.designer.length);
    expect(labels).toContain(strings.designer.lineAngle);
    expect(labels).toContain(strings.designer.lineWidth);
    expect(labels).not.toContain(strings.designer.width);
    expect(labels).not.toContain(strings.designer.height);
    el.remove();
  });

  it('선 svg는 자르지 않는다 — 상자보다 굵은 선도 PDF처럼 그대로 보여야 한다 (G-32)', async () => {
    // happy-dom은 CSS를 계산하지 않으므로 규칙 자체가 살아 있는지로 확인한다.
    // PDF(convert.ts appendLine)는 상자 밖까지 그리므로 캔버스도 자르면 안 된다.
    const { SlipDesigner } = await import('../src/slip-designer.js');
    const css = [SlipDesigner.styles].flat(Infinity).map(String).join('\n');
    expect(css).toMatch(/\.element\.type-line svg\s*\{[^}]*overflow:\s*visible/);
  });
});

// ---------------------------------------------------------------------------
// 캔버스 스타일 반영
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

  it('필드 미리보기는 파라미터면 {키}, 수식이면 수식을 보인다 (수식 필드에 {undefined} 금지, ADR-049)', async () => {
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
    // 원래 줄바꿈은 없애고 글자마다 줄바꿈을 넣어 한 열로 쌓는다 (writing-mode 근사가 아님)
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
    // A·A는 하나로 합쳐 세로 2칸, B는 따로 1칸 — 값 칸은 둘뿐이다
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

    // 빈 값 칸({g} placeholder)은 병합되지 않아 span 2가 없다 (PDF는 빈 값에서 끊는다)
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

describe('<slip-designer> 조건부 서식 (ADR-062)', () => {
  async function mountFile(
    elements: unknown[],
    sampleValues?: Record<string, unknown>,
  ): Promise<import('../src/slip-designer.js').SlipDesigner> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = elements as never;
    if (sampleValues) file.template.sampleValues = sampleValues as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  it('텍스트 요소의 색을 샘플 값으로 미리 적용한다', async () => {
    const el = await mountFile(
      [{
        type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
        width: 60, height: 10, content: '취소됨',
        conditionalFormats: [
          { condition: 'status = "취소"', fontColor: '#FF0000', backgroundColor: '#FFEEEE' },
        ],
      }],
      { status: '취소' },
    );
    const box = el.shadowRoot?.querySelector('[data-id="t1"]') as HTMLElement;
    expect(box.style.color).toBe('#FF0000');
    expect(box.style.backgroundColor).toBe('#FFEEEE');
    el.remove();
  });

  it('반복 그리드 셀은 행별로 조건을 평가한다', async () => {
    const el = await mountFile(
      [{
        type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
        rows: [{ height: 8 }],
        columns: [{ width: 40 }],
        repeat: {
          parameter: 'items',
          bands: [
            { id: 'b-item', fromRow: 0, toRow: 0, placement: 'item' },
          ],
          pagination: { mode: 'fixed', itemsPerPage: 2 },
        },
        cells: [{
          row: 0, column: 0, parameter: 'amount',
          conditionalFormats: [{ condition: 'amount >= 2000', fontColor: '#FF0000' }],
        }],
      }],
      { items: [{ amount: 1000 }, { amount: 2000 }] },
    );
    const boxes = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > div')) as HTMLElement[];
    const low = boxes.find((c) => c.textContent === '1000')!;
    const high = boxes.find((c) => c.textContent === '2000')!;
    expect(low.style.color).toBe('');
    expect(high.style.color).toBe('#FF0000');
    el.remove();
  });

  it('계산되지 않는 조건식은 캔버스에서 건너뛴다', async () => {
    const el = await mountFile(
      [{
        type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
        width: 60, height: 10, content: '제목',
        conditionalFormats: [
          { condition: 'status <', fontColor: '#00FF00' },
          { condition: 'TRUE', fontColor: '#FF0000' },
        ],
      }],
      {},
    );
    // 문법 오류 규칙은 무시하고 계산되는 규칙만 적용한다.
    const box = el.shadowRoot?.querySelector('[data-id="t1"]') as HTMLElement;
    expect(box.style.color).toBe('#FF0000');
    el.remove();
  });

  async function selectElement(
    el: import('../src/slip-designer.js').SlipDesigner,
    id: string,
  ): Promise<void> {
    const target = el.shadowRoot?.querySelector(`[data-id="${id}"]`) as HTMLElement;
    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;
  }

  it('강조(굵게·밑줄)를 캔버스에 미리 적용한다 (ADR-063)', async () => {
    const el = await mountFile(
      [{
        type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
        width: 60, height: 10, content: '제목',
        conditionalFormats: [{ condition: 'TRUE', bold: true, underline: true }],
      }],
      {},
    );
    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    expect(content.style.fontWeight).toBe('700');
    expect(content.style.textDecoration).toContain('underline');
    el.remove();
  });

  it('강조는 적용→해제→유지 순서로 바뀌고, 마지막 강조는 지울 수 없다 (ADR-063)', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', bold: true }],
    }]);
    await selectElement(el, 't1');

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });
    const name = `${strings.designer.conditionalFormat} 1`;
    const boldBtn = () => el.shadowRoot!.querySelector(
      `button[aria-label^="${name}: ${strings.designer.bold}"]`,
    ) as HTMLButtonElement;
    const ruleOf = (file: SlipTemplateFile) =>
      (file.template.pages[0]!.elements[0] as { conditionalFormats?: { bold?: boolean }[] })
        .conditionalFormats![0]!;

    // 적용(true) → 해제(false)
    boldBtn().click();
    await el.updateComplete;
    expect(ruleOf(changed!).bold).toBe(false);

    // 해제 → 기본 유지는 규칙의 마지막 강조를 없애므로 막힌다.
    changed = null;
    boldBtn().click();
    await el.updateComplete;
    expect(changed).toBeNull();
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.conditionEffectRequired);
    el.remove();
  });

  it('기울임을 규칙에서 설정할 수 있다 (ADR-063)', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });
    const name = `${strings.designer.conditionalFormat} 1`;
    (el.shadowRoot!.querySelector(
      `button[aria-label^="${name}: ${strings.designer.italic}"]`,
    ) as HTMLButtonElement).click();
    await el.updateComplete;

    const rule = (changed!.template.pages[0]!.elements[0] as { conditionalFormats?: { italic?: boolean }[] })
      .conditionalFormats![0]!;
    expect(rule.italic).toBe(true);
    el.remove();
  });

  it('결과가 논리값이 아닌 조건식은 저장하지 않는다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });

    const name = `${strings.designer.conditionalFormat} 1`;
    const input = el.shadowRoot!.querySelector(
      `input[aria-label="${name}: ${strings.designer.condition}"]`,
    ) as HTMLInputElement;
    input.value = '1 + 1';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(changed).toBe(false);
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.conditionNotBoolean);
    el.remove();
  });

  it('규칙의 마지막 색은 지울 수 없다 — 색이 없는 규칙은 파일 검증에 걸린다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });

    const name = `${strings.designer.conditionalFormat} 1`;
    const colorBtn = el.shadowRoot!.querySelector(
      `button[aria-label="${name}: ${strings.designer.fontColor}"]`,
    ) as HTMLButtonElement;
    colorBtn.click();
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.color-pop .swatch.none') as HTMLButtonElement).click();
    await el.updateComplete;

    // 색은 지워지지 않고 안내가 표시된다.
    expect(changed).toBe(false);
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.conditionEffectRequired);
    el.remove();
  });

  it('문법이 깨진 조건식은 저장하지 않고 입력 오류를 표시한다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });

    const name = `${strings.designer.conditionalFormat} 1`;
    const input = el.shadowRoot!.querySelector(
      `input[aria-label="${name}: ${strings.designer.condition}"]`,
    ) as HTMLInputElement;
    input.value = 'amount <';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(changed).toBe(false);
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.syntaxError);
    el.remove();
  });

  it('속성 패널에서 규칙을 추가하면 파일에 저장된다', async () => {
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

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });

    const addBtn = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.textContent?.includes(strings.designer.addConditionRule)) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    addBtn.click();
    await el.updateComplete;

    expect(changed).not.toBeNull();
    const text = changed!.template.pages[0]!.elements.find((item) => item.id === 'txt-1')!;
    expect((text as { conditionalFormats?: unknown[] }).conditionalFormats).toEqual([
      { condition: 'TRUE', fontColor: '#FF0000' },
    ]);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 툴바, 정렬 토글, 색 선택기
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
    expect(byAriaLabel(el, `${strings.designer.backgroundColor} #d93025`).getAttribute('aria-pressed'))
      .toBe('true');

    byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.colorNone}`).click();
    await el.updateComplete;
    expect(text.backgroundColor ?? undefined).toBeUndefined();
    expect(byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.colorNone}`)
      .getAttribute('aria-pressed')).toBe('true');
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

    // 색상 팝오버에 팔레트, 채도·명도 영역, 색조 슬라이더를 함께 표시한다.
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

  it('현재 색을 자주 쓰는 색으로 저장하면 커스텀 견본이 생기고 localStorage에 유지된다', async () => {
    localStorage.removeItem('slipkit-designer-custom-colors');
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click();
    await el.updateComplete;

    const saveLabel = `${strings.designer.backgroundColor}: ${strings.designer.saveColor}`;
    expect(byAriaLabel(el, saveLabel).disabled).toBe(true);

    const hex = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('placeholder') === '#RRGGBB')!;
    hex.value = '#123456';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    byAriaLabel(el, saveLabel).click();
    await el.updateComplete;

    const custom = el.shadowRoot!.querySelector('.swatch.custom');
    expect(custom?.getAttribute('title')).toBe('#123456');
    expect(JSON.parse(localStorage.getItem('slipkit-designer-custom-colors')!)).toEqual(['#123456']);

    byAriaLabel(el, `${strings.designer.backgroundColor} #123456`).click();
    await el.updateComplete;
    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#123456');
    el.remove();
  });

  it('커스텀 색이 30개를 넘으면 가장 오래된 것부터 밀려난다', async () => {
    const thirty = Array.from({ length: 30 }, (_, i) =>
      `#${(i + 1).toString(16).padStart(2, '0')}0000`);
    localStorage.setItem('slipkit-designer-custom-colors', JSON.stringify(thirty));
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click();
    await el.updateComplete;

    const hex = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('placeholder') === '#RRGGBB')!;
    hex.value = '#00ff77';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.saveColor}`).click();
    await el.updateComplete;

    const stored = JSON.parse(localStorage.getItem('slipkit-designer-custom-colors')!) as string[];
    expect(stored.length).toBe(30);
    expect(stored).not.toContain(thirty[0]); // 가장 오래된 색이 밀려남
    expect(stored.at(-1)).toBe('#00ff77');
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

    // 도구 선택만으로는 요소를 생성하지 않는다.
    expect(toolbarButton(el, strings.designer.addText).getAttribute('aria-pressed')).toBe('true');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(changes.length).toBe(0);

    // 캔버스 클릭 위치에 기본 크기의 요소를 만들고 도구 선택을 해제한다.
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

  it('드래그하면 끌어낸 사각형의 위치·크기로 생성되고 점선 미리보기가 표시된다', async () => {
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

    // 드래그 중에는 생성 영역의 미리보기를 표시한다.
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
    // 선은 시작점과 끝점을 차례로 클릭해 만든다.
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

    // 왼쪽 위에서 오른쪽 아래로 그린 선은 `down` 방향이다.
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

    // 왼쪽 아래에서 오른쪽 위로 그린 선은 `up` 방향이다.
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

    // 선택한 요소는 Delete 키로 삭제한다.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
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

    await addByCanvasClick(el, strings.designer.addText);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);

    const undoBtn = Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === strings.designer.undo) as HTMLElement;
    undoBtn.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

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

  it('텍스트를 필드로 바꾸면 새 파라미터를 만들어 붙인다 — 빈 참조를 남기지 않는다', async () => {
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

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });

    const fieldBtn = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group.text button'))
      .find((b) => b.textContent?.trim() === strings.designer.typeField) as HTMLButtonElement;
    fieldBtn.click();
    await el.updateComplete;

    expect(changed).not.toBeNull();
    const converted = changed!.template.pages[0]!.elements.find((item) => item.id === 'txt-1')!;
    expect(converted.type).toBe('field');
    // 필드 생성 시 유효한 파라미터 키와 정의를 함께 추가한다.
    const key = (converted as { parameter?: string }).parameter;
    expect(key).toBeTruthy();
    expect(changed!.template.parameters?.some((p) => p.key === key)).toBe(true);
    el.remove();
  });

  it('필드 소스를 수식에서 파라미터로 바꾸면 새 파라미터를 만들어 붙인다', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements.push({
      type: 'field', id: 'fld-1', name: 'test-field',
      position: { x: 30, y: 60 }, width: 60, height: 10, formula: 'TODAY()',
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);

    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="fld-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });

    const sourceTrigger = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((row) => row.querySelector('label')?.textContent?.trim() === strings.designer.cellSource)
      ?.querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, sourceTrigger, 'parameter');

    expect(changed).not.toBeNull();
    const field = changed!.template.pages[0]!.elements.find((item) => item.id === 'fld-1')!;
    const record = field as { parameter?: string; formula?: string };
    // 파라미터를 선택하면 기존 수식을 제거한다.
    expect(record.formula).toBeUndefined();
    expect(record.parameter).toBeTruthy();
    expect(changed!.template.parameters?.some((p) => p.key === record.parameter)).toBe(true);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 왼쪽 사이드바의 페이지, 요소, 파라미터 목록
// ---------------------------------------------------------------------------

describe('<slip-designer> 사이드바', () => {
  function sideSection(el: Element, title: string): Element {
    const section = Array.from(el.shadowRoot!.querySelectorAll('.side-section'))
      .find((sec) => sec.querySelector('.side-title')?.textContent?.trim() === title);
    if (!section) throw new Error(`사이드바 섹션을 찾지 못했습니다: ${title}`);
    return section;
  }

  /** 접힌 파라미터의 하위 항목을 펼친다. */
  function twisty(el: Element, name: string): HTMLButtonElement | undefined {
    return Array.from(el.shadowRoot!.querySelectorAll('.side-twisty'))
      .find((b) => b.getAttribute('aria-label')?.startsWith(`${name} `)) as HTMLButtonElement;
  }

  it('페이지가 한 줄씩 나열되고, 누르면 그 페이지로 이동한다 (G-35)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const rows = sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row');
    expect(rows.length).toBe(2);
    expect(Array.from(rows).map((r) => r.textContent?.trim()))
      .toEqual([strings.designer.pageLabel.replace('{n}', '1'),
                strings.designer.pageLabel.replace('{n}', '2')]);
    // 페이지를 추가한 뒤 첫 페이지를 다시 선택한다.
    expect(rows[1]?.classList.contains('current')).toBe(true);
    (rows[0] as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('1 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.pageSettings);
    el.remove();
  });

  it('페이지 줄은 평소에 썸네일을 띄우지 않는다 — 목록이 길어지지 않게 (G-35)', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot!.querySelector('.page-thumb-pop')).toBeNull();
    el.remove();
  });

  it('페이지 줄에 포커스가 가면 그 페이지 썸네일이 뜬다 (G-35)', async () => {
    const el = await loadDesigner();
    const row = sideSection(el, strings.designer.sidebarPages)
      .querySelector('.page-row') as HTMLElement;
    row.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    await el.updateComplete;

    const pop = el.shadowRoot!.querySelector('.page-thumb-pop');
    expect(pop).not.toBeNull();
    expect(pop?.querySelectorAll('.thumb-el').length).toBe(2);

    row.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.page-thumb-pop')).toBeNull();
    el.remove();
  });

  it('페이지 이름을 정하면 썸네일·목록에 번호 대신 그 이름이 나온다 (G-46)', async () => {
    const el = await loadDesigner();
    (sideSection(el, strings.designer.sidebarPages).querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;

    const nameInput = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.pageName)!
      .querySelector('input') as HTMLInputElement;
    nameInput.value = '표지';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const row = sideSection(el, strings.designer.sidebarPages).querySelector('.page-row');
    expect(row?.textContent?.trim()).toBe('표지');
    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages[0]!.label).toBe('표지');
  });

  it('페이지 설정에 이름 입력을 설명하는 안내문을 표시하지 않는다', async () => {
    const el = await loadDesigner();
    (sideSection(el, strings.designer.sidebarPages).querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.prop-panel .cell-hint:not(.error)')).toBeNull();
    el.remove();
  });

  it('페이지 번호 표시를 켜면 위치를 고를 수 있고 캔버스에 X / X 자리표시가 나온다 (G-46)', async () => {
    const el = await loadDesigner();
    (sideSection(el, strings.designer.sidebarPages).querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;

    const toggle = Array.from(el.shadowRoot!.querySelectorAll('input[type="checkbox"]'))
      .find((c) => c.getAttribute('aria-label') === strings.designer.pageNumberShow) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages[0]!.pageNumber?.position).toBe('bottom-center');
    // 캔버스에는 실제 번호 대신 페이지 번호 자리표시를 표시한다.
    const mark = el.shadowRoot!.querySelector('.page-number-mark');
    expect(mark?.textContent?.trim()).toBe('X / X');

    const posTrigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((sel) => sel.getAttribute('aria-label') === strings.designer.pageNumberPosition) as HTMLButtonElement;
    await pickListValue(el, posTrigger, 'top-right');
    expect(file.template.pages[0]!.pageNumber?.position).toBe('top-right');
  });

  it('페이지 물리명이 다른 페이지와 겹치면 되돌리고 안내한다 (G-46)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;
    const setKey = async (value: string) => {
      const keyInput = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
        .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.pageKey)!
        .querySelector('input') as HTMLInputElement;
      keyInput.value = value;
      keyInput.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
    };
    // 두 번째 페이지에 `cover` 키를 지정한다.
    (Array.from(sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row'))[1] as HTMLElement).click();
    await el.updateComplete;
    await setKey('cover');
    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages[1]!.key).toBe('cover');

    // 다른 페이지에는 같은 키를 적용할 수 없다.
    (Array.from(sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row'))[0] as HTMLElement).click();
    await el.updateComplete;
    await setKey('cover');
    expect(file.template.pages[0]!.key).toBeUndefined();
    const invalidKey = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.pageKey)!
      .querySelector('input') as HTMLInputElement;
    expect(invalidKey.getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.keyInUse);
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

  /** 값 하나(합계금액)와 반복 구간을 가진 그리드 하나(items · 하위 필드 a)를 둔 양식 */
  function makeFileWithRepeatGrid(): ReturnType<typeof makeTemplateFile> {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'field' as const, id: 'fld-1', name: 'f1', position: { x: 10, y: 10 },
          width: 60, height: 10, parameter: '합계금액',
        } as never,
        {
          type: 'grid' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          rows: [{ height: 8 }, { height: 8 }],
          columns: [{ width: 180 }],
          repeat: {
            parameter: 'items',
            bands: [
              { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
              { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
            ],
            pagination: { mode: 'fixed', itemsPerPage: 2 },
          },
          cells: [{ row: 1, column: 0, parameter: 'a' }],
        } as never,
      ],
    });
    return file;
  }

  it('하위가 있는 줄에만 펼침 표시가 붙고, 기본은 접혀 있다 (G-25)', async () => {
    parseSlipFileMock.mockReturnValue(makeFileWithRepeatGrid() as unknown as SlipFile);
    const el = await loadDesigner();

    // 하위 항목은 처음에 접힌 상태로 표시된다.
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(0);
    expect(twisty(el, 'items')).toBeDefined();
    expect(twisty(el, '합계금액')).toBeUndefined();
    el.remove();
  });

  it('펼침 표시를 누르면 하위 줄이 열리고, 다시 누르면 닫힌다 (G-25)', async () => {
    parseSlipFileMock.mockReturnValue(makeFileWithRepeatGrid() as unknown as SlipFile);
    const el = await loadDesigner();

    const open = twisty(el, 'items')!;
    expect(open.getAttribute('aria-expanded')).toBe('false');
    open.click();
    await el.updateComplete;
    expect(Array.from(el.shadowRoot!.querySelectorAll('.side-col-row'))
      .map((r) => r.textContent?.trim())).toEqual(['a']);
    expect(twisty(el, 'items')!.getAttribute('aria-expanded')).toBe('true');

    twisty(el, 'items')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(0);
    el.remove();
  });

  it('그 값이나 그 그리드를 고르면 하위 줄이 저절로 열린다 (G-25)', async () => {
    parseSlipFileMock.mockReturnValue(makeFileWithRepeatGrid() as unknown as SlipFile);
    const el = await loadDesigner();

    const parameterRow = Array.from(sideSection(el, strings.designer.sidebarParameters)
      .querySelectorAll('.side-row')).find((r) => r.textContent?.trim() === 'items') as HTMLElement;
    parameterRow.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(1);

    // 자동으로 펼쳐진 항목도 다시 접을 수 있다.
    twisty(el, 'items')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(0);

    // 그리드를 선택하면 해당 그리드가 사용하는 파라미터를 펼친다.
    (Array.from(sideSection(el, strings.designer.sidebarPages)
      .querySelectorAll('.side-row'))[1] as HTMLElement).click();
    await el.updateComplete;
    const gridRow = Array.from(sideSection(el, strings.designer.sidebarElements)
      .querySelectorAll('.side-row')).find((r) => r.textContent?.trim() === 't1') as HTMLElement;
    gridRow.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(1);
    el.remove();
  });

  it('파라미터 목록은 양식 전체의 field·그리드 파라미터를 모으고, 반복 구간 필드는 하위 줄로 보여준다', async () => {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'field' as const, id: 'fld-1', name: 'f1', position: { x: 10, y: 10 },
          width: 60, height: 10, parameter: '합계금액',
        } as never,
        {
          type: 'grid' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          rows: [{ height: 8 }, { height: 8 }],
          columns: [{ width: 180 }],
          repeat: {
            parameter: 'items',
            bands: [
              { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
              { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
            ],
            pagination: { mode: 'fixed', itemsPerPage: 2 },
          },
          cells: [{ row: 1, column: 0, parameter: 'a' }],
        } as never,
      ],
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const section = sideSection(el, strings.designer.sidebarParameters);
    const rows = section.querySelectorAll('.side-row');
    // 반복 파라미터는 목록 파라미터로 등록한다.
    expect(Array.from(rows).map((r) => r.textContent?.trim())).toEqual(['items', '합계금액']);
    // 반복 구간의 셀 파라미터는 목록 하위 필드로 표시한다.
    twisty(el, 'items')!.click();
    await el.updateComplete;
    expect(Array.from(sideSection(el, strings.designer.sidebarParameters)
      .querySelectorAll('.side-col-row')).map((r) => r.textContent?.trim()))
      .toEqual(['a']);

    // 파라미터 패널의 사용 위치에서 해당 요소로 이동할 수 있다.
    (rows[1] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.sidebarParameters);

    (el.shadowRoot?.querySelector('.usage-row') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('2 / 2');
    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id')).toBe('fld-1');
    el.remove();
  });

  it('샘플 값이 없어도 선언된 종류로 수식의 타입 어긋남이 드러난다 (ADR-044/047)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'memo', valueType: 'text' }];
    file.template.pages[0]!.elements = [{
      type: 'field' as const, id: 'f-1', name: 'f', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '',
    } as never];
    delete (file.template as { sampleValues?: unknown }).sampleValues;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'f-1');
    await el.updateComplete;

    // 수식 모달을 열고 글자 파라미터를 숫자 자리에 넣는다
    (el as unknown as { _formulaModalOpen: boolean })._formulaModalOpen = true;
    (el as unknown as { _formulaDraft: string })._formulaDraft = 'SUM(memo)';
    (el as unknown as { requestUpdate: () => void }).requestUpdate();
    await el.updateComplete;

    // 샘플 값이 없으면 선언된 값 종류의 시험값으로 평가한다.
    const status = el.shadowRoot!.querySelector('.formula-status');
    expect(status?.textContent?.trim()).not.toBe('');
    el.remove();
  });

  it('반복 구간이 쓰는 파라미터는 열 때 목록으로 선언되고 하위 필드가 채워진다 (ADR-047)', async () => {
    const file = makeTemplateFile();
    // 값 종류가 선언되지 않은 기존 파일을 사용한다.
    file.template.parameters = [{ key: 'items', label: '품목' }];
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'g-1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 10 }, { height: 10 }],
      columns: [{ width: 60 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 1 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 1, column: 0, parameter: 'itemName' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    const items = defs.find((b) => b.key === 'items')!;
    // 반복 구간이 있다는 것은 그 값이 목록이라는 뜻이다
    expect(items.valueType).toBe('list');
    // 구간 칸이 읽는 이름이 하위 필드로 선언되고, 이름은 헤더의 직접 입력한 글을 쓴다
    expect(items.fields?.map((f) => [f.key, f.label])).toEqual([['itemName', '품명']]);
    el.remove();
  });

  it('목록이 아닌 종류로 선언된 파라미터는 열 때 건드리지 않는다', async () => {
    const file = makeTemplateFile();
    // 반복 구간에서 참조하지만 값 종류는 text로 선언되어 있다.
    file.template.parameters = [{ key: 'items', label: '품목', valueType: 'text' }];
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'g-1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 10 }, { height: 10 }],
      columns: [{ width: 60 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 1 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 1, column: 0, parameter: 'itemName' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    const items = defs.find((b) => b.key === 'items')!;
    // 명시된 값 종류를 유지한다.
    expect(items.valueType).toBe('text');
    // 하위 필드는 목록 파라미터에만 추가한다.
    expect(items.fields).toBeUndefined();
    el.remove();
  });

  it('샘플 JSON은 저장된 행에 없는 하위 필드도 키로 보여준다 (입력폼 탭과 어긋나지 않게)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{
      key: 'items', valueType: 'list',
      fields: [{ key: 'name' }, { key: 'amount', valueType: 'number' }],
    }];
    // 저장된 행에는 name만 있다
    file.template.sampleValues = { items: [{ name: '사과' }] };
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const skeleton = (el as unknown as { _sampleSkeleton: () => Record<string, unknown> })
      ._sampleSkeleton();
    expect(skeleton['items']).toEqual([{ name: '사과', amount: 0 }]);
    el.remove();
  });

  it('파라미터에 값 종류를 지정할 수 있고, 목록이면 하위 필드를 그리드 없이 만들 수 있다 (ADR-047)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'rows', label: '품목' }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 파라미터를 고르면 값 종류를 지정할 수 있다
    const row = Array.from(sideSection(el, strings.designer.sidebarParameters).querySelectorAll('.side-row'))
      .find((r) => r.textContent?.includes('품목')) as HTMLElement;
    row.click();
    await el.updateComplete;

    const typeRow = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.parameterValueType);
    await pickListValue(el, typeRow!.querySelector('.list-select') as HTMLButtonElement, 'list');

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    expect(defs[0]!.valueType).toBe('list');

    // 그리드 없이도 목록 파라미터에 하위 필드를 추가할 수 있다.
    (el.shadowRoot!.querySelector('.prop-add-row') as HTMLElement).click();
    await el.updateComplete;
    const after = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    expect(after[0]!.fields?.map((f) => f.key)).toEqual(['field1']);
    // 만든 필드가 곧바로 편집 대상이 된다
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.parameterField);
    el.remove();
  });

  it('목록이 아닌 종류로 바꾸면 하위 필드가 함께 정리된다 (스키마가 거부하는 조합을 남기지 않는다)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'rows', valueType: 'list', fields: [{ key: 'amount' }] }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const row = Array.from(sideSection(el, strings.designer.sidebarParameters).querySelectorAll('.side-row'))
      .find((r) => r.textContent?.includes('rows')) as HTMLElement;
    row.click();
    await el.updateComplete;

    const typeRow = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.parameterValueType);
    await pickListValue(el, typeRow!.querySelector('.list-select') as HTMLButtonElement, 'number');

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    expect(defs[0]!.valueType).toBe('number');
    expect(defs[0]!.fields).toBeUndefined();
    el.remove();
  });

  it('목록 파라미터의 하위 필드를 고르면 요소가 아니라 그 필드가 편집된다 (ADR-047)', async () => {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'grid' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          rows: [{ height: 8 }, { height: 8 }],
          columns: [{ width: 108 }, { width: 72 }],
          repeat: {
            parameter: 'items',
            bands: [
              { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
              { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
            ],
            pagination: { mode: 'fixed', itemsPerPage: 2 },
          },
          cells: [
            { row: 0, column: 0, content: '품명' },
            { row: 1, column: 0, parameter: 'name' },
            { row: 1, column: 1, parameter: 'amount' },
          ],
        } as never,
      ],
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 하위 줄 이름은 반복 구간 위쪽 같은 열의 직접 입력한 글, 없으면 물리명이다 (펼쳐야 보인다)
    twisty(el, 'items')!.click();
    await el.updateComplete;
    const cols = sideSection(el, strings.designer.sidebarParameters).querySelectorAll('.side-col-row');
    expect(Array.from(cols).map((c) => c.textContent?.trim())).toEqual(['품명', 'amount']);

    (cols[1] as HTMLElement).click();
    await el.updateComplete;

    // 그 필드를 읽는 칸이 있는 페이지로 옮겨 어디에 쓰이는지 보인다
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('2 / 2');
    // 파라미터의 하위 필드를 선택한 상태이므로 요소는 선택하지 않는다.
    expect(el.shadowRoot?.querySelector('.element.selected')).toBeNull();

    // 오른쪽 패널이 그 하위 필드 편집으로 바뀐다
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.parameterField);
    const keyRow = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.parameterKey);
    expect((keyRow?.querySelector('input') as HTMLInputElement).value).toBe('amount');

    // 「쓰는 곳」에는 해당 필드를 참조하는 칸이 표시된다.
    const usage = Array.from(el.shadowRoot!.querySelectorAll('.usage-row'))
      .map((u) => u.textContent?.replace(/\s+/g, ' ').trim());
    expect(usage.some((u) => u?.includes(`${strings.designer.cell} (2, 2)`))).toBe(true);
    el.remove();
  });

  it('페이지 설정 패널에서 순서를 옮기면 그 페이지 요소가 그대로 따라간다 (G-46)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;
    // 2페이지에 요소를 하나 만들어 순서가 바뀌는지 확인한다
    await addByCanvasClick(el, strings.designer.addText);

    // 페이지 순서는 페이지 설정 패널에서 변경한다.
    const pageRows = sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row');
    (pageRows[1] as HTMLElement).click();
    await el.updateComplete;
    const moveForward = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.pageMoveForward) as HTMLButtonElement;
    moveForward.click();
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages.map((pg) => pg.elements.length)).toEqual([1, 2]);
    // 보고 있던 페이지를 그대로 따라간다
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('1 / 2');
    // 첫 페이지에서는 더 앞으로 옮길 수 없다
    const moveForwardAgain = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.pageMoveForward) as HTMLButtonElement;
    expect(moveForwardAgain.disabled).toBe(true);
    el.remove();
  });

  it('요소 목록은 페이지별로 묶이고, 줄의 삭제 버튼으로 그 요소를 지운다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const section = sideSection(el, strings.designer.sidebarElements);
    // 페이지가 여럿이면 페이지 머리가 붙고, 현재(2)페이지만 펼쳐진다
    expect(section.querySelectorAll('.side-page-head').length).toBe(2);
    expect(section.querySelectorAll('.side-row').length).toBe(0);

    (section.querySelectorAll('.side-page-head')[0] as HTMLElement).click();
    await el.updateComplete;

    expect(sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row').length)
      .toBe(2);

    const remove = Array.from(
      sideSection(el, strings.designer.sidebarElements).querySelectorAll('button'),
    ).find((b) => b.getAttribute('aria-label') === `test-text ${strings.designer.delete}`)!;
    remove.click();
    await el.updateComplete;

    expect(sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row').length)
      .toBe(1);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(1);
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
// 표 내부 편집: 그리드 행·열·칸·병합
// ---------------------------------------------------------------------------

describe('<slip-designer> 표 내부 편집', () => {
  const PX = 96 / 25.4;

  function makeGridFile(): SlipFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const,
      id: 'grid-1',
      name: 'grid',
      position: { x: 10, y: 10 },
      width: 90,
      height: 30,
      rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
      columns: [{ width: 36 }, { width: 27 }, { width: 27 }],
      cells: [{ row: 0, column: 0, content: '라벨' }],
    } as never];
    return file as unknown as SlipFile;
  }

  async function mountGrid() {
    parseSlipFileMock.mockReturnValue(makeGridFile());
    const el = await loadDesigner();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    return el;
  }

  function gridOf(el: Element) {
    return (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as never as {
      width: number; height: number;
      rows: { height: number }[]; columns: { width: number }[];
      cells: { row: number; column: number; content?: string; rowSpan?: number; colSpan?: number }[];
    };
  }

  /** 행·열 수 조절 버튼 (-, +) */
  function stepButton(el: Element, label: string, sign: '-' | '+'): HTMLButtonElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 줄을 찾지 못했습니다: ${label}`);
    return row.querySelectorAll('button')[sign === '-' ? 0 : 1] as HTMLButtonElement;
  }

  function panelField(el: Element, label: string): HTMLInputElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 입력을 찾지 못했습니다: ${label}`);
    return row.querySelector('input') as HTMLInputElement;
  }

  function setField(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** 선택된 그리드를 (mm 좌표로) 한 번 더 클릭한다 — 셀 선택·인라인 편집 진입 */
  async function clickCell(el: Element, mmX: number, mmY: number) {
    const div = el.shadowRoot!.querySelector('[data-id="grid-1"]') as HTMLElement;
    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: mmX * PX, clientY: mmY * PX, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, composed: true, clientX: mmX * PX, clientY: mmY * PX, pointerId: 1,
    }));
    await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  }

  it('열을 더하면 다른 열 너비는 그대로고 상자만 넓어진다 (mm 트랙, ADR-037)', async () => {
    const el = await mountGrid();
    stepButton(el, strings.designer.columns, '+').click();
    await el.updateComplete;

    const grid = gridOf(el);
    expect(grid.columns.length).toBe(4);
    // 새 열은 마지막 열 너비를 복사하고 기존 열은 그대로다.
    expect(grid.columns.map((c) => c.width)).toEqual([36, 27, 27, 27]);
    el.remove();
  });

  it('행·열을 줄이면 범위 밖 셀이 제거된다', async () => {
    const el = await mountGrid();
    // (2,2)에 셀 추가해 두고 2행 2열로 줄인다
    gridOf(el).cells.push({ row: 2, column: 2, content: '밖' });
    stepButton(el, strings.designer.rows, '-').click();
    await el.updateComplete;
    stepButton(el, strings.designer.columns, '-').click();
    await el.updateComplete;

    const after = gridOf(el);
    expect(after.rows.length).toBe(2);
    expect(after.columns.length).toBe(2);
    expect(after.cells.some((c) => c.row >= 2 || c.column >= 2)).toBe(false);
    // 남은 셀은 유지
    expect(after.cells.some((c) => c.content === '라벨')).toBe(true);
    el.remove();
  });

  it('선택된 그리드를 다시 클릭하면 셀이 선택되고 인라인 입력으로 내용이 저장된다', async () => {
    const el = await mountGrid();
    // 그리드 원점(10,10) + 첫 칸 안쪽 (5,5)
    await clickCell(el, 15, 15);

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe('라벨');

    editor.value = '상호';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.content).toBe('상호');
    expect(el.shadowRoot!.querySelector('.cell-editor')).toBeNull();
    el.remove();
  });

  it('빈 칸을 클릭해 입력하면 새 셀이 만들어진다', async () => {
    const el = await mountGrid();
    // 두 번째 열(40%~70% → 36mm~63mm 폭 기준), (1,1) 칸 근처: x=10+50, y=10+15
    await clickCell(el, 60, 25);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.value = '새 값';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.some((c) => c.content === '새 값')).toBe(true);
    el.remove();
  });

  it('셀 내용을 바꾸지 않고 편집을 끝내면 오류를 표시하지 않는다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15);

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor.value).toBe('라벨');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.content).toBe('라벨');
    expect(el.shadowRoot!.querySelector('.input-error')).toBeNull();
    el.remove();
  });

  it('빈 셀을 비운 채 편집을 끝내면 셀을 만들거나 오류를 표시하지 않는다', async () => {
    const el = await mountGrid();
    await clickCell(el, 60, 25);

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor.value).toBe('');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).cells.some((c) => c.row === 1 && c.column === 1)).toBe(false);
    expect(el.shadowRoot!.querySelector('.input-error')).toBeNull();
    el.remove();
  });

  it('선택 셀의 병합 값을 늘리면 저장되고, 다른 셀과 겹치는 값은 무시된다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15); // (0,0) 선택
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    const colSpanInput = () => Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.merge} ${strings.designer.columns}`) as HTMLInputElement;
    setField(colSpanInput(), '2');
    await el.updateComplete;
    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.colSpan).toBe(2);

    // 다른 셀과 겹치는 병합 값은 적용하지 않는다.
    gridOf(el).cells.push({ row: 0, column: 2, content: '충돌' });
    setField(colSpanInput(), '3');
    await el.updateComplete;
    expect(gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)?.colSpan).toBe(2);
    expect(colSpanInput().getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.mergeOverlap);
    el.remove();
  });

  it('선택 셀에 배경색·글자 크기·정렬을 지정하면 셀 스타일로 저장된다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15); // (0,0) 선택
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    // 셀 배경색 — 셀 전용 색 버튼을 펼쳐 견본 클릭
    const byAria = (label: string) => Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;
    // 셀 전용 색 버튼 (요소 스타일 섹션과 이름으로 구분된다)
    const cellBg = `${strings.designer.cell} ${strings.designer.backgroundColor}`;
    byAria(cellBg).click();
    await el.updateComplete;
    byAria(`${cellBg} #d93025`).click();
    await el.updateComplete;

    // 글자 크기·정렬
    setField(panelField(el, strings.designer.fontSize), '14');
    await el.updateComplete;
    byAria(`${strings.designer.cell} ${strings.designer.alignment}: ${strings.designer.alignCenter}`).click();
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)! as never as Record<string, unknown>;
    expect(cell.backgroundColor).toBe('#d93025');
    expect(cell.fontSize).toBe(14);
    expect(cell.alignment).toBe('center');
    el.remove();
  });

  it('셀 편집 패널은 값·구조·텍스트·배경·테두리를 나누고 그리드 공통 스타일을 섞지 않는다', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15);
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    const titles = Array.from(el.shadowRoot!.querySelectorAll('.prop-section-title'))
      .map((title) => title.textContent?.trim() ?? '');
    expect(el.shadowRoot!.querySelector('.type-name')?.textContent?.trim())
      .toContain(`${strings.designer.cell} (1, 1)`);
    expect(el.shadowRoot!.querySelector('.grid-back-label')?.textContent?.trim())
      .toBe(strings.designer.gridBack);
    expect(titles).toContain(strings.designer.panelValue);
    expect(titles).toContain(strings.designer.panelStructure);
    expect(titles).toContain(strings.designer.styleText);
    expect(titles).toContain(strings.designer.styleBackground);
    expect(titles).toContain(strings.designer.styleBorder);

    const colorLabels = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .map((button) => button.getAttribute('aria-label'));
    expect(colorLabels).toContain(`${strings.designer.cell} ${strings.designer.fontColor}`);
    expect(colorLabels).not.toContain(strings.designer.fontColor);
    expect(colorLabels).not.toContain(strings.designer.backgroundColor);
    expect(colorLabels).not.toContain(strings.designer.borderColor);
    el.remove();
  });

  it('선택 셀의 테두리를 없음으로 하면 굵기 0이 저장된다 (합계 박스, ADR-033)', async () => {
    const el = await mountGrid();
    await clickCell(el, 15, 15); // (0,0) 선택
    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    // 셀 섹션의 테두리 굵기 버튼(첫 번째)을 펼쳐 없음 선택
    const widthButtons = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'));
    (widthButtons[0] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.menu-backdrop')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.width-pop')?.classList.contains('preset-menu')).toBe(true);
    const noneOption = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
      .find((b) => b.getAttribute('aria-label') ===
        `${strings.designer.borderWidth}: ${strings.designer.colorNone}`) as HTMLButtonElement;
    noneOption.click();
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)! as never as Record<string, unknown>;
    expect(cell.borderWidth).toBe(0);

    // 굵기 단계를 고르면 그 값이 저장된다
    (el.shadowRoot!.querySelector('.width-btn') as HTMLElement).click();
    await el.updateComplete;
    const step = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
      .find((b) => b.getAttribute('aria-label') === `${strings.designer.borderWidth}: 0.5mm`) as HTMLButtonElement;
    step.click();
    await el.updateComplete;
    expect(cell.borderWidth).toBe(0.5);

    // 셀 테두리 형태를 점선으로 (굵기와 같은 미리보기 버튼 + 펼침 메뉴)
    await pickBorderShape(
      el,
      `${strings.designer.cell} ${strings.designer.borderShape}`,
      strings.designer.borderDotted,
    );
    expect(cell.borderStyle).toBe('dotted');
    el.remove();
  });

});

// ---------------------------------------------------------------------------
// 좌표 기준점: X·Y 표시·입력의 기준 9점, 파일에는 좌상단 좌표를 저장한다.
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

  it('기준점은 요소마다 따로 기억한다 — 한 요소에서 바꿔도 다른 요소는 그대로 (G-32)', async () => {
    const el = await loadDesigner();

    // txt-1(60×10)만 중앙 기준으로 바꾼다
    selectElement(el, 'txt-1');
    await el.updateComplete;
    anchorDot(el, strings.designer.anchorC).click();
    await el.updateComplete;
    expect(xyInputs(el)[0].value).toBe('60'); // 30 + 60/2

    // shp-1(50×30, position 100,80)은 손대지 않았으니 좌상 기준 그대로여야 한다
    selectElement(el, 'shp-1');
    await el.updateComplete;
    expect(anchorDot(el, strings.designer.anchorTL).getAttribute('aria-pressed')).toBe('true');
    expect(xyInputs(el).map((i) => i.value)).toEqual(['100', '80']);

    // txt-1로 돌아오면 아까 고른 중앙 기준이 그대로 남아 있다
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(anchorDot(el, strings.designer.anchorC).getAttribute('aria-pressed')).toBe('true');
    expect(xyInputs(el)[0].value).toBe('60');
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
// 양식 설정 패널: 제목·용지 크기·방향·여백
// ---------------------------------------------------------------------------

describe('<slip-designer> 양식 설정 패널', () => {
  /** 라벨 문구로 속성 패널의 입력(input 또는 리스트형 선택 상자)을 찾는다 */
  function panelField(el: Element, label: string): HTMLInputElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 입력을 찾지 못했습니다: ${label}`);
    return row.querySelector('input, .list-select') as HTMLInputElement;
  }

  function currentFile(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  function setField(field: HTMLInputElement, value: string): void {
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

    await pickListValue(el, panelField(el, strings.designer.paperSize), '1'); // A5 148×210
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
    expect(panelField(el, strings.designer.marginLeft).getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.marginAreaError);
    el.remove();
  });

  it('너비를 여백 합 이하로 줄이는 값은 무시한다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.width), '20'); // 좌우 여백 합 30 이하
    await el.updateComplete;
    expect(currentFile(el).template.paper.width).toBe(210);
    expect(panelField(el, strings.designer.width).getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.paperAreaError);
    el.remove();
  });

  it('편집 대상을 바꾸면 이전 패널의 입력 오류를 남기지 않는다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.width), '20');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.field-error')).not.toBeNull();

    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.field-error')).toBeNull();
    el.remove();
  });

  it('용지 변경은 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();

    await pickListValue(el, panelField(el, strings.designer.paperSize), '1'); // A5
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

/**
 * 선 모양 미리보기 메뉴에서 테두리 형태를 선택한다.
 * ariaLabel은 버튼·메뉴를 구분하는 이름(요소용·셀용), shapeLabel은 실선·파선·점선 이름.
 */
async function pickBorderShape(
  el: import('../src/slip-designer.js').SlipDesigner,
  ariaLabel: string,
  shapeLabel: string,
): Promise<void> {
  const button = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'))
    .find((b) => b.getAttribute('aria-label') === ariaLabel) as HTMLButtonElement;
  button.click();
  await el.updateComplete;
  const option = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
    .find((b) => b.getAttribute('aria-label') === `${ariaLabel}: ${shapeLabel}`) as HTMLButtonElement;
  option.click();
  await el.updateComplete;
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

describe('<slip-designer> 눈금자·격자 (F-20)', () => {
  /** 격자 간격 메뉴에서 항목을 고른다 (없음·1mm·5mm·10mm) */
  async function pickGrid(
    el: import('../src/slip-designer.js').SlipDesigner,
    label: string,
  ): Promise<void> {
    toolbarButton(el, strings.designer.grid).click();
    await el.updateComplete;
    const option = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    option.click();
    await el.updateComplete;
  }

  it('용지 위·왼쪽에 mm 눈금자가 붙고 10mm마다 숫자가 나온다', async () => {
    const el = await loadDesigner();

    expect(el.shadowRoot!.querySelectorAll('.ruler').length).toBe(2);
    expect(el.shadowRoot!.querySelector('.ruler-corner')).not.toBeNull();

    const numbers = Array.from(el.shadowRoot!.querySelectorAll('.ruler-h text'))
      .map((t) => t.textContent);
    expect(numbers.slice(0, 3)).toEqual(['10', '20', '30']);
    el.remove();
  });

  it('격자 간격을 고르면 그 간격으로 격자가 깔리고, 없음으로 끈다', async () => {
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

  it('격자를 켜야 색 견본이 나오고, 고른 색으로 격자선이 그려진다', async () => {
    const el = await loadDesigner();

    // 격자가 꺼져 있으면 색을 고를 일이 없으므로 견본을 두지 않는다
    toolbarButton(el, strings.designer.grid).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.grid-colors button').length).toBe(0);

    const gap = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .find((b) => b.textContent?.trim() === '5mm') as HTMLButtonElement;
    gap.click();
    await el.updateComplete;

    // 기본은 회색이 골라져 있다
    toolbarButton(el, strings.designer.grid).click();
    await el.updateComplete;
    const swatch = (name: string) => Array.from(el.shadowRoot!.querySelectorAll('.grid-colors button'))
      .find((b) => b.getAttribute('aria-label')
        === `${strings.designer.gridColor}: ${name}`) as HTMLButtonElement;
    expect(swatch(strings.designer.colorGray).getAttribute('aria-pressed')).toBe('true');

    // 파랑을 고르면 격자선 색이 바뀌고 메뉴는 닫힌다
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

    // txt-1(x=30, y=40)을 어중간한 위치로 끌면 10mm 격자로 맞춰진다
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

    // Alt를 누르면 격자를 무시하고 자유롭게 놓인다
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

    // 편집으로 되돌리면 요소 수가 그대로여야 한다 (미리보기 중 편집이 무시됨)
    toolbarButton(el, strings.designer.edit).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.element').length).toBe(before);
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
// 페이지
// ---------------------------------------------------------------------------

function pageIndicator(el: Element): string {
  return el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('<slip-designer> 페이지', () => {
  it('페이지 표시기가 현재/전체 페이지를 보여주고, 한 페이지면 삭제가 비활성화된다', async () => {
    const el = await loadDesigner();
    expect(pageIndicator(el)).toBe('1 / 1');
    expect(toolbarButton(el, strings.designer.deletePage).disabled).toBe(true);
    // 페이지 이동 버튼은 사이드바의 페이지 영역에 표시한다.
    expect(toolbarButton(el, strings.designer.prevPage)).toBeUndefined();
    expect(toolbarButton(el, strings.designer.nextPage)).toBeUndefined();
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

  it('사이드바 페이지 줄로 페이지를 전환하면 해당 페이지 요소가 보인다 (G-34)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const pageRows = () => el.shadowRoot!.querySelectorAll('.page-row');
    (pageRows()[0] as HTMLElement).click();
    await el.updateComplete;
    expect(pageIndicator(el)).toBe('1 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);

    (pageRows()[1] as HTMLElement).click();
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

describe('<slip-designer> slipkit 공통 설정', () => {
  it('폰트가 설정된 slipkit이 있으면 미리보기가 같은 인스턴스의 render를 쓴다', async () => {
    const el = await loadDesigner();
    const render = vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    el.slipkit = {
      locale: undefined,
      getFonts: () => [{ name: 'HostFont', data: new Uint8Array([1]) }],
      render,
      evaluate: (source: string, context: Parameters<typeof evaluateFormula>[1]) =>
        evaluateFormula(source, context),
    } as unknown as SlipKit;
    await el.updateComplete;

    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 미리보기가 호스트의 직접 렌더링과 같은 인스턴스를 사용한다.
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// UI 언어
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
    const el = await loadDesigner(); // 기본 영어
    expect(toolbarButton(el, strings.designer.addText)).toBeTruthy();

    el.locale = 'ko';
    await el.updateComplete;
    expect(toolbarButton(el, '텍스트')).toBeTruthy();
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

  it('오각형을 고르고 캔버스를 클릭하면 변 5개 다각형이 생긴다', async () => {
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

describe('<slip-designer> 선 전용 편집 (C-11)', () => {
  const PX = 96 / 25.4;

  it('선 도구 첫 클릭은 시작점만 기록하고, 둘째 클릭에 선이 생긴다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;

    await clickCanvasAt(el, 20 * PX, 50 * PX);
    // 아직 요소가 생기지 않고 도구가 유지된다
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(toolbarButton(el, strings.designer.shapeLine).getAttribute('aria-pressed')).toBe('true');

    // 커서를 움직이면 반투명 미리보기 선이 보인다
    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 60 * PX, clientY: 50 * PX, pointerId: 1,
    }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.line-ghost')).not.toBeNull();

    await clickCanvasAt(el, 60 * PX, 50 * PX);
    const added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { type: string; lineDirection?: string; position: { x: number }; width: number };
    expect(added.type).toBe('line');
    expect(added.lineDirection).toBe('horizontal');
    expect(added.position.x).toBeCloseTo(20, 0);
    expect(added.width).toBeCloseTo(40, 0);
    expect(el.shadowRoot?.querySelector('.line-ghost')).toBeNull();
    el.remove();
  });

  it('Escape는 두 번 클릭 생성을 취소한다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 100, 100);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.line-ghost')).toBeNull();
    expect(toolbarButton(el, strings.designer.shapeLine).getAttribute('aria-pressed')).toBe('false');

    // 이후 클릭해도 요소가 생기지 않는다
    await clickCanvasAt(el, 200, 100);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('선을 선택하면 8방향 핸들 대신 선 하이라이트와 끝점 핸들 2개가 나타난다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 20 * PX, 50 * PX);
    await clickCanvasAt(el, 60 * PX, 50 * PX);

    // 방금 만든 선이 선택돼 있다
    expect(el.shadowRoot?.querySelectorAll('.endpoint').length).toBe(2);
    expect(el.shadowRoot?.querySelector('.handle-nw')).toBeNull();
    expect(el.shadowRoot?.querySelector('.line-highlight')).not.toBeNull();
    el.remove();
  });

  it('끝점을 끌면 반대쪽 끝점은 고정된 채 상자·선 방향이 다시 계산된다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 20 * PX, 50 * PX);
    await clickCanvasAt(el, 60 * PX, 50 * PX);

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    // 두 번째 끝점(오른쪽)을 아래로 끌어 사선(↘)으로 만든다
    const handle = el.shadowRoot!.querySelectorAll('.endpoint')[1] as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 60 * PX, clientY: 50 * PX, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 80 * PX, clientY: 90 * PX, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;

    const line = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as {
        lineDirection?: string; position: { x: number; y: number }; width: number; height: number;
      };
    expect(line.lineDirection).toBe('down');
    expect(line.position.x).toBeCloseTo(20, 0);
    expect(line.width).toBeCloseTo(60, 0);
    // 고정 끝점은 수평선 상자 세로 중앙(y=51)이라 높이는 90-51=39
    expect(line.height).toBeCloseTo(39, 0);
    expect(changes.length).toBe(1);
    el.remove();
  });
});

describe('<slip-designer> 패널 표시 정리 (F-18)', () => {
  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  it('펼쳐지는 항목은 한 번에 하나만 열린다 — 다른 것을 열면 먼저 것이 닫힌다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1'); // 사각형 — 배경색·테두리색·굵기·형태가 모두 있다
    await el.updateComplete;

    (el.shadowRoot!.querySelector('.color-btn') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.color-pop').length).toBe(1);

    // 테두리 굵기를 열면 색 피커가 닫힌다
    (el.shadowRoot!.querySelector('.width-btn') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.color-pop').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.width-pop').length).toBe(1);

    // 다시 색을 열면 굵기가 닫힌다
    (el.shadowRoot!.querySelector('.color-btn') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.width-pop').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.color-pop').length).toBe(1);
    el.remove();
  });

  it('테두리 형태도 굵기처럼 선 모양 미리보기와 함께 펼쳐진다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1');
    await el.updateComplete;

    const shapeButton = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'))
      .find((b) => b.getAttribute('aria-label')
        === `${strings.designer.styleBorder} ${strings.designer.borderShape}`) as HTMLButtonElement;
    // 버튼에도 지금 형태의 선 모양이 보인다
    expect(shapeButton.querySelector('.shape-line.shape-solid')).not.toBeNull();

    shapeButton.click();
    await el.updateComplete;
    const options = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'));
    expect(options.map((o) => o.querySelector('.shape-line')?.className))
      .toEqual(['shape-line shape-solid', 'shape-line shape-dashed', 'shape-line shape-dotted']);
    el.remove();
  });

  it('숫자 칸에 잘못된 값을 넣으면 지우지 않고 되돌리며 오류를 알린다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const sizeInput = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.fontSize)!
      .querySelector('input') as HTMLInputElement;

    const input = sizeInput();
    // 숫자 칸에 글자를 넣으면 브라우저가 값을 빈 문자열로 준다 (badInput)
    Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    // 값이 사라지지 않고 되돌아온다
    expect(sizeInput().value).toBe('10');
    // 유효하지 않은 입력임을 표시한다.
    expect(el.shadowRoot!.querySelector('.input-error')?.textContent?.trim())
      .toBe(strings.designer.numberInput);
    el.remove();
  });

  it('지정하지 않은 항목은 실제 적용 중인 값을 흐리게 보여준다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1'); // 글자색·크기 미지정 텍스트
    await el.updateComplete;

    const fontColor = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.fontColor)!;
    // 미지정이지만 실제로 적용되는 검정을 흐리게 보여준다
    expect(fontColor.querySelector('.color-value')?.textContent?.trim()).toBe('#000000');
    expect(fontColor.querySelector('.color-value')?.classList.contains('dim')).toBe(true);

    const sizeInput = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.fontSize)!
      .querySelector('input') as HTMLInputElement;

    // 미지정 상태에서도 실제 적용값으로 숫자 입력을 시작한다.
    const fontSize = sizeInput();
    expect(fontSize.value).toBe('10');
    expect(fontSize.classList.contains('dim')).toBe(true);

    // 값을 지정하면 흐린 표시가 사라진다
    fontSize.value = '14';
    fontSize.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const after = sizeInput();
    expect(after.value).toBe('14');
    expect(after.classList.contains('dim')).toBe(false);

    // 기본값과 같은 값을 넣으면 파일에는 적지 않는다(다시 흐리게)
    after.value = '10';
    after.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(sizeInput().classList.contains('dim')).toBe(true);
    el.remove();
  });

  it('그리드 셀은 요소에서 물려받는 글자색을 흐리게 보여준다', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'grd-1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 15 }, { height: 15 }], columns: [{ width: 45 }, { width: 45 }],
      fontColor: '#1a73e8',
      cells: [{ row: 0, column: 0, content: '가' }],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 표를 고른 뒤 그 자리를 한 번 더 누르면 셀 선택 모드가 되어 (0,0) 셀이 골라진다
    const PX = 96 / 25.4;
    const grid = el.shadowRoot!.querySelector('[data-id="grd-1"]') as HTMLElement;
    for (let i = 0; i < 2; i += 1) {
      grid.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, composed: true, clientX: 15 * PX, clientY: 15 * PX, pointerId: 1,
      }));
      grid.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, composed: true, clientX: 15 * PX, clientY: 15 * PX, pointerId: 1,
      }));
      await el.updateComplete;
    }

    const cellFontColor = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .find((b) => b.getAttribute('aria-label')
        === `${strings.designer.cell} ${strings.designer.fontColor}`)!;
    // 셀에 지정하지 않았으면 표 요소의 글자색이 적용되므로 그 값을 흐리게 보여준다
    expect(cellFontColor.querySelector('.color-value')?.textContent?.trim()).toBe('#1a73e8');
    expect(cellFontColor.querySelector('.color-value')?.classList.contains('dim')).toBe(true);

    // 셀 선택 중에는 그리드 공통 스타일을 함께 표시하지 않는다.
    const elementFontColor = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.fontColor);
    expect(elementFontColor).toBeUndefined();
    el.remove();
  });

  it('요소 종류 배지는 평소 숨었다가 고른 요소에만 보이고, 요소 확인로 전부 켠다', async () => {
    const el = await loadDesigner();
    const badges = () => Array.from(el.shadowRoot!.querySelectorAll('.element .badge'));
    const canvas = () => el.shadowRoot!.querySelector('.canvas-area')!;

    // 배지는 요소마다 있지만 평소에는 숨어 있고, 고른 요소에만 보인다
    expect(badges().length).toBe(2);
    expect(badges().filter((n) => getComputedStyle(n).display !== 'none').length).toBe(0);
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(badges().filter((n) => getComputedStyle(n).display !== 'none').length).toBe(1);

    // 툴바의 요소 확인를 켜면 캔버스가 전부 보이는 상태로 바뀐다
    toolbarButton(el, strings.designer.showBadges).click();
    await el.updateComplete;
    expect(canvas().classList.contains('show-badges')).toBe(true);
    expect(toolbarButton(el, strings.designer.showBadges).getAttribute('aria-pressed')).toBe('true');

    // Ctrl+B로 다시 끈다
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(canvas().classList.contains('show-badges')).toBe(false);
    el.remove();
  });

  it('텍스트의 줄바꿈이 캔버스에도 그대로 보인다 (PDF와 같게)', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'text' as const, id: 'txt-nl', name: 'nl', position: { x: 10, y: 10 },
      width: 60, height: 20, content: '첫째 줄\n둘째 줄',
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    expect(content.textContent).toBe('첫째 줄\n둘째 줄');
    // 한 줄로 눌리지 않도록 줄바꿈을 살려 표시한다
    expect(getComputedStyle(content).whiteSpace).toBe('pre-wrap');
    el.remove();
  });
});

describe('<slip-designer> 글자 스타일·테두리 편집 (C-11)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  it('텍스트 요소의 굵게·밑줄·취소선 토글이 값을 넣고 지운다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    byAria(el, strings.designer.bold).click();
    await el.updateComplete;
    byAria(el, strings.designer.underline).click();
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[0]! as never as Record<string, unknown>;
    expect(text.bold).toBe(true);
    expect(text.underline).toBe(true);
    expect(byAria(el, strings.designer.bold).getAttribute('aria-pressed')).toBe('true');

    byAria(el, strings.designer.bold).click();
    await el.updateComplete;
    expect(text.bold).toBeUndefined();
    el.remove();
  });

  it('수직 정렬·줄간격·자간·세로쓰기를 속성 패널에서 정한다 (G-45)', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const text = () => (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[0]! as never as Record<string, unknown>;
    const rowInput = (labelText: string) => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === labelText)!
      .querySelector('input') as HTMLInputElement;

    // 수직 정렬 — 가운데
    byAria(el, `${strings.designer.verticalAlignment}: ${strings.designer.alignMiddle}`).click();
    await el.updateComplete;
    expect(text().verticalAlignment).toBe('middle');

    // 줄간격 1.5
    const lh = rowInput(strings.designer.lineHeight);
    lh.value = '1.5';
    lh.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(text().lineHeight).toBe(1.5);

    // 자간 2
    const cs = rowInput(strings.designer.characterSpacing);
    cs.value = '2';
    cs.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(text().characterSpacing).toBe(2);

    // 세로쓰기 켜기
    const vertical = Array.from(el.shadowRoot!.querySelectorAll('input[type="checkbox"]'))
      .find((c) => c.getAttribute('aria-label') === strings.designer.verticalWriting) as HTMLInputElement;
    vertical.checked = true;
    vertical.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(text().vertical).toBe(true);

    // 기본값으로 되돌리면 필드가 지워진다
    byAria(el, `${strings.designer.verticalAlignment}: ${strings.designer.alignTop}`).click();
    await el.updateComplete;
    expect(text().verticalAlignment).toBeUndefined();
    el.remove();
  });

  it('테두리 굵기 선택에 없음과 정해진 단계가 굵기 미리보기 선과 함께 나열된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1'); // 사각형 — 기본 0.2mm
    await el.updateComplete;

    (el.shadowRoot!.querySelector('.width-btn') as HTMLElement).click();
    await el.updateComplete;

    const options = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'));
    expect(options[0]?.getAttribute('aria-label'))
      .toBe(`${strings.designer.borderWidth}: ${strings.designer.colorNone}`);
    // 단계 항목마다 굵기 미리보기 선이 있다
    expect(options.slice(1).every((b) => b.querySelector('.width-line'))).toBe(true);

    // 0.8mm를 고르면 저장되고 버튼 표시도 바뀐다
    (options.find((b) => b.getAttribute('aria-label') === `${strings.designer.borderWidth}: 0.8mm`) as HTMLButtonElement).click();
    await el.updateComplete;
    const rect = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[1]! as never as Record<string, unknown>;
    expect(rect.borderWidth).toBe(0.8);
    expect(el.shadowRoot!.querySelector('.width-btn')?.textContent).toContain('0.8mm');
    el.remove();
  });

  it('사각형에 파선을 고르면 모서리 반경이 지워지고 반경 입력이 비활성화된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1');
    await el.updateComplete;

    const radiusInput = () => Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === strings.designer.cornerRadius) as HTMLInputElement;
    radiusInput().value = '3';
    radiusInput().dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const rect = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[1]! as never as Record<string, unknown>;
    expect(rect.radius).toBe(3);

    await pickBorderShape(
      el,
      `${strings.designer.styleBorder} ${strings.designer.borderShape}`,
      strings.designer.borderDashed,
    );

    expect(rect.borderStyle).toBe('dashed');
    expect(rect.radius).toBeUndefined();
    expect(radiusInput().disabled).toBe(true);
    el.remove();
  });

  it('스타일 항목이 텍스트/배경/테두리 그룹으로 나뉘어 표시된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const titles = Array.from(el.shadowRoot!.querySelectorAll('.prop-section-title'))
      .map((t) => t.textContent?.trim());
    expect(titles).toContain(strings.designer.styleText);
    expect(titles).toContain(strings.designer.styleBackground);
    expect(titles).toContain(strings.designer.styleBorder);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// : 수식 편집 모달
// ---------------------------------------------------------------------------

describe('<slip-designer> 수식 편집 모달 (D-12)', () => {
  /** 수식 편집 모달을 열고, 모달을 연 버튼을 돌려준다 (초점 복귀 확인용) */
  async function openFormulaModal(
    el: import('../src/slip-designer.js').SlipDesigner,
  ): Promise<HTMLButtonElement> {
    await addByCanvasClick(el, strings.designer.addField);
    // 값 소스를 수식으로 바꾸면 수식 입력란이 표시된다.
    const source = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.cellSource)!
      .querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, source, 'formula');

    const open = Array.from(el.shadowRoot!.querySelectorAll('.row-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.formulaModalTitle) as HTMLButtonElement;
    open.focus();
    open.click();
    await el.updateComplete;
    return open;
  }

  function formulaInput(el: Element): HTMLTextAreaElement {
    return el.shadowRoot!.querySelector('.formula-input') as HTMLTextAreaElement;
  }

  function setDraft(el: Element, value: string): void {
    const input = formulaInput(el);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyButton(el: Element): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.apply) as HTMLButtonElement;
  }

  /** 반복 구간이 값 3개를 읽는 그리드를 담은 양식으로 디자이너를 띄운다 */
  async function loadWithTable(): Promise<import('../src/slip-designer.js').SlipDesigner> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'tbl-1', name: '품목 표',
      position: { x: 10, y: 10 }, width: 180, height: 8 * 3,
      rows: [{ height: 8 }, { height: 8 }],
      columns: [{ width: 90 }, { width: 54 }, { width: 36 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 2 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 0, column: 1, content: '금액' },
        { row: 0, column: 2, content: '수량' },
        { row: 1, column: 0, parameter: 'itemName' },
        { row: 1, column: 1, parameter: 'amount' },
        { row: 1, column: 2, parameter: 'quantity' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    return loadDesigner();
  }

  /** 모달 안에서 Tab으로 갈 수 있는 요소를 화면 순서대로 모은다 */
  function modalFocusables(el: Element): HTMLElement[] {
    const modal = el.shadowRoot!.querySelector('.modal') as HTMLElement;
    return Array.from(
      modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  /** 요소에 초점을 두고 Tab 키를 눌러 기본 이동이 막혔는지 확인한다 */
  function pressTab(target: HTMLElement, shiftKey = false): boolean {
    target.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('모달을 열면 모달임을 알리고 안으로 초점을 옮긴다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const modal = el.shadowRoot!.querySelector('.modal') as HTMLElement;
    expect(modal.getAttribute('aria-modal')).toBe('true');
    // 초점이 모달 안에 있어야 배경 화면을 잘못 조작하지 않는다.
    expect(modal.contains(el.shadowRoot!.activeElement as Node)).toBe(true);
    el.remove();
  });

  it('마지막 요소에서 Tab을 누르면 첫 요소로 초점이 돌아온다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const items = modalFocusables(el);
    expect(pressTab(items[items.length - 1]!)).toBe(true);
    // 기본 이동을 막는 데 그치지 않고 실제로 첫 요소에 초점이 있어야 한다.
    expect(el.shadowRoot!.activeElement).toBe(items[0]);
    el.remove();
  });

  it('첫 요소에서 Shift+Tab을 누르면 마지막 요소로 이동한다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const items = modalFocusables(el);
    expect(pressTab(items[0]!, true)).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(items[items.length - 1]);
    el.remove();
  });

  it('모달 가운데에서 Tab을 누르면 브라우저 기본 이동을 막지 않는다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    const items = modalFocusables(el);
    expect(items.length).toBeGreaterThan(2);
    expect(pressTab(items[1]!)).toBe(false);
    el.remove();
  });

  it('모달을 닫으면 열기 전 요소로 초점이 돌아온다', async () => {
    const el = await loadDesigner();
    const opener = await openFormulaModal(el);
    expect(el.shadowRoot!.activeElement).not.toBe(opener);

    const close = Array.from(el.shadowRoot!.querySelectorAll('.modal-close'))[0] as HTMLButtonElement;
    close.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(opener);
    el.remove();
  });

  it('Escape로 닫아도 초점이 열기 전 요소로 돌아온다', async () => {
    const el = await loadDesigner();
    const opener = await openFormulaModal(el);
    const modal = el.shadowRoot!.querySelector('.modal') as HTMLElement;
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(opener);
    el.remove();
  });

  it('문자열 따옴표 규칙을 모달에서 안내한다 (F-21)', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    expect(el.shadowRoot!.querySelector('.formula-hint')?.textContent?.trim())
      .toBe(strings.designer.formulaQuoteHint);
    el.remove();
  });

  it('파라미터 목록에 표의 하위 열까지 나오고, 누르면 표파라미터.열키로 삽입된다 (F-21)', async () => {
    const el = await loadWithTable();
    await openFormulaModal(el);

    const columnChips = Array.from(el.shadowRoot!.querySelectorAll('.parameter-chip.column'));
    expect(columnChips.map((c) => c.textContent?.trim())).toEqual(['품명', '금액', '수량']);

    (columnChips[1] as HTMLElement).click();
    await el.updateComplete;
    expect(formulaInput(el).value).toBe('items.amount');
    el.remove();
  });

  it('표 파라미터 뒤에 점을 찍으면 열을 제안하고, 고르면 이어 붙는다 (F-21)', async () => {
    const el = await loadWithTable();
    await openFormulaModal(el);

    // 제안은 표 파라미터 뒤에 점을 찍었을 때만 나온다
    expect(el.shadowRoot!.querySelector('.formula-suggest')).toBeNull();

    setDraft(el, 'SUM(items.');
    await el.updateComplete;
    const suggested = () => Array.from(el.shadowRoot!.querySelectorAll('.formula-suggest .parameter-chip'));
    expect(suggested().map((c) => c.textContent?.trim()))
      .toEqual(['품명 · itemName', '금액 · amount', '수량 · quantity']);

    // 몇 글자 치면 그 글자로 시작하는 열만 남는다
    setDraft(el, 'SUM(items.a');
    await el.updateComplete;
    expect(suggested().map((c) => c.textContent?.trim())).toEqual(['금액 · amount']);

    // 고르면 이미 친 글자 뒤에 나머지가 이어 붙는다
    (suggested()[0] as HTMLElement).click();
    await el.updateComplete;
    expect(formulaInput(el).value).toBe('SUM(items.amount');
    el.remove();
  });

  it('함수 32종이 분류와 설명과 함께 나열된다 (ADR-017·044)', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    const rows = el.shadowRoot!.querySelectorAll('.fn-row');
    expect(rows.length).toBe(32);
    expect(el.shadowRoot!.querySelectorAll('.fn-category').length).toBe(8);
    // 각 항목에 사용법·설명이 있다
    expect(rows[0]?.querySelector('.fn-signature')?.textContent).toContain('SUM');
    expect(rows[0]?.querySelector('.fn-desc')?.textContent?.length).toBeGreaterThan(0);
    el.remove();
  });

  it('함수를 클릭하면 커서 위치에 삽입된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    const sumRow = Array.from(el.shadowRoot!.querySelectorAll('.fn-row'))
      .find((b) => b.getAttribute('aria-label') === 'SUM') as HTMLButtonElement;
    sumRow.click();
    await el.updateComplete;
    expect(formulaInput(el).value).toBe('SUM()');
    el.remove();
  });

  it('문법 오류는 실시간으로 표시되고 적용이 비활성화된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    setDraft(el, 'SUM(1,');
    await el.updateComplete;
    const status = el.shadowRoot!.querySelector('.formula-status');
    expect(status?.classList.contains('error')).toBe(true);
    expect(status?.textContent).toContain(strings.designer.syntaxError);
    expect(applyButton(el).disabled).toBe(true);
    el.remove();
  });

  it('올바른 수식은 결과를 미리 계산해 보여주고, 적용하면 요소에 저장된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    setDraft(el, 'ROUND(1.5) + 1');
    await el.updateComplete;
    const status = el.shadowRoot!.querySelector('.formula-status');
    expect(status?.classList.contains('error')).toBe(false);
    expect(status?.textContent).toContain(`${strings.designer.previewResult}: 3`);

    applyButton(el).click();
    await el.updateComplete;
    const field = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { formula?: string };
    expect(field.formula).toBe('ROUND(1.5) + 1');
    // 모달은 닫힌다
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    el.remove();
  });

  it('파라미터 목록이 칩으로 나오고 클릭하면 삽입된다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);

    const chips = el.shadowRoot!.querySelectorAll('.parameter-chip');
    // 방금 만든 필드의 기본 파라미터가 하나 있다
    expect(chips.length).toBeGreaterThan(0);
    (chips[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(formulaInput(el).value.length).toBeGreaterThan(0);
    el.remove();
  });

  it('Escape로 적용 없이 닫힌다', async () => {
    const el = await loadDesigner();
    await openFormulaModal(el);
    setDraft(el, 'SUM(1)');
    await el.updateComplete;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).toBeNull();
    const field = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { formula?: string };
    // Escape로 초안을 취소해도 값 소스는 수식으로 유지된다.
    expect(field.formula).toBe('');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// : 사이드바 파라미터 등록·삭제·논리명 편집 + 샘플 데이터 편집·채운 미리보기
// ---------------------------------------------------------------------------

describe('<slip-designer> 파라미터 관리 (ADR-034)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  function defsOf(el: Element): { key: string; label?: string }[] | undefined {
    return (fileOf(el).template as { parameters?: { key: string; label?: string }[] }).parameters;
  }

  /** 사이드바 + 버튼 — 기본 이름으로 값을 만들고 바로 고른다 */
  async function addParameter(el: import('../src/slip-designer.js').SlipDesigner) {
    byAria(el, strings.designer.addParameter).click();
    await el.updateComplete;
  }

  it('+ 버튼은 기본 이름으로 값을 바로 만들고 그 값의 편집 패널을 연다', async () => {
    const el = await loadDesigner();
    await addParameter(el);

    expect(defsOf(el)).toEqual([{ key: 'value1', label: `${strings.designer.newParameterName} 1` }]);
    // 오른쪽 패널이 파라미터 편집으로 바뀐다
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.sidebarParameters);
    expect((el.shadowRoot?.querySelector('.parameter-key-input') as HTMLInputElement).value)
      .toBe('value1');

    // 두 번째는 겹치지 않는 이름으로 이어진다
    await addParameter(el);
    expect(defsOf(el)?.map((d) => d.key)).toEqual(['value1', 'value2']);
    el.remove();
  });

  it('패널에서 물리명을 바꾸면 그 값을 쓰는 요소와 샘플 값도 함께 따라간다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };
    const created = field.parameter;
    fileOf(el).template.sampleValues = { [created]: '1,000' } as never;

    // 사이드바에서 그 값을 골라 패널에서 물리명을 고친다
    const row = Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
      .find((r) => r.getAttribute('title') === created) as HTMLElement;
    row.click();
    await el.updateComplete;

    const keyInput = el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement;
    keyInput.value = 'totalAmount';
    keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(defsOf(el)).toEqual([{ key: 'totalAmount' }]);
    expect(field.parameter).toBe('totalAmount');
    expect(fileOf(el).template.sampleValues).toEqual({ totalAmount: '1,000' });
    el.remove();
  });

  it('이미 쓰는 물리명으로는 바꾸지 않는다', async () => {
    const el = await loadDesigner();
    await addParameter(el);
    await addParameter(el);

    const keyInput = el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement;
    keyInput.value = 'value1';
    keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(defsOf(el)?.map((d) => d.key)).toEqual(['value1', 'value2']);
    // 입력칸은 원래 이름으로 되돌아가고 이유를 알려준다
    expect(keyInput.value).toBe('value2');
    expect(keyInput.getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot?.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.keyInUse);
    el.remove();
  });

  it('패널에서 논리명을 고치면 목록 표시가 바뀐다', async () => {
    const el = await loadDesigner();
    await addParameter(el);

    const labelInput = el.shadowRoot!.querySelector('.parameter-label-input') as HTMLInputElement;
    labelInput.value = '합계 금액';
    labelInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(defsOf(el)).toEqual([{ key: 'value1', label: '합계 금액' }]);
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.side-row'));
    expect(rows.some((r) => r.textContent?.includes('합계 금액'))).toBe(true);
    el.remove();
  });

  it('요소를 추가하면 그 값이 정의부에 함께 등록된다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };

    expect(defsOf(el)).toEqual([{ key: field.parameter }]);
    el.remove();
  });

  it('요소 패널의 선택 상자로 등록된 값을 고르거나 새 값을 만들어 붙인다', async () => {
    const el = await loadDesigner();
    await addParameter(el);
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };

    const trigger = el.shadowRoot!.querySelector('.parameter-select') as HTMLButtonElement;
    // 등록된 값 + "새 값 등록" 항목이 나온다
    expect(await listOptionLabels(el, trigger))
      .toEqual([`${strings.designer.newParameterName} 1`, field.parameter, strings.designer.parameterNew]);

    await pickListValue(el, trigger, 'value1');
    expect(field.parameter).toBe('value1');

    // "새 값 등록"을 고르면 값을 만들어 그대로 이 요소에 붙인다
    const trigger2 = el.shadowRoot!.querySelector('.parameter-select') as HTMLButtonElement;
    trigger2.click();
    await el.updateComplete;
    const optionButtons = el.shadowRoot!.querySelectorAll('.list-select-menu button');
    (optionButtons[optionButtons.length - 1] as HTMLButtonElement).click();
    await el.updateComplete;

    expect(field.parameter).toBe('value2');
    expect(defsOf(el)?.map((d) => d.key)).toContain('value2');
    el.remove();
  });

  it('정의부 삭제는 항목을 제거하고, 요소가 쓰는 키는 목록에 남으며 삭제가 비활성화된다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };

    byAria(el, `${field.parameter} ${strings.designer.delete}`).click();
    await el.updateComplete;

    // 정의부에서는 빠지지만 요소가 쓰고 있으니 목록에는 남고, 그 삭제 버튼은 비활성
    expect(defsOf(el)).toBeUndefined();
    expect(byAria(el, `${field.parameter} ${strings.designer.delete}`).disabled).toBe(true);
    el.remove();
  });
});

describe('<slip-designer> 샘플 데이터 (D-13)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  async function openSampleModal(el: import('../src/slip-designer.js').SlipDesigner) {
    byAria(el, strings.designer.sampleData).click();
    await el.updateComplete;
  }

  it('필드 파라미터의 샘플 값을 입력하면 sampleValues에 저장된다 (숫자 표기는 수로)', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };
    await openSampleModal(el);

    const input = Array.from(el.shadowRoot!.querySelectorAll('.modal input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.sampleData} ${field.parameter}`) as HTMLInputElement;
    input.value = '12500';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const samples = (fileOf(el).template as { sampleValues?: Record<string, unknown> }).sampleValues;
    expect(samples?.[field.parameter]).toBe(12500);

    // 빈 값으로 바꾸면 지워지고, 전부 비면 sampleValues 자체가 사라진다
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect((fileOf(el).template as { sampleValues?: unknown }).sampleValues).toBeUndefined();
    el.remove();
  });

  it('반복 구간 파라미터는 항목 필드대로 행을 추가·편집한다 (ADR-037)', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'g-items', name: '품목 그리드',
      position: { x: 10, y: 10 }, width: 90, height: 8 * 3,
      rows: [{ height: 8 }, { height: 8 }],
      columns: [{ width: 60 }, { width: 30 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 2 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 1, column: 0, parameter: 'itemName' },
        { row: 1, column: 1, parameter: 'amount' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    await openSampleModal(el);

    // 반복 파라미터(items)은 행 편집 그리드로 나온다
    expect(el.shadowRoot!.querySelector('.sample-grid')).not.toBeNull();
    byAria(el, `items ${strings.designer.addRow}`).click();
    await el.updateComplete;

    const cell = Array.from(el.shadowRoot!.querySelectorAll('.sample-grid input'))
      .find((i) => i.getAttribute('aria-label') === 'items 1 itemName') as HTMLInputElement;
    cell.value = '노트';
    cell.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const samples = (fileOf(el).template as { sampleValues?: Record<string, unknown> }).sampleValues;
    expect(samples?.items).toEqual([{ itemName: '노트' }]);

    // 행 삭제로 비우면 값도 사라진다
    byAria(el, `items 1 ${strings.designer.delete}`).click();
    await el.updateComplete;
    expect((fileOf(el).template as { sampleValues?: unknown }).sampleValues).toBeUndefined();
    el.remove();
  });

  it('샘플 값이 있으면 미리보기는 그 값으로 채운 전표를 렌더한다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };
    await openSampleModal(el);
    const input = Array.from(el.shadowRoot!.querySelectorAll('.modal input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.sampleData} ${field.parameter}`) as HTMLInputElement;
    input.value = '9900';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    // 모달 닫기
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    renderSlipToPdfMock.mockClear();
    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();

    const rendered = renderSlipToPdfMock.mock.calls[0]?.[0] as never as {
      kind: string; values?: Record<string, unknown>; issued?: boolean;
    };
    expect(rendered.kind).toBe('voucher');
    expect(rendered.values?.[field.parameter]).toBe(9900);
    expect(rendered.issued).toBe(false);
    el.remove();
  });

  it('샘플 값이 없으면 미리보기는 양식 그대로 렌더한다', async () => {
    const el = await loadDesigner();
    renderSlipToPdfMock.mockClear();
    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();
    const rendered = renderSlipToPdfMock.mock.calls[0]?.[0] as never as { kind: string };
    expect(rendered.kind).toBe('template');
    el.remove();
  });

  it('파라미터가 10개를 넘으면 10개 단위 페이지로 나뉜다', async () => {
    const el = await loadDesigner();
    (fileOf(el).template as { parameters?: { key: string }[] }).parameters =
      Array.from({ length: 12 }, (_, i) => ({ key: `b${i + 1}` }));
    await openSampleModal(el);

    const inputs = () => el.shadowRoot!.querySelectorAll('.modal .prop-row input');
    expect(inputs().length).toBe(10);
    const pageButtons = () => el.shadowRoot!.querySelectorAll('.page-btn');
    expect(pageButtons().length).toBe(2);
    expect(pageButtons()[0]?.getAttribute('aria-pressed')).toBe('true');

    // 다음 버튼으로도, 페이지 번호 버튼으로도 바로 이동할 수 있다
    byAria(el, `${strings.designer.sampleData} ${strings.designer.nextPage}`).click();
    await el.updateComplete;
    expect(inputs().length).toBe(2);
    expect(pageButtons()[1]?.getAttribute('aria-pressed')).toBe('true');
    (pageButtons()[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(inputs().length).toBe(10);

    // 10개 이하면 페이지 표시가 없다
    (fileOf(el).template as { parameters?: { key: string }[] }).parameters =
      Array.from({ length: 3 }, (_, i) => ({ key: `b${i + 1}` }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    await openSampleModal(el);
    expect(el.shadowRoot!.querySelector('.sample-pager')).toBeNull();
    el.remove();
  });

  it('JSON 탭에서 샘플 전체를 붙여 넣어 적용할 수 있고, 잘못된 JSON은 적용이 막힌다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    await openSampleModal(el);

    byAria(el, `${strings.designer.sampleData}: JSON`).click();
    await el.updateComplete;
    const textarea = el.shadowRoot!.querySelector('.sample-json') as HTMLTextAreaElement;
    const applyBtn = () => Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.apply) as HTMLButtonElement;

    // 잘못된 JSON은 오류를 표시하고 적용 버튼을 비활성화한다.
    textarea.value = '{ "a": ';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(applyBtn().disabled).toBe(true);
    expect(el.shadowRoot!.querySelector('.formula-status.error')).not.toBeNull();

    // 최상위 값이 배열이면 적용할 수 없다.
    textarea.value = '[1, 2]';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(applyBtn().disabled).toBe(true);

    // 유효한 객체를 적용하면 sampleValues 전체를 교체한다.
    textarea.value = '{ "tradeDate": "2026-08-20", "items": [{ "amount": 1000 }] }';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(applyBtn().disabled).toBe(false);
    applyBtn().click();
    await el.updateComplete;

    const samples = (fileOf(el).template as { sampleValues?: Record<string, unknown> }).sampleValues;
    expect(samples).toEqual({ tradeDate: '2026-08-20', items: [{ amount: 1000 }] });
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// : 프리셋 주입 + 내 양식 저장·목록
// ---------------------------------------------------------------------------

describe('<slip-designer> 프리셋 주입 (D-15)', () => {
  it('presets를 주면 동봉 프리셋 대신 그 목록이 메뉴에 나오고 적용된다', async () => {
    const el = await loadDesigner();
    const custom = makeTemplateFile();
    custom.template.meta.title = '우리 회사 양식';
    (el as unknown as { presets: unknown[] }).presets = [
      { id: 'ours', name: '우리 회사 양식', create: () => JSON.parse(JSON.stringify(custom)) },
    ];
    await el.updateComplete;

    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    const items = Array.from(el.shadowRoot!.querySelectorAll('.preset-menu button'))
      .map((b) => b.textContent?.trim());
    expect(items).toEqual(['우리 회사 양식']);

    (el.shadowRoot!.querySelector('.preset-menu button') as HTMLButtonElement).click();
    await el.updateComplete;
    expect((el as unknown as { _file: SlipTemplateFile })._file.template.meta.title)
      .toBe('우리 회사 양식');
    el.remove();
  });
});

describe('<slip-designer> 내 양식 저장·목록 (D-15)', () => {
  interface FakeStorage {
    save: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  }

  function makeStorage(): FakeStorage {
    return {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(makeTemplateFile()),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        items: [
          { id: 'a', kind: 'template', title: '거래명세서', updatedAt: '2026-08-20T00:00:00.000Z' },
          { id: 'b', kind: 'template', title: '청구서' },
        ],
      }),
    };
  }

  async function mountWithStorage(storage: FakeStorage) {
    const el = await loadDesigner();
    (el as unknown as { storage: FakeStorage }).storage = storage;
    await el.updateComplete;
    return el;
  }

  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  it('storage가 없으면 저장·목록 버튼이 나오지 않는다', async () => {
    const el = await loadDesigner();
    expect(toolbarButton(el, strings.designer.saveAsMyForm)).toBeUndefined();
    el.remove();
  });

  it('제목을 확인해 저장하면 어댑터에 저장되고 양식 제목도 반영된다', async () => {
    const storage = makeStorage();
    const el = await mountWithStorage(storage);

    toolbarButton(el, strings.designer.saveAsMyForm).click();
    await el.updateComplete;
    const title = el.shadowRoot!.querySelector('.save-title') as HTMLInputElement;
    expect(title.value).toBe('테스트'); // 현재 양식 제목이 초안
    title.value = '내 거래명세서';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    (Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.save) as HTMLButtonElement).click();
    await flush();
    await el.updateComplete;

    expect(storage.save).toHaveBeenCalledTimes(1);
    const [id, file] = storage.save.mock.calls[0]! as [string, SlipTemplateFile];
    expect(typeof id).toBe('string');
    expect(file.template.meta.title).toBe('내 거래명세서');
    expect((el as unknown as { _file: SlipTemplateFile })._file.template.meta.title)
      .toBe('내 거래명세서');
    expect(el.shadowRoot!.textContent).toContain(strings.designer.savedNotice);

    // 두 번째 저장은 같은 키로 덮어쓴다
    toolbarButton(el, strings.designer.saveAsMyForm).click();
    await el.updateComplete;
    (Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.save) as HTMLButtonElement).click();
    await flush();
    await el.updateComplete;
    expect(storage.save.mock.calls[1]![0]).toBe(id);

    // "새 양식으로 저장"을 고르면 새 키로 저장된다
    toolbarButton(el, strings.designer.saveAsMyForm).click();
    await el.updateComplete;
    const asNew = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === strings.designer.saveAsNew) as HTMLInputElement;
    asNew.checked = true;
    asNew.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    (Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.save) as HTMLButtonElement).click();
    await flush();
    await el.updateComplete;
    expect(storage.save.mock.calls[2]![0]).not.toBe(id);
    el.remove();
  });

  it('목록에서 고르면 그 양식을 불러오고, 검색은 화면에서 거르며, 삭제·불러오기는 어댑터로 이어진다', async () => {
    const storage = makeStorage();
    const loaded = makeTemplateFile();
    loaded.template.meta.title = '불러온 양식';
    storage.load.mockResolvedValue(loaded);
    const el = await mountWithStorage(storage);

    toolbarButton(el, strings.designer.myFormsList).click();
    await flush();
    await el.updateComplete;
    expect(storage.list).toHaveBeenCalledWith({ kind: 'template' }, undefined);
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(2);

    // 검색은 이미 조회한 목록에 적용하며 어댑터를 다시 호출하지 않는다.
    storage.list.mockClear();
    const search = el.shadowRoot!.querySelector('.forms-search') as HTMLInputElement;
    search.value = '청구';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(storage.list).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(1);

    // 검색어를 지우면 다시 둘 다 보인다
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(2);

    // 삭제
    byAria(el, `청구서 ${strings.designer.delete}`).click();
    await flush();
    await el.updateComplete;
    expect(storage.delete).toHaveBeenCalledWith('b');
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(1);

    // 불러오면 캔버스를 교체하고 모달을 닫은 뒤 slip-change를 발생시킨다.
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    byAria(el, `거래명세서 ${strings.designer.edit}`).click();
    await flush();
    await el.updateComplete;
    expect(storage.load).toHaveBeenCalledWith('a');
    expect((el as unknown as { _file: SlipTemplateFile })._file.template.meta.title)
      .toBe('불러온 양식');
    expect(el.shadowRoot!.querySelector('.form-row')).toBeNull();
    expect(changes.length).toBe(1);
    el.remove();
  });

  it('목록을 커서로 전부 받아 번호 페이지로 나눠 보인다 (ADR-045)', async () => {
    const storage = makeStorage();
    // 커서로 나뉜 12개 항목을 모두 조회해 목록에 보관한다.
    const many = Array.from({ length: 12 }, (_, i) =>
      ({ id: `f${i}`, kind: 'template' as const, title: `양식 ${i}` }));
    storage.list
      .mockResolvedValueOnce({ items: many.slice(0, 10), nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: many.slice(10) });
    const el = await mountWithStorage(storage);

    toolbarButton(el, strings.designer.myFormsList).click();
    await flush();
    await el.updateComplete;

    // 커서로 두 번 조회해 전부 모은다
    expect(storage.list).toHaveBeenCalledTimes(2);
    expect(storage.list).toHaveBeenNthCalledWith(1, { kind: 'template' }, undefined);
    expect(storage.list).toHaveBeenNthCalledWith(2, { kind: 'template' }, 'c1');

    // 한 페이지 10개 → 첫 페이지 10개 + 번호 버튼 2개
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(10);
    const pageBtns = Array.from(el.shadowRoot!.querySelectorAll('.page-btn')) as HTMLButtonElement[];
    expect(pageBtns.length).toBe(2);

    // 두 번째 화면 페이지에서도 어댑터를 다시 호출하지 않는다.
    storage.list.mockClear();
    pageBtns[1]!.click();
    await el.updateComplete;
    expect(storage.list).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelectorAll('.form-row').length).toBe(2);
    el.remove();
  });

  it('저장소 오류는 모달에 그대로 보여준다', async () => {
    const storage = makeStorage();
    storage.list.mockRejectedValue(new Error('로컬 파일 저장소는 목록 조회를 지원하지 않습니다'));
    const el = await mountWithStorage(storage);

    toolbarButton(el, strings.designer.myFormsList).click();
    await flush();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.formula-status.error')?.textContent)
      .toContain('목록 조회를 지원하지 않습니다');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 이미지 업로드: 파일을 base64로 저장하고 등록된 이미지를 재사용한다.
// ---------------------------------------------------------------------------

describe('<slip-designer> 이미지 업로드', () => {
  const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=';
  const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function makeImageFile(srcs: string[]): SlipFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = srcs.map((src, i) => ({
      type: 'image' as const,
      id: `img-${i + 1}`,
      name: `이미지 ${i + 1}`,
      position: { x: 10 + i * 50, y: 10 },
      width: 40,
      height: 40,
      src,
    })) as never;
    return file as unknown as SlipFile;
  }

  async function mountImages(srcs: string[]) {
    parseSlipFileMock.mockReturnValue(makeImageFile(srcs));
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  function openImageButton(el: Element): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.col-modal-open'))
      .find((b) => b.textContent?.includes(strings.designer.imagePick)
        || b.textContent?.includes(strings.designer.imageChange)) as HTMLButtonElement;
  }

  it('이미지를 선택하지 않은 요소는 안 골랐음을 알리고 캔버스에도 글자로 보인다', async () => {
    const el = await mountImages([PLACEHOLDER]);
    selectElement(el, 'img-1');
    await el.updateComplete;

    expect(el.shadowRoot!.textContent).toContain(strings.designer.imageNone);
    // 1×1 투명 PNG 자리표시는 안내 문구로 표시한다.
    const canvasImg = el.shadowRoot!.querySelector('.element[data-id="img-1"] img');
    expect(canvasImg).toBeNull();
    el.remove();
  });

  it('이미지를 고른 요소는 패널과 캔버스에 그 이미지를 보여준다', async () => {
    const el = await mountImages([PNG_A]);
    selectElement(el, 'img-1');
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.image-current img')?.getAttribute('src')).toBe(PNG_A);
    expect(el.shadowRoot!.querySelector('.element[data-id="img-1"] img')?.getAttribute('src'))
      .toBe(PNG_A);
    el.remove();
  });

  it('이미 등록된 이미지를 골라 다른 요소에 다시 쓴다', async () => {
    const el = await mountImages([PNG_A, PLACEHOLDER]);
    selectElement(el, 'img-2');
    await el.updateComplete;

    openImageButton(el).click();
    await el.updateComplete;

    const choices = Array.from(el.shadowRoot!.querySelectorAll('.image-choice'));
    // 자리표시는 제외하고 업로드한 이미지만 목록에 표시한다.
    expect(choices.length).toBe(1);
    (choices[0] as HTMLButtonElement).click();
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect((file.template.pages[0]!.elements[1] as { src: string }).src).toBe(PNG_A);
    // 고르면 모달이 닫힌다
    expect(el.shadowRoot!.querySelector('.image-choice')).toBeNull();
    el.remove();
  });

  it('넣을 수 있는 최대 크기를 안내하고 호스트가 바꿀 수 있다', async () => {
    const el = await mountImages([PLACEHOLDER]);
    el.maxImageBytes = 512 * 1024;
    selectElement(el, 'img-1');
    await el.updateComplete;

    openImageButton(el).click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain('512KB');
    el.remove();
  });

  it('기본 최대 크기는 2MB다', async () => {
    const el = await mountImages([PLACEHOLDER]);
    expect(el.maxImageBytes).toBe(2 * 1024 * 1024);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 그리드 편집 2단계
// ---------------------------------------------------------------------------

describe('<slip-designer> 그리드 편집 (ADR-037)', () => {
  const PX = 96 / 25.4;
  const s = strings.designer;

  /** 헤더 1행 + 반복 1행 + 꼬리 1행, 행 10mm·열 30mm짜리 그리드 하나만 둔 양식 */
  function makeGridElementFile(): SlipTemplateFile {
    return {
      schemaVersion: '0.1.0',
      kind: 'template',
      template: {
        meta: { title: '그리드' },
        paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
        pages: [{
          elements: [{
            type: 'grid' as const,
            id: 'g-1',
            name: 'test-grid',
            position: { x: 10, y: 10 },
            width: 60,
            height: 60,
            columns: [{ width: 30 }, { width: 30 }],
            rows: [{ height: 10 }, { height: 10 }, { height: 10 }],
            repeat: {
              parameter: 'items',
              bands: [
                { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
                { id: 'b-tail', fromRow: 2, toRow: 2, placement: 'after-data' },
              ],
              pagination: { mode: 'fixed', itemsPerPage: 4 },
            },
            cells: [
              { row: 0, column: 0, content: '품명' },
              { row: 1, column: 0, parameter: '품명' },
            ],
          }],
          assets: [],
        }],
        assets: [],
        sampleValues: { items: [{ 품명: '사과' }, { 품명: '배' }] },
      },
    } as unknown as SlipTemplateFile;
  }

  async function mount() {
    parseSlipFileMock.mockReturnValue(makeGridElementFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;
    return el;
  }

  type TestGrid = {
    columns: { width: number }[];
    rows: { height: number }[];
    repeat?: {
      parameter: string;
      bands: {
        id: string;
        fromRow: number;
        toRow: number;
        placement: string;
        name?: string;
        pages?: string;
      }[];
      pagination: { mode: 'auto'; minItems: number } | { mode: 'fixed'; itemsPerPage: number };
      maxItems?: number;
      groupBy?: string[];
    };
    overflow?: string;
    cells: {
      row: number;
      column: number;
      name?: string;
      content?: string;
      parameter?: string;
      formula?: string;
      rowSpan?: number;
      overflow?: string;
    }[];
  };

  function gridOf(el: Element): TestGrid {
    return (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as unknown as TestGrid;
  }

  function row(el: Element, label: string): Element {
    const found = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!found) throw new Error(`패널 줄을 찾지 못했습니다: ${label}`);
    return found;
  }

  function setNumber(el: Element, label: string, value: string): void {
    const input = row(el, label).querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** 그리드 안 mm 좌표를 눌러 셀을 고른다 (선택된 요소 재클릭) */
  async function clickCell(el: Element, mmX: number, mmY: number) {
    const div = el.shadowRoot!.querySelector('[data-id="g-1"]') as HTMLElement;
    for (const type of ['pointerdown', 'pointerup']) {
      div.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, clientX: mmX * PX, clientY: mmY * PX, pointerId: 1,
      }));
    }
    await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  }

  it('툴바에서 그리드를 만들면 반복 설정이 없는 정적 그리드로 생긴다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, s.addGrid);

    const elements = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
    const created = elements[elements.length - 1] as unknown as TestGrid & { type: string };
    expect(created.type).toBe('grid');
    // 새 그리드는 정적 그리드다 — 반복은 사용자가 켠다 (§7.1)
    expect(created.repeat).toBeUndefined();
    expect(created.rows.length).toBe(3);
    expect(created.columns.length).toBe(3);
    el.remove();
  });

  it('선택하지 않은 반복 그리드는 출력 페이지 계획대로 항목 인스턴스가 펼쳐져 보인다', async () => {
    parseSlipFileMock.mockReturnValue(makeGridElementFile() as unknown as SlipFile);
    const el = await loadDesigner();
    // 헤더 1 + 항목 4 + 꼬리 1 = 6줄
    const preview = el.shadowRoot!.querySelector('[data-id="g-1"] .grid-preview') as HTMLElement;
    expect(preview.style.gridTemplateRows.split(' ').length).toBe(6);
    el.remove();
  });

  it('선택한 반복 그리드는 원본 행 구조와 행 번호 선택 영역을 보여준다', async () => {
    const el = await mount();
    const preview = el.shadowRoot!.querySelector('[data-id="g-1"] .grid-preview') as HTMLElement;
    expect(preview.style.gridTemplateRows.split(' ').length).toBe(3);
    // 행 구간 선택 영역이 행 수만큼 나온다 (§7.2)
    const grid = el.shadowRoot!.querySelector('[data-id="g-1"]') as HTMLElement;
    const strip = grid.querySelector('.band-strip') as HTMLElement;
    expect(strip.querySelectorAll('.band-row').length).toBe(3);
    // 행 선택 영역은 요소 바깥에 있어도 잘리지 않고 포인터 입력을 받는다.
    expect(getComputedStyle(grid).overflow).toBe('visible');
    expect(getComputedStyle(strip).pointerEvents).toBe('auto');
    el.remove();
  });

  it('페이지 계획 오류에서 문제가 있는 요소와 행 구간으로 이동한다', async () => {
    const file = makeGridElementFile();
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.rows[1]!.height = 100;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const canvasError = el.shadowRoot!.querySelector('.plan-error') as HTMLElement;
    expect(canvasError.getAttribute('role')).toBe('alert');
    const move = canvasError.querySelector('button') as HTMLButtonElement;
    move.click();
    await el.updateComplete;

    expect((el as unknown as { _selectedId: string | null })._selectedId).toBe('g-1');
    expect((el as unknown as { _bandSelect: { from: number; to: number } | null })._bandSelect)
      .toEqual({ from: 1, to: 1 });
    expect(el.shadowRoot!.querySelector('[data-id="g-1"]')?.classList.contains('layout-error')).toBe(true);
    const band = el.shadowRoot!.querySelector('[data-band-id="b-item"]') as HTMLElement;
    expect(band.classList.contains('layout-error')).toBe(true);
    const message = canvasError.querySelector('span')!.textContent!.replace(`${s.planError}: `, '');
    expect(band.querySelector('.band-plan-error')?.textContent?.trim()).toBe(message);
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.remove();
  });

  it('선택한 반복 그리드도 출력 결과 보기에서 페이지별 헤더와 소계를 확인한다', async () => {
    const file = makeGridElementFile();
    file.template.sampleValues = {
      items: Array.from({ length: 5 }, (_, index) => ({ 품명: `항목 ${index + 1}` })),
    };
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.repeat!.pagination = { mode: 'fixed', itemsPerPage: 2 };
    grid.rows.push({ height: 10 });
    grid.repeat!.bands.push({
      id: 'b-page-total', fromRow: 3, toRow: 3, placement: 'page-end',
      name: '페이지 소계', pages: 'non-final',
    });
    grid.cells.push({ row: 3, column: 0, content: '페이지 소계' });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const toggle = el.shadowRoot!.querySelector('.output-preview-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.closest('.canvas-stack')).not.toBeNull();
    expect(toggle.closest('.paper-wrap')).toBeNull();
    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect((el as unknown as { _selectedId: string | null })._selectedId).toBe('g-1');
    toggle.click();
    await el.updateComplete;

    const activeToggle = el.shadowRoot!.querySelector('.output-preview-toggle') as HTMLButtonElement;
    expect(activeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-id="g-1"]')?.textContent).toContain('페이지 소계');

    const next = el.shadowRoot!.querySelector('.output-page-next') as HTMLButtonElement;
    next.click();
    await el.updateComplete;
    next.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.output-page-status')?.textContent).toContain('3 / 3');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"]')?.textContent).not.toContain('페이지 소계');

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect((el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements)
      .toHaveLength(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.output-preview-toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).not.toBeNull();
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.remove();
  });

  it('행 역할 메뉴는 포커스를 받고 방향키와 Escape로 조작된다', async () => {
    const el = await mount();
    const rowButton = el.shadowRoot!.querySelector('[data-id="g-1"] .band-row') as HTMLButtonElement;
    rowButton.click();
    await el.updateComplete;

    const items = Array.from(el.shadowRoot!.querySelectorAll('.band-menu-item')) as HTMLButtonElement[];
    expect(el.shadowRoot!.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    expect(el.shadowRoot!.activeElement).toBe(items[1]);
    items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.band-menu')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(rowButton);
    rowButton.blur();
    el.remove();
  });

  it('행 표시 방식은 적용 범위와 대표 용도를 선택 전에 설명한다', async () => {
    const el = await mount();
    const rowButton = el.shadowRoot!.querySelector('[data-id="g-1"] .band-row') as HTMLButtonElement;
    rowButton.click();
    await el.updateComplete;

    const once = el.shadowRoot!.querySelector('.band-menu-item.placement-before-data') as HTMLButtonElement;
    expect(once.querySelector('.band-menu-label')?.textContent?.trim()).toBe(s.bandBeforeData);
    expect(once.querySelector('.band-menu-description')?.textContent?.trim()).toBe(s.bandBeforeDataHelp);

    const perPage = el.shadowRoot!.querySelector('.band-menu-item.placement-page-start') as HTMLButtonElement;
    expect(perPage.querySelector('.band-menu-label')?.textContent?.trim()).toBe(s.bandPageStart);
    expect(perPage.querySelector('.band-menu-description')?.textContent?.trim()).toBe(s.bandPageStartHelp);
    expect(Array.from(el.shadowRoot!.querySelectorAll('.band-menu-label'))
      .map((label) => label.textContent?.trim())).toEqual([
      s.bandBeforeData,
      s.bandPageStart,
      s.bandGroupStart,
      s.bandItem,
      s.bandGroupEnd,
      s.bandAfterData,
      s.bandPageEnd,
    ]);

    rowButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    const cancel = Array.from(el.shadowRoot!.querySelectorAll('.band-menu-item'))
      .find((button) => button.textContent?.trim() === s.cancel) as HTMLButtonElement;
    cancel.click();
    await el.updateComplete;

    const addRow = row(el, s.addRow).querySelector('.list-select') as HTMLButtonElement;
    addRow.click();
    await el.updateComplete;
    const option = el.shadowRoot!.querySelector(
      '.list-select-menu button[data-value="after-data"]',
    ) as HTMLButtonElement;
    expect(option.querySelector('.list-select-option-label')?.textContent?.trim()).toBe(s.bandAfterData);
    expect(option.querySelector('.list-select-option-description')?.textContent?.trim())
      .toBe(s.bandAfterDataHelp);
    el.remove();
  });

  it('셀을 편집하는 동안에는 행 역할 선택 영역을 감춘다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip')).toBeNull();
    expect(el.shadowRoot!.querySelector('.grid-back')).not.toBeNull();
    el.remove();
  });

  it('항목 인스턴스는 샘플 값으로 채워 보이고, 빈 항목은 값 이름을 표시하지 않는다', async () => {
    parseSlipFileMock.mockReturnValue(makeGridElementFile() as unknown as SlipFile);
    const el = await loadDesigner();
    const texts = Array.from(el.shadowRoot!.querySelectorAll('[data-id="g-1"] .grid-preview > div'))
      .map((d) => d.textContent?.trim() ?? '')
      .filter(Boolean);
    expect(texts).toContain('품명');
    expect(texts).toContain('사과');
    expect(texts).toContain('배');
    // 샘플이 2건뿐이라 남는 2벌은 빈 항목이다 — 값 이름을 출력값처럼 표시하지 않는다 (§7.5)
    expect(texts).not.toContain('{품명}');
    el.remove();
  });

  it('반복 그리드에 행을 더할 때 편입할 역할을 먼저 고른다', async () => {
    const el = await mount();
    expect(row(el, s.rows).querySelectorAll('button')).toHaveLength(2);
    const addRow = row(el, 'Add row').querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, addRow, 'page-end');

    const after = gridOf(el);
    expect(after.rows.length).toBe(4);
    expect(after.rows.map((r) => r.height)).toEqual([10, 10, 10, 10]);
    expect(after.repeat!.bands.at(-1)).toMatchObject({ fromRow: 3, toRow: 3, placement: 'page-end' });
    el.remove();
  });

  it('헤더 명령은 추가 결과를 보여 준 뒤 항목 행의 필드 이름으로 행을 만든다', async () => {
    const el = await mount();
    const beforeRows = gridOf(el).rows.length;
    (el.shadowRoot!.querySelector('[data-grid-command="header"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.grid-command-editor') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.textContent).toContain(s.gridCommandPreview);
    expect(gridOf(el).rows).toHaveLength(beforeRows);

    (editor.querySelector('.primary') as HTMLButtonElement).click();
    await el.updateComplete;
    const grid = gridOf(el);
    expect(grid.rows).toHaveLength(beforeRows + 1);
    expect(grid.repeat!.bands).toContainEqual(expect.objectContaining({
      placement: 'page-start',
      name: s.gridCommandHeaderName,
    }));
    expect(grid.cells).toContainEqual(expect.objectContaining({ row: 1, column: 0, content: '품명' }));
    expect(() => validateSlipFile(
      (el as unknown as { _file: SlipTemplateFile })._file,
    )).not.toThrow();
    el.remove();
  });

  it('그룹 소계는 그룹 기준이 없으면 적용하지 않고 필요한 설정을 알린다', async () => {
    const el = await mount();
    (el.shadowRoot!.querySelector('[data-grid-command="group-subtotal"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.grid-command-editor') as HTMLElement;
    expect(editor.textContent).toContain(s.gridCommandGroupRequired);
    expect((editor.querySelector('.primary') as HTMLButtonElement).disabled).toBe(true);
    expect(gridOf(el).rows).toHaveLength(3);
    el.remove();
  });

  it('소계의 기본 필드는 항목 영역의 가장 오른쪽 숫자 필드로 고른다', async () => {
    const file = makeGridElementFile();
    file.template.parameters = [{
      key: 'items', valueType: 'list',
      fields: [
        { key: '수량', label: 'Qty', valueType: 'number' },
        { key: '금액', label: 'Amount', valueType: 'number' },
      ],
    }];
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.cells.find((cell) => cell.row === 1 && cell.column === 0)!.parameter = '수량';
    grid.cells.push({ row: 1, column: 1, parameter: '금액' });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    (el.shadowRoot!.querySelector('[data-grid-command="page-subtotal"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.grid-command-editor .list-select')?.textContent?.trim()).toBe('Amount');
    el.remove();
  });

  it.each([
    ['group-subtotal', 'group-end', undefined, '@group', 'gridCommandGroupSubtotalName'],
    ['page-subtotal', 'page-end', 'non-final', '@page', 'gridCommandPageSubtotalName'],
    ['final-total', 'after-data', undefined, '@all', 'gridCommandFinalTotalName'],
  ] as const)(
    '%s 명령은 고른 숫자 필드와 적절한 집계 범위로 행을 만든다',
    async (command, placement, pages, scope, nameKey) => {
      const file = makeGridElementFile();
      file.template.parameters = [{
        key: 'items', label: 'Items', valueType: 'list',
        fields: [
          { key: '분류', label: 'Category', valueType: 'text' },
          { key: '금액', label: 'Amount', valueType: 'number' },
        ],
      }];
      file.template.sampleValues = {
        items: [{ '분류': 'A', '금액': 10 }, { '분류': 'A', '금액': 20 }],
      };
      const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
      grid.cells.push({ row: 1, column: 1, parameter: '금액' });
      if (command === 'group-subtotal') grid.repeat!.groupBy = ['분류'];
      parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
      const el = await loadDesigner();
      selectElement(el, 'g-1');
      await el.updateComplete;

      (el.shadowRoot!.querySelector(`[data-grid-command="${command}"]`) as HTMLButtonElement).click();
      await el.updateComplete;
      const editor = el.shadowRoot!.querySelector('.grid-command-editor') as HTMLElement;
      expect(editor.textContent).toContain('Amount');
      expect(gridOf(el).rows).toHaveLength(3);

      (editor.querySelector('.primary') as HTMLButtonElement).click();
      await el.updateComplete;
      const after = gridOf(el);
      const name = s[nameKey];
      const addedBand = after.repeat!.bands.find((band) => band.name === name);
      expect(addedBand).toEqual(expect.objectContaining({ placement, name }));
      if (pages === undefined) expect(addedBand).not.toHaveProperty('pages');
      else expect(addedBand?.pages).toBe(pages);
      expect(after.cells).toContainEqual(expect.objectContaining({
        column: 1,
        formula: `SUM(${scope}.금액)`,
      }));
      if (command === 'page-subtotal') {
        const canvasText = el.shadowRoot!.querySelector('[data-id="g-1"] .grid-preview')?.textContent ?? '';
        expect(canvasText).toContain('30');
        expect(canvasText).not.toContain(`SUM(${scope}.금액)`);
      }
      expect(() => validateSlipFile(
        (el as unknown as { _file: SlipTemplateFile })._file,
      )).not.toThrow();
      el.remove();
    },
  );

  it('행 높이·열 너비를 mm로 고치면 그 트랙만 바뀐다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25); // 항목 구간 행 (요소 y=10, 행 10mm)
    await el.updateComplete;

    setNumber(el, s.rowHeight, '20');
    await el.updateComplete;
    expect(gridOf(el).rows.map((r) => r.height)).toEqual([10, 20, 10]);

    setNumber(el, s.columnWidth, '50');
    await el.updateComplete;
    expect(gridOf(el).columns.map((c) => c.width)).toEqual([50, 30]);
    el.remove();
  });

  it('반복을 끄면 사라지고, 다시 켜면 고른 행이 항목 구간이 된다', async () => {
    const el = await mount();
    const toggle = row(el, s.repeatOn).querySelector('input') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat).toBeUndefined();

    const on = row(el, s.repeatOn).querySelector('input') as HTMLInputElement;
    on.checked = true;
    on.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const repeat = gridOf(el).repeat!;
    // 항목 구간 하나와 자동 확장 방식으로 시작한다 — perPage를 임의로 지정하지 않는다 (§7.1)
    expect(repeat.bands.filter((b) => b.placement === 'item').length).toBe(1);
    expect(repeat.pagination).toEqual({ mode: 'auto', minItems: 0 });
    el.remove();
  });

  it('행 번호 선택 영역에서 역할 명령으로 행 구간을 바꾼다 (§7.2)', async () => {
    const el = await mount();
    // 첫 행을 눌러 역할 메뉴를 연다
    const stripRow = el.shadowRoot!.querySelector('[data-id="g-1"] .band-strip .band-row') as HTMLButtonElement;
    stripRow.click();
    await el.updateComplete;
    const menu = el.shadowRoot!.querySelector('.band-menu');
    expect(menu).not.toBeNull();

    // 첫 행을 데이터 반복 영역으로 지정하면 기존 항목 행은 아래 역할로 흡수된다
    const command = menu!.querySelector('.band-menu-item.placement-item') as HTMLButtonElement;
    command.click();
    await el.updateComplete;

    const bands = gridOf(el).repeat!.bands;
    expect(bands[0]).toMatchObject({ fromRow: 0, toRow: 0, placement: 'item' });
    expect(bands.filter((b) => b.placement === 'item').length).toBe(1);
    el.remove();
  });

  it('속성 패널에서 고른 행 구간의 역할을 바꾼다', async () => {
    const el = await mount();
    const lastBand = el.shadowRoot!.querySelector('[data-band-id="b-tail"] .band-item-main') as HTMLButtonElement;
    lastBand.click();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.band-editor') as HTMLElement;
    await pickListValue(el, editor.querySelector('.list-select') as HTMLButtonElement, 'page-end');
    expect(gridOf(el).repeat!.bands.at(-1)).toMatchObject({ fromRow: 2, toRow: 2, placement: 'page-end' });
    el.remove();
  });

  it('행 구간의 종료 행을 바꾸면 실제 구간 경계에 즉시 반영한다', async () => {
    const el = await mount();
    const itemBand = el.shadowRoot!.querySelector('[data-band-id="b-item"] .band-item-main') as HTMLButtonElement;
    itemBand.click();
    await el.updateComplete;

    let editor = el.shadowRoot!.querySelector('.band-editor') as HTMLElement;
    let to = editor.querySelector(`[aria-label="${s.bandToRow}"]`) as HTMLInputElement;
    to.value = '3';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat!.bands.find((band) => band.id === 'b-item'))
      .toMatchObject({ fromRow: 1, toRow: 2, placement: 'item' });
    expect((el as unknown as { _bandSelect: { from: number; to: number } })._bandSelect)
      .toEqual({ from: 1, to: 2 });

    editor = el.shadowRoot!.querySelector('.band-editor') as HTMLElement;
    to = editor.querySelector(`[aria-label="${s.bandToRow}"]`) as HTMLInputElement;
    to.value = '2';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat!.bands.find((band) => band.id === 'b-item'))
      .toMatchObject({ fromRow: 1, toRow: 1, placement: 'item' });
    expect(gridOf(el).repeat!.bands.at(-1))
      .toMatchObject({ fromRow: 2, toRow: 2, placement: 'after-data' });
    el.remove();
  });

  it('종료 행 변경으로 병합 셀이 구간 경계를 넘으면 적용하지 않는다', async () => {
    const file = makeGridElementFile();
    const grid = file.template.pages[0]!.elements[0] as unknown as TestGrid;
    grid.repeat!.bands = [
      { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
      { id: 'b-item', fromRow: 1, toRow: 2, placement: 'item' },
    ];
    grid.cells.push({ row: 1, column: 1, rowSpan: 2, content: '병합' });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const itemBand = el.shadowRoot!.querySelector('[data-band-id="b-item"] .band-item-main') as HTMLButtonElement;
    itemBand.click();
    await el.updateComplete;
    const to = el.shadowRoot!.querySelector(`[aria-label="${s.bandToRow}"]`) as HTMLInputElement;
    to.value = '2';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(gridOf(el).repeat!.bands.find((band) => band.id === 'b-item'))
      .toMatchObject({ fromRow: 1, toRow: 2, placement: 'item' });
    expect(el.shadowRoot!.querySelector('#error-band-range')?.textContent?.trim()).toBe(s.repeatMergeError);
    expect(to.getAttribute('aria-invalid')).toBe('true');
    el.remove();
  });

  it('페이지 방식 세그먼트로 자동 확장과 고정 페이지를 전환한다 (§7.3)', async () => {
    const el = await mount();
    // 고정 페이지 상태 — 페이지당 항목 수만 보인다
    const labels = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    expect(labels()).toContain(s.itemsPerPage);
    expect(labels()).not.toContain(s.minItems);

    setNumber(el, s.itemsPerPage, '6');
    await el.updateComplete;
    expect(gridOf(el).repeat?.pagination).toEqual({ mode: 'fixed', itemsPerPage: 6 });

    // 자동 확장으로 전환하면 최소 표시 항목 수만 보인다
    const auto = Array.from(el.shadowRoot!.querySelectorAll('.segment button'))
      .find((b) => b.textContent?.trim() === s.paginationAuto) as HTMLButtonElement;
    auto.click();
    await el.updateComplete;
    expect(gridOf(el).repeat?.pagination).toEqual({ mode: 'auto', minItems: 0 });
    expect(labels()).toContain(s.minItems);
    expect(labels()).not.toContain(s.itemsPerPage);

    setNumber(el, s.minItems, '3');
    await el.updateComplete;
    expect(gridOf(el).repeat?.pagination).toEqual({ mode: 'auto', minItems: 3 });
    el.remove();
  });

  it('최대 항목 수와 그룹 기준은 고급 설정에 두고 그룹 기준은 필드 목록에서 고른다', async () => {
    const file = makeGridElementFile();
    file.template.parameters = [{
      key: 'items', label: 'Items', valueType: 'list',
      fields: [
        { key: '품명', label: 'Item name', valueType: 'text' },
        { key: '분류', label: 'Category', valueType: 'text' },
      ],
    }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'g-1');
    await el.updateComplete;

    const advanced = el.shadowRoot!.querySelector('details.advanced-settings') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(row(el, s.repeatMaxItems).closest('details')).toBe(advanced);
    expect(row(el, s.groupBy).querySelector('input[type="text"]')).toBeNull();

    const category = advanced.querySelector('input[data-field="분류"]') as HTMLInputElement;
    category.checked = true;
    category.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(gridOf(el).repeat?.groupBy).toEqual(['분류']);
    el.remove();
  });

  it('maxItems는 페이지당 항목 수보다 작아도 받아들인다', async () => {
    const el = await mount();
    setNumber(el, s.repeatMaxItems, '2');
    await el.updateComplete;
    // 페이지당 항목 수(4)보다 작은 최대 항목 수를 허용한다 (§5.5)
    expect(gridOf(el).repeat?.maxItems).toBe(2);
    el.remove();
  });

  it('칸에 담을 것을 고르면 나머지 둘은 지워진다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25);
    await el.updateComplete;

    await pickListValue(el, row(el, s.cellSource).querySelector('.list-select') as HTMLButtonElement, 'formula');

    const input = row(el, s.formula).querySelector('input') as HTMLInputElement;
    input.value = 'SUM(items.금액)';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 1 && c.column === 0)!;
    expect(cell.formula).toBe('SUM(items.금액)');
    expect(cell.parameter).toBeUndefined();
    expect(cell.content).toBeUndefined();
    el.remove();
  });

  it('선택한 그리드에서 행을 누르면 그 원본 행의 칸이 골라진다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25); // 항목 구간 행 (y 20~30)
    const item = (el as unknown as { _selectedCell: { row: number; column: number } })._selectedCell;
    await clickCell(el, 15, 35); // 꼬리 행 (y 30~40)
    const tail = (el as unknown as { _selectedCell: { row: number; column: number } })._selectedCell;
    expect(item).toEqual({ row: 1, column: 0 });
    expect(tail).toEqual({ row: 2, column: 0 });
    el.remove();
  });

  it('행 구간 경계를 넘는 병합은 받아들이지 않는다', async () => {
    const el = await mount();
    await clickCell(el, 15, 15); // 헤더 행 (y 10~20)
    await el.updateComplete;
    const merge = el.shadowRoot!.querySelector(`[aria-label="${s.merge} ${s.rows}"]`) as HTMLInputElement;
    merge.value = '2';
    merge.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const cell = gridOf(el).cells.find((c) => c.row === 0 && c.column === 0)!;
    expect(cell.rowSpan).toBeUndefined();
    el.remove();
  });

  it('그리드의 긴 내용 표시 기본값은 텍스트 섹션에서 바꿀 수 있다', async () => {
    const el = await mount();
    const overflowRow = row(el, s.overflow);
    expect(overflowRow.closest('.prop-section')?.querySelector('.prop-section-title')?.textContent?.trim())
      .toBe(s.styleText);
    await pickListValue(el, overflowRow.querySelector('.list-select') as HTMLButtonElement, 'shrink');
    expect(gridOf(el).overflow).toBe('shrink');
    el.remove();
  });

  it('선택 셀은 그리드의 긴 내용 표시 설정을 따르거나 별도로 덮어쓸 수 있다', async () => {
    const el = await mount();
    await clickCell(el, 15, 25);
    await el.updateComplete;

    const overflowSelect = () => row(el, s.overflow).querySelector('.list-select') as HTMLButtonElement;
    expect(overflowSelect().getAttribute('data-value')).toBe('inherit');

    await pickListValue(el, overflowSelect(), 'shrink');
    expect(gridOf(el).cells.find((cell) => cell.row === 1 && cell.column === 0)?.overflow).toBe('shrink');

    await pickListValue(el, overflowSelect(), 'inherit');
    expect(gridOf(el).cells.find((cell) => cell.row === 1 && cell.column === 0)?.overflow).toBeUndefined();
    el.remove();
  });

  it('그리드가 쓰는 값은 사이드바에, 반복 구간 칸의 항목 필드는 그 하위 줄에 나온다', async () => {
    const el = await mount();
    const labels = Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
      .map((r) => r.textContent?.trim() ?? '');
    expect(labels.some((l) => l.includes('items'))).toBe(true);
    // 반복 구간의 칸은 목록 항목의 필드로 표시한다.
    expect(Array.from(el.shadowRoot!.querySelectorAll('.side-col-row'))
      .map((r) => r.textContent?.trim())).toEqual(['품명']);
    el.remove();
  });

  it('인라인 칸 편집 상자는 칸의 배경색을 그대로 쓴다 (편집 중 색이 사라지지 않게)', async () => {
    const el = await mount();
    // 칸에 배경색을 준 뒤 그 칸을 두 번 눌러 인라인 편집을 연다
    (el as unknown as { _selectedCell: { row: number; column: number } | null })._selectedCell =
      { row: 0, column: 0 };
    (el as unknown as { _updateCellStyle: (k: string, v: unknown) => void })
      ._updateCellStyle('backgroundColor', '#ffeeaa');
    await el.updateComplete;
    (el as unknown as { _cellEditing: boolean })._cellEditing = true;
    (el as unknown as { requestUpdate: () => void }).requestUpdate();
    await el.updateComplete;

    const editor = el.shadowRoot!.querySelector('.cell-editor') as HTMLInputElement;
    expect(editor).not.toBeNull();
    expect(editor.getAttribute('style')).toContain('background:#ffeeaa');
    el.remove();
  });

  it('셀 파라미터를 포커스 이동 없이 연달아 바꿔도 매번 반영된다 (Lit select 회귀)', async () => {
    const el = await mount();
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      f.template.parameters = [{
        key: 'items', valueType: 'list',
        fields: [{ key: '품명' }, { key: '수량' }, { key: '단가' }],
      }];
    });
    await el.updateComplete;
    await clickCell(el, 15, 25);
    await el.updateComplete;

    const sel = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === s.parameter)!
      .querySelector('.list-select') as HTMLButtonElement;
    const cellParameter = () => gridOf(el).cells.find((c) => c.row === 1 && c.column === 0)?.parameter;

    for (const value of ['수량', '단가', '품명']) {
      await pickListValue(el, sel(), value);
      expect(cellParameter()).toBe(value);
      expect(sel().getAttribute('data-value')).toBe(value);
    }
    el.remove();
  });

  it('그리드 칸을 고르면 그리드 자체 옵션은 감추고 그리드로 돌아가는 줄을 보인다 (ADR-034)', async () => {
    const el = await mount();
    // 칸을 고르기 전에는 그리드 옵션(행 수)이 보인다
    const labels = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row label'))
      .map((l) => l.textContent?.trim());
    expect(labels()).toContain(s.rows);

    await clickCell(el, 15, 25);
    await el.updateComplete;
    // 칸을 고르면 그리드 옵션은 사라지고 칸 편집만 남는다
    expect(labels()).not.toContain(s.rows);
    expect(labels()).toContain(s.merge);
    // 그리드로 돌아갈 수 있다
    const back = el.shadowRoot!.querySelector('.grid-back') as HTMLButtonElement;
    expect(back).not.toBeNull();
    expect(back.textContent).toContain(s.gridBack);
    expect(back.getAttribute('aria-label')).toContain(s.gridBack);
    back.click();
    await el.updateComplete;
    expect(labels()).toContain(s.rows);
    el.remove();
  });

  it('요소 목록에서 그리드를 펼치면 이름·값·수식 칸이 나오고 누르면 그 칸이 선택된다 (G-44)', async () => {
    const el = await mount(); // 그리드를 고르면 요소 목록에서도 저절로 펼쳐진다
    const cellRows = () => Array.from(el.shadowRoot!.querySelectorAll('.side-cell-row'));
    // 이름이 없는 직접 입력 칸은 제외하고 파라미터가 지정된 칸을 표시한다.
    expect(cellRows().length).toBe(1);
    // 이름이 없는 칸은 좌표를 표시한다 — 헤더나 파라미터에서 이름을 자동으로 만들지 않는다 (§7.4)
    expect(cellRows()[0]!.textContent?.trim()).toBe('Row 2, Col 1');
    expect(cellRows()[0]!.getAttribute('title')).toContain('Row 2'); // 2행 1열

    // 셀 이름을 지정하면 목록에 그 이름을 우선 표시한다
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      const grid = f.template.pages[0]!.elements[0]! as unknown as TestGrid;
      grid.cells.find((c) => c.row === 1 && c.column === 0)!.name = '품명 칸';
    });
    await el.updateComplete;
    expect(cellRows()[0]!.textContent?.trim()).toBe('품명 칸');

    // 직접 입력 칸도 이름을 지정하면 요소 목록에서 다시 찾을 수 있다.
    (el as unknown as { _updateFile: (fn: (f: SlipTemplateFile) => void) => void })._updateFile((f) => {
      const grid = f.template.pages[0]!.elements[0]! as unknown as TestGrid;
      grid.cells.find((c) => c.row === 0 && c.column === 0)!.name = '품명 머리글';
    });
    await el.updateComplete;
    expect(cellRows().map((item) => item.textContent?.trim())).toEqual(['품명 머리글', '품명 칸']);

    // 하위 줄을 누르면 그 칸이 선택된다
    (cellRows()[1] as HTMLElement).click();
    await el.updateComplete;
    const sel = (el as unknown as { _selectedCell: { row: number; column: number } | null })._selectedCell;
    expect(sel).toEqual({ row: 1, column: 0 });
    el.remove();
  });

  it('요소 목록의 그리드 하위 줄은 펼침 표시로 접을 수 있다 (G-44)', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelectorAll('.side-cell-row').length).toBe(1);
    // 요소 목록 그리드 줄의 펼침 표시를 눌러 접는다
    const twisty = Array.from(el.shadowRoot!.querySelectorAll('.side-twisty'))
      .find((b) => b.getAttribute('aria-label')?.startsWith('test-grid')) as HTMLButtonElement;
    twisty.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-cell-row').length).toBe(0);
    el.remove();
  });
});

describe('<slip-designer> 변동 이미지 (G-47)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  function templateWithImage(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements.push({
      type: 'image' as const, id: 'img-1', name: '로고',
      position: { x: 120, y: 20 }, width: 30, height: 20,
      src: 'data:image/png;base64,AAAA',
    } as never);
    return file;
  }

  const imageEl = (el: Element) =>
    (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.find((e) => e.id === 'img-1') as never as Record<string, unknown>;

  it('이미지를 변동으로 바꾸면 값이 생기고 src가 빠진다 (되돌리면 반대)', async () => {
    parseSlipFileMock.mockReturnValue(templateWithImage() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'img-1');
    await el.updateComplete;

    // 변동 이미지로 전환하면 parameter와 valueType을 설정하고 src를 제거한다.
    byAria(el, strings.designer.imageMode);
    const toVariable = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group button'))
      .find((b) => b.textContent?.trim() === strings.designer.imageVariable) as HTMLButtonElement;
    toVariable.click();
    await el.updateComplete;
    expect(typeof imageEl(el).parameter).toBe('string');
    expect(imageEl(el).src).toBeUndefined();
    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters ?? [];
    const def = defs.find((b) => b.key === imageEl(el).parameter);
    expect(def?.valueType).toBe('image');

    // 고정 이미지로 전환하면 parameter를 제거하고 src를 복원한다.
    const toFixed = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group button'))
      .find((b) => b.textContent?.trim() === strings.designer.imageFixed) as HTMLButtonElement;
    toFixed.click();
    await el.updateComplete;
    expect(imageEl(el).parameter).toBeUndefined();
    expect(typeof imageEl(el).src).toBe('string');
    el.remove();
  });

  it('변동 이미지 값은 샘플 데이터 모달에서 이미지 업로드 입력으로 나온다', async () => {
    const file = templateWithImage();
    const img = file.template.pages[0]!.elements.find((e) => e.id === 'img-1') as never as Record<string, unknown>;
    delete img.src;
    img.parameter = 'stamp';
    file.template.parameters = [{ key: 'stamp', label: '도장', valueType: 'image' }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 사이드바 샘플 데이터 버튼으로 모달을 연다
    byAria(el, strings.designer.sampleData).click();
    await el.updateComplete;

    // 이미지 파라미터에는 업로드 버튼이 나오고 한 줄 텍스트 입력은 없다
    const pick = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === `도장 ${strings.designer.imagePick}`);
    expect(pick).toBeTruthy();
    const textInput = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.sampleData} stamp`);
    expect(textInput).toBeUndefined();
    el.remove();
  });
});

describe('<slip-designer> 바코드 요소 (G-33)', () => {
  const lastElement = (el: Element) => {
    const els = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
    return els[els.length - 1] as never as Record<string, unknown>;
  };
  const selectEl = (el: HTMLElement, id: string) => selectElement(el, id);

  it('바코드 도구로 만들면 qrcode·파라미터로 생성된다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addBarcode);
    const bc = lastElement(el);
    expect(bc.type).toBe('barcode');
    expect(bc.kind).toBe('qrcode');
    expect(typeof bc.parameter).toBe('string');
    // 캔버스에 견본(svg)이 그려진다
    expect(el.shadowRoot!.querySelector('.barcode-preview svg')).not.toBeNull();
    el.remove();
  });

  it('종류를 바꾸고 값 소스를 직접 입력으로 바꾼다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addBarcode);
    const bc = lastElement(el);
    selectEl(el, bc.id as string);
    await el.updateComplete;

    // 종류 변경
    const kindTrigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((s) => s.getAttribute('aria-label') === strings.designer.barcodeKind) as HTMLButtonElement;
    await pickListValue(el, kindTrigger, 'ean13');
    expect(lastElement(el).kind).toBe('ean13');

    // 직접 입력으로 전환하면 content를 설정하고 parameter를 제거한다.
    const sourceTrigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((s) => s.getAttribute('aria-label') === strings.designer.barcodeValue) as HTMLButtonElement;
    await pickListValue(el, sourceTrigger, 'content');
    expect(lastElement(el).parameter).toBeUndefined();
    expect(lastElement(el).content).toBe('');

    // 유효하지 않은 EAN-13 값에는 경고를 표시한다.
    const input = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.content)!
      .querySelector('input') as HTMLInputElement;
    input.value = '123';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(lastElement(el).content).toBe('123');
    expect(el.shadowRoot!.querySelector('.image-error')?.textContent).toContain('13');
    el.remove();
  });
});

describe('<slip-designer> 요소 그룹화 (G-27)', () => {
  const elById = (el: Element, id: string) =>
    (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.find((e) => e.id === id) as never as Record<string, unknown>;
  const selectedIds = (el: Element) =>
    (el as unknown as { _selectedIds: Set<string> })._selectedIds;

  function sidebarRow(el: Element, name: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
      .find((r) => r.querySelector('span')?.textContent?.trim() === name) as HTMLButtonElement;
  }
  function panelButton(el: Element, label: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  }
  async function groupBoth(el: import('../src/slip-designer.js').SlipDesigner) {
    sidebarRow(el, 'test-text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'test-shape').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    panelButton(el, strings.designer.groupElements).click();
    await el.updateComplete;
  }

  it('사이드바 Ctrl+클릭으로 여러 요소를 골라 묶으면 같은 그룹이 된다', async () => {
    const el = await loadDesigner();
    sidebarRow(el, 'test-text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'test-shape').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    panelButton(el, strings.designer.groupElements).click();
    await el.updateComplete;
    const g1 = elById(el, 'txt-1').group;
    const g2 = elById(el, 'shp-1').group;
    expect(typeof g1).toBe('string');
    expect(g1).toBe(g2);
    el.remove();
  });

  it('그룹을 복사·붙여넣기하면 사본도 함께 새 그룹으로 묶인다 (G-48)', async () => {
    const el = await loadDesigner();
    await groupBoth(el);
    const origGroup = elById(el, 'txt-1').group;

    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    toolbarButton(el, strings.designer.paste).click();
    await el.updateComplete;

    const elements = changes.at(-1)!.detail.file.template.pages[0].elements;
    // 원본 2개 + 사본 2개
    expect(elements.length).toBe(4);
    const pasted = elements.slice(2);
    expect(pasted[0].group).toBe(pasted[1].group); // 사본끼리 같은 그룹
    expect(pasted[0].group).not.toBe(origGroup); // 원본 그룹과는 다른 새 그룹
    expect(selectedIds(el).size).toBe(2); // 사본 2개가 선택됨
    el.remove();
  });

  it('그룹의 한 요소만 눌러도 그룹 전체가 선택되고 함께 움직인다', async () => {
    const el = await loadDesigner();
    await groupBoth(el);

    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    // txt-1(30,40)을 +5mm/+5mm 끌면 shp-1(100,80)도 같이 움직인다
    const div = el.shadowRoot!.querySelector('[data-id="txt-1"]') as HTMLElement;
    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 5 * PX_PER_MM, clientY: 5 * PX_PER_MM, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(elById(el, 'txt-1').position).toEqual({ x: 35, y: 45 });
    expect(elById(el, 'shp-1').position).toEqual({ x: 105, y: 85 });
    el.remove();
  });

  it('그룹 해제하면 그룹이 사라진다', async () => {
    const el = await loadDesigner();
    await groupBoth(el);
    selectElement(el, 'txt-1');
    await el.updateComplete;
    panelButton(el, strings.designer.ungroupElements).click();
    await el.updateComplete;
    expect(elById(el, 'txt-1').group).toBeUndefined();
    expect(elById(el, 'shp-1').group).toBeUndefined();
    el.remove();
  });

  it('다중 선택 상태에서 Delete로 모두 지운다', async () => {
    const el = await loadDesigner();
    sidebarRow(el, 'test-text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'test-shape').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await el.updateComplete;
    const elements = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
    expect(elements.length).toBe(0);
    el.remove();
  });
});

describe('<slip-designer> 용지 공급·저장 (G-31)', () => {
  const paperSelect = (el: Element): HTMLButtonElement =>
    Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.paperSize)!
      .querySelector('.list-select') as HTMLButtonElement;
  const rowInput = (el: Element, labelText: string): HTMLInputElement =>
    Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === labelText)!
      .querySelector('input') as HTMLInputElement;
  const paper = (el: Element) =>
    (el as unknown as { _file: SlipTemplateFile })._file.template.paper;

  it('settings.getPaperSizes로 준 용지가 고르개에 나오고 고르면 적용된다', async () => {
    const el = await loadDesigner();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    el.settings = { getPaperSizes: () => [{ name: '라벨 100x150', width: 100, height: 150 }] };
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const labels = await listOptionLabels(el, paperSelect(el));
    expect(labels.some((l) => l.includes('라벨 100x150'))).toBe(true);

    // 기본 용지 네 종류 다음에 호스트가 제공한 용지가 표시된다.
    await pickListValue(el, paperSelect(el), '4');
    expect(paper(el).width).toBe(100);
    expect(paper(el).height).toBe(150);
    expect(warn.mock.calls.some(([message]) => String(message).includes('scheduled an update'))).toBe(false);
    warn.mockRestore();
    el.remove();
  });

  it('직접 입력한 크기를 savePaperSize로 보관한다', async () => {
    const saved: { name: string; width: number; height: number }[] = [];
    const el = await loadDesigner();
    el.settings = { savePaperSize: (size) => { saved.push(size); } };
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    // 프리셋에 없는 크기로 바꾸면 "이 크기 저장"이 나타난다
    const widthInput = rowInput(el, strings.designer.width);
    widthInput.value = '123';
    widthInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(paper(el).width).toBe(123);

    const nameInput = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === strings.designer.paperSizeName) as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    nameInput.value = '내 용지';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    const saveBtn = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.paperSaveThis) as HTMLButtonElement;
    saveBtn.click();
    await el.updateComplete;
    await flush();

    expect(saved).toEqual([{ name: '내 용지', width: 123, height: 297 }]);
    el.remove();
  });
});
