# 環境設定ガイド

[한국어](configuration.ko.md) · [English](configuration.md)

このドキュメントは、SlipKit の言語、フォント、用紙、バーコード、プリセット、ストレージ、画像制限をホストアプリケーションに合わせて設定する方法を説明します。

設定は、コンポーネントの機能自体を変更するというより、次のようなアプリケーション固有のリソースとポリシーを渡すために使います。

- 画面に表示する言語
- PDF レンダリングに使うフォント
- デザイナーで選択する用紙とバーコード
- アプリケーション専用のテンプレートプリセット
- デザイナーの「マイテンプレート」ストレージ
- アップロードできる画像サイズ
- Core の数式ロケールと暗号化キー

> [!NOTE]
> コンポーネントのイベントと自動保存フローは[アプリケーション統合ガイド](integration.ja.md)を、各設定タイプの全フィールドは[API リファレンス](api-reference.ja.md)を確認してください。
>
> ローカル MCP サーバーの `slipkit-mcp.json` 設定は [MCP 利用ガイド](mcp.ja.md) で別途説明します。

## コンポーネント設定を一覧で見る

| 設定 | デザイナー | 入力フォーム | ビューアー | 既定の動作 |
|---|:---:|:---:|:---:|---|
| `locale` | ● | ● | ● | `SlipKit` のロケールまたは英語 UI |
| `slipkit` | ● | ● | ● | 同梱フォントと Core の既定設定を使用 |
| `settings` | ● | — | — | 同梱のバーコード種類と用紙を使用 |
| `presets` | ● | — | — | 同梱プリセット 2 種を使用 |
| `storage` | ● | — | — | 「マイテンプレート」保存・一覧機能を非表示 |
| `maxImageBytes` | ● | ● | — | 画像の元ファイル最大 2MB |

`locale` と `max-image-bytes` は HTML 属性で渡せます。

`slipkit`、`settings`、`presets`、`storage` はオブジェクトや関数を含むため、JavaScript プロパティ、またはフレームワークのオブジェクト prop として渡す必要があります。

## 設定の渡し方

### Web Component

文字列と数値は HTML 属性で渡せます。

```html
<slip-designer
  id="designer"
  locale="ja"
  max-image-bytes="2097152"
></slip-designer>
```

オブジェクト設定は JavaScript プロパティで渡します。

```ts
import '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';

import type {
  SlipDesigner,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designer =
  document.querySelector<SlipDesigner>(
    '#designer',
  );

if (!designer) {
  throw new Error(
    'slip-designer 要素が見つかりません。',
  );
}

const slipkit = createSlipKit({
  getFonts: () => appFonts,
  locale: 'ja-JP',
});

const settings: SlipDesignerSettings = {
  getPaperSizes: () => appPaperSizes,
};

designer.slipkit = slipkit;
designer.settings = settings;
designer.presets = appPresets;
designer.storage = templateStorage;
designer.maxImageBytes = 2 * 1024 * 1024;
```

次のようにオブジェクト名を HTML 属性の文字列として書いても、実際のオブジェクトは渡されません。

```html
<!-- 誤った使い方 -->
<slip-designer
  settings="settings"
  presets="appPresets"
  storage="templateStorage"
></slip-designer>
```

### React

React ラッパーでは、通常のコンポーネント prop として渡します。

```tsx
import { useMemo } from 'react';

import {
  SlipDesigner,
} from '@omdc-slipkit/react';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

export function DesignerScreen() {
  const settings =
    useMemo<SlipDesignerSettings>(
      () => ({
        getPaperSizes: () => appPaperSizes,
      }),
      [],
    );

  return (
    <SlipDesigner
      src={designerSrc}
      locale="ja"
      slipkit={slipkit}
      settings={settings}
      presets={appPresets}
      storage={templateStorage}
      maxImageBytes={2 * 1024 * 1024}
      onSlipChange={handleSlipChange}
    />
  );
}
```

> [!TIP]
> レンダリングのたびに `slipkit`、`settings`、`presets`、`storage` オブジェクトを新しく作らないでください。
> React ではモジュールスコープで宣言するか、`useMemo` を使って同じオブジェクトを保つのがよいです。

