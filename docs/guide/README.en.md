# SlipKit Guide

[한국어](README.md) · [日本語](README.ja.md)

This page points you to the documents you need to run SlipKit or connect it to an existing application.

If this is your first time, start with [Getting started](getting-started.en.md) to run the repository demos and connect the form designer.

> [!IMPORTANT]
> SlipKit is currently in a pre-release review stage, and the `@omdc-slipkit/*` packages are not yet published to the npm registry.
> For now you can explore it by cloning the repository and reviewing the bundled demos and source code.

## Find the document for your goal

| What you want to do | Document | Audience |
|---|---|---|
| Run SlipKit from the repository for the first time and connect the designer | [Getting started](getting-started.en.md) | First-time developers |
| Connect the designer, entry form, and viewer, and save the results | [Application Integration Guide](integration.en.md) | Frontend and application developers |
| Build a template on the designer screen | [Form Designer Guide](designer.en.md) | Template authors |
| Handle `.slip` files, assemble vouchers, and generate PDFs | [Core Usage Guide](core.en.md) | Backend and Core developers |
| Issue vouchers and generate and store PDFs on a Node.js server | [Server Integration Guide](server-integration.en.md) | Backend developers |
| Configure language, fonts, paper, presets, and storage | [Configuration Guide](configuration.en.md) | Application developers |
| Write calculations in a template | [Formula Function Reference](formula.en.md) | Template authors and developers |
| Check the public functions, types, components, and events | [API Reference](api-reference.en.md) | Integration developers |

> [!TIP]
> If you are new, go through [Getting started](getting-started.en.md) first, then move on to the [Application Integration Guide](integration.en.md).
>
> If you only build templates, you can go straight to the [Form Designer Guide](designer.en.md); if you handle `.slip` files and PDFs without UI, go straight to the [Core Usage Guide](core.en.md).

## SlipKit's components

SlipKit provides three UI components with different purposes.

| Component | Role | Input | Change output |
|---|---|---|---|
| `<slip-designer>` | Design a document template | A template | The edited template |
| `<slip-form>` | Fill a template with values and issue a voucher | A template or an in-progress voucher | An in-progress voucher / an issued voucher |
| `<slip-viewer>` | View a template or a voucher | A template or a voucher | None |

Each component receives a `.slip` file as a JSON string.

- A template has `kind: 'template'`.
- A voucher has `kind: 'voucher'`.
- An issued voucher has `issued: true` and can no longer be edited in the entry form.

> [!NOTE]
> SlipKit is not a standalone service.
> User authentication, permission management, data storage, server APIs, and screen transitions between components are implemented by the application that uses SlipKit.

## Usage flow

A typical application uses SlipKit in the following order.

1. Create a template in `<slip-designer>`.
2. Save the changed template in the application.
3. Pass the saved template to `<slip-form>`.
4. The user enters values and issues a voucher.
5. Save the in-progress or issued voucher in the application.
6. View the saved template or voucher in `<slip-viewer>`.

The components do not automatically persist edits. The application must receive the events emitted by the designer and the entry form and save them.

## Choosing a package

Use the following packages depending on your environment.

| Package | Purpose |
|---|---|
| `@omdc-slipkit/core` | `.slip` validation, voucher assembly, formula evaluation, PDF generation, and file encryption |
| `@omdc-slipkit/elements` | Web Component-based designer, entry form, and viewer |
| `@omdc-slipkit/react` | Wrapper components for React |
| `@omdc-slipkit/vue` | Wrapper components for Vue |

The React and Vue packages are thin wrappers that connect the Web Components to each framework's usage style. There is no difference in the SlipKit features they provide.

<details>
<summary><strong>Terms used in the guides</strong></summary>

| Term | Meaning |
|---|---|
| Host application | The web application that installs and uses SlipKit |
| Template | A file that defines a document's size, layout, parameters, and formulas |
| Voucher | A file with actual values filled into a template |
| Issue | Finalizing a filled-in voucher's values so it can no longer be edited in the entry form |
| Parameter | A name used in a template to reference values that differ per voucher |
| Template snapshot | The template at creation time, saved inside the voucher |
| Storage adapter | An interface for saving templates and vouchers to the browser or a server |

</details>

## Example projects

The repository includes three demos that implement the same features in different environments.

| Environment | Example |
|---|---|
| Web Component | [`examples/demo`](../../examples/demo) |
| React | [`examples/react-demo`](../../examples/react-demo) |
| Vue | [`examples/vue-demo`](../../examples/vue-demo) |
| Framework-independent logic | [`examples/shared`](../../examples/shared) |

Features that must be implemented outside SlipKit — such as auto-save, opening and downloading files, and screen transitions between the template and voucher views — are collected in [`examples/shared`](../../examples/shared).

## Project information

For the package layout, how to run locally, development commands, technical documents, and the license, see the [Project README](../../README.en.md).
