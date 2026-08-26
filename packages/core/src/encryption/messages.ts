/**
 * 암호화·복호화의 사용자 대면 메시지 사전 (영어 기본, 한국어·일본어).
 *
 * 암호화 함수는 비동기라 모듈 상태로 언어를 유지하지 않고, 호출자가 로케일을
 * 인자로 전달해 {@link em}으로 사전을 얻는다.
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
    'Web Crypto API(crypto.subtle)를 사용할 수 없습니다 — Node 22.13+ 또는 모던 브라우저가 필요합니다',
  emptyPassphrase: () => '암호가 비어 있습니다',
  rawKeyLength: () => '원시 키는 32바이트(AES-256)여야 합니다',
  notAnEnvelope: () => '암호화된 `.slip` 봉투 형식이 아닙니다',
  unsupportedEnvelopeVersion: () =>
    '지원하지 않는 암호화 봉투 버전입니다 — 더 새로운 SlipKit으로 잠근 파일일 수 있습니다',
  lockedWithPassphrase: () => '이 파일은 암호(passphrase)로 잠겨 있습니다',
  lockedWithRawKey: () => '이 파일은 원시 키로 잠겨 있습니다',
  unsupportedKdf: () => '지원하지 않는 키 파생 방식입니다',
  decryptFailed: () => '복호화에 실패했습니다 — 키가 틀렸거나 파일이 변조되었습니다',
  noEncryptKey: () => '암호화 키가 없습니다 — 설정의 encryption.key나 인자로 키를 주세요',
  noDecryptKey: () => '복호화 키가 없습니다 — 설정의 encryption.key나 인자로 키를 주세요',
  noMatchingKey: () => '복호화에 실패했습니다 — 맞는 키가 없습니다',
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
 * 로케일에 맞는 암호화 메시지 사전을 돌려준다.
 *
 * @param locale - BCP 47 로케일 (생략하면 영어)
 * @returns 메시지 사전
 */
export function em(locale?: string): EncryptionMessages {
  return CATALOG[resolveMessageLocale(locale)];
}
