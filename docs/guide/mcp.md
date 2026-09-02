# SlipKit MCP Guide

[한국어](mcp.ko.md) · [日本語](mcp.ja.md)

`@omdc-slipkit/mcp` is a local stdio MCP server that lets an AI read, create, and edit `.slip` templates and vouchers in a designated directory. It can also build unissued vouchers from templates and render templates or vouchers to PDF.

You do not need to keep the server running in a separate terminal. With stdio, the MCP client starts the server as a local child process and stops it when the connection closes. The server reads its storage path, locale, fonts, and encryption environment-variable names from `slipkit-mcp.json`.

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

## Try it with MCP Inspector

The repository includes an Inspector demo for calling the tools before configuring a separate MCP client. MCP Inspector requires Node.js 22.19 or later.

```bash
pnpm demo:mcp
```

The command builds the MCP package, prepares a sample template in `examples/mcp-demo/workspace`, and opens Inspector at `http://localhost:6274`. Select **Connect**, open **Tools**, and call tools such as `slip_list`, `slip_read`, `slip_edit`, and `slip_render_pdf`.

Files edited or generated through Inspector stay in the demo workspace and are excluded from Git. To restore the initial sample, close Inspector and run:

```bash
pnpm demo:mcp:reset
```

See [`examples/mcp-demo`](../../examples/mcp-demo) for ready-to-use inputs.

## Create the server configuration

`slipkit-mcp.json` is the configuration file read by the MCP server. This example uses a `slip-workspace` directory next to the directory containing the configuration file.

```json
{
  "rootDir": "../slip-workspace",
  "locale": "en"
}
```

The configuration file may be stored anywhere. Relative `rootDir` and font paths are resolved from the directory containing the configuration file. `~` is not expanded to the home directory, so use an absolute path or a valid relative path.

| Field | Description | Default |
|---|---|---|
| `rootDir` | Working directory for `.slip` files, images, and PDFs | Server process working directory |
| `locale` | Locale for errors and the bundled default fonts | English |
| `fonts` | TTF or OTF files used for PDF rendering | Bundled fonts selected by locale |
| `encryption.keyEnv` | Environment-variable name containing the current encryption key | `SLIPKIT_MCP_KEY` |
| `encryption.previousKeysEnv` | Environment-variable name containing previous keys | `SLIPKIT_MCP_PREVIOUS_KEYS` |

Unknown fields are rejected. Invalid JSON, a missing working directory, or a missing font file prevents the server from starting and reports the cause to stderr.

## Connect an MCP client

Register the executable and the path to `slipkit-mcp.json` in the client's stdio MCP server configuration. The top-level key and storage location vary by client.

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "--config",
        "/absolute/path/to/slipkit-mcp.json"
      ]
    }
  }
}
```

Replace the paths with real absolute paths. After saving the configuration, restart the MCP client or reload its MCP server list. The connection is ready when the seven tools, including `slip_list` and `slip_read`, appear.

### The two configuration files

The server configuration and the MCP client configuration have separate responsibilities.

| Configuration | Contents |
|---|---|
| `slipkit-mcp.json` | Working directory, locale, custom fonts, and the names of encryption-key environment variables |
| MCP client configuration | Server command, path to `slipkit-mcp.json`, and any encryption environment-variable values |

MCP clients store their launch configuration in the following locations.

| Client | Storage and registration |
|---|---|
| Codex CLI | User configuration at `~/.codex/config.toml`. Use `codex mcp add` instead of editing TOML directly. |
| Claude Code | Supports `local`, `user`, and `project` scopes. Project scope uses `.mcp.json` in the repository. Local scope is more suitable during development because the command currently contains machine-specific absolute paths. |
| Other clients | Register the same `command`, `args`, and `env` in the user or project MCP configuration defined by that client. |

To register the current repository build with Codex CLI:

```bash
codex mcp add slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  --config /absolute/path/to/slipkit-mcp.json
```

Claude Code can register it as follows. Local scope avoids sharing machine-specific paths in `.mcp.json`.

```bash
claude mcp add --scope local slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  --config /absolute/path/to/slipkit-mcp.json
```

After the package is published to npm, clients can launch it without building this repository:

```bash
codex mcp add slipkit -- \
  npx -y @omdc-slipkit/mcp --config /absolute/path/to/slipkit-mcp.json
