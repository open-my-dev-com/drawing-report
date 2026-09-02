# SlipKit

[한국어](README.ko.md) · [English](README.md)

SlipKit は、Web アプリケーションに文書テンプレートの設計、データ入力、閲覧、PDF 出力機能を追加するライブラリです。

一般ユーザーはビジュアルデザイナーで取引明細書、請求書、見積書などのテンプレートを作成でき、開発者は Web Component または React・Vue コンポーネントとして既存のアプリケーションに統合できます。

SlipKit は単独で動作するサービスではありません。ユーザー認証、権限管理、データ保存、サーバー連携は SlipKit を利用するアプリケーション側が担当します。

![SlipKit テンプレートデザイナー](docs/guide/images/ja/overview.png)

## 主な機能

- ドラッグ＆ドロップ方式の文書テンプレートデザイナー
- テンプレートにデータを入力して伝票を発行する作成画面
- 発行済みの伝票とテンプレートを確認する読み取り専用ビューア
- ブラウザおよび Node.js で使える PDF 生成機能
- JSON ベースの `.slip` ファイルによるテンプレート・伝票の保存
- 数式、条件付き書式、表、画像、図形、バーコードのサポート
- IndexedDB とローカルファイルベースのストレージアダプタ
- 任意の AES-256-GCM ファイル暗号化
- 韓国語・英語・日本語の UI
- Web Component と React・Vue 向けラッパーの提供

## 動作の仕組み

SlipKit ではテンプレートと伝票を区別します。

| 段階 | 構成要素 | 役割 |
|---|---|---|
| テンプレート設計 | `<slip-designer>` | 文書のレイアウト、パラメータ、数式などを編集します。 |
| 伝票作成 | `<slip-form>` | テンプレートに実際の値を入力して伝票を発行します。 |
| 伝票閲覧 | `<slip-viewer>` | テンプレートまたは発行済みの伝票を読み取り専用で表示します。 |

テンプレートと伝票はいずれも `.slip` 拡張子を使い、ファイル内部の `kind` 値で区別されます。発行済みの伝票には発行時点のテンプレートが一緒に保存されるため、後で元のテンプレートが変更されても既存の伝票の構成は保たれます。

## 現在の状態

> [!IMPORTANT]
> SlipKit は現在、公開前のレビュー段階です。
>
> `@omdc-slipkit/*` パッケージはまだ npm レジストリに公開されていません。現在のバージョンはリポジトリをクローンして、デモとソースコードで確認できます。

## パッケージ構成

SlipKit は pnpm ワークスペースベースのモノレポで構成されています。

| パッケージ | 役割 |
|---|---|
| [`@omdc-slipkit/core`](packages/core) | `.slip` ファイルの検証、数式評価、伝票の組み立て、PDF 生成、ファイル暗号化を提供します。DOM に依存しないため、ブラウザと Node.js で利用できます。 |
| [`@omdc-slipkit/elements`](packages/elements) | Lit で実装した `<slip-designer>`、`<slip-form>`、`<slip-viewer>` Web Component を提供します。 |
| [`@omdc-slipkit/react`](packages/react) | SlipKit の Web Component を React コンポーネントとして使えるようにします。 |
| [`@omdc-slipkit/vue`](packages/vue) | SlipKit の Web Component を Vue コンポーネントとして使えるようにします。 |
| [`@omdc-slipkit/mcp`](packages/mcp) | AI が MCP ツールでテンプレートを作成・編集できるローカル MCP サーバーを提供します。 |

## ローカルでの実行

### 要件

- Node.js 22.13 以上
- pnpm 10.33.0
- `<slip-designer>`: 1440×810 以上のデスクトップブラウザー表示領域

### リポジトリの準備

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
pnpm install
```

### デモの実行

利用する環境に合わせてデモを一つ実行します。

```bash
# Web Component
pnpm demo

# React
pnpm demo:react

