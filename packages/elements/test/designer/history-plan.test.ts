// @vitest-environment happy-dom
// 되돌리기 기록과 페이지 계획 캐시 — 드래그 중 직렬화 없음, 편집 단위, 기록 상한과 계획 무효화
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 페이지 계획·수식 엔진은 실제 구현을 사용합니다.
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
  installDesignerTestEnv,
  loadDesigner,
  flush,
  toolbarButton,
  clickCanvasAt,
  selectElement,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

/** 테스트가 들여다보는 디자이너 내부 상태 */
type Internals = {
  _file: SlipTemplateFile;
  _history: { undoDepth: number; redoDepth: number; snapshotBytes: number };
  _planner: { computations: number };
  _forms: { savedId: string | null };
  _pagePlan(): { plan: { outputPageCount: number } | null };
  _selectPage(index: number): void;
};

function internals(el: Designer): Internals {
  return el as unknown as Internals;
}

function fileOf(el: Designer): SlipTemplateFile {
  return internals(el)._file;
}

/** 양식 전체를 JSON으로 — 직렬화 횟수를 세는 구간 밖에서만 부릅니다 */
function fileJson(el: Designer): string {
  return JSON.stringify(fileOf(el));
}

function positionOf(el: Designer, id: string): { x: number; y: number } {
  const found = fileOf(el).template.pages[0]!.elements.find((e) => e.id === id)!;
  return { x: found.position.x, y: found.position.y };
}

function textElement(id: string, x: number, y: number) {
  return {
    type: 'text' as const, id, name: id, position: { x, y }, width: 15, height: 8, content: id,
  };
}

/** 항목 구간이 한 행인 자동 확장 반복 그리드 — 세로 위치가 바뀌면 출력 페이지 수가 달라집니다 */
function repeatGrid(y: number) {
  return {
    type: 'grid' as const,
    id: 'g-1',
    name: 'repeat-grid',
    position: { x: 10, y },
    columns: [{ width: 60 }, { width: 60 }],
    rows: [{ height: 5 }, { height: 5 }],
    repeat: {
      parameter: 'items',
      bands: [
        { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
        { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
      ],
      pagination: { mode: 'auto', minItems: 0 },
    },
    cells: [
      { row: 0, column: 0, content: '품명' },
      { row: 1, column: 0, parameter: 'name' },
      { row: 1, column: 1, parameter: 'qty' },
    ],
  };
}

/** 10페이지 × 100요소, 첫 페이지에 샘플 항목 500개짜리 반복 그리드를 둔 큰 양식 */
function makeLargeFile(): SlipTemplateFile {
  const pages = Array.from({ length: 10 }, (_, page) => {
    const count = page === 0 ? 99 : 100;
    const elements: unknown[] = Array.from({ length: count }, (_, i) =>
      textElement(`t-${page}-${i}`, 10 + (i % 10) * 19, 100 + Math.floor(i / 10) * 15));
    if (page === 0) elements.unshift(repeatGrid(30));
    return { elements };
  });
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '큰 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
      pages,
      assets: [],
      sampleValues: {
        items: Array.from({ length: 500 }, (_, i) => ({ name: `항목 ${i + 1}`, qty: i + 1 })),
      },
    },
  } as unknown as SlipTemplateFile;
}

/** 1페이지 × 20요소의 작은 양식. 첫 요소 `t-0`은 (30,40)에 있습니다 */
function makeSmallFile(): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '작은 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
      pages: [{
        elements: Array.from({ length: 20 }, (_, i) =>
          textElement(`t-${i}`, 30 + (i % 5) * 30, 40 + Math.floor(i / 5) * 20)),
      }],
      assets: [],
    },
  } as unknown as SlipTemplateFile;
}

