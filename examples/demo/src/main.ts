/**
 * SlipKit 데모 (바닐라) — 양식을 만들고, 전표를 쓰고, 발행된 전표를 확인하고, 파일로 주고받는
 * 흐름을 그대로 보여준다. 여기 있는 코드가 곧 호스트 앱이 SlipKit을 붙이는 방법의 예시다.
 *
 * 화면을 그리는 방법만 다르고 무엇을 저장하고 언제 이어 쓰는지는 React·Vue 데모와 같다 —
 * 그 공통 부분은 `slipkit-demo-shared`에 있다 (F-22).
 */
import '@omdc-slipkit/elements';
import 'slipkit-demo-shared/demo.css';
import {
  buildVoucher,
  createSlipKit,
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import {
  loadDefaultFonts,
  type SlipDesigner,
  type SlipDesignerSettings,
  type SlipForm,
  type SlipViewer,
} from '@omdc-slipkit/elements';
import {
  AUTOSAVE_DELAY_MS,
  ISSUED_KEY,
  MODE_KEY,
  TEMPLATE_KEY,
  VOUCHER_KEY,
  asDemoMode,
  canResumeVoucher,
  createDemoStorageQueue,
  createStores,
  demoFontLocale,
  getMessages,
  initialTemplate,
  isCancelled,
  reasonOf,
  resolveDemoEncryption,
  resolveDemoLocale,
  restore,
  saveBytes,
  savedLabel,
  suggestedName,
  templateFromVoucher,
  usesDemoSampleKey,
  type DemoMode,
} from 'slipkit-demo-shared';

// 데모 언어 — 주소의 ?locale= 값이 우선하고, 없으면 빌드 설정값을 쓴다
const locale = resolveDemoLocale(location.search, import.meta.env.VITE_SLIPKIT_LOCALE as string | undefined);
const messages = getMessages(locale);

// 공통 설정은 여기 한 번만 적는다 — 컴포넌트, 자동 저장, 파일 주고받기, PDF 렌더링이
// 전부 이 인스턴스의 폰트·로케일·암호화 키를 사용한다.
// 암호화 키는 .env(VITE_SLIPKIT_KEY)에서 한 번 읽고, 없으면 데모 샘플 키를 명시적으로 쓴다.
const slipKit = createSlipKit({
  // 데모는 PDF 내려받기를 직접 렌더링하므로 동봉 기본 폰트를 명시적으로 공급한다.
  // 컴포넌트 미리보기는 이 설정이 없어도 같은 기본 폰트로 되돌아간다.
  getFonts: () => loadDefaultFonts(demoFontLocale(locale)),
  ...(locale === undefined ? {} : { locale }),
  encryption: resolveDemoEncryption(import.meta.env.VITE_SLIPKIT_KEY as string | undefined),
});

// 호스트가 용지 후보를 공급하는 예시 — 기본 용지 뒤에 추가로 표시된다.
// 바코드 종류(getBarcodeKinds)도 같은 방식으로 공급하고, 폰트는 위 createSlipKit의 getFonts로 공급한다.
const designerSettings: SlipDesignerSettings = {
  getPaperSizes: () => [{ name: 'Label 100x150', width: 100, height: 150 }],
};

const designer = document.querySelector<SlipDesigner>('#designer')!;
const form = document.querySelector<SlipForm>('#form')!;
const viewer = document.querySelector<SlipViewer>('#viewer')!;
const statusEl = document.getElementById('status')!;
const autosaveEl = document.getElementById('autosave')!;
const newSlipButton = document.getElementById('new-slip') as HTMLButtonElement;
const viewButton = document.getElementById('mode-view') as HTMLButtonElement;
const filenameDialog = document.getElementById('filename-dialog') as HTMLDialogElement;
const filenameInput = document.getElementById('filename') as HTMLInputElement;
const clearDialog = document.getElementById('clear-dialog') as HTMLDialogElement;

// 공개된 샘플 키를 쓰는 동안에만 화면에 키 경고를 띄운다
const sampleKey = usesDemoSampleKey(import.meta.env.VITE_SLIPKIT_KEY as string | undefined);

const { store, files } = createStores(slipKit, 'slipkit-demo');
const storageQueue = createDemoStorageQueue(store);

let template: SlipTemplateFile = initialTemplate(locale);
let voucher: SlipVoucherFile | null = null;
let issued: SlipVoucherFile | null = null;
let mode: DemoMode = 'design';
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
// 초기 상태로 되돌리는 동안 컴포넌트가 알리는 변경은 저장하지 않는다 — 방금 지운 데이터가 되살아난다
let restoring = false;

function status(message: string): void {
  statusEl.textContent = message;
}

/** 자동 저장 정리 작업의 실패도 자동 저장 실패와 같은 수준으로 알린다 */
function reportStorageFailure(error: unknown): void {
  status(messages.autosaveFailed(reasonOf(error)));
}

/** 지금 화면에서 다루고 있는 파일 — 내려받기 대상 */
function activeFile(): SlipFile {
  if (mode === 'view' && issued) return issued;
  if (mode === 'fill' && voucher) return voucher;
  return template;
}

// ---------------------------------------------------------------------------
// 자동 저장 · 복원
// ---------------------------------------------------------------------------

function scheduleAutosave(): void {
  if (restoring) return;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void saveNow();
  }, AUTOSAVE_DELAY_MS);
}

