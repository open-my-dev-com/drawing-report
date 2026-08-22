// @vitest-environment happy-dom
/**
 * `<slip-form>` 전표 작성폼 테스트 (D-14).
 *
 * PDF 렌더만 모의하고 파싱·수식·무결성은 실제 core 구현을 쓴다 —
 * 발행 규칙·해시 기록이 실제로 지켜지는지 확인하기 위함.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@omdc-slipkit/core', async () => {
  const actual = await vi.importActual<typeof import('@omdc-slipkit/core')>('@omdc-slipkit/core');
  return { ...actual, renderSlipToPdf: vi.fn() };
});

vi.mock('../src/default-fonts.js', () => ({
  loadDefaultFonts: () =>
    Promise.resolve([{ name: 'Pretendard', data: new Uint8Array([1]), fallback: true }]),
}));

import {
  CURRENT_SCHEMA_VERSION,
  renderSlipToPdf,
  serializeSlipFile,
  verifyIntegrity,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { SlipForm } from '../src/slip-form.js';
import { strings } from '../src/strings.js';

const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);
const DUMMY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

if (!customElements.get('slip-form')) {
  customElements.define('slip-form', SlipForm);
}

function makeTemplate(withExternalImage = false): SlipTemplateFile {
  const elements: SlipTemplateFile['template']['pages'][number]['elements'] = [
    {
      type: 'field', id: 'f-date', name: '날짜 필드',
      position: { x: 15, y: 20 }, width: 60, height: 8, binding: 'tradeDate',
    },
    {
      type: 'grid', id: 't-items', name: '품목 표',
      position: { x: 15, y: 40 }, width: 180, height: 40,
      columns: [{ width: 108 }, { width: 72 }],
      rows: [{ height: 8 }, { height: 8 }],
      cells: [
        { row: 0, column: 0, content: '품명' },
        { row: 0, column: 1, content: '금액' },
        { row: 1, column: 0, binding: 'itemName' },
        { row: 1, column: 1, binding: 'amount' },
      ],
      repeat: { binding: 'items', fromRow: 1, toRow: 1, perPage: 4, repeatHeader: true },
    },
    {
      type: 'field', id: 'f-total', name: '합계 필드',
      position: { x: 140, y: 100 }, width: 55, height: 8,
      binding: 'totalAmount', formula: 'SUM(items.amount)',
    },
  ];
  if (withExternalImage) {
    elements.push({
      type: 'image', id: 'img-1', name: '로고',
      position: { x: 150, y: 15 }, width: 30, height: 12,
      src: 'https://example.com/logo.png',
    });
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '거래명세서' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [{ elements }],
      assets: [],
      bindings: [
        { key: 'tradeDate', label: '거래일자' },
        { key: 'items', label: '품목' },
        { key: 'totalAmount', label: '합계금액' },
        { key: 'memo', label: '비고' },
      ],
    },
  };
}

beforeEach(() => {
  let counter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++counter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  renderSlipToPdfMock.mockResolvedValue(DUMMY_PDF);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * 조건이 참이 될 때까지 기다린다 — 발행(해시 계산)·미리보기(디바운스)는 비동기라
 * 고정 시간 대기로는 부하가 걸린 실행에서 흔들린다.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('조건을 기다리다 시간이 초과되었습니다');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function mount(file: SlipTemplateFile | SlipVoucherFile = makeTemplate()): Promise<SlipForm> {
  const el = document.createElement('slip-form') as SlipForm;
  document.body.appendChild(el);
  el.src = serializeSlipFile(file);
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

function inputByLabel(el: SlipForm, label: string): HTMLInputElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('input'))
    .find((i) => i.getAttribute('aria-label') === label);
  if (!found) throw new Error(`입력을 찾지 못했습니다: ${label}`);
  return found;
}

function buttonByLabel(el: SlipForm, label: string): HTMLButtonElement {
  const found = Array.from(el.shadowRoot!.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
  if (!found) throw new Error(`버튼을 찾지 못했습니다: ${label}`);
  return found as HTMLButtonElement;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('<slip-form> 기본 상태', () => {
  it('src가 없으면 안내 문구를 표시한다', async () => {
    const el = document.createElement('slip-form') as SlipForm;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain(strings.form.noFile);
    el.remove();
  });

  it('잘못된 src는 파싱 오류를 표시한다', async () => {
    const el = document.createElement('slip-form') as SlipForm;
    document.body.appendChild(el);
    el.src = '{ 깨진 파일 }';
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain(strings.form.parseError);
    el.remove();
  });
});

describe('<slip-form> 입력 칸 구성', () => {
  it('바인딩마다 입력 칸을 만들고 논리명으로 보여준다 (정의부에만 있는 값 포함)', async () => {
    const el = await mount();
    expect(inputByLabel(el, '거래일자')).toBeTruthy();
    expect(inputByLabel(el, '비고')).toBeTruthy(); // 요소 없이 정의부에만 있는 바인딩
    // 반복 구간이 쓰는 값은 그리드 헤더에 적힌 이름으로 열이 나온다
    const titles = Array.from(el.shadowRoot!.querySelectorAll('.col-title')).map((s) => s.textContent);
    expect(titles).toEqual(['품명', '금액']);
    el.remove();
  });

  it('수식 필드는 입력받지 않고 계산 결과만 보여준다', async () => {
    const el = await mount();
    const computed = inputByLabel(el, `합계금액 (${strings.form.computed})`);
    expect(computed.disabled).toBe(true);
    el.remove();
  });
});

describe('<slip-form> 값 입력·행 편집', () => {
  it('값을 입력하면 작성 중 전표를 slip-change로 알린다 (숫자 표기는 수로)', async () => {
    const el = await mount();
    const changes: SlipVoucherFile[] = [];
    el.addEventListener('slip-change', (e) => {
      changes.push((e as CustomEvent<{ file: SlipVoucherFile }>).detail.file);
    });

    setInput(inputByLabel(el, '거래일자'), '2026-08-20');
    await el.updateComplete;
    setInput(inputByLabel(el, '비고'), '1200');
    await el.updateComplete;

    expect(changes.length).toBe(2);
    const last = changes.at(-1)!;
    expect(last.kind).toBe('voucher');
    expect(last.issued).toBe(false);
    expect(last.values.tradeDate).toBe('2026-08-20');
    expect(last.values.memo).toBe(1200);
    el.remove();
  });

  it('반복 구간이 쓰는 값은 행을 추가·편집·삭제할 수 있다', async () => {
    const el = await mount();
    const changes: SlipVoucherFile[] = [];
    el.addEventListener('slip-change', (e) => {
      changes.push((e as CustomEvent<{ file: SlipVoucherFile }>).detail.file);
    });

    buttonByLabel(el, `품목 ${strings.form.addRow}`).click();
    await el.updateComplete;
    setInput(inputByLabel(el, '품목 1 품명'), '노트');
    await el.updateComplete;
    setInput(inputByLabel(el, '품목 1 금액'), '3000');
    await el.updateComplete;

    expect(changes.at(-1)!.values.items).toEqual([{ itemName: '노트', amount: 3000 }]);

    buttonByLabel(el, `품목 1 ${strings.form.deleteRow}`).click();
    await el.updateComplete;
    expect(changes.at(-1)!.values.items).toBeUndefined();
    el.remove();
  });

  it('행 값이 바뀌면 수식 칸이 즉시 다시 계산된다', async () => {
    const el = await mount();
    const total = () => inputByLabel(el, `합계금액 (${strings.form.computed})`).value;
    expect(total()).toBe('0');

    buttonByLabel(el, `품목 ${strings.form.addRow}`).click();
    await el.updateComplete;
    setInput(inputByLabel(el, '품목 1 금액'), '3000');
    await el.updateComplete;
    expect(total()).toBe('3000');

    buttonByLabel(el, `품목 ${strings.form.addRow}`).click();
    await el.updateComplete;
    setInput(inputByLabel(el, '품목 2 금액'), '4500');
    await el.updateComplete;
    expect(total()).toBe('7500');
    el.remove();
  });

  it('입력 지우기는 값을 모두 비운다', async () => {
    const el = await mount();
    setInput(inputByLabel(el, '거래일자'), '2026-08-20');
    await el.updateComplete;
    buttonByLabel(el, strings.form.reset).click();
    await el.updateComplete;
    expect(inputByLabel(el, '거래일자').value).toBe('');
    el.remove();
  });
});

describe('<slip-form> 발행', () => {
  it('발행하면 해시를 기록한 전표를 slip-issue로 내보내고 폼이 잠긴다', async () => {
    const el = await mount();
    const issued: SlipVoucherFile[] = [];
    el.addEventListener('slip-issue', (e) => {
      issued.push((e as CustomEvent<{ file: SlipVoucherFile }>).detail.file);
    });

    setInput(inputByLabel(el, '거래일자'), '2026-08-20');
    await el.updateComplete;
    buttonByLabel(el, strings.form.issue).click();
    await waitFor(() => issued.length > 0);
    await el.updateComplete;

    expect(issued.length).toBe(1);
    const file = issued[0]!;
    expect(file.issued).toBe(true);
    expect(file.integrity?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(file.values.tradeDate).toBe('2026-08-20');
    // 기록된 해시는 실제로 검증을 통과한다 (SPEC §8)
    await expect(verifyIntegrity(file)).resolves.toBeUndefined();

    // 폼은 잠기고 발행 표시가 나온다
    expect(el.shadowRoot?.textContent).toContain(strings.form.issued);
    expect(inputByLabel(el, '거래일자').disabled).toBe(true);
    expect(el.shadowRoot?.textContent).toContain(strings.form.issuedNotice);
    el.remove();
  });

  it('발행 규칙을 어기면 오류를 표시하고 잠기지 않는다', async () => {
    const el = await mount(makeTemplate(true)); // 외부 URL 이미지 포함
    const issued: SlipVoucherFile[] = [];
    el.addEventListener('slip-issue', (e) => issued.push((e as CustomEvent).detail.file));

    buttonByLabel(el, strings.form.issue).click();
    await waitFor(() => el.shadowRoot?.textContent?.includes(strings.form.issueError) === true);
    await el.updateComplete;

    expect(issued.length).toBe(0);
    expect(el.shadowRoot?.textContent).toContain(strings.form.issueError);
    expect(inputByLabel(el, '거래일자').disabled).toBe(false);
    el.remove();
  });

  it('발행된 전표를 열면 처음부터 잠긴 상태로 보여준다', async () => {
    const template = makeTemplate();
    const el = await mount();
    setInput(inputByLabel(el, '거래일자'), '2026-08-20');
    await el.updateComplete;
    buttonByLabel(el, strings.form.issue).click();
    await waitFor(() => inputByLabel(el, '거래일자').disabled);
    await el.updateComplete;
    const issuedFile = (el as unknown as { _buildVoucher: (i: boolean) => SlipVoucherFile })
      ._buildVoucher(true);
    el.remove();

    expect(template.template.meta.title).toBe('거래명세서');
    const reopened = await mount(issuedFile);
    expect(inputByLabel(reopened, '거래일자').value).toBe('2026-08-20');
    expect(inputByLabel(reopened, '거래일자').disabled).toBe(true);
    reopened.remove();
  });
});

describe('<slip-form> 미리보기', () => {
  it('값 입력 뒤 전표 상태로 PDF를 렌더해 표시한다', async () => {
    const el = await mount();
    renderSlipToPdfMock.mockClear();
    setInput(inputByLabel(el, '거래일자'), '2026-08-20');
    await el.updateComplete;

    // 디바운스 뒤 한 번만 렌더된다
    await waitFor(() => renderSlipToPdfMock.mock.calls.length > 0);
    await waitFor(() => el.shadowRoot?.querySelector('iframe') !== null);
    await el.updateComplete;
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);
    const rendered = renderSlipToPdfMock.mock.calls[0]![0] as SlipVoucherFile;
    expect(rendered.kind).toBe('voucher');
    expect(rendered.values.tradeDate).toBe('2026-08-20');
    expect(el.shadowRoot?.querySelector('iframe')).not.toBeNull();
    el.remove();
  });
});

describe('<slip-form> UI 언어', () => {
  it('locale="en"이면 영어 문구로 표시된다', async () => {
    const el = document.createElement('slip-form') as SlipForm;
    el.locale = 'en';
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain('Load a template');
    el.remove();
  });
});

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 변동 이미지 요소가 있는 양식 (G-47) */
function makeImageTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '도장 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [{
        elements: [{
          type: 'image', id: 'img-stamp', name: '도장',
          position: { x: 150, y: 15 }, width: 30, height: 30, binding: 'stamp',
        }],
      }],
      assets: [],
      bindings: [{ key: 'stamp', label: '도장 이미지', valueType: 'image' }],
    },
  };
}

