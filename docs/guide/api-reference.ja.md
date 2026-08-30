# API リファレンス

[한국어](api-reference.md) · [English](api-reference.en.md)

このドキュメントは、SlipKit パッケージが公開する関数、型、コンポーネントのプロパティ、イベント、エラーを素早く確認するためのリファレンスです。

作業の順序と全体の例は、次のドキュメントを先に確認してください。

- [はじめに](getting-started.ja.md)
- [アプリケーション統合ガイド](integration.ja.md)
- [Core 利用ガイド](core.ja.md)
- [MCP 利用ガイド](mcp.ja.md)
- [環境設定ガイド](configuration.ja.md)

> [!NOTE]
> このドキュメントの型の形は、分かりやすさのために TypeScript 表記で整理しています。
> 実際の `.slip` の実行時検証は、`parseSlipFile`、`validateSlipFile` と公開スキーマを基準とします。

## パッケージ構成

| パッケージ | 主な公開 API |
|---|---|
| `@omdc-slipkit/core` | ファイル検証、伝票の組み立て、数式、PDF、暗号化、ストレージインターフェース |
| `@omdc-slipkit/elements` | Web Component、設定の型、既定プリセットとストレージ実装 |
| `@omdc-slipkit/react` | React ラッパーコンポーネント |
| `@omdc-slipkit/vue` | Vue ラッパーコンポーネント |
| `@omdc-slipkit/mcp` | ローカル stdio MCP サーバー、ファイルシステムストレージ、MCP 構造ガイド |

フォントは次のサブパスからも取得できます。

```ts
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';
```

## `@omdc-slipkit/core`

### ファイルのパースとシリアライズ

#### `parseSlipFile`

```ts
function parseSlipFile(
  json: string,
  options?: { locale?: string },
): SlipFile;
```

JSON 文字列をパースし、`.slip` ファイル全体を検証します。サポートされるマイグレーション経路があれば、現在のスキーマバージョンへ変換します。

不正な JSON やファイル構造は `SlipParseError` を発生させます。`options.locale` はエラーメッセージの言語を決めます（既定は英語）。

#### `validateSlipFile`

```ts
function validateSlipFile(
  raw: unknown,
  options?: { locale?: string },
): SlipFile;
```

すでにパース済みの値を `.slip` ファイルとして検証します。`options.locale` はエラーメッセージの言語を決めます（既定は英語）。

HTTP リクエストボディ、`JSON.parse` の結果、またはアプリケーションで直接組み立てたオブジェクトを検査するときに使います。

#### `serializeSlipFile`

```ts
function serializeSlipFile(
  file: SlipFile,
): string;
```

`SlipFile` オブジェクトをインデント付きの JSON 文字列に変換します。

この関数は入力オブジェクトを再検証しません。

#### `CURRENT_SCHEMA_VERSION`

```ts
const CURRENT_SCHEMA_VERSION: string;
```

現在ライブラリが使う `.slip` スキーマのバージョンです。

新しいテンプレートをコードで直接作るときは、バージョン文字列をハードコードせず、この定数を使うことを推奨します。

```ts
const file: SlipTemplateFile = {
  schemaVersion:
    CURRENT_SCHEMA_VERSION,
  kind: 'template',
  template: {
    // ...
  },
};
```

### 設定インスタンス

#### `createSlipKit`

```ts
function createSlipKit(
  config?: SlipKitConfig,
): SlipKit;
```

フォント、数式ロケール、暗号化キーを一度設定した Core インスタンスを作ります。

#### `SlipKitConfig`

```ts
interface SlipKitConfig {
  getFonts?:
    () =>
      | readonly SlipFont[]
      | Promise<readonly SlipFont[]>;

  locale?: string;

  encryption?: {
    key:
      | string
      | Uint8Array;

    previousKeys?: (
      | string
      | Uint8Array
    )[];
  };
}
```

| フィールド | 説明 |
|---|---|
| `getFonts` | PDF レンダリングに使うフォントを供給する関数 |
| `locale` | 数式フォーマットとエラーメッセージの言語に使う BCP-47 ロケール、既定値 `'en-US'` |
| `encryption.key` | 暗号化・復号の既定キー |
| `encryption.previousKeys` | 以前のキーで暗号化されたファイルを復号するときに追加で試すキー |

#### `SlipKit`

```ts
interface SlipKit {
  readonly locale: string | undefined;

  readonly getFonts:
    | (() =>
        | readonly SlipFont[]
        | Promise<readonly SlipFont[]>)
    | undefined;

  render(
    file: SlipFile,
  ): Promise<Uint8Array>;

  buildVoucher(
    template: SlipTemplateFile,
    values: Record<string, JsonValue>,
  ): SlipVoucherFile;

  evaluate(
    source: string | FormulaAst,
    context: FormulaContext,
  ): FormulaValue;

  encrypt(
    file: SlipFile,
    key?: string | Uint8Array,
  ): Promise<string>;

  decrypt(
    json: string,
    key?: string | Uint8Array,
  ): Promise<SlipFile>;
}
```

| プロパティ・メソッド | 戻り値 | 説明 |
|---|---|---|
| `locale` | `string \| undefined` | インスタンスに設定されたロケール |
| `getFonts` | 関数または `undefined` | インスタンスに設定されたフォント供給関数 |
| `render` | `Promise<Uint8Array>` | テンプレートまたは伝票を PDF バイトに変換 |
| `buildVoucher` | `SlipVoucherFile` | テンプレートと値で作成中の伝票を生成 |
| `evaluate` | `FormulaValue` | 数式文字列または AST を評価 |
| `encrypt` | `Promise<string>` | `.slip` ファイルを暗号化エンベロープ JSON に変換 |
| `decrypt` | `Promise<SlipFile>` | 暗号化エンベロープを復号して検証 |

### 伝票の組み立て

#### `buildVoucher`

```ts
function buildVoucher(
  template: SlipTemplateFile,
  values: Record<string, JsonValue>,
): SlipVoucherFile;
```

