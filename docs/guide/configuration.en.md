# Configuration Guide

[한국어](configuration.md) · [日本語](configuration.ja.md)

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
> For component events and the auto-save flow, see the [Application Integration Guide](integration.en.md). For the full fields of each settings type, see the [API Reference](api-reference.en.md).

## Component settings at a glance

| Setting | Designer | Form | Viewer | Default behavior |
|---|:---:|:---:|:---:|---|
| `locale` | ● | ● | ● | Korean UI |
| `settings` | ● | ● | ● | Uses the bundled fonts and default resources for the language |
| `presets` | ● | — | — | Uses the 2 bundled presets |
| `storage` | ● | — | — | Hides the "My templates" save/list feature |
| `maxImageBytes` | ● | ● | — | Image source file up to 2MB |

`locale` and `max-image-bytes` can be passed as HTML attributes.

`settings`, `presets`, and `storage` contain objects or functions, so they must be passed as JavaScript properties or as your framework's object props.

## How to pass settings

### Web Component

Strings and numbers can be passed as HTML attributes.

```html
<slip-designer
  id="designer"
  locale="ko"
  max-image-bytes="2097152"
></slip-designer>
```

Object settings are passed as JavaScript properties.

```ts
import '@omdc-slipkit/elements';

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

const settings: SlipDesignerSettings = {
  getFonts: () => appFonts,
};

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
        getFonts: () => appFonts,
      }),
      [],
    );

  return (
    <SlipDesigner
      src={designerSrc}
      locale="ko"
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
> Do not create new `settings`, `presets`, or `storage` objects on every render.
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
  getFonts: () => appFonts,
};
</script>

<template>
  <SlipDesigner
    :src="designerSrc"
    locale="ko"
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

If you omit `locale` or pass an unsupported value, Korean is used.

Values that include a region code, such as `en-US`, `ko-KR`, and `ja-JP`, can also be used. In that case, the leading language code selects the UI language.

```html
<slip-designer locale="ja"></slip-designer>
<slip-form locale="ja-JP"></slip-form>
<slip-viewer locale="en-US"></slip-viewer>
```

`locale` affects the following.

- Component buttons and guidance text
- Error messages
- The default font used when no font is supplied separately

The following are not translated automatically.

- Text entered directly into the template
- Parameter logical names
- The contents of a `.slip` file received from an external source
- The names and contents of presets supplied by the application
- The document contents of the bundled presets

> [!IMPORTANT]
> The currently bundled trade statement and invoice presets are Korean templates.
> Even if you use `locale="en"` or `locale="ja"`, the titles and table items inside the presets are not translated automatically.
> If you need templates in another language, supply presets written in that language separately.

## Font settings

### Bundled default fonts

If you do not specify `settings.getFonts`, the UI component loads the default font for the `locale`.

| Language | Bundled font | Composition |
|---|---|---|
| Korean·English | Pretendard | Regular·Bold |
| Japanese | Noto Sans JP | Regular subset |

The bundled fonts are lazily loaded when PDF rendering is needed, and once loaded they are reused for the same language.

The Japanese default font is a subset that includes common kana, kanji, and Latin characters. If you need characters outside the bundled range or a bold Japanese font, you must supply your own font.

### Supplying your own fonts

The three components receive fonts through `settings.getFonts`.

```ts
import type {
  SlipFontProvider,
} from '@omdc-slipkit/elements';

const settings: SlipFontProvider = {
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
};

viewer.settings = settings;
form.settings = settings;
```

`getFonts` can use a font array or a `Promise` that returns a font array.

```ts
import type {
  SlipFont,
  SlipFontProvider,
} from '@omdc-slipkit/elements';

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

let fontPromise:
  Promise<SlipFont[]> | undefined;

const settings: SlipFontProvider = {
  getFonts: () => {
    fontPromise ??= loadAppFonts();
    return fontPromise;
  },
};
```

> [!TIP]
> `getFonts` may be called again when a PDF is rendered.
> If you read fonts from the network or file system, keep the resulting `Promise` as in the example above so that the same font is not fetched repeatedly.

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

To use the bundled fonts together with your own fonts, import them directly from the font subpaths.

```ts
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';

