// @vitest-environment happy-dom
/**
 * `<slip-form>`의 값 형식 검사, 이미지 선택 검사, `reset()`, 로케일 변경과 재연결 테스트.
 *
 * PDF 렌더링만 모의하고 파싱과 수식에는 core의 실제 구현을 사용합니다.
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
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { SlipForm } from '../src/slip-form.js';
import { formStyles } from '../src/styles/slip-form.styles.js';
import { getStrings } from '../src/strings.js';

// 기본 영어 문구를 기준으로 화면을 확인합니다.
const strings = getStrings();

const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);
const DUMMY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

if (!customElements.get('slip-form')) {
  customElements.define('slip-form', SlipForm);
}

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 형식이 다른 파라미터를 고루 가진 양식. 그리드가 참조하지 않는 목록 파라미터를 포함합니다. */
function makeTypedTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '형식 양식' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [{
        elements: [{
          type: 'field', id: 'f-phone', name: '전화 필드',
          position: { x: 15, y: 20 }, width: 60, height: 8, parameter: 'phone',
        }],
      }],
      assets: [],
      parameters: [
        { key: 'phone', label: '전화' },
        { key: 'qty', label: '수량', valueType: 'number' },
        { key: 'when', label: '날짜', valueType: 'date' },
        { key: 'agreed', label: '동의', valueType: 'boolean' },
        { key: 'stamp', label: '도장', valueType: 'image' },
        {
          key: 'tags', label: '태그', valueType: 'list',
          fields: [{ key: 'name', label: '이름' }, { key: 'score', label: '점수', valueType: 'number' }],
        },
      ],
    },
  };
}

function typedVoucher(values: SlipVoucherFile['values'], issued = false): SlipVoucherFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'voucher',
    templateSnapshot: makeTypedTemplate().template,
    values,
    issued,
  };
}

