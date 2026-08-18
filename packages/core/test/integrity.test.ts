import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SlipIntegrityError,
  canonicalize,
  computeContentHash,
  computeIntegrity,
  generateSigningKeyPair,
  verifyIntegrity,
  type SlipVoucherFile,
} from '../src/index.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeVoucher(overrides?: Partial<SlipVoucherFile>): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: {
      meta: { title: '테스트 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [
        {
          elements: [
            {
              type: 'text',
              id: 'title',
              name: '제목',
              position: { x: 15, y: 15 },
              width: 180,
              height: 10,
              content: '거래명세서',
              fontSize: 18,
              alignment: 'center',
            },
          ],
        },
      ],
      assets: [{ id: 'logo', mimeType: 'image/png', src: PNG_1PX }],
    },
    values: { title: '테스트 전표' },
    issued: true,
    integrity: { contentHash: 'a'.repeat(64) },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// JCS 정규화 (RFC 8785)
// ---------------------------------------------------------------------------

describe('JCS 정규화 (RFC 8785)', () => {
  it('null / boolean / number / string을 올바르게 직렬화한다', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(3.14)).toBe('3.14');
    expect(canonicalize('')).toBe('""');
    expect(canonicalize('hello')).toBe('"hello"');
  });

  it('객체 키를 정렬한다', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalize({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  it('중첩 객체도 재귀적으로 키를 정렬한다', () => {
    const input = { b: { d: 4, c: 3 }, a: 1 };
    expect(canonicalize(input)).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('배열 순서를 보존한다', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('undefined 값을 가진 속성은 생략한다', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('빈 객체와 빈 배열을 처리한다', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('이스케이프가 필요한 문자열을 올바르게 처리한다', () => {
    expect(canonicalize('line\nnew')).toBe('"line\\nnew"');
    expect(canonicalize('"quote"')).toBe('"\\"quote\\""');
  });

  it('Infinity와 NaN은 거부한다', () => {
    expect(() => canonicalize(Infinity)).toThrow(TypeError);
    expect(() => canonicalize(-Infinity)).toThrow(TypeError);
    expect(() => canonicalize(NaN)).toThrow(TypeError);
  });

  it('같은 내용이면 항상 같은 문자열을 반환한다', () => {
    const a = { schemaVersion: '0.1.0', kind: 'voucher', values: { x: 1 } };
    const b = { kind: 'voucher', values: { x: 1 }, schemaVersion: '0.1.0' };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

// ---------------------------------------------------------------------------
// contentHash 계산
// ---------------------------------------------------------------------------

describe('contentHash 계산', () => {
  it('SHA-256 소문자 hex 64자를 반환한다', async () => {
    const hash = await computeContentHash(makeVoucher());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('같은 전표는 항상 같은 해시를 반환한다', async () => {
    const v = makeVoucher();
    const h1 = await computeContentHash(v);
    const h2 = await computeContentHash(v);
    expect(h1).toBe(h2);
  });

  it('integrity 필드 값이 달라도 해시에 영향을 주지 않는다', async () => {
    const v1 = makeVoucher({ integrity: { contentHash: 'a'.repeat(64) } });
    const v2 = makeVoucher({ integrity: { contentHash: 'b'.repeat(64) } });
    expect(await computeContentHash(v1)).toBe(await computeContentHash(v2));
  });

  it('값이 다르면 해시가 달라진다', async () => {
    const v1 = makeVoucher();
    const v2 = makeVoucher({ values: { title: '다른 값' } });
    expect(await computeContentHash(v1)).not.toBe(await computeContentHash(v2));
  });
});

// ---------------------------------------------------------------------------
// 해시 전용 무결성 (서명 없이)
// ---------------------------------------------------------------------------

describe('해시 전용 무결성', () => {
  it('computeIntegrity로 올바른 contentHash를 생성한다', async () => {
    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher);
    expect(integrity.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(integrity.signature).toBeUndefined();
  });

  it('생성한 해시로 verifyIntegrity가 통과한다', async () => {
    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher);
    const sealed = { ...voucher, integrity };
    await expect(verifyIntegrity(sealed)).resolves.toBeUndefined();
  });

  it('변조된 전표는 verifyIntegrity가 실패한다', async () => {
    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher);
    const tampered = { ...voucher, integrity, values: { title: '위조' } };
    await expect(verifyIntegrity(tampered)).rejects.toThrow(SlipIntegrityError);
    await expect(verifyIntegrity(tampered)).rejects.toThrow(/변조/);
  });

  it('integrity 필드가 없으면 실패한다', async () => {
    const voucher = makeVoucher();
    const { integrity: _, ...noIntegrity } = voucher;
    await expect(
      verifyIntegrity(noIntegrity as SlipVoucherFile),
    ).rejects.toThrow(SlipIntegrityError);
  });
});

// ---------------------------------------------------------------------------
// JWS(ES256) 서명
// ---------------------------------------------------------------------------

describe('JWS(ES256) 서명', () => {
  it('키 쌍을 생성할 수 있다', async () => {
    const keyPair = await generateSigningKeyPair();
    expect(keyPair.privateKey.kty).toBe('EC');
    expect(keyPair.publicKey.kty).toBe('EC');
    expect(keyPair.privateKey.d).toBeDefined();
    expect(keyPair.publicKey.d).toBeUndefined();
  });

  it('서명 포함 무결성을 생성하고 검증한다', async () => {
    const keyPair = await generateSigningKeyPair();
    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher, keyPair.privateKey);

    expect(integrity.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(integrity.signature).toBeDefined();
    expect(integrity.signature).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const sealed = { ...voucher, integrity };
    await expect(verifyIntegrity(sealed, keyPair.publicKey)).resolves.toBeUndefined();
  });

  it('다른 키로 서명된 전표는 검증 실패한다', async () => {
    const keyPairA = await generateSigningKeyPair();
    const keyPairB = await generateSigningKeyPair();

    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher, keyPairA.privateKey);
    const sealed = { ...voucher, integrity };

    await expect(verifyIntegrity(sealed, keyPairB.publicKey)).rejects.toThrow(
      SlipIntegrityError,
    );
  });

  it('서명이 있지만 공개키 없이 검증하면 실패한다', async () => {
    const keyPair = await generateSigningKeyPair();
    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher, keyPair.privateKey);
    const sealed = { ...voucher, integrity };

    await expect(verifyIntegrity(sealed)).rejects.toThrow(/공개키/);
  });

  it('서명이 없으면 공개키 없이도 해시 검증만으로 통과한다', async () => {
    const voucher = makeVoucher();
    const integrity = await computeIntegrity(voucher);
    const sealed = { ...voucher, integrity };

    await expect(verifyIntegrity(sealed)).resolves.toBeUndefined();
  });
});
