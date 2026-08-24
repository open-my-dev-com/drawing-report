/**
 * 파일 암호화 (ADR-054) — `.slip` 내용을 대칭키로 잠근다.
 *
 * 편집기로 열어도 내용이 보이지 않게 하는 **선택** 기능이다. AES-256-GCM(인증 암호)이라
 * 잘못된 키나 변조된 파일은 복호화 단계에서 걸러진다. 키 관리·전달은 호스트 책임이며,
 * 잠근 파일은 표준 `.slip`이 아니라 다른 시스템과 그대로 주고받을 수 없다 (SPEC §8).
 *
 * 암호는 Web Crypto API로 구현한다 — core는 순수 TS라 Node 20+·모던 브라우저의 표준
 * `crypto.subtle`만 쓴다 (ADR-002).
 */
import { parseSlipFile, serializeSlipFile, type SlipFile } from '../format/schema.js';
import { base64urlEncode, base64urlDecode } from './base64url.js';
import { SlipEncryptionError } from './errors.js';

/** 암호화 봉투의 최상위 표식 — 이 값이 있으면 표준 `.slip`이 아니라 암호화 파일이다 */
const MARKER = 'encrypted';
/** PBKDF2 반복 횟수 — 암호(passphrase)에서 키를 만들 때 (OWASP 2023 권장 하한 이상) */
const PBKDF2_ITERATIONS = 210_000;
/** AES-GCM 초기화 벡터 길이(바이트) */
const IV_BYTES = 12;
/** PBKDF2 솔트 길이(바이트) */
const SALT_BYTES = 16;

/**
 * 쓰는 Web Crypto 메서드만 담은 좁은 인터페이스. DOM·Node의 SubtleCrypto 타입 차이(오버로드)를
 * 피하려고 이 형태로만 다룬다 — 런타임은 표준 `crypto.subtle` 그대로다.
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
 * 암호화 봉투 — `.slip` 내용을 담는 JSON. `kdf`는 암호(passphrase)로 잠갔을 때만 있다.
 */
interface EncryptedEnvelope {
  slipkit: typeof MARKER;
  /** 봉투 형식 버전 */
  v: 1;
  /** 대칭 암호 알고리즘 */
  cipher: 'A256GCM';
  /** 키 파생(암호 → 키) 정보 — 원시 키로 잠갔으면 없다 */
  kdf?: { algo: 'PBKDF2-SHA256'; salt: string; iterations: number };
  /** 초기화 벡터 (base64url) */
  iv: string;
  /** 암호문 + 인증 태그 (base64url) */
  data: string;
}

function requireSubtle(): SubtleLike {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) {
    throw new SlipEncryptionError(
      'Web Crypto API(crypto.subtle)를 사용할 수 없습니다 — Node 20+ 또는 모던 브라우저가 필요합니다',
    );
  }
  return subtle as unknown as SubtleLike;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  (crypto as unknown as { getRandomValues(a: Uint8Array): Uint8Array }).getRandomValues(bytes);
  return bytes;
}

/**
 * 키를 AES-GCM 키로 만든다.
 * - `string`이면 암호(passphrase)로 보고 PBKDF2로 파생한다(솔트·반복 필요).
 * - `Uint8Array`면 32바이트 원시 키로 본다.
 */
async function toAesKey(key: string | Uint8Array, salt: Uint8Array): Promise<unknown> {
  const subtle = requireSubtle();
  if (typeof key === 'string') {
    if (key.length === 0) throw new SlipEncryptionError('암호가 비어 있습니다');
    const baseKey = await subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
  if (key.length !== 32) {
    throw new SlipEncryptionError('원시 키는 32바이트(AES-256)여야 합니다');
  }
  return subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * 이미 직렬화된 JSON 문자열이 암호화 봉투인지 판별한다.
 *
 * @param json - 검사할 JSON 문자열
 * @returns 암호화 봉투면 true (표준 `.slip`이면 false)
 */
export function isEncryptedSlipFile(json: string): boolean {
  try {
    const raw = JSON.parse(json) as { slipkit?: unknown };
    return raw?.slipkit === MARKER;
  } catch {
    return false;
  }
}

/**
 * `.slip` 파일을 암호로 잠가 암호화 봉투 JSON 문자열로 만든다 (ADR-054).
 *
 * @param file - 잠글 `.slip` 파일 (양식 또는 전표)
 * @param key - 암호(passphrase 문자열) 또는 32바이트 원시 키(Uint8Array)
 * @returns 암호화 봉투 JSON 문자열
 * @throws SlipEncryptionError 키가 비었거나 길이가 틀리거나 Web Crypto를 쓸 수 없으면
 *
 * @example
 * ```ts
 * const locked = await encryptSlipFile(file, '내-비밀-암호');
 * // locked는 표준 .slip이 아니다 — 복호화해야 다시 읽을 수 있다
 * ```
 */
export async function encryptSlipFile(file: SlipFile, key: string | Uint8Array): Promise<string> {
  const subtle = requireSubtle();
  const usePassphrase = typeof key === 'string';
  const salt = usePassphrase ? randomBytes(SALT_BYTES) : new Uint8Array(0);
  const aesKey = await toAesKey(key, salt);
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

/**
 * 암호화 봉투 JSON 문자열을 풀어 `.slip` 파일로 되돌린다 (ADR-054).
 * 복호화 뒤 {@link parseSlipFile}로 검증하므로, 키가 맞아도 내용이 규칙에 어긋나면 거부한다.
 *
 * @param json - 암호화 봉투 JSON 문자열
 * @param key - 잠글 때 쓴 암호(passphrase) 또는 원시 키
 * @returns 검증까지 끝난 `.slip` 파일
 * @throws SlipEncryptionError 봉투 형식이 아니거나, 키가 틀리거나(복호화 실패), 파일 변조 시
 * @throws SlipParseError 복호화된 내용이 유효한 `.slip`이 아니면
 */
export async function decryptSlipFile(json: string, key: string | Uint8Array): Promise<SlipFile> {
  const subtle = requireSubtle();
  let envelope: EncryptedEnvelope;
  try {
    const raw = JSON.parse(json) as EncryptedEnvelope;
    if (raw?.slipkit !== MARKER || raw.cipher !== 'A256GCM') throw new Error('marker');
    envelope = raw;
  } catch {
    throw new SlipEncryptionError('암호화된 `.slip` 봉투 형식이 아닙니다');
  }
  const usePassphrase = typeof key === 'string';
  if (usePassphrase !== (envelope.kdf !== undefined)) {
    throw new SlipEncryptionError(
      envelope.kdf ? '이 파일은 암호(passphrase)로 잠겨 있습니다' : '이 파일은 원시 키로 잠겨 있습니다',
    );
  }
  const salt = envelope.kdf ? base64urlDecode(envelope.kdf.salt) : new Uint8Array(0);
  const aesKey = await toAesKey(key, salt);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: base64urlDecode(envelope.iv) },
      aesKey,
      base64urlDecode(envelope.data),
    );
  } catch {
    // GCM 인증 실패 — 키가 틀렸거나 파일이 변조됐다
    throw new SlipEncryptionError('복호화에 실패했습니다 — 키가 틀렸거나 파일이 변조되었습니다');
  }
  return parseSlipFile(new TextDecoder().decode(new Uint8Array(plainBuf)));
}