### Vue

Vue ラッパーでも、オブジェクト prop として渡します。

```vue
<script setup lang="ts">
import {
  SlipDesigner,
} from '@omdc-slipkit/vue';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const settings: SlipDesignerSettings = {
  getPaperSizes: () => appPaperSizes,
};
</script>

<template>
  <SlipDesigner
    :src="designerSrc"
    locale="ja"
    :slipkit="slipkit"
    :settings="settings"
    :presets="appPresets"
    :storage="templateStorage"
    :max-image-bytes="2 * 1024 * 1024"
    @slip-change="handleSlipChange"
  />
</template>
```

## UI 言語の設定

3 つの UI コンポーネントは `locale` をサポートします。

| 値 | 言語 | 既定フォント |
|---|---|---|
| `ko` | 韓国語 | Pretendard Regular・Bold |
| `en` | 英語 | Pretendard Regular・Bold |
| `ja` | 日本語 | Noto Sans JP Regular |

`locale` を省略すると、UI は `SlipKit.locale` の言語を使います。`slipkit` も指定していない場合、またはサポートしない `locale` を明示した場合は英語を使います。

`en-US`、`ko-KR`、`ja-JP` のように地域コードを含む値も使えます。この場合、先頭の言語コードで UI 言語を選択します。

```html
<slip-designer locale="ja"></slip-designer>
<slip-form locale="ja-JP"></slip-form>
<slip-viewer locale="en-US"></slip-viewer>
```

コンポーネントの `locale` は次の項目に影響します。

- コンポーネントのボタンと案内文
- エラーメッセージ

`getFonts` を設定していない場合、同梱の既定フォントは `SlipKit.locale` で選択します。`slipkit` も指定していない場合は、コンポーネントの `locale` を使います。

次の項目は自動的には翻訳しません。

- テンプレートに直接入力したテキスト
- パラメータの論理名
- 外部から受け取った `.slip` ファイルの内容
- アプリケーションが供給したプリセットの名前と内容

> [!IMPORTANT]
> 同梱されている取引明細書と請求書のプリセットは、**適用した時点の `locale` の言語**でタイトル、表の項目と文言が作られます。
> すでに作られたテンプレートは、あとで `locale` を変えても自動的には翻訳されません。
> 別の構成のテンプレートが必要なら、独自に作成したプリセットを別途供給してください。

## フォントの設定

### 同梱の既定フォント

`SlipKit` に `getFonts` を設定していない場合、UI コンポーネントは `SlipKit.locale` に合った既定フォントを読み込みます。`slipkit` も指定していない場合は、コンポーネントの `locale` を使います。

| 言語 | 同梱フォント | 構成 |
|---|---|---|
| 韓国語・英語 | Pretendard | Regular・Bold |
| 日本語 | Noto Sans JP | Regular サブセット |

同梱フォントは PDF レンダリングが必要になったときに遅延読み込みされ、一度読み込むと同じ言語で再利用されます。

日本語の既定フォントは、一般的なかな、漢字、ラテン文字を含むサブセットです。同梱範囲にない文字や太字の日本語フォントが必要なら、独自フォントを供給する必要があります。

### 独自フォントの供給

独自フォントは `createSlipKit` の `getFonts` オプションに一度設定し、同じインスタンスを各コンポーネントに渡します。

```ts
import { createSlipKit } from '@omdc-slipkit/core';

const slipkit = createSlipKit({
  getFonts: () => [
    {
      name: 'AppFont',
      data: appFontRegular,
      fallback: true,
    },
    {
      name: 'AppFont-Bold',
      data: appFontBold,
    },
  ],
});

viewer.slipkit = slipkit;
form.slipkit = slipkit;
designer.slipkit = slipkit;
```

`getFonts` はフォント配列、またはフォント配列を返す `Promise` を使えます。

UI コンポーネントは `getFonts` がない場合に同梱フォントを補いますが、Core の `slipkit.render()` は Elements の同梱フォントを自動では読み込みません。Core での直接レンダリングとコンポーネントのプレビューで同じ独自フォントを使う場合は、`getFonts` を設定してください。

