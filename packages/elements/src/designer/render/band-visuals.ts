/**
 * 행 구간 역할의 표시 이름, 설명과 아이콘.
 *
 * @remarks
 * 값이 아니라 화면에 보이는 것이라 렌더 계층에 둔다.
 * 캔버스의 역할 메뉴와 속성 패널의 행 구간 목록이 같은 표기를 쓴다.
 */

import type { TemplateResult } from 'lit';
import type { GridBandPlacement } from '@omdc-slipkit/core';
import { icons } from '../../icons.js';
import type { DesignerStrings } from '../../strings.js';

/**
 * 행 구간 역할의 표시 이름을 반환한다.
 *
 * @param s - UI 문구 사전
 * @param placement - 행 구간 역할
 * @returns 표시 이름
 */
export function bandLabel(s: DesignerStrings, placement: GridBandPlacement): string {
  switch (placement) {
    case 'before-data': return s.bandBeforeData;
    case 'page-start': return s.bandPageStart;
    case 'group-start': return s.bandGroupStart;
    case 'item': return s.bandItem;
    case 'group-end': return s.bandGroupEnd;
    case 'after-data': return s.bandAfterData;
    case 'page-end': return s.bandPageEnd;
  }
}

/**
 * 행 구간이 출력되는 시점과 대표 용도를 설명한다.
 *
 * @param s - UI 문구 사전
 * @param placement - 행 구간 역할
 * @returns 설명 문구
 */
export function bandDescription(s: DesignerStrings, placement: GridBandPlacement): string {
  switch (placement) {
    case 'before-data': return s.bandBeforeDataHelp;
    case 'page-start': return s.bandPageStartHelp;
    case 'group-start': return s.bandGroupStartHelp;
    case 'item': return s.bandItemHelp;
    case 'group-end': return s.bandGroupEndHelp;
    case 'after-data': return s.bandAfterDataHelp;
    case 'page-end': return s.bandPageEndHelp;
  }
}

/**
 * 행 구간 역할을 나타내는 아이콘을 반환한다.
 *
 * @param placement - 행 구간 역할
 * @returns 아이콘 조각
 */
export function bandIcon(placement: GridBandPlacement): TemplateResult {
  switch (placement) {
    case 'before-data': return icons.pagePrev;
    case 'page-start': return icons.up;
    case 'group-start': return icons.treeOpen;
    case 'item': return icons.gridElement;
    case 'group-end': return icons.treeClosed;
    case 'after-data': return icons.pageNext;
    case 'page-end': return icons.down;
  }
}
