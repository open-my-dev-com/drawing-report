/**
 * 저장소 어댑터 암호화 설정.
 *
 * 저장소 어댑터는 이 설정에 따라 저장할 때 `.slip` 파일을 암호화하고 불러올 때
 * 복호화한다. 암호화와 복호화는 core의 함수를 사용한다.
 */
import {
  encryptSlipFile,
  decryptSlipFile,
  isEncryptedSlipFile,
  parseSlipFile,
  serializeSlipFile,
  SlipEncryptionError,
  type SlipFile,
} from '@omdc-slipkit/core';
import { getStrings } from '../strings.js';

/**
 * 키를 지정하지 않은 데모에서 사용하는 샘플 키.
 *
 * @remarks
 * 소스에 포함된 공개 값이므로 데이터를 보호하는 용도로 사용할 수 없다.
 * 실제 데이터에는 호스트가 관리하는 키를 {@link StorageEncryption.key}로 전달해야 한다.
 */
export const SAMPLE_ENCRYPTION_KEY = 'omdc-slipkit-sample-key';

/** 저장소 어댑터의 암호화 및 키 교체 설정. */
export interface StorageEncryption {
  /**
   * 저장 시 암호화할지 여부. `false`거나 설정 자체가 없으면 평문으로 저장한다.
   *
   * @defaultValue false
   */
  enabled: boolean;
  /**
   * 암호화에 사용할 암호 문자열 또는 32바이트 원시 키.
   * 생략하면 데모용 {@link SAMPLE_ENCRYPTION_KEY}를 사용한다.
   */
  key?: string | Uint8Array;
  /**
   * 이전 키로 암호화한 파일을 읽을 때 추가로 시도할 키 목록.
   *
   * @remarks
   * 저장에는 현재 {@link key}만 사용한다. 복호화는 현재 키를 먼저 시도한 뒤 이 목록의
   * 키를 순서대로 시도한다. 이전 키로 복호화한 파일을 다시 저장하면 현재 키를 사용한다.
   */
  previousKeys?: (string | Uint8Array)[];
}

/** 저장에 사용할 키를 반환한다. */
function resolveKey(encryption: StorageEncryption): string | Uint8Array {
  return encryption.key ?? SAMPLE_ENCRYPTION_KEY;
}

/** 복호화에 사용할 키를 시도 순서대로 반환한다. */
function decryptionKeys(encryption?: StorageEncryption): (string | Uint8Array)[] {
  return [encryption?.key ?? SAMPLE_ENCRYPTION_KEY, ...(encryption?.previousKeys ?? [])];
}

/**
 * 저장할 `.slip` 파일을 설정에 맞춰 문자열로 만든다.
 * 암호화가 활성화되어 있으면 암호화 봉투를, 아니면 일반 `.slip` JSON을 반환한다.
 *
 * @param file - 저장할 `.slip` 파일
 * @param encryption - 어댑터 암호화 설정 (생략·비활성이면 평문)
 * @param locale - 오류 메시지에 사용할 BCP 47 로케일 (생략하면 영어)
 * @returns 저장할 JSON 문자열
 */
export function serializeForStorage(
  file: SlipFile,
  encryption?: StorageEncryption,
  locale?: string,
): Promise<string> {
  if (encryption?.enabled) {
    return encryptSlipFile(file, resolveKey(encryption), locale === undefined ? undefined : { locale });
  }
  return Promise.resolve(serializeSlipFile(file));
}

/**
 * 저장소에서 읽은 문자열을 `.slip` 파일로 변환한다.
 * 암호화 봉투는 설정된 키로 복호화하고 일반 `.slip` JSON은 바로 파싱한다.
 *
 * @param text - 저장소에서 읽은 JSON 문자열
 * @param encryption - 어댑터 암호화 설정 (봉투를 풀 때만 쓴다)
 * @param locale - 오류 메시지에 사용할 BCP 47 로케일 (생략하면 영어)
 * @returns 검증까지 끝난 `.slip` 파일
 * @throws SlipEncryptionError 현재 키와 이전 키로 복호화할 수 없거나 파일이 변조된 경우
 * @throws SlipParseError 내용이 유효한 `.slip`이 아니면
 */
export async function deserializeFromStorage(
  text: string,
  encryption?: StorageEncryption,
  locale?: string,
): Promise<SlipFile> {
  const options = locale === undefined ? undefined : { locale };
  if (!isEncryptedSlipFile(text)) return parseSlipFile(text, options);
  // 키가 맞지 않아 복호화에 실패한 경우에만 다음 키를 시도한다.
  let lastError: unknown;
  for (const key of decryptionKeys(encryption)) {
    try {
      return await decryptSlipFile(text, key, options);
    } catch (error) {
      if (!(error instanceof SlipEncryptionError)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new SlipEncryptionError(getStrings(locale).storage.noMatchingKey);
}
