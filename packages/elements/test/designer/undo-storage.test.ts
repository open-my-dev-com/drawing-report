// @vitest-environment happy-dom
// 불러오기·되돌리기·저장 대상과 호스트 설정 Promise의 상태 정리
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
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  loadDesigner,
  flush,
  toolbarButton,
  selectElement,
  listOptionLabels,
  addByCanvasClick,
  pickListValue,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

interface FakeStorage {
  save: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

function makeStorage(): FakeStorage {
  const loaded = makeTemplateFile();
  loaded.template.meta.title = '불러온 양식';
  return {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(loaded),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({
      items: [
        { id: 'a', kind: 'template', title: '거래명세서' },
        { id: 'b', kind: 'template', title: '청구서' },
      ],
    }),
  };
}

function fileOf(el: Element): SlipTemplateFile {
  return (el as unknown as { _file: SlipTemplateFile })._file;
}

function savedId(el: Element): string | null {
  return (el as unknown as { _forms: { savedId: string | null } })._forms.savedId;
}

function undoDepth(el: Element): number {
  return (el as unknown as { _undoStack: unknown[] })._undoStack.length;
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

const byAria = (el: Element, label: string) =>
  Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

async function settle(el: Designer): Promise<void> {
  await el.updateComplete;
  await flush();
  await el.updateComplete;
}

async function mountWithStorage(storage: FakeStorage): Promise<Designer> {
  const el = await loadDesigner();
  el.storage = storage as never;
  await el.updateComplete;
  return el;
}

/** 내 양식 목록에서 한 양식을 불러옵니다 */
async function loadForm(el: Designer, title: string): Promise<void> {
  toolbarButton(el, strings.designer.myFormsList).click();
  await settle(el);
  byAria(el, `${title} ${strings.designer.edit}`).click();
  await settle(el);
}

/** 저장 모달을 열어 현재 제목 그대로 저장합니다 */
async function saveCurrent(el: Designer): Promise<void> {
  toolbarButton(el, strings.designer.saveAsMyForm).click();
  await el.updateComplete;
  (Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
    .find((b) => b.textContent?.trim() === strings.designer.save) as HTMLButtonElement).click();
  await settle(el);
}

describe('<slip-designer> 불러오기·되돌리기·저장 대상', () => {
  it('불러온 양식을 되돌린 뒤 저장하면 불러온 양식을 덮어쓰지 않고, 다시 실행하면 원래 대상으로 돌아간다', async () => {
    const storage = makeStorage();
    const el = await mountWithStorage(storage);
    await loadForm(el, '거래명세서');
    expect(fileOf(el).template.meta.title).toBe('불러온 양식');
    expect(savedId(el)).toBe('a');

    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(fileOf(el).template.meta.title).toBe('테스트');
    expect(savedId(el)).toBeNull();

    await saveCurrent(el);
    expect(storage.save).toHaveBeenCalledTimes(1);
    const [newId, savedFile] = storage.save.mock.calls[0]! as [string, SlipTemplateFile];
    expect(newId).not.toBe('a');
    expect(savedFile.template.meta.title).toBe('테스트');

    press(el, 'y', { ctrlKey: true });
    await el.updateComplete;
    expect(fileOf(el).template.meta.title).toBe('불러온 양식');
    expect(savedId(el)).toBe('a');
    await saveCurrent(el);
    expect(storage.save.mock.calls[1]![0]).toBe('a');
    el.remove();
  });

  it('프리셋을 적용하면 이전에 불러온 양식을 덮어쓰지 않고, 되돌리면 원래 대상이 돌아온다', async () => {
    const storage = makeStorage();
    const el = await mountWithStorage(storage);
    await loadForm(el, '거래명세서');
    expect(savedId(el)).toBe('a');

    toolbarButton(el, strings.designer.preset).click();
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.toolbar [role="menuitem"]') as HTMLButtonElement).click();
    await settle(el);
    expect(fileOf(el).template.meta.title).not.toBe('불러온 양식');
    expect(savedId(el)).toBeNull();

    await saveCurrent(el);
    expect(storage.save.mock.calls[0]![0]).not.toBe('a');

    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(fileOf(el).template.meta.title).toBe('불러온 양식');
    expect(savedId(el)).toBe('a');
    el.remove();
  });

  it('저장이 실패하면 제목을 바꾸지 않고 되돌리기 이력도 남기지 않는다', async () => {
    const storage = makeStorage();
    storage.save.mockRejectedValue(new Error('디스크 가득 참'));
    const el = await mountWithStorage(storage);
    const depth = undoDepth(el);

    toolbarButton(el, strings.designer.saveAsMyForm).click();
    await el.updateComplete;
    const title = el.shadowRoot!.querySelector('.save-title') as HTMLInputElement;
    title.value = '새 제목';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    (Array.from(el.shadowRoot!.querySelectorAll('.modal-foot button'))
      .find((b) => b.textContent?.trim() === strings.designer.save) as HTMLButtonElement).click();
    await settle(el);

    expect(fileOf(el).template.meta.title).toBe('테스트');
    expect(undoDepth(el)).toBe(depth);
    expect(el.shadowRoot!.querySelector('.formula-status.error')?.textContent).toContain('디스크 가득 참');
    expect(el.shadowRoot!.querySelector('.modal')).not.toBeNull();
    el.remove();
  });

  it('빠르게 다른 양식을 고르면 먼저 시작한 불러오기의 늦은 응답은 무시한다', async () => {
    const storage = makeStorage();
    const slow = makeTemplateFile();
    slow.template.meta.title = '느린 양식';
    const fast = makeTemplateFile();
    fast.template.meta.title = '빠른 양식';
    let finishSlow: (file: SlipTemplateFile) => void = () => undefined;
    storage.load.mockImplementation((id: string) => id === 'a'
      ? new Promise<SlipTemplateFile>((resolve) => { finishSlow = resolve; })
      : Promise.resolve(fast));
    const el = await mountWithStorage(storage);

    toolbarButton(el, strings.designer.myFormsList).click();
    await settle(el);
    byAria(el, `거래명세서 ${strings.designer.edit}`).click();
    byAria(el, `청구서 ${strings.designer.edit}`).click();
    await settle(el);
    expect(fileOf(el).template.meta.title).toBe('빠른 양식');
    expect(savedId(el)).toBe('b');

    finishSlow(slow);
    await settle(el);
    expect(fileOf(el).template.meta.title).toBe('빠른 양식');
    expect(savedId(el)).toBe('b');
    el.remove();
  });
});

describe('<slip-designer> 반복 켜기와 파라미터 정의', () => {
  function makeGridFile(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid', id: 'grid-1', name: 'table', position: { x: 10, y: 10 },
      rows: [{ height: 10 }, { height: 10 }], columns: [{ width: 30 }, { width: 30 }], cells: [],
    } as never];
    return file;
  }

  const repeatToggle = (el: Element) =>
    el.shadowRoot!.querySelector(`input[aria-label="${strings.designer.repeatOn}"]`) as HTMLInputElement;

  it('반복을 켜면 목록 정의가 내보내는 파일에 함께 담기고, 되돌리면 정의도 사라진다', async () => {
    parseSlipFileMock.mockReturnValue(makeGridFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'grid-1');
    await el.updateComplete;
    const changes: SlipTemplateFile[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push((e as CustomEvent).detail.file as SlipTemplateFile));
    const depth = undoDepth(el);

    const toggle = repeatToggle(el);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const key = 'items_grid';
    expect(fileOf(el).template.parameters?.find((p) => p.key === key)?.valueType).toBe('list');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.template.parameters?.some((p) => p.key === key)).toBe(true);
    expect(undoDepth(el)).toBe(depth + 1);

    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(fileOf(el).template.parameters?.some((p) => p.key === key) ?? false).toBe(false);
    expect((fileOf(el).template.pages[0]!.elements[0] as { repeat?: unknown }).repeat).toBeUndefined();

    // Cmd/Ctrl+Shift+Z는 대문자 Z로 와도 다시 실행입니다.
    press(el, 'Z', { ctrlKey: true, shiftKey: true });
    await el.updateComplete;
    expect(fileOf(el).template.parameters?.some((p) => p.key === key)).toBe(true);
    el.remove();
  });

