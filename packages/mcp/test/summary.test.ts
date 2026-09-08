import { describe, expect, it } from 'vitest';
import { elideDataUrls } from '../src/summary.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** JSON 문자열을 파싱해 `__proto__` 같은 키를 자신의 속성으로 가진 객체를 만든다. */
function fromJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

describe('요약의 data URL 치환', () => {
  it('문법을 만족하는 data URL은 길이와 상관없이 크기 자리표시자로 바꾼다', () => {
    expect(elideDataUrls('data:image/png;base64,iVBORw0KGgo=')).toBe('[data 1KB image/png]');
    expect(elideDataUrls(PNG_1PX)).toBe('[data 1KB image/png]');
    const long = `data:image/jpeg;base64,${'/9j/'.repeat(3 * 1024)}`;
    expect(elideDataUrls(long)).toBe('[data 12KB image/jpeg]');
    // 파라미터가 있는 MIME과 base64가 아닌 data URL도 문법에 맞으면 치환한다.
    expect(elideDataUrls('data:text/plain;charset=utf-8;base64,aGVsbG8=')).toBe('[data 1KB text/plain]');
    expect(elideDataUrls('data:text/plain,hello%20world')).toBe('[data 1KB text/plain]');
  });

  it('data:로 시작하는 일반 문자열은 원문 그대로 둔다', () => {
    for (const text of [
      'data:2026-09-08 매출 마감',
      'data:마감',
      'data:',
      'data:image/png',
      'data:,x',
      'data: image/png;base64,AAAA',
      'Data:image/png;base64,AAAA',
    ]) {
      expect(elideDataUrls(text)).toBe(text);
    }
  });

  it('문법에 어긋나는 data URL은 치환하지 않는다', () => {
    for (const text of [
      'data:image;base64,AAAA',
      'data:image/png;base64,AAAA AAAA',
      'data:image/png;base64,AAAA!',
      'data:image/png;base64',
      'data:image/png;charset,AAAA',
      'data:text/plain,hello world',
    ]) {
      expect(elideDataUrls(text)).toBe(text);
    }
  });

  it('URL·숫자·불리언·null은 그대로 둔다', () => {
    expect(elideDataUrls('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(elideDataUrls(12)).toBe(12);
    expect(elideDataUrls(true)).toBe(true);
    expect(elideDataUrls(null)).toBeNull();
    expect(elideDataUrls(undefined)).toBeUndefined();
  });

  it('중첩된 values·content 안의 data URL만 바꾸고 나머지 값은 유지한다', () => {
    const input = {
      values: {
        memo: 'data:2026-09-08 매출 마감',
        sign: PNG_1PX,
        items: [{ name: 'a', photo: PNG_1PX }, { name: 'data:b', photo: '' }],
      },
      pages: [{ elements: [{ id: 'tx', content: 'data:안내 문구' }, { id: 'img', src: PNG_1PX }] }],
    };
    expect(elideDataUrls(input)).toEqual({
      values: {
        memo: 'data:2026-09-08 매출 마감',
        sign: '[data 1KB image/png]',
        items: [{ name: 'a', photo: '[data 1KB image/png]' }, { name: 'data:b', photo: '' }],
      },
      pages: [{ elements: [{ id: 'tx', content: 'data:안내 문구' }, { id: 'img', src: '[data 1KB image/png]' }] }],
    });
    // 원본은 바꾸지 않는다.
    expect(input.values.sign).toBe(PNG_1PX);
  });

  it('__proto__·constructor 키는 자신의 속성으로 유지하고 값도 치환한다', () => {
    const elided = elideDataUrls(
      fromJson(`{"__proto__":{"deep":"${PNG_1PX}"},"constructor":"data:c","toString":"data:text/plain,t"}`),
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(elided)).toBe(Object.prototype);
    expect(Object.hasOwn(elided, '__proto__')).toBe(true);
    expect(elided['__proto__']).toEqual({ deep: '[data 1KB image/png]' });
    expect(elided['constructor']).toBe('data:c');
    expect(elided['toString']).toBe('[data 1KB text/plain]');
  });
});
