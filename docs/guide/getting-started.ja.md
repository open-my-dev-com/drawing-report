# スタートガイド

このドキュメントは、SlipKit を初めて使う開発者がテンプレートデザイナーを実行し、ユーザーが編集したテンプレートデータをアプリケーションで受け取るまでの流れを説明します。

このドキュメントを終えると、次のことができるようになります。

- 有効な空テンプレートを作る
- `<slip-designer>` でテンプレートを表示する
- ユーザーが編集したテンプレートを受け取る
- 以降の保存・伝票作成機能を接続する準備をする

> [!IMPORTANT]
> SlipKit は現在、公開前のレビュー段階であり、`@omdc-slipkit/*` パッケージはまだ npm レジストリに公開されていません。
> 今すぐ実行するには、リポジトリをクローンして同梱デモを使用してください。

## 実行方法の選択

| 目的 | 使用する方法 |
|---|---|
| 今すぐ SlipKit を実行して機能を確認 | [リポジトリからデモを実行](#リポジトリからデモを実行) |
| npm 公開後に既存アプリケーションへ統合 | [外部プロジェクトに接続](#外部プロジェクトに接続) |

---

## リポジトリからデモを実行

現在すぐに実行できる方法です。

### 要件

- Node.js 20 以上
- pnpm 10.33.0

インストール済みのバージョンは次のコマンドで確認できます。

```bash
node --version
pnpm --version
```

### 1. リポジトリの準備

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
pnpm install
```

### 2. デモの実行

利用する環境に合わせてデモを一つ実行します。

```bash
# Web Component
pnpm demo

# React
pnpm demo:react

# Vue
pnpm demo:vue
```

| デモ | 既定のアドレス |
|---|---|
| Web Component | `http://localhost:5173` |
| React | `http://localhost:5174` |
| Vue | `http://localhost:5175` |

ポートがすでに使用中の場合、開発サーバーが別のアドレスを案内することがあります。その場合はターミナルに表示されたアドレスにアクセスします。

### 3. 機能の確認

デモを実行すると、次のようなテンプレートデザイナーが表示されます。

![SlipKit テンプレートデザイナー](images/ja/overview.png)

次の項目を順に確認してみてください。

- [ ] <kbd>プリセット</kbd> から取引明細書または請求書を読み込む
- [ ] テキストやフィールド要素を追加する
- [ ] 追加した要素の位置とサイズを変更する
- [ ] パラメータまたは数式を設定する
- [ ] <kbd>プレビュー</kbd> で PDF レンダリング結果を確認する
- [ ] <kbd>伝票作成</kbd> に移動して値を入力する
- [ ] 作成した伝票を発行する
- [ ] `.slip` ファイルをダウンロードする
- [ ] ダウンロードした `.slip` ファイルを再度開く
- [ ] リロード後に前の作業が復元されるか確認する

> [!NOTE]
> 画面遷移、自動保存、ファイルの読み込みとダウンロードは、SlipKit コンポーネントが単独で提供する機能ではありません。
> 同梱デモが SlipKit のイベントとストレージアダプタを組み合わせて実装した使用例です。

フレームワークごとの実装全体は、次のディレクトリで確認できます。

| 環境 | 例 |
|---|---|
| Web Component | [`examples/demo`](../../examples/demo) |
| React | [`examples/react-demo`](../../examples/react-demo) |
| Vue | [`examples/vue-demo`](../../examples/vue-demo) |
| 共通の保存・ファイル処理 | [`examples/shared`](../../examples/shared) |

---

## 外部プロジェクトに接続

> [!WARNING]
> この節のインストールコマンドは、`@omdc-slipkit/*` パッケージが npm に公開されたあとに使用できます。
> 現在実行すると `404 Not Found` エラーが発生します。

以下の例は、ESM と TypeScript をサポートする Vite などのビルド環境を前提とします。

### 1. パッケージのインストール

利用する環境に合わせてパッケージをインストールします。

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

React 19 以上が必要です。既存のプロジェクトに React がなければ一緒にインストールします。

```bash
npm install react react-dom
```

</details>

<details>
<summary><strong>Vue</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/vue
```

Vue 3.4 以上が必要です。既存のプロジェクトに Vue がなければ一緒にインストールします。

```bash
npm install vue
```

</details>

> [!TIP]
> `elements`、`react`、`vue` パッケージは内部的に `core` を使用します。
> ただし、アプリケーションコードで `@omdc-slipkit/core` を直接 import する場合は、`core` も直接の依存関係としてインストールする必要があります。

### 2. 開始テンプレートを作る

3 つの環境で共通して使う有効な空テンプレートを作ります。

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
        title: '新しいテンプレート',
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

この例は A4 サイズの空テンプレートを作ります。デザイナーが表示されたら、要素を直接追加したり同梱プリセットを読み込んだりできます。

> [!IMPORTANT]
> `<slip-designer>` の `src` には、プレーンオブジェクトではなく `serializeSlipFile` で変換した JSON 文字列を渡してください。

### 3. デザイナーの接続

利用する環境に該当する例だけを開いて適用します。

<details>
<summary><strong>Web Component の例</strong></summary>

HTML にデザイナーを表示する領域を追加します。

`index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>SlipKit スタートガイド</title>
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

デザイナーを登録して開始テンプレートを渡します。

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
  throw new Error('slip-designer 要素が見つかりません。');
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
  console.log('変更されたテンプレート:', template);
});
```

Web Component では `slip-change` が `CustomEvent` として渡され、変更されたファイルは `event.detail.file` に入っています。

</details>

<details>
<summary><strong>React の例</strong></summary>

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
    console.log('変更されたテンプレート:', file);
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

React ラッパーの `onSlipChange` には、`CustomEvent` ではなく変更された `SlipFile` オブジェクトが直接渡されます。

</details>

<details>
<summary><strong>Vue の例</strong></summary>

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
  console.log('変更されたテンプレート:', file);
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

Vue ラッパーの `slip-change` イベントには、変更された `SlipFile` オブジェクトが直接渡されます。

</details>

### 4. 実行結果の確認

アプリケーションを実行したあと、次の内容を確認します。

- [ ] A4 サイズの空テンプレートが表示されます。
- [ ] デザイナーの <kbd>プリセット</kbd> メニューから既定のテンプレートを読み込めます。
- [ ] 要素を追加または編集すると、コンソールに `変更されたテンプレート` が出力されます。
- [ ] 出力されたオブジェクトの `kind` が `template` です。
- [ ] TypeScript エラーが発生しません。

すべての項目を確認できたら、SlipKit テンプレートデザイナーの最小接続が完了です。

---

## 変更されたテンプレートを保存する

> [!IMPORTANT]
> `<slip-designer>` は編集結果を自動的に永続保存しません。
> `slip-change` で受け取ったファイルをアプリケーションで保持しないと、リロードや画面を閉じたときに編集内容が失われます。

Web Component の `slip-change`、React の `onSlipChange`、Vue の `slip-change` を通じて受け取ったファイルを、アプリケーションで保持する必要があります。

このイベントは、ユーザーがテンプレートを編集するたびに発生することがあります。サーバーに保存する場合は、キー入力やドラッグごとにリクエストしないよう、一定時間の変更をまとめて保存する方法を推奨します。

次のステップでは、一般的に以下の機能を追加します。

1. ブラウザにテンプレートを一時保存
2. サーバー API にテンプレートを保存
3. 保存したテンプレートを再度読み込み
4. テンプレートを `<slip-form>` に渡して伝票を作成
5. 発行された伝票を `<slip-viewer>` で閲覧

---

## よくある問題

<details>
<summary><strong>npm でパッケージが見つかりません</strong></summary>

SlipKit パッケージがまだ公開されていない状態では、次のようなエラーが発生します。

```text
npm error 404 Not Found
```

現在は [リポジトリからデモを実行](#リポジトリからデモを実行) する方法を使用します。

</details>

<details>
<summary><strong>デザイナーにファイルエラーが表示されます</strong></summary>

`src` に空オブジェクトやプレーンオブジェクトを直接渡していないか確認します。

次のような値は有効なテンプレートではありません。

```html
<slip-designer src="{}"></slip-designer>
```

`SlipTemplateFile` オブジェクトを作ってから `serializeSlipFile` で変換してください。

```ts
designer.src = serializeSlipFile(createBlankTemplate());
```

</details>

<details>
<summary><strong>@omdc-slipkit/core が見つかりません</strong></summary>

アプリケーションコードで `core` を直接 import する場合は、直接の依存関係としてインストールする必要があります。

```bash
npm install @omdc-slipkit/core
```

</details>

<details>
<summary><strong>コンポーネントが画面に表示されません</strong></summary>

親要素に高さがないか確認します。デザイナーを全画面で表示するには、親とデザイナーに高さを指定します。

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
<summary><strong>リロードすると編集内容が消えます</strong></summary>

SlipKit コンポーネントは編集内容を自動的に永続保存しません。`slip-change` で受け取ったファイルを IndexedDB、サーバー、またはアプリケーションの状態に保存する必要があります。

</details>

---

## 次のドキュメント

- [テンプレートデザイナー利用ガイド](designer.ja.md): 画面でテンプレートを作る方法
- [Core API ガイド](core.ja.md): Node.js でのファイル検証と PDF 生成
- [数式関数リファレンス](formula.ja.md): テンプレートで使える数式
- [主要な型リファレンス](types.ja.md): コンポーネント設定と公開型