```

The server configuration and working directory remain local in this setup.

## Configuration discovery and precedence

The server looks for a configuration file in this order:

1. `--config <path>`
2. The `SLIPKIT_MCP_CONFIG` environment variable
3. `slipkit-mcp.json` in the first positional working-directory argument
4. `slipkit-mcp.json` in the server process working directory when no positional argument is given

An explicitly selected configuration file must exist and be readable. If no file exists at an automatic discovery location, the server starts with defaults.

Configuration values use the following precedence.

| Setting | Precedence |
|---|---|
| Working directory | First positional argument → `rootDir` → current directory |
| Locale | `--locale` → `SLIPKIT_MCP_LOCALE` → `locale` → English |
| Fonts | Configuration `fonts` → bundled fonts selected by locale |
| Encryption keys | Environment variables named by `encryption`, or the default names when omitted |
| PDF links | `httpPort` in the configuration file; disabled when omitted |

The positional working-directory argument and `--locale` remain available as temporary overrides.

### CLI options and environment variables

| Setting | Description |
|---|---|
| First positional argument | Working directory. The server's current directory is used when omitted. |
| `--config <path>` | Path to `slipkit-mcp.json`. A relative path is resolved from the server process current directory. |
| `--locale <locale>` | Language for errors and the default PDF font. Supported values are `ko`, `en`, and `ja`. |
| `--help`, `-h` | Print CLI usage to stdout and exit without reading configuration or starting the server. |
| `--version`, `-v` | Print the npm package version to stdout and exit without starting the server. |
| `SLIPKIT_MCP_CONFIG` | Configuration path used when `--config` is omitted. |
| `SLIPKIT_MCP_LOCALE` | Locale used when `--locale` is omitted. |
| `SLIPKIT_MCP_KEY` | Current key for encrypting and decrypting `.slip` files. Accepted only as an environment variable. |
| `SLIPKIT_MCP_PREVIOUS_KEYS` | Comma-separated keys used before the current key. They are tried after the current key when decrypting. |

Unknown options, missing option values, and more than one positional working directory are usage errors. The CLI writes the cause and a `--help` hint to stderr and exits with code 2. Configuration and server startup failures exit with code 1. A running server reserves stdout for MCP protocol messages and writes startup information to stderr.

### Encryption configuration

Do not store encryption keys in `slipkit-mcp.json`. Store only the environment-variable names used to read them.

```json
{
  "rootDir": "../slip-workspace",
  "locale": "en",
  "encryption": {
    "keyEnv": "MY_SLIP_KEY",
    "previousKeysEnv": "MY_SLIP_PREVIOUS_KEYS"
  }
}
```

Pass the actual values through the environment that starts the server process.

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "--config",
        "/absolute/path/to/slipkit-mcp.json"
      ],
      "env": {
        "MY_SLIP_KEY": "current-passphrase",
        "MY_SLIP_PREVIOUS_KEYS": "previous-passphrase"
      }
    }
  }
}
```

Do not commit an MCP client configuration containing real keys. Use user or local scope, or the client's secret-management facility.

When the current-key environment variable is set, newly saved files are encrypted. Plain `.slip` files remain readable, but encrypted files require a matching current or previous key. If `encryption.keyEnv` is explicitly configured but that variable is absent, the server does not start.

### Local PDF links

Set `httpPort` to expose rendered PDFs through a read-only server bound to `127.0.0.1`. Each MCP process creates its own 64-character token, and returned links have the form `http://127.0.0.1:<port>/<token>/<file>.pdf`. Processes do not share tokens or join an existing link server. If the port is already used by another `slipkit-mcp` link server for the same working directory, the process starts its own server on a free port. If any other program, or a `slipkit-mcp` server for a different working directory, holds the port, startup fails. Only PDFs inside the working directory are served.

### PDF fonts

When `fonts` is omitted, the MCP server uses fonts embedded as base64 in `@omdc-slipkit/elements`. It does not download fonts from the network or automatically load operating-system fonts.

| Locale | Default fonts |
|---|---|
| Locale starting with `ja` | Noto Sans JP Regular Japanese subset |
| All other locales | Pretendard Regular and Pretendard Bold |

Omit `fontName` to use the locale's fallback font. When specifying it, use a currently registered font name. The bundled Japanese font has no Bold variant, so `bold: true` does not select a separate Bold font.

Register custom fonts in the server configuration.

```json
{
  "rootDir": "../slip-workspace",
  "locale": "en",
  "fonts": [
    {
      "name": "AppFont",
      "path": "./fonts/AppFont-Regular.ttf",
      "fallback": true
    },
    {
      "name": "AppFont-Bold",
      "path": "./fonts/AppFont-Bold.ttf"
    }
  ]
}
```