テンプレートと入力値を組み合わせて、`issued: false` の伝票を作ります。

- テンプレートは `templateSnapshot` としてディープコピーされます。
- 入力値も元のオブジェクトと参照を共有しません。
- 最上位の数値パラメータの空の値は `0` に正規化されます。
- 数式の結果は `values` にあらかじめ入れる必要はありません。

#### `normalizeNumericParameters`

```ts
function normalizeNumericParameters(
  values: Record<string, unknown>,
  parameters?:
    readonly ParameterDef[],
): Record<string, unknown>;
```

`valueType: 'number'` の最上位パラメータの `undefined`、`null`、空文字列を `0` に置き換えます。

変更する値がなければ、入力オブジェクトをそのまま返します。

### PDF レンダリング

#### `renderSlipToPdf`

```ts
function renderSlipToPdf(
  file: SlipFile,
  options?: RenderOptions,
): Promise<Uint8Array>;
```

テンプレートまたは伝票を一つ PDF バイトに変換する便利関数です。

#### `createPdfRenderer`

```ts
function createPdfRenderer(
  options?: RenderOptions,
): SlipPdfRenderer;
```

同じレンダリング設定を複数のファイルで再利用できる PDF レンダラーを作ります。

#### `RenderOptions`

```ts
interface RenderOptions {
  getFonts?:
    () =>
      | readonly SlipFont[]
      | Promise<readonly SlipFont[]>;

  locale?: string;
}
```

| フィールド | 既定値 | 説明 |
|---|---|---|
| `getFonts` | 下層エンジンの既定フォント | レンダリングに使うフォントを供給する関数 |
| `locale` | `'en-US'` | 数値と日付の数式フォーマット、エラーメッセージの言語に使うロケール |

#### `SlipPdfRenderer`

```ts
interface SlipPdfRenderer {
  renderToPdf(
    file: SlipFile,
  ): Promise<Uint8Array>;
}
```

#### `SlipFont`

```ts
interface SlipFont {
  name: string;
  data: Uint8Array;
  fallback?: boolean;
}
```

| フィールド | 説明 |
|---|---|
| `name` | テンプレートの `fontName` と結びつけるフォント名 |
| `data` | TTF または OTF フォントのバイト |
| `fallback` | 他のフォントが見つからないときに使う代替フォントかどうか |

`fallback: true` のフォントは 1 つだけ指定できます。指定しない場合は、配列の最初のフォントを代替フォントとして使います。

#### `stackVertically`

```ts
function stackVertically(
  text: string,
  vertical: boolean | undefined,
): string;
```

`vertical` が `true` の場合、文字列の各文字の間に改行を入れて、縦書き用の文字列を作ります。

一般的なアプリケーションで直接使う必要はあまりない、低レベルのレンダリング補助関数です。

### 数式

#### `parseFormula`

```ts
function parseFormula(
  source: string,
): FormulaAst;
```

数式文字列をパースして AST を返します。

文法が誤っているか、登録されていない関数を使うと `FormulaSyntaxError` が発生します。

#### `evaluateFormula`

```ts
function evaluateFormula(
  source: string | FormulaAst,
  context: FormulaContext,
): FormulaValue;
```

数式文字列またはパース済みの AST を評価します。

#### `FormulaContext`

```ts
interface FormulaContext {
  values: Record<string, unknown>;
  now?: Date;
  locale?: string;
}
```

| フィールド | 既定値 | 説明 |
|---|---|---|
| `values` | 必須 | 数式で参照する値 |
| `now` | 呼び出し時刻 | `TODAY` などの日付関数の基準時刻 |
| `locale` | `'en-US'` | 数値と日付のフォーマット、エラーメッセージの言語のロケール |

#### `resolveConditionalFormats`

```ts
function resolveConditionalFormats(
  rules: readonly ConditionalFormatRule[] | undefined,
  scope: Record<string, unknown>,
  options?: {
    locale?: string;
    subject?: string;
  },
): ConditionalFormatOverrides;
```

条件付き書式のルールを宣言順に評価し、条件が真になったルールのスタイルを合成します。複数のルールが同じプロパティを指定した場合は、後に宣言したルールの値を使います。

条件式の構文が正しくない場合や、結果が真偽値でない場合は `SlipRenderError` が発生します。値がない、型が一致しないなどの理由で条件式を計算できない場合は、そのルールを適用しません。

#### `FormulaValue`

```ts
type FormulaValue =
  | number
  | string
  | boolean
  | null
  | FormulaValue[];
```

#### `FormulaAst`

`FormulaAst` は、次のノードで構成される判別可能なユニオンです。

| `type` | 意味 |
|---|---|
| `number` | 数値リテラル |
| `string` | 文字列リテラル |
| `boolean` | 論理値 |
| `reference` | パラメータまたは下位フィールドの参照 |
| `call` | 関数呼び出し |
| `unary` | 単項 `+`、`-` |
| `binary` | 算術または比較の演算 |

#### `FORMULA_FUNCTIONS`

```ts
const FORMULA_FUNCTIONS:
  readonly FormulaFunctionName[];
```

現在登録されている数式関数名の一覧です。この一覧にない関数は、パースの段階で拒否されます。

関数ごとの引数と使い方は[数式関数リファレンス](formula.ja.md)を確認してください。

#### `FormulaFunctionName`

```ts
type FormulaFunctionName =
  (typeof FORMULA_FUNCTIONS)[number];
```

サポートされる数式関数名の文字列ユニオンです。

### 暗号化

#### `encryptSlipFile`

```ts
function encryptSlipFile(
  file: SlipFile,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<string>;
```

`.slip` ファイルを AES-256-GCM の暗号化エンベロープ JSON に変換します。

文字列キーはパスフレーズとして扱い、`Uint8Array` キーは 32 バイトの生 AES キーである必要があります。

#### `decryptSlipFile`

```ts
function decryptSlipFile(
  json: string,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<SlipFile>;
```

暗号化エンベロープを復号した後、`parseSlipFile` で検証します。`options.locale` はエラーメッセージの言語を決めます（既定は英語）。

