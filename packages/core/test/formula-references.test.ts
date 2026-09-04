import { describe, expect, it } from 'vitest';
import {
  FormulaSyntaxError,
  collectFormulaReferences,
  escapeReferenceKey,
  evaluateFormula,
  formatReferencePath,
  isBareIdentifier,
  parseFormula,
  renameFormulaReferences,
  toExplicitReferences,
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

describe('명시 참조 $(...)', () => {
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

  it('한 단계와 여러 단계 경로를 구분한다', () => {
    const values = { customer: { name: '중첩' }, 'customer.name': '평면' };
    expect(evaluateFormula('$(customer.name)', ctx(values))).toBe('평면');
    expect(evaluateFormula('$(customer).$(name)', ctx(values))).toBe('중첩');
    expect(parseFormula('$(customer).$(name)')).toEqual({
      type: 'reference',
      path: ['customer', 'name'],
      explicit: true,
      span: { start: 0, end: 19 },
    });
  });

  it('행 배열 위의 명시 경로는 배열을 돌려준다', () => {
    const values = { 'order-items': [{ 'unit-price': 100 }, { 'unit-price': 250 }] };
    expect(evaluateFormula('$(order-items).$(unit-price)', ctx(values))).toEqual([100, 250]);
    expect(evaluateFormula('SUM($(order-items).$(unit-price))', ctx(values))).toBe(350);
  });

  it('예약 참조 뒤에 명시 단계를 이을 수 있다', () => {
    const reserved = {
      '@item': { 'unit-price': 70 },
      '@page': [{ 'line-amount': 1 }, { 'line-amount': 2 }],
    };
    expect(evaluateFormula('@item.$(unit-price)', ctx({}, reserved))).toBe(70);
    expect(evaluateFormula('SUM(@page.$(line-amount))', ctx({}, reserved))).toBe(3);
    expect(parseFormula('@item.$(unit-price)')).toEqual({
      type: 'reference',
      path: ['@item', 'unit-price'],
      explicit: true,
      span: { start: 0, end: 19 },
    });
  });

  it('문자열 리터럴 안의 $(는 참조 형식을 바꾸지 않는다', () => {
    expect(evaluateFormula('IF(amount > 1, "$(x)", "no")', ctx({ amount: 2 }))).toBe('$(x)');
    expect(collectFormulaReferences('IF(amount > 1, "$(x)", "no")')).toEqual([
      { path: ['amount'], explicit: false, span: { start: 3, end: 9 } },
    ]);
  });
});

describe('일반 참조는 그대로 동작한다', () => {
  const items = [
    { 품명: '노트', 수량: 2, 금액: 3000 },
    { 품명: '연필', 수량: 10, 금액: 5000 },
  ];

  it('기존 수식의 파싱 결과와 평가 값이 같다', () => {
    const values = { items, rate: 0.1, customer: { name: '홍길동' } };
    expect(evaluateFormula('SUM(items.금액) * (1 + rate)', ctx(values))).toBeCloseTo(8800);
    expect(evaluateFormula('customer.name', ctx(values))).toBe('홍길동');
    expect(evaluateFormula('items.금액', ctx(values))).toEqual([3000, 5000]);
    expect(parseFormula('items.금액')).toEqual({
      type: 'reference',
      path: ['items', '금액'],
      span: { start: 0, end: 8 },
    });
    expect(parseFormula('@item.금액', undefined)).toEqual({
      type: 'reference',
      path: ['@item', '금액'],
      span: { start: 0, end: 8 },
    });
  });

  it('일반 참조 노드에는 explicit 표시가 없다', () => {
    for (const ref of collectFormulaReferences('SUM(items.금액) + rate + @item.금액')) {
      expect(ref.explicit).toBe(false);
    }
  });
});

describe('형식 혼용 오류', () => {
  it('명시 참조를 쓰는 수식의 일반 참조는 이름을 밝히며 거부한다', () => {
    const error = syntaxError('$(a) + amount');
    expect(error.message).toContain("'amount'");
    expect(error.message).toContain('$(amount)');
    expect(error.position).toBe(7);
    expect(syntaxError('$(a) + items.amount').message).toContain('$(items).$(amount)');
    expect(syntaxError('$(a) + amount', 'ko').message).toContain('$(amount)으로');
    expect(syntaxError('$(a) + amount', 'ja').message).toContain('$(amount)');
  });

  it('예약 참조 뒤의 일반 단계도 명시 수식에서는 거부한다', () => {
    const error = syntaxError('@item.amount + $(x)');
    expect(error.message).toContain("'@item.amount'");
    expect(error.message).toContain('@item.$(amount)');
    expect(error.position).toBe(0);
    // 예약 참조 이름 하나만 적은 것은 허용한다.
    expect(() => parseFormula('@item + $(x)')).not.toThrow();
  });

  it('한 경로 안에서 두 형식을 섞을 수 없다', () => {
    expect(syntaxError('$(items).amount').message).toMatch(/cannot mix/);
    expect(syntaxError('$(items).amount').position).toBe(9);
    expect(syntaxError('items.$(amount)').message).toMatch(/cannot mix/);
    expect(syntaxError('items.$(amount)').position).toBe(6);
    expect(syntaxError('@item.a.$(b)').message).toMatch(/cannot mix/);
    expect(syntaxError('items.$(amount)', 'ko').message).toContain('섞어 쓸 수 없습니다');
  });
});

describe('명시 참조 문법 오류', () => {
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
});

describe('객체가 직접 가진 키만 읽는다', () => {
  it('constructor·toString·__proto__는 없으면 빈 값이고 함수가 아니다', () => {
    for (const source of ['$(constructor)', 'constructor', '$(toString)', 'toString', '$(__proto__)', '__proto__']) {
      expect(evaluateFormula(source, ctx({}))).toBeNull();
    }
    expect(evaluateFormula('$(items).$(constructor)', ctx({ items: [{}, {}] }))).toEqual([null, null]);
  });

  it('직접 가진 값이면 일반 키처럼 읽는다', () => {
    const values = JSON.parse('{"constructor": 7, "toString": "text", "__proto__": {"x": 1}}') as Record<string, unknown>;
    expect(evaluateFormula('$(constructor) + 1', ctx(values))).toBe(8);
    expect(evaluateFormula('toString', ctx(values))).toBe('text');
    expect(evaluateFormula('$(__proto__).$(x)', ctx(values))).toBe(1);
  });

  it('예약 참조 값도 직접 가진 키만 읽는다', () => {
    expect(() => evaluateFormula('@item.x', ctx({}, { '@item': { x: 1 } }))).not.toThrow();
    expect(evaluateFormula('@item.$(constructor)', ctx({}, { '@item': { x: 1 } }))).toBeNull();
  });
});

describe('참조 표기 도우미', () => {
  it('isBareIdentifier는 토크나이저의 식별자 규칙을 따른다', () => {
    expect(isBareIdentifier('amount')).toBe(true);
    expect(isBareIdentifier('금액_2')).toBe(true);
    expect(isBareIdentifier('_x')).toBe(true);
    expect(isBareIdentifier('2nd')).toBe(false);
    expect(isBareIdentifier('unit-price')).toBe(false);
    expect(isBareIdentifier('customer.name')).toBe(false);
    expect(isBareIdentifier('unit price')).toBe(false);
    expect(isBareIdentifier('नमस्ते')).toBe(false);
    expect(isBareIdentifier('@item')).toBe(false);
    expect(isBareIdentifier('')).toBe(false);
  });

  it('formatReferencePath는 이스케이프하고 예약 이름은 그대로 둔다', () => {
    expect(formatReferencePath(['a', 'b'])).toBe('$(a).$(b)');
    expect(formatReferencePath(['@item', 'unit-price'])).toBe('@item.$(unit-price)');
    expect(formatReferencePath(['@item'])).toBe('@item');
    expect(formatReferencePath(['@item'], { reserved: false })).toBe('$(@item)');
    expect(formatReferencePath(['a)b', 'c\\d'])).toBe('$(a\\)b).$(c\\\\d)');
    expect(escapeReferenceKey(')\\')).toBe('\\)\\\\');
    expect(() => formatReferencePath([])).toThrow(RangeError);
  });

  it('formatReferencePath 결과를 파싱하면 같은 경로가 된다', () => {
    for (const path of [['a)b', 'c\\d'], ['x.y', ' z '], ['@page', 'line-amount'], ['\\)', ')(']]) {
      const ast = parseFormula(formatReferencePath(path));
      expect(ast).toMatchObject({ type: 'reference', path, explicit: true });
    }
  });

  it('collectFormulaReferences는 원본 순서와 범위를 돌려준다', () => {
    expect(collectFormulaReferences('SUM(items.amount) + @item.x * rate')).toEqual([
      { path: ['items', 'amount'], explicit: false, span: { start: 4, end: 16 } },
      { path: ['@item', 'x'], explicit: false, span: { start: 20, end: 27 } },
      { path: ['rate'], explicit: false, span: { start: 30, end: 34 } },
    ]);
    expect(collectFormulaReferences('SUM($(items).$(amount)) + @item.$(x)')).toEqual([
      { path: ['items', 'amount'], explicit: true, span: { start: 4, end: 22 } },
      { path: ['@item', 'x'], explicit: true, span: { start: 26, end: 36 } },
    ]);
  });
});

describe('toExplicitReferences', () => {
  it('일반 참조만 $(...)로 바꾸고 나머지는 그대로 둔다', () => {
    const source = 'SUM(items.금액) * rate + IF(FALSE, "items.x", 1) + @item.amount + @page';
    const explicit = toExplicitReferences(source);
    expect(explicit).toBe(
      'SUM($(items).$(금액)) * $(rate) + IF(FALSE, "items.x", 1) + @item.$(amount) + @page',
    );
    const values = { items: [{ 금액: 1 }, { 금액: 2 }], rate: 2 };
    const reserved = { '@item': { amount: 10 }, '@page': 5 };
    expect(evaluateFormula(explicit, ctx(values, reserved))).toBe(
      evaluateFormula(source, ctx(values, reserved)),
    );
  });

  it('이미 명시 참조를 쓰는 수식은 그대로 돌려준다', () => {
    const source = 'SUM($(items).$(amount)) + @item';
    expect(toExplicitReferences(source)).toBe(source);
  });

  it('공백이 섞인 경로도 범위째 바꾼다', () => {
    expect(toExplicitReferences('items . 금액 + 1')).toBe('$(items).$(금액) + 1');
  });
});

describe('renameFormulaReferences', () => {
  it('일반 수식에서 새 이름이 식별자면 형식을 유지한다', () => {
    expect(renameFormulaReferences('SUM(items.amount) + itemsExtra + items', ['items'], ['lines'])).toBe(
      'SUM(lines.amount) + itemsExtra + lines',
    );
    expect(renameFormulaReferences('items.amount * 2', ['items', 'amount'], ['items', 'total'])).toBe(
      'items.total * 2',
    );
  });

  it('일반 수식에서 새 이름이 식별자가 아니면 수식 전체를 명시 참조로 바꾼다', () => {
    expect(renameFormulaReferences('SUM(items.amount) + rate', ['items'], ['order-items'])).toBe(
      'SUM($(order-items).$(amount)) + $(rate)',
    );
    expect(renameFormulaReferences('amount + 1', ['amount'], ['नमस्ते'])).toBe('$(नमस्ते) + 1');
    expect(renameFormulaReferences('amount + 1', ['amount'], ['TRUE'])).toBe('$(TRUE) + 1');
    expect(renameFormulaReferences('amount + 1', ['amount'], ['customer.name'])).toBe(
      '$(customer.name) + 1',
    );
  });

  it('명시 수식에서는 명시 참조로 바꿔 넣는다', () => {
    expect(renameFormulaReferences('SUM($(items).$(amount))', ['items', 'amount'], ['items', 'total'])).toBe(
      'SUM($(items).$(total))',
    );
    expect(renameFormulaReferences('$(a\\)b) + $(c)', ['a)b'], ['x\\y'])).toBe('$(x\\\\y) + $(c)');
  });

  it('예약 참조로 시작하는 경로도 바꾼다', () => {
    expect(renameFormulaReferences('@item.amount + @page.amount', ['@item', 'amount'], ['@item', 'sum'])).toBe(
      '@item.sum + @page.amount',
    );
    expect(renameFormulaReferences('@item.amount', ['@item', 'amount'], ['@item', 'unit-price'])).toBe(
      '@item.$(unit-price)',
    );
  });

  it('일치하는 참조가 없거나 앞부분만 겹치면 바꾸지 않는다', () => {
    expect(renameFormulaReferences('itemsExtra + 1', ['items'], ['x-y'])).toBe('itemsExtra + 1');
    expect(renameFormulaReferences('IF(TRUE, "items", 1)', ['items'], ['lines'])).toBe('IF(TRUE, "items", 1)');
    expect(() => renameFormulaReferences('a', [], ['b'])).toThrow(RangeError);
  });

  it('이름을 바꾼 수식은 바뀐 데이터로 같은 값을 낸다', () => {
    const source = 'SUM(items.amount) * rate';
    const renamed = renameFormulaReferences(source, ['items'], ['order-items']);
    const before = evaluateFormula(source, ctx({ items: [{ amount: 2 }, { amount: 3 }], rate: 10 }));
    const after = evaluateFormula(renamed, ctx({ 'order-items': [{ amount: 2 }, { amount: 3 }], rate: 10 }));
    expect(after).toBe(before);
  });
});
