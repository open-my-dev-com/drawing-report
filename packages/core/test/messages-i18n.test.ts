import { describe, expect, it } from 'vitest';
import { em } from '../src/encryption/messages.js';
import { fmt, withFormatLocale } from '../src/format/messages.js';
import { fm, withFormulaLocale } from '../src/formula/messages.js';
import { lm } from '../src/layout/messages.js';
import { rm } from '../src/render/messages.js';

// 세 언어 사전이 같은 문구를 갖추고, 받은 인자를 실제로 문구에 담는지 확인한다.

type Message = (...args: never[]) => string;
type Dictionary = Record<string, Message>;

const LOCALES = ['en', 'ko', 'ja'] as const;

const DICTIONARIES: Record<string, (locale: string) => Dictionary> = {
  format: (locale) => withFormatLocale(locale, () => fmt()) as unknown as Dictionary,
  formula: (locale) => withFormulaLocale(locale, () => fm()) as unknown as Dictionary,
  layout: (locale) => lm(locale) as unknown as Dictionary,
  render: (locale) => rm(locale) as unknown as Dictionary,
  encryption: (locale) => em(locale) as unknown as Dictionary,
};

/** 문구에 그대로 나타나야 하는 인자 표시 */
const mark = (index: number): string => `«arg${index}»`;

/**
 * 값에 따라 다른 문장을 고르는 인자는 실제 값을 넘겨야 하므로 따로 지정한다.
 * `mark`가 아닌 값은 문구에 그대로 나타나지 않아도 된다.
 */
const FIXED_ARGS: Record<string, unknown[]> = {
  'render.imageInvalid': [mark(0), 'content'],
  'layout.fixedPageTooTall': [mark(0), mark(1), 'first-page'],
  'layout.bandsTooTall': [mark(0), 'empty-page'],
  'formula.rangeNotAllowed': [{ kind: 'functionArg', name: mark(0) }],
  'formula.numberNotFinite': ['value'],
  'formula.mustBeNumber': ['value', mark(1)],
  'formula.mustBeInteger': ['digits'],
  'formula.dateNotReal': ['date', mark(1)],
  'formula.dateInvalid': ['date', mark(1)],
  'formula.dateOffsetRange': ['date', mark(1)],
  'formula.dateYearRange': ['date', mark(1)],
  // 바이트를 MiB로 바꿔 보여 주므로 실제 수를 넘기고 변환 결과를 확인한다.
  'format.imageTooLarge': [2 * 1024 * 1024],
};

/** 인자를 그대로 쓰지 않고 변환해 보여 주는 문구가 담아야 할 값 */
const DERIVED_TEXT: Record<string, string> = {
  'format.imageTooLarge': '2',
};

/** 문구 하나를 호출할 때 넘길 인자 */
function argsFor(name: string, fn: Message): unknown[] {
  return FIXED_ARGS[name] ?? Array.from({ length: fn.length }, (_, index) => mark(index));
}

describe('core 메시지 사전 (ADR-060)', () => {
  it('세 언어 사전이 같은 문구 목록을 갖는다', () => {
    for (const [name, load] of Object.entries(DICTIONARIES)) {
      const [en, ko, ja] = LOCALES.map((locale) => Object.keys(load(locale)).sort());
      expect(ko, `${name} 한국어 사전`).toEqual(en);
      expect(ja, `${name} 일본어 사전`).toEqual(en);
    }
  });

  it('세 언어 사전이 같은 개수의 인자를 받는다', () => {
    for (const [name, load] of Object.entries(DICTIONARIES)) {
      const en = load('en');
      for (const locale of ['ko', 'ja'] as const) {
        const dict = load(locale);
        for (const key of Object.keys(en)) {
          expect(dict[key]!.length, `${name}.${key} (${locale})`).toBe(en[key]!.length);
        }
      }
    }
  });

  it('모든 문구가 받은 인자를 빠짐없이 문구에 담는다', () => {
    for (const [name, load] of Object.entries(DICTIONARIES)) {
      for (const locale of LOCALES) {
        const dict = load(locale);
        for (const [key, message] of Object.entries(dict)) {
          const args = argsFor(`${name}.${key}`, message);
          const text = message(...(args as never[]));
          expect(text.trim(), `${name}.${key} (${locale})`).not.toBe('');
          const derived = DERIVED_TEXT[`${name}.${key}`];
          if (derived !== undefined) expect(text, `${name}.${key} (${locale})`).toContain(derived);
          for (const arg of args) {
            if (typeof arg !== 'string' || !arg.startsWith('«arg')) continue;
            expect(text, `${name}.${key} (${locale})`).toContain(arg);
          }
        }
      }
    }
  });
});
