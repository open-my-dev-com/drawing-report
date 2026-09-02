# Configuration Guide

[한국어](configuration.ko.md) · [日本語](configuration.ja.md)

This document explains how to configure SlipKit's language, fonts, paper, barcodes, presets, storage, and image limits to match your host application.

Configuration is used less to change the features of the components themselves and more to pass application-specific resources and policies such as the following.

- The language displayed on screen
- The fonts used for PDF rendering
- The paper and barcodes selectable in the designer
- Application-specific template presets
- The designer's "My templates" storage
- The size of images that can be uploaded
- Core's formula locale and encryption key

> [!NOTE]
> For component events and the auto-save flow, see the [Application Integration Guide](integration.md). For the full fields of each settings type, see the [API Reference](api-reference.md).
>
> See the [MCP Guide](mcp.md) for the local MCP server's separate `slipkit-mcp.json` configuration.

## Component settings at a glance

| Setting | Designer | Form | Viewer | Default behavior |
|---|:---:|:---:|:---:|---|
| `locale` | ● | ● | ● | The `SlipKit` locale or English UI |
| `slipkit` | ● | ● | ● | Uses bundled fonts and the default Core settings |
| `settings` | ● | — | — | Uses the bundled barcode kinds and paper sizes |
| `presets` | ● | — | — | Uses the 2 bundled presets |
| `storage` | ● | — | — | Hides the "My templates" save/list feature |
| `maxImageBytes` | ● | ● | — | Image source file up to 2MB |

`locale` and `max-image-bytes` can be passed as HTML attributes.

`slipkit`, `settings`, `presets`, and `storage` contain objects or functions, so they must be passed as JavaScript properties or as your framework's object props.

## How to pass settings

### Web Component

Strings and numbers can be passed as HTML attributes.

```html
<slip-designer
  id="designer"
  locale="en"
  max-image-bytes="2097152"
></slip-designer>
```

Object settings are passed as JavaScript properties.

```ts
import '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';

import type {
  SlipDesigner,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designer =
  document.querySelector<SlipDesigner>(
    '#designer',
  );

if (!designer) {
  throw new Error(
    'The slip-designer element could not be found.',
  );
}

const slipkit = createSlipKit({
  getFonts: () => appFonts,
  locale: 'en-US',
});

const settings: SlipDesignerSettings = {
  getPaperSizes: () => appPaperSizes,
};

designer.slipkit = slipkit;
designer.settings = settings;
designer.presets = appPresets;
designer.storage = templateStorage;
designer.maxImageBytes = 2 * 1024 * 1024;
```

Writing the object name as an HTML attribute string as below does not actually pass the object.

```html
<!-- Incorrect usage -->
<slip-designer
  settings="settings"
  presets="appPresets"
  storage="templateStorage"
></slip-designer>
```

### React

In the React wrapper, pass them as ordinary component props.

```tsx
import { useMemo } from 'react';

import {
  SlipDesigner,
} from '@omdc-slipkit/react';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

export function DesignerScreen() {
  const settings =
    useMemo<SlipDesignerSettings>(
      () => ({
        getPaperSizes: () => appPaperSizes,
      }),
      [],
    );

  return (
    <SlipDesigner
      src={designerSrc}
      locale="en"
      slipkit={slipkit}
      settings={settings}
      presets={appPresets}
      storage={templateStorage}
      maxImageBytes={2 * 1024 * 1024}
      onSlipChange={handleSlipChange}
    />
  );
}
```

> [!TIP]
> Do not create new `slipkit`, `settings`, `presets`, or `storage` objects on every render.
> In React, it is better to declare them at module scope or use `useMemo` to keep the same object.

### Vue

In the Vue wrapper, also pass them as object props.

```vue
<script setup lang="ts">
import {
  SlipDesigner,
} from '@omdc-slipkit/vue';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const settings: SlipDesignerSettings = {
  getPaperSizes: () => appPaperSizes,
};
</script>

<template>
  <SlipDesigner
    :src="designerSrc"
    locale="en"
    :slipkit="slipkit"
    :settings="settings"
    :presets="appPresets"
    :storage="templateStorage"
    :max-image-bytes="2 * 1024 * 1024"
    @slip-change="handleSlipChange"
  />
</template>
```

