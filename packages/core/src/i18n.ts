/**
 * 사용자 대면 메시지의 언어 결정.
 *
 * 메시지 언어는 BCP 47 로케일의 언어 부분으로 고르며, 영어가 기본이다.
 * 숫자·날짜 형식에 쓰는 로케일(`FORMAT_NUMBER` 등)과 같은 값을 받아 함께 움직인다.
 */

/** 메시지를 제공하는 언어 */
export type MessageLocale = 'en' | 'ko' | 'ja';

/**
 * 로케일 문자열에서 메시지 언어를 고른다.
 *
 * @param locale - BCP 47 로케일 (예: `'ko-KR'`, `'ja'`). 생략하거나 지원하지 않는 언어면 영어
 * @returns 메시지 언어
 */
export function resolveMessageLocale(locale?: string): MessageLocale {
  const language = locale?.toLowerCase().split('-')[0];
  return language === 'ko' || language === 'ja' ? language : 'en';
}
