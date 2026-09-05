/**
 * `.slip` 파일을 인증 암호화 형식으로 변환하고 복호화한다.
 *
 * AES-256-GCM 인증 암호화를 사용하므로 키가 올바르지 않거나 파일이 변조되면 복호화에
 * 실패한다. 키 관리와 전달은 호스트가 담당한다. 암호화 결과는 표준 `.slip` 형식과
 * 호환되지 않는다(SPEC §8).
 *
 * 암호 연산에는 Web Crypto API의 `crypto.subtle`을 사용한다.
 */
import { parseSlipFile, serializeSlipFile, type SlipFile } from '../format/schema.js';
import { stripLeadingBom } from '../format/text.js';
import { base64urlEncode, base64urlDecode } from './base64url.js';
import { SlipEncryptionError } from './errors.js';
import { em } from './messages.js';

/** 암호화 봉투를 식별하는 최상위 속성 값. */
const MARKER = 'encrypted';
/**
 * 새 암호화 봉투에 기록할 PBKDF2 반복 횟수.
 * OWASP Password Storage Cheat Sheet의 PBKDF2-HMAC-SHA256 권고치를 따른다.
 */
const PBKDF2_ITERATIONS = 600_000;
/** 복호화 시 허용하는 PBKDF2 반복 횟수의 상한. */
const MAX_PBKDF2_ITERATIONS = 10_000_000;
/** AES-GCM 초기화 벡터 길이(바이트) */
const IV_BYTES = 12;
/** PBKDF2 솔트 길이(바이트) */
const SALT_BYTES = 16;

/**
 * DOM과 Node의 `SubtleCrypto` 타입 차이를 분리하기 위해 사용하는 최소 인터페이스.
 */
interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: unknown,
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  deriveKey(
    algorithm: unknown,
    baseKey: unknown,
    derivedKeyType: unknown,
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  encrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

/**
 * 암호화한 `.slip` 내용을 저장하는 JSON 봉투. `kdf`는 암호를 사용한 경우에만 포함한다.
 */
interface EncryptedEnvelope {
  slipkit: typeof MARKER;
  /** 봉투 형식 버전 */
  v: 1;
  /** 대칭 암호 알고리즘 */
  cipher: 'A256GCM';
  /** 암호에서 키를 파생하는 데 필요한 정보. 원시 키를 사용하면 생략한다. */
  kdf?: { algo: 'PBKDF2-SHA256'; salt: string; iterations: number };
  /** 초기화 벡터 (base64url) */
  iv: string;
  /** 암호문 + 인증 태그 (base64url) */
  data: string;
}

function requireSubtle(locale?: string): SubtleLike {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) {
    throw new SlipEncryptionError(em(locale).webCryptoUnavailable());
  }
  return subtle as unknown as SubtleLike;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  (crypto as unknown as { getRandomValues(a: Uint8Array): Uint8Array }).getRandomValues(bytes);
  return bytes;
}

/**
 * 입력 키를 AES-GCM 키로 변환한다.
 * `string`은 PBKDF2로 파생할 암호로, `Uint8Array`는 32바이트 원시 키로 처리한다.
 *
 * 암호 문자열은 PBKDF2에 넣기 직전에 NFC로 정규화한다 — 같은 글자를 NFC와 NFD로 다르게 입력해도
 * 같은 키가 나오도록 한다. 원시 키는 바이트 그대로 쓴다.
 * 암호화에는 현재 기본 반복 횟수를 사용하고, 복호화에는 봉투에 기록된 반복 횟수를 사용한다.
 */