#### `isEncryptedSlipFile`

```ts
function isEncryptedSlipFile(
  json: string,
): boolean;
```

JSON に SlipKit の暗号化エンベロープの目印があるかを確認します。

復号できるかどうかや、データの完全性を検証する関数ではありません。

## `.slip` ファイルの型

### `JsonValue`

```ts
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
```

伝票の `values` とテンプレートの `sampleValues` に使える JSON 値です。

### `SlipFile`

```ts
type SlipFile =
  | SlipTemplateFile
  | SlipVoucherFile;
```

`kind` を基準にテンプレートと伝票を区別する判別可能なユニオンです。

### `SlipFileKind`

```ts
type SlipFileKind =
  SlipFile['kind'];
```

現在の値は次の 2 種類です。

```ts
type SlipFileKind =
  | 'template'
  | 'voucher';
```

### `SlipTemplateFile`

```ts
interface SlipTemplateFile {
  schemaVersion: string;
  kind: 'template';
  template: SlipTemplateBody;
}
```

### `SlipVoucherFile`

```ts
interface SlipVoucherFile {
  schemaVersion: string;
  kind: 'voucher';
  templateSnapshot:
    SlipTemplateBody;

  values:
    Record<string, JsonValue>;

  issued: boolean;
}
```

| フィールド | 説明 |
|---|---|
| `templateSnapshot` | 伝票を作った時点のテンプレート全体 |
| `values` | パラメータの物理名と実際の値 |
| `issued` | 発行済みかどうか |

発行済みの伝票は、外部 URL の画像に依存できません。固定画像と変動画像の値は、ファイル内で使える形で含める必要があります。

### `SlipTemplateBody`

```ts
interface SlipTemplateBody {
  meta: {
    title: string;
    createdAt?: string;
    updatedAt?: string;
  };

  paper: CorePaperSize;
  pages: SlipPage[];
  assets: AssetEntry[];

  parameters?:
    ParameterDef[];

  sampleValues?:
    Record<string, JsonValue>;
}
```

| フィールド | 必須 | 説明 |
|---|:---:|---|
| `meta` | ● | テンプレートのタイトルと、任意の作成・更新時刻 |
| `paper` | ● | 用紙サイズと余白 |
| `pages` | ● | 最低 1 つ以上のページ |
| `assets` | ● | ファイルに含まれる画像などのアセット |
| `parameters` | — | パラメータ定義の一覧 |
| `sampleValues` | — | デザイナーのプレビュー用の値 |

`createdAt` と `updatedAt` は、タイムゾーンオフセットを含む ISO 日付・時刻文字列を使います。

### Core の `PaperSize`

`@omdc-slipkit/core` が公開する `PaperSize` は、`.slip` ファイル内の実際の用紙サイズです。

```ts
interface CorePaperSize {
  width: number;
  height: number;

  padding: [
    top: number,
    right: number,
    bottom: number,
    left: number,
  ];
}
```

サイズと余白の単位はミリメートルです。

> [!CAUTION]
> `@omdc-slipkit/elements` も `PaperSize` という名前を公開しますが、用途が異なります。
> Elements の `PaperSize` は、デザイナーの選択リストに表示する `{ name, width, height }` の形の用紙プリセットです。

2 つの型を併用するなら、別名を指定するのが安全です。

```ts
import type {
  PaperSize as SlipPaperSize,
} from '@omdc-slipkit/core';

import type {
  PaperSize as PaperPreset,
} from '@omdc-slipkit/elements';
```

### `SlipPage`

```ts
interface SlipPage {
  elements: SlipElement[];
  key?: string;
  label?: string;
  pageNumber?: PageNumber;
  flowArea?: PageFlowArea;
}
```

| フィールド | 説明 |
|---|---|
| `elements` | ページに配置された要素 |
| `key` | 外部連携に使うページの物理名 |
| `label` | デザイナーのリストに表示するページの論理名 |
| `pageNumber` | PDF に表示するページ番号の設定 |
| `flowArea` | 自動拡張する要素を配置する縦方向の範囲 |

ドキュメント内で `key` は重複できません。

### `PageFlowArea`

```ts
interface PageFlowArea {
  top: number;
  bottom: number;
}
```

`top` と `bottom` は用紙上端を基準にした mm 座標です。省略した場合は、用紙の上下余白の間をフロー領域として使います。

### `PageNumber`

```ts
interface PageNumber {
  position: PageNumberPosition;
  format?: string;
  fontSize?: number;
}
```

`format` では `{n}` が現在のページ番号、`{total}` が総ページ数に変換されます。

既定の形式は `{n} / {total}` です。

### `PageNumberPosition`

```ts
type PageNumberPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'top-left'
  | 'top-center'
  | 'top-right';
```

### `AssetEntry`

```ts
interface AssetEntry {
  id: string;
  mimeType: string;
  src: string;
}
```

`src` は次の形を使えます。

| 形 | 例 |
|---|---|
| 外部 URL | `https://example.com/logo.png` |
| Base64 データ | `data:image/png;base64,...` |
| 内蔵アセット参照 | `asset://company-logo` |

発行済みの伝票は、外部 URL の画像を含められません。

### `ParameterDef`

```ts
interface ParameterDef {
  key: string;
  label?: string;
  valueType?:
    ParameterValueType;

  fields?: ParameterField[];
}
```

| フィールド | 説明 |
|---|---|
| `key` | ファイル、数式、外部連携に使う物理名 |
| `label` | 入力フォームとデザイナーに表示する論理名 |
| `valueType` | 値の種類。省略すると文字として扱う |
| `fields` | リストパラメータの下位フィールド |

### `ParameterField`

```ts
interface ParameterField {
  key: string;
  label?: string;
  valueType?:
    ParameterValueType;
}
```

下位フィールドは、さらに `fields` を持てません。

### `ParameterValueType`

```ts
type ParameterValueType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'image'
  | 'list';
```

`fields` は `valueType: 'list'` のパラメータでのみ使えます。

## 要素の型

### `SlipElement`

