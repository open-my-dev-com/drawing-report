/**
 * 바닐라·React·Vue 데모가 함께 사용하는 로직입니다.
 *
 * 화면을 그리는 방법은 프레임워크마다 다르지만, 무엇을 저장하고 언제 이어 쓰며
 * 어떤 문구를 보여줄지는 같습니다. 그 공통 부분만 여기에 두고 각 데모는 화면만 만듭니다.
 */
import { getPresets, IndexedDbStorage, SlipFileExchange } from '@omdc-slipkit/elements';
import {
  SlipStorageError,
  type SlipFile,
  type SlipKit,
  type SlipTemplateFile,
  type SlipVoucherFile,
  type StorageAdapter,
} from '@omdc-slipkit/core';

/** 양식, 작성 중 전표, 발행된 전표를 구분하는 자동 저장 키입니다. */
export const TEMPLATE_KEY = 'autosave-template';
export const VOUCHER_KEY = 'autosave-voucher';
export const ISSUED_KEY = 'autosave-issued';

/** 새로고침 후 같은 화면으로 돌아가기 위해 마지막 화면을 기록하는 키입니다. */
export const MODE_KEY = 'slipkit-demo-mode';

/** 데모가 저장소에 남기는 자동 저장 키입니다. 저장 데이터를 삭제할 때도 이 순서를 따릅니다. */
export const AUTOSAVE_KEYS: readonly string[] = [TEMPLATE_KEY, VOUCHER_KEY, ISSUED_KEY];

/** 데모 화면을 양식 편집, 전표 작성, 발행 전표 조회로 구분합니다. */
export type DemoMode = 'design' | 'fill' | 'view';

/**
 * 저장된 화면 값을 {@link DemoMode}로 검증합니다.
 *
 * @param value - localStorage에서 읽은 값
 * @returns 지원하는 화면 모드. 그 외에는 'design'
 */
export function asDemoMode(value: string | null): DemoMode {
  return value === 'fill' || value === 'view' ? value : 'design';
}

/** 입력할 때마다 저장하지 않도록 자동 저장을 미루는 시간(ms)입니다. */
export const AUTOSAVE_DELAY_MS = 800;

/** 데모가 지원하는 언어입니다. SlipKit 컴포넌트와 같은 세 언어를 사용합니다. */
export type DemoLocale = 'ko' | 'en' | 'ja';

/**
 * 데모를 실행할 언어를 정합니다. 주소의 `?locale=` 값을 먼저 쓰고,
 * 없으면 빌드 설정(`VITE_SLIPKIT_LOCALE` 등)으로 받은 값을 씁니다.
 *
 * @param search - 페이지 주소의 쿼리 문자열 (`location.search`)
 * @param fallback - 쿼리에 없을 때 사용할 로케일(생략 가능)
 * @returns 로케일 문자열. 둘 다 없으면 undefined (컴포넌트 기본 언어인 영어)
 */
export function resolveDemoLocale(search: string, fallback?: string): string | undefined {
  return new URLSearchParams(search).get('locale') ?? fallback ?? undefined;
}

/** 로케일 문자열에서 데모 문구의 언어를 고릅니다. 지원하지 않는 언어는 영어로 처리합니다. */
function demoLanguage(locale?: string): DemoLocale {
  const language = locale?.toLowerCase().split('-')[0];
  return language === 'ko' || language === 'ja' ? language : 'en';
}

/**
 * 데모가 PDF 렌더링에 쓸 동봉 기본 폰트의 언어를 고릅니다.
 *
 * @remarks
 * 컴포넌트는 `getFonts`가 없으면 동봉 기본 폰트를 자동으로 불러옵니다. 데모에서 직접 호출하는
 * `slipkit.render`는 폰트를 자동으로 불러오지 않으므로 세 데모의 언어 선택을 이 함수에서 처리합니다.
 *
 * @param locale - 데모 언어(생략하거나 지원하지 않는 언어면 영어)
 * @returns `loadDefaultFonts`에 넘길 언어
 */
export function demoFontLocale(locale?: string): DemoLocale {
  return demoLanguage(locale);
}

