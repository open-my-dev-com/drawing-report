/**
 * 페이지 계획 계층의 공개 진입점.
 *
 * @remarks
 * 여기서 내보내는 이름은 `@omdc-slipkit/elements`와 `@omdc-slipkit/mcp`가 화면·PDF·미리보기에
 * 같은 페이지 계획을 쓰기 위해 가져가는 패키지 연동 API다. 계획을 계산하는 `planGrid`·
 * `visiblePageRange`와 그 입력 타입(`GridFlow`·`ElementPlacement`·`PlanPaper`)은 계획 계층의
 * 구현 세부이므로 공개하지 않는다 — core 안에서는 `./grid-plan.js`·`./page-plan.js`에서 직접
 * 가져온다.
 */
export { SlipLayoutError } from './errors.js';
export { type GridFragment, type GridItem, type GridPlan, type PlannedBand } from './grid-plan.js';
export { filterVisibleOnPage, planSourcePage, type SourcePagePlan } from './page-plan.js';
