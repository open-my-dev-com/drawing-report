# API Reference

[한국어](api-reference.ko.md) · [日本語](api-reference.ja.md)

This document is a reference for quickly checking the functions, types, component properties, events, and errors that the SlipKit packages expose.

For the workflow and full examples, check these documents first.

- [Getting Started](getting-started.md)
- [Application Integration Guide](integration.md)
- [Core Usage Guide](core.md)
- [MCP Guide](mcp.md)
- [Configuration Guide](configuration.md)

> [!NOTE]
> The type shapes in this document are written in TypeScript notation for readability.
> The actual `.slip` runtime validation is based on `parseSlipFile`, `validateSlipFile`, and the public schema.

## Package structure

| Package | Main public API |
|---|---|
| `@omdc-slipkit/core` | File validation, voucher assembly, formulas, PDF, encryption, storage interface |
| `@omdc-slipkit/elements` | Web Components, settings types, built-in presets and storage implementations |
| `@omdc-slipkit/react` | React wrapper components |
| `@omdc-slipkit/vue` | Vue wrapper components |
| `@omdc-slipkit/mcp` | Local stdio MCP server, file-system storage, and MCP schema guidance |

Fonts can also be imported from the following subpaths.

```ts
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';
```

## `@omdc-slipkit/core`

### File parsing and serialization

#### `parseSlipFile`

```ts
function parseSlipFile(
  json: string,
  options?: { locale?: string },
): SlipFile;
```

Parses a JSON string and validates the entire `.slip` file. If a supported migration path exists, it converts to the current schema version.

Invalid JSON or file structure throws a `SlipParseError`. `options.locale` selects the error message language (English by default).

#### `validateSlipFile`

```ts
function validateSlipFile(
  raw: unknown,
  options?: { locale?: string },
): SlipFile;
```

Validates an already-parsed value as a `.slip` file. `options.locale` selects the error message language (English by default).

Use it to check an HTTP request body, the result of `JSON.parse`, or an object assembled directly in your application.

#### `serializeSlipFile`

```ts
function serializeSlipFile(
  file: SlipFile,
): string;
```

Converts a `SlipFile` object into an indented JSON string.

This function does not re-validate the input object.

#### `CURRENT_SCHEMA_VERSION`

```ts
const CURRENT_SCHEMA_VERSION: string;
```

The `.slip` schema version the library currently uses.

When creating a new template directly in code, we recommend using this constant rather than hardcoding the version string.

```ts
const file: SlipTemplateFile = {
  schemaVersion:
    CURRENT_SCHEMA_VERSION,
  kind: 'template',
  template: {
    // ...
  },
};
```

### Settings instance

#### `createSlipKit`

```ts
function createSlipKit(
  config?: SlipKitConfig,
): SlipKit;
```

Creates a Core instance with fonts, the formula locale, and the encryption key configured once.

#### `SlipKitConfig`

```ts
interface SlipKitConfig {
  getFonts?:
    () =>
      | readonly SlipFont[]
      | Promise<readonly SlipFont[]>;

  locale?: string;

  encryption?: {
    key:
      | string
      | Uint8Array;

    previousKeys?: (
      | string
      | Uint8Array
    )[];
  };
}
```

| Field | Description |
|---|---|
| `getFonts` | A function that supplies the fonts used for PDF rendering |
| `locale` | The BCP-47 locale used for formula formatting and error messages, default `'en-US'` |
| `encryption.key` | The default key for encryption and decryption |
| `encryption.previousKeys` | Additional keys to try when decrypting files encrypted with a previous key |

#### `SlipKit`

```ts
interface SlipKit {
  readonly locale: string | undefined;

  readonly getFonts:
    | (() =>
        | readonly SlipFont[]
        | Promise<readonly SlipFont[]>)
    | undefined;

  render(
    file: SlipFile,
  ): Promise<Uint8Array>;

  buildVoucher(
    template: SlipTemplateFile,
    values: Record<string, JsonValue>,
  ): SlipVoucherFile;

  evaluate(
    source: string | FormulaAst,
    context: FormulaContext,
  ): FormulaValue;

  encrypt(
    file: SlipFile,
    key?: string | Uint8Array,
  ): Promise<string>;

  decrypt(
    json: string,
    key?: string | Uint8Array,
  ): Promise<SlipFile>;
}
```

| Property or method | Return value | Description |
|---|---|---|
| `locale` | `string \| undefined` | The locale configured for this instance |
| `getFonts` | Function or `undefined` | The font provider configured for this instance |
| `render` | `Promise<Uint8Array>` | Converts a template or voucher into PDF bytes |
| `buildVoucher` | `SlipVoucherFile` | Creates a draft voucher from a template and values |
| `evaluate` | `FormulaValue` | Evaluates a formula string or AST |
| `encrypt` | `Promise<string>` | Converts a `.slip` file into an encryption envelope JSON |
| `decrypt` | `Promise<SlipFile>` | Decrypts an encryption envelope and validates it |

### Voucher assembly

#### `buildVoucher`

```ts
function buildVoucher(
  template: SlipTemplateFile,
  values: Record<string, JsonValue>,
): SlipVoucherFile;
```

Combines a template and input values to create a voucher with `issued: false`.

- The template is deep-copied into `templateSnapshot`.
- The input values also do not share references with the original objects.
- Empty values of top-level number parameters are normalized to `0`.
- Formula results do not need to be put into `values` in advance.

#### `normalizeNumericParameters`

```ts
function normalizeNumericParameters(
  values: Record<string, unknown>,
  parameters?:
    readonly ParameterDef[],
): Record<string, unknown>;
```

