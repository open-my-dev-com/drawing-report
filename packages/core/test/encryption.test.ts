import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  encryptSlipFile,
  decryptSlipFile,
  isEncryptedSlipFile,
  SlipEncryptionError,
  parseSlipFile,
  serializeSlipFile,
  type SlipTemplateFile,
} from '../src/index.js';

function template(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '거래명세서' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      parameters: [{ key: 'total', valueType: 'number' }],
      pages: [{ elements: [] }],
      assets: [],
    },
  };
}

describe('파일 암호화 (ADR-054)', () => {
  it('암호(passphrase)로 잠그고 같은 암호로 되돌린다', async () => {
    const file = template();
    const locked = await encryptSlipFile(file, 'my-secret-passphrase');
    expect(isEncryptedSlipFile(locked)).toBe(true);
    // 잠근 파일은 표준 .slip이 아니다 — 그대로 파싱하면 거부된다
    expect(() => parseSlipFile(locked)).toThrow();
    const unlocked = await decryptSlipFile(locked, 'my-secret-passphrase');
    expect(unlocked).toEqual(file);
  });

  it('32바이트 원시 키로 잠그고 되돌린다', async () => {
    const file = template();
    const key = new Uint8Array(32).fill(7);
    const locked = await encryptSlipFile(file, key);
    const unlocked = await decryptSlipFile(locked, key);
    expect(unlocked).toEqual(file);
  });

  it('평문에 원본 제목이 남지 않는다 (내용이 잠긴다)', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    expect(locked).not.toContain('거래명세서');
  });

  it('틀린 암호는 복호화에 실패한다', async () => {
    const locked = await encryptSlipFile(template(), 'right');
    await expect(decryptSlipFile(locked, 'wrong')).rejects.toBeInstanceOf(SlipEncryptionError);
  });

  it('암호문이 변조되면 복호화에 실패한다 (AES-GCM 인증)', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { data: string };
    // data 마지막 글자를 바꿔 변조
    env.data = env.data.slice(0, -1) + (env.data.endsWith('A') ? 'B' : 'A');
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toBeInstanceOf(SlipEncryptionError);
  });

  it('키 종류가 다르면 거부한다 (암호로 잠근 걸 원시 키로 열기)', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    await expect(decryptSlipFile(locked, new Uint8Array(32))).rejects.toBeInstanceOf(SlipEncryptionError);
  });

  it('32바이트가 아닌 원시 키는 거부한다', async () => {
    await expect(encryptSlipFile(template(), new Uint8Array(16))).rejects.toBeInstanceOf(SlipEncryptionError);
  });

  it('봉투가 아닌 JSON을 복호화하면 거부한다', async () => {
    const plain = serializeSlipFile(template());
    expect(isEncryptedSlipFile(plain)).toBe(false);
    await expect(decryptSlipFile(plain, 'pw')).rejects.toBeInstanceOf(SlipEncryptionError);
  });
});