```ts
type SlipElement =
  | TextElement
  | FieldElement
  | GridElement
  | ImageElement
  | BarcodeElement
  | LineElement
  | RectElement
  | EllipseElement
  | PolygonElement;
```

`type` を基準に 9 種類の要素を区別します。

### すべての要素の共通フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | 文字列ユニオン | 要素の種類 |
| `id` | `string` | ドキュメント全体で一意な要素識別子 |
| `name` | `string` | デザイナーに表示する要素名 |
| `position` | `{ x, y }` | ページの左上を基準とした位置(mm) |
| `width` | `number` | 要素の幅(mm)。グリッドは列幅の合計から求めるため使用しない |
| `height` | `number` | 要素の高さ(mm)。グリッドは行の高さの合計から求めるため使用しない |
| `group` | `string?` | 複数の要素をまとめるグループ識別子 |
| `pagePlacement` | `PagePlacement?` | 生成された出力ページでの配置と表示範囲 |

### `PagePlacement`

```ts
type OutputPageFilter =
  | 'all'
  | 'first'
  | 'continuation'
  | 'non-final'
  | 'last';

type PagePlacement =
  | { mode: 'absolute'; pages?: OutputPageFilter }
  | { mode: 'after'; target: string; gap?: number };
```

`absolute` は元の座標に要素を表示し、`pages` で表示対象の出力ページを選びます。`after` は、同じテンプレートページにある対象要素の最後の出力断片に続けて要素を配置します。

### 文字スタイルのフィールド

テキスト、フィールド、グリッド、グリッドのセルで、次のフィールドを使えます。

| フィールド | 型 | 既定の動作 |
|---|---|---|
| `fontName` | `string?` | 代替フォントを使用 |
| `fontSize` | `number?` | 要素ごとの既定サイズ |
| `alignment` | `'left' \| 'center' \| 'right'` | 左揃え |
| `verticalAlignment` | `'top' \| 'middle' \| 'bottom'` | 上揃え |
| `bold` | `boolean?` | 太字フォントの変形を使用 |
| `italic` | `boolean?` | 斜体フォントの変形を使用 |
| `underline` | `boolean?` | 下線 |
| `strikethrough` | `boolean?` | 取り消し線 |
| `lineHeight` | `number?` | 行間の倍率 |
| `characterSpacing` | `number?` | 字間(pt) |
| `vertical` | `boolean?` | 縦書き |

### 色と枠線のフィールド

該当するスタイルをサポートする要素で、次のフィールドを使います。

| フィールド | 型 |
|---|---|
| `backgroundColor` | `#RRGGBB` または `#RRGGBBAA` |
| `fontColor` | `#RRGGBB` または `#RRGGBBAA` |
| `borderColor` | `#RRGGBB` または `#RRGGBBAA` |
| `borderWidth` | `number` |
| `borderStyle` | `'solid' \| 'dashed' \| 'dotted'` |

### `ConditionalFormatRule`

```ts
interface ConditionalFormatRule {
  condition: string;
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}
```

`condition` は真偽値を返す数式です。各ルールには、色または文字の強調を 1 つ以上指定する必要があります。要素またはセルごとに最大 20 個まで宣言できます。

文字の強調は、`true` で有効になり、`false` で基本スタイルの強調が解除されます。プロパティを省略すると、基本スタイルまたは前のルールの結果を維持します。

`conditionalFormats?: ConditionalFormatRule[]` は、`TextElement`、`FieldElement`、`GridCell` でのみ使用できます。

### `ConditionalFormatOverrides`

```ts
interface ConditionalFormatOverrides {
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}
```

`resolveConditionalFormats` が返すスタイルです。条件が真になるルールがない場合、すべてのフィールドが省略されます。

### `TextElement`

```ts
interface TextElement {
  type: 'text';
  content: string;
  conditionalFormats?: ConditionalFormatRule[];

  // 共通の位置・サイズ、
  // 文字・色・枠線スタイル
}
```

すべての伝票で同じに表示する固定文字列です。

### `FieldElement`

```ts
interface FieldElement {
  type: 'field';

  parameter?: string;
  formula?: string;
  conditionalFormats?: ConditionalFormatRule[];

  // 共通の位置・サイズ、
  // 文字・色・枠線スタイル
}
```

`parameter` と `formula` のどちらか一方だけを持つ必要があります。

### `ImageElement`

```ts
interface ImageElement {
  type: 'image';

  src?: string;
  parameter?: string;

  // 共通の位置・サイズ
}
```

| フィールド | 役割 |
|---|---|
| `src` | すべての伝票で同じ固定画像 |
| `parameter` | 伝票ごとに異なる画像値のキー |

`src` と `parameter` のどちらか一方だけを持つ必要があります。

変動画像の伝票値は `data:` Base64 文字列を使います。

### `BarcodeElement`

```ts
interface BarcodeElement {
  type: 'barcode';

  kind: BarcodeKind;

  content?: string;
  parameter?: string;
  formula?: string;
  conditionalFormats?: ConditionalFormatRule[];

  fontColor?: string;
  backgroundColor?: string;
}
```

`content`、`parameter`、`formula` のいずれか一つだけを持つ必要があります。

### `BarcodeKind`

```ts
type BarcodeKind =
  | 'qrcode'
  | 'code128'
  | 'ean13'
  | 'code39'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'itf14'
  | 'nw7'
  | 'japanpost'
  | 'gs1datamatrix'
  | 'pdf417';
```

### `LineElement`

```ts
interface LineElement {
  type: 'line';

  borderColor?: string;
  borderWidth?: number;

  borderStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted';

  lineDirection?:
    | 'horizontal'
    | 'vertical'
    | 'down'
    | 'up';
}
```

`lineDirection` を省略すると `horizontal` を使います。

### `RectElement`

```ts
interface RectElement {
  type: 'rect';

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;

  borderStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted';

  radius?: number;
}
```

`radius` が `0` より大きいと、破線または点線の枠線を併用できません。

### `EllipseElement`

