// @vitest-environment happy-dom
// 속성 패널과 사이드바
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  // 파싱과 렌더링만 모의하고 수식 엔진은 실제 구현을 사용한다.
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return {
    ...actual,
    parseSlipFile: vi.fn(),
    renderSlipToPdf: vi.fn(),
    CURRENT_SCHEMA_VERSION: '0.1.0',
  };
});

vi.mock('../../src/default-fonts.js', () => ({
  // 웹 컴포넌트 연결만 검증하므로 대용량 동봉 폰트 로딩은 모의한다.
  loadDefaultFonts: () =>
    Promise.resolve([
      { name: 'Pretendard', data: new Uint8Array([1]), fallback: true },
      { name: 'Pretendard-Bold', data: new Uint8Array([2]) },
    ]),
}));

import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import {
  strings,
  PX_PER_MM,
  parseSlipFileMock,
  makeTemplateFile,
  installDesignerTestEnv,
  createElement,
  loadDesigner,
  flush,
  toolbarButton,
  pickListValue,
  listOptionLabels,
  addByCanvasClick,
  clickCanvasAt,
  pickBorderShape,
  selectElement,
  retargetedKey,
} from './helpers.js';
import type { Designer } from './helpers.js';

installDesignerTestEnv();

describe('<slip-designer> 조건부 서식 (ADR-062)', () => {
  async function mountFile(
    elements: unknown[],
    sampleValues?: Record<string, unknown>,
  ): Promise<Designer> {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = elements as never;
    if (sampleValues) file.template.sampleValues = sampleValues as never;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    return el;
  }

  it('텍스트 요소의 색을 샘플 값으로 미리 적용한다', async () => {
    const el = await mountFile(
      [{
        type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
        width: 60, height: 10, content: '취소됨',
        conditionalFormats: [
          { condition: 'status = "취소"', fontColor: '#FF0000', backgroundColor: '#FFEEEE' },
        ],
      }],
      { status: '취소' },
    );
    const box = el.shadowRoot?.querySelector('[data-id="t1"]') as HTMLElement;
    expect(box.style.color).toBe('#FF0000');
    expect(box.style.backgroundColor).toBe('#FFEEEE');
    el.remove();
  });

  it('반복 그리드 셀은 행별로 조건을 평가한다', async () => {
    const el = await mountFile(
      [{
        type: 'grid', id: 'g1', name: 'g', position: { x: 10, y: 10 },
        rows: [{ height: 8 }],
        columns: [{ width: 40 }],
        repeat: {
          parameter: 'items',
          bands: [
            { id: 'b-item', fromRow: 0, toRow: 0, placement: 'item' },
          ],
          pagination: { mode: 'fixed', itemsPerPage: 2 },
        },
        cells: [{
          row: 0, column: 0, parameter: 'amount',
          conditionalFormats: [{ condition: 'amount >= 2000', fontColor: '#FF0000' }],
        }],
      }],
      { items: [{ amount: 1000 }, { amount: 2000 }] },
    );
    const boxes = Array.from(el.shadowRoot!.querySelectorAll('.grid-preview > div')) as HTMLElement[];
    const low = boxes.find((c) => c.textContent === '1000')!;
    const high = boxes.find((c) => c.textContent === '2000')!;
    expect(low.style.color).toBe('');
    expect(high.style.color).toBe('#FF0000');
    el.remove();
  });

  it('계산되지 않는 조건식은 캔버스에서 건너뛴다', async () => {
    const el = await mountFile(
      [{
        type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
        width: 60, height: 10, content: '제목',
        conditionalFormats: [
          { condition: 'status <', fontColor: '#00FF00' },
          { condition: 'TRUE', fontColor: '#FF0000' },
        ],
      }],
      {},
    );
    // 문법 오류 규칙은 무시하고 계산되는 규칙만 적용한다.
    const box = el.shadowRoot?.querySelector('[data-id="t1"]') as HTMLElement;
    expect(box.style.color).toBe('#FF0000');
    el.remove();
  });

  async function selectElement(
    el: Designer,
    id: string,
  ): Promise<void> {
    const target = el.shadowRoot?.querySelector(`[data-id="${id}"]`) as HTMLElement;
    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;
  }

  it('강조(굵게·밑줄)를 캔버스에 미리 적용한다 (ADR-063)', async () => {
    const el = await mountFile(
      [{
        type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
        width: 60, height: 10, content: '제목',
        conditionalFormats: [{ condition: 'TRUE', bold: true, underline: true }],
      }],
      {},
    );
    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    expect(content.style.fontWeight).toBe('700');
    expect(content.style.textDecoration).toContain('underline');
    el.remove();
  });

  it('강조는 적용→해제→유지 순서로 바뀌고, 마지막 강조는 지울 수 없다 (ADR-063)', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', bold: true }],
    }]);
    await selectElement(el, 't1');

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });
    const name = `${strings.designer.conditionalFormat} 1`;
    const boldBtn = () => el.shadowRoot!.querySelector(
      `button[aria-label^="${name}: ${strings.designer.bold}"]`,
    ) as HTMLButtonElement;
    const ruleOf = (file: SlipTemplateFile) =>
      (file.template.pages[0]!.elements[0] as { conditionalFormats?: { bold?: boolean }[] })
        .conditionalFormats![0]!;

    // 적용(true) → 해제(false)
    boldBtn().click();
    await el.updateComplete;
    expect(ruleOf(changed!).bold).toBe(false);

    // 해제 → 기본 유지는 규칙의 마지막 강조를 없애므로 막힌다.
    changed = null;
    boldBtn().click();
    await el.updateComplete;
    expect(changed).toBeNull();
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.conditionEffectRequired);
    el.remove();
  });

  it('기울임을 규칙에서 설정할 수 있다 (ADR-063)', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });
    const name = `${strings.designer.conditionalFormat} 1`;
    (el.shadowRoot!.querySelector(
      `button[aria-label^="${name}: ${strings.designer.italic}"]`,
    ) as HTMLButtonElement).click();
    await el.updateComplete;

    const rule = (changed!.template.pages[0]!.elements[0] as { conditionalFormats?: { italic?: boolean }[] })
      .conditionalFormats![0]!;
    expect(rule.italic).toBe(true);
    el.remove();
  });

  it('결과가 논리값이 아닌 조건식은 저장하지 않는다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });

    const name = `${strings.designer.conditionalFormat} 1`;
    const input = el.shadowRoot!.querySelector(
      `input[aria-label="${name}: ${strings.designer.condition}"]`,
    ) as HTMLInputElement;
    input.value = '1 + 1';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(changed).toBe(false);
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.conditionNotBoolean);
    el.remove();
  });

  it('규칙의 마지막 색은 지울 수 없다 — 색이 없는 규칙은 파일 검증에 걸린다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });

    const name = `${strings.designer.conditionalFormat} 1`;
    const colorBtn = el.shadowRoot!.querySelector(
      `button[aria-label="${name}: ${strings.designer.fontColor}"]`,
    ) as HTMLButtonElement;
    colorBtn.click();
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.color-pop .swatch.none') as HTMLButtonElement).click();
    await el.updateComplete;

    // 색은 지워지지 않고 안내가 표시된다.
    expect(changed).toBe(false);
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.conditionEffectRequired);
    el.remove();
  });

  it('문법이 깨진 조건식은 저장하지 않고 입력 오류를 표시한다', async () => {
    const el = await mountFile([{
      type: 'text', id: 't1', name: 't', position: { x: 10, y: 10 },
      width: 60, height: 10, content: '제목',
      conditionalFormats: [{ condition: 'TRUE', fontColor: '#FF0000' }],
    }]);
    await selectElement(el, 't1');

    let changed = false;
    el.addEventListener('slip-change', () => { changed = true; });

    const name = `${strings.designer.conditionalFormat} 1`;
    const input = el.shadowRoot!.querySelector(
      `input[aria-label="${name}: ${strings.designer.condition}"]`,
    ) as HTMLInputElement;
    input.value = 'amount <';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(changed).toBe(false);
    const error = el.shadowRoot!.querySelector('.input-error');
    expect(error?.textContent).toBe(strings.designer.syntaxError);
    el.remove();
  });

  it('속성 패널에서 규칙을 추가하면 파일에 저장된다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });

    const addBtn = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.textContent?.includes(strings.designer.addConditionRule)) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    addBtn.click();
    await el.updateComplete;

    expect(changed).not.toBeNull();
    const text = changed!.template.pages[0]!.elements.find((item) => item.id === 'txt-1')!;
    expect((text as { conditionalFormats?: unknown[] }).conditionalFormats).toEqual([
      { condition: 'TRUE', fontColor: '#FF0000' },
    ]);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 툴바, 정렬 토글, 색 선택기
// ---------------------------------------------------------------------------