Replaces `undefined`, `null`, and empty strings of top-level parameters with `valueType: 'number'` with `0`.

If there is nothing to change, it returns the input object as-is.

### PDF rendering

#### `renderSlipToPdf`

```ts
function renderSlipToPdf(
  file: SlipFile,
  options?: RenderOptions,
): Promise<Uint8Array>;
```

A convenience function that converts a single template or voucher into PDF bytes.

#### `createPdfRenderer`

```ts
function createPdfRenderer(
  options?: RenderOptions,
): SlipPdfRenderer;
```

Creates a PDF renderer that can reuse the same rendering settings across multiple files.

#### `RenderOptions`

```ts
interface RenderOptions {
  getFonts?:
    () =>
      | readonly SlipFont[]
      | Promise<readonly SlipFont[]>;

  locale?: string;
}
```

| Field | Default | Description |
|---|---|---|
| `getFonts` | Underlying engine's default font | A function that supplies the fonts used for rendering |
| `locale` | `'en-US'` | The locale used for number and date formula formatting and the error message language |

#### `SlipPdfRenderer`

```ts
interface SlipPdfRenderer {
  renderToPdf(
    file: SlipFile,
  ): Promise<Uint8Array>;
}
```

#### `SlipFont`

```ts
interface SlipFont {
  name: string;
  data: Uint8Array;
  fallback?: boolean;
}
```

| Field | Description |
|---|---|
| `name` | The font name to link with the template's `fontName` |
| `data` | The TTF or OTF font bytes |
| `fallback` | Whether this font is used as the fallback when no other font is found |

Only one font can be marked `fallback: true`. If none is specified, the first font in the array is used as the fallback.

#### `stackVertically`

```ts
function stackVertically(
  text: string,
  vertical: boolean | undefined,
): string;
```

If `vertical` is `true`, it inserts a line break between each character of the string to create a string for vertical writing.

This is a low-level rendering helper function that most applications rarely need to use directly.

### Formulas

#### `parseFormula`

```ts
function parseFormula(
  source: string,
): FormulaAst;
```

Parses a formula string and returns an AST.

Invalid syntax or an unregistered function throws a `FormulaSyntaxError`.

#### `evaluateFormula`

```ts
function evaluateFormula(
  source: string | FormulaAst,
  context: FormulaContext,
): FormulaValue;
```

Evaluates a formula string or a parsed AST. It stops at the first error and throws.

#### `diagnoseFormula`

```ts
interface FormulaDiagnosis {
  value: FormulaValue;
  formulaError?: FormulaEvalError;
  dataError?: FormulaEvalError;
}

function diagnoseFormula(
  source: string | FormulaAst,
  context: FormulaContext,
): FormulaDiagnosis;
```

Reports whether a formula can be evaluated, without stopping at the first error. A place that fails because a value is missing or a reserved range is unavailable is filled with an empty value so evaluation continues, and that failure is reported as `dataError`. A failure that no data can resolve is reported as `formulaError`. Use this when an editor has to decide whether a formula is worth saving: `SUM(@page.amount) / 0` reports both, so a division by zero hidden behind a missing range is not mistaken for a value that will arrive later. When `formulaError` or `dataError` is set, `value` came out of the diagnosis, so do not show it as a result.

#### `FormulaContext`

```ts
interface FormulaContext {
  values: Record<string, unknown>;
  now?: Date;
  locale?: string;
}
```

| Field | Default | Description |
|---|---|---|
| `values` | Required | The values referenced by the formula |
| `now` | The call time | The reference time for date functions such as `TODAY` |
| `locale` | `'en-US'` | The locale for number and date formatting and the error message language |

#### `resolveConditionalFormats`

```ts
function resolveConditionalFormats(
  rules: readonly ConditionalFormatRule[] | undefined,
  scope: Record<string, unknown>,
  options?: {
    locale?: string;
    subject?: string;
  },
): ConditionalFormatOverrides;
```

Evaluates conditional-format rules in declaration order and combines the styles from rules whose conditions are true. If multiple rules set the same property, the later rule wins.

Invalid syntax or a non-boolean result throws a `SlipRenderError`. If a condition cannot be evaluated because of a missing value, type mismatch, or similar computation error, that rule is skipped.

#### `FormulaValue`

```ts
type FormulaValue =
  | number
  | string
  | boolean
  | null
  | FormulaValue[];
```

#### `FormulaAst`

`FormulaAst` is a discriminated union composed of the following nodes.

| `type` | Meaning |
|---|---|
| `number` | Number literal |
| `string` | String literal |
| `boolean` | Boolean value |
| `reference` | Reference to a parameter or sub-field |
| `call` | Function call |
| `unary` | Unary `+`, `-` |
| `binary` | Arithmetic or comparison operation |

#### `FORMULA_FUNCTIONS`

```ts
const FORMULA_FUNCTIONS:
  readonly FormulaFunctionName[];
```

The list of currently registered formula function names. Functions not in this list are rejected at the parsing stage.

For each function's arguments and usage, see the [Formula Function Reference](formula.md).

#### `FORMULA_ARITY`

```ts
interface FormulaArity {
  min: number;
  max?: number;
}

const FORMULA_ARITY:
  Record<FormulaFunctionName, FormulaArity>;
```

Defines the minimum and maximum number of arguments accepted by each supported function. When `max` is omitted, there is no upper limit.

#### `assertFormulaArity`

```ts
function assertFormulaArity(
  ast: FormulaAst,
  options?: { locale?: string },
): void;
```

Checks the number of arguments in every function call in a parsed AST. It throws `FormulaEvalError` when an argument count does not match `FORMULA_ARITY`. The formula is not evaluated, so no voucher values are required.

