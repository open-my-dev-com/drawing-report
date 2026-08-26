import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createSlipKit,
  isEncryptedSlipFile,
  SlipEncryptionError,
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
    expect(slip.evaluate('SUM(items.amount)', { values: { items: { amount: [1000, 2000] } } })).toBe(3000);
    // 컨텍스트에 로케일이 없으면 SlipKit 설정을 사용한다.
    expect(slip.evaluate('FORMAT_NUMBER(1234.5)', { values: {} })).toBe('1.234,5');
    // 평가 컨텍스트의 로케일이 SlipKit 설정보다 우선한다.
    expect(slip.evaluate('FORMAT_NUMBER(1234.5)', { values: {}, locale: 'ko-KR' })).toBe('1,234.5');
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

  it('오류 메시지는 기본 영어이고 설정 locale을 따른다', async () => {
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
});
