# 環境設定ガイド

[한국어](configuration.md) · [English](configuration.en.md)

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

## コンポーネント設定を一覧で見る

| 設定 | デザイナー | 入力フォーム | ビューアー | 既定の動作 |
|---|:---:|:---:|:---:|---|
| `locale` | ● | ● | ● | 英語 UI |
| `settings` | ● | ● | ● | 言語に合った同梱フォントと既定リソースを使用 |
| `presets` | ● | — | — | 同梱プリセット 2 種を使用 |
| `storage` | ● | — | — | 「マイテンプレート」保存・一覧機能を非表示 |
| `maxImageBytes` | ● | ● | — | 画像の元ファイル最大 2MB |

`locale` と `max-image-bytes` は HTML 属性で渡せます。

`settings`、`presets`、`storage` はオブジェクトや関数を含むため、JavaScript プロパティ、またはフレームワークのオブジェクト prop として渡す必要があります。

## 設定の渡し方

### Web Component

文字列と数値は HTML 属性で渡せます。

```html
<slip-designer
  id="designer"
  locale="ko"
  max-image-bytes="2097152"
></slip-designer>
```

オブジェクト設定は JavaScript プロパティで渡します。

```ts
import '@omdc-slipkit/elements';

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

const settings: SlipDesignerSettings = {
  getFonts: () => appFonts,
};

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
        getFonts: () => appFonts,
      }),
      [],
    );

  return (
    <SlipDesigner
      src={designerSrc}
      locale="ko"
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
> レンダリングのたびに `settings`、`presets`、`storage` オブジェクトを新しく作らないでください。
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
  getFonts: () => appFonts,
};
</script>

<template>
  <SlipDesigner
    :src="designerSrc"
    locale="ko"
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

`locale` を省略するか、サポートしない値を渡すと、英語を使います。

`en-US`、`ko-KR`、`ja-JP` のように地域コードを含む値も使えます。この場合、先頭の言語コードで UI 言語を選択します。

```html
<slip-designer locale="ja"></slip-designer>
<slip-form locale="ja-JP"></slip-form>
<slip-viewer locale="en-US"></slip-viewer>
```

`locale` は次の項目に影響します。

- コンポーネントのボタンと案内文
- エラーメッセージ
- フォントを別途供給しなかったときに使う既定フォント

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

`settings.getFonts` を指定しないと、UI コンポーネントは `locale` に合った既定フォントを読み込みます。

| 言語 | 同梱フォント | 構成 |
|---|---|---|
| 韓国語・英語 | Pretendard | Regular・Bold |
| 日本語 | Noto Sans JP | Regular サブセット |

同梱フォントは PDF レンダリングが必要になったときに遅延読み込みされ、一度読み込むと同じ言語で再利用されます。

日本語の既定フォントは、一般的なかな、漢字、ラテン文字を含むサブセットです。同梱範囲にない文字や太字の日本語フォントが必要なら、独自フォントを供給する必要があります。

### 独自フォントの供給

3 つのコンポーネントは `settings.getFonts` を通じてフォントを受け取ります。

```ts
import type {
  SlipFontProvider,
} from '@omdc-slipkit/elements';

const settings: SlipFontProvider = {
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
};

viewer.settings = settings;
form.settings = settings;
```

`getFonts` はフォント配列、またはフォント配列を返す `Promise` を使えます。

```ts
import type {
  SlipFont,
  SlipFontProvider,
} from '@omdc-slipkit/elements';

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

let fontPromise:
  Promise<SlipFont[]> | undefined;

const settings: SlipFontProvider = {
  getFonts: () => {
    fontPromise ??= loadAppFonts();
    return fontPromise;
  },
};
```

> [!TIP]
> `getFonts` は PDF をレンダリングするときに再度呼び出されることがあります。
> ネットワークやファイルシステムからフォントを読むなら、上の例のように結果の `Promise` を保持して、同じフォントを繰り返し読み込まないように構成してください。

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

同梱フォントを独自フォントと併用するには、フォントのサブパスから直接読み込みます。

```ts
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';

