/**
 * SlipKit 데모 (바닐라) — 양식을 만들고, 전표를 쓰고, 파일로 주고받는 흐름을 그대로 보여준다.
 * 여기 있는 코드가 곧 호스트 앱이 SlipKit을 붙이는 방법의 예시다.
 *
 * 화면을 그리는 방법만 다르고 무엇을 저장하고 언제 이어 쓰는지는 React·Vue 데모와 같다 —
 * 그 공통 부분은 `slipkit-demo-shared`에 있다 (F-22).
 */
import '@omdc-slipkit/elements';
import { serializeSlipFile, type SlipFile, type SlipTemplateFile, type SlipVoucherFile } from '@omdc-slipkit/core';
import {
  AUTOSAVE_DELAY_MS,
  MODE_KEY,
  TEMPLATE_KEY,
  VOUCHER_KEY,
  canResumeVoucher,
  createStores,
  getMessages,
  initialTemplate,
  resolveDemoLocale,
  restore,
  savedLabel,
  suggestedName,
  templateFromVoucher,
} from 'slipkit-demo-shared';

// 데모 언어 — 주소의 ?locale= 값이 우선하고, 없으면 빌드 설정값을 쓴다
const locale = resolveDemoLocale(location.search, import.meta.env.VITE_SLIPKIT_LOCALE as string | undefined);
const messages = getMessages(locale);

const designer = document.getElementById('designer') as HTMLElement & { src: string; locale?: string };
const form = document.getElementById('form') as HTMLElement & { src: string; locale?: string };
const statusEl = document.getElementById('status')!;
const autosaveEl = document.getElementById('autosave')!;
const newSlipButton = document.getElementById('new-slip') as HTMLButtonElement;
const filenameDialog = document.getElementById('filename-dialog') as HTMLDialogElement;
const filenameInput = document.getElementById('filename') as HTMLInputElement;

const { store, localFile } = createStores('slipkit-demo', locale);

let template: SlipTemplateFile = initialTemplate(locale);
let voucher: SlipVoucherFile | null = null;
let filling = false;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function status(message: string): void {
  statusEl.textContent = message;
}

/** 지금 화면에서 다루고 있는 파일 — 내려받기 대상 */
function activeFile(): SlipFile {
  return filling && voucher ? voucher : template;
}

// ---------------------------------------------------------------------------
// 자동 저장 · 복원
// ---------------------------------------------------------------------------

function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void saveNow();
  }, AUTOSAVE_DELAY_MS);
}