/**
 * 키를 지정하지 않은 데모에서 사용하는 샘플 키입니다.
 * 소스에 포함된 공개 값이므로 실제 데이터 보호에는 쓸 수 없습니다.
 *
 * @remarks
 * 이 값을 바꾸면 기존 IndexedDB 데이터와 내려받은 암호화 파일을 열 수 없게 됩니다.
 */
export const DEMO_SAMPLE_KEY = 'omdc-slipkit-sample-key';

/**
 * 데모의 암호화 키 설정을 만듭니다. `.env`의 키(`VITE_SLIPKIT_KEY`)를 한 번 읽어 검증하고,
 * 없으면 경고를 남기고 샘플 키를 명시적으로 사용합니다.
 *
 * @remarks
 * 자체 키를 설정해도 샘플 키를 이전 키로 등록해, 키를 정하기 전에 저장한
 * 데이터를 계속 열 수 있게 합니다.
 *
 * @param envKey - 빌드 환경변수에서 읽은 키 값(생략 가능)
 * @returns `createSlipKit`의 encryption 설정
 */
export function resolveDemoEncryption(
  envKey: string | undefined,
): { key: string; previousKeys?: string[] } {
  const key = envKey?.trim();
  if (key) return { key, previousKeys: [DEMO_SAMPLE_KEY] };
  console.warn('[demo] VITE_SLIPKIT_KEY is not set — using the public demo sample key. Supply your own key for real data.');
  return { key: DEMO_SAMPLE_KEY };
}

/**
 * 공개 샘플 키 사용 여부를 반환합니다. 화면의 경고 표시 여부도 이 값으로 결정합니다.
 *
 * @param envKey - 빌드 환경변수에서 읽은 키 값(생략 가능)
 * @returns 자체 키가 없어 샘플 키를 쓰면 `true`
 */
export function usesDemoSampleKey(envKey: string | undefined): boolean {
  return !envKey?.trim();
}

/**
 * 데모에서 사용하는 두 저장 수단을 만듭니다.
 * 키와 로케일은 SlipKit 인스턴스의 공통 설정을 그대로 씁니다.
 *
 * @param slipkit - 공통 설정 인스턴스
 * @param dbName - 데모별 저장 내용을 구분할 IndexedDB 이름
 * @returns 브라우저 저장소와 파일 주고받기 기능
 */
export function createStores(slipkit: SlipKit, dbName: string): {
  store: StorageAdapter;
  files: SlipFileExchange;
} {
  return {
    // 자동 저장 본문은 공통 키로 암호화합니다.
    store: new IndexedDbStorage(slipkit, { dbName, encryptOnSave: true }),
    // 내려받는 .slip 파일은 내용 확인이 목적이라 암호화하지 않습니다. 암호화 파일 열기는 가능합니다.
    files: new SlipFileExchange(slipkit, { encryptOnSave: false }),
  };
}

/**
 * 데모를 처음 열 때 동봉 프리셋의 첫 번째 양식을 반환합니다.
 *
 * @param locale - 프리셋 제목·라벨에 사용할 로케일(생략하면 영어)
 * @returns 프리셋에서 만든 양식 파일
 */
export function initialTemplate(locale?: string): SlipTemplateFile {
  return getPresets(locale)[0]!.create();
}

/** 전표에 담긴 양식 스냅샷을 편집용 양식으로 되돌립니다. */
export function templateFromVoucher(voucher: SlipVoucherFile): SlipTemplateFile {
  return {
    schemaVersion: voucher.schemaVersion,
    kind: 'template',
    template: voucher.templateSnapshot,
  };
}

/**
 * 작성 중인 전표를 이어 쓸 수 있는지 확인합니다. 전표에는 만들 때의 양식(`templateSnapshot`)이
 * 포함되므로 현재 편집 중인 양식과 구조를 비교하지 않습니다.
 * 발행된 전표는 값이 확정되어 이어 쓰지 않습니다.
 *
 * @param voucher - 작성 중 전표(없으면 null)
 * @returns 발행되지 않은 전표가 있으면 true
 */
export function canResumeVoucher(voucher: SlipVoucherFile | null): boolean {
  return voucher !== null && !voucher.issued;
}

/**
 * 양식 제목을 바탕으로 내려받을 파일 이름을 만듭니다.
 *
 * @param file - 지금 다루고 있는 파일
 * @param locale - 이름에 붙이는 "전표" 표기에 사용할 로케일(생략하면 영어)
 * @returns 전표면 "제목 전표", 양식이면 제목 그대로
 */