#### `FormulaFunctionName`

```ts
type FormulaFunctionName =
  (typeof FORMULA_FUNCTIONS)[number];
```

A string union of the supported formula function names.

### Encryption

#### `encryptSlipFile`

```ts
function encryptSlipFile(
  file: SlipFile,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<string>;
```

Converts a `.slip` file into an AES-256-GCM encryption envelope JSON.

A string key is treated as a passphrase, and a `Uint8Array` key must be a 32-byte raw AES key.

#### `decryptSlipFile`

```ts
function decryptSlipFile(
  json: string,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<SlipFile>;
```

Decrypts an encryption envelope and then validates it with `parseSlipFile`. `options.locale` selects the error message language (English by default).

#### `isEncryptedSlipFile`

```ts
function isEncryptedSlipFile(
  json: string,
): boolean;
```

Checks whether the JSON has the SlipKit encryption envelope marker.

It is not a function that verifies whether decryption is possible or that the data has integrity.

## `.slip` file types

### `JsonValue`

```ts
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
```

A JSON value that can be used in a voucher's `values` and a template's `sampleValues`.

### `SlipFile`

```ts
type SlipFile =
  | SlipTemplateFile
  | SlipVoucherFile;
```

A discriminated union that distinguishes templates and vouchers by `kind`.

### `SlipFileKind`

```ts
type SlipFileKind =
  SlipFile['kind'];
```

The current values are the following two.

```ts
type SlipFileKind =
  | 'template'
  | 'voucher';
```

### `SlipTemplateFile`

```ts
interface SlipTemplateFile {
  schemaVersion: string;
  kind: 'template';
  template: SlipTemplateBody;
}
```

### `SlipVoucherFile`

```ts
interface SlipVoucherFile {
  schemaVersion: string;
  kind: 'voucher';
  templateSnapshot:
    SlipTemplateBody;

  values:
    Record<string, JsonValue>;

  issued: boolean;
}
```

| Field | Description |
|---|---|
| `templateSnapshot` | The entire template as it was when the voucher was created |
| `values` | The parameter physical names and their actual values |
| `issued` | Whether it has been issued |

An issued voucher cannot depend on external URL images. Fixed image and variable image values must be included in a form usable within the file.

### `SlipTemplateBody`

```ts
interface SlipTemplateBody {
  meta: {
    title: string;
    createdAt?: string;
    updatedAt?: string;
  };

  paper: CorePaperSize;
  pages: SlipPage[];
  assets: AssetEntry[];

  parameters?:
    ParameterDef[];

  sampleValues?:
    Record<string, JsonValue>;
}
```

| Field | Required | Description |
|---|:---:|---|
| `meta` | ● | The template title and optional created/updated times |
| `paper` | ● | Paper size and padding |
| `pages` | ● | At least one page |
| `assets` | ● | Assets such as images included in the file |
| `parameters` | — | The list of parameter definitions |
| `sampleValues` | — | Values for the designer preview |

`createdAt` and `updatedAt` use ISO date-time strings that include a time-zone offset.

### Core's `PaperSize`

The `PaperSize` that `@omdc-slipkit/core` exposes is the actual paper size inside the `.slip` file.

```ts
interface CorePaperSize {
  width: number;
  height: number;

  padding: [
    top: number,
    right: number,
    bottom: number,
    left: number,
  ];
}
```

The unit of the size and padding is millimeters.

> [!CAUTION]
> `@omdc-slipkit/elements` also exposes a name `PaperSize`, but its purpose is different.
> The Elements `PaperSize` is a paper preset in the shape `{ name, width, height }` shown in the designer's selection list.

If you use both types together, it is safer to specify aliases.

```ts
import type {
  PaperSize as SlipPaperSize,
} from '@omdc-slipkit/core';

import type {
  PaperSize as PaperPreset,
} from '@omdc-slipkit/elements';
```

### `SlipPage`

```ts
interface SlipPage {
  elements: SlipElement[];
  key?: string;
  label?: string;
  pageNumber?: PageNumber;
  flowArea?: PageFlowArea;
}
```

| Field | Description |
|---|---|
| `elements` | The elements placed on the page |
| `key` | The page physical name used for external integration |
| `label` | The page logical name shown in the designer list |
| `pageNumber` | The page-number setting shown in the PDF |
| `flowArea` | The vertical area used by auto-growing elements |

Within a document, `key` cannot be duplicated.

### `PageFlowArea`

```ts
interface PageFlowArea {
  top: number;
  bottom: number;
}
```

`top` and `bottom` are millimeter coordinates measured from the top of the paper. When omitted, the area between the top and bottom paper margins is used.

### `PageNumber`

```ts
interface PageNumber {
  position: PageNumberPosition;
  format?: string;
  fontSize?: number;
}
```

In `format`, `{n}` is converted to the current page number and `{total}` to the total number of pages.

The default format is `{n} / {total}`.

### `PageNumberPosition`

```ts
type PageNumberPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'top-left'
  | 'top-center'
  | 'top-right';
```

### `AssetEntry`

```ts
interface AssetEntry {
  id: string;
  mimeType: string;
  src: string;
}
```

`src` can use the following forms.

| Form | Example |
|---|---|
| External URL | `https://example.com/logo.png` |
| Base64 data | `data:image/png;base64,...` |
| Embedded asset reference | `asset://company-logo` |

An issued voucher cannot include external URL images.

### `ParameterDef`

```ts
interface ParameterDef {
  key: string;
  label?: string;
  valueType?:
    ParameterValueType;

  fields?: ParameterField[];
}
```

