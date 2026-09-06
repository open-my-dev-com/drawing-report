// @vitest-environment happy-dom
// 용지 경계 정책, 화살표 키 이동, 복수 선택과 정렬·간격 배치
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
  loadDesigner,
  selectElement,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

type Pos = { x: number; y: number };

function elementsOf(el: Element) {
  return (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
}

function positionOf(el: Element, id: string): Pos {
  const found = elementsOf(el).find((e) => e.id === id)!;
  return { x: found.position.x, y: found.position.y };
}

function selectedIds(el: Element): Set<string> {
  return (el as unknown as { _selectedIds: Set<string> })._selectedIds;
}

function selectedId(el: Element): string | null {
  return (el as unknown as { _selectedId: string | null })._selectedId;
}

function undoDepth(el: Element): number {
  return (el as unknown as { _undoStack: unknown[] })._undoStack.length;
}

function watchChanges(el: Element): CustomEvent[] {
  const changes: CustomEvent[] = [];
  el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
  return changes;
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

function release(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function pointer(target: HTMLElement, type: string, mmX: number, mmY: number, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, composed: true, clientX: mmX * PX_PER_MM, clientY: mmY * PX_PER_MM, pointerId: 1, ...init,
  }));
}

function canvasElement(el: Element, id: string): HTMLElement {
  return el.shadowRoot!.querySelector(`[data-id="${id}"]`) as HTMLElement;
}

/** 요소를 (0,0)에서 눌러 (dx,dy)mm 끌고 놓습니다 */
async function drag(el: Designer, id: string, dx: number, dy: number): Promise<void> {
  const div = canvasElement(el, id);
  pointer(div, 'pointerdown', 0, 0);
  pointer(div, 'pointermove', dx, dy);
  pointer(div, 'pointerup', dx, dy);
  await el.updateComplete;
}

function sidebarRow(el: Element, name: string): HTMLButtonElement {
  return Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
    .find((r) => r.querySelector('span')?.textContent?.trim() === name) as HTMLButtonElement;
}

function panelButton(el: Element, label: string): HTMLButtonElement {
  return Array.from(el.shadowRoot!.querySelectorAll('.prop-panel button'))
    .find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) as HTMLButtonElement;
}

function propInput(el: Element, label: string): HTMLInputElement {
  return el.shadowRoot!.querySelector(`.prop-panel input[aria-label="${label}"]`) as HTMLInputElement;
}

/** 세 개의 사각형(그중 둘은 그룹)과 기본 요소를 가진 양식 */
function makeFile(): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.pages[0]!.elements.push(
    { type: 'rect', id: 'r-a', name: 'rect-a', position: { x: 10, y: 200 }, width: 10, height: 10 } as never,
    { type: 'rect', id: 'r-b', name: 'rect-b', position: { x: 60, y: 210 }, width: 20, height: 10, group: 'grp-1' } as never,
    { type: 'rect', id: 'r-c', name: 'rect-c', position: { x: 90, y: 230 }, width: 10, height: 10, group: 'grp-1' } as never,
    { type: 'rect', id: 'r-d', name: 'rect-d', position: { x: 150, y: 200 }, width: 10, height: 10 } as never,
  );
  return file;
}

async function mount(file: SlipTemplateFile = makeFile()): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
  return loadDesigner();
}

// ---------------------------------------------------------------------------
// 용지 경계 — 이동·크기 조절·좌표 입력
// ---------------------------------------------------------------------------

