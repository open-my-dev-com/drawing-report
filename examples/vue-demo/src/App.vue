<script setup lang="ts">
/**
 * SlipKit Vue 데모 — 양식을 만들고, 전표를 쓰고, 발행된 전표를 확인하고, 파일로 주고받는
 * 흐름을 그대로 보여준다. 호스트 앱이 `@omdc-slipkit/vue` 래퍼를 어떻게 붙이는지 보여준다.
 *
 * 화면을 그리는 방법만 다르고 무엇을 저장하고 언제 이어 쓰는지는 바닐라·React 데모와 같다 —
 * 그 공통 부분은 `slipkit-demo-shared`에 있다 (F-22).
 */
import { onMounted, ref, shallowRef } from 'vue';
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/vue';
import {
  buildVoucher,
  createSlipKit,
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import { loadDefaultFonts, type SlipDesignerSettings } from '@omdc-slipkit/elements';
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
document.documentElement.lang = locale ?? 'en';
document.title = messages.appTitle('Vue');

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

// 공개된 샘플 키를 쓰는 동안에만 화면에 키 경고를 띄운다
const sampleKey = usesDemoSampleKey(import.meta.env.VITE_SLIPKIT_KEY as string | undefined);

const { store, files } = createStores(slipKit, 'slipkit-demo-vue');
const storageQueue = createDemoStorageQueue(store);

// 파일 객체는 통째로 갈아 끼우므로 깊은 반응성이 필요 없다
const template = shallowRef<SlipTemplateFile>(initialTemplate(locale));
const voucher = shallowRef<SlipVoucherFile | null>(null);
const issued = shallowRef<SlipVoucherFile | null>(null);
const mode = ref<DemoMode>('design');
const status = ref<string>(messages.welcome);
const autosave = ref('');
const formSrc = ref('');
// 새 전표마다 올려 SlipForm을 다시 마운트하는 세션 번호
const formSession = ref(0);
const viewerSrc = ref('');

// 디자이너에 넣는 시작 입력 — 편집 중에는 바꾸지 않고, 외부 양식을 명시적으로 열 때만 갱신한다
const designerSrc = ref(serializeSlipFile(template.value));

const dialog = ref<HTMLDialogElement | null>(null);
const clearDialog = ref<HTMLDialogElement | null>(null);
const filename = ref<HTMLInputElement | null>(null);
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** 자동 저장 정리 작업의 실패도 자동 저장 실패와 같은 수준으로 알린다 */
function reportStorageFailure(error: unknown): void {
  status.value = messages.autosaveFailed(reasonOf(error));
}

async function saveNow(): Promise<void> {
  try {
    await storageQueue.save([
      [TEMPLATE_KEY, template.value],
      ...(voucher.value ? [[VOUCHER_KEY, voucher.value] as const] : []),
    ]);
    autosave.value = savedLabel(new Date(), locale);
  } catch (error) {
    autosave.value = '';
    status.value = messages.autosaveFailed(reasonOf(error));
  }
}

function scheduleAutosave(): void {
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

/** 화면 전환 — 양식 편집 · 전표 작성 · 발행 전표 조회 */
function setMode(next: DemoMode, message?: string): void {
  // 발행된 전표가 없으면 조회 화면을 열 수 없다.
  if (next === 'view' && !issued.value) next = 'design';
  mode.value = next;
  localStorage.setItem(MODE_KEY, next);

  if (next === 'fill') {
    const continuing = canResumeVoucher(voucher.value);
    // 이어 쓸 전표가 없으면 buildVoucher로 양식에서 빈 전표를 만들어 시작한다.
    if (!continuing) {
      voucher.value = buildVoucher(template.value, {});
      // 새 전표는 SlipForm을 다시 마운트해 시작한다 — 같은 양식이면 src가 그대로라 발행 상태가 풀리지 않는다.
      formSession.value += 1;
    }
    formSrc.value = serializeSlipFile(voucher.value!);
    status.value = message ?? (continuing ? messages.fillContinue : messages.fillNew);
  } else if (next === 'view') {
    viewerSrc.value = serializeSlipFile(issued.value!);
    status.value = message ?? messages.viewing;
  } else {
    status.value = message ?? messages.design;
  }
}

/** 지금 화면에서 다루고 있는 파일 — 내려받기 대상 */
function activeFile(): SlipFile {
  if (mode.value === 'view' && issued.value) return issued.value;
  if (mode.value === 'fill' && voucher.value) return voucher.value;
  return template.value;
}

function onDesignerChange(file: SlipFile): void {
  if (file.kind !== 'template') return;
  template.value = file;
  scheduleAutosave();
}

function onFormChange(file: SlipFile): void {
  if (file.kind !== 'voucher') return;
  voucher.value = file;
  scheduleAutosave();
}

function onFormIssue(file: SlipFile): void {
  if (file.kind !== 'voucher') return;
  // 발행된 전표는 작성 대상에서 내리고 조회 화면으로 넘긴다.
  voucher.value = null;
  issued.value = file;
  void storageQueue.save([[ISSUED_KEY, file]]).catch(reportStorageFailure);
  void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
  setMode('view', messages.issued);
}

function newSlip(): void {
  voucher.value = null;
  void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
  setMode('fill', messages.newSlip);
}

function openClearDialog(): void {
  if (!clearDialog.value) return;
  clearDialog.value.returnValue = 'cancel';
  clearDialog.value.showModal();
}

/** 지운 뒤 처음 상태로 되돌린다 — 화면을 내렸다 다시 올리므로 자동 저장이 새로 예약되지 않는다 */
function resetToInitial(): void {
  template.value = initialTemplate(locale);
  voucher.value = null;
  issued.value = null;
  designerSrc.value = serializeSlipFile(template.value);
  // 작성·조회 화면을 내려 이전 전표를 남기지 않는다. 다음에 열 때 빈 전표로 다시 만든다.
  formSrc.value = '';
  viewerSrc.value = '';
  formSession.value += 1;
  autosave.value = '';
  // 방금 지운 화면 기억(localStorage)을 다시 쓰지 않도록 setMode를 거치지 않는다.
  mode.value = 'design';
  status.value = messages.cleared;
}

async function clearStorage(): Promise<void> {
  // 예약된 저장이 남아 있으면 지운 직후 다시 저장된다 — 먼저 취소한다.
  cancelAutosave();
  try {
    await storageQueue.clear();
  } catch (error) {
    status.value = messages.clearFailed(reasonOf(error));
    return;
  }
  resetToInitial();
}

function onClearDialogClose(): void {
  // 취소하면 저장된 내용을 그대로 둔다.
  if (clearDialog.value?.returnValue !== 'ok') return;
  void clearStorage();
}

function openDownloadDialog(): void {
  if (filename.value) filename.value.value = suggestedName(activeFile(), locale);
  if (!dialog.value) return;
  dialog.value.returnValue = 'cancel';
  dialog.value.showModal();
  filename.value?.select();
}

function onDialogClose(): void {
  if (dialog.value?.returnValue !== 'ok') return;
  const file = activeFile();
  const name = filename.value?.value.trim() || suggestedName(file, locale);
  files
    .download(name, file)
    .then(() => {
      status.value = messages.downloaded(name);
    })
    .catch((error: unknown) => {
      status.value = messages.downloadFailed(reasonOf(error));
    });
}

function downloadPdf(): void {
  const file = activeFile();
  const name = `${suggestedName(file, locale)}.pdf`;
  slipKit
    .render(file)
    .then((pdf) => {
      saveBytes(pdf, name, 'application/pdf');
      status.value = messages.pdfDownloaded(name);
    })
    .catch((error: unknown) => {
      status.value = messages.pdfFailed(reasonOf(error));
    });
}

function openFile(): void {
  files
    .open()
    .then((file) => {
      if (file.kind === 'template') {
        template.value = file;
        voucher.value = null;
        // 열기 전에 쓰던 전표 초안까지 지운다 — 남겨 두면 다음 실행에서 되살아난다.
        void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
        designerSrc.value = serializeSlipFile(file);
        setMode('design', messages.openedTemplate);
      } else if (file.issued) {
        issued.value = file;
        void storageQueue.save([[ISSUED_KEY, file]]).catch(reportStorageFailure);
        setMode('view', messages.openedIssued);
      } else {
        voucher.value = file;
        // 전표에 담긴 양식 스냅샷을 그대로 편집용 양식으로도 쓴다
        template.value = templateFromVoucher(file);
        designerSrc.value = serializeSlipFile(template.value);
        setMode('fill', messages.openedVoucher);
      }
      void saveNow();
    })
    .catch((error: unknown) => {
      // 파일 선택 취소는 오류가 아니므로 안내를 바꾸지 않는다.
      if (isCancelled(error)) return;
      status.value = messages.openFailed(reasonOf(error));
    });
}

// 시작 — 이전 작업이 있으면 그대로 이어서 연다
onMounted(async () => {
  const savedTemplate = await restore(store, TEMPLATE_KEY);
  const savedVoucher = await restore(store, VOUCHER_KEY);
  const savedIssued = await restore(store, ISSUED_KEY);
  const restored = savedTemplate?.kind === 'template';
  if (savedTemplate?.kind === 'template') {
    template.value = savedTemplate;
    designerSrc.value = serializeSlipFile(savedTemplate);
  }
  if (savedVoucher?.kind === 'voucher' && !savedVoucher.issued) voucher.value = savedVoucher;
  if (savedIssued?.kind === 'voucher' && savedIssued.issued) issued.value = savedIssued;
  setMode(asDemoMode(localStorage.getItem(MODE_KEY)), restored ? messages.restored : messages.welcome);
});
</script>

<template>
  <header>
    <span class="title">{{ messages.appTitle('Vue') }}</span>
    <button :aria-pressed="mode === 'design'" @click="setMode('design')">{{ messages.buttonDesign }}</button>
    <button :aria-pressed="mode === 'fill'" @click="setMode('fill')">{{ messages.buttonFill }}</button>
    <button v-show="issued !== null" :aria-pressed="mode === 'view'" @click="setMode('view')">
      {{ messages.buttonView }}
    </button>
    <button v-show="mode === 'fill'" @click="newSlip">{{ messages.buttonNewSlip }}</button>
    <span class="sep" />
    <button @click="openDownloadDialog">{{ messages.buttonDownload }}</button>
    <button @click="downloadPdf">{{ messages.buttonPdf }}</button>
    <button @click="openFile">{{ messages.buttonOpen }}</button>
    <span class="autosave">{{ autosave }}</span>
    <span class="status">{{ status }}</span>
  </header>

  <div class="notice">
    <span>{{ messages.storageNotice }}</span>
    <span v-if="sampleKey" class="warn">{{ messages.storageKeyWarning }}</span>
    <button @click="openClearDialog">{{ messages.buttonClearStorage }}</button>
  </div>

  <div class="pane" :hidden="mode !== 'design'">
    <!-- UI 언어와 렌더 설정은 slipkit이 공급한다 — 컴포넌트 locale은 다르게 표시할 때만 쓴다 -->
    <SlipDesigner
      :src="designerSrc"
      :slipkit="slipKit"
      :settings="designerSettings"
      :storage="store"
      @slip-change="onDesignerChange"
    />
  </div>
  <div class="pane" :hidden="mode !== 'fill'">
    <SlipForm
      v-if="formSrc !== ''"
      :key="formSession"
      :src="formSrc"
      :slipkit="slipKit"
      @slip-change="onFormChange"
      @slip-issue="onFormIssue"
    />
  </div>
  <div class="pane" :hidden="mode !== 'view'">
    <SlipViewer v-if="viewerSrc !== ''" :src="viewerSrc" :slipkit="slipKit" />
  </div>

  <dialog ref="dialog" @close="onDialogClose">
    <form method="dialog">
      <h2>{{ messages.buttonDownload }}</h2>
      <div class="body">
        <label for="filename">{{ messages.filenameLabel }}</label>
        <input id="filename" ref="filename" name="filename" autocomplete="off" />
      </div>
      <div class="foot">
        <button value="cancel">{{ messages.cancel }}</button>
        <button value="ok">{{ messages.download }}</button>
      </div>
    </form>
  </dialog>

  <dialog ref="clearDialog" @close="onClearDialogClose">
    <form method="dialog">
      <h2>{{ messages.clearConfirmTitle }}</h2>
      <div class="body">
        <p>{{ messages.clearConfirmBody }}</p>
      </div>
      <div class="foot">
        <button value="cancel">{{ messages.cancel }}</button>
        <button value="ok" class="danger">{{ messages.clearConfirmOk }}</button>
      </div>
    </form>
  </dialog>
</template>
