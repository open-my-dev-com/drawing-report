# @omdc-slipkit/core

TypeScript APIs for validating `.slip` files, evaluating formulas, assembling vouchers, encrypting stored files, and generating PDFs.

## Installation

```bash
npm install @omdc-slipkit/core
```

Node.js 22.13 or later is required. The package is ESM-first and includes TypeScript declarations and the current JSON Schema.

## Basic usage

```ts
import { parseSlipFile, serializeSlipFile } from '@omdc-slipkit/core';

const file = parseSlipFile(await fetch('/forms/invoice.slip').then((response) => response.text()));

console.log(file.kind, file.schemaVersion);
const json = serializeSlipFile(file);
```

See the [Core guide](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/guide/core.md) for validation, formulas, voucher assembly, encryption, storage adapters, and PDF rendering.

## Versioning

The npm package version follows the package release. A `.slip` file's `schemaVersion` describes the file format and changes independently. See the [`.slip` specification](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/SPEC.md) for format compatibility.

## License and support

This package is licensed under the Business Source License 1.1. See the included `LICENSE` file for its terms and change date.

Report defects and documentation problems through [GitHub Issues](https://github.com/open-my-dev-com/drawing-report/issues).