export function suggestedName(file: SlipFile, locale?: string): string {
  if (file.kind === 'voucher') {
    return getMessages(locale).voucherFileName(file.templateSnapshot.meta.title);
  }
  return file.template.meta.title;
}

/**
 * 사용자가 파일 선택을 취소한 오류인지 판별합니다.
 *
 * @param error - 저장소 작업에서 잡은 오류
 * @returns 취소면 true
 */
export function isCancelled(error: unknown): boolean {
  return error instanceof SlipStorageError && error.code === 'cancelled';
}

/**
 * 화면에 표시할 오류 문구를 만듭니다.
 *
 * @param error - 잡은 오류
 * @returns 오류 메시지 본문
 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 바이트 데이터를 브라우저 다운로드로 저장합니다.
 *
 * @param bytes - 저장할 파일 내용
 * @param name - 파일 이름
 * @param type - MIME 타입
 */
export function saveBytes(bytes: Uint8Array, name: string, type: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 저장된 파일을 읽습니다. 파일이 없거나 읽을 수 없으면 `null`을 반환합니다.
 *
 * @param store - 읽을 저장소
 * @param key - 저장 키
 * @returns 저장된 파일, 없거나 읽지 못하면 null
 */
export async function restore(store: StorageAdapter, key: string): Promise<SlipFile | null> {
  try {
    return await store.load(key);
  } catch (error) {
    if (error instanceof SlipStorageError && error.code === 'not-found') return null;
    console.warn('[demo] 이전 작업을 읽지 못했습니다:', error);
    return null;
  }
}

/** {@link clearDemoStorage} 설정입니다. */
export interface ClearDemoStorageOptions {
  /**
   * 마지막으로 열었던 화면 정보(`slipkit-demo-mode`)를 삭제할지를 나타냅니다.
   *
   * @defaultValue true
   */
  removeMode?: boolean;
}

/**
 * 데모가 이 브라우저에 남긴 저장 데이터를 삭제합니다. 자동 저장 키 세 개를 차례로 삭제하고,
 * 마지막으로 열었던 화면 정보도 함께 삭제합니다.
 *
 * @remarks
 * 삭제 대상은 이 데모가 만든 항목뿐입니다. 디자이너에서 이름을 붙여 저장한 양식,
 * 내려받은 파일과 다른 데모의 저장 데이터는 변경하지 않습니다. 하나가 실패해도 나머지 키를
 * 모두 시도한 뒤 오류를 던지므로, 일부만 삭제된 상태를 성공으로 알리지 않습니다.
 *
 * @param store - 데모가 자동 저장에 쓰는 저장소
 * @param options - 삭제 설정. 생략하면 화면 정보까지 삭제합니다.
 * @throws 삭제하지 못한 항목이 있으면 처음 발생한 오류를 그대로 던집니다.
 */
export async function clearDemoStorage(
  store: StorageAdapter,
  options: ClearDemoStorageOptions = {},
): Promise<void> {
  const failures: unknown[] = [];
  for (const key of AUTOSAVE_KEYS) {
    try {
      await store.delete(key);
    } catch (error) {
      failures.push(error);
    }
  }
  if (options.removeMode !== false) {
    try {
      localStorage.removeItem(MODE_KEY);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/** 한 번의 저장 작업에서 순서대로 기록할 자동 저장 항목입니다. */
export type DemoSaveEntry = readonly [key: string, file: SlipFile];

/** 데모의 자동 저장·삭제 작업을 호출 순서대로 실행하는 큐입니다. */
export interface DemoStorageQueue {
  /**
   * 파일 묶음을 다른 저장·삭제 작업과 섞이지 않게 순서대로 저장합니다.
   *
   * @param entries - 저장할 키와 파일 묶음
   * @returns 모든 파일을 저장한 뒤 끝나는 Promise
   */
  save(entries: readonly DemoSaveEntry[]): Promise<void>;
  /**
   * 키 목록을 다른 저장·삭제 작업과 섞이지 않게 순서대로 삭제합니다.
   *
   * @param keys - 삭제할 키 목록
   * @returns 모든 키를 삭제한 뒤 끝나는 Promise
   */
  delete(keys: readonly string[]): Promise<void>;
  /**
   * 앞서 시작한 저장·삭제가 끝난 뒤 데모 저장 데이터를 삭제합니다.
   *
   * @param options - 마지막 화면 정보의 삭제 여부
   * @returns 삭제가 끝난 뒤 완료되는 Promise
   */
  clear(options?: ClearDemoStorageOptions): Promise<void>;
}

/**
 * 데모의 자동 저장과 삭제를 하나의 순서로 직렬화합니다.
 *
 * @remarks
 * 삭제 확인 직전에 시작된 IndexedDB 저장이 삭제보다 늦게 끝나면 삭제한 데이터가 다시 저장될 수
 * 있습니다. 한 번의 자동 저장 묶음과 삭제를 같은 큐에 넣어, 삭제가 앞선 저장을 항상 기다리게 합니다.
 * 실패한 작업은 호출자에게 그대로 전달하지만 뒤 작업의 실행은 막지 않습니다.
 *
 * @param store - 데모 자동 저장에 쓰는 저장소
 * @returns 호출 순서대로 작업하는 저장 큐
 */
export function createDemoStorageQueue(store: StorageAdapter): DemoStorageQueue {
  let tail: Promise<void> = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  }

  return {
    save: (entries) => enqueue(async () => {
      for (const [key, file] of entries) await store.save(key, file);
    }),
    delete: (keys) => enqueue(async () => {
      for (const key of keys) await store.delete(key);
    }),
    clear: (options) => enqueue(() => clearDemoStorage(store, options)),
  };
}

/**
 * 자동 저장 완료 시각을 나타내는 문구를 만듭니다.
 *
 * @param at - 저장한 시각
 * @param locale - 시각과 문구에 사용할 로케일(생략하면 영어)
 * @returns "오후 1:20에 자동 저장했습니다." 형태의 문구
 */
export function savedLabel(at: Date, locale?: string): string {
  const time = at.toLocaleTimeString(locale ?? 'en', { hour: '2-digit', minute: '2-digit' });
  return getMessages(locale).autosaved(time);
}

/** 데모 화면의 버튼 이름과 안내 문구 목록입니다. */
export interface DemoMessages {
  appTitle(framework?: string): string;
  buttonDesign: string;
  buttonFill: string;
  buttonNewSlip: string;
  buttonDownload: string;
  buttonPdf: string;
  buttonOpen: string;
  buttonView: string;
  buttonClearStorage: string;
  filenameLabel: string;
  cancel: string;
  download: string;
  storageNotice: string;
  storageKeyWarning: string;
  clearConfirmTitle: string;
  clearConfirmBody: string;
  clearConfirmOk: string;
  cleared: string;
  design: string;
  fillNew: string;
  fillContinue: string;
  newSlip: string;
  issued: string;
  openedTemplate: string;
  openedVoucher: string;
  openedIssued: string;
  viewing: string;
  restored: string;
  welcome: string;
  downloaded(name: string): string;
  downloadFailed(reason: string): string;
  pdfDownloaded(name: string): string;
  pdfFailed(reason: string): string;
  openFailed(reason: string): string;
  autosaveFailed(reason: string): string;
  clearFailed(reason: string): string;
  autosaved(time: string): string;
  voucherFileName(title: string): string;
}

const KO: DemoMessages = {
  appTitle: (framework) => (framework ? `SlipKit ${framework} 데모` : 'SlipKit 데모'),
  buttonDesign: '양식 만들기',
  buttonFill: '전표 작성',
  buttonNewSlip: '새 전표',
  buttonDownload: '파일로 내려받기',
  buttonPdf: 'PDF로 내려받기',
  buttonOpen: '파일 열기',
  buttonView: '발행 전표 보기',
  buttonClearStorage: '저장 데이터 삭제',
  filenameLabel: '파일 이름',
  cancel: '취소',
  download: '내려받기',
  storageNotice: '작업 중인 양식과 전표는 이 브라우저에 자동 저장되며 다음에 열 때 복원됩니다. 공용 기기에서는 사용을 마친 뒤 저장 데이터를 삭제하세요. 내 양식에 저장한 양식은 삭제되지 않습니다.',
  storageKeyWarning: '데모의 암호화 키는 소스 코드에 공개된 샘플 값이므로 개인정보를 보호하지 못합니다. 실제 개인정보나 기밀 정보를 입력하지 마세요.',
  clearConfirmTitle: '저장 데이터를 삭제할까요?',
  clearConfirmBody: '자동 저장된 양식, 작성 중 전표, 발행된 전표와 마지막으로 사용한 화면 설정을 삭제합니다. 내 양식에 저장한 양식과 이미 내려받은 파일은 삭제되지 않습니다. 삭제한 내용은 되돌릴 수 없습니다.',
  clearConfirmOk: '삭제',
  cleared: '자동 저장된 작업 내용을 삭제하고 초기 상태로 돌아갔습니다. 내 양식은 그대로 유지됩니다.',
  design: '양식을 편집하고 있습니다. 변경 내용은 자동으로 저장됩니다.',
  fillNew: '값을 입력한 뒤 전표를 발행하면 작성 폼에서 더 이상 수정할 수 없습니다.',
  fillContinue: '작성 중이던 전표를 이어서 작성합니다.',
  newSlip: '새 전표를 시작했습니다.',
  issued: '전표를 발행했습니다. 파일로 내려받아 보관하거나 전송할 수 있습니다.',
  openedTemplate: '양식 파일을 열었습니다.',
  openedVoucher: '작성 중이던 전표를 열었습니다.',
  openedIssued: '발행된 전표를 열었습니다. 발행된 전표는 수정할 수 없습니다.',
  viewing: '발행된 전표를 보고 있습니다.',
  restored: '이전 작업을 복원했습니다.',
  welcome: '양식을 만든 뒤 전표 작성 화면에서 값을 입력해 보세요.',
  downloaded: (name) => `${name} 파일을 내려받았습니다.`,
  downloadFailed: (reason) => `내려받지 못했습니다: ${reason}`,
  pdfDownloaded: (name) => `${name} 파일을 내려받았습니다.`,
  pdfFailed: (reason) => `PDF를 만들지 못했습니다: ${reason}`,
  openFailed: (reason) => `열지 못했습니다: ${reason}`,
  autosaveFailed: (reason) => `자동 저장하지 못했습니다: ${reason}`,
  clearFailed: (reason) => `저장 데이터를 삭제하지 못했습니다: ${reason}`,
  autosaved: (time) => `${time}에 자동 저장했습니다.`,
  voucherFileName: (title) => `${title} 전표`,
};

const EN: DemoMessages = {
  appTitle: (framework) => (framework ? `SlipKit ${framework} Demo` : 'SlipKit Demo'),
  buttonDesign: 'Design template',
  buttonFill: 'Fill voucher',
  buttonNewSlip: 'New voucher',
  buttonDownload: 'Download file',
  buttonPdf: 'Download PDF',
  buttonOpen: 'Open file',
  buttonView: 'View issued voucher',
  buttonClearStorage: 'Delete saved data',
  filenameLabel: 'File name',
  cancel: 'Cancel',
  download: 'Download',
  storageNotice: 'The template and vouchers you work on are autosaved in this browser and restored the next time you open the demo. Delete the saved data when you are done on a shared device — templates you saved to My templates are kept.',
  storageKeyWarning: 'The demo encryption key is a public sample from the source code and protects nothing — do not enter real personal or confidential information.',
  clearConfirmTitle: 'Delete saved data?',
  clearConfirmBody: 'This deletes the autosaved template, the draft and issued vouchers, and the screen you last used. Templates you saved to My templates and files you already downloaded are kept. It cannot be undone.',
  clearConfirmOk: 'Delete',
  cleared: 'Deleted the autosaved work — back to the initial state (My templates are kept)',
  design: 'Editing the template — changes are saved automatically',
  fillNew: 'Fill in the values and issue the voucher. Issued vouchers are read-only in the form.',
  fillContinue: 'Continuing the voucher you were working on',
  newSlip: 'Started a new voucher',
  issued: 'Voucher issued — download it as a file to keep, or send it as is',
  openedTemplate: 'Opened a template file',
  openedVoucher: 'Opened the voucher you were working on',
  openedIssued: 'Opened an issued voucher (read-only)',
  viewing: 'Showing the issued voucher',
  restored: 'Continuing where you left off',
  welcome: 'Build a template, then switch to voucher filling and enter values',
  downloaded: (name) => `Downloaded ${name}`,
  downloadFailed: (reason) => `Download failed: ${reason}`,
  pdfDownloaded: (name) => `Downloaded ${name}`,
  pdfFailed: (reason) => `Could not create the PDF: ${reason}`,
  openFailed: (reason) => `Could not open the file: ${reason}`,
  autosaveFailed: (reason) => `Autosave failed: ${reason}`,
  clearFailed: (reason) => `Could not delete the saved data: ${reason}`,
  autosaved: (time) => `Autosaved (${time})`,
  voucherFileName: (title) => `${title} voucher`,
};

const JA: DemoMessages = {
  appTitle: (framework) => (framework ? `SlipKit ${framework} デモ` : 'SlipKit デモ'),
  buttonDesign: 'テンプレート作成',
  buttonFill: '伝票入力',
  buttonNewSlip: '新しい伝票',
  buttonDownload: 'ファイルをダウンロード',
  buttonPdf: 'PDF をダウンロード',
  buttonOpen: 'ファイルを開く',
  buttonView: '発行済み伝票を見る',
  buttonClearStorage: '保存データを削除',
  filenameLabel: 'ファイル名',
  cancel: 'キャンセル',
  download: 'ダウンロード',
  storageNotice: '作業中のテンプレートと伝票はこのブラウザーに自動保存され、次に開いたときにそのまま復元されます。共用の端末では使い終わったら保存データを削除してください — 「マイテンプレート」に保存したテンプレートはそのまま残ります。',
  storageKeyWarning: 'デモの暗号化キーはソースに公開されたサンプル値で、個人情報を守るものではありません — 実際の個人情報や機密情報は入力しないでください。',
  clearConfirmTitle: '保存データを削除しますか？',
  clearConfirmBody: '自動保存されたテンプレートと、作成中・発行済みの伝票、最後に開いていた画面を削除します。「マイテンプレート」に保存したテンプレートとダウンロード済みのファイルはそのまま残ります。元に戻せません。',
  clearConfirmOk: '削除',
  cleared: '自動保存された作業内容を削除しました — 最初の状態に戻ります（「マイテンプレート」はそのまま残ります）',
  design: 'テンプレートを編集します — 変更内容は自動的に保存されます',
  fillNew: '値を入力して発行すると、入力フォームでは編集できなくなります',
  fillContinue: '作成中の伝票を続けて入力します',
  newSlip: '新しい伝票を開始しました',
  issued: '伝票を発行しました — ファイルとしてダウンロードして保管するか、そのまま送ることができます',
  openedTemplate: 'テンプレートファイルを開きました',
  openedVoucher: '作成中の伝票を開きました',
  openedIssued: '発行済みの伝票を開きました（編集できません）',
  viewing: '発行済みの伝票を表示します',
  restored: '前回の作業を続けて開きます',
  welcome: 'テンプレートを作成し、伝票入力に切り替えて値を入力してみましょう',
  downloaded: (name) => `${name} をダウンロードしました`,
  downloadFailed: (reason) => `ダウンロードできませんでした: ${reason}`,
  pdfDownloaded: (name) => `${name} をダウンロードしました`,
  pdfFailed: (reason) => `PDF を作成できませんでした: ${reason}`,
  openFailed: (reason) => `開けませんでした: ${reason}`,
  autosaveFailed: (reason) => `自動保存できませんでした: ${reason}`,
  clearFailed: (reason) => `保存データを削除できませんでした: ${reason}`,
  autosaved: (time) => `自動保存済み (${time})`,
  voucherFileName: (title) => `${title} 伝票`,
};

const MESSAGES: Record<DemoLocale, DemoMessages> = { ko: KO, en: EN, ja: JA };

/**
 * 로케일에 맞는 데모 문구 목록을 반환합니다.
 *
 * @param locale - 데모 언어(생략하거나 지원하지 않는 언어면 영어)
 * @returns 데모 문구 목록
 */
export function getMessages(locale?: string): DemoMessages {
  return MESSAGES[demoLanguage(locale)];
}