## UI language setting

The three UI components support `locale`.

| Value | Language | Default font |
|---|---|---|
| `ko` | Korean | Pretendard Regular·Bold |
| `en` | English | Pretendard Regular·Bold |
| `ja` | Japanese | Noto Sans JP Regular |

If you omit `locale`, the UI uses the language from `SlipKit.locale`. If `slipkit` is also absent, or if you explicitly pass an unsupported `locale`, the UI uses English.

Values that include a region code, such as `en-US`, `ko-KR`, and `ja-JP`, can also be used. In that case, the leading language code selects the UI language.

```html
<slip-designer locale="ja"></slip-designer>
<slip-form locale="ja-JP"></slip-form>
<slip-viewer locale="en-US"></slip-viewer>
```

The component `locale` affects the following.

- Component buttons and guidance text
- Error messages

When `getFonts` is not configured, `SlipKit.locale` selects the bundled default font. If `slipkit` is also absent, the component `locale` is used.

The following are not translated automatically.

- Text entered directly into the template
- Parameter logical names
- The contents of a `.slip` file received from an external source
- The names and contents of presets supplied by the application

> [!IMPORTANT]
> The bundled trade statement and invoice presets are created with titles, table items, and phrases in the **`locale` language at the moment you apply them**.
> A template that has already been created is not translated automatically when you change `locale` later.
> If you need templates with a different structure, supply your own presets separately.

## Font settings

### Bundled default fonts

If `getFonts` is not configured on `SlipKit`, the UI component loads the default font for `SlipKit.locale`. If `slipkit` is also absent, it uses the component `locale`.

| Language | Bundled font | Composition |
|---|---|---|
| Korean·English | Pretendard | Regular·Bold |
| Japanese | Noto Sans JP | Regular subset |

The bundled fonts are lazily loaded when PDF rendering is needed, and once loaded they are reused for the same language.

The Japanese default font is a subset that includes common kana, kanji, and Latin characters. If you need characters outside the bundled range or a bold Japanese font, you must supply your own font.

### Supplying your own fonts

Configure custom fonts once with the `getFonts` option of `createSlipKit`, then pass the same instance to each component.

```ts
import { createSlipKit } from '@omdc-slipkit/core';

const slipkit = createSlipKit({
  getFonts: () => [
    {
      name: 'AppFont',
      data: appFontRegular,
      fallback: true,
    },
    {
      name: 'AppFont-Bold',
      data: appFontBold,
    },
  ],
});

viewer.slipkit = slipkit;
form.slipkit = slipkit;
designer.slipkit = slipkit;
```

`getFonts` can use a font array or a `Promise` that returns a font array.

UI components supply bundled fonts when `getFonts` is absent, but Core's `slipkit.render()` does not load fonts bundled with Elements. Configure `getFonts` when direct Core rendering and component previews must use the same custom fonts.

```ts
import { createSlipKit, type SlipFont } from '@omdc-slipkit/core';

async function loadFont(
  url: string,
): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to load the font: ${response.status}`,
    );
  }

  return new Uint8Array(
    await response.arrayBuffer(),
  );
}

async function loadAppFonts(): Promise<SlipFont[]> {
  const [regular, bold] = await Promise.all([
    loadFont('/fonts/AppFont-Regular.otf'),
    loadFont('/fonts/AppFont-Bold.otf'),
  ]);

  return [
    {
      name: 'AppFont',
      data: regular,
      fallback: true,
    },
    {
      name: 'AppFont-Bold',
      data: bold,
    },
  ];
}

