# Security Policy

SlipKit is an embeddable library: it has no server, no accounts, and no network service of its own. It runs inside your application, in your users' browsers, or in a local Node process. This document explains what that means for security, and how to report a vulnerability.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting: open the repository's [Security tab](https://github.com/open-my-dev-com/drawing-report/security) and choose **Report a vulnerability**. If that is unavailable to you, open a regular issue that says only that you have a security report and asks for a private channel — no details.

Please include what you have:

- The affected package and version, or the commit
- What an attacker can do, and what they need in order to do it
- A `.slip` file, configuration, or steps that reproduce it
- Any workaround you already found

We will confirm receipt within **7 days**, tell you whether we accept the report and how we rate it within **14 days**, and aim to publish a fix within **90 days** of confirmation. If a fix will take longer, we will say so and agree a date with you. We will credit you in the release notes unless you prefer otherwise.

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

Out of scope:

- Vulnerabilities in the host application that embeds SlipKit
- Vulnerabilities in dependencies — report those to the dependency, and tell us so we can pin or upgrade
- Missing hardening that is documented below as the host's responsibility
- Findings from automated scanners with no demonstrated impact

## Security model

### What SlipKit guarantees

**No dynamic code execution.** Formulas are evaluated by a parser written for this project; formula text never reaches a JavaScript evaluator. `eval` and `new Function` are not used anywhere in the packages, and the rule is enforced in review.

**No HTML injection.** The UI components render through Lit templates only. `innerHTML`, `unsafeHTML`, and `document.write` are not used.

**Every `.slip` file is validated before use.** Parsing runs a schema over the whole file: values must match their declared types, colors must match `#RRGGBB` or `#RRGGBBAA`, and sizes, counts, and nesting are all capped. Properties the schema does not define are dropped rather than passed through to the renderer. A file that fails validation is never rendered.

**Bounded inputs.** Pages, elements per page, grid cells, repeat items, output pages, formula length, and formula nesting all have hard limits, so a hostile file cannot make the renderer loop indefinitely.

**Authenticated encryption.** `.slip` files can be saved in an AES-256-GCM envelope. A wrong key and a tampered file both fail the same way, with the same message. Passphrases are stretched with PBKDF2-HMAC-SHA256 using the iteration count recommended by the OWASP Password Storage Cheat Sheet; the count is stored in the envelope, so files written by older versions still open.

**The MCP server stays local.** It speaks stdio. Its optional PDF link server binds to `127.0.0.1` only, answers `GET` only, serves only `.pdf` files inside the configured working directory, and rejects requests whose `Host` header is not a local address, so a web page cannot reach it by DNS rebinding.

### What SlipKit does not guarantee — your responsibility as the host

**Encryption keys.** SlipKit never generates, stores, or transmits keys. You supply them and you protect them. A key in client-side JavaScript is readable by anyone using that browser; if the threat you care about is the user's own machine, encrypt on your server instead.

**Passphrase strength.** We stretch what you give us. We do not enforce a minimum length or reject weak passphrases — do that before calling the API.

**Templates from untrusted sources.** A `.slip` template may reference images by `https://` URL. Opening such a template makes the viewer's browser fetch that URL, which tells the third party that the file was opened, and from which IP. If you accept templates from people you do not trust, serve your application with a Content Security Policy that restricts `img-src`, or strip URL images before rendering. (Issued vouchers cannot contain URL images — those must be embedded — but templates can.)

**Content Security Policy.** SlipKit needs no inline scripts and no `eval`, so it works under a strict CSP. Set one.

**Access control and audit.** There is no concept of a user, a permission, or a log in SlipKit. Deciding who may open, edit, or issue a document is entirely the host's job.

**Storage.** The bundled IndexedDB adapter stores whatever you save, in the user's browser, unencrypted unless you turn encryption on. Anyone with access to that browser profile can read it.

**Integrity of issued vouchers.** Issuing locks a voucher against further editing in the UI. It is not a signature and it does not prove authorship — an earlier hash-and-signature design was removed. If you need non-repudiation, sign the output in your own system.

### Known limitations

These are understood and accepted for now, not undiscovered:

- **Symbolic links inside the MCP working directory are not resolved.** Path containment compares resolved paths, but a symlink planted inside the working directory can point outside it. Anyone who can write into that directory can already run code as you, so this only matters in unusual setups.
- **Page planning runs on the main thread.** A voucher with tens of thousands of repeat items takes a noticeable moment to lay out, during which the browser tab does not respond. Cap the item count you pass in if your data can grow without bound.
- **No CI runs on pull requests.** The verification gate runs on a developer's machine before each commit. Do not treat a green branch as an independently verified one.

## Hardening checklist for hosts

1. Serve your application over HTTPS with a strict Content Security Policy; restrict `img-src` if you render third-party templates.
2. Keep encryption keys out of client-side code, or accept that they are readable by the user.
3. Enforce your own passphrase policy before handing a passphrase to SlipKit.
4. Validate the size of uploaded `.slip` files and images before passing them in.
5. Run the MCP server only against a working directory you control, and leave its link server on the default local binding.
6. Track dependency advisories for `@pdfme/*`, `zod`, `lit`, and `@modelcontextprotocol/sdk`.

## Verification

The security properties above are checked as part of the project's test plan. See [TEST-PLAN.md](docs/TEST-PLAN.md) — section 7 lists the threat model, what was checked, and the security test cases that run in the suite.

```bash
pnpm audit        # known vulnerabilities in dependencies
pnpm -r test      # includes the security test cases
```
