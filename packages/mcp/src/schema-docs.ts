/**
 * `slip_schema` 도구가 반환하는 `.slip` 구조 안내문.
 * AI에 제공하는 내용은 영어로 작성하고, 전체 필드 정의는 core가 생성한 JSON Schema로 제공한다.
 * 요소 종류처럼 스키마와 함께 바뀌어야 하는 내용은 테스트에서 대조한다.
 */
import { FORMULA_FUNCTIONS, slipFileJsonSchema } from '@omdc-slipkit/core';

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

- Template (blank form): { "schemaVersion": "0.1.0", "kind": "template", "template": BODY }
- Voucher (filled document): { "schemaVersion": "0.1.0", "kind": "voucher", "templateSnapshot": BODY, "values": { key: value }, "issued": false }

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
Every element has: type, id (unique in the file), name, position {x, y}, width, height, group?.
Element types: text, field, image, barcode, line, rect, ellipse, polygon, grid.
Use topic "elements" for per-type fields, "grid" for tables, "parameters" for value definitions,
"formula" for computed values, "voucher" for filled documents, "json-schema" for the full JSON Schema.

Typical workflow: slip_schema -> slip_save (new file, full JSON) -> slip_render_pdf to check.
To modify an existing file: slip_read (summary) -> slip_read part=element -> slip_edit (targeted ops).`;

const ELEMENTS = `# Element types

Common fields (every element): type, id, name, position {x, y}, width, height, group?.
Text styling fields (text, field, grid, and grid cells): fontName?, fontSize?, alignment? (left|center|right),
verticalAlignment? (top|middle|bottom), bold?, italic?, underline?, strikethrough?, lineHeight?,
characterSpacing?, vertical?. Box styling: backgroundColor?, fontColor?, borderColor?, borderWidth?, borderStyle? (solid|dashed|dotted).

- text: fixed label. { "type": "text", "content": string, ...styling }
- field: value filled per voucher. Exactly ONE of: "parameter" (a values key) or "formula".
  { "type": "field", "parameter": "customerName" } or { "type": "field", "formula": "SUM(items.amount)" }
- image: exactly ONE of "src" or "parameter". For a fixed image, use slip_edit set_image with a local
  file path. It stores the bytes as a base64 data URL in assets[] and sets src to "asset://<assetId>".
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
  "type": "grid", ...common/styling fields,
  "columns": [ { "width": mm, "autoMerge"?: boolean }, ... ],
  "rows":    [ { "height": mm }, ... ],
  "cells":   [ Cell, ... ],
  "repeat"?: { "parameter": listKey, "fromRow": n, "toRow": n, "perPage": n, "repeatHeader": boolean, "maxItems"?: n },
  "overflow"?: "clip" | "shrink"
}

Constraints the validator enforces:
- Element width equals the sum of column widths. Without repeat, height equals the sum of row heights.
  With repeat, height = sum(all row heights) + (perPage - 1) * sum(fromRow..toRow heights).
- Cell = { "row": r, "column": c (0-based), "rowSpan"?, "colSpan"?, plus at most ONE value source:
  "content" (literal) / "parameter" / "formula", plus styling and "overflow"? }.
- Merged spans must not overlap other cells and must not cross the repeat range boundary.
- repeat: rows fromRow..toRow (inclusive) duplicate once per item of the list parameter.
  Inside the repeat range, "parameter" on a cell names a FIELD of the list item, and a cell
  "formula" can reference the item's field keys as well.
  perPage splits items across pages; maxItems, when present, must be at least perPage. repeatHeader
  redraws the rows above the repeat range on each page.
- columns[i].autoMerge merges vertically adjacent equal values inside the repeat range.`;

const PARAMETERS = `# Parameters (values that fill a form)

Template BODY.parameters declares the inputs a voucher provides in "values":

ParameterDef = {
  "key": string,              // physical key used in files and formulas
  "label"?: string,           // display name
  "valueType"?: "text" | "number" | "date" | "boolean" | "image" | "list",  // default text
  "fields"?: [ { "key", "label"?, "valueType"? }, ... ]  // only when valueType is "list"
}

- Keys must be unique. List items are flat objects — fields cannot nest lists or objects.
- Elements reference parameters by key ("parameter": "customerName"); a grid repeat references a
  list parameter, and cells inside the repeat range reference the item's field keys.
- Template BODY.sampleValues holds sample data for preview only; voucher "values" holds real data.`;

const FORMULA = `# Formulas

Fields, barcodes and grid cells can compute their value with "formula" instead of "parameter".
Formulas run in a purpose-built parser (no JavaScript). Values are typed; convert explicitly.

- Reference values by parameter key: customerName, items.amount (list field inside aggregates).
- Arithmetic operators: + - * /. Comparisons: = <> < > <= >=.
- Use CONCAT(...) for text concatenation; arithmetic operators require numeric values.
- Functions: ${FORMULA_FUNCTIONS.join(', ')}.
- FORMAT_NUMBER(value, fractionDigits?) adds locale digit grouping; the second argument is an
  integer number of decimal places (0-20), NOT a pattern string like "#,##0".
  FORMAT_DATE(date, pattern? = "YYYY-MM-DD") takes a token pattern (YYYY YY MM M DD D HH mm ss).
- Example: FORMAT_NUMBER(SUM(items.amount) * 1.1, 0)`;

const VOUCHER = `# Voucher files

A voucher freezes a template and fills it with data:

{
  "schemaVersion": "0.1.0",
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
