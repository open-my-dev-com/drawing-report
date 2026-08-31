// @vitest-environment happy-dom
// 저장소와 PDF 미리보기
import { describe, expect, it, vi } from 'vitest';

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

vi.mock('../../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의한다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import type { SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  renderSlipToPdfMock,
  revokedUrls,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  loadDesigner,
  flush,
  toolbarButton,
  pickListValue,
  listOptionLabels,
} from './helpers.js';

installDesignerTestEnv();

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
    expect(revokedUrls().length).toBeGreaterThan(0);
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