```ts
import { createSlipKit, type SlipFont } from '@omdc-slipkit/core';

async function loadFont(
  url: string,
): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `フォントを読み込めませんでした: ${response.status}`,
    );
  }

  return new Uint8Array(
    await response.arrayBuffer(),
  );
}

async function loadAppFonts(): Promise<SlipFont[]> {
  const [regular, bold] = await Promise.all([
    loadFont('/fonts/AppFont-Regular.otf'),
    loadFont('/fonts/AppFont-Bold.otf'),
  ]);

  return [
    {
      name: 'AppFont',
      data: regular,
      fallback: true,
    },
    {
      name: 'AppFont-Bold',
      data: bold,
    },
  ];
}

const slipkit = createSlipKit({
  getFonts: loadAppFonts,
});
```

> [!TIP]
> `SlipKit` インスタンスは、デザイナーと PDF レンダラーで成功した `getFonts` の結果を再利用します。
> 読み込みに失敗した場合は、次の呼び出しで供給関数を再実行します。

### 独自フォントの適用ルール

フォントオブジェクトは次の値を使います。

| フィールド | 説明 |
|---|---|
| `name` | テンプレート要素が参照するフォント名 |
| `data` | TTF または OTF ファイルの `Uint8Array` |
| `fallback` | 他のフォントが見つからないときに使う代替フォントかどうか |

次のルールを確認してください。

- `fallback: true` のフォントは 1 つだけ指定できます。
- 代替フォントを指定しないと、リストの最初のフォントを代替フォントとして使います。
- 同じ `name` を持つフォントを複数登録できません。
- 太字フォントは基本の名前の後ろに `-Bold` を付けます。
- 斜体フォントは基本の名前の後ろに `-Italic` を付けます。
- 太字斜体フォントは基本の名前の後ろに `-BoldItalic` を付けます。

たとえば基本フォント名が `AppFont` なら、次のように構成します。

```ts
const fonts = [
  {
    name: 'AppFont',
    data: regular,
    fallback: true,
  },
  {
    name: 'AppFont-Bold',
    data: bold,
  },
  {
    name: 'AppFont-Italic',
    data: italic,
  },
  {
    name: 'AppFont-BoldItalic',
    data: boldItalic,
  },
];
```

必要な変形フォントが登録されていないと、その太さや斜体の効果を適用できないことがあります。

### 同梱フォントと独自フォントを併用する

`getFonts` が空でない配列を返すと、同梱の既定フォントは自動的には追加されません。

コンポーネントの既定動作と同じロケール別の同梱フォント構成が必要なら、`loadDefaultFonts(locale)` を使います。2 つの同梱フォント群を意図的に併用するときだけ、フォントのサブパスを使います。

```ts
import { loadDefaultFonts } from '@omdc-slipkit/elements';

const slipkit = createSlipKit({
  getFonts: () => loadDefaultFonts('ja'),
});
```

同梱フォントを独自フォントと併用するには、フォントのサブパスから直接読み込みます。

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';

const slipkit = createSlipKit({
  getFonts: () => [
    ...PRETENDARD_FONTS,
    ...NOTO_SANS_JP_FONTS,
    {
      name: 'AppFont',
      data: appFont,
    },
  ],
});
```

> [!CAUTION]
> フルフォントファイルは、バンドルサイズと初期読み込み時間に大きく影響することがあります。
> アプリケーションで実際に使う文字と太さを含むフォントだけを供給してください。

同梱の Pretendard と Noto Sans JP には、それぞれ SIL Open Font License 1.1 が適用されます。独自フォントを含める場合は、そのフォントの配布・埋め込み条件も確認する必要があります。

## デザイナーの設定

`<slip-designer>` は用紙とバーコードの選択肢を `SlipDesignerSettings` で受け取ります。フォントとロケールは `slipkit` プロパティで渡します。

```ts
import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designerSettings:
  SlipDesignerSettings = {
    getPaperSizes: () => appPaperSizes,
    savePaperSize: saveAppPaperSize,
    getBarcodeKinds: () => [
      'qrcode',
      'code128',
      'ean13',
    ],
  };