# Vue
pnpm demo:vue
```

| デモ | 既定のアドレス | 説明 |
|---|---|---|
| [`examples/demo`](examples/demo) | `http://localhost:5173` | Web Component を直接使う例 |
| [`examples/react-demo`](examples/react-demo) | `http://localhost:5174` | React ラッパーを使う例 |
| [`examples/vue-demo`](examples/vue-demo) | `http://localhost:5175` | Vue ラッパーを使う例 |

3 つのデモが提供する機能は同じです。テンプレート設計、伝票作成、PDF プレビュー、`.slip` ファイルの保存と読み込みを確認できます。

デモの自動保存やファイル処理のようなフレームワークに依存しないロジックは、[`examples/shared`](examples/shared) に共通で実装されています。

MCP ツールは [MCP Inspector デモ](examples/mcp-demo) から直接呼び出せます。このデモには Node.js 22.19 以上が必要です。

```bash
pnpm demo:mcp
```

このコマンドはサンプル作業ディレクトリを準備して MCP パッケージをビルドし、`http://localhost:6274` で Inspector を開きます。

## 利用ガイド

はじめて使うなら、[スタートガイド](docs/guide/getting-started.ja.md) でリポジトリのデモを実行し、デザイナーを接続してみてください。保存・復元と 3 つのコンポーネントの接続方法は、[アプリケーション統合ガイド](docs/guide/integration.ja.md) で続けて説明します。

すべてのドキュメントは [SlipKit ガイド](docs/guide/README.ja.md) で目的別に確認できます。

| ドキュメント | 内容 |
|---|---|
| [スタートガイド](docs/guide/getting-started.ja.md) | デモの実行とテンプレートデザイナーの最小接続 |
| [アプリケーション統合ガイド](docs/guide/integration.ja.md) | デザイナー・作成フォーム・ビューアの接続、保存・復元、サーバー連携 |
| [テンプレートデザイナー利用ガイド](docs/guide/designer.ja.md) | デザイナー画面でテンプレートを作成する方法 |
| [Core 利用ガイド](docs/guide/core.ja.md) | `.slip` ファイル処理、伝票の組み立て、数式評価、PDF 生成、暗号化 |
| [MCP 利用ガイド](docs/guide/mcp.ja.md) | AI による `.slip` の作成・編集、伝票の組み立て、PDF 確認 |
| [環境設定ガイド](docs/guide/configuration.ja.md) | 言語・フォント・用紙・バーコード・プリセット・ストレージの設定 |
| [数式関数リファレンス](docs/guide/formula.ja.md) | 数式の記述ルール、対応する関数と使用例 |
| [API リファレンス](docs/guide/api-reference.ja.md) | 関数・型・コンポーネント・イベント・エラーの全体リファレンス |

## 技術ドキュメント (Korean)

| ドキュメント | 内容 |
|---|---|
| [`.slip` ファイル形式仕様](docs/SPEC.md) | `.slip` ファイルの構造と検証ルール |
| [アーキテクチャ](docs/ARCHITECTURE.md) | パッケージ構造と外部システム連携の方式 |
| [要件](docs/REQUIREMENTS.md) | 確定した製品要件 |
| [設計判断の記録](docs/DECISIONS.md) | 主要な設計判断とその根拠 |
| [ロードマップ](docs/ROADMAP.md) | 開発状況と予定作業 |

## 開発コマンド

```bash
# コードスタイルチェック
pnpm lint

# 型チェック
pnpm typecheck

# パッケージのビルド
pnpm build

# テストの実行
pnpm test

# 検証ゲート全体
pnpm verify
```

## ライセンス

SlipKit は [Business Source License 1.1](LICENSE) の下で提供されます。ソースコードは公開されていますが、現時点では OSI 承認のオープンソースライセンスではありません。

自社アプリケーションに SlipKit を組み込むプロダクション利用は許可されています。ただし、SlipKit と競合するホスティング型または組み込み型の商用製品・サービスとして第三者に提供する場合は、別途の商用ライセンスが必要です。

ライセンスで定められた移行時期になると、Apache License 2.0 に移行します。正確な利用条件と移行時期は [LICENSE](LICENSE) を確認してください。

同梱の Pretendard と Noto Sans JP フォントには、それぞれ SIL Open Font License 1.1 が適用されます。