| Field | Description |
|---|---|
| `key` | The physical name used in the file, formulas, and external integration |
| `label` | The logical name shown in the form and the designer |
| `valueType` | The value type. Treated as text if omitted |
| `fields` | The sub-fields of a list parameter |

### `ParameterField`

```ts
interface ParameterField {
  key: string;
  label?: string;
  valueType?:
    ParameterValueType;
}
```

A sub-field cannot have `fields` again.

### `ParameterValueType`

```ts
type ParameterValueType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'image'
  | 'list';
```

`fields` can only be used on a parameter with `valueType: 'list'`.

## Element types

### `SlipElement`

```ts
type SlipElement =
  | TextElement
  | FieldElement
  | GridElement
  | ImageElement
  | BarcodeElement
  | LineElement
  | RectElement
  | EllipseElement
  | PolygonElement;
```

Nine kinds of element are distinguished by `type`.

### Common fields of all elements

| Field | Type | Description |
|---|---|---|
| `type` | String union | The element kind |
| `id` | `string` | An element identifier unique across the whole document |
| `name` | `string` | The element name shown in the designer |
| `position` | `{ x, y }` | The position relative to the top-left of the page (mm) |
| `width` | `number` | Element width (mm). Grids omit it because their width is the sum of column widths |
| `height` | `number` | Element height (mm). Grids omit it because their height is the sum of row heights |
| `group` | `string?` | A group identifier that binds multiple elements together |
| `pagePlacement` | `PagePlacement?` | Placement and visibility on generated output pages |

### `PagePlacement`

```ts
type OutputPageFilter =
  | 'all'
  | 'first'
  | 'continuation'
  | 'non-final'
  | 'last';

type PagePlacement =
  | { mode: 'absolute'; pages?: OutputPageFilter }
  | { mode: 'after'; target: string; gap?: number };
```

`absolute` keeps the original coordinates and uses `pages` to choose the output pages on which the element appears. `after` places the element after the target element's last output fragment on the same source page.

### Text style fields

The following fields can be used on text, field, grid, and grid cells.

| Field | Type | Default behavior |
|---|---|---|
| `fontName` | `string?` | Use the fallback font |
| `fontSize` | `number?` | The element's default size |
| `alignment` | `'left' \| 'center' \| 'right'` | Left aligned |
| `verticalAlignment` | `'top' \| 'middle' \| 'bottom'` | Top aligned |
| `bold` | `boolean?` | Use the bold font variant |
| `italic` | `boolean?` | Use the italic font variant |
| `underline` | `boolean?` | Underline |
| `strikethrough` | `boolean?` | Strikethrough |
| `lineHeight` | `number?` | The line spacing multiple |
| `characterSpacing` | `number?` | The character spacing (pt) |
| `vertical` | `boolean?` | Vertical writing |

### Color and border fields

The following fields are used on elements that support the corresponding style.

| Field | Type |
|---|---|
| `backgroundColor` | `#RRGGBB` or `#RRGGBBAA` |
| `fontColor` | `#RRGGBB` or `#RRGGBBAA` |
| `borderColor` | `#RRGGBB` or `#RRGGBBAA` |
| `borderWidth` | `number` |
| `borderStyle` | `'solid' \| 'dashed' \| 'dotted'` |

### `ConditionalFormatRule`

```ts
interface ConditionalFormatRule {
  condition: string;
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}
```

`condition` is a formula that returns a boolean. Each rule must set at least one color or text-emphasis property. An element or cell can have up to 20 rules.

For text-emphasis properties, `true` enables the emphasis and `false` disables the base style's emphasis. Omitting a property preserves the base style or the result from an earlier rule.

`conditionalFormats?: ConditionalFormatRule[]` is available only on `TextElement`, `FieldElement`, and `GridCell`.

### `ConditionalFormatOverrides`

```ts
interface ConditionalFormatOverrides {
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}
```

The style returned by `resolveConditionalFormats`. Every property is absent when no rule has a true condition.

### `TextElement`

```ts
interface TextElement {
  type: 'text';
  content: string;
  conditionalFormats?: ConditionalFormatRule[];

  // common position & size,
  // text/color/border style
}
```

A fixed string shown identically on all vouchers.

### `FieldElement`

```ts
interface FieldElement {
  type: 'field';

  parameter?: string;
  formula?: string;
  conditionalFormats?: ConditionalFormatRule[];

  // common position & size,
  // text/color/border style
}
```

It must have exactly one of `parameter` and `formula`.

### `ImageElement`

```ts
interface ImageElement {
  type: 'image';

  src?: string;
  parameter?: string;

  // common position & size
}
```

| Field | Role |
|---|---|
| `src` | A fixed image that is the same on all vouchers |
| `parameter` | The key of an image value that differs per voucher |

It must have exactly one of `src` and `parameter`.

The voucher value of a variable image uses a `data:` Base64 string.

### `BarcodeElement`

```ts
interface BarcodeElement {
  type: 'barcode';

  kind: BarcodeKind;

  content?: string;
  parameter?: string;
  formula?: string;
  conditionalFormats?: ConditionalFormatRule[];

  fontColor?: string;
  backgroundColor?: string;
}
```

It must have exactly one of `content`, `parameter`, and `formula`.

### `BarcodeKind`

```ts
type BarcodeKind =
  | 'qrcode'
  | 'code128'
  | 'ean13'
  | 'code39'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'itf14'
  | 'nw7'
  | 'japanpost'
  | 'gs1datamatrix'
  | 'pdf417';
```

### `LineElement`

