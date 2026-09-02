// @vitest-environment happy-dom
// 미리보기 복구 — 로케일·인스턴스 변경과 분리·재연결 때 PDF 미리보기를 다시 만드는지
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

import type { SlipKit } from '@omdc-slipkit/core';
import {
  strings,
  renderSlipToPdfMock,
  revokedUrls,
  installDesignerTestEnv,
  loadDesigner,
  flush,
  toolbarButton,
  DUMMY_PDF,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

async function settle(el: Designer): Promise<void> {
  await el.updateComplete;
  await flush();
  await el.updateComplete;
}

async function openPreview(el: Designer): Promise<void> {
  toolbarButton(el, strings.designer.preview).click();
  await settle(el);
}

function iframeSrc(el: Designer): string | null {
  return el.shadowRoot!.querySelector('iframe')?.getAttribute('src') ?? null;
}

describe('<slip-designer> 로케일·인스턴스 변경 시 미리보기', () => {
  it('미리보기가 열린 채 로케일이 바뀌면 이전 PDF를 버리고 다시 만든다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = await loadDesigner();
    await openPreview(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);
    expect(iframeSrc(el)).toBe('blob:test-1');

    el.locale = 'ja';
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(2);
    expect(renderSlipToPdfMock.mock.calls[1]![1]).toMatchObject({ locale: 'ja' });
    expect(revokedUrls()).toContain('blob:test-1');
    expect(iframeSrc(el)).toBe('blob:test-2');
    expect(warn.mock.calls.some(([message]) => String(message).includes('scheduled an update'))).toBe(false);
    warn.mockRestore();
    el.remove();
  });

  it('미리보기가 닫혀 있거나 PDF 로케일이 그대로면 다시 만들지 않는다', async () => {
    const el = await loadDesigner();
    el.locale = 'en';
    await settle(el);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();

    // SlipKit 로케일이 PDF 로케일을 정하므로 UI 로케일만 바뀌면 PDF는 그대로입니다.
    el.slipkit = { locale: 'ko' } as unknown as SlipKit;
    await settle(el);
    await openPreview(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);
    el.locale = 'ja';
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);

    // 인스턴스가 바뀌면 다시 만듭니다.
    el.slipkit = { locale: 'ja' } as unknown as SlipKit;
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(2);
    el.remove();
  });
});

describe('<slip-designer> 분리·재연결 시 미리보기', () => {
  it('분리된 동안 끝난 렌더 결과는 버리고, 다시 연결되면 현재 양식으로 복구한다', async () => {
    let finish: (bytes: Uint8Array) => void = () => undefined;
    renderSlipToPdfMock.mockImplementationOnce(
      () => new Promise<Uint8Array>((resolve) => { finish = resolve; }),
    );
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);

    el.remove();
    finish(DUMMY_PDF);
    await flush();
    // 분리 중 끝난 결과로는 오브젝트 URL을 만들지 않습니다.
    expect(vi.mocked(URL.createObjectURL)).not.toHaveBeenCalled();
    expect((el as unknown as { _previewUrl: string | null })._previewUrl).toBeNull();

    document.body.appendChild(el);
    await settle(el);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(1);
    expect(iframeSrc(el)).toBe('blob:test-1');
    expect(toolbarButton(el, strings.designer.edit)).toBeTruthy();
    el.remove();
  });

  it('분리될 때 오브젝트 URL을 해제하고 재연결 뒤 새 URL을 만든다', async () => {
    const el = await loadDesigner();
    await openPreview(el);
    expect(iframeSrc(el)).toBe('blob:test-1');

    el.remove();
    expect(revokedUrls()).toContain('blob:test-1');

    document.body.appendChild(el);
    await settle(el);
    expect(iframeSrc(el)).toBe('blob:test-2');
    el.remove();
  });

  it('미리보기가 닫힌 채 재연결되면 렌더하지 않는다', async () => {
    const el = await loadDesigner();
    el.remove();
    document.body.appendChild(el);
    await settle(el);
    expect(renderSlipToPdfMock).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('.canvas-area')).not.toBeNull();
    el.remove();
  });
});
