/**
 * `slip_schema` 도구가 반환하는 `.slip` 구조 안내문.
 * AI에 제공하는 내용은 영어로 작성하고, 전체 필드 정의는 core가 생성한 JSON Schema로 제공한다.
 * 요소 종류처럼 스키마와 함께 바뀌어야 하는 내용은 테스트에서 대조한다.
 */
import {
  CURRENT_SCHEMA_VERSION,
  FORMULA_FUNCTIONS,
  MAX_IMAGE_BYTES,
  SLIP_LIMITS,
  slipFileJsonSchema,
} from '@omdc-slipkit/core';

/** `slip_schema` 도구가 지원하는 주제 */
export const SCHEMA_TOPICS = [
  'overview',
  'elements',
  'grid',
  'parameters',
  'formula',
  'voucher',
  'json-schema',
] as const;

/** `slip_schema` 주제 이름 */
export type SchemaTopic = (typeof SCHEMA_TOPICS)[number];

const OVERVIEW = `# .slip file structure (overview)

A .slip file is a JSON document. Two kinds exist:

- Template (blank form): { "schemaVersion": "${CURRENT_SCHEMA_VERSION}", "kind": "template", "template": BODY }
- Voucher (filled document): { "schemaVersion": "${CURRENT_SCHEMA_VERSION}", "kind": "voucher", "templateSnapshot": BODY, "values": { key: value }, "issued": false }

BODY = {
  "meta": { "title": string },            // required, non-empty
  "paper": { "width": mm, "height": mm, "padding": [top, right, bottom, left] },
  "pages": [ { "elements": [Element, ...], "key"?: string, "label"?: string,
                 "pageNumber"?: { "position": string, "format"?: string, "fontSize"?: number } } ],
  "assets": [ { "id": string, "mimeType": string, "src": "data:..." } ],          // required, may be []
  "parameters"?: [ ParameterDef, ... ],
  "sampleValues"?: { key: value }         // preview-only sample data
}

All coordinates and sizes are millimeters on the paper. Colors are "#RRGGBB" or "#RRGGBBAA".
Every element has: type, id (unique in the file), name, position {x, y}, group?, pagePlacement?.
All types except grid also have width and height; a grid's size is the sum of its column widths
and row heights. A page may set "flowArea"?: { "top": mm, "bottom": mm } — the vertical range
repeating grids flow in (defaults to the paper padding edges).
Element types: text, field, image, barcode, line, rect, ellipse, polygon, grid.
Use topic "elements" for per-type fields, "grid" for tables, "parameters" for value definitions,
"formula" for computed values, "voucher" for filled documents, "json-schema" for the full JSON Schema.

Typical workflow: slip_schema -> slip_save (new file, full JSON) -> slip_render_pdf to check.
To modify an existing file: slip_read (summary) -> slip_read part=element -> slip_edit (targeted ops).`;