```ts
interface LineElement {
  type: 'line';

  borderColor?: string;
  borderWidth?: number;

  borderStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted';

  lineDirection?:
    | 'horizontal'
    | 'vertical'
    | 'down'
    | 'up';
}
```

If `lineDirection` is omitted, `horizontal` is used.

### `RectElement`

```ts
interface RectElement {
  type: 'rect';

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;

  borderStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted';

  radius?: number;
}
```

If `radius` is greater than `0`, a dashed or dotted border cannot be used together.

### `EllipseElement`

```ts
interface EllipseElement {
  type: 'ellipse';

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}
```

### `PolygonElement`

```ts
interface PolygonElement {
  type: 'polygon';

  sides: number;

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}
```

`sides` is an integer from 3 to 12.

### `GridElement`

```ts
interface GridElement {
  type: 'grid';

  id: string;
  name: string;
  position: { x: number; y: number };
  group?: string;
  pagePlacement?: PagePlacement;

  columns: {
    width: number;
    autoMerge?: boolean;
  }[];

  rows: {
    height: number;
  }[];

  cells: GridCell[];
  repeat?: GridRepeat;

  overflow?:
    | 'clip'
    | 'shrink';

  // text/color/border style
}
```

Column widths and row heights are absolute values in millimeters, not ratios.

- Grid width is calculated from the sum of column widths.
- The template height of a grid is calculated from the sum of row heights.
- Repeated output height and output-page count are calculated from the row bands and page mode in `repeat`.

### `GridCell`

```ts
interface GridCell {
  row: number;
  column: number;

  name?: string;

  rowSpan?: number;
  colSpan?: number;

  content?: string;
  parameter?: string;
  formula?: string;

  overflow?:
    | 'clip'
    | 'shrink';

  // text/color/border style
}
```

`row` and `column` start at 0.

`content`, `parameter`, and `formula` cannot be used two or more at the same time.

`name` identifies the cell in the designer and is not printed in the PDF. When omitted, the designer shows the cell coordinates.

A `parameter` in an `item` row band refers to a sub-field of a list item. Outside that band, it refers to a top-level key of the voucher `values`.

### `GridRepeat`

```ts
interface GridRepeat {
  parameter: string;
  bands: GridBand[];
  pagination: GridPagination;
  groupBy?: string[];
  maxItems?: number;
}
```

| Field | Description |
|---|---|
| `parameter` | A list parameter holding an array of objects |
| `bands` | Row ranges and the output stage at which each range is rendered |
| `pagination` | Auto-grow or fixed-page mode |
| `groupBy` | Item sub-fields that group consecutive items |
| `maxItems` | The upper limit on the total number of output items |

### `GridBand`

```ts
type GridBandPlacement =
  | 'before-data'
  | 'page-start'
  | 'group-start'
  | 'item'
  | 'group-end'
  | 'after-data'
  | 'page-end';

interface GridBand {
  id: string;
  name?: string;
  fromRow: number;
  toRow: number;
  placement: GridBandPlacement;
  pages?: OutputPageFilter;
  repeatOnPageBreak?: boolean;
}
```

`fromRow` and `toRow` are zero-based and inclusive. Every template row must belong to exactly one band without gaps or overlaps, and exactly one `item` band is required.

Bands follow this order: `before-data`, `page-start`, `group-start`, `item`, `group-end`, `after-data`, `page-end`. `pages` limits where a `page-start` or `page-end` band appears. `repeatOnPageBreak` repeats a `group-start` band when its group continues on another page.

### `GridPagination`

```ts
type GridPagination =
  | { mode: 'auto'; minItems: number }
  | { mode: 'fixed'; itemsPerPage: number };
```

`auto` reserves at least `minItems` item slots for the document and plans output pages from the actual data and flow area. `fixed` reserves `itemsPerPage` slots on every output page. Both modes fill unused slots with blank items, which are excluded from calculation scopes.

## Storage API

### `StorageAdapter`

```ts
interface StorageAdapter {
  save(
    id: string,
    file: SlipFile,
  ): Promise<void>;

  load(
    id: string,
  ): Promise<SlipFile>;

  delete(
    id: string,
  ): Promise<void>;

  list(
    filter?: SlipListFilter,
    cursor?: string,
  ): Promise<SlipListPage>;
}
```

| Method | Description |
|---|---|
| `save` | Overwrites if the same ID exists |
| `load` | Loads the file for the given ID |
| `delete` | Deletes the file for the given ID |
| `list` | Lists by kind and search term |

### `SlipListFilter`

```ts
interface SlipListFilter {
  kind?: SlipFileKind;
  query?: string;
}
```

### `SlipListPage`

```ts
interface SlipListPage {
  items: SlipListItem[];
  nextCursor?: string;
}
```

If there is no `nextCursor`, it is the last page.

### `SlipListItem`

```ts
interface SlipListItem {
  id: string;
  kind: SlipFileKind;
  title: string;
  updatedAt?: string;
}
```

List metadata that does not include the file body.

### `VersionedStorageAdapter`

```ts
interface VersionedStorageAdapter
  extends StorageAdapter {
  listVersions(
    id: string,
  ): Promise<{
    version: string;
    savedAt: string;
  }[]>;

  loadVersion(
    id: string,
    version: string,
  ): Promise<SlipFile>;
}
```

An extension interface that a custom storage supporting version history can optionally implement.

The bundled `IndexedDbStorage` does not implement this interface. `SlipFileExchange` is not storage and does not implement `StorageAdapter`.

### `supportsVersions`

```ts
function supportsVersions(
  adapter: StorageAdapter,
): adapter is VersionedStorageAdapter;
```

A type guard that checks whether the storage implements both `listVersions` and `loadVersion`.

