/**
 * 배포 산출물(tarball)의 무결성 값을 만들고 검사하는 도우미.
 *
 * `SHA256SUMS`는 `sha256sum` 형식(`<hex>  <파일명>`)이고, `integrity`는 npm 레지스트리의
 * `dist.integrity`와 같은 SHA-512 SRI(`sha512-<base64>`)다.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * SHA-256 해시를 16진수 문자열로 만든다.
 *
 * @param data - 해시할 바이트
 * @returns 64자리 16진수 문자열
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * npm `dist.integrity`와 같은 형식의 SHA-512 SRI 문자열을 만든다.
 *
 * @param data - 해시할 바이트
 * @returns `sha512-<base64>` 문자열
 */
export function sriSha512(data) {
  return `sha512-${createHash('sha512').update(data).digest('base64')}`;
}

/**
 * `SHA256SUMS` 본문을 만든다.
 *
 * @param entries - 파일명과 SHA-256 16진수 목록
 * @returns 줄마다 `<hex>  <파일명>`인 텍스트 (마지막 줄바꿈 포함)
 */
export function formatSha256Sums(entries) {
  return entries.map((entry) => `${entry.sha256}  ${entry.file}\n`).join('');
}

/**
 * `SHA256SUMS` 본문을 해석한다. 빈 줄은 무시하고 형식이 어긋난 줄은 오류다.
 *
 * @param text - `SHA256SUMS` 본문
 * @returns 파일명과 SHA-256 16진수 목록
 * @throws Error 줄 형식이 `<hex>  <파일명>`이 아니면
 */
export function parseSha256Sums(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    if (match === null) throw new Error(`SHA256SUMS line is malformed: ${line}`);
    entries.push({ sha256: match[1], file: match[2] });
  }
  return entries;
}

/**
 * 디렉터리 안의 파일이 `SHA256SUMS`와 모두 일치하는지 확인한다.
 *
 * @param dir - 파일이 있는 디렉터리
 * @param text - `SHA256SUMS` 본문
 * @returns 확인한 파일명 목록
 * @throws Error 목록이 비었거나, 파일이 없거나, 해시가 다르면
 */
export async function verifySha256Sums(dir, text) {
  const entries = parseSha256Sums(text);
  if (entries.length === 0) throw new Error('SHA256SUMS has no entries');
  for (const entry of entries) {
    let data;
    try {
      data = await readFile(path.join(dir, entry.file));
    } catch {
      throw new Error(`artifact file is missing: ${entry.file}`);
    }
    const actual = sha256Hex(data);
    if (actual !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${entry.file}: expected ${entry.sha256}, got ${actual}`);
    }
  }
  return entries.map((entry) => entry.file);
}
