# Bundled Fonts & Presets

[한국어](fonts-and-presets.md)

Details about SlipKit's bundled fonts and presets, and how they behave with locale settings.

---

## Bundled Font: Pretendard

SlipKit bundles **Pretendard Regular** and **Pretendard Bold**.

| Item | Detail |
|---|---|
| Typeface | Pretendard |
| Weights | Regular (default), Bold |
| Format | OTF |
| License | SIL Open Font License 1.1 |
| Size | ~3 MB total (including base64 encoding) |

### Automatic Loading

When no `fonts` property is passed to a component (`<slip-designer>`, `<slip-form>`,
`<slip-viewer>`), Pretendard is loaded automatically. Regular is set as `fallback: true`
so Korean text renders correctly.

Loading happens once, asynchronously, when the component first renders.

### Explicit Use

You can import the bundled fonts explicitly to combine them with custom fonts.

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';

// Use bundled fonts only
designer.fonts = pretendardFonts;

// Add custom fonts alongside
designer.fonts = [
  ...pretendardFonts,
  { name: 'NotoSans', data: notoSansBuffer },
];
```

When you set the `fonts` property, automatic loading is skipped — include `pretendardFonts`
in the array if you need Korean text support.

---

## Built-in Presets

The designer ships with two presets.

| Preset | Structure |
|---|---|
| **Trade Statement** | Supplier/buyer info (registration number, business name, address, etc.), item table (product, spec, quantity, unit price, amount), sum formulas |
| **Invoice** | Billing info, amount breakdown table, subtotal/tax formulas |

### Presets and Locale

The preset **menu names** (거래명세서, 청구서) are translated based on `locale` —
with English locale they show as "Transaction statement" and "Invoice".

However, the preset **content** (cell text, binding labels, column titles) is hardcoded
in Korean. For example, selecting the trade statement preset with `locale="en"` still
produces cells containing "등록번호" (registration number), "상호" (business name), etc.

To create English-language forms, pass your own presets via the `presets` property.

### Creating Custom Presets

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
import type { SlipTemplateFile } from '@omdc-slipkit/core';

const myPresets: SlipPreset[] = [
  {
    id: 'my-invoice',
    name: 'Invoice',
    create: (): SlipTemplateFile => ({
      schemaVersion: '0.4.0',
      kind: 'template',
      template: {
        meta: { title: 'Invoice' },
        paper: { width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } },
        pages: [{ elements: [] }],
        assets: [],
      },
    }),
  },
];
```

```html
<slip-designer .presets=${myPresets}></slip-designer>
```

When `presets` is set, your list replaces the built-in presets in the menu.
