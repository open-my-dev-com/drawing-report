/**
 * core 사용 진입점 — 설정을 한 번 지닌 인스턴스 (ADR-056).
 *
 * 폰트·로케일·암호화 키처럼 여러 작업에 걸치는 **설정을 한 번** 주고, 이후 렌더·전표 조립·
 * 수식 평가·암호화를 그 설정으로 실행한다. 호출마다 폰트·키를 넘기다 빠뜨리거나 엉뚱한 값을
 * 주는 오용 여지를 없앤다. 설정이 늘어도 이 config 객체에 필드만 더하면 되고 각 함수 시그니처는
 * 흔들리지 않는다.
 *
 * 설정이 필요 없는 순수 함수({@link parseSlipFile} 등)는 그대로 단독 export한다 — 이 인스턴스는
 * "설정을 지닌 편의 진입점"이며 내부에서 같은 함수를 부른다.
 */
import { buildVoucher } from './format/voucher.js';
import type { JsonValue, SlipFile, SlipTemplateFile, SlipVoucherFile } from './format/schema.js';
import { createPdfRenderer, type SlipFont } from './render/index.js';
import type { FormulaAst } from './formula/parser.js';
import { evaluateFormula, type FormulaContext, type FormulaValue } from './formula/evaluator.js';
import { encryptSlipFile, decryptSlipFile } from './encryption/index.js';
import { SlipEncryptionError } from './encryption/errors.js';

/** 인스턴스가 파일마다 다른 키를 받을 때의 키 형 — 암호(passphrase) 또는 32바이트 원시 키 */
type EncryptionKey = string | Uint8Array;

/** {@link createSlipKit} 설정 — 여러 작업에 걸치는 값을 한 번 준다 */
export interface SlipKitConfig {
  /**
   * 렌더 폰트를 **당겨 오는 공급 함수** (ADR-040) — 서버 폴더·네트워크 등에서 비동기로 받아도 된다.
   * 주지 않으면 하부 엔진 기본 폰트를 쓴다.
   */
  getFonts?: () => readonly SlipFont[] | Promise<readonly SlipFont[]>;
  /**
   * FORMAT_NUMBER 등 수식 포맷 함수의 로케일 (BCP-47) — 렌더·`evaluate`에 함께 적용된다.
   *
   * @defaultValue `'ko-KR'`
   */
  locale?: string;
  /**
   * 암호화 기본 설정. `key`를 주면 `encrypt`/`decrypt`가 이 키를 기본으로 쓴다.
   * 파일마다 다른 키는 메서드 인자로 덮어쓴다. `previousKeys`는 키 변경(회전) 시 옛 키로
   * 잠근 파일을 풀 때 순차로 시도한다.
   */
  encryption?: { key: EncryptionKey; previousKeys?: EncryptionKey[] };
}

/** {@link createSlipKit}가 돌려주는, 설정을 지닌 인스턴스 */
export interface SlipKit {
  /**
   * `.slip` 파일을 PDF 바이트로 렌더한다 — 설정의 폰트·로케일을 쓴다.
   *
   * @param file - 렌더할 .slip 파일 (양식 또는 전표)
   * @returns PDF 파일 바이트
   */
  render(file: SlipFile): Promise<Uint8Array>;
  /**
   * 양식+값을 발행 전 전표로 조립한다 (설정과 무관 — 편의 제공).
   *
   * @param template - 양식 파일
   * @param values - 파라미터 값 묶음 (물리명 → 값)
   * @returns 발행 전(issued: false) 전표
   */
  buildVoucher(template: SlipTemplateFile, values: Record<string, JsonValue>): SlipVoucherFile;
  /**
   * 수식을 평가한다 — 컨텍스트에 `locale`이 없으면 설정 로케일을 쓴다.
   *
   * @param source - 수식 문자열 또는 파싱된 AST
   * @param context - 값(`values`)·기준 시각 등 평가 컨텍스트
   * @returns 평가 결과 값
   */
  evaluate(source: string | FormulaAst, context: FormulaContext): FormulaValue;
  /**
   * `.slip` 파일을 잠가 암호화 봉투 JSON으로 만든다 (ADR-054).
   *
   * @param file - 잠글 .slip 파일
   * @param key - 이 파일만 쓸 키 (생략하면 설정의 기본 키)
   * @returns 암호화 봉투 JSON 문자열
   * @throws SlipEncryptionError 이 파일 키도 설정 기본 키도 없으면
   */
  encrypt(file: SlipFile, key?: EncryptionKey): Promise<string>;
  /**
   * 암호화 봉투 JSON을 풀어 `.slip` 파일로 되돌린다 (ADR-054).
   * 키를 주지 않으면 설정의 기본 키, 안 맞으면 `previousKeys`를 차례로 시도한다(키 회전 대비).
   *
   * @param json - 암호화 봉투 JSON 문자열
   * @param key - 이 파일만 쓸 키 (생략하면 설정의 기본 키·예전 키)
   * @returns 검증까지 끝난 .slip 파일
   * @throws SlipEncryptionError 키가 없거나, 어떤 키로도 못 풀거나, 파일이 변조됐으면
   */
  decrypt(json: string, key?: EncryptionKey): Promise<SlipFile>;
}

/**
 * 설정을 한 번 지닌 core 인스턴스를 만든다 (ADR-056).
 *
 * @param config - 폰트 공급·로케일·암호화 기본 키 (전부 선택)
 * @returns 설정을 지닌 {@link SlipKit} 인스턴스
 *
 * @example
 * ```ts
 * const slip = createSlipKit({ getFonts, locale: 'ko-KR', encryption: { key } });
 * const pdf = await slip.render(voucher);   // 폰트·로케일 자동
 * const locked = await slip.encrypt(file);  // 설정 키로 잠금
 * ```
 */
export function createSlipKit(config: SlipKitConfig = {}): SlipKit {
  const renderer = createPdfRenderer({
    ...(config.getFonts ? { getFonts: config.getFonts } : {}),
    ...(config.locale === undefined ? {} : { locale: config.locale }),
  });

  /** 잠글 키를 고른다 — 인자 우선, 없으면 설정 기본 키, 둘 다 없으면 오류 */
  function keyForEncrypt(override: EncryptionKey | undefined): EncryptionKey {
    const key = override ?? config.encryption?.key;
    if (key === undefined) {
      throw new SlipEncryptionError('암호화 키가 없습니다 — 설정의 encryption.key나 인자로 키를 주세요');
    }
    return key;
  }

  /** 풀 때 시도할 키 순서 — 인자만 주면 그것만, 없으면 설정 기본 키 다음에 예전 키들 */
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