/** 예약해 둔 자동 저장을 취소한다 */
function cancelAutosave(): void {
  if (autosaveTimer === null) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

async function saveNow(): Promise<void> {
  try {
    await storageQueue.save([
      [TEMPLATE_KEY, template],
      ...(voucher ? [[VOUCHER_KEY, voucher] as const] : []),
    ]);
    // 저장 표시는 안내 문구와 따로 둔다 — 조작 안내가 저장 알림에 덮이지 않도록
    autosaveEl.textContent = savedLabel(new Date(), locale);
  } catch (error) {
    autosaveEl.textContent = '';
    status(messages.autosaveFailed(reasonOf(error)));
  }
}

// ---------------------------------------------------------------------------
// 화면 전환 — 양식 편집 · 전표 작성 · 발행 전표 조회
// ---------------------------------------------------------------------------

function setMode(next: DemoMode, message?: string, remember = true): void {
  // 발행된 전표가 없으면 조회 화면을 열 수 없다.
  if (next === 'view' && !issued) next = 'design';
  mode = next;
  designer.hidden = next !== 'design';
  form.hidden = next !== 'fill';
  viewer.hidden = next !== 'view';
  newSlipButton.hidden = next !== 'fill';
  viewButton.hidden = issued === null;
  document.getElementById('mode-design')!.setAttribute('aria-pressed', String(next === 'design'));
  document.getElementById('mode-fill')!.setAttribute('aria-pressed', String(next === 'fill'));
  viewButton.setAttribute('aria-pressed', String(next === 'view'));
  // 저장 데이터를 지운 직후에는 방금 지운 화면 기억을 다시 쓰지 않는다
  if (remember) localStorage.setItem(MODE_KEY, next);

  if (next === 'fill') {
    const continuing = canResumeVoucher(voucher);
    // 이어 쓸 전표가 없으면 buildVoucher로 양식에서 빈 전표를 만들어 시작한다.
    if (!continuing) voucher = buildVoucher(template, {});
    form.src = serializeSlipFile(voucher!);
    status(message ?? (continuing ? messages.fillContinue : messages.fillNew));
  } else if (next === 'view') {
    viewer.src = serializeSlipFile(issued!);
    status(message ?? messages.viewing);
  } else {
    status(message ?? messages.design);
  }
}

document.getElementById('mode-design')!.addEventListener('click', () => setMode('design'));
document.getElementById('mode-fill')!.addEventListener('click', () => setMode('fill'));
viewButton.addEventListener('click', () => setMode('view'));

newSlipButton.addEventListener('click', () => {
  voucher = null;
  void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
  setMode('fill', messages.newSlip);
  // 같은 양식이면 src 문자열이 그대로라 변경으로 잡히지 않는다 — 발행 상태를 풀고 빈 전표로 명시적으로 되돌린다.
  form.reset();
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
  // 발행된 전표는 작성 대상에서 내리고 조회 화면으로 넘긴다.
  voucher = null;
  issued = file;
  void storageQueue.save([[ISSUED_KEY, file]]).catch(reportStorageFailure);
  void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
  setMode('view', messages.issued);
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
  files
    .download(name, activeFile())
    .then(() => status(messages.downloaded(name)))
    .catch((error: unknown) => status(messages.downloadFailed(reasonOf(error))));
});

document.getElementById('download-pdf')!.addEventListener('click', () => {
  const file = activeFile();
  const name = `${suggestedName(file, locale)}.pdf`;
  slipKit
    .render(file)
    .then((pdf) => {
      saveBytes(pdf, name, 'application/pdf');
      status(messages.pdfDownloaded(name));
    })
    .catch((error: unknown) => status(messages.pdfFailed(reasonOf(error))));
});

document.getElementById('open')!.addEventListener('click', () => {
  files
    .open()
    .then((file) => {
      if (file.kind === 'template') {
        template = file;
        voucher = null;
        // 열기 전에 쓰던 전표 초안까지 지운다 — 남겨 두면 다음 실행에서 되살아난다.
        void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
        designer.src = serializeSlipFile(file);
        setMode('design', messages.openedTemplate);
      } else if (file.issued) {
        issued = file;
        void storageQueue.save([[ISSUED_KEY, file]]).catch(reportStorageFailure);
        setMode('view', messages.openedIssued);
      } else {
        voucher = file;
        // 전표에 담긴 양식 스냅샷을 그대로 편집용 양식으로도 쓴다
        template = templateFromVoucher(file);
        designer.src = serializeSlipFile(template);
        setMode('fill', messages.openedVoucher);
      }
      void saveNow();
    })
    .catch((error: unknown) => {
      // 파일 선택 취소는 오류가 아니므로 안내를 바꾸지 않는다.
      if (isCancelled(error)) return;
      status(messages.openFailed(reasonOf(error)));
    });
});

// ---------------------------------------------------------------------------
// 저장 데이터 삭제
// ---------------------------------------------------------------------------

/** 지운 뒤 처음 상태로 되돌린다 — 되돌리는 사이의 변경은 저장하지 않는다 */
function resetToInitial(): void {
  restoring = true;
  try {
    template = initialTemplate(locale);
    issued = null;
    designer.src = serializeSlipFile(template);
    form.src = serializeSlipFile(buildVoucher(template, {}));
    // 같은 양식이면 src 문자열이 그대로라 발행 상태가 풀리지 않는다 — 빈 전표로 명시적으로 되돌린다.
    form.reset();
    voucher = null;
    autosaveEl.textContent = '';
    setMode('design', messages.cleared, false);
  } finally {
    restoring = false;
  }
}

async function clearStorage(): Promise<void> {
  // 예약된 저장이 남아 있으면 지운 직후 다시 저장된다 — 먼저 취소한다.
  cancelAutosave();
  try {
    await storageQueue.clear();
  } catch (error) {
    status(messages.clearFailed(reasonOf(error)));
    return;
  }
  resetToInitial();
}

document.getElementById('clear-storage')!.addEventListener('click', () => {
  clearDialog.returnValue = 'cancel';
  clearDialog.showModal();
});

clearDialog.addEventListener('close', () => {
  // 취소하면 저장된 내용을 그대로 둔다.
  if (clearDialog.returnValue !== 'ok') return;
  void clearStorage();
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
  viewButton.textContent = messages.buttonView;
  newSlipButton.textContent = messages.buttonNewSlip;
  document.getElementById('download')!.textContent = messages.buttonDownload;
  document.getElementById('download-pdf')!.textContent = messages.buttonPdf;
  document.getElementById('open')!.textContent = messages.buttonOpen;
  document.getElementById('storage-notice')!.textContent = messages.storageNotice;
  const warningEl = document.getElementById('storage-warning')!;
  warningEl.textContent = sampleKey ? messages.storageKeyWarning : '';
  warningEl.hidden = !sampleKey;
  document.getElementById('clear-storage')!.textContent = messages.buttonClearStorage;
  filenameDialog.querySelector('h2')!.textContent = messages.buttonDownload;
  filenameDialog.querySelector('label')!.textContent = messages.filenameLabel;
  filenameDialog.querySelector('button[value="cancel"]')!.textContent = messages.cancel;
  filenameDialog.querySelector('button[value="ok"]')!.textContent = messages.download;
  clearDialog.querySelector('h2')!.textContent = messages.clearConfirmTitle;
  document.getElementById('clear-body')!.textContent = messages.clearConfirmBody;
  clearDialog.querySelector('button[value="cancel"]')!.textContent = messages.cancel;
  clearDialog.querySelector('button[value="ok"]')!.textContent = messages.clearConfirmOk;
}

async function boot(): Promise<void> {
  applyChromeText();
  // 세 컴포넌트가 같은 공통 설정 인스턴스로 UI 언어, 미리보기와 수식을 처리한다.
  // 컴포넌트 locale은 UI 언어를 인스턴스와 다르게 표시할 때만 지정한다.
  designer.slipkit = slipKit;
  form.slipkit = slipKit;
  viewer.slipkit = slipKit;
  designer.settings = designerSettings;
  // 디자이너의 "내 양식" 저장·목록도 같은 저장소를 쓴다
  designer.storage = store;

  const savedTemplate = await restore(store, TEMPLATE_KEY);
  const savedVoucher = await restore(store, VOUCHER_KEY);
  const savedIssued = await restore(store, ISSUED_KEY);
  const restored = savedTemplate?.kind === 'template';
  if (savedTemplate?.kind === 'template') template = savedTemplate;
  if (savedVoucher?.kind === 'voucher' && !savedVoucher.issued) voucher = savedVoucher;
  if (savedIssued?.kind === 'voucher' && savedIssued.issued) issued = savedIssued;

  designer.src = serializeSlipFile(template);
  setMode(asDemoMode(localStorage.getItem(MODE_KEY)), restored ? messages.restored : messages.welcome);
}

void boot();