describe('<slip-designer> UI 정리 (A-4)', () => {
  async function mountAndSelectText(): Promise<Designer> {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    (el.shadowRoot?.querySelector('.element[data-id="txt-1"]') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true }),
    );
    await el.updateComplete;
    return el;
  }

  function byAriaLabel(el: Element, label: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;
  }

  it('툴바 버튼은 아이콘(svg) + 이름(title·aria-label)으로 표시된다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const buttons = el.shadowRoot?.querySelectorAll('.toolbar button');
    expect(buttons!.length).toBeGreaterThan(10);
    for (const b of Array.from(buttons!)) {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
    }
    el.remove();
  });

  it('정렬은 아이콘 토글로 바꾼다 — 가운데 클릭 시 alignment가 저장되고 눌림 상태가 바뀐다', async () => {
    const el = await mountAndSelectText();
    const label = `${strings.designer.alignment}: ${strings.designer.alignCenter}`;
    const centerBtn = byAriaLabel(el, label);
    expect(centerBtn.getAttribute('aria-pressed')).toBe('false');

    centerBtn.click();
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect((text as Record<string, unknown>).alignment).toBe('center');
    expect(byAriaLabel(el, label).getAttribute('aria-pressed')).toBe('true');
    el.remove();
  });

  it('색 피커 — 색 버튼을 펼쳐 팔레트 견본으로 색을 지정하고, 없음으로 지운다', async () => {
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click(); // 색 버튼 펼침
    await el.updateComplete;
    const swatch = byAriaLabel(el, `${strings.designer.backgroundColor} #d93025`);
    swatch.click();
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    const text = file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#d93025');
    expect(byAriaLabel(el, `${strings.designer.backgroundColor} #d93025`).getAttribute('aria-pressed'))
      .toBe('true');

    byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.colorNone}`).click();
    await el.updateComplete;
    expect(text.backgroundColor ?? undefined).toBeUndefined();
    expect(byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.colorNone}`)
      .getAttribute('aria-pressed')).toBe('true');
    el.remove();
  });

  it('툴바 버튼은 아이콘 아래에 작은 이름 라벨을 함께 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    for (const b of Array.from(el.shadowRoot!.querySelectorAll('.toolbar button'))) {
      expect(b.querySelector('.btn-label')?.textContent).toBe(b.getAttribute('aria-label'));
    }
    el.remove();
  });

  it('색 미지정이면 색 버튼 칩이 없음 표시로 보이고, 색을 고르면 색으로 바뀐다', async () => {
    const el = await mountAndSelectText();
    const btn = byAriaLabel(el, strings.designer.backgroundColor);
    expect(btn.querySelector('.color-chip')?.classList.contains('none')).toBe(true);
    expect(btn.textContent).toContain(strings.designer.colorNone);

    btn.click(); // 펼침
    await el.updateComplete;
    byAriaLabel(el, `${strings.designer.backgroundColor} #1a73e8`).click();
    await el.updateComplete;
    const after = byAriaLabel(el, strings.designer.backgroundColor);
    expect(after.querySelector('.color-chip')?.classList.contains('none')).toBe(false);
    expect(after.textContent).toContain('#1a73e8');
    el.remove();
  });

  it('색 피커 — 투명도를 내리면 #RRGGBBAA 8자리로 저장된다', async () => {
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click(); // 색 버튼 펼침
    await el.updateComplete;
    byAriaLabel(el, `${strings.designer.backgroundColor} #1a73e8`).click();
    await el.updateComplete;

    const alpha = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.backgroundColor} ${strings.designer.opacity}`)!;
    alpha.value = '50';
    alpha.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#1a73e880');
    el.remove();
  });

  it('색 피커 — 버튼 한 번에 견본·색상판·색조가 함께 펼쳐지고, 색조 변경이 바로 저장된다', async () => {
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click();
    await el.updateComplete;

    // 색상 팝오버에 팔레트, 채도·명도 영역, 색조 슬라이더를 함께 표시한다.
    expect(el.shadowRoot?.querySelector('.sv-area')).not.toBeNull();
    expect(el.shadowRoot?.querySelectorAll('.swatch').length).toBeGreaterThan(2);

    const hue = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.backgroundColor} ${strings.designer.hue}`)!;
    hue.value = '120';
    hue.dispatchEvent(new Event('input', { bubbles: true }));
    hue.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#00ff00');
    el.remove();
  });

  it('현재 색을 자주 쓰는 색으로 저장하면 커스텀 견본이 생기고 localStorage에 유지된다', async () => {
    localStorage.removeItem('slipkit-designer-custom-colors');
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click();
    await el.updateComplete;

    const saveLabel = `${strings.designer.backgroundColor}: ${strings.designer.saveColor}`;
    expect(byAriaLabel(el, saveLabel).disabled).toBe(true);

    const hex = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('placeholder') === '#RRGGBB')!;
    hex.value = '#123456';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    byAriaLabel(el, saveLabel).click();
    await el.updateComplete;

    const custom = el.shadowRoot!.querySelector('.swatch.custom');
    expect(custom?.getAttribute('title')).toBe('#123456');
    expect(JSON.parse(localStorage.getItem('slipkit-designer-custom-colors')!)).toEqual(['#123456']);

    byAriaLabel(el, `${strings.designer.backgroundColor} #123456`).click();
    await el.updateComplete;
    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]! as Record<string, unknown>;
    expect(text.backgroundColor).toBe('#123456');
    el.remove();
  });

  it('커스텀 색이 30개를 넘으면 가장 오래된 것부터 밀려난다', async () => {
    const thirty = Array.from({ length: 30 }, (_, i) =>
      `#${(i + 1).toString(16).padStart(2, '0')}0000`);
    localStorage.setItem('slipkit-designer-custom-colors', JSON.stringify(thirty));
    const el = await mountAndSelectText();
    byAriaLabel(el, strings.designer.backgroundColor).click();
    await el.updateComplete;

    const hex = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('placeholder') === '#RRGGBB')!;
    hex.value = '#00ff77';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    byAriaLabel(el, `${strings.designer.backgroundColor}: ${strings.designer.saveColor}`).click();
    await el.updateComplete;

    const stored = JSON.parse(localStorage.getItem('slipkit-designer-custom-colors')!) as string[];
    expect(stored.length).toBe(30);
    expect(stored).not.toContain(thirty[0]); // 가장 오래된 색이 밀려남
    expect(stored.at(-1)).toBe('#00ff77');
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 속성 패널
// ---------------------------------------------------------------------------

describe('<slip-designer> 속성 패널', () => {
  it('요소 미선택 시 양식 설정 패널을 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const typeName = el.shadowRoot?.querySelector('.type-name')?.textContent?.trim();
    expect(typeName).toBe(strings.designer.formSettings);
    el.remove();
  });

  it('요소 선택 시 유형 이름을 표시한다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    const typeName = el.shadowRoot?.querySelector('.type-name')?.textContent?.trim();
    expect(typeName).toBe(strings.designer.typeText);
    el.remove();
  });

  it('텍스트를 필드로 바꾸면 새 파라미터를 만들어 붙인다 — 빈 참조를 남기지 않는다', async () => {
    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="txt-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });

    const fieldBtn = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group.text button'))
      .find((b) => b.textContent?.trim() === strings.designer.typeField) as HTMLButtonElement;
    fieldBtn.click();
    await el.updateComplete;

    expect(changed).not.toBeNull();
    const converted = changed!.template.pages[0]!.elements.find((item) => item.id === 'txt-1')!;
    expect(converted.type).toBe('field');
    // 필드 생성 시 유효한 파라미터 키와 정의를 함께 추가한다.
    const key = (converted as { parameter?: string }).parameter;
    expect(key).toBeTruthy();
    expect(changed!.template.parameters?.some((p) => p.key === key)).toBe(true);
    el.remove();
  });

  it('필드 소스를 수식에서 파라미터로 바꾸면 새 파라미터를 만들어 붙인다', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements.push({
      type: 'field', id: 'fld-1', name: 'test-field',
      position: { x: 30, y: 60 }, width: 60, height: 10, formula: 'TODAY()',
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);

    const el = await createElement();
    el.src = '{"valid": true}';
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const elementDiv = el.shadowRoot?.querySelector('[data-id="fld-1"]') as HTMLElement;
    elementDiv.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 10, clientY: 10, pointerId: 1,
    }));
    elementDiv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;

    let changed: SlipTemplateFile | null = null;
    el.addEventListener('slip-change', (e) => {
      changed = (e as CustomEvent<{ file: SlipTemplateFile }>).detail.file;
    });

    const sourceTrigger = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((row) => row.querySelector('label')?.textContent?.trim() === strings.designer.cellSource)
      ?.querySelector('.list-select') as HTMLButtonElement;
    await pickListValue(el, sourceTrigger, 'parameter');

    expect(changed).not.toBeNull();
    const field = changed!.template.pages[0]!.elements.find((item) => item.id === 'fld-1')!;
    const record = field as { parameter?: string; formula?: string };
    // 파라미터를 선택하면 기존 수식을 제거한다.
    expect(record.formula).toBeUndefined();
    expect(record.parameter).toBeTruthy();
    expect(changed!.template.parameters?.some((p) => p.key === record.parameter)).toBe(true);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 왼쪽 사이드바의 페이지, 요소, 파라미터 목록
// ---------------------------------------------------------------------------

