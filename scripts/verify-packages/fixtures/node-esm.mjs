// ESM 소비자: 패키지 이름으로만 불러와 파싱·검증·수식 API가 동작하는지 확인한다.
import { createSlipKit, parseSlipFile, validateSlipFile } from '@omdc-slipkit/core';
import { template } from './template.mjs';

const text = JSON.stringify(template);
const parsed = parseSlipFile(text);
if (parsed.kind !== 'template') throw new Error(`kind: ${parsed.kind}`);
// validateSlipFile은 검증을 통과한 파일을 돌려주고 실패하면 SlipParseError를 던진다.
const validated = validateSlipFile(parsed, { locale: 'en' });
if (validated.kind !== 'template') throw new Error(`validated kind: ${validated.kind}`);
let rejected = false;
try {
  validateSlipFile({ ...parsed, schemaVersion: 'bogus' });
} catch (error) {
  rejected = error instanceof Error && error.name === 'SlipParseError';
  if (!rejected) throw error;
}
if (!rejected) throw new Error('invalid schemaVersion was not rejected');
const kit = createSlipKit({ locale: 'en' });
if (typeof kit.render !== 'function') throw new Error('createSlipKit().render is missing');
console.log('esm ok');