```ts
interface EllipseElement {
  type: 'ellipse';

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}
```

### `PolygonElement`

```ts
interface PolygonElement {
  type: 'polygon';

  sides: number;

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}
```

`sides` は 3 以上 12 以下の整数です。

### `GridElement`

```ts
interface GridElement {
  type: 'grid';

  id: string;
  name: string;
  position: { x: number; y: number };
  group?: string;
  pagePlacement?: PagePlacement;

  columns: {
    width: number;
    autoMerge?: boolean;
  }[];

  rows: {
    height: number;
  }[];

  cells: GridCell[];
  repeat?: GridRepeat;

  overflow?:
    | 'clip'
    | 'shrink';

  // 文字・色・枠線スタイル
}
```

列の幅と行の高さは、比率ではなくミリメートル単位の絶対値です。

- グリッドの幅は列幅の合計から求めます。
- グリッドのテンプレート上の高さは行の高さの合計から求めます。
- 繰り返し出力の高さと出力ページ数は、`repeat` の行範囲とページ方式から求めます。

### `GridCell`

```ts
interface GridCell {
  row: number;
  column: number;

  name?: string;

  rowSpan?: number;
  colSpan?: number;

  content?: string;
  parameter?: string;
  formula?: string;

  overflow?:
    | 'clip'
    | 'shrink';

  // 文字・色・枠線スタイル
}
```

`row` と `column` は 0 から始まります。

`content`、`parameter`、`formula` は、同時に 2 つ以上使えません。

`name` はデザイナーでセルを識別する名前で、PDF には出力されません。省略した場合、デザイナーは行と列の座標を表示します。

`item` 行範囲内の `parameter` はリスト項目の下位フィールドを指し、それ以外では伝票 `values` の最上位キーを指します。

### `GridRepeat`

```ts
interface GridRepeat {
  parameter: string;
  bands: GridBand[];
  pagination: GridPagination;
  groupBy?: string[];
  maxItems?: number;
}
```

| フィールド | 説明 |
|---|---|
| `parameter` | オブジェクトの配列を持つリストパラメータ |
| `bands` | 各テンプレート行の範囲と出力タイミングを定義する行範囲一覧 |
| `pagination` | 自動拡張または固定ページ方式 |
| `groupBy` | 連続する項目をグループ化する項目フィールド一覧 |
| `maxItems` | 出力項目の総数の上限 |

### `GridBand`

```ts
type GridBandPlacement =
  | 'before-data'
  | 'page-start'
  | 'group-start'
  | 'item'
  | 'group-end'
  | 'after-data'
  | 'page-end';

interface GridBand {
  id: string;
  name?: string;
  fromRow: number;
  toRow: number;
  placement: GridBandPlacement;
  pages?: OutputPageFilter;
  repeatOnPageBreak?: boolean;
}
```

`fromRow` と `toRow` は 0 から始まり、両端を含みます。すべてのテンプレート行は、重複や空白なく 1 つの行範囲に属する必要があり、`item` 行範囲は 1 つだけ必要です。

行範囲は `before-data`、`page-start`、`group-start`、`item`、`group-end`、`after-data`、`page-end` の順に配置します。`pages` は `page-start` と `page-end` の表示ページを制限します。`repeatOnPageBreak` は、グループが次のページに続く場合に `group-start` を再表示します。

### `GridPagination`

```ts
type GridPagination =
  | { mode: 'auto'; minItems: number }
  | { mode: 'fixed'; itemsPerPage: number };
```

`auto` はドキュメント全体に最低 `minItems` 件分の領域を確保し、実データとフロー領域から出力ページを計画します。`fixed` は各出力ページに `itemsPerPage` 件分の領域を確保します。どちらも不足分を空の項目で埋めますが、空の項目は計算範囲に含まれません。

## ストレージ API

### `StorageAdapter`

```ts
interface StorageAdapter {
  save(
    id: string,
    file: SlipFile,
  ): Promise<void>;

  load(
    id: string,
  ): Promise<SlipFile>;

  delete(
    id: string,
  ): Promise<void>;

  list(
    filter?: SlipListFilter,
    cursor?: string,
  ): Promise<SlipListPage>;
}
```

| メソッド | 説明 |
|---|---|
| `save` | 同じ ID があれば上書き |
| `load` | ID に対応するファイルを読み込む |
| `delete` | ID に対応するファイルを削除 |
| `list` | 種類と検索語で一覧を取得 |

### `SlipListFilter`

```ts
interface SlipListFilter {
  kind?: SlipFileKind;
  query?: string;
}
```

### `SlipListPage`

```ts
interface SlipListPage {
  items: SlipListItem[];
  nextCursor?: string;
}
```

`nextCursor` がなければ最後のページです。

### `SlipListItem`

```ts
interface SlipListItem {
  id: string;
  kind: SlipFileKind;
  title: string;
  updatedAt?: string;
}
```

ファイル本体を含まない一覧用のメタデータです。

### `VersionedStorageAdapter`

```ts
interface VersionedStorageAdapter
  extends StorageAdapter {
  listVersions(
    id: string,
  ): Promise<{
    version: string;
    savedAt: string;
  }[]>;

  loadVersion(
    id: string,
    version: string,
  ): Promise<SlipFile>;
}
```

バージョン履歴をサポートする独自ストレージが、任意で実装できる拡張インターフェースです。

同梱の `IndexedDbStorage` は、このインターフェースを実装しません。`SlipFileExchange` はストレージではないため、`StorageAdapter` を実装しません。

### `supportsVersions`

```ts
function supportsVersions(
  adapter: StorageAdapter,
): adapter is VersionedStorageAdapter;
```

ストレージが `listVersions` と `loadVersion` を両方実装しているかを確認する型ガードです。

## スキーマとマイグレーションの API

### 公開 Zod スキーマ

次のスキーマを `@omdc-slipkit/core` から取得できます。

