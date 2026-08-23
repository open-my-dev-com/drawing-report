# Bundled Fonts & Presets

[한국어](fonts-and-presets.md) · [日本語](fonts-and-presets.ja.md)

Details of the fonts and presets SlipKit bundles, how the host supplies fonts, and how behavior
changes with the locale.

---

## Font supply: `settings.getFonts` (ADR-040)

The host supplies render fonts through a **provider interface**. Give the `settings` property of a
component (`<slip-designer>`, `<slip-form>`, `<slip-viewer>`) an object implementing `getFonts`, and
the preview and PDF render with those fonts. Because only the host knows where fonts live (bundle,
server folder, etc.), the library only pulls the list back — it never uploads or stores fonts.

```ts
import type { SlipFontProvider } from '@omdc-slipkit/elements';

const settings: SlipFontProvider = {
  // A synchronous array or a Promise (e.g. server fetch) both work.
  getFonts: () => [
    { name: 'MyFont', data: myFontBuffer },
    { name: 'MyFont-Bold', data: myFontBoldBuffer },
  ],
};

designer.settings = settings;
```

| Field | Type | Description |
|---|---|---|
| `getFonts?` | `() => SlipFont[] \| Promise<SlipFont[]>` | Fonts to render with. If empty or omitted, the bundled default font is used |

`SlipFont` is the same as an element of core's `RenderOptions.fonts` (`{ name, data, fallback? }`).

> The designer takes `SlipDesignerSettings`, which adds paper-size supply/save
> (`getPaperSizes`/`savePaperSize`) on top of `getFonts` — see the paper settings in the
> [integration guide](README.en.md).

---

## Bundled default fonts

If you **do not** supply fonts via `settings.getFonts`, the component automatically loads the bundled
default font that matches the `locale`. Each language ships with one default font so it renders out of
the box.

| Locale | Default font | Weights | Format | Approx. size |
|---|---|---|---|---|
| `ko` (default) · `en` | Pretendard | Regular · Bold | OTF | ~3 MB |
| `ja` | Noto Sans JP | Regular | TTF (subset) | ~4.8 MB |

- Regular has `fallback: true`, so it draws any glyph missing from other fonts.
- Loading happens once, lazily (async), and is reused per language.
- The font data is isolated behind a **subpath** and dynamically imported, so it does not enter the
  bundle of a host that does not use that language.
- Licenses: Pretendard is under SIL Open Font License 1.1 (`OFL-Pretendard.txt`); Noto Sans JP is
  also under SIL Open Font License 1.1 (`OFL-NotoSansJP.txt`).

### Coverage of the Japanese font (ADR-042)

The bundled Noto Sans JP is a **single Regular weight**, subset to the glyphs common in Japanese
documents (kana, common kanji, Latin, full/half-width forms). If you need **bold** or glyphs outside
the subset, supply a font via `settings.getFonts` — bundling is "one default", extension is the
provider interface.

### Using them directly

You can import the bundled fonts explicitly and combine them with your own fonts.

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';
import notoSansJpFonts from '@omdc-slipkit/elements/fonts/noto-sans-jp';

designer.settings = {
  getFonts: () => [
    ...pretendardFonts,
    ...notoSansJpFonts,
    { name: 'MyFont', data: myFontBuffer },
  ],
};
```

When `getFonts` returns a list, the automatic bundled-font load does not happen, so include any
bundled font you need in the array yourself.

---

## Bundled presets

The designer bundles two presets.

| Preset | Contents |
|---|---|
| **Transaction statement** | Supplier / recipient info (registration number, name, address, etc.), an item table (name, spec, qty, unit price, amount), total formulas |
| **Invoice** | Billing info, an amount-breakdown table, total / VAT formulas |

### Presets and locale

The preset menu **names** (Transaction statement, Invoice) are translated by `locale`.

However, the preset **contents** (cell text, parameter labels, column titles, etc.) are fixed in Korean.
For example, selecting the transaction-statement preset shows "등록번호", "상호" in cells even under
`locale="en"` or `locale="ja"`.

For English or Japanese forms, pass your own presets via the `presets` property.

### Making your own presets

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
import type { SlipTemplateFile } from '@omdc-slipkit/core';

const myPresets: SlipPreset[] = [
  {
    id: 'my-invoice',
    name: 'Invoice',
    create: (): SlipTemplateFile => ({
      schemaVersion: '0.1.0',
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

When `presets` is set, the menu shows your list instead of the bundled presets.
