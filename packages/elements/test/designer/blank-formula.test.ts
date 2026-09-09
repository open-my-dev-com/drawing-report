// @vitest-environment happy-dom
// 공백뿐인 수식의 화면 계약 — 디자이너 캔버스·자동 병합·경고 목록과 작성 폼이 PDF 변환처럼 빈 값으로 다룹니다.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용합니다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 화면 동작만 확인하므로 대용량 동봉 폰트 로딩은 모의합니다.
  loadDefaultFonts: () => Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import type { SlipFile } from '@omdc-slipkit/core';
import { isBlankFormula } from '../../src/formula-blank.js';
import { checkFormula } from '../../src/designer/formula-check.js';
import { SlipForm } from '../../src/slip-form.js';
import {
  strings,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  flush,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

if (!customElements.get('slip-form')) {
  customElements.define('slip-form', SlipForm);
}

const SAMPLE_ITEMS = [{ itemName: '연필' }, { itemName: '지우개' }, { itemName: '자' }];

/**
 * 디자이너와 작성 폼에 전달하는 공통 양식입니다. 자동 병합 열의 항목 구간 셀과 필드가 같은 수식을 사용합니다.
 */
function makeFile(formula: string): SlipFile {
  const file = makeTemplateFile();
  file.template.sampleValues = { items: SAMPLE_ITEMS } as never;
  file.template.parameters = [
    { key: 'items', label: '품목', valueType: 'list', fields: [{ key: 'itemName', valueType: 'text' }] },
  ] as never;
  file.template.pages[0]!.elements = [
    {
      type: 'grid', id: 'g1', name: '품목 표', position: { x: 10, y: 10 },
      rows: [{ height: 8 }, { height: 8 }],
      columns: [{ width: 100 }, { width: 60, autoMerge: true }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 3 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 0, column: 1, content: '비고' },
        { row: 1, column: 0, parameter: 'itemName' },
        { row: 1, column: 1, formula },
      ],
    },
    {
      type: 'field', id: 'f1', name: '합계', position: { x: 10, y: 60 },
      width: 40, height: 8, formula,
    },
  ] as never;
  return file as unknown as SlipFile;
}

async function mountDesigner(file: SlipFile): Promise<Designer> {
  parseSlipFileMock.mockReturnValue(file);
  const el = await createElement();
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

async function mountForm(file: SlipFile): Promise<SlipForm> {
  parseSlipFileMock.mockReturnValue(file);
  const el = document.createElement('slip-form') as SlipForm;
  document.body.appendChild(el);
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

/** 캔버스에 놓인 그리드 셀 — 반복 그리드를 고르지 않았으므로 출력 결과 그대로입니다. */
function gridCells(el: Designer): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>('.grid-preview > .grid-cell'));
}

/** 작성 폼의 수식 입력 필드와 그 아래 안내 문구입니다. */
function computedField(el: SlipForm): { input: HTMLInputElement; hint: string } {
  const input = Array.from(el.shadowRoot!.querySelectorAll('input'))
    .find((i) => i.getAttribute('aria-label') === `합계 (${strings.form.computed})`);
  if (!input) throw new Error('수식 입력 필드를 찾지 못했습니다');
  const hint = input.parentElement!.querySelector('.hint')!.textContent?.trim() ?? '';
  return { input, hint };
}

afterEach(() => {
  for (const el of Array.from(document.body.querySelectorAll('slip-designer, slip-form'))) el.remove();
});

