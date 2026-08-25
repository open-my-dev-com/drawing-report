# Getting started

This document walks a developer new to SlipKit through running the form designer and receiving the form data a user has edited in the application.

By the end of this document you will be able to:

- Create a valid blank template
- Display a template with `<slip-designer>`
- Receive the template a user has edited
- Prepare to connect storage and voucher-entry features next

> [!IMPORTANT]
> SlipKit is currently in a pre-release review stage, and the `@omdc-slipkit/*` packages are not yet published to the npm registry.
> To run it right now, clone the repository and use the bundled demos.

## Choose how to run it

| Goal | Method to use |
|---|---|
| Run SlipKit now and check its features | [Run the demos from the repository](#run-the-demos-from-the-repository) |
| Integrate into an existing application after the npm release | [Connect to an external project](#connect-to-an-external-project) |

---

## Run the demos from the repository

This is the way you can run it right now.

### Requirements

- Node.js 20 or later
- pnpm 10.33.0

You can check the installed versions with:

```bash
node --version
pnpm --version
```

### 1. Set up the repository

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
pnpm install
```

### 2. Run a demo

Run the one demo that matches your environment.

```bash
# Web Component
pnpm demo

# React
pnpm demo:react

# Vue
pnpm demo:vue
```

| Demo | Default address |
|---|---|
| Web Component | `http://localhost:5173` |
| React | `http://localhost:5174` |
| Vue | `http://localhost:5175` |

If a port is already in use, the dev server may point you to a different address. In that case, open the address shown in the terminal.

### 3. Try the features

When you run a demo, a form designer like this appears.

![SlipKit form designer](images/en/overview.png)

Try the following in order.

- [ ] Load a transaction statement or invoice from <kbd>Presets</kbd>
- [ ] Add a text or field element
- [ ] Move and resize the element you added
- [ ] Set a parameter or a formula
- [ ] Check the PDF rendering result in <kbd>Preview</kbd>
- [ ] Move to <kbd>Fill</kbd> and enter values
- [ ] Issue the voucher you filled in
- [ ] Download the `.slip` file
- [ ] Reopen the downloaded `.slip` file
- [ ] Refresh and confirm the previous work is restored

> [!NOTE]
> Screen transitions, auto-save, and opening and downloading files are not features the SlipKit components provide on their own.
> They are usage examples the bundled demos implement by combining SlipKit's events and storage adapters.

You can find the full implementation for each framework in these directories.

| Environment | Example |
|---|---|
| Web Component | [`examples/demo`](../../examples/demo) |
| React | [`examples/react-demo`](../../examples/react-demo) |
| Vue | [`examples/vue-demo`](../../examples/vue-demo) |
| Shared storage/file handling | [`examples/shared`](../../examples/shared) |

---

## Connect to an external project

> [!WARNING]
> The install commands in this section become usable after the `@omdc-slipkit/*` packages are published to npm.
> Running them now results in a `404 Not Found` error.

The examples below assume a build environment such as Vite that supports ESM and TypeScript.

### 1. Install the packages

Install the packages that match your environment.

<details>
<summary><strong>Web Component</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/elements
```

</details>

<details>
<summary><strong>React</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/react
```

React 19 or later is required. If your project doesn't have React yet, install it as well.

```bash
npm install react react-dom
```

</details>

<details>
<summary><strong>Vue</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/vue
```

Vue 3.4 or later is required. If your project doesn't have Vue yet, install it as well.

```bash
npm install vue
```

</details>

> [!TIP]
> The `elements`, `react`, and `vue` packages use `core` internally.
> However, if your application code imports `@omdc-slipkit/core` directly, you must also install `core` as a direct dependency.

### 2. Create a starting template

Create a valid blank template to share across all three environments.

`src/slip-template.ts`:

```ts
import {
  CURRENT_SCHEMA_VERSION,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';

export function createBlankTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: {
        title: 'New template',
      },
      paper: {
        width: 210,
        height: 297,
        padding: [10, 10, 10, 10],
      },
      pages: [
        {
          elements: [],
        },
      ],
      assets: [],
    },
  };
}
```

This example creates an A4-sized blank template. Once the designer appears, you can add elements directly or load a bundled preset.

> [!IMPORTANT]
> Pass `<slip-designer>`'s `src` a JSON string produced by `serializeSlipFile`, not a plain object.

### 3. Connect the designer

Expand only the example for your environment and apply it.

<details>
<summary><strong>Web Component example</strong></summary>

Add an area in the HTML where the designer will be shown.

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>SlipKit getting started</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }

      slip-designer {
        display: block;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <slip-designer></slip-designer>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Register the designer and pass it the starting template.

`src/main.ts`:

```ts
import '@omdc-slipkit/elements';

import {
  serializeSlipFile,
  type SlipFile,
} from '@omdc-slipkit/core';
import type { SlipDesigner } from '@omdc-slipkit/elements';

import { createBlankTemplate } from './slip-template';

