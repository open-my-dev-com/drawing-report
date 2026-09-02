# @omdc-slipkit/react

React wrappers for the SlipKit Web Components: `SlipDesigner`, `SlipForm`, and `SlipViewer`.

## Installation

```bash
npm install @omdc-slipkit/core @omdc-slipkit/react react react-dom
```

Node.js 22.13 or later and React 19 or later are required. The package imports `@omdc-slipkit/elements` and registers the underlying custom elements.

## Basic usage

```tsx
import { SlipDesigner } from '@omdc-slipkit/react';

export function FormDesigner({ slipJson }: { slipJson: string }) {
  return (
    <SlipDesigner
      src={slipJson}
      locale="en"
      onSlipChange={(file) => console.log(file)}
    />
  );
}
```

See [Getting started](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/guide/getting-started.md) and the [API reference](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/guide/api-reference.md) for all props and events.

## Versioning

The npm package version follows the package release. A `.slip` file's `schemaVersion` describes the file format and changes independently. See the [`.slip` specification](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/SPEC.md) for format compatibility.

## License and support

This package is licensed under the Business Source License 1.1. See the included `LICENSE` file for its terms and change date.

Report defects and documentation problems through [GitHub Issues](https://github.com/open-my-dev-com/drawing-report/issues).
