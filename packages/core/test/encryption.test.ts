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
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('envelope version');
  });

  it('지원하지 않는 봉투 버전은 거부한다 (SPEC §21.3)', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { v: number };
    env.v = 2;
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('envelope version');
  });

  it('지원하지 않는 키 파생 알고리즘은 거부한다', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { kdf: { algo: string } };
    env.kdf.algo = 'SCRYPT';
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('key derivation');
  });

  it('새 봉투는 OWASP 권고 반복 횟수로 키를 파생한다', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { kdf: { algo: string; iterations: number } };
    expect(env.kdf.algo).toBe('PBKDF2-SHA256');
    expect(env.kdf.iterations).toBe(600_000);
  });

  it('정상 범위를 벗어난 PBKDF2 반복 횟수는 거부한다', async () => {
    const locked = await encryptSlipFile(template(), 'pw');
    const env = JSON.parse(locked) as { kdf: { iterations: number } };
    env.kdf.iterations = 100_000_000; // 상한 초과 — 악의적으로 큰 값
    await expect(decryptSlipFile(JSON.stringify(env), 'pw')).rejects.toThrow('key derivation');
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

describe('메시지 언어 (로케일 설정)', () => {
  it('기본은 영어 메시지다', async () => {
    await expect(decryptSlipFile('{"x":1}', 'pw')).rejects.toThrow('Not an encrypted');
  });

  it("locale이 'ko-KR'이면 한국어 메시지를 표시한다", async () => {
    await expect(decryptSlipFile('{"x":1}', 'pw', { locale: 'ko-KR' })).rejects.toThrow(
      '`.slip` 암호화 봉투 형식이 아닙니다',
    );
  });

  it("locale이 'ja'이면 일본어 메시지를 표시한다", async () => {
    await expect(decryptSlipFile('{"x":1}', 'pw', { locale: 'ja' })).rejects.toThrow(
      'エンベロープの形式ではありません',
    );
  });
});

describe('봉투 검증 — 손상된 봉투는 모두 SlipEncryptionError로 보고한다 (SPEC §21.3)', () => {
  async function envelopeOf(key: string | Uint8Array = 'pw'): Promise<Record<string, unknown>> {
    return JSON.parse(await encryptSlipFile(template(), key)) as Record<string, unknown>;
  }
  const rejects = (env: unknown, key: string | Uint8Array = 'pw') =>
    expect(decryptSlipFile(JSON.stringify(env), key)).rejects;

  it.each([
    ['salt 누락', (e: Record<string, unknown>) => { delete (e['kdf'] as Record<string, unknown>)['salt']; }, "'kdf.salt'"],
    ['salt 오형식', (e: Record<string, unknown>) => { (e['kdf'] as Record<string, unknown>)['salt'] = '***'; }, "'kdf.salt'"],
    ['salt 길이 불일치', (e: Record<string, unknown>) => { (e['kdf'] as Record<string, unknown>)['salt'] = 'AAAA'; }, "'kdf.salt'"],
    ['salt가 문자열이 아님', (e: Record<string, unknown>) => { (e['kdf'] as Record<string, unknown>)['salt'] = 12; }, "'kdf.salt'"],
    ['iv 누락', (e: Record<string, unknown>) => { delete e['iv']; }, "'iv'"],
    ['iv 오형식', (e: Record<string, unknown>) => { e['iv'] = 'not base64url!'; }, "'iv'"],
    ['iv 길이 불일치', (e: Record<string, unknown>) => { e['iv'] = 'AAAAAAAA'; }, "'iv'"],
    ['data 누락', (e: Record<string, unknown>) => { delete e['data']; }, "'data'"],
    ['data 오형식', (e: Record<string, unknown>) => { e['data'] = 'A'; }, "'data'"],
    ['data가 객체', (e: Record<string, unknown>) => { e['data'] = { x: 1 }; }, "'data'"],
    ['빈 암호문', (e: Record<string, unknown>) => { e['data'] = ''; }, "'data'"],
    ['kdf가 null', (e: Record<string, unknown>) => { e['kdf'] = null; }, "'kdf'"],
    ['kdf가 배열', (e: Record<string, unknown>) => { e['kdf'] = []; }, "'kdf'"],
  ])('%s → 봉투 손상 오류', async (_label, mutate, field) => {
    const env = await envelopeOf();
    mutate(env);
    await rejects(env).toBeInstanceOf(SlipEncryptionError);
    await rejects(env).toThrow(field);
  });

  it('kdf가 null이면 빈 솔트로 해석하지 않고 손상으로 보고한다 (원시 키로도 마찬가지)', async () => {
    const env = await envelopeOf(new Uint8Array(32).fill(7));
    env['kdf'] = null;
    await rejects(env, new Uint8Array(32).fill(7)).toThrow("'kdf'");
  });

  it('반복 횟수가 숫자가 아니면 키 파생 방식 오류로 보고한다', async () => {
    const env = await envelopeOf();
    (env['kdf'] as Record<string, unknown>)['iterations'] = '600000';
    await rejects(env).toThrow('key derivation');
  });

  it('버전을 암호보다 먼저 검사한다 — v: 2인 봉투는 미래 버전으로 보고한다', async () => {
    const env = await envelopeOf();
    env['v'] = 2;
    env['cipher'] = 'A256GCM-SIV';
    await rejects(env).toThrow('envelope version');
  });

  it('지원하지 않는 암호 방식은 별도 오류로 보고한다', async () => {
    const env = await envelopeOf();
    env['cipher'] = 'CHACHA';
    await rejects(env).toThrow('cipher');
  });

  it('slipkit 표식이 없거나 JSON이 객체가 아니면 봉투 아님으로 보고한다', async () => {
    await expect(decryptSlipFile('[1,2]', 'pw')).rejects.toThrow('Not an encrypted');
    await expect(decryptSlipFile('null', 'pw')).rejects.toThrow('Not an encrypted');
    await expect(decryptSlipFile('{{', 'pw')).rejects.toThrow('Not an encrypted');
  });

  it('손상 메시지는 세 언어로 제공한다', async () => {
    const env = await envelopeOf();
    env['iv'] = 'AAAA';
    const json = JSON.stringify(env);
    await expect(decryptSlipFile(json, 'pw')).rejects.toThrow("The encrypted envelope is corrupted — the 'iv' field");
    await expect(decryptSlipFile(json, 'pw', { locale: 'ko-KR' })).rejects.toThrow("암호화 봉투가 손상되었습니다. 'iv' 필드");
    await expect(decryptSlipFile(json, 'pw', { locale: 'ja' })).rejects.toThrow("暗号化エンベロープが破損しています — 'iv' フィールド");
    env['cipher'] = 'X';
    await expect(decryptSlipFile(JSON.stringify(env), 'pw', { locale: 'ko-KR' })).rejects.toThrow('지원하지 않는 암호 방식');
    await expect(decryptSlipFile(JSON.stringify(env), 'pw', { locale: 'ja' })).rejects.toThrow('サポートされていない暗号方式');
  });
});