  it('새 필드·바코드·이미지 파라미터를 만들어 연결하는 것은 되돌리기 한 단위이고 내보내는 파일에 정의가 있다', async () => {
    const el = await loadDesigner();
    const changes: SlipTemplateFile[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push((e as CustomEvent).detail.file as SlipTemplateFile));

    await addByCanvasClick(el, strings.designer.addBarcode);
    const barcode = fileOf(el).template.pages[0]!.elements.at(-1) as { id: string; parameter?: string };
    expect(changes.at(-1)!.template.parameters?.some((p) => p.key === barcode.parameter)).toBe(true);

    const depth = undoDepth(el);
    const source = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.barcodeValue)!
      .querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, source(), 'content');
    await pickListValue(el, source(), 'parameter');

    const linked = fileOf(el).template.pages[0]!.elements.find((e) => e.id === barcode.id) as { parameter?: string };
    expect(linked.parameter).toMatch(/^value\d+$/);
    expect(undoDepth(el)).toBe(depth + 2);
    expect(changes.at(-1)!.template.parameters?.some((p) => p.key === linked.parameter)).toBe(true);

    press(el, 'z', { ctrlKey: true });
    await el.updateComplete;
    expect(fileOf(el).template.parameters?.some((p) => p.key === linked.parameter) ?? false).toBe(false);
    el.remove();
  });
});