| スキーマ | 検証範囲 |
|---|---|
| `slipEnvelopeSchema` | `schemaVersion` と `kind` |
| `slipFileSchema` | テンプレートまたは伝票の全体 |
| `slipTemplateFileSchema` | テンプレートファイルの全体 |
| `slipVoucherFileSchema` | 伝票ファイルの全体 |
| `slipTemplateBodySchema` | テンプレート本体 |
| `slipElementSchema` | 要素 1 つ |
| `paperSchema` | 用紙サイズと余白 |

一般的な外部入力の検証には、スキーマを直接呼ぶより、マイグレーションとエラー変換を併せて行う `parseSlipFile` または `validateSlipFile` を推奨します。

### `slipFileJsonSchema`

```ts
function slipFileJsonSchema():
  Record<string, unknown>;
```

現在の `.slip` 形式の draft 2020-12 JSON Schema オブジェクトを作ります。

パッケージには、次の JSON Schema ファイルも含まれます。

- `@omdc-slipkit/core/schemas/slip.schema.json`
- バージョンごとの `slip-<schemaVersion>.schema.json`

> [!IMPORTANT]
> JSON Schema で表現できない、いくつかの交差フィールドの検証があります。
> 完全な検証は `parseSlipFile` または `validateSlipFile` を基準にする必要があります。

### `migrateSlipDocument`

```ts
function migrateSlipDocument(
  document:
    Record<string, unknown>,

  steps?:
    readonly SlipMigrationStep[],
): Record<string, unknown>;
```

ドキュメントの `schemaVersion` を、現在のバージョンまで段階的に変換します。

通常は `parseSlipFile` と `validateSlipFile` が内部で呼び出すため、直接使う必要はあまりありません。

### `SlipMigrationStep`

```ts
interface SlipMigrationStep {
  from: string;
  to: string;

  migrate(
    document:
      Record<string, unknown>,
  ): Record<string, unknown>;
}
```

### `BUILT_IN_MIGRATIONS`

```ts
const BUILT_IN_MIGRATIONS:
  readonly SlipMigrationStep[];
```

ライブラリに含まれるマイグレーション段階の一覧です。

現在の基準スキーマが最初の公開形式のため、一覧は空です。

### `SLIP_LIMITS`

ファイル検証に使う構造サイズの上限です。

| フィールド | 現在の値 | 意味 |
|---|---:|---|
| `maxPages` | 500 | ドキュメントあたりの最大ページ数 |
| `maxElementsPerPage` | 2,000 | ページあたりの最大要素数 |
| `maxAssets` | 1,000 | ドキュメントあたりの最大アセット数 |
| `maxGridCells` | 100,000 | グリッドの最大セル数 |
| `maxParameters` | 500 | 最大パラメータ定義数 |
| `maxGridRowTracks` | 1,000 | グリッドの最大行数 |
| `maxGridColumnTracks` | 100 | グリッドの最大列数 |
| `maxRepeatPerPage` | 1,000 | ページあたりの最大繰り返し項目数 |
| `maxRepeatItems` | 100,000 | 繰り返しリスト全体の項目数の上限 |
| `maxLineHeight` | 10 | 行間の倍率の上限 |
| `maxCharacterSpacing` | 100 | 字間の絶対値の上限(pt) |

## `@omdc-slipkit/elements`

パッケージのルートを import すると、3 つの Web Component が登録されます。

```ts
import '@omdc-slipkit/elements';
```

クラスの型も直接取得できます。

```ts
import type {
  SlipDesigner,
  SlipForm,
  SlipViewer,
} from '@omdc-slipkit/elements';
```

### `<slip-designer>`

テンプレートファイルを視覚的に編集します。

#### 属性とプロパティ

| 名前 | 型 | 渡し方 | 既定値 |
|---|---|---|---|
| `src` | `string` | HTML 属性・プロパティ | `''` |
| `locale` | `string` | HTML 属性・プロパティ | `SlipKit` のロケールまたは英語 |
| `slipkit` | `SlipKit` | JS プロパティ | 省略 |
| `settings` | `SlipDesignerSettings` | JS プロパティ | 同梱の既定設定 |
| `presets` | `SlipPreset[]` | JS プロパティ | 同梱プリセット 2 種 |
| `storage` | `StorageAdapter` | JS プロパティ | 保存機能を非表示 |
| `maxImageBytes` | `number` | `max-image-bytes` 属性・プロパティ | 2MB |

`src` には、`kind: 'template'` のファイルを `serializeSlipFile` で変換した JSON 文字列を渡します。

#### イベント

| イベント | `detail` | 発生タイミング |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | テンプレートが編集されたとき |

実際の `file.kind` は `'template'` です。

このイベントは `bubbles: true`、`composed: true` で伝わります。

### `<slip-form>`

テンプレートに値を入力し、伝票を発行します。

#### 属性とプロパティ

| 名前 | 型 | 渡し方 | 既定値 |
|---|---|---|---|
| `src` | `string` | HTML 属性・プロパティ | `''` |
| `locale` | `string` | HTML 属性・プロパティ | `SlipKit` のロケールまたは英語 |
| `slipkit` | `SlipKit` | JS プロパティ | 省略 |
| `maxImageBytes` | `number` | `max-image-bytes` 属性・プロパティ | 2MB |

`src` には、次のファイルを渡せます。

- `kind: 'template'` のテンプレート
- `kind: 'voucher'`、`issued: false` の作成中の伝票
- `kind: 'voucher'`、`issued: true` の発行済み伝票

発行済みの伝票を渡すと、入力がロックされます。

#### イベント

| イベント | `detail` | 発生タイミング |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | 入力値が変わったとき |
| `slip-issue` | `{ file: SlipFile }` | 伝票の発行が完了したとき |

どちらのイベントでも、実際の `file.kind` は `'voucher'` です。

イベントは `bubbles: true`、`composed: true` で伝わります。

### `<slip-viewer>`

テンプレートや伝票を PDF にレンダリングし、読み取り専用で表示します。

#### 属性とプロパティ