describe('<slip-designer> 용지 경계 — 이동', () => {
  it('요소 하나를 왼쪽 위로 끌면 0에서 멈추고 오른쪽 아래로는 용지 밖까지 나간다', async () => {
    const el = await mount();
    // txt-1 (30,40)
    await drag(el, 'txt-1', -100, -100);
    expect(positionOf(el, 'txt-1')).toEqual({ x: 0, y: 0 });
    await drag(el, 'txt-1', 300, 400);
    expect(positionOf(el, 'txt-1')).toEqual({ x: 300, y: 400 });
    el.remove();
  });

  it('그룹을 끌어 경계에 닿으면 선택 전체가 같은 양만 움직여 간격이 유지된다', async () => {
    const el = await mount();
    // r-b (60,210), r-c (90,230) — 그룹 grp-1. −100mm 끌면 r-b가 0에 닿는 −60/−210까지만 움직입니다.
    await drag(el, 'r-b', -100, -300);
    expect(positionOf(el, 'r-b')).toEqual({ x: 0, y: 0 });
    expect(positionOf(el, 'r-c')).toEqual({ x: 30, y: 20 });
    el.remove();
  });

  it('여러 요소를 Ctrl+클릭으로 함께 선택해 끌 때도 요소 사이 간격을 유지한다', async () => {
    const el = await mount();
    selectElement(el, 'r-a');
    await el.updateComplete;
    pointer(canvasElement(el, 'r-d'), 'pointerdown', 0, 0, { ctrlKey: true });
    pointer(canvasElement(el, 'r-d'), 'pointerup', 0, 0, { ctrlKey: true });
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a', 'r-d']));

    // r-a (10,200), r-d (150,200): −50/−50 끌면 r-a가 0에 닿는 −10만큼만 가로로 움직입니다.
    await drag(el, 'r-d', -50, -50);
    expect(positionOf(el, 'r-a')).toEqual({ x: 0, y: 150 });
    expect(positionOf(el, 'r-d')).toEqual({ x: 140, y: 150 });
    el.remove();
  });
});

describe('<slip-designer> 용지 경계 — 크기 조절과 좌표 입력', () => {
  it('서쪽·북쪽 핸들은 0에서 멈추고 동쪽·남쪽 핸들은 용지 밖까지 늘어난다', async () => {
    const el = await mount();
    selectElement(el, 'shp-1'); // (100,80) 50×30
    await el.updateComplete;

    const west = el.shadowRoot!.querySelector('.handle-nw') as HTMLElement;
    pointer(west, 'pointerdown', 0, 0);
    pointer(west, 'pointermove', -150, -150);
    pointer(west, 'pointerup', -150, -150);
    await el.updateComplete;
    const shape = elementsOf(el).find((e) => e.id === 'shp-1') as unknown as Record<string, number> & { position: Pos };
    expect(shape.position).toEqual({ x: 0, y: 0 });
    expect(shape.width).toBe(150);
    expect(shape.height).toBe(110);

    const east = el.shadowRoot!.querySelector('.handle-se') as HTMLElement;
    pointer(east, 'pointerdown', 0, 0);
    pointer(east, 'pointermove', 200, 300);
    pointer(east, 'pointerup', 200, 300);
    await el.updateComplete;
    expect(shape.position).toEqual({ x: 0, y: 0 });
    expect(shape.width).toBe(350);
    expect(shape.height).toBe(410);
    el.remove();
  });

  it('X·Y 입력은 음수를 0으로 올리고 용지 오른쪽·아래쪽으로는 자르지 않는다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const x = propInput(el, 'X');
    x.value = '-5';
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(positionOf(el, 'txt-1').x).toBe(0);

    x.value = '500';
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(positionOf(el, 'txt-1').x).toBe(500);

    const y = propInput(el, 'Y');
    y.value = '400';
    y.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(positionOf(el, 'txt-1').y).toBe(400);
    el.remove();
  });

  it('용지를 넘는 좌표는 불러오기와 변경 알림을 거쳐도 그대로 유지된다', async () => {
    const file = makeTemplateFile();
    // x+width = 250 > 210, y+height = 300 > 297
    file.template.pages[0]!.elements[1]!.position = { x: 200, y: 290 };
    const el = await mount(file);
    expect(positionOf(el, 'shp-1')).toEqual({ x: 200, y: 290 });

    selectElement(el, 'txt-1');
    await el.updateComplete;
    const changes = watchChanges(el);
    const name = propInput(el, strings.designer.name);
    name.value = '이름';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const emitted = changes[0]!.detail.file.template.pages[0].elements.find((e: { id: string }) => e.id === 'shp-1');
    expect(emitted.position).toEqual({ x: 200, y: 290 });
    expect(emitted.width).toBe(50);
    el.remove();
  });

  it('용지 밖으로 나간 요소도 캔버스에 그려지고 눌러 선택할 수 있다', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements[1]!.position = { x: 250, y: 320 };
    const el = await mount(file);
    const div = canvasElement(el, 'shp-1');
    expect(div).not.toBeNull();
    selectElement(el, 'shp-1');
    await el.updateComplete;
    expect(selectedId(el)).toBe('shp-1');
    el.remove();
  });
});