const slipkit = createSlipKit({
  getFonts: loadAppFonts,
});
```

> [!TIP]
> A `SlipKit` instance reuses a successful `getFonts` result across the designer and PDF renderer.
> If loading fails, the next call retries the provider.

### Rules for applying your own fonts

A font object uses the following values.

| Field | Description |
|---|---|
| `name` | The font name that template elements reference |
| `data` | The `Uint8Array` of a TTF or OTF file |
| `fallback` | Whether this font is used as the fallback when no other font is found |

Check the following rules.

- Only one font can be marked `fallback: true`.
- If no fallback font is specified, the first font in the list is used as the fallback.
- You cannot register multiple fonts with the same `name`.
- The bold font is named with `-Bold` appended to the base name.
- The italic font is named with `-Italic` appended to the base name.
- The bold italic font is named with `-BoldItalic` appended to the base name.

For example, if the base font name is `AppFont`, configure it as follows.

```ts
const fonts = [
  {
    name: 'AppFont',
    data: regular,
    fallback: true,
  },
  {
    name: 'AppFont-Bold',
    data: bold,
  },
  {
    name: 'AppFont-Italic',
    data: italic,
  },
  {
    name: 'AppFont-BoldItalic',
    data: boldItalic,
  },
];
```

If the required variant font is not registered, the corresponding weight or italic effect may not be applied.

### Using bundled fonts together with your own fonts

If `getFonts` returns a non-empty array, the bundled default fonts are not added automatically.

Use `loadDefaultFonts(locale)` when you want the same bundled set that the components use by default. It already contains both bundled families and selects one fallback by locale. Use the font subpaths only when you need a single family or set `fallback` yourself. Each subpath list marks its own font as `fallback: true`, so spreading both lists unchanged fails with `Only one fallback font can be specified`.

```ts
import { loadDefaultFonts } from '@omdc-slipkit/elements';

const slipkit = createSlipKit({
  getFonts: () => loadDefaultFonts('en'),
});
```

To use the bundled fonts together with your own fonts, import them directly from the font subpaths.

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';

const slipkit = createSlipKit({
  getFonts: () => [
    ...PRETENDARD_FONTS,
    ...NOTO_SANS_JP_FONTS.map((font) => ({
      ...font,
      fallback: false,
    })),
    {
      name: 'AppFont',
      data: appFont,
    },
  ],
});
```

> [!CAUTION]
> Full font files can significantly affect bundle size and initial load time.
> Supply only fonts that contain the characters and weights your application actually uses.

The bundled Pretendard and Noto Sans JP are each covered by the SIL Open Font License 1.1. When including your own fonts, you must also check the distribution and embedding terms of those fonts.

## Designer settings

`<slip-designer>` receives paper and barcode choices through `SlipDesignerSettings`. Pass fonts and locale through the `slipkit` property.

```ts
import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designerSettings:
  SlipDesignerSettings = {
    getPaperSizes: () => appPaperSizes,
    savePaperSize: saveAppPaperSize,
    getBarcodeKinds: () => [
      'qrcode',
      'code128',
      'ean13',
    ],
  };
```

### Adding your own paper sizes

The designer provides the following paper sizes by default.

| Name | Width | Height |
|---|---:|---:|
| A4 | 210mm | 297mm |
| A5 | 148mm | 210mm |
| B5 | 176mm | 250mm |
| Letter | 215.9mm | 279.4mm |

Add application-specific paper sizes with `getPaperSizes`.

```ts
import type {
  PaperSize,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const paperSizes: PaperSize[] = [
  {
    name: 'Shipping label 100×150',
    width: 100,
    height: 150,
  },
  {
    name: 'Receipt 80mm',
    width: 80,
    height: 200,
  },
];

const settings: SlipDesignerSettings = {
  getPaperSizes: () => paperSizes,
};
```

Your own paper sizes are added after the default paper sizes. A `.slip` file stores only the actual width and height, not the paper name.

To store a paper size the user entered directly in the designer into your application, also implement `savePaperSize`.

```ts
const PAPER_STORAGE_KEY =
  'my-app-paper-sizes';

function readPaperSizes(): PaperSize[] {
  const json =
    localStorage.getItem(PAPER_STORAGE_KEY);

  if (!json) {
    return [];
  }

  return JSON.parse(json) as PaperSize[];
}

function writePaperSizes(
  sizes: PaperSize[],
): void {
  localStorage.setItem(
    PAPER_STORAGE_KEY,
    JSON.stringify(sizes),
  );
}

const settings: SlipDesignerSettings = {
  getPaperSizes: () => readPaperSizes(),

  savePaperSize: (size) => {
    const sizes = readPaperSizes();

    const filtered = sizes.filter(
      (item) => item.name !== size.name,
    );

    writePaperSizes([
      ...filtered,
      size,
    ]);
  },
};
```

