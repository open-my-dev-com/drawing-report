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
6. [Backend Integration](#6-backend-integration)
7. [File encryption (optional)](#7-file-encryption-optional)

### Reference Pages

- **[Formula Function Reference](formula.en.md)** — usage, parameters, and examples for all 32 built-in functions
- **[Type Reference](types.en.md)** — field definitions and defaults for `SlipFile`, fonts, `StorageAdapter`, and more

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
parameters to 0 (ADR-044), and assembles the voucher. Pass the result to `render` to get a PDF
with the values filled in.

```ts
import { parseSlipFile, createSlipKit } from '@omdc-slipkit/core';

const slip = createSlipKit({ getFonts });   // configure once (see §5)

const template = parseSlipFile(templateJson);
if (template.kind !== 'template') throw new Error('not a template file');

const voucher = slip.buildVoucher(template, values);   // an unissued (issued: false) voucher
const pdf = await slip.render(voucher);
```

- Fields computed by a formula (e.g. the total) don't need to be in `values` — they're computed at render time.
- The voucher embeds the whole template at creation time as `templateSnapshot`, so it renders the same even
  if the template changes later (ADR-008). The voucher `buildVoucher` returns shares no references with the
  input template or values.
- When a list has more items than fit on one page, pages are added automatically.

### Issuing (finalizing)

Issuing means finalizing the values and **locking** them — set `issued: true` and the entry form stops
accepting input. An issued voucher renders the same way.

```ts
const issued = { ...voucher, issued: true };
const pdf = await slip.render(issued);
```

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

Configuration such as fonts and locale is given **once** via `createSlipKit`; `render(file)` then takes
only the file — you don't pass fonts on each render call (ADR-056).

```ts
import { createSlipKit } from '@omdc-slipkit/core';

const slip = createSlipKit({
  getFonts: () => [{ name: 'Pretendard', data: fontBuffer, fallback: true }],
  locale: 'ko-KR',
});

const pdfBytes = await slip.render(file);   // Uint8Array — raw PDF file bytes
```

- Fonts are supplied once via `getFonts` — a sync array or a Promise from a server folder (ADR-040).
  Korean/Japanese documents must supply fonts, or text may be garbled.
- `locale` controls number formatting in formula output (FORMAT_NUMBER, etc.; default `'ko-KR'`).
- See [Type Reference](types.en.md#font) for font type details.
- The low-level `createPdfRenderer(config)` / `renderSlipToPdf(file, config)` also exist, but prefer
  `createSlipKit`, which holds config once and also offers `buildVoucher`, `evaluate`, and `encrypt`/`decrypt`.

## 6. Backend Integration

SlipKit is a server-less embeddable library that integrates with external backends through `.slip` files.
See [ARCHITECTURE.md](../ARCHITECTURE.md) for detailed diagrams and patterns.

### Flow 1: Backend sends JSON request → receives PDF binary

1. Backend sends the `.slip` template and voucher data (values) as JSON.
2. Core assembles the voucher, evaluates formulas, and issues it.
3. The issued voucher is rendered to PDF binary and returned to the backend.

### Flow 2: Server-side batch PDF generation (e.g. nightly jobs)

When unattended issuance is needed at a specific time (nightly batch, etc.), run core in Node.

```ts
import { parseSlipFile, createSlipKit } from '@omdc-slipkit/core';

const slip = createSlipKit({ getFonts });   // configure once
const file = parseSlipFile(jsonFromDb);
const pdf = await slip.render(file);
```

Core runs on Node 20+ only.

## 7. File encryption (optional)

A `.slip` is JSON, so opening it in an editor reveals everything. To lock a sensitive template or
voucher, encrypt it (AES-256-GCM, ADR-054). Give the key to the config **once** and `slip.encrypt`/
`slip.decrypt` use it (ADR-056).

```ts
import { createSlipKit, isEncryptedSlipFile } from '@omdc-slipkit/core';

// Key given once — a passphrase (string) or a 32-byte raw key (Uint8Array)
const slip = createSlipKit({ encryption: { key: 'secret-passphrase' } });

const locked = await slip.encrypt(file);    // envelope JSON string
const file2 = await slip.decrypt(locked);   // decrypts and validates

isEncryptedSlipFile(locked);   // true — distinguishes it from a plain .slip
```

- Override the key per file with an argument — `slip.encrypt(file, otherKey)`. After a key change, put the
  old key in `encryption.previousKeys` and `decrypt` still opens files locked with it (rotation).
- The standalone functions work without a config instance too — `encryptSlipFile(file, key)` · `decryptSlipFile(json, key)`.
- **Key management is the host's responsibility** — core neither creates nor stores keys.
- A locked file is **not a standard `.slip`.** The recipient must decrypt it with the same key, so it
  can't be exchanged between systems as-is.
- A wrong key or a tampered file is rejected at decryption (AES-GCM authentication).
- For the envelope format, see [SPEC §8](../SPEC.md).
- To encrypt automatically when saving from the UI (the designer, etc.), don't call the core functions
  directly — use the storage adapter's `encryption` option (ADR-055): see
  [Type Reference](types.en.md#encryption-on-save-optional-adr-055).