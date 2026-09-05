// 용지를 넘는 요소 — PDF 페이지 크기·수가 커지지 않고 파일 좌표도 그대로 남는지
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  parseSlipFile,
  renderSlipToPdf,
  serializeSlipFile,
  type SlipTemplateFile,
} from '../src/index.js';

const MM_TO_PT = 72 / 25.4;

/** 오른쪽을 넘는 사각형과 아래쪽을 넘는 글을 담은 A4 양식 */
function makeOverflowFile(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: { title: '용지 밖' },
      paper: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{
        elements: [
          // x + width = 250 > 210
          { type: 'rect', id: 'wide', name: '넓은 사각형', position: { x: 190, y: 20 }, width: 60, height: 20, borderWidth: 0.5 },
          // y + height = 310 > 297
          { type: 'text', id: 'low', name: '아래 글', position: { x: 20, y: 290 }, width: 100, height: 20, content: '용지 밖 글' },
        ],
      }],
      assets: [],
    },
  };
}

describe('용지를 넘는 요소의 PDF 렌더링', () => {
  it('페이지는 한 장이고 크기는 용지 크기 그대로이며 요소 크기도 바뀌지 않는다', async () => {
    const file = makeOverflowFile();
    const pdf = await renderSlipToPdf(file);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.abs(width - 210 * MM_TO_PT)).toBeLessThan(0.5);
    expect(Math.abs(height - 297 * MM_TO_PT)).toBeLessThan(0.5);

    const wide = file.template.pages[0]!.elements[0] as { width: number; position: { x: number } };
    expect(wide.width).toBe(60);
    expect(wide.position.x).toBe(190);
  }, 30_000);

  it('직렬화 후 다시 파싱해도 용지를 넘는 좌표를 보정하지 않는다', () => {
    const parsed = parseSlipFile(serializeSlipFile(makeOverflowFile()));
    expect(parsed.kind).toBe('template');
    const [wide, low] = (parsed as SlipTemplateFile).template.pages[0]!.elements as {
      position: { x: number; y: number }; width: number; height: number;
    }[];
    expect(wide!.position).toEqual({ x: 190, y: 20 });
    expect(wide!.width).toBe(60);
    expect(low!.position).toEqual({ x: 20, y: 290 });
    expect(low!.height).toBe(20);
  });
});
