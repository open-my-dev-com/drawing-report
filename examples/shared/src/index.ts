/**
 * 데모 3종(바닐라·React·Vue)이 함께 쓰는 로직 (F-22).
 *
 * 화면을 그리는 방법은 프레임워크마다 다르지만, 무엇을 저장하고 언제 이어 쓰며
 * 어떤 문구를 보여줄지는 같다. 그 공통 부분만 여기에 두고 각 데모는 화면만 만든다.
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

/** 자동 저장 키 — 양식, 작성 중 전표, 발행된 전표를 따로 보관한다 */
export const TEMPLATE_KEY = 'autosave-template';
export const VOUCHER_KEY = 'autosave-voucher';
export const ISSUED_KEY = 'autosave-issued';

/** 마지막으로 보던 화면 — 새로고침 후 같은 화면으로 돌아오기 위해 기억한다 */
export const MODE_KEY = 'slipkit-demo-mode';

/** 데모의 화면 구분 — 양식 편집, 전표 작성, 발행 전표 조회 */
export type DemoMode = 'design' | 'fill' | 'view';

/**
 * 저장된 화면 값을 {@link DemoMode}로 검증한다.
 *
 * @param value - localStorage에서 읽은 값
 * @returns 지원하는 화면 값. 그 외에는 'design'
 */
export function asDemoMode(value: string | null): DemoMode {
  return value === 'fill' || value === 'view' ? value : 'design';
}

/** 자동 저장을 미루는 시간(ms) — 타자 중 매번 저장하지 않는다 */
export const AUTOSAVE_DELAY_MS = 800;

/** 데모가 지원하는 언어 — SlipKit 컴포넌트와 같은 세 언어를 쓴다 */
export type DemoLocale = 'ko' | 'en' | 'ja';

/**
 * 데모를 실행할 언어를 정한다. 주소의 `?locale=` 값을 먼저 쓰고,
 * 없으면 빌드 설정(`VITE_SLIPKIT_LOCALE` 등)으로 받은 값을 쓴다.
 *
 * @param search - 페이지 주소의 쿼리 문자열 (`location.search`)
 * @param fallback - 쿼리에 없을 때 사용할 로케일 (생략 가능)
 * @returns 로케일 문자열. 둘 다 없으면 undefined (컴포넌트 기본 언어인 영어)
 */
export function resolveDemoLocale(search: string, fallback?: string): string | undefined {
  return new URLSearchParams(search).get('locale') ?? fallback ?? undefined;
}

/** 로케일 문자열에서 데모 문구의 언어를 고른다. 지원하지 않는 언어는 영어로 처리한다. */
function demoLanguage(locale?: string): DemoLocale {
  const language = locale?.toLowerCase().split('-')[0];
  return language === 'ko' || language === 'ja' ? language : 'en';
}

/**
 * 키를 지정하지 않은 데모에서 사용하는 샘플 키.
 * 소스에 포함된 공개 값이므로 실제 데이터 보호에는 쓸 수 없다.
 *
 * @remarks
 * 공통 설정 도입 전 데모의 자동 저장이 쓰던 키와 같은 값이다. 값을 바꾸면
 * 이전에 저장한 IndexedDB 데이터와 내려받은 암호화 파일을 열 수 없게 된다.
 */
export const DEMO_SAMPLE_KEY = 'omdc-slipkit-sample-key';

/**
 * 데모의 암호화 키 설정을 만든다. `.env`의 키(`VITE_SLIPKIT_KEY`)를 한 번 읽어 검증하고,
 * 없으면 경고를 남기고 샘플 키를 명시적으로 사용한다.
 *
 * @remarks
 * 자체 키를 설정해도 샘플 키를 이전 키로 등록해, 키를 정하기 전에 저장한
 * 데이터를 계속 열 수 있게 한다.
 *
 * @param envKey - 빌드 환경변수에서 읽은 키 값 (생략 가능)
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
 * 데모가 쓰는 저장 수단 두 벌을 만든다 (ADR-021/025).
 * 키와 로케일은 SlipKit 인스턴스의 공통 설정을 그대로 쓴다.
 *
 * @param slipkit - 공통 설정 인스턴스
 * @param dbName - IndexedDB 이름 — 데모끼리 저장 내용이 섞이지 않게 따로 준다
 * @returns 브라우저 저장소와 파일 주고받기 기능
 */
export function createStores(slipkit: SlipKit, dbName: string): {
  store: StorageAdapter;
  files: SlipFileExchange;
} {
  return {
    // 자동 저장 본문은 공통 키로 암호화한다.
    store: new IndexedDbStorage(slipkit, { dbName, encryptOnSave: true }),
    // 내려받는 .slip 파일은 내용 확인이 목적이라 암호화하지 않는다. 암호화 파일 열기는 가능하다.
    files: new SlipFileExchange(slipkit, { encryptOnSave: false }),
  };
}

/**
 * 처음 열 때 보여줄 양식 — 동봉 프리셋의 첫 번째.
 *
 * @param locale - 프리셋 제목·라벨에 사용할 로케일 (생략하면 영어)
 * @returns 프리셋에서 만든 양식 파일
 */
export function initialTemplate(locale?: string): SlipTemplateFile {
  return getPresets(locale)[0]!.create();
}

/** 전표에 담긴 양식 스냅샷을 편집용 양식으로 되돌린다 */
export function templateFromVoucher(voucher: SlipVoucherFile): SlipTemplateFile {
  return {
    schemaVersion: voucher.schemaVersion,
    kind: 'template',
    template: voucher.templateSnapshot,
  };
}

