/**
 * 데모 3종(바닐라·React·Vue)이 함께 쓰는 로직 (F-22).
 *
 * 화면을 그리는 방법은 프레임워크마다 다르지만, 무엇을 저장하고 언제 이어 쓰며
 * 어떤 문구를 보여줄지는 같다. 그 공통 부분만 여기에 두고 각 데모는 화면만 만든다.
 */
import { getPresets, IndexedDbStorage, LocalFileStorage } from '@omdc-slipkit/elements';
import {
  SlipStorageError,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
  type StorageAdapter,
} from '@omdc-slipkit/core';

/** 자동 저장 키 — 양식과 작성 중 전표를 따로 보관한다 */
export const TEMPLATE_KEY = 'autosave-template';
export const VOUCHER_KEY = 'autosave-voucher';

/** 마지막으로 보던 화면 — 새로고침 후 같은 화면으로 돌아오기 위해 기억한다 */
export const MODE_KEY = 'slipkit-demo-mode';

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
 * 데모가 쓰는 저장소 두 벌을 만든다 (ADR-021/025).
 *
 * @param dbName - IndexedDB 이름 — 데모끼리 저장 내용이 섞이지 않게 따로 준다
 * @param locale - 저장소 오류 메시지에 사용할 로케일 (생략하면 영어)
 * @returns 브라우저 저장소와 파일 주고받기 어댑터
 */
export function createStores(dbName: string, locale?: string): {
  store: StorageAdapter;
  localFile: LocalFileStorage;
} {
  const options = locale === undefined ? {} : { locale };
  return {
    store: new IndexedDbStorage({ dbName, ...options }),
    localFile: new LocalFileStorage(options),
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
  buttonOpen: string;
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
  restored: string;
  welcome: string;
  downloaded(name: string): string;
  downloadFailed(reason: string): string;
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
  buttonOpen: '파일 열기',
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
  restored: '이전에 하던 작업을 이어서 엽니다',
  welcome: '양식을 만들고, 전표 쓰기로 넘어가 값을 채워 보세요',
  downloaded: (name) => `${name} 파일을 내려받았습니다`,
  downloadFailed: (reason) => `내려받지 못했습니다: ${reason}`,
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
  buttonOpen: 'Open file',
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
  restored: 'Continuing where you left off',
  welcome: 'Build a template, then switch to voucher filling and enter values',
  downloaded: (name) => `Downloaded ${name}`,
  downloadFailed: (reason) => `Download failed: ${reason}`,
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
  buttonOpen: 'ファイルを開く',
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
  restored: '前回の作業を続けて開きます',
  welcome: 'テンプレートを作成し、伝票入力に切り替えて値を入力してみましょう',
  downloaded: (name) => `${name} をダウンロードしました`,
  downloadFailed: (reason) => `ダウンロードできませんでした: ${reason}`,
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
