# SlipKit

[한국어](README.md)

An **embeddable package** for designing, filling, and printing slip forms (structured document templates) through a visual UI.

Install the packages into your project, and your app gets a full-featured form designer,
data-entry form, PDF viewer, and print output — all running in the browser.

- npm scope: `@omdc-slipkit/*` (`core` / `elements` / `react` / `vue`)
- File extension: `.slip`
- Custom elements: `<slip-designer>`, `<slip-form>`, `<slip-viewer>`

## Key Features

- **General-purpose form engine** — from invoices and statements to accounting vouchers, anything expressible as a template
- **GUI designer for non-developers** — drag-and-drop layout with cell merging, color styling, snap guides, undo/redo
- **Framework-agnostic** — ships as Web Components (Lit) with thin React and Vue wrappers
- **Print & PDF as first-class** — paper-based layout (A4, etc.); screen = print = PDF. PDF engine is pdfme (verified, not exposed publicly)
- **Self-contained files** — a slip is a JSON-based `.slip` file with an embedded template snapshot, mandatory SHA-256 hash, and optional JWS signature

## Try It Locally (Demo)

Everything runs in the browser — no server required. After cloning:

```bash
pnpm install
pnpm demo         # Vanilla  → http://localhost:5173
pnpm demo:react   # React    → http://localhost:5174
pnpm demo:vue     # Vue      → http://localhost:5175
```

You can switch between **designing forms** (adding elements, dragging, snapping, tables,
shapes, formulas, sample data, saving) and **filling slips** (entering values, live formula
calculation, issuing) in a single view. Edits are auto-saved in the browser and survive
page reloads. You can also download and open `.slip` files.
The demo references the library source directly, so code changes are reflected immediately.

**All three demos have the same features — only the integration method differs.**
Pick the one that matches your framework:

| Example | Integration |
|---|---|
| [`examples/demo`](examples/demo) | Custom elements directly (`<slip-designer>`, `<slip-form>`) |
| [`examples/react-demo`](examples/react-demo) | `@omdc-slipkit/react` wrapper components + hooks |
| [`examples/vue-demo`](examples/vue-demo) | `@omdc-slipkit/vue` wrapper components + SFC |

Framework-independent logic (what to save, when to resume) lives in
[`examples/shared`](examples/shared) and is shared across all three demos.

## Integration Guide

See the **[Integration Guide](docs/guide/README.en.md)** for step-by-step instructions on
embedding SlipKit in your app — installation, designer / form / viewer setup,
storage adapters, and backend integration.

## Documentation

| Document | Description |
|---|---|
| [docs/guide/](docs/guide/README.en.md) | **Integration Guide** — install, embed, API ([Korean](docs/guide/README.md)) + [Type Reference](docs/guide/types.en.md) · [Fonts & Presets](docs/guide/fonts-and-presets.en.md) |
| [docs/SPEC.md](docs/SPEC.md) | `.slip` file format specification |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture — external system integration (with diagrams) |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Confirmed requirements |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records (ADR-001–035) |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Open questions (all resolved) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Roadmap and session hand-off |
