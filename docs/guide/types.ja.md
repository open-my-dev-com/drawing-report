# 主要な型リファレンス

[한국어](types.md) · [English](types.en.md)

ホストアプリで扱うことになる主要な型のフィールドとデフォルト値をまとめました。
スキーマ全体の詳細は [SPEC.md](../SPEC.md) を参照してください。

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
| `bindings?` | `BindingDef[]` | バインディング定義部 — 物理名（`key`）と論理名（`label`） |
| `sampleValues?` | `Record<string, JsonValue>` | プレビュー用のサンプル値 (発行には含まれない) |

### 伝票 (voucher)

| フィールド | 型 | 説明 |
|---|---|---|
| `schemaVersion` | `string` | スキーマバージョン |
| `kind` | `'voucher'` | ファイル種別 |
| `templateSnapshot` | テンプレート本体と同一 | 作成時点のテンプレート全体のスナップショット |
| `values` | `Record<string, JsonValue>` | バインディングキー → 入力した値 |
| `issued` | `boolean` | 発行済みかどうか |
| `integrity?` | `Integrity` | ハッシュ・署名の記録 (発行時は必須) |

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

---

## IntegrityJwk

整合性の署名・検証に使う EC P-256 鍵（JWK 形式）です。

```ts
import type { IntegrityJwk } from '@omdc-slipkit/core';
```

| フィールド | 型 | 説明 |
|---|---|---|
| `kty` | `string` | 鍵タイプ (`'EC'`) |
| `crv` | `string` | 曲線 (`'P-256'`) |
| `x` | `string` | 公開鍵の x 座標 (base64url) |
| `y` | `string` | 公開鍵の y 座標 (base64url) |
| `d` | `string` | 秘密鍵 (base64url) — 署名にのみ必要、検証には不要 |
| `kid` | `string` | 鍵識別子 (任意) |

鍵ペアを自分で作成するには、次のように書きます:

```ts
import { generateSigningKeyPair } from '@omdc-slipkit/core';

const { privateKey, publicKey } = await generateSigningKeyPair();
```

**未指定の場合**: `<slip-form>` に `signingKey` を指定しないと、発行時にハッシュ（SHA-256）のみを記録し、
署名は行いません。

---

## RenderOptions

`renderSlipToPdf` と `createPdfRenderer` に渡す PDF レンダリングオプションです。

```ts
import type { RenderOptions } from '@omdc-slipkit/core';
```

| フィールド | 型 | デフォルト値 | 説明 |
|---|---|---|---|
| `fonts` | `Font[]` | — | PDF に使うフォントの一覧。韓国語・日本語の文書では必須 |
| `locale` | `string` | `'ko-KR'` | 数式フォーマット関数のロケール (BCP-47)。数値の桁区切りなどに影響 |
