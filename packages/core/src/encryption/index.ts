/**
 * 파일 암호화 (ADR-054) — `.slip` 내용을 대칭키(AES-256-GCM)로 잠그는 선택 기능.
 * 규범은 docs/SPEC.md §8.
 */
export { encryptSlipFile, decryptSlipFile, isEncryptedSlipFile } from './crypto.js';
export { SlipEncryptionError } from './errors.js';
