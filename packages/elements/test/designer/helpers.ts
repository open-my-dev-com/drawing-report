/**
 * 디자이너 테스트 공용 도우미.
 *
 * @remarks
 * `vi.mock`은 파일 단위로 끌어올려지므로 각 테스트 파일이 자기 파일 맨 위에서
 * `@omdc-slipkit/core`와 `../../src/default-fonts.js`를 모의한 뒤 이 모듈을 가져온다.
 * 이 모듈은 모의한 모듈을 참조하기만 한다.
 */
import { expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSlipFile, renderSlipToPdf } from '@omdc-slipkit/core';
import type { SlipFile, SlipTemplateFile } from '@omdc-slipkit/core';
import { getStrings } from '../../src/strings.js';

/** 기본 영어 문구. 화면 확인의 기준이다. */
export const strings = getStrings();

/** 렌더링 완료를 기다릴 수 있는 Lit 요소. */
export type LitHost = HTMLElement & { updateComplete: Promise<unknown> };

/** 테스트에서 다루는 디자이너 요소 타입. */
export type Designer = import('../../src/slip-designer.js').SlipDesigner;

export const PX_PER_MM = 96 / 25.4;

/** 렌더링에 사용할 더미 PDF 바이트. */
export const DUMMY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

export const parseSlipFileMock = vi.mocked(parseSlipFile);
export const renderSlipToPdfMock = vi.mocked(renderSlipToPdf);

let revoked: string[] = [];
let uuidCounter = 0;

/** 이번 테스트에서 해제한 오브젝트 URL 목록. */
export function revokedUrls(): string[] {
  return revoked;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

/** 텍스트와 사각형 요소를 하나씩 가진 기본 양식. */
export function makeTemplateFile(): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title: '테스트' },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] as [number, number, number, number] },
      pages: [{
        elements: [
          {
            type: 'text' as const,
            id: 'txt-1',
            name: 'test-text',
            position: { x: 30, y: 40 },
            width: 60,
            height: 10,
            content: '테스트 텍스트',
          },
          {
            type: 'rect' as const,
            id: 'shp-1',
            name: 'test-shape',
            position: { x: 100, y: 80 },
            width: 50,
            height: 30,
          },
        ],
      }],
      assets: [],
    },
  };
}

/**
 * 디자이너 테스트의 공통 환경을 설치한다.
 * 각 테스트 파일에서 최상위로 한 번 호출한다.
 */
