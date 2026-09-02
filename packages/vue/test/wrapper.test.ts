// @vitest-environment happy-dom
/**
 * `@omdc-slipkit/vue` 래퍼 테스트.
 *
 * 실제 `@omdc-slipkit/elements` 빌드를 마운트해 설정 전달과 이벤트 연결을 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowReactive, type App } from 'vue';
import {
  CURRENT_SCHEMA_VERSION,
  serializeSlipFile,
  type SlipFile,
  type SlipKit,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import type { SlipDesigner as SlipDesignerElement, SlipForm as SlipFormElement } from '@omdc-slipkit/elements';
import { SlipDesigner, SlipForm, SlipViewer } from '../src/index.js';

/** 요소의 이미지 크기 기본값(2MB) */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const DUMMY_SLIPKIT = {
  getFonts: () => [{ name: 'demo', data: new Uint8Array([1]) }],
  render: () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
} as unknown as SlipKit;

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BYTES = new Uint8Array(Uint8Array.from(atob(SAMPLE_PNG.split(',')[1]!), (c) => c.charCodeAt(0)));

/** 이미지 파라미터 하나와 문자 파라미터 하나를 가진 양식 */
function makeTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '도장 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [{
        elements: [{
          type: 'image', id: 'img-stamp', name: '도장',
          position: { x: 150, y: 15 }, width: 30, height: 30, parameter: 'stamp',
        }],
      }],
      assets: [],
      parameters: [
        { key: 'stamp', label: '도장 이미지', valueType: 'image' },
        { key: 'memo', label: '비고' },
      ],
    },
  };
}

const TEMPLATE_SRC = serializeSlipFile(makeTemplate());

interface Mounted {
  container: HTMLElement;
  app: App;
  unmount(): void;
}

/** 반응형 props 객체로 자식을 그려 갱신·제거를 시험할 수 있게 마운트한다. */
function mount(renderNode: () => ReturnType<typeof h>): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({ render: renderNode });
  app.mount(container);
  return {
    container,
    app,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function settle(el: { updateComplete: Promise<boolean> }): Promise<void> {
  await nextTick();
  await el.updateComplete;
  await flush();
  await el.updateComplete;
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 선택적 설정 전달
// ---------------------------------------------------------------------------

describe('@omdc-slipkit/vue 선택적 설정', () => {
  it('SlipViewer는 slipkit을 생략하면 요소에 쓰지 않고, 지정·갱신·제거를 그대로 반영한다', async () => {
    const state = shallowReactive<{ slipkit: SlipKit | undefined; locale: string | undefined }>({
      slipkit: undefined,
      locale: undefined,
    });
    const m = mount(() => h(SlipViewer, { src: '', slipkit: state.slipkit, locale: state.locale }));
    const el = m.container.querySelector('slip-viewer') as HTMLElement & { src: string; slipkit?: unknown; locale?: string };
    expect(el.src).toBe('');
    expect(el.slipkit).toBeUndefined();
    expect(el.locale).toBeUndefined();

    state.slipkit = DUMMY_SLIPKIT;
    state.locale = 'ko';
    await nextTick();
    expect(el.slipkit).toBe(DUMMY_SLIPKIT);
    expect(el.locale).toBe('ko');

    const other = { ...DUMMY_SLIPKIT } as SlipKit;
    state.slipkit = other;
    state.locale = 'ja';
    await nextTick();
    expect(el.slipkit).toBe(other);
    expect(el.locale).toBe('ja');

    state.slipkit = undefined;
    state.locale = undefined;
    await nextTick();
    expect(el.slipkit).toBeUndefined();
    expect(el.locale).toBeUndefined();
    m.unmount();
  });

  it('SlipDesigner는 maxImageBytes·settings·presets·storage를 생략하면 요소 기본값을 유지한다', async () => {
    const settings = { getBarcodeKinds: () => [] };
    const storage = {} as SlipDesignerElement['storage'];
    const state = shallowReactive<{
      maxImageBytes: number | undefined;
      settings: typeof settings | undefined;
      presets: SlipDesignerElement['presets'];
      storage: SlipDesignerElement['storage'];
    }>({ maxImageBytes: undefined, settings: undefined, presets: undefined, storage: undefined });
    const m = mount(() => h(SlipDesigner, {
      src: '',
      maxImageBytes: state.maxImageBytes,
      settings: state.settings,
      presets: state.presets,
      storage: state.storage,
    }));
    const el = m.container.querySelector('slip-designer') as SlipDesignerElement;
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);
    expect(el.settings).toBeUndefined();
    expect(el.presets).toBeUndefined();
    expect(el.storage).toBeUndefined();

    state.maxImageBytes = 100;
    state.settings = settings;
    state.presets = [];
    state.storage = storage;
    await nextTick();
    expect(el.maxImageBytes).toBe(100);
    expect(el.settings).toBe(settings);
    expect(el.presets).toEqual([]);
    expect(el.storage).toBe(storage);

    state.maxImageBytes = 200;
    state.settings = undefined;
    await nextTick();
    expect(el.maxImageBytes).toBe(200);
    expect(el.settings).toBeUndefined();

    state.maxImageBytes = undefined;
    await nextTick();
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);
    m.unmount();
  });

  it('SlipForm은 maxImageBytes를 생략·지정·갱신·제거해도 요소 기본값과 명시값을 정확히 오간다', async () => {
    const state = shallowReactive<{ maxImageBytes: number | undefined }>({ maxImageBytes: undefined });
    const m = mount(() => h(SlipForm, { src: '', maxImageBytes: state.maxImageBytes }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);

    state.maxImageBytes = 100;
    await nextTick();
    expect(el.maxImageBytes).toBe(100);
    state.maxImageBytes = 300;
    await nextTick();
    expect(el.maxImageBytes).toBe(300);
    state.maxImageBytes = undefined;
    await nextTick();
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);
    m.unmount();
  });
});