describe('<slip-designer> 용지 밖 안내', () => {
  it('선택한 요소가 용지 오른쪽·아래쪽을 넘으면 안내를 보이고 안으로 들어오면 감춘다', async () => {
    const el = await mount();
    selectElement(el, 'shp-1'); // (100,80) 50×30 — 용지 안
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.paper-overflow-notice')).toBeNull();

    const x = propInput(el, 'X');
    x.value = '190'; // 190+50 = 240 > 210
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const notice = el.shadowRoot!.querySelector('.paper-overflow-notice');
    expect(notice).not.toBeNull();
    expect(notice!.getAttribute('role')).toBe('note');
    expect(notice!.textContent?.trim()).toBe(strings.designer.paperOverflowNotice);

    x.value = '100';
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.paper-overflow-notice')).toBeNull();
    el.remove();
  });

  it('복수 선택 중 하나라도 용지를 넘으면 그룹 패널에 안내를 보인다', async () => {
    const file = makeFile();
    file.template.pages[0]!.elements.find((e) => e.id === 'r-d')!.position = { x: 205, y: 200 };
    const el = await mount(file);
    sidebarRow(el, 'rect-a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'rect-d').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);
    expect(el.shadowRoot!.querySelector('.paper-overflow-notice')).not.toBeNull();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 화살표 키 이동
// ---------------------------------------------------------------------------

describe('<slip-designer> 화살표 키 이동', () => {
  it('화살표는 0.5mm, Shift+화살표는 5mm 옮긴다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1'); // (30,40)
    await el.updateComplete;

    expect(press(el, 'ArrowRight').defaultPrevented).toBe(true);
    release(el, 'ArrowRight');
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30.5, y: 40 });

    press(el, 'ArrowDown', { shiftKey: true });
    release(el, 'ArrowDown');
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30.5, y: 45 });

    press(el, 'ArrowLeft');
    release(el, 'ArrowLeft');
    press(el, 'ArrowUp', { shiftKey: true });
    release(el, 'ArrowUp');
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30, y: 40 });
    el.remove();
  });

  it('키를 누르고 있는 동안의 반복 이동은 되돌리기 한 단계와 slip-change 한 번으로 묶인다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const changes = watchChanges(el);
    const depth = undoDepth(el);

    press(el, 'ArrowRight');
    press(el, 'ArrowRight');
    press(el, 'ArrowRight');
    expect(changes.length).toBe(0);
    expect(undoDepth(el)).toBe(depth);
    expect(positionOf(el, 'txt-1').x).toBe(31.5);

    release(el, 'ArrowRight');
    await el.updateComplete;
    expect(changes.length).toBe(1);
    expect(undoDepth(el)).toBe(depth + 1);
    expect(changes[0]!.detail.file.template.pages[0].elements[0].position.x).toBe(31.5);

    // 되돌리기 한 번으로 세 번의 이동 전으로 돌아갑니다.
    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(positionOf(el, 'txt-1').x).toBe(30);
    el.remove();
  });

  it('키를 떼기 전에 방향을 바꿔도 한 단계로 묶인다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const changes = watchChanges(el);
    const depth = undoDepth(el);

    press(el, 'ArrowRight');
    press(el, 'ArrowDown');
    press(el, 'ArrowDown', { shiftKey: true });
    release(el, 'ArrowDown');
    await el.updateComplete;
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30.5, y: 45.5 });
    expect(changes.length).toBe(1);
    expect(undoDepth(el)).toBe(depth + 1);
    el.remove();
  });

  it('키를 누른 채 초점을 잃으면 그 자리에서 한 번 커밋한다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const changes = watchChanges(el);

    press(el, 'ArrowRight');
    press(el, 'ArrowRight');
    el.dispatchEvent(new FocusEvent('blur'));
    await el.updateComplete;
    expect(changes.length).toBe(1);
    // 뒤늦게 온 keyup은 아무것도 하지 않습니다.
    release(el, 'ArrowRight');
    await el.updateComplete;
    expect(changes.length).toBe(1);
    el.remove();
  });

  it('그룹과 복수 선택은 한 덩어리로 움직이고 경계에서는 선택 전체가 함께 멈춘다', async () => {
    const el = await mount();
    selectElement(el, 'r-b'); // grp-1: r-b (60,210), r-c (90,230)
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    press(el, 'ArrowUp', { shiftKey: true });
    release(el, 'ArrowUp');
    expect(positionOf(el, 'r-b')).toEqual({ x: 60, y: 205 });
    expect(positionOf(el, 'r-c')).toEqual({ x: 90, y: 225 });

    // r-a(10,200)와 r-b 그룹을 함께 선택해 왼콽으로 밀면 r-a가 0에 닿은 뒤 모두 멈춥니다.
    sidebarRow(el, 'rect-a').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(3);
    for (let i = 0; i < 3; i += 1) press(el, 'ArrowLeft', { shiftKey: true });
    release(el, 'ArrowLeft');
    expect(positionOf(el, 'r-a').x).toBe(0);
    expect(positionOf(el, 'r-b').x).toBe(50);
    expect(positionOf(el, 'r-c').x).toBe(80);
    el.remove();
  });

  it('움직인 것이 없으면(이미 0에 닿음) 되돌리기 단계와 변경 알림을 만들지 않는다', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements[0]!.position = { x: 0, y: 0 };
    const el = await mount(file);
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const changes = watchChanges(el);
    const depth = undoDepth(el);
    press(el, 'ArrowLeft');
    release(el, 'ArrowLeft');
    await el.updateComplete;
    expect(changes.length).toBe(0);
    expect(undoDepth(el)).toBe(depth);
    el.remove();
  });

  it('Ctrl/Cmd+화살표는 가로채지 않는다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(press(el, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(el, 'ArrowRight', { metaKey: true }).defaultPrevented).toBe(false);
    release(el, 'ArrowRight');
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30, y: 40 });
    el.remove();
  });

  it('선택이 없으면 화살표를 가로채지 않는다', async () => {
    const el = await mount();
    expect(press(el, 'ArrowRight').defaultPrevented).toBe(false);
    el.remove();
  });

  it('입력란 안이나 모달이 열린 동안에는 화살표로 요소를 옮기지 않는다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    // 속성 패널 입력란을 원래 대상으로 삼는 화살표
    const input = propInput(el, 'X');
    const fromInput = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    Object.defineProperty(fromInput, 'composedPath', { value: () => [input] });
    el.dispatchEvent(fromInput);
    release(el, 'ArrowRight');
    expect(fromInput.defaultPrevented).toBe(false);
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30, y: 40 });

    // 샘플 데이터 모달을 연 상태
    (Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.sampleData) as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.modal')).not.toBeNull();
    expect(press(el, 'ArrowRight').defaultPrevented).toBe(false);
    release(el, 'ArrowRight');
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30, y: 40 });
    el.remove();
  });

  it('PDF 미리보기 중에는 화살표로 요소를 옮기지 않는다', async () => {
    const el = await mount();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    (el as unknown as { _previewMode: boolean })._previewMode = true;
    await el.updateComplete;
    expect(press(el, 'ArrowRight').defaultPrevented).toBe(false);
    release(el, 'ArrowRight');
    expect(positionOf(el, 'txt-1')).toEqual({ x: 30, y: 40 });
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 복수 선택 — 캔버스·사이드바 보조키 클릭, 정렬·간격 배치
// ---------------------------------------------------------------------------

describe('<slip-designer> 복수 선택 — 캔버스와 사이드바', () => {
  it('캔버스에서 Shift·Ctrl/Cmd 클릭은 선택 단위를 넣고 빼며 그룹은 통째로 움직인다', async () => {
    const el = await mount();
    selectElement(el, 'r-a');
    await el.updateComplete;

    // Shift+클릭으로 그룹 구성원 하나를 누르면 그룹 전체가 들어옵니다.
    pointer(canvasElement(el, 'r-c'), 'pointerdown', 0, 0, { shiftKey: true });
    pointer(canvasElement(el, 'r-c'), 'pointerup', 0, 0, { shiftKey: true });
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a', 'r-b', 'r-c']));
    expect(selectedId(el)).toBe('r-c');

    // Cmd+클릭으로 그룹의 다른 구성원을 누르면 그룹 전체가 빠집니다.
    pointer(canvasElement(el, 'r-b'), 'pointerdown', 0, 0, { metaKey: true });
    pointer(canvasElement(el, 'r-b'), 'pointerup', 0, 0, { metaKey: true });
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a']));
    expect(selectedId(el)).toBe('r-a');

    // Ctrl+클릭으로 다시 넣고, 보조키 클릭은 드래그를 시작하지 않습니다.
    pointer(canvasElement(el, 'r-d'), 'pointerdown', 0, 0, { ctrlKey: true });
    pointer(canvasElement(el, 'r-d'), 'pointermove', 20, 20, { ctrlKey: true });
    pointer(canvasElement(el, 'r-d'), 'pointerup', 20, 20, { ctrlKey: true });
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a', 'r-d']));
    expect(positionOf(el, 'r-d')).toEqual({ x: 150, y: 200 });
    el.remove();
  });

  it('이미 선택된 요소를 그냥 눌러 끌면 복수 선택이 유지되어 함께 움직인다', async () => {
    const el = await mount();
    selectElement(el, 'r-a');
    await el.updateComplete;
    pointer(canvasElement(el, 'r-d'), 'pointerdown', 0, 0, { shiftKey: true });
    pointer(canvasElement(el, 'r-d'), 'pointerup', 0, 0, { shiftKey: true });
    await el.updateComplete;

    await drag(el, 'r-a', 5, 5);
    expect(selectedIds(el)).toEqual(new Set(['r-a', 'r-d']));
    expect(positionOf(el, 'r-a')).toEqual({ x: 15, y: 205 });
    expect(positionOf(el, 'r-d')).toEqual({ x: 155, y: 205 });
    el.remove();
  });

  it('선택되지 않은 요소를 그냥 누르면 그 요소(그룹이면 그룹 전체)만 선택한다', async () => {
    const el = await mount();
    selectElement(el, 'r-a');
    await el.updateComplete;
    pointer(canvasElement(el, 'r-d'), 'pointerdown', 0, 0, { shiftKey: true });
    pointer(canvasElement(el, 'r-d'), 'pointerup', 0, 0, { shiftKey: true });
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    selectElement(el, 'r-b');
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-b', 'r-c']));
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['txt-1']));
    el.remove();
  });

  it('사이드바에서 Shift·Ctrl/Cmd 클릭은 캔버스와 같이 선택 단위를 넣고 뺀다', async () => {
    const el = await mount();
    sidebarRow(el, 'rect-a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'rect-b').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a', 'r-b', 'r-c']));

    sidebarRow(el, 'rect-c').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a']));

    sidebarRow(el, 'rect-d').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    expect(selectedIds(el)).toEqual(new Set(['r-a', 'r-d']));
    el.remove();
  });
});

