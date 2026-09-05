import { describe, expect, it } from 'vitest';
import {
  FormulaSyntaxError,
  collectFormulaReferences,
  escapeReferenceKey,
  evaluateFormula,
  formatReferencePath,
  parseFormula,
  renameFormulaReferences,
  type FormulaContext,
} from '../src/index.js';

const ctx = (values: FormulaContext['values'] = {}, reserved?: FormulaContext['reserved']): FormulaContext =>
  reserved ? { values, reserved } : { values };

function syntaxError(source: string, locale?: string): FormulaSyntaxError {
  try {
    parseFormula(source, locale === undefined ? undefined : { locale });
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return error;
    throw error;
  }
  throw new Error(`파싱이 실패해야 합니다: ${source}`);
}

describe('값 참조 $(...)', () => {
  it('$(datas-2)는 키 하나이고 $(datas) - 2는 뺄셈이다', () => {
    const values = { datas: 10, 'datas-2': 99 };
    expect(evaluateFormula('$(datas-2)', ctx(values))).toBe(99);
    expect(evaluateFormula('$(datas) - 2', ctx(values))).toBe(8);
  });

  it('식별자 규칙에 맞지 않는 키를 읽는다', () => {
    const values = {
      'customer.name': '홍길동',
      'unit price': 1500,
      '2nd': 2,
      금액: 3000,
      金額: 4000,
      नमस्ते: 'hi',
      'a)b': 'paren',
      'a\\b': 'backslash',
    };
    expect(evaluateFormula('$(customer.name)', ctx(values))).toBe('홍길동');
    expect(evaluateFormula('$(unit price)', ctx(values))).toBe(1500);
    expect(evaluateFormula('$(2nd)', ctx(values))).toBe(2);
    expect(evaluateFormula('$(금액)', ctx(values))).toBe(3000);
    expect(evaluateFormula('$(金額)', ctx(values))).toBe(4000);
    expect(evaluateFormula('$(नमस्ते)', ctx(values))).toBe('hi');
    expect(evaluateFormula('$(a\\)b)', ctx(values))).toBe('paren');
    expect(evaluateFormula('$(a\\\\b)', ctx(values))).toBe('backslash');
  });

  it('$( ) 안의 공백은 키의 일부다', () => {
    const values = { ' padded ': 'yes', padded: 'no' };
    expect(evaluateFormula('$( padded )', ctx(values))).toBe('yes');
  });

  it('한 단계와 여러 단계 경로를 구분한다', () => {
    const values = { customer: { name: '중첩' }, 'customer.name': '평면' };
    expect(evaluateFormula('$(customer.name)', ctx(values))).toBe('평면');
    expect(evaluateFormula('$(customer).$(name)', ctx(values))).toBe('중첩');
    expect(parseFormula('$(customer).$(name)')).toEqual({
      type: 'reference',
      path: ['customer', 'name'],
      span: { start: 0, end: 19 },
    });
  });

  it('행 배열 위의 경로는 배열을 돌려준다', () => {
    const values = { 'order-items': [{ 'unit-price': 100 }, { 'unit-price': 250 }] };
    expect(evaluateFormula('$(order-items).$(unit-price)', ctx(values))).toEqual([100, 250]);
    expect(evaluateFormula('SUM($(order-items).$(unit-price))', ctx(values))).toBe(350);
  });

  it('예약 참조 뒤에 $( ) 단계를 이을 수 있다', () => {
    const reserved = {
      '@item': { 'unit-price': 70 },
      '@page': [{ 'line-amount': 1 }, { 'line-amount': 2 }],
    };
    expect(evaluateFormula('@item.$(unit-price)', ctx({}, reserved))).toBe(70);
    expect(evaluateFormula('SUM(@page.$(line-amount))', ctx({}, reserved))).toBe(3);
    expect(parseFormula('@item.$(unit-price)')).toEqual({
      type: 'reference',
      path: ['@item', 'unit-price'],
      reserved: true,
      span: { start: 0, end: 19 },
    });
    // 예약 참조 이름 하나만 적은 것은 그대로 허용한다.
    expect(parseFormula('@item')).toEqual({
      type: 'reference',
      path: ['@item'],
      reserved: true,
      span: { start: 0, end: 5 },
    });
    expect(parseFormula('@item + $(x)')).toMatchObject({ type: 'binary', operator: '+' });
  });

  it('$(@item)·$(@page)·$(@foo)는 예약 참조가 아니라 그 이름의 값 키다', () => {
    const values = { '@item': 3, '@page': { n: 7 }, '@foo': 'foo' };
    // 예약 참조를 공급하지 않는 문맥에서도 값 키로 읽는다.
    expect(evaluateFormula('$(@item)', ctx(values))).toBe(3);
    expect(evaluateFormula('$(@page).$(n)', ctx(values))).toBe(7);
    expect(evaluateFormula('$(@foo)', ctx(values))).toBe('foo');
    expect(evaluateFormula('$(@item) + 1', ctx(values))).toBe(4);
    // 예약 참조를 공급하는 문맥에서도 $(@item)은 값 키 쪽을 읽는다.
    const reserved = { '@item': { amount: 100 }, '@page': [{ amount: 1 }] };
    expect(evaluateFormula('$(@item)', ctx(values, reserved))).toBe(3);
    expect(evaluateFormula('$(@page).$(n)', ctx(values, reserved))).toBe(7);
    // 값 키가 없으면 빈 값이고, 예약 참조 오류가 아니다.
    expect(evaluateFormula('$(@item)', ctx({}, reserved))).toBeNull();
    expect(evaluateFormula('$(@item)', ctx({}))).toBeNull();
    expect(parseFormula('$(@item)')).toEqual({
      type: 'reference',
      path: ['@item'],
      span: { start: 0, end: 8 },
    });
    expect(parseFormula('$(@item)')).not.toHaveProperty('reserved');
  });

  it('같은 수식에서 @item은 예약 참조, $(@item)은 값 키로 함께 쓸 수 있다', () => {
    const values = { '@item': 3 };
    const reserved = { '@item': { amount: 100 } };
    expect(evaluateFormula('@item.$(amount) + $(@item)', ctx(values, reserved))).toBe(103);
    expect(collectFormulaReferences('@item.$(amount) + $(@item)')).toEqual([
      { path: ['@item', 'amount'], reserved: true, span: { start: 0, end: 15 } },
      { path: ['@item'], reserved: false, span: { start: 18, end: 26 } },
    ]);
    // 예약 참조가 없는 문맥에서는 @item만 실패한다.
    expect(() => evaluateFormula('@item.$(amount) + $(@item)', ctx(values))).toThrow(/grid row bands/);
  });

  it('문자열 리터럴 안의 $(와 이름은 참조가 아니다', () => {
    expect(evaluateFormula('IF($(amount) > 1, "$(x)", "amount")', ctx({ amount: 2 }))).toBe('$(x)');
    expect(evaluateFormula('IF($(amount) > 1, "$(x)", "amount")', ctx({ amount: 0 }))).toBe('amount');
    expect(collectFormulaReferences('IF($(amount) > 1, "$(x)", "amount")')).toEqual([
      { path: ['amount'], reserved: false, span: { start: 3, end: 12 } },
    ]);
  });

  it('함수 이름과 TRUE·FALSE만 $( ) 없이 적는다', () => {
    expect(evaluateFormula('IF(TRUE, 1, 2)', ctx())).toBe(1);
    expect(evaluateFormula('IF(false, 1, 2)', ctx())).toBe(2);
    expect(evaluateFormula('sum($(items).$(amount))', ctx({ items: [{ amount: 1 }, { amount: 2 }] }))).toBe(3);
    // 함수 이름을 값처럼 쓰면 참조로 보고 거부한다.
    expect(syntaxError('SUM + 1').message).toBe("'SUM' must be written as $(SUM)");
  });
});