/** 고정 페이지(항목 5개 ÷ 2 = 출력 3페이지) 반복 그리드 하나짜리 양식 */
function makeFixedGridFile(): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '고정 페이지' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
      pages: [{
        elements: [{
          ...repeatGrid(10),
          repeat: { ...repeatGrid(10).repeat, pagination: { mode: 'fixed', itemsPerPage: 2 } },
        }],
      }],
      assets: [],
      sampleValues: { items: Array.from({ length: 5 }, (_, i) => ({ name: `항목 ${i + 1}`, qty: i })) },
    },
  } as unknown as SlipTemplateFile;
}

async function mountFile(file: SlipTemplateFile): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
  return loadDesigner();
}

async function settle(el: Designer): Promise<void> {
  await el.updateComplete;
  await flush();
  await el.updateComplete;
}

function canvasElement(el: Designer, id: string): HTMLElement {
  return el.shadowRoot!.querySelector(`[data-id="${id}"]`) as HTMLElement;
}

/** happy-dom의 `getBoundingClientRect`는 0을 돌려주므로 mm 좌표를 `clientX / PX_PER_MM`로 씁니다 */
function pointer(target: HTMLElement, type: string, mmX: number, mmY: number): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, composed: true, clientX: mmX * PX_PER_MM, clientY: mmY * PX_PER_MM, pointerId: 1,
  }));
}

