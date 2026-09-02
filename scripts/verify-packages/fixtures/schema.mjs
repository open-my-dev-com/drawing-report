// JSON Schema 공개 하위 경로: 최신 스키마와 버전 고정 스키마를 패키지 이름으로 읽는다.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const latest = require('@omdc-slipkit/core/schemas/slip.schema.json');
const pinned = require('@omdc-slipkit/core/schemas/slip-0.1.0.schema.json');
for (const [name, schema] of [['slip.schema.json', latest], ['slip-0.1.0.schema.json', pinned]]) {
  if (typeof schema !== 'object' || schema === null || typeof schema.$schema !== 'string') {
    throw new Error(`${name} is not a JSON Schema document`);
  }
}
console.log('schema ok');
