# 主要な型リファレンス

[한국어](types.md) · [English](types.en.md)

ホストアプリで扱うことになる主要な型のフィールドとデフォルト値をまとめました。
スキーマ全体の詳細は [SPEC.md](../SPEC.md) を参照してください。

---

## 設定を一覧で

ホストが 3 つのコンポーネントに注入する設定を一箇所にまとめました。● はそのコンポーネントが受け取る設定です。

| 設定（プロパティ） | `<slip-designer>` | `<slip-form>` | `<slip-viewer>` | 型 | 未指定なら |
|---|:---:|:---:|:---:|---|---|
| `src` | ● | ● | ● | `string`（HTML 属性） | 空の表示 |
| `locale` | ● | ● | ● | `'ko' \| 'en' \| 'ja'`（HTML 属性） | 韓国語 |
| `settings` | ● | ● | ● | JS プロパティ（[下記](#コンポーネント設定--settings-adr-040)） | 同梱フォント・用紙 |
| `presets` | ● | — | — | `SlipPreset[]`（JS プロパティ） | 同梱プリセット 2 種 |
| `storage` | ● | — | — | `StorageAdapter`（JS プロパティ） | 保存・一覧ボタン非表示 |
| `maxImageBytes` | ● | ● | — | `number`（属性 `max-image-bytes`） | 2MB |

- **HTML 属性 vs JS プロパティ**: `src`・`locale`・`max-image-bytes` は HTML 属性でも渡せますが、
  `settings`・`presets`・`storage` はオブジェクト・関数なので **JS プロパティでのみ**渡します（`el.storage = ...`）。
- `settings` はコンポーネントごとに形が異なります — デザイナーはフォント＋バーコード＋用紙
  （`SlipDesignerSettings`）、作成フォーム・ビューアはフォントのみ（`SlipFontProvider`）。
  [詳細](#コンポーネント設定--settings-adr-040)。
- **暗号化**はコンポーネントの設定ではなく保存アダプタの生成オプションです →
  [保存時の暗号化](#保存時の暗号化任意-adr-055)。

詳細セクション: [settings](#コンポーネント設定--settings-adr-040) · [SlipPreset](#slippreset) ·
[StorageAdapter](#storageadapter) · [Font](#font) · [RenderOptions](#renderoptions)。

---

## コンポーネント設定 — settings (ADR-040)

コンポーネントの `settings` プロパティで、ホストがレンダーフォントなどの資源を供給します。作成フォーム・
ビューアはフォントのみ（`SlipFontProvider`）、デザイナーはそこにバーコード・用紙を加えます
（`SlipDesignerSettings`）。

```ts
import type { SlipFontProvider, SlipDesignerSettings } from '@omdc-slipkit/elements';

interface SlipFontProvider {
  getFonts?(): SlipFont[] | Promise<SlipFont[]>;   // レンダーフォント（なければ同梱既定）
}

interface SlipDesignerSettings extends SlipFontProvider {
  getBarcodeKinds?(): BarcodeKind[] | Promise<BarcodeKind[]>;  // バーコード選択の候補（なければ 12 種すべて）
  getPaperSizes?():   PaperSize[]  | Promise<PaperSize[]>;     // 用紙選択に追加する一覧（同梱 4 種の後）
  savePaperSize?(size: PaperSize): void | Promise<void>;       // ユーザーが入力した用紙をホストが保管
}
```

| メソッド | コンポーネント | 未指定なら |
|---|---|---|
| `getFonts` | デザイナー・作成フォーム・ビューア | `locale` に合った同梱フォント |
| `getBarcodeKinds` | デザイナー | エンジンが描ける 12 種すべて |
| `getPaperSizes` | デザイナー | 同梱用紙 4 種のみ |
| `savePaperSize` | デザイナー | 入力した用紙を保管しない |

- すべて**任意**で、同期配列・非同期（`Promise`）どちらも返せます — フォントをサーバーフォルダから受け取っても構いません。
- `settings` は HTML 属性ではなく **JS プロパティ**でのみ渡します（`el.settings = { getFonts }`）。
- `PaperSize` は画面選択用のプリセット（`{ name, width, height }`、単位 mm）です — `.slip` には常に実際の
  幅・高さのみが入り、ファイルフォーマットとは無関係です。

---

## SlipFile

`.slip` ファイルの最上位の型です。`kind` でテンプレート（template）と伝票（voucher）を区別します。

```ts
import type { SlipFile } from '@omdc-slipkit/core';
```

### テンプレート (template)

| フィールド | 型 | 説明 |
|---|---|---|
| `schemaVersion` | `string` | スキーマバージョン (semver) |
| `kind` | `'template'` | ファイル種別 |
| `template` | オブジェクト | テンプレート本体 (下記参照) |

テンプレート本体（`template`）:

| フィールド | 型 | 説明 |
|---|---|---|
| `meta` | `{ title, createdAt?, updatedAt? }` | テンプレートのメタ情報 |
| `paper` | `PaperSize` | 用紙サイズ・余白 (単位: mm) |
| `pages` | `SlipPage[]` | ページ配列 (最小 1) |
| `assets` | `AssetEntry[]` | 内蔵リソース (画像など) |
| `parameters?` | `ParameterDef[]` | パラメータ定義部 — 物理名（`key`）・論理名（`label`）・値の種類（`valueType`）・項目フィールド（`fields`、リストのみ） |
| `sampleValues?` | `Record<string, JsonValue>` | プレビュー用のサンプル値 (発行には含まれない) |

### 伝票 (voucher)

| フィールド | 型 | 説明 |
|---|---|---|
| `schemaVersion` | `string` | スキーマバージョン |
| `kind` | `'voucher'` | ファイル種別 |
| `templateSnapshot` | テンプレート本体と同一 | 作成時点のテンプレート全体のスナップショット |
| `values` | `Record<string, JsonValue>` | バインディングキー → 入力した値 |
| `issued` | `boolean` | 発行済みかどうか |

---

## Font

PDF レンダリングとプレビューに使うフォントオブジェクトです。core の `RenderOptions.fonts` と
コンポーネントの `settings.getFonts`（ADR-040）がこの配列を受け取ります。

```ts
{ name: string; data: Uint8Array; fallback?: boolean }
```

| フィールド | 型 | デフォルト値 | 説明 |
|---|---|---|---|
| `name` | `string` | — | フォント名 (テンプレートで指定した名前とマッチング) |
| `data` | `Uint8Array` | — | フォントファイルのバイト列 (OTF/TTF) |
| `fallback` | `boolean` | `false` | `true` の場合はフォールバックフォント（代替）として使用 (1 つだけ指定可能)。何も指定しない場合は最初のフォントをフォールバックフォント（代替）として使います |

**未指定の場合**: コンポーネント（`<slip-designer>`、`<slip-form>`、`<slip-viewer>`）に `settings` を
指定しないと、`locale` に合った同梱フォントを自動的に読み込みます（韓国語・英語は Pretendard、
日本語は Noto Sans JP）。詳細は [同梱フォント・プリセット](fonts-and-presets.md) を参照してください。

---

## SlipPreset

デザイナーのプリセットメニューに使うテンプレートです。
`<slip-designer>` の `presets` 属性に配列で渡すと、同梱プリセットの代わりに表示されます。

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
```

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `string` | 一意の識別子 |
| `name` | `string` | プリセットメニューに表示される名前 |
| `create` | `() => SlipTemplateFile` | 呼び出すとテンプレートファイルを新しく作成して返します |

**未指定の場合**: `presets` を指定しないと、同梱プリセット 2 種（取引明細書、請求書）が
メニューに表示されます。同梱プリセットの内容は韓国語になっています。

---

## StorageAdapter

「マイテンプレートの保存・読み込み」機能に使うストレージインターフェースです。
`<slip-designer>` の `storage` 属性に渡すと、保存・一覧ボタンが表示されます。

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';
```

| メソッド | シグネチャ | 説明 |
|---|---|---|
| `save` | `(id: string, file: SlipFile) => Promise<void>` | ファイル保存 (同じ id なら上書き) |
| `load` | `(id: string) => Promise<SlipFile>` | ファイル読み込み |
| `delete` | `(id: string) => Promise<void>` | ファイル削除 |
| `list` | `(filter?: SlipListFilter, cursor?: string) => Promise<SlipListPage>` | 一覧取得 (ページング) |

エラーは `SlipStorageError` をスローし、`code` で原因を区別します:

| code | 意味 |
|---|---|
| `'not-found'` | 該当 id のファイルが存在しない |
| `'unsupported'` | このアダプターが対応していない操作 |
| `'io'` | ストレージの入出力に失敗 |

**未指定の場合**: `storage` を指定しないと、デザイナーに保存・一覧ボタンは表示されません。

### 同梱実装

| クラス | import | 保存媒体 |
|---|---|---|
| `IndexedDbStorage` | `@omdc-slipkit/elements` | ブラウザの IndexedDB。タイトル・種別フィルタ、カーソルページングに対応 |
| `LocalFileStorage` | `@omdc-slipkit/elements` | 保存はファイルダウンロード、読み込みはファイル選択ダイアログ。`delete`・`list` は `unsupported` |

### 保存時の暗号化（任意, ADR-055）

同梱アダプタ 2 種は、生成オプション `encryption` で**保存時に自動で暗号化**できます。
有効にすると保存時に core の暗号化（AES-256-GCM）で `.slip` の内容をロックし、読み込み時に自動で解除します。

```ts
interface StorageEncryption {
  enabled: boolean;                        // 保存時に暗号化するか (false・省略で平文)
  key?: string | Uint8Array;               // ロックするキー — パスフレーズまたは 32 バイトの生キー (なければサンプル既定キー)
  previousKeys?: (string | Uint8Array)[];  // 読み込み時に追加で試す旧キー (キーローテーション対応)
}
```

```ts
import { IndexedDbStorage, type StorageEncryption } from '@omdc-slipkit/elements';

// 生成オプションの encryption に渡す — LocalFileStorage も同じ
const storage = new IndexedDbStorage({
  encryption: { enabled: true, key: hostKey },   // ホストが供給するパスフレーズまたは生キー
});
```

| フィールド | 値 | 動作 |
|---|---|---|
| `enabled` | `boolean` | `true` で保存時に暗号化、`false`（または `encryption` 省略）で平文保存 |
| `key` | `string \| Uint8Array`（任意） | 保存時にロックするキー — パスフレーズまたは 32 バイトの生キー |
| `previousKeys` | `(string \| Uint8Array)[]`（任意） | 読み込み時に追加で試す旧キー — キー変更（ローテーション）対応 |

- `enabled: true` で `key` がないと、**デモ用サンプル既定キー**（`SAMPLE_ENCRYPTION_KEY`）でロックします。
  このキーはソースに埋め込まれており**実際のセキュリティにはなりません** — 実際に保護するには `key` を渡してください。
- **読み込みは設定に関係なく**暗号化ファイルを自動検出して解除します — 旧来の平文保存もそのまま読めます。
- `IndexedDbStorage` は本文のみをロックし、一覧表示用のタイトルは平文で残します（一覧にタイトルが出るように）。
  機微な内容は本文内（パラメータ・直接入力・画像）にあり暗号化されます。
- キー管理はホストの責任です（ADR-054）。core 単体使用時の暗号化は [Core ガイド §7](core.ja.md#7-ファイル暗号化-任意) を参照してください。

**途中で有効化する・キーを変える**

- **オフ → オン**: `enabled: true` にすると以降の保存分からロックされます。すでに平文で保存済みの
  ファイルは遡ってロックされず、開いて**保存し直したとき**にロックされます。
- **キーのローテーション**: 新しいキーを `key` に、古いキーを `previousKeys` に入れます。読み込み時に
  現在のキーが合わなければ旧キーを順に試すので古いファイルも開け、**保存し直すと新しいキーへ移行します。**
- **オフにする**: `enabled: false` にしてもロック済みファイルは封筒のまま残ります — `key`（と
  `previousKeys`）を残しておけば読み続けられ、新しい保存分だけ平文になります。

---

## RenderOptions

`renderSlipToPdf` と `createPdfRenderer` に渡す PDF レンダリングオプションです。

```ts
import type { RenderOptions } from '@omdc-slipkit/core';
```

| フィールド | 型 | デフォルト値 | 説明 |
|---|---|---|---|
| `fonts` | `Font[]` | — | PDF に使うフォントの一覧。韓国語・日本語の文書では必須 |
| `getFonts` | `() => Font[] \| Promise<Font[]>` | — | フォントを非同期で供給する関数（サーバーフォルダなど）。指定すると `fonts` より優先 (ADR-040) |
| `locale` | `string` | `'ko-KR'` | 数式フォーマット関数のロケール (BCP-47)。数値の桁区切りなどに影響 |
