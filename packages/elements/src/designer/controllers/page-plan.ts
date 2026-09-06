/**
 * 현재 양식 페이지의 페이지 계획과 그 캐시.
 *
 * @remarks
 * 계획은 문서 개정 번호·페이지 번호·평가 로케일이 모두 같을 때만 재사용합니다. 문서 내용을
 * 직렬화해 비교하지 않으므로, 호스트는 양식을 바꾸는 모든 경로에서 개정 번호를 올려야 합니다.
 * 개정 번호를 올리지 않은 변경은 이전 계획이 그대로 남습니다.
 */

import type { ReactiveController } from 'lit';
import {
  planSourcePage,
  SlipLayoutError,
  type GridItem,
  type SlipTemplateFile,
  type SourcePagePlan,
} from '@omdc-slipkit/core';
import { sampleItemsOf } from '../formula-context.js';

/** 계획을 구할 때 넘기는 입력 */
export interface PagePlanInput {
  /** 편집 중인 양식 */
  file: SlipTemplateFile | null;
  /** 계획을 구할 양식 페이지 (0부터) */
  pageIndex: number;
  /** 수식·조건식 평가 로케일 */
  locale: string | undefined;
  /** 문서 개정 번호 — 양식이 바뀔 때마다 커집니다 */
  revision: number;
}

/** 계획 결과 — 계획을 만들 수 없으면 오류를 대신 담습니다 */
export interface PagePlanResult {
  plan: SourcePagePlan | null;
  error: SlipLayoutError | null;
}

/** 양식이 없거나 페이지가 없을 때의 결과 */
const EMPTY_RESULT: PagePlanResult = { plan: null, error: null };

export class PagePlanController implements ReactiveController {
  /** 마지막으로 계산한 계획과 그때의 캐시 키 */
  private _cache: {
    revision: number;
    pageIndex: number;
    locale: string | undefined;
    result: PagePlanResult;
  } | null = null;
  private _computations = 0;

  hostConnected(): void {}

  /** 지금까지 실제로 계획을 계산한 횟수 */
  get computations(): number {
    return this._computations;
  }

  /**
   * 현재 페이지의 계획을 돌려줍니다. 키가 같으면 캐시를 재사용합니다.
   *
   * @param input - 양식, 페이지 번호, 평가 로케일과 문서 개정 번호
   * @returns 계획 또는 계획 오류
   */
  plan(input: PagePlanInput): PagePlanResult {
    const { file, pageIndex, locale, revision } = input;
    const page = file?.template.pages[pageIndex];
    if (!file || !page) return EMPTY_RESULT;
    const cached = this._cache;
    if (cached !== null && cached.revision === revision && cached.pageIndex === pageIndex
      && cached.locale === locale) {
      return cached.result;
    }
    const itemsByGrid = new Map<string, readonly GridItem[]>();
    for (const el of page.elements) {
      if (el.type === 'grid' && el.repeat !== undefined) {
        itemsByGrid.set(el.id, sampleItemsOf(el, file.template.sampleValues));
      }
    }
    let plan: SourcePagePlan | null = null;
    let error: SlipLayoutError | null = null;
    this._computations += 1;
    try {
      plan = planSourcePage(file.template.paper, page, itemsByGrid, locale);
    } catch (cause) {
      if (!(cause instanceof SlipLayoutError)) throw cause;
      error = cause;
    }
    const result = { plan, error };
    this._cache = { revision, pageIndex, locale, result };
    return result;
  }

  /** 캐시를 버려 다음 요청에서 계획을 다시 계산하게 합니다. */
  invalidate(): void {
    this._cache = null;
  }
}