/**
 * 작성 중 전표를 이어 쓸 수 있는지 — 전표는 만들 때의 양식(templateSnapshot)을 품고
 * 그 양식으로 이어 쓰므로 지금 양식과의 구조 비교는 필요하지 않다 (ADR-008).
 * 발행된 전표는 값이 확정되어 이어 쓰지 않는다.
 *
 * @param voucher - 작성 중 전표 (없으면 null)
 * @returns 발행되지 않은 전표가 있으면 true
 */
export function canResumeVoucher(voucher: SlipVoucherFile | null): boolean {
  return voucher !== null && !voucher.issued;
}

/**
 * 내려받을 때 채워 줄 파일 이름 후보 — 양식 제목에서 따온다.
 *
 * @param file - 지금 다루고 있는 파일
 * @param locale - 이름에 붙이는 "전표" 표기에 사용할 로케일 (생략하면 영어)
 * @returns 전표면 "제목 전표", 양식이면 제목 그대로
 */
export function suggestedName(file: SlipFile, locale?: string): string {
  if (file.kind === 'voucher') {
    return getMessages(locale).voucherFileName(file.templateSnapshot.meta.title);
  }
  return file.template.meta.title;
}

/**
 * 사용자가 파일 선택을 취소한 오류인지 판별한다.
 *
 * @param error - 저장소 작업에서 잡은 오류
 * @returns 취소면 true
 */
export function isCancelled(error: unknown): boolean {
  return error instanceof SlipStorageError && error.code === 'cancelled';
}

/**
 * 화면에 표시할 오류 문구를 만든다.
 *
 * @param error - 잡은 오류
 * @returns 오류 메시지 본문
 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 바이트 데이터를 브라우저 다운로드로 저장한다.
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
 * 저장해 둔 파일을 조용히 읽어 온다.
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

/**
 * 자동 저장 표시 문구.
 *
 * @param at - 저장한 시각
 * @param locale - 시각과 문구에 사용할 로케일 (생략하면 영어)
 * @returns "자동 저장됨 (오후 1:20)" 형태의 문구
 */
export function savedLabel(at: Date, locale?: string): string {
  const time = at.toLocaleTimeString(locale ?? 'en', { hour: '2-digit', minute: '2-digit' });
  return getMessages(locale).autosaved(time);
}

/** 데모 화면의 버튼 이름과 안내 문구 목록 */
export interface DemoMessages {
  appTitle(framework?: string): string;
  buttonDesign: string;
  buttonFill: string;
  buttonNewSlip: string;
  buttonDownload: string;
  buttonPdf: string;
  buttonOpen: string;
  buttonView: string;
  filenameLabel: string;
  cancel: string;
  download: string;
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
  autosaved(time: string): string;
  voucherFileName(title: string): string;
}

const KO: DemoMessages = {
  appTitle: (framework) => (framework ? `SlipKit ${framework} 데모` : 'SlipKit 데모'),
  buttonDesign: '양식 만들기',
  buttonFill: '전표 쓰기',
  buttonNewSlip: '새 전표',
  buttonDownload: '파일로 내려받기',
  buttonPdf: 'PDF로 내려받기',
  buttonOpen: '파일 열기',
  buttonView: '발행 전표 보기',
  filenameLabel: '파일 이름',
  cancel: '취소',
  download: '내려받기',
  design: '양식을 고칩니다 — 바꾼 내용은 자동으로 저장됩니다',
  fillNew: '값을 채운 뒤 발행하면 나중에 내용이 바뀌지 않았는지 확인할 수 있는 표시가 함께 남습니다',
  fillContinue: '쓰던 전표를 이어서 작성합니다',
  newSlip: '새 전표를 시작했습니다',
  issued: '전표를 발행했습니다 — 파일로 내려받아 보관하거나 그대로 보낼 수 있습니다',
  openedTemplate: '양식 파일을 열었습니다',
  openedVoucher: '쓰던 전표를 열었습니다',
  openedIssued: '발행된 전표를 열었습니다 (고칠 수 없습니다)',
  viewing: '발행된 전표를 표시합니다',
  restored: '이전에 하던 작업을 이어서 엽니다',
  welcome: '양식을 만들고, 전표 쓰기로 넘어가 값을 채워 보세요',
  downloaded: (name) => `${name} 파일을 내려받았습니다`,
  downloadFailed: (reason) => `내려받지 못했습니다: ${reason}`,
  pdfDownloaded: (name) => `${name} 파일을 내려받았습니다`,
  pdfFailed: (reason) => `PDF를 만들지 못했습니다: ${reason}`,
  openFailed: (reason) => `열지 못했습니다: ${reason}`,
  autosaveFailed: (reason) => `자동 저장하지 못했습니다: ${reason}`,
  autosaved: (time) => `자동 저장됨 (${time})`,
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
  filenameLabel: 'File name',
  cancel: 'Cancel',
  download: 'Download',
  design: 'Editing the template — changes are saved automatically',
  fillNew: 'Fill in the values and issue the voucher — an issued voucher carries a mark that shows its content has not been changed',
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
  filenameLabel: 'ファイル名',
  cancel: 'キャンセル',
  download: 'ダウンロード',
  design: 'テンプレートを編集します — 変更内容は自動的に保存されます',
  fillNew: '値を入力して発行すると、後から内容が変わっていないことを確認できる印が残ります',
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
  autosaved: (time) => `自動保存済み (${time})`,
  voucherFileName: (title) => `${title} 伝票`,
};

const MESSAGES: Record<DemoLocale, DemoMessages> = { ko: KO, en: EN, ja: JA };

/**
 * 로케일에 맞는 데모 문구 목록을 반환한다.
 *
 * @param locale - 데모 언어 (생략하거나 지원하지 않는 언어면 영어)
 * @returns 데모 문구 목록
 */
export function getMessages(locale?: string): DemoMessages {
  return MESSAGES[demoLanguage(locale)];
}