const ELEMENTS = `# Element types

Common fields (every element): type, id, name, position {x, y}, group?, pagePlacement?.
All types except grid also have width and height (a grid's size is the sum of its tracks).
pagePlacement controls output pages when a repeating grid multiplies pages:
  { "mode": "absolute", "pages"?: "all"|"first"|"continuation"|"non-final"|"last" }  // default all
  { "mode": "after", "target": elementId, "gap"?: mm }  // flows after the target's last output
  ("after" targets must be on the same page and must not form a cycle.)
Bundled fontName values (when the server has no custom fonts): "Pretendard", "Pretendard-Bold",
"Noto Sans JP". All are always available; an element without fontName uses the locale's default
(Pretendard, or Noto Sans JP when the server locale is Japanese). Japanese kanji needs
"Noto Sans JP"; Korean text needs Pretendard.
Text styling fields (text, field, grid, and grid cells): fontName?, fontSize?, alignment? (left|center|right),
verticalAlignment? (top|middle|bottom), bold?, italic?, underline?, strikethrough?, lineHeight?,
characterSpacing?, vertical?. Box styling for text, field, and grid cells: backgroundColor?, fontColor?,
borderColor?, borderWidth?, borderStyle? (solid|dashed|dotted). Grid borders use the fields described
in topic "grid".

Conditional formats (text, field, and grid cells): "conditionalFormats"?: [
  { "condition": formula, "fontColor"?, "backgroundColor"?, "borderColor"?,
    "bold"?, "italic"?, "underline"?, "strikethrough"? }, ... ]
  (max ${SLIP_LIMITS.maxConditionalFormats}).
The condition is a formula (see topic "formula") that must return a boolean, e.g. "$(amount) < 0".
Rules whose condition is true apply in declared order (later rules win per property); each rule
needs at least one color or emphasis. Emphasis booleans: true applies it, false clears the base
style's emphasis. bold/italic need a matching font variant to show in the PDF (SPEC 9.3). A condition that cannot be computed for the current data (missing value, type
mismatch) simply does not apply — blank templates render with base styles. Replace the whole array
via slip_edit set_element/set_cell fields, or pass {"conditionalFormats": null} to remove all rules.

- text: fixed label. { "type": "text", "content": string, ...styling }
- field: value filled per voucher. Exactly ONE of: "parameter" (a values key) or "formula".
  { "type": "field", "parameter": "customerName" } or { "type": "field", "formula": "SUM($(items).$(amount))" }
- image: exactly ONE of "src" or "parameter". For a fixed image, use slip_edit set_image with a local
  file path. It stores the bytes as a base64 data URL in assets[] and sets src to "asset://<assetId>".
  Images must be PNG or JPEG and at most ${MAX_IMAGE_BYTES / 1024 / 1024} MiB each; the server checks the
  file content (signature), not just the extension, and applies the same rule to any "data:" image
  given directly in src, assets[], or voucher image values.
  Do not author http(s) URLs. The file schema recognizes them for compatibility, but PDF rendering
  does not fetch external images and issued vouchers reject them. set_image replaces parameter binding;
  this server does not provide a path-based operation for voucher image parameter values.
- barcode: { "type": "barcode", "kind": "qrcode"|"code128"|"ean13"|"code39"|"ean8"|"upca"|
  "upce"|"itf14"|"nw7"|"japanpost"|"gs1datamatrix"|"pdf417", plus exactly ONE of content /
  parameter / formula, fontColor?, backgroundColor? }
- line: { "type": "line", "lineDirection"?: "horizontal"|"vertical"|"down"|"up", borderColor?, borderWidth?, borderStyle? }
- rect: { "type": "rect", backgroundColor?, borderColor?, borderWidth?, borderStyle?, "radius"?: mm }
  (radius cannot combine with dashed/dotted border)
- ellipse: inscribed in the element box; solid border only.
- polygon: regular polygon, { "sides": 3..12 }; solid border only.
- grid: table with fixed and repeating rows — see topic "grid".`;

