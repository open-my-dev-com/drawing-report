/**
 * 렌더링, 수식 평가, 암호화에 공통 설정을 적용하는 core API.
 *
 * 설정이 필요 없는 순수 함수({@link parseSlipFile} 등)는 별도로 내보낸다.
 */
import { buildVoucher } from './format/voucher.js';
import type { JsonValue, SlipFile, SlipTemplateFile, SlipVoucherFile } from './format/schema.js';
import { createPdfRenderer, type SlipFont } from './render/index.js';
import type { FormulaAst } from './formula/parser.js';
import { evaluateFormula, type FormulaContext, type FormulaValue } from './formula/evaluator.js';
import { encryptSlipFile, decryptSlipFile } from './encryption/index.js';
import { SlipEncryptionError } from './encryption/errors.js';

/** 파일별 암호화에 사용하는 암호문 또는 32바이트 원시 키 */
type EncryptionKey = string | Uint8Array;

/** {@link createSlipKit}에 적용할 공통 설정 */
export interface SlipKitConfig {
  /**
   * 렌더링에 사용할 폰트를 반환하는 함수.
   * 서버나 네트워크에서 비동기로 불러올 수 있다. 생략하면 렌더링 엔진의 기본 폰트를 사용한다.
   */
  getFonts?: () => readonly SlipFont[] | Promise<readonly SlipFont[]>;
  /**
   * `FORMAT_NUMBER` 등 형식 함수에 사용할 BCP 47 로케일.
   * 렌더링과 `evaluate`에 함께 적용된다.
   *
   * @defaultValue `'ko-KR'`
   */
  locale?: string;
  /**
   * 암호화 기본 설정. `key`를 주면 `encrypt`/`decrypt`가 이 키를 기본으로 쓴다.
   * 메서드에 키를 전달하면 해당 호출에만 그 키를 사용한다. `previousKeys`는 키를 변경하기 전에
   * 암호화한 파일을 복호화할 때 순서대로 시도한다.
   */
  encryption?: { key: EncryptionKey; previousKeys?: EncryptionKey[] };
}

/** {@link createSlipKit}가 반환하는 core API */
export interface SlipKit {
  /**
   * `.slip` 파일을 설정된 폰트와 로케일로 렌더링한다.
   *
   * @param file - 렌더할 `.slip` 파일 (양식 또는 전표)
   * @returns PDF 파일 바이트
   */
  render(file: SlipFile): Promise<Uint8Array>;
  /**
   * 양식과 값을 발행 전 전표로 조립한다.
   *
   * @param template - 양식 파일
   * @param values - 파라미터 값 묶음 (물리명 → 값)
   * @returns 발행 전(issued: false) 전표
   */
  buildVoucher(template: SlipTemplateFile, values: Record<string, JsonValue>): SlipVoucherFile;
  /**
   * 수식을 평가한다. 컨텍스트에 `locale`이 없으면 설정된 로케일을 사용한다.
   *
   * @param source - 수식 문자열 또는 파싱된 AST
   * @param context - 값(`values`)·기준 시각 등 평가 컨텍스트
   * @returns 평가 결과 값
   */
  evaluate(source: string | FormulaAst, context: FormulaContext): FormulaValue;
  /**
   * `.slip` 파일을 암호화 봉투 JSON으로 변환한다.
   *
   * @param file - 암호화할 `.slip` 파일
   * @param key - 이 호출에 사용할 키. 생략하면 설정된 기본 키를 사용한다
   * @returns 암호화 봉투 JSON 문자열
   * @throws SlipEncryptionError 호출 인자와 설정에 암호화 키가 없을 때
   */
  encrypt(file: SlipFile, key?: EncryptionKey): Promise<string>;
  /**
   * 암호화 봉투 JSON을 복호화하고 `.slip` 파일을 검증한다.
   * 키를 생략하면 기본 키와 `previousKeys`를 순서대로 시도한다.
   *
   * @param json - 암호화 봉투 JSON 문자열
   * @param key - 이 호출에 사용할 키. 생략하면 설정된 키를 사용한다
   * @returns 복호화하고 검증한 `.slip` 파일
   * @throws SlipEncryptionError 키가 없거나 복호화에 실패하거나 파일이 변조되었을 때
   */
  decrypt(json: string, key?: EncryptionKey): Promise<SlipFile>;
}

/**
 * 공통 설정을 적용한 core API를 생성한다.
 *
 * @param config - 폰트, 로케일, 암호화 키 설정
 * @returns 공통 설정이 적용된 {@link SlipKit} 인스턴스
 *
 * @example
 * ```ts
 * const slip = createSlipKit({ getFonts, locale: 'ko-KR', encryption: { key } });
 * const pdf = await slip.render(voucher);
 * const locked = await slip.encrypt(file);
 * ```
 */
export function createSlipKit(config: SlipKitConfig = {}): SlipKit {
  const renderer = createPdfRenderer({
    ...(config.getFonts ? { getFonts: config.getFonts } : {}),
    ...(config.locale === undefined ? {} : { locale: config.locale }),
  });

  /** 암호화에 사용할 키를 호출 인자와 기본 설정 순서로 선택한다. */
  function keyForEncrypt(override: EncryptionKey | undefined): EncryptionKey {
    const key = override ?? config.encryption?.key;
    if (key === undefined) {
      throw new SlipEncryptionError('암호화 키가 없습니다 — 설정의 encryption.key나 인자로 키를 주세요');
    }
    return key;
  }

  /** 복호화에 시도할 키를 호출 인자, 기본 키, 이전 키 순서로 반환한다. */
  function keysForDecrypt(override: EncryptionKey | undefined): EncryptionKey[] {
    if (override !== undefined) return [override];
    const base = config.encryption?.key;
    if (base === undefined) {
      throw new SlipEncryptionError('복호화 키가 없습니다 — 설정의 encryption.key나 인자로 키를 주세요');
    }
    return [base, ...(config.encryption?.previousKeys ?? [])];
  }

  return {
    render: (file) => renderer.renderToPdf(file),
    buildVoucher: (template, values) => buildVoucher(template, values),
    evaluate: (source, context) =>
      evaluateFormula(
        source,
        context.locale === undefined && config.locale !== undefined
          ? { ...context, locale: config.locale }
          : context,
      ),
    encrypt: async (file, key) => encryptSlipFile(file, keyForEncrypt(key)),
    decrypt: async (json, key) => {
      const keys = keysForDecrypt(key);
      let lastError: unknown;
      for (const k of keys) {
        try {
          return await decryptSlipFile(json, k);
        } catch (error) {
          if (!(error instanceof SlipEncryptionError)) throw error;
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new SlipEncryptionError('복호화에 실패했습니다 — 맞는 키가 없습니다');
    },
  };
}
