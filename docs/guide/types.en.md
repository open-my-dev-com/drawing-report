# Type Reference

[한국어](types.md) · [日本語](types.ja.md)

Key types your host app interacts with, including field descriptions and default values.
For the full schema specification, see [SPEC.md](../SPEC.md).

---

## SlipFile

The top-level type for a `.slip` file. The `kind` field distinguishes templates from vouchers.

```ts
import type { SlipFile } from '@omdc-slipkit/core';
```

### Template

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `string` | Schema version (semver) |
| `kind` | `'template'` | File type |
| `template` | object | Template body (see below) |

Template body (`template`):

| Field | Type | Description |
|---|---|---|
| `meta` | `{ title, createdAt?, updatedAt? }` | Template metadata |
| `paper` | `PaperSize` | Paper size and margins (unit: mm) |
| `pages` | `SlipPage[]` | Page array (at least 1) |
| `assets` | `AssetEntry[]` | Embedded resources (images, etc.) |
| `bindings?` | `BindingDef[]` | Binding definitions — physical key (`key`) and display label (`label`) |
| `sampleValues?` | `Record<string, JsonValue>` | Sample values for preview (not included in issued vouchers) |

### Voucher

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `string` | Schema version |
| `kind` | `'voucher'` | File type |
| `templateSnapshot` | same as template body | Full template snapshot from creation time |
| `values` | `Record<string, JsonValue>` | Binding key → filled value |
| `issued` | `boolean` | Whether the voucher has been issued |
| `integrity?` | `Integrity` | Hash & signature record (required when issued) |

---

## Font

Font object used for PDF rendering and previews. Both core's `RenderOptions.fonts` and a
component's `settings.getFonts` (ADR-040) accept an array of these.

```ts
{ name: string; data: Uint8Array; fallback?: boolean }
```

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Font name (matched against names used in the template) |
| `data` | `Uint8Array` | — | Font file bytes (OTF/TTF) |
| `fallback` | `boolean` | `false` | If `true`, used as the fallback font (only one allowed). When omitted for all fonts, the first font becomes the fallback |

**When unspecified**: If no `settings` is passed to a component (`<slip-designer>`,
`<slip-form>`, `<slip-viewer>`), the bundled font for the locale is loaded automatically
(Pretendard for Korean/English, Noto Sans JP for Japanese). See
[Bundled Fonts & Presets](fonts-and-presets.en.md) for details.

---

## SlipPreset

A template preset for the designer's preset menu.
Pass an array to `<slip-designer>`'s `presets` property to replace the built-in presets.

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier |
| `name` | `string` | Display name in the preset menu |
| `create` | `() => SlipTemplateFile` | Called to create a fresh template file |

**When unspecified**: If `presets` is not set, the two built-in presets (trade statement,
invoice) appear in the menu. Their content is in Korean.

---

## StorageAdapter

Interface for the "save/load my templates" feature.
Pass an implementation to `<slip-designer>`'s `storage` property to show save/load buttons.

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';
```

| Method | Signature | Description |
|---|---|---|
| `save` | `(id: string, file: SlipFile) => Promise<void>` | Save a file (overwrites if same id) |
| `load` | `(id: string) => Promise<SlipFile>` | Load a file |
| `delete` | `(id: string) => Promise<void>` | Delete a file |
| `list` | `(filter?: SlipListFilter, cursor?: string) => Promise<SlipListPage>` | List files with pagination |

Errors are thrown as `SlipStorageError` with a `code` to identify the cause:

| code | Meaning |
|---|---|
| `'not-found'` | No file with that id |
| `'unsupported'` | This adapter doesn't support this operation |
| `'io'` | Storage I/O failure |

**When unspecified**: If `storage` is not set, save/load buttons don't appear in the designer.

### Bundled Implementations

| Class | Import | Storage |
|---|---|---|
| `IndexedDbStorage` | `@omdc-slipkit/elements` | Browser IndexedDB. Supports title/kind filtering and cursor-based pagination |
| `LocalFileStorage` | `@omdc-slipkit/elements` | Save triggers download; load opens file picker. `delete` and `list` throw `unsupported` |

---

## IntegrityJwk

EC P-256 key in JWK format for signing and verifying integrity.

```ts
import type { IntegrityJwk } from '@omdc-slipkit/core';
```

| Field | Type | Description |
|---|---|---|
| `kty` | `string` | Key type (`'EC'`) |
| `crv` | `string` | Curve (`'P-256'`) |
| `x` | `string` | Public key x coordinate (base64url) |
| `y` | `string` | Public key y coordinate (base64url) |
| `d` | `string` | Private key (base64url) — needed for signing only, not for verification |
| `kid` | `string` | Key identifier (optional) |

To generate a key pair:

```ts
import { generateSigningKeyPair } from '@omdc-slipkit/core';

const { privateKey, publicKey } = await generateSigningKeyPair();
```

**When unspecified**: If `signingKey` is not passed to `<slip-form>`, only a SHA-256 hash
is recorded on issue — no signature.

---

## RenderOptions

Options for `renderSlipToPdf` and `createPdfRenderer`.

```ts
import type { RenderOptions } from '@omdc-slipkit/core';
```

| Field | Type | Default | Description |
|---|---|---|---|
| `fonts` | `Font[]` | — | Fonts for PDF rendering. Required for Korean and Japanese documents |
| `locale` | `string` | `'ko-KR'` | BCP-47 locale for formula formatting functions (number grouping, etc.) |