beforeEach(() => {
  let counter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++counter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  renderSlipToPdfMock.mockReset();
  renderSlipToPdfMock.mockResolvedValue(DUMMY_PDF);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('조건을 기다리다 시간이 초과되었습니다');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function mount(file: SlipTemplateFile | SlipVoucherFile = makeTypedTemplate()): Promise<SlipForm> {
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

function setChecked(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** `slip-change`로 받은 마지막 전표를 돌려주는 함수를 만듭니다. */
function lastChange(el: SlipForm): () => SlipVoucherFile | undefined {
  const changes: SlipVoucherFile[] = [];
  el.addEventListener('slip-change', (e) => {
    changes.push((e as CustomEvent<{ file: SlipVoucherFile }>).detail.file);
  });
  return () => changes.at(-1);
}

function hintTexts(el: SlipForm): string[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.hint.error')).map((h) => h.textContent?.trim() ?? '');
}

function noticeText(el: SlipForm): string {
  return el.shadowRoot?.querySelector('.notice.error')?.textContent ?? '';
}

// ---------------------------------------------------------------------------
// 값 형식별 입력과 발행 전 검사
// ---------------------------------------------------------------------------

describe('<slip-form> 값 형식', () => {
  it('문자 파라미터는 선행 0과 20자리 숫자 문자열을 그대로 보존한다', async () => {
    const el = await mount();
    const last = lastChange(el);
    setInput(inputByLabel(el, '전화'), '01012345678');
    await el.updateComplete;
    expect(last()!.values.phone).toBe('01012345678');
    setInput(inputByLabel(el, '전화'), '12345678901234567890');
    await el.updateComplete;
    expect(last()!.values.phone).toBe('12345678901234567890');
    expect(inputByLabel(el, '전화').value).toBe('12345678901234567890');
    el.remove();
  });

  it('형식마다 맞는 입력 컨트롤을 쓴다', async () => {
    const el = await mount();
    expect(inputByLabel(el, '전화').type).toBe('text');
    expect(inputByLabel(el, '수량').type).toBe('number');
    expect(inputByLabel(el, '날짜').type).toBe('date');
    expect(inputByLabel(el, '동의').type).toBe('checkbox');
    expect(buttonByLabel(el, `도장 ${strings.form.imageUpload}`)).toBeTruthy();
    expect(buttonByLabel(el, `태그 ${strings.form.addRow}`)).toBeTruthy();
    el.remove();
  });

  it('숫자 파라미터만 수로 바꾸고 날짜·불리언은 형식대로 저장한다', async () => {
    const el = await mount();
    const last = lastChange(el);
    setInput(inputByLabel(el, '수량'), '12.5');
    await el.updateComplete;
    expect(last()!.values.qty).toBe(12.5);
    setInput(inputByLabel(el, '날짜'), '2026-08-20');
    await el.updateComplete;
    expect(last()!.values.when).toBe('2026-08-20');
    setChecked(inputByLabel(el, '동의'), true);
    await el.updateComplete;
    expect(last()!.values.agreed).toBe(true);
    setChecked(inputByLabel(el, '동의'), false);
    await el.updateComplete;
    expect(last()!.values.agreed).toBe(false);
    el.remove();
  });

  it('형식에 맞지 않는 값은 입력 아래에 문구를 보이고 발행을 막는다', async () => {
    const el = await mount(typedVoucher({
      qty: 'abc',
      when: 'yesterday',
      agreed: 'yes',
      stamp: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      tags: [{ name: 'a', score: 'x' }],
    }));
    expect(hintTexts(el)).toEqual([
      strings.form.invalidNumber,
      strings.form.invalidDate,
      strings.form.invalidBoolean,
      strings.form.invalidImage,
      strings.form.invalidList,
    ]);
    expect(inputByLabel(el, '수량').getAttribute('aria-invalid')).toBe('true');

    const issued: SlipVoucherFile[] = [];
    el.addEventListener('slip-issue', (e) => issued.push((e as CustomEvent).detail.file));
    buttonByLabel(el, strings.form.issue).click();
    await el.updateComplete;
    await flush();
    expect(issued.length).toBe(0);
    expect(noticeText(el)).toContain(strings.form.issueInvalid);
    expect(inputByLabel(el, '전화').disabled).toBe(false);
    el.remove();
  });

  it('형식 오류 문구는 로케일에 따라 세 언어로 표시된다', async () => {
    const el = await mount(typedVoucher({ qty: 'abc' }));
    buttonByLabel(el, strings.form.issue).click();
    await el.updateComplete;
    for (const locale of ['ko', 'en', 'ja'] as const) {
      el.locale = locale;
      await el.updateComplete;
      const t = getStrings(locale).form;
      expect(hintTexts(el)).toEqual([t.invalidNumber]);
      expect(noticeText(el)).toContain(t.issueInvalid);
    }
    el.remove();
  });

  it('값을 고치면 형식 문구가 사라지고 발행할 수 있다', async () => {
    const el = await mount(typedVoucher({ qty: 'abc' }));
    const issued: SlipVoucherFile[] = [];
    el.addEventListener('slip-issue', (e) => issued.push((e as CustomEvent).detail.file));
    setInput(inputByLabel(el, '수량'), '3');
    await el.updateComplete;
    expect(hintTexts(el)).toEqual([]);
    buttonByLabel(el, strings.form.issue).click();
    await waitFor(() => issued.length > 0);
    expect(issued[0]!.values.qty).toBe(3);
    el.remove();
  });

  it('그리드가 참조하지 않는 목록 파라미터도 하위 필드대로 행을 추가·수정·삭제한다', async () => {
    const el = await mount();
    const last = lastChange(el);
    const titles = () => Array.from(el.shadowRoot!.querySelectorAll('.col-title')).map((s) => s.textContent);
    expect(titles()).toEqual(['이름', '점수']);

    buttonByLabel(el, `태그 ${strings.form.addRow}`).click();
    await el.updateComplete;
    setInput(inputByLabel(el, '태그 1 이름'), '007');
    await el.updateComplete;
    expect(inputByLabel(el, '태그 1 점수').type).toBe('number');
    setInput(inputByLabel(el, '태그 1 점수'), '42');
    await el.updateComplete;
    expect(last()!.values.tags).toEqual([{ name: '007', score: 42 }]);

    buttonByLabel(el, `태그 ${strings.form.addRow}`).click();
    await el.updateComplete;
    setInput(inputByLabel(el, '태그 2 이름'), 'b');
    await el.updateComplete;
    setInput(inputByLabel(el, '태그 1 점수'), '7');
    await el.updateComplete;
    expect(last()!.values.tags).toEqual([{ name: '007', score: 7 }, { name: 'b' }]);

    buttonByLabel(el, `태그 1 ${strings.form.deleteRow}`).click();
    await el.updateComplete;
    expect(last()!.values.tags).toEqual([{ name: 'b' }]);
    el.remove();
  });

  it('파라미터에 없는 값 키는 편집·입력 지우기 뒤에도 보존한다', async () => {
    const el = await mount(typedVoucher({ ghost: { deep: [1, 2] }, phone: '010' }));
    const last = lastChange(el);
    setInput(inputByLabel(el, '전화'), '011');
    await el.updateComplete;
    expect(last()!.values).toMatchObject({ ghost: { deep: [1, 2] }, phone: '011' });
    buttonByLabel(el, strings.form.reset).click();
    await el.updateComplete;
    expect(last()!.values.phone).toBeUndefined();
    expect(last()!.values.ghost).toEqual({ deep: [1, 2] });
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 이미지 선택
// ---------------------------------------------------------------------------

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

const PNG_BYTES = base64Bytes(SAMPLE_PNG.split(',')[1]!);
const GIF_BYTES = new Uint8Array(new TextEncoder().encode('GIF89a-not-a-png'));

/** 이미지 선택 버튼을 누르고 파일 선택을 흉내 냅니다. */
async function pickFile(el: SlipForm, file: File): Promise<void> {
  let captured: HTMLInputElement | null = null;
  const original = document.createElement.bind(document);
  const created = vi.spyOn(document, 'createElement').mockImplementation(
    (tag: string, options?: ElementCreationOptions) => {
      const node = original(tag, options);
      if (tag === 'input') captured = node as HTMLInputElement;
      return node;
    },
  );
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  buttonByLabel(el, `도장 ${strings.form.imageUpload}`).click();
  await flush();
  created.mockRestore();
  click.mockRestore();
  const input = captured as HTMLInputElement | null;
  if (!input) throw new Error('파일 입력이 만들어지지 않았습니다');
  expect(input.accept).toBe('image/png,image/jpeg');
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await flush();
  await flush();
  await el.updateComplete;
}

describe('<slip-form> 이미지 선택 검사', () => {
  it('PNG 파일은 내용을 확인해 data: 값으로 저장한다', async () => {
    const el = await mount();
    const last = lastChange(el);
    await pickFile(el, new File([PNG_BYTES], 'stamp.png', { type: 'image/png' }));
    expect(last()!.values.stamp).toBe(SAMPLE_PNG);
    expect(noticeText(el)).toBe('');
    el.remove();
  });

  it('GIF와 PNG로 위장한 파일은 notImage로 거부한다', async () => {
    const el = await mount();
    const last = lastChange(el);
    await pickFile(el, new File([GIF_BYTES], 'anim.gif', { type: 'image/gif' }));
    expect(last()).toBeUndefined();
    expect(noticeText(el)).toContain(strings.form.imageUnsupported);

    await pickFile(el, new File([GIF_BYTES], 'fake.png', { type: 'image/png' }));
    expect(last()).toBeUndefined();
    expect(noticeText(el)).toContain(strings.form.imageUnsupported);
    el.remove();
  });

  it('상한을 넘는 파일은 tooLarge로 거부하고 크기를 문구에 넣는다', async () => {
    const el = await mount();
    el.maxImageBytes = 10;
    const last = lastChange(el);
    await pickFile(el, new File([PNG_BYTES], 'big.png', { type: 'image/png' }));
    expect(last()).toBeUndefined();
    expect(noticeText(el)).toContain('10B');
    expect(noticeText(el)).toContain(`${PNG_BYTES.length}B`);
    el.remove();
  });

  it('파일을 읽지 못하면 readFailed 문구를 보이고 로케일을 바꾸면 그 언어로 바뀐다', async () => {
    const el = await mount();
    const broken = new File([PNG_BYTES], 'broken.png', { type: 'image/png' });
    Object.defineProperty(broken, 'arrayBuffer', { value: () => Promise.reject(new Error('read')) });
    await pickFile(el, broken);
    expect(noticeText(el)).toContain(strings.form.imageReadFailed);
    el.locale = 'ja';
    await el.updateComplete;
    expect(noticeText(el)).toContain(getStrings('ja').form.imageReadFailed);
    expect(noticeText(el)).not.toContain(strings.form.imageReadFailed);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('<slip-form> reset()', () => {
  it('발행 뒤 reset()하면 같은 양식의 빈 전표로 돌아가 다시 입력할 수 있다', async () => {
    const el = await mount();
    const last = lastChange(el);
    setInput(inputByLabel(el, '전화'), '010');
    await el.updateComplete;
    buttonByLabel(el, strings.form.issue).click();
    await waitFor(() => inputByLabel(el, '전화').disabled);

    el.reset();
    await el.updateComplete;
    expect(inputByLabel(el, '전화').disabled).toBe(false);
    expect(inputByLabel(el, '전화').value).toBe('');
    expect(el.shadowRoot?.textContent).not.toContain(strings.form.issuedNotice);
    const file = last()!;
    expect(file.issued).toBe(false);
    // 입력값은 모두 비어 있다 — 빈 number 파라미터만 buildVoucher가 0으로 정규화한다.
    expect(file.values).toEqual({ qty: 0 });

    setInput(inputByLabel(el, '전화'), '011');
    await el.updateComplete;
    expect(last()!.values.phone).toBe('011');
    el.remove();
  });

  it('발행된 전표를 src로 열었어도 reset()하면 새 전표를 시작한다', async () => {
    const el = await mount(typedVoucher({ phone: '010' }, true));
    expect(inputByLabel(el, '전화').disabled).toBe(true);
    el.reset();
    await el.updateComplete;
    expect(inputByLabel(el, '전화').disabled).toBe(false);
    expect(inputByLabel(el, '전화').value).toBe('');
    el.remove();
  });

  it('src가 없으면 reset()은 아무 이벤트도 내지 않는다', async () => {
    const el = document.createElement('slip-form') as SlipForm;
    document.body.appendChild(el);
    await el.updateComplete;
    const last = lastChange(el);
    el.reset();
    await el.updateComplete;
    expect(last()).toBeUndefined();
    expect(el.shadowRoot?.textContent).toContain(strings.form.noFile);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 로케일 변경 · 분리와 재연결
// ---------------------------------------------------------------------------

describe('<slip-form> 로케일 변경과 재연결', () => {
  it('locale이 바뀌면 미리보기를 다시 만든다', async () => {
    const el = await mount();
    await waitFor(() => el.shadowRoot?.querySelector('iframe') !== null);
    renderSlipToPdfMock.mockClear();
    el.locale = 'ja';
    await el.updateComplete;
    await waitFor(() => renderSlipToPdfMock.mock.calls.length > 0);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);
    expect(renderSlipToPdfMock.mock.calls[0]![1]?.locale).toBe('ja');
    el.remove();
  });

  it('분리 중 완료된 렌더 결과는 버리고 Blob URL을 만들지 않는다', async () => {
    let resolveRender!: (pdf: Uint8Array) => void;
    renderSlipToPdfMock.mockImplementation(
      () => new Promise<Uint8Array>((resolve) => { resolveRender = resolve; }),
    );
    const el = await mount();
    await waitFor(() => renderSlipToPdfMock.mock.calls.length > 0);
    const created = vi.mocked(URL.createObjectURL);
    created.mockClear();
    el.remove();
    resolveRender(DUMMY_PDF);
    await flush();
    expect(created).not.toHaveBeenCalled();
    expect(el.shadowRoot?.querySelector('iframe')).toBeNull();
  });

  it('다시 연결하면 현재 값으로 미리보기를 복구한다', async () => {
    const el = await mount();
    await waitFor(() => el.shadowRoot?.querySelector('iframe') !== null);
    el.remove();
    renderSlipToPdfMock.mockClear();
    document.body.appendChild(el);
    await waitFor(() => renderSlipToPdfMock.mock.calls.length > 0);
    await waitFor(() => el.shadowRoot?.querySelector('iframe') !== null);
    expect(renderSlipToPdfMock).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('갱신 중 상태 변경으로 Lit 경고를 내지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = await mount();
    el.locale = 'ko';
    await el.updateComplete;
    el.src = serializeSlipFile(typedVoucher({ phone: '1' }));
    await el.updateComplete;
    await flush();
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes('scheduled an update'))).toEqual([]);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// 목록 레이아웃 (브라우저 확인 필요 — 여기서는 스타일 규칙만 확인)
// ---------------------------------------------------------------------------

describe('<slip-form> 목록 레이아웃', () => {
  it('입력 pane 폭은 뷰포트 비율로 정하고 목록 열은 pane 폭을 나누어 채운다', async () => {
    const css = formStyles.cssText;
    expect(css).toContain('grid-template-columns: clamp(320px, 40%, 720px) 1fr');
    expect(css).toMatch(/\.row-grid\s*\{[^}]*width: 100%/);
    const el = await mount();
    const grid = el.shadowRoot?.querySelector('.row-grid') as HTMLElement;
    expect(grid.getAttribute('style')).toContain('repeat(2, minmax(56px, 1fr)) 22px');
    el.remove();
  });
});
