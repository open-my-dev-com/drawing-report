# Core API Guide

[한국어](core.md) · [日本語](core.ja.md)

`@omdc-slipkit/core` is a pure TypeScript library with no DOM or browser dependencies.
It works in Node.js as-is.

You can send a `.slip` file to core without installing any UI packages, enabling server-side PDF generation and slip verification.

## Table of Contents

1. [Installation](#1-installation)
2. [File Parsing & Serialization](#2-file-parsing--serialization)
3. [Building a voucher — filling a template with values](#3-building-a-voucher--filling-a-template-with-values)
4. [Formulas](#4-formulas)
5. [PDF Rendering](#5-pdf-rendering)
6. [Integrity (Hash & Signature)](#6-integrity-hash--signature)
7. [Backend Integration](#7-backend-integration)

### Reference Pages

- **[Formula Function Reference](formula.en.md)** — usage, parameters, and examples for all 32 built-in functions
- **[Type Reference](types.en.md)** — field definitions and defaults for `SlipFile`, fonts, `StorageAdapter`, `IntegrityJwk`, and more

---

## 1. Installation

If your project uses a UI package (`elements` / `react` / `vue`), core is included as a transitive dependency (no separate install needed).
When separating UI from a slip server, install core directly on the server.

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

// Validate a pre-parsed JSON value (e.g. JSON.parse result)
const validated = validateSlipFile(jsonValue);
```

- `parseSlipFile` takes a JSON string and returns a `SlipFile` object. Older schema versions are automatically migrated to the current version.
- `serializeSlipFile` converts a `SlipFile` object to a JSON string.
- `validateSlipFile` validates an already-parsed JSON value (e.g. a `JSON.parse` result) and returns a `SlipFile`. Throws `SlipParseError` if invalid.

## 3. Building a voucher — filling a template with values

To create a voucher with core alone (no UI), you **fill a template with values** and assemble the voucher
object yourself. The template is linked as a `.slip` file, but the parameter data is passed via a `values`
object.

### Shape of the values object

Keys are the template's **parameter physical names (`key`)**; the value depends on the parameter type.

| Parameter type | Value |
|---|---|
| text · number · date · boolean | the value itself (`'2026-08-24'` · `12000` · `true`) |
| image | a `data:` base64 string (no external URLs — core does not use the network) |
| list | an **array of objects** — each item keyed by its sub-field `key` |

```ts
const values = {
  tradeDate: '2026-08-24',          // a date parameter
  items: [                          // a list parameter — filled by sub-field key
    { itemName: 'Pencil', spec: 'HB', quantity: 12, unitPrice: 300, amount: 3600 },
    { itemName: 'Notebook', spec: 'A5', quantity: 5, unitPrice: 1200, amount: 6000 },
  ],
  // totalAmount is computed by the formula SUM(items.amount), so you may omit it
};
```

### Template + values → voucher

`buildVoucher(template, values)` does it all: embeds the template snapshot, normalizes empty number
parameters to 0 (ADR-044), and assembles the voucher. Pass the result to `renderSlipToPdf` to get a PDF
with the values filled in.

```ts
import { parseSlipFile, buildVoucher, renderSlipToPdf } from '@omdc-slipkit/core';

const template = parseSlipFile(templateJson);
if (template.kind !== 'template') throw new Error('not a template file');

const voucher = buildVoucher(template, values);   // an unissued (issued: false) voucher
const pdf = await renderSlipToPdf(voucher, { fonts });
```

- Fields computed by a formula (e.g. the total) don't need to be in `values` — they're computed at render time.
- The voucher embeds the whole template at creation time as `templateSnapshot`, so it renders the same even
  if the template changes later (ADR-008). The voucher `buildVoucher` returns shares no references with the
  input template or values.
- When a list has more items than fit on one page, pages are added automatically.
- To finalize the values and record a tamper-evidence mark, record integrity with `computeIntegrity` and set
  `issued: true` — see [§6 Integrity](#6-integrity-hash--signature).

> You can also assemble it by hand — a voucher is just `{ schemaVersion, kind: 'voucher', templateSnapshot,
> values, issued }`; `buildVoucher` merely adds a deep copy and number normalization. Validate a hand-built
> object with `validateSlipFile(voucher)`.

## 4. Formulas

```ts
import { parseFormula, evaluateFormula } from '@omdc-slipkit/core';

const ast = parseFormula('SUM(items.amount)');
const result = evaluateFormula(ast, {
  values: { items: { amount: [1000, 2000, 3000] } },
});
// result → 6000
```

32 built-in functions are supported (SUM, IF, ROUND, CONCAT, etc.). See **[Formula Function Reference](formula.en.md)** for details on each function.
Unregistered function names are rejected at parse time.

## 5. PDF Rendering

```ts
import { renderSlipToPdf } from '@omdc-slipkit/core';

const pdfBytes = await renderSlipToPdf(file, {
  fonts: [{ name: 'Pretendard', data: fontBuffer }],
});
// pdfBytes: Uint8Array — raw PDF file bytes
```

- Register the correct fonts via `fonts`. Incorrect or missing fonts may cause garbled text in the PDF output.
- The `locale` option controls number formatting in formula output (default `'ko-KR'`).
- See [Type Reference](types.en.md#font) for font type details.

## 6. Integrity (Hash & Signature)

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

Verifies the integrity of a `.slip` file.
Uses SHA-256 hashing + JWS (ES256) signing with RFC 8785 (JCS) canonicalization, implemented via Web Crypto API.

## 7. Backend Integration

SlipKit is a server-less embeddable library that integrates with external backends through `.slip` files.
See [ARCHITECTURE.md](../ARCHITECTURE.md) for detailed diagrams and patterns.

### Flow 1: Backend sends JSON request → receives PDF binary

1. Backend sends the `.slip` template and voucher data (values) as JSON.
2. Core assembles the voucher, evaluates formulas, and issues it.
3. The issued voucher is rendered to PDF binary and returned to the backend.

### Flow 2: Server-side batch PDF generation (e.g. nightly jobs)

When unattended issuance is needed at a specific time (nightly batch, etc.), run core in Node.

```ts
import { parseSlipFile, renderSlipToPdf, computeIntegrity } from '@omdc-slipkit/core';

const file = parseSlipFile(jsonFromDb);
const issued = await computeIntegrity(file);
const pdf = await renderSlipToPdf(issued, { fonts });
```

Core runs on Node 20+ only.