async function saveNow(): Promise<void> {
  try {
    await store.save(TEMPLATE_KEY, template);
    if (voucher) await store.save(VOUCHER_KEY, voucher);
    // 저장 표시는 안내 문구와 따로 둔다 — 조작 안내가 저장 알림에 덮이지 않도록
    autosaveEl.textContent = savedLabel(new Date(), locale);
  } catch (error) {
    autosaveEl.textContent = '';
    status(messages.autosaveFailed(String(error)));
  }
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------

function setMode(fill: boolean, message?: string): void {
  filling = fill;
  designer.hidden = fill;
  form.hidden = !fill;
  newSlipButton.hidden = !fill;
  document.getElementById('mode-design')!.setAttribute('aria-pressed', String(!fill));
  document.getElementById('mode-fill')!.setAttribute('aria-pressed', String(fill));
  localStorage.setItem(MODE_KEY, fill ? 'fill' : 'design');

  if (fill) {
    const continuing = canResumeVoucher(voucher);
    if (!continuing) voucher = null;
    form.src = serializeSlipFile(continuing ? voucher! : template);
    status(message ?? (continuing ? messages.fillContinue : messages.fillNew));
  } else {
    status(message ?? messages.design);
  }
}

document.getElementById('mode-design')!.addEventListener('click', () => setMode(false));
document.getElementById('mode-fill')!.addEventListener('click', () => setMode(true));

newSlipButton.addEventListener('click', () => {
  voucher = null;
  void store.delete(VOUCHER_KEY).catch(() => undefined);
  setMode(true, messages.newSlip);
});

// ---------------------------------------------------------------------------
// 컴포넌트에서 오는 변경
// ---------------------------------------------------------------------------

designer.addEventListener('slip-change', (event) => {
  const file = (event as CustomEvent<{ file: SlipFile }>).detail.file;
  if (file.kind !== 'template') return;
  template = file;
  scheduleAutosave();
});

form.addEventListener('slip-change', (event) => {
  const file = (event as CustomEvent<{ file: SlipFile }>).detail.file;
  if (file.kind !== 'voucher') return;
  voucher = file;
  scheduleAutosave();
});

form.addEventListener('slip-issue', (event) => {
  const file = (event as CustomEvent<{ file: SlipFile }>).detail.file;
  if (file.kind !== 'voucher') return;
  voucher = file;
  void saveNow().then(() => {
    status(messages.issued);
  });
});

// ---------------------------------------------------------------------------
// 파일 주고받기
// ---------------------------------------------------------------------------

document.getElementById('download')!.addEventListener('click', () => {
  filenameInput.value = suggestedName(activeFile(), locale);
  filenameDialog.returnValue = 'cancel';
  filenameDialog.showModal();
  filenameInput.select();
});

filenameDialog.addEventListener('close', () => {
  if (filenameDialog.returnValue !== 'ok') return;
  const name = filenameInput.value.trim() || suggestedName(activeFile(), locale);
  localFile
    .save(name, activeFile())
    .then(() => status(messages.downloaded(name)))
    .catch((error: unknown) => status(messages.downloadFailed(String(error))));
});

document.getElementById('open')!.addEventListener('click', () => {
  localFile
    .load('')
    .then((file) => {
      if (file.kind === 'template') {
        template = file;
        voucher = null;
        designer.src = serializeSlipFile(file);
        setMode(false, messages.openedTemplate);
      } else {
        voucher = file;
        form.src = serializeSlipFile(file);
        // 전표에 담긴 양식 스냅샷을 그대로 편집용 양식으로도 쓴다
        template = templateFromVoucher(file);
        designer.src = serializeSlipFile(template);
        filling = true;
        setMode(true, file.issued ? messages.openedIssued : messages.openedVoucher);
      }
      void saveNow();
    })
    .catch((error: unknown) => status(messages.openFailed(String(error))));
});

// ---------------------------------------------------------------------------
// 시작 — 이전 작업이 있으면 그대로 이어서
// ---------------------------------------------------------------------------

/** 데모 화면의 고정 문구를 현재 언어로 채운다 */
function applyChromeText(): void {
  document.documentElement.lang = locale ?? 'en';
  document.title = messages.appTitle();
  document.querySelector('header .title')!.textContent = messages.appTitle();
  document.getElementById('mode-design')!.textContent = messages.buttonDesign;
  document.getElementById('mode-fill')!.textContent = messages.buttonFill;
  newSlipButton.textContent = messages.buttonNewSlip;
  document.getElementById('download')!.textContent = messages.buttonDownload;
  document.getElementById('open')!.textContent = messages.buttonOpen;
  filenameDialog.querySelector('h2')!.textContent = messages.buttonDownload;
  filenameDialog.querySelector('label')!.textContent = messages.filenameLabel;
  filenameDialog.querySelector('button[value="cancel"]')!.textContent = messages.cancel;
  filenameDialog.querySelector('button[value="ok"]')!.textContent = messages.download;
}

async function boot(): Promise<void> {
  applyChromeText();
  if (locale !== undefined) {
    designer.locale = locale;
    form.locale = locale;
  }
  // 디자이너의 "내 양식" 저장·목록도 같은 저장소를 쓴다
  (designer as unknown as { storage: typeof store }).storage = store;

  const savedTemplate = await restore(store, TEMPLATE_KEY);
  const savedVoucher = await restore(store, VOUCHER_KEY);
  const restored = savedTemplate?.kind === 'template';
  if (savedTemplate?.kind === 'template') template = savedTemplate;
  if (savedVoucher?.kind === 'voucher') voucher = savedVoucher;

  designer.src = serializeSlipFile(template);
  const fill = localStorage.getItem(MODE_KEY) === 'fill';
  setMode(fill, restored ? messages.restored : messages.welcome);
}

void boot();
