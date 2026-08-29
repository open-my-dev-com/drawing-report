/**
 * 저장소가 `.slip` 파일을 문자열로 바꾸거나 되돌릴 때 쓰는 공통 처리.
 *
 * 암호화와 복호화는 호스트가 만든 {@link SlipKit} 인스턴스를 그대로 사용한다.
 * 키와 이전 키 목록은 `createSlipKit` 설정 한 곳에서만 관리한다.
 */
import {
  isEncryptedSlipFile,
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
  type SlipKit,
} from '@omdc-slipkit/core';

/**
 * 저장할 `.slip` 파일을 정책에 맞춰 문자열로 만든다.
 *
 * @param slipkit - 공통 설정을 가진 SlipKit 인스턴스
 * @param file - 저장할 `.slip` 파일
 * @param encryptOnSave - true면 설정된 키로 암호화 봉투를 만든다. false면 평문 JSON
 * @returns 저장할 JSON 문자열
 * @throws SlipEncryptionError 암호화 저장인데 설정에 키가 없을 때
 */
export function serializeForStorage(
  slipkit: SlipKit,
  file: SlipFile,
  encryptOnSave: boolean,
): Promise<string> {
  if (encryptOnSave) return slipkit.encrypt(file);
  return Promise.resolve(serializeSlipFile(file));
}

/**
 * 저장소에서 읽은 문자열을 `.slip` 파일로 변환한다.
 * 암호화 봉투는 저장 정책과 무관하게 설정된 현재 키와 이전 키로 복호화를 시도하고,
 * 일반 `.slip` JSON은 바로 파싱한다.
 *
 * @param slipkit - 공통 설정을 가진 SlipKit 인스턴스
 * @param text - 저장소에서 읽은 JSON 문자열
 * @returns 검증까지 끝난 `.slip` 파일
 * @throws SlipEncryptionError 설정에 키가 없거나 어떤 키로도 복호화할 수 없는 경우
 * @throws SlipParseError 내용이 유효한 `.slip`이 아니면
 */
export function deserializeFromStorage(slipkit: SlipKit, text: string): Promise<SlipFile> {
  if (!isEncryptedSlipFile(text)) {
    const locale = slipkit.locale;
    return Promise.resolve(parseSlipFile(text, locale === undefined ? undefined : { locale }));
  }
  return slipkit.decrypt(text);
}
