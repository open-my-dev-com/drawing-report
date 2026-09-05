import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createSlipKit,
  isEncryptedSlipFile,
  SlipEncryptionError,
  SlipParseError,
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

describe('createSlipKit (ADR-056)', () => {
  it('buildVoucher는 발행 전 전표를 조립한다', () => {
    const slip = createSlipKit();
    const voucher = slip.buildVoucher(template(), { total: 100 });
    expect(voucher.kind).toBe('voucher');
    expect(voucher.issued).toBe(false);
    expect(voucher.values.total).toBe(100);
  });

  it('evaluate는 수식을 계산하고, 컨텍스트에 로케일이 없으면 설정 로케일을 쓴다', () => {
    const slip = createSlipKit({ locale: 'de-DE' });
    expect(slip.evaluate('SUM($(items).$(amount))', { values: { items: { amount: [1000, 2000] } } })).toBe(3000);
    // 컨텍스트에 로케일이 없으면 SlipKit 설정을 사용한다.
    expect(slip.evaluate('FORMAT_NUMBER(1234.5)', { values: {} })).toBe('1.234,5');
    // 평가 컨텍스트의 로케일이 SlipKit 설정보다 우선한다.
    expect(slip.evaluate('FORMAT_NUMBER(1234.5)', { values: {}, locale: 'ko-KR' })).toBe('1,234.5');
  });

  it('getFonts는 인스턴스 안에서 한 번만 호출하고 결과를 공유한다', async () => {
    const fonts = [{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }];
    const supply = vi.fn(() => fonts);
    const slip = createSlipKit({ getFonts: supply });

    // 디자이너와 렌더링 경로가 같은 조회 결과를 공유합니다.
    await slip.getFonts!();
    await slip.getFonts!();
    await slip.render(template());
    await slip.render(template());
    expect(supply).toHaveBeenCalledTimes(1);
  });

  it('getFonts 조회에 실패하면 다음 호출에서 다시 시도한다', async () => {
    const fonts = [{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }];
    let attempt = 0;
    const supply = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('네트워크 오류'));
      return Promise.resolve(fonts);
    });
    const slip = createSlipKit({ getFonts: supply });

    await expect(slip.getFonts!()).rejects.toThrow('네트워크 오류');
    await expect(slip.getFonts!()).resolves.toEqual(fonts);
    expect(supply).toHaveBeenCalledTimes(2);
  });

  it('getFonts에서 동기 예외가 발생해도 Promise 거부로 처리하고 다시 시도한다', async () => {
    const fonts = [{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }];
    let attempt = 0;
    const supply = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) throw new Error('설정 오류');
      return fonts;
    });
    const slip = createSlipKit({ getFonts: supply });

    // 호출은 동기 예외를 던지지 않고 거부된 Promise를 반환합니다.
    await expect(slip.getFonts!()).rejects.toThrow('설정 오류');
    await expect(slip.getFonts!()).resolves.toEqual(fonts);
    expect(supply).toHaveBeenCalledTimes(2);
  });

  it('encrypt/decrypt는 설정 키로 왕복한다', async () => {
    const slip = createSlipKit({ encryption: { key: 'cfg-key' } });
    const locked = await slip.encrypt(template());
    expect(isEncryptedSlipFile(locked)).toBe(true);
    expect(await slip.decrypt(locked)).toEqual(template());
  });

  it('encrypt는 인자 키로 설정 키를 덮어쓴다', async () => {
    const slip = createSlipKit({ encryption: { key: 'cfg' } });
    const locked = await slip.encrypt(template(), 'override');
    // 호출 시 전달한 키가 SlipKit 기본 키보다 우선한다.
    await expect(slip.decrypt(locked)).rejects.toBeInstanceOf(SlipEncryptionError);
    expect(await slip.decrypt(locked, 'override')).toEqual(template());
  });

  it('decrypt는 previousKeys로 옛 키로 잠근 파일을 푼다 (키 회전)', async () => {
    const locked = await createSlipKit({ encryption: { key: 'old' } }).encrypt(template());
    const rotated = createSlipKit({ encryption: { key: 'new', previousKeys: ['old'] } });
    expect(await rotated.decrypt(locked)).toEqual(template());
  });

  it('키가 없으면 encrypt·decrypt가 오류를 던진다', async () => {
    const slip = createSlipKit();
    await expect(slip.encrypt(template())).rejects.toBeInstanceOf(SlipEncryptionError);
    await expect(slip.decrypt('{}')).rejects.toBeInstanceOf(SlipEncryptionError);
  });

  it('오류 메시지는 기본적으로 영어를 사용하고 설정한 locale을 따른다', async () => {
    await expect(createSlipKit().encrypt(template())).rejects.toThrow('No encryption key');
    await expect(createSlipKit({ locale: 'ko-KR' }).encrypt(template())).rejects.toThrow(
      '암호화 키가 없습니다',
    );
    await expect(createSlipKit({ locale: 'ja' }).encrypt(template())).rejects.toThrow(
      '暗号化キーがありません',
    );
  });

  it('render는 PDF 바이트를 만든다', async () => {
    const pdf = await createSlipKit().render(template());
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
  });

  it('인스턴스는 설정된 locale과 getFonts를 노출한다 — UI와 저장소가 재사용한다', async () => {
    const fonts = [{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }];
    const slip = createSlipKit({ locale: 'ko', getFonts: () => fonts });
    expect(slip.locale).toBe('ko');
    // 조회 결과를 공유하도록 감싸므로 함수 자체가 아니라 반환값으로 확인합니다.
    await expect(slip.getFonts!()).resolves.toEqual(fonts);

    const bare = createSlipKit();
    expect(bare.locale).toBeUndefined();
    expect(bare.getFonts).toBeUndefined();
  });
});