## Schema and migration API

### Public Zod schemas

The following schemas can be imported from `@omdc-slipkit/core`.

| Schema | Validation scope |
|---|---|
| `slipEnvelopeSchema` | `schemaVersion` and `kind` |
| `slipFileSchema` | An entire template or voucher |
| `slipTemplateFileSchema` | An entire template file |
| `slipVoucherFileSchema` | An entire voucher file |
| `slipTemplateBodySchema` | The template body |
| `slipElementSchema` | A single element |
| `paperSchema` | Paper size and padding |

For typical external-input validation, we recommend `parseSlipFile` or `validateSlipFile`, which perform migration and error conversion together, rather than calling the schemas directly.

### `slipFileJsonSchema`

```ts
function slipFileJsonSchema():
  Record<string, unknown>;
```

Creates a draft 2020-12 JSON Schema object of the current `.slip` format.

The package also includes the following JSON Schema files.

- `@omdc-slipkit/core/schemas/slip.schema.json`
- Per-version `slip-<schemaVersion>.schema.json`

> [!IMPORTANT]
> There are some cross-field validations that cannot be expressed in JSON Schema.
> Complete validation must be based on `parseSlipFile` or `validateSlipFile`.

### `migrateSlipDocument`

```ts
function migrateSlipDocument(
  document:
    Record<string, unknown>,

  steps?:
    readonly SlipMigrationStep[],
): Record<string, unknown>;
```

Converts a document's `schemaVersion` step by step up to the current version.

Since `parseSlipFile` and `validateSlipFile` usually call it internally, you rarely need to use it directly.

### `SlipMigrationStep`

```ts
interface SlipMigrationStep {
  from: string;
  to: string;

  migrate(
    document:
      Record<string, unknown>,
  ): Record<string, unknown>;
}
```

### `BUILT_IN_MIGRATIONS`

```ts
const BUILT_IN_MIGRATIONS:
  readonly SlipMigrationStep[];
```

The list of migration steps included in the library.

Since the current base schema is the first public format, the list is empty.

### `SLIP_LIMITS`

The structural size limits used in file validation.

| Field | Current value | Meaning |
|---|---:|---|
| `maxPages` | 500 | Maximum number of pages per document |
| `maxElementsPerPage` | 2,000 | Maximum number of elements per page |
| `maxAssets` | 1,000 | Maximum number of assets per document |
| `maxGridCells` | 100,000 | Maximum number of grid cells |
| `maxParameters` | 500 | Maximum number of parameter definitions |
| `maxGridRowTracks` | 1,000 | Maximum number of grid rows |
| `maxGridColumnTracks` | 100 | Maximum number of grid columns |
| `maxRepeatPerPage` | 1,000 | Maximum number of repeat items per page |
| `maxRepeatItems` | 100,000 | Upper limit on the total number of repeat-list items |
| `maxLineHeight` | 10 | Upper limit on the line spacing multiple |
| `maxCharacterSpacing` | 100 | Upper limit on the absolute character spacing (pt) |

## `@omdc-slipkit/elements`

Importing the package root registers the three Web Components.

```ts
import '@omdc-slipkit/elements';
```

The class types can also be imported directly.

```ts
import type {
  SlipDesigner,
  SlipForm,
  SlipViewer,
} from '@omdc-slipkit/elements';
```

### `<slip-designer>`

Visually edits a template file.

#### Attributes and properties

| Name | Type | How to pass | Default |
|---|---|---|---|
| `src` | `string` | HTML attribute · property | `''` |
| `locale` | `string` | HTML attribute · property | The `SlipKit` locale or English |
| `slipkit` | `SlipKit` | JS property | Omitted |
| `settings` | `SlipDesignerSettings` | JS property | Bundled default settings |
| `presets` | `SlipPreset[]` | JS property | 2 bundled presets |
| `storage` | `StorageAdapter` | JS property | Save feature hidden |
| `maxImageBytes` | `number` | `max-image-bytes` attribute · property | 2MB |

For `src`, pass the JSON string of a `kind: 'template'` file converted with `serializeSlipFile`.

#### Events

| Event | `detail` | When it fires |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | When the template is edited |

The actual `file.kind` is `'template'`.

This event is delivered with `bubbles: true`, `composed: true`.

### `<slip-form>`

Fills a template with values and issues a voucher.

#### Attributes and properties

| Name | Type | How to pass | Default |
|---|---|---|---|
| `src` | `string` | HTML attribute · property | `''` |
| `locale` | `string` | HTML attribute · property | The `SlipKit` locale or English |
| `slipkit` | `SlipKit` | JS property | Omitted |
| `maxImageBytes` | `number` | `max-image-bytes` attribute · property | 2MB |

For `src`, you can pass the following files.

- A `kind: 'template'` template
- A `kind: 'voucher'`, `issued: false` draft voucher
- A `kind: 'voucher'`, `issued: true` issued voucher

If you pass an issued voucher, input is locked.

#### Events

| Event | `detail` | When it fires |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | When the input values change |
| `slip-issue` | `{ file: SlipFile }` | When voucher issuing completes |

In both events, the actual `file.kind` is `'voucher'`.

The events are delivered with `bubbles: true`, `composed: true`.

### `<slip-viewer>`

Renders a template or voucher as a PDF and displays it read-only.

#### Attributes and properties

| Name | Type | How to pass | Default |
|---|---|---|---|
| `src` | `string` | HTML attribute · property | `''` |
| `locale` | `string` | HTML attribute · property | The `SlipKit` locale or English |
| `slipkit` | `SlipKit` | JS property | Omitted |

The viewer does not fire any file-change event.

## Elements settings types