describe('$( ) 없이 적은 참조는 고쳐 쓸 예와 함께 거부한다', () => {
  it('키 하나를 그대로 적은 이름', () => {
    const error = syntaxError('amount');
    expect(error.message).toBe("'amount' must be written as $(amount)");
    expect(error.position).toBe(0);
    expect(syntaxError('1 + rate * 2').position).toBe(4);
  });

  it('점으로 이은 경로', () => {
    const error = syntaxError('items.amount');
    expect(error.message).toBe("'items.amount' must be written as $(items).$(amount)");
    expect(error.position).toBe(0);
    expect(syntaxError('a.b.c').message).toBe("'a.b.c' must be written as $(a).$(b).$(c)");
    // 단계 사이의 공백은 고쳐 쓸 예에서 사라진다.
    expect(syntaxError('items . 금액').message).toBe("'items.금액' must be written as $(items).$(금액)");
  });

  it('예약 참조 뒤의 하위 필드', () => {
    const error = syntaxError('@item.amount');
    expect(error.message).toBe("'@item.amount' must be written as @item.$(amount)");
    expect(error.position).toBe(0);
    expect(syntaxError('SUM(@page.amount)').message).toBe("'@page.amount' must be written as @page.$(amount)");
    expect(syntaxError('SUM(@page.amount)').position).toBe(4);
    expect(syntaxError('@item.a.$(b)').message).toBe("'@item.a.$(b)' must be written as @item.$(a).$(b)");
  });

  it('일부 단계만 $( )로 적은 경로', () => {
    const tail = syntaxError('$(items).amount');
    expect(tail.message).toBe("'$(items).amount' must be written as $(items).$(amount)");
    expect(tail.position).toBe(0);
    const head = syntaxError('items.$(amount)');
    expect(head.message).toBe("'items.$(amount)' must be written as $(items).$(amount)");
    expect(head.position).toBe(0);
    // 이미 $( )로 적은 단계는 이스케이프까지 그대로 보여 준다.
    expect(syntaxError('$(a\\)b).c').message).toBe("'$(a\\)b).c' must be written as $(a\\)b).$(c)");
  });

  it('수식 일부가 $( )를 써도 나머지 참조는 따로 거부한다', () => {
    const error = syntaxError('SUM(items.amount) + $(x)');
    expect(error.message).toBe("'items.amount' must be written as $(items).$(amount)");
    expect(error.position).toBe(4);
    expect(syntaxError('$(a) + amount').position).toBe(7);
  });

  it('한국어·일본어 메시지에도 고쳐 쓸 예를 담는다', () => {
    expect(syntaxError('items.amount', 'ko').message).toBe(
      "'items.amount'은(는) $(items).$(amount)으로 써야 합니다",
    );
    expect(syntaxError('@item.amount', 'ko').message).toBe("'@item.amount'은(는) @item.$(amount)으로 써야 합니다");
    expect(syntaxError('items.amount', 'ja').message).toBe(
      "'items.amount' は $(items).$(amount) と書く必要があります",
    );
    expect(syntaxError('@item.amount', 'ja').message).toBe("'@item.amount' は @item.$(amount) と書く必要があります");
  });

  it('알 수 없는 예약 참조 이름은 별도 오류다', () => {
    expect(syntaxError('@foo').message).toMatch(/Unknown reserved reference: @foo/);
    expect(syntaxError('@foo.$(x)').message).toMatch(/Unknown reserved reference: @foo/);
  });

  it('evaluateFormula와 collectFormulaReferences도 같은 오류를 낸다', () => {
    expect(() => evaluateFormula('amount + 1', ctx({ amount: 1 }))).toThrow(FormulaSyntaxError);
    expect(() => evaluateFormula('amount + 1', ctx({ amount: 1 }))).toThrow(/must be written as \$\(amount\)/);
    expect(() => collectFormulaReferences('SUM(items.amount)')).toThrow(/\$\(items\)\.\$\(amount\)/);
  });
});