describe('isBlankFormula — 공백뿐인 수식 판정', () => {
  it('비었거나 공백·줄바꿈·탭만 있으면 빈 수식이다', () => {
    for (const source of [undefined, '', ' ', '   ', '\n', '\t \n']) {
      expect(isBlankFormula(source), JSON.stringify(source)).toBe(true);
    }
  });

  it('글자가 하나라도 있으면 문법이 틀려도 빈 수식이 아니다', () => {
    for (const source of ['1', ' 1 + 1 ', '1 +', 'BAD(']) {
      expect(isBlankFormula(source), source).toBe(false);
    }
  });

  it('공통 검사도 같은 판정으로 비어 있음을 반환한다', () => {
    const diagnose = vi.fn();
    const check = checkFormula({
      source: ' \n ', condition: false, emptyAllowed: true, locale: undefined, context: { values: {} }, diagnose,
    });
    expect(check.status).toBe('empty');
    expect(diagnose).not.toHaveBeenCalled();
  });
});

describe('공백뿐인 수식은 빈 값 — 디자이너·작성 폼이 PDF 변환과 같은 계약을 쓴다', () => {
  const BLANK = '   ';

  it('디자이너 캔버스의 그리드 셀은 오류 표시 없이 빈 셀로 그린다', async () => {
    const el = await mountDesigner(makeFile(BLANK));
    const cells = gridCells(el);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.filter((cell) => cell.classList.contains('formula-error'))).toHaveLength(0);
    expect(el.shadowRoot!.querySelector('.formula-error-text')).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(strings.designer.formulaErrorLabel);
  });

  it('자동 병합 열의 빈 수식 셀은 값이 없는 것으로 보아 합치지 않는다', async () => {
    const el = await mountDesigner(makeFile(BLANK));
    // 값이 같은 항목이 이어져도 세로로 합친 셀(span 2 이상)이 생기지 않습니다.
    const merged = gridCells(el).filter((cell) => /span[2-9]/.test(cell.style.gridArea.replaceAll(' ', '')));
    expect(merged).toHaveLength(0);
    // 세 항목의 비고 셀이 각각 빈 셀로 남습니다.
    const blanks = gridCells(el).filter((cell) => cell.textContent?.trim() === '');
    expect(blanks.length).toBeGreaterThanOrEqual(SAMPLE_ITEMS.length);
  });

  it('경고 목록과 배지에는 빈 수식이 나타나지 않는다', async () => {
    const el = await mountDesigner(makeFile(BLANK));
    expect(el.shadowRoot!.querySelector('#formula-warnings')).toBeNull();
    expect(el.shadowRoot!.querySelector('.formula-warning-badge')).toBeNull();
  });

  it('작성 폼의 수식 필드는 계산 오류 대신 빈 값을 보여 준다', async () => {
    const el = await mountForm(makeFile(BLANK));
    const { input, hint } = computedField(el);
    expect(input.value).toBe('');
    expect(hint).toBe(strings.form.computed);
    expect(el.shadowRoot!.textContent).not.toContain(strings.form.calcError);
  });
});

describe('실제 문법 오류는 그대로 오류 — 빈 수식 판정이 오류를 감추지 않는다', () => {
  const BROKEN = '1 +';

  it('디자이너 캔버스의 그리드 셀은 오류 표시와 경고 배지를 보여 준다', async () => {
    const el = await mountDesigner(makeFile(BROKEN));
    const failed = gridCells(el).filter((cell) => cell.classList.contains('formula-error'));
    expect(failed).toHaveLength(SAMPLE_ITEMS.length);
    expect(failed[0]!.querySelector('.formula-error-text')!.textContent?.trim())
      .toBe(strings.designer.formulaErrorLabel);
    expect(failed[0]!.querySelector('.formula-warning-badge')).not.toBeNull();
  });

  it('경고 목록에 셀과 필드가 모두 오른다', async () => {
    const el = await mountDesigner(makeFile(BROKEN));
    expect(el.shadowRoot!.querySelector('#formula-warnings')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-id="f1"] .formula-warning-badge')).not.toBeNull();
  });

  it('작성 폼의 수식 필드는 계산 오류를 알린다', async () => {
    const el = await mountForm(makeFile(BROKEN));
    const { input, hint } = computedField(el);
    expect(input.value).toBe('');
    expect(hint.startsWith(`${strings.form.calcError}:`)).toBe(true);
  });
});
