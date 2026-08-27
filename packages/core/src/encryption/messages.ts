/**
 * 사용자에게 표시하는 암호화·복호화 메시지를 언어별로 정의한다.
 *
 * 암호화 함수는 비동기로 실행되므로 언어를 모듈 상태에 저장하지 않는다.
 * 호출자가 전달한 로케일로 {@link em}에서 메시지 사전을 선택한다.
 */
import { resolveMessageLocale, type MessageLocale } from '../i18n.js';

interface EncryptionMessages {
  webCryptoUnavailable(): string;
  emptyPassphrase(): string;
  rawKeyLength(): string;
  notAnEnvelope(): string;
  unsupportedEnvelopeVersion(): string;
  lockedWithPassphrase(): string;
  lockedWithRawKey(): string;
  unsupportedKdf(): string;
  decryptFailed(): string;
  noEncryptKey(): string;
  noDecryptKey(): string;
  noMatchingKey(): string;
}

const EN: EncryptionMessages = {
  webCryptoUnavailable: () =>
    'The Web Crypto API (crypto.subtle) is not available — Node 22.13+ or a modern browser is required',
  emptyPassphrase: () => 'The passphrase is empty',
  rawKeyLength: () => 'A raw key must be 32 bytes (AES-256)',
  notAnEnvelope: () => 'Not an encrypted `.slip` envelope',
  unsupportedEnvelopeVersion: () =>
    'Unsupported encryption envelope version — the file may have been locked with a newer SlipKit',
  lockedWithPassphrase: () => 'This file is locked with a passphrase',
  lockedWithRawKey: () => 'This file is locked with a raw key',
  unsupportedKdf: () => 'Unsupported key derivation method',
  decryptFailed: () => 'Decryption failed — the key is wrong or the file has been tampered with',
  noEncryptKey: () => 'No encryption key — provide a key in the encryption.key setting or as an argument',
  noDecryptKey: () => 'No decryption key — provide a key in the encryption.key setting or as an argument',
  noMatchingKey: () => 'Decryption failed — no matching key',
};

const KO: EncryptionMessages = {
  webCryptoUnavailable: () =>
    'Web Crypto API(crypto.subtle)를 사용할 수 없습니다. Node.js 22.13 이상 또는 최신 브라우저가 필요합니다',
  emptyPassphrase: () => '암호 문구가 비어 있습니다',
  rawKeyLength: () => '원시 키는 32바이트(AES-256)여야 합니다',
  notAnEnvelope: () => '`.slip` 암호화 봉투 형식이 아닙니다',
  unsupportedEnvelopeVersion: () =>
    '지원하지 않는 암호화 봉투 버전입니다. 더 최신 버전의 SlipKit으로 암호화한 파일일 수 있습니다',
  lockedWithPassphrase: () => '이 파일은 암호 문구(passphrase)로 암호화되어 있습니다',
  lockedWithRawKey: () => '이 파일은 원시 키로 암호화되어 있습니다',
  unsupportedKdf: () => '지원하지 않는 키 파생 방식입니다',
  decryptFailed: () => '복호화에 실패했습니다. 키가 일치하지 않거나 파일이 변조되었습니다',
  noEncryptKey: () => '암호화 키가 없습니다. encryption.key 설정이나 함수 인자로 키를 전달하세요',
  noDecryptKey: () => '복호화 키가 없습니다. encryption.key 설정이나 함수 인자로 키를 전달하세요',
  noMatchingKey: () => '복호화에 실패했습니다. 일치하는 키가 없습니다',
};

const JA: EncryptionMessages = {
  webCryptoUnavailable: () =>
    'Web Crypto API（crypto.subtle）を利用できません — Node 22.13+ またはモダンブラウザが必要です',
  emptyPassphrase: () => 'パスフレーズが空です',
  rawKeyLength: () => '生キーは 32 バイト（AES-256）でなければなりません',
  notAnEnvelope: () => '暗号化された `.slip` エンベロープの形式ではありません',
  unsupportedEnvelopeVersion: () =>
    'サポートされていない暗号化エンベロープのバージョンです — より新しい SlipKit でロックされたファイルの可能性があります',
  lockedWithPassphrase: () => 'このファイルはパスフレーズでロックされています',
  lockedWithRawKey: () => 'このファイルは生キーでロックされています',
  unsupportedKdf: () => 'サポートされていない鍵導出方式です',
  decryptFailed: () => '復号に失敗しました — キーが違うか、ファイルが改ざんされています',
  noEncryptKey: () => '暗号化キーがありません — encryption.key の設定または引数でキーを渡してください',
  noDecryptKey: () => '復号キーがありません — encryption.key の設定または引数でキーを渡してください',
  noMatchingKey: () => '復号に失敗しました — 一致するキーがありません',
};

const CATALOG: Record<MessageLocale, EncryptionMessages> = { en: EN, ko: KO, ja: JA };

/**
 * 로케일에 맞는 암호화 메시지 사전을 반환한다.
 *
 * @param locale - BCP 47 로케일 (생략하면 영어)
 * @returns 메시지 사전
 */
export function em(locale?: string): EncryptionMessages {
  return CATALOG[resolveMessageLocale(locale)];
}