| 名前 | 型 | 渡し方 | 既定値 |
|---|---|---|---|
| `src` | `string` | HTML 属性・プロパティ | `''` |
| `locale` | `string` | HTML 属性・プロパティ | `SlipKit` のロケールまたは英語 |
| `slipkit` | `SlipKit` | JS プロパティ | 省略 |

ビューアーはファイル変更イベントを発生させません。

## Elements の設定の型

### `SlipDesignerSettings`

```ts
interface SlipDesignerSettings {
  getBarcodeKinds?():
    | BarcodeKind[]
    | Promise<BarcodeKind[]>;

  getPaperSizes?():
    | ElementPaperSize[]
    | Promise<ElementPaperSize[]>;

  savePaperSize?(
    size: ElementPaperSize,
  ):
    | void
    | Promise<void>;
}
```

### Elements の `PaperSize`

```ts
interface ElementPaperSize {
  name: string;
  width: number;
  height: number;
}
```

デザイナーの用紙選択リストに表示するプリセットです。実際の `.slip` 用紙の型と違い、`name` を持ち `padding` はありません。

### `SlipPreset`

```ts
interface SlipPreset {
  id: string;
  name: string;

  create():
    SlipTemplateFile;
}
```

`create` は、呼び出すたびに独立した新しいテンプレートオブジェクトを返す必要があります。

## Elements の内蔵 API

### `getPresets`

```ts
function getPresets(
  locale?: string,
): SlipPreset[];
```

同梱の取引明細書と請求書のプリセット一覧を作ります。タイトル、ラベルと文言は `locale` の言語（既定は英語）で埋められます。

### `IndexedDbStorage`

```ts
class IndexedDbStorage
  implements StorageAdapter {
  constructor(
    slipkit: SlipKit,
    options?:
      IndexedDbStorageOptions,
  );
}
```

ブラウザの IndexedDB に `.slip` ファイルを保存します。

`save`、`load`、`delete`、`list` をすべてサポートします。

#### `IndexedDbStorageOptions`

```ts
interface IndexedDbStorageOptions {
  dbName?: string;
  pageSize?: number;
  encryptOnSave?: boolean;
}
```

| フィールド | 既定値 | 説明 |
|---|---|---|
| `dbName` | `'slipkit'` | IndexedDB データベース名 |
| `pageSize` | `50` | 一覧 1 ページの項目数 |
| `encryptOnSave` | `false` | 保存時にファイル本体を暗号化するか |

### `SlipFileExchange`

```ts
class SlipFileExchange {
  constructor(
    slipkit: SlipKit,
    options?: SlipFileExchangeOptions,
  );

  download(
    name: string,
    file: SlipFile,
  ): Promise<void>;

  open(): Promise<SlipFile>;
}
```

`SlipFileExchange` はブラウザのダウンロードとファイル選択ダイアログを提供します。`StorageAdapter` は実装せず、`download` と `open` だけを提供します。

#### `SlipFileExchangeOptions`

```ts
interface SlipFileExchangeOptions {
  encryptOnSave?: boolean;
}
```

`encryptOnSave` の既定値は `false` です。開くときはこの設定に関係なく暗号化エンベロープを検出し、`SlipKit` に設定したキーで復号します。

### 同梱フォント

#### `PRETENDARD_FONTS`

```ts
const PRETENDARD_FONTS:
  SlipFont[];
```

Pretendard Regular と Bold を含みます。Regular が代替フォントとして指定されています。

#### `NOTO_SANS_JP_FONTS`

```ts
const NOTO_SANS_JP_FONTS:
  SlipFont[];
```

Noto Sans JP Regular のサブセットを含みます。そのフォントが代替フォントとして指定されています。

## `@omdc-slipkit/react`

React 19 以上をサポートします。

### `SlipDesigner`

```ts
interface SlipDesignerProps {
  src: string;
  locale?: string;
  slipkit?: SlipKit;

  settings?:
    SlipDesignerSettings;

  presets?: SlipPreset[];
  storage?: StorageAdapter;

  maxImageBytes?: number;

  onSlipChange?(
    file: SlipFile,
  ): void;
}
```

Web Component の `slip-change` イベントから `CustomEvent` を取り除き、`SlipFile` オブジェクトをコールバックに直接渡します。

### `SlipForm`

```ts
interface SlipFormProps {
  src: string;
  locale?: string;
  slipkit?: SlipKit;

  maxImageBytes?: number;

  onSlipChange?(
    file: SlipFile,
  ): void;

  onSlipIssue?(
    file: SlipFile,
  ): void;
}
```

### `SlipViewer`

```ts
interface SlipViewerProps {
  src: string;
  locale?: string;
  slipkit?: SlipKit;
}
```

React パッケージでは、次の props の型も直接取得できます。

```ts
import type {
  SlipDesignerProps,
  SlipFormProps,
  SlipViewerProps,
} from '@omdc-slipkit/react';
```

## `@omdc-slipkit/vue`

Vue 3.4 以上をサポートします。

### `SlipDesigner`

| prop | 型 | 必須 |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |
| `settings` | `SlipDesignerSettings` | — |
| `presets` | `SlipPreset[]` | — |
| `storage` | `StorageAdapter` | — |
| `maxImageBytes` | `number` | — |

発生するイベント:

| イベント | 渡す値 |
|---|---|
| `slip-change` | `SlipFile` |

### `SlipForm`

| prop | 型 | 必須 |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |
| `maxImageBytes` | `number` | — |

発生するイベント:

| イベント | 渡す値 |
|---|---|
| `slip-change` | `SlipFile` |
| `slip-issue` | `SlipFile` |

### `SlipViewer`

| prop | 型 | 必須 |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |

## `@omdc-slipkit/mcp`

`@omdc-slipkit/mcp` は、ローカル stdio MCP サーバーと、そのサーバーが使用するファイルシステムストレージを提供します。接続方法とツールの使い方は [MCP 利用ガイド](mcp.ja.md) を確認してください。

### `createSlipMcpServer`

```ts
function createSlipMcpServer(
  options: SlipMcpServerOptions,
): {
  server: McpServer;
  storage: FileSystemStorage;
};
```

