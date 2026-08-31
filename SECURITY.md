# Security Policy

SlipKit is primarily an embeddable library. It provides no accounts and no remote service of its own. The Core and UI packages run inside a host application, in your users' browsers or in your own Node.js process, while `@omdc-slipkit/mcp` runs as a local Node.js process and can optionally expose a loopback-only PDF link server. This document explains what that means for security, and how to report a vulnerability.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting: open the repository's [Security tab](https://github.com/open-my-dev-com/drawing-report/security) and choose **Report a vulnerability**. If that is unavailable to you, open a regular issue that says only that you have a security report and asks for a private channel — no details.

Please include what you have:

- The affected package and version, or the commit
- What an attacker can do, and what they need in order to do it
- A `.slip` file, configuration, or steps that reproduce it
- Any workaround you already found

We aim to acknowledge reports within **7 days**. After reviewing a report we will share its status, the expected next steps, and a disclosure timeline where one applies. This project is maintained by a small team and has no on-call rotation, so we do not promise a fixed remediation deadline. We will credit you in the release notes unless you prefer otherwise.

## Supported versions

The `@omdc-slipkit/*` packages are not yet published to the npm registry, and the `.slip` schema is at the pre-release version `0.1.0`. Until the first release, **only the default branch is supported** — fixes land there, and there are no backports.

| Version | Supported |
|---|---|
| `main` (pre-release) | Yes |
| Anything else | No |

This table will be replaced with a real version policy at the first release.

## Scope

In scope — vulnerabilities in this repository:

- `@omdc-slipkit/core` — parsing, validation, formula evaluation, page planning, PDF generation, encryption
- `@omdc-slipkit/elements` — the designer, entry form, and viewer components, and browser storage
- `@omdc-slipkit/react` and `@omdc-slipkit/vue` — the framework wrappers
- `@omdc-slipkit/mcp` — the local MCP server, its file access, and its local PDF link server
- The bundled presets, fonts, and JSON Schemas

Dependency vulnerabilities may be reported here when they affect SlipKit. Fixing one may require coordination with the upstream project.

Out of scope:

- Vulnerabilities in the host application that embeds SlipKit
- Vulnerabilities that are purely in a dependency and cannot be reached through SlipKit — report those upstream
- Missing hardening that is documented below as the host's responsibility
- Scanner output with no affected package, code path, or description of impact

## Security model

### Security characteristics

**Formulas are not evaluated as JavaScript.** Formulas are parsed and evaluated by project code; formula text is not passed to `eval` or `new Function`. Neither is used anywhere in the packages, and the rule is checked during review.

**Markup is built through Lit templates.** The UI components do not use `innerHTML`, `unsafeHTML`, or `document.write`, so values are inserted as data rather than parsed as markup.

**Untrusted input must go through validation.** `parseSlipFile` and `validateSlipFile` run a schema over the whole file: values must match their declared types, colors must match `#RRGGBB` or `#RRGGBBAA`, and sizes, counts, and nesting are all capped. Properties the schema does not define are dropped rather than passed through to the renderer, and a file that fails validation is not returned. Pass JSON and any other untrusted values through one of these functions before rendering — TypeScript types alone are not runtime validation, and an object your application builds and hands straight to the renderer is not re-checked.

**Inputs are bounded.** Pages, elements per page, grid cells, repeat items, output pages, formula length, and formula nesting all have hard limits, which bounds the work a single hostile file can cause. These limits do not replace host-level limits on request size, image size, memory, and concurrency.

**Authenticated encryption.** `.slip` files can be saved in an AES-256-GCM envelope. A wrong key and a tampered file both fail the same way, with the same message. Passphrases are stretched with PBKDF2-HMAC-SHA256 using the iteration count recommended by the OWASP Password Storage Cheat Sheet; the count is stored in the envelope, so files written by older versions still open.

**The MCP server stays local.** It speaks stdio. Its optional PDF link server binds to `127.0.0.1` only, answers `GET` only, and serves only `.pdf` paths that are lexically contained within the configured working directory — the symbolic-link limitation described below still applies. It rejects requests whose `Host` header is not a local address, which mitigates common DNS-rebinding attempts from a web page.

### What SlipKit does not guarantee — your responsibility as the host

**Encryption keys.** SlipKit never generates, stores, or transmits keys; the host supplies and protects them. A key held in client-side JavaScript is readable by anyone using that browser, so encrypt on your server if the browser is inside your threat model.

**Passphrase strength.** The passphrase you pass in is stretched with a key derivation function, but no minimum length or complexity is enforced. Apply your own policy before calling the API.

**Templates from untrusted sources.** A `.slip` template may reference images by `https://` URL. Opening such a template makes the viewer's browser fetch that URL, which tells the third party that the file was opened, and from which IP. If you accept templates from people you do not trust, serve your application with a Content Security Policy that restricts `img-src`, or strip URL images before rendering. (Issued vouchers cannot contain URL images — those must be embedded — but templates can.)

**Content Security Policy.** SlipKit does not require inline scripts or `eval`. The host application's CSP must still allow any font and image sources its configuration and templates use.

**Access control and audit.** There is no concept of a user, a permission, or a log in SlipKit. Deciding who may open, edit, or issue a document is entirely the host's job.

**Storage.** The bundled IndexedDB adapter stores whatever you save, in the user's browser, unencrypted unless you turn encryption on. Anyone with access to that browser profile can read it.

**Integrity of issued vouchers.** The `issued` state prevents further editing through the standard UI. It is not a digital signature and does not prove authorship or integrity. If you need non-repudiation, sign the output in your own system.

### Known limitations

These are known and currently accepted:

- **Symbolic links inside the MCP working directory are not resolved.** Containment is checked on the lexical path, so a symlink created inside the working directory may reference a file outside it. Do not allow untrusted users or processes to write to the MCP working directory.
- **Page planning runs on the main thread.** A voucher with tens of thousands of repeat items takes a noticeable moment to lay out, during which the browser tab does not respond. Cap the item count you pass in if your data can grow without bound.
- **No CI runs on pull requests.** The verification gate runs on a developer's machine through a commit hook, which can be skipped with `--no-verify` or missing in a fresh checkout. Do not treat a branch as independently verified.

## Hardening checklist for hosts

1. Serve your application over HTTPS with a strict Content Security Policy; restrict `img-src` if you render third-party templates.
2. Keep encryption keys out of client-side code where the browser is inside your threat model.
3. Enforce your own passphrase policy before handing a passphrase to SlipKit.
4. Validate the size of uploaded `.slip` files and images before passing them in.
5. Run the MCP server only against a working directory you control, and leave its link server on the default local binding.
6. Track dependency advisories for `@pdfme/*`, `zod`, `lit`, and `@modelcontextprotocol/sdk`.

## Verification

Relevant security checks, automated tests, and manual review items are documented in the project's test plan. See [TEST-PLAN.md](docs/TEST-PLAN.md) — section 7 lists the threat model, the checks performed, and the security test cases that run in the suite. Some items in this document are host responsibilities or known limitations rather than properties the suite verifies.

```bash
pnpm audit        # known vulnerabilities in dependencies
pnpm -r test      # includes the security test cases
```