```

### 独自用紙の追加

デザイナーには次の用紙が既定で用意されています。

| 名前 | 幅 | 高さ |
|---|---:|---:|
| A4 | 210mm | 297mm |
| A5 | 148mm | 210mm |
| B5 | 176mm | 250mm |
| Letter | 215.9mm | 279.4mm |

アプリケーション専用の用紙は `getPaperSizes` で追加します。

```ts
import type {
  PaperSize,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const paperSizes: PaperSize[] = [
  {
    name: '配送ラベル 100×150',
    width: 100,
    height: 150,
  },
  {
    name: 'レシート 80mm',
    width: 80,
    height: 200,
  },
];

const settings: SlipDesignerSettings = {
  getPaperSizes: () => paperSizes,
};
```

独自の用紙は既定の用紙の後ろに追加されます。`.slip` ファイルには用紙名ではなく、実際の幅と高さだけが保存されます。

デザイナーでユーザーが直接入力した用紙をアプリケーションに保存するには、`savePaperSize` も実装します。

```ts
const PAPER_STORAGE_KEY =
  'my-app-paper-sizes';

function readPaperSizes(): PaperSize[] {
  const json =
    localStorage.getItem(PAPER_STORAGE_KEY);

  if (!json) {
    return [];
  }

  return JSON.parse(json) as PaperSize[];
}

function writePaperSizes(
  sizes: PaperSize[],
): void {
  localStorage.setItem(
    PAPER_STORAGE_KEY,
    JSON.stringify(sizes),
  );
}

const settings: SlipDesignerSettings = {
  getPaperSizes: () => readPaperSizes(),

  savePaperSize: (size) => {
    const sizes = readPaperSizes();

    const filtered = sizes.filter(
      (item) => item.name !== size.name,
    );

    writePaperSizes([
      ...filtered,
      size,
    ]);
  },
};
```

ユーザーがデザイナーで用紙を保存すると `savePaperSize` が呼び出されます。保存が終わった後、デザイナーは `getPaperSizes` を再度呼び出して選択リストを更新します。

> [!NOTE]
> `savePaperSize` は用紙をどこに保存するかを決めません。
> `localStorage`、IndexedDB、サーバー API のうち、アプリケーションに合った保存方法をホストが実装する必要があります。

### バーコード種類の制限

デザイナーは既定で次の 12 種のバーコードを表示します。

| 値 | 表示名 |
|---|---|
| `qrcode` | QR Code |
| `code128` | CODE128 |
| `ean13` | EAN-13 |
| `code39` | CODE39 |
| `ean8` | EAN-8 |
| `upca` | UPC-A |
| `upce` | UPC-E |
| `itf14` | ITF-14 |
| `nw7` | NW-7 (CODABAR) |
| `japanpost` | Japan Post |
| `gs1datamatrix` | GS1 DataMatrix |
| `pdf417` | PDF417 |

アプリケーションで使う種類だけを表示するには、`getBarcodeKinds` を実装します。

```ts
import type {
  BarcodeKind,
} from '@omdc-slipkit/core';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const barcodeKinds: BarcodeKind[] = [
  'qrcode',
  'code128',
  'ean13',
];

const settings: SlipDesignerSettings = {
  getBarcodeKinds: () => barcodeKinds,
};
```

`getBarcodeKinds` を省略するか、空の配列を返すと、12 種すべてが表示されます。

> [!NOTE]
> この設定は、デザイナーの選択リストを絞る機能です。
> 既存の `.slip` ファイルに入っている別のバーコード種類を、ファイル形式のレベルで禁止するポリシーではありません。

## テンプレートプリセットの設定

デザイナーには取引明細書と請求書のプリセットが既定で含まれています。

アプリケーション専用のプリセットを提供するには、`SlipPreset` の配列を `presets` に渡します。

```ts
import {
  CURRENT_SCHEMA_VERSION,
} from '@omdc-slipkit/core';

import type {
  SlipPreset,
} from '@omdc-slipkit/elements';

const shippingLabelPreset:
  SlipPreset = {
    id: 'shipping-label',
    name: '配送ラベル',

    create: () => ({
      schemaVersion:
        CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: {
          title: '配送ラベル',
        },
        paper: {
          width: 100,
          height: 150,
          padding: [
            5,
            5,
            5,
            5,
          ],
        },
        parameters: [
          {
            key: 'recipientName',
            label: '受取人',
          },
          {
            key: 'address',
            label: '住所',
          },
        ],
        pages: [
          {
            elements: [
              {
                type: 'field',
                id: 'recipient-name',
                name: '受取人',
                position: {
                  x: 10,
                  y: 15,
                },
                width: 80,
                height: 10,
                parameter: 'recipientName',
                fontSize: 14,
              },
              {
                type: 'field',
                id: 'address',
                name: '住所',
                position: {
                  x: 10,
                  y: 30,
                },
                width: 80,
                height: 30,
                parameter: 'address',
              },
            ],
          },
        ],
        assets: [],
      },
    }),
  };