When the user saves a paper size in the designer, `savePaperSize` is called. After saving, the designer calls `getPaperSizes` again to refresh the selection list.

> [!NOTE]
> `savePaperSize` does not decide where the paper size should be stored.
> The host must implement a storage method suited to the application, among `localStorage`, IndexedDB, or a server API.

### Restricting barcode types

By default, the designer shows the following 12 barcode types.

| Value | Display name |
|---|---|
| `qrcode` | QR Code |
| `code128` | CODE128 |
| `ean13` | EAN-13 |
| `code39` | CODE39 |
| `ean8` | EAN-8 |
| `upca` | UPC-A |
| `upce` | UPC-E |
| `itf14` | ITF-14 |
| `nw7` | NW-7 (CODABAR) |
| `japanpost` | Japan Post |
| `gs1datamatrix` | GS1 DataMatrix |
| `pdf417` | PDF417 |

To show only the types your application uses, implement `getBarcodeKinds`.

```ts
import type {
  BarcodeKind,
} from '@omdc-slipkit/core';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const barcodeKinds: BarcodeKind[] = [
  'qrcode',
  'code128',
  'ean13',
];

const settings: SlipDesignerSettings = {
  getBarcodeKinds: () => barcodeKinds,
};
```

If you omit `getBarcodeKinds` or return an empty array, all 12 types are shown.

> [!NOTE]
> This setting narrows the designer's selection list.
> It is not a policy that forbids other barcode types already present in an existing `.slip` file at the file-format level.

## Template preset settings

The designer includes a trade statement and an invoice preset by default.

To provide application-specific presets, pass an array of `SlipPreset` to `presets`.

```ts
import {
  CURRENT_SCHEMA_VERSION,
} from '@omdc-slipkit/core';

import type {
  SlipPreset,
} from '@omdc-slipkit/elements';

const shippingLabelPreset:
  SlipPreset = {
    id: 'shipping-label',
    name: 'Shipping label',

    create: () => ({
      schemaVersion:
        CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: {
          title: 'Shipping label',
        },
        paper: {
          width: 100,
          height: 150,
          padding: [
            5,
            5,
            5,
            5,
          ],
        },
        parameters: [
          {
            key: 'recipientName',
            label: 'Recipient',
          },
          {
            key: 'address',
            label: 'Address',
          },
        ],
        pages: [
          {
            elements: [
              {
                type: 'field',
                id: 'recipient-name',
                name: 'Recipient',
                position: {
                  x: 10,
                  y: 15,
                },
                width: 80,
                height: 10,
                parameter: 'recipientName',
                fontSize: 14,
              },
              {
                type: 'field',
                id: 'address',
                name: 'Address',
                position: {
                  x: 10,
                  y: 30,
                },
                width: 80,
                height: 30,
                parameter: 'address',
              },
            ],
          },
        ],
        assets: [],
      },
    }),
  };

const appPresets: SlipPreset[] = [
  shippingLabelPreset,
];

designer.presets = appPresets;
```

`create` must return a new `SlipTemplateFile` object each time the preset is selected. If it keeps returning the same object, previous edits may carry over into the next preset selection.

### Showing bundled presets together

If you specify your own presets, they are shown instead of the bundled presets.

To show both together, get the bundled presets for the current locale with `getPresets` and spread them.

```ts
import {
  getPresets,
} from '@omdc-slipkit/elements';

const appPresets = [
  ...getPresets('en'),
  shippingLabelPreset,
];

designer.presets = appPresets;
```

> [!NOTE]
> Passing an empty array does not leave the preset menu empty; it falls back to the bundled presets.
> This setting alone does not hide the entire preset menu.

> [!WARNING]
> Selecting a preset replaces the entire template being edited in the designer with the template returned by the preset.
> Give users a chance to save their current work before applying a preset.

## Storage settings

The designer's `storage` property is used for the following features.

- Save as a template of mine
- List saved templates
- Load a saved template
- Delete a saved template

If you do not specify `storage`, those buttons are not shown.

### IndexedDB storage