### `SlipDesignerSettings`

```ts
interface SlipDesignerSettings {
  getBarcodeKinds?():
    | BarcodeKind[]
    | Promise<BarcodeKind[]>;

  getPaperSizes?():
    | ElementPaperSize[]
    | Promise<ElementPaperSize[]>;

  savePaperSize?(
    size: ElementPaperSize,
  ):
    | void
    | Promise<void>;
}
```

### Elements' `PaperSize`

```ts
interface ElementPaperSize {
  name: string;
  width: number;
  height: number;
}
```

A preset shown in the designer's paper selection list. Unlike the actual `.slip` paper type, it has a `name` and no `padding`.

### `SlipPreset`

```ts
interface SlipPreset {
  id: string;
  name: string;

  create():
    SlipTemplateFile;
}
```

`create` must return an independent new template object each time it is called.

## Elements built-in API

### `getPresets`

```ts
function getPresets(
  locale?: string,
): SlipPreset[];
```

Builds the list of the bundled trade statement and invoice presets. Titles, labels, and phrases are filled in the `locale` language (English by default).

### `IndexedDbStorage`

```ts
class IndexedDbStorage
  implements StorageAdapter {
  constructor(
    slipkit: SlipKit,
    options?:
      IndexedDbStorageOptions,
  );
}
```

Stores `.slip` files in the browser's IndexedDB.

Supports all of `save`, `load`, `delete`, and `list`.

#### `IndexedDbStorageOptions`

```ts
interface IndexedDbStorageOptions {
  dbName?: string;
  pageSize?: number;
  encryptOnSave?: boolean;
}
```

| Field | Default | Description |
|---|---|---|
| `dbName` | `'slipkit'` | The IndexedDB database name |
| `pageSize` | `50` | The number of items per list page |
| `encryptOnSave` | `false` | Whether to encrypt file bodies when saving |

### `SlipFileExchange`

```ts
class SlipFileExchange {
  constructor(
    slipkit: SlipKit,
    options?: SlipFileExchangeOptions,
  );

  download(
    name: string,
    file: SlipFile,
  ): Promise<void>;

  open(): Promise<SlipFile>;
}
```

`SlipFileExchange` provides browser downloads and the file picker. It does not implement `StorageAdapter`; it only provides `download` and `open`.

#### `SlipFileExchangeOptions`

```ts
interface SlipFileExchangeOptions {
  encryptOnSave?: boolean;
}
```

`encryptOnSave` defaults to `false`. Opening detects encrypted envelopes regardless of this option and decrypts them with the keys configured in `SlipKit`.

### Bundled fonts

#### `PRETENDARD_FONTS`

```ts
const PRETENDARD_FONTS:
  SlipFont[];
```

Includes Pretendard Regular and Bold. Regular is specified as the fallback font.

#### `NOTO_SANS_JP_FONTS`

```ts
const NOTO_SANS_JP_FONTS:
  SlipFont[];
```

Includes the Noto Sans JP Regular subset. That font is specified as the fallback font.

## `@omdc-slipkit/react`

Supports React 19 or later.

### `SlipDesigner`

```ts
interface SlipDesignerProps {
  src: string;
  locale?: string;
  slipkit?: SlipKit;

  settings?:
    SlipDesignerSettings;

  presets?: SlipPreset[];
  storage?: StorageAdapter;

  maxImageBytes?: number;

  onSlipChange?(
    file: SlipFile,
  ): void;
}
```

It removes the `CustomEvent` from the Web Component's `slip-change` event and passes the `SlipFile` object directly to the callback.

### `SlipForm`

```ts
interface SlipFormProps {
  src: string;
  locale?: string;
  slipkit?: SlipKit;

  maxImageBytes?: number;

  onSlipChange?(
    file: SlipFile,
  ): void;

  onSlipIssue?(
    file: SlipFile,
  ): void;
}
```

### `SlipViewer`

```ts
interface SlipViewerProps {
  src: string;
  locale?: string;
  slipkit?: SlipKit;
}
```

The React package also lets you import these props types directly.

```ts
import type {
  SlipDesignerProps,
  SlipFormProps,
  SlipViewerProps,
} from '@omdc-slipkit/react';
```

## `@omdc-slipkit/vue`

Supports Vue 3.4 or later.

### `SlipDesigner`

| prop | Type | Required |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |
| `settings` | `SlipDesignerSettings` | — |
| `presets` | `SlipPreset[]` | — |
| `storage` | `StorageAdapter` | — |
| `maxImageBytes` | `number` | — |

Emitted events:

| Event | Payload |
|---|---|
| `slip-change` | `SlipFile` |

### `SlipForm`

| prop | Type | Required |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |
| `maxImageBytes` | `number` | — |

Emitted events:

| Event | Payload |
|---|---|
| `slip-change` | `SlipFile` |
| `slip-issue` | `SlipFile` |

### `SlipViewer`

| prop | Type | Required |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |

## `@omdc-slipkit/mcp`

`@omdc-slipkit/mcp` provides a local stdio MCP server and the file-system storage used by that server. See the [MCP Guide](mcp.md) for connection and tool usage.

### `createSlipMcpServer`

```ts
function createSlipMcpServer(
  options: SlipMcpServerOptions,
): {
  server: McpServer;
  storage: FileSystemStorage;
};
```

Creates an MCP server with seven tools and the `slip://schema` resource. The returned `server` is not yet connected to a transport.

```ts
interface SlipMcpServerOptions
  extends FileSystemStorageOptions {
  fonts?: readonly SlipFont[];
}
```

When `fonts` is omitted, the server uses the bundled fonts selected by locale. A supplied list replaces the bundled fonts.