describe('<slip-designer> 사이드바', () => {
  function sideSection(el: Element, title: string): Element {
    const section = Array.from(el.shadowRoot!.querySelectorAll('.side-section'))
      .find((sec) => sec.querySelector('.side-title')?.textContent?.trim() === title);
    if (!section) throw new Error(`사이드바 섹션을 찾지 못했습니다: ${title}`);
    return section;
  }

  /** 접힌 파라미터의 하위 항목을 펼친다. */
  function twisty(el: Element, name: string): HTMLButtonElement | undefined {
    return Array.from(el.shadowRoot!.querySelectorAll('.side-twisty'))
      .find((b) => b.getAttribute('aria-label')?.startsWith(`${name} `)) as HTMLButtonElement;
  }

  it('페이지가 한 줄씩 나열되고, 누르면 그 페이지로 이동한다 (G-35)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const rows = sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row');
    expect(rows.length).toBe(2);
    expect(Array.from(rows).map((r) => r.textContent?.trim()))
      .toEqual([strings.designer.pageLabel.replace('{n}', '1'),
                strings.designer.pageLabel.replace('{n}', '2')]);
    // 페이지를 추가한 뒤 첫 페이지를 다시 선택한다.
    expect(rows[1]?.classList.contains('current')).toBe(true);
    (rows[0] as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('1 / 2');
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.pageSettings);
    el.remove();
  });

  it('페이지 줄은 평소에 썸네일을 띄우지 않는다 — 목록이 길어지지 않게 (G-35)', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot!.querySelector('.page-thumb-pop')).toBeNull();
    el.remove();
  });

  it('페이지 줄에 포커스가 가면 그 페이지 썸네일이 뜬다 (G-35)', async () => {
    const el = await loadDesigner();
    const row = sideSection(el, strings.designer.sidebarPages)
      .querySelector('.page-row') as HTMLElement;
    row.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    await el.updateComplete;

    const pop = el.shadowRoot!.querySelector('.page-thumb-pop');
    expect(pop).not.toBeNull();
    expect(pop?.querySelectorAll('.thumb-el').length).toBe(2);

    row.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.page-thumb-pop')).toBeNull();
    el.remove();
  });

  it('페이지 이름을 정하면 썸네일·목록에 번호 대신 그 이름이 나온다 (G-46)', async () => {
    const el = await loadDesigner();
    (sideSection(el, strings.designer.sidebarPages).querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;

    const nameInput = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.pageName)!
      .querySelector('input') as HTMLInputElement;
    nameInput.value = '표지';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const row = sideSection(el, strings.designer.sidebarPages).querySelector('.page-row');
    expect(row?.textContent?.trim()).toBe('표지');
    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages[0]!.label).toBe('표지');
  });

  it('페이지 설정에 이름 입력을 설명하는 안내문을 표시하지 않는다', async () => {
    const el = await loadDesigner();
    (sideSection(el, strings.designer.sidebarPages).querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.prop-panel .cell-hint:not(.error)')).toBeNull();
    el.remove();
  });

  it('페이지 번호 표시를 켜면 위치를 고를 수 있고 캔버스에 X / X 자리표시가 나온다 (G-46)', async () => {
    const el = await loadDesigner();
    (sideSection(el, strings.designer.sidebarPages).querySelector('.page-row') as HTMLElement).click();
    await el.updateComplete;

    const toggle = Array.from(el.shadowRoot!.querySelectorAll('input[type="checkbox"]'))
      .find((c) => c.getAttribute('aria-label') === strings.designer.pageNumberShow) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages[0]!.pageNumber?.position).toBe('bottom-center');
    // 캔버스에는 실제 번호 대신 페이지 번호 자리표시를 표시한다.
    const mark = el.shadowRoot!.querySelector('.page-number-mark');
    expect(mark?.textContent?.trim()).toBe('X / X');

    const posTrigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((sel) => sel.getAttribute('aria-label') === strings.designer.pageNumberPosition) as HTMLButtonElement;
    await pickListValue(el, posTrigger, 'top-right');
    expect(file.template.pages[0]!.pageNumber?.position).toBe('top-right');
  });

  it('페이지 물리명이 다른 페이지와 겹치면 되돌리고 안내한다 (G-46)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;
    const setKey = async (value: string) => {
      const keyInput = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
        .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.pageKey)!
        .querySelector('input') as HTMLInputElement;
      keyInput.value = value;
      keyInput.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
    };
    // 두 번째 페이지에 `cover` 키를 지정한다.
    (Array.from(sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row'))[1] as HTMLElement).click();
    await el.updateComplete;
    await setKey('cover');
    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages[1]!.key).toBe('cover');

    // 다른 페이지에는 같은 키를 적용할 수 없다.
    (Array.from(sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row'))[0] as HTMLElement).click();
    await el.updateComplete;
    await setKey('cover');
    expect(file.template.pages[0]!.key).toBeUndefined();
    const invalidKey = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.pageKey)!
      .querySelector('input') as HTMLInputElement;
    expect(invalidKey.getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.keyInUse);
  });

  it('요소 목록에 현재 페이지 요소가 나열되고, 클릭하면 그 요소가 선택된다', async () => {
    const el = await loadDesigner();
    const rows = sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row');
    expect(Array.from(rows).map((r) => r.textContent?.trim())).toEqual(['test-text', 'test-shape']);

    (rows[1] as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id')).toBe('shp-1');
    const after = sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row');
    expect(after[1]?.classList.contains('selected')).toBe(true);
    el.remove();
  });

  /** 값 하나(합계금액)와 반복 구간을 가진 그리드 하나(items · 하위 필드 a)를 둔 양식 */
  function makeFileWithRepeatGrid(): ReturnType<typeof makeTemplateFile> {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'field' as const, id: 'fld-1', name: 'f1', position: { x: 10, y: 10 },
          width: 60, height: 10, parameter: '합계금액',
        } as never,
        {
          type: 'grid' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          rows: [{ height: 8 }, { height: 8 }],
          columns: [{ width: 180 }],
          repeat: {
            parameter: 'items',
            bands: [
              { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
              { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
            ],
            pagination: { mode: 'fixed', itemsPerPage: 2 },
          },
          cells: [{ row: 1, column: 0, parameter: 'a' }],
        } as never,
      ],
    });
    return file;
  }

  it('하위가 있는 줄에만 펼침 표시가 붙고, 기본은 접혀 있다 (G-25)', async () => {
    parseSlipFileMock.mockReturnValue(makeFileWithRepeatGrid() as unknown as SlipFile);
    const el = await loadDesigner();

    // 하위 항목은 처음에 접힌 상태로 표시된다.
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(0);
    expect(twisty(el, 'items')).toBeDefined();
    expect(twisty(el, '합계금액')).toBeUndefined();
    el.remove();
  });

  it('펼침 표시를 누르면 하위 줄이 열리고, 다시 누르면 닫힌다 (G-25)', async () => {
    parseSlipFileMock.mockReturnValue(makeFileWithRepeatGrid() as unknown as SlipFile);
    const el = await loadDesigner();

    const open = twisty(el, 'items')!;
    expect(open.getAttribute('aria-expanded')).toBe('false');
    open.click();
    await el.updateComplete;
    expect(Array.from(el.shadowRoot!.querySelectorAll('.side-col-row'))
      .map((r) => r.textContent?.trim())).toEqual(['a']);
    expect(twisty(el, 'items')!.getAttribute('aria-expanded')).toBe('true');

    twisty(el, 'items')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(0);
    el.remove();
  });

  it('그 값이나 그 그리드를 고르면 하위 줄이 저절로 열린다 (G-25)', async () => {
    parseSlipFileMock.mockReturnValue(makeFileWithRepeatGrid() as unknown as SlipFile);
    const el = await loadDesigner();

    const parameterRow = Array.from(sideSection(el, strings.designer.sidebarParameters)
      .querySelectorAll('.side-row')).find((r) => r.textContent?.trim() === 'items') as HTMLElement;
    parameterRow.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(1);

    // 자동으로 펼쳐진 항목도 다시 접을 수 있다.
    twisty(el, 'items')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(0);

    // 그리드를 선택하면 해당 그리드가 사용하는 파라미터를 펼친다.
    (Array.from(sideSection(el, strings.designer.sidebarPages)
      .querySelectorAll('.side-row'))[1] as HTMLElement).click();
    await el.updateComplete;
    const gridRow = Array.from(sideSection(el, strings.designer.sidebarElements)
      .querySelectorAll('.side-row')).find((r) => r.textContent?.trim() === 't1') as HTMLElement;
    gridRow.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.side-col-row').length).toBe(1);
    el.remove();
  });

  it('파라미터 목록은 양식 전체의 field·그리드 파라미터를 모으고, 반복 구간 필드는 하위 줄로 보여준다', async () => {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'field' as const, id: 'fld-1', name: 'f1', position: { x: 10, y: 10 },
          width: 60, height: 10, parameter: '합계금액',
        } as never,
        {
          type: 'grid' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          rows: [{ height: 8 }, { height: 8 }],
          columns: [{ width: 180 }],
          repeat: {
            parameter: 'items',
            bands: [
              { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
              { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
            ],
            pagination: { mode: 'fixed', itemsPerPage: 2 },
          },
          cells: [{ row: 1, column: 0, parameter: 'a' }],
        } as never,
      ],
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const section = sideSection(el, strings.designer.sidebarParameters);
    const rows = section.querySelectorAll('.side-row');
    // 반복 파라미터는 목록 파라미터로 등록한다.
    expect(Array.from(rows).map((r) => r.textContent?.trim())).toEqual(['items', '합계금액']);
    // 반복 구간의 셀 파라미터는 목록 하위 필드로 표시한다.
    twisty(el, 'items')!.click();
    await el.updateComplete;
    expect(Array.from(sideSection(el, strings.designer.sidebarParameters)
      .querySelectorAll('.side-col-row')).map((r) => r.textContent?.trim()))
      .toEqual(['a']);

    // 파라미터 패널의 사용 위치에서 해당 요소로 이동할 수 있다.
    (rows[1] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.sidebarParameters);

    (el.shadowRoot?.querySelector('.usage-row') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('2 / 2');
    expect(el.shadowRoot?.querySelector('.element.selected')?.getAttribute('data-id')).toBe('fld-1');
    el.remove();
  });

  it('샘플 값이 없어도 선언된 종류로 수식의 타입 어긋남이 드러난다 (ADR-044/047)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'memo', valueType: 'text' }];
    file.template.pages[0]!.elements = [{
      type: 'field' as const, id: 'f-1', name: 'f', position: { x: 10, y: 10 },
      width: 40, height: 8, formula: '',
    } as never];
    delete (file.template as { sampleValues?: unknown }).sampleValues;
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'f-1');
    await el.updateComplete;

    // 수식 모달을 열고 글자 파라미터를 숫자 자리에 넣는다
    (el as unknown as { _formulaModalOpen: boolean })._formulaModalOpen = true;
    (el as unknown as { _formulaDraft: string })._formulaDraft = 'SUM(memo)';
    (el as unknown as { requestUpdate: () => void }).requestUpdate();
    await el.updateComplete;

    // 샘플 값이 없으면 선언된 값 종류의 시험값으로 평가한다.
    const status = el.shadowRoot!.querySelector('.formula-status');
    expect(status?.textContent?.trim()).not.toBe('');
    el.remove();
  });

  it('반복 구간이 쓰는 파라미터는 열 때 목록으로 선언되고 하위 필드가 채워진다 (ADR-047)', async () => {
    const file = makeTemplateFile();
    // 값 종류가 선언되지 않은 기존 파일을 사용한다.
    file.template.parameters = [{ key: 'items', label: '품목' }];
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'g-1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 10 }, { height: 10 }],
      columns: [{ width: 60 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 1 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 1, column: 0, parameter: 'itemName' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    const items = defs.find((b) => b.key === 'items')!;
    // 반복 구간이 있다는 것은 그 값이 목록이라는 뜻이다
    expect(items.valueType).toBe('list');
    // 구간 칸이 읽는 이름이 하위 필드로 선언되고, 이름은 헤더의 직접 입력한 글을 쓴다
    expect(items.fields?.map((f) => [f.key, f.label])).toEqual([['itemName', '품명']]);
    el.remove();
  });

  it('목록이 아닌 종류로 선언된 파라미터는 열 때 건드리지 않는다', async () => {
    const file = makeTemplateFile();
    // 반복 구간에서 참조하지만 값 종류는 text로 선언되어 있다.
    file.template.parameters = [{ key: 'items', label: '품목', valueType: 'text' }];
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'g-1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 10 }, { height: 10 }],
      columns: [{ width: 60 }],
      repeat: {
        parameter: 'items',
        bands: [
          { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
          { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
        ],
        pagination: { mode: 'fixed', itemsPerPage: 1 },
      },
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 1, column: 0, parameter: 'itemName' },
      ],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    const items = defs.find((b) => b.key === 'items')!;
    // 명시된 값 종류를 유지한다.
    expect(items.valueType).toBe('text');
    // 하위 필드는 목록 파라미터에만 추가한다.
    expect(items.fields).toBeUndefined();
    el.remove();
  });

  it('샘플 JSON은 저장된 행에 없는 하위 필드도 키로 보여준다 (입력폼 탭과 어긋나지 않게)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{
      key: 'items', valueType: 'list',
      fields: [{ key: 'name' }, { key: 'amount', valueType: 'number' }],
    }];
    // 저장된 행에는 name만 있다
    file.template.sampleValues = { items: [{ name: '사과' }] };
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const skeleton = (el as unknown as { _sampleSkeleton: () => Record<string, unknown> })
      ._sampleSkeleton();
    expect(skeleton['items']).toEqual([{ name: '사과', amount: 0 }]);
    el.remove();
  });

  it('파라미터에 값 종류를 지정할 수 있고, 목록이면 하위 필드를 그리드 없이 만들 수 있다 (ADR-047)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'rows', label: '품목' }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 파라미터를 고르면 값 종류를 지정할 수 있다
    const row = Array.from(sideSection(el, strings.designer.sidebarParameters).querySelectorAll('.side-row'))
      .find((r) => r.textContent?.includes('품목')) as HTMLElement;
    row.click();
    await el.updateComplete;

    const typeRow = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.parameterValueType);
    await pickListValue(el, typeRow!.querySelector('.list-select') as HTMLButtonElement, 'list');

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    expect(defs[0]!.valueType).toBe('list');

    // 그리드 없이도 목록 파라미터에 하위 필드를 추가할 수 있다.
    (el.shadowRoot!.querySelector('.prop-add-row') as HTMLElement).click();
    await el.updateComplete;
    const after = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    expect(after[0]!.fields?.map((f) => f.key)).toEqual(['field1']);
    // 만든 필드가 곧바로 편집 대상이 된다
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.parameterField);
    el.remove();
  });

  it('목록이 아닌 종류로 바꾸면 하위 필드가 함께 정리된다 (스키마가 거부하는 조합을 남기지 않는다)', async () => {
    const file = makeTemplateFile();
    file.template.parameters = [{ key: 'rows', valueType: 'list', fields: [{ key: 'amount' }] }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const row = Array.from(sideSection(el, strings.designer.sidebarParameters).querySelectorAll('.side-row'))
      .find((r) => r.textContent?.includes('rows')) as HTMLElement;
    row.click();
    await el.updateComplete;

    const typeRow = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.parameterValueType);
    await pickListValue(el, typeRow!.querySelector('.list-select') as HTMLButtonElement, 'number');

    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters!;
    expect(defs[0]!.valueType).toBe('number');
    expect(defs[0]!.fields).toBeUndefined();
    el.remove();
  });

  it('목록 파라미터의 하위 필드를 고르면 요소가 아니라 그 필드가 편집된다 (ADR-047)', async () => {
    const file = makeTemplateFile();
    file.template.pages.push({
      elements: [
        {
          type: 'grid' as const, id: 'tbl-1', name: 't1', position: { x: 10, y: 30 },
          rows: [{ height: 8 }, { height: 8 }],
          columns: [{ width: 108 }, { width: 72 }],
          repeat: {
            parameter: 'items',
            bands: [
              { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
              { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
            ],
            pagination: { mode: 'fixed', itemsPerPage: 2 },
          },
          cells: [
            { row: 0, column: 0, content: '품명' },
            { row: 1, column: 0, parameter: 'name' },
            { row: 1, column: 1, parameter: 'amount' },
          ],
        } as never,
      ],
    });
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 하위 줄 이름은 반복 구간 위쪽 같은 열의 직접 입력한 글, 없으면 물리명이다 (펼쳐야 보인다)
    twisty(el, 'items')!.click();
    await el.updateComplete;
    const cols = sideSection(el, strings.designer.sidebarParameters).querySelectorAll('.side-col-row');
    expect(Array.from(cols).map((c) => c.textContent?.trim())).toEqual(['품명', 'amount']);

    (cols[1] as HTMLElement).click();
    await el.updateComplete;

    // 그 필드를 읽는 칸이 있는 페이지로 옮겨 어디에 쓰이는지 보인다
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('2 / 2');
    // 파라미터의 하위 필드를 선택한 상태이므로 요소는 선택하지 않는다.
    expect(el.shadowRoot?.querySelector('.element.selected')).toBeNull();

    // 오른쪽 패널이 그 하위 필드 편집으로 바뀐다
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.parameterField);
    const keyRow = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.parameterKey);
    expect((keyRow?.querySelector('input') as HTMLInputElement).value).toBe('amount');

    // 「쓰는 곳」에는 해당 필드를 참조하는 칸이 표시된다.
    const usage = Array.from(el.shadowRoot!.querySelectorAll('.usage-row'))
      .map((u) => u.textContent?.replace(/\s+/g, ' ').trim());
    expect(usage.some((u) => u?.includes(`${strings.designer.cell} (2, 2)`))).toBe(true);
    el.remove();
  });

  it('페이지 설정 패널에서 순서를 옮기면 그 페이지 요소가 그대로 따라간다 (G-46)', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;
    // 2페이지에 요소를 하나 만들어 순서가 바뀌는지 확인한다
    await addByCanvasClick(el, strings.designer.addText);

    // 페이지 순서는 페이지 설정 패널에서 변경한다.
    const pageRows = sideSection(el, strings.designer.sidebarPages).querySelectorAll('.page-row');
    (pageRows[1] as HTMLElement).click();
    await el.updateComplete;
    const moveForward = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.pageMoveForward) as HTMLButtonElement;
    moveForward.click();
    await el.updateComplete;

    const file = (el as unknown as { _file: SlipTemplateFile })._file;
    expect(file.template.pages.map((pg) => pg.elements.length)).toEqual([1, 2]);
    // 보고 있던 페이지를 그대로 따라간다
    expect(el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('1 / 2');
    // 첫 페이지에서는 더 앞으로 옮길 수 없다
    const moveForwardAgain = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.pageMoveForward) as HTMLButtonElement;
    expect(moveForwardAgain.disabled).toBe(true);
    el.remove();
  });

  it('요소 목록은 페이지별로 묶이고, 줄의 삭제 버튼으로 그 요소를 지운다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.addPage).click();
    await el.updateComplete;

    const section = sideSection(el, strings.designer.sidebarElements);
    // 페이지가 여럿이면 페이지 머리가 붙고, 현재(2)페이지만 펼쳐진다
    expect(section.querySelectorAll('.side-page-head').length).toBe(2);
    expect(section.querySelectorAll('.side-row').length).toBe(0);

    (section.querySelectorAll('.side-page-head')[0] as HTMLElement).click();
    await el.updateComplete;

    expect(sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row').length)
      .toBe(2);

    const remove = Array.from(
      sideSection(el, strings.designer.sidebarElements).querySelectorAll('button'),
    ).find((b) => b.getAttribute('aria-label') === `test-text ${strings.designer.delete}`)!;
    remove.click();
    await el.updateComplete;

    expect(sideSection(el, strings.designer.sidebarElements).querySelectorAll('.side-row').length)
      .toBe(1);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(1);
    el.remove();
  });

  it('미리보기 모드에서는 사이드바가 표시되지 않는다', async () => {
    const el = await loadDesigner();
    expect(el.shadowRoot?.querySelector('.sidebar')).not.toBeNull();

    toolbarButton(el, strings.designer.preview).click();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.sidebar')).toBeNull();
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 좌표 기준점: X·Y 표시·입력의 기준 9점, 파일에는 좌상단 좌표를 저장한다.
// ---------------------------------------------------------------------------

describe('<slip-designer> 좌표 기준점', () => {
  function anchorDot(el: Element, name: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.anchor-dot'))
      .find((b) => b.getAttribute('aria-label') === `${strings.designer.anchor}: ${name}`) as HTMLButtonElement;
  }

  function xyInputs(el: Element): [HTMLInputElement, HTMLInputElement] {
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'));
    const x = rows.find((r) => r.querySelector('label')?.textContent?.trim() === 'X')!
      .querySelector('input') as HTMLInputElement;
    const y = rows.find((r) => r.querySelector('label')?.textContent?.trim() === 'Y')!
      .querySelector('input') as HTMLInputElement;
    return [x, y];
  }

  // 픽스처 텍스트 요소: position (30, 40), 크기 60×10

  it('기본 기준점은 좌상 — X·Y 표시가 저장 좌표와 같다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    expect(anchorDot(el, strings.designer.anchorTL).getAttribute('aria-pressed')).toBe('true');
    const [x, y] = xyInputs(el);
    expect(x.value).toBe('30');
    expect(y.value).toBe('40');
    el.remove();
  });

  it('중앙 기준을 고르면 X·Y가 중앙 좌표로 표시되고 파일 좌표는 그대로다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    anchorDot(el, strings.designer.anchorC).click();
    await el.updateComplete;

    const [x, y] = xyInputs(el);
    expect(x.value).toBe('60'); // 30 + 60/2
    expect(y.value).toBe('45'); // 40 + 10/2
    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect(text.position).toEqual({ x: 30, y: 40 });
    // 기준점 변경만으로는 파일이 바뀌지 않는다
    expect(changes.length).toBe(0);
    el.remove();
  });

  it('기준점은 요소마다 따로 기억한다 — 한 요소에서 바꿔도 다른 요소는 그대로 (G-32)', async () => {
    const el = await loadDesigner();

    // txt-1(60×10)만 중앙 기준으로 바꾼다
    selectElement(el, 'txt-1');
    await el.updateComplete;
    anchorDot(el, strings.designer.anchorC).click();
    await el.updateComplete;
    expect(xyInputs(el)[0].value).toBe('60'); // 30 + 60/2

    // shp-1(50×30, position 100,80)은 손대지 않았으니 좌상 기준 그대로여야 한다
    selectElement(el, 'shp-1');
    await el.updateComplete;
    expect(anchorDot(el, strings.designer.anchorTL).getAttribute('aria-pressed')).toBe('true');
    expect(xyInputs(el).map((i) => i.value)).toEqual(['100', '80']);

    // txt-1로 돌아오면 아까 고른 중앙 기준이 그대로 남아 있다
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(anchorDot(el, strings.designer.anchorC).getAttribute('aria-pressed')).toBe('true');
    expect(xyInputs(el)[0].value).toBe('60');
    el.remove();
  });

  it('중앙 기준으로 X를 입력하면 좌상단 좌표로 환산해 저장한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    anchorDot(el, strings.designer.anchorC).click();
    await el.updateComplete;

    const [x] = xyInputs(el);
    x.value = '100';
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect(text.position.x).toBe(70); // 100 - 60/2
    expect(text.position.y).toBe(40);
    // 표시도 입력한 기준점 좌표를 유지한다
    expect(xyInputs(el)[0].value).toBe('100');
    el.remove();
  });

  it('우하 기준은 X·Y를 오른쪽 아래 모서리 좌표로 표시한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    anchorDot(el, strings.designer.anchorBR).click();
    await el.updateComplete;

    const [x, y] = xyInputs(el);
    expect(x.value).toBe('90'); // 30 + 60
    expect(y.value).toBe('50'); // 40 + 10
    el.remove();
  });

  it('환산 결과가 음수가 되는 입력은 0으로 눌러 붙인다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    anchorDot(el, strings.designer.anchorBR).click();
    await el.updateComplete;

    const [x] = xyInputs(el);
    x.value = '10'; // 10 - 60 = -50 → 0
    x.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements[0]!;
    expect(text.position.x).toBe(0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 양식 설정 패널: 제목·용지 크기·방향·여백
// ---------------------------------------------------------------------------

describe('<slip-designer> 양식 설정 패널', () => {
  /** 라벨 문구로 속성 패널의 입력(input 또는 리스트형 선택 상자)을 찾는다 */
  function panelField(el: Element, label: string): HTMLInputElement {
    const row = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!row) throw new Error(`패널 입력을 찾지 못했습니다: ${label}`);
    return row.querySelector('input, .list-select') as HTMLInputElement;
  }

  function currentFile(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  function setField(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('제목을 바꾸면 meta.title이 갱신되고 slip-change를 발행한다 (빈 값은 무시)', async () => {
    const el = await loadDesigner();
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    setField(panelField(el, strings.designer.formTitle), '새 양식 제목');
    await el.updateComplete;
    expect(currentFile(el).template.meta.title).toBe('새 양식 제목');
    expect(changes.length).toBe(1);

    setField(panelField(el, strings.designer.formTitle), '   ');
    await el.updateComplete;
    expect(currentFile(el).template.meta.title).toBe('새 양식 제목');
    expect(changes.length).toBe(1);
    el.remove();
  });

  it('용지 프리셋을 고르면 크기가 바뀌고 캔버스 용지도 함께 바뀐다', async () => {
    const el = await loadDesigner();

    await pickListValue(el, panelField(el, strings.designer.paperSize), '1'); // A5 148×210
    await el.updateComplete;

    const { paper } = currentFile(el).template;
    expect(paper.width).toBe(148);
    expect(paper.height).toBe(210);
    const paperDiv = el.shadowRoot?.querySelector('.paper') as HTMLElement;
    expect(parseFloat(paperDiv.style.width)).toBeCloseTo(148 * PX_PER_MM, 0);
    el.remove();
  });

  it('방향을 가로로 바꾸면 너비·높이가 서로 바뀐다', async () => {
    const el = await loadDesigner();
    const landscapeBtn = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') ===
        `${strings.designer.orientation}: ${strings.designer.landscape}`) as HTMLButtonElement;
    expect(landscapeBtn.getAttribute('aria-pressed')).toBe('false');

    landscapeBtn.click();
    await el.updateComplete;

    const { paper } = currentFile(el).template;
    expect(paper.width).toBe(297);
    expect(paper.height).toBe(210);
    el.remove();
  });

  it('여백을 바꾸면 padding에 반영되고, 용지를 넘는 값은 무시한다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.marginTop), '25');
    await el.updateComplete;
    expect(currentFile(el).template.paper.padding).toEqual([25, 15, 20, 15]);

    // 왼쪽+오른쪽 여백 합이 용지 너비를 넘는 값은 되돌린다
    setField(panelField(el, strings.designer.marginLeft), '300');
    await el.updateComplete;
    expect(currentFile(el).template.paper.padding).toEqual([25, 15, 20, 15]);
    expect(panelField(el, strings.designer.marginLeft).getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.marginAreaError);
    el.remove();
  });

  it('너비를 여백 합 이하로 줄이는 값은 무시한다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.width), '20'); // 좌우 여백 합 30 이하
    await el.updateComplete;
    expect(currentFile(el).template.paper.width).toBe(210);
    expect(panelField(el, strings.designer.width).getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.paperAreaError);
    el.remove();
  });

  it('편집 대상을 바꾸면 이전 패널의 입력 오류를 남기지 않는다', async () => {
    const el = await loadDesigner();

    setField(panelField(el, strings.designer.width), '20');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.field-error')).not.toBeNull();

    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.field-error')).toBeNull();
    el.remove();
  });

  it('용지 변경은 되돌리기로 복구된다', async () => {
    const el = await loadDesigner();

    await pickListValue(el, panelField(el, strings.designer.paperSize), '1'); // A5
    expect(currentFile(el).template.paper.width).toBe(148);

    toolbarButton(el, strings.designer.undo).click();
    await el.updateComplete;
    expect(currentFile(el).template.paper.width).toBe(210);
    el.remove();
  });
});