const settings: SlipFontProvider = {
  getFonts: () => [
    ...PRETENDARD_FONTS,
    ...NOTO_SANS_JP_FONTS,
    {
      name: 'AppFont',
      data: appFont,
    },
  ],
};
```

> [!CAUTION]
> Full font files can significantly affect bundle size and initial load time.
> Supply only fonts that contain the characters and weights your application actually uses.

The bundled Pretendard and Noto Sans JP are each covered by the SIL Open Font License 1.1. When including your own fonts, you must also check the distribution and embedding terms of those fonts.

## Designer settings

Besides fonts, `<slip-designer>` receives paper and barcode choices via `SlipDesignerSettings`.

```ts
import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designerSettings:
  SlipDesignerSettings = {
    getFonts: () => appFonts,
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

To show both together, spread the bundled `presets` and pass them.

```ts
import {
  presets as builtInPresets,
} from '@omdc-slipkit/elements';

const appPresets = [
  ...builtInPresets,
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

const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    pageSize: 50,
    locale: 'ko',
  });

designer.storage = templateStorage;
```

| Option | Default | Description |
|---|---|---|
| `dbName` | `'slipkit'` | The name of the IndexedDB database to use |
| `pageSize` | `50` | The number of items `list` returns at once |
| `locale` | `'ko'` | The language of storage error messages |
| `encryption` | Disabled | The encryption setting for the body to be stored |

We recommend specifying a unique `dbName` so that data does not get mixed across multiple applications or runtime environments.

> [!IMPORTANT]
> `storage` is used for the designer's "My templates" feature.
> It is not a setting that automatically saves the `slip-change` that fires on every edit.
> Auto-save must be implemented separately by receiving the event.

For auto-save and connecting to server storage, see the [Application Integration Guide](integration.en.md).

### Encrypting the stored content

`IndexedDbStorage` and `LocalFileStorage` support the `encryption` option.

```ts
const encryptionKey =
  getEncryptionKeyFromHost();

const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    encryption: {
      enabled: true,
      key: encryptionKey,
    },
  });
```

If you also need to read files stored with a previous key, specify `previousKeys`.

```ts
const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    encryption: {
      enabled: true,
      key: currentKey,
      previousKeys: [
        previousKey,
      ],
    },
  });
```

> [!WARNING]
> If `enabled: true` but `key` is omitted, the bundled demo sample key is used.
> This key is published in the source code, so it is not a real security feature.
> In production, be sure to pass a key managed by the host.

IndexedDB encryption protects the `.slip` body, but the following metadata needed for listing is stored in plaintext.

- Storage key
- File kind
- Template title
- Last modified time

If the title is also sensitive information, you must use a separate storage implementation or a server-side protection policy.

### Local file storage

`LocalFileStorage` provides file download and a file selection dialog.

```ts
import {
  LocalFileStorage,
} from '@omdc-slipkit/elements';

const localFiles =
  new LocalFileStorage({
    locale: 'ko',
    encryption: {
      enabled: true,
      key: encryptionKey,
    },
  });
```

`LocalFileStorage` does not support listing or deletion. Therefore, rather than passing it as the designer's `storage`, it is better suited to being used directly in your application's file open/download features.

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
| `locale` | The BCP-47 locale used by formula format functions such as `FORMAT_NUMBER` |
| `encryption.key` | The key that `encrypt` and `decrypt` use by default |
| `encryption.previousKeys` | The list of keys to use when decrypting files encrypted with a previous key |

The UI component's `locale` and Core's `locale` play different roles.

| Setting | Example | Role |
|---|---|---|
| Component `locale` | `'ko'`, `'en'`, `'ja'` | Selects buttons, guidance text, and the bundled font |
| Core `locale` | `'ko-KR'`, `'en-US'`, `'ja-JP'` | Number and date formatting in formulas |

For the Core usage flow and how to generate PDFs, see the [Core Usage Guide](core.en.md).

## Recommended settings structure

If you use the same settings across your entire application, we recommend creating them in one file and sharing them.

`src/slipkit-config.ts`:

```ts
import {
  IndexedDbStorage,
  presets as builtInPresets,
  type SlipDesignerSettings,
  type SlipFontProvider,
  type SlipPreset,
} from '@omdc-slipkit/elements';

const fontPromise =
  loadAppFonts();

export const fontSettings:
  SlipFontProvider = {
    getFonts: () => fontPromise,
  };

export const designerSettings:
  SlipDesignerSettings = {
    getFonts: () => fontPromise,

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
    ...builtInPresets,
    shippingLabelPreset,
  ];

export const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    locale: 'ko',
  });
```

In the components, pass only the settings you need.

```tsx
<SlipDesigner
  src={designerSrc}
  locale="ko"
  settings={designerSettings}
  presets={designerPresets}
  storage={templateStorage}
/>

<SlipForm
  src={formSrc}
  locale="ko"
  settings={fontSettings}
/>

<SlipViewer
  src={viewerSrc}
  locale="ko"
  settings={fontSettings}
/>
```

With this structure, you do not repeatedly create different settings objects for each component, and you can reuse the font and storage instances.

## Configurations to avoid

- Passing an object setting as an HTML attribute string
- Creating new `settings` and storage instances on every React render
- Re-downloading the same font from the network every time `getFonts` is called
- Assuming the required default fonts are added automatically while you supply your own fonts
- Marking more than one font `fallback: true`
- Registering a bold font with the same name as the base font
- Assuming `locale` also translates the text inside the template
- Assuming an empty `presets` array hides the preset menu
- Interpreting `storage` as an auto-save setting
- Using `LocalFileStorage` as a designer storage that needs listing
- Using the bundled sample encryption key in production
- Setting the image limit without accounting for the size increase after Base64 conversion

## Completion check

- [ ] Specify the UI language of the components.
- [ ] Supply the fonts required for the characters and styles you will output.
- [ ] Structure things so the font-supply result is reused.
- [ ] Configure the custom paper sizes and barcode types your application needs.
- [ ] Ensure your presets' `create` returns a new template each time.
- [ ] Distinguish the roles of designer storage and auto-save.
- [ ] Manage the production encryption key on the host.
- [ ] Set an image size limit suited to your storage and transmission environment.
- [ ] Reuse settings objects and storage instances in React and Vue.

## Related documents

- [Getting Started](getting-started.en.md)
- [Form Designer Usage Guide](designer.en.md)
- [Application Integration Guide](integration.en.md)
- [Core Usage Guide](core.en.md)
- [API Reference](api-reference.en.md)
