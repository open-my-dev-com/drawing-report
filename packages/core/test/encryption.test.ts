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
    // 암호화 봉투는 복호화 전에는 표준 `.slip` 파일로 파싱할 수 없다.
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
    // base64url 끝 문자의 패딩 비트를 피하기 위해 디코딩한 첫 바이트를 직접 변경한다.
    const bytes = Buffer.from(env.data, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    env.data = bytes.toString('base64url');
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

  it('봉투 버전이 없으면 거부한다 (SPEC §21.3)', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { v?: number };
    delete env.v;
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('봉투 버전');
  });

  it('지원하지 않는 봉투 버전은 거부한다 (SPEC §21.3)', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { v: number };
    env.v = 2;
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('봉투 버전');
  });

  it('지원하지 않는 키 파생 알고리즘은 거부한다', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { kdf: { algo: string } };
    env.kdf.algo = 'SCRYPT';
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('키 파생');
  });

  it('정상 범위를 벗어난 PBKDF2 반복 횟수는 거부한다', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { kdf: { iterations: number } };
    env.kdf.iterations = 100_000_000; // 상한 초과 — 악의적으로 큰 값
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('키 파생');
  });

  it('봉투에 적힌 반복 횟수로 키를 파생한다 — 기본값과 달라도 연다', async () => {
    // 봉투에 기록된 반복 횟수로 키를 파생하는지 확인하기 위해 기본값과 다른 봉투를 만든다.
    const file = template();
    const iterations = 100_000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('pw'), { name: 'PBKDF2' }, false, ['deriveKey'],
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    );
    const data = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(serializeSlipFile(file)),
    ));
    const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
    const envelope = JSON.stringify({
      slipkit: 'encrypted', v: 1, cipher: 'A256GCM',
      kdf: { algo: 'PBKDF2-SHA256', salt: b64u(salt), iterations },
      iv: b64u(iv), data: b64u(data),
    });
    await expect(decryptSlipFile(envelope, 'pw')).resolves.toEqual(file);
  });
});