export function installDesignerTestEnv(): void {
  beforeEach(() => {
    revoked = [];
    uuidCounter = 0;

    // Node.js 25의 불완전한 전역 localStorage 대신 격리된 브라우저형 저장소를 사용한다.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });

    let urlCounter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++urlCounter}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });

    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      return `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
    });

    parseSlipFileMock.mockReturnValue(makeTemplateFile() as unknown as SlipFile);
    renderSlipToPdfMock.mockResolvedValue(DUMMY_PDF);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

/** 디자이너 요소를 만들어 문서에 붙인다. */
export async function createElement(): Promise<Designer> {
  const { SlipDesigner } = await import('../../src/slip-designer.js');
  if (!customElements.get('slip-designer')) {
    customElements.define('slip-designer', SlipDesigner);
  }
  const el = document.createElement('slip-designer') as Designer;
  document.body.appendChild(el);
  return el;
}

/** 디자이너를 만들고 기본 양식을 불러온 상태로 만든다. */
export async function loadDesigner(): Promise<Designer> {
  const el = await createElement();
  el.src = '{"valid": true}';
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

/** 마이크로태스크 큐를 비운다. */
export function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** shadow root의 전체 텍스트. */
export function shadowText(el: Element): string {
  return el.shadowRoot?.textContent?.trim() ?? '';
}

/** 툴바에서 이름이 일치하는 버튼을 찾는다. */
export function toolbarButton(el: Element, label: string): HTMLButtonElement {
  return Array.from(el.shadowRoot?.querySelectorAll('.toolbar button') ?? [])
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label) as HTMLButtonElement;
}

/** 리스트형 선택 상자를 열고 data-value가 일치하는 항목을 고른다. */
export async function pickListValue(host: LitHost, trigger: HTMLElement, value: string): Promise<void> {
  trigger.click();
  await host.updateComplete;
  const option = host.shadowRoot!.querySelector(
    `.list-select-menu button[data-value="${value}"]`,
  ) as HTMLButtonElement | null;
  if (!option) throw new Error(`목록 항목을 찾지 못했습니다: ${value}`);
  option.click();
  await host.updateComplete;
}

/** 리스트형 선택 상자를 열어 항목 문구를 읽고 다시 닫는다. */
export async function listOptionLabels(host: LitHost, trigger: HTMLElement): Promise<string[]> {
  trigger.click();
  await host.updateComplete;
  const labels = Array.from(host.shadowRoot!.querySelectorAll('.list-select-menu button'))
    .map((b) => b.textContent?.trim() ?? '');
  (host.shadowRoot!.querySelector('.menu-backdrop') as HTMLElement).click();
  await host.updateComplete;
  return labels;
}

/**
 * 생성 도구를 선택하고 캔버스를 클릭해 요소를 만든다.
 * happy-dom의 `getBoundingClientRect`는 0을 반환하므로 좌표는 `clientX / PX_PER_MM`로 계산한다.
 */
export async function addByCanvasClick(
  el: Designer,
  label: string,
  clientX = 200,
  clientY = 200,
): Promise<void> {
  toolbarButton(el, label).click();
  await el.updateComplete;
  await clickCanvasAt(el, clientX, clientY);
}

/** 캔버스의 지정한 좌표를 클릭한다. */
export async function clickCanvasAt(
  el: Designer,
  clientX = 200,
  clientY = 200,
): Promise<void> {
  const paper = el.shadowRoot!.querySelector('.paper') as HTMLElement;
  paper.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, clientX, clientY, pointerId: 1,
  }));
  paper.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, composed: true, clientX, clientY, pointerId: 1,
  }));
  await el.updateComplete;
}

/** 도형 메뉴를 열고 요소 종류를 선택한다. */
export async function pickShapeTool(el: Designer, label: string): Promise<void> {
  toolbarButton(el, strings.designer.shape).click();
  await el.updateComplete;
  const item = Array.from(el.shadowRoot?.querySelectorAll('.preset-menu button') ?? [])
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  item.click();
  await el.updateComplete;
}

/**
 * 선 모양 미리보기 메뉴에서 테두리 형태를 선택한다.
 * ariaLabel은 버튼·메뉴를 구분하는 이름(요소용·셀용), shapeLabel은 실선·파선·점선 이름.
 */
export async function pickBorderShape(
  el: Designer,
  ariaLabel: string,
  shapeLabel: string,
): Promise<void> {
  const button = Array.from(el.shadowRoot!.querySelectorAll('.width-btn'))
    .find((b) => b.getAttribute('aria-label') === ariaLabel) as HTMLButtonElement;
  button.click();
  await el.updateComplete;
  const option = Array.from(el.shadowRoot!.querySelectorAll('.width-pop button'))
    .find((b) => b.getAttribute('aria-label') === `${ariaLabel}: ${shapeLabel}`) as HTMLButtonElement;
  option.click();
  await el.updateComplete;
}

/** 캔버스에서 id로 요소를 눌러 선택한다. */
export function selectElement(el: Element, id: string): HTMLElement {
  const div = el.shadowRoot?.querySelector(`[data-id="${id}"]`) as HTMLElement;
  div.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, clientX: 0, clientY: 0, pointerId: 1,
  }));
  div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
  return div;
}

/** 페이지 표시기의 문구. */
export function pageIndicator(el: Element): string {
  return el.shadowRoot?.querySelector('.page-indicator')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * 속성 패널 입력란을 원래 대상으로 삼는 키 이벤트를 만든다.
 * Shadow DOM 리타게팅 때문에 `composedPath`를 직접 지정한다.
 */
export function retargetedKey(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const input = el.shadowRoot?.querySelector('.prop-panel input') as HTMLInputElement;
  expect(input).not.toBeNull();
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  Object.defineProperty(event, 'composedPath', { value: () => [input] });
  return event;
}