### `FileSystemStorage`

```ts
class FileSystemStorage
  implements StorageAdapter {
  readonly rootDir: string;

  constructor(options: FileSystemStorageOptions);
  resolvePath(id: string): string;
  save(id: string, file: SlipFile): Promise<void>;
  load(id: string): Promise<SlipFile>;
  delete(id: string): Promise<void>;
  list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage>;
}
```

A Node.js storage adapter that reads and writes `.slip` files inside a designated root directory. It appends the `.slip` extension when omitted and throws `SlipStorageError` for paths outside the root.

```ts
interface FileSystemStorageOptions {
  rootDir: string;
  locale?: string;
  encryption?: {
    key: FileSystemStorageKey;
    previousKeys?: FileSystemStorageKey[];
  };
}

type FileSystemStorageKey = string | Uint8Array;
```

### `slipkit-mcp.json`

```ts
interface SlipMcpConfig {
  rootDir?: string;
  locale?: string;
  fonts?: Array<{
    name: string;
    path: string;
    fallback?: boolean;
  }>;
  encryption?: {
    keyEnv?: string;
    previousKeysEnv?: string;
  };
}

interface ResolveInput {
  configPath?: string;
  cliRootDir?: string;
  cliLocale?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}
```

Relative `rootDir` and `fonts[].path` values are resolved from the configuration file directory. Unknown fields, invalid JSON, missing working directories, and missing font files throw `SlipMcpConfigError`.

### MCP configuration API

| Export | Description |
|---|---|
| `readConfigFile(filePath)` | Reads and validates a JSON file as `SlipMcpConfig`. |
| `loadConfigFonts(entries, baseDir)` | Reads configured font files and returns `SlipFont[]`. |
| `resolveServerOptions(input)` | Resolves the configuration file, CLI values, and environment into `{ options, configPath }`. |
| `SlipMcpConfigError` | Error thrown when configuration or a referenced resource cannot be read or applied. |
| `CONFIG_FILE_NAME` | Default configuration filename: `slipkit-mcp.json`. |
| `DEFAULT_KEY_ENV` | Default current-key environment-variable name: `SLIPKIT_MCP_KEY`. |
| `DEFAULT_PREVIOUS_KEYS_ENV` | Default previous-keys environment-variable name: `SLIPKIT_MCP_PREVIOUS_KEYS`. |

### Other MCP exports

| Export | Description |
|---|---|
| `resolveInRoot(rootDir, relPath, locale?)` | Resolves a relative path inside the root directory and throws when it escapes the root. |
| `editOpSchema` | Zod schema for `slip_edit` operations. |
| `EditOp` | Operation type inferred from `editOpSchema`. |
| `MAX_IMAGE_BYTES` | Maximum image size accepted by `set_image`: `2 * 1024 * 1024`. |
| `SCHEMA_TOPICS` | Topics supported by `slip_schema`. |
| `SchemaTopic` | Element type of `SCHEMA_TOPICS`. |
| `schemaTopicText(topic)` | Returns the English `.slip` structure guide for a topic. |

## Error types

### `SlipParseError`

Thrown when `.slip` JSON parsing, schema validation, or migration fails.

### `SlipMigrationError`

When you call `migrateSlipDocument` directly, it indicates a migration failure such as the following.

- Invalid version format
- A version newer than the current library
- No migration path
- A cycle in the migration path

Migration errors that occur through `parseSlipFile` and `validateSlipFile` are converted to `SlipParseError`.

### `SlipRenderError`

Thrown when PDF conversion, font configuration, or template formula computation fails.

### `FormulaSyntaxError`

Thrown when formula syntax analysis fails.

```ts
class FormulaSyntaxError
  extends Error {
  readonly position: number;
}
```

`position` is the 0-based position in the formula string where the error occurred.

### `FormulaEvalError`

```ts
type FormulaEvalReason =
  | 'data'
  | 'value'
  | 'formula';

class FormulaEvalError
  extends Error {
  readonly reason: FormulaEvalReason;
  get dataDependent(): boolean;
}
```

Used when a type mismatch, an invalid argument, or division by zero occurs during formula evaluation.

`reason` says why the evaluation failed: `data` when a value is missing or a reserved range is unavailable, `value` when a value used in the calculation is wrong, and `formula` when the formula itself is wrong.

`dataDependent` is true when different values could resolve the error. For a `value` reason it looks only at the value that actually failed to convert or pass a check, not at the other operands in the same place: `amount / 0` stays blocked because the constant divisor is at fault, while `amount / quantity` and `amount + 1` with a non-numeric `amount` do not. Use it instead of comparing error messages.

### `SlipEncryptionError`

Used for encryption/decryption failures such as the following.

- Missing encryption key
- An empty passphrase
- A raw key length error
- An unsupported encryption envelope
- A wrong key
- Ciphertext tampering
- The Web Crypto API being unavailable

### `SlipStorageError`

```ts
class SlipStorageError
  extends Error {
  readonly code:
    | 'not-found'
    | 'unsupported'
    | 'io'
    | 'cancelled';
}
```

| `code` | Meaning |
|---|---|
| `not-found` | No file for the given storage key |
| `unsupported` | The storage does not support the feature |
| `io` | A storage read/write failure |
| `cancelled` | The user cancelled the file selection |

## Related documents

- [Getting Started](getting-started.md)
- [Form Designer Usage Guide](designer.md)
- [Application Integration Guide](integration.md)
- [Core Usage Guide](core.md)
- [MCP Guide](mcp.md)
- [Configuration Guide](configuration.md)
- [Formula Function Reference](formula.md)
