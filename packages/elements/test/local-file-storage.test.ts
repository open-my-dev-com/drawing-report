// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeSlipFile } from '@omdc-slipkit/core';
import { LocalFileStorage } from '../src/storage/local-file-storage.js';
import { presets } from '../src/presets.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('LocalFileStorage', () => {
  it('save는 id를 파일명으로 .slip 파일을 다운로드한다', async () => {
    const downloads: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    await new LocalFileStorage().save('거래명세서', presets[0]!.create());

    expect(downloads).toEqual(['거래명세서.slip']);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  it('load는 선택한 .slip 파일을 파싱해 돌려준다', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const storage = new LocalFileStorage();
    const promise = storage.load('무시되는-id');
    await flush();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const file = presets[1]!.create();
    const picked = new File([serializeSlipFile(file)], 'invoice.slip', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', { value: [picked] });
    input.dispatchEvent(new Event('change'));

    expect(await promise).toEqual(file);
  });

  it('load에서 잘못된 파일을 고르면 파싱 오류로 거부된다', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = new LocalFileStorage().load('무시');
    await flush();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const picked = new File(['{ 잘못된 json'], 'broken.slip', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [picked] });
    input.dispatchEvent(new Event('change'));

    await expect(promise).rejects.toMatchObject({ name: 'SlipParseError' });
  });

  it('delete와 list는 unsupported 오류를 던진다', async () => {
    const storage = new LocalFileStorage();
    await expect(storage.delete('x')).rejects.toMatchObject({
      name: 'SlipStorageError',
      code: 'unsupported',
    });
    await expect(storage.list()).rejects.toMatchObject({ code: 'unsupported' });
  });
});