describe('$( ) 문법 오류', () => {
  it('$name은 $(name)을 안내한다', () => {
    const error = syntaxError('$datas + 1');
    expect(error.message).toBe('Write $(datas) instead of $datas');
    expect(error.position).toBe(0);
    expect(syntaxError('1 + $datas', 'ko').message).toBe('$datas 대신 $(datas)으로 쓰세요');
    expect(syntaxError('1 + $datas', 'ja').message).toBe('$datas ではなく $(datas) と書いてください');
    expect(syntaxError('1 + $datas').position).toBe(4);
  });

  it('빈 단계·닫히지 않은 참조·잘못된 이스케이프는 위치와 함께 실패한다', () => {
    const empty = syntaxError('1 + $()');
    expect(empty.message).toMatch(/cannot be empty/);
    expect(empty.position).toBe(4);

    const open = syntaxError('$(abc');
    expect(open.message).toMatch(/not closed/);
    expect(open.position).toBe(0);
    expect(syntaxError('$(abc\\').position).toBe(0);

    const escape = syntaxError('$(a\\b)');
    expect(escape.message).toContain("'\\b'");
    expect(escape.position).toBe(3);
    expect(syntaxError('$(a\\b)', 'ko').message).toContain('이스케이프');
  });

  it('홀로 쓴 $는 알 수 없는 문자다', () => {
    expect(syntaxError('$ + 1').message).toMatch(/Unknown character/);
  });

  it('점 뒤에 단계가 없으면 실패한다', () => {
    expect(syntaxError('$(a).').message).toMatch(/field name must follow/);
    expect(syntaxError('@item.').message).toMatch(/field name must follow/);
    expect(syntaxError('$(a).(b)').message).toMatch(/field name must follow/);
  });
});

