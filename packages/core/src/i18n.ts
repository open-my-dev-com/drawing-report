/**
 * 사용자에게 표시할 메시지 언어를 결정합니다.
 *
 * 메시지 언어는 BCP 47 로케일의 언어 부분으로 고르며, 영어가 기본입니다.
 * 숫자·날짜 형식(`FORMAT_NUMBER` 등)과 동일한 로케일 값을 사용합니다.
 */

/** 메시지를 제공하는 언어입니다. */
export type MessageLocale = 'en' | 'ko' | 'ja';

/**
 * 로케일 문자열에서 메시지 언어를 선택합니다.
 *
 * @param locale - BCP 47 로케일 (예: `'ko-KR'`, `'ja'`). 생략하거나 지원하지 않는 언어면 영어
 * @returns 메시지 언어
 */
export function resolveMessageLocale(locale?: string): MessageLocale {
  const language = locale?.toLowerCase().split('-')[0];
  return language === 'ko' || language === 'ja' ? language : 'en';
}
