// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { SlipFile } from '@omdc-slipkit/core';
import { SlipDesigner, SlipViewer, type SlipViewerProps } from '../src/index.js';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

function render(node: Parameters<ReturnType<typeof createRoot>['render']>[0]): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return container;
}

const DUMMY_SETTINGS: SlipViewerProps['settings'] = {
  getFonts: () => [{ name: 'demo', data: new Uint8Array([1]) }],
};

describe('@omdc-slipkit/react 래퍼', () => {
  it('SlipViewer는 slip-viewer 엘리먼트에 src·settings를 전달한다', () => {
    const container = render(createElement(SlipViewer, { src: '', settings: DUMMY_SETTINGS }));
    const el = container.querySelector('slip-viewer') as HTMLElement & {
      src: string;
      settings?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.src).toBe('');
    expect(el.settings).toBe(DUMMY_SETTINGS);
  });

  it('SlipDesigner는 slip-change 이벤트를 onSlipChange 콜백으로 전달한다', () => {
    const received: SlipFile[] = [];
    const container = render(
      createElement(SlipDesigner, { src: '', onSlipChange: (file) => received.push(file) }),
    );
    const el = container.querySelector('slip-designer')!;

    const file = { schemaVersion: '0.1.0', kind: 'template' } as unknown as SlipFile;
    act(() => {
      el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));
    });

    expect(received).toEqual([file]);
  });
});
