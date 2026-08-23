# SlipKit 利用ガイド

[한국어](README.md) · [English](README.en.md)

ホストアプリに SlipKit をインストールし、テンプレートデザイナー・伝票入力フォーム・ビューアーを組み込む方法を説明します。

## 目次

1. [インストール](#1-インストール)
2. [クイックスタート](#2-クイックスタート)
3. [コンポーネント API](#3-コンポーネント-api)
4. [イベント](#4-イベント)
5. [ストレージアダプター](#5-ストレージアダプター)
6. [フォント設定](#6-フォント設定)
7. [言語設定](#7-言語設定)

### 関連ドキュメント

- **[Core API ガイド](core.md)** — パース・数式・PDF レンダリング・整合性・サーバー連携（Node.js 単独利用を含む）
- **[数式関数リファレンス](formula.md)** — 組み込み関数 32 種の使い方・引数・例
- **[主要型リファレンス](types.md)** — `SlipFile`、フォント、`SlipPreset`、`StorageAdapter`、`IntegrityJwk` など型ごとのフィールドと既定値
- **[同梱フォント・プリセット](fonts-and-presets.md)** — 同梱フォント（Pretendard・Noto Sans JP）の詳細、フォント供給、同梱プリセット（取引明細書・請求書）の構成と言語処理

---

## 1. インストール

```bash
# バニラ (Web Component を直接利用)
npm install @omdc-slipkit/elements

# React
npm install @omdc-slipkit/react
# peerDependency: react >= 19

# Vue
npm install @omdc-slipkit/vue
# peerDependency: vue >= 3.4
```

`@omdc-slipkit/core` は elements・react・vue が依存しているため、別途インストールする必要はありません。
サーバーで core のみ単独で使う場合（Node での PDF 生成など）だけ直接インストールします。

```bash
npm install @omdc-slipkit/core
```

## 2. クイックスタート

### バニラ (Web Component)

```html
<script type="module">
  import '@omdc-slipkit/elements';
  import { serializeSlipFile } from '@omdc-slipkit/core';

  const designer = document.querySelector('slip-designer');

  // 変更検知
  designer.addEventListener('slip-change', (e) => {
    const file = e.detail.file;  // SlipFile オブジェクト
    console.log('テンプレートが変更されました:', file);
  });
</script>

<slip-designer src="{}"></slip-designer>
```

### React

```tsx
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/react';
import { serializeSlipFile, type SlipFile } from '@omdc-slipkit/core';

function App() {
  const [template, setTemplate] = useState(initialTemplate);

  return (
    <SlipDesigner
      src={serializeSlipFile(template)}
      onSlipChange={(file) => {
        if (file.kind === 'template') setTemplate(file);
      }}
    />
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/vue';
import { serializeSlipFile, type SlipFile } from '@omdc-slipkit/core';
import { shallowRef, computed } from 'vue';

const template = shallowRef(initialTemplate());
const src = computed(() => serializeSlipFile(template.value));

function onDesignerChange(file: SlipFile) {
  if (file.kind === 'template') template.value = file;
}
</script>

<template>
  <SlipDesigner :src="src" @slip-change="onDesignerChange" />
</template>
```

> Vue で `slip-` 接頭辞をカスタム要素として認識するようビルド設定を追加すれば、ラッパーなしで
> `<slip-designer>` を直接使えます。

## 3. コンポーネント API

### `<slip-designer>` — テンプレートデザイナー

テンプレート（template）を視覚的に編集する GUI エディターです。

| プロパティ | 型 | 説明 |
|---|---|---|
| `src` | `string` | `.slip` JSON 文字列 (template ファイル) |
| `locale` | `'ko' \| 'en' \| 'ja'` | UI 言語 (既定: `'ko'`) |
| `settings` | `SlipDesignerSettings` | フォント供給（`getFonts`）・用紙一覧の供給/保存（`getPaperSizes`/`savePaperSize`）・バーコード種類の絞り込み（`getBarcodeKinds`）。未指定の場合は言語に合わせた同梱フォントを使い、バーコードは12種すべて表示 (ADR-040/042/048) |
| `presets` | `SlipPreset[]` | プリセットメニューに使うテンプレート一覧 — 指定すると同梱プリセットの代わりに表示 |
| `storage` | `StorageAdapter` | 「マイテンプレートの保存・読み込み」に使うストレージアダプター |

| イベント | detail | 説明 |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | 編集でテンプレートが変更されるたびに発生 |

### `<slip-form>` — 伝票入力フォーム

テンプレートに値を入力して発行する入力画面です。右側に入力済みの状態の PDF プレビューを表示します。

| プロパティ | 型 | 説明 |
|---|---|---|
| `src` | `string` | `.slip` JSON 文字列 (テンプレートまたは入力中の伝票) |
| `locale` | `'ko' \| 'en' \| 'ja'` | UI 言語 (既定: `'ko'`) |
| `settings` | `SlipFontProvider` | フォント供給（`getFonts`）。未指定の場合は言語に合わせた同梱フォントを使用 (ADR-040/042) |
| `signingKey` | `IntegrityJwk` | 発行時の署名に使う ES256 秘密鍵 (JWK)。なければハッシュのみ記録 |

| イベント | detail | 説明 |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | 値を入力するたびに入力中の伝票を送出 |
| `slip-issue` | `{ file: SlipFile }` | 発行が完了すると整合性記録を含む伝票を送出 |

### `<slip-viewer>` — ビューアー

発行済みの伝票やテンプレートを PDF にレンダリングして表示する読み取り専用ビューアーです。

| プロパティ | 型 | 説明 |
|---|---|---|
| `src` | `string` | `.slip` JSON 文字列 |
| `locale` | `'ko' \| 'en' \| 'ja'` | UI 言語 (既定: `'ko'`) |
| `settings` | `SlipFontProvider` | フォント供給（`getFonts`）。未指定の場合は言語に合わせた同梱フォントを使用 (ADR-040/042) |

## 4. イベント

コンポーネントが送るイベントは `CustomEvent` であり、`detail.file` に現在の `.slip` ファイルオブジェクトが入ります。
**ホストアプリはこのイベントでコンポーネント内のデータを受け取ります** — コンポーネントが自ら保存しないため、
イベントを受け取って保存しなければ編集内容は失われます。

```ts
// バニラ
designer.addEventListener('slip-change', (e) => {
  const file = e.detail.file;  // SlipFile
});

// React
<SlipDesigner onSlipChange={(file) => { /* SlipFile */ }} />

// Vue
<SlipDesigner @slip-change="(file) => { /* SlipFile */ }" />
```

### イベントの種類と用途

| イベント | 発生タイミング | ファイル種別 | ホストアプリが行うこと |
|---|---|---|---|
| `slip-change` (デザイナー) | テンプレートを編集するたびに | `template` | テンプレートの自動保存、状態同期 |
| `slip-change` (入力フォーム) | 伝票に値を入力するたびに | `voucher` | 入力中の伝票を一時保存 (リロード後に続きから入力) |
| `slip-issue` (入力フォーム) | 発行ボタンを押すと | `voucher` (整合性記録を含む) | 発行済みの伝票をサーバーに保存 |

### 活用例

```ts
// デザイナー: テンプレートが変わったらサーバーに保存
designer.addEventListener('slip-change', (e) => {
  const template = e.detail.file;
  fetch('/api/templates/' + templateId, {
    method: 'PUT',
    body: serializeSlipFile(template),
  });
});

// 入力フォーム: 発行が終わったら伝票をサーバーにアップロードします
form.addEventListener('slip-issue', (e) => {
  const voucher = e.detail.file;
  fetch('/api/vouchers', {
    method: 'POST',
    body: serializeSlipFile(voucher),
  });
});
```

## 5. ストレージアダプター

`StorageAdapter` インターフェースを実装すると、「マイテンプレートの保存・読み込み」機能が使えます。
elements パッケージにはブラウザ向けの実装が 2 種含まれています。

### IndexedDB ストレージ

ブラウザの IndexedDB にテンプレートを保存します。タイトル・種別フィルターとカーソルページングをサポートします。

```ts
import { IndexedDbStorage } from '@omdc-slipkit/elements';

const store = new IndexedDbStorage({ dbName: 'my-app-slips' });
```

### ローカルファイルストレージ

保存はファイルのダウンロード、開くはファイル選択ダイアログで動作します。

```ts
import { LocalFileStorage } from '@omdc-slipkit/elements';

const localFile = new LocalFileStorage();
await localFile.save('取引明細書.slip', file);  // ダウンロード
const file = await localFile.load('');           // ファイル選択
```

### 独自実装

サーバー API でテンプレートを管理したい場合は、`StorageAdapter` インターフェースを独自に実装します。

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';

const serverStorage: StorageAdapter = {
  async save(key, file) { /* POST /api/slips */ },
  async load(key) { /* GET /api/slips/:key */ },
  async delete(key) { /* DELETE /api/slips/:key */ },
  async list(options?) { /* GET /api/slips?title=...&cursor=... */ },
};
```

## 6. フォント設定

SlipKit は言語ごとの既定フォントを同梱しています — 韓国語・英語は Pretendard、日本語は Noto Sans JP。
`settings` を指定しなければ `locale` に合ったフォントが自動的に使われ、文字化けしません。

ホストがフォントを供給するには、`settings.getFonts` を実装して渡します（同期配列またはサーバー fetch の Promise）。

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';

designer.settings = {
  getFonts: () => [
    ...pretendardFonts,
    { name: 'NotoSans', data: notoSansArrayBuffer },
  ],
};
```

フォント供給インターフェースと同梱フォントの詳細は **[同梱フォント・プリセット](fonts-and-presets.md)** を参照してください。

## 7. 言語設定

UI 言語は `locale` プロパティで変更します。対応言語は韓国語（`'ko'`、既定）・英語（`'en'`）・日本語（`'ja'`）です。

```html
<slip-designer locale="ja"></slip-designer>
```

```tsx
<SlipDesigner src={src} locale="ja" />
```

日本語（`'ja'`）は既定フォント（Noto Sans JP）を同梱しているため、言語を切り替えるだけでレンダリングされます — 太字やより広い文字
範囲が必要な場合は `settings.getFonts` でフォントを供給します。

数式関数の結果フォーマット（数値の桁区切りなど）もロケールに応じて変わります（`ja-JP` を含む）。

サーバーで `.slip` ファイルを直接扱ったり PDF を生成したりする必要がある場合は、**[Core API ガイド](core.md)** を参照してください。