// ---------------------------------------------------------------------------
// 실제 이미지 선택으로 확인하는 상한
// ---------------------------------------------------------------------------

function buttonByLabel(el: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
  if (!found) throw new Error(`버튼을 찾지 못했습니다: ${label}`);
  return found as HTMLButtonElement;
}

/** 이미지 선택 버튼을 누르고 파일 선택을 흉내 낸다. */
async function pickFile(el: SlipFormElement, file: File): Promise<void> {
  let captured: HTMLInputElement | null = null;
  const original = document.createElement.bind(document);
  const created = vi.spyOn(document, 'createElement').mockImplementation(
    (tag: string, options?: ElementCreationOptions) => {
      const node = original(tag, options);
      if (tag === 'input') captured = node as HTMLInputElement;
      return node;
    },
  );
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  buttonByLabel(el, '도장 이미지 Select image').click();
  await flush();
  created.mockRestore();
  click.mockRestore();
  const input = captured as HTMLInputElement | null;
  if (!input) throw new Error('파일 입력이 만들어지지 않았습니다');
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await flush();
  await flush();
  await el.updateComplete;
}

describe('@omdc-slipkit/vue 이미지 상한', () => {
  it('maxImageBytes를 생략하면 요소 기본값으로 실제 이미지를 받는다', async () => {
    const changes: SlipVoucherFile[] = [];
    const m = mount(() => h(SlipForm, {
      src: TEMPLATE_SRC, slipkit: DUMMY_SLIPKIT, onSlipChange: (file: SlipVoucherFile) => changes.push(file),
    }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    await settle(el);
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(changes.at(-1)?.values.stamp).toBe(SAMPLE_PNG);
    expect(el.shadowRoot?.querySelector('.notice.error')).toBeNull();
    m.unmount();
  });

  it('maxImageBytes를 지정하면 그 상한을 넘는 이미지를 거부하고, 제거하면 기본값으로 돌아간다', async () => {
    const changes: SlipVoucherFile[] = [];
    const state = shallowReactive<{ maxImageBytes: number | undefined }>({ maxImageBytes: 10 });
    const m = mount(() => h(SlipForm, {
      src: TEMPLATE_SRC,
      slipkit: DUMMY_SLIPKIT,
      maxImageBytes: state.maxImageBytes,
      onSlipChange: (file: SlipVoucherFile) => changes.push(file),
    }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    await settle(el);
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(changes.length).toBe(0);
    expect(el.shadowRoot?.querySelector('.notice.error')?.textContent).toContain('10B');

    state.maxImageBytes = undefined;
    await nextTick();
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(changes.at(-1)?.values.stamp).toBe(SAMPLE_PNG);
    m.unmount();
  });
});

// ---------------------------------------------------------------------------
// 이벤트 연결
// ---------------------------------------------------------------------------

describe('@omdc-slipkit/vue 이벤트', () => {
  it('SlipDesigner는 slip-change 이벤트의 양식 파일을 다시 내보낸다', () => {
    const received: SlipTemplateFile[] = [];
    const m = mount(() => h(SlipDesigner, {
      src: '', onSlipChange: (file: SlipTemplateFile) => received.push(file),
    }));
    const el = m.container.querySelector('slip-designer')!;
    const file = makeTemplate();
    el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
    expect(received).toEqual([file]);
    m.unmount();
  });

  it('SlipForm은 값 변경을 전표로, 발행을 확정 전표로 각 이벤트에 전달한다', async () => {
    const changes: SlipVoucherFile[] = [];
    const issued: SlipVoucherFile[] = [];
    const m = mount(() => h(SlipForm, {
      src: TEMPLATE_SRC,
      slipkit: DUMMY_SLIPKIT,
      onSlipChange: (file: SlipVoucherFile) => changes.push(file),
      onSlipIssue: (file: SlipVoucherFile) => issued.push(file),
    }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    await settle(el);

    const memo = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === '비고')!;
    memo.value = '메모';
    memo.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(changes.at(-1)).toMatchObject({ kind: 'voucher', issued: false, values: { memo: '메모' } });

    buttonByLabel(el, 'Issue').click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(issued.length).toBe(1);
    expect(issued[0]).toMatchObject({ kind: 'voucher', issued: true, values: { memo: '메모' } });
    m.unmount();
  });

  it('핸들러를 바꾸면 옛 핸들러는 더 이상 불리지 않고, 언마운트 뒤에는 아무 핸들러도 불리지 않는다', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const state = shallowReactive<{ handler: (file: SlipVoucherFile) => void }>({ handler: first });
    const m = mount(() => h(SlipForm, { src: '', onSlipChange: state.handler, onSlipIssue: state.handler }));
    const el = m.container.querySelector('slip-form')!;
    const file = { kind: 'voucher' } as SlipVoucherFile;

    state.handler = second;
    await nextTick();
    el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
    el.dispatchEvent(new CustomEvent('slip-issue', { detail: { file } }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);

    m.unmount();
    el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
    el.dispatchEvent(new CustomEvent('slip-issue', { detail: { file } }));
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('SlipFile을 받는 핸들러도 그대로 넘길 수 있다 (하위 호환)', () => {
    const generic = (file: SlipFile): void => {
      expect(file.kind).toBeDefined();
    };
    const m = mount(() => h(SlipForm, { src: '', onSlipChange: generic, onSlipIssue: generic }));
    m.unmount();
    const d = mount(() => h(SlipDesigner, { src: '', onSlipChange: generic }));
    d.unmount();
  });
});
