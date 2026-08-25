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
| `parameters?` | `ParameterDef[]` | Parameter definitions — physical key (`key`), display label (`label`), value type (`valueType`), and item fields (`fields`, list only) |
| `sampleValues?` | `Record<string, JsonValue>` | Sample values for preview (not included in issued vouchers) |

### Voucher

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `string` | Schema version |
| `kind` | `'voucher'` | File type |
| `templateSnapshot` | same as template body | Full template snapshot from creation time |
| `values` | `Record<string, JsonValue>` | Parameter key → filled value |
| `issued` | `boolean` | Whether the voucher has been issued |

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

### Encryption on save (optional, ADR-055)

Both bundled adapters can **encrypt automatically on save** via the `encryption` constructor option.
When enabled, saving locks the `.slip` content with core's encryption (AES-256-GCM); loading unlocks it
automatically.

```ts
interface StorageEncryption {
  enabled: boolean;                        // whether to encrypt on save (false/omitted = plaintext)
  key?: string | Uint8Array;               // key to lock with — passphrase or 32-byte raw key (falls back to the sample key)
  previousKeys?: (string | Uint8Array)[];  // extra keys tried on load (for key rotation)
}
```

```ts
import { IndexedDbStorage, type StorageEncryption } from '@omdc-slipkit/elements';

// pass it to the constructor's encryption option — LocalFileStorage is the same
const storage = new IndexedDbStorage({
  encryption: { enabled: true, key: hostKey },   // a host-supplied passphrase or raw key
});
```

| Field | Value | Behavior |
|---|---|---|
| `enabled` | `boolean` | `true` encrypts on save; `false` (or omitting `encryption`) stores plaintext |
| `key` | `string \| Uint8Array` (optional) | the key to lock with on save — a passphrase or a 32-byte raw key |
| `previousKeys` | `(string \| Uint8Array)[]` (optional) | extra keys tried on load — for key rotation |

- With `enabled: true` and no `key`, a **sample default key** (`SAMPLE_ENCRYPTION_KEY`) is used. This key
  is baked into the source and is **not real security** — supply your own `key` to actually protect files.
- **Loading auto-detects** encrypted files regardless of the setting — old plaintext saves still load.
- `IndexedDbStorage` encrypts only the body and keeps the title plaintext (so titles show in the list).
  Sensitive content lives in the body (parameters, direct input, images) and is encrypted.
- Key management is the host's responsibility (ADR-054). For encryption when using core alone, see
  [Core Guide §7](core.en.md#7-file-encryption-optional).

**Turning it on later, or changing the key**

- **Off → on**: set `enabled: true` and saves from then on are locked. Files already stored as plaintext
  aren't locked retroactively — they get locked when you open and **save them again.**
- **Key rotation**: put the new key in `key` and the old key in `previousKeys`. On load, if the current key
  doesn't match, the previous keys are tried in turn, so old files still open — and **saving them again
  migrates them to the new key.**
- **Turning it off**: setting `enabled: false` leaves already-locked files as envelopes — keep `key` (and
  `previousKeys`) to keep reading them; only new saves become plaintext.

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
