// Node.js PDF 생성: 동봉 폰트 하위 경로와 core만으로 PDF 바이트를 만든다.
import { createSlipKit } from '@omdc-slipkit/core';
import { PRETENDARD_FONTS } from '@omdc-slipkit/elements/fonts/pretendard';
import { template } from './template.mjs';

const kit = createSlipKit({ locale: 'en', getFonts: () => PRETENDARD_FONTS });
const pdf = await kit.render(template);
const head = new TextDecoder().decode(pdf.slice(0, 4));
if (!(pdf instanceof Uint8Array) || head !== '%PDF') {
  throw new Error(`unexpected PDF output: ${pdf?.constructor?.name} ${head}`);
}
console.log(`pdf ok ${pdf.length} bytes`);