const GRID = `# Grid element (tables)

{
  "type": "grid", ...common fields and text/background styling (no width/height),
  "cellBorderColor"?: color, "cellBorderWidth"?: mm, "cellBorderStyle"?: "solid"|"dashed"|"dotted",
  "outlineColor"?: color, "outlineWidth"?: mm, "outlineStyle"?: "solid"|"dashed"|"dotted",
  "columns": [ { "width": mm, "autoMerge"?: boolean }, ... ],
  "rows":    [ { "height": mm }, ... ],
  "cells":   [ Cell, ... ],
  "repeat"?: {
    "parameter": listKey,
    "bands": [ { "id": string, "fromRow": n, "toRow": n, "placement": Placement,
                 "name"?: string, "pages"?: PageFilter, "repeatOnPageBreak"?: boolean }, ... ],
    "pagination": { "mode": "auto", "minItems": n } | { "mode": "fixed", "itemsPerPage": n },
    "groupBy"?: [ itemFieldKey, ... ],
    "maxItems"?: n
  },
  "overflow"?: "clip" | "shrink"
}

Placement (vertical order): "before-data" | "page-start" | "group-start" | "item" | "group-end" |
"after-data" | "page-end". PageFilter: "all" (default) | "first" | "continuation" | "non-final" | "last".

Constraints the validator enforces:
- cellBorder* is the default border for cells that omit the corresponding border* property. Its
  default is a black 0.2 mm solid line. A cell's border* overrides only the matching default field.
- outline* is a separate frame around the whole grid. Its default width is 0 (no frame), and every
  repeated output fragment receives all four sides. Changing outline* never changes cell borders.
- Legacy borderColor/borderWidth/borderStyle on a grid are accepted only as fallbacks for missing
  cellBorder* fields. Do not write them in new files, and never use them as the grid outline.
- Without repeat the grid is static. With repeat, the bands must cover every template row exactly
  once, in the placement order above, with exactly ONE "item" band (one or more rows). The item
  band is atomic — one data item never splits across output pages.
- Cell = { "row": r, "column": c (0-based), "name"?, "rowSpan"?, "colSpan"?,
  plus at most ONE value source: "content" (literal) / "parameter" / "formula", plus styling,
  "overflow"? and "conditionalFormats"? (see topic "elements") }. "name" is a display label for
  editors only and is never derived automatically from headers or parameters.
- Merged spans must not overlap other cells and must not cross a band boundary.
- Inside the item band, "parameter" on a cell names a FIELD of the list item, and a cell "formula"
  can reference the item's field keys as well.
- pagination "auto" fills each page's flow area and continues on the next page; minItems pads
  short data with empty item rows (0 shows only the fixed bands). "fixed" places exactly
  itemsPerPage item rows on every page; short data is padded with empty rows and a set that does
  not fit the flow area is a plan error. The two modes are exclusive — mixing their fields is
  rejected.
- "pages" applies only to page-start/page-end bands; a filtered-out band takes no space.
- group-start/group-end need "groupBy": consecutive items with equal values of those fields form a
  group. "repeatOnPageBreak" on a group-start band redraws it after a page break.
- maxItems caps the real data before planning (it may be smaller than itemsPerPage).
- columns[i].autoMerge merges vertically adjacent equal values inside the item band; merges break
  at group and output-page boundaries.
- Formulas and conditions in band cells can use reserved references (@item, @group, @page, @all,
  @carried) — see topic "formula".
- Page start: when the first item block of a repeating grid with data (page-start bands plus
  one item, or the whole itemsPerPage set in "fixed" mode) does not fit the remaining space of
  the page it is placed on, the grid starts on the next output page instead of leaving a
  header-only fragment. This applies to absolutely placed grids and "after" flows alike. If a
  block still does not fit the full flow area of an empty page, planning fails with an error.`;

const PARAMETERS = `# Parameters (values that fill a form)

Template BODY.parameters declares the inputs a voucher provides in "values":

ParameterDef = {
  "key": string,              // physical key used in files and formulas
  "label"?: string,           // display name
  "valueType"?: "text" | "number" | "date" | "boolean" | "image" | "list",  // default text
  "fields"?: [ { "key", "label"?, "valueType"? }, ... ]  // only when valueType is "list"
}

- A key is any non-empty string: dots, hyphens, spaces, leading digits, non-ASCII text, and
  names such as "__proto__", "constructor" or "toString" are all valid business keys. Keys must
  be unique by exact match — nothing is trimmed, case-folded or otherwise normalized, so "a" and
  "A" are different keys. List field keys follow the same rules.
- In formulas, write a key as $(key) — see topic "formula" for keys that are not plain identifiers.
- "values" may hold keys that no parameter declares; they are kept as open data. A key that is
  absent from "values" reads as null in formulas.
- List items are flat objects — fields cannot nest lists or objects.
- Elements reference parameters by key ("parameter": "customerName"); a grid repeat references a
  list parameter, and cells inside the repeat range reference the item's field keys.
- Template BODY.sampleValues holds sample data for preview only; voucher "values" holds real data.`;

