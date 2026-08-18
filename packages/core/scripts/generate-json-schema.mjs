/**
 * .slip JSON Schema 파일 생성 (ADR-022).
 * 사용: pnpm --filter @slipkit/core build && pnpm --filter @slipkit/core generate:schemas
 * 산출: schemas/slip-<version>.schema.json + schemas/slip.schema.json(최신 별칭)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_SCHEMA_VERSION, slipFileJsonSchema } from '../dist/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(packageRoot, 'schemas');
await mkdir(outDir, { recursive: true });

const json = JSON.stringify(slipFileJsonSchema(), null, 2) + '\n';
const versioned = join(outDir, `slip-${CURRENT_SCHEMA_VERSION}.schema.json`);
const latest = join(outDir, 'slip.schema.json');
await writeFile(versioned, json);
await writeFile(latest, json);
console.log(`generated: ${versioned}`);
console.log(`generated: ${latest}`);