const settings: SlipFontProvider = {
  getFonts: () => [
    ...PRETENDARD_FONTS,
    ...NOTO_SANS_JP_FONTS,
    {
      name: 'AppFont',
      data: appFont,
    },
  ],
};
```

> [!CAUTION]
> フルフォントファイルは、バンドルサイズと初期読み込み時間に大きく影響することがあります。
> アプリケーションで実際に使う文字と太さを含むフォントだけを供給してください。

同梱の Pretendard と Noto Sans JP には、それぞれ SIL Open Font License 1.1 が適用されます。独自フォントを含める場合は、そのフォントの配布・埋め込み条件も確認する必要があります。

## デザイナーの設定

`<slip-designer>` は、フォントのほかに用紙とバーコードの選択肢を `SlipDesignerSettings` で受け取ります。

```ts
import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designerSettings:
  SlipDesignerSettings = {
    getFonts: () => appFonts,
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

両方を一緒に表示するには、同梱の `presets` を展開して渡します。

```ts
import {
  presets as builtInPresets,
} from '@omdc-slipkit/elements';

const appPresets = [
  ...builtInPresets,
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

const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    pageSize: 50,
    locale: 'ko',
  });

designer.storage = templateStorage;
```

| オプション | 既定値 | 説明 |
|---|---|---|
| `dbName` | `'slipkit'` | 使用する IndexedDB データベース名 |
| `pageSize` | `50` | `list` が一度に返す項目数 |
| `locale` | `'en'` | ストレージのエラーメッセージの言語 |
| `encryption` | 無効 | 保存する本体の暗号化設定 |

複数のアプリケーションや実行環境でデータが混ざらないよう、固有の `dbName` を指定することを推奨します。

> [!IMPORTANT]
> `storage` はデザイナーの「マイテンプレート」機能に使います。
> 編集のたびに発生する `slip-change` を自動的に保存する設定ではありません。
> 自動保存はイベントを受け取って別途実装する必要があります。

自動保存とサーバーストレージの接続は[アプリケーション統合ガイド](integration.ja.md)を参照してください。

### 保存内容の暗号化

`IndexedDbStorage` と `LocalFileStorage` は `encryption` オプションをサポートします。

```ts
const encryptionKey =
  getEncryptionKeyFromHost();

const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    encryption: {
      enabled: true,
      key: encryptionKey,
    },
  });
```

以前のキーで保存したファイルも読む必要があるなら、`previousKeys` を指定します。

```ts
const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    encryption: {
      enabled: true,
      key: currentKey,
      previousKeys: [
        previousKey,
      ],
    },
  });
```

> [!WARNING]
> `enabled: true` でありながら `key` を省略すると、同梱のデモ用サンプルキーを使います。
> このキーはソースコードに公開されているため、実際のセキュリティ機能ではありません。
> 運用環境では、ホストが管理するキーを必ず渡してください。

IndexedDB の暗号化は `.slip` の本体を保護しますが、一覧に必要な次のメタデータは平文で保存します。

- 保存キー
- ファイル種類
- テンプレートのタイトル
- 最終更新時刻

タイトルまで機密情報なら、別のストレージ実装やサーバー側の保護ポリシーを使う必要があります。

### ローカルファイルストレージ

`LocalFileStorage` はファイルのダウンロードとファイル選択ダイアログを提供します。

```ts
import {
  LocalFileStorage,
} from '@omdc-slipkit/elements';

const localFiles =
  new LocalFileStorage({
    locale: 'ko',
    encryption: {
      enabled: true,
      key: encryptionKey,
    },
  });
```

`LocalFileStorage` は一覧表示と削除をサポートしません。そのため、デザイナーの `storage` として渡すより、アプリケーションのファイルを開く・ダウンロードする機能で直接使うのが適しています。

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

UI コンポーネントの `locale` と Core の `locale` は役割が異なります。

| 設定 | 例 | 役割 |
|---|---|---|
| コンポーネント `locale` | `'ko'`, `'en'`, `'ja'` | ボタン、案内文、同梱フォントの選択 |
| Core `locale` | `'ko-KR'`, `'en-US'`, `'ja-JP'` | 数値と日付の数式フォーマット、エラーメッセージの言語 |

Core の利用フローと PDF 生成方法は[Core 利用ガイド](core.ja.md)を参照してください。

## 推奨する設定構成

アプリケーション全体で同じ設定を使うなら、1 つのファイルで生成して共有する方法を推奨します。

`src/slipkit-config.ts`:

```ts
import {
  IndexedDbStorage,
  presets as builtInPresets,
  type SlipDesignerSettings,
  type SlipFontProvider,
  type SlipPreset,
} from '@omdc-slipkit/elements';

const fontPromise =
  loadAppFonts();

export const fontSettings:
  SlipFontProvider = {
    getFonts: () => fontPromise,
  };

export const designerSettings:
  SlipDesignerSettings = {
    getFonts: () => fontPromise,

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
    ...builtInPresets,
    shippingLabelPreset,
  ];

export const templateStorage =
  new IndexedDbStorage({
    dbName: 'my-app-templates',
    locale: 'ko',
  });
```

コンポーネントでは、必要な設定だけを渡します。

```tsx
<SlipDesigner
  src={designerSrc}
  locale="ko"
  settings={designerSettings}
  presets={designerPresets}
  storage={templateStorage}
/>

<SlipForm
  src={formSrc}
  locale="ko"
  settings={fontSettings}
/>

<SlipViewer
  src={viewerSrc}
  locale="ko"
  settings={fontSettings}
/>
```

このように構成すると、コンポーネントごとに別々の設定オブジェクトを繰り返し作らずに済み、フォントとストレージのインスタンスも再利用できます。

## 避けるべき設定

- オブジェクト設定を HTML 属性の文字列で渡す
- React のレンダリングのたびに新しい `settings` とストレージのインスタンスを生成する
- `getFonts` が呼ばれるたびに同じフォントをネットワークから再ダウンロードする
- 独自フォントを供給しながら、必要な既定フォントが自動的に追加されると仮定する
- 2 つ以上のフォントに `fallback: true` を指定する
- 太字フォントを基本フォントと同じ名前で登録する
- `locale` がテンプレート内の文言まで翻訳すると仮定する
- 空の `presets` 配列でプリセットメニューが非表示になると仮定する
- `storage` を自動保存の設定と解釈する
- `LocalFileStorage` を、一覧機能が必要なデザイナーストレージとして使う
- 運用環境で同梱のサンプル暗号化キーを使う
- Base64 変換後のファイルサイズ増加を考慮せずに画像制限を設定する

## 完了確認

- [ ] コンポーネントの UI 言語を指定した。
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
