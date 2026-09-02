// 브라우저 PDF 생성: 공개 export만으로 PDF를 만들고 결과를 페이지에 남긴다.
import { createSlipKit } from '@omdc-slipkit/core';
import { loadDefaultFonts } from '@omdc-slipkit/elements';
import { template } from '../template.mjs';

declare global {
  interface Window {
    __slipkitPdf: Promise<{ isUint8Array: boolean; head: string; length: number }>;
  }
}

window.__slipkitPdf = (async () => {
  const kit = createSlipKit({ locale: 'en', getFonts: () => loadDefaultFonts('en') });
  const pdf = await kit.render(template as never);
  const summary = {
    isUint8Array: pdf instanceof Uint8Array,
    head: new TextDecoder().decode(pdf.slice(0, 4)),
    length: pdf.length,
  };
  document.getElementById('result')!.textContent = JSON.stringify(summary);
  return summary;
})();