describe('<slip-designer> 입력 필드 단축키 가드', () => {
  it('속성 패널 입력란에서 Backspace를 눌러도 요소가 삭제되지 않는다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(retargetedKey(el, 'Backspace'));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(el.shadowRoot?.querySelector('.element.selected')).not.toBeNull();
    el.remove();
  });

  it('입력란에서 Ctrl+V는 요소 붙여넣기를 실행하지 않는다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;

    el.dispatchEvent(retargetedKey(el, 'v', { ctrlKey: true }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('입력란에서 Ctrl+Z는 전체 양식 undo를 실행하지 않는다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addText);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(retargetedKey(el, 'z', { ctrlKey: true }));
    await el.updateComplete;

    // 입력란 텍스트 undo가 아니라면 양식은 그대로여야 한다
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(3);
    el.remove();
  });

  it('입력란 밖(캔버스)에서는 단축키가 그대로 동작한다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(1);
    el.remove();
  });
});

describe('<slip-designer> 선 전용 편집 (C-11)', () => {
  const PX = 96 / 25.4;

  it('선 도구 첫 클릭은 시작점만 기록하고, 둘째 클릭에 선이 생긴다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;

    await clickCanvasAt(el, 20 * PX, 50 * PX);
    // 아직 요소가 생기지 않고 도구가 유지된다
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    expect(toolbarButton(el, strings.designer.shapeLine).getAttribute('aria-pressed')).toBe('true');

    // 커서를 움직이면 반투명 미리보기 선이 보인다
    const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
    paper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 60 * PX, clientY: 50 * PX, pointerId: 1,
    }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.line-ghost')).not.toBeNull();

    await clickCanvasAt(el, 60 * PX, 50 * PX);
    const added = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as { type: string; lineDirection?: string; position: { x: number }; width: number };
    expect(added.type).toBe('line');
    expect(added.lineDirection).toBe('horizontal');
    expect(added.position.x).toBeCloseTo(20, 0);
    expect(added.width).toBeCloseTo(40, 0);
    expect(el.shadowRoot?.querySelector('.line-ghost')).toBeNull();
    el.remove();
  });

  it('Escape는 두 번 클릭 생성을 취소한다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 100, 100);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.line-ghost')).toBeNull();
    expect(toolbarButton(el, strings.designer.shapeLine).getAttribute('aria-pressed')).toBe('false');

    // 이후 클릭해도 요소가 생기지 않는다
    await clickCanvasAt(el, 200, 100);
    expect(el.shadowRoot?.querySelectorAll('.element').length).toBe(2);
    el.remove();
  });

  it('선을 선택하면 8방향 핸들 대신 선 하이라이트와 끝점 핸들 2개가 나타난다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 20 * PX, 50 * PX);
    await clickCanvasAt(el, 60 * PX, 50 * PX);

    // 방금 만든 선이 선택돼 있다
    expect(el.shadowRoot?.querySelectorAll('.endpoint').length).toBe(2);
    expect(el.shadowRoot?.querySelector('.handle-nw')).toBeNull();
    expect(el.shadowRoot?.querySelector('.line-highlight')).not.toBeNull();
    el.remove();
  });

  it('끝점을 끌면 반대쪽 끝점은 고정된 채 상자·선 방향이 다시 계산된다', async () => {
    const el = await loadDesigner();
    toolbarButton(el, strings.designer.shapeLine).click();
    await el.updateComplete;
    await clickCanvasAt(el, 20 * PX, 50 * PX);
    await clickCanvasAt(el, 60 * PX, 50 * PX);

    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));

    // 두 번째 끝점(오른쪽)을 아래로 끌어 사선(↘)으로 만든다
    const handle = el.shadowRoot!.querySelectorAll('.endpoint')[1] as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 60 * PX, clientY: 50 * PX, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 80 * PX, clientY: 90 * PX, pointerId: 1,
    }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
    await el.updateComplete;

    const line = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.at(-1)! as never as {
        lineDirection?: string; position: { x: number; y: number }; width: number; height: number;
      };
    expect(line.lineDirection).toBe('down');
    expect(line.position.x).toBeCloseTo(20, 0);
    expect(line.width).toBeCloseTo(60, 0);
    // 고정 끝점은 수평선 상자 세로 중앙(y=51)이라 높이는 90-51=39
    expect(line.height).toBeCloseTo(39, 0);
    expect(changes.length).toBe(1);
    el.remove();
  });
});