describe('객체가 직접 가진 키만 읽는다', () => {
  it('constructor·toString·__proto__는 없으면 빈 값이고 함수가 아니다', () => {
    for (const source of ['$(constructor)', '$(toString)', '$(__proto__)']) {
      expect(evaluateFormula(source, ctx({}))).toBeNull();
    }
    expect(evaluateFormula('$(items).$(constructor)', ctx({ items: [{}, {}] }))).toEqual([null, null]);
  });

  it('직접 가진 값이면 일반 키처럼 읽는다', () => {
    const values = JSON.parse('{"constructor": 7, "toString": "text", "__proto__": {"x": 1}}') as Record<string, unknown>;
    expect(evaluateFormula('$(constructor) + 1', ctx(values))).toBe(8);
    expect(evaluateFormula('$(toString)', ctx(values))).toBe('text');
    expect(evaluateFormula('$(__proto__).$(x)', ctx(values))).toBe(1);
  });

  it('예약 참조 값도 직접 가진 키만 읽는다', () => {
    expect(evaluateFormula('@item.$(x)', ctx({}, { '@item': { x: 1 } }))).toBe(1);
    expect(evaluateFormula('@item.$(constructor)', ctx({}, { '@item': { x: 1 } }))).toBeNull();
  });
});

describe('참조 표기 도우미', () => {
  it('formatReferencePath는 이스케이프하고 reserved를 지정한 예약 이름만 그대로 둔다', () => {
    expect(formatReferencePath(['a', 'b'])).toBe('$(a).$(b)');
    expect(formatReferencePath(['@item', 'unit-price'], { reserved: true })).toBe('@item.$(unit-price)');
    expect(formatReferencePath(['@item'], { reserved: true })).toBe('@item');
    // 이름만으로 예약 참조로 보지 않는다 — 지정하지 않으면 값 키다.
    expect(formatReferencePath(['@item'])).toBe('$(@item)');
    expect(formatReferencePath(['@item', 'unit-price'])).toBe('$(@item).$(unit-price)');
    expect(formatReferencePath(['@item'], { reserved: false })).toBe('$(@item)');
    expect(formatReferencePath(['@foo'])).toBe('$(@foo)');
    expect(formatReferencePath(['a)b', 'c\\d'])).toBe('$(a\\)b).$(c\\\\d)');
    expect(escapeReferenceKey(')\\')).toBe('\\)\\\\');
    expect(() => formatReferencePath([])).toThrow(RangeError);
    // 예약 참조 이름이 아닌 첫 단계를 그대로 적으면 파싱할 수 없는 문자열이 되므로 거부한다.
    expect(() => formatReferencePath(['amount'], { reserved: true })).toThrow(RangeError);
    expect(() => formatReferencePath(['@foo', 'x'], { reserved: true })).toThrow(RangeError);
  });

  it('formatReferencePath 결과를 파싱하면 같은 경로가 된다', () => {
    for (const path of [['a)b', 'c\\d'], ['x.y', ' z '], ['\\)', ')('], ['@item'], ['@page', 'line-amount'], ['TRUE'], ['SUM']]) {
      const ast = parseFormula(formatReferencePath(path));
      expect(ast).toMatchObject({ type: 'reference', path });
      expect(ast).not.toHaveProperty('reserved');
    }
    const reserved = parseFormula(formatReferencePath(['@page', 'line-amount'], { reserved: true }));
    expect(reserved).toMatchObject({ type: 'reference', path: ['@page', 'line-amount'], reserved: true });
  });

  it('collectFormulaReferences는 원본 순서와 범위를 돌려준다', () => {
    expect(collectFormulaReferences('SUM($(items).$(amount)) + @item.$(x) * $(rate)')).toEqual([
      { path: ['items', 'amount'], reserved: false, span: { start: 4, end: 22 } },
      { path: ['@item', 'x'], reserved: true, span: { start: 26, end: 36 } },
      { path: ['rate'], reserved: false, span: { start: 39, end: 46 } },
    ]);
    expect(collectFormulaReferences('IF(TRUE, "items", 1)')).toEqual([]);
    expect(collectFormulaReferences('@page + @item')).toEqual([
      { path: ['@page'], reserved: true, span: { start: 0, end: 5 } },
      { path: ['@item'], reserved: true, span: { start: 8, end: 13 } },
    ]);
  });
});