const appPresets: SlipPreset[] = [
  shippingLabelPreset,
];

designer.presets = appPresets;
```

`create` は、プリセットを選択するたびに新しい `SlipTemplateFile` オブジェクトを返す必要があります。同じオブジェクトを返し続けると、前の編集内容が次のプリセット選択に残ることがあります。

### 同梱プリセットと一緒に表示する

独自プリセットを指定すると、同梱プリセットの代わりに独自プリセットが表示されます。

両方を一緒に表示するには、`getPresets` で現在の言語の同梱プリセットを取得して展開します。

```ts
import {
  getPresets,
} from '@omdc-slipkit/elements';

const appPresets = [
  ...getPresets('ja'),
  shippingLabelPreset,
];

designer.presets = appPresets;
```

> [!NOTE]
> 空の配列を渡すと、プリセットメニューが空になるのではなく、同梱プリセットに戻ります。
> この設定だけでプリセットメニュー全体を非表示にはできません。

> [!WARNING]
> プリセットを選択すると、デザイナーで編集中のテンプレート全体が、プリセットが返したテンプレートに置き換わります。
> プリセットを適用する前に、ユーザーが現在の作業を保存する機会を用意してください。

## ストレージの設定

デザイナーの `storage` プロパティは、次の機能に使います。

- マイテンプレートとして保存
- 保存したテンプレートの一覧表示
- 保存したテンプレートの読み込み
- 保存したテンプレートの削除

`storage` を指定しないと、該当するボタンは表示されません。

### IndexedDB ストレージ

ブラウザにテンプレートを保存するには、`IndexedDbStorage` を使えます。

```ts
import {
  IndexedDbStorage,
} from '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';

const slipkit = createSlipKit({
  locale: 'ja-JP',
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    pageSize: 50,
  });

designer.storage = templateStorage;
```

| オプション | 既定値 | 説明 |
|---|---|---|
| `dbName` | `'slipkit'` | 使用する IndexedDB データベース名 |
| `pageSize` | `50` | `list` が一度に返す項目数 |
| `encryptOnSave` | `false` | 保存時に本体を暗号化するか |

複数のアプリケーションや実行環境でデータが混ざらないよう、固有の `dbName` を指定することを推奨します。

> [!IMPORTANT]
> `storage` はデザイナーの「マイテンプレート」機能に使います。
> 編集のたびに発生する `slip-change` を自動的に保存する設定ではありません。
> 自動保存はイベントを受け取って別途実装する必要があります。

自動保存とサーバーストレージの接続は[アプリケーション統合ガイド](integration.ja.md)を参照してください。

### 保存内容の暗号化

現在の暗号化キーと過去のキーは `createSlipKit` に一度だけ設定します。各保存手段では `encryptOnSave` によって新規保存時の暗号化の有無だけを決めます。

```ts
const encryptionKey =
  getEncryptionKeyFromHost();

