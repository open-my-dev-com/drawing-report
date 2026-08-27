<script setup lang="ts">
/**
 * SlipKit Vue 데모 — 양식을 만들고, 전표를 쓰고, 파일로 주고받는 흐름 (F-22).
 *
 * 호스트 앱이 `@omdc-slipkit/vue` 래퍼를 어떻게 붙이는지 보여준다.
 * 무엇을 저장하고 언제 이어 쓰는지는 바닐라·React 데모와 같은 `slipkit-demo-shared`를 쓴다.
 */
import { onMounted, ref, shallowRef } from 'vue';
import { SlipDesigner, SlipForm } from '@omdc-slipkit/vue';
import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
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
// locale을 지정하지 않았을 때 컴포넌트 기본 언어를 그대로 두기 위한 조건부 prop
const localeProp = locale === undefined ? {} : { locale };
document.documentElement.lang = locale ?? 'en';
document.title = messages.appTitle('Vue');

const { store, localFile } = createStores('slipkit-demo-vue', locale);

// 파일 객체는 통째로 갈아 끼우므로 깊은 반응성이 필요 없다
const template = shallowRef<SlipTemplateFile>(initialTemplate(locale));
const voucher = shallowRef<SlipVoucherFile | null>(null);
const filling = ref(false);
const status = ref<string>(messages.welcome);
const autosave = ref('');
const formSrc = ref('');

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
    status.value = messages.autosaveFailed(String(error));
  }
}

function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void saveNow();
  }, AUTOSAVE_DELAY_MS);
}

/** 화면 전환 — 전표 쓰기로 갈 때 이어 쓸지 새로 시작할지 정한다 */
function setMode(fill: boolean, message?: string): void {
  filling.value = fill;
  localStorage.setItem(MODE_KEY, fill ? 'fill' : 'design');
  if (!fill) {
    status.value = message ?? messages.design;
    return;
  }
  const continuing = canResumeVoucher(voucher.value);
  if (!continuing) voucher.value = null;
  formSrc.value = serializeSlipFile(continuing ? voucher.value! : template.value);
  status.value = message ?? (continuing ? messages.fillContinue : messages.fillNew);
}

/** 지금 화면에서 다루고 있는 파일 — 내려받기 대상 */
function activeFile(): SlipFile {
  return filling.value && voucher.value ? voucher.value : template.value;
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
  voucher.value = file;
  void saveNow().then(() => {
    status.value = messages.issued;
  });
}

function newSlip(): void {
  voucher.value = null;
  void store.delete(VOUCHER_KEY).catch(() => undefined);
  setMode(true, messages.newSlip);
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
      status.value = messages.downloadFailed(String(error));
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
        setMode(false, messages.openedTemplate);
      } else {
        const fromVoucher = templateFromVoucher(file);
        voucher.value = file;
        template.value = fromVoucher;
        designerSrc.value = serializeSlipFile(fromVoucher);
        formSrc.value = serializeSlipFile(file);
        filling.value = true;
        localStorage.setItem(MODE_KEY, 'fill');
        status.value = file.issued ? messages.openedIssued : messages.openedVoucher;
      }
      void saveNow();
    })
    .catch((error: unknown) => {
      status.value = messages.openFailed(String(error));
    });
}

// 시작 — 이전 작업이 있으면 그대로 이어서 연다
onMounted(async () => {
  const savedTemplate = await restore(store, TEMPLATE_KEY);
  const savedVoucher = await restore(store, VOUCHER_KEY);
  const restored = savedTemplate?.kind === 'template';
  if (savedTemplate?.kind === 'template') {
    template.value = savedTemplate;
    designerSrc.value = serializeSlipFile(savedTemplate);
  }
  if (savedVoucher?.kind === 'voucher') voucher.value = savedVoucher;
  setMode(localStorage.getItem(MODE_KEY) === 'fill', restored ? messages.restored : messages.welcome);
});
</script>

<template>
  <header>
    <span class="title">{{ messages.appTitle('Vue') }}</span>
    <button :aria-pressed="!filling" @click="setMode(false)">{{ messages.buttonDesign }}</button>
    <button :aria-pressed="filling" @click="setMode(true)">{{ messages.buttonFill }}</button>
    <button v-show="filling" @click="newSlip">{{ messages.buttonNewSlip }}</button>
    <span class="sep" />
    <button @click="openDownloadDialog">{{ messages.buttonDownload }}</button>
    <button @click="openFile">{{ messages.buttonOpen }}</button>
    <span class="autosave">{{ autosave }}</span>
    <span class="status">{{ status }}</span>
  </header>

  <div class="pane" :hidden="filling">
    <SlipDesigner :src="designerSrc" v-bind="localeProp" :storage="store" @slip-change="onDesignerChange" />
  </div>
  <div class="pane" :hidden="!filling">
    <SlipForm
      v-if="formSrc !== ''"
      :src="formSrc"
      v-bind="localeProp"
      @slip-change="onFormChange"
      @slip-issue="onFormIssue"
    />
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