Font paths are resolved from the configuration file directory. At most one font may set `fallback: true`; when none does, the first font is used as the fallback. Configuring `fonts` replaces the bundled font list, so include every font referenced by the templates. Use names such as `AppFont-Bold`, `AppFont-Italic`, and `AppFont-BoldItalic` for style variants.

When running from this repository, keep the pnpm-installed workspace dependencies instead of copying only `packages/mcp/dist`. After npm publication, the `elements` dependency and its embedded fonts will be installed with the MCP package.

## Tools

| Tool | Purpose | Main inputs |
|---|---|---|
| `slip_list` | List up to 50 `.slip` files per page in the working directory. | `kind`, `query`, `cursor` |
| `slip_read` | Read a summary, one page, one element, or the full file. | `path`, `part`, `elementId`, `pageIndex` |
| `slip_save` | Validate complete JSON and save it as a new `.slip` file. | `path`, `file`, `overwrite` |
| `slip_edit` | Atomically apply targeted edit operations to an existing file. | `path`, `ops` |
| `slip_build_voucher` | Build an unissued voucher from a template and parameter values. | `templatePath`, `values`, `outPath`, `overwrite` |
| `slip_render_pdf` | Render a template or voucher to a PDF file, optionally returning one page as a PNG preview image. A link URL is included whenever `httpPort` is set. | `path`, `outPath`, `preview`, `previewPage` |
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

Image data validation applies only to values declared as images: an image element's parameter, a parameter with `valueType: 'image'`, or a list field with that value type. Other business-data strings, including unknown keys beginning with `data:`, are preserved.

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

Operations that accept `fields`, such as `set_element`, merge only the fields that you pass. Omit fields that must remain unchanged, and set a field to `null` to remove it. In contrast, `null` passed through `set_values` is stored as an actual voucher value.

#### Conditional-format edit example

The following operation renders the `total` field in bold red text when its value is negative.

```json
{
  "path": "invoice",
  "ops": [
    {
      "action": "set_element",
      "id": "total",
      "fields": {
        "conditionalFormats": [
          {
            "condition": "total < 0",
            "fontColor": "#FF0000",
            "bold": true
          }
        ]
      }
    }
  ]
}
```

Use `set_cell` for a grid cell. Passing `conditionalFormats` replaces the complete rule list; set it to `null` to remove all rules. Use the `elements` or `grid` and `formula` topics of `slip_schema` to check the supported fields and condition syntax.

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

- Every input and output path is restricted to the working directory selected at startup. Existing paths and symlink targets are checked by real path, including read, write, delete, image, PDF, and HTTP access.
- `rootDir` is normalized to its real path. A target that is itself a symlink is rejected, and `slip_list` omits symlink files and linked directories.
- The `.slip` extension is appended to storage paths when omitted.
- A group of `slip_edit` operations is stored only when the complete result is valid.
- `slip_save` and `slip_build_voucher` do not replace an existing file by default. Even with `overwrite: true`, they cannot replace an issued voucher.
- A PDF `outPath` must end with `.pdf`. Rendering replaces an existing target only when the existing file is a PDF.
- `set_image` supports PNG and JPEG files up to 2 MiB each and validates both the signature and media type.
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

Use `createSlipMcpServer(options)` when embedding the MCP server itself. It returns an unconnected `McpServer` and a `FileSystemStorage`; the caller is responsible for connecting a transport. To apply the same configuration rules as the CLI, create `options` with `resolveServerOptions({ cwd, configPath, env })` first.

## Troubleshooting

| Symptom | Check |
|---|---|
| MCP tools do not appear | Confirm that the package was built, the `cli.js` and `--config` paths are valid, and the client was restarted. Read the client's MCP log or stderr for startup errors. |
| `Could not read the config file` | Check the `--config` or `SLIPKIT_MCP_CONFIG` path and file permissions. |
| `Working directory not found` | Check `rootDir` and confirm the directory exists. Relative paths start at the configuration file directory. |
| `Font file ... not found` | Check `fonts[].path` and file permissions. Relative paths start at the configuration file directory. |
| An encrypted file cannot be read | Check the environment variables named by `keyEnv` and `previousKeysEnv` for a matching key. |
| A file did not change after an edit | Read the validation error in the tool response. Failed validation leaves the original unchanged. |
| PDF output fails | Confirm that the output parent directory exists and is writable. |

## Related documents

- [Core Usage Guide](core.md)
- [Server Integration Guide](server-integration.md)
- [API Reference](api-reference.md)