async function toAesKey(
  key: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
  locale?: string,
): Promise<unknown> {
  const subtle = requireSubtle(locale);
  if (typeof key === 'string') {
    if (key.length === 0) throw new SlipEncryptionError(em(locale).emptyPassphrase());
    const baseKey = await subtle.importKey(
      'raw',
      new TextEncoder().encode(key.normalize('NFC')),
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
  if (key.length !== 32) {
    throw new SlipEncryptionError(em(locale).rawKeyLength());
  }
  return subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * 이미 직렬화된 JSON 문자열이 암호화 봉투인지 판별한다.
 * 텍스트 맨 앞의 UTF-8 BOM 하나는 무시하고 판별한다.
 *
 * @param json - 검사할 JSON 문자열
 * @returns 암호화 봉투면 true (표준 `.slip`이면 false)
 */
export function isEncryptedSlipFile(json: string): boolean {
  try {
    const raw = JSON.parse(stripLeadingBom(json)) as { slipkit?: unknown };
    return raw?.slipkit === MARKER;
  } catch {
    return false;
  }
}

/**
 * `.slip` 파일을 암호화 봉투 형식의 JSON 문자열로 변환한다.
 *
 * 결과 봉투에는 BOM을 붙이지 않는다(첫 글자는 항상 `{`). 암호 문자열은 키 파생 직전에 NFC로
 * 정규화하고, 원시 키와 파일 안의 문자열은 정규화하지 않는다.
 *
 * @param file - 암호화할 `.slip` 파일
 * @param key - 암호(passphrase 문자열) 또는 32바이트 원시 키(Uint8Array)
 * @param options - 오류 메시지에 사용할 로케일 설정 (생략하면 영어)
 * @returns 암호화 봉투 JSON 문자열
 * @throws SlipEncryptionError 키가 비었거나 형식이 잘못되었거나 Web Crypto를 사용할 수 없을 때
 *
 * @example
 * ```ts
 * const locked = await encryptSlipFile(file, '내-비밀-암호');
 * // 암호화 결과는 decryptSlipFile로 복호화한다.
 * ```
 */
export async function encryptSlipFile(
  file: SlipFile,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<string> {
  const locale = options?.locale;
  const subtle = requireSubtle(locale);
  const usePassphrase = typeof key === 'string';
  const salt = usePassphrase ? randomBytes(SALT_BYTES) : new Uint8Array(0);
  const aesKey = await toAesKey(key, salt, PBKDF2_ITERATIONS, locale);
  const iv = randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(serializeSlipFile(file));
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
  const envelope: EncryptedEnvelope = {
    slipkit: MARKER,
    v: 1,
    cipher: 'A256GCM',
    ...(usePassphrase
      ? { kdf: { algo: 'PBKDF2-SHA256' as const, salt: base64urlEncode(salt), iterations: PBKDF2_ITERATIONS } }
      : {}),
    iv: base64urlEncode(iv),
    data: base64urlEncode(new Uint8Array(cipherBuf)),
  };
  return JSON.stringify(envelope);
}

/** 봉투에서 읽어 디코딩까지 마친 복호화 입력. */
export interface ParsedEnvelope {
  /** 암호 문구로 잠갔으면 솔트와 반복 횟수, 원시 키로 잠갔으면 없음 */
  kdf?: { salt: Uint8Array; iterations: number };
  iv: Uint8Array;
  data: Uint8Array;
}

/** 키가 맞지 않아 복호화하지 못한 오류를 표시한다 — 봉투 손상과 구분해 다음 키를 시도할 수 있게 한다. */
const keyMismatch = new WeakSet<SlipEncryptionError>();

/**
 * 오류가 키 불일치(틀린 키·키 종류 불일치) 때문인지 알려 준다.
 *
 * @param error - 검사할 값
 * @returns 키를 바꾸면 해결될 수 있는 오류면 true
 */
export function isKeyMismatchError(error: unknown): boolean {
  return error instanceof SlipEncryptionError && keyMismatch.has(error);
}

function mismatch(message: string): SlipEncryptionError {
  const error = new SlipEncryptionError(message);
  keyMismatch.add(error);
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** base64url 문자열을 디코딩한다. 형식이 틀리거나 길이가 맞지 않으면 `undefined`. */
function decodeField(value: unknown, expectedLength?: number): Uint8Array | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base64urlDecode(value);
  } catch {
    return undefined;
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) return undefined;
  return bytes;
}

/**
 * 암호화 봉투 JSON 문자열의 구조·필드 형식·길이를 검증하고 디코딩한다 (SPEC §21.3 1~4단계).
 * 텍스트 맨 앞의 UTF-8 BOM 하나는 받아들여 제거하고 파싱한다.
 *
 * @param json - 암호화 봉투 JSON 문자열
 * @param locale - 오류 메시지에 사용할 BCP 47 로케일
 * @returns 디코딩한 봉투
 * @throws SlipEncryptionError 봉투 형식이 아니거나, 버전·암호·키 파생 방식을 지원하지 않거나,
 *   `kdf`·`iv`·`data` 필드가 손상되었을 때
 */
export function parseEncryptedEnvelope(json: string, locale?: string): ParsedEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(stripLeadingBom(json));
  } catch {
    throw new SlipEncryptionError(em(locale).notAnEnvelope());
  }
  if (!isRecord(raw) || raw['slipkit'] !== MARKER) {
    throw new SlipEncryptionError(em(locale).notAnEnvelope());
  }
  // 버전을 먼저 보고 암호를 본다 — 더 새로운 봉투를 "봉투 아님"으로 보고하지 않기 위해서다.
  if (raw['v'] !== 1) {
    throw new SlipEncryptionError(em(locale).unsupportedEnvelopeVersion());
  }
  if (raw['cipher'] !== 'A256GCM') {
    throw new SlipEncryptionError(em(locale).unsupportedCipher());
  }
  const envelope: ParsedEnvelope = { iv: new Uint8Array(0), data: new Uint8Array(0) };
  if (raw['kdf'] !== undefined) {
    const kdf = raw['kdf'];
    if (!isRecord(kdf)) throw new SlipEncryptionError(em(locale).envelopeFieldInvalid('kdf'));
    const iterations = kdf['iterations'];
    const validIterations =
      typeof iterations === 'number' &&
      Number.isSafeInteger(iterations) &&
      iterations >= 1 &&
      iterations <= MAX_PBKDF2_ITERATIONS;
    if (kdf['algo'] !== 'PBKDF2-SHA256' || !validIterations) {
      throw new SlipEncryptionError(em(locale).unsupportedKdf());
    }
    const salt = decodeField(kdf['salt'], SALT_BYTES);
    if (salt === undefined) throw new SlipEncryptionError(em(locale).envelopeFieldInvalid('kdf.salt'));
    envelope.kdf = { salt, iterations };
  }
  const iv = decodeField(raw['iv'], IV_BYTES);
  if (iv === undefined) throw new SlipEncryptionError(em(locale).envelopeFieldInvalid('iv'));
  const data = decodeField(raw['data']);
  if (data === undefined || data.length === 0) {
    throw new SlipEncryptionError(em(locale).envelopeFieldInvalid('data'));
  }
  envelope.iv = iv;
  envelope.data = data;
  return envelope;
}

/**
 * 검증을 마친 봉투를 키로 복호화하고 `.slip` 형식인지 검증한다 (SPEC §21.3 5~8단계).
 *
 * @param envelope - {@link parseEncryptedEnvelope}의 결과
 * @param key - 암호화에 사용한 암호 또는 원시 키
 * @param locale - 오류 메시지에 사용할 BCP 47 로케일
 * @returns 복호화하고 검증한 `.slip` 파일
 * @throws SlipEncryptionError 키 종류가 봉투와 다르거나, 키가 틀리거나(복호화 실패), 파일 변조 시
 * @throws SlipParseError 복호화된 내용이 유효한 `.slip`이 아니면
 */
export async function decryptParsedEnvelope(
  envelope: ParsedEnvelope,
  key: string | Uint8Array,
  locale?: string,
): Promise<SlipFile> {
  const subtle = requireSubtle(locale);
  const usePassphrase = typeof key === 'string';
  if (usePassphrase !== (envelope.kdf !== undefined)) {
    throw mismatch(envelope.kdf ? em(locale).lockedWithPassphrase() : em(locale).lockedWithRawKey());
  }
  // 복호화에는 봉투에 기록된 반복 횟수를 사용한다.
  const aesKey = await toAesKey(
    key,
    envelope.kdf?.salt ?? new Uint8Array(0),
    envelope.kdf?.iterations ?? PBKDF2_ITERATIONS,
    locale,
  );
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv }, aesKey, envelope.data);
  } catch {
    // GCM 인증 실패는 잘못된 키나 파일 변조를 뜻한다.
    throw mismatch(em(locale).decryptFailed());
  }
  return parseSlipFile(
    new TextDecoder().decode(new Uint8Array(plainBuf)),
    locale === undefined ? undefined : { locale },
  );
}

