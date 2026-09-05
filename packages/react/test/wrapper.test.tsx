// @vitest-environment happy-dom
/**
 * `@omdc-slipkit/react` 래퍼 테스트.
 *
 * 실제 `@omdc-slipkit/elements` 빌드를 마운트해 설정 전달과 이벤트 연결을 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode, type Ref, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CURRENT_SCHEMA_VERSION,
  serializeSlipFile,
  type SlipFile,
  type SlipKit,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import type {
  SlipDesigner as SlipDesignerElement,
  SlipForm as SlipFormElement,
  SlipViewer as SlipViewerElement,
} from '@omdc-slipkit/elements';
import { SlipDesigner, SlipForm, SlipViewer } from '../src/index.js';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

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
  root: Root;
  rerender(node: ReactNode): void;
  unmount(): void;
}

function render(node: ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    root,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function settle(el: { updateComplete: Promise<boolean> }): Promise<void> {
  await act(async () => {
    await el.updateComplete;
    await flush();
    await el.updateComplete;
  });
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

describe('@omdc-slipkit/react 선택적 설정', () => {
  it('SlipViewer는 slipkit을 생략하면 요소에 쓰지 않고, 지정·갱신·제거를 그대로 반영한다', () => {
    const m = render(createElement(SlipViewer, { src: '' }));
    const el = m.container.querySelector('slip-viewer') as HTMLElement & { src: string; slipkit?: unknown; locale?: string };
    expect(el.src).toBe('');
    expect(el.slipkit).toBeUndefined();
    expect(el.locale).toBeUndefined();

    m.rerender(createElement(SlipViewer, { src: '', slipkit: DUMMY_SLIPKIT, locale: 'ko' }));
    expect(el.slipkit).toBe(DUMMY_SLIPKIT);
    expect(el.locale).toBe('ko');

    const other = { ...DUMMY_SLIPKIT } as SlipKit;
    m.rerender(createElement(SlipViewer, { src: '', slipkit: other, locale: 'ja' }));
    expect(el.slipkit).toBe(other);
    expect(el.locale).toBe('ja');

    m.rerender(createElement(SlipViewer, { src: '' }));
    expect(el.slipkit).toBeUndefined();
    expect(el.locale).toBeUndefined();
    m.unmount();
  });

  it('SlipDesigner는 maxImageBytes·settings·presets·storage를 생략하면 요소 기본값을 유지한다', () => {
    const m = render(createElement(SlipDesigner, { src: '' }));
    const el = m.container.querySelector('slip-designer') as SlipDesignerElement;
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);
    expect(el.settings).toBeUndefined();
    expect(el.presets).toBeUndefined();
    expect(el.storage).toBeUndefined();

    const settings = { getBarcodeKinds: () => [] };
    const storage = {} as NonNullable<SlipDesignerElement['storage']>;
    m.rerender(createElement(SlipDesigner, { src: '', maxImageBytes: 100, settings, presets: [], storage }));
    expect(el.maxImageBytes).toBe(100);
    expect(el.settings).toBe(settings);
    expect(el.presets).toEqual([]);
    expect(el.storage).toBe(storage);

    m.rerender(createElement(SlipDesigner, { src: '', maxImageBytes: 200 }));
    expect(el.maxImageBytes).toBe(200);
    expect(el.settings).toBeUndefined();

    m.rerender(createElement(SlipDesigner, { src: '' }));
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);
    m.unmount();
  });

  it('SlipForm은 maxImageBytes를 생략·지정·갱신·제거해도 요소 기본값과 명시값을 정확히 오간다', () => {
    const m = render(createElement(SlipForm, { src: '' }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    expect(el.maxImageBytes).toBe(DEFAULT_MAX_IMAGE_BYTES);

    m.rerender(createElement(SlipForm, { src: '', maxImageBytes: 100 }));
    expect(el.maxImageBytes).toBe(100);
    m.rerender(createElement(SlipForm, { src: '', maxImageBytes: 300 }));
    expect(el.maxImageBytes).toBe(300);
    m.rerender(createElement(SlipForm, { src: '', maxImageBytes: undefined }));
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
  await act(async () => {
    input.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    await el.updateComplete;
  });
}

describe('@omdc-slipkit/react 이미지 상한', () => {
  it('maxImageBytes를 생략하면 요소 기본값으로 실제 이미지를 받는다', async () => {
    const changes: SlipVoucherFile[] = [];
    const m = render(createElement(SlipForm, {
      src: TEMPLATE_SRC, slipkit: DUMMY_SLIPKIT, onSlipChange: (file) => changes.push(file),
    }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    await settle(el);
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(changes.at(-1)?.values.stamp).toBe(SAMPLE_PNG);
    expect(el.shadowRoot?.querySelector('.notice.error')).toBeNull();
    m.unmount();
  });

  it('maxImageBytes를 지정하면 그 상한을 넘는 이미지를 거부한다', async () => {
    const changes: SlipVoucherFile[] = [];
    const m = render(createElement(SlipForm, {
      src: TEMPLATE_SRC, slipkit: DUMMY_SLIPKIT, maxImageBytes: 10, onSlipChange: (file) => changes.push(file),
    }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    await settle(el);
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(changes.length).toBe(0);
    expect(el.shadowRoot?.querySelector('.notice.error')?.textContent).toContain('10B');

    // 상한을 제거하면 요소 기본값으로 돌아가 같은 이미지를 받는다.
    m.rerender(createElement(SlipForm, {
      src: TEMPLATE_SRC, slipkit: DUMMY_SLIPKIT, onSlipChange: (file) => changes.push(file),
    }));
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(changes.at(-1)?.values.stamp).toBe(SAMPLE_PNG);
    m.unmount();
  });
});

// ---------------------------------------------------------------------------
// 이벤트 연결
// ---------------------------------------------------------------------------

describe('@omdc-slipkit/react 이벤트', () => {
  it('SlipDesigner는 slip-change 이벤트의 양식 파일을 onSlipChange에 전달한다', () => {
    const received: SlipTemplateFile[] = [];
    const m = render(createElement(SlipDesigner, { src: '', onSlipChange: (file) => received.push(file) }));
    const el = m.container.querySelector('slip-designer')!;
    const file = makeTemplate();
    act(() => {
      el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
    });
    expect(received).toEqual([file]);
    m.unmount();
  });

  it('SlipForm은 값 변경을 전표로, 발행을 확정 전표로 각 콜백에 전달한다', async () => {
    const changes: SlipVoucherFile[] = [];
    const issued: SlipVoucherFile[] = [];
    const m = render(createElement(SlipForm, {
      src: TEMPLATE_SRC,
      slipkit: DUMMY_SLIPKIT,
      onSlipChange: (file) => changes.push(file),
      onSlipIssue: (file) => issued.push(file),
    }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    await settle(el);

    const memo = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === '비고')!;
    await act(async () => {
      memo.value = '메모';
      memo.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
    });
    expect(changes.at(-1)).toMatchObject({ kind: 'voucher', issued: false, values: { memo: '메모' } });

    await act(async () => {
      buttonByLabel(el, 'Issue').click();
      await el.updateComplete;
      await flush();
      await el.updateComplete;
    });
    expect(issued.length).toBe(1);
    expect(issued[0]).toMatchObject({ kind: 'voucher', issued: true, values: { memo: '메모' } });
    m.unmount();
  });

  it('핸들러를 바꾸면 옛 핸들러는 더 이상 불리지 않고, 언마운트 뒤에는 아무 핸들러도 불리지 않는다', () => {
    const first = vi.fn();
    const second = vi.fn();
    const m = render(createElement(SlipForm, { src: '', onSlipChange: first, onSlipIssue: first }));
    const el = m.container.querySelector('slip-form')!;
    const file = { kind: 'voucher' } as SlipVoucherFile;

    m.rerender(createElement(SlipForm, { src: '', onSlipChange: second, onSlipIssue: second }));
    act(() => {
      el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
      el.dispatchEvent(new CustomEvent('slip-issue', { detail: { file } }));
    });
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
    const m = render(createElement(SlipForm, { src: '', onSlipChange: generic, onSlipIssue: generic }));
    m.rerender(createElement(SlipDesigner, { src: '', onSlipChange: generic }));
    m.unmount();
  });
});

// ---------------------------------------------------------------------------
// ref 전달
// ---------------------------------------------------------------------------

describe('@omdc-slipkit/react ref', () => {
  /** 객체 ref의 연결·교체·해제를 세 컴포넌트에 같은 절차로 확인한다. */
  function checkObjectRef<E extends HTMLElement>(
    tag: string,
    make: (ref: RefObject<E | null>) => ReactNode,
  ): void {
    const first: RefObject<E | null> = { current: null };
    const second: RefObject<E | null> = { current: null };
    const m = render(make(first));
    const el = m.container.querySelector(tag) as E;
    expect(el).not.toBeNull();
    expect(first.current).toBe(el);

    // 다른 ref 객체로 바꾸면 옛 ref는 비워지고 새 ref가 같은 요소를 받는다.
    m.rerender(make(second));
    expect(first.current).toBeNull();
    expect(second.current).toBe(el);
    expect(m.container.querySelector(tag)).toBe(el);

    m.unmount();
    expect(second.current).toBeNull();
  }

  it('SlipViewer의 ref는 <slip-viewer> 요소를 연결·교체·해제한다', () => {
    checkObjectRef<SlipViewerElement>('slip-viewer', (ref) => createElement(SlipViewer, { src: '', ref }));
  });

  it('SlipDesigner의 ref는 <slip-designer> 요소를 연결·교체·해제한다', () => {
    checkObjectRef<SlipDesignerElement>('slip-designer', (ref) => createElement(SlipDesigner, { src: '', ref }));
  });

  it('SlipForm의 ref는 <slip-form> 요소를 연결·교체·해제한다', () => {
    checkObjectRef<SlipFormElement>('slip-form', (ref) => createElement(SlipForm, { src: '', ref }));
  });

  it('콜백 ref는 요소로 한 번, 언마운트 때 null로 한 번 불린다', () => {
    const calls: Array<SlipFormElement | null> = [];
    const ref: Ref<SlipFormElement> = (node) => {
      calls.push(node);
    };
    const m = render(createElement(SlipForm, { src: '', ref }));
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    expect(calls).toEqual([el]);

    // 같은 콜백이면 다시 렌더해도 다시 부르지 않는다.
    m.rerender(createElement(SlipForm, { src: '', maxImageBytes: 10, ref }));
    expect(calls).toEqual([el]);

    m.unmount();
    expect(calls).toEqual([el, null]);
  });

  it('정리 함수를 돌려주는 콜백 ref는 null 호출 대신 정리 함수가 불린다', () => {
    const attached: SlipViewerElement[] = [];
    const cleanup = vi.fn();
    const ref: Ref<SlipViewerElement> = (node) => {
      if (node) attached.push(node);
      return cleanup;
    };
    const m = render(createElement(SlipViewer, { src: '', ref }));
    const el = m.container.querySelector('slip-viewer') as SlipViewerElement;
    expect(attached).toEqual([el]);
    expect(cleanup).not.toHaveBeenCalled();

    m.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(attached).toEqual([el]);
  });

  it('ref를 바꿔도 설정 프로퍼티와 이벤트 연결은 같은 요소에 유지된다', () => {
    const first: RefObject<SlipDesignerElement | null> = { current: null };
    const second: RefObject<SlipDesignerElement | null> = { current: null };
    const received: SlipTemplateFile[] = [];
    const onSlipChange = (file: SlipTemplateFile): void => {
      received.push(file);
    };
    const m = render(createElement(SlipDesigner, { src: '', ref: first, maxImageBytes: 100, onSlipChange }));
    const el = first.current!;
    m.rerender(createElement(SlipDesigner, { src: '', ref: second, maxImageBytes: 100, onSlipChange }));
    expect(second.current).toBe(el);
    expect(el.maxImageBytes).toBe(100);
    const file = makeTemplate();
    act(() => {
      el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
    });
    expect(received).toEqual([file]);
    m.unmount();
  });
});

