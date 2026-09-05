// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSlipKit,
  serializeSlipFile,
  isEncryptedSlipFile,
  type SlipFile,
  type SlipKit,
} from '@omdc-slipkit/core';
import { SlipFileExchange } from '../src/storage/file-exchange.js';
import { deserializeFromStorage } from '../src/storage/encryption.js';
import { getPresets } from '../src/presets.js';

const presets = getPresets();

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** `download`가 내려받은 Blob의 내용을 문자열로 반환한다. */
async function captureDownloadedText(
  slipkit: SlipKit,
  file: SlipFile,
  encryptOnSave: boolean,
  onDownload?: (name: string) => void,
): Promise<string> {
  let captured: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    captured = blob as Blob;
    return 'blob:test';
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    onDownload?.(this.download);
  });
  await new SlipFileExchange(slipkit, { encryptOnSave }).download('doc', file);
  expect(revoke).toHaveBeenCalledWith('blob:test');
  return captured!.text();
}

/** 파일 선택을 모의하고 `open` 결과를 반환한다. */
async function openPicked(slipkit: SlipKit, content: string): Promise<SlipFile> {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const promise = new SlipFileExchange(slipkit).open();
  await flush();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const picked = new File([content], 'doc.slip', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [picked] });
  input.dispatchEvent(new Event('change'));
  return promise;
}

describe('SlipFileExchange', () => {
  it('download는 이름에 .slip 확장자를 붙여 내려받는다', async () => {
    const names: string[] = [];
    await captureDownloadedText(createSlipKit(), presets[0]!.create(), false, (n) => names.push(n));
    expect(names).toEqual(['doc.slip']);
  });

  it('open은 선택한 .slip 파일을 파싱해 돌려준다', async () => {
    const file = presets[1]!.create();
    expect(await openPicked(createSlipKit(), serializeSlipFile(file))).toEqual(file);
  });

  it('open에서 잘못된 파일을 고르면 파싱 오류로 거부된다', async () => {
    await expect(openPicked(createSlipKit(), '{ 잘못된 json')).rejects.toMatchObject({
      name: 'SlipParseError',
    });
  });

  it('open에서 파일 선택을 취소하면 cancelled 오류로 거부된다', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = new SlipFileExchange(createSlipKit()).open();
    await flush();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.dispatchEvent(new Event('cancel'));

    await expect(promise).rejects.toMatchObject({
      name: 'SlipStorageError',
      code: 'cancelled',
    });
  });
});

describe('SlipFileExchange 암호화 — 공통 키 재사용', () => {
  it('createSlipKit에 키를 한 번 설정하면 암호화 내려받기와 열기가 그 키를 쓴다', async () => {
    const slipkit = createSlipKit({ encryption: { key: '내-키' } });
    const file = presets[0]!.create();
    const saved = await captureDownloadedText(slipkit, file, true);
    expect(isEncryptedSlipFile(saved)).toBe(true);

    expect(await openPicked(slipkit, saved)).toEqual(file);
  });

  it('encryptOnSave: false면 평문으로 저장되지만 암호화 파일 열기는 가능하다', async () => {
    const slipkit = createSlipKit({ encryption: { key: '내-키' } });
    const file = presets[0]!.create();

    const plain = await captureDownloadedText(slipkit, file, false);
    expect(isEncryptedSlipFile(plain)).toBe(false);
    expect(plain).toBe(serializeSlipFile(file));

    const encrypted = await slipkit.encrypt(file);
    expect(await openPicked(slipkit, encrypted)).toEqual(file);
  });

  it('이전 키로 암호화한 파일도 previousKeys 폴백으로 열린다', async () => {
    const oldKit = createSlipKit({ encryption: { key: '옛-키' } });
    const file = presets[0]!.create();
    const saved = await captureDownloadedText(oldKit, file, true);

    const rotated = createSlipKit({ encryption: { key: '새-키', previousKeys: ['옛-키'] } });
    expect(await openPicked(rotated, saved)).toEqual(file);
  });

  it('키 없이 암호화 내려받기를 하면 샘플 키로 대체하지 않고 오류를 던진다', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exchange = new SlipFileExchange(createSlipKit(), { encryptOnSave: true });
    await expect(exchange.download('doc', presets[0]!.create())).rejects.toMatchObject({
      name: 'SlipEncryptionError',
    });
  });

  it('키 없는 설정으로 암호화 파일을 열면 샘플 키로 대체하지 않고 오류를 던진다', async () => {
    const saved = await captureDownloadedText(
      createSlipKit({ encryption: { key: '내-키' } }),
      presets[0]!.create(),
      true,
    );
    await expect(openPicked(createSlipKit(), saved)).rejects.toMatchObject({
      name: 'SlipEncryptionError',
    });
  });

  it('틀린 키로 암호화 파일을 열면 복호화 오류로 거부된다', async () => {
    const saved = await captureDownloadedText(
      createSlipKit({ encryption: { key: '맞는-키' } }),
      presets[0]!.create(),
      true,
    );
    await expect(
      openPicked(createSlipKit({ encryption: { key: '틀린-키' } }), saved),
    ).rejects.toMatchObject({ name: 'SlipEncryptionError' });
  });
});

describe('SlipFileExchange — 앞에 BOM이 붙은 파일', () => {
  /** UTF-8 BOM (U+FEFF) */
  const BOM = '\uFEFF';

  it('open은 BOM으로 시작하는 평문 .slip을 파싱한다', async () => {
    const file = presets[0]!.create();
    expect(await openPicked(createSlipKit(), BOM + serializeSlipFile(file))).toEqual(file);
  });

  it('open은 BOM으로 시작하는 암호화 .slip을 복호화한다', async () => {
    const slipkit = createSlipKit({ encryption: { key: '내-키' } });
    const file = presets[0]!.create();
    const encrypted = await slipkit.encrypt(file);
    expect(encrypted.charAt(0)).toBe('{');
    expect(await openPicked(slipkit, BOM + encrypted)).toEqual(file);
  });

  it('deserializeFromStorage는 BOM으로 시작하는 평문·암호화 문자열을 모두 읽는다', async () => {
    const slipkit = createSlipKit({ encryption: { key: '내-키' } });
    const file = presets[0]!.create();
    expect(await deserializeFromStorage(slipkit, BOM + serializeSlipFile(file))).toEqual(file);
    expect(await deserializeFromStorage(slipkit, BOM + (await slipkit.encrypt(file)))).toEqual(file);
  });
});
