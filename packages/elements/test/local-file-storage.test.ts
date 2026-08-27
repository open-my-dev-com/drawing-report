// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeSlipFile, isEncryptedSlipFile, type SlipFile } from '@omdc-slipkit/core';
import { LocalFileStorage } from '../src/storage/local-file-storage.js';
import { type StorageEncryption } from '../src/storage/encryption.js';
import { getPresets } from '../src/presets.js';

const presets = getPresets();

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

  it('load에서 파일 선택을 취소하면 cancelled 오류로 거부된다', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = new LocalFileStorage().load('무시');
    await flush();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.dispatchEvent(new Event('cancel'));

    await expect(promise).rejects.toMatchObject({
      name: 'SlipStorageError',
      code: 'cancelled',
    });
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

/** `save`가 다운로드한 Blob의 내용을 문자열로 반환한다. */
async function captureSavedText(
  file: SlipFile,
  encryption?: StorageEncryption,
): Promise<string> {
  let captured: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    captured = blob as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await new LocalFileStorage(encryption ? { encryption } : {}).save('doc', file);
  return captured!.text();
}

/** 파일 선택을 모의하고 `load` 결과를 반환한다. */
async function loadPicked(content: string, encryption?: StorageEncryption): Promise<SlipFile> {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const promise = new LocalFileStorage(encryption ? { encryption } : {}).load('무시');
  await flush();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const picked = new File([content], 'doc.slip', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [picked] });
  input.dispatchEvent(new Event('change'));
  return promise;
}

describe('LocalFileStorage 암호화 (ADR-055)', () => {
  it('키를 주면 저장 파일이 암호화 봉투가 되고, 같은 키로 열면 원본이 돌아온다', async () => {
    const file = presets[0]!.create();
    const saved = await captureSavedText(file, { enabled: true, key: '내-키' });
    expect(isEncryptedSlipFile(saved)).toBe(true);

    const loaded = await loadPicked(saved, { enabled: true, key: '내-키' });
    expect(loaded).toEqual(file);
  });

  it('키 없이 켜면 샘플 기본키로 잠가, 설정 없는 어댑터로도 열린다', async () => {
    const file = presets[0]!.create();
    const saved = await captureSavedText(file, { enabled: true });
    expect(isEncryptedSlipFile(saved)).toBe(true);

    expect(await loadPicked(saved)).toEqual(file); // 설정 없는 어댑터 = 샘플키
  });

  it('비활성이면 평문 .slip으로 저장된다', async () => {
    const file = presets[0]!.create();
    const saved = await captureSavedText(file, { enabled: false, key: '키' });
    expect(isEncryptedSlipFile(saved)).toBe(false);
    expect(saved).toBe(serializeSlipFile(file));
  });

  it('틀린 키로 암호화 파일을 열면 복호화 오류로 거부된다', async () => {
    const saved = await captureSavedText(presets[0]!.create(), { enabled: true, key: '맞는-키' });
    await expect(loadPicked(saved, { enabled: true, key: '틀린-키' })).rejects.toMatchObject({
      name: 'SlipEncryptionError',
    });
  });
});