describe('<slip-designer> 패널 표시 정리 (F-18)', () => {
  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  it('펼쳐지는 항목은 한 번에 하나만 열린다 — 다른 것을 열면 먼저 것이 닫힌다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1'); // 사각형 — 배경색·테두리색·굵기·형태가 모두 있다
    await el.updateComplete;

    (el.shadowRoot!.querySelector('.color-btn') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.color-pop').length).toBe(1);

    // 테두리 굵기를 열면 색 피커가 닫힌다
    (el.shadowRoot!.querySelector('.width-btn') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.color-pop').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.width-pop').length).toBe(1);

    // 다시 색을 열면 굵기가 닫힌다
    (el.shadowRoot!.querySelector('.color-btn') as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('.width-pop').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.color-pop').length).toBe(1);
    el.remove();
  });

  it('테두리 형태도 굵기처럼 선 모양 미리보기와 함께 펼쳐진다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1');
    await el.updateComplete;

    const shapeButton = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'))
      .find((b) => b.getAttribute('aria-label')
        === `${strings.designer.styleBorder} ${strings.designer.borderShape}`) as HTMLButtonElement;
    // 버튼에도 지금 형태의 선 모양이 보인다
    expect(shapeButton.querySelector('.shape-line.shape-solid')).not.toBeNull();

    shapeButton.click();
    await el.updateComplete;
    const options = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'));
    expect(options.map((o) => o.querySelector('.shape-line')?.className))
      .toEqual(['shape-line shape-solid', 'shape-line shape-dashed', 'shape-line shape-dotted']);
    el.remove();
  });

  it('숫자 칸에 잘못된 값을 넣으면 지우지 않고 되돌리며 오류를 알린다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const sizeInput = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.fontSize)!
      .querySelector('input') as HTMLInputElement;

    const input = sizeInput();
    // 숫자 칸에 글자를 넣으면 브라우저가 값을 빈 문자열로 준다 (badInput)
    Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    // 값이 사라지지 않고 되돌아온다
    expect(sizeInput().value).toBe('10');
    // 유효하지 않은 입력임을 표시한다.
    expect(el.shadowRoot!.querySelector('.input-error')?.textContent?.trim())
      .toBe(strings.designer.numberInput);
    el.remove();
  });

  it('지정하지 않은 항목은 실제 적용 중인 값을 흐리게 보여준다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1'); // 글자색·크기 미지정 텍스트
    await el.updateComplete;

    const fontColor = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.fontColor)!;
    // 미지정이지만 실제로 적용되는 검정을 흐리게 보여준다
    expect(fontColor.querySelector('.color-value')?.textContent?.trim()).toBe('#000000');
    expect(fontColor.querySelector('.color-value')?.classList.contains('dim')).toBe(true);

    const sizeInput = () => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.fontSize)!
      .querySelector('input') as HTMLInputElement;

    // 미지정 상태에서도 실제 적용값으로 숫자 입력을 시작한다.
    const fontSize = sizeInput();
    expect(fontSize.value).toBe('10');
    expect(fontSize.classList.contains('dim')).toBe(true);

    // 값을 지정하면 흐린 표시가 사라진다
    fontSize.value = '14';
    fontSize.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const after = sizeInput();
    expect(after.value).toBe('14');
    expect(after.classList.contains('dim')).toBe(false);

    // 기본값과 같은 값을 넣으면 파일에는 적지 않는다(다시 흐리게)
    after.value = '10';
    after.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(sizeInput().classList.contains('dim')).toBe(true);
    el.remove();
  });

  it('그리드 셀은 요소에서 물려받는 글자색을 흐리게 보여준다', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'grid' as const, id: 'grd-1', name: 'g', position: { x: 10, y: 10 },
      rows: [{ height: 15 }, { height: 15 }], columns: [{ width: 45 }, { width: 45 }],
      fontColor: '#1a73e8',
      cells: [{ row: 0, column: 0, content: '가' }],
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 표를 고른 뒤 그 자리를 한 번 더 누르면 셀 선택 모드가 되어 (0,0) 셀이 골라진다
    const PX = 96 / 25.4;
    const grid = el.shadowRoot!.querySelector('[data-id="grd-1"]') as HTMLElement;
    for (let i = 0; i < 2; i += 1) {
      grid.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, composed: true, clientX: 15 * PX, clientY: 15 * PX, pointerId: 1,
      }));
      grid.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, composed: true, clientX: 15 * PX, clientY: 15 * PX, pointerId: 1,
      }));
      await el.updateComplete;
    }

    const cellFontColor = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .find((b) => b.getAttribute('aria-label')
        === `${strings.designer.cell} ${strings.designer.fontColor}`)!;
    // 셀에 지정하지 않았으면 표 요소의 글자색이 적용되므로 그 값을 흐리게 보여준다
    expect(cellFontColor.querySelector('.color-value')?.textContent?.trim()).toBe('#1a73e8');
    expect(cellFontColor.querySelector('.color-value')?.classList.contains('dim')).toBe(true);

    // 셀 선택 중에는 그리드 공통 스타일을 함께 표시하지 않는다.
    const elementFontColor = Array.from(el.shadowRoot!.querySelectorAll('.color-btn'))
      .find((b) => b.getAttribute('aria-label') === strings.designer.fontColor);
    expect(elementFontColor).toBeUndefined();
    el.remove();
  });

  it('요소 종류 배지는 평소 숨었다가 고른 요소에만 보이고, 요소 확인로 전부 켠다', async () => {
    const el = await loadDesigner();
    const badges = () => Array.from(el.shadowRoot!.querySelectorAll('.element .badge'));
    const canvas = () => el.shadowRoot!.querySelector('.canvas-area')!;

    // 배지는 요소마다 있지만 평소에는 숨어 있고, 고른 요소에만 보인다
    expect(badges().length).toBe(2);
    expect(badges().filter((n) => getComputedStyle(n).display !== 'none').length).toBe(0);
    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(badges().filter((n) => getComputedStyle(n).display !== 'none').length).toBe(1);

    // 툴바의 요소 확인를 켜면 캔버스가 전부 보이는 상태로 바뀐다
    toolbarButton(el, strings.designer.showBadges).click();
    await el.updateComplete;
    expect(canvas().classList.contains('show-badges')).toBe(true);
    expect(toolbarButton(el, strings.designer.showBadges).getAttribute('aria-pressed')).toBe('true');

    // Ctrl+B로 다시 끈다
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(canvas().classList.contains('show-badges')).toBe(false);
    el.remove();
  });

  it('텍스트의 줄바꿈이 캔버스에도 그대로 보인다 (PDF와 같게)', async () => {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements = [{
      type: 'text' as const, id: 'txt-nl', name: 'nl', position: { x: 10, y: 10 },
      width: 60, height: 20, content: '첫째 줄\n둘째 줄',
    } as never];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    const content = el.shadowRoot?.querySelector('.el-content') as HTMLElement;
    expect(content.textContent).toBe('첫째 줄\n둘째 줄');
    // 한 줄로 눌리지 않도록 줄바꿈을 살려 표시한다
    expect(getComputedStyle(content).whiteSpace).toBe('pre-wrap');
    el.remove();
  });
});

