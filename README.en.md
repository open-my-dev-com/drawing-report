# SlipKit

[한국어](README.md) · [日本語](README.ja.md)

SlipKit is a library that adds document form design, data entry, viewing, and PDF output to web applications.

End users can build forms such as transaction statements, invoices, and quotations with a visual designer, and developers can integrate those features into an existing application as Web Components or React/Vue components.

SlipKit is not a standalone service. User authentication, permission management, data storage, and server integration are the responsibility of the application that uses SlipKit.

![SlipKit form designer](docs/guide/images/en/overview.png)

## Features

- A drag-and-drop document form designer
- An entry screen for filling a form with data and issuing a voucher
- A read-only viewer for reviewing issued vouchers and templates
- PDF generation usable in the browser and Node.js
- Template and voucher storage via JSON-based `.slip` files
- Formulas, tables, images, shapes, and barcodes
- IndexedDB and local-file storage adapters
- Optional AES-256-GCM file encryption
- Korean, English, and Japanese UI
- Web Components with React and Vue wrappers

## How it works

SlipKit distinguishes between templates and vouchers.

| Stage | Component | Role |
|---|---|---|
| Form design | `<slip-designer>` | Edit the document's layout, parameters, formulas, and more. |
| Voucher entry | `<slip-form>` | Fill a template with actual values and issue a voucher. |
| Voucher viewing | `<slip-viewer>` | Display a template or an issued voucher read-only. |

Both templates and vouchers use the `.slip` extension and are distinguished by the `kind` value inside the file. An issued voucher stores the template as it was at issue time, so the voucher keeps its composition even if the original template changes later.

## Current status

> [!IMPORTANT]
> SlipKit is currently in a pre-release review stage.
>
> The `@omdc-slipkit/*` packages are not yet published to the npm registry. For now you can explore the current version by cloning the repository and reviewing the demos and source code.

## Packages

SlipKit is a pnpm workspace-based monorepo.

| Package | Role |
|---|---|
| [`@omdc-slipkit/core`](packages/core) | Provides `.slip` file validation, formula evaluation, voucher assembly, PDF generation, and file encryption. It has no DOM dependency, so it runs in the browser and Node.js. |
| [`@omdc-slipkit/elements`](packages/elements) | Provides the `<slip-designer>`, `<slip-form>`, and `<slip-viewer>` Web Components built with Lit. |
| [`@omdc-slipkit/react`](packages/react) | Lets you use the SlipKit Web Components as React components. |
| [`@omdc-slipkit/vue`](packages/vue) | Lets you use the SlipKit Web Components as Vue components. |
| [`@omdc-slipkit/mcp`](packages/mcp) | Provides a local MCP server that lets AI create and edit templates through MCP tools. |

## Running locally

### Requirements

- Node.js 22.13 or later
- pnpm 10.33.0

### Set up the repository

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
pnpm install
```

### Run a demo

Run the one demo that matches your environment.

```bash
# Web Component
pnpm demo

# React
pnpm demo:react

# Vue
pnpm demo:vue
```

| Demo | Default address | Description |
|---|---|---|
| [`examples/demo`](examples/demo) | `http://localhost:5173` | An example that uses the Web Components directly |
| [`examples/react-demo`](examples/react-demo) | `http://localhost:5174` | An example that uses the React wrappers |
| [`examples/vue-demo`](examples/vue-demo) | `http://localhost:5175` | An example that uses the Vue wrappers |

The three demos provide the same features. You can try form design, voucher entry, PDF preview, and saving and loading `.slip` files.

Framework-independent logic such as the demos' auto-save and file handling is implemented once in [`examples/shared`](examples/shared).

You can call the MCP tools directly in the [MCP Inspector demo](examples/mcp-demo). This demo requires Node.js 22.19 or later.

```bash
pnpm demo:mcp
```

The command prepares a sample workspace, builds the MCP package, and opens Inspector at `http://localhost:6274`.

## Guides

If you are new, start by running a repository demo and connecting the designer in [Getting started](docs/guide/getting-started.en.md). Saving and restoring, and how to connect the three components, continue in the [Application Integration Guide](docs/guide/integration.en.md).

The full documentation is organized by goal in the [SlipKit Guide](docs/guide/README.en.md).

| Document | Contents |
|---|---|
| [Getting started](docs/guide/getting-started.en.md) | Running the demos and the minimal connection of the form designer |
| [Application Integration Guide](docs/guide/integration.en.md) | Connecting the designer, entry form, and viewer; saving, restoring, and server integration |
| [Form Designer Guide](docs/guide/designer.en.md) | How to build a form on the designer screen |
| [Core Usage Guide](docs/guide/core.en.md) | `.slip` file handling, voucher assembly, formula evaluation, PDF generation, and encryption |
| [MCP Guide](docs/guide/mcp.en.md) | AI-assisted `.slip` creation and editing, voucher assembly, and PDF review |
| [Configuration Guide](docs/guide/configuration.en.md) | Language, fonts, paper, barcodes, presets, and storage settings |
| [Formula Function Reference](docs/guide/formula.en.md) | Formula-writing rules, supported functions, and usage examples |
| [API Reference](docs/guide/api-reference.en.md) | The full reference of functions, types, components, events, and errors |

## Technical documents

| Document | Contents |
|---|---|
| [`.slip` file format specification](docs/SPEC.md) | The structure and validation rules of `.slip` files |
| [Architecture](docs/ARCHITECTURE.md) | Package structure and external-system integration |
| [Requirements](docs/REQUIREMENTS.md) | Confirmed product requirements |
| [Design decision log](docs/DECISIONS.md) | Key design decisions and their rationale |
| [Roadmap](docs/ROADMAP.md) | Development status and planned work |

## Development commands

```bash
# Code-style check
pnpm lint

# Type check
pnpm typecheck

# Build packages
pnpm build

# Run tests
pnpm test
```

## License

SlipKit is provided under the [Business Source License 1.1](LICENSE). The source is publicly available but is not currently an OSI-approved open-source license.

Production use that embeds SlipKit in your own application is permitted. However, providing it to third parties as a hosted or embeddable commercial product or service that competes with SlipKit requires a separate commercial license.

At the change date defined in the license, it converts to the Apache License 2.0. Please see [LICENSE](LICENSE) for the exact terms and change date.

The bundled Pretendard and Noto Sans JP fonts are each licensed under the SIL Open Font License 1.1.
