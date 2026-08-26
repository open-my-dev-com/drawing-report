import { describe, expect, it } from 'vitest';
import { parseSlipFile } from '@omdc-slipkit/core';
import { presets } from '../src/presets.js';
import { strings } from '../src/strings.js';

// 프리셋은 core의 실제 parseSlipFile로 검증한다.

describe('디자이너 프리셋', () => {
  it('거래명세서·청구서 2종이 제공된다', () => {
    expect(presets.map((p) => p.id)).toEqual(['trade-statement', 'invoice']);
    expect(presets.map((p) => p.name)).toEqual([
      strings.designer.presetTradeStatement,
      strings.designer.presetInvoice,
    ]);
  });

  for (const meta of [
    { id: 'trade-statement', title: '거래명세서' },
    { id: 'invoice', title: '청구서' },
  ]) {
    it(`${meta.title} 프리셋은 core 스키마를 통과하는 유효한 양식이다`, () => {
      const preset = presets.find((p) => p.id === meta.id)!;
      const file = parseSlipFile(JSON.stringify(preset.create()));
      expect(file.kind).toBe('template');
      if (file.kind === 'template') {
        expect(file.template.meta.title).toBe(meta.title);
        expect(file.template.pages[0]!.elements.length).toBeGreaterThan(0);
      }
    });
  }

  it('create()는 호출마다 새 객체를 반환한다', () => {
    const a = presets[0]!.create();
    const b = presets[0]!.create();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