describe('<slip-designer> 글자 스타일·테두리 편집 (C-11)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  it('텍스트 요소의 굵게·밑줄·취소선 토글이 값을 넣고 지운다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    byAria(el, strings.designer.bold).click();
    await el.updateComplete;
    byAria(el, strings.designer.underline).click();
    await el.updateComplete;

    const text = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[0]! as never as Record<string, unknown>;
    expect(text.bold).toBe(true);
    expect(text.underline).toBe(true);
    expect(byAria(el, strings.designer.bold).getAttribute('aria-pressed')).toBe('true');

    byAria(el, strings.designer.bold).click();
    await el.updateComplete;
    expect(text.bold).toBeUndefined();
    el.remove();
  });

  it('수직 정렬·줄간격·자간·세로쓰기를 속성 패널에서 정한다 (G-45)', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const text = () => (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[0]! as never as Record<string, unknown>;
    const rowInput = (labelText: string) => Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === labelText)!
      .querySelector('input') as HTMLInputElement;

    // 수직 정렬 — 가운데
    byAria(el, `${strings.designer.verticalAlignment}: ${strings.designer.alignMiddle}`).click();
    await el.updateComplete;
    expect(text().verticalAlignment).toBe('middle');

    // 줄간격 1.5
    const lh = rowInput(strings.designer.lineHeight);
    lh.value = '1.5';
    lh.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(text().lineHeight).toBe(1.5);

    // 자간 2
    const cs = rowInput(strings.designer.characterSpacing);
    cs.value = '2';
    cs.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(text().characterSpacing).toBe(2);

    // 세로쓰기 켜기
    const vertical = Array.from(el.shadowRoot!.querySelectorAll('input[type="checkbox"]'))
      .find((c) => c.getAttribute('aria-label') === strings.designer.verticalWriting) as HTMLInputElement;
    vertical.checked = true;
    vertical.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(text().vertical).toBe(true);

    // 기본값으로 되돌리면 필드가 지워진다
    byAria(el, `${strings.designer.verticalAlignment}: ${strings.designer.alignTop}`).click();
    await el.updateComplete;
    expect(text().verticalAlignment).toBeUndefined();
    el.remove();
  });

  it('테두리 굵기 선택에 없음과 정해진 단계가 굵기 미리보기 선과 함께 나열된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1'); // 사각형 — 기본 0.2mm
    await el.updateComplete;

    (el.shadowRoot!.querySelector('.width-btn') as HTMLElement).click();
    await el.updateComplete;

    const options = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'));
    expect(options[0]?.getAttribute('aria-label'))
      .toBe(`${strings.designer.borderWidth}: ${strings.designer.colorNone}`);
    // 단계 항목마다 굵기 미리보기 선이 있다
    expect(options.slice(1).every((b) => b.querySelector('.width-line'))).toBe(true);

    // 0.8mm를 고르면 저장되고 버튼 표시도 바뀐다
    (options.find((b) => b.getAttribute('aria-label') === `${strings.designer.borderWidth}: 0.8mm`) as HTMLButtonElement).click();
    await el.updateComplete;
    const rect = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[1]! as never as Record<string, unknown>;
    expect(rect.borderWidth).toBe(0.8);
    expect(el.shadowRoot!.querySelector('.width-btn')?.textContent).toContain('0.8mm');
    el.remove();
  });

  it('사각형에 파선을 고르면 모서리 반경이 지워지고 반경 입력이 비활성화된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'shp-1');
    await el.updateComplete;

    const radiusInput = () => Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === strings.designer.cornerRadius) as HTMLInputElement;
    radiusInput().value = '3';
    radiusInput().dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const rect = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements[1]! as never as Record<string, unknown>;
    expect(rect.radius).toBe(3);

    await pickBorderShape(
      el,
      `${strings.designer.styleBorder} ${strings.designer.borderShape}`,
      strings.designer.borderDashed,
    );

    expect(rect.borderStyle).toBe('dashed');
    expect(rect.radius).toBeUndefined();
    expect(radiusInput().disabled).toBe(true);
    el.remove();
  });

  it('스타일 항목이 텍스트/배경/테두리 그룹으로 나뉘어 표시된다', async () => {
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;

    const titles = Array.from(el.shadowRoot!.querySelectorAll('.prop-section-title'))
      .map((t) => t.textContent?.trim());
    expect(titles).toContain(strings.designer.styleText);
    expect(titles).toContain(strings.designer.styleBackground);
    expect(titles).toContain(strings.designer.styleBorder);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// : 사이드바 파라미터 등록·삭제·논리명 편집 + 샘플 데이터 편집·채운 미리보기
// ---------------------------------------------------------------------------

describe('<slip-designer> 파라미터 관리 (ADR-034)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  function defsOf(el: Element): { key: string; label?: string }[] | undefined {
    return (fileOf(el).template as { parameters?: { key: string; label?: string }[] }).parameters;
  }

  /** 사이드바 + 버튼 — 기본 이름으로 값을 만들고 바로 고른다 */
  async function addParameter(el: Designer) {
    byAria(el, strings.designer.addParameter).click();
    await el.updateComplete;
  }

  it('+ 버튼은 기본 이름으로 값을 바로 만들고 그 값의 편집 패널을 연다', async () => {
    const el = await loadDesigner();
    await addParameter(el);

    expect(defsOf(el)).toEqual([{ key: 'value1', label: `${strings.designer.newParameterName} 1` }]);
    // 오른쪽 패널이 파라미터 편집으로 바뀐다
    expect(el.shadowRoot?.querySelector('.type-name')?.textContent?.trim())
      .toBe(strings.designer.sidebarParameters);
    expect((el.shadowRoot?.querySelector('.parameter-key-input') as HTMLInputElement).value)
      .toBe('value1');

    // 두 번째는 겹치지 않는 이름으로 이어진다
    await addParameter(el);
    expect(defsOf(el)?.map((d) => d.key)).toEqual(['value1', 'value2']);
    el.remove();
  });

  it('패널에서 물리명을 바꾸면 그 값을 쓰는 요소와 샘플 값도 함께 따라간다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };
    const created = field.parameter;
    fileOf(el).template.sampleValues = { [created]: '1,000' } as never;

    // 사이드바에서 그 값을 골라 패널에서 물리명을 고친다
    const row = Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
      .find((r) => r.getAttribute('title') === created) as HTMLElement;
    row.click();
    await el.updateComplete;

    const keyInput = el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement;
    keyInput.value = 'totalAmount';
    keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(defsOf(el)).toEqual([{ key: 'totalAmount' }]);
    expect(field.parameter).toBe('totalAmount');
    expect(fileOf(el).template.sampleValues).toEqual({ totalAmount: '1,000' });
    el.remove();
  });

  it('이미 쓰는 물리명으로는 바꾸지 않는다', async () => {
    const el = await loadDesigner();
    await addParameter(el);
    await addParameter(el);

    const keyInput = el.shadowRoot!.querySelector('.parameter-key-input') as HTMLInputElement;
    keyInput.value = 'value1';
    keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(defsOf(el)?.map((d) => d.key)).toEqual(['value1', 'value2']);
    // 입력칸은 원래 이름으로 되돌아가고 이유를 알려준다
    expect(keyInput.value).toBe('value2');
    expect(keyInput.getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot?.querySelector('.field-error')?.textContent?.trim())
      .toBe(strings.designer.keyInUse);
    el.remove();
  });

  it('패널에서 논리명을 고치면 목록 표시가 바뀐다', async () => {
    const el = await loadDesigner();
    await addParameter(el);

    const labelInput = el.shadowRoot!.querySelector('.parameter-label-input') as HTMLInputElement;
    labelInput.value = '합계 금액';
    labelInput.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(defsOf(el)).toEqual([{ key: 'value1', label: '합계 금액' }]);
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.side-row'));
    expect(rows.some((r) => r.textContent?.includes('합계 금액'))).toBe(true);
    el.remove();
  });

  it('요소를 추가하면 그 값이 정의부에 함께 등록된다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };

    expect(defsOf(el)).toEqual([{ key: field.parameter }]);
    el.remove();
  });

  it('요소 패널의 선택 상자로 등록된 값을 고르거나 새 값을 만들어 붙인다', async () => {
    const el = await loadDesigner();
    await addParameter(el);
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };

    const trigger = el.shadowRoot!.querySelector('.parameter-select') as HTMLButtonElement;
    // 등록된 값 + "새 값 등록" 항목이 나온다
    expect(await listOptionLabels(el, trigger))
      .toEqual([`${strings.designer.newParameterName} 1`, field.parameter, strings.designer.parameterNew]);

    await pickListValue(el, trigger, 'value1');
    expect(field.parameter).toBe('value1');

    // "새 값 등록"을 고르면 값을 만들어 그대로 이 요소에 붙인다
    const trigger2 = el.shadowRoot!.querySelector('.parameter-select') as HTMLButtonElement;
    trigger2.click();
    await el.updateComplete;
    const optionButtons = el.shadowRoot!.querySelectorAll('.list-select-menu button');
    (optionButtons[optionButtons.length - 1] as HTMLButtonElement).click();
    await el.updateComplete;

    expect(field.parameter).toBe('value2');
    expect(defsOf(el)?.map((d) => d.key)).toContain('value2');
    el.remove();
  });

  it('정의부 삭제는 항목을 제거하고, 요소가 쓰는 키는 목록에 남으며 삭제가 비활성화된다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addField);
    const field = fileOf(el).template.pages[0]!.elements.at(-1)! as never as { parameter: string };

    byAria(el, `${field.parameter} ${strings.designer.delete}`).click();
    await el.updateComplete;

    // 정의부에서는 빠지지만 요소가 쓰고 있으니 목록에는 남고, 그 삭제 버튼은 비활성
    expect(defsOf(el)).toBeUndefined();
    expect(byAria(el, `${field.parameter} ${strings.designer.delete}`).disabled).toBe(true);
    el.remove();
  });
});

