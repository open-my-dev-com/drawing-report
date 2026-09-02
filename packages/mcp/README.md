# @omdc-slipkit/mcp

A local stdio MCP server for creating and editing `.slip` forms, assembling unissued vouchers, and rendering PDFs inside a configured working directory.

## Installation

```bash
npm install @omdc-slipkit/mcp
```

Node.js 22.13 or later and an MCP client with local stdio server support are required.

## Basic usage

Create `slipkit-mcp.json`:

```json
{
  "rootDir": "./slip-workspace",
  "locale": "en"
}
```

Start the server through your MCP client's stdio configuration, or inspect its options first:

```bash
npx @omdc-slipkit/mcp --config /absolute/path/to/slipkit-mcp.json
npx @omdc-slipkit/mcp --help
```

The MCP client normally starts and stops this command. Do not keep a second copy running in a separate terminal. See the [MCP guide](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/guide/mcp.md) for client configuration, custom fonts, encryption, safety boundaries, and all tools.

## Library API

The package also exports `createSlipMcpServer`, `FileSystemStorage`, and configuration helpers for hosts that need to connect their own transport or reuse the filesystem adapter.

## Versioning

The npm package version follows the package release. A `.slip` file's `schemaVersion` describes the file format and changes independently. See the [`.slip` specification](https://github.com/open-my-dev-com/drawing-report/blob/main/docs/SPEC.md) for format compatibility.

## License and support

This package is licensed under the Business Source License 1.1. See the included `LICENSE` file for its terms and change date.

Report defects and documentation problems through [GitHub Issues](https://github.com/open-my-dev-com/drawing-report/issues).