describe('<slip-form> 변동 이미지 (G-47)', () => {
  it('변동 이미지 바인딩에 이미지 업로드 입력을 낸다', async () => {
    const el = await mount(makeImageTemplate());
    // 텍스트 입력이 아니라 업로드 버튼과 "선택된 이미지 없음" 안내가 나온다
    const pick = buttonByLabel(el, `도장 이미지 ${strings.form.imageUpload}`);
    expect(pick).not.toBeNull();
    expect(el.shadowRoot?.textContent).toContain(strings.form.imageNone);
    // 이미지 바인딩에는 한 줄 텍스트 입력을 만들지 않는다
    const textInput = Array.from(el.shadowRoot!.querySelectorAll('input'))
      .find((i) => i.getAttribute('aria-label') === '도장 이미지');
    expect(textInput).toBeUndefined();
    el.remove();
  });

  it('이미지 값이 있으면 미리보기와 지우기 버튼을 보여준다', async () => {
    const voucher: SlipVoucherFile = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'voucher',
      templateSnapshot: makeImageTemplate().template,
      values: { stamp: SAMPLE_PNG },
      issued: false,
    };
    const el = await mount(voucher);
    const img = el.shadowRoot?.querySelector('.image-current img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe(SAMPLE_PNG);
    const clear = buttonByLabel(el, `도장 이미지 ${strings.form.imageClear}`);
    expect(clear).not.toBeNull();

    // 지우면 값이 빠지고 안내로 돌아간다
    clear.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.image-current')).toBeNull();
    expect(el.shadowRoot?.textContent).toContain(strings.form.imageNone);
    el.remove();
  });
});