const designer =
  document.querySelector<SlipDesigner>('slip-designer');

if (!designer) {
  throw new Error('Could not find the slip-designer element.');
}

let template = createBlankTemplate();

designer.src = serializeSlipFile(template);

designer.addEventListener('slip-change', (event) => {
  const { file } = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail;

  if (file.kind !== 'template') {
    return;
  }

  template = file;
  console.log('Changed template:', template);
});
```

In Web Components, `slip-change` is delivered as a `CustomEvent`, and the changed file is in `event.detail.file`.

</details>

<details>
<summary><strong>React example</strong></summary>

`src/App.tsx`:

```tsx
import { useState } from 'react';
import { SlipDesigner } from '@omdc-slipkit/react';
import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';

import { createBlankTemplate } from './slip-template';

export default function App() {
  const [template, setTemplate] =
    useState<SlipTemplateFile>(() => createBlankTemplate());

  function handleSlipChange(file: SlipFile): void {
    if (file.kind !== 'template') {
      return;
    }

    setTemplate(file);
    console.log('Changed template:', file);
  }

  return (
    <main style={{ height: '100vh' }}>
      <SlipDesigner
        src={serializeSlipFile(template)}
        onSlipChange={handleSlipChange}
      />
    </main>
  );
}
```

The React wrapper's `onSlipChange` receives the changed `SlipFile` object directly, not a `CustomEvent`.

</details>

<details>
<summary><strong>Vue example</strong></summary>

`src/App.vue`:

```vue
<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { SlipDesigner } from '@omdc-slipkit/vue';
import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';

import { createBlankTemplate } from './slip-template';

const template =
  shallowRef<SlipTemplateFile>(createBlankTemplate());

const designerSrc = computed(() =>
  serializeSlipFile(template.value),
);

function handleSlipChange(file: SlipFile): void {
  if (file.kind !== 'template') {
    return;
  }

  template.value = file;
  console.log('Changed template:', file);
}
</script>

<template>
  <main class="designer-page">
    <SlipDesigner
      :src="designerSrc"
      @slip-change="handleSlipChange"
    />
  </main>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

.designer-page {
  height: 100%;
}
</style>
```

The Vue wrapper's `slip-change` event receives the changed `SlipFile` object directly.

</details>

### 4. Check the result

After running the application, confirm the following.

- [ ] An A4-sized blank template is shown.
- [ ] You can load a default template from the designer's <kbd>Presets</kbd> menu.
- [ ] Adding or editing an element prints `Changed template` to the console.
- [ ] The printed object's `kind` is `template`.
- [ ] No TypeScript errors occur.

If you confirmed every item, the minimal connection of the SlipKit form designer is complete.

---

## Save the changed template

> [!IMPORTANT]
> `<slip-designer>` does not automatically persist edits.
> If your application does not keep the file received via `slip-change`, the edits are lost when you refresh or close the screen.

You must keep the file received via the Web Component's `slip-change`, React's `onSlipChange`, or Vue's `slip-change` in your application.

This event can fire every time the user edits the template. When saving to a server, we recommend batching changes over a period of time so you don't send a request on every keystroke or drag.

The next step typically adds the following features.

1. Save the template temporarily in the browser
2. Save the template to a server API
3. Reload the saved template
4. Pass the template to `<slip-form>` to fill in a voucher
5. View the issued voucher with `<slip-viewer>`

---

## Common problems

<details>
<summary><strong>The package can't be found on npm</strong></summary>

While the SlipKit packages are not yet published, you get an error like this.

```text
npm error 404 Not Found
```

For now, use the [Run the demos from the repository](#run-the-demos-from-the-repository) method.

</details>

<details>
<summary><strong>The designer shows a file error</strong></summary>

Check whether you passed an empty object or a plain object directly to `src`.

The following is not a valid template.

```html
<slip-designer src="{}"></slip-designer>
```

Create a `SlipTemplateFile` object and then convert it with `serializeSlipFile`.

```ts
designer.src = serializeSlipFile(createBlankTemplate());
```

</details>

<details>
<summary><strong>@omdc-slipkit/core can't be found</strong></summary>

If your application code imports `core` directly, you must install it as a direct dependency.

```bash
npm install @omdc-slipkit/core
```

</details>

<details>
<summary><strong>The component isn't visible on screen</strong></summary>

Check whether the parent element has no height. To show the designer full-screen, give both the parent and the designer a height.

```css
html,
body,
#app {
  height: 100%;
}

slip-designer {
  display: block;
  height: 100%;
}
```

</details>

<details>
<summary><strong>Edits disappear after refreshing</strong></summary>

SlipKit components do not automatically persist edits. You must save the file received via `slip-change` to IndexedDB, a server, or application state.

</details>

---

## Next documents

- [Form Designer Guide](designer.en.md): how to build a template on screen
- [Core API Guide](core.en.md): file validation and PDF generation in Node.js
- [Formula Function Reference](formula.en.md): formulas you can use in a template
