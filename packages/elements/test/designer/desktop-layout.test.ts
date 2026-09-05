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

  it('수식 편집 모달은 입력을 위에, 참조를 아래에 두고 함수 상세는 고른 뒤에만 옆에 편다', () => {
    const layout = ruleBody(dialogsStyles.cssText, '.formula-layout');
    expect(layout).toMatch(/flex-direction:\s*column/);
    // 참조 영역의 배치 기준은 뷰포트가 아니라 모달 너비입니다.
    expect(layout).toMatch(/container-type:\s*inline-size/);
    expect(layout).toMatch(/container-name:\s*formula-modal/);

    // 고른 함수가 없으면 목록이 너비 전체를 쓰고, 고르면 목록·상세 두 열이 됩니다.
    const functions = ruleBody(dialogsStyles.cssText, '.fn-panel');
    expect(functions).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
    const withDetail = ruleBody(dialogsStyles.cssText, '.fn-panel.with-detail');
    expect(withDetail).toMatch(/grid-template-columns:\s*minmax\(0, 44fr\) minmax\(0, 56fr\)/);
  });

  it('좁은 모달에서는 모달 너비를 기준으로 함수 목록과 상세를 위아래로 쌓는다', () => {
    const css = dialogsStyles.cssText;
    const container = css.indexOf('@container formula-modal (max-width: 899px)');
    expect(container).toBeGreaterThanOrEqual(0);
    const stacked = ruleBody(css.slice(container), '.fn-panel.with-detail');
    expect(stacked).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(stacked).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    // 목록과 상세는 각자 안에서 스크롤해 입력란과 하단 버튼을 밀지 않습니다.
    expect(ruleBody(css, '.fn-list')).toMatch(/overflow-y:\s*auto/);
    expect(ruleBody(css, '.fn-detail')).toMatch(/overflow-y:\s*auto/);
  });
});
