# Core API Guide

[한국어](core.md)

`@omdc-slipkit/core` is a pure TypeScript library with no DOM or browser dependencies.
It works in Node.js as-is, making it suitable for server-side PDF generation and slip verification.

## Table of Contents

1. [Installation](#1-installation)
2. [File Parsing & Serialization](#2-file-parsing--serialization)
3. [Formulas](#3-formulas)
4. [PDF Rendering](#4-pdf-rendering)
5. [Integrity (Hash & Signature)](#5-integrity-hash--signature)
6. [Backend Integration](#6-backend-integration)

### Reference Pages

- **[Type Reference](types.en.md)** — field definitions and defaults for `SlipFile`, fonts, `StorageAdapter`, `IntegrityJwk`, and more

---

## 1. Installation

If you're using a UI package (`elements` / `react` / `vue`), core is included as a transitive dependency — no separate install needed.
Install it directly only when using core standalone on the server.

```bash
npm install @omdc-slipkit/core
```

## 2. File Parsing & Serialization

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  validateSlipFile,
} from '@omdc-slipkit/core';

// JSON string → SlipFile (auto-migrates older versions)
const file = parseSlipFile(jsonString);

// SlipFile → JSON string
const json = serializeSlipFile(file);

// Validate issuing rules (check if file is ready to issue)
const errors = validateSlipFile(file);
```

- `parseSlipFile` takes a JSON string and returns a `SlipFile`. Older schema versions
  are automatically migrated to the current version.
- `serializeSlipFile` converts a `SlipFile` object to a JSON string.
- `validateSlipFile` validates an already-parsed JSON value (e.g. a `JSON.parse` result)
  and returns a `SlipFile`. Throws `SlipParseError` if invalid.

## 3. Formulas

```ts
import { parseFormula, evaluateFormula } from '@omdc-slipkit/core';

const ast = parseFormula('SUM(items.amount)');
const result = evaluateFormula(ast, {
  bindings: { /* binding values */ },
  items: { amount: [1000, 2000, 3000] },
});
// result → 6000
```

29 built-in functions are supported (SUM, IF, ROUND, TEXT, etc.).
No `eval` or `new Function` is used — unregistered function names are rejected at parse time.

## 4. PDF Rendering

```ts
import { renderSlipToPdf } from '@omdc-slipkit/core';

const pdfBytes = await renderSlipToPdf(file, {
  fonts: [{ name: 'Pretendard', data: fontBuffer }],
});
// pdfBytes: Uint8Array — raw PDF file bytes
```

- Pass Korean fonts in `fonts` to render Korean text correctly.
- The `locale` option controls number formatting in formula output (default `'ko-KR'`).
- See [Type Reference](types.en.md#font) for font type details.

## 5. Integrity (Hash & Signature)

```ts
import {
  computeIntegrity,
  verifyIntegrity,
  generateSigningKeyPair,
} from '@omdc-slipkit/core';

// Hash only
const hashed = await computeIntegrity(file);

// Hash + signature
const keyPair = await generateSigningKeyPair();
const signed = await computeIntegrity(file, { privateKey: keyPair.privateKey });

// Verify
const result = await verifyIntegrity(signed);
// result.hashValid, result.signatureValid
```

Uses SHA-256 hashing + JWS (ES256) signing with RFC 8785 (JCS) canonicalization,
implemented via Web Crypto API.

## 6. Backend Integration

SlipKit is a server-less embeddable library. Integration with external backends
is based on the `.slip` file (plain JSON) as the contract.
See [ARCHITECTURE.md](../ARCHITECTURE.md) for detailed diagrams and patterns.

### Default Pattern: Backend Only Handles JSON

1. Backend serves the template `.slip` and prepares voucher data (values) as JSON
2. The browser's core assembles the voucher, evaluates formulas, and issues it
3. The issued voucher `.slip` is sent back to the backend for storage

The backend doesn't need to parse the `.slip` — just store and relay the JSON.
Use the bundled JSON Schema for structural validation if needed.

### Server-Side PDF Generation

When unattended batch issuance is needed (e.g. nightly jobs), run core in Node:

```ts
import { parseSlipFile, renderSlipToPdf, computeIntegrity } from '@omdc-slipkit/core';

const file = parseSlipFile(jsonFromDb);
const issued = await computeIntegrity(file);
const pdf = await renderSlipToPdf(issued, { fonts });
```

Core is pure TypeScript and runs on Node 20+ without modification.
