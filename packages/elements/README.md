# @omdc-slipkit/elements

Lit-based Web Components for designing `.slip` templates, filling vouchers, and viewing templates or issued vouchers.

## Installation

```bash
npm install @omdc-slipkit/core @omdc-slipkit/elements
```

Node.js 22.13 or later is required for the supported toolchain. The components run in modern browsers. `<slip-designer>` is a desktop interface that requires a browser viewport of at least 1440×810 and an allocated element area of at least 1280×640.

## Basic usage

```ts
import '@omdc-slipkit/elements';

const designer = document.querySelector('slip-designer');
designer.src = await fetch('/forms/invoice.slip').then((response) => response.text());
designer.locale = 'en';
designer.addEventListener('slip-change', (event) => {
  console.log(event.detail.file);
});
```

```html
<slip-designer></slip-designer>
```

The package registers `<slip-designer>`, `<slip-form>`, and `<slip-viewer>` when imported. See [Getting started](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/guide/getting-started.md) and the [configuration guide](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/guide/configuration.md) for complete integration examples.

## Bundled fonts and package size

The published package includes Pretendard Regular/Bold and a Noto Sans JP Regular subset under the SIL Open Font License 1.1. The current packed tarball is 5,973,728 bytes (about 5.97 MB) and expands to 11,320,008 bytes (about 11.32 MB), primarily because the font data is embedded in JavaScript.

The font modules are separate dynamic chunks. Importing the component entry point does not load their data immediately. When no `getFonts` provider is configured and rendering needs the bundled defaults, `loadDefaultFonts` loads both font chunks and selects the locale-appropriate fallback. Supplying fonts through `createSlipKit({ getFonts })` avoids loading the bundled font chunks.

The package includes `OFL-Pretendard.txt` and `OFL-NotoSansJP.txt` with the font license terms.

## Versioning

The npm package version follows the package release. A `.slip` file's `schemaVersion` describes the file format and changes independently. See the [`.slip` specification](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/SPEC.md) for format compatibility.

## License and support

SlipKit code in this package is licensed under the Business Source License 1.1. See the included `LICENSE` file for its terms and change date. The bundled fonts retain their SIL Open Font License 1.1 terms.

Report defects and documentation problems through [GitHub Issues](https://github.com/open-my-dev-com/drawing-report/issues).
