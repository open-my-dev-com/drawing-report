/**
 * 사용자에게 표시하는 페이지 계획 메시지를 언어별로 정의한다.
 *
 * 계획은 렌더링과 같은 호출 흐름에서 실행되므로 언어를 모듈 상태에 저장하지 않고
 * 호출자가 전달한 로케일로 {@link lm}에서 메시지 사전을 선택한다.
 */
import { resolveMessageLocale, type MessageLocale } from '../i18n.js';

/** 페이지 계획 오류 메시지 목록. `what`은 그리드·요소를 가리키는 명사구다. */
interface LayoutMessages {
  subjectGrid(name: string, id: string): string;
  subjectElement(name: string, id: string): string;
  itemTooTall(what: string): string;
  fixedPageTooTall(what: string, itemsPerPage: number): string;
  groupTooTall(what: string): string;
  flowOverlap(a: string, b: string): string;
  outputPagesExceeded(max: number): string;
  afterTargetNotPlanned(what: string, target: string): string;
  elementTooTall(what: string): string;
}

const EN: LayoutMessages = {
  subjectGrid: (name, id) => `grid '${name}' (${id})`,
  subjectElement: (name, id) => `element '${name}' (${id})`,
  itemTooTall: (what) => `An item area of ${what} does not fit in the page flow area`,
  fixedPageTooTall: (what, itemsPerPage) =>
    `${what} with itemsPerPage ${itemsPerPage} does not fit in the page flow area`,
  groupTooTall: (what) => `A group of ${what} (start and end bands included) does not fit in an empty page flow area`,
  flowOverlap: (a, b) => `The output areas of ${a} and ${b} overlap`,
  outputPagesExceeded: (max) => `The page plan exceeds the output page limit (${max})`,
  afterTargetNotPlanned: (what, target) => `${what} cannot follow '${target}' — the target has no output`,
  elementTooTall: (what) => `${what} does not fit in the page flow area`,
};

const KO: LayoutMessages = {
  subjectGrid: (name, id) => `그리드 '${name}' (${id})`,
  subjectElement: (name, id) => `요소 '${name}' (${id})`,
  itemTooTall: (what) => `${what}의 항목 영역이 페이지 흐름 영역에 들어가지 않습니다`,
  fixedPageTooTall: (what, itemsPerPage) =>
    `${what}의 페이지당 항목 수(${itemsPerPage})가 페이지 흐름 영역에 들어가지 않습니다`,
  groupTooTall: (what) => `${what}의 그룹(시작·종료 구간 포함)이 빈 페이지의 흐름 영역에 들어가지 않습니다`,
  flowOverlap: (a, b) => `${a}와(과) ${b}의 출력 영역이 겹칩니다`,
  outputPagesExceeded: (max) => `페이지 계획이 출력 페이지 상한(${max})을 초과합니다`,
  afterTargetNotPlanned: (what, target) => `${what}을(를) '${target}' 뒤에 배치할 수 없습니다 — 대상의 출력이 없습니다`,
  elementTooTall: (what) => `${what}이(가) 페이지 흐름 영역에 들어가지 않습니다`,
};

const JA: LayoutMessages = {
  subjectGrid: (name, id) => `グリッド '${name}' (${id})`,
  subjectElement: (name, id) => `要素 '${name}' (${id})`,
  itemTooTall: (what) => `${what} の項目領域がページのフロー領域に収まりません`,
  fixedPageTooTall: (what, itemsPerPage) =>
    `${what} のページあたり項目数(${itemsPerPage})がページのフロー領域に収まりません`,
  groupTooTall: (what) => `${what} のグループ（開始・終了範囲を含む）が空ページのフロー領域に収まりません`,
  flowOverlap: (a, b) => `${a} と ${b} の出力領域が重なっています`,
  outputPagesExceeded: (max) => `ページ計画が出力ページの上限(${max})を超えています`,
  afterTargetNotPlanned: (what, target) => `${what} を '${target}' の後に配置できません — 対象の出力がありません`,
  elementTooTall: (what) => `${what} がページのフロー領域に収まりません`,
};

const CATALOG: Record<MessageLocale, LayoutMessages> = { en: EN, ko: KO, ja: JA };

/**
 * 로케일에 맞는 페이지 계획 메시지 사전을 반환한다.
 *
 * @param locale - BCP 47 로케일 (생략하면 영어)
 * @returns 메시지 사전
 */
export function lm(locale?: string): LayoutMessages {
  return CATALOG[resolveMessageLocale(locale)];
}
