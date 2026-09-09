// CommonJS 소비자입니다. Node 22의 require(esm)으로 패키지 이름을 불러옵니다.
const core = require('@omdc-slipkit/core');
const { PRETENDARD_FONTS } = require('@omdc-slipkit/elements/fonts/pretendard');

for (const name of ['parseSlipFile', 'createSlipKit', 'renderSlipToPdf', 'encryptSlipFile']) {
  if (typeof core[name] !== 'function') throw new Error(`${name} is not exported for require`);
}
if (!Array.isArray(PRETENDARD_FONTS) || PRETENDARD_FONTS.length === 0) {
  throw new Error('PRETENDARD_FONTS is empty');
}
console.log('cjs ok');