describe('SlipKit.decrypt — 키 순회와 오류 구분', () => {
  it('원시 키와 암호 문구가 섞인 previousKeys를 끝까지 시도한다', async () => {
    const raw = new Uint8Array(32).fill(3);
    const locked = await createSlipKit({ encryption: { key: 'oldest' } }).encrypt(template());
    const rotated = createSlipKit({ encryption: { key: raw, previousKeys: [new Uint8Array(32).fill(9), 'wrong', 'oldest'] } });
    expect(await rotated.decrypt(locked)).toEqual(template());
  });

  it('어떤 키도 맞지 않으면 "일치하는 키 없음"으로 보고한다', async () => {
    const locked = await createSlipKit({ encryption: { key: 'a' } }).encrypt(template());
    const slip = createSlipKit({ encryption: { key: 'b', previousKeys: [new Uint8Array(32), 'c'] } });
    await expect(slip.decrypt(locked)).rejects.toThrow('no matching key');
    await expect(createSlipKit({ locale: 'ko-KR', encryption: { key: 'b', previousKeys: ['c'] } }).decrypt(locked))
      .rejects.toThrow('일치하는 키가 없습니다');
  });

  it('키가 하나뿐이면 그 키의 오류를 그대로 보고한다', async () => {
    const locked = await createSlipKit({ encryption: { key: 'a' } }).encrypt(template());
    await expect(createSlipKit({ encryption: { key: 'b' } }).decrypt(locked)).rejects.toThrow('key is wrong');
    await expect(createSlipKit({ encryption: { key: new Uint8Array(32) } }).decrypt(locked))
      .rejects.toThrow('locked with a passphrase');
  });

  it('봉투가 손상되면 키를 시도하지 않고 손상 오류를 보고한다', async () => {
    const locked = await createSlipKit({ encryption: { key: 'a' } }).encrypt(template());
    const env = JSON.parse(locked) as Record<string, unknown>;
    env['iv'] = 'AAAA';
    const slip = createSlipKit({ encryption: { key: 'b', previousKeys: ['a'] } });
    await expect(slip.decrypt(JSON.stringify(env))).rejects.toThrow("'iv' field");
    await expect(slip.decrypt('{"x":1}')).rejects.toThrow('Not an encrypted');
  });

  it('복호화는 됐지만 내용이 .slip이 아니면 SlipParseError를 그대로 전달한다', async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const rawKey = new Uint8Array(32).fill(5);
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode('{"kind":"nope"}')));
    const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
    const envelope = JSON.stringify({ slipkit: 'encrypted', v: 1, cipher: 'A256GCM', iv: b64u(iv), data: b64u(data) });
    const slip = createSlipKit({ encryption: { key: rawKey, previousKeys: ['other'] } });
    await expect(slip.decrypt(envelope)).rejects.toBeInstanceOf(SlipParseError);
  });
});
