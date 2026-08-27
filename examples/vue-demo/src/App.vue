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
  createStores,
  getMessages,
  initialTemplate,
  isCancelled,
  reasonOf,
  resolveDemoLocale,
  restore,
  saveBytes,
  savedLabel,
  suggestedName,
  templateFromVoucher,
  type DemoMode,
} from 'slipkit-demo-shared';

// 데모 언어 — 주소의 ?locale= 값이 우선하고, 없으면 빌드 설정값을 쓴다
const locale = resolveDemoLocale(location.search, import.meta.env.VITE_SLIPKIT_LOCALE as string | undefined);
const messages = getMessages(locale);
// locale을 지정하지 않았을 때 컴포넌트 기본 언어를 그대로 두기 위한 조건부 prop
const localeProp = locale === undefined ? {} : { locale };
document.documentElement.lang = locale ?? 'en';
document.title = messages.appTitle('Vue');

// core 공통 설정 — PDF 내려받기에 사용한다. 동봉 폰트는 두 벌을 모두 등록하고
// 언어는 기본(fallback) 폰트만 결정한다.
const slipKit = createSlipKit({
  getFonts: () => loadDefaultFonts(locale?.toLowerCase().startsWith('ja') ? 'ja' : 'ko'),
  ...(locale === undefined ? {} : { locale }),
});

// 호스트가 용지 후보를 공급하는 예시 — 기본 용지 뒤에 추가로 표시된다.
// 폰트(getFonts)와 바코드 종류(getBarcodeKinds)도 같은 방식으로 공급할 수 있다.
const designerSettings: SlipDesignerSettings = {
  getPaperSizes: () => [{ name: 'Label 100x150', width: 100, height: 150 }],
};

const { store, localFile } = createStores('slipkit-demo-vue', locale);

// 파일 객체는 통째로 갈아 끼우므로 깊은 반응성이 필요 없다
const template = shallowRef<SlipTemplateFile>(initialTemplate(locale));
const voucher = shallowRef<SlipVoucherFile | null>(null);
const issued = shallowRef<SlipVoucherFile | null>(null);
const mode = ref<DemoMode>('design');
const status = ref<string>(messages.welcome);
const autosave = ref('');
const formSrc = ref('');
const viewerSrc = ref('');

// 디자이너에 넣는 시작 입력 — 편집 중에는 바꾸지 않고, 외부 양식을 명시적으로 열 때만 갱신한다
const designerSrc = ref(serializeSlipFile(template.value));

const dialog = ref<HTMLDialogElement | null>(null);
const filename = ref<HTMLInputElement | null>(null);
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveNow(): Promise<void> {
  try {
    await store.save(TEMPLATE_KEY, template.value);
    if (voucher.value) await store.save(VOUCHER_KEY, voucher.value);
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

/** 화면 전환 — 양식 편집 · 전표 작성 · 발행 전표 조회 */
function setMode(next: DemoMode, message?: string): void {
  // 발행된 전표가 없으면 조회 화면을 열 수 없다.
  if (next === 'view' && !issued.value) next = 'design';
  mode.value = next;
  localStorage.setItem(MODE_KEY, next);

  if (next === 'fill') {
    const continuing = canResumeVoucher(voucher.value);
    // 이어 쓸 전표가 없으면 buildVoucher로 양식에서 빈 전표를 만들어 시작한다.
    if (!continuing) voucher.value = buildVoucher(template.value, {});
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
  void store.save(ISSUED_KEY, file).catch(() => undefined);
  void store.delete(VOUCHER_KEY).catch(() => undefined);
  setMode('view', messages.issued);
}

function newSlip(): void {
  voucher.value = null;
  void store.delete(VOUCHER_KEY).catch(() => undefined);
  setMode('fill', messages.newSlip);
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
  localFile
    .save(name, file)
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
  localFile
    .load('')
    .then((file) => {
      if (file.kind === 'template') {
        template.value = file;
        voucher.value = null;
        designerSrc.value = serializeSlipFile(file);
        setMode('design', messages.openedTemplate);
      } else if (file.issued) {
        issued.value = file;
        void store.save(ISSUED_KEY, file).catch(() => undefined);
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

  <div class="pane" :hidden="mode !== 'design'">
    <SlipDesigner
      :src="designerSrc"
      v-bind="localeProp"
      :settings="designerSettings"
      :storage="store"
      @slip-change="onDesignerChange"
    />
  </div>
  <div class="pane" :hidden="mode !== 'fill'">
    <SlipForm
      v-if="formSrc !== ''"
      :src="formSrc"
      v-bind="localeProp"
      @slip-change="onFormChange"
      @slip-issue="onFormIssue"
    />
  </div>
  <div class="pane" :hidden="mode !== 'view'">
    <SlipViewer v-if="viewerSrc !== ''" :src="viewerSrc" v-bind="localeProp" />
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
</template>