7 つのツールと `slip://schema` リソースを登録した MCP サーバーを作成します。返される `server` はまだトランスポートに接続されていません。

```ts
interface SlipMcpServerOptions
  extends FileSystemStorageOptions {
  fonts?: readonly SlipFont[];
}
```

`fonts` を省略すると、サーバーはロケールに対応する同梱フォントを使用します。指定した場合は、その一覧が同梱フォントを置き換えます。

### `FileSystemStorage`

```ts
class FileSystemStorage
  implements StorageAdapter {
  readonly rootDir: string;

  constructor(options: FileSystemStorageOptions);
  resolvePath(id: string): string;
  save(id: string, file: SlipFile): Promise<void>;
  load(id: string): Promise<SlipFile>;
  delete(id: string): Promise<void>;
  list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage>;
}
```

指定したルートディレクトリ内で `.slip` ファイルを読み書きする Node.js ストレージです。id に `.slip` 拡張子がない場合は自動的に付与し、ルート外のパスには `SlipStorageError` をスローします。

```ts
interface FileSystemStorageOptions {
  rootDir: string;
  locale?: string;
  encryption?: {
    key: FileSystemStorageKey;
    previousKeys?: FileSystemStorageKey[];
  };
}

type FileSystemStorageKey = string | Uint8Array;
```

### `slipkit-mcp.json`

```ts
interface SlipMcpConfig {
  rootDir?: string;
  locale?: string;
  fonts?: Array<{
    name: string;
    path: string;
    fallback?: boolean;
  }>;
  encryption?: {
    keyEnv?: string;
    previousKeysEnv?: string;
  };
}

interface ResolveInput {
  configPath?: string;
  cliRootDir?: string;
  cliLocale?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}
```

`rootDir` と `fonts[].path` の相対パスは、設定ファイルを置いたディレクトリを基準に解決されます。未定義のフィールド、不正な JSON、存在しない作業ディレクトリやフォントファイルは `SlipMcpConfigError` を発生させます。

### MCP 設定 API

| API | 説明 |
|---|---|
| `readConfigFile(filePath)` | JSON ファイルを読み取り、`SlipMcpConfig` として検証します。 |
| `loadConfigFonts(entries, baseDir)` | 設定されたフォントファイルを読み取り、`SlipFont[]` を返します。 |
| `resolveServerOptions(input)` | 設定ファイル、CLI 値、環境変数を解決し、`{ options, configPath }` を返します。 |
| `SlipMcpConfigError` | 設定または参照先リソースを読み取り、適用できない場合に発生するエラーです。 |
| `CONFIG_FILE_NAME` | 既定の設定ファイル名 `slipkit-mcp.json` です。 |
| `DEFAULT_KEY_ENV` | 現在のキーを読む既定の環境変数名 `SLIPKIT_MCP_KEY` です。 |
| `DEFAULT_PREVIOUS_KEYS_ENV` | 過去のキーを読む既定の環境変数名 `SLIPKIT_MCP_PREVIOUS_KEYS` です。 |

### その他の MCP 公開 API

| API | 説明 |
|---|---|
| `resolveInRoot(rootDir, relPath, locale?)` | 相対パスをルート内の絶対パスに変換し、ルート外に出る場合はエラーをスローします。 |
| `editOpSchema` | `slip_edit` 操作を検証する Zod スキーマです。 |
| `EditOp` | `editOpSchema` から推論される操作型です。 |
| `MAX_IMAGE_BYTES` | `set_image` が受け付ける最大画像サイズ `2 * 1024 * 1024` です。 |
| `SCHEMA_TOPICS` | `slip_schema` が対応するトピック一覧です。 |
| `SchemaTopic` | `SCHEMA_TOPICS` の要素型です。 |
| `schemaTopicText(topic)` | 指定したトピックの英文 `.slip` 構造ガイドを返します。 |

## エラーの型

### `SlipParseError`

`.slip` JSON のパース、スキーマ検証、またはマイグレーションに失敗したときに発生します。

### `SlipMigrationError`

`migrateSlipDocument` を直接呼び出したとき、次のようなマイグレーション失敗を表します。

- 正しくないバージョン形式
- 現在のライブラリより新しいバージョン
- マイグレーション経路なし
- マイグレーション経路の循環

`parseSlipFile` と `validateSlipFile` を通じて発生したマイグレーションエラーは、`SlipParseError` に変換されます。

### `SlipRenderError`

PDF 変換、フォント設定、またはテンプレートの数式計算に失敗したときに発生します。

### `FormulaSyntaxError`

数式の文法解析に失敗したときに発生します。

```ts
class FormulaSyntaxError
  extends Error {
  readonly position: number;
}
```

`position` は、数式文字列でエラーが発生した 0 から始まる位置です。

### `FormulaEvalError`

数式の評価中に、型の不一致、誤った引数、または 0 での除算などが発生したときに使います。

### `SlipEncryptionError`

次のような暗号化・復号の失敗に使います。

- 暗号化キーなし
- 空のパスフレーズ
- 生キーの長さエラー
- サポートしない暗号化エンベロープ
- 誤ったキー
- 暗号文の改ざん
- Web Crypto API が使用不可

### `SlipStorageError`

```ts
class SlipStorageError
  extends Error {
  readonly code:
    | 'not-found'
    | 'unsupported'
    | 'io'
    | 'cancelled';
}
```

| `code` | 意味 |
|---|---|
| `not-found` | 指定した保存キーのファイルがない |
| `unsupported` | ストレージがその機能をサポートしない |
| `io` | ストレージの読み書きの失敗 |
| `cancelled` | ユーザーがファイル選択をキャンセルした |

## 関連ドキュメント

- [はじめに](getting-started.ja.md)
- [フォームデザイナー利用ガイド](designer.ja.md)
- [アプリケーション統合ガイド](integration.ja.md)
- [Core 利用ガイド](core.ja.md)
- [MCP 利用ガイド](mcp.ja.md)
- [環境設定ガイド](configuration.ja.md)
- [数式関数リファレンス](formula.ja.md)
