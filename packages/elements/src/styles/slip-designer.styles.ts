/**
 * `<slip-designer>`의 스타일 시트.
 *
 * @remarks
 * 영역별 파일로 나누되 적용 순서는 그대로 둔다 — 뒤쪽 규칙이 앞쪽을 덮으므로
 * 순서를 바꾸면 화면이 달라진다.
 */
import { layoutStyles } from './designer/layout.styles.js';
import { sidebarStyles } from './designer/sidebar.styles.js';
import { canvasStyles } from './designer/canvas.styles.js';
import { propertiesStyles } from './designer/properties.styles.js';
import { dialogsStyles } from './designer/dialogs.styles.js';
import { gridStyles } from './designer/grid.styles.js';

export { RULER_PX } from './designer/metrics.js';

/** `<slip-designer>` 스타일 — 선언 순서대로 적용한다 */
export const designerStyles = [
  layoutStyles,
  sidebarStyles,
  canvasStyles,
  propertiesStyles,
  dialogsStyles,
  gridStyles,
];