describe('<slip-designer> 변동 이미지 (G-47)', () => {
  const byAria = (el: Element, label: string) =>
    Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

  function templateWithImage(): SlipTemplateFile {
    const file = makeTemplateFile();
    file.template.pages[0]!.elements.push({
      type: 'image' as const, id: 'img-1', name: '로고',
      position: { x: 120, y: 20 }, width: 30, height: 20,
      src: 'data:image/png;base64,AAAA',
    } as never);
    return file;
  }

  const imageEl = (el: Element) =>
    (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.find((e) => e.id === 'img-1') as never as Record<string, unknown>;

  it('이미지를 변동으로 바꾸면 값이 생기고 src가 빠진다 (되돌리면 반대)', async () => {
    parseSlipFileMock.mockReturnValue(templateWithImage() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'img-1');
    await el.updateComplete;

    // 변동 이미지로 전환하면 parameter와 valueType을 설정하고 src를 제거한다.
    byAria(el, strings.designer.imageMode);
    const toVariable = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group button'))
      .find((b) => b.textContent?.trim() === strings.designer.imageVariable) as HTMLButtonElement;
    toVariable.click();
    await el.updateComplete;
    expect(typeof imageEl(el).parameter).toBe('string');
    expect(imageEl(el).src).toBeUndefined();
    const defs = (el as unknown as { _file: SlipTemplateFile })._file.template.parameters ?? [];
    const def = defs.find((b) => b.key === imageEl(el).parameter);
    expect(def?.valueType).toBe('image');

    // 고정 이미지로 전환하면 parameter를 제거하고 src를 복원한다.
    const toFixed = Array.from(el.shadowRoot!.querySelectorAll('.toggle-group button'))
      .find((b) => b.textContent?.trim() === strings.designer.imageFixed) as HTMLButtonElement;
    toFixed.click();
    await el.updateComplete;
    expect(imageEl(el).parameter).toBeUndefined();
    expect(typeof imageEl(el).src).toBe('string');
    el.remove();
  });

  it('변동 이미지 값은 샘플 데이터 모달에서 이미지 업로드 입력으로 나온다', async () => {
    const file = templateWithImage();
    const img = file.template.pages[0]!.elements.find((e) => e.id === 'img-1') as never as Record<string, unknown>;
    delete img.src;
    img.parameter = 'stamp';
    file.template.parameters = [{ key: 'stamp', label: '도장', valueType: 'image' }];
    parseSlipFileMock.mockReturnValue(file as unknown as SlipFile);
    const el = await loadDesigner();

    // 사이드바 샘플 데이터 버튼으로 모달을 연다
    byAria(el, strings.designer.sampleData).click();
    await el.updateComplete;

    // 이미지 파라미터에는 업로드 버튼이 나오고 한 줄 텍스트 입력은 없다
    const pick = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === `도장 ${strings.designer.imagePick}`);
    expect(pick).toBeTruthy();
    const textInput = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${strings.designer.sampleData} stamp`);
    expect(textInput).toBeUndefined();
    el.remove();
  });
});

describe('<slip-designer> 바코드 요소 (G-33)', () => {
  const lastElement = (el: Element) => {
    const els = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
    return els[els.length - 1] as never as Record<string, unknown>;
  };
  const selectEl = (el: HTMLElement, id: string) => selectElement(el, id);

  it('바코드 도구로 만들면 qrcode·파라미터로 생성된다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addBarcode);
    const bc = lastElement(el);
    expect(bc.type).toBe('barcode');
    expect(bc.kind).toBe('qrcode');
    expect(typeof bc.parameter).toBe('string');
    // 캔버스에 견본(svg)이 그려진다
    expect(el.shadowRoot!.querySelector('.barcode-preview svg')).not.toBeNull();
    el.remove();
  });

  it('종류를 바꾸고 값 소스를 직접 입력으로 바꾼다', async () => {
    const el = await loadDesigner();
    await addByCanvasClick(el, strings.designer.addBarcode);
    const bc = lastElement(el);
    selectEl(el, bc.id as string);
    await el.updateComplete;

    // 종류 변경
    const kindTrigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((s) => s.getAttribute('aria-label') === strings.designer.barcodeKind) as HTMLButtonElement;
    await pickListValue(el, kindTrigger, 'ean13');
    expect(lastElement(el).kind).toBe('ean13');

    // 직접 입력으로 전환하면 content를 설정하고 parameter를 제거한다.
    const sourceTrigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((s) => s.getAttribute('aria-label') === strings.designer.barcodeValue) as HTMLButtonElement;
    await pickListValue(el, sourceTrigger, 'content');
    expect(lastElement(el).parameter).toBeUndefined();
    expect(lastElement(el).content).toBe('');

    // 유효하지 않은 EAN-13 값에는 경고를 표시한다.
    const input = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === strings.designer.content)!
      .querySelector('input') as HTMLInputElement;
    input.value = '123';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(lastElement(el).content).toBe('123');
    expect(el.shadowRoot!.querySelector('.image-error')?.textContent).toContain('13');
    el.remove();
  });
});

describe('<slip-designer> 요소 그룹화 (G-27)', () => {
  const elById = (el: Element, id: string) =>
    (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!
      .elements.find((e) => e.id === id) as never as Record<string, unknown>;
  const selectedIds = (el: Element) =>
    (el as unknown as { _selectedIds: Set<string> })._selectedIds;

  function sidebarRow(el: Element, name: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('.side-row'))
      .find((r) => r.querySelector('span')?.textContent?.trim() === name) as HTMLButtonElement;
  }
  function panelButton(el: Element, label: string): HTMLButtonElement {
    return Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  }
  async function groupBoth(el: Designer) {
    sidebarRow(el, 'test-text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'test-shape').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    panelButton(el, strings.designer.groupElements).click();
    await el.updateComplete;
  }

  it('사이드바 Ctrl+클릭으로 여러 요소를 골라 묶으면 같은 그룹이 된다', async () => {
    const el = await loadDesigner();
    sidebarRow(el, 'test-text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'test-shape').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    panelButton(el, strings.designer.groupElements).click();
    await el.updateComplete;
    const g1 = elById(el, 'txt-1').group;
    const g2 = elById(el, 'shp-1').group;
    expect(typeof g1).toBe('string');
    expect(g1).toBe(g2);
    el.remove();
  });

  it('그룹을 복사·붙여넣기하면 사본도 함께 새 그룹으로 묶인다 (G-48)', async () => {
    const el = await loadDesigner();
    await groupBoth(el);
    const origGroup = elById(el, 'txt-1').group;

    toolbarButton(el, strings.designer.copy).click();
    await el.updateComplete;
    const changes: CustomEvent[] = [];
    el.addEventListener('slip-change', (e: Event) => changes.push(e as CustomEvent));
    toolbarButton(el, strings.designer.paste).click();
    await el.updateComplete;

    const elements = changes.at(-1)!.detail.file.template.pages[0].elements;
    // 원본 2개 + 사본 2개
    expect(elements.length).toBe(4);
    const pasted = elements.slice(2);
    expect(pasted[0].group).toBe(pasted[1].group); // 사본끼리 같은 그룹
    expect(pasted[0].group).not.toBe(origGroup); // 원본 그룹과는 다른 새 그룹
    expect(selectedIds(el).size).toBe(2); // 사본 2개가 선택됨
    el.remove();
  });

  it('그룹의 한 요소만 눌러도 그룹 전체가 선택되고 함께 움직인다', async () => {
    const el = await loadDesigner();
    await groupBoth(el);

    selectElement(el, 'txt-1');
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    // txt-1(30,40)을 +5mm/+5mm 끌면 shp-1(100,80)도 같이 움직인다
    const div = el.shadowRoot!.querySelector('[data-id="txt-1"]') as HTMLElement;
    div.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, clientX: 5 * PX_PER_MM, clientY: 5 * PX_PER_MM, pointerId: 1,
    }));
    div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(elById(el, 'txt-1').position).toEqual({ x: 35, y: 45 });
    expect(elById(el, 'shp-1').position).toEqual({ x: 105, y: 85 });
    el.remove();
  });

  it('그룹 해제하면 그룹이 사라진다', async () => {
    const el = await loadDesigner();
    await groupBoth(el);
    selectElement(el, 'txt-1');
    await el.updateComplete;
    panelButton(el, strings.designer.ungroupElements).click();
    await el.updateComplete;
    expect(elById(el, 'txt-1').group).toBeUndefined();
    expect(elById(el, 'shp-1').group).toBeUndefined();
    el.remove();
  });

  it('다중 선택 상태에서 Delete로 모두 지운다', async () => {
    const el = await loadDesigner();
    sidebarRow(el, 'test-text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    sidebarRow(el, 'test-shape').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await el.updateComplete;
    expect(selectedIds(el).size).toBe(2);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await el.updateComplete;
    const elements = (el as unknown as { _file: SlipTemplateFile })._file.template.pages[0]!.elements;
    expect(elements.length).toBe(0);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 목록 하위 필드 편집 — 모듈 분리에서 옮길 상태 경계
// ---------------------------------------------------------------------------

describe('<slip-designer> 목록 하위 필드 편집', () => {
  const s = strings.designer;

  /** 하위 필드 둘을 가진 목록 파라미터를 항목 구간 셀이 참조하는 양식 */
  function makeFieldFile(): SlipTemplateFile {
    return {
      schemaVersion: '0.1.0',
      kind: 'template',
      template: {
        meta: { title: '하위 필드' },
        paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
        pages: [{
          elements: [{
            type: 'grid' as const,
            id: 'g-1',
            name: 'field-grid',
            position: { x: 10, y: 10 },
            columns: [{ width: 30 }, { width: 30 }],
            rows: [{ height: 10 }, { height: 10 }],
            repeat: {
              parameter: 'items',
              bands: [
                { id: 'b-head', fromRow: 0, toRow: 0, placement: 'page-start' },
                { id: 'b-item', fromRow: 1, toRow: 1, placement: 'item' },
              ],
              pagination: { mode: 'auto', minItems: 0 },
            },
            cells: [
              { row: 0, column: 0, content: '품명' },
              { row: 1, column: 0, parameter: 'itemName' },
            ],
          }],
          assets: [],
        }],
        assets: [],
        parameters: [{
          key: 'items',
          label: '항목',
          valueType: 'list',
          fields: [{ key: 'itemName', label: '품명' }, { key: 'qty', label: '수량' }],
        }],
      },
    } as unknown as SlipTemplateFile;
  }

  type FieldDef = { key: string; label?: string; valueType?: string };

  function fileOf(el: Element): SlipTemplateFile {
    return (el as unknown as { _file: SlipTemplateFile })._file;
  }

  function fieldsOf(el: Element): FieldDef[] {
    return (fileOf(el).template.parameters ?? []).find((d) => d.key === 'items')
      ?.fields as unknown as FieldDef[];
  }

  function cellOf(el: Element): { parameter?: string } {
    const grid = fileOf(el).template.pages[0]!.elements[0] as unknown as {
      cells: { row: number; column: number; parameter?: string }[];
    };
    return grid.cells.find((c) => c.row === 1 && c.column === 0)!;
  }

  /** 사이드바에서 파라미터를 펼치고 하위 필드를 선택해 속성 패널을 연다 */
  async function openField(el: Designer, fieldTitle: string): Promise<void> {
    const twisty = Array.from(el.shadowRoot!.querySelectorAll('.side-twisty'))
      .find((b) => b.getAttribute('aria-label')?.startsWith('항목 ')) as HTMLButtonElement;
    twisty.click();
    await el.updateComplete;
    const fieldRow = Array.from(el.shadowRoot!.querySelectorAll('.side-col-row'))
      .find((b) => b.textContent?.trim() === fieldTitle) as HTMLButtonElement;
    fieldRow.click();
    await el.updateComplete;
  }

  function panelInput(el: Element, label: string): HTMLInputElement {
    const found = Array.from(el.shadowRoot!.querySelectorAll('.prop-row'))
      .find((r) => r.querySelector('label')?.textContent?.trim() === label);
    if (!found) throw new Error(`패널 줄을 찾지 못했습니다: ${label}`);
    return found.querySelector('input') as HTMLInputElement;
  }

  function commit(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function mount() {
    parseSlipFileMock.mockReturnValue(makeFieldFile() as unknown as SlipFile);
    const el = await loadDesigner();
    await openField(el, '품명');
    return el;
  }

  it('하위 필드의 물리명을 바꾸면 정의와 이를 참조하던 셀이 함께 바뀐다', async () => {
    const el = await mount();
    commit(panelInput(el, s.parameterKey), 'productName');
    await el.updateComplete;

    expect(fieldsOf(el).map((f) => f.key)).toEqual(['productName', 'qty']);
    expect(cellOf(el).parameter).toBe('productName');
    el.remove();
  });

  it('빈 물리명은 저장하지 않고 입력을 되돌린다', async () => {
    const el = await mount();
    const input = panelInput(el, s.parameterKey);
    commit(input, '   ');
    await el.updateComplete;

    expect(fieldsOf(el).map((f) => f.key)).toEqual(['itemName', 'qty']);
    expect(input.value).toBe('itemName');
    el.remove();
  });

  it('형제 필드와 겹치는 물리명은 저장하지 않고 이미 쓰는 이름이라고 알린다', async () => {
    const el = await mount();
    commit(panelInput(el, s.parameterKey), 'qty');
    await el.updateComplete;

    expect(fieldsOf(el).map((f) => f.key)).toEqual(['itemName', 'qty']);
    expect(el.shadowRoot!.querySelector('#error-parameter-key')?.textContent?.trim())
      .toBe(s.keyInUse);
    el.remove();
  });

  it('논리명을 비우면 키가 사라지고, 다시 채우면 저장된다', async () => {
    const el = await mount();
    commit(panelInput(el, s.parameterLabel), '   ');
    await el.updateComplete;
    expect('label' in fieldsOf(el)[0]!).toBe(false);

    commit(panelInput(el, s.parameterLabel), '제품명');
    await el.updateComplete;
    expect(fieldsOf(el)[0]!.label).toBe('제품명');
    el.remove();
  });

  it('파라미터 타입을 고르면 저장되고, 지정 없음으로 되돌리면 키가 사라진다', async () => {
    const el = await mount();
    const trigger = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((b) => b.getAttribute('aria-label') === s.parameterValueType) as HTMLElement;

    await pickListValue(el, trigger, 'number');
    expect(fieldsOf(el)[0]!.valueType).toBe('number');

    const again = Array.from(el.shadowRoot!.querySelectorAll('.list-select'))
      .find((b) => b.getAttribute('aria-label') === s.parameterValueType) as HTMLElement;
    await pickListValue(el, again, '');
    expect('valueType' in fieldsOf(el)[0]!).toBe(false);
    el.remove();
  });

  it('하위 필드를 지우면 정의에서 빠지고 이를 쓰던 항목 구간 셀의 파라미터도 지워진다', async () => {
    const el = await mount();
    const remove = Array.from(el.shadowRoot!.querySelectorAll('.side-mini'))
      .find((b) => b.getAttribute('aria-label') === `itemName ${s.delete}`) as HTMLButtonElement;
    remove.click();
    await el.updateComplete;

    expect(fieldsOf(el).map((f) => f.key)).toEqual(['qty']);
    expect('parameter' in cellOf(el)).toBe(false);
    el.remove();
  });

  it('마지막 하위 필드를 지우면 fields 키 자체가 사라진다', async () => {
    const el = await mount();
    for (const key of ['itemName', 'qty']) {
      const remove = Array.from(el.shadowRoot!.querySelectorAll('.side-mini'))
        .find((b) => b.getAttribute('aria-label') === `${key} ${s.delete}`) as HTMLButtonElement;
      remove.click();
      await el.updateComplete;
    }
    const def = (fileOf(el).template.parameters ?? []).find((d) => d.key === 'items')!;
    expect('fields' in def).toBe(false);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 색 선택기의 채도·명도 끌기 — 모듈 분리에서 옮길 포인터 상태 경계
// ---------------------------------------------------------------------------

describe('<slip-designer> 색 선택기 끌기', () => {
  const s = strings.designer;

  /**
   * 채도·명도 영역에 포인터 사건을 보낸다.
   * happy-dom의 `getBoundingClientRect`는 0을 돌려주므로 너비·높이가 1로 취급되어
   * clientX·clientY가 그대로 0~1 비율이 된다.
   */
  function svPointer(el: Element, type: string, x: number, y: number): void {
    const area = el.shadowRoot!.querySelector('.sv-area') as HTMLElement;
    area.dispatchEvent(new PointerEvent(type, {
      bubbles: true, composed: true, clientX: x, clientY: y, pointerId: 1,
    }));
  }

  function colorOf(el: Element): string | undefined {
    const text = (el as unknown as { _file: SlipTemplateFile })._file
      .template.pages[0]!.elements[0]! as Record<string, unknown>;
    return text.backgroundColor as string | undefined;
  }

  async function openPicker(): Promise<Designer> {
    parseSlipFileMock.mockReturnValue(makeTemplateFile() as unknown as SlipFile);
    const el = await loadDesigner();
    selectElement(el, 'txt-1');
    await el.updateComplete;
    const button = Array.from(el.shadowRoot!.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === s.backgroundColor) as HTMLButtonElement;
    button.click();
    await el.updateComplete;

    const hue = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === `${s.backgroundColor} ${s.hue}`)!;
    hue.value = '120';
    hue.dispatchEvent(new Event('input', { bubbles: true }));
    hue.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    return el;
  }

  it('채도·명도 영역을 끌어 놓으면 그 위치의 색이 저장된다', async () => {
    const el = await openPicker();
    expect(colorOf(el)).toBe('#00ff00');

    svPointer(el, 'pointerdown', 0.2, 0.9);
    svPointer(el, 'pointermove', 0.5, 0.25);
    svPointer(el, 'pointerup', 0.5, 0.25);
    await el.updateComplete;

    // 채도 0.5, 명도 0.75 (y는 위가 명도 1이라 뒤집힌다)
    expect(colorOf(el)).toBe('#60bf60');
    el.remove();
  });

  it('끌기 중에는 표시만 따라 움직이고, 손을 뗄 때 한 번만 저장한다', async () => {
    const el = await openPicker();

    svPointer(el, 'pointerdown', 0, 1);
    svPointer(el, 'pointermove', 0.5, 0.25);
    await el.updateComplete;
    // 아직 손을 떼지 않았으므로 저장된 색은 그대로다.
    expect(colorOf(el)).toBe('#00ff00');

    const thumb = el.shadowRoot!.querySelector('.sv-thumb') as HTMLElement;
    expect(thumb.getAttribute('style')).toContain('left:50.0%');
    expect(thumb.getAttribute('style')).toContain('top:25.0%');
    el.remove();
  });

  it('끌기를 취소하면 이후 움직임은 무시한다', async () => {
    const el = await openPicker();

    svPointer(el, 'pointerdown', 0.5, 0.25);
    svPointer(el, 'pointercancel', 0.5, 0.25);
    svPointer(el, 'pointermove', 0.9, 0.9);
    svPointer(el, 'pointerup', 0.9, 0.9);
    await el.updateComplete;

    // 취소 뒤에는 pointerup도 저장하지 않는다.
    expect(colorOf(el)).toBe('#00ff00');
    const thumb = el.shadowRoot!.querySelector('.sv-thumb') as HTMLElement;
    expect(thumb.getAttribute('style')).toContain('left:50.0%');
    el.remove();
  });
});