describe('renameFormulaReferences', () => {
  it('일치하는 참조만 새 경로로 바꾼다', () => {
    expect(
      renameFormulaReferences('SUM($(items).$(amount)) + $(itemsExtra) + $(items)', ['items'], ['lines']),
    ).toBe('SUM($(lines).$(amount)) + $(itemsExtra) + $(lines)');
    expect(renameFormulaReferences('$(items).$(amount) * 2', ['items', 'amount'], ['items', 'total'])).toBe(
      '$(items).$(total) * 2',
    );
  });

  it('식별자 규칙에 맞지 않는 새 이름도 이스케이프해 그대로 넣는다', () => {
    expect(renameFormulaReferences('SUM($(items).$(amount)) + $(rate)', ['items'], ['order-items'])).toBe(
      'SUM($(order-items).$(amount)) + $(rate)',
    );
    expect(renameFormulaReferences('$(amount) + 1', ['amount'], ['नमस्ते'])).toBe('$(नमस्ते) + 1');
    expect(renameFormulaReferences('$(amount) + 1', ['amount'], ['TRUE'])).toBe('$(TRUE) + 1');
    expect(renameFormulaReferences('$(amount) + 1', ['amount'], ['customer.name'])).toBe('$(customer.name) + 1');
    expect(renameFormulaReferences('$(a\\)b) + $(c)', ['a)b'], ['x\\y'])).toBe('$(x\\\\y) + $(c)');
  });

  it('공백이 섞인 경로도 범위째 바꾼다', () => {
    expect(renameFormulaReferences('$(items) . $(금액) + 1', ['items'], ['lines'])).toBe('$(lines).$(금액) + 1');
  });

  it('reservedRoot를 지정하면 예약 참조 뒤의 하위 필드를 바꾼다', () => {
    const reserved = { reservedRoot: true } as const;
    expect(
      renameFormulaReferences('@item.$(amount) + @page.$(amount)', ['@item', 'amount'], ['@item', 'sum'], reserved),
    ).toBe('@item.$(sum) + @page.$(amount)');
    expect(
      renameFormulaReferences('@item.$(amount)', ['@item', 'amount'], ['@item', 'unit-price'], reserved),
    ).toBe('@item.$(unit-price)');
    expect(
      renameFormulaReferences('@item.$(amount) + $(@item)', ['@item', 'amount'], ['@item', 'sum'], reserved),
    ).toBe('@item.$(sum) + $(@item)');
    // 지정하지 않으면 @item은 값 키라 예약 참조와 맞지 않는다.
    expect(renameFormulaReferences('@item.$(amount)', ['@item', 'amount'], ['@item', 'sum'])).toBe('@item.$(amount)');
    // 첫 단계가 예약 참조 이름이 아니면 거부한다.
    expect(() => renameFormulaReferences('$(a).$(b)', ['a', 'b'], ['a', 'c'], reserved)).toThrow(RangeError);
    expect(() => renameFormulaReferences('@item.$(b)', ['@item', 'b'], ['x', 'c'], reserved)).toThrow(RangeError);
  });

  it('값 키를 @item으로 바꾸면 $(@item)이 되고, 다시 되돌릴 수 있다', () => {
    const renamed = renameFormulaReferences('$(amount) + 1', ['amount'], ['@item']);
    expect(renamed).toBe('$(@item) + 1');
    expect(evaluateFormula(renamed, ctx({ '@item': 3 }))).toBe(4);
    expect(evaluateFormula(renamed, ctx({ '@item': 3 }, { '@item': { amount: 100 } }))).toBe(4);
    // 되돌릴 때 from은 값 키 경로라 $(@item)과 맞는다.
    expect(renameFormulaReferences(renamed, ['@item'], ['amount'])).toBe('$(amount) + 1');
    expect(renameFormulaReferences('$(@foo).$(x)', ['@foo'], ['bar'])).toBe('$(bar).$(x)');
  });

  it('그리드 수식에서 하위 필드를 @item으로 바꿔도 예약 참조 @page는 그대로 남는다', () => {
    const reserved = { reservedRoot: true } as const;
    const renamed = renameFormulaReferences('SUM(@page.$(amount))', ['@page', 'amount'], ['@page', '@item'], reserved);
    expect(renamed).toBe('SUM(@page.$(@item))');
    expect(evaluateFormula(renamed, ctx({}, { '@page': [{ '@item': 1 }, { '@item': 2 }] }))).toBe(3);
    expect(renameFormulaReferences(renamed, ['@page', '@item'], ['@page', 'amount'], reserved)).toBe(
      'SUM(@page.$(amount))',
    );
  });

  it('일치하는 참조가 없거나 앞부분만 겹치면 바꾸지 않는다', () => {
    expect(renameFormulaReferences('$(itemsExtra) + 1', ['items'], ['x-y'])).toBe('$(itemsExtra) + 1');
    expect(renameFormulaReferences('IF(TRUE, "items", 1)', ['items'], ['lines'])).toBe('IF(TRUE, "items", 1)');
    expect(() => renameFormulaReferences('$(a)', [], ['b'])).toThrow(RangeError);
  });

  it('$( ) 없이 적은 참조가 있는 수식은 바꾸지 못하고 문법 오류를 낸다', () => {
    expect(() => renameFormulaReferences('SUM(items.amount)', ['items'], ['lines'])).toThrow(FormulaSyntaxError);
  });

  it('이름을 바꾼 수식은 바뀐 데이터로 같은 값을 낸다', () => {
    const source = 'SUM($(items).$(amount)) * $(rate)';
    const renamed = renameFormulaReferences(source, ['items'], ['order-items']);
    const before = evaluateFormula(source, ctx({ items: [{ amount: 2 }, { amount: 3 }], rate: 10 }));
    const after = evaluateFormula(renamed, ctx({ 'order-items': [{ amount: 2 }, { amount: 3 }], rate: 10 }));
    expect(after).toBe(before);
  });
});
