# SlipKit MCP Guide

[한국어](mcp.md) · [日本語](mcp.ja.md)

`@omdc-slipkit/mcp` is a local stdio MCP server that lets an AI read, create, and edit `.slip` templates and vouchers in a designated directory. It can also build unissued vouchers from templates and render templates or vouchers to PDF.

You do not need to keep the server running in a separate terminal. With stdio, the MCP client uses the configured `command` and `args` to start the server as a local child process and stops it when the connection closes. You only need to register the executable and working directory in the MCP configuration.

> [!IMPORTANT]
> SlipKit packages are not yet published to the npm registry. For now, build the package from this repository and connect the generated CLI to your MCP client.

## Prerequisites

- Node.js 22.13 or later
- pnpm 10.33.0
- An MCP client that can connect to a local stdio server

Install dependencies and build the MCP package from the repository root.

```bash
pnpm install
pnpm --filter @omdc-slipkit/mcp build
mkdir slip-workspace
```

`slip-workspace` is an example working directory for the `.slip` files and images that the AI may access. You may use any other directory.

## Connect an MCP client

Add the following entry to your client's stdio MCP server configuration. The configuration file location and its top-level key vary by client.

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "/absolute/path/to/slip-workspace",
        "--locale",
        "en"
      ]
    }
  }
}
```

Replace both paths with real absolute paths. After saving the configuration, restart the MCP client or reload its MCP server list. The connection is ready when the seven tools, including `slip_list` and `slip_read`, appear.

### Where the configuration is stored

The SlipKit MCP server does not create a configuration file of its own. The working directory and locale are command arguments, while encryption keys are environment variables. The MCP client decides where to store this launch configuration.

| Client | Storage and registration |
|---|---|
| Codex CLI | User configuration at `~/.codex/config.toml`. Use `codex mcp add` instead of editing TOML directly. |
| Claude Code | Supports `local`, `user`, and `project` scopes. Project scope uses `.mcp.json` in the repository. Local scope is more suitable during development because the command currently contains machine-specific absolute paths. |
| Other clients | Register the same `command`, `args`, and `env` in the user or project MCP configuration defined by that client. |

To register the current repository build with Codex CLI:

```bash
codex mcp add slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  /absolute/path/to/slip-workspace --locale en
```

Claude Code can register it as follows. Local scope avoids sharing machine-specific paths in `.mcp.json`.

```bash
claude mcp add --scope local slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  /absolute/path/to/slip-workspace --locale en
```

After the package is published to npm, clients can launch it without building this repository:

```bash
codex mcp add slipkit -- \
  npx -y @omdc-slipkit/mcp /absolute/path/to/slip-workspace --locale en
```

The working directory still contains user data, so each environment must specify that path once.

### CLI options and environment variables

| Setting | Description |
|---|---|
| First positional argument | Working directory. The server's current directory is used when omitted. |
| `--locale <locale>` | Language for errors and the default PDF font. Supported values are `ko`, `en`, and `ja`. |
| `SLIPKIT_MCP_LOCALE` | Locale used when `--locale` is omitted. |
| `SLIPKIT_MCP_KEY` | Current key for encrypting and decrypting `.slip` files. Accepted only as an environment variable. |
| `SLIPKIT_MCP_PREVIOUS_KEYS` | Comma-separated keys used before the current key. They are tried after the current key when decrypting. |

An encrypted configuration can include the environment variables as follows.

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "/absolute/path/to/slip-workspace",
        "--locale",
        "en"
      ],
      "env": {
        "SLIPKIT_MCP_KEY": "current-passphrase",
        "SLIPKIT_MCP_PREVIOUS_KEYS": "previous-passphrase"
      }
    }
  }
}
```

When `SLIPKIT_MCP_KEY` is set, newly saved files are encrypted. Plain `.slip` files remain readable, but encrypted files require a matching current or previous key.

### PDF fonts

No font path or operating-system font installation is required. The MCP server reads fonts embedded as base64 in `@omdc-slipkit/elements`, passes them to the PDF renderer in memory, and does not download fonts from the network.

| Locale | Default fonts |
|---|---|
| Locale starting with `ja` | Noto Sans JP Regular Japanese subset |
| All other locales | Pretendard Regular and Pretendard Bold |

Omit `fontName` to use the locale's fallback font. When specifying it, use a registered name for the current locale: `Pretendard`, `Pretendard-Bold`, or `Noto Sans JP`. The bundled Japanese font has no Bold variant, so `bold: true` does not select a separate Bold font.

The current CLI does not expose a custom-font option. Supporting user fonts requires a separate server option for a font provider. When running from this repository, keep the pnpm-installed workspace dependencies instead of copying only `packages/mcp/dist`. After npm publication, the `elements` dependency and its embedded fonts will be installed with the MCP package.

## Tools

| Tool | Purpose | Main inputs |
|---|---|---|
| `slip_list` | List up to 50 `.slip` files per page in the working directory. | `kind`, `query`, `cursor` |
| `slip_read` | Read a summary, one page, one element, or the full file. | `path`, `part`, `elementId`, `pageIndex` |
| `slip_save` | Validate complete JSON and save it as a new `.slip` file. | `path`, `file`, `overwrite` |
| `slip_edit` | Atomically apply targeted edit operations to an existing file. | `path`, `ops` |
| `slip_build_voucher` | Build an unissued voucher from a template and parameter values. | `templatePath`, `values`, `outPath`, `overwrite` |
| `slip_render_pdf` | Render a template or voucher to a PDF file. | `path`, `outPath` |
| `slip_schema` | Explain the `.slip` structure by topic. | `topic` |

