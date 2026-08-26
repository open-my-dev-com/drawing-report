/** `.slip` 파일을 AES-256-GCM으로 암호화하고 복호화하는 API. */
export { encryptSlipFile, decryptSlipFile, isEncryptedSlipFile } from './crypto.js';
export { SlipEncryptionError } from './errors.js';
