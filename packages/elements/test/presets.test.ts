import { describe, expect, it } from 'vitest';
import { collectFormulaReferences, parseSlipFile } from '@omdc-slipkit/core';
import { getPresets } from '../src/presets.js';
import { getStrings } from '../src/strings.js';

// 프리셋은 core의 실제 parseSlipFile로 검증한다.

describe('디자이너 프리셋', () => {
  it('거래명세서·청구서 2종이 제공된다', () => {
    const presets = getPresets();
    const strings = getStrings();
    expect(presets.map((p) => p.id)).toEqual(['trade-statement', 'invoice']);
    expect(presets.map((p) => p.name)).toEqual([
      strings.designer.presetTradeStatement,
      strings.designer.presetInvoice,
    ]);
  });

  for (const meta of [
    { id: 'trade-statement', title: 'Transaction statement' },
    { id: 'invoice', title: 'Invoice' },
  ]) {
    it(`${meta.title} 프리셋은 core 스키마를 통과하는 유효한 양식이다`, () => {
      const preset = getPresets().find((p) => p.id === meta.id)!;
      const file = parseSlipFile(JSON.stringify(preset.create()));
      expect(file.kind).toBe('template');
      if (file.kind === 'template') {
        expect(file.template.meta.title).toBe(meta.title);
        expect(file.template.pages[0]!.elements.length).toBeGreaterThan(0);
      }
    });
  }

  it('프리셋의 수식은 업무 값을 모두 명시형 참조로 적는다', () => {
    const formulas: string[] = [];
    for (const preset of getPresets()) {
      const file = parseSlipFile(JSON.stringify(preset.create()));
      if (file.kind !== 'template') continue;
      for (const page of file.template.pages) {
        for (const element of page.elements) {
          if ('formula' in element && typeof element.formula === 'string') formulas.push(element.formula);
          if (element.type === 'grid') {
            for (const cell of element.cells) if (cell.formula !== undefined) formulas.push(cell.formula);
          }
        }
      }
    }
    expect(formulas).toEqual(['SUM($(items).$(amount))', 'SUM($(items).$(amount))']);
    for (const formula of formulas) {
      for (const ref of collectFormulaReferences(formula)) {
        // 예약 참조가 아닌 업무 값 참조는 전부 `$(...)`로 적혀 있어야 한다.
        if (!ref.reserved) expect(ref.explicit, formula).toBe(true);
      }
    }
  });

  it('create()는 호출마다 새 객체를 반환한다', () => {
    const presets = getPresets();
    const a = presets[0]!.create();
    const b = presets[0]!.create();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('locale에 해당하는 언어로 제목과 라벨을 채운다', () => {
    const ko = getPresets('ko-KR')[0]!.create();
    expect(ko.template.meta.title).toBe('거래명세서');
    expect(ko.template.parameters?.[1]?.label).toBe('품목');

    const ja = getPresets('ja')[1]!.create();
    expect(ja.template.meta.title).toBe('請求書');

    // 지원하지 않는 언어는 영어로 대체한다.
    expect(getPresets('fr')[0]!.create().template.meta.title).toBe('Transaction statement');
  });

  it('세 언어로 생성한 프리셋이 모두 core 스키마를 통과한다', () => {
    for (const locale of ['ko', 'en', 'ja']) {
      for (const preset of getPresets(locale)) {
        expect(() => parseSlipFile(JSON.stringify(preset.create()))).not.toThrow();
      }
    }
  });
});