// ---------------------------------------------------------------------------
// 표준 HTML 속성과 DOM 이벤트 전달
// ---------------------------------------------------------------------------

describe('@omdc-slipkit/react 표준 속성', () => {
  it('className·style·id·title·role·tabIndex·aria-*·data-*가 요소에 그대로 전달된다', () => {
    const m = render(
      <SlipViewer
        src=""
        className="viewer"
        style={{ width: '10px' }}
        id="viewer-1"
        title="전표 뷰어"
        role="region"
        tabIndex={0}
        aria-label="발행된 전표"
        data-testid="viewer"
      />,
    );
    const el = m.container.querySelector('slip-viewer') as SlipViewerElement;
    expect(el.className).toBe('viewer');
    expect(el.style.width).toBe('10px');
    expect(el.id).toBe('viewer-1');
    expect(el.getAttribute('title')).toBe('전표 뷰어');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-label')).toBe('발행된 전표');
    expect(el.getAttribute('data-testid')).toBe('viewer');
    m.unmount();
  });

  it('className을 바꾸면 갱신되고 제거하면 지워진다', () => {
    const m = render(<SlipDesigner src="" className="a" />);
    const el = m.container.querySelector('slip-designer') as SlipDesignerElement;
    expect(el.className).toBe('a');
    m.rerender(<SlipDesigner src="" className="b c" />);
    expect(el.className).toBe('b c');
    m.rerender(<SlipDesigner src="" />);
    expect(el.hasAttribute('class')).toBe(false);
    expect(el.getAttribute('class')).toBeNull();
    m.unmount();
  });

  it('SlipForm에도 표준 속성이 전달된다', () => {
    const m = render(<SlipForm src="" className="form" data-testid="form" aria-label="전표 작성" />);
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    expect(el.className).toBe('form');
    expect(el.getAttribute('data-testid')).toBe('form');
    expect(el.getAttribute('aria-label')).toBe('전표 작성');
    m.unmount();
  });

  it('onClick과 onKeyDown 같은 DOM 이벤트 props가 요소의 이벤트를 받는다', () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    const m = render(<SlipForm src="" onClick={onClick} onKeyDown={onKeyDown} />);
    const el = m.container.querySelector('slip-form') as SlipFormElement;
    act(() => {
      el.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]?.[0]).toMatchObject({ key: 'Enter' });
    m.unmount();
  });

  it('나머지 props에 src가 섞여 있어도 전용 src가 우선한다', () => {
    const spread = { src: '{"kind":"ignored"}', className: 'x' } as Record<string, unknown>;
    const m = render(createElement(SlipViewer, { ...spread, src: '' } as never));
    const el = m.container.querySelector('slip-viewer') as SlipViewerElement;
    expect(el.src).toBe('');
    expect(el.className).toBe('x');
    m.unmount();
  });

  it('onClick이 함께 있어도 onSlipChange는 그대로 파일을 받는다', () => {
    const onClick = vi.fn();
    const received: SlipTemplateFile[] = [];
    const m = render(
      <SlipDesigner src="" onClick={onClick} onSlipChange={(file) => received.push(file)} />,
    );
    const el = m.container.querySelector('slip-designer') as SlipDesignerElement;
    const file = makeTemplate();
    act(() => {
      el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
      el.click();
    });
    expect(received).toEqual([file]);
    expect(onClick).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});
