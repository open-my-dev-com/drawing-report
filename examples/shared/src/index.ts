/**
 * 데모 3종(바닐라·React·Vue)이 함께 쓰는 로직 (F-22).
 *
 * 화면을 그리는 방법은 프레임워크마다 다르지만, 무엇을 저장하고 언제 이어 쓰며
 * 어떤 문구를 보여줄지는 같다. 그 공통 부분만 여기에 두고 각 데모는 화면만 만든다.
 */
import { presets, IndexedDbStorage, LocalFileStorage } from '@omdc-slipkit/elements';
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

/**
 * 데모가 쓰는 저장소 두 벌을 만든다 (ADR-021/025).
 *
 * @param dbName - IndexedDB 이름 — 데모끼리 저장 내용이 섞이지 않게 따로 준다
 * @returns 브라우저 저장소와 파일 주고받기 어댑터
 */
export function createStores(dbName: string): {
  store: StorageAdapter;
  localFile: LocalFileStorage;
} {
  return { store: new IndexedDbStorage({ dbName }), localFile: new LocalFileStorage() };
}

/** 처음 열 때 보여줄 양식 — 동봉 프리셋의 첫 번째 */
export function initialTemplate(): SlipTemplateFile {
  return presets[0]!.create();
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
 * 작성 중 전표를 지금 양식으로 이어 쓸 수 있는지 — 양식이 바뀌었으면 새로 시작한다.
 * 전표는 만들 때의 양식을 품기 때문이다 (ADR-008).
 *
 * @param voucher - 작성 중 전표 (없으면 null)
 * @param template - 지금 편집 중인 양식
 * @returns 이어 쓸 수 있으면 true
 */
export function canContinueVoucher(
  voucher: SlipVoucherFile | null,
  template: SlipTemplateFile,
): boolean {
  if (!voucher || voucher.issued) return false;
  return JSON.stringify(voucher.templateSnapshot) === JSON.stringify(template.template);
}

/**
 * 내려받을 때 채워 줄 파일 이름 후보 — 양식 제목에서 따온다.
 *
 * @param file - 지금 다루고 있는 파일
 * @returns 전표면 "제목 전표", 양식이면 제목 그대로
 */
export function suggestedName(file: SlipFile): string {
  if (file.kind === 'voucher') return `${file.templateSnapshot.meta.title} 전표`;
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
 * @returns "자동 저장됨 (오후 1:20)" 형태의 문구
 */
export function savedLabel(at: Date): string {
  const time = at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return `자동 저장됨 (${time})`;
}

/** 화면에 띄우는 안내 문구 — 세 데모가 같은 말을 쓰도록 한곳에 모은다 */
export const messages = {
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
  downloaded: (name: string) => `${name} 파일을 내려받았습니다`,
  downloadFailed: (reason: string) => `내려받지 못했습니다: ${reason}`,
  openFailed: (reason: string) => `열지 못했습니다: ${reason}`,
  autosaveFailed: (reason: string) => `자동 저장하지 못했습니다: ${reason}`,
} as const;
