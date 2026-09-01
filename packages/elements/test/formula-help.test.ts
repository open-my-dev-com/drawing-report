import { describe, expect, it } from 'vitest';
import { FORMULA_ARITY, FORMULA_FUNCTIONS, evaluateFormula } from '@omdc-slipkit/core';
import { getFormulaHelp } from '../src/formula-help.js';

describe('수식 함수 도움말 (D-12)', () => {
  it.each(['ko', 'en', 'ja'] as const)(
    '%s 도움말이 core 함수 목록(32종, ADR-017·044)과 빠짐없이 일치한다',
    (locale) => {
      const names = getFormulaHelp(locale).flatMap((category) =>
        category.functions.map((fn) => fn.name),
      );
      expect([...names].sort()).toEqual([...FORMULA_FUNCTIONS].sort());
      expect(new Set(names).size).toBe(names.length);
    },
  );

  it('모든 항목이 사용법·설명을 갖고, 사용법은 함수 이름으로 시작한다', () => {
    for (const locale of ['ko', 'en', 'ja'] as const) {
      for (const category of getFormulaHelp(locale)) {
        expect(category.title.length).toBeGreaterThan(0);
        for (const fn of category.functions) {
          expect(fn.signature.startsWith(fn.name)).toBe(true);
          expect(fn.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('모든 항목이 사용법 표기와 같은 수의 인자 설명과 반환값 설명을 갖는다', () => {
    for (const locale of ['ko', 'en', 'ja'] as const) {
      for (const category of getFormulaHelp(locale)) {
        for (const fn of category.functions) {
          const inside = fn.signature.slice(fn.signature.indexOf('(') + 1, fn.signature.lastIndexOf(')'));
          // 사용법 표기의 `…`는 앞 인자를 여러 번 쓸 수 있다는 뜻이라 인자 하나로 셉니다.
          const written = inside.trim() === ''
            ? []
            : inside.split(',').map((part) => part.trim()).filter((part) => part !== '…');
          expect(fn.args.length, `${locale} ${fn.name}`).toBe(written.length);
          fn.args.forEach((arg, index) => {
            expect(arg.name, `${locale} ${fn.name}`).toBe(written[index]!.replace(/\?$/, ''));
            expect(arg.description.length).toBeGreaterThan(0);
            expect(arg.optional === true, `${locale} ${fn.name} ${arg.name}`)
              .toBe(written[index]!.endsWith('?'));
            expect(arg.variadic === true, `${locale} ${fn.name} ${arg.name}`)
              .toBe(inside.includes('…') && index === fn.args.length - 1);
          });
          expect(fn.returns.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('인자 도움말이 core의 허용 인자 수와 어긋나지 않는다', () => {
    for (const locale of ['ko', 'en', 'ja'] as const) {
      for (const category of getFormulaHelp(locale)) {
        for (const fn of category.functions) {
          const arity = FORMULA_ARITY[fn.name as keyof typeof FORMULA_ARITY];
          const variadic = fn.args.some((arg) => arg.variadic === true);
          const where = `${locale} ${fn.name}`;
          // 개수 제한이 없는 함수만 반복 인자로 적습니다.
          expect(variadic, where).toBe(arity.max === undefined);
          if (variadic) continue;
          expect(fn.args.length, where).toBe(arity.max);
          expect(fn.args.filter((arg) => arg.optional !== true).length, where).toBe(arity.min);
        }
      }
    }
  });

  it('생략 가능 인자의 기본값 설명이 실제 계산 결과와 맞는다', () => {
    const help = new Map(
      getFormulaHelp('en').flatMap((category) => category.functions).map((fn) => [fn.name, fn]),
    );
    const evaluate = (source: string): unknown => evaluateFormula(source, { values: {} });

    // VAT의 세율은 백분율 포인트이고 생략하면 10입니다 — 0.1로 알리면 100배 어긋납니다.
    expect(help.get('VAT')!.args[1]!.description).toContain('10');
    expect(evaluate('VAT(10000)')).toBe(1000);
    expect(evaluate('VAT(10000, 5)')).toBe(500);

    // FORMAT_NUMBER는 자릿수를 생략하면 있는 소수를 그대로 표기합니다.
    expect(help.get('FORMAT_NUMBER')!.args[1]!.description).not.toContain('0');
    expect(evaluate('FORMAT_NUMBER(1234567.5)')).toBe('1,234,567.5');
    expect(evaluate('FORMAT_NUMBER(1234567.5, 0)')).toBe('1,234,568');

    // IF의 세 번째 인자는 생략할 수 있고 생략하면 빈 값입니다.
    expect(help.get('IF')!.args[2]!.optional).toBe(true);
    expect(evaluate('IF(FALSE, 1)')).toBeNull();
  });

  it('지원하지 않는 로케일에는 영어를 사용한다', () => {
    expect(getFormulaHelp('fr')).toEqual(getFormulaHelp('en'));
    expect(getFormulaHelp(undefined)).toEqual(getFormulaHelp('en'));
    expect(getFormulaHelp('en-US')).toEqual(getFormulaHelp('en'));
    expect(getFormulaHelp('ja-JP')).toEqual(getFormulaHelp('ja'));
  });
});
