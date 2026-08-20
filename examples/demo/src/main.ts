/**
 * SlipKit 데모 — 양식을 만들고, 전표를 쓰고, 파일로 주고받는 흐름을 그대로 보여준다.
 * 여기 있는 코드가 곧 호스트 앱이 SlipKit을 붙이는 방법의 예시다.
 *
 * 편집 내용은 브라우저에 자동으로 저장되어 새로고침해도 이어서 작업할 수 있다.
 */
import { presets, IndexedDbStorage, LocalFileStorage } from '@omdc-slipkit/elements';
import {
  serializeSlipFile,
  SlipStorageError,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';

const designer = document.getElementById('designer') as HTMLElement & { src: string };
const form = document.getElementById('form') as HTMLElement & { src: string };
const statusEl = document.getElementById('status')!;
const autosaveEl = document.getElementById('autosave')!;
const newSlipButton = document.getElementById('new-slip') as HTMLButtonElement;
const filenameDialog = document.getElementById('filename-dialog') as HTMLDialogElement;
const filenameInput = document.getElementById('filename') as HTMLInputElement;

/** 자동 저장 키 — 양식과 작성 중 전표를 따로 보관한다 */
const TEMPLATE_KEY = 'autosave-template';
const VOUCHER_KEY = 'autosave-voucher';
/** 마지막으로 보던 화면 — 새로고침 후 같은 화면으로 돌아오기 위해 기억한다 */
const MODE_KEY = 'slipkit-demo-mode';
/** 자동 저장을 미루는 시간(ms) — 타자 중 매번 저장하지 않는다 */
const AUTOSAVE_DELAY_MS = 800;

const store = new IndexedDbStorage({ dbName: 'slipkit-demo' });
const localFile = new LocalFileStorage();

let template: SlipTemplateFile = presets[0]!.create();
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

/** 지금 파일의 이름 후보 — 양식 제목에서 따온다 */
function suggestedName(): string {
  const file = activeFile();
  const title = file.kind === 'template' ? file.template.meta.title : file.templateSnapshot.meta.title;
  return filling ? `${title} 전표` : title;
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
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    // 저장 표시는 안내 문구와 따로 둔다 — 조작 안내가 저장 알림에 덮이지 않도록
    autosaveEl.textContent = `자동 저장됨 (${now})`;
  } catch (error) {
    autosaveEl.textContent = '';
    status(`자동 저장하지 못했습니다: ${String(error)}`);
  }
}

/** 저장해 둔 파일을 조용히 읽어 온다 — 없으면 null */
async function restore(key: string): Promise<SlipFile | null> {
  try {
    return await store.load(key);
  } catch (error) {
    if (error instanceof SlipStorageError && error.code === 'not-found') return null;
    console.warn('[demo] 이전 작업을 읽지 못했습니다:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------

/** 작성 중 전표를 지금 양식으로 이어 쓸 수 있는지 — 양식이 바뀌었으면 새로 시작한다 */
function canContinueVoucher(): boolean {
  if (!voucher || voucher.issued) return false;
  return JSON.stringify(voucher.templateSnapshot) === JSON.stringify(template.template);
}

function setMode(fill: boolean, message?: string): void {
  filling = fill;
  designer.hidden = fill;
  form.hidden = !fill;
  newSlipButton.hidden = !fill;
  document.getElementById('mode-design')!.setAttribute('aria-pressed', String(!fill));
  document.getElementById('mode-fill')!.setAttribute('aria-pressed', String(fill));
  localStorage.setItem(MODE_KEY, fill ? 'fill' : 'design');

  if (fill) {
    const continuing = canContinueVoucher();
    if (!continuing) voucher = null;
    form.src = serializeSlipFile(continuing ? voucher! : template);
    status(
      message ??
        (continuing
          ? '쓰던 전표를 이어서 작성합니다'
          : '값을 채운 뒤 발행하면 나중에 내용이 바뀌지 않았는지 확인할 수 있는 표시가 함께 남습니다'),
    );
  } else {
    status(message ?? '양식을 고칩니다 — 바꾼 내용은 자동으로 저장됩니다');
  }
}

document.getElementById('mode-design')!.addEventListener('click', () => setMode(false));
document.getElementById('mode-fill')!.addEventListener('click', () => setMode(true));

newSlipButton.addEventListener('click', () => {
  voucher = null;
  void store.delete(VOUCHER_KEY).catch(() => undefined);
  setMode(true, '새 전표를 시작했습니다');
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
    status('전표를 발행했습니다 — 파일로 내려받아 보관하거나 그대로 보낼 수 있습니다');
  });
});

// ---------------------------------------------------------------------------
// 파일 주고받기
// ---------------------------------------------------------------------------

document.getElementById('download')!.addEventListener('click', () => {
  filenameInput.value = suggestedName();
  filenameDialog.returnValue = 'cancel';
  filenameDialog.showModal();
  filenameInput.select();
});

filenameDialog.addEventListener('close', () => {
  if (filenameDialog.returnValue !== 'ok') return;
  const name = filenameInput.value.trim() || suggestedName();
  localFile
    .save(name, activeFile())
    .then(() => status(`${name} 파일을 내려받았습니다`))
    .catch((error: unknown) => status(`내려받지 못했습니다: ${String(error)}`));
});

document.getElementById('open')!.addEventListener('click', () => {
  localFile
    .load('')
    .then((file) => {
      if (file.kind === 'template') {
        template = file;
        voucher = null;
        designer.src = serializeSlipFile(file);
        setMode(false, '양식 파일을 열었습니다');
      } else {
        voucher = file;
        form.src = serializeSlipFile(file);
        // 전표에 담긴 양식 스냅샷을 그대로 편집용 양식으로도 쓴다
        template = { schemaVersion: file.schemaVersion, kind: 'template', template: file.templateSnapshot };
        designer.src = serializeSlipFile(template);
        filling = true;
        setMode(true, file.issued ? '발행된 전표를 열었습니다 (고칠 수 없습니다)' : '쓰던 전표를 열었습니다');
      }
      void saveNow();
    })
    .catch((error: unknown) => status(`열지 못했습니다: ${String(error)}`));
});

// ---------------------------------------------------------------------------
// 시작 — 이전 작업이 있으면 그대로 이어서
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // 디자이너의 "내 양식" 저장·목록도 같은 저장소를 쓴다
  (designer as unknown as { storage: typeof store }).storage = store;

  const savedTemplate = await restore(TEMPLATE_KEY);
  const savedVoucher = await restore(VOUCHER_KEY);
  const restored = savedTemplate?.kind === 'template';
  if (savedTemplate?.kind === 'template') template = savedTemplate;
  if (savedVoucher?.kind === 'voucher') voucher = savedVoucher;

  designer.src = serializeSlipFile(template);
  const fill = localStorage.getItem(MODE_KEY) === 'fill';
  setMode(
    fill,
    restored
      ? '이전에 하던 작업을 이어서 엽니다'
      : '양식을 만들고, 전표 쓰기로 넘어가 값을 채워 보세요',
  );
}

void boot();
