/**
 * 저장소 어댑터 암호화 설정 (ADR-055).
 *
 * 호스트가 저장소 어댑터에 주입하는 설정이다 — 폰트·용지 provider와 같은 결(ADR-040).
 * 켜 두면 저장 시 `.slip` 내용을 core의 {@link encryptSlipFile}로 잠그고, 불러올 때
 * 자동으로 푼다. 실제 암호화·복호화는 전부 core가 한다(ADR-003/054) — 이 계층은
 * "언제·어떤 키로" 잠글지만 정한다.
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

/**
 * 키를 주지 않고 암호화를 켰을 때 쓰는 **데모용 샘플 기본키**.
 *
 * @remarks
 * 이 값은 소스에 그대로 박혀 있어 **실제 보안이 아니다** — 코드를 볼 수 있으면 누구나
 * 같은 키로 풀 수 있다. 설정 없이도 "잠긴 파일" 동작을 바로 확인해 보라고 둔 기본값일 뿐이다.
 * 민감한 양식·전표를 실제로 보호하려면 호스트가 {@link StorageEncryption.key}에 자기 키를
 * 반드시 넘겨야 한다 (키 관리는 호스트 책임, ADR-054).
 */
export const SAMPLE_ENCRYPTION_KEY = 'omdc-slipkit-sample-key';

/** 저장소 어댑터 암호화 설정 (ADR-055) */
export interface StorageEncryption {
  /**
   * 저장 시 암호화할지 여부. `false`거나 설정 자체가 없으면 평문으로 저장한다.
   *
   * @defaultValue false
   */
  enabled: boolean;
  /**
   * 잠글 키 — 암호(passphrase 문자열) 또는 32바이트 원시 키(Uint8Array).
   * 생략하면 {@link SAMPLE_ENCRYPTION_KEY}(데모용, 실보안 아님)로 잠근다.
   */
  key?: string | Uint8Array;
  /**
   * 예전 키로 잠근 파일도 읽도록 **불러올 때** 추가로 시도할 키들 — 키 변경(회전) 대비.
   *
   * @remarks
   * 저장은 항상 현재 {@link key}로만 하고, 불러오기는 현재 키가 안 맞으면 이 목록을 차례로
   * 시도한다. 키를 바꿀 때 새 키를 `key`에, 옛 키를 여기에 두면 옛 파일도 열리고, 그 파일을
   * 다시 저장하면 새 키로 옮겨진다. 암호화를 끄는 경우(`enabled: false`)에도 `key`·이 목록을
   * 남겨 두면 예전에 잠근 파일을 계속 읽을 수 있다.
   */
  previousKeys?: (string | Uint8Array)[];
}

/** 저장 시 잠글 키를 고른다 — 없으면 샘플 기본키 */
function resolveKey(encryption: StorageEncryption): string | Uint8Array {
  return encryption.key ?? SAMPLE_ENCRYPTION_KEY;
}

/** 불러올 때 시도할 키 순서 — 현재 키(또는 샘플) 다음에 예전 키들 */
function decryptionKeys(encryption?: StorageEncryption): (string | Uint8Array)[] {
  return [encryption?.key ?? SAMPLE_ENCRYPTION_KEY, ...(encryption?.previousKeys ?? [])];
}

/**
 * 저장할 `.slip` 파일을 설정에 맞춰 문자열로 만든다.
 * 암호화가 켜져 있으면 봉투 JSON, 아니면 표준 `.slip` JSON을 돌려준다.
 *
 * @param file - 저장할 .slip 파일
 * @param encryption - 어댑터 암호화 설정 (생략·비활성이면 평문)
 * @returns 저장할 JSON 문자열
 */
export function serializeForStorage(
  file: SlipFile,
  encryption?: StorageEncryption,
): Promise<string> {
  if (encryption?.enabled) {
    return encryptSlipFile(file, resolveKey(encryption));
  }
  return Promise.resolve(serializeSlipFile(file));
}

/**
 * 저장소에서 읽은 문자열을 `.slip` 파일로 되돌린다.
 * 암호화 봉투면 키(또는 샘플 기본키)로 풀고, 표준 `.slip`이면 그대로 파싱한다 —
 * 즉 옛 평문 파일도 그대로 읽힌다.
 *
 * @param text - 저장소에서 읽은 JSON 문자열
 * @param encryption - 어댑터 암호화 설정 (봉투를 풀 때만 쓴다)
 * @returns 검증까지 끝난 .slip 파일
 * @throws SlipEncryptionError 봉투인데 현재·예전 키 어느 것으로도 못 풀거나 파일이 변조됐으면
 * @throws SlipParseError 내용이 유효한 .slip이 아니면
 */
export async function deserializeFromStorage(
  text: string,
  encryption?: StorageEncryption,
): Promise<SlipFile> {
  if (!isEncryptedSlipFile(text)) return parseSlipFile(text);
  // 현재 키부터, 안 맞으면 예전 키들을 차례로 시도한다(키 회전 대비). 복호화 자체가
  // 실패(SlipEncryptionError)할 때만 다음 키로 넘어가고, 풀린 뒤의 검증 오류는 그대로 던진다.
  let lastError: unknown;
  for (const key of decryptionKeys(encryption)) {
    try {
      return await decryptSlipFile(text, key);
    } catch (error) {
      if (!(error instanceof SlipEncryptionError)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new SlipEncryptionError('복호화에 실패했습니다 — 맞는 키가 없습니다');
}