describe('<slip-designer> 복수 선택 — 정렬·간격 배치', () => {
  const s = strings.designer;

  async function selectMany(el: Designer, names: string[]): Promise<void> {
    sidebarRow(el, names[0]!).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    for (const name of names.slice(1)) {
      sidebarRow(el, name).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await el.updateComplete;
    }
  }

  it('정렬 버튼 여섯 개와 간격 배치 버튼 두 개가 이름과 함께 표시된다', async () => {
    const el = await mount();
    await selectMany(el, ['rect-a', 'rect-d']);
    for (const label of [
      s.alignLeftEdges, s.alignHCenters, s.alignRightEdges,
      s.alignTopEdges, s.alignVCenters, s.alignBottomEdges,
      s.distributeHorizontally, s.distributeVertically,
    ]) {
      const button = panelButton(el, label);
      expect(button, label).toBeDefined();
      expect(button.getAttribute('title')).toContain(label);
    }
    el.remove();
  });

  it('왼쪽 맞춤은 한 번의 되돌리기 단계와 slip-change로 모든 단위를 선택 상자 왼쪽에 맞춘다', async () => {
    const el = await mount();
    await selectMany(el, ['rect-a', 'rect-b', 'rect-d']); // r-a 10, grp(60~100), r-d 150
    const changes = watchChanges(el);
    const depth = undoDepth(el);

    panelButton(el, s.alignLeftEdges).click();
    await el.updateComplete;
    expect(positionOf(el, 'r-a').x).toBe(10);
    expect(positionOf(el, 'r-b').x).toBe(10);
    expect(positionOf(el, 'r-c').x).toBe(40); // 그룹 안 간격 30 유지
    expect(positionOf(el, 'r-d').x).toBe(10);
    expect(changes.length).toBe(1);
    expect(undoDepth(el)).toBe(depth + 1);

    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(positionOf(el, 'r-d').x).toBe(150);
    el.remove();
  });

  it('아래쪽 맞춤은 세로 좌표만 바꾼다', async () => {
    const el = await mount();
    await selectMany(el, ['rect-a', 'rect-d', 'rect-b']); // 아래 끝: r-a 210, r-d 210, grp 240
    panelButton(el, s.alignBottomEdges).click();
    await el.updateComplete;
    expect(positionOf(el, 'r-a')).toEqual({ x: 10, y: 230 });
    expect(positionOf(el, 'r-d')).toEqual({ x: 150, y: 230 });
    expect(positionOf(el, 'r-b')).toEqual({ x: 60, y: 210 });
    el.remove();
  });

  it('가로 간격 균등은 양 끝을 두고 가운데 단위를 같은 간격으로 놓는다', async () => {
    const el = await mount();
    await selectMany(el, ['rect-a', 'rect-b', 'rect-d']);
    // r-a 10~20, grp 60~100, r-d 150~160 → 빈 공간 90을 둘로 나눠 간격 45 → 그룹은 65에서 시작
    panelButton(el, s.distributeHorizontally).click();
    await el.updateComplete;
    expect(positionOf(el, 'r-a').x).toBe(10);
    expect(positionOf(el, 'r-b').x).toBe(65);
    expect(positionOf(el, 'r-c').x).toBe(95);
    expect(positionOf(el, 'r-d').x).toBe(150);
    el.remove();
  });

  it('단위가 셋 미만이면 간격 배치가 비활성화되고 이유를 알린다', async () => {
    const el = await mount();
    await selectMany(el, ['rect-a', 'rect-b']); // 요소 하나 + 그룹 하나 = 두 단위
    const button = panelButton(el, s.distributeHorizontally);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toContain(s.distributeNeedsThree);
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(el.shadowRoot!.getElementById(describedBy!)?.textContent?.trim()).toBe(s.distributeNeedsThree);
    // 정렬은 두 단위부터 가능합니다.
    expect(panelButton(el, s.alignLeftEdges).disabled).toBe(false);
    el.remove();
  });

  it('상자가 양 끝 사이에 들어가지 않으면 간격 배치가 비활성화되고 이유를 알린다', async () => {
    const file = makeFile();
    // 가로로 r-a 10~20, r-d 150~160 사이(빈 공간 130)에 폭 140인 shp-1(20~160)은 들어갈 수 없습니다.
    file.template.pages[0]!.elements[1]!.position = { x: 20, y: 200 };
    (file.template.pages[0]!.elements[1] as unknown as { width: number }).width = 140;
    const el = await mount(file);
    await selectMany(el, ['rect-a', 'test-shape', 'rect-d']);
    const horizontal = panelButton(el, s.distributeHorizontally);
    expect(horizontal.disabled).toBe(true);
    expect(horizontal.getAttribute('title')).toContain(s.distributeNoRoom);
    const describedBy = horizontal.getAttribute('aria-describedby');
    expect(el.shadowRoot!.getElementById(describedBy!)?.textContent?.trim()).toBe(s.distributeNoRoom);
    // 세로로도 r-a·r-d(200~210) 사이에 높이 30인 shp-1이 들어갈 수 없어 비활성입니다.
    expect(panelButton(el, s.distributeVertically).disabled).toBe(true);
    el.remove();
  });

  it('세로 간격 균등은 세로 좌표만 바꾼다', async () => {
    const file = makeFile();
    // r-a 200~210, shp-1 240~270, r-d 300~310 → 빈 공간 60을 둘로 나눠 간격 30 → shp-1은 240에 그대로
    file.template.pages[0]!.elements[1]!.position = { x: 100, y: 235 };
    file.template.pages[0]!.elements.find((e) => e.id === 'r-d')!.position = { x: 150, y: 300 };
    const el = await mount(file);
    await selectMany(el, ['rect-a', 'test-shape', 'rect-d']);
    panelButton(el, s.distributeVertically).click();
    await el.updateComplete;
    expect(positionOf(el, 'shp-1')).toEqual({ x: 100, y: 240 });
    expect(positionOf(el, 'r-a')).toEqual({ x: 10, y: 200 });
    expect(positionOf(el, 'r-d')).toEqual({ x: 150, y: 300 });
    el.remove();
  });
});