To store templates in the browser, you can use `IndexedDbStorage`.

```ts
import {
  IndexedDbStorage,
} from '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';

const slipkit = createSlipKit({
  locale: 'en-US',
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    pageSize: 50,
  });

designer.storage = templateStorage;
```

| Option | Default | Description |
|---|---|---|
| `dbName` | `'slipkit'` | The name of the IndexedDB database to use |
| `pageSize` | `50` | The number of items `list` returns at once |
| `encryptOnSave` | `false` | Whether to encrypt content when saving |

We recommend specifying a unique `dbName` so that data does not get mixed across multiple applications or runtime environments.

> [!IMPORTANT]
> `storage` is used for the designer's "My templates" feature.
> It is not a setting that automatically saves the `slip-change` that fires on every edit.
> Auto-save must be implemented separately by receiving the event.

For auto-save and connecting to server storage, see the [Application Integration Guide](integration.md).

### Encrypting the stored content

Configure the current and previous encryption keys once in `createSlipKit`. Each storage mechanism only chooses whether to encrypt new writes with `encryptOnSave`.

```ts
const encryptionKey =
  getEncryptionKeyFromHost();

const slipkit = createSlipKit({
  locale: 'en-US',
  encryption: {
    key: encryptionKey,
  },
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

If you also need to read files stored with a previous key, specify `previousKeys`.

```ts
const slipkit = createSlipKit({
  encryption: {
    key: currentKey,
    previousKeys: [previousKey],
  },
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

> [!WARNING]
> Saving fails when `encryptOnSave: true` is used without an encryption key in `SlipKit`.
> The library does not substitute a sample key. Manage production keys in the host application.

IndexedDB encryption protects the `.slip` body, but the following metadata needed for listing is stored in plaintext.

- Storage key
- File kind
- Template title
- Last modified time

If the title is also sensitive information, you must use a separate storage implementation or a server-side protection policy.

### Opening and downloading files

`SlipFileExchange` provides file download and a file selection dialog. It has no list or delete operations and does not implement `StorageAdapter`.

```ts
import {
  SlipFileExchange,
} from '@omdc-slipkit/elements';

const files =
  new SlipFileExchange(slipkit, {
    encryptOnSave: true,
  });

await files.download('document.slip', file);
const opened = await files.open();
```

Even when `encryptOnSave` is `false`, opening an encrypted file tries the current and previous keys configured in `SlipKit`.

## Image size limit

`<slip-designer>` and `<slip-form>` can limit the maximum source file size of images that users upload.

The default is 2MB.

### Web Component

```html
<slip-designer
  max-image-bytes="1048576"
></slip-designer>

<slip-form
  max-image-bytes="1048576"
></slip-form>
```

### React

```tsx
<SlipDesigner
  src={designerSrc}
  maxImageBytes={1024 * 1024}
/>

<SlipForm
  src={formSrc}
  maxImageBytes={1024 * 1024}
/>
```

### Vue

```vue
<SlipDesigner
  :src="designerSrc"
  :max-image-bytes="1024 * 1024"
/>

<SlipForm
  :src="formSrc"
  :max-image-bytes="1024 * 1024"
/>
```

This limit applies to the following image selections.

- Fixed images added in the designer
- Image sample values entered in the designer
- Variable images entered in the form

Images are included in the `.slip` file as `data:` Base64 strings, so their size after conversion can be about 33% larger than the original.

> [!NOTE]
> `maxImageBytes` checks the original image file the user newly selects.
> It does not limit the total size of an existing `.slip` file loaded from an external source, nor does it automatically shrink images already included.

When deciding on the image size to allow in your application, also consider the following.

- Browser memory usage
- IndexedDB or server storage capacity
- API request body size limits
- PDF rendering time
- The number of images that a single voucher can contain

## Core settings

In `@omdc-slipkit/core`, pass common settings to `createSlipKit`.

```ts
import {
  createSlipKit,
} from '@omdc-slipkit/core';

const slip = createSlipKit({
  getFonts: () => appFonts,
  locale: 'ko-KR',
  encryption: {
    key: currentKey,
    previousKeys: [
      previousKey,
    ],
  },
});
```

| Setting | Purpose |
|---|---|
| `getFonts` | Supplies the fonts used for PDF rendering |
| `locale` | The BCP-47 locale used by formula format functions such as `FORMAT_NUMBER` and by error messages (default `'en-US'`) |
| `encryption.key` | The key that `encrypt` and `decrypt` use by default |
| `encryption.previousKeys` | The list of keys to use when decrypting files encrypted with a previous key |

When UI components and storage receive the same `slipkit`, custom fonts, formulas, PDF rendering, and storage error messages reuse one instance's settings. If the component `locale` is omitted, the UI language also follows `SlipKit.locale`. If `getFonts` is absent, component previews use the bundled fonts.

Use a component `locale` only when its UI language must differ.

| Setting | Example | Role |
|---|---|---|
| Component `locale` | `'ko'`, `'en'`, `'ja'` | UI text; also selects the bundled font when `slipkit` is absent |
| Core `locale` | `'ko-KR'`, `'en-US'`, `'ja-JP'` | Number and date formatting in formulas, error message language, and bundled font selection when `getFonts` is absent |

For the Core usage flow and how to generate PDFs, see the [Core Usage Guide](core.md).

## Recommended settings structure

If you use the same settings across your entire application, we recommend creating them in one file and sharing them.

`src/slipkit-config.ts`:

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import {
  IndexedDbStorage,
  getPresets,
  type SlipDesignerSettings,
  type SlipPreset,
} from '@omdc-slipkit/elements';

const fontPromise =
  loadAppFonts();

export const slipkit = createSlipKit({
  locale: 'en-US',
  getFonts: () => fontPromise,
  encryption: {
    key: currentKey,
    previousKeys: [previousKey],
  },
});

export const designerSettings:
  SlipDesignerSettings = {
    getPaperSizes: () => [
      {
        name: 'Shipping label 100×150',
        width: 100,
        height: 150,
      },
    ],

    getBarcodeKinds: () => [
      'qrcode',
      'code128',
    ],
  };

export const designerPresets:
  SlipPreset[] = [
    ...getPresets('en'),
    shippingLabelPreset,
  ];

export const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

In the components, pass only the settings you need.

```tsx
<SlipDesigner
  src={designerSrc}
  slipkit={slipkit}
  settings={designerSettings}
  presets={designerPresets}
  storage={templateStorage}
/>

<SlipForm
  src={formSrc}
  slipkit={slipkit}
/>

<SlipViewer
  src={viewerSrc}
  slipkit={slipkit}
/>
```

This keeps fonts, locale, and encryption keys in one `SlipKit` instance shared by components and storage mechanisms.

## Configurations to avoid

- Passing an object setting as an HTML attribute string
- Creating new `slipkit`, `settings`, and storage instances on every React render
- Re-downloading the same font from the network every time `getFonts` is called
- Assuming the required default fonts are added automatically while you supply your own fonts
- Marking more than one font `fallback: true`
- Registering a bold font with the same name as the base font
- Assuming `locale` also translates the text inside the template
- Assuming an empty `presets` array hides the preset menu
- Interpreting `storage` as an auto-save setting
- Passing `SlipFileExchange` as the designer's `storage`
- Hard-coding production encryption keys
- Setting the image limit without accounting for the size increase after Base64 conversion

## Completion check

- [ ] Configure fonts, locale, and encryption keys once in `SlipKit`.
- [ ] Override `locale` only on components that need a different UI language.
- [ ] Supply the fonts required for the characters and styles you will output.
- [ ] Structure things so the font-supply result is reused.
- [ ] Configure the custom paper sizes and barcode types your application needs.
- [ ] Ensure your presets' `create` returns a new template each time.
- [ ] Distinguish the roles of designer storage and auto-save.
- [ ] Manage the production encryption key on the host.
- [ ] Set an image size limit suited to your storage and transmission environment.
- [ ] Reuse settings objects and storage instances in React and Vue.

## Related documents

- [Getting Started](getting-started.md)
- [Form Designer Usage Guide](designer.md)
- [Application Integration Guide](integration.md)
- [Core Usage Guide](core.md)
- [API Reference](api-reference.md)
