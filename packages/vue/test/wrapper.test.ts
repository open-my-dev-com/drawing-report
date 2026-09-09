// @vitest-environment happy-dom
/**
 * `@omdc-slipkit/vue` 래퍼 테스트입니다.
 *
 * 실제 `@omdc-slipkit/elements` 빌드를 마운트해 설정 전달과 이벤트 연결을 확인합니다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, shallowReactive, type App, type ComponentPublicInstance } from 'vue';
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

/** 요소의 이미지 크기 기본값(2MB)입니다. */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const DUMMY_SLIPKIT = {
  getFonts: () => [{ name: 'demo', data: new Uint8Array([1]) }],
  render: () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
} as unknown as SlipKit;

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BYTES = new Uint8Array(Uint8Array.from(atob(SAMPLE_PNG.split(',')[1]!), (c) => c.charCodeAt(0)));

/** 이미지 파라미터 하나와 문자 파라미터 하나를 가진 양식입니다. */
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

/** 반응형 속성 객체로 자식을 그려 갱신·제거를 시험할 수 있게 마운트합니다. */
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

/** 이미지 선택 버튼을 누른 뒤 파일 선택 동작을 재현합니다. */
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

// ---------------------------------------------------------------------------
// Vue 표준 동작 — ref, 속성 전달, DOM 이벤트
// ---------------------------------------------------------------------------

describe('@omdc-slipkit/vue 표준 동작', () => {
  it('세 컴포넌트의 ref는 컴포넌트 인스턴스이고 $el이 웹 컴포넌트다', async () => {
    const cases: [unknown, string][] = [
      [SlipViewer, 'slip-viewer'],
      [SlipDesigner, 'slip-designer'],
      [SlipForm, 'slip-form'],
    ];
    for (const [component, tag] of cases) {
      const instance = ref<ComponentPublicInstance | null>(null);
      const m = mount(() => h(component as typeof SlipViewer, { ref: instance, src: '' }));
      await nextTick();
      const el = instance.value?.$el as HTMLElement;
      expect(el).toBe(m.container.querySelector(tag));
      expect(el.tagName.toLowerCase()).toBe(tag);
      m.unmount();
    }
  });

  it('class·style·id·aria-*·data-*·tabindex를 웹 컴포넌트에 그대로 넘긴다', async () => {
    const m = mount(() => h(SlipViewer, {
      src: '',
      class: 'sheet wide',
      style: { border: '1px solid red' },
      id: 'viewer-1',
      'aria-label': '전표 미리보기',
      'data-testid': 'viewer',
      tabindex: '0',
      title: '미리보기',
    }));
    const el = m.container.querySelector('slip-viewer') as HTMLElement;
    expect(el.className).toBe('sheet wide');
    expect(el.style.border).toBe('1px solid red');
    expect(el.id).toBe('viewer-1');
    expect(el.getAttribute('aria-label')).toBe('전표 미리보기');
    expect(el.dataset['testid']).toBe('viewer');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('title')).toBe('미리보기');
    m.unmount();
  });

  it('갱신한 속성은 다시 쓰고 제거한 속성은 웹 컴포넌트에서도 지운다', async () => {
    const state = shallowReactive<{ id: string | undefined; label: string | undefined }>({
      id: 'first',
      label: '첫 이름',
    });
    const m = mount(() => h(SlipViewer, { src: '', id: state.id, 'aria-label': state.label }));
    const el = m.container.querySelector('slip-viewer') as HTMLElement;
    expect(el.id).toBe('first');

    state.id = 'second';
    state.label = '둘째 이름';
    await nextTick();
    expect(el.id).toBe('second');
    expect(el.getAttribute('aria-label')).toBe('둘째 이름');

    state.label = undefined;
    await nextTick();
    expect(el.hasAttribute('aria-label')).toBe(false);
    m.unmount();
  });

  it('DOM 이벤트 핸들러를 웹 컴포넌트에 붙여 클릭·포커스·키 입력을 그대로 받는다', async () => {
    const clicked = vi.fn();
    const focused = vi.fn();
    const keyed = vi.fn();
    const m = mount(() => h(SlipViewer, {
      src: '',
      onClick: clicked,
      onFocusin: focused,
      onKeydown: keyed,
    }));
    const el = m.container.querySelector('slip-viewer') as HTMLElement;

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(focused).toHaveBeenCalledTimes(1);
    expect(keyed.mock.calls[0]?.[0]).toMatchObject({ key: 'Enter' });

    // 언마운트하면 웹 컴포넌트가 문서에서 사라집니다. 떨어져 나간 노드에 남는 리스너는 Vue가 지우지 않습니다.
    m.unmount();
    expect(m.container.querySelector('slip-viewer')).toBeNull();
  });

  it('DOM 이벤트는 부모로 올라가고 slip 이벤트 핸들러와 서로 방해하지 않는다', async () => {
    const bubbled = vi.fn();
    const changed = vi.fn();
    const m = mount(() => h(
      'div',
      { onClick: bubbled },
      [h(SlipForm, { src: '', onSlipChange: changed })],
    ));
    const el = m.container.querySelector('slip-form')!;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new CustomEvent('slip-change', { detail: { file: { kind: 'voucher' } as SlipVoucherFile } }));
    expect(bubbled).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});