function press(el: Designer, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function release(el: Designer, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function watchChanges(el: Designer): CustomEvent[] {
  const changes: CustomEvent[] = [];
  el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
  return changes;
}

/** 요소를 (0,0)에서 눌러 `steps`번 나눠 (dx,dy)mm까지 끌고 놓습니다 */
async function drag(el: Designer, id: string, dx: number, dy: number, steps = 3): Promise<void> {
  const div = canvasElement(el, id);
  pointer(div, 'pointerdown', 0, 0);
  for (let i = 1; i <= steps; i += 1) {
    pointer(div, 'pointermove', (dx * i) / steps, (dy * i) / steps);
    await el.updateComplete;
  }
  pointer(div, 'pointerup', dx, dy);
  await el.updateComplete;
}

/** 화살표 키 한 번 누르고 떼기 — 되돌리기 한 단계 */
async function nudge(el: Designer, key: string, init: KeyboardEventInit = {}): Promise<void> {
  press(el, key, init);
  release(el, key);
  await el.updateComplete;
}

async function undo(el: Designer): Promise<void> {
  press(el, 'z', { ctrlKey: true });
  await el.updateComplete;
}

async function redo(el: Designer): Promise<void> {
  press(el, 'y', { ctrlKey: true });
  await el.updateComplete;
}

/** 속성 패널의 출력 페이지 표시 문구 (반복 그리드를 선택했을 때) */
function navStatus(el: Designer): string {
  return el.shadowRoot!.querySelector('.prop-panel .output-page-nav .output-page-status')
    ?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

// ---------------------------------------------------------------------------
// 드래그 중 직렬화 없음
// ---------------------------------------------------------------------------

describe('<slip-designer> 드래그 중 문서 직렬화', () => {
  it('120번 움직여도 양식은 검사점 한 번만 직렬화하고, 놓을 때 한 번 복제해 slip-change 한 번을 보낸다', async () => {
    const el = await mountFile(makeLargeFile());
    const file = fileOf(el);
    selectElement(el, 't-0-0');
    await el.updateComplete;
    const changes = watchChanges(el);
    const depth = internals(el)._history.undoDepth;
    const computationsBefore = internals(el)._planner.computations;

    const stringify = vi.spyOn(JSON, 'stringify');
    const clone = vi.spyOn(globalThis, 'structuredClone');
    // 큰 직렬화 = 첫 인자가 양식 자체이거나 결과가 10,000자를 넘는 호출
    const largeStringifyCalls = (): number => stringify.mock.calls.filter((args, index) => {
      const value = stringify.mock.results[index]?.value as unknown;
      return args[0] === file || (typeof value === 'string' && value.length > 10_000);
    }).length;

    const div = canvasElement(el, 't-0-0');
    pointer(div, 'pointerdown', 0, 0);
    for (let i = 1; i <= 120; i += 1) {
      pointer(div, 'pointermove', i * 0.5, 0);
      await el.updateComplete;
    }

    // 이동 중: 검사점 한 번 외에는 직렬화·복제·변경 알림·기록이 없습니다. 계획은 다시 계산됩니다.
    expect(largeStringifyCalls()).toBeLessThanOrEqual(1);
    expect(clone).not.toHaveBeenCalled();
    expect(changes).toHaveLength(0);
    expect(internals(el)._history.undoDepth).toBe(depth);
    expect(internals(el)._planner.computations).toBeGreaterThan(computationsBefore);

    pointer(div, 'pointerup', 60, 0);
    await el.updateComplete;

    expect(largeStringifyCalls()).toBeLessThanOrEqual(1);
    expect(clone).toHaveBeenCalledTimes(1);
    expect(changes).toHaveLength(1);
    expect(internals(el)._history.undoDepth).toBe(depth + 1);
    expect(positionOf(el, 't-0-0').x).toBeGreaterThan(10);
    expect(internals(el)._history.snapshotBytes).toBeGreaterThan(10_000);
    el.remove();
  });

  it('취소된 드래그와 움직이지 않은 클릭은 기록도 slip-change도 남기지 않고 양식이 그대로다', async () => {
    const el = await mountFile(makeSmallFile());
    selectElement(el, 't-0');
    await el.updateComplete;
    const changes = watchChanges(el);
    const depth = internals(el)._history.undoDepth;
    const before = fileJson(el);

    const div = canvasElement(el, 't-0');
    pointer(div, 'pointerdown', 0, 0);
    pointer(div, 'pointermove', 20, 10);
    await el.updateComplete;
    expect(positionOf(el, 't-0')).not.toEqual({ x: 30, y: 40 });
    div.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(fileJson(el)).toBe(before);
    expect(changes).toHaveLength(0);
    expect(internals(el)._history.undoDepth).toBe(depth);

    pointer(div, 'pointerdown', 0, 0);
    pointer(div, 'pointerup', 0, 0);
    await el.updateComplete;
    expect(fileJson(el)).toBe(before);
    expect(changes).toHaveLength(0);
    expect(internals(el)._history.undoDepth).toBe(depth);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 편집 단위와 되돌리기 왕복
// ---------------------------------------------------------------------------

describe('<slip-designer> 편집 단위', () => {
  it('드래그·크기 조절·선 끝점·화살표 연속 이동은 각각 되돌리기 한 단계와 slip-change 한 번이다', async () => {
    const el = await mountFile(makeSmallFile());
    const changes = watchChanges(el);
    const history = internals(el)._history;

    selectElement(el, 't-0');
    await el.updateComplete;
    await drag(el, 't-0', 20, 10);
    expect(history.undoDepth).toBe(1);
    expect(changes).toHaveLength(1);

    const handle = el.shadowRoot!.querySelector('.handle-se') as HTMLElement;
    pointer(handle, 'pointerdown', 0, 0);
    for (let i = 1; i <= 3; i += 1) {
      pointer(handle, 'pointermove', i * 3, i * 3);
      await el.updateComplete;
    }
    pointer(handle, 'pointerup', 9, 9);
    await el.updateComplete;
    expect(history.undoDepth).toBe(2);
    expect(changes).toHaveLength(2);

    // 선을 두 번 클릭해 만들고(한 단계) 끝점을 끕니다(한 단계)
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 20 * PX_PER_MM, 150 * PX_PER_MM);
    await clickCanvasAt(el, 60 * PX_PER_MM, 150 * PX_PER_MM);
    expect(history.undoDepth).toBe(3);
    const endpoint = el.shadowRoot!.querySelectorAll('.endpoint')[1] as HTMLElement;
    pointer(endpoint, 'pointerdown', 60, 150);
    for (let i = 1; i <= 3; i += 1) {
      pointer(endpoint, 'pointermove', 60 + i * 5, 150 + i * 10);
      await el.updateComplete;
    }
    pointer(endpoint, 'pointerup', 75, 180);
    await el.updateComplete;
    expect(history.undoDepth).toBe(4);
    expect(changes).toHaveLength(4);

    // 화살표를 누른 채 방향을 바꿔도 키를 떼기 전까지는 한 단계입니다
    selectElement(el, 't-1');
    await el.updateComplete;
    press(el, 'ArrowRight');
    press(el, 'ArrowRight');
    press(el, 'ArrowDown', { shiftKey: true });
    expect(history.undoDepth).toBe(4);
    expect(changes).toHaveLength(4);
    release(el, 'ArrowDown');
    await el.updateComplete;
    expect(positionOf(el, 't-1')).toEqual({ x: 61, y: 45 });
    expect(history.undoDepth).toBe(5);
    expect(changes).toHaveLength(5);
    el.remove();
  });

  it('되돌리기·다시 실행은 양식 JSON과 저장 대상을 그대로 되살리고, 되돌린 뒤 새 편집은 다시 실행 기록을 지운다', async () => {
    const loaded = makeSmallFile();
    loaded.template.meta.title = '불러온 양식';
    const storage = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(loaded),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ items: [{ id: 'a', kind: 'template', title: '거래명세서' }] }),
    };
    const el = await mountFile(makeSmallFile());
    el.storage = storage as never;
    await el.updateComplete;
    const history = internals(el)._history;

    const original = fileJson(el);
    selectElement(el, 't-0');
    await el.updateComplete;
    await drag(el, 't-0', 20, 0);
    const edited = fileJson(el);
    expect(edited).not.toBe(original);

    // 내 양식을 불러오면 저장 대상이 붙습니다
    toolbarButton(el, strings.designer.myFormsList).click();
    await settle(el);
    (Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === `거래명세서 ${strings.designer.edit}`) as HTMLButtonElement).click();
    await settle(el);
    const loadedJson = fileJson(el);
    expect(internals(el)._forms.savedId).toBe('a');
    expect(history.undoDepth).toBe(2);

    await undo(el);
    expect(fileJson(el)).toBe(edited);
    expect(internals(el)._forms.savedId).toBeNull();
    await undo(el);
    expect(fileJson(el)).toBe(original);
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(2);

    await redo(el);
    expect(fileJson(el)).toBe(edited);
    await redo(el);
    expect(fileJson(el)).toBe(loadedJson);
    expect(internals(el)._forms.savedId).toBe('a');
    expect(history.redoDepth).toBe(0);

    // 되돌린 뒤 새로 편집하면 다시 실행할 것이 없어집니다
    await undo(el);
    expect(history.redoDepth).toBe(1);
    selectElement(el, 't-1');
    await el.updateComplete;
    await nudge(el, 'ArrowRight');
    expect(history.redoDepth).toBe(0);
    expect(history.undoDepth).toBe(2);
    el.remove();
  });

  it('51번 편집하면 50단계만 남고 가장 오래된 단계가 버려진다', async () => {
    const el = await mountFile(makeSmallFile());
    const history = internals(el)._history;
    selectElement(el, 't-0');
    await el.updateComplete;

    await nudge(el, 'ArrowRight');
    const afterFirst = fileJson(el);
    expect(positionOf(el, 't-0').x).toBe(30.5);
    for (let i = 0; i < 50; i += 1) await nudge(el, 'ArrowRight');
    expect(positionOf(el, 't-0').x).toBe(55.5);
    expect(history.undoDepth).toBe(50);

    for (let i = 0; i < 50; i += 1) await undo(el);
    expect(history.undoDepth).toBe(0);
    expect(fileJson(el)).toBe(afterFirst);

    // 첫 편집 이전으로는 더 돌아갈 수 없습니다
    await undo(el);
    expect(fileJson(el)).toBe(afterFirst);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 페이지 계획 캐시
// ---------------------------------------------------------------------------

describe('<slip-designer> 페이지 계획 캐시', () => {
  it('바뀐 것이 없으면 다시 그려도 계획을 다시 계산하지 않고, 페이지를 옮기면 다시 계산한다', async () => {
    const el = await mountFile(makeLargeFile());
    const planner = internals(el)._planner;
    const count = planner.computations;
    expect(count).toBeGreaterThan(0);

    el.requestUpdate();
    await el.updateComplete;
    el.requestUpdate();
    await el.updateComplete;
    expect(planner.computations).toBe(count);

    internals(el)._selectPage(1);
    await el.updateComplete;
    expect(planner.computations).toBe(count + 1);
    expect(internals(el)._pagePlan().plan?.outputPageCount).toBe(1);

    internals(el)._selectPage(0);
    await el.updateComplete;
    expect(planner.computations).toBe(count + 2);
    expect(internals(el)._pagePlan().plan?.outputPageCount).toBeGreaterThan(1);
    el.remove();
  });

  it('반복 그리드를 키보드로 옮기면 출력 페이지 수가 새 위치를 따르고, 되돌리면 원래 계획으로 돌아간다', async () => {
    const el = await mountFile(makeLargeFile());
    const planner = internals(el)._planner;
    selectElement(el, 'g-1');
    await el.updateComplete;
    const before = internals(el)._pagePlan().plan!.outputPageCount;
    expect(before).toBeGreaterThan(1);
    expect(navStatus(el)).toContain(`/ ${before}`);
    const count = planner.computations;

    // 둘째 출력 페이지부터는 흐름 영역 맨 위에서 시작하므로 첫 페이지 용량만 위치를 따릅니다.
    // 그리드를 흐름 영역 맨 위(y=20)까지 10mm 올리면 첫 페이지에 항목이 더 들어가 출력 페이지가 줄어듭니다.
    press(el, 'ArrowUp', { shiftKey: true });
    press(el, 'ArrowUp', { shiftKey: true });
    release(el, 'ArrowUp');
    await el.updateComplete;
    expect(positionOf(el, 'g-1').y).toBe(20);
    expect(planner.computations).toBeGreaterThan(count);
    const after = internals(el)._pagePlan().plan!.outputPageCount;
    expect(after).toBeLessThan(before);
    expect(navStatus(el)).toContain(`/ ${after}`);

    await undo(el);
    expect(positionOf(el, 'g-1').y).toBe(30);
    expect(internals(el)._pagePlan().plan!.outputPageCount).toBe(before);
    expect(navStatus(el)).toContain(`/ ${before}`);
    el.remove();
  });

  it('src를 바꾸면 되돌리기·다시 실행 기록이 비고 새 양식의 계획을 계산한다', async () => {
    const el = await mountFile(makeLargeFile());
    const history = internals(el)._history;
    const planner = internals(el)._planner;
    selectElement(el, 't-0-0');
    await el.updateComplete;
    await nudge(el, 'ArrowRight');
    await nudge(el, 'ArrowRight');
    await undo(el);
    expect(history.undoDepth).toBe(1);
    expect(history.redoDepth).toBe(1);
    const count = planner.computations;

    parseSlipFileMock.mockReturnValue(makeFixedGridFile() as unknown as SlipFile);
    el.src = '{"next": true}';
    await settle(el);

    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
    expect(history.snapshotBytes).toBe(0);
    expect(planner.computations).toBeGreaterThan(count);
    expect(fileOf(el).template.meta.title).toBe('고정 페이지');
    expect(internals(el)._pagePlan().plan?.outputPageCount).toBe(3);
    el.remove();
  });
});