The `slip://schema` resource provides the full current `.slip` JSON Schema. Supported `slip_schema` topics are `overview`, `elements`, `grid`, `parameters`, `formula`, `voucher`, and `json-schema`.

### `slip_read` parts

| `part` | Returned content |
|---|---|
| `summary` | Pages, element ids/types/positions, parameters, and asset summaries. This is the default. |
| `element` | The complete element selected by `elementId` |
| `page` | The complete page selected by `pageIndex` |
| `full` | The complete file |

Base64 image data in read responses is replaced with a size marker. Images inside `.slip` files still use base64 data URLs. To add an image through MCP, pass a file path inside the working directory to the `set_image` operation. The server reads the file and creates the base64 asset.

### `slip_edit` operations

| `action` | Target |
|---|---|
| `set_meta` | Template metadata |
| `set_paper` | Paper settings |
| `set_page`, `add_page`, `remove_page` | Pages |
| `set_element`, `add_element`, `remove_element` | Elements selected by id |
| `add_parameter`, `set_parameter`, `remove_parameter` | Parameters selected by key |
| `set_cell` | A grid cell selected by grid id and zero-based row and column |
| `set_image` | An image element selected by id |
| `set_values` | Values in an unissued voucher |

Operations are applied to a copy in the given order, followed by full-file validation. If any operation or validation fails, the server writes nothing.

Operations that accept `fields`, such as `set_element`, merge only the fields that you pass. Omit fields that must remain unchanged. `null` is stored as a value; it is not a deletion marker.

## Recommended workflows

### Create a template

1. Read the `overview` topic with `slip_schema`.
2. Read the relevant `elements`, `grid`, `parameters`, or `formula` topics.
3. Save the complete template JSON with `slip_save`.
4. Render it with `slip_render_pdf` and inspect its layout and styles.

### Edit an existing template

1. Use the default `slip_read` summary to find pages and element ids.
2. Read a full `element` or `page` only when needed.
3. Change only the intended targets with `slip_edit`.
4. Render the result with `slip_render_pdf`.

Do not use `slip_save` or a `full` read for a small change to an existing file. Summary-first, targeted editing reduces the risk of dropping or changing unrelated elements.

### Build a voucher and PDF

1. Pass the template path, parameter values, and output path to `slip_build_voucher`.
2. Adjust values with the `set_values` operation when needed.
3. Use `slip_render_pdf` to render a PDF with the actual values.

Vouchers created by the MCP server are unissued (`issued: false`). Issuing must remain in the host application, where user confirmation and authorization can be enforced. Issued vouchers cannot be modified through this MCP server.

## File access and safety boundaries

- Every input and output path is restricted to the working directory selected at startup.
- The `.slip` extension is appended to storage paths when omitted.
- A group of `slip_edit` operations is stored only when the complete result is valid.
- `slip_save` and `slip_build_voucher` do not replace an existing file by default. Even with `overwrite: true`, they cannot replace an issued voucher.
- A PDF output path cannot use the `.slip` extension.
- `set_image` supports PNG, JPEG, GIF, and WebP files up to 2 MB each.
- The server does not provide arbitrary code execution, network access, user authentication, or voucher issuing.

`slip_edit` includes operations that remove elements, pages, and parameters. Configure user confirmation for such tool calls in the MCP client's approval settings.

## Reuse the storage in Node.js

`FileSystemStorage` is a `StorageAdapter` implementation with the same path restriction and encryption rules as the MCP server.

```ts
import { FileSystemStorage } from '@omdc-slipkit/mcp';

const key = process.env.SLIPKIT_MCP_KEY;
if (!key) throw new Error('SLIPKIT_MCP_KEY is required.');

const previousKeys = process.env.SLIPKIT_MCP_PREVIOUS_KEYS
  ?.split(',')
  .map((key) => key.trim())
  .filter((key) => key !== '');

const storage = new FileSystemStorage({
  rootDir: '/absolute/path/to/slip-workspace',
  locale: 'en',
  encryption: {
    key,
    ...(previousKeys?.length ? { previousKeys } : {}),
  },
});

const template = await storage.load('invoice');
await storage.save('archive/invoice', template);
```

Use `createSlipMcpServer(options)` when embedding the MCP server itself. It returns an unconnected `McpServer` and a `FileSystemStorage`; the caller is responsible for connecting a transport.

## Troubleshooting

| Symptom | Check |
|---|---|
| MCP tools do not appear | Confirm that the package was built, both configured paths are absolute and valid, and the client was restarted. |
| `working directory not found` | Create the working directory and correct its configured path. |
| An encrypted file cannot be read | Confirm that the matching key is present in `SLIPKIT_MCP_KEY` or `SLIPKIT_MCP_PREVIOUS_KEYS`. |
| A file did not change after an edit | Read the validation error in the tool response. Failed validation leaves the original unchanged. |
| PDF output fails | Confirm that the output parent directory exists and is writable. |

## Related documents

- [`.slip` File Format Specification](../SPEC.md)
- [Core Usage Guide](core.en.md)
- [Server Integration Guide](server-integration.en.md)
- [API Reference](api-reference.en.md)
- [ADR-061: Provide AI integration as a local MCP server package](../DECISIONS.md#adr-061-ai-연동은-로컬-mcp-서버-패키지로-제공한다)
