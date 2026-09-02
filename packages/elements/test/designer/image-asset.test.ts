// @vitest-environment happy-dom
// 고정 이미지의 캔버스 표시 — `data:`와 `asset://`를 PDF 변환과 같은 규칙으로 해석하는지
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
import { strings, parseSlipFileMock, makeTemplateFile, installDesignerTestEnv, loadDesigner } from './helpers.js';
import { PLACEHOLDER_IMG, resolveDisplayImage } from '../../src/designer/image-pick.js';

installDesignerTestEnv();

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/** MCP가 파일에 넣는 형태의 에셋 — id·mimeType·base64 `data:` URL */
function makeAssetFile(): SlipTemplateFile {
  const file = makeTemplateFile();
  file.template.assets = [
    { id: 'logo', mimeType: 'image/png', src: PNG },
    { id: 'alias', mimeType: 'image/png', src: 'asset://logo' },
  ];
  file.template.pages[0]!.elements = [
    { type: 'image', id: 'i-data', name: 'direct', position: { x: 10, y: 10 }, width: 20, height: 20, src: JPEG },
    { type: 'image', id: 'i-asset', name: 'from-asset', position: { x: 40, y: 10 }, width: 20, height: 20, src: 'asset://logo' },
    { type: 'image', id: 'i-missing', name: 'lost', position: { x: 70, y: 10 }, width: 20, height: 20, src: 'asset://nope' },
    { type: 'image', id: 'i-alias', name: 'chained', position: { x: 100, y: 10 }, width: 20, height: 20, src: 'asset://alias' },
    { type: 'image', id: 'i-empty', name: 'empty', position: { x: 130, y: 10 }, width: 20, height: 20, src: PLACEHOLDER_IMG },
  ] as never;
  return file;
}

describe('resolveDisplayImage (상태 비의존)', () => {
  const file = makeAssetFile();

  it('data: URL은 그대로, asset://은 에셋의 data: URL로 해석한다', () => {
    expect(resolveDisplayImage(file, JPEG)).toEqual({ kind: 'data', src: JPEG });
    expect(resolveDisplayImage(file, 'asset://logo')).toEqual({ kind: 'data', src: PNG });
  });

  it('없는 에셋과 data:가 아닌 에셋(다른 에셋을 가리키는 것 포함)은 사유를 돌려준다', () => {
    expect(resolveDisplayImage(file, 'asset://nope')).toEqual({ kind: 'missing', assetId: 'nope' });
    expect(resolveDisplayImage(file, 'asset://alias')).toEqual({ kind: 'notEmbedded', assetId: 'alias' });
    expect(resolveDisplayImage(null, 'asset://logo')).toEqual({ kind: 'missing', assetId: 'logo' });
  });

  it('자리표시 이미지·빈 값·외부 URL은 이미지 없음으로 본다', () => {
    expect(resolveDisplayImage(file, PLACEHOLDER_IMG)).toEqual({ kind: 'none' });
    expect(resolveDisplayImage(file, undefined)).toEqual({ kind: 'none' });
    expect(resolveDisplayImage(file, 'https://example.com/a.png')).toEqual({ kind: 'none' });
  });
});

describe('<slip-designer> 캔버스의 고정 이미지', () => {
  it('data:와 asset:// 이미지를 <img>로, 없는 에셋과 순환 참조는 안내 문구로 표시한다', async () => {
    parseSlipFileMock.mockReturnValue(makeAssetFile() as unknown as SlipFile);
    const el = await loadDesigner();
    const root = el.shadowRoot!;
    const s = strings.designer;

    expect(root.querySelector('[data-id="i-data"] img')?.getAttribute('src')).toBe(JPEG);
    expect(root.querySelector('[data-id="i-asset"] img')?.getAttribute('src')).toBe(PNG);

    expect(root.querySelector('[data-id="i-missing"] img')).toBeNull();
    const missing = root.querySelector('[data-id="i-missing"] .image-missing');
    expect(missing?.textContent).toContain(s.imageAssetMissing.replace('{id}', 'nope'));
    expect(missing?.getAttribute('aria-label')).toBe(s.imageAssetMissing.replace('{id}', 'nope'));

    expect(root.querySelector('[data-id="i-alias"] img')).toBeNull();
    expect(root.querySelector('[data-id="i-alias"] .image-missing')?.textContent)
      .toContain(s.imageAssetNotEmbedded.replace('{id}', 'alias'));

    expect(root.querySelector('[data-id="i-empty"] img')).toBeNull();
    expect(root.querySelector('[data-id="i-empty"] .el-content')?.textContent?.trim()).toBe(s.typeImage);
    el.remove();
  });
});
