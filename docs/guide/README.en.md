# SlipKit Integration Guide

[한국어](README.md) · [日本語](README.ja.md)

How to install SlipKit and embed the form designer, data-entry form, and viewer in your app.

## Table of Contents

1. [Installation](#1-installation)
2. [Quick Start](#2-quick-start)
3. [Component API](#3-component-api)
4. [Events](#4-events)
5. [Storage Adapters](#5-storage-adapters)
6. [Font Configuration](#6-font-configuration)
7. [Locale](#7-locale)

### Related Documents

- **[Core API Guide](core.en.md)** — parsing, formulas, PDF rendering, integrity, backend integration (including standalone Node.js usage)
- **[Formula Function Reference](formula.en.md)** — usage, parameters, and examples for all 32 built-in functions
- **[Type Reference](types.en.md)** — field definitions and defaults for `SlipFile`, fonts, `SlipPreset`, `StorageAdapter`, `IntegrityJwk`, and more
- **[Bundled Fonts & Presets](fonts-and-presets.en.md)** — Bundled fonts (Pretendard, Noto Sans JP), font supply, built-in presets (trade statement, invoice), and locale behavior

---

## 1. Installation

```bash
# Vanilla (use Web Components directly)
npm install @omdc-slipkit/elements

# React
npm install @omdc-slipkit/react
# peer dependency: react >= 19

# Vue
npm install @omdc-slipkit/vue
# peer dependency: vue >= 3.4
```

`@omdc-slipkit/core` is a transitive dependency of elements / react / vue,
so you don't need to install it separately.
Install it directly only when using core standalone on the server (e.g. PDF generation in Node).

```bash
npm install @omdc-slipkit/core
```

## 2. Quick Start

### Vanilla (Web Components)

```html
<script type="module">
  import '@omdc-slipkit/elements';
  import { serializeSlipFile } from '@omdc-slipkit/core';

  const designer = document.querySelector('slip-designer');

  // Listen for changes
  designer.addEventListener('slip-change', (e) => {
    const file = e.detail.file;  // SlipFile object
    console.log('Template changed:', file);
  });
</script>

<slip-designer src="{}"></slip-designer>
```

### React

```tsx
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/react';
import { serializeSlipFile, type SlipFile } from '@omdc-slipkit/core';

function App() {
  const [template, setTemplate] = useState(initialTemplate);

  return (
    <SlipDesigner
      src={serializeSlipFile(template)}
      onSlipChange={(file) => {
        if (file.kind === 'template') setTemplate(file);
      }}
    />
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/vue';
import { serializeSlipFile, type SlipFile } from '@omdc-slipkit/core';
import { shallowRef, computed } from 'vue';

const template = shallowRef(initialTemplate());
const src = computed(() => serializeSlipFile(template.value));

function onDesignerChange(file: SlipFile) {
  if (file.kind === 'template') template.value = file;
}
</script>

<template>
  <SlipDesigner :src="src" @slip-change="onDesignerChange" />
</template>
```

> In Vue, if you configure the build to recognize the `slip-` prefix as custom elements,
> you can use `<slip-designer>` directly without the wrapper.

## 3. Component API

### `<slip-designer>` — Form Designer

A visual editor for designing templates.

| Property | Type | Description |
|---|---|---|
| `src` | `string` | `.slip` JSON string (template file) |
| `locale` | `'ko' \| 'en' \| 'ja'` | UI language (default: `'ko'`) |
| `settings` | `SlipDesignerSettings` | Font supply (`getFonts`) plus paper-size supply/save (`getPaperSizes`/`savePaperSize`). Falls back to the bundled font for the locale (ADR-040/042) |
| `presets` | `SlipPreset[]` | Template list for the preset menu — replaces built-in presets if given |
| `storage` | `StorageAdapter` | Storage adapter for save/load of user templates |

| Event | detail | Description |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | Fires on every template edit |

### `<slip-form>` — Data-Entry Form

Fill a template with values and issue the slip. Shows a live PDF preview on the right.

| Property | Type | Description |
|---|---|---|
| `src` | `string` | `.slip` JSON string (template or in-progress voucher) |
| `locale` | `'ko' \| 'en' \| 'ja'` | UI language (default: `'ko'`) |
| `settings` | `SlipFontProvider` | Font supply (`getFonts`). Falls back to the bundled font for the locale (ADR-040/042) |
| `signingKey` | `IntegrityJwk` | ES256 private key (JWK) for signing on issue. Omit for hash-only |

| Event | detail | Description |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | Fires on every value edit with the in-progress voucher |
| `slip-issue` | `{ file: SlipFile }` | Fires when the voucher is issued with integrity record |

### `<slip-viewer>` — Viewer

Read-only viewer that renders a slip or template as PDF.

| Property | Type | Description |
|---|---|---|
| `src` | `string` | `.slip` JSON string |
| `locale` | `'ko' \| 'en' \| 'ja'` | UI language (default: `'ko'`) |
| `settings` | `SlipFontProvider` | Font supply (`getFonts`). Falls back to the bundled font for the locale (ADR-040/042) |

## 4. Events

All component events are `CustomEvent`s with `detail.file` containing the current `.slip` file object.
**Your host app receives component data through these events** — components don't save
anything on their own, so if you don't handle the events, edits are lost.

```ts
// Vanilla
designer.addEventListener('slip-change', (e) => {
  const file = e.detail.file;  // SlipFile
});

// React
<SlipDesigner onSlipChange={(file) => { /* SlipFile */ }} />

// Vue
<SlipDesigner @slip-change="(file) => { /* SlipFile */ }" />
```

### Event Types and Purpose

| Event | When | File kind | What to do |
|---|---|---|---|
| `slip-change` (designer) | On every template edit | `template` | Auto-save the template, sync state |
| `slip-change` (form) | On every value entry | `voucher` | Save draft voucher (resume after reload) |
| `slip-issue` (form) | When the issue button is pressed | `voucher` (with integrity) | Send the finalized voucher to the server |

### Usage Examples

```ts
// Designer: save the template when it changes
designer.addEventListener('slip-change', (e) => {
  const template = e.detail.file;
  fetch('/api/templates/' + templateId, {
    method: 'PUT',
    body: serializeSlipFile(template),
  });
});

// Form: send the issued voucher to the server
form.addEventListener('slip-issue', (e) => {
  const voucher = e.detail.file;
  fetch('/api/vouchers', {
    method: 'POST',
    body: serializeSlipFile(voucher),
  });
});
```

## 5. Storage Adapters

Implement the `StorageAdapter` interface to enable "save/load my templates" in the designer.
Two browser implementations ship with the elements package.

### IndexedDB Storage

Stores templates in the browser's IndexedDB. Supports title/kind filtering and cursor-based pagination.

```ts
import { IndexedDbStorage } from '@omdc-slipkit/elements';

const store = new IndexedDbStorage({ dbName: 'my-app-slips' });
```

### Local File Storage

Save triggers a file download; load opens a file picker dialog.

```ts
import { LocalFileStorage } from '@omdc-slipkit/elements';

const localFile = new LocalFileStorage();
await localFile.save('invoice.slip', file);   // downloads
const file = await localFile.load('');         // opens picker
```

### Custom Implementation

To manage templates via a server API, implement the `StorageAdapter` interface:

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';

const serverStorage: StorageAdapter = {
  async save(key, file) { /* POST /api/slips */ },
  async load(key) { /* GET /api/slips/:key */ },
  async delete(key) { /* DELETE /api/slips/:key */ },
  async list(options?) { /* GET /api/slips?title=...&cursor=... */ },
};
```

## 6. Font Configuration

SlipKit bundles a default font per language — Pretendard for Korean/English, Noto Sans JP for
Japanese. When `settings` is not specified, the font matching the `locale` is used automatically so
text renders correctly.

To supply fonts from the host, implement `settings.getFonts` (a synchronous array or a server-fetch
Promise):

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';

designer.settings = {
  getFonts: () => [
    ...pretendardFonts,
    { name: 'NotoSans', data: notoSansArrayBuffer },
  ],
};
```

See **[Bundled Fonts & Presets](fonts-and-presets.en.md)** for the provider interface and the bundled
fonts in detail.

## 7. Locale

Set the `locale` property to change the UI language. Supported: Korean (`'ko'`, default), English
(`'en'`), Japanese (`'ja'`).

```html
<slip-designer locale="ja"></slip-designer>
```

```tsx
<SlipDesigner src={src} locale="ja" />
```

Japanese (`'ja'`) bundles a default font (Noto Sans JP) so it renders by just switching the language —
supply a font via `settings.getFonts` for bold or a wider glyph range.

Formula result formatting (number grouping, etc.) also follows the locale (including `ja-JP`).

For server-side usage (parsing `.slip` files, generating PDFs, verifying integrity),
see the **[Core API Guide](core.en.md)**.
