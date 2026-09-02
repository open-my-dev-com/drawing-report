// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { designerStyles } from '../../src/styles/slip-designer.styles.js';
import { layoutStyles } from '../../src/styles/designer/layout.styles.js';
import { dialogsStyles } from '../../src/styles/designer/dialogs.styles.js';

/** 스타일 시트에서 지정한 선택자의 선언 블록을 반환합니다. */
function ruleBody(cssText: string, selector: string): string {
  const start = cssText.indexOf(`${selector} {`);
  expect(start, `규칙을 찾지 못했습니다: ${selector}`).toBeGreaterThanOrEqual(0);
  const end = cssText.indexOf('}', start);
  return cssText.slice(start, end);
}

describe('<slip-designer> 데스크톱 전용 배치', () => {
  it('디자이너 스타일에 뷰포트 기준 @media 규칙이 없다', () => {
    for (const sheet of designerStyles) {
      expect(sheet.cssText).not.toContain('@media');
    }
  });

  it('호스트는 세 열 데스크톱 구성과 최소 영역 1280×640을 선언한다', () => {
    const host = ruleBody(layoutStyles.cssText, ':host');
    expect(host).toMatch(/grid-template-columns:\s*176px 1fr 300px/);
    expect(host).toMatch(/min-width:\s*1280px/);
    expect(host).toMatch(/min-height:\s*640px/);
    expect(host).toMatch(/overflow:\s*hidden/);
  });

  it('수식 편집 모달은 편집과 참조를 두 열로 나란히 둔다', () => {
    const layout = ruleBody(dialogsStyles.cssText, '.formula-layout');
    expect(layout).toMatch(/grid-template-columns:\s*minmax\(0, 42fr\) minmax\(0, 58fr\)/);
    const functions = ruleBody(dialogsStyles.cssText, '.fn-panel');
    expect(functions).toMatch(/grid-template-columns:\s*minmax\(0, 44fr\) minmax\(0, 56fr\)/);
  });
});
