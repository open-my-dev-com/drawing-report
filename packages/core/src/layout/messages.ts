/**
 * 사용자에게 표시하는 페이지 계획 메시지를 언어별로 정의한다.
 *
 * 계획은 렌더링과 같은 호출 흐름에서 실행되므로 언어를 모듈 상태에 저장하지 않고
 * 호출자가 전달한 로케일로 {@link lm}에서 메시지 사전을 선택한다.
 */
import { resolveMessageLocale, type MessageLocale } from '../i18n.js';

/**
 * 계획 오류가 가리키는 세로 공간.
 * `first-page`는 그리드가 시작하는 첫 출력 페이지의 남은 공간, `empty-page`는 빈 출력 페이지의
 * 흐름 영역 전체다.
 */
export type PlanSpace = 'first-page' | 'empty-page';

/** 페이지 계획 오류 메시지 목록. `what`은 그리드·요소를 가리키는 명사구다. */
interface LayoutMessages {
  subjectGrid(name: string, id: string): string;
  subjectElement(name: string, id: string): string;
  /** 빈 페이지의 흐름 영역 전체에도 항목 블록 하나가 들어가지 않을 때 */
  itemTooTall(what: string): string;
  /** 페이지당 항목 묶음이 `space`에 들어가지 않을 때 */
  fixedPageTooTall(what: string, itemsPerPage: number, space: PlanSpace): string;
  /** 그룹 시작 구간(이월 재표시 포함)이 붙은 항목 블록이 빈 페이지의 흐름 영역 전체에 들어가지 않을 때 */
  groupTooTall(what: string): string;
  /** 페이지 머리·꼬리 구간만으로 `space`가 넘칠 때 */
  bandsTooTall(what: string, space: PlanSpace): string;
  flowOverlap(a: string, b: string): string;
  outputPagesExceeded(max: number): string;
  elementTooTall(what: string): string;
  planNotConverged(): string;
}

/** 영어 공간 표현 */
const EN_SPACE: Record<PlanSpace, string> = {
  'first-page': 'the remaining space of the first page',
  'empty-page': 'the full flow area of an empty page',
};

const EN: LayoutMessages = {
  subjectGrid: (name, id) => `grid '${name}' (${id})`,
  subjectElement: (name, id) => `element '${name}' (${id})`,
  itemTooTall: (what) => `An item area of ${what} does not fit in ${EN_SPACE['empty-page']}`,
  fixedPageTooTall: (what, itemsPerPage, space) =>
    `${what} with itemsPerPage ${itemsPerPage} does not fit in ${EN_SPACE[space]}`,
  groupTooTall: (what) =>
    `The item block of ${what} that carries the group start band (including a group start repeated after a page break) does not fit in ${EN_SPACE['empty-page']}`,
  bandsTooTall: (what, space) => `The fixed row bands of ${what} do not fit in ${EN_SPACE[space]}`,
  flowOverlap: (a, b) => `The output areas of ${a} and ${b} overlap`,
  outputPagesExceeded: (max) => `The page plan exceeds the output page limit (${max})`,
  elementTooTall: (what) => `${what} does not fit in the page flow area`,
  planNotConverged: () => 'The output page count does not settle while planning "after" placements',
};

/** 한국어 공간 표현 */
const KO_SPACE: Record<PlanSpace, string> = {
  'first-page': '첫 페이지의 남은 공간',
  'empty-page': '빈 페이지의 흐름 영역 전체',
};

const KO: LayoutMessages = {
  subjectGrid: (name, id) => `그리드 '${name}' (${id})`,
  subjectElement: (name, id) => `요소 '${name}' (${id})`,
  itemTooTall: (what) => `${what}의 항목 영역이 ${KO_SPACE['empty-page']}에 들어가지 않습니다`,
  fixedPageTooTall: (what, itemsPerPage, space) =>
    `${what}의 페이지당 항목 수(${itemsPerPage})가 ${KO_SPACE[space]}에 들어가지 않습니다`,
  groupTooTall: (what) =>
    `${what}의 그룹 시작 구간(페이지를 넘겨 다시 표시한 것 포함)이 붙은 항목 블록이 ${KO_SPACE['empty-page']}에 들어가지 않습니다`,
  bandsTooTall: (what, space) => `${what}의 고정 행 구간이 ${KO_SPACE[space]}에 들어가지 않습니다`,
  flowOverlap: (a, b) => `${a}와(과) ${b}의 출력 영역이 겹칩니다`,
  outputPagesExceeded: (max) => `페이지 계획이 출력 페이지 상한(${max})을 초과합니다`,
  elementTooTall: (what) => `${what}이(가) 페이지 흐름 영역에 들어가지 않습니다`,
  planNotConverged: () => '이어서 배치를 계획하는 동안 출력 페이지 수가 확정되지 않습니다',
};

/** 일본어 공간 표현 */
const JA_SPACE: Record<PlanSpace, string> = {
  'first-page': '最初のページの残り領域',
  'empty-page': '空ページのフロー領域全体',
};

const JA: LayoutMessages = {
  subjectGrid: (name, id) => `グリッド '${name}' (${id})`,
  subjectElement: (name, id) => `要素 '${name}' (${id})`,
  itemTooTall: (what) => `${what} の項目領域が${JA_SPACE['empty-page']}に収まりません`,
  fixedPageTooTall: (what, itemsPerPage, space) =>
    `${what} のページあたり項目数(${itemsPerPage})が${JA_SPACE[space]}に収まりません`,
  groupTooTall: (what) =>
    `${what} のグループ開始範囲（改ページ後に再表示したものを含む）を伴う項目ブロックが${JA_SPACE['empty-page']}に収まりません`,
  bandsTooTall: (what, space) => `${what} の固定行範囲が${JA_SPACE[space]}に収まりません`,
  flowOverlap: (a, b) => `${a} と ${b} の出力領域が重なっています`,
  outputPagesExceeded: (max) => `ページ計画が出力ページの上限(${max})を超えています`,
  elementTooTall: (what) => `${what} がページのフロー領域に収まりません`,
  planNotConverged: () => '続けて配置の計画中に出力ページ数が確定しません',
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