describe('<slip-designer> 호스트 설정 Promise', () => {
  const paperSelect = (el: Element): HTMLButtonElement =>
    Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.paperSize)!
      .querySelector('.list-select') as HTMLButtonElement;

  it('거부된 Promise는 처리되지 않은 오류가 되지 않고, 기본 목록을 유지한 채 안내를 표시한다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = await loadDesigner();
    el.settings = {
      getPaperSizes: () => Promise.reject(new Error('paper down')),
      getBarcodeKinds: () => Promise.reject(new Error('barcode down')),
      savePaperSize: () => Promise.reject(new Error('save down')),
    };
    await settle(el);

    expect(el.shadowRoot!.querySelector('.paper-settings-error')?.textContent?.trim())
      .toBe(strings.designer.paperSizesLoadError);
    const labels = await listOptionLabels(el, paperSelect(el));
    expect(labels.some((l) => l.startsWith('A4'))).toBe(true);

    // 용지 저장 실패는 입력한 이름을 지우지 않고 안내만 바꿉니다.
    const width = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.width)!
      .querySelector('input') as HTMLInputElement;
    width.value = '123';
    width.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const name = el.shadowRoot!.querySelector('.paper-save-name') as HTMLInputElement;
    name.value = '내 용지';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    byAria(el, strings.designer.paperSaveThis).click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('.paper-settings-error')?.textContent?.trim())
      .toBe(strings.designer.paperSaveError);
    expect((el.shadowRoot!.querySelector('.paper-save-name') as HTMLInputElement).value).toBe('내 용지');

    // 바코드 종류는 모든 종류를 유지하고 바코드 패널에 안내합니다.
    await addByCanvasClick(el, strings.designer.addBarcode);
    expect(el.shadowRoot!.querySelector('.barcode-kinds-error')?.textContent?.trim())
      .toBe(strings.designer.barcodeKindsLoadError);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    el.remove();
  });

  it('설정이 바뀐 뒤 도착한 이전 설정의 늦은 응답은 무시한다', async () => {
    const el = await loadDesigner();
    let finishOld: (sizes: { name: string; width: number; height: number }[]) => void = () => undefined;
    el.settings = {
      getPaperSizes: () => new Promise((resolve) => { finishOld = resolve; }),
    };
    await settle(el);
    el.settings = { getPaperSizes: () => [{ name: '새 설정 용지', width: 100, height: 100 }] };
    await settle(el);
    expect((await listOptionLabels(el, paperSelect(el))).some((l) => l.includes('새 설정 용지'))).toBe(true);

    finishOld([{ name: '옛 설정 용지', width: 50, height: 50 }]);
    await settle(el);
    const labels = await listOptionLabels(el, paperSelect(el));
    expect(labels.some((l) => l.includes('새 설정 용지'))).toBe(true);
    expect(labels.some((l) => l.includes('옛 설정 용지'))).toBe(false);
    el.remove();
  });
});
