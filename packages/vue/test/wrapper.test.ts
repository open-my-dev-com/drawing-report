// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';
import type { SlipFile } from '@omdc-slipkit/core';
import { SlipDesigner, SlipViewer } from '../src/index.js';

const DUMMY_SETTINGS = { getFonts: () => [{ name: 'demo', data: new Uint8Array([1]) }] };

function mount(node: ReturnType<typeof h>): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  createApp({ render: () => node }).mount(container);
  return container;
}

describe('@omdc-slipkit/vue 래퍼', () => {
  it('SlipViewer는 slip-viewer 엘리먼트에 src·settings를 전달한다', () => {
    const container = mount(h(SlipViewer, { src: '', settings: DUMMY_SETTINGS }));
    const el = container.querySelector('slip-viewer') as HTMLElement & {
      src: string;
      settings?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.src).toBe('');
    expect(el.settings).toBe(DUMMY_SETTINGS);
  });

  it('SlipDesigner는 slip-change 이벤트를 다시 내보낸다', () => {
    const received: SlipFile[] = [];
    const container = mount(
      h(SlipDesigner, { src: '', onSlipChange: (file: SlipFile) => received.push(file) }),
    );
    const el = container.querySelector('slip-designer')!;

    const file = { schemaVersion: '0.1.0', kind: 'template' } as unknown as SlipFile;
    el.dispatchEvent(new CustomEvent('slip-change', { detail: { file } }));

    expect(received).toEqual([file]);
  });
});