const FORMULA = `# Formulas

Fields, barcodes and grid cells can compute their value with "formula" instead of "parameter".
Formulas run in a purpose-built parser (no JavaScript). Values are typed; convert explicitly.

- Reference values by parameter key, one $(...) per path step: $(customerName),
  $(items).$(amount) (a list field inside aggregates), @item.$(amount) (a reserved root followed
  by a key step). Inside $(...) any key is allowed — "a.b", "a b", "1a", non-ASCII, "__proto__" —
  and only two escapes exist: "\\)" for ")" and "\\\\" for "\\".
- Bare references (customerName, items.amount) are still accepted in existing files, but only for
  identifier-like keys, and one formula must not mix the two forms: once it contains $(...), every
  reference in it must use $(...). Write new formulas with $(...).
- Arithmetic operators: + - * /. Comparisons: = <> < > <= >=.
- Use CONCAT(...) for text concatenation; arithmetic operators require numeric values.
- Functions: ${FORMULA_FUNCTIONS.join(', ')}.
- FORMAT_NUMBER(value, fractionDigits?) adds locale digit grouping; the second argument is an
  integer number of decimal places (0-20), NOT a pattern string like "#,##0".
  FORMAT_DATE(date, pattern? = "YYYY-MM-DD") takes a token pattern with exactly nine tokens:
  YYYY YY MM M DD D HH mm ss. Put literal text in [...] (inside, "\\]" is "]" and "\\\\" is "\\").
  Outside brackets any other run of ASCII letters is an error ("YYYYY", "MMM", "Date"), while
  non-ASCII text, spaces and punctuation are literal. The date value must be "YYYY-MM-DD" or
  "YYYY-MM-DDTHH:mm[:ss[.fff]][Z|±HH:mm]"; without an offset it is read as UTC.
- Example: FORMAT_NUMBER(SUM($(items).$(amount)) * 1.1, 0)
- Reserved references (grid band cells only): @item (the current item), @group (items of the
  current group), @page (real items on the current output page), @all (all items after maxItems),
  @carried (real items placed on previous output pages). Example: SUM(@page.$(amount)) for a page
  subtotal, SUM(@carried.$(amount)) for a carried-over total. Empty padding rows are excluded.
- The "condition" of a conditionalFormats rule uses this same language and must return a boolean,
  e.g. $(amount) < 0 or AND($(amount) > 0, $(status) = "open").`;

const VOUCHER = `# Voucher files

A voucher freezes a template and fills it with data:

{
  "schemaVersion": "${CURRENT_SCHEMA_VERSION}",
  "kind": "voucher",
  "templateSnapshot": BODY,       // copied from the template at build time
  "values": { key: value },       // data for the declared parameters
  "issued": false                 // true = finalized and locked; this server never issues
}

- Build one with the slip_build_voucher tool (template path + values) instead of writing it by hand.
- values for a "list" parameter: an array of flat objects, e.g. [{ "name": "A", "amount": 100 }].
- Editing an issued voucher is rejected — issued documents are immutable.
- An issued voucher must embed images as data (no external URLs); this matters only when issuing,
  which happens in the host application, not through this server.`;

/**
 * 주제에 해당하는 안내문을 반환한다.
 *
 * @param topic - 주제 이름
 * @returns 안내문 (json-schema 주제는 core가 생성한 JSON Schema 전체 내용)
 */
export function schemaTopicText(topic: SchemaTopic): string {
  switch (topic) {
    case 'overview':
      return OVERVIEW;
    case 'elements':
      return ELEMENTS;
    case 'grid':
      return GRID;
    case 'parameters':
      return PARAMETERS;
    case 'formula':
      return FORMULA;
    case 'voucher':
      return VOUCHER;
    case 'json-schema':
      return JSON.stringify(slipFileJsonSchema(), null, 2);
  }
}