const slipkit = createSlipKit({
  locale: 'ja-JP',
  encryption: {
    key: encryptionKey,
  },
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

以前のキーで保存したファイルも読む必要があるなら、`previousKeys` を指定します。

```ts
const slipkit = createSlipKit({
  encryption: {
    key: currentKey,
    previousKeys: [previousKey],
  },
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

> [!WARNING]
> `SlipKit` に暗号化キーがない状態で `encryptOnSave: true` を使うと保存に失敗します。
> ライブラリはサンプルキーを代わりに使いません。運用キーはホストアプリケーションで管理してください。

IndexedDB の暗号化は `.slip` の本体を保護しますが、一覧に必要な次のメタデータは平文で保存します。

- 保存キー
- ファイル種類
- テンプレートのタイトル
- 最終更新時刻

タイトルまで機密情報なら、別のストレージ実装やサーバー側の保護ポリシーを使う必要があります。

### ファイルを開く・ダウンロードする

`SlipFileExchange` はファイルのダウンロードとファイル選択ダイアログを提供します。一覧・削除機能はなく、`StorageAdapter` を実装しません。

```ts
import {
  SlipFileExchange,
} from '@omdc-slipkit/elements';

const files =
  new SlipFileExchange(slipkit, {
    encryptOnSave: true,
  });

await files.download('document.slip', file);
const opened = await files.open();
```

`encryptOnSave` が `false` でも、暗号化ファイルを開くときは `SlipKit` に設定した現在のキーと過去のキーを順に試します。

## 画像サイズの制限

`<slip-designer>` と `<slip-form>` は、ユーザーがアップロードする画像の最大の元ファイルサイズを制限できます。

既定値は 2MB です。

### Web Component

```html
<slip-designer
  max-image-bytes="1048576"
></slip-designer>

<slip-form
  max-image-bytes="1048576"
></slip-form>
```

### React

```tsx
<SlipDesigner
  src={designerSrc}
  maxImageBytes={1024 * 1024}
/>

<SlipForm
  src={formSrc}
  maxImageBytes={1024 * 1024}
/>
```

### Vue

```vue
<SlipDesigner
  :src="designerSrc"
  :max-image-bytes="1024 * 1024"
/>

<SlipForm
  :src="formSrc"
  :max-image-bytes="1024 * 1024"
/>
```

この制限は次の画像選択に適用されます。

- デザイナーで追加する固定画像
- デザイナーで入力する画像サンプル値
- 入力フォームで入力する変動画像

画像は `data:` Base64 文字列として `.slip` ファイルに含まれるため、変換後のサイズが元より約 33% 大きくなることがあります。

> [!NOTE]
> `maxImageBytes` は、ユーザーが新しく選択する元の画像ファイルを検査します。
> 外部から読み込んだ既存の `.slip` ファイル全体のサイズを制限したり、すでに含まれている画像を自動的に縮小したりはしません。

アプリケーションで許可する画像サイズを決めるときは、次の項目も併せて考慮してください。

- ブラウザのメモリ使用量
- IndexedDB またはサーバーの保存容量
- API リクエストボディのサイズ制限
- PDF レンダリング時間
- 伝票 1 件に含められる画像の枚数

## Core の設定

`@omdc-slipkit/core` では、`createSlipKit` に共通設定を渡します。

```ts
import {
  createSlipKit,
} from '@omdc-slipkit/core';

const slip = createSlipKit({
  getFonts: () => appFonts,
  locale: 'ko-KR',
  encryption: {
    key: currentKey,
    previousKeys: [
      previousKey,
    ],
  },
});
```

| 設定 | 用途 |
|---|---|
| `getFonts` | PDF レンダリングに使うフォントの供給 |
| `locale` | `FORMAT_NUMBER` などの数式フォーマット関数とエラーメッセージの言語に使う BCP-47 ロケール (既定 `'en-US'`) |
| `encryption.key` | `encrypt` と `decrypt` が既定で使うキー |
| `encryption.previousKeys` | 以前のキーで暗号化されたファイルを復号するときに使うキーのリスト |

UI コンポーネントと保存手段に同じ `slipkit` を渡すと、独自フォント、数式、PDF レンダリング、ストレージのエラーメッセージが 1 つのインスタンスの設定を再利用します。コンポーネントの `locale` を省略すると、UI 言語も `SlipKit.locale` に従います。`getFonts` がない場合、コンポーネントのプレビューは同梱フォントを使います。

コンポーネントの `locale` は、UI 言語だけを別に指定する場合に使います。

| 設定 | 例 | 役割 |
|---|---|---|
| コンポーネント `locale` | `'ko'`, `'en'`, `'ja'` | UI 文言。`slipkit` がない場合は同梱フォントも選択 |
| Core `locale` | `'ko-KR'`, `'en-US'`, `'ja-JP'` | 数値と日付の数式フォーマット、エラーメッセージの言語。`getFonts` がない場合は同梱フォントも選択 |

Core の利用フローと PDF 生成方法は[Core 利用ガイド](core.ja.md)を参照してください。

## 推奨する設定構成

アプリケーション全体で同じ設定を使うなら、1 つのファイルで生成して共有する方法を推奨します。

`src/slipkit-config.ts`:

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import {
  IndexedDbStorage,
  getPresets,
  type SlipDesignerSettings,
  type SlipPreset,
} from '@omdc-slipkit/elements';

const fontPromise =
  loadAppFonts();

export const slipkit = createSlipKit({
  locale: 'ja-JP',
  getFonts: () => fontPromise,
  encryption: {
    key: currentKey,
    previousKeys: [previousKey],
  },
});

export const designerSettings:
  SlipDesignerSettings = {
    getPaperSizes: () => [
      {
        name: '配送ラベル 100×150',
        width: 100,
        height: 150,
      },
    ],

    getBarcodeKinds: () => [
      'qrcode',
      'code128',
    ],
  };

export const designerPresets:
  SlipPreset[] = [
    ...getPresets('ja'),
    shippingLabelPreset,
  ];

export const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

コンポーネントでは、必要な設定だけを渡します。

```tsx
<SlipDesigner
  src={designerSrc}
  slipkit={slipkit}
  settings={designerSettings}
  presets={designerPresets}
  storage={templateStorage}
/>

<SlipForm
  src={formSrc}
  slipkit={slipkit}
/>

<SlipViewer
  src={viewerSrc}
  slipkit={slipkit}
/>
```

この構成により、フォント、ロケール、暗号化キーを 1 つの `SlipKit` インスタンスに集約し、コンポーネントと保存手段で共有できます。

## 避けるべき設定

- オブジェクト設定を HTML 属性の文字列で渡す
- React のレンダリングのたびに新しい `slipkit`、`settings`、ストレージのインスタンスを生成する
- `getFonts` が呼ばれるたびに同じフォントをネットワークから再ダウンロードする
- 独自フォントを供給しながら、必要な既定フォントが自動的に追加されると仮定する
- 2 つ以上のフォントに `fallback: true` を指定する
- 太字フォントを基本フォントと同じ名前で登録する
- `locale` がテンプレート内の文言まで翻訳すると仮定する
- 空の `presets` 配列でプリセットメニューが非表示になると仮定する
- `storage` を自動保存の設定と解釈する
- `SlipFileExchange` をデザイナーの `storage` に渡す
- 運用用の暗号化キーをコードにハードコードする
- Base64 変換後のファイルサイズ増加を考慮せずに画像制限を設定する

## 完了確認

- [ ] `SlipKit` にフォント、ロケール、暗号化キーを一度だけ設定した。
- [ ] UI 言語を変える必要があるコンポーネントだけ `locale` を上書きした。
- [ ] 出力する文字とスタイルに必要なフォントを供給した。
- [ ] フォント供給の結果を再利用するように構成した。
- [ ] アプリケーションに必要な独自用紙とバーコード種類を設定した。
- [ ] 独自プリセットの `create` が毎回新しいテンプレートを返す。
- [ ] デザイナーストレージと自動保存の役割を区別した。
- [ ] 運用環境の暗号化キーをホストで管理する。
- [ ] 保存・送信環境に合った画像サイズ制限を設定した。
- [ ] React・Vue で設定オブジェクトとストレージのインスタンスを再利用する。

## 関連ドキュメント

- [はじめに](getting-started.ja.md)
- [フォームデザイナー利用ガイド](designer.ja.md)
- [アプリケーション統合ガイド](integration.ja.md)
- [Core 利用ガイド](core.ja.md)
- [API リファレンス](api-reference.ja.md)