/**
 * 암호화 봉투 JSON 문자열을 복호화하고 `.slip` 형식인지 검증한다.
 *
 * 봉투 텍스트 맨 앞의 UTF-8 BOM 하나는 받아들여 제거한다. 암호 문자열은 키 파생 직전에 NFC로
 * 정규화하므로 암호화할 때와 다른 정규화 형태로 입력해도 복호화된다. 복호화된 문서 안의
 * 문자열은 정규화하지 않고 그대로 돌려준다.
 *
 * @param json - 암호화 봉투 JSON 문자열
 * @param key - 암호화에 사용한 암호 또는 원시 키
 * @param options - 오류 메시지에 사용할 로케일 설정 (생략하면 영어)
 * @returns 복호화하고 검증한 `.slip` 파일
 * @throws SlipEncryptionError 봉투 형식이 아니거나, 봉투 버전·암호·키 파생 방식을 지원하지
 *   않거나, `kdf`·`iv`·`data` 필드가 손상되었거나, 키 종류가 다르거나, 키가 틀리거나
 *   (복호화 실패), 파일 변조 시
 * @throws SlipParseError 복호화된 내용이 유효한 `.slip`이 아니면
 */
export async function decryptSlipFile(
  json: string,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<SlipFile> {
  const locale = options?.locale;
  return decryptParsedEnvelope(parseEncryptedEnvelope(json, locale), key, locale);
}
